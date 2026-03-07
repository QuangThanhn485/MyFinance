import type { ISODate } from "@/domain/types"

export const DAY_LOCK_STORAGE_KEY = "expenses.day.lock.v1"

export type DayLockMemory = Record<string, true>

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

