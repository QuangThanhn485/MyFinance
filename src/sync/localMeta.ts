import { nanoid } from "nanoid"
import type { SyncDoc } from "@/sync/snapshot"
import type { ConflictEntry } from "@/sync/merge"

/**
 * Trạng thái đồng bộ cục bộ. Prefix `mf3.` cố ý KHÔNG khớp các prefix mà build cũ
 * coi là app-data (`cttm_`, `smartSpend.`, `expenses.`), nên tab build cũ không thể
 * upload/xoá những key này.
 */

export const LOCAL_KEYS = {
  meta: "mf3.meta",
  base: "mf3.base",
  history: "mf3.history",
  conflicts: "mf3.conflicts",
  templateTombstones: "mf3.tplTombstones",
  /** Bộ đếm tăng mỗi lần app (build mới) ghi cttm_v1 — để phân biệt với tiến trình ghi lạ. */
  writeSeq: "mf3.writeSeq",
  legacyLastSync: "smartSpend.storage.lastSync.v1",
  legacyLocalMeta: "smartSpend.storage.localMeta.v1",
  legacyRemoteCleanup: "smartSpend.storage.remoteCleanup.v1",
} as const

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SyncMeta = {
  deviceId: string
  deviceLabel: string
  redisUrl?: string
  genesisId?: string
  baseVersion: number
  baseHash?: string
  dirty: boolean
  dirtySince?: number
  lastPullAt?: number
  lastPushAt?: number
  lastError?: string
  legacyImportedChecksum?: string
  legacyMigrated?: boolean
  lastIssuedMs?: number
  /** Hash của bản cttm_v1 mà chính app đã ghi đĩa lần cuối. Lệch với đĩa lúc boot ⇒ có tiến trình lạ đã ghi. */
  lastPersistedHash?: string
  /** true khi base không còn đáng tin (đĩa bị ghi bởi tiến trình ngoài engine); xoá sau lần đồng bộ thành công. */
  baseUntrusted?: boolean
}

export type LocalHistoryEntry = {
  at: number
  reason: string
  version: number
  doc: SyncDoc
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeSet(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function defaultDeviceLabel() {
  if (typeof navigator === "undefined") return "Thiết bị"
  const ua = navigator.userAgent || ""
  if (/iphone|ipad/i.test(ua)) return "iPhone/iPad"
  if (/android/i.test(ua)) return "Android"
  if (/macintosh/i.test(ua)) return "Mac"
  if (/windows/i.test(ua)) return "Windows"
  if (/linux/i.test(ua)) return "Linux"
  return "Trình duyệt"
}

export function readMeta(storage: KeyValueStorage): SyncMeta {
  const parsed = safeParse<Partial<SyncMeta> | null>(storage.getItem(LOCAL_KEYS.meta), null)
  if (parsed && typeof parsed.deviceId === "string" && parsed.deviceId) {
    return {
      deviceId: parsed.deviceId,
      deviceLabel: parsed.deviceLabel || defaultDeviceLabel(),
      redisUrl: parsed.redisUrl,
      genesisId: parsed.genesisId,
      baseVersion: Number.isFinite(parsed.baseVersion) ? Number(parsed.baseVersion) : 0,
      baseHash: parsed.baseHash,
      dirty: parsed.dirty === true,
      dirtySince: parsed.dirtySince,
      lastPullAt: parsed.lastPullAt,
      lastPushAt: parsed.lastPushAt,
      lastError: parsed.lastError,
      legacyImportedChecksum: parsed.legacyImportedChecksum,
      legacyMigrated: parsed.legacyMigrated === true,
      lastIssuedMs: parsed.lastIssuedMs,
      lastPersistedHash: parsed.lastPersistedHash,
      baseUntrusted: parsed.baseUntrusted === true,
    }
  }
  const fresh: SyncMeta = {
    deviceId: `dev_${nanoid(8)}`,
    deviceLabel: defaultDeviceLabel(),
    baseVersion: 0,
    dirty: false,
  }
  safeSet(storage, LOCAL_KEYS.meta, JSON.stringify(fresh))
  return fresh
}

export function writeMeta(storage: KeyValueStorage, meta: SyncMeta) {
  safeSet(storage, LOCAL_KEYS.meta, JSON.stringify(meta))
}

export function updateMeta(storage: KeyValueStorage, patch: Partial<SyncMeta>): SyncMeta {
  const next = { ...readMeta(storage), ...patch }
  writeMeta(storage, next)
  return next
}

export function readBase(storage: KeyValueStorage): SyncDoc | null {
  const parsed = safeParse<SyncDoc | null>(storage.getItem(LOCAL_KEYS.base), null)
  if (!parsed || !parsed.cttm || typeof parsed.cttm !== "object") return null
  if (!parsed.templates) parsed.templates = { items: [], tombstones: {} }
  return parsed
}

/** Trả về false khi không lưu được (quota). Engine sẽ coi như không có base. */
export function writeBase(storage: KeyValueStorage, doc: SyncDoc | null): boolean {
  if (!doc) {
    storage.removeItem(LOCAL_KEYS.base)
    return true
  }
  const ok = safeSet(storage, LOCAL_KEYS.base, JSON.stringify(doc))
  if (!ok) storage.removeItem(LOCAL_KEYS.base)
  return ok
}

const LOCAL_HISTORY_LIMIT = 3

export function pushLocalHistory(storage: KeyValueStorage, entry: LocalHistoryEntry) {
  const current = readLocalHistory(storage)
  let next = [entry, ...current].slice(0, LOCAL_HISTORY_LIMIT)
  while (next.length > 0) {
    if (safeSet(storage, LOCAL_KEYS.history, JSON.stringify(next))) return
    next = next.slice(0, -1)
  }
  storage.removeItem(LOCAL_KEYS.history)
}

export function readLocalHistory(storage: KeyValueStorage): LocalHistoryEntry[] {
  const parsed = safeParse<LocalHistoryEntry[]>(storage.getItem(LOCAL_KEYS.history), [])
  return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.doc && entry.doc.cttm) : []
}

const CONFLICT_LIMIT = 100

export function appendConflicts(storage: KeyValueStorage, entries: ConflictEntry[]) {
  if (entries.length === 0) return
  const current = readConflicts(storage)
  const next = [...entries, ...current].slice(0, CONFLICT_LIMIT)
  if (!safeSet(storage, LOCAL_KEYS.conflicts, JSON.stringify(next))) {
    safeSet(storage, LOCAL_KEYS.conflicts, JSON.stringify(next.slice(0, 20)))
  }
}

export function readConflicts(storage: KeyValueStorage): ConflictEntry[] {
  const parsed = safeParse<ConflictEntry[]>(storage.getItem(LOCAL_KEYS.conflicts), [])
  return Array.isArray(parsed) ? parsed : []
}

export function clearConflicts(storage: KeyValueStorage) {
  storage.removeItem(LOCAL_KEYS.conflicts)
}

export function readLegacyLastSync(storage: KeyValueStorage): { revision: number; checksum?: string } | null {
  const parsed = safeParse<{ revision?: number; checksum?: string } | null>(storage.getItem(LOCAL_KEYS.legacyLastSync), null)
  if (!parsed || typeof parsed.revision !== "number") return null
  return { revision: parsed.revision, checksum: parsed.checksum }
}

export function readWriteSeq(storage: KeyValueStorage): number {
  const n = Number.parseInt(storage.getItem(LOCAL_KEYS.writeSeq) ?? "0", 10)
  return Number.isFinite(n) ? n : 0
}

export function bumpWriteSeq(storage: KeyValueStorage): number {
  const next = readWriteSeq(storage) + 1
  safeSet(storage, LOCAL_KEYS.writeSeq, String(next))
  return next
}

export function clearLegacyLocalMeta(storage: KeyValueStorage) {
  storage.removeItem(LOCAL_KEYS.legacyLastSync)
  storage.removeItem(LOCAL_KEYS.legacyLocalMeta)
  storage.removeItem(LOCAL_KEYS.legacyRemoteCleanup)
}
