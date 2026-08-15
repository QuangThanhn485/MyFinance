import type { Expense, ExpenseCategory, ISODate } from "@/domain/types"
import { addDaysIsoDate, dayOfMonthFromIsoDate, parseIsoDateLocal } from "@/lib/date"

export type ClusterTier = "low" | "mid" | "high"

export type ClusterTierSummary = {
  tier: ClusterTier
  avg: number
  count: number
  share: number
  total: number
  days: ISODate[]
}

export type ClusterQuality = "weak" | "moderate" | "strong"

export type ClusterInsight = {
  tiers: ClusterTierSummary[]
  sampleDays: number
  highDays: ISODate[]
  highTotal: number
  highAvg: number
  silhouette: number
  quality: ClusterQuality
  topCategories: { category: ExpenseCategory; amount: number; share: number }[]
  topWeekdays: {
    weekday: number
    highAvg: number
    highDays: number
    activeDays: number
    highRate: number
  }[]
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

export type AssociationDiagnostic = {
  state: "insufficient-data" | "no-stable-pair" | "stable"
  sampleDays: number
  minPairDays: number
  minSupport: number
  minConfidence: number
  minLift: number
  candidate: AssociationInsight | null
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
  ignoredNominalExpenses: number
  cluster: ClusterInsight | null
  association: AssociationInsight | null
  associationDiagnostic: AssociationDiagnostic
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

const CLUSTER_COUNT = 3
const MIN_CLUSTER_DAYS = 21
const MIN_CLUSTER_SIZE = 2
const MIN_ASSOCIATION_DAYS = 6
const MIN_ASSOCIATION_LIFT = 1.03
const NOMINAL_CORRECTION_MAX_VND = 100

function sanitizeInsightExpenses(expenses: Expense[], today: ISODate) {
  return expenses.filter((expense) => {
    if (!expense) return false
    if (
      !Number.isFinite(expense.amountVnd) ||
      expense.amountVnd <= NOMINAL_CORRECTION_MAX_VND
    ) return false
    return expense.date <= today
  })
}

function countNominalInsightExpenses(expenses: Expense[], today: ISODate) {
  return expenses.filter(
    (expense) =>
      Number.isFinite(expense.amountVnd) &&
      expense.amountVnd > 0 &&
      expense.amountVnd <= NOMINAL_CORRECTION_MAX_VND &&
      expense.date <= today,
  ).length
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function optimalKMeans1D(values: number[], k = CLUSTER_COUNT, minClusterSize = MIN_CLUSTER_SIZE) {
  if (values.length < k * minClusterSize) return null

  const indexed = values
    .map((value, originalIndex) => ({ value, originalIndex }))
    .sort((a, b) => a.value - b.value || a.originalIndex - b.originalIndex)
  const distinctValues = new Set(indexed.map((item) => item.value))
  if (distinctValues.size < k) return null

  const prefix = new Float64Array(indexed.length + 1)
  const prefixSquares = new Float64Array(indexed.length + 1)
  for (let index = 0; index < indexed.length; index += 1) {
    const value = indexed[index].value
    prefix[index + 1] = prefix[index] + value
    prefixSquares[index + 1] = prefixSquares[index] + value * value
  }

  const rangeCost = (start: number, end: number) => {
    const count = end - start + 1
    const sum = prefix[end + 1] - prefix[start]
    const squareSum = prefixSquares[end + 1] - prefixSquares[start]
    return Math.max(0, squareSum - (sum * sum) / count)
  }

  const costs = Array.from({ length: k + 1 }, () =>
    new Float64Array(indexed.length).fill(Number.POSITIVE_INFINITY),
  )
  const previous = Array.from({ length: k + 1 }, () =>
    new Int32Array(indexed.length).fill(-1),
  )

  for (let end = minClusterSize - 1; end < indexed.length; end += 1) {
    costs[1][end] = rangeCost(0, end)
  }

  for (let clusterCount = 2; clusterCount <= k; clusterCount += 1) {
    const minEnd = clusterCount * minClusterSize - 1
    for (let end = minEnd; end < indexed.length; end += 1) {
      const minPreviousEnd = (clusterCount - 1) * minClusterSize - 1
      const maxPreviousEnd = end - minClusterSize
      for (
        let previousEnd = minPreviousEnd;
        previousEnd <= maxPreviousEnd;
        previousEnd += 1
      ) {
        if (indexed[previousEnd].value === indexed[previousEnd + 1].value) continue
        const previousCost = costs[clusterCount - 1][previousEnd]
        if (!Number.isFinite(previousCost)) continue
        const candidateCost = previousCost + rangeCost(previousEnd + 1, end)
        if (candidateCost < costs[clusterCount][end]) {
          costs[clusterCount][end] = candidateCost
          previous[clusterCount][end] = previousEnd
        }
      }
    }
  }

  if (!Number.isFinite(costs[k][indexed.length - 1])) return null

  const ranges = new Array<{ start: number; end: number }>(k)
  let end = indexed.length - 1
  for (let clusterIndex = k; clusterIndex >= 1; clusterIndex -= 1) {
    const previousEnd = clusterIndex === 1 ? -1 : previous[clusterIndex][end]
    if (clusterIndex > 1 && previousEnd < 0) return null
    ranges[clusterIndex - 1] = { start: previousEnd + 1, end }
    end = previousEnd
  }

  const assignments = new Array<number>(values.length)
  const centroids = ranges.map((range, clusterIndex) => {
    const count = range.end - range.start + 1
    const sum = prefix[range.end + 1] - prefix[range.start]
    for (let index = range.start; index <= range.end; index += 1) {
      assignments[indexed[index].originalIndex] = clusterIndex
    }
    return sum / count
  })

  return {
    centroids,
    assignments,
    squaredError: costs[k][indexed.length - 1],
  }
}

function computeSilhouette(values: number[], assignments: number[], clusterCount: number) {
  if (values.length <= 1) return 0
  const members = Array.from({ length: clusterCount }, () => [] as number[])
  assignments.forEach((assignment, index) => members[assignment]?.push(index))

  let totalScore = 0
  values.forEach((value, index) => {
    const ownCluster = assignments[index]
    const ownMembers = members[ownCluster] ?? []
    if (ownMembers.length <= 1) return

    const ownDistance =
      ownMembers.reduce(
        (sum, memberIndex) =>
          memberIndex === index ? sum : sum + Math.abs(value - values[memberIndex]),
        0,
      ) /
      (ownMembers.length - 1)

    let nearestOtherDistance = Number.POSITIVE_INFINITY
    members.forEach((clusterMembers, clusterIndex) => {
      if (clusterIndex === ownCluster || clusterMembers.length === 0) return
      const distance =
        clusterMembers.reduce(
          (sum, memberIndex) => sum + Math.abs(value - values[memberIndex]),
          0,
        ) / clusterMembers.length
      nearestOtherDistance = Math.min(nearestOtherDistance, distance)
    })

    if (!Number.isFinite(nearestOtherDistance)) return
    const denominator = Math.max(ownDistance, nearestOtherDistance)
    if (denominator > 0) {
      totalScore += (nearestOtherDistance - ownDistance) / denominator
    }
  })

  return totalScore / values.length
}

function clusterQualityFromSilhouette(silhouette: number): ClusterQuality {
  if (silhouette >= 0.55) return "strong"
  if (silhouette >= 0.35) return "moderate"
  return "weak"
}

function buildPeriodDailyBuckets(
  expenses: Expense[],
  periodStart: ISODate,
  periodEnd: ISODate,
  today: ISODate,
) {
  const effectiveEnd = periodEnd < today ? periodEnd : today
  if (periodStart > effectiveEnd) return []

  const buckets: DayBucket[] = []
  let date = periodStart
  while (date <= effectiveEnd) {
    buckets.push({
      day: dayOfMonthFromIsoDate(date),
      date,
      weekday: parseIsoDateLocal(date).getDay(),
      total: 0,
      categories: new Set<ExpenseCategory>(),
      categoryTotals: {} as Record<ExpenseCategory, number>,
    })
    date = addDaysIsoDate(date, 1)
  }
  const bucketsByDate = new Map(buckets.map((bucket) => [bucket.date, bucket]))

  for (const expense of expenses) {
    const bucket = bucketsByDate.get(expense.date)
    if (!bucket) continue
    const amount = Number.isFinite(expense.amountVnd) ? expense.amountVnd : 0
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
  periodStart: ISODate
  periodEnd: ISODate
  today: ISODate
}): AdvancedInsights {
  const analysisEnd = input.periodEnd < input.today ? input.periodEnd : input.today
  const periodSourceExpenses = sanitizeInsightExpenses(input.expenses, analysisEnd)
  const historySourceExpenses = sanitizeInsightExpenses(
    input.historyExpenses ?? input.expenses,
    analysisEnd,
  )

  const periodBuckets = buildPeriodDailyBuckets(
    periodSourceExpenses,
    input.periodStart,
    input.periodEnd,
    input.today,
  )
  const historicalBuckets = buildHistoricalDailyBuckets(historySourceExpenses)
  const ignoredNominalExpenses = countNominalInsightExpenses(
    input.historyExpenses ?? input.expenses,
    analysisEnd,
  )

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
  if (historicalActiveDays >= MIN_CLUSTER_DAYS) {
    const clusteredTotals = activeDailyTotals.map((value) => Math.log1p(value))
    const clusterResult = optimalKMeans1D(clusteredTotals)
    if (clusterResult) {
      const { assignments } = clusterResult
      const silhouette = computeSilhouette(clusteredTotals, assignments, CLUSTER_COUNT)
      const CLUSTER_TIER_ORDER: readonly ClusterTier[] = ["low", "mid", "high"]
      const tiers: ClusterTierSummary[] = CLUSTER_TIER_ORDER.map((tier, idx) => {
        const days = historicalActiveBuckets
          .map((b, dayIndex) => (assignments[dayIndex] === idx ? b.date : null))
          .filter((date): date is ISODate => date !== null)
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
        const highWeekdayTotals: Record<number, { sum: number; count: number }> = {}
        const activeWeekdayCounts: Record<number, number> = {}
        historicalActiveBuckets.forEach((bucket) => {
          activeWeekdayCounts[bucket.weekday] =
            (activeWeekdayCounts[bucket.weekday] ?? 0) + 1
        })
        historicalActiveBuckets.forEach((bucket, index) => {
          if (assignments[index] !== CLUSTER_TIER_ORDER.indexOf("high")) return
          Object.entries(bucket.categoryTotals).forEach(([key, value]) => {
            const category = key as ExpenseCategory
            categoryTotals[category] = (categoryTotals[category] ?? 0) + value
          })
          const weekday = bucket.weekday
          const entry = highWeekdayTotals[weekday] ?? { sum: 0, count: 0 }
          entry.sum += bucket.total
          entry.count += 1
          highWeekdayTotals[weekday] = entry
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
        const topWeekdays = Object.entries(highWeekdayTotals)
          .map(([weekday, entry]) => ({
            weekday: Number(weekday),
            highAvg: entry.count > 0 ? entry.sum / entry.count : 0,
            highDays: entry.count,
            activeDays: activeWeekdayCounts[Number(weekday)] ?? 0,
            highRate:
              (activeWeekdayCounts[Number(weekday)] ?? 0) > 0
                ? entry.count / activeWeekdayCounts[Number(weekday)]
                : 0,
          }))
          .sort((a, b) => b.highRate - a.highRate || b.highAvg - a.highAvg)
          .slice(0, 3)

        cluster = {
          tiers,
          sampleDays: historicalActiveDays,
          highDays: highTier.days,
          highTotal: highTier.total,
          highAvg: highTier.avg,
          silhouette,
          quality: clusterQualityFromSilhouette(silhouette),
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
          silhouette,
          quality: clusterQualityFromSilhouette(silhouette),
          topCategories: [],
          topWeekdays: [],
        }
      }
    }
  }

  const associationBuckets = historicalBuckets.filter((b) => b.categories.size > 0)
  const associationSampleDays = associationBuckets.length
  const minPairDays = Math.max(
    3,
    Math.min(24, Math.ceil(Math.sqrt(Math.max(associationSampleDays, 1)))),
  )
  const minSupport =
    associationSampleDays >= 120 ? 0.025 : associationSampleDays >= 60 ? 0.03 : 0.04
  const minConfidence = 0.3
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

  type ScoredAssociation = AssociationInsight & { score: number }
  let bestStable: ScoredAssociation | null = null
  let bestCandidate: ScoredAssociation | null = null

  if (associationSampleDays >= MIN_ASSOCIATION_DAYS) {
    for (const [key, count] of Object.entries(pairCounts)) {
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
      const support = count / associationSampleDays
      const lift = otherDays > 0 ? confidence / (otherDays / associationSampleDays) : 0
      const unionDays = countA + countB - count
      const jaccard = unionDays > 0 ? count / unionDays : 0
      const evidence = Math.min(1, count / minPairDays)
      const score =
        Math.max(0, lift - 1) *
        confidence *
        Math.sqrt(support) *
        (0.6 + jaccard) *
        evidence
      const insight: ScoredAssociation = {
        base,
        with: other,
        support,
        confidence,
        lift,
        days: count,
        baseDays,
        sampleDays: associationSampleDays,
        score,
      }

      if (count >= Math.min(3, minPairDays) && (!bestCandidate || score > bestCandidate.score)) {
        bestCandidate = insight
      }

      const isStable =
        count >= minPairDays &&
        support >= minSupport &&
        confidence >= minConfidence &&
        lift >= MIN_ASSOCIATION_LIFT
      if (isStable && (!bestStable || score > bestStable.score)) {
        bestStable = insight
      }
    }
  }

  const toAssociationInsight = (item: ScoredAssociation | null): AssociationInsight | null =>
    item
      ? {
          base: item.base,
          with: item.with,
          support: item.support,
          confidence: item.confidence,
          lift: item.lift,
          days: item.days,
          baseDays: item.baseDays,
          sampleDays: item.sampleDays,
        }
      : null
  const association = toAssociationInsight(bestStable)
  const associationDiagnostic: AssociationDiagnostic = {
    state:
      associationSampleDays < MIN_ASSOCIATION_DAYS
        ? "insufficient-data"
        : association
          ? "stable"
          : "no-stable-pair",
    sampleDays: associationSampleDays,
    minPairDays,
    minSupport,
    minConfidence,
    minLift: MIN_ASSOCIATION_LIFT,
    candidate: association ?? toAssociationInsight(bestCandidate),
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
    ignoredNominalExpenses,
    cluster,
    association,
    associationDiagnostic,
    trend,
  }
}
