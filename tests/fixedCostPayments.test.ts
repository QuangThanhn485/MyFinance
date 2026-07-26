// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { getFixedCostPaymentSummary } from "@/selectors/expenses"
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
