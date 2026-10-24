import {
  compactFields,
  isValidRecordKey,
  jsonEqual,
  type Fields,
  type LedgerState,
  type RecordMap,
} from "@/ledger/records"

/**
 * Op = một sự thật đã xảy ra ("thêm X", "đổi field f của X", "xoá X"). Thiết bị KHÔNG bao giờ
 * gửi trạng thái; dữ liệu của mọi thiết bị = phát lại (fold) chuỗi op theo thứ tự server cấp.
 */

/** Tăng khi thêm loại op/ngữ nghĩa mới. Client gặp op có sv lớn hơn sẽ dừng phát lại và khoá ghi. */
export const OP_SCHEMA_VERSION = 1

export type OpType = "put" | "patch" | "del" | "init"

export type OpDraft = {
  t: OpType
  key: string
  /** put/init: toàn bộ field; patch: chỉ field đổi. */
  v?: Fields
  /** patch: field bị bỏ. */
  u?: string[]
}

export type LedgerOp = OpDraft & {
  sv: number
  /** Nonce duy nhất — để nhận ra op của chính mình trong sổ cái và phát hiện trùng danh tính thiết bị. */
  id: string
  dev: string
  dl?: string
  cseq: number
  /** Giờ máy lúc thao tác — chỉ để hiển thị, không dùng để sắp thứ tự. */
  at: string
  /** Gom các op của cùng một thao tác người dùng. */
  tx: string
}

export type ServerOp = LedgerOp & {
  /** Thứ tự toàn cục do server cấp (1-based, liền mạch). */
  seq: number
  sat: number
}

export type FoldEffect = "applied" | "noop" | "patch-missing" | "patch-deleted" | "init-skipped" | "invalid"

const OP_TYPES = new Set<OpType>(["put", "patch", "del", "init"])

function isFieldObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function cloneLedgerState(state: LedgerState): LedgerState {
  return { records: { ...state.records }, deleted: { ...state.deleted } }
}

/**
 * Áp một op lên bản sao làm việc (mutate `state`, nhưng không bao giờ mutate object field cũ).
 *
 * | op    | chưa có      | đang sống        | đã xoá                |
 * |-------|--------------|------------------|-----------------------|
 * | put   | tạo          | thay toàn bộ     | tạo lại (có chủ đích) |
 * | patch | bỏ qua       | gán từng field   | bỏ qua                |
 * | del   | ghi nhận xoá | xoá              | bỏ qua                |
 * | init  | tạo          | bỏ qua           | bỏ qua                |
 */
export function applyOpInPlace(state: LedgerState, op: Pick<LedgerOp, "t" | "key" | "v" | "u" | "at">): FoldEffect {
  if (!isValidRecordKey(op.key) || !OP_TYPES.has(op.t)) return "invalid"
  switch (op.t) {
    case "put": {
      if (!isFieldObject(op.v)) return "invalid"
      state.records[op.key] = compactFields(op.v)
      delete state.deleted[op.key]
      return "applied"
    }
    case "init": {
      if (!isFieldObject(op.v)) return "invalid"
      if (state.records[op.key] || state.deleted[op.key]) return "init-skipped"
      state.records[op.key] = compactFields(op.v)
      return "applied"
    }
    case "patch": {
      const current = state.records[op.key]
      if (!current) return state.deleted[op.key] ? "patch-deleted" : "patch-missing"
      const next: Fields = { ...current }
      if (isFieldObject(op.v)) {
        for (const [field, value] of Object.entries(op.v)) {
          if (value !== undefined) next[field] = value
        }
      }
      if (Array.isArray(op.u)) {
        for (const field of op.u) if (typeof field === "string") delete next[field]
      }
      state.records[op.key] = next
      return "applied"
    }
    case "del": {
      const existed = Boolean(state.records[op.key])
      delete state.records[op.key]
      if (!state.deleted[op.key]) state.deleted[op.key] = typeof op.at === "string" && op.at ? op.at : new Date(0).toISOString()
      return existed ? "applied" : "noop"
    }
    default:
      return "invalid"
  }
}

export function foldOps(
  state: LedgerState,
  ops: Array<Pick<LedgerOp, "t" | "key" | "v" | "u" | "at">>,
  onEffect?: (op: Pick<LedgerOp, "t" | "key" | "v" | "u" | "at">, effect: FoldEffect) => void,
): LedgerState {
  const next = cloneLedgerState(state)
  for (const op of ops) {
    const effect = applyOpInPlace(next, op)
    onEffect?.(op, effect)
  }
  return next
}

// ---------------------------------------------------------------------------
// Diff: hai trạng thái liên tiếp CỦA CÙNG MỘT TAB → op tối thiểu
// ---------------------------------------------------------------------------

/**
 * Sinh op biến `before` thành `after`. Chỉ dùng cho hai trạng thái liên tiếp trong cùng một tab
 * (trước/sau một thao tác), hoặc để tính op cần ghi thêm khi khôi phục/chuyển đổi — KHÔNG dùng
 * để so dữ liệu của hai thiết bị.
 */
export function diffRecordMaps(before: RecordMap, after: RecordMap): OpDraft[] {
  const drafts: OpDraft[] = []
  for (const key of Object.keys(after)) {
    const next = after[key]
    const prev = before[key]
    if (next === prev) continue
    if (!prev) {
      drafts.push({ t: "put", key, v: next })
      continue
    }
    const changed: Fields = {}
    const unset: string[] = []
    for (const field of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (jsonEqual(prev[field], next[field])) continue
      if (next[field] === undefined) unset.push(field)
      else changed[field] = next[field]
    }
    if (Object.keys(changed).length === 0 && unset.length === 0) continue
    const draft: OpDraft = { t: "patch", key, v: changed }
    if (unset.length > 0) draft.u = unset
    drafts.push(draft)
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) drafts.push({ t: "del", key })
  }
  return drafts
}

// ---------------------------------------------------------------------------
// (De)serialize
// ---------------------------------------------------------------------------

/** JSON gửi lên server. Server chèn `"seq":N,"sat":T,` ngay sau dấu `{` đầu tiên. */
export function serializeOpForAppend(op: LedgerOp): string {
  const { seq: _seq, sat: _sat, ...rest } = op as ServerOp
  const body: Record<string, unknown> = { ...rest }
  if (rest.v) body.v = compactFields(rest.v)
  return JSON.stringify(body)
}

export function parseServerOp(raw: unknown): ServerOp | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isFieldObject(parsed)) return null
  const op = parsed as Partial<ServerOp>
  if (typeof op.seq !== "number" || !Number.isInteger(op.seq) || op.seq < 1) return null
  if (typeof op.sv !== "number") return null
  if (typeof op.dev !== "string" || typeof op.id !== "string") return null
  if (typeof op.cseq !== "number" || !Number.isInteger(op.cseq)) return null
  if (typeof op.t !== "string" || typeof op.key !== "string") return null
  return {
    ...(op as ServerOp),
    at: typeof op.at === "string" ? op.at : new Date(typeof op.sat === "number" ? op.sat : 0).toISOString(),
    tx: typeof op.tx === "string" ? op.tx : "",
    sat: typeof op.sat === "number" ? op.sat : 0,
  }
}

export function isLedgerOp(value: unknown): value is LedgerOp {
  if (!isFieldObject(value)) return false
  const op = value as Partial<LedgerOp>
  return (
    typeof op.sv === "number" &&
    typeof op.id === "string" &&
    typeof op.dev === "string" &&
    typeof op.cseq === "number" &&
    typeof op.t === "string" &&
    typeof op.key === "string"
  )
}
