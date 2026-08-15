// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { getFixedCostPaymentSummary, getMonthTotals } from "@/selectors/expenses"
import { loadCttmStateFromKey } from "@/storage/localStorage"
import { createInitialState } from "@/storage/schema"

const STORAGE_KEY = "cttm_fixed_cost_payment_test"

beforeEach(() => {
  localStorage.clear()
})

describe("fixed-cost payment tracking", () => {
  it("separates the monthly plan from the amount actually paid", () => {
    const state = createInitialState("2026-07-26T00:00:00.000Z")
    state.settingsByMonth["2026-07"] = {
      ...state.settings,
      debtPaymentMonthlyVnd: 800_000,
      debtPaymentPaidVnd: 600_000,
    }
    state.entities.fixedCosts = {
      byId: {
        rent: {
          id: "rent",
          month: "2026-07",
          name: "Tiền nhà",
          amountVnd: 2_000_000,
          paidAmountVnd: 2_200_000,
          category: "Bills",
          active: true,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-26T00:00:00.000Z",
        },
        utilities: {
          id: "utilities",
          month: "2026-07",
          name: "Điện nước",
          amountVnd: 1_000_000,
          paidAmountVnd: 400_000,
          category: "Bills",
          active: true,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-26T00:00:00.000Z",
        },
      },
      allIds: ["rent", "utilities"],
    }

    expect(getFixedCostPaymentSummary(state, "2026-07")).toMatchObject({
      plannedVnd: 3_800_000,
      paidVnd: 3_200_000,
      remainingVnd: 600_000,
      overPlanVnd: 0,
    })
    expect(getMonthTotals(state, "2026-07")).toMatchObject({
      fixedCostsTotal: 3_800_000,
      fixedCostsPaidTotal: 3_200_000,
      budgetUsed: 3_800_000,
      actualSpent: 3_200_000,
      totalSpent: 3_800_000,
    })
  })

  it("separates actual cash outflow from committed budget", () => {
    const state = createInitialState("2026-08-15T00:00:00.000Z")
    state.settingsByMonth["2026-08"] = {
      ...state.settings,
      debtPaymentMonthlyVnd: 500_000,
      debtPaymentPaidVnd: 200_000,
    }
    state.entities.fixedCosts.byId.rent = {
      id: "rent",
      month: "2026-08",
      name: "Tiền nhà",
      amountVnd: 2_000_000,
      paidAmountVnd: 1_500_000,
      category: "Bills",
      active: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }
    state.entities.fixedCosts.allIds = ["rent"]
    state.entities.expenses.byId.food = {
      id: "food",
      amountVnd: 300_000,
      category: "Food",
      bucket: "needs",
      note: "",
      date: "2026-08-15",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }
    state.entities.expenses.allIds = ["food"]
    state.indexes.expensesByMonth["2026-08"] = ["food"]

    expect(getMonthTotals(state, "2026-08")).toMatchObject({
      fixedCostsTotal: 2_500_000,
      fixedCostsPaidTotal: 1_700_000,
      variableTotal: 300_000,
      budgetUsed: 2_800_000,
      actualSpent: 2_000_000,
      totalSpent: 2_800_000,
    })
  })

  it("normalizes old fixed costs that do not have paidAmountVnd", () => {
    const oldState = createInitialState("2026-07-01T00:00:00.000Z")
    const oldFixedCost = {
      id: "legacy",
      month: "2026-07",
      name: "Khoản cũ",
      amountVnd: 1_000_000,
      category: "Bills",
      active: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }
    ;(oldState.entities.fixedCosts.byId as Record<string, unknown>).legacy = oldFixedCost
    oldState.entities.fixedCosts.allIds = ["legacy"]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldState))

    const loaded = loadCttmStateFromKey(STORAGE_KEY)

    expect(loaded.entities.fixedCosts.byId.legacy.paidAmountVnd).toBe(0)
    expect(loaded.settings.debtPaymentPaidVnd).toBe(0)
    expect(loaded.accountBalanceReconciliationsByMonth).toEqual({})
  })
})
