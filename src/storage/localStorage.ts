import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import {
  createInitialState,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type CttmState,
  type EntityTable,
} from "@/storage/schema"

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

  const raw = localStorage.getItem(storageKey)
  if (!raw) return empty

  const parsed = safeParseJson(raw)
  if (!isObject(parsed)) return empty

  const schemaVersion = coerceNumber(parsed.schemaVersion, SCHEMA_VERSION)
  if (schemaVersion !== SCHEMA_VERSION) {
    return empty
  }

  const state = parsed as Partial<CttmState>

  const next: CttmState = {
    ...empty,
    ...state,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: coerceString(state.updatedAt, now),
    migrations: Array.isArray(state.migrations) ? state.migrations : [],
    settings: isRecord(state.settings)
      ? { ...empty.settings, ...(state.settings as any) }
      : empty.settings,
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
    },
    budgetAdjustmentsByMonth: isRecord(state.budgetAdjustmentsByMonth)
      ? (state.budgetAdjustmentsByMonth as any)
      : {},
    capsByMonth: isRecord(state.capsByMonth) ? (state.capsByMonth as any) : {},
    indexes: empty.indexes,
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

  return next
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
