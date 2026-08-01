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
  it("adds July savings to the 17.590.711 ending fund on August startup", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"))
    const state = createInitialState("2026-07-31T12:00:00.000Z")
    state.settingsByMonth["2026-07"] = {
      ...state.settings,
      monthlyIncomeVnd: 14_000_000,
      emergencyFundCurrentVnd: 12_825_711,
    }
    state.settingsByMonth["2026-08"] = {
      ...state.settingsByMonth["2026-07"],
      emergencyFundCurrentVnd: 17_590_711,
    }
    state.emergencyFundOpeningSourcesByMonth["2026-08"] = "auto"
    state.entities.expenses.byId.july = {
      id: "july",
      amountVnd: 3_181_000,
      category: "Food",
      bucket: "needs",
      note: "",
      date: "2026-07-31",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    }
    state.entities.expenses.allIds.push("july")
    state.indexes.expensesByMonth["2026-07"] = ["july"]
    state.entities.fixedCosts.byId.fixed = {
      id: "fixed",
      month: "2026-07",
      name: "Chi phí cố định",
      amountVnd: 6_838_500,
      paidAmountVnd: 6_838_500,
      category: "Bills",
      active: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    }
    state.entities.fixedCosts.allIds.push("fixed")
    state.entities.savingsTransactions.byId.deposit = {
      id: "deposit",
      fund: "emergency",
      type: "deposit",
      amountVnd: 7_277_000,
      reason: "Nạp lại quỹ",
      note: "",
      date: "2026-07-01",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }
    state.entities.savingsTransactions.byId.withdraw = {
      id: "withdraw",
      fund: "emergency",
      type: "withdraw",
      amountVnd: 2_512_000,
      reason: "Khẩn cấp",
      note: "",
      date: "2026-07-31",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    }
    state.entities.savingsTransactions.allIds.push("deposit", "withdraw")
    state.accountBalanceReconciliationsByMonth["2026-07"] = {
      month: "2026-07",
      asOfDate: "2026-07-31",
      actualBalanceVnd: 0,
      incomeReceivedVnd: 14_000_000,
      updatedAt: "2026-07-31T12:00:00.000Z",
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useAppStore } = await import("@/store/useAppStore")

    expect(
      useAppStore.getState().data.settingsByMonth["2026-08"].emergencyFundCurrentVnd,
    ).toBe(21_571_211)
    expect(
      useAppStore.getState().data.emergencyFundOpeningSourcesByMonth["2026-08"],
    ).toBe("auto")
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as CttmState
    expect(persisted.settingsByMonth["2026-08"].emergencyFundCurrentVnd).toBe(21_571_211)
    expect(persisted.emergencyFundOpeningSourcesByMonth["2026-08"]).toBe("auto")
  })

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

  it("repairs a current-month opening generated by the legacy rollover formula", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
    const state = stateWithStaleFutureOpening()
    state.settingsByMonth["2026-05"].emergencyFundCurrentVnd = 6_000_000
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useAppStore } = await import("@/store/useAppStore")

    expect(
      useAppStore.getState().data.settingsByMonth["2026-05"].emergencyFundCurrentVnd,
    ).toBe(6_200_000)
  })

  it("repairs a stale opening equal to the previous fund balance even if it was marked manual", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
    const state = stateWithStaleFutureOpening()
    state.settingsByMonth["2026-05"].emergencyFundCurrentVnd = 700_000
    state.emergencyFundOpeningSourcesByMonth["2026-05"] = "manual"
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useAppStore } = await import("@/store/useAppStore")

    expect(
      useAppStore.getState().data.settingsByMonth["2026-05"].emergencyFundCurrentVnd,
    ).toBe(6_200_000)
    expect(
      useAppStore.getState().data.emergencyFundOpeningSourcesByMonth["2026-05"],
    ).toBe("auto")
  })

  it("does not overwrite a current-month opening that was edited manually", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
    const state = stateWithStaleFutureOpening()
    state.settingsByMonth["2026-05"].emergencyFundCurrentVnd = 5_900_000
    state.emergencyFundOpeningSourcesByMonth["2026-05"] = "manual"
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useAppStore } = await import("@/store/useAppStore")

    useAppStore.getState().actions.ensureSettingsForMonth("2026-05")

    expect(
      useAppStore.getState().data.settingsByMonth["2026-05"].emergencyFundCurrentVnd,
    ).toBe(5_900_000)
  })

  it("does not mark an unchanged opening as manual when saving the full settings form", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
    const state = stateWithStaleFutureOpening()
    state.settingsByMonth["2026-05"].emergencyFundCurrentVnd = 6_200_000
    state.emergencyFundOpeningSourcesByMonth["2026-05"] = "auto"
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useAppStore } = await import("@/store/useAppStore")
    const settings = useAppStore.getState().data.settingsByMonth["2026-05"]
    useAppStore.getState().actions.setSettingsForMonth({
      month: "2026-05",
      patch: {
        ...settings,
        monthlyIncomeVnd: settings.monthlyIncomeVnd + 100_000,
      },
    })

    expect(
      useAppStore.getState().data.emergencyFundOpeningSourcesByMonth["2026-05"],
    ).toBe("auto")
  })
})
