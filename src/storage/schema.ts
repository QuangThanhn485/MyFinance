import type {
  BudgetAdjustment,
  Expense,
  FixedCost,
  PurchasePlan,
  Settings,
  SpendingCaps,
} from "@/domain/types"

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

export interface CttmState {
  schemaVersion: SchemaVersion
  updatedAt: string
  migrations: MigrationRecord[]
  settings: Settings
  entities: {
    expenses: EntityTable<Expense>
    fixedCosts: EntityTable<FixedCost>
    purchasePlans: EntityTable<PurchasePlan>
  }
  indexes: ExpenseIndexes
  budgetAdjustmentsByMonth: Record<string, BudgetAdjustment>
  capsByMonth: Record<string, SpendingCaps>
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
    entities: {
      expenses: createEmptyEntityTable(),
      fixedCosts: createEmptyEntityTable(),
      purchasePlans: createEmptyEntityTable(),
    },
    indexes: createEmptyExpenseIndexes(),
    budgetAdjustmentsByMonth: {},
    capsByMonth: {},
  }
}
