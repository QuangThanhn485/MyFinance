// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { createInitialState, STORAGE_KEY, type CttmState } from "@/storage/schema"

function stateWithStaleFutureOpening(): CttmState {
  const state = createInitialState("2026-04-30T00:00:00.000Z")

  state.settingsByMonth["2026-04"] = {
    ...state.settings,
    monthlyIncomeVnd: 10_000_000,
    emergencyFundCurrentVnd: 1_000_000,
  }

  state.settingsByMonth["2026-05"] = {
    ...state.settingsByMonth["2026-04"],
    emergencyFundCurrentVnd: 6_700_000,
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
      ex_2: {
        id: "ex_2",
        amountVnd: 500_000,
        category: "Food",
        bucket: "needs",
        note: "",
        date: "2026-04-29",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
    },
    allIds: ["ex_1", "ex_2"],
  }
  state.indexes.expensesByMonth["2026-04"] = ["ex_1", "ex_2"]

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

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  localStorage.clear()
})

describe("future emergency opening balance", () => {
  it("refreshes an existing future month from the previous month's latest numbers", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateWithStaleFutureOpening()))

    const { useAppStore } = await import("@/store/useAppStore")

    useAppStore.getState().actions.ensureSettingsForMonth("2026-05")

    expect(
      useAppStore.getState().data.settingsByMonth["2026-05"].emergencyFundCurrentVnd,
    ).toBe(6_200_000)
  })
})
