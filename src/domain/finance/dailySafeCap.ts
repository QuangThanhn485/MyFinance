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
  const remainingDays = Math.max(1, dim - day + 1)

  const plannedNeedsMonthlyVnd = clampMoneyVnd(input.plannedMonthlyNeedsVariableVnd)
  const plannedWantsMonthlyVnd = clampMoneyVnd(input.plannedMonthlyWantsVnd)

  const actualNeedsToDateVnd = clampMoneyVnd(input.actualNeedsToDateVnd)
  const actualWantsToDateVnd = clampMoneyVnd(input.actualWantsToDateVnd)

  const needsSpentTodayVnd = clampMoneyVnd(input.needsSpentTodayVnd)
  const wantsSpentTodayVnd = clampMoneyVnd(input.wantsSpentTodayVnd)

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
