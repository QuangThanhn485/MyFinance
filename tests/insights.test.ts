import { describe, expect, it } from "vitest"

import { computeAdvancedInsights } from "@/domain/finance/insights"
import type { Expense, ExpenseCategory, ISODate } from "@/domain/types"
import { addDaysIsoDate } from "@/lib/date"

function expense(
  id: string,
  date: ISODate,
  amountVnd: number,
  category: ExpenseCategory = "Food",
): Expense {
  return {
    id,
    amountVnd,
    category,
    bucket: "needs",
    note: "",
    date,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

describe("advanced report insights", () => {
  it("keeps dates from different months in separate daily buckets", () => {
    const expenses = [
      expense("jul-31", "2026-07-31", 10_000),
      expense("aug-01", "2026-08-01", 20_000),
    ]

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: "2026-07-31",
      periodEnd: "2026-08-01",
      today: "2026-08-15",
    })

    expect(result).toMatchObject({
      totalDays: 2,
      activeDays: 2,
      zeroDays: 0,
      totalSpent: 30_000,
    })
  })

  it("counts only calendar days inside a partial historical range", () => {
    const expenses = [expense("jul-11", "2026-07-11", 50_000)]

    const result = computeAdvancedInsights({
      expenses,
      periodStart: "2026-07-10",
      periodEnd: "2026-07-12",
      today: "2026-08-15",
    })

    expect(result).toMatchObject({
      totalDays: 3,
      activeDays: 1,
      zeroDays: 2,
      totalSpent: 50_000,
    })
  })

  it("builds a cross-month trend from two exact seven-day windows", () => {
    const start = "2026-07-29" as ISODate
    const expenses = Array.from({ length: 14 }, (_, index) => {
      const date = addDaysIsoDate(start, index)
      return expense(`day-${index}`, date, index < 7 ? 10_000 : 20_000)
    })

    const result = computeAdvancedInsights({
      expenses,
      periodStart: start,
      periodEnd: "2026-08-11",
      today: "2026-08-15",
    })

    expect(result.trend).toMatchObject({
      window: 7,
      previousAvg: 10_000,
      recentAvg: 20_000,
      delta: 10_000,
      deltaPct: 1,
      direction: "up",
    })
  })

  it("stops a current-period analysis at today", () => {
    const result = computeAdvancedInsights({
      expenses: [expense("future", "2026-08-20", 100_000)],
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      today: "2026-08-15",
    })

    expect(result).toMatchObject({
      totalDays: 15,
      activeDays: 0,
      zeroDays: 15,
      totalSpent: 0,
    })
  })

  it("ignores nominal correction records in statistical insights", () => {
    const expenses = [
      expense("correction", "2026-06-21", 1),
      expense("real", "2026-06-22", 10_000),
    ]

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: "2026-06-21",
      periodEnd: "2026-06-22",
      today: "2026-08-15",
    })

    expect(result).toMatchObject({
      totalDays: 2,
      activeDays: 1,
      zeroDays: 1,
      totalSpent: 10_000,
      historicalActiveDays: 1,
      ignoredNominalExpenses: 1,
    })
  })

  it("does not leak expenses after the selected period into historical baselines", () => {
    const historyExpenses = [
      expense("july", "2026-07-10", 50_000),
      expense("august", "2026-08-10", 500_000),
    ]

    const result = computeAdvancedInsights({
      expenses: [historyExpenses[0]],
      historyExpenses,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      today: "2026-08-15",
    })

    expect(result).toMatchObject({
      historicalActiveDays: 1,
      historicalFrom: "2026-07-10",
      historicalTo: "2026-07-10",
    })
  })

  it("ranks weekdays by their high-spend rate instead of outlier averages", () => {
    const start = "2026-07-05" as ISODate
    const expenses = Array.from({ length: 28 }, (_, index) => {
      const date = addDaysIsoDate(start, index)
      const weekday = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ).getDay()
      const amountVnd = weekday === 0 ? 1_000_000 : weekday === 6 ? 200_000 : 50_000
      return expense(`weekday-${index}`, date, amountVnd)
    })

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: start,
      periodEnd: "2026-08-01",
      today: "2026-08-15",
    })

    expect(result.cluster?.topWeekdays[0]).toMatchObject({
      weekday: 0,
      highDays: 4,
      activeDays: 4,
      highRate: 1,
      highAvg: 1_000_000,
    })
  })

  it("finds the globally optimal one-dimensional clusters", () => {
    const amounts = [
      11_000, 11_000, 11_000, 12_000, 12_000, 12_000, 12_000, 13_000,
      14_000, 17_000, 18_000, 19_000, 21_000, 22_000, 22_000, 38_000,
      41_000, 60_000, 70_000, 137_000, 140_000, 146_000, 152_000, 232_000,
    ]
    const start = "2026-01-01" as ISODate
    const expenses = amounts.map((amountVnd, index) => {
      const date = addDaysIsoDate(start, index)
      return expense(`cluster-${index}`, date, amountVnd)
    })

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: start,
      periodEnd: addDaysIsoDate(start, amounts.length - 1),
      today: "2026-08-15",
    })

    expect(result.cluster?.tiers.map((tier) => tier.count)).toEqual([15, 4, 5])
    expect(result.cluster?.tiers[0].days[0]).toBe("2026-01-01")
    expect(result.cluster?.tiers[2].days).toEqual([
      "2026-01-20",
      "2026-01-21",
      "2026-01-22",
      "2026-01-23",
      "2026-01-24",
    ])
    expect(result.cluster?.silhouette).toBeGreaterThan(0)
  })

  it("does not manufacture three clusters from fewer than three spending levels", () => {
    const start = "2026-01-01" as ISODate
    const expenses = Array.from({ length: 21 }, (_, index) => {
      const date = addDaysIsoDate(start, index)
      return expense(`duplicate-${index}`, date, index < 10 ? 50_000 : 100_000)
    })

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: start,
      periodEnd: addDaysIsoDate(start, 20),
      today: "2026-08-15",
    })

    expect(result.cluster).toBeNull()
  })

  it("distinguishes insufficient association data from no stable pair", () => {
    const start = "2026-01-01" as ISODate
    const expenses = Array.from({ length: 25 }, (_, index) => {
      const date = addDaysIsoDate(start, index)
      const entries = [expense(`food-${index}`, date, 10_000, "Food")]
      if (index < 10) entries.push(expense(`drink-${index}`, date, 5_000, "Drink"))
      return entries
    }).flat()

    const insufficientExpenses = expenses.filter((item) => item.date <= "2026-01-05")
    const insufficientResult = computeAdvancedInsights({
      expenses: insufficientExpenses,
      historyExpenses: insufficientExpenses,
      periodStart: start,
      periodEnd: "2026-01-05",
      today: "2026-08-15",
    })

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: start,
      periodEnd: addDaysIsoDate(start, 24),
      today: "2026-08-15",
    })

    expect(insufficientResult.associationDiagnostic).toMatchObject({
      state: "insufficient-data",
      sampleDays: 5,
    })
    expect(result.association).toBeNull()
    expect(result.associationDiagnostic).toMatchObject({
      state: "no-stable-pair",
      sampleDays: 25,
      minPairDays: 5,
    })
    expect(result.associationDiagnostic.candidate).toMatchObject({
      days: 10,
      confidence: 1,
      lift: 1,
    })
  })

  it("returns a stable association only after every statistical guard passes", () => {
    const start = "2026-01-01" as ISODate
    const expenses = Array.from({ length: 25 }, (_, index) => {
      const date = addDaysIsoDate(start, index)
      if (index < 8) {
        return [
          expense(`service-${index}`, date, 10_000, "Service"),
          expense(`drink-${index}`, date, 5_000, "Drink"),
        ]
      }
      if (index < 10) return [expense(`service-${index}`, date, 10_000, "Service")]
      return [expense(`food-${index}`, date, 10_000, "Food")]
    }).flat()

    const result = computeAdvancedInsights({
      expenses,
      historyExpenses: expenses,
      periodStart: start,
      periodEnd: addDaysIsoDate(start, 24),
      today: "2026-08-15",
    })

    expect(result.associationDiagnostic.state).toBe("stable")
    expect(result.association).toMatchObject({
      base: "Drink",
      with: "Service",
      days: 8,
      support: 8 / 25,
      confidence: 1,
      lift: 2.5,
    })
  })
})
