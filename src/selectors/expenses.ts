import type { Expense, ExpenseCategory, ISODate, YearMonth } from "@/domain/types"
import type { CttmState } from "@/storage/schema"
import { getEffectiveSettingsForMonth } from "@/domain/finance/monthLock"

const ESSENTIAL_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set([
  "Food",
  "Transport",
  "Bills",
  "Health",
  "Education",
  "Family",
])

export function getExpensesByDate(state: CttmState, date: string): Expense[] {
  const ids = state.indexes.expensesByDate[date] ?? []
  const out: Expense[] = []
  for (const id of ids) {
    const ex = state.entities.expenses.byId[id]
    if (ex) out.push(ex)
  }
  return out
}

export function getExpensesByMonth(
  state: CttmState,
  month: YearMonth,
): Expense[] {
  const ids = state.indexes.expensesByMonth[month] ?? []
  const out: Expense[] = []
  for (const id of ids) {
    const ex = state.entities.expenses.byId[id]
    if (ex) out.push(ex)
  }
  return out
}

export function getMonthTotals(state: CttmState, month: YearMonth) {
  const ids = state.indexes.expensesByMonth[month] ?? []
  const settingsForMonth = getEffectiveSettingsForMonth(state, month)

  let variableNeeds = 0
  let variableWants = 0
  let variableTotal = 0

  for (const id of ids) {
    const ex = state.entities.expenses.byId[id]
    if (!ex) continue
    variableTotal += ex.amountVnd
    if (ex.bucket === "needs") variableNeeds += ex.amountVnd
    else variableWants += ex.amountVnd
  }

  let fixedCostsTotal = 0
  let fixedCostsPaidTotal = 0
  for (const id of state.entities.fixedCosts.allIds) {
    const fc = state.entities.fixedCosts.byId[id]
    if (!fc || !fc.active) continue
    if (fc.month !== month) continue
    fixedCostsTotal += fc.amountVnd
    fixedCostsPaidTotal += Math.max(0, Math.trunc(fc.paidAmountVnd ?? 0))
  }
  fixedCostsTotal += Math.max(0, Math.trunc(settingsForMonth.debtPaymentMonthlyVnd ?? 0))
  fixedCostsPaidTotal += Math.max(0, Math.trunc(settingsForMonth.debtPaymentPaidVnd ?? 0))

  const budgetUsed = fixedCostsTotal + variableTotal
  const actualSpent = fixedCostsPaidTotal + variableTotal

  return {
    fixedCostsTotal,
    fixedCostsPaidTotal,
    variableTotal,
    variableNeeds,
    variableWants,
    budgetUsed,
    actualSpent,
    // Kept for existing budget formulas. This is committed budget, not cash paid.
    totalSpent: budgetUsed,
  }
}

export function getFixedCostPaymentSummary(state: CttmState, month: YearMonth) {
  const settingsForMonth = getEffectiveSettingsForMonth(state, month)
  let plannedVnd = 0
  let paidVnd = 0

  for (const id of state.entities.fixedCosts.allIds) {
    const fixedCost = state.entities.fixedCosts.byId[id]
    if (!fixedCost || !fixedCost.active || fixedCost.month !== month) continue
    plannedVnd += Math.max(0, Math.trunc(fixedCost.amountVnd))
    paidVnd += Math.max(0, Math.trunc(fixedCost.paidAmountVnd ?? 0))
  }

  const debtPlannedVnd = Math.max(0, Math.trunc(settingsForMonth.debtPaymentMonthlyVnd ?? 0))
  const debtPaidVnd = Math.max(0, Math.trunc(settingsForMonth.debtPaymentPaidVnd ?? 0))
  plannedVnd += debtPlannedVnd
  paidVnd += debtPaidVnd

  return {
    plannedVnd,
    paidVnd,
    remainingVnd: plannedVnd - paidVnd,
    overPlanVnd: Math.max(0, paidVnd - plannedVnd),
    debtPlannedVnd,
    debtPaidVnd,
  }
}

export function getMonthToDateTotals(state: CttmState, date: ISODate) {
  const month = date.slice(0, 7) as YearMonth
  const ids = state.indexes.expensesByMonth[month] ?? []

  let variableTotalToDateVnd = 0
  let variableWantsToDateVnd = 0
  let variableNeedsToDateVnd = 0
  let essentialNeedsToDateVnd = 0

  for (const id of ids) {
    const ex = state.entities.expenses.byId[id]
    if (!ex) continue
    if (ex.date > date) continue

    variableTotalToDateVnd += ex.amountVnd
    if (ex.bucket === "needs") {
      variableNeedsToDateVnd += ex.amountVnd
      if (ESSENTIAL_CATEGORIES.has(ex.category)) {
        essentialNeedsToDateVnd += ex.amountVnd
      }
    } else {
      variableWantsToDateVnd += ex.amountVnd
    }
  }

  return {
    variableTotalToDateVnd,
    variableNeedsToDateVnd,
    variableWantsToDateVnd,
    essentialNeedsToDateVnd,
  }
}

export function getCategoryTotals(state: CttmState, month: YearMonth) {
  const result: Record<string, number> = {}
  const settingsForMonth = getEffectiveSettingsForMonth(state, month)

  for (const [key, ids] of Object.entries(state.indexes.expensesByCategoryMonth)) {
    if (!key.startsWith(`${month}|`)) continue
    const category = key.slice(month.length + 1)
    let sum = 0
    for (const id of ids) {
      const ex = state.entities.expenses.byId[id]
      if (ex) sum += ex.amountVnd
    }
    if (sum > 0) result[category] = sum
  }

  for (const id of state.entities.fixedCosts.allIds) {
    const fc = state.entities.fixedCosts.byId[id]
    if (!fc || !fc.active) continue
    if (fc.month !== month) continue
    result[fc.category] = (result[fc.category] ?? 0) + fc.amountVnd
  }
  const debtPaymentMonthlyVnd = Math.max(0, Math.trunc(settingsForMonth.debtPaymentMonthlyVnd ?? 0))
  if (debtPaymentMonthlyVnd > 0) {
    result.Bills = (result.Bills ?? 0) + debtPaymentMonthlyVnd
  }

  return result
}
