import { clampMoneyVnd } from "@/domain/finance/finance"
import {
  computePacedAmountToDateVnd,
  normalizeFinanceDay,
  normalizeFinanceDaysInMonth,
} from "@/domain/finance/pace"

export type PaceSurplusSnapshot = {
  plannedNeedsToDateVnd: number
  plannedWantsToDateVnd: number
  actualNeedsToDateVnd: number
  actualWantsToDateVnd: number
  needsSurplusToPaceVnd: number
  wantsSurplusToPaceVnd: number
}

export type TodayCapsSnapshot = {
  essentialDailyVnd: number
  wantsDailyCapVnd: number
  needsSpentTodayVnd: number
  wantsSpentTodayVnd: number
  needsRemainingTodayVnd: number
  wantsRemainingTodayVnd: number
}

export type RecoveryCapsSnapshot = {
  needsRecoveryDailyVnd: number
  wantsRecoveryDailyVnd: number
  needsRemainingTodayVnd: number
  wantsRemainingTodayVnd: number
  remainingDays: number
}

export type RemainingDailySpendingCapSnapshot = {
  spendingBudgetVnd: number
  totalRemainingVnd: number
  remainingDaysInMonth: number
  dailyTotalCapVnd: number
}

export type DailyCapRaiseByDaysPlan = {
  feasible: boolean
  alreadyAtTarget: boolean
  totalRemainingVnd: number
  remainingDaysInMonth: number
  currentDailyCapVnd: number
  targetDailyCapVnd: number
  planDays: number
  remainingDaysAfterPlan: number
  requiredDailyCeilingVnd: number
  dailyReductionFromCurrentCapVnd: number
  allowedSpendDuringPlanVnd: number
  requiredReserveForAfterPlanVnd: number
  projectedRemainingAfterPlanVnd: number
  projectedDailyCapAfterPlanVnd: number
  maxAchievableDailyCapVnd: number
}

export type DailyCapRaiseByCeilingPlan = {
  feasible: boolean
  alreadyAtTarget: boolean
  totalRemainingVnd: number
  remainingDaysInMonth: number
  currentDailyCapVnd: number
  targetDailyCapVnd: number
  dailyCeilingVnd: number
  daysNeeded: number | null
  remainingDaysAfterPlan: number
  projectedRemainingAfterPlanVnd: number
  projectedDailyCapAfterPlanVnd: number
  maxAchievableDailyCapVnd: number
}

export function computeRemainingDailySpendingCap(input: {
  incomeVnd: number
  savingsTargetVnd: number
  totalSpentVnd: number
  remainingDaysInMonth: number
}): RemainingDailySpendingCapSnapshot {
  const incomeVnd = clampMoneyVnd(input.incomeVnd)
  const savingsTargetVnd = clampMoneyVnd(input.savingsTargetVnd)
  const totalSpentVnd = clampMoneyVnd(input.totalSpentVnd)
  const remainingDaysInMonth = Math.max(0, Math.trunc(input.remainingDaysInMonth))

  const spendingBudgetVnd = Math.max(0, incomeVnd - savingsTargetVnd)
  const totalRemainingVnd = spendingBudgetVnd - totalSpentVnd
  const dailyTotalCapVnd =
    remainingDaysInMonth > 0
      ? Math.floor(Math.max(0, totalRemainingVnd) / remainingDaysInMonth)
      : 0

  return {
    spendingBudgetVnd,
    totalRemainingVnd,
    remainingDaysInMonth,
    dailyTotalCapVnd,
  }
}

function normalizeRemainingBudgetVnd(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.trunc(value)
}

function computeDailyCapFromRemaining(totalRemainingVnd: number, remainingDaysInMonth: number) {
  const days = Math.max(0, Math.trunc(remainingDaysInMonth))
  if (days <= 0) return 0
  return Math.floor(Math.max(0, normalizeRemainingBudgetVnd(totalRemainingVnd)) / days)
}

export function computeDailyCapRaisePlanByDays(input: {
  totalRemainingVnd: number
  remainingDaysInMonth: number
  targetDailyCapVnd: number
  planDays: number
  currentDailyCapVnd?: number
}): DailyCapRaiseByDaysPlan {
  const totalRemainingVnd = normalizeRemainingBudgetVnd(input.totalRemainingVnd)
  const remainingDaysInMonth = Math.max(0, Math.trunc(input.remainingDaysInMonth))
  const targetDailyCapVnd = clampMoneyVnd(input.targetDailyCapVnd)
  const planDays = Math.max(0, Math.trunc(input.planDays))
  const currentDailyCapVnd =
    input.currentDailyCapVnd === undefined
      ? computeDailyCapFromRemaining(totalRemainingVnd, remainingDaysInMonth)
      : clampMoneyVnd(input.currentDailyCapVnd)
  const alreadyAtTarget = currentDailyCapVnd >= targetDailyCapVnd
  const remainingDaysAfterPlan = Math.max(0, remainingDaysInMonth - planDays)
  const maxAchievableDailyCapVnd =
    planDays > 0 && planDays < remainingDaysInMonth
      ? computeDailyCapFromRemaining(totalRemainingVnd, remainingDaysAfterPlan)
      : currentDailyCapVnd

  if (planDays <= 0 || planDays >= remainingDaysInMonth) {
    return {
      feasible: alreadyAtTarget,
      alreadyAtTarget,
      totalRemainingVnd,
      remainingDaysInMonth,
      currentDailyCapVnd,
      targetDailyCapVnd,
      planDays,
      remainingDaysAfterPlan,
      requiredDailyCeilingVnd: 0,
      dailyReductionFromCurrentCapVnd: 0,
      allowedSpendDuringPlanVnd: 0,
      requiredReserveForAfterPlanVnd: targetDailyCapVnd * remainingDaysAfterPlan,
      projectedRemainingAfterPlanVnd: Math.max(0, totalRemainingVnd),
      projectedDailyCapAfterPlanVnd: currentDailyCapVnd,
      maxAchievableDailyCapVnd,
    }
  }

  const requiredReserveForAfterPlanVnd = targetDailyCapVnd * remainingDaysAfterPlan
  const maxSpendDuringPlanVnd = totalRemainingVnd - requiredReserveForAfterPlanVnd
  const feasible = maxSpendDuringPlanVnd >= 0
  const requiredDailyCeilingVnd = feasible
    ? Math.floor(maxSpendDuringPlanVnd / planDays)
    : 0
  const allowedSpendDuringPlanVnd = requiredDailyCeilingVnd * planDays
  const projectedRemainingAfterPlanVnd =
    totalRemainingVnd - allowedSpendDuringPlanVnd
  const projectedDailyCapAfterPlanVnd = computeDailyCapFromRemaining(
    projectedRemainingAfterPlanVnd,
    remainingDaysAfterPlan,
  )

  return {
    feasible,
    alreadyAtTarget,
    totalRemainingVnd,
    remainingDaysInMonth,
    currentDailyCapVnd,
    targetDailyCapVnd,
    planDays,
    remainingDaysAfterPlan,
    requiredDailyCeilingVnd,
    dailyReductionFromCurrentCapVnd: Math.max(0, currentDailyCapVnd - requiredDailyCeilingVnd),
    allowedSpendDuringPlanVnd,
    requiredReserveForAfterPlanVnd,
    projectedRemainingAfterPlanVnd,
    projectedDailyCapAfterPlanVnd,
    maxAchievableDailyCapVnd,
  }
}

export function computeDailyCapRaisePlanByCeiling(input: {
  totalRemainingVnd: number
  remainingDaysInMonth: number
  targetDailyCapVnd: number
  dailyCeilingVnd: number
  currentDailyCapVnd?: number
}): DailyCapRaiseByCeilingPlan {
  const totalRemainingVnd = normalizeRemainingBudgetVnd(input.totalRemainingVnd)
  const remainingDaysInMonth = Math.max(0, Math.trunc(input.remainingDaysInMonth))
  const targetDailyCapVnd = clampMoneyVnd(input.targetDailyCapVnd)
  const dailyCeilingVnd = clampMoneyVnd(input.dailyCeilingVnd)
  const currentDailyCapVnd =
    input.currentDailyCapVnd === undefined
      ? computeDailyCapFromRemaining(totalRemainingVnd, remainingDaysInMonth)
      : clampMoneyVnd(input.currentDailyCapVnd)
  const alreadyAtTarget = currentDailyCapVnd >= targetDailyCapVnd

  if (alreadyAtTarget) {
    return {
      feasible: true,
      alreadyAtTarget,
      totalRemainingVnd,
      remainingDaysInMonth,
      currentDailyCapVnd,
      targetDailyCapVnd,
      dailyCeilingVnd,
      daysNeeded: 0,
      remainingDaysAfterPlan: remainingDaysInMonth,
      projectedRemainingAfterPlanVnd: totalRemainingVnd,
      projectedDailyCapAfterPlanVnd: currentDailyCapVnd,
      maxAchievableDailyCapVnd: currentDailyCapVnd,
    }
  }

  let bestCap = currentDailyCapVnd
  for (let days = 1; days < remainingDaysInMonth; days += 1) {
    const remainingDaysAfterPlan = remainingDaysInMonth - days
    const projectedRemainingAfterPlanVnd = totalRemainingVnd - dailyCeilingVnd * days
    const projectedDailyCapAfterPlanVnd = computeDailyCapFromRemaining(
      projectedRemainingAfterPlanVnd,
      remainingDaysAfterPlan,
    )
    bestCap = Math.max(bestCap, projectedDailyCapAfterPlanVnd)
    if (projectedDailyCapAfterPlanVnd >= targetDailyCapVnd) {
      return {
        feasible: true,
        alreadyAtTarget,
        totalRemainingVnd,
        remainingDaysInMonth,
        currentDailyCapVnd,
        targetDailyCapVnd,
        dailyCeilingVnd,
        daysNeeded: days,
        remainingDaysAfterPlan,
        projectedRemainingAfterPlanVnd,
        projectedDailyCapAfterPlanVnd,
        maxAchievableDailyCapVnd: bestCap,
      }
    }
  }

  return {
    feasible: false,
    alreadyAtTarget,
    totalRemainingVnd,
    remainingDaysInMonth,
    currentDailyCapVnd,
    targetDailyCapVnd,
    dailyCeilingVnd,
    daysNeeded: null,
    remainingDaysAfterPlan: 0,
    projectedRemainingAfterPlanVnd: 0,
    projectedDailyCapAfterPlanVnd: 0,
    maxAchievableDailyCapVnd: bestCap,
  }
}

export function resolveEffectiveDailyTotalCapVnd(input: {
  computedDailyTotalCapVnd: number
  appliedDailyTotalCapVnd?: number | null
}) {
  const computedDailyTotalCapVnd = clampMoneyVnd(input.computedDailyTotalCapVnd)
  if (input.appliedDailyTotalCapVnd === undefined || input.appliedDailyTotalCapVnd === null) {
    return computedDailyTotalCapVnd
  }

  return Math.min(computedDailyTotalCapVnd, clampMoneyVnd(input.appliedDailyTotalCapVnd))
}

export function computePaceSurplus(input: {
  dayOfMonth: number
  daysInMonth: number
  plannedMonthlyNeedsVariableVnd: number
  plannedMonthlyWantsVnd: number
  actualNeedsToDateVnd: number
  actualWantsToDateVnd: number
}): PaceSurplusSnapshot {
  const day = normalizeFinanceDay(input.dayOfMonth)
  const dim = normalizeFinanceDaysInMonth(input.daysInMonth)

  const plannedNeedsMonthly = clampMoneyVnd(input.plannedMonthlyNeedsVariableVnd)
  const plannedWantsMonthly = clampMoneyVnd(input.plannedMonthlyWantsVnd)

  const actualNeedsToDateVnd = clampMoneyVnd(input.actualNeedsToDateVnd)
  const actualWantsToDateVnd = clampMoneyVnd(input.actualWantsToDateVnd)

  const plannedNeedsToDateVnd = computePacedAmountToDateVnd({
    monthlyAmountVnd: plannedNeedsMonthly,
    dayOfMonth: day,
    daysInMonth: dim,
  })
  const plannedWantsToDateVnd = computePacedAmountToDateVnd({
    monthlyAmountVnd: plannedWantsMonthly,
    dayOfMonth: day,
    daysInMonth: dim,
  })

  const needsSurplusToPaceVnd = Math.max(
    0,
    plannedNeedsToDateVnd - actualNeedsToDateVnd,
  )
  const wantsSurplusToPaceVnd = Math.max(
    0,
    plannedWantsToDateVnd - actualWantsToDateVnd,
  )

  return {
    plannedNeedsToDateVnd,
    plannedWantsToDateVnd,
    actualNeedsToDateVnd,
    actualWantsToDateVnd,
    needsSurplusToPaceVnd,
    wantsSurplusToPaceVnd,
  }
}

export function computeTodayCaps(input: {
  daysInMonth: number
  essentialBaselineMonthlyVnd: number
  wantsBudgetMonthlyVnd: number
  needsSpentTodayVnd: number
  wantsSpentTodayVnd: number
}): TodayCapsSnapshot {
  const dim = normalizeFinanceDaysInMonth(input.daysInMonth)

  const essentialBaselineMonthlyVnd = clampMoneyVnd(input.essentialBaselineMonthlyVnd)
  const wantsBudgetMonthlyVnd = clampMoneyVnd(input.wantsBudgetMonthlyVnd)

  const needsSpentTodayVnd = clampMoneyVnd(input.needsSpentTodayVnd)
  const wantsSpentTodayVnd = clampMoneyVnd(input.wantsSpentTodayVnd)

  const essentialDailyVnd = Math.floor(essentialBaselineMonthlyVnd / dim)
  const wantsDailyCapVnd = Math.floor(wantsBudgetMonthlyVnd / dim)

  return {
    essentialDailyVnd,
    wantsDailyCapVnd,
    needsSpentTodayVnd,
    wantsSpentTodayVnd,
    needsRemainingTodayVnd: Math.max(0, essentialDailyVnd - needsSpentTodayVnd),
    wantsRemainingTodayVnd: Math.max(0, wantsDailyCapVnd - wantsSpentTodayVnd),
  }
}

export function computeRecoveryCaps(input: {
  dayOfMonth: number
  daysInMonth: number
  remainingDaysInMonth?: number
  plannedMonthlyNeedsVariableVnd: number
  plannedMonthlyWantsVnd: number
  actualNeedsToDateVnd: number
  actualWantsToDateVnd: number
  needsSpentTodayVnd: number
  wantsSpentTodayVnd: number
  relaxMultiplier?: number
}): RecoveryCapsSnapshot {
  const day = normalizeFinanceDay(input.dayOfMonth)
  const dim = normalizeFinanceDaysInMonth(input.daysInMonth)
  const remainingDays =
    input.remainingDaysInMonth === undefined
      ? Math.max(1, dim - day + 1)
      : Math.max(0, Math.trunc(input.remainingDaysInMonth))

  const plannedNeedsMonthlyVnd = clampMoneyVnd(input.plannedMonthlyNeedsVariableVnd)
  const plannedWantsMonthlyVnd = clampMoneyVnd(input.plannedMonthlyWantsVnd)

  const actualNeedsToDateVnd = clampMoneyVnd(input.actualNeedsToDateVnd)
  const actualWantsToDateVnd = clampMoneyVnd(input.actualWantsToDateVnd)

  const needsSpentTodayVnd = clampMoneyVnd(input.needsSpentTodayVnd)
  const wantsSpentTodayVnd = clampMoneyVnd(input.wantsSpentTodayVnd)

  if (remainingDays <= 0) {
    return {
      needsRecoveryDailyVnd: 0,
      wantsRecoveryDailyVnd: 0,
      needsRemainingTodayVnd: 0,
      wantsRemainingTodayVnd: 0,
      remainingDays: 0,
    }
  }

  const plannedNeedsToDateVnd = computePacedAmountToDateVnd({
    monthlyAmountVnd: plannedNeedsMonthlyVnd,
    dayOfMonth: day,
    daysInMonth: dim,
  })
  const plannedWantsToDateVnd = computePacedAmountToDateVnd({
    monthlyAmountVnd: plannedWantsMonthlyVnd,
    dayOfMonth: day,
    daysInMonth: dim,
  })

  const baselineNeedsDailyVnd = Math.floor(plannedNeedsMonthlyVnd / dim)
  const baselineWantsDailyVnd = Math.floor(plannedWantsMonthlyVnd / dim)

  const needsActualBeforeTodayVnd = Math.max(
    0,
    actualNeedsToDateVnd - needsSpentTodayVnd,
  )
  const wantsActualBeforeTodayVnd = Math.max(
    0,
    actualWantsToDateVnd - wantsSpentTodayVnd,
  )

  const needsRemainingBudgetVnd = Math.max(
    0,
    plannedNeedsMonthlyVnd - needsActualBeforeTodayVnd,
  )
  const wantsRemainingBudgetVnd = Math.max(
    0,
    plannedWantsMonthlyVnd - wantsActualBeforeTodayVnd,
  )

  const relaxMultiplier = input.relaxMultiplier ?? 1.2

  const needsOverPace = actualNeedsToDateVnd > plannedNeedsToDateVnd
  const wantsOverPace = actualWantsToDateVnd > plannedWantsToDateVnd

  const needsRecoveryDailyVnd = needsOverPace
    ? Math.floor(needsRemainingBudgetVnd / remainingDays)
    : Math.min(
        Math.floor(needsRemainingBudgetVnd / remainingDays),
        Math.floor(baselineNeedsDailyVnd * relaxMultiplier),
      )
  const wantsRecoveryDailyVnd = wantsOverPace
    ? Math.floor(wantsRemainingBudgetVnd / remainingDays)
    : Math.min(
        Math.floor(wantsRemainingBudgetVnd / remainingDays),
        Math.floor(baselineWantsDailyVnd * relaxMultiplier),
      )

  return {
    needsRecoveryDailyVnd,
    wantsRecoveryDailyVnd,
    needsRemainingTodayVnd: Math.max(0, needsRecoveryDailyVnd - needsSpentTodayVnd),
    wantsRemainingTodayVnd: Math.max(0, wantsRecoveryDailyVnd - wantsSpentTodayVnd),
    remainingDays,
  }
}

export type DailySafeCapSnapshot = PaceSurplusSnapshot

export const computeDailySafeCap = computePaceSurplus
