import { describe, expect, it } from "vitest"
import { getMonthDayContext } from "@/storage/dayLock"
import type { BudgetBucket, ISODate, YearMonth } from "@/domain/types"
import { createInitialState, type CttmState } from "@/storage/schema"

function addExpense(
  state: CttmState,
  input: { id: string; date: ISODate; amountVnd: number; bucket?: BudgetBucket },
) {
  const month = input.date.slice(0, 7) as YearMonth
  const bucket = input.bucket ?? "needs"
  state.entities.expenses.byId[input.id] = {
    id: input.id,
    amountVnd: input.amountVnd,
    category: bucket === "needs" ? "Food" : "Shopping",
    bucket,
    note: "",
    date: input.date,
    createdAt: `${input.date}T00:00:00.000Z`,
    updatedAt: `${input.date}T00:00:00.000Z`,
  }
  state.entities.expenses.allIds.push(input.id)
  state.indexes.expensesByMonth[month] = [
    ...(state.indexes.expensesByMonth[month] ?? []),
    input.id,
  ]
  state.indexes.expensesByDate[input.date] = [
    ...(state.indexes.expensesByDate[input.date] ?? []),
    input.id,
  ]
}

describe("getMonthDayContext", () => {
  it("counts the reference day as remaining when it has no expense yet", () => {
    const state = createInitialState("2026-04-01T00:00:00.000Z")
    const ctx = getMonthDayContext(state, "2026-04-25")

    expect(ctx.dateHasExpense).toBe(false)
    expect(ctx.remainingStartDate).toBe("2026-04-25")
    expect(ctx.remainingDaysInMonth).toBe(6)
  })

  it("auto-excludes the reference day once it has an expense", () => {
    const state = createInitialState("2026-04-01T00:00:00.000Z")
    addExpense(state, { id: "e1", date: "2026-04-25", amountVnd: 100_000 })
    const ctx = getMonthDayContext(state, "2026-04-25")

    expect(ctx.dateHasExpense).toBe(true)
    expect(ctx.remainingStartDate).toBe("2026-04-26")
    expect(ctx.remainingStartDayOfMonth).toBe(26)
    expect(ctx.remainingDaysInMonth).toBe(5)
  })

  it("uses the real length of the month (July 2026 has 31 days)", () => {
    const state = createInitialState("2026-07-01T00:00:00.000Z")

    // Hôm nay 05/07 chưa chi: còn lại 05..31 = 27 ngày.
    expect(getMonthDayContext(state, "2026-07-05").remainingDaysInMonth).toBe(27)

    // Sau khi ghi chi tiêu hôm nay: loại đúng hôm nay -> 06..31 = 26 ngày.
    addExpense(state, { id: "today", date: "2026-07-05", amountVnd: 100_000 })
    const ctx = getMonthDayContext(state, "2026-07-05")
    expect(ctx.dateHasExpense).toBe(true)
    expect(ctx.remainingStartDate).toBe("2026-07-06")
    expect(ctx.remainingDaysInMonth).toBe(26)
  })

  it("does NOT reduce remaining days for other days in the month that have expenses", () => {
    const state = createInitialState("2026-07-01T00:00:00.000Z")
    addExpense(state, { id: "today", date: "2026-07-05", amountVnd: 100_000 })
    addExpense(state, { id: "future", date: "2026-07-20", amountVnd: 500_000 })
    const ctx = getMonthDayContext(state, "2026-07-05")

    // Chỉ loại hôm nay (05/07); ngày 20/07 tuy đã có chi nhưng vẫn nằm trong "ngày còn lại".
    expect(ctx.remainingDaysInMonth).toBe(26)
    expect(ctx.remainingStartDate).toBe("2026-07-06")
  })

  it("does not count past days in the same month", () => {
    const state = createInitialState("2026-04-01T00:00:00.000Z")
    addExpense(state, { id: "e1", date: "2026-04-10", amountVnd: 100_000 })
    const ctx = getMonthDayContext(state, "2026-04-25")

    expect(ctx.remainingDaysInMonth).toBe(6)
    expect(ctx.remainingStartDate).toBe("2026-04-25")
  })

  it("returns zero remaining days when the last day of month already has an expense", () => {
    const state = createInitialState("2026-04-01T00:00:00.000Z")
    addExpense(state, { id: "e1", date: "2026-04-30", amountVnd: 100_000 })
    const ctx = getMonthDayContext(state, "2026-04-30")

    expect(ctx.dateHasExpense).toBe(true)
    expect(ctx.remainingStartDate).toBe("2026-05-01")
    expect(ctx.remainingDaysInMonth).toBe(0)
  })

  it("ignores zero-amount expenses when detecting spending", () => {
    const state = createInitialState("2026-04-01T00:00:00.000Z")
    addExpense(state, { id: "e1", date: "2026-04-25", amountVnd: 0 })
    const ctx = getMonthDayContext(state, "2026-04-25")

    expect(ctx.dateHasExpense).toBe(false)
    expect(ctx.remainingDaysInMonth).toBe(6)
  })
})
