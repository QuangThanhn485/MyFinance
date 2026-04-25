import { describe, expect, it } from "vitest"
import { computePaceSurplus, computeRecoveryCaps, computeTodayCaps } from "@/domain/finance/dailySafeCap"

describe("computePaceSurplus", () => {
  it("wantsSurplusToPace decreases after adding 600k wants spend", () => {
    const before = computePaceSurplus({
      dayOfMonth: 5,
      daysInMonth: 30,
      plannedMonthlyNeedsVariableVnd: 3_000_000,
      plannedMonthlyWantsVnd: 4_200_000,
      actualNeedsToDateVnd: 0,
      actualWantsToDateVnd: 0,
    })

    const after = computePaceSurplus({
      dayOfMonth: 5,
      daysInMonth: 30,
      plannedMonthlyNeedsVariableVnd: 3_000_000,
      plannedMonthlyWantsVnd: 4_200_000,
      actualNeedsToDateVnd: 0,
      actualWantsToDateVnd: 600_000,
    })

    expect(before.wantsSurplusToPaceVnd).toBe(700_000)
    expect(after.wantsSurplusToPaceVnd).toBe(100_000)
    expect(after.wantsSurplusToPaceVnd).toBe(
      Math.max(0, before.wantsSurplusToPaceVnd - 600_000),
    )
  })
})

describe("computeTodayCaps", () => {
  it("computes remaining today from simple daily caps", () => {
    const caps = computeTodayCaps({
      daysInMonth: 30,
      essentialBaselineMonthlyVnd: 3_000_000,
      wantsBudgetMonthlyVnd: 4_200_000,
      needsSpentTodayVnd: 50_000,
      wantsSpentTodayVnd: 600_000,
    })

    expect(caps.essentialDailyVnd).toBe(100_000)
    expect(caps.wantsDailyCapVnd).toBe(140_000)
    expect(caps.needsRemainingTodayVnd).toBe(50_000)
    expect(caps.wantsRemainingTodayVnd).toBe(0)
  })
})

describe("computeRecoveryCaps", () => {
  it("returns zero caps when no days remain in the month", () => {
    const caps = computeRecoveryCaps({
      dayOfMonth: 30,
      daysInMonth: 30,
      remainingDaysInMonth: 0,
      plannedMonthlyNeedsVariableVnd: 3_000_000,
      plannedMonthlyWantsVnd: 4_200_000,
      actualNeedsToDateVnd: 1_000_000,
      actualWantsToDateVnd: 1_000_000,
      needsSpentTodayVnd: 0,
      wantsSpentTodayVnd: 0,
    })

    expect(caps.remainingDays).toBe(0)
    expect(caps.needsRemainingTodayVnd).toBe(0)
    expect(caps.wantsRemainingTodayVnd).toBe(0)
  })
})
