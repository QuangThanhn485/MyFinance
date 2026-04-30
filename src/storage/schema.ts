import type {
  BudgetAdjustment,
  Expense,
  ExpenseCategoryConfig,
  FixedCost,
  PurchasePlan,
  SavingsTransaction,
  Settings,
  SpendingCaps,
} from "@/domain/types"
import { createDefaultExpenseCategories } from "@/storage/categories"

export const STORAGE_KEY = "cttm_v1" as const
export const SCHEMA_VERSION = 1 as const

export type SchemaVersion = typeof SCHEMA_VERSION

export interface MigrationRecord {
  from: number
  to: number
  at: string
  note?: string
}

export interface EntityTable<T> {
  byId: Record<string, T>
  allIds: string[]
}

export interface ExpenseIndexes {
  expensesByDate: Record<string, string[]>
  expensesByMonth: Record<string, string[]>
  expensesByCategoryMonth: Record<string, string[]>
  expensesByBucketMonth: Record<string, string[]>
}

export type MonthLockSnapshot = {
  closedAt: string
  settings: Settings
  budgetAdjustment: BudgetAdjustment | null
  caps: SpendingCaps | null
}

export interface CttmState {
  schemaVersion: SchemaVersion
  updatedAt: string
  migrations: MigrationRecord[]
  settings: Settings
  settingsByMonth: Record<string, Settings>
  expenseCategories: ExpenseCategoryConfig[]
  entities: {
    expenses: EntityTable<Expense>
    fixedCosts: EntityTable<FixedCost>
    purchasePlans: EntityTable<PurchasePlan>
    savingsTransactions: EntityTable<SavingsTransaction>
  }
  indexes: ExpenseIndexes
  budgetAdjustmentsByMonth: Record<string, BudgetAdjustment>
  capsByMonth: Record<string, SpendingCaps>
  monthLocksByMonth: Record<string, MonthLockSnapshot>
}

export function createEmptyExpenseIndexes(): ExpenseIndexes {
  return {
    expensesByDate: {},
    expensesByMonth: {},
    expensesByCategoryMonth: {},
    expensesByBucketMonth: {},
  }
}

export function createEmptyEntityTable<T>(): EntityTable<T> {
  return { byId: {}, allIds: [] }
}

export function createDefaultSettings(): Settings {
  return {
    monthlyIncomeVnd: 0,
    extraIncomeMonthlyVnd: 0,
    paydayDayOfMonth: 1,
    debtPaymentMonthlyVnd: 0,
    budgetRule: { type: "50_30_20" },
    emergencyFundTargetMonths: 6,
    emergencyFundCurrentVnd: 0,
    actualSavingsBalanceVnd: 0,
    essentialVariableBaselineVnd: 2000000,
    customSavingsGoalVnd: null,
  }
}

export function createInitialState(nowIso: string): CttmState {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso,
    migrations: [],
    settings: createDefaultSettings(),
    settingsByMonth: {},
    expenseCategories: createDefaultExpenseCategories(nowIso),
    entities: {
      expenses: createEmptyEntityTable(),
      fixedCosts: createEmptyEntityTable(),
      purchasePlans: createEmptyEntityTable(),
      savingsTransactions: createEmptyEntityTable(),
    },
    indexes: createEmptyExpenseIndexes(),
    budgetAdjustmentsByMonth: {},
    capsByMonth: {},
    monthLocksByMonth: {},
  }
}
