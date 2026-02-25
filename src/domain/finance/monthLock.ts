import type { Settings, SpendingCaps, YearMonth, BudgetAdjustment } from "@/domain/types"
import type { CttmState, MonthLockSnapshot } from "@/storage/schema"
import { previousMonth } from "@/lib/date"

export function getMonthLock(state: CttmState, month: YearMonth): MonthLockSnapshot | null {
  return state.monthLocksByMonth?.[month] ?? null
}

export function isMonthLocked(state: CttmState, month: YearMonth) {
  return !!getMonthLock(state, month)
}

function getUnlockedSettingsForMonth(state: CttmState, month: YearMonth): Settings {
  const direct = state.settingsByMonth?.[month]
  if (direct) return direct

  let cursor = month
  for (let i = 0; i < 240; i += 1) {
    const maybe = state.settingsByMonth?.[cursor]
    if (maybe) return maybe
    cursor = previousMonth(cursor)
  }
  return state.settings
}

export function getEffectiveSettingsForMonth(state: CttmState, month: YearMonth): Settings {
  return getMonthLock(state, month)?.settings ?? getUnlockedSettingsForMonth(state, month)
}

export function getMonthlyIncomeTotalVnd(settings: Settings): number {
  const salary = Math.max(0, Math.trunc(settings.monthlyIncomeVnd ?? 0))
  const extra = Math.max(0, Math.trunc(settings.extraIncomeMonthlyVnd ?? 0))
  return salary + extra
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
