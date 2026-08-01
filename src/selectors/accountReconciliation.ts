import { computeAccountReconciliation } from "@/domain/finance/accountReconciliation"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import type { ISODate, YearMonth } from "@/domain/types"
import {
  getFixedCostPaymentSummary,
  getMonthToDateTotals,
  getMonthTotals,
} from "@/selectors/expenses"
import type { CttmState } from "@/storage/schema"

export function getSavedAccountReconciliation(
  state: CttmState,
  month: YearMonth,
  throughDate?: ISODate,
) {
  const saved = state.accountBalanceReconciliationsByMonth[month]
  if (!saved || (throughDate && saved.asOfDate > throughDate)) return null

  const settings = getEffectiveSettingsForMonth(state, month)
  const monthTotals = getMonthTotals(state, month)
  const fixedCosts = getFixedCostPaymentSummary(state, month)
  const plannedIncomeVnd = getMonthlyIncomeTotalVnd(settings)
  const budgets = computeBudgets({
    incomeVnd: plannedIncomeVnd,
    fixedCostsVnd: monthTotals.fixedCostsTotal,
    essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
    rule: settings.budgetRule,
    adjustment: getEffectiveBudgetAdjustmentForMonth(state, month),
    customSavingsGoalVnd: settings.customSavingsGoalVnd,
  })

  let emergencyDepositedVnd = 0
  let emergencyWithdrawnVnd = 0
  for (const id of state.entities.savingsTransactions.allIds) {
    const transaction = state.entities.savingsTransactions.byId[id]
    if (
      !transaction ||
      transaction.fund !== "emergency" ||
      transaction.date.slice(0, 7) !== month ||
      transaction.date > saved.asOfDate
    ) {
      continue
    }
    if (transaction.type === "deposit") emergencyDepositedVnd += transaction.amountVnd
    else emergencyWithdrawnVnd += transaction.amountVnd
  }

  const variableBudgetVnd = budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd
  return computeAccountReconciliation({
    emergencyOpeningVnd: settings.emergencyFundCurrentVnd,
    emergencyDepositedVnd,
    emergencyWithdrawnVnd,
    plannedIncomeVnd,
    incomeReceivedVnd: saved.incomeReceivedVnd,
    fixedCostsPlannedVnd: fixedCosts.plannedVnd,
    fixedCostsPaidVnd: fixedCosts.paidVnd,
    variableBudgetVnd,
    variableSpentVnd: getMonthToDateTotals(state, saved.asOfDate).variableTotalToDateVnd,
    savingsTargetVnd: budgets.savingsTargetVnd,
    actualBalanceVnd: saved.actualBalanceVnd,
  })
}

export function getSavedReconciliationDeficitVnd(
  state: CttmState,
  month: YearMonth,
  throughDate?: ISODate,
) {
  const reconciliation = getSavedAccountReconciliation(state, month, throughDate)
  return reconciliation ? Math.max(0, -reconciliation.differenceVnd) : 0
}
