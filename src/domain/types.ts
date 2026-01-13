export type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`
export type YearMonth = `${number}${number}${number}${number}-${number}${number}`

export type BudgetBucket = "needs" | "wants"
export type PurchasePriority = "low" | "med" | "high"

export type ExpenseCategory =
  | "Food"
  | "Transport"
  | "Bills"
  | "Shopping"
  | "Entertainment"
  | "Health"
  | "Education"
  | "Family"
  | "Other"

export interface Expense {
  id: string
  amountVnd: number
  category: ExpenseCategory
  bucket: BudgetBucket
  note: string
  date: ISODate
  createdAt: string
  updatedAt: string
}

export interface FixedCost {
  id: string
  name: string
  amountVnd: number
  category: ExpenseCategory
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PurchasePlan {
  id: string
  name: string
  priceVnd: number
  bucket: BudgetBucket
  targetDate?: ISODate
  priority: PurchasePriority
  forced: boolean
  createdAt: string
  updatedAt: string
}

export type BudgetRule =
  | { type: "50_30_20" }
  | { type: "60_20_20" }
  | { type: "custom"; needsPct: number; wantsPct: number; savingsPct: number }

export interface Settings {
  monthlyIncomeVnd: number
  paydayDayOfMonth: number
  debtPaymentMonthlyVnd: number
  budgetRule: BudgetRule
  emergencyFundTargetMonths: number
  emergencyFundCurrentVnd: number
  actualSavingsBalanceVnd: number
  essentialVariableBaselineVnd: number
  customSavingsGoalVnd?: number | null
}

export interface BudgetAdjustment {
  needsDeltaVnd: number
  wantsDeltaVnd: number
  savingsDeltaVnd: number
  appliedAt: string
  note?: string
}

export interface SpendingCaps {
  month: YearMonth
  dailyTotalCapVnd?: number | null
  dailyWantsCapVnd?: number | null
  wantsFreezeUntil?: ISODate | null
  appliedAt: string
  source?: string
  note?: string
}
