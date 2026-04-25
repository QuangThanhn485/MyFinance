import { describe, expect, it } from "vitest"
import type { CttmState } from "@/storage/schema"
import { createInitialState } from "@/storage/schema"
import {
  getEffectiveEmergencyFundBalance,
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
    expect(getNextMonthEmergencyOpeningBalance(state, "2026-04")).toBe(6_700_000)
  })
})
