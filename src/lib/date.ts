import type { ISODate, YearMonth } from "@/domain/types"

export function todayIso(): ISODate {
  return formatIsoDate(new Date())
}

export function formatIsoDate(date: Date): ISODate {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}` as ISODate
}

export function parseIsoDateLocal(date: ISODate): Date {
  const year = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  return new Date(year, m - 1, d)
}

export function monthFromIsoDate(date: ISODate): YearMonth {
  return date.slice(0, 7) as YearMonth
}

export function dayOfMonthFromIsoDate(date: ISODate) {
  const d = Number(date.slice(8, 10))
  return Number.isFinite(d) && d > 0 ? d : 1
}

export function daysInMonth(month: YearMonth) {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const lastDay = new Date(year, m, 0)
  return lastDay.getDate()
}

export function addDaysIsoDate(date: ISODate, days: number): ISODate {
  const dt = parseIsoDateLocal(date)
  dt.setDate(dt.getDate() + days)
  return formatIsoDate(dt)
}

export function previousMonth(month: YearMonth): YearMonth {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const dt = new Date(year, m - 1, 1)
  dt.setMonth(dt.getMonth() - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}` as YearMonth
}
