import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import type { FixedCost, Settings, YearMonth } from "@/domain/types"
import {
  createInitialState,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type CttmState,
  type EntityTable,
} from "@/storage/schema"
import {
  ensureCategoriesForState,
  normalizeExpenseCategoryList,
} from "@/storage/categories"

function nowIso() {
  return new Date().toISOString()
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function coerceNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toYearMonthFromDateTime(dateLike: string, fallback: YearMonth): YearMonth {
  const d = new Date(dateLike)
  if (Number.isNaN(d.getTime())) return fallback
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}` as YearMonth
}

function mergeEntityTable<T>(
  base: EntityTable<T>,
  incoming: unknown,
): EntityTable<T> {
  if (!isRecord(incoming)) return base
  const byId = isRecord(incoming.byId) ? (incoming.byId as Record<string, T>) : {}
  const allIds = Array.isArray(incoming.allIds)
    ? (incoming.allIds.filter((x) => typeof x === "string") as string[])
    : []

  return {
    byId: { ...base.byId, ...byId },
    allIds: allIds.length > 0 ? allIds : base.allIds,
  }
}

export function loadCttmState(): CttmState {
  return loadCttmStateFromKey(STORAGE_KEY)
}

export function loadCttmStateFromKey(storageKey: string): CttmState {
  const now = nowIso()
  const empty = createInitialState(now)
  const fallbackMonth = toYearMonthFromDateTime(now, "2000-01")

  const raw = localStorage.getItem(storageKey)
  if (!raw) return empty

  const parsed = safeParseJson(raw)
  if (!isObject(parsed)) return empty

  const schemaVersion = coerceNumber(parsed.schemaVersion, SCHEMA_VERSION)
  if (schemaVersion !== SCHEMA_VERSION) {
    return empty
  }

  const state = parsed as Partial<CttmState>

  const settingsByMonthRaw = isRecord((state as any).settingsByMonth)
    ? ((state as any).settingsByMonth as Record<string, unknown>)
    : {}

  const normalizedSettingsByMonth: Record<string, Settings> = {}
  for (const [month, value] of Object.entries(settingsByMonthRaw)) {
    if (!isRecord(value)) continue
    normalizedSettingsByMonth[month] = {
      ...empty.settings,
      ...(value as Partial<Settings>),
    }
  }

  const monthLocksRaw = isRecord((state as any).monthLocksByMonth)
    ? ((state as any).monthLocksByMonth as Record<string, unknown>)
    : {}
  const normalizedMonthLocks: CttmState["monthLocksByMonth"] = {}
  for (const [month, value] of Object.entries(monthLocksRaw)) {
    if (!isRecord(value)) continue
    const settingsRaw = isRecord((value as any).settings) ? ((value as any).settings as Partial<Settings>) : {}
    normalizedMonthLocks[month] = {
      ...(value as any),
      settings: { ...empty.settings, ...settingsRaw },
    }
  }

  const next: CttmState = {
    ...empty,
    ...state,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: coerceString(state.updatedAt, now),
    migrations: Array.isArray(state.migrations) ? state.migrations : [],
    settings: isRecord(state.settings)
      ? { ...empty.settings, ...(state.settings as any) }
      : empty.settings,
    settingsByMonth: normalizedSettingsByMonth,
    expenseCategories: normalizeExpenseCategoryList((state as any).expenseCategories, now),
    entities: {
      expenses: mergeEntityTable(empty.entities.expenses, state.entities?.expenses),
      fixedCosts: mergeEntityTable(
        empty.entities.fixedCosts,
        state.entities?.fixedCosts,
      ),
      purchasePlans: mergeEntityTable(
        empty.entities.purchasePlans,
        state.entities?.purchasePlans,
      ),
      savingsTransactions: mergeEntityTable(
        empty.entities.savingsTransactions,
        state.entities?.savingsTransactions,
      ),
    },
    budgetAdjustmentsByMonth: isRecord(state.budgetAdjustmentsByMonth)
      ? (state.budgetAdjustmentsByMonth as any)
      : {},
    capsByMonth: isRecord(state.capsByMonth) ? (state.capsByMonth as any) : {},
    monthLocksByMonth: normalizedMonthLocks,
    indexes: empty.indexes,
  }

  for (const id of next.entities.fixedCosts.allIds) {
    const fc = next.entities.fixedCosts.byId[id] as FixedCost | undefined
    if (!fc) continue
    if (fc.month) continue
    next.entities.fixedCosts.byId[id] = {
      ...fc,
      month: toYearMonthFromDateTime(fc.createdAt, fallbackMonth),
    }
  }

  const idx = state.indexes
  const indexesOk =
    isRecord(idx) &&
    isRecord(idx.expensesByDate) &&
    isRecord(idx.expensesByMonth) &&
    isRecord(idx.expensesByCategoryMonth) &&
    isRecord(idx.expensesByBucketMonth)

  next.indexes = indexesOk
    ? (idx as any)
    : rebuildExpenseIndexesFromEntities(next.entities.expenses)

  return ensureCategoriesForState(next)
}

export function saveCttmState(storageKey: string, state: CttmState) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

export function createDebouncedSaver(delayMs: number) {
  let handle: number | null = null
  let latest: { key: string; state: CttmState } | null = null

  return (key: string, state: CttmState) => {
    latest = { key, state }
    if (handle !== null) window.clearTimeout(handle)
    handle = window.setTimeout(() => {
      if (!latest) return
      saveCttmState(latest.key, latest.state)
      handle = null
    }, delayMs)
  }
}
