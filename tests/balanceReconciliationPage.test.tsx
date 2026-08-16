// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import BalanceReconciliationPage from "@/pages/BalanceReconciliationPage"
import { createInitialState } from "@/storage/schema"

const mocks = vi.hoisted(() => ({
  store: { current: null as any },
  reconcile: vi.fn(),
  fixedSummary: vi.fn(),
}))

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: any) => unknown) => selector(mocks.store.current),
}))

vi.mock("@/selectors/accountReconciliation", () => ({
  getAccountReconciliation: mocks.reconcile,
}))

vi.mock("@/selectors/expenses", () => ({
  getFixedCostPaymentSummary: mocks.fixedSummary,
}))

vi.mock("@/components/DatePicker", () => ({ default: () => null }))
vi.mock("@/components/MonthPicker", () => ({ default: () => null }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
  vi.clearAllMocks()

  const state = createInitialState("2026-08-15T05:00:00.000Z")
  state.settingsByMonth["2026-08"] = {
    ...state.settings,
    monthlyIncomeVnd: 14_000_000,
    essentialVariableBaselineVnd: 3_000_000,
  }
  state.entities.fixedCosts.byId.rent = {
    id: "rent",
    month: "2026-08",
    name: "Tiền nhà",
    amountVnd: 4_000_000,
    paidAmountVnd: 4_000_000,
    category: "Bills",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
  state.entities.fixedCosts.allIds.push("rent")

  mocks.store.current = {
    data: state,
    actions: { saveAccountBalanceReconciliation: vi.fn() },
  }
})

afterEach(() => {
  document.body.innerHTML = ""
  vi.useRealTimers()
})

describe("BalanceReconciliationPage empty state", () => {
  it("does not calculate or render reconciliation details before a balance is entered", () => {
    document.body.innerHTML = renderToStaticMarkup(<BalanceReconciliationPage />)
    const text = document.body.textContent ?? ""
    const saveButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Lưu đối soát"),
    ) as HTMLButtonElement | undefined

    expect(text).toContain("Nhập tổng số dư thực tế để bắt đầu đối soát.")
    expect(text).not.toContain("Chênh lệch thực tế - hệ thống")
    expect(text).not.toContain("Số liệu hệ thống tại ngày đối soát")
    expect(text).not.toContain("Chi phí cố định")
    expect(saveButton?.disabled).toBe(true)
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.fixedSummary).not.toHaveBeenCalled()
  })
})
