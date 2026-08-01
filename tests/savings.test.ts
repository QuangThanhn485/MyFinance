import { describe, expect, it } from "vitest"
import type { CttmState } from "@/storage/schema"
import { createInitialState } from "@/storage/schema"
import {
  getActualMonthlySavingsVnd,
  getEffectiveEmergencyFundBalance,
  getMonthlySavingsRolloverContributionVnd,
  getNextMonthEmergencyOpeningBalance,
} from "@/selectors/savings"

function baseState(): CttmState {
  const state = createInitialState("2026-04-30T12:00:00.000Z")
  state.settingsByMonth["2026-04"] = {
    ...state.settings,
    monthlyIncomeVnd: 10_000_000,
    emergencyFundCurrentVnd: 1_000_000,
  }
  state.entities.expenses = {
    byId: {
      ex_1: {
        id: "ex_1",
        amountVnd: 4_000_000,
        category: "Food",
        bucket: "needs",
        note: "",
        date: "2026-04-10",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    },
    allIds: ["ex_1"],
  }
  state.indexes.expensesByMonth["2026-04"] = ["ex_1"]
  state.entities.savingsTransactions = {
    byId: {
      st_1: {
        id: "st_1",
        fund: "emergency",
        type: "withdraw",
        amountVnd: 500_000,
        reason: "Y tế",
        note: "",
        date: "2026-04-12",
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z",
      },
      st_2: {
        id: "st_2",
        fund: "emergency",
        type: "deposit",
        amountVnd: 200_000,
        reason: "Nạp lại quỹ",
        note: "",
        date: "2026-04-20",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    },
    allIds: ["st_1", "st_2"],
  }
  return state
}

describe("emergency fund savings ledger", () => {
  it("keeps fund withdrawals out of monthly expenses and adjusts only fund balance", () => {
    const state = baseState()

    expect(getEffectiveEmergencyFundBalance(state, "2026-04")).toBe(700_000)
    expect(getActualMonthlySavingsVnd(state, "2026-04")).toBe(6_000_000)
    expect(getMonthlySavingsRolloverContributionVnd(state, "2026-04")).toBe(5_800_000)
    expect(getNextMonthEmergencyOpeningBalance(state, "2026-04")).toBe(6_500_000)
  })

  it("deducts a saved reconciliation deficit before rolling savings forward", () => {
    const state = baseState()
    state.accountBalanceReconciliationsByMonth["2026-04"] = {
      month: "2026-04",
      asOfDate: "2026-04-30",
      actualBalanceVnd: 6_200_000,
      incomeReceivedVnd: 10_000_000,
      updatedAt: "2026-04-30T12:00:00.000Z",
    }

    expect(getActualMonthlySavingsVnd(state, "2026-04")).toBe(5_500_000)
    expect(getMonthlySavingsRolloverContributionVnd(state, "2026-04")).toBe(5_300_000)
    expect(getNextMonthEmergencyOpeningBalance(state, "2026-04")).toBe(6_000_000)
  })

  it("does not add a fund deposit twice when carrying the balance to next month", () => {
    const state = createInitialState("2026-07-31T12:00:00.000Z")
    state.settingsByMonth["2026-07"] = {
      ...state.settings,
      monthlyIncomeVnd: 10_000_000,
      emergencyFundCurrentVnd: 15_779_711,
    }
    state.entities.expenses.byId.july = {
      id: "july",
      amountVnd: 4_308_500,
      category: "Food",
      bucket: "needs",
      note: "",
      date: "2026-07-31",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    }
    state.entities.expenses.allIds.push("july")
    state.indexes.expensesByMonth["2026-07"] = ["july"]
    state.entities.savingsTransactions.byId.deposit = {
      id: "deposit",
      fund: "emergency",
      type: "deposit",
      amountVnd: 1_811_000,
      reason: "Nạp lại quỹ",
      note: "",
      date: "2026-07-31",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    }
    state.entities.savingsTransactions.allIds.push("deposit")

    expect(getEffectiveEmergencyFundBalance(state, "2026-07")).toBe(17_590_711)
    expect(getActualMonthlySavingsVnd(state, "2026-07")).toBe(5_691_500)
    expect(getMonthlySavingsRolloverContributionVnd(state, "2026-07")).toBe(3_880_500)
    expect(getNextMonthEmergencyOpeningBalance(state, "2026-07")).toBe(21_471_211)
  })
})
