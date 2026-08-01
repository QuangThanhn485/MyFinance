import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import type { MonthEndProjection } from "@/domain/finance/dailySafeCap"
import type { BudgetBucket, ISODate, YearMonth } from "@/domain/types"
import {
  daysInMonth,
  monthFromIsoDate,
  parseIsoDateLocal,
  previousMonth,
} from "@/lib/date"
import {
  getFixedCostPaymentSummary,
  getMonthTotals,
} from "@/selectors/expenses"
import { getSavedAccountReconciliation } from "@/selectors/accountReconciliation"
import { getMonthDayContext } from "@/storage/dayLock"
import type { CttmState } from "@/storage/schema"

type DailySpend = {
  date: ISODate
  weekday: number
  needs: number
  wants: number
}

type SignalWeights = {
  month: number
  recent: number
  ewma: number
}

export type AdaptiveMonthEndProjection = MonthEndProjection & {
  observedDays: number
  remainingDaysInMonth: number
  historyMonthsUsed: number
  confidence: "low" | "medium" | "high"
  forecastNeedsDailyVnd: number
  forecastWantsDailyVnd: number
  projectedUntrackedVnd: number
  fixedCostOverPlanVnd: number
  committedPurchasesVnd: number
  reconciliationAsOfDate: ISODate | null
}

const HISTORY_MONTHS = 6
const BACKTEST_CUTOFFS = [7, 14, 21] as const
const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  month: 0.45,
  recent: 0.3,
  ewma: 0.25,
}

function money(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function quantile(sorted: number[], ratio: number) {
  if (sorted.length === 0) return 0
  const position = Math.max(0, Math.min(1, ratio)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const fraction = position - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction
}

/** Caps isolated high-spend days before estimating a repeatable daily rate. */
function winsorizeDaily(values: number[]) {
  const normalized = values.map(money)
  const positive = normalized.filter((value) => value > 0).sort((a, b) => a - b)
  if (positive.length < 4) return normalized

  const q1 = quantile(positive, 0.25)
  const q3 = quantile(positive, 0.75)
  const upperFence = Math.max(q3, q3 + 1.5 * (q3 - q1))
  return normalized.map((value) => Math.min(value, upperFence))
}

function robustDailyMean(values: number[]) {
  if (values.length === 0) return 0
  return sum(winsorizeDaily(values)) / values.length
}

function exponentiallyWeightedMean(values: number[], alpha = 0.35) {
  if (values.length === 0) return 0
  const robustValues = winsorizeDaily(values)
  let level = robustValues[0]
  for (let index = 1; index < robustValues.length; index += 1) {
    level = alpha * robustValues[index] + (1 - alpha) * level
  }
  return level
}

function dailyValues(days: DailySpend[], bucket: BudgetBucket) {
  return days.map((day) => day[bucket])
}

function buildMonthDailySpend(state: CttmState, month: YearMonth): DailySpend[] {
  const dim = daysInMonth(month)
  const days = Array.from({ length: dim }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}` as ISODate
    return {
      date,
      weekday: parseIsoDateLocal(date).getDay(),
      needs: 0,
      wants: 0,
    }
  })

  for (const id of state.indexes.expensesByMonth[month] ?? []) {
    const expense = state.entities.expenses.byId[id]
    if (!expense || expense.date.slice(0, 7) !== month) continue
    const day = Number(expense.date.slice(8, 10))
    if (!Number.isFinite(day) || day < 1 || day > dim) continue
    days[day - 1][expense.bucket] += money(expense.amountVnd)
  }

  return days
}

function getHistoricalDailySpend(state: CttmState, month: YearMonth) {
  const months: Array<{ month: YearMonth; days: DailySpend[] }> = []
  let cursor = previousMonth(month)

  for (let index = 0; index < HISTORY_MONTHS; index += 1) {
    const ids = state.indexes.expensesByMonth[cursor] ?? []
    const hasRecordedExpense = ids.some((id) => {
      const expense = state.entities.expenses.byId[id]
      return !!expense && expense.amountVnd > 0
    })
    const isConfirmedMonth = !!state.monthLocksByMonth[cursor]
    if (hasRecordedExpense || isConfirmedMonth) {
      months.push({ month: cursor, days: buildMonthDailySpend(state, cursor) })
    }
    cursor = previousMonth(cursor)
  }

  return months.reverse()
}

function learnSignalWeights(
  history: Array<{ month: YearMonth; days: DailySpend[] }>,
  bucket: BudgetBucket,
): SignalWeights {
  const errors = { month: 0, recent: 0, ewma: 0 }
  let samples = 0
  let targetTotal = 0

  for (const entry of history) {
    const values = dailyValues(entry.days, bucket)
    for (const cutoff of BACKTEST_CUTOFFS) {
      if (cutoff >= values.length - 2) continue
      const observed = values.slice(0, cutoff)
      const future = values.slice(cutoff)
      const target = sum(future) / future.length
      const predictions = {
        month: robustDailyMean(observed),
        recent: robustDailyMean(observed.slice(-7)),
        ewma: exponentiallyWeightedMean(observed),
      }
      errors.month += Math.abs(predictions.month - target)
      errors.recent += Math.abs(predictions.recent - target)
      errors.ewma += Math.abs(predictions.ewma - target)
      targetTotal += target
      samples += 1
    }
  }

  if (samples < 3) return DEFAULT_SIGNAL_WEIGHTS

  const targetScale = Math.max(1, targetTotal / samples)
  const stabilization = Math.max(1, targetScale * 0.08)
  const inverseErrors = {
    month: 1 / (errors.month / samples + stabilization),
    recent: 1 / (errors.recent / samples + stabilization),
    ewma: 1 / (errors.ewma / samples + stabilization),
  }
  const total = inverseErrors.month + inverseErrors.recent + inverseErrors.ewma
  if (!Number.isFinite(total) || total <= 0) return DEFAULT_SIGNAL_WEIGHTS

  return {
    month: inverseErrors.month / total,
    recent: inverseErrors.recent / total,
    ewma: inverseErrors.ewma / total,
  }
}

function weekdayMultipliers(days: DailySpend[], bucket: BudgetBucket) {
  const fallback = Array(7).fill(1) as number[]
  if (days.length < 21) return fallback

  const values = winsorizeDaily(dailyValues(days, bucket))
  const overall = sum(values) / values.length
  if (overall <= 0) return fallback

  const totals = Array(7).fill(0) as number[]
  const counts = Array(7).fill(0) as number[]
  days.forEach((day, index) => {
    totals[day.weekday] += values[index]
    counts[day.weekday] += 1
  })

  const multipliers = totals.map((total, weekday) => {
    if (counts[weekday] === 0) return 1
    const raw = total / counts[weekday] / overall
    const reliability = counts[weekday] / (counts[weekday] + 8)
    return Math.max(0.7, Math.min(1.3, 1 + (raw - 1) * reliability))
  })
  const weightedMean = multipliers.reduce(
    (total, multiplier, weekday) => total + multiplier * counts[weekday],
    0,
  ) / Math.max(1, sum(counts))

  return multipliers.map((value) => value / Math.max(0.01, weightedMean))
}

function forecastDailyRate(input: {
  currentDays: DailySpend[]
  history: Array<{ month: YearMonth; days: DailySpend[] }>
  bucket: BudgetBucket
  plannedMonthlyVnd: number
  daysInCurrentMonth: number
}) {
  const currentValues = dailyValues(input.currentDays, input.bucket)
  const historyDays = input.history.flatMap((entry) => entry.days)
  const historyValues = dailyValues(historyDays, input.bucket)
  const weights = learnSignalWeights(input.history, input.bucket)
  const currentRate =
    robustDailyMean(currentValues) * weights.month +
    robustDailyMean(currentValues.slice(-7)) * weights.recent +
    exponentiallyWeightedMean(currentValues) * weights.ewma

  const planRate = money(input.plannedMonthlyVnd) / Math.max(1, input.daysInCurrentMonth)
  const historicalRate = robustDailyMean(historyValues)
  const historyReliability = Math.min(0.85, input.history.length / 4)
  const priorRate = historyValues.length > 0
    ? historicalRate * historyReliability + planRate * (1 - historyReliability)
    : planRate
  const currentReliability = currentValues.length / (currentValues.length + 7)

  return Math.max(
    0,
    currentRate * currentReliability + priorRate * (1 - currentReliability),
  )
}

/**
 * Adaptive month-end projection using zero-inclusive daily observations, recent trend,
 * exponentially weighted trend, rolling historical backtests, weekday effects, active caps,
 * exact remaining calendar days, and the latest negative account reconciliation difference.
 */
export function projectMonthEndFromData(input: {
  state: CttmState
  date: ISODate
  excludePurchasePlanId?: string
}): AdaptiveMonthEndProjection {
  const { state, date } = input
  const month = monthFromIsoDate(date)
  const context = getMonthDayContext(state, date)
  const dim = context.daysInMonth
  const observedDays = Math.max(0, dim - context.remainingDaysInMonth)
  const currentMonthDays = buildMonthDailySpend(state, month)
  let committedPurchasesVnd = 0
  for (const id of state.entities.purchasePlans.allIds) {
    if (id === input.excludePurchasePlanId) continue
    const plan = state.entities.purchasePlans.byId[id]
    if (!plan?.forced || !plan.targetDate || monthFromIsoDate(plan.targetDate) !== month) continue
    if (plan.targetDate < context.remainingStartDate) continue
    const targetDay = Number(plan.targetDate.slice(8, 10))
    if (!Number.isFinite(targetDay) || targetDay < 1 || targetDay > dim) continue
    const amountVnd = money(plan.priceVnd)
    currentMonthDays[targetDay - 1][plan.bucket] += amountVnd
    committedPurchasesVnd += amountVnd
  }
  const observed = currentMonthDays.slice(0, observedDays)
  const future = currentMonthDays.slice(observedDays)
  const history = getHistoricalDailySpend(state, month)
  const historyDays = history.flatMap((entry) => entry.days)
  const settings = getEffectiveSettingsForMonth(state, month)
  const totals = getMonthTotals(state, month)
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settings),
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
    rule: settings.budgetRule,
    adjustment: getEffectiveBudgetAdjustmentForMonth(state, month),
    customSavingsGoalVnd: settings.customSavingsGoalVnd,
  })

  const needsDailyRate = forecastDailyRate({
    currentDays: observed,
    history,
    bucket: "needs",
    plannedMonthlyVnd: budgets.essentialVariableBaselineVnd,
    daysInCurrentMonth: dim,
  })
  const wantsDailyRate = forecastDailyRate({
    currentDays: observed,
    history,
    bucket: "wants",
    plannedMonthlyVnd: budgets.wantsBudgetVnd,
    daysInCurrentMonth: dim,
  })
  const needsWeekday = weekdayMultipliers([...historyDays, ...observed], "needs")
  const wantsWeekday = weekdayMultipliers([...historyDays, ...observed], "wants")
  const caps = getEffectiveCapsForMonth(state, month)

  let projectedFutureNeedsVnd = 0
  let projectedFutureWantsVnd = 0
  for (const day of future) {
    let needsEstimate = needsDailyRate * needsWeekday[day.weekday]
    let wantsEstimate = wantsDailyRate * wantsWeekday[day.weekday]

    if (caps?.wantsFreezeUntil && day.date <= caps.wantsFreezeUntil) wantsEstimate = 0
    if (caps?.dailyWantsCapVnd != null) {
      wantsEstimate = Math.min(wantsEstimate, money(caps.dailyWantsCapVnd))
    }
    if (caps?.dailyTotalCapVnd != null) {
      const cap = money(caps.dailyTotalCapVnd)
      const estimatedTotal = needsEstimate + wantsEstimate
      if (estimatedTotal > cap && estimatedTotal > 0) {
        const ratio = cap / estimatedTotal
        needsEstimate *= ratio
        wantsEstimate *= ratio
      }
    }

    projectedFutureNeedsVnd += Math.max(day.needs, needsEstimate)
    projectedFutureWantsVnd += Math.max(day.wants, wantsEstimate)
  }

  const observedNeedsVnd = sum(dailyValues(observed, "needs"))
  const observedWantsVnd = sum(dailyValues(observed, "wants"))
  const projectedNeedsVnd = Math.round(observedNeedsVnd + projectedFutureNeedsVnd)
  const projectedWantsVnd = Math.round(observedWantsVnd + projectedFutureWantsVnd)
  const reconciliation = getSavedAccountReconciliation(state, month, date)
  const projectedUntrackedVnd = reconciliation
    ? Math.max(0, -reconciliation.differenceVnd)
    : 0
  const fixedCosts = getFixedCostPaymentSummary(state, month)
  const fixedCostOverPlanVnd = fixedCosts.overPlanVnd
  const projectedVariableVnd =
    projectedNeedsVnd + projectedWantsVnd + projectedUntrackedVnd
  const projectedTotalSpendVnd =
    totals.fixedCostsTotal + fixedCostOverPlanVnd + projectedVariableVnd
  const projectedSavingsVnd = Math.trunc(budgets.incomeVnd - projectedTotalSpendVnd)
  const confidence =
    observedDays >= 14 && history.length >= 2
      ? "high"
      : observedDays >= 7 || history.length >= 2
        ? "medium"
        : "low"

  return {
    projectedNeedsVnd,
    projectedWantsVnd,
    projectedVariableVnd,
    projectedTotalSpendVnd,
    projectedSavingsVnd,
    observedDays,
    remainingDaysInMonth: context.remainingDaysInMonth,
    historyMonthsUsed: history.length,
    confidence,
    forecastNeedsDailyVnd: Math.round(needsDailyRate),
    forecastWantsDailyVnd: Math.round(wantsDailyRate),
    projectedUntrackedVnd,
    fixedCostOverPlanVnd,
    committedPurchasesVnd,
    reconciliationAsOfDate: reconciliation
      ? state.accountBalanceReconciliationsByMonth[month].asOfDate
      : null,
  }
}
