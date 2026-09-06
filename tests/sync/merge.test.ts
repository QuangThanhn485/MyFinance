import { describe, expect, it } from "vitest"
import { countMissingEntities, isMassDelete, threeWayMerge } from "@/sync/merge"
import { hashDoc, hashState, stableStringify, stripForSync } from "@/sync/snapshot"
import type { SyncDoc } from "@/sync/snapshot"
import { makeState, withExpense, withFixedCost, withoutExpense } from "./harness"

const NOW = "2026-09-05T10:00:00.000Z"
const doc = (cttm: ReturnType<typeof makeState>, templates: SyncDoc["templates"] = { items: [], tombstones: {} }): SyncDoc => ({ cttm, templates })

describe("threeWayMerge — entities", () => {
  it("hai bên thêm khác nhau → giữ cả hai", () => {
    const base = doc(makeState())
    const local = doc(withExpense(base.cttm, { id: "ex_l", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(withExpense(base.cttm, { id: "ex_r", amountVnd: 2, date: "2026-09-02" }))
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(Object.keys(merged.cttm.entities.expenses.byId).sort()).toEqual(["ex_l", "ex_r"])
    expect(conflicts).toHaveLength(0)
  })

  it("chỉ một bên đổi → lấy bên đó, không xung đột", () => {
    const base = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const local = base
    const remote = doc(withExpense(base.cttm, { id: "ex_1", amountVnd: 99, date: "2026-09-01", at: "2026-09-05T09:00:00.000Z" }))
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.byId.ex_1.amountVnd).toBe(99)
    expect(conflicts).toHaveLength(0)
  })

  it("cả hai sửa cùng entity → updatedAt lớn hơn thắng, bản thua vào conflicts", () => {
    const base = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const local = doc(withExpense(base.cttm, { id: "ex_1", amountVnd: 10, date: "2026-09-01", at: "2026-09-05T09:00:00.000Z" }))
    const remote = doc(withExpense(base.cttm, { id: "ex_1", amountVnd: 20, date: "2026-09-01", at: "2026-09-05T09:30:00.000Z" }))
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.byId.ex_1.amountVnd).toBe(20)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: "both-edited", key: "ex_1", winner: "remote" })
    expect((conflicts[0].loser as { amountVnd: number }).amountVnd).toBe(10)
  })

  it("xoá có tombstone ở remote, local không sửa → xoá", () => {
    const base = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(withoutExpense(base.cttm, "ex_1", "2026-09-05T09:00:00.000Z"))
    const { merged, stats } = threeWayMerge(base, base, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.allIds).toEqual([])
    expect(stats.localDeleted).toBe(1)
    expect(merged.cttm.tombstones?.ex_1).toBeTruthy()
  })

  it("xoá vs sửa sau thời điểm xoá → giữ bản sửa và ghi xung đột", () => {
    const base = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(withoutExpense(base.cttm, "ex_1", "2026-09-05T09:00:00.000Z"))
    const local = doc(withExpense(base.cttm, { id: "ex_1", amountVnd: 5, date: "2026-09-01", at: "2026-09-05T09:30:00.000Z" }))
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.byId.ex_1.amountVnd).toBe(5)
    expect(merged.cttm.tombstones?.ex_1).toBeUndefined()
    expect(conflicts.some((c) => c.kind === "delete-vs-edit")).toBe(true)
  })

  it("không có base: thiếu id không bao giờ bị hiểu là xoá (union)", () => {
    const local = doc(withExpense(makeState(), { id: "ex_l", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(withExpense(makeState(), { id: "ex_r", amountVnd: 2, date: "2026-09-02" }))
    const { merged } = threeWayMerge(null, local, remote, { now: NOW })
    expect(Object.keys(merged.cttm.entities.expenses.byId).sort()).toEqual(["ex_l", "ex_r"])
  })

  it("không có base nhưng có tombstone → vẫn xoá", () => {
    const local = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(withoutExpense(local.cttm, "ex_1", "2026-09-05T09:00:00.000Z"))
    const { merged } = threeWayMerge(null, local, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.allIds).toEqual([])
  })

  it("thiếu id mà KHÔNG có tombstone (nguồn cũ) → không bao giờ hiểu là xoá, kể cả khi có base", () => {
    const base = doc(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    const remote = doc(makeState())
    const { merged } = threeWayMerge(base, base, remote, { now: NOW })
    expect(merged.cttm.entities.expenses.allIds).toEqual(["ex_1"])
  })

  it("thứ tự danh mục sau merge tất định, không phụ thuộc bên nào là local", () => {
    const base = doc(makeState())
    const cat = (id: string, createdAt: string) => ({ id, label: id, defaultBucket: "wants" as const, system: false, createdAt, updatedAt: createdAt })
    const local = doc({ ...base.cttm, expenseCategories: [cat("custom_x", "2026-09-05T09:00:00.000Z"), ...base.cttm.expenseCategories] })
    const remote = doc({ ...base.cttm, expenseCategories: [cat("custom_y", "2026-09-05T08:00:00.000Z"), ...base.cttm.expenseCategories] })
    const a = threeWayMerge(base, local, remote, { now: NOW }).merged.cttm.expenseCategories.map((c) => c.id)
    const b = threeWayMerge(base, remote, local, { now: NOW }).merged.cttm.expenseCategories.map((c) => c.id)
    expect(a).toEqual(b)
    expect(a.slice(0, base.cttm.expenseCategories.length)).toEqual(base.cttm.expenseCategories.map((c) => c.id))
    expect(a.slice(-2)).toEqual(["custom_y", "custom_x"])
  })

  it("clone chi phí cố định cùng id ở hai máy → một bản", () => {
    const base = doc(makeState())
    const local = doc(withFixedCost(base.cttm, { id: "fc_2026-09_abc", month: "2026-09", name: "Nhà", amountVnd: 1 }))
    const remote = doc(withFixedCost(base.cttm, { id: "fc_2026-09_abc", month: "2026-09", name: "Nhà", amountVnd: 1 }))
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.entities.fixedCosts.allIds).toEqual(["fc_2026-09_abc"])
    expect(conflicts).toHaveLength(0)
  })
})

describe("threeWayMerge — settings, tháng, danh mục, mẫu", () => {
  it("settings: hai bên đổi field khác nhau → giữ cả hai", () => {
    const base = doc(makeState())
    const local = doc({ ...base.cttm, settings: { ...base.cttm.settings, monthlyIncomeVnd: 30_000_000 } })
    const remote = doc({ ...base.cttm, settings: { ...base.cttm.settings, paydayDayOfMonth: 15 } })
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.settings.monthlyIncomeVnd).toBe(30_000_000)
    expect(merged.cttm.settings.paydayDayOfMonth).toBe(15)
    expect(conflicts).toHaveLength(0)
  })

  it("settings: cùng field → remote thắng, có log", () => {
    const base = doc(makeState())
    const local = doc({ ...base.cttm, settings: { ...base.cttm.settings, monthlyIncomeVnd: 1 } })
    const remote = doc({ ...base.cttm, settings: { ...base.cttm.settings, monthlyIncomeVnd: 2 } })
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.settings.monthlyIncomeVnd).toBe(2)
    expect(conflicts[0]).toMatchObject({ kind: "settings-field", key: "monthlyIncomeVnd" })
  })

  it("settingsByMonth: bên 'manual' thắng bên 'auto'", () => {
    const base = doc(makeState())
    const autoSettings = { ...base.cttm.settings, emergencyFundCurrentVnd: 100 }
    const manualSettings = { ...base.cttm.settings, emergencyFundCurrentVnd: 999 }
    const local = doc({ ...base.cttm, settingsByMonth: { "2026-09": autoSettings }, emergencyFundOpeningSourcesByMonth: { "2026-09": "auto" } })
    const remote = doc({ ...base.cttm, settingsByMonth: { "2026-09": manualSettings }, emergencyFundOpeningSourcesByMonth: { "2026-09": "manual" } })
    const { merged } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.settingsByMonth["2026-09"].emergencyFundCurrentVnd).toBe(999)
    expect(merged.cttm.emergencyFundOpeningSourcesByMonth["2026-09"]).toBe("manual")
  })

  it("caps: source 'seed' luôn thua", () => {
    const base = doc(makeState())
    const seedCaps = { month: "2026-09" as const, appliedAt: "2026-09-05T09:59:00.000Z", source: "seed" }
    const userCaps = { month: "2026-09" as const, appliedAt: "2026-09-05T09:00:00.000Z", source: "user", dailyTotalCapVnd: 100 }
    const local = doc({ ...base.cttm, capsByMonth: { "2026-09": seedCaps } })
    const remote = doc({ ...base.cttm, capsByMonth: { "2026-09": userCaps } })
    const { merged } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.capsByMonth["2026-09"].source).toBe("user")
  })

  it("month lock khác nhau ở hai bên → dựng lại từ dữ liệu đã gộp", () => {
    const base = doc(makeState())
    const settingsA = { ...base.cttm.settings, monthlyIncomeVnd: 1 }
    const settingsB = { ...base.cttm.settings, monthlyIncomeVnd: 2 }
    const local = doc({
      ...base.cttm,
      settingsByMonth: { "2026-08": settingsA },
      monthLocksByMonth: { "2026-08": { closedAt: "2026-09-01T00:00:10.000Z", settings: settingsA, budgetAdjustment: null, caps: null } },
    })
    const remote = doc({
      ...base.cttm,
      settingsByMonth: { "2026-08": settingsB },
      emergencyFundOpeningSourcesByMonth: { "2026-08": "manual" },
      monthLocksByMonth: { "2026-08": { closedAt: "2026-09-01T00:00:05.000Z", settings: settingsB, budgetAdjustment: null, caps: null } },
    })
    const { merged, conflicts } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.monthLocksByMonth["2026-08"].settings.monthlyIncomeVnd).toBe(2)
    expect(merged.cttm.monthLocksByMonth["2026-08"].closedAt).toBe("2026-09-01T00:00:05.000Z")
    expect(conflicts.some((c) => c.kind === "month-lock-rebuilt")).toBe(true)
  })

  it("danh mục bị xoá một bên nhưng bên kia đang dùng → giữ lại", () => {
    const base = doc(makeState())
    const catId = base.cttm.expenseCategories[0].id
    const local = doc({
      ...base.cttm,
      expenseCategories: base.cttm.expenseCategories.filter((c) => c.id !== catId),
      tombstones: { [`cat:${catId}`]: "2026-09-05T09:00:00.000Z" },
    })
    const remote = doc(withExpense(base.cttm, { id: "ex_r", amountVnd: 1, date: "2026-09-02", category: catId, at: "2026-09-05T09:30:00.000Z" }))
    const { merged } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.cttm.expenseCategories.some((c) => c.id === catId)).toBe(true)
  })

  it("mẫu chi tiêu: useCount lấy max, tombstone xoá lan", () => {
    const t = (id: string, useCount: number, updatedAt: string) => ({
      id,
      name: "Cà phê",
      amount: 30_000,
      category: "Food",
      bucket: "NEEDS" as const,
      lastUsedAt: updatedAt,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt,
      useCount,
    })
    const base = doc(makeState(), { items: [t("tpl_1", 1, "2026-09-01T00:00:00.000Z"), t("tpl_2", 1, "2026-09-01T00:00:00.000Z")], tombstones: {} })
    const local = doc(makeState(), { items: [t("tpl_1", 5, "2026-09-05T09:00:00.000Z")], tombstones: { tpl_2: "2026-09-05T08:00:00.000Z" } })
    const remote = doc(makeState(), { items: [t("tpl_1", 3, "2026-09-05T09:30:00.000Z"), t("tpl_2", 1, "2026-09-01T00:00:00.000Z")], tombstones: {} })
    const { merged } = threeWayMerge(base, local, remote, { now: NOW })
    expect(merged.templates.items.map((i) => i.id)).toEqual(["tpl_1"])
    expect(merged.templates.items[0].useCount).toBe(5)
    expect(merged.templates.tombstones.tpl_2).toBeTruthy()
  })
})

describe("mass-delete guard & hash", () => {
  it("đếm entity thiếu và ngưỡng", () => {
    let local = makeState()
    for (let i = 0; i < 40; i += 1) local = withExpense(local, { id: `ex_${i}`, amountVnd: 1, date: "2026-09-01" })
    const merged = makeState()
    const { missing, total } = countMissingEntities(local, merged)
    expect(missing).toBe(40)
    expect(total).toBe(40)
    expect(isMassDelete(missing, total, 0)).toBe(true)
    expect(isMassDelete(2, 40, 38)).toBe(false)
    expect(isMassDelete(20, 100, 80)).toBe(true)
    expect(isMassDelete(1, 1, 0)).toBe(false) // xoá mục cuối cùng là bình thường
    expect(isMassDelete(5, 5, 0)).toBe(true)
  })

  it("hash không phụ thuộc indexes, updatedAt, thứ tự allIds", () => {
    const a = withExpense(withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }), { id: "ex_2", amountVnd: 2, date: "2026-09-02" })
    const b = withExpense(withExpense(makeState(), { id: "ex_2", amountVnd: 2, date: "2026-09-02" }), { id: "ex_1", amountVnd: 1, date: "2026-09-01" })
    expect(hashState(a)).toBe(hashState({ ...b, updatedAt: "2030-01-01T00:00:00.000Z", indexes: { expensesByDate: {}, expensesByMonth: {}, expensesByCategoryMonth: {}, expensesByBucketMonth: {} } }))
    expect(hashDoc(doc(a))).toBe(hashDoc(doc(b)))
    expect(stableStringify(stripForSync(a))).toBe(stableStringify(stripForSync(b)))
    const c = withExpense(a, { id: "ex_3", amountVnd: 3, date: "2026-09-03" })
    expect(hashState(a)).not.toBe(hashState(c))
  })
})
