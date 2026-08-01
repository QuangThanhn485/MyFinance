import type { SavingsFund, SavingsTransaction, YearMonth } from "@/domain/types"
import { getEffectiveSettingsForMonth, getMonthlyIncomeTotalVnd } from "@/domain/finance/monthLock"
import { monthFromIsoDate } from "@/lib/date"
import { getSavedReconciliationDeficitVnd } from "@/selectors/accountReconciliation"
import { getFixedCostPaymentSummary, getMonthTotals } from "@/selectors/expenses"
import type { CttmState } from "@/storage/schema"

export function getSavingsTransactionsByMonth(
  state: CttmState,
  month: YearMonth,
  fund: SavingsFund = "emergency",
): SavingsTransaction[] {
  return state.entities.savingsTransactions.allIds
    .map((id) => state.entities.savingsTransactions.byId[id])
    .filter((tx): tx is SavingsTransaction => !!tx && tx.fund === fund && monthFromIsoDate(tx.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export function getEmergencyFundMonthSummary(state: CttmState, month: YearMonth) {
  const settings = getEffectiveSettingsForMonth(state, month)
  const openingBalanceVnd = Math.max(0, Math.trunc(settings.emergencyFundCurrentVnd ?? 0))
  const transactions = getSavingsTransactionsByMonth(state, month, "emergency")

  let depositedVnd = 0
  let withdrawnVnd = 0
  for (const tx of transactions) {
    const amount = Math.max(0, Math.trunc(tx.amountVnd))
    if (tx.type === "deposit") depositedVnd += amount
    else withdrawnVnd += amount
  }

  return {
    openingBalanceVnd,
    depositedVnd,
    withdrawnVnd,
    transactionCount: transactions.length,
    effectiveBalanceVnd: Math.max(0, openingBalanceVnd + depositedVnd - withdrawnVnd),
    transactions,
  }
}

export function getEffectiveEmergencyFundBalance(state: CttmState, month: YearMonth) {
  return getEmergencyFundMonthSummary(state, month).effectiveBalanceVnd
}

export function getActualMonthlySavingsVnd(state: CttmState, month: YearMonth) {
  const settings = getEffectiveSettingsForMonth(state, month)
  const incomeVnd = getMonthlyIncomeTotalVnd(settings)
  const totals = getMonthTotals(state, month)
  const fixedCostPayments = getFixedCostPaymentSummary(state, month)
  const reconciliationDeficitVnd = getSavedReconciliationDeficitVnd(state, month)
  return Math.max(
    0,
    Math.trunc(
      incomeVnd -
        totals.totalSpent -
        fixedCostPayments.overPlanVnd -
        reconciliationDeficitVnd,
    ),
  )
}

export function getMonthlySavingsRolloverContributionVnd(
  state: CttmState,
  month: YearMonth,
) {
  const emergency = getEmergencyFundMonthSummary(state, month)
  return Math.max(0, getActualMonthlySavingsVnd(state, month) - emergency.depositedVnd)
}

export function getNextMonthEmergencyOpeningBalance(state: CttmState, previousMonth: YearMonth) {
  return (
    getEffectiveEmergencyFundBalance(state, previousMonth) +
    getMonthlySavingsRolloverContributionVnd(state, previousMonth)
  )
}

/** Previous formula retained only to repair month settings generated before the rollover fix. */
export function getLegacyNextMonthEmergencyOpeningBalance(
  state: CttmState,
  previousMonth: YearMonth,
) {
  const settings = getEffectiveSettingsForMonth(state, previousMonth)
  const incomeVnd = getMonthlyIncomeTotalVnd(settings)
  const totals = getMonthTotals(state, previousMonth)
  const fixedCostPayments = getFixedCostPaymentSummary(state, previousMonth)
  const legacySavingsVnd = Math.max(
    0,
    Math.trunc(incomeVnd - totals.totalSpent - fixedCostPayments.overPlanVnd),
  )
  return getEffectiveEmergencyFundBalance(state, previousMonth) + legacySavingsVnd
}
