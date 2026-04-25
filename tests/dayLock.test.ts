import { describe, expect, it } from "vitest"
import { getDayLockMonthContext } from "@/storage/dayLock"

describe("getDayLockMonthContext", () => {
  it("counts the selected date as remaining while it is not locked", () => {
    const ctx = getDayLockMonthContext("2026-04-25", {})

    expect(ctx.locked).toBe(false)
    expect(ctx.remainingStartDate).toBe("2026-04-25")
    expect(ctx.remainingDaysInMonth).toBe(6)
  })

  it("starts remaining-month calculations from the next day after lock", () => {
    const ctx = getDayLockMonthContext("2026-04-25", { "2026-04-25": true })

    expect(ctx.locked).toBe(true)
    expect(ctx.remainingStartDate).toBe("2026-04-26")
    expect(ctx.remainingStartDayOfMonth).toBe(26)
    expect(ctx.remainingDaysInMonth).toBe(5)
  })

  it("returns zero remaining days when a locked day is the last day of month", () => {
    const ctx = getDayLockMonthContext("2026-04-30", { "2026-04-30": true })

    expect(ctx.remainingStartDate).toBe("2026-05-01")
    expect(ctx.remainingDaysInMonth).toBe(0)
  })
})
