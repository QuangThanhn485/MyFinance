import { describe, expect, it } from "vitest"
import {
  computePaceSurplus,
  computeDailyCapRaisePlanByCeiling,
  computeDailyCapRaisePlanByDays,
  computeRecoveryCaps,
  computeRemainingDailySpendingCap,
  computeTodayDailySpendingCap,
  computeTodayCaps,
  projectMonthEndFromPace,
  resolveEffectiveDailyTotalCapVnd,
} from "@/domain/finance/dailySafeCap"

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

describe("computeRemainingDailySpendingCap", () => {
  it("matches the total daily cap formula used by overview screens", () => {
    const cap = computeRemainingDailySpendingCap({
      incomeVnd: 10_000_000,
      savingsTargetVnd: 1_000_000,
      totalSpentVnd: 8_932_900,
      remainingDaysInMonth: 1,
    })

    expect(cap.spendingBudgetVnd).toBe(9_000_000)
    expect(cap.totalRemainingVnd).toBe(67_100)
    expect(cap.dailyTotalCapVnd).toBe(67_100)
  })

  it("keeps today's cap anchored before today's spending is recorded", () => {
    const todayCap = computeTodayDailySpendingCap({
      incomeVnd: 10_000_000,
      savingsTargetVnd: 1_000_000,
      monthTotalSpentVnd: 3_100_000,
      todaySpentVnd: 100_000,
      dayOfMonth: 10,
      daysInMonth: 30,
    })
    const futureCap = computeRemainingDailySpendingCap({
      incomeVnd: 10_000_000,
      savingsTargetVnd: 1_000_000,
      totalSpentVnd: 3_100_000,
      remainingDaysInMonth: 20,
    })

    expect(todayCap.totalRemainingVnd).toBe(6_000_000)
    expect(todayCap.remainingDaysInMonth).toBe(21)
    expect(todayCap.dailyTotalCapVnd).toBe(285_714)
    expect(futureCap.dailyTotalCapVnd).toBe(295_000)
    expect(todayCap.dailyTotalCapVnd).not.toBe(futureCap.dailyTotalCapVnd)
  })
})

describe("daily cap raise planner", () => {
  it("computes the daily ceiling needed to raise a future cap", () => {
    const plan = computeDailyCapRaisePlanByDays({
      totalRemainingVnd: 2_000_000,
      remainingDaysInMonth: 20,
      currentDailyCapVnd: 100_000,
      targetDailyCapVnd: 120_000,
      planDays: 10,
    })

    expect(plan.feasible).toBe(true)
    expect(plan.requiredDailyCeilingVnd).toBe(80_000)
    expect(plan.dailyReductionFromCurrentCapVnd).toBe(20_000)
    expect(plan.allowedSpendDuringPlanVnd).toBe(800_000)
    expect(plan.projectedRemainingAfterPlanVnd).toBe(1_200_000)
    expect(plan.projectedDailyCapAfterPlanVnd).toBe(120_000)
  })

  it("finds the minimum number of days for a chosen daily ceiling", () => {
    const plan = computeDailyCapRaisePlanByCeiling({
      totalRemainingVnd: 2_000_000,
      remainingDaysInMonth: 20,
      currentDailyCapVnd: 100_000,
      targetDailyCapVnd: 120_000,
      dailyCeilingVnd: 80_000,
    })

    expect(plan.feasible).toBe(true)
    expect(plan.daysNeeded).toBe(10)
    expect(plan.remainingDaysAfterPlan).toBe(10)
    expect(plan.projectedDailyCapAfterPlanVnd).toBe(120_000)
  })

  it("marks a target impossible when zero spending for the selected days is not enough", () => {
    const plan = computeDailyCapRaisePlanByDays({
      totalRemainingVnd: 2_000_000,
      remainingDaysInMonth: 20,
      currentDailyCapVnd: 100_000,
      targetDailyCapVnd: 300_000,
      planDays: 10,
    })

    expect(plan.feasible).toBe(false)
    expect(plan.maxAchievableDailyCapVnd).toBe(200_000)
  })

  it("raises the cap above 100k after one zero-spend day when 990.5k is spread over 10 days", () => {
    const plan = computeDailyCapRaisePlanByDays({
      totalRemainingVnd: 990_500,
      remainingDaysInMonth: 10,
      currentDailyCapVnd: 99_050,
      targetDailyCapVnd: 100_000,
      planDays: 1,
    })

    expect(plan.feasible).toBe(true)
    expect(plan.requiredDailyCeilingVnd).toBe(90_500)
    expect(plan.remainingDaysAfterPlan).toBe(9)
    expect(plan.projectedDailyCapAfterPlanVnd).toBe(100_000)
    expect(plan.maxAchievableDailyCapVnd).toBe(110_055)
  })
})

describe("resolveEffectiveDailyTotalCapVnd", () => {
  it("does not let a stale applied cap exceed the recomputed safe cap", () => {
    expect(
      resolveEffectiveDailyTotalCapVnd({
        computedDailyTotalCapVnd: 67_100,
        appliedDailyTotalCapVnd: 100_000,
      }),
    ).toBe(67_100)
  })

  it("keeps a stricter applied cap", () => {
    expect(
      resolveEffectiveDailyTotalCapVnd({
        computedDailyTotalCapVnd: 67_100,
        appliedDailyTotalCapVnd: 50_000,
      }),
    ).toBe(50_000)
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

describe("projectMonthEndFromPace", () => {
  it("projects a realistic (low/negative) end-of-month savings when overspending early", () => {
    // Ngày 4/31, mới qua 4 ngày đã chi 3tr biến đổi -> ngoại suy cho cả tháng sẽ vượt xa,
    // KHÔNG coi toàn bộ tiền chưa tiêu là tiết kiệm.
    const p = projectMonthEndFromPace({
      incomeVnd: 20_000_000,
      fixedCostsVnd: 5_000_000,
      essentialVariableBaselineVnd: 6_000_000,
      variableNeedsToDateVnd: 1_000_000,
      variableWantsToDateVnd: 2_000_000,
      dayOfMonth: 4,
      daysInMonth: 31,
    })

    expect(p.projectedNeedsVnd).toBe(7_750_000) // (1tr/4)*31
    expect(p.projectedWantsVnd).toBe(15_500_000) // (2tr/4)*31
    expect(p.projectedVariableVnd).toBe(23_250_000)
    expect(p.projectedTotalSpendVnd).toBe(28_250_000) // + F 5tr
    expect(p.projectedSavingsVnd).toBe(-8_250_000)

    // So với cách cũ (I - đã chi) = 20tr - 8tr = 12tr: sai lệch rất lớn.
    const naiveSavings = 20_000_000 - (5_000_000 + 3_000_000)
    expect(naiveSavings).toBe(12_000_000)
    expect(p.projectedSavingsVnd).toBeLessThan(naiveSavings)
  })

  it("floors projected essentials at the monthly baseline", () => {
    const p = projectMonthEndFromPace({
      incomeVnd: 20_000_000,
      fixedCostsVnd: 5_000_000,
      essentialVariableBaselineVnd: 6_000_000,
      variableNeedsToDateVnd: 1_000_000, // pace*dim = 3tr < baseline 6tr
      variableWantsToDateVnd: 1_000_000,
      dayOfMonth: 10,
      daysInMonth: 30,
    })

    expect(p.projectedNeedsVnd).toBe(6_000_000) // floored at baseline
    expect(p.projectedWantsVnd).toBe(3_000_000) // (1tr/10)*30
    expect(p.projectedSavingsVnd).toBe(6_000_000) // 20tr - 5tr - 9tr
  })

  it("converges to actual spending at end of month", () => {
    const p = projectMonthEndFromPace({
      incomeVnd: 20_000_000,
      fixedCostsVnd: 5_000_000,
      essentialVariableBaselineVnd: 6_000_000,
      variableNeedsToDateVnd: 6_000_000,
      variableWantsToDateVnd: 4_000_000,
      dayOfMonth: 30,
      daysInMonth: 30,
    })

    expect(p.projectedVariableVnd).toBe(10_000_000)
    expect(p.projectedSavingsVnd).toBe(5_000_000)
  })
})
