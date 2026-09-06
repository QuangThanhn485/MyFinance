import type {
  AccountBalanceReconciliation,
  BudgetAdjustment,
  ExpenseCategoryConfig,
  Settings,
  SpendingCaps,
  YearMonth,
} from "@/domain/types"
import { DEFAULT_EXPENSE_CATEGORY_DEFINITIONS } from "@/domain/constants"
import { previousMonth } from "@/lib/date"
import { ensureCategoriesForState } from "@/storage/categories"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import type { CttmState, EntityTable, MonthLockSnapshot } from "@/storage/schema"
import type { ExpenseTemplate } from "@/storage/templates"
import { canonicalTable, stableStringify, type SyncDoc, type SyncedTemplates } from "@/sync/snapshot"

/**
 * Three-way merge cho toàn bộ tài liệu đồng bộ.
 *
 * Quy tắc chung cho một giá trị v tại (base b, local l, remote r):
 *   eq(l, r)          → l
 *   b && eq(l, b)     → r   (chỉ remote đổi)
 *   b && eq(r, b)     → l   (chỉ local đổi)
 *   còn lại           → tie-break, bên thua được ghi vào conflicts
 *
 * Xoá LUÔN đi qua tombstone; khi không có base thì không bao giờ suy luận xoá
 * từ việc "thiếu id" (union), để bản cũ không thể xoá dữ liệu của bản mới.
 */

export type ConflictEntry = {
  at: string
  kind:
    | "both-edited"
    | "delete-vs-edit"
    | "edit-vs-delete"
    | "settings-field"
    | "month-lock-rebuilt"
    | "category-in-use"
  dataKind: string
  key: string
  winner: "local" | "remote" | "delete" | "keep"
  loser?: unknown
  remoteVersion?: number
}

export type MergeStats = {
  localEntityCount: number
  mergedEntityCount: number
  localDeleted: number
  remoteAdded: number
  changed: boolean
}

export type MergeResult = {
  merged: SyncDoc
  conflicts: ConflictEntry[]
  stats: MergeStats
}

type Timestamped = { id: string; createdAt?: string; updatedAt?: string }

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_CATEGORY_ORDER = new Map(DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map((category, index) => [category.id, index]))

function eq(a: unknown, b: unknown) {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return stableStringify(a) === stableStringify(b)
}

function tsOf(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const v = value as Record<string, unknown>
  const candidate = v.updatedAt ?? v.appliedAt ?? v.closedAt ?? v.createdAt
  return typeof candidate === "string" ? candidate : ""
}

function later(a: string, b: string) {
  return a > b
}

// ---------------------------------------------------------------------------
// Entity tables
// ---------------------------------------------------------------------------

type TableMergeInput<T> = {
  base: EntityTable<T> | null
  local: EntityTable<T>
  remote: EntityTable<T>
  localTomb: Record<string, string>
  remoteTomb: Record<string, string>
  dataKind: string
  now: string
  remoteVersion?: number
}

type TableMergeOutput<T> = {
  table: EntityTable<T>
  conflicts: ConflictEntry[]
  deletedFromLocal: number
  addedFromRemote: number
}

function mergeTable<T extends Timestamped>(input: TableMergeInput<T>): TableMergeOutput<T> {
  const { base, local, remote, localTomb, remoteTomb, dataKind, now, remoteVersion } = input
  const ids = new Set<string>([
    ...Object.keys(base?.byId ?? {}),
    ...Object.keys(local.byId),
    ...Object.keys(remote.byId),
  ])
  const byId: Record<string, T> = {}
  const conflicts: ConflictEntry[] = []
  let deletedFromLocal = 0
  let addedFromRemote = 0

  const log = (entry: Omit<ConflictEntry, "at" | "dataKind" | "remoteVersion">) =>
    conflicts.push({ at: now, dataKind, remoteVersion, ...entry })

  for (const id of ids) {
    const b = base?.byId[id]
    const l = local.byId[id]
    const r = remote.byId[id]
    const tl = localTomb[id]
    const tr = remoteTomb[id]

    if (l && r) {
      if (eq(l, r)) {
        byId[id] = l
      } else if (b && eq(l, b)) {
        byId[id] = r
      } else if (b && eq(r, b)) {
        byId[id] = l
      } else {
        const localWins = later(tsOf(l), tsOf(r))
        byId[id] = localWins ? l : r
        log({ kind: "both-edited", key: id, winner: localWins ? "local" : "remote", loser: localWins ? r : l })
      }
      continue
    }

    // Xoá CHỈ đi qua tombstone. Thiếu id mà không có tombstone (bản ghi từ nguồn cũ, tombstone
    // đã GC...) không bao giờ được hiểu là "đã xoá" — thà hồi sinh còn hơn mất im lặng.
    if (l && !r) {
      if (tr) {
        if (later(tsOf(l), tr) && (!b || !eq(l, b))) {
          byId[id] = l
          log({ kind: "delete-vs-edit", key: id, winner: "keep", loser: { deletedAt: tr } })
        } else {
          deletedFromLocal += 1
          if (b && !eq(l, b)) log({ kind: "delete-vs-edit", key: id, winner: "delete", loser: l })
        }
      } else {
        byId[id] = l
      }
      continue
    }

    if (!l && r) {
      if (tl) {
        if (later(tsOf(r), tl) && (!b || !eq(r, b))) {
          byId[id] = r
          addedFromRemote += 1
          log({ kind: "delete-vs-edit", key: id, winner: "keep", loser: { deletedAt: tl } })
        }
      } else {
        byId[id] = r
        addedFromRemote += 1
      }
    }
  }

  return { table: canonicalTable({ byId, allIds: Object.keys(byId) }), conflicts, deletedFromLocal, addedFromRemote }
}

function mergeTombstones(
  local: Record<string, string>,
  remote: Record<string, string>,
  keptIds: Set<string>,
  nowMs: number,
) {
  const out: Record<string, string> = {}
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  for (const key of keys) {
    if (keptIds.has(key)) continue
    const a = local[key]
    const b = remote[key]
    const at = a && b ? (a > b ? a : b) : (a ?? b)
    if (!at) continue
    const ageMs = nowMs - Date.parse(at)
    if (Number.isFinite(ageMs) && ageMs > TOMBSTONE_TTL_MS) continue
    out[key] = at
  }
  return out
}

// ---------------------------------------------------------------------------
// Records (settings per-field, month maps)
// ---------------------------------------------------------------------------

function mergeFields<T extends object>(
  base: T | null | undefined,
  local: T,
  remote: T,
  onConflict: (field: string, localValue: unknown, remoteValue: unknown) => void,
): T {
  const out: Record<string, unknown> = {}
  const l = local as Record<string, unknown>
  const r = remote as Record<string, unknown>
  const b = (base ?? null) as Record<string, unknown> | null
  const keys = new Set([...Object.keys(l), ...Object.keys(r)])
  for (const key of keys) {
    const vl = l[key]
    const vr = r[key]
    const vb = b ? b[key] : undefined
    if (eq(vl, vr)) out[key] = vl
    else if (base && eq(vl, vb)) out[key] = vr
    else if (base && eq(vr, vb)) out[key] = vl
    else {
      out[key] = vr
      onConflict(key, vl, vr)
    }
  }
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out as T
}

type MapMergeOutput<T> = { map: Record<string, T>; conflicts: ConflictEntry[] }

function mergeMonthMap<T>(input: {
  base: Record<string, T> | null
  local: Record<string, T>
  remote: Record<string, T>
  dataKind: string
  now: string
  remoteVersion?: number
  /** Khi cả hai bên đổi cùng key: trả về giá trị thắng (mặc định: timestamp lớn hơn, hoà → remote). */
  resolve?: (key: string, l: T, r: T, b: T | undefined) => { value: T; winner: "local" | "remote"; logged?: boolean }
}): MapMergeOutput<T> {
  const { base, local, remote, dataKind, now, remoteVersion } = input
  const map: Record<string, T> = {}
  const conflicts: ConflictEntry[] = []
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)])

  for (const key of keys) {
    const b = base ? base[key] : undefined
    const l = local[key]
    const r = remote[key]
    const hasL = l !== undefined
    const hasR = r !== undefined

    if (hasL && hasR) {
      if (eq(l, r)) map[key] = l
      else if (base && eq(l, b)) map[key] = r
      else if (base && eq(r, b)) map[key] = l
      else if (input.resolve) {
        const res = input.resolve(key, l, r, b)
        map[key] = res.value
        if (!res.logged) {
          conflicts.push({
            at: now,
            kind: "both-edited",
            dataKind,
            key,
            winner: res.winner,
            loser: res.winner === "local" ? r : l,
            remoteVersion,
          })
        }
      } else {
        const localWins = later(tsOf(l), tsOf(r))
        map[key] = localWins ? l : r
        conflicts.push({
          at: now,
          kind: "both-edited",
          dataKind,
          key,
          winner: localWins ? "local" : "remote",
          loser: localWins ? r : l,
          remoteVersion,
        })
      }
      continue
    }

    // App không có thao tác xoá cho các map theo tháng → thiếu key nghĩa là bên kia chưa có, giữ lại.
    if (hasL && !hasR) {
      map[key] = l
      continue
    }

    if (!hasL && hasR) {
      map[key] = r
    }
  }

  return { map, conflicts }
}

// ---------------------------------------------------------------------------
// Month locks (derived)
// ---------------------------------------------------------------------------

function unlockedSettingsForMonth(
  settingsByMonth: Record<string, Settings>,
  fallback: Settings,
  month: YearMonth,
): Settings {
  let cursor = month
  for (let i = 0; i < 240; i += 1) {
    const maybe = settingsByMonth[cursor]
    if (maybe) return maybe
    cursor = previousMonth(cursor)
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function categoriesToTable(list: ExpenseCategoryConfig[]): EntityTable<ExpenseCategoryConfig> {
  const byId: Record<string, ExpenseCategoryConfig> = {}
  for (const category of list) byId[category.id] = category
  return { byId, allIds: list.map((category) => category.id) }
}

function scopedTombstones(tomb: Record<string, string>, prefix: string) {
  const out: Record<string, string> = {}
  for (const [key, at] of Object.entries(tomb)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = at
  }
  return out
}

function unscopedTombstones(tomb: Record<string, string>, prefix: string) {
  const out: Record<string, string> = {}
  for (const [key, at] of Object.entries(tomb)) {
    if (!key.startsWith(prefix)) out[key] = at
  }
  return out
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function mergeTemplates(
  base: SyncedTemplates | null,
  local: SyncedTemplates,
  remote: SyncedTemplates,
  now: string,
  remoteVersion?: number,
): { templates: SyncedTemplates; conflicts: ConflictEntry[] } {
  const toTable = (t: SyncedTemplates): EntityTable<ExpenseTemplate> => {
    const byId: Record<string, ExpenseTemplate> = {}
    for (const item of t.items) byId[item.id] = item
    return { byId, allIds: Object.keys(byId) }
  }
  const merged = mergeTable<ExpenseTemplate>({
    base: base ? toTable(base) : null,
    local: toTable(local),
    remote: toTable(remote),
    localTomb: local.tombstones ?? {},
    remoteTomb: remote.tombstones ?? {},
    dataKind: "templates",
    now,
    remoteVersion,
  })

  // Với mẫu chi tiêu, "cả hai đổi" gộp được ở mức field thay vì chọn một bên.
  const items: ExpenseTemplate[] = []
  for (const id of merged.table.allIds) {
    const l = local.items.find((item) => item.id === id)
    const r = remote.items.find((item) => item.id === id)
    if (l && r && !eq(l, r)) {
      const newer = later(l.updatedAt ?? "", r.updatedAt ?? "") ? l : r
      items.push({
        ...newer,
        useCount: Math.max(l.useCount ?? 1, r.useCount ?? 1),
        lastUsedAt: l.lastUsedAt > r.lastUsedAt ? l.lastUsedAt : r.lastUsedAt,
      })
    } else {
      items.push(merged.table.byId[id])
    }
  }
  const kept = new Set(items.map((item) => item.id))
  const tombstones = mergeTombstones(local.tombstones ?? {}, remote.tombstones ?? {}, kept, Date.parse(now))
  return {
    templates: { items, tombstones },
    conflicts: merged.conflicts.filter((conflict) => conflict.kind !== "both-edited"),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function threeWayMerge(
  base: SyncDoc | null,
  local: SyncDoc,
  remote: SyncDoc,
  ctx: { now: string; remoteVersion?: number },
): MergeResult {
  const { now, remoteVersion } = ctx
  const nowMs = Date.parse(now) || Date.now()
  const conflicts: ConflictEntry[] = []
  const bs = base?.cttm ?? null
  const ls = local.cttm
  const rs = remote.cttm
  const localTomb = ls.tombstones ?? {}
  const remoteTomb = rs.tombstones ?? {}

  // --- entities -------------------------------------------------------------
  const tableKinds = ["expenses", "fixedCosts", "purchasePlans", "savingsTransactions"] as const
  const entities = {} as CttmState["entities"]
  let localDeleted = 0
  let remoteAdded = 0
  let localEntityCount = 0
  let mergedEntityCount = 0
  const keptIds = new Set<string>()

  for (const kind of tableKinds) {
    const out = mergeTable<Timestamped>({
      base: bs ? (bs.entities[kind] as EntityTable<Timestamped>) : null,
      local: ls.entities[kind] as EntityTable<Timestamped>,
      remote: rs.entities[kind] as EntityTable<Timestamped>,
      localTomb,
      remoteTomb,
      dataKind: kind,
      now,
      remoteVersion,
    })
    ;(entities as Record<string, EntityTable<Timestamped>>)[kind] = out.table
    conflicts.push(...out.conflicts)
    localDeleted += out.deletedFromLocal
    remoteAdded += out.addedFromRemote
    localEntityCount += ls.entities[kind].allIds.length
    mergedEntityCount += out.table.allIds.length
    for (const id of out.table.allIds) keptIds.add(id)
  }

  // --- categories -----------------------------------------------------------
  const catOut = mergeTable<ExpenseCategoryConfig>({
    base: bs ? categoriesToTable(bs.expenseCategories) : null,
    local: categoriesToTable(ls.expenseCategories),
    remote: categoriesToTable(rs.expenseCategories),
    localTomb: scopedTombstones(localTomb, "cat:"),
    remoteTomb: scopedTombstones(remoteTomb, "cat:"),
    dataKind: "expenseCategories",
    now,
    remoteVersion,
  })
  conflicts.push(...catOut.conflicts)
  const usedCategories = new Set<string>()
  for (const id of entities.expenses.allIds) usedCategories.add(entities.expenses.byId[id].category)
  for (const id of entities.fixedCosts.allIds) usedCategories.add(entities.fixedCosts.byId[id].category)
  const categoryById = { ...catOut.table.byId }
  for (const category of [...ls.expenseCategories, ...rs.expenseCategories]) {
    if (categoryById[category.id]) continue
    if (category.system || usedCategories.has(category.id)) {
      categoryById[category.id] = category
      conflicts.push({ at: now, kind: "category-in-use", dataKind: "expenseCategories", key: category.id, winner: "keep", remoteVersion })
    }
  }
  // Thứ tự tất định (không phụ thuộc bên nào là local) để hai tab/máy hội tụ về cùng một bản:
  // danh mục hệ thống theo thứ tự mặc định, danh mục tự tạo theo (createdAt, id).
  const categoryOrder = Object.keys(categoryById).sort((a, b) => {
    const da = DEFAULT_CATEGORY_ORDER.get(a)
    const db = DEFAULT_CATEGORY_ORDER.get(b)
    if (da !== undefined || db !== undefined) {
      if (da === undefined) return 1
      if (db === undefined) return -1
      return da - db
    }
    const ca = categoryById[a].createdAt ?? ""
    const cb = categoryById[b].createdAt ?? ""
    if (ca !== cb) return ca < cb ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })
  const expenseCategories = categoryOrder.map((id) => categoryById[id])
  for (const id of categoryOrder) keptIds.add(`cat:${id}`)

  // --- settings -------------------------------------------------------------
  const settings = mergeFields<Settings>(bs?.settings ?? null, ls.settings, rs.settings, (field, lv, rv) =>
    conflicts.push({ at: now, kind: "settings-field", dataKind: "settings", key: field, winner: "remote", loser: { field, localValue: lv, remoteValue: rv }, remoteVersion }),
  )

  // --- settingsByMonth + opening sources -----------------------------------
  const openingWinner: Record<string, "local" | "remote" | "merge"> = {}
  const settingsByMonthOut = mergeMonthMap<Settings>({
    base: bs?.settingsByMonth ?? null,
    local: ls.settingsByMonth,
    remote: rs.settingsByMonth,
    dataKind: "settingsByMonth",
    now,
    remoteVersion,
    resolve: (month, l, r, b) => {
      const srcL = ls.emergencyFundOpeningSourcesByMonth[month]
      const srcR = rs.emergencyFundOpeningSourcesByMonth[month]
      if (srcL === "manual" && srcR !== "manual") {
        openingWinner[month] = "local"
        return { value: l, winner: "local" }
      }
      if (srcR === "manual" && srcL !== "manual") {
        openingWinner[month] = "remote"
        return { value: r, winner: "remote" }
      }
      openingWinner[month] = "merge"
      const merged = mergeFields<Settings>(b ?? null, l, r, (field, lv, rv) =>
        conflicts.push({ at: now, kind: "settings-field", dataKind: `settingsByMonth/${month}`, key: field, winner: "remote", loser: { field, localValue: lv, remoteValue: rv }, remoteVersion }),
      )
      return { value: merged, winner: "remote", logged: true }
    },
  })
  conflicts.push(...settingsByMonthOut.conflicts)

  const openingSources: Record<string, "auto" | "manual"> = {}
  for (const month of Object.keys(settingsByMonthOut.map)) {
    const winner = openingWinner[month]
    const srcL = ls.emergencyFundOpeningSourcesByMonth[month]
    const srcR = rs.emergencyFundOpeningSourcesByMonth[month]
    let src: "auto" | "manual" | undefined
    if (winner === "local") src = srcL
    else if (winner === "remote") src = srcR
    else if (srcL === "manual" || srcR === "manual") src = "manual"
    else src = srcL ?? srcR
    if (src) openingSources[month] = src
  }

  // --- other month maps -----------------------------------------------------
  const adjustmentsOut = mergeMonthMap<BudgetAdjustment>({
    base: bs?.budgetAdjustmentsByMonth ?? null,
    local: ls.budgetAdjustmentsByMonth,
    remote: rs.budgetAdjustmentsByMonth,
    dataKind: "budgetAdjustmentsByMonth",
    now,
    remoteVersion,
  })
  conflicts.push(...adjustmentsOut.conflicts)

  const capsOut = mergeMonthMap<SpendingCaps>({
    base: bs?.capsByMonth ?? null,
    local: ls.capsByMonth,
    remote: rs.capsByMonth,
    dataKind: "capsByMonth",
    now,
    remoteVersion,
    resolve: (_month, l, r) => {
      if (l.source === "seed" && r.source !== "seed") return { value: r, winner: "remote" }
      if (r.source === "seed" && l.source !== "seed") return { value: l, winner: "local" }
      const localWins = later(tsOf(l), tsOf(r))
      return { value: localWins ? l : r, winner: localWins ? "local" : "remote" }
    },
  })
  conflicts.push(...capsOut.conflicts)

  const reconciliationsOut = mergeMonthMap<AccountBalanceReconciliation>({
    base: bs?.accountBalanceReconciliationsByMonth ?? null,
    local: ls.accountBalanceReconciliationsByMonth,
    remote: rs.accountBalanceReconciliationsByMonth,
    dataKind: "accountBalanceReconciliationsByMonth",
    now,
    remoteVersion,
  })
  conflicts.push(...reconciliationsOut.conflicts)

  // --- month locks (derived) -----------------------------------------------
  const monthLocks: Record<string, MonthLockSnapshot> = {}
  const lockMonths = new Set([...Object.keys(ls.monthLocksByMonth ?? {}), ...Object.keys(rs.monthLocksByMonth ?? {})])
  for (const month of lockMonths) {
    const l = ls.monthLocksByMonth?.[month]
    const r = rs.monthLocksByMonth?.[month]
    if (l && r) {
      if (eq(l, r)) {
        monthLocks[month] = l
      } else {
        const rebuilt: MonthLockSnapshot = {
          closedAt: l.closedAt < r.closedAt ? l.closedAt : r.closedAt,
          settings: unlockedSettingsForMonth(settingsByMonthOut.map, settings, month as YearMonth),
          budgetAdjustment: adjustmentsOut.map[month] ?? null,
          caps: capsOut.map[month] ?? null,
        }
        monthLocks[month] = rebuilt
        conflicts.push({ at: now, kind: "month-lock-rebuilt", dataKind: "monthLocksByMonth", key: month, winner: "keep", loser: { local: l, remote: r }, remoteVersion })
      }
    } else {
      monthLocks[month] = (l ?? r) as MonthLockSnapshot
    }
  }

  // --- tombstones -----------------------------------------------------------
  const tombstones = mergeTombstones(localTomb, remoteTomb, keptIds, nowMs)

  // --- assemble -------------------------------------------------------------
  const mergedState: CttmState = ensureCategoriesForState({
    ...ls,
    schemaVersion: 1,
    updatedAt: ls.updatedAt > rs.updatedAt ? ls.updatedAt : rs.updatedAt,
    migrations: ls.migrations ?? [],
    settings,
    settingsByMonth: settingsByMonthOut.map,
    expenseCategories,
    entities,
    indexes: rebuildExpenseIndexesFromEntities(entities.expenses),
    budgetAdjustmentsByMonth: adjustmentsOut.map,
    capsByMonth: capsOut.map,
    monthLocksByMonth: monthLocks,
    accountBalanceReconciliationsByMonth: reconciliationsOut.map,
    emergencyFundOpeningSourcesByMonth: openingSources,
    tombstones,
  })

  const templatesOut = mergeTemplates(base?.templates ?? null, local.templates, remote.templates, now, remoteVersion)
  conflicts.push(...templatesOut.conflicts)

  const merged: SyncDoc = { cttm: mergedState, templates: templatesOut.templates }
  const changed = stableStringify(stripDoc(merged)) !== stableStringify(stripDoc(local))

  return {
    merged,
    conflicts,
    stats: { localEntityCount, mergedEntityCount, localDeleted, remoteAdded, changed },
  }
}

function stripDoc(doc: SyncDoc) {
  const { indexes: _i, updatedAt: _u, migrations: _m, ...rest } = doc.cttm
  return { cttm: rest, templates: doc.templates }
}

/** Số entity có ở local nhưng vắng ở merged — dùng cho mass-delete guard. */
export function countMissingEntities(local: CttmState, merged: CttmState) {
  let missing = 0
  let total = 0
  for (const kind of ["expenses", "fixedCosts", "purchasePlans", "savingsTransactions"] as const) {
    for (const id of local.entities[kind].allIds) {
      total += 1
      if (!merged.entities[kind].byId[id]) missing += 1
    }
  }
  return { missing, total }
}

export function isMassDelete(missing: number, total: number, mergedTotal: number) {
  if (missing === 0) return false
  // Xoá nốt 1–4 mục cuối cùng là thao tác bình thường; chỉ hỏi khi mất trắng một bộ dữ liệu có nghĩa.
  if (mergedTotal === 0 && total >= 5) return true
  if (missing >= 20) return true
  return total >= 12 && missing / total >= 0.25
}
