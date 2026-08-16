import {
  computeAccountReconciliation,
  hasConfirmedActualBalance,
} from "@/domain/finance/accountReconciliation"
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
import { getEmergencyFundMonthSummary } from "@/selectors/savings"
import type { CttmState } from "@/storage/schema"

export function getAccountReconciliation(
  state: CttmState,
  input: {
    month: YearMonth
    asOfDate: ISODate
    actualBalanceVnd: number
    incomeReceivedVnd: number
  },
) {
  const { month, asOfDate, actualBalanceVnd, incomeReceivedVnd } = input
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
  const emergency = getEmergencyFundMonthSummary(state, month, asOfDate)
  const spendingToDate = getMonthToDateTotals(state, asOfDate).variableTotalToDateVnd
  const variableBudgetVnd = budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd

  return computeAccountReconciliation({
    emergencyOpeningVnd: emergency.openingBalanceVnd,
    emergencyDepositedVnd: emergency.depositedVnd,
    emergencyWithdrawnVnd: emergency.withdrawnVnd,
    plannedIncomeVnd,
    incomeReceivedVnd,
    fixedCostsPlannedVnd: fixedCosts.plannedVnd,
    fixedCostsPaidVnd: fixedCosts.paidVnd,
    variableBudgetVnd,
    variableSpentVnd: spendingToDate,
    savingsTargetVnd: budgets.savingsTargetVnd,
    actualBalanceVnd,
  })
}

export function getSavedAccountReconciliation(
  state: CttmState,
  month: YearMonth,
  throughDate?: ISODate,
) {
  const saved = state.accountBalanceReconciliationsByMonth[month]
  if (
    !saved ||
    !hasConfirmedActualBalance(saved) ||
    (throughDate && saved.asOfDate > throughDate)
  ) {
    return null
  }

  if (saved.calculationSnapshot) {
    return computeAccountReconciliation({
      ...saved.calculationSnapshot,
      incomeReceivedVnd: saved.incomeReceivedVnd,
      actualBalanceVnd: saved.actualBalanceVnd,
    })
  }

  const fixedCostsChangedAfterSave = state.entities.fixedCosts.allIds.some((id) => {
    const fixedCost = state.entities.fixedCosts.byId[id]
    return fixedCost?.month === month && fixedCost.updatedAt > saved.updatedAt
  })
  if (fixedCostsChangedAfterSave) return null

  return getAccountReconciliation(state, {
    month,
    asOfDate: saved.asOfDate,
    actualBalanceVnd: saved.actualBalanceVnd,
    incomeReceivedVnd: saved.incomeReceivedVnd,
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
