import { describe, expect, it } from "vitest"
import {
  computeAccountReconciliation,
  hasConfirmedActualBalance,
  resolveAccountReconciliationForm,
} from "@/domain/finance/accountReconciliation"
import {
  getAccountReconciliation,
  getSavedAccountReconciliation,
} from "@/selectors/accountReconciliation"
import { createInitialState } from "@/storage/schema"

const baseInput = {
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
}

describe("account balance reconciliation", () => {
  it("uses actual cash flow for the expected account balance", () => {
    const result = computeAccountReconciliation(baseInput)

    expect(result.emergencyBalanceVnd).toBe(10_500_000)
    expect(result.fixedCostsBalanceVnd).toBe(2_000_000)
    expect(result.variableSpendingBalanceVnd).toBe(5_000_000)
    expect(result.monthlySavingsBalanceVnd).toBe(3_000_000)
    expect(result.expectedBalanceVnd).toBe(20_500_000)
    expect(result.controlExpectedBalanceVnd).toBe(20_500_000)
    expect(result.calculationBalanced).toBe(true)
    expect(result.differenceVnd).toBe(-1_600_000)
    expect(result.status).toBe("deficit")
  })

  it("adds an emergency-fund deposit to the fund and total balance", () => {
    const withoutDeposit = computeAccountReconciliation({
      ...baseInput,
      emergencyDepositedVnd: 0,
    })
    const withDeposit = computeAccountReconciliation(baseInput)

    expect(withDeposit.emergencyBalanceVnd - withoutDeposit.emergencyBalanceVnd).toBe(1_000_000)
    expect(withDeposit.monthlySavingsBalanceVnd).toBe(withoutDeposit.monthlySavingsBalanceVnd)
    expect(withDeposit.expectedBalanceVnd - withoutDeposit.expectedBalanceVnd).toBe(1_000_000)
  })

  it("deducts an emergency withdrawal from both the fund and total balance", () => {
    const withoutWithdrawal = computeAccountReconciliation({
      ...baseInput,
      emergencyWithdrawnVnd: 0,
    })
    const withWithdrawal = computeAccountReconciliation(baseInput)

    expect(withoutWithdrawal.emergencyBalanceVnd - withWithdrawal.emergencyBalanceVnd).toBe(500_000)
    expect(withoutWithdrawal.expectedBalanceVnd - withWithdrawal.expectedBalanceVnd).toBe(500_000)
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

  it("uses received income instead of the monthly income plan", () => {
    const result = computeAccountReconciliation({
      ...baseInput,
      emergencyOpeningVnd: 2_000_000,
      emergencyDepositedVnd: 0,
      emergencyWithdrawnVnd: 0,
      plannedIncomeVnd: 10_000_000,
      incomeReceivedVnd: 4_000_000,
      fixedCostsPlannedVnd: 4_000_000,
      fixedCostsPaidVnd: 1_000_000,
      variableBudgetVnd: 4_000_000,
      variableSpentVnd: 500_000,
      savingsTargetVnd: 2_000_000,
      actualBalanceVnd: 4_500_000,
    })

    expect(result.incomeAllocationDifferenceVnd).toBe(-6_000_000)
    expect(result.expectedBalanceVnd).toBe(4_500_000)
    expect(result.differenceVnd).toBe(0)
    expect(result.status).toBe("matched")
  })

  it("only includes expenses and fund movements through the reconciliation date", () => {
    const state = createInitialState("2026-08-01T00:00:00.000Z")
    state.settingsByMonth["2026-08"] = {
      ...state.settings,
      monthlyIncomeVnd: 10_000_000,
      extraIncomeMonthlyVnd: 0,
      emergencyFundCurrentVnd: 4_000_000,
      essentialVariableBaselineVnd: 2_000_000,
    }
    state.entities.fixedCosts.byId.rent = {
      id: "rent",
      month: "2026-08",
      name: "Tiền nhà",
      amountVnd: 3_000_000,
      paidAmountVnd: 1_000_000,
      category: "Bills",
      active: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    }
    state.entities.fixedCosts.allIds = ["rent"]
    state.entities.expenses.byId.before = {
      id: "before",
      amountVnd: 500_000,
      category: "Food",
      bucket: "needs",
      date: "2026-08-05",
      note: "",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    }
    state.entities.expenses.byId.after = {
      ...state.entities.expenses.byId.before,
      id: "after",
      amountVnd: 900_000,
      date: "2026-08-20",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    }
    state.entities.expenses.allIds = ["before", "after"]
    state.indexes.expensesByMonth["2026-08"] = ["before", "after"]
    state.entities.savingsTransactions.byId.deposit = {
      id: "deposit",
      fund: "emergency",
      type: "deposit",
      amountVnd: 1_000_000,
      date: "2026-08-10",
      reason: "Nạp quỹ",
      note: "",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    }
    state.entities.savingsTransactions.byId.withdrawBefore = {
      ...state.entities.savingsTransactions.byId.deposit,
      id: "withdrawBefore",
      type: "withdraw",
      amountVnd: 400_000,
      date: "2026-08-12",
    }
    state.entities.savingsTransactions.byId.withdrawAfter = {
      ...state.entities.savingsTransactions.byId.deposit,
      id: "withdrawAfter",
      type: "withdraw",
      amountVnd: 200_000,
      date: "2026-08-20",
    }
    state.entities.savingsTransactions.allIds = ["deposit", "withdrawBefore", "withdrawAfter"]

    const result = getAccountReconciliation(state, {
      month: "2026-08",
      asOfDate: "2026-08-15",
      incomeReceivedVnd: 10_000_000,
      actualBalanceVnd: 13_100_000,
    })

    expect(result.emergencyDepositedVnd).toBe(1_000_000)
    expect(result.emergencyWithdrawnVnd).toBe(400_000)
    expect(result.emergencyBalanceVnd).toBe(4_600_000)
    expect(result.variableSpentVnd).toBe(500_000)
    expect(result.variableBudgetVnd).toBe(5_000_000)
    expect(result.variableSpendingBalanceVnd).toBe(4_500_000)
    expect(result.expectedBalanceVnd).toBe(13_100_000)
    expect(result.status).toBe("matched")
  })

  it("matches the 15/08 production backup exactly", () => {
    const result = computeAccountReconciliation({
      emergencyOpeningVnd: 21_571_211,
      emergencyDepositedVnd: 0,
      emergencyWithdrawnVnd: 342_000,
      plannedIncomeVnd: 14_000_000,
      incomeReceivedVnd: 14_000_000,
      fixedCostsPlannedVnd: 6_517_900,
      fixedCostsPaidVnd: 6_287_900,
      variableBudgetVnd: 3_482_100,
      variableSpentVnd: 1_626_000,
      savingsTargetVnd: 4_000_000,
      actualBalanceVnd: 27_315_311,
    })

    expect(result.emergencyBalanceVnd).toBe(21_229_211)
    expect(result.fixedCostsBalanceVnd).toBe(230_000)
    expect(result.variableSpendingBalanceVnd).toBe(1_856_100)
    expect(result.monthlySavingsBalanceVnd).toBe(4_000_000)
    expect(result.expectedBalanceVnd).toBe(27_315_311)
    expect(result.calculationBalanced).toBe(true)
    expect(result.status).toBe("matched")
  })

  it("does not restore an old current-month balance into today's calculation", () => {
    const form = resolveAccountReconciliationForm({
      selectedMonth: "2026-08",
      currentMonth: "2026-08",
      currentDate: "2026-08-15",
      plannedIncomeVnd: 14_000_000,
      saved: {
        month: "2026-08",
        asOfDate: "2026-08-09",
        actualBalanceVnd: 28_278_000,
        incomeReceivedVnd: 14_000_000,
        updatedAt: "2026-08-09T13:17:30.183Z",
      },
    })

    expect(form).toEqual({
      asOfDate: "2026-08-15",
      actualBalanceVnd: 0,
      incomeReceivedVnd: 14_000_000,
      hasActualBalance: false,
      hasStaleCurrentMonthSave: true,
    })
  })

  it("treats a legacy saved zero balance as an empty reconciliation input", () => {
    const saved = {
      month: "2026-08" as const,
      asOfDate: "2026-08-15" as const,
      actualBalanceVnd: 0,
      incomeReceivedVnd: 14_000_000,
      updatedAt: "2026-08-15T12:00:00.000Z",
    }

    const form = resolveAccountReconciliationForm({
      selectedMonth: "2026-08",
      currentMonth: "2026-08",
      currentDate: "2026-08-15",
      plannedIncomeVnd: 14_000_000,
      saved,
    })
    const state = createInitialState("2026-08-15T12:00:00.000Z")
    state.accountBalanceReconciliationsByMonth["2026-08"] = saved

    expect(hasConfirmedActualBalance(saved)).toBe(false)
    expect(form).toEqual({
      asOfDate: "2026-08-15",
      actualBalanceVnd: 0,
      incomeReceivedVnd: 14_000_000,
      hasActualBalance: false,
      hasStaleCurrentMonthSave: true,
    })
    expect(getSavedAccountReconciliation(state, "2026-08")).toBeNull()
  })

  it("preserves an explicitly confirmed zero account balance", () => {
    const saved = {
      month: "2026-08" as const,
      asOfDate: "2026-08-15" as const,
      actualBalanceVnd: 0,
      actualBalanceConfirmed: true,
      incomeReceivedVnd: 14_000_000,
      updatedAt: "2026-08-15T12:00:00.000Z",
    }
    const state = createInitialState("2026-08-15T12:00:00.000Z")
    state.accountBalanceReconciliationsByMonth["2026-08"] = saved

    expect(hasConfirmedActualBalance(saved)).toBe(true)
    expect(resolveAccountReconciliationForm({
      selectedMonth: "2026-08",
      currentMonth: "2026-08",
      currentDate: "2026-08-15",
      plannedIncomeVnd: 14_000_000,
      saved,
    }).hasActualBalance).toBe(true)
    expect(getSavedAccountReconciliation(state, "2026-08")).not.toBeNull()
  })

  it("replays a saved reconciliation from its immutable calculation snapshot", () => {
    const state = createInitialState("2026-08-09T00:00:00.000Z")
    state.accountBalanceReconciliationsByMonth["2026-08"] = {
      month: "2026-08",
      asOfDate: "2026-08-09",
      actualBalanceVnd: 28_278_000,
      incomeReceivedVnd: 14_000_000,
      calculationSnapshot: {
        emergencyOpeningVnd: 21_571_211,
        emergencyDepositedVnd: 0,
        emergencyWithdrawnVnd: 177_000,
        plannedIncomeVnd: 14_000_000,
        fixedCostsPlannedVnd: 6_517_900,
        fixedCostsPaidVnd: 5_997_900,
        variableBudgetVnd: 3_482_100,
        variableSpentVnd: 949_000,
        savingsTargetVnd: 4_000_000,
      },
      updatedAt: "2026-08-09T13:17:30.183Z",
    }
    state.entities.fixedCosts.byId.changedLater = {
      id: "changedLater",
      month: "2026-08",
      name: "Cập nhật sau lần lưu",
      amountVnd: 1_000_000,
      paidAmountVnd: 1_000_000,
      category: "Bills",
      active: true,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }
    state.entities.fixedCosts.allIds = ["changedLater"]

    const result = getSavedAccountReconciliation(state, "2026-08")

    expect(result?.fixedCostsPaidVnd).toBe(5_997_900)
    expect(result?.variableSpentVnd).toBe(949_000)
    expect(result?.emergencyWithdrawnVnd).toBe(177_000)
    expect(result?.expectedBalanceVnd).toBe(28_447_311)
    expect(result?.differenceVnd).toBe(-169_311)
  })
})
