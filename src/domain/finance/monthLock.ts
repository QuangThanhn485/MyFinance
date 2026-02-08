import type { Settings, SpendingCaps, YearMonth, BudgetAdjustment } from "@/domain/types"
import type { CttmState, MonthLockSnapshot } from "@/storage/schema"

export function getMonthLock(state: CttmState, month: YearMonth): MonthLockSnapshot | null {
  return state.monthLocksByMonth?.[month] ?? null
}

export function isMonthLocked(state: CttmState, month: YearMonth) {
  return !!getMonthLock(state, month)
}

export function getEffectiveSettingsForMonth(state: CttmState, month: YearMonth): Settings {
  return getMonthLock(state, month)?.settings ?? state.settings
}

export function getEffectiveBudgetAdjustmentForMonth(
  state: CttmState,
  month: YearMonth,
): BudgetAdjustment | null {
  const lock = getMonthLock(state, month)
  return lock ? lock.budgetAdjustment : (state.budgetAdjustmentsByMonth[month] ?? null)
}

export function getEffectiveCapsForMonth(state: CttmState, month: YearMonth): SpendingCaps | null {
  const lock = getMonthLock(state, month)
  return lock ? lock.caps : (state.capsByMonth[month] ?? null)
}

