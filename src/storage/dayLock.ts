import type { ISODate, YearMonth } from "@/domain/types"
import {
  addDaysIsoDate,
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
} from "@/lib/date"

export const DAY_LOCK_STORAGE_KEY = "expenses.day.lock.v1"

export type DayLockMemory = Record<string, true>

export type DayLockMonthContext = {
  date: ISODate
  month: YearMonth
  dayOfMonth: number
  daysInMonth: number
  locked: boolean
  remainingStartDate: ISODate
  remainingStartMonth: YearMonth
  remainingStartDayOfMonth: number
  remainingDaysInMonth: number
}

function isIsoDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function loadDayLockMemory(): DayLockMemory {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(DAY_LOCK_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}

    const out: DayLockMemory = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true && isIsoDateKey(key)) out[key] = true
    }
    return out
  } catch {
    return {}
  }
}

export function saveDayLockMemory(memory: DayLockMemory) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(DAY_LOCK_STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // ignore
  }
}

export function isDayLocked(date: ISODate, memory?: DayLockMemory) {
  const source = memory ?? loadDayLockMemory()
  return source[date] === true
}

export function setDayLocked(input: {
  date: ISODate
  locked: boolean
  memory?: DayLockMemory
}) {
  const next: DayLockMemory = { ...(input.memory ?? loadDayLockMemory()) }
  if (input.locked) next[input.date] = true
  else delete next[input.date]
  saveDayLockMemory(next)
  return next
}

export function getDayLockMonthContext(
  date: ISODate,
  memory?: DayLockMemory,
): DayLockMonthContext {
  const month = monthFromIsoDate(date)
  const dim = daysInMonth(month)
  const day = Math.min(dim, Math.max(1, dayOfMonthFromIsoDate(date)))
  const locked = isDayLocked(date, memory)

  // Business rule: after a day is locked, all remaining-month calculations
  // start from the next calendar day instead of the locked date.
  const remainingStartDate = locked ? addDaysIsoDate(date, 1) : date
  const remainingStartMonth = monthFromIsoDate(remainingStartDate)
  const remainingStartInSameMonth = remainingStartMonth === month
  const remainingStartDayOfMonth = remainingStartInSameMonth
    ? Math.min(dim, Math.max(1, dayOfMonthFromIsoDate(remainingStartDate)))
    : dim + 1
  const remainingDaysInMonth = remainingStartInSameMonth
    ? Math.max(0, dim - remainingStartDayOfMonth + 1)
    : 0

  return {
    date,
    month,
    dayOfMonth: day,
    daysInMonth: dim,
    locked,
    remainingStartDate,
    remainingStartMonth,
    remainingStartDayOfMonth,
    remainingDaysInMonth,
  }
}
