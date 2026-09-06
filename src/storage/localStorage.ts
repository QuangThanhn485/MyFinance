import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import type { AccountBalanceReconciliation, FixedCost, Settings, YearMonth } from "@/domain/types"
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
import { bumpWriteSeq } from "@/sync/localMeta"

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
  return normalizeCttmStateFromRaw(localStorage.getItem(storageKey))
}

function normalizeTombstones(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Chuẩn hoá một chuỗi JSON CttmState (từ localStorage, Redis hay file) — không bao giờ throw. */
export function normalizeCttmStateFromRaw(raw: string | null): CttmState {
  const now = nowIso()
  const empty = createInitialState(now)
  const fallbackMonth = toYearMonthFromDateTime(now, "2000-01")

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

  const reconciliationsRaw = isRecord((state as any).accountBalanceReconciliationsByMonth)
    ? ((state as any).accountBalanceReconciliationsByMonth as Record<string, unknown>)
    : {}
  const normalizedReconciliations: Record<string, AccountBalanceReconciliation> = {}
  for (const [month, value] of Object.entries(reconciliationsRaw)) {
    if (!isRecord(value)) continue
    const actualBalanceVnd = coerceNumber(value.actualBalanceVnd, -1)
    const incomeReceivedVnd = coerceNumber(value.incomeReceivedVnd, -1)
    const asOfDate = coerceString(value.asOfDate, "")
    if (actualBalanceVnd < 0 || incomeReceivedVnd < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) continue
    const snapshotRaw = isRecord(value.calculationSnapshot)
      ? value.calculationSnapshot
      : null
    const snapshotValues = snapshotRaw
      ? {
          emergencyOpeningVnd: coerceNumber(snapshotRaw.emergencyOpeningVnd, -1),
          emergencyDepositedVnd: coerceNumber(snapshotRaw.emergencyDepositedVnd, -1),
          emergencyWithdrawnVnd: coerceNumber(snapshotRaw.emergencyWithdrawnVnd, -1),
          plannedIncomeVnd: coerceNumber(snapshotRaw.plannedIncomeVnd, -1),
          fixedCostsPlannedVnd: coerceNumber(snapshotRaw.fixedCostsPlannedVnd, -1),
          fixedCostsPaidVnd: coerceNumber(snapshotRaw.fixedCostsPaidVnd, -1),
          variableBudgetVnd: coerceNumber(snapshotRaw.variableBudgetVnd, -1),
          variableSpentVnd: coerceNumber(snapshotRaw.variableSpentVnd, -1),
          savingsTargetVnd: coerceNumber(snapshotRaw.savingsTargetVnd, -1),
        }
      : null
    const calculationSnapshot: AccountBalanceReconciliation["calculationSnapshot"] =
      snapshotValues && Object.values(snapshotValues).every((number) => number >= 0)
        ? {
            emergencyOpeningVnd: Math.trunc(snapshotValues.emergencyOpeningVnd),
            emergencyDepositedVnd: Math.trunc(snapshotValues.emergencyDepositedVnd),
            emergencyWithdrawnVnd: Math.trunc(snapshotValues.emergencyWithdrawnVnd),
            plannedIncomeVnd: Math.trunc(snapshotValues.plannedIncomeVnd),
            fixedCostsPlannedVnd: Math.trunc(snapshotValues.fixedCostsPlannedVnd),
            fixedCostsPaidVnd: Math.trunc(snapshotValues.fixedCostsPaidVnd),
            variableBudgetVnd: Math.trunc(snapshotValues.variableBudgetVnd),
            variableSpentVnd: Math.trunc(snapshotValues.variableSpentVnd),
            savingsTargetVnd: Math.trunc(snapshotValues.savingsTargetVnd),
          }
        : undefined
    normalizedReconciliations[month] = {
      month: month as YearMonth,
      asOfDate: asOfDate as AccountBalanceReconciliation["asOfDate"],
      actualBalanceVnd: Math.trunc(actualBalanceVnd),
      actualBalanceConfirmed:
        value.actualBalanceConfirmed === true ||
        (value.actualBalanceConfirmed !== false && actualBalanceVnd > 0),
      incomeReceivedVnd: Math.trunc(incomeReceivedVnd),
      calculationSnapshot,
      updatedAt: coerceString(value.updatedAt, now),
    }
  }

  const openingSourcesRaw = isRecord((state as any).emergencyFundOpeningSourcesByMonth)
    ? ((state as any).emergencyFundOpeningSourcesByMonth as Record<string, unknown>)
    : {}
  const normalizedOpeningSources: CttmState["emergencyFundOpeningSourcesByMonth"] = {}
  for (const [month, source] of Object.entries(openingSourcesRaw)) {
    if (source === "auto" || source === "manual") normalizedOpeningSources[month] = source
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
    accountBalanceReconciliationsByMonth: normalizedReconciliations,
    emergencyFundOpeningSourcesByMonth: normalizedOpeningSources,
    indexes: empty.indexes,
    tombstones: normalizeTombstones((state as any).tombstones),
  }

  for (const id of next.entities.fixedCosts.allIds) {
    const fc = next.entities.fixedCosts.byId[id] as FixedCost | undefined
    if (!fc) continue
    next.entities.fixedCosts.byId[id] = {
      ...fc,
      month: fc.month || toYearMonthFromDateTime(fc.createdAt, fallbackMonth),
      paidAmountVnd: Math.max(0, Math.trunc(fc.paidAmountVnd ?? 0)),
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
  // Đánh dấu "bản ghi này do build mới tạo" TRƯỚC khi ghi, để tab khác nhận storage event
  // của cttm_v1 đã thấy writeSeq mới (phân biệt với tab build cũ ghi đè).
  if (storageKey === STORAGE_KEY) bumpWriteSeq(localStorage)
  localStorage.setItem(storageKey, JSON.stringify(state))
}

export function createDebouncedSaver(
  delayMs: number,
  onSaved?: (key: string, state: CttmState) => void,
) {
  let handle: number | null = null
  let latest: { key: string; state: CttmState } | null = null

  const write = () => {
    if (!latest) return
    const { key, state } = latest
    latest = null
    try {
      saveCttmState(key, state)
      onSaved?.(key, state)
    } catch (error) {
      // Hết dung lượng localStorage: giữ lại để lần flush sau thử lại, và báo ra console.
      latest = { key, state }
      console.error("Không ghi được dữ liệu vào localStorage:", error)
    }
  }

  return {
    save(key: string, state: CttmState) {
      latest = { key, state }
      if (handle !== null) clearTimeout(handle)
      handle = setTimeout(() => {
        handle = null
        write()
      }, delayMs) as unknown as number
    },
    /** Ghi ngay phần đang chờ (nếu có). */
    flush() {
      if (handle !== null) {
        clearTimeout(handle)
        handle = null
      }
      write()
    },
    cancel() {
      if (handle !== null) {
        clearTimeout(handle)
        handle = null
      }
      latest = null
    },
  }
}
