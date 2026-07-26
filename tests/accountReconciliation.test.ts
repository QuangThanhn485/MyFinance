import { describe, expect, it } from "vitest"
import { computeAccountReconciliation } from "@/domain/finance/accountReconciliation"

describe("account balance reconciliation", () => {
  it("reconciles every allocation component to the expected account balance", () => {
    const result = computeAccountReconciliation({
      emergencyOpeningVnd: 10_000_000,
      emergencyDepositedVnd: 1_000_000,
      emergencyWithdrawnVnd: 500_000,
      plannedIncomeVnd: 15_000_000,
      incomeReceivedVnd: 15_000_000,
      fixedCostsPlannedVnd: 5_000_000,
      fixedCostsPaidVnd: 3_000_000,
      variableBudgetVnd: 7_000_000,
      variableSpentVnd: 2_000_000,
      savingsTargetVnd: 3_000_000,
      actualBalanceVnd: 18_900_000,
    })

    expect(result.expectedBalanceVnd).toBe(20_500_000)
    expect(result.calculationBalanced).toBe(true)
    expect(result.differenceVnd).toBe(-1_600_000)
    expect(result.status).toBe("deficit")
  })

  it("counts an emergency-fund deposit exactly once", () => {
    const withoutDeposit = computeAccountReconciliation({
      emergencyOpeningVnd: 2_000_000,
      emergencyDepositedVnd: 0,
      emergencyWithdrawnVnd: 0,
      plannedIncomeVnd: 10_000_000,
      incomeReceivedVnd: 10_000_000,
      fixedCostsPlannedVnd: 4_000_000,
      fixedCostsPaidVnd: 4_000_000,
      variableBudgetVnd: 4_000_000,
      variableSpentVnd: 1_000_000,
      savingsTargetVnd: 2_000_000,
      actualBalanceVnd: 0,
    })
    const withDeposit = computeAccountReconciliation({
      emergencyOpeningVnd: 2_000_000,
      emergencyDepositedVnd: 1_000_000,
      emergencyWithdrawnVnd: 0,
      plannedIncomeVnd: 10_000_000,
      incomeReceivedVnd: 10_000_000,
      fixedCostsPlannedVnd: 4_000_000,
      fixedCostsPaidVnd: 4_000_000,
      variableBudgetVnd: 4_000_000,
      variableSpentVnd: 1_000_000,
      savingsTargetVnd: 2_000_000,
      actualBalanceVnd: 0,
    })

    expect(withDeposit.expectedBalanceVnd - withoutDeposit.expectedBalanceVnd).toBe(1_000_000)
  })

  it("keeps fixed and variable overruns as negative balances", () => {
    const result = computeAccountReconciliation({
      emergencyOpeningVnd: 1_000_000,
      emergencyDepositedVnd: 0,
      emergencyWithdrawnVnd: 0,
      plannedIncomeVnd: 10_000_000,
      incomeReceivedVnd: 8_000_000,
      fixedCostsPlannedVnd: 4_000_000,
      fixedCostsPaidVnd: 5_000_000,
      variableBudgetVnd: 4_000_000,
      variableSpentVnd: 5_000_000,
      savingsTargetVnd: 2_000_000,
      actualBalanceVnd: 0,
    })

    expect(result.fixedCostsBalanceVnd).toBe(-1_000_000)
    expect(result.variableSpendingBalanceVnd).toBe(-1_000_000)
    expect(result.expectedBalanceVnd).toBe(-1_000_000)
    expect(result.differenceVnd).toBe(1_000_000)
    expect(result.status).toBe("surplus")
  })
})
