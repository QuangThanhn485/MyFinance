import { parseServerOp, serializeOpForAppend, type LedgerOp, type ServerOp } from "@/ledger/ops"
import { asInt, asString, type SyncRedis } from "@/sync/redisProtocol"

/**
 * Giao thức sổ cái trên Upstash Redis.
 *
 * BẤT BIẾN: code này không có lệnh nào xoá, cắt, sửa hay ghi đè `mf4:log`. Ghi duy nhất vào
 * sổ cái là RPUSH bên trong APPEND_LUA. Lịch sử vì vậy chính là dữ liệu; không cần bản sao lưu.
 */

export const LEDGER_KEYS = {
  log: "mf4:log",
  dev: "mf4:dev",
  genesis: "mf4:genesis",
  migration: "mf4:migration",
  v3Final: "mf4:v3final",
  v3Version: "mf3:version",
} as const

/** Đọc một lần: độ dài sổ cái, genesis, trạng thái chuyển đổi, cseq cuối server đã nhận của máy này. */
export const HEAD_LUA = `
return {
  redis.call('LLEN', KEYS[1]),
  redis.call('GET', KEYS[2]) or '',
  redis.call('GET', KEYS[3]) or '',
  redis.call('HGET', KEYS[4], ARGV[1]) or '0'
}
`.trim()

/**
 * Ghi thêm một lô op của MỘT thiết bị, nguyên tử.
 * - cseq phải nối tiếp đúng cseq cuối server đã nhận của thiết bị (không bỏ qua, không trùng):
 *   lệch ⇒ trả {-1, last}, không ghi gì (client đọc lại sổ cái rồi quyết định).
 * - genesis phải khớp (đổi/xoá database ⇒ {-2, genesis}).
 * - op không hợp lệ ⇒ {-3, vị trí}, không ghi gì.
 * - Server tự cấp seq liền mạch và chèn `"seq":N,"sat":T,` vào đầu mỗi op.
 */
export const APPEND_LUA = `
for i = 6, #ARGV do
  local op = ARGV[i]
  if string.sub(op, 1, 1) ~= '{' or string.sub(op, 2, 2) == '}' or string.len(op) > 65536 then
    return {-3, i - 5}
  end
end
local g = redis.call('GET', KEYS[3])
if not g then
  if ARGV[5] == '' or ARGV[5] ~= ARGV[4] or redis.call('LLEN', KEYS[1]) ~= 0 then
    return {-2, ''}
  end
  redis.call('SET', KEYS[3], ARGV[5])
  g = ARGV[5]
elseif g ~= ARGV[4] then
  return {-2, g}
end
local last = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
if tonumber(ARGV[2]) ~= last + 1 then
  return {-1, last}
end
local seq = redis.call('LLEN', KEYS[1])
for i = 6, #ARGV do
  seq = seq + 1
  redis.call('RPUSH', KEYS[1], '{"seq":' .. seq .. ',"sat":' .. ARGV[3] .. ',' .. string.sub(ARGV[i], 2))
end
last = last + (#ARGV - 5)
redis.call('HSET', KEYS[2], ARGV[1], last)
return {1, last, seq, g}
`.trim()

/**
 * Đóng băng Sync v3 (idempotent): đổi `mf3:version` thành chuỗi không phải số để mọi CAS của
 * build cũ trượt vĩnh viễn (không thể ghi), và ghi lại version cuối vào `mf4:v3final` để đọc
 * snapshot cuối cùng / rollback. Trả về version cuối ('0' nếu chưa từng có v3).
 */
export const FREEZE_V3_LUA = `
local f = redis.call('GET', KEYS[2])
if f then return f end
local v = redis.call('GET', KEYS[1])
if not v then
  redis.call('SET', KEYS[2], '0')
  return '0'
end
if not tonumber(v) then return v end
redis.call('SET', KEYS[1], 'frozen-v4:' .. v)
redis.call('SET', KEYS[2], v)
return v
`.trim()

export type MigrationRecord = {
  state: "running" | "done"
  by: string
  byLabel?: string
  at: number
  v3Final?: number
  v3Genesis?: string
}

export type LedgerHead = {
  length: number
  genesis: string | null
  migration: MigrationRecord | null
  /** cseq lớn nhất server đã nhận của thiết bị được hỏi. */
  deviceLast: number
}

export type AppendResult =
  | { status: "ok"; last: number; length: number; genesis: string }
  | { status: "cseq-mismatch"; last: number }
  | { status: "genesis-mismatch"; genesis: string | null }
  | { status: "invalid"; index: number }

function parseMigration(raw: unknown): MigrationRecord | null {
  const text = asString(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as MigrationRecord
    if (!parsed || (parsed.state !== "running" && parsed.state !== "done") || typeof parsed.by !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export async function readLedgerHead(redis: SyncRedis, deviceId: string): Promise<LedgerHead> {
  const raw = await redis.eval(HEAD_LUA, [LEDGER_KEYS.log, LEDGER_KEYS.genesis, LEDGER_KEYS.migration, LEDGER_KEYS.dev], [deviceId])
  const list = Array.isArray(raw) ? raw : []
  const genesis = asString(list[1])
  return {
    length: asInt(list[0], 0),
    genesis: genesis ? genesis : null,
    migration: parseMigration(list[2]),
    deviceLast: asInt(list[3], 0),
  }
}

export const READ_PAGE_SIZE = 500

/**
 * Đọc op có seq trong (fromSeq, toSeq]. Luôn trả về một đoạn LIỀN MẠCH bắt đầu từ fromSeq+1:
 * - bản ghi hỏng / seq lệch ⇒ ném lỗi (không bao giờ phát lại dữ liệu sai thứ tự);
 * - replica trả ít hơn (đọc trễ hơn LLEN) ⇒ trả phần đã có, lần đồng bộ sau lấy nốt.
 */
export async function readOps(redis: SyncRedis, fromSeq: number, toSeq: number): Promise<ServerOp[]> {
  const out: ServerOp[] = []
  let next = fromSeq + 1
  while (next <= toSeq) {
    const end = Math.min(toSeq, next + READ_PAGE_SIZE - 1)
    // LRANGE dùng chỉ số 0-based: seq s nằm ở vị trí s-1.
    const raw = await redis.lrange(LEDGER_KEYS.log, next - 1, end - 1)
    const list = Array.isArray(raw) ? raw : []
    const expected = end - next + 1
    for (const item of list.slice(0, expected)) {
      const op = parseServerOp(item)
      if (!op || op.seq !== next) throw new Error(`Sổ cái trên Redis có bản ghi hỏng tại seq ${next}.`)
      out.push(op)
      next += 1
    }
    if (list.length < expected) break
  }
  return out
}

export async function appendOps(
  redis: SyncRedis,
  input: { deviceId: string; ops: LedgerOp[]; nowMs: number; expectedGenesis: string; createGenesis: boolean },
): Promise<AppendResult> {
  if (input.ops.length === 0) throw new Error("appendOps: lô rỗng")
  const raw = await redis.eval(
    APPEND_LUA,
    [LEDGER_KEYS.log, LEDGER_KEYS.dev, LEDGER_KEYS.genesis],
    [
      input.deviceId,
      String(input.ops[0].cseq),
      String(Math.trunc(input.nowMs)),
      input.expectedGenesis,
      input.createGenesis ? input.expectedGenesis : "",
      ...input.ops.map(serializeOpForAppend),
    ],
  )
  const list = Array.isArray(raw) ? raw : []
  const status = asInt(list[0], -9)
  if (status === 1) return { status: "ok", last: asInt(list[1]), length: asInt(list[2]), genesis: asString(list[3]) ?? input.expectedGenesis }
  if (status === -1) return { status: "cseq-mismatch", last: asInt(list[1]) }
  if (status === -2) return { status: "genesis-mismatch", genesis: asString(list[1]) || null }
  if (status === -3) return { status: "invalid", index: asInt(list[1]) }
  throw new Error("Redis trả về kết quả ghi sổ cái không hợp lệ.")
}

/** Ước lượng kích thước body JSON của lệnh EVAL (chuỗi bị escape thêm). */
export function estimateAppendBytes(ops: LedgerOp[]): number {
  let total = APPEND_LUA.length + 512
  for (const op of ops) total += Math.ceil(serializeOpForAppend(op).length * 1.25) + 4
  return total
}

export async function tryAcquireMigration(redis: SyncRedis, record: MigrationRecord): Promise<boolean> {
  const result = await redis.set(LEDGER_KEYS.migration, JSON.stringify(record), { nx: true })
  return result === "OK" || result === true
}

export async function markMigrationDone(redis: SyncRedis, record: MigrationRecord) {
  await redis.set(LEDGER_KEYS.migration, JSON.stringify(record))
}

/** Đóng băng v3 và trả về version cuối cùng của nó (0 nếu chưa từng có). */
export async function freezeV3(redis: SyncRedis): Promise<number> {
  const raw = await redis.eval(FREEZE_V3_LUA, [LEDGER_KEYS.v3Version, LEDGER_KEYS.v3Final], [])
  const text = asString(raw) ?? "0"
  const match = text.match(/(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : 0
}
