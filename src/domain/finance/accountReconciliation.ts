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

  // Giao dịch nạp quỹ là một dòng tiền vào độc lập theo nghiệp vụ sổ quỹ hiện tại.
  const emergencyBalanceVnd = emergencyOpeningVnd + emergencyDepositedVnd - emergencyWithdrawnVnd
  const monthlySavingsBalanceVnd = savingsTargetVnd
  const fixedCostsBalanceVnd = fixedCostsPlannedVnd - fixedCostsPaidVnd
  const variableSpendingBalanceVnd = variableBudgetVnd - variableSpentVnd

  const plannedAllocationVnd = fixedCostsPlannedVnd + variableBudgetVnd + savingsTargetVnd
  const incomeAllocationDifferenceVnd = incomeReceivedVnd - plannedAllocationVnd

  const expectedBalanceVnd =
    emergencyBalanceVnd +
    monthlySavingsBalanceVnd +
    fixedCostsBalanceVnd +
    variableSpendingBalanceVnd +
    incomeAllocationDifferenceVnd
  const controlExpectedBalanceVnd =
    emergencyOpeningVnd -
    emergencyWithdrawnVnd +
    emergencyDepositedVnd +
    incomeReceivedVnd -
    fixedCostsPaidVnd -
    variableSpentVnd
  const differenceVnd = actualBalanceVnd - expectedBalanceVnd

  return {
    plannedIncomeVnd,
    incomeReceivedVnd,
    plannedAllocationVnd,
    emergencyBalanceVnd,
    monthlySavingsBalanceVnd,
    fixedCostsBalanceVnd,
    variableSpendingBalanceVnd,
    incomeAllocationDifferenceVnd,
    expectedBalanceVnd,
    controlExpectedBalanceVnd,
    calculationBalanced: expectedBalanceVnd === controlExpectedBalanceVnd,
    actualBalanceVnd,
    differenceVnd,
    status: differenceVnd === 0 ? "matched" as const : differenceVnd > 0 ? "surplus" as const : "deficit" as const,
  }
}
