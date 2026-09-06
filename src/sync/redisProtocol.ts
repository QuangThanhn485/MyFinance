import { getStorageErrorMessage, sanitizeUpstashConfig, type UpstashConfig } from "@/storage/dataSource"
import { legacyChecksum, type HeadV3 } from "@/sync/snapshot"

/**
 * Giao thức Redis cho Sync v3.
 *
 * Mọi key mới nằm dưới prefix `mf3:` — không trùng và không đụng tới key cũ
 * `myfinance:storage:snapshot` ngoài việc đọc để migrate.
 */

export const REDIS_KEYS = {
  version: "mf3:version",
  head: "mf3:head",
  history: "mf3:history",
  pins: "mf3:pins",
  genesis: "mf3:genesis",
  snapPrefix: "mf3:snap:",
  legacyArchive: "mf3:legacy:v2",
  legacySnapshot: "myfinance:storage:snapshot",
} as const

export const RETENTION = {
  keepRecent: 20,
  keepDays: 60,
} as const

/**
 * Compare-and-swap commit. Redis chạy script đơn luồng nên đây là CAS thật.
 * Thứ tự ghi: snap → history → head → version (version là commit point, ghi cuối cùng)
 * để nếu lỗi giữa chừng thì version không đổi và lần push sau ghi đè lại snap:<cur+1>.
 */
export const CAS_COMMIT_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur ~= tonumber(ARGV[1]) then
  return {0, cur, redis.call('GET', KEYS[2]) or '', redis.call('GET', KEYS[5]) or ''}
end
if string.len(ARGV[2]) > tonumber(ARGV[9]) then
  return {-1, cur, 'too-large', ''}
end
local nv = cur + 1
local now = tonumber(ARGV[4])
local last = redis.call('ZRANGE', KEYS[3], -1, -1, 'WITHSCORES')
if last[2] and tonumber(last[2]) >= now then now = tonumber(last[2]) + 1 end
if cur == 0 then redis.call('SET', KEYS[5], ARGV[8], 'NX') end
redis.call('SET', ARGV[5] .. nv, ARGV[2])
redis.call('ZADD', KEYS[3], now, nv)
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[1], nv)
local keepRecent, keepDays = tonumber(ARGV[6]), tonumber(ARGV[7])
local pinned = {}
for _, v in ipairs(redis.call('SMEMBERS', KEYS[4])) do pinned[v] = true end
local all = redis.call('ZRANGE', KEYS[3], 0, -1, 'WITHSCORES')
local n, seenDay, removed = #all / 2, {}, 0
for i = n, 1, -1 do
  local ver, score = all[2*i-1], tonumber(all[2*i])
  local day = math.floor(score / 86400000)
  local keep = pinned[ver] or ((n - i) < keepRecent)
    or (((now - score) <= keepDays * 86400000) and not seenDay[day])
  seenDay[day] = true
  if not keep then
    redis.call('ZREM', KEYS[3], ver); redis.call('DEL', ARGV[5] .. ver); removed = removed + 1
  end
end
return {1, nv, redis.call('GET', KEYS[5]) or '', removed}
`.trim()

/** Tập lệnh tối thiểu engine cần. FakeRedis trong test cũng implement đúng interface này. */
export interface SyncRedis {
  ping(): Promise<unknown>
  get(key: string): Promise<unknown>
  set(key: string, value: string, opts?: { nx?: boolean }): Promise<unknown>
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>
  mget(...keys: string[]): Promise<unknown>
  zrange(key: string, min: number | string, max: number | string, opts?: { withScores?: boolean }): Promise<unknown>
  sadd(key: string, ...members: string[]): Promise<unknown>
  srem(key: string, ...members: string[]): Promise<unknown>
  smembers(key: string): Promise<unknown>
  time(): Promise<unknown>
}

const clientCache = new Map<string, Promise<SyncRedis>>()

export function createUpstashClient(config: UpstashConfig): Promise<SyncRedis> {
  const sanitized = sanitizeUpstashConfig(config)
  const cacheKey = `${sanitized.url}\n${sanitized.token}`
  const cached = clientCache.get(cacheKey)
  if (cached) return cached

  const created = (async () => {
    const { Redis } = await import("@upstash/redis/cloudflare")
    const supportsTimeout = typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function"
    const redis = new Redis({
      url: sanitized.url,
      token: sanitized.token,
      automaticDeserialization: false,
      enableAutoPipelining: false,
      enableTelemetry: false,
      keepAlive: false,
      readYourWrites: true,
      retry: { retries: 3, backoff: (attempt: number) => Math.min(2_000, 150 * 2 ** attempt) },
      ...(supportsTimeout ? { signal: () => (AbortSignal as any).timeout(25_000) as AbortSignal } : {}),
    })
    return redis as unknown as SyncRedis
  })()

  clientCache.set(cacheKey, created)
  created.catch(() => clientCache.delete(cacheKey))
  return created
}

export function resetUpstashClientCache() {
  clientCache.clear()
}

// ---------------------------------------------------------------------------
// Parsing helpers (automaticDeserialization = false → mọi thứ là chuỗi thô)
// ---------------------------------------------------------------------------

export function asString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

export function asInt(value: unknown, fallback = 0): number {
  const text = asString(value)
  if (text === null) return fallback
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : fallback
}

export function parseHead(raw: unknown): HeadV3 | null {
  const text = asString(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as HeadV3
    if (!parsed || parsed.schema !== 3 || typeof parsed.version !== "number") return null
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function readVersion(redis: SyncRedis): Promise<number> {
  return asInt(await redis.get(REDIS_KEYS.version), 0)
}

export async function readHeadAndSnapshot(
  redis: SyncRedis,
  version: number,
): Promise<{ head: HeadV3 | null; payload: string | null }> {
  const result = await redis.mget(REDIS_KEYS.head, `${REDIS_KEYS.snapPrefix}${version}`)
  const list = Array.isArray(result) ? result : [null, null]
  return { head: parseHead(list[0]), payload: asString(list[1]) }
}

export async function readSnapshotPayload(redis: SyncRedis, version: number) {
  return asString(await redis.get(`${REDIS_KEYS.snapPrefix}${version}`))
}

export type CasResult =
  | { status: "ok"; version: number; genesisId: string; removed: number }
  | { status: "conflict"; version: number; head: HeadV3 | null; genesisId: string }
  | { status: "too-large"; version: number }

export async function casCommit(
  redis: SyncRedis,
  input: {
    expectedVersion: number
    payload: string
    head: HeadV3
    nowMs: number
    genesisCandidate: string
    maxBytes: number
  },
): Promise<CasResult> {
  const raw = await redis.eval(
    CAS_COMMIT_LUA,
    [REDIS_KEYS.version, REDIS_KEYS.head, REDIS_KEYS.history, REDIS_KEYS.pins, REDIS_KEYS.genesis],
    [
      String(input.expectedVersion),
      input.payload,
      JSON.stringify(input.head),
      String(input.nowMs),
      REDIS_KEYS.snapPrefix,
      String(RETENTION.keepRecent),
      String(RETENTION.keepDays),
      input.genesisCandidate,
      String(input.maxBytes),
    ],
  )
  const list = Array.isArray(raw) ? raw : []
  const status = asInt(list[0], -2)
  if (status === 1) {
    return { status: "ok", version: asInt(list[1]), genesisId: asString(list[2]) ?? "", removed: asInt(list[3]) }
  }
  if (status === -1) {
    return { status: "too-large", version: asInt(list[1]) }
  }
  return { status: "conflict", version: asInt(list[1]), head: parseHead(list[2]), genesisId: asString(list[3]) ?? "" }
}

export type HistoryEntry = { version: number; committedAt: number; pinned: boolean }

export async function listHistory(redis: SyncRedis): Promise<HistoryEntry[]> {
  const [rangeRaw, pinsRaw] = await Promise.all([
    redis.zrange(REDIS_KEYS.history, 0, -1, { withScores: true }),
    redis.smembers(REDIS_KEYS.pins),
  ])
  const pins = new Set((Array.isArray(pinsRaw) ? pinsRaw : []).map((p) => asString(p) ?? ""))
  const flat = Array.isArray(rangeRaw) ? rangeRaw : []
  const out: HistoryEntry[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const version = asInt(flat[i])
    const committedAt = Number(asString(flat[i + 1]) ?? 0)
    out.push({ version, committedAt, pinned: pins.has(String(version)) })
  }
  return out.sort((a, b) => b.version - a.version)
}

export async function pinVersion(redis: SyncRedis, version: number) {
  await redis.sadd(REDIS_KEYS.pins, String(version))
}

export async function unpinVersion(redis: SyncRedis, version: number) {
  await redis.srem(REDIS_KEYS.pins, String(version))
}

export async function readGenesis(redis: SyncRedis) {
  return asString(await redis.get(REDIS_KEYS.genesis))
}

export async function readServerTimeMs(redis: SyncRedis): Promise<number | null> {
  try {
    const raw = await redis.time()
    const list = Array.isArray(raw) ? raw : []
    const sec = asInt(list[0], -1)
    const usec = asInt(list[1], 0)
    if (sec < 0) return null
    return sec * 1000 + Math.floor(usec / 1000)
  } catch {
    return null
  }
}

export async function pingRedis(redis: SyncRedis) {
  await redis.ping()
}

// ---------------------------------------------------------------------------
// Legacy (v2) — chỉ đọc để migrate, cộng thêm một lần đánh dấu "đã thay thế"
// ---------------------------------------------------------------------------

export type LegacyV2Snapshot = {
  raw: string
  values: Record<string, string>
  revision: number
  updatedAt: number
  checksum: string
  keyCount: number
  checksumValid: boolean
  supersededBy?: string
}

export async function readLegacySnapshot(redis: SyncRedis): Promise<LegacyV2Snapshot | null> {
  const raw = asString(await redis.get(REDIS_KEYS.legacySnapshot))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number
      manifest?: { revision?: number; updatedAt?: number; checksum?: string; keyCount?: number }
      values?: Record<string, string>
      supersededBy?: string
    }
    if (!parsed || parsed.schemaVersion !== 2 || !parsed.manifest || !parsed.values || typeof parsed.values !== "object") {
      return null
    }
    const values = parsed.values
    const checksum = parsed.manifest.checksum ?? ""
    return {
      raw,
      values,
      revision: Number(parsed.manifest.revision ?? 0),
      updatedAt: Number(parsed.manifest.updatedAt ?? 0),
      checksum,
      keyCount: Object.keys(values).length,
      checksumValid: legacyChecksum(values) === checksum,
      supersededBy: parsed.supersededBy,
    }
  } catch {
    return null
  }
}

/**
 * Marker thay cho key cũ sau khi đã chuyển sang v3. Cố ý dùng schemaVersion 3 để build cũ
 * KHÔNG parse được (parseRemoteSnapshot của build cũ đòi schemaVersion === 2): build cũ coi
 * remote là rỗng → chỉ upload bản của nó lên key cũ (bản mới sẽ thấy và gộp vào), và không
 * bao giờ "tải về" một snapshot rỗng rồi xoá dữ liệu local của chính nó.
 */
export function buildSupersededLegacyPayload(nowMs: number) {
  const values: Record<string, string> = {}
  return JSON.stringify({
    schemaVersion: 3,
    supersededBy: "v3",
    supersededAt: nowMs,
    manifest: {
      schemaVersion: 1,
      revision: nowMs,
      updatedAt: nowMs,
      keyCount: 0,
      keys: [],
      checksum: legacyChecksum(values),
    },
    values,
  })
}

/** Lưu nguyên bản v2 vào kho lưu trữ (chỉ ghi nếu chưa có). */
export async function archiveLegacySnapshot(redis: SyncRedis, legacyRaw: string) {
  await redis.set(REDIS_KEYS.legacyArchive, legacyRaw, { nx: true })
}

export async function markLegacySuperseded(redis: SyncRedis, nowMs: number) {
  await redis.set(REDIS_KEYS.legacySnapshot, buildSupersededLegacyPayload(nowMs))
}

export async function archiveLegacyAndMarkSuperseded(redis: SyncRedis, legacyRaw: string, nowMs: number) {
  await archiveLegacySnapshot(redis, legacyRaw)
  await markLegacySuperseded(redis, nowMs)
}

export async function readLegacyMarker(redis: SyncRedis): Promise<{ supersededBy: string } | null> {
  const raw = asString(await redis.get(REDIS_KEYS.legacySnapshot))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { supersededBy?: string }
    return parsed && typeof parsed.supersededBy === "string" ? { supersededBy: parsed.supersededBy } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type SyncErrorKind = "network" | "auth" | "rate-limit" | "too-large" | "unsupported" | "unknown"

export function classifySyncError(error: unknown): { kind: SyncErrorKind; message: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toLowerCase()
  // Lỗi do chính engine ném (hash không khớp, snapshot thiếu...) phải giữ nguyên câu chữ để chẩn đoán.
  const message = getStorageErrorMessage(error, raw.replace(/command was: .+$/i, "").trim() || "Không thể kết nối Upstash Redis.")
  if (normalized.includes("unauthorized") || normalized.includes("wrongpass") || normalized.includes("invalid token")) {
    return { kind: "auth", message }
  }
  if (normalized.includes("max request size") || normalized.includes("too-large")) {
    return { kind: "too-large", message: "Dữ liệu vượt giới hạn request của Upstash Redis." }
  }
  if (normalized.includes("max daily request limit") || normalized.includes("rate limit")) {
    return { kind: "rate-limit", message }
  }
  // Upstash nối "command was: [\"eval\", ...]" vào MỌI lỗi của lệnh EVAL → chỉ dựa vào mã lỗi thật.
  if (normalized.includes("unknown command") || normalized.includes("noscript") || normalized.includes("not allowed")) {
    return { kind: "unsupported", message: "Upstash Redis không cho phép chạy script (EVAL). Đồng bộ ghi đã bị khoá để bảo vệ dữ liệu." }
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("abort") ||
    normalized.includes("timeout") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound")
  ) {
    return { kind: "network", message: "Không kết nối được Upstash Redis. Thay đổi vẫn được lưu trên máy này và sẽ đồng bộ khi có mạng." }
  }
  return { kind: "unknown", message }
}
