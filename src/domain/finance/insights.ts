import type { Expense, ExpenseCategory, ISODate, YearMonth } from "@/domain/types"
import { dayOfMonthFromIsoDate, daysInMonth, monthFromIsoDate, parseIsoDateLocal } from "@/lib/date"

export type ClusterTier = "low" | "mid" | "high"

export type ClusterTierSummary = {
  tier: ClusterTier
  avg: number
  count: number
  share: number
  total: number
  days: number[]
}

export type ClusterInsight = {
  tiers: ClusterTierSummary[]
  sampleDays: number
  highDays: number[]
  highTotal: number
  highAvg: number
  topCategories: { category: ExpenseCategory; amount: number; share: number }[]
  topWeekdays: { weekday: number; avg: number; count: number }[]
}

export type AssociationInsight = {
  base: ExpenseCategory
  with: ExpenseCategory
  support: number
  confidence: number
  lift: number
  days: number
  baseDays: number
  sampleDays: number
}

export type TrendDirection = "up" | "down" | "flat"

export type TrendInsight = {
  window: number
  recentAvg: number
  previousAvg: number
  delta: number
  deltaPct: number
  direction: TrendDirection
}

export type AdvancedInsights = {
  totalDays: number
  activeDays: number
  zeroDays: number
  totalSpent: number
  historicalActiveDays: number
  historicalFrom: ISODate | null
  historicalTo: ISODate | null
  cluster: ClusterInsight | null
  association: AssociationInsight | null
  trend: TrendInsight | null
}

type DayBucket = {
  day: number
  date: ISODate
  weekday: number
  total: number
  categories: Set<ExpenseCategory>
  categoryTotals: Record<ExpenseCategory, number>
}

const MIN_CLUSTER_DAYS = 7
const MIN_ACTIVE_DAYS = 4
const MIN_ASSOCIATION_DAYS = 6
const MIN_ASSOCIATION_LIFT = 1.03

function sanitizeInsightExpenses(expenses: Expense[], today: ISODate) {
  return expenses.filter((expense) => {
    if (!expense) return false
    if (!Number.isFinite(expense.amountVnd) || expense.amountVnd <= 0) return false
    return expense.date <= today
  })
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function kMeans1D(values: number[], k = 3, maxIterations = 24) {
  const sorted = [...values].sort((a, b) => a - b)
  const pick = (ratio: number) => {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * (sorted.length - 1))))
    return sorted[idx]
  }
  let centroids = Array.from({ length: k }, (_, idx) => pick((idx + 1) / (k + 1)))
  let assignments = new Array(values.length).fill(0)

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let changed = false
    const sums = Array(k).fill(0)
    const counts = Array(k).fill(0)

    values.forEach((value, index) => {
      let bestIdx = 0
      let bestDist = Number.POSITIVE_INFINITY
      centroids.forEach((centroid, cIdx) => {
        const dist = Math.abs(value - centroid)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = cIdx
        }
      })
      if (assignments[index] !== bestIdx) {
        assignments[index] = bestIdx
        changed = true
      }
      sums[bestIdx] += value
      counts[bestIdx] += 1
    })

    centroids = centroids.map((centroid, idx) =>
      counts[idx] > 0 ? sums[idx] / counts[idx] : centroid,
    )

    if (!changed) break
  }

  const order = centroids
    .map((centroid, idx) => ({ centroid, idx }))
    .sort((a, b) => a.centroid - b.centroid)
  const rankMap = new Map(order.map((item, idx) => [item.idx, idx]))
  const rankedAssignments = assignments.map((idx) => rankMap.get(idx) ?? 0)

  return {
    centroids: order.map((item) => item.centroid),
    assignments: rankedAssignments,
  }
}

function buildDailyBuckets(
  expenses: Expense[],
  month: YearMonth,
  today: ISODate,
) {
  const monthLength = daysInMonth(month)
  const isCurrentMonth = month === monthFromIsoDate(today)
  const lastDay = isCurrentMonth
    ? Math.min(monthLength, Math.max(1, dayOfMonthFromIsoDate(today)))
    : monthLength

  const buckets: DayBucket[] = Array.from({ length: lastDay }, (_, idx) => {
    const day = idx + 1
    const date = `${month}-${String(day).padStart(2, "0")}` as ISODate
    return {
      day,
      date,
      weekday: parseIsoDateLocal(date).getDay(),
      total: 0,
      categories: new Set<ExpenseCategory>(),
      categoryTotals: {} as Record<ExpenseCategory, number>,
    }
  })

  for (const expense of expenses) {
    const day = dayOfMonthFromIsoDate(expense.date)
    if (day < 1 || day > lastDay) continue
    const amount = Number.isFinite(expense.amountVnd) ? expense.amountVnd : 0
    const bucket = buckets[day - 1]
    bucket.total += amount
    bucket.categories.add(expense.category)
    bucket.categoryTotals[expense.category] =
      (bucket.categoryTotals[expense.category] ?? 0) + amount
  }

  return buckets
}

function buildHistoricalDailyBuckets(expenses: Expense[]) {
  const byDate = new Map<ISODate, DayBucket>()
  for (const expense of expenses) {
    const date = expense.date
    if (!byDate.has(date)) {
      byDate.set(date, {
        day: dayOfMonthFromIsoDate(date),
        date,
        weekday: parseIsoDateLocal(date).getDay(),
        total: 0,
        categories: new Set<ExpenseCategory>(),
        categoryTotals: {} as Record<ExpenseCategory, number>,
      })
    }
    const bucket = byDate.get(date)!
    const amount = Number.isFinite(expense.amountVnd) ? expense.amountVnd : 0
    bucket.total += amount
    bucket.categories.add(expense.category)
    bucket.categoryTotals[expense.category] =
      (bucket.categoryTotals[expense.category] ?? 0) + amount
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function computeAdvancedInsights(input: {
  expenses: Expense[]
  historyExpenses?: Expense[]
  month: YearMonth
  today: ISODate
}): AdvancedInsights {
  const periodSourceExpenses = sanitizeInsightExpenses(input.expenses, input.today)
  const historySourceExpenses = sanitizeInsightExpenses(
    input.historyExpenses ?? input.expenses,
    input.today,
  )

  const periodBuckets = buildDailyBuckets(periodSourceExpenses, input.month, input.today)
  const historicalBuckets = buildHistoricalDailyBuckets(historySourceExpenses)

  const totalDays = periodBuckets.length
  const allDailyTotals = periodBuckets.map((b) => b.total)
  const totalSpent = allDailyTotals.reduce((sum, v) => sum + v, 0)
  const activeBuckets = periodBuckets.filter((b) => b.total > 0)
  const activeDays = activeBuckets.length
  const zeroDays = Math.max(0, totalDays - activeDays)

  const historicalActiveBuckets = historicalBuckets.filter((b) => b.total > 0)
  const historicalActiveDays = historicalActiveBuckets.length
  const historicalFrom = historicalBuckets[0]?.date ?? null
  const historicalTo = historicalBuckets[historicalBuckets.length - 1]?.date ?? null
  const activeDailyTotals = historicalActiveBuckets.map((b) => b.total)

  let cluster: ClusterInsight | null = null
  if (
    historicalActiveDays >= MIN_CLUSTER_DAYS &&
    historicalActiveDays >= MIN_ACTIVE_DAYS
  ) {
    // Log-scale clustering is more stable on skewed spending distributions.
    const clusteredTotals = activeDailyTotals.map((value) => Math.log1p(value))
    const { assignments } = kMeans1D(clusteredTotals, 3)
    const CLUSTER_TIER_ORDER: readonly ClusterTier[] = ["low", "mid", "high"]
    const tiers: ClusterTierSummary[] = CLUSTER_TIER_ORDER.map((tier, idx) => {
      const days = historicalActiveBuckets
        .map((b, dayIndex) => (assignments[dayIndex] === idx ? b.day : null))
        .filter((day): day is number => typeof day === "number")
      const total = historicalActiveBuckets.reduce((sum, b, dayIndex) => {
        return assignments[dayIndex] === idx ? sum + b.total : sum
      }, 0)
      const count = days.length
      return {
        tier,
        avg: count > 0 ? total / count : 0,
        count,
        share: historicalActiveDays > 0 ? count / historicalActiveDays : 0,
        total,
        days,
      }
    })

    const highTier = tiers.find((t) => t.tier === "high")
    if (highTier && highTier.count > 0) {
      const categoryTotals: Record<ExpenseCategory, number> = {} as Record<
        ExpenseCategory,
        number
      >
      const weekdayTotals: Record<number, { sum: number; count: number }> = {}
      historicalActiveBuckets.forEach((bucket, index) => {
        if (assignments[index] !== CLUSTER_TIER_ORDER.indexOf("high")) return
        Object.entries(bucket.categoryTotals).forEach(([key, value]) => {
          const category = key as ExpenseCategory
          categoryTotals[category] = (categoryTotals[category] ?? 0) + value
        })
        const weekday = bucket.weekday
        const entry = weekdayTotals[weekday] ?? { sum: 0, count: 0 }
        entry.sum += bucket.total
        entry.count += 1
        weekdayTotals[weekday] = entry
      })
      const topCategories = Object.entries(categoryTotals)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category, amount]) => ({
          category: category as ExpenseCategory,
          amount,
          share: highTier.total > 0 ? amount / highTier.total : 0,
        }))
      const topWeekdays = Object.entries(weekdayTotals)
        .map(([weekday, entry]) => ({
          weekday: Number(weekday),
          avg: entry.count > 0 ? entry.sum / entry.count : 0,
          count: entry.count,
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)

      cluster = {
        tiers,
        sampleDays: historicalActiveDays,
        highDays: highTier.days,
        highTotal: highTier.total,
        highAvg: highTier.avg,
        topCategories,
        topWeekdays,
      }
    } else {
      cluster = {
        tiers,
        sampleDays: historicalActiveDays,
        highDays: [],
        highTotal: 0,
        highAvg: 0,
        topCategories: [],
        topWeekdays: [],
      }
    }
  }

  let association: AssociationInsight | null = null
  if (historicalActiveDays >= MIN_ASSOCIATION_DAYS) {
    const associationBuckets = historicalBuckets.filter((b) => b.categories.size > 0)
    const total = associationBuckets.length
    const categoryCounts: Record<ExpenseCategory, number> = {} as Record<
      ExpenseCategory,
      number
    >
    const pairCounts: Record<string, number> = {}
    for (const bucket of associationBuckets) {
      const cats = Array.from(bucket.categories)
      cats.forEach((cat) => {
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
      })
      for (let i = 0; i < cats.length; i += 1) {
        for (let j = i + 1; j < cats.length; j += 1) {
          const a = cats[i]
          const b = cats[j]
          const key = a < b ? `${a}|${b}` : `${b}|${a}`
          pairCounts[key] = (pairCounts[key] ?? 0) + 1
        }
      }
    }

    const minPairDays = Math.max(3, Math.min(24, Math.ceil(Math.sqrt(total))))
    const minSupport = total >= 120 ? 0.025 : total >= 60 ? 0.03 : 0.04
    const minConfidence = 0.3
    let best:
      | (AssociationInsight & { score: number })
      | null = null

    for (const [key, count] of Object.entries(pairCounts)) {
      if (count < minPairDays) continue
      const [a, b] = key.split("|") as ExpenseCategory[]
      const countA = categoryCounts[a] ?? 0
      const countB = categoryCounts[b] ?? 0
      if (countA <= 0 || countB <= 0) continue
      const confA = count / countA
      const confB = count / countB
      const base = confA >= confB ? a : b
      const other = confA >= confB ? b : a
      const baseDays = confA >= confB ? countA : countB
      const confidence = Math.max(confA, confB)
      const otherDays = confA >= confB ? countB : countA
      const support = count / total
      const lift = otherDays > 0 ? confidence / (otherDays / total) : 0
      if (
        support < minSupport ||
        confidence < minConfidence ||
        lift < MIN_ASSOCIATION_LIFT
      ) {
        continue
      }
      const unionDays = countA + countB - count
      const jaccard = unionDays > 0 ? count / unionDays : 0
      const score = (lift - 1) * confidence * Math.sqrt(support) * (0.6 + jaccard)

      if (!best || score > best.score) {
        best = {
          base,
          with: other,
          support,
          confidence,
          lift,
          days: count,
          baseDays,
          sampleDays: total,
          score,
        }
      }
    }

    if (best) {
      association = {
        base: best.base,
        with: best.with,
        support: best.support,
        confidence: best.confidence,
        lift: best.lift,
        days: best.days,
        baseDays: best.baseDays,
        sampleDays: best.sampleDays,
      }
    }
  }

  let trend: TrendInsight | null = null
  const totalDaysForTrend = allDailyTotals.length
  const window =
    totalDaysForTrend >= 14 ? 7 : totalDaysForTrend >= 10 ? 5 : totalDaysForTrend >= 8 ? 4 : 0
  if (window > 0) {
    const recent = allDailyTotals.slice(totalDaysForTrend - window)
    const previous = allDailyTotals.slice(
      totalDaysForTrend - window * 2,
      totalDaysForTrend - window,
    )
    if (previous.length === window) {
      const recentAvg = mean(recent)
      const previousAvg = mean(previous)
      const delta = recentAvg - previousAvg
      const deltaPct =
        previousAvg > 0 ? delta / previousAvg : recentAvg > 0 ? 1 : 0
      const direction =
        Math.abs(deltaPct) < 0.05 ? "flat" : delta > 0 ? "up" : "down"
      trend = {
        window,
        recentAvg,
        previousAvg,
        delta,
        deltaPct,
        direction,
      }
    }
  }

  return {
    totalDays,
    activeDays,
    zeroDays,
    totalSpent,
    historicalActiveDays,
    historicalFrom,
    historicalTo,
    cluster,
    association,
    trend,
  }
}
