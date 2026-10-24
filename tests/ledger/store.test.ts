// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { diffRecordMaps } from "@/ledger/ops"
import { docToRecords, recordsToDoc } from "@/ledger/records"
import { STORAGE_KEY } from "@/storage/schema"
import { makeConfiguredState, withExpense } from "../sync/fixtures"

/**
 * Store THẬT + sổ cái: mọi action phải sinh ra op tái tạo đúng dữ liệu người dùng thấy, sống sót
 * qua khởi động lại, và v4 không bao giờ ghi vào cttm_v1 của bản cũ.
 */

let factory: IDBFactory

async function boot() {
  const ledger = await import("@/ledger/appLedger")
  const engine = await ledger.startLedger({ indexedDB: factory })
  const store = await import("@/store/useAppStore")
  const templates = await import("@/storage/templates")
  return { engine, useAppStore: store.useAppStore, templates }
}

async function restart() {
  const ledger = await import("@/ledger/appLedger")
  await ledger.getLedgerEngine().whenIdle()
  ledger.resetLedgerForTests()
  vi.resetModules()
  return boot()
}

function storeRecords(state: { data: unknown; templates: unknown }) {
  return docToRecords({ cttm: state.data as never, templates: state.templates as never })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"))
  localStorage.clear()
  factory = new IDBFactory()
})

afterEach(async () => {
  const ledger = await import("@/ledger/appLedger")
  ledger.resetLedgerForTests()
  vi.resetModules()
  vi.useRealTimers()
})

describe("Store thật ghi qua sổ cái", () => {
  it("mọi action sinh op tái tạo đúng dữ liệu; khởi động lại vẫn y nguyên; cttm_v1 không bị đụng tới", async () => {
    const legacy = JSON.stringify(withExpense(makeConfiguredState(), { id: "ex_legacy", amountVnd: 42_000, date: "2026-10-01" }))
    localStorage.setItem(STORAGE_KEY, legacy)
    const { engine, useAppStore, templates } = await boot()
    const actions = () => useAppStore.getState().actions

    const check = async (label: string) => {
      await engine.whenIdle()
      const projected = recordsToDoc(engine.getRecords())
      const drift = diffRecordMaps(docToRecords(projected), storeRecords(useAppStore.getState()))
      expect(drift, `${label}: store và sổ cái lệch nhau`).toEqual([])
    }

    expect(Object.keys(useAppStore.getState().data.entities.expenses.byId)).toContain("ex_legacy")
    await check("boot")

    const exId = actions().addExpense({ amountVnd: 50_000, category: "Food", note: "Ăn trưa", date: "2026-10-24" })
    await check("addExpense")
    actions().updateExpense(exId, { amountVnd: 55_000, note: "Ăn trưa + nước" })
    await check("updateExpense")
    actions().deleteExpense("ex_legacy")
    await check("deleteExpense")

    const fcId = actions().addFixedCost({ month: "2026-10", name: "Nhà", amountVnd: 5_000_000 })
    actions().updateFixedCost(fcId, { paidAmountVnd: 5_000_000 })
    await check("fixedCost")
    actions().setSettings({ monthlyIncomeVnd: 25_000_000 })
    actions().setSettingsForMonth({ month: "2026-10", patch: { emergencyFundCurrentVnd: 3_000_000 } })
    actions().ensureSettingsForMonth("2026-11")
    await check("settings")

    const category = actions().addExpenseCategory({ label: "Thú cưng", defaultBucket: "wants" })
    expect(category.ok).toBe(true)
    if (category.ok) {
      actions().updateExpenseCategory(category.id, { label: "Thú cưng & chăm sóc" })
      await check("category")
      actions().deleteExpenseCategory(category.id)
    }
    await check("deleteCategory")

    const stId = actions().addSavingsTransaction({ type: "deposit", amountVnd: 1_000_000, reason: "Nạp quỹ", date: "2026-10-24" })
    actions().saveAccountBalanceReconciliation({ month: "2026-10", asOfDate: "2026-10-24", actualBalanceVnd: 12_000_000, incomeReceivedVnd: 25_000_000 })
    const ppId = actions().addPurchasePlan({ name: "Laptop", priceVnd: 20_000_000, bucket: "wants", priority: "med", forced: false })
    actions().updatePurchasePlan(ppId, { priceVnd: 18_000_000 })
    await check("savings/reconciliation/purchase")
    actions().deletePurchasePlan(ppId)
    actions().deleteSavingsTransaction(stId)
    await check("deletes")

    const list = templates.upsertExpenseTemplate({ amountVnd: 30_000, category: "Food", bucket: "needs", note: "Cà phê" })
    templates.updateExpenseTemplate(list[0].id, { name: "Cà phê sáng" })
    await check("templates")
    expect(useAppStore.getState().templates[0].name).toBe("Cà phê sáng")

    const beforeRestart = storeRecords(useAppStore.getState())
    const again = await restart()
    expect(diffRecordMaps(beforeRestart, storeRecords(again.useAppStore.getState()))).toEqual([])
    expect(again.useAppStore.getState().templates[0].name).toBe("Cà phê sáng")

    // v4 không bao giờ ghi đè dữ liệu của bản cũ (để luôn có đường quay lại).
    expect(localStorage.getItem(STORAGE_KEY)).toBe(legacy)
  })

  it("nhập file và xoá toàn bộ đều hoàn tác được từ nhật ký", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withExpense(makeConfiguredState(), { id: "ex_keep", amountVnd: 1, date: "2026-10-01" })))
    const { engine, useAppStore } = await boot()
    const imported = withExpense(makeConfiguredState(), { id: "ex_file", amountVnd: 2, date: "2026-10-02" })
    expect(useAppStore.getState().actions.importJson(JSON.stringify(imported)).ok).toBe(true)
    await engine.whenIdle()
    expect(Object.keys(useAppStore.getState().data.entities.expenses.byId)).toEqual(["ex_file"])

    useAppStore.getState().actions.resetAll()
    await engine.whenIdle()
    expect(Object.keys(useAppStore.getState().data.entities.expenses.byId)).toEqual([])

    const history = await engine.loadHistory()
    const importGroup = history.find((group) => group.ops.some((op) => op.key === "expense/ex_file" && op.t === "put"))!
    await engine.restoreBefore(importGroup)
    await engine.whenIdle()
    expect(Object.keys(useAppStore.getState().data.entities.expenses.byId)).toEqual(["ex_keep"])
  })
})
