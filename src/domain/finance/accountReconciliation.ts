import type { AccountBalanceReconciliation, ISODate, YearMonth } from "@/domain/types"
import { daysInMonth } from "@/lib/date"

export type AccountReconciliationInput = {
  emergencyOpeningVnd: number
  emergencyDepositedVnd: number
  emergencyWithdrawnVnd: number
  plannedIncomeVnd: number
  incomeReceivedVnd: number
  fixedCostsPlannedVnd: number
  fixedCostsPaidVnd: number
  variableBudgetVnd: number
  variableSpentVnd: number
  savingsTargetVnd: number
  actualBalanceVnd: number
}

function money(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/** Legacy records had no presence marker; only their positive balances were unambiguous. */
export function hasConfirmedActualBalance(
  value: Pick<AccountBalanceReconciliation, "actualBalanceVnd" | "actualBalanceConfirmed">,
) {
  if (!Number.isFinite(value.actualBalanceVnd) || value.actualBalanceVnd < 0) return false
  return value.actualBalanceConfirmed ?? (value.actualBalanceVnd > 0)
}

export function resolveAccountReconciliationForm(input: {
  selectedMonth: YearMonth
  currentMonth: YearMonth
  currentDate: ISODate
  plannedIncomeVnd: number
  saved?: AccountBalanceReconciliation | null
}) {
  const { selectedMonth, currentMonth, currentDate, plannedIncomeVnd, saved } = input
  const defaultDate = selectedMonth === currentMonth
    ? currentDate
    : selectedMonth < currentMonth
      ? `${selectedMonth}-${String(daysInMonth(selectedMonth)).padStart(2, "0")}` as ISODate
      : `${selectedMonth}-01` as ISODate
  const hasSavedActualBalance = Boolean(
    saved && hasConfirmedActualBalance(saved),
  )
  const restoreSaved = Boolean(
    saved &&
    hasSavedActualBalance &&
    (selectedMonth < currentMonth || saved.asOfDate === defaultDate),
  )

  return {
    asOfDate: restoreSaved && saved ? saved.asOfDate : defaultDate,
    actualBalanceVnd: restoreSaved && saved ? saved.actualBalanceVnd : 0,
    incomeReceivedVnd: restoreSaved && saved
      ? saved.incomeReceivedVnd
      : money(plannedIncomeVnd),
    hasActualBalance: restoreSaved,
    hasStaleCurrentMonthSave: Boolean(
      saved &&
      selectedMonth === currentMonth &&
      (!hasSavedActualBalance || saved.asOfDate !== defaultDate),
    ),
  }
}

export function computeAccountReconciliation(input: AccountReconciliationInput) {
  const emergencyOpeningVnd = money(input.emergencyOpeningVnd)
  const emergencyDepositedVnd = money(input.emergencyDepositedVnd)
  const emergencyWithdrawnVnd = money(input.emergencyWithdrawnVnd)
  const plannedIncomeVnd = money(input.plannedIncomeVnd)
  const incomeReceivedVnd = money(input.incomeReceivedVnd)
  const fixedCostsPlannedVnd = money(input.fixedCostsPlannedVnd)
  const fixedCostsPaidVnd = money(input.fixedCostsPaidVnd)
  const variableBudgetVnd = money(input.variableBudgetVnd)
  const variableSpentVnd = money(input.variableSpentVnd)
  const savingsTargetVnd = money(input.savingsTargetVnd)
  const actualBalanceVnd = money(input.actualBalanceVnd)

  const emergencyBalanceVnd = emergencyOpeningVnd + emergencyDepositedVnd - emergencyWithdrawnVnd
  const fixedCostsBalanceVnd = fixedCostsPlannedVnd - fixedCostsPaidVnd
  const variableSpendingBalanceVnd = variableBudgetVnd - variableSpentVnd

  const plannedAllocationVnd = fixedCostsPlannedVnd + variableBudgetVnd + savingsTargetVnd
  const incomeAllocationDifferenceVnd = incomeReceivedVnd - plannedIncomeVnd

  // Giao dịch quỹ là dòng tiền độc lập với thu nhập và chi tiêu tháng. Phần còn
  // lại của tháng chỉ được tính từ thu nhập thực nhận và các khoản phân bổ tháng.
  const monthlySavingsBalanceVnd =
    incomeReceivedVnd - fixedCostsPlannedVnd - variableBudgetVnd

  const expectedBalanceVnd =
    emergencyBalanceVnd +
    monthlySavingsBalanceVnd +
    fixedCostsBalanceVnd +
    variableSpendingBalanceVnd

  // Công thức kiểm tra chéo chỉ dùng dòng tiền thực. Mục tiêu tiết kiệm và ngân
  // sách kế hoạch không được phép làm thay đổi số dư tài khoản kỳ vọng.
  const controlExpectedBalanceVnd =
    emergencyOpeningVnd +
    emergencyDepositedVnd -
    emergencyWithdrawnVnd +
    incomeReceivedVnd -
    fixedCostsPaidVnd -
    variableSpentVnd
  const trackedOutflowsVnd = fixedCostsPaidVnd + variableSpentVnd + emergencyWithdrawnVnd
  const differenceVnd = actualBalanceVnd - expectedBalanceVnd

  return {
    emergencyOpeningVnd,
    emergencyDepositedVnd,
    emergencyWithdrawnVnd,
    plannedIncomeVnd,
    incomeReceivedVnd,
    plannedAllocationVnd,
    fixedCostsPlannedVnd,
    fixedCostsPaidVnd,
    variableBudgetVnd,
    variableSpentVnd,
    savingsTargetVnd,
    emergencyBalanceVnd,
    monthlySavingsBalanceVnd,
    fixedCostsBalanceVnd,
    variableSpendingBalanceVnd,
    incomeAllocationDifferenceVnd,
    trackedOutflowsVnd,
    expectedBalanceVnd,
    controlExpectedBalanceVnd,
    calculationBalanced: expectedBalanceVnd === controlExpectedBalanceVnd,
    actualBalanceVnd,
    differenceVnd,
    status: differenceVnd === 0 ? "matched" as const : differenceVnd > 0 ? "surplus" as const : "deficit" as const,
  }
}
