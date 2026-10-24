import type { OpDraft } from "@/ledger/ops"
import { diffRecordMaps } from "@/ledger/ops"
import {
  docToRecords,
  ENTITY_COLLECTIONS,
  splitRecordKey,
  type AppDoc,
  type LedgerState,
  type RecordMap,
} from "@/ledger/records"
import { normalizeCttmStateFromRaw } from "@/storage/localStorage"
import { createDefaultSettings, STORAGE_KEY, type CttmState } from "@/storage/schema"
import { normalizeTemplateList, type ExpenseTemplate } from "@/storage/templates"
import { threeWayMerge } from "@/sync/merge"
import { asString, readHeadAndSnapshot, readLegacySnapshot, readSnapshotPayload, REDIS_KEYS, type SyncRedis } from "@/sync/redisProtocol"
import { contentHash, decodeSnapshot, hashDoc, stableStringify, type SnapshotV3, type SyncDoc, type SyncedTemplates } from "@/sync/snapshot"

/**
 * Đọc dữ liệu của các cơ chế cũ (localStorage + Sync v3/v2 trên Redis) và tính trạng thái
 * gộp khi một thiết bị gia nhập sổ cái. Chỉ ĐỌC dữ liệu cũ, không bao giờ sửa/xoá nó (trừ
 * việc đóng băng v3 ở remote.ts), để luôn có đường quay lại.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const LEGACY_KEYS = {
  cttm: STORAGE_KEY,
  templates: "smartSpend.templates.v1",
  templateTombstones: "mf3.tplTombstones",
  v3Meta: "mf3.meta",
  v3Base: "mf3.base",
  /** Đánh dấu dữ liệu bản cũ của trình duyệt này ĐÃ được gộp vào sổ cái (không nhập lại lần nữa). */
  consumed: "mf4.legacyConsumed",
} as const

export function readLegacyConsumed(storage: KeyValueStorage): { genesisId: string; at: number } | null {
  const parsed = safeJson(safeGet(storage, LEGACY_KEYS.consumed)) as { genesisId?: unknown; at?: unknown } | null
  return parsed && typeof parsed.genesisId === "string" ? { genesisId: parsed.genesisId, at: Number(parsed.at) || 0 } : null
}

export function writeLegacyConsumed(storage: KeyValueStorage, genesisId: string, at: number) {
  try {
    storage.setItem(LEGACY_KEYS.consumed, JSON.stringify({ genesisId, at }))
  } catch {
    // không bắt buộc
  }
}

export type LegacyLocal = {
  hasData: boolean
  cttm: CttmState
  templates: ExpenseTemplate[]
  tombstones: Record<string, string>
  templateTombstones: Record<string, string>
  fingerprint: string
  v3: {
    deviceLabel?: string
    baseVersion: number
    baseTrusted: boolean
    genesisId?: string
    base: SyncDoc | null
  }
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === "string" && at) out[key] = at
  }
  return out
}

function safeGet(storage: KeyValueStorage, key: string) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** Dấu vân tay của dữ liệu bản cũ trong localStorage — đổi nghĩa là có tab bản cũ vừa ghi. */
export function legacyFingerprint(storage: KeyValueStorage): string {
  return contentHash(
    [safeGet(storage, LEGACY_KEYS.cttm) ?? "", safeGet(storage, LEGACY_KEYS.templates) ?? "", safeGet(storage, LEGACY_KEYS.templateTombstones) ?? ""].join("\n"),
  )
}

export function readLegacyLocal(storage: KeyValueStorage): LegacyLocal {
  const rawCttm = safeGet(storage, LEGACY_KEYS.cttm)
  const cttm = normalizeCttmStateFromRaw(rawCttm)
  const templates = normalizeTemplateList(safeJson(safeGet(storage, LEGACY_KEYS.templates)))
  const meta = safeJson(safeGet(storage, LEGACY_KEYS.v3Meta)) as
    | { deviceLabel?: string; baseVersion?: number; baseUntrusted?: boolean; genesisId?: string }
    | null
  const baseRaw = safeJson(safeGet(storage, LEGACY_KEYS.v3Base)) as SyncDoc | null
  const base =
    baseRaw && baseRaw.cttm && typeof baseRaw.cttm === "object"
      ? {
          cttm: normalizeCttmStateFromRaw(JSON.stringify(baseRaw.cttm)),
          templates: {
            items: normalizeTemplateList(baseRaw.templates?.items ?? []),
            tombstones: stringMap(baseRaw.templates?.tombstones),
          },
        }
      : null
  const baseVersion = typeof meta?.baseVersion === "number" && Number.isFinite(meta.baseVersion) ? meta.baseVersion : 0
  return {
    hasData: Boolean(rawCttm),
    cttm,
    templates,
    tombstones: { ...(cttm.tombstones ?? {}) },
    templateTombstones: stringMap(safeJson(safeGet(storage, LEGACY_KEYS.templateTombstones))),
    fingerprint: legacyFingerprint(storage),
    v3: {
      deviceLabel: typeof meta?.deviceLabel === "string" ? meta.deviceLabel : undefined,
      baseVersion,
      baseTrusted: Boolean(base) && baseVersion > 0 && meta?.baseUntrusted !== true,
      genesisId: typeof meta?.genesisId === "string" ? meta.genesisId : undefined,
      base,
    },
  }
}

// ---------------------------------------------------------------------------
// Chuyển đổi AppDoc/LedgerState ↔ SyncDoc (định dạng merge của v3)
// ---------------------------------------------------------------------------

const ENTITY_COLLECTION_VALUES = new Set<string>(Object.values(ENTITY_COLLECTIONS))

/** Lệnh xoá trong sổ cái → tombstone kiểu v3 (id trần cho entity, `cat:<id>` cho danh mục). */
export function deletedToTombstones(deleted: Record<string, string>) {
  const cttm: Record<string, string> = {}
  const templates: Record<string, string> = {}
  for (const [key, at] of Object.entries(deleted)) {
    const parsed = splitRecordKey(key)
    if (!parsed) continue
    if (ENTITY_COLLECTION_VALUES.has(parsed.collection)) cttm[parsed.id] = at
    else if (parsed.collection === "category") cttm[`cat:${parsed.id}`] = at
    else if (parsed.collection === "template") templates[parsed.id] = at
  }
  return { cttm, templates }
}

export function toSyncDoc(
  doc: AppDoc,
  deleted: Record<string, string>,
  extra: { tombstones?: Record<string, string>; templateTombstones?: Record<string, string> } = {},
): SyncDoc {
  const fromDeleted = deletedToTombstones(deleted)
  const templates: SyncedTemplates = {
    items: doc.templates,
    tombstones: { ...(extra.templateTombstones ?? {}), ...fromDeleted.templates },
  }
  return {
    cttm: { ...doc.cttm, tombstones: { ...(extra.tombstones ?? {}), ...fromDeleted.cttm } },
    templates,
  }
}

export function fromSyncDoc(doc: SyncDoc): AppDoc {
  const { tombstones: _tombstones, ...cttm } = doc.cttm
  return { cttm: cttm as CttmState, templates: doc.templates.items }
}

const DEFAULT_SETTINGS_JSON = stableStringify(createDefaultSettings())

function settingsAreDefault(settings: CttmState["settings"]) {
  return stableStringify({ ...createDefaultSettings(), ...settings }) === DEFAULT_SETTINGS_JSON
}

/** "Trống" = chưa có gì do người dùng tạo (giống v3): máy mới chỉ việc nhận dữ liệu, không gộp. */
export function isEmptyDoc(doc: SyncDoc) {
  const s = doc.cttm
  return (
    s.entities.expenses.allIds.length === 0 &&
    s.entities.fixedCosts.allIds.length === 0 &&
    s.entities.purchasePlans.allIds.length === 0 &&
    s.entities.savingsTransactions.allIds.length === 0 &&
    Object.keys(s.accountBalanceReconciliationsByMonth).length === 0 &&
    Object.keys(s.budgetAdjustmentsByMonth).length === 0 &&
    Object.keys(s.capsByMonth).length === 0 &&
    Object.keys(s.tombstones ?? {}).length === 0 &&
    !s.expenseCategories.some((category) => !category.system) &&
    doc.templates.items.length === 0 &&
    settingsAreDefault(s.settings) &&
    Object.values(s.settingsByMonth).every((monthSettings) => settingsAreDefault(monthSettings))
  )
}

/**
 * Gộp dữ liệu máy này vào bản "remote" (snapshot v3 cuối cùng, hoặc trạng thái sổ cái), đúng quy
 * tắc v3 đã chạy trên prod: máy trống/không đổi so với base ⇒ lấy remote; còn lại 3-way merge
 * (không có base ⇒ hợp nhất, không bao giờ suy ra xoá từ việc thiếu id).
 */
export function mergeLocalIntoRemote(local: SyncDoc, base: SyncDoc | null, remote: SyncDoc | null, nowIso: string): SyncDoc {
  if (!remote) return local
  if (isEmptyDoc(local)) return remote
  const localHash = hashDoc(local)
  if (localHash === hashDoc(remote)) return remote
  if (base && localHash === hashDoc(base)) return remote
  return threeWayMerge(base, local, remote, { now: nowIso }).merged
}

/**
 * Op cần ghi thêm để biến `fromRecords` (trạng thái sổ cái) thành `target`.
 * `fromRecords` là bản ghi THẬT trong sổ cái; patch lên khoá chưa có thật được nâng thành put
 * (phép chiếu có thể tự sinh vài bản ghi mặc định không nằm trong sổ cái).
 */
export function draftsToReach(fromRecords: RecordMap, fromProjected: RecordMap, target: AppDoc): OpDraft[] {
  const targetRecords = docToRecords(target)
  return diffRecordMaps(fromProjected, targetRecords).map((draft) => {
    if (draft.t === "patch" && !fromRecords[draft.key]) return { t: "put" as const, key: draft.key, v: targetRecords[draft.key] }
    return draft
  })
}

const ENTITY_ID_PREFIX: Array<[string, string]> = [
  ["ex_", "expense"],
  ["fc_", "fixedCost"],
  ["pp_", "purchasePlan"],
  ["st_", "savingsTx"],
]

/**
 * Tombstone kiểu v3 (id trần, `cat:<id>`, mẫu) → lệnh xoá trong sổ cái, giữ nguyên thời điểm xoá.
 * Bắt buộc ghi vào genesis: thiếu chúng, máy gia nhập sau còn giữ bản cũ sẽ làm mục đã xoá sống lại.
 */
export function tombstoneDrafts(doc: SyncDoc, existing: RecordMap): Array<{ draft: OpDraft; at: string }> {
  const out: Array<{ draft: OpDraft; at: string }> = []
  const del = (key: string, at: string) => {
    if (!existing[key]) out.push({ draft: { t: "del", key }, at })
  }
  for (const [id, at] of Object.entries(doc.cttm.tombstones ?? {})) {
    if (id.startsWith("cat:")) {
      del(`category/${id.slice(4)}`, at)
      continue
    }
    const known = ENTITY_ID_PREFIX.find(([prefix]) => id.startsWith(prefix))
    // Id không theo quy ước (dữ liệu nhập tay/cũ): ghi xoá cho mọi loại entity — vô hại nếu không tồn tại.
    for (const collection of known ? [known[1]] : [...ENTITY_COLLECTION_VALUES]) del(`${collection}/${id}`, at)
  }
  for (const [id, at] of Object.entries(doc.templates.tombstones ?? {})) del(`template/${id}`, at)
  return out
}

// ---------------------------------------------------------------------------
// Đọc dữ liệu cũ trên Redis
// ---------------------------------------------------------------------------

function rawDocFromSnapshotData(data: SnapshotV3["data"]): SyncDoc {
  return {
    cttm: data.cttm as CttmState,
    templates: {
      items: Array.isArray(data.templates?.items) ? data.templates.items : [],
      tombstones: data.templates?.tombstones && typeof data.templates.tombstones === "object" ? data.templates.tombstones : {},
    },
  }
}

function docFromSnapshotData(data: SnapshotV3["data"]): SyncDoc {
  return {
    cttm: normalizeCttmStateFromRaw(JSON.stringify(data.cttm ?? {})),
    templates: {
      items: normalizeTemplateList(data.templates?.items ?? []),
      tombstones: stringMap(data.templates?.tombstones),
    },
  }
}

/** Snapshot v3 cuối cùng (sau khi đóng băng). Kiểm tra hash; sai ⇒ ném lỗi, không bao giờ dùng dữ liệu hỏng. */
export async function readV3Final(redis: SyncRedis, version: number): Promise<SyncDoc | null> {
  if (version <= 0) return null
  const { head, payload } = await readHeadAndSnapshot(redis, version)
  const snapshotPayload = payload ?? (await readSnapshotPayload(redis, version))
  if (!snapshotPayload) throw new Error(`Không đọc được snapshot v3 bản ${version} trên Redis.`)
  const snapshot = await decodeSnapshot(snapshotPayload)
  if (!snapshot) throw new Error(`Snapshot v3 bản ${version} không giải mã được.`)
  const rawHash = hashDoc(rawDocFromSnapshotData(snapshot.data))
  const expected = head && head.version === version ? head.contentHash : snapshot.contentHash
  if (rawHash !== expected) throw new Error(`Snapshot v3 bản ${version} không khớp hash — dừng chuyển đổi để bảo vệ dữ liệu.`)
  return docFromSnapshotData(snapshot.data)
}

export async function readV3Genesis(redis: SyncRedis): Promise<string | undefined> {
  return asString(await redis.get(REDIS_KEYS.genesis)) ?? undefined
}

/** Dữ liệu cơ chế v2 (trước 06/09/2026) nếu Redis chưa từng có v3. */
export async function readV2(redis: SyncRedis): Promise<SyncDoc | null> {
  const legacy = await readLegacySnapshot(redis)
  if (!legacy || legacy.keyCount === 0 || legacy.supersededBy || !legacy.checksumValid) return null
  const raw = legacy.values[LEGACY_KEYS.cttm]
  if (typeof raw !== "string" || !raw) return null
  const templatesRaw = legacy.values[LEGACY_KEYS.templates]
  return {
    cttm: normalizeCttmStateFromRaw(raw),
    templates: { items: normalizeTemplateList(safeJson(typeof templatesRaw === "string" ? templatesRaw : null)), tombstones: {} },
  }
}

// ---------------------------------------------------------------------------
// Cầu nối: tab bản cũ (chưa tải lại) ghi thêm vào localStorage sau khi máy đã lên sổ cái
// ---------------------------------------------------------------------------

const BRIDGE_COLLECTIONS = new Set<string>([...ENTITY_COLLECTION_VALUES, "category", "template"])

/**
 * Chỉ NHẬN THÊM từ dữ liệu tab bản cũ: bản ghi mới, bản ghi được sửa SAU bản đang có, lệnh xoá
 * xảy ra sau thời điểm nhập. Không bao giờ để RAM cũ của tab bản cũ làm lùi cài đặt hay xoá ngầm.
 */
export function legacyBridgeDrafts(current: LedgerState, legacy: LegacyLocal, importedAt: string): OpDraft[] {
  const legacyRecords = docToRecords({ cttm: legacy.cttm, templates: legacy.templates })
  const drafts: OpDraft[] = []
  for (const [key, fields] of Object.entries(legacyRecords)) {
    const parsed = splitRecordKey(key)
    if (!parsed || !BRIDGE_COLLECTIONS.has(parsed.collection)) continue
    const existing = current.records[key]
    if (!existing) {
      if (!current.deleted[key]) drafts.push({ t: "put", key, v: fields })
      continue
    }
    const legacyUpdated = typeof fields.updatedAt === "string" ? fields.updatedAt : ""
    const currentUpdated = typeof existing.updatedAt === "string" ? existing.updatedAt : ""
    if (legacyUpdated && legacyUpdated > currentUpdated) {
      drafts.push(...diffRecordMaps({ [key]: existing }, { [key]: fields }))
    }
  }
  const deleteIfLive = (key: string) => {
    if (current.records[key]) drafts.push({ t: "del", key })
  }
  for (const [id, at] of Object.entries(legacy.tombstones)) {
    if (at <= importedAt) continue
    if (id.startsWith("cat:")) deleteIfLive(`category/${id.slice(4)}`)
    else for (const collection of ENTITY_COLLECTION_VALUES) deleteIfLive(`${collection}/${id}`)
  }
  for (const [id, at] of Object.entries(legacy.templateTombstones)) {
    if (at > importedAt) deleteIfLive(`template/${id}`)
  }
  return drafts
}
