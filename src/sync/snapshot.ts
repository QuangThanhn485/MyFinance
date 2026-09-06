import type { CttmState, EntityTable } from "@/storage/schema"
import type { ExpenseTemplate } from "@/storage/templates"

/**
 * Snapshot v3 = tài liệu được đồng bộ giữa các thiết bị.
 *
 * Chỉ gồm dữ liệu nghiệp vụ (CttmState không kèm indexes) và mẫu chi tiêu nhanh.
 * UI preferences, workspace demo, backup local... KHÔNG nằm trong đây.
 */

export const SYNC_SCHEMA = 3 as const

export type SyncedTemplates = {
  items: ExpenseTemplate[]
  tombstones: Record<string, string>
}

export type SyncDoc = {
  cttm: CttmState
  templates: SyncedTemplates
}

export type SnapshotV3 = {
  schema: typeof SYNC_SCHEMA
  version: number
  contentHash: string
  committedAt: number
  deviceId: string
  data: SyncDoc
}

export type HeadV3 = {
  schema: typeof SYNC_SCHEMA
  version: number
  contentHash: string
  genesisId: string
  deviceId: string
  deviceLabel: string
  committedAt: number
  bytes: number
  enc: "json" | "gzip+b64"
  appBuild: string
}

// ---------------------------------------------------------------------------
// Canonical form & hashing
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

/** FNV-1a 32-bit + biến thể xor-shift, ghép thành 16 ký tự hex. Thuần số, chạy được ở mọi nơi. */
export function contentHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9747b28c
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
    h2 ^= h2 >>> 15
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
}

/** Checksum djb2 của bản v2 cũ — chỉ dùng để đọc/đánh dấu key legacy. */
export function legacyChecksum(values: Record<string, string>) {
  const input = stableStringify(values)
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

// ---------------------------------------------------------------------------
// Canonical entity ordering
// ---------------------------------------------------------------------------

type WithMeta = { id: string; createdAt?: string }

export function canonicalAllIds<T extends WithMeta>(byId: Record<string, T>): string[] {
  return Object.keys(byId).sort((a, b) => {
    const ca = byId[a]?.createdAt ?? ""
    const cb = byId[b]?.createdAt ?? ""
    if (ca !== cb) return ca < cb ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

export function canonicalTable<T extends WithMeta>(table: EntityTable<T>): EntityTable<T> {
  const byId: Record<string, T> = {}
  for (const id of canonicalAllIds(table.byId)) byId[id] = table.byId[id]
  return { byId, allIds: Object.keys(byId) }
}

/**
 * Dạng dùng để hash & lưu lên Redis: bỏ indexes (rebuild được), bỏ updatedAt tổng
 * (touch() đổi mỗi action), bỏ migrations, sắp allIds tất định.
 */
export function stripForSync(state: CttmState): Omit<CttmState, "indexes" | "updatedAt" | "migrations"> {
  const { indexes: _indexes, updatedAt: _updatedAt, migrations: _migrations, ...rest } = state
  return {
    ...rest,
    entities: {
      expenses: canonicalTable(state.entities.expenses),
      fixedCosts: canonicalTable(state.entities.fixedCosts),
      purchasePlans: canonicalTable(state.entities.purchasePlans),
      savingsTransactions: canonicalTable(state.entities.savingsTransactions),
    },
    tombstones: state.tombstones ?? {},
  }
}

export function canonicalTemplates(templates: SyncedTemplates): SyncedTemplates {
  const items = templates.items
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { items, tombstones: templates.tombstones ?? {} }
}

export function hashDoc(doc: SyncDoc): string {
  return contentHash(
    stableStringify({
      cttm: stripForSync(doc.cttm),
      templates: canonicalTemplates(doc.templates),
    }),
  )
}

export function hashState(state: CttmState): string {
  return contentHash(stableStringify(stripForSync(state)))
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const GZIP_THRESHOLD_BYTES = 200 * 1024

function utf8Length(value: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length
  return value.length
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function streamBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const transform = stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  const readable = new Blob([bytes as BlobPart]).stream().pipeThrough(transform)
  const buffer = await new Response(readable).arrayBuffer()
  return new Uint8Array(buffer)
}

export function hasCompression() {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined"
}

export async function encodeSnapshot(
  snapshot: SnapshotV3,
): Promise<{ payload: string; enc: HeadV3["enc"]; bytes: number }> {
  const json = JSON.stringify(snapshot)
  const rawBytes = utf8Length(json)
  if (rawBytes > GZIP_THRESHOLD_BYTES && hasCompression()) {
    try {
      const compressed = await streamBytes(new TextEncoder().encode(json), new CompressionStream("gzip"))
      const payload = `gz1:${bytesToBase64(compressed)}`
      return { payload, enc: "gzip+b64", bytes: payload.length }
    } catch {
      // rơi về JSON thuần
    }
  }
  return { payload: json, enc: "json", bytes: rawBytes }
}

export async function decodeSnapshot(payload: string): Promise<SnapshotV3 | null> {
  try {
    let json = payload
    if (payload.startsWith("gz1:")) {
      if (!hasCompression()) throw new Error("Trình duyệt không hỗ trợ giải nén snapshot.")
      const bytes = await streamBytes(base64ToBytes(payload.slice(4)), new DecompressionStream("gzip"))
      json = new TextDecoder().decode(bytes)
    }
    const parsed = JSON.parse(json) as SnapshotV3
    if (!parsed || parsed.schema !== SYNC_SCHEMA || !parsed.data || typeof parsed.data !== "object") return null
    return parsed
  } catch {
    return null
  }
}

export function estimateRequestBytes(payload: string) {
  // Body thật của Upstash là JSON.stringify(["eval", script, ...]) nên chuỗi bị escape thêm.
  return utf8Length(JSON.stringify(payload)) + 4096
}
