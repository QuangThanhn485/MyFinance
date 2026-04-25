import { nanoid } from "nanoid"
import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import type {
  BudgetBucket,
  Expense,
  ExpenseCategory,
  FixedCost,
  ISODate,
  PurchasePlan,
  PurchasePriority,
  SavingsTransaction,
  SavingsTransactionType,
  Settings,
  YearMonth,
} from "@/domain/types"
import { suggestBucketByCategory } from "@/domain/constants"
import { computeBudgets } from "@/domain/finance/finance"
import type { OverspendingResult, RecoveryOption } from "@/domain/finance/rescue"
import { evaluateOverspending } from "@/domain/finance/rescue"
import { computeEmergencyFund } from "@/domain/finance/finance"
import {
  addDaysIsoDate,
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
  previousMonth,
  todayIso,
} from "@/lib/date"
import { formatVnd } from "@/lib/currency"
import { getMonthTotals } from "@/selectors/expenses"
import {
  getEffectiveEmergencyFundBalance,
  getNextMonthEmergencyOpeningBalance,
} from "@/selectors/savings"
import { getEffectiveSettingsForMonth, getMonthlyIncomeTotalVnd } from "@/domain/finance/monthLock"
import {
  addExpenseToIndexes,
  rebuildExpenseIndexesFromEntities,
  removeExpenseFromIndexes,
  updateExpenseInIndexes,
} from "@/storage/indexes"
import {
  createDebouncedSaver,
  loadCttmStateFromKey,
  saveCttmState,
} from "@/storage/localStorage"
import { createInitialState, type CttmState } from "@/storage/schema"
import {
  getStorageKeyForWorkspace,
  loadWorkspaceId,
  saveWorkspaceId,
  type WorkspaceId,
} from "@/storage/workspace"
import { writeLastBackup } from "@/storage/backups"
import { getDayLockMonthContext } from "@/storage/dayLock"

type UiState = {
  overspending: OverspendingResult | null
  forcedPurchaseRescue: null
}

type Actions = {
  setWorkspace: (workspace: WorkspaceId) => void
  openDemo: () => void
  resetDemoAndSeed: () => void

  setSettings: (patch: Partial<Settings>) => void
  setSettingsForMonth: (input: { month: YearMonth; patch: Partial<Settings> }) => void
  ensureSettingsForMonth: (month: YearMonth) => void

  addFixedCost: (input: {
    month: YearMonth
    name: string
    amountVnd: number
    category?: ExpenseCategory
  }) => string
  updateFixedCost: (
    id: string,
    patch: Partial<Pick<FixedCost, "month" | "name" | "amountVnd" | "category" | "active">>,
  ) => void
  deleteFixedCost: (id: string) => void

  addExpense: (input: {
    amountVnd: number
    category: ExpenseCategory
    bucket?: BudgetBucket
    note?: string
    date: ISODate
  }) => string
  updateExpense: (
    id: string,
    patch: Partial<Pick<Expense, "amountVnd" | "category" | "bucket" | "note" | "date">>,
  ) => void
  deleteExpense: (id: string) => void

  addSavingsTransaction: (input: {
    fund?: "emergency"
    type: SavingsTransactionType
    amountVnd: number
    reason: string
    note?: string
    date: ISODate
  }) => string
  deleteSavingsTransaction: (id: string) => void

  addPurchasePlan: (input: {
    name: string
    priceVnd: number
    bucket: BudgetBucket
    targetDate?: ISODate
    priority: PurchasePriority
    forced: boolean
  }) => string
  updatePurchasePlan: (
    id: string,
    patch: Partial<
      Pick<
        PurchasePlan,
        "name" | "priceVnd" | "bucket" | "targetDate" | "priority" | "forced"
      >
    >,
  ) => void
  deletePurchasePlan: (id: string) => void

  setUi: (patch: Partial<UiState>) => void
  resetUi: () => void

  applyRecoveryOption: (input: {
    month: YearMonth
    option: RecoveryOption
  }) => { ok: true } | { ok: false; error: string }
  clearOverspending: () => void

  rebuildIndexes: () => void
  exportJson: () => string
  importJson: (raw: string) => { ok: true } | { ok: false; error: string }
  resetAll: () => void
  autoClosePreviousMonthIfNeeded: () => void
}

export type AppStore = {
  workspace: WorkspaceId
  data: CttmState
  ui: UiState
  actions: Actions
}

function nowIso() {
  return new Date().toISOString()
}

function touch(state: CttmState): CttmState {
  return { ...state, updatedAt: nowIso() }
}

function id(prefix: "ex_" | "fc_" | "pp_" | "st_") {
  return `${prefix}${nanoid(10)}`
}

function cloneSettings(settings: Settings): Settings {
  const rule = settings.budgetRule
  const budgetRule =
    rule.type === "custom"
      ? { type: "custom" as const, needsPct: rule.needsPct, wantsPct: rule.wantsPct, savingsPct: rule.savingsPct }
      : { type: rule.type }

  return {
    ...settings,
    budgetRule,
    customSavingsGoalVnd: settings.customSavingsGoalVnd ?? null,
    actualSavingsBalanceVnd: settings.actualSavingsBalanceVnd ?? 0,
  }
}

function ensureMonthConfigurationFromPrevious(
  state: CttmState,
  targetMonth: YearMonth,
): CttmState {
  const now = nowIso()
  const prevMonth = previousMonth(targetMonth)
  const hasTargetSettings = !!state.settingsByMonth[targetMonth]
  const hasTargetFixedCosts = state.entities.fixedCosts.allIds.some((fixedCostId) => {
    const fixedCost = state.entities.fixedCosts.byId[fixedCostId]
    return !!fixedCost && fixedCost.month === targetMonth
  })

  if (hasTargetSettings) return state

  // Tháng mới kế thừa cấu hình "hiệu lực" của tháng liền trước.
  const inheritedSettings = {
    ...cloneSettings(getEffectiveSettingsForMonth(state, prevMonth)),
    emergencyFundCurrentVnd: getNextMonthEmergencyOpeningBalance(state, prevMonth),
  }
  const nextSettingsByMonth = {
    ...state.settingsByMonth,
    [targetMonth]: inheritedSettings,
  }

  if (hasTargetFixedCosts) {
    return touch({
      ...state,
      settingsByMonth: nextSettingsByMonth,
    })
  }

  let nextFixedCosts = state.entities.fixedCosts
  const prevFixedCosts = state.entities.fixedCosts.allIds
    .map((fixedCostId) => state.entities.fixedCosts.byId[fixedCostId])
    .filter((fixedCost): fixedCost is FixedCost => !!fixedCost && fixedCost.month === prevMonth)

  if (prevFixedCosts.length > 0) {
    const cloned = prevFixedCosts.map((fixedCost) => {
      const newId = id("fc_")
      return {
        ...fixedCost,
        id: newId,
        month: targetMonth,
        createdAt: now,
        updatedAt: now,
      }
    })

    nextFixedCosts = {
      byId: {
        ...state.entities.fixedCosts.byId,
        ...Object.fromEntries(cloned.map((fixedCost) => [fixedCost.id, fixedCost])),
      },
      allIds: [...state.entities.fixedCosts.allIds, ...cloned.map((fixedCost) => fixedCost.id)],
    }
  }

  return touch({
    ...state,
    settingsByMonth: nextSettingsByMonth,
    entities: {
      ...state.entities,
      fixedCosts: nextFixedCosts,
    },
  })
}

function ensureCurrentMonthConfigurationFromPrevious(state: CttmState): CttmState {
  return ensureMonthConfigurationFromPrevious(state, monthFromIsoDate(todayIso()))
}

function autoClosePreviousMonthIfNeeded(state: CttmState): CttmState {
  const nextState = ensureCurrentMonthConfigurationFromPrevious(state)
  const now = nowIso()
  const currentMonth = monthFromIsoDate(todayIso())
  const target = previousMonth(currentMonth)
  const alreadyClosed = !!nextState.monthLocksByMonth?.[target]
  if (alreadyClosed) return nextState
  const settingsForTarget = getEffectiveSettingsForMonth(nextState, target)

  const snapshot = {
    closedAt: now,
    settings: cloneSettings(settingsForTarget),
    budgetAdjustment: nextState.budgetAdjustmentsByMonth[target] ?? null,
    caps: nextState.capsByMonth[target] ?? null,
  }

  return touch({
    ...nextState,
    monthLocksByMonth: { ...(nextState.monthLocksByMonth ?? {}), [target]: snapshot },
  })
}

function isDefaultSettings(settings: Settings): boolean {
  return (
    settings.monthlyIncomeVnd === 0 &&
    (settings.extraIncomeMonthlyVnd ?? 0) === 0 &&
    settings.paydayDayOfMonth === 1 &&
    settings.debtPaymentMonthlyVnd === 0 &&
    settings.budgetRule?.type === "50_30_20" &&
    settings.emergencyFundTargetMonths === 6 &&
    settings.emergencyFundCurrentVnd === 0 &&
    (settings.actualSavingsBalanceVnd ?? 0) === 0 &&
    settings.essentialVariableBaselineVnd === 2000000 &&
    (settings.customSavingsGoalVnd ?? null) === null
  )
}

function isSeedableEmptyState(state: CttmState): boolean {
  return (
    state.entities.expenses.allIds.length === 0 &&
    state.entities.fixedCosts.allIds.length === 0 &&
    state.entities.purchasePlans.allIds.length === 0 &&
    Object.keys(state.settingsByMonth).length === 0 &&
    Object.keys(state.budgetAdjustmentsByMonth).length === 0 &&
    Object.keys(state.capsByMonth).length === 0 &&
    isDefaultSettings(state.settings)
  )
}

function buildDemoSeedState(now: string): CttmState {
  const base = createInitialState(now)
  const today = todayIso()
  const month = monthFromIsoDate(today)

  base.settings = {
    ...base.settings,
    monthlyIncomeVnd: 15000000,
    extraIncomeMonthlyVnd: 0,
    paydayDayOfMonth: 1,
    debtPaymentMonthlyVnd: 800000,
    budgetRule: { type: "50_30_20" },
    emergencyFundTargetMonths: 6,
    emergencyFundCurrentVnd: 10000000,
    essentialVariableBaselineVnd: 3000000,
    customSavingsGoalVnd: null,
  }

  const fixedCosts: FixedCost[] = [
    {
      id: id("fc_"),
      month,
      name: "Tiá»n nhÃ ",
      amountVnd: 5000000,
      category: "Bills",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: id("fc_"),
      month,
      name: "Äiá»‡n/nÆ°á»›c/internet",
      amountVnd: 1200000,
      category: "Bills",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: id("fc_"),
      month,
      name: "Báº£o hiá»ƒm",
      amountVnd: 600000,
      category: "Bills",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
  base.entities.fixedCosts = {
    byId: Object.fromEntries(fixedCosts.map((x) => [x.id, x])),
    allIds: fixedCosts.map((x) => x.id),
  }

  const expenseSeed: Omit<Expense, "id" | "createdAt" | "updatedAt">[] = [
    {
      amountVnd: 35000,
      category: "Food",
      bucket: "needs",
      note: "CÃ  phÃª",
      date: today,
    },
    {
      amountVnd: 85000,
      category: "Food",
      bucket: "needs",
      note: "Ä‚n trÆ°a",
      date: today,
    },
    {
      amountVnd: 25000,
      category: "Transport",
      bucket: "needs",
      note: "Xe Ã´m",
      date: addDaysIsoDate(today, -1),
    },
    {
      amountVnd: 120000,
      category: "Food",
      bucket: "needs",
      note: "Ä‚n tá»‘i",
      date: addDaysIsoDate(today, -1),
    },
    {
      amountVnd: 180000,
      category: "Shopping",
      bucket: "wants",
      note: "Mua láº·t váº·t",
      date: addDaysIsoDate(today, -2),
    },
    {
      amountVnd: 65000,
      category: "Entertainment",
      bucket: "wants",
      note: "Xem phim",
      date: addDaysIsoDate(today, -3),
    },
    {
      amountVnd: 90000,
      category: "Health",
      bucket: "needs",
      note: "Thuá»‘c",
      date: addDaysIsoDate(today, -4),
    },
    {
      amountVnd: 42000,
      category: "Food",
      bucket: "needs",
      note: "Ä‚n sÃ¡ng",
      date: addDaysIsoDate(today, -5),
    },
  ]

  const expenses: Expense[] = expenseSeed.map((x) => ({
    ...x,
    id: id("ex_"),
    createdAt: now,
    updatedAt: now,
  }))

  base.entities.expenses = {
    byId: Object.fromEntries(expenses.map((x) => [x.id, x])),
    allIds: expenses.map((x) => x.id),
  }

  base.indexes = rebuildExpenseIndexesFromEntities(base.entities.expenses)
  base.settingsByMonth = {
    [month]: cloneSettings(base.settings),
  }
  base.capsByMonth = {
    [month]: {
      month,
      dailyTotalCapVnd: null,
      dailyWantsCapVnd: null,
      wantsFreezeUntil: null,
      appliedAt: now,
      source: "seed",
      note: "Dá»¯ liá»‡u máº«u",
    },
  }

  return base
}

const debouncedSave = createDebouncedSaver(400)
const persistedWorkspace = loadWorkspaceId()
const initialWorkspace: WorkspaceId = "real"
if (persistedWorkspace !== "real") {
  saveWorkspaceId("real")
}

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    workspace: initialWorkspace,
    data: autoClosePreviousMonthIfNeeded(
      loadCttmStateFromKey(getStorageKeyForWorkspace(initialWorkspace)),
    ),
    ui: { overspending: null, forcedPurchaseRescue: null },
    actions: {
      setWorkspace: (workspace) => {
        const currentWorkspace = get().workspace
        if (workspace === currentWorkspace) return

        saveCttmState(getStorageKeyForWorkspace(currentWorkspace), get().data)
        saveWorkspaceId(workspace)

        set(() => ({
          workspace,
          data: autoClosePreviousMonthIfNeeded(
            loadCttmStateFromKey(getStorageKeyForWorkspace(workspace)),
          ),
          ui: { overspending: null, forcedPurchaseRescue: null },
        }))
      },

      openDemo: () => {
        get().actions.setWorkspace("demo")

        const afterSwitch = get().data
        if (!isSeedableEmptyState(afterSwitch)) return

        const now = nowIso()
        const seeded = buildDemoSeedState(now)
        saveCttmState(getStorageKeyForWorkspace("demo"), seeded)

        set(() => ({
          data: seeded,
          ui: { overspending: null, forcedPurchaseRescue: null },
        }))
      },

      resetDemoAndSeed: () => {
        const currentWorkspace = get().workspace
        saveCttmState(getStorageKeyForWorkspace(currentWorkspace), get().data)

        const demoKey = getStorageKeyForWorkspace("demo")
        const existingDemo = loadCttmStateFromKey(demoKey)
        writeLastBackup({
          workspace: "demo",
          reason: "reset_demo_seed",
          data: existingDemo,
        })

        const now = nowIso()
        const seeded = buildDemoSeedState(now)
        saveWorkspaceId("demo")
        saveCttmState(demoKey, seeded)

        set(() => ({
          workspace: "demo",
          data: seeded,
          ui: { overspending: null, forcedPurchaseRescue: null },
        }))
      },

      setSettings: (patch) => {
        set((s) => ({ data: touch({ ...s.data, settings: { ...s.data.settings, ...patch } }) }))
      },
      setSettingsForMonth: ({ month, patch }) => {
        set((s) => {
          const current = getEffectiveSettingsForMonth(s.data, month)
          const nextSettings = { ...current, ...patch }
          const existingLock = s.data.monthLocksByMonth[month]
          const nextMonthLocks = existingLock
            ? {
                ...s.data.monthLocksByMonth,
                [month]: {
                  ...existingLock,
                  settings: nextSettings,
                },
              }
            : s.data.monthLocksByMonth

          return {
            data: touch({
              ...s.data,
              settingsByMonth: {
                ...s.data.settingsByMonth,
                [month]: nextSettings,
              },
              monthLocksByMonth: nextMonthLocks,
            }),
          }
        })
      },
      ensureSettingsForMonth: (month) => {
        set((s) => ({ data: ensureMonthConfigurationFromPrevious(s.data, month) }))
      },

      addFixedCost: ({ month, name, amountVnd, category }) => {
        const newId = id("fc_")
        const now = nowIso()
        const fc: FixedCost = {
          id: newId,
          month,
          name,
          amountVnd,
          category: category ?? "Bills",
          active: true,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => {
          const table = s.data.entities.fixedCosts
          const nextTable = {
            byId: { ...table.byId, [newId]: fc },
            allIds: [...table.allIds, newId],
          }
          return { data: touch({ ...s.data, entities: { ...s.data.entities, fixedCosts: nextTable } }) }
        })
        return newId
      },
      updateFixedCost: (id, patch) => {
        set((s) => {
          const existing = s.data.entities.fixedCosts.byId[id]
          if (!existing) return s
          const next: FixedCost = { ...existing, ...patch, updatedAt: nowIso() }
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                fixedCosts: {
                  ...s.data.entities.fixedCosts,
                  byId: { ...s.data.entities.fixedCosts.byId, [id]: next },
                },
              },
            }),
          }
        })
      },
      deleteFixedCost: (idToDelete) => {
        set((s) => {
          const table = s.data.entities.fixedCosts
          const existing = table.byId[idToDelete]
          if (!existing) return s
          const { [idToDelete]: _removed, ...rest } = table.byId
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                fixedCosts: { byId: rest, allIds: table.allIds.filter((x) => x !== idToDelete) },
              },
            }),
          }
        })
      },

      addExpense: ({ amountVnd, category, bucket, note, date }) => {
        const newId = id("ex_")
        const now = nowIso()
        const ex: Expense = {
          id: newId,
          amountVnd,
          category,
          bucket: bucket ?? suggestBucketByCategory(category),
          note: note ?? "",
          date,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => {
          const table = s.data.entities.expenses
          const nextTable = {
            byId: { ...table.byId, [newId]: ex },
            allIds: [...table.allIds, newId],
          }
          const nextIndexes = addExpenseToIndexes(s.data.indexes, ex)
          return {
            data: touch({
              ...s.data,
              entities: { ...s.data.entities, expenses: nextTable },
              indexes: nextIndexes,
            }),
          }
        })

        const state = get().data
        const month = monthFromIsoDate(date)
        const totals = getMonthTotals(state, month)
        const adjustment = state.budgetAdjustmentsByMonth[month] ?? null
        const settingsForMonth = getEffectiveSettingsForMonth(state, month)
        const budgets = computeBudgets({
          incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
          fixedCostsVnd: totals.fixedCostsTotal,
          essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
          rule: settingsForMonth.budgetRule,
          adjustment,
          customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
        })
        const emergency = computeEmergencyFund({
          fixedCostsVnd: totals.fixedCostsTotal,
          essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
          targetMonths: settingsForMonth.emergencyFundTargetMonths,
          currentBalanceVnd: getEffectiveEmergencyFundBalance(state, month),
        })

        const result = evaluateOverspending({
          month,
          dayOfMonth: dayOfMonthFromIsoDate(date),
          daysInMonth: daysInMonth(month),
          incomeVnd: budgets.incomeVnd,
          budgets: {
            needsBudgetVnd: budgets.needsBudgetVnd,
            wantsBudgetVnd: budgets.wantsBudgetVnd,
            savingsTargetVnd: budgets.savingsTargetVnd,
            savingsBudgetVnd: budgets.savingsBudgetVnd,
          },
          spentToDate: {
            fixedCostsVnd: totals.fixedCostsTotal,
            variableSpentVnd: totals.variableTotal,
            variableNeedsSpentVnd: totals.variableNeeds,
            variableWantsSpentVnd: totals.variableWants,
          },
          emergency: {
            essentialMonthlyVnd: emergency.essentialMonthlyVnd,
            emergencyFundCurrentVnd: emergency.currentVnd,
            emergencyFundTargetMonths: settingsForMonth.emergencyFundTargetMonths,
          },
        })

        if (result) {
          set((s) => ({ ui: { ...s.ui, overspending: result } }))
        }

        return newId
      },

      updateExpense: (expenseId, patch) => {
        set((s) => {
          const existing = s.data.entities.expenses.byId[expenseId]
          if (!existing) return s
          const next: Expense = {
            ...existing,
            ...patch,
            updatedAt: nowIso(),
          }
          const nextIndexes = updateExpenseInIndexes(s.data.indexes, existing, next)
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                expenses: {
                  ...s.data.entities.expenses,
                  byId: { ...s.data.entities.expenses.byId, [expenseId]: next },
                },
              },
              indexes: nextIndexes,
            }),
          }
        })
      },

      deleteExpense: (expenseId) => {
        set((s) => {
          const table = s.data.entities.expenses
          const existing = table.byId[expenseId]
          if (!existing) return s
          const { [expenseId]: _removed, ...rest } = table.byId
          const nextIndexes = removeExpenseFromIndexes(s.data.indexes, existing)
          return {
            data: touch({
              ...s.data,
              entities: { ...s.data.entities, expenses: { byId: rest, allIds: table.allIds.filter((x) => x !== expenseId) } },
              indexes: nextIndexes,
            }),
          }
        })
      },

      addSavingsTransaction: ({ fund = "emergency", type, amountVnd, reason, note, date }) => {
        const newId = id("st_")
        const now = nowIso()
        const tx: SavingsTransaction = {
          id: newId,
          fund,
          type,
          amountVnd: Math.max(0, Math.trunc(amountVnd)),
          reason: reason.trim(),
          note: note?.trim() ?? "",
          date,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => {
          const table = s.data.entities.savingsTransactions
          const nextTable = {
            byId: { ...table.byId, [newId]: tx },
            allIds: [...table.allIds, newId],
          }
          return {
            data: touch({
              ...s.data,
              entities: { ...s.data.entities, savingsTransactions: nextTable },
            }),
          }
        })
        return newId
      },

      deleteSavingsTransaction: (transactionId) => {
        set((s) => {
          const table = s.data.entities.savingsTransactions
          const existing = table.byId[transactionId]
          if (!existing) return s
          const { [transactionId]: _removed, ...rest } = table.byId
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                savingsTransactions: {
                  byId: rest,
                  allIds: table.allIds.filter((x) => x !== transactionId),
                },
              },
            }),
          }
        })
      },

      addPurchasePlan: ({
        name,
        priceVnd,
        bucket,
        targetDate,
        priority,
        forced,
      }) => {
        const newId = id("pp_")
        const now = nowIso()
        const pp: PurchasePlan = {
          id: newId,
          name,
          priceVnd,
          bucket,
          targetDate,
          priority,
          forced,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => {
          const table = s.data.entities.purchasePlans
          const nextTable = {
            byId: { ...table.byId, [newId]: pp },
            allIds: [...table.allIds, newId],
          }
          return {
            data: touch({ ...s.data, entities: { ...s.data.entities, purchasePlans: nextTable } }),
          }
        })
        return newId
      },
      updatePurchasePlan: (ppId, patch) => {
        set((s) => {
          const existing = s.data.entities.purchasePlans.byId[ppId]
          if (!existing) return s
          const next: PurchasePlan = { ...existing, ...patch, updatedAt: nowIso() }
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                purchasePlans: {
                  ...s.data.entities.purchasePlans,
                  byId: { ...s.data.entities.purchasePlans.byId, [ppId]: next },
                },
              },
            }),
          }
        })
      },
      deletePurchasePlan: (ppId) => {
        set((s) => {
          const table = s.data.entities.purchasePlans
          const existing = table.byId[ppId]
          if (!existing) return s
          const { [ppId]: _removed, ...rest } = table.byId
          return {
            data: touch({
              ...s.data,
              entities: {
                ...s.data.entities,
                purchasePlans: { byId: rest, allIds: table.allIds.filter((x) => x !== ppId) },
              },
            }),
          }
        })
      },

      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      resetUi: () => set(() => ({ ui: { overspending: null, forcedPurchaseRescue: null } })),

      applyRecoveryOption: ({ month, option }) => {
        const caps = option.actions.caps
        const delta = option.actions.budgetAdjustmentDelta
        const extraIncomeTargetVnd = option.actions.extraIncomeTargetVnd
        const installment = option.actions.installmentSimulation

        if (!caps && !delta && !extraIncomeTargetVnd && !installment) {
          return { ok: false as const, error: "PhÆ°Æ¡ng Ã¡n nÃ y khÃ´ng cÃ³ thay Ä‘á»•i Ä‘á»ƒ Ã¡p dá»¥ng." }
        }

        set((s) => {
          const next = { ...s.data }
          if (delta) {
            const current = next.budgetAdjustmentsByMonth[month]
            const base = current ?? {
              needsDeltaVnd: 0,
              wantsDeltaVnd: 0,
              savingsDeltaVnd: 0,
              appliedAt: nowIso(),
            }
            next.budgetAdjustmentsByMonth = {
              ...next.budgetAdjustmentsByMonth,
              [month]: {
                needsDeltaVnd: base.needsDeltaVnd + delta.needsDeltaVnd,
                wantsDeltaVnd: base.wantsDeltaVnd + delta.wantsDeltaVnd,
                savingsDeltaVnd: base.savingsDeltaVnd + delta.savingsDeltaVnd,
                appliedAt: nowIso(),
                note: delta.note,
              },
            }
          }

          const shouldWriteCaps = !!caps || !!extraIncomeTargetVnd || !!installment || !!delta
          if (shouldWriteCaps) {
            const current = next.capsByMonth[month]
            const noteParts: string[] = []
            if (caps?.note) noteParts.push(caps.note)
            if (typeof extraIncomeTargetVnd === "number" && extraIncomeTargetVnd > 0) {
              noteParts.push(`Má»¥c tiÃªu tÄƒng thu nháº­p: ${formatVnd(extraIncomeTargetVnd)}`)
            }
            if (installment) {
              noteParts.push(
                `MÃ´ phá»ng tráº£ gÃ³p: ~${formatVnd(installment.monthlyInstallmentVnd)}/thÃ¡ng trong ${installment.tenorMonths} thÃ¡ng`,
              )
            }

            const isCurrentMonth = monthFromIsoDate(todayIso()) === month
            let autoDailyTotalCap: number | null | undefined = undefined
            let autoDailyWantsCap: number | null | undefined = undefined
            if (isCurrentMonth) {
              const totals = getMonthTotals(next, month)
              const adj = next.budgetAdjustmentsByMonth[month] ?? null
              const settingsForMonth = getEffectiveSettingsForMonth(next, month)
               const b = computeBudgets({
                 incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
                 fixedCostsVnd: totals.fixedCostsTotal,
                 essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
                 rule: settingsForMonth.budgetRule,
                 adjustment: adj,
                 customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
               })
               const spendingBudgetVnd = Math.max(0, b.incomeVnd - b.savingsTargetVnd)
               const remainingVnd = spendingBudgetVnd - totals.totalSpent
               const wantsRemainingVnd = b.wantsBudgetVnd - totals.variableWants
               const dayContext = getDayLockMonthContext(todayIso())
               const daysRem = dayContext.remainingDaysInMonth

              autoDailyTotalCap =
                daysRem > 0
                  ? Math.floor(Math.max(0, remainingVnd) / daysRem)
                  : 0
              autoDailyWantsCap =
                daysRem > 0
                  ? Math.floor(Math.max(0, wantsRemainingVnd) / daysRem)
                  : 0
            }

            next.capsByMonth = {
              ...next.capsByMonth,
              [month]: {
                month,
                dailyTotalCapVnd:
                  caps?.dailyTotalCapVnd ??
                  current?.dailyTotalCapVnd ??
                  autoDailyTotalCap ??
                  null,
                dailyWantsCapVnd:
                  caps?.dailyWantsCapVnd ??
                  current?.dailyWantsCapVnd ??
                  autoDailyWantsCap ??
                  null,
                wantsFreezeUntil:
                  caps?.wantsFreezeUntil ??
                  current?.wantsFreezeUntil ??
                  null,
                appliedAt: nowIso(),
                source: option.id,
                note: noteParts.length ? noteParts.join(" â€¢ ") : current?.note,
              },
            }
          }
          return { data: touch(next) }
        })

        return { ok: true as const }
      },

      clearOverspending: () => set((s) => ({ ui: { ...s.ui, overspending: null } })),

      rebuildIndexes: () => {
        set((s) => {
          const rebuilt = rebuildExpenseIndexesFromEntities(s.data.entities.expenses)
          return { data: touch({ ...s.data, indexes: rebuilt }) }
        })
      },

      exportJson: () => {
        return JSON.stringify(get().data, null, 2)
      },

      importJson: (raw) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return { ok: false as const, error: "JSON khÃ´ng há»£p lá»‡." }
        }
        if (!parsed || typeof parsed !== "object") {
          return { ok: false as const, error: "Dá»¯ liá»‡u import khÃ´ng há»£p lá»‡." }
        }
        const incoming = parsed as Partial<CttmState>
        if (incoming.schemaVersion !== 1) {
          return { ok: false as const, error: "Sai schemaVersion (chá»‰ há»— trá»£ v1)." }
        }

        writeLastBackup({
          workspace: get().workspace,
          reason: "import_overwrite",
          data: get().data,
        })

        const baseImportState = createInitialState(nowIso())
        const nextData: CttmState = {
          ...baseImportState,
          ...(incoming as CttmState),
          settings: {
            ...baseImportState.settings,
            ...((incoming as CttmState).settings ?? {}),
          },
          settingsByMonth: {
            ...((incoming as CttmState).settingsByMonth ?? {}),
          },
          entities: {
            ...baseImportState.entities,
            ...((incoming as CttmState).entities ?? {}),
            savingsTransactions:
              (incoming as CttmState).entities?.savingsTransactions ??
              baseImportState.entities.savingsTransactions,
          },
          indexes: rebuildExpenseIndexesFromEntities(
            (incoming as CttmState).entities.expenses,
          ),
          updatedAt: nowIso(),
        }

        saveCttmState(getStorageKeyForWorkspace(get().workspace), nextData)

        set(() => ({
          data: nextData,
          ui: { overspending: null, forcedPurchaseRescue: null },
        }))
        return { ok: true as const }
      },

      resetAll: () => {
        writeLastBackup({
          workspace: get().workspace,
          reason: "reset_all",
          data: get().data,
        })
        const now = nowIso()
        const next = createInitialState(now)
        saveCttmState(getStorageKeyForWorkspace(get().workspace), next)
        set(() => ({
          data: next,
          ui: { overspending: null, forcedPurchaseRescue: null },
        }))
      },

      autoClosePreviousMonthIfNeeded: () => {
        set((s) => ({ data: autoClosePreviousMonthIfNeeded(s.data) }))
      },
    },
  })),
)

useAppStore.subscribe(
  (s) => ({ workspace: s.workspace, data: s.data }),
  ({ workspace, data }) => debouncedSave(getStorageKeyForWorkspace(workspace), data),
)


