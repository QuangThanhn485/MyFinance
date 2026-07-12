import type { ExpenseCategory } from "@/domain/types"

export const REPORTS_CONFIG_STORAGE_KEY = "smartSpend.reports.v1"

export type ReportsMode = "month" | "trend" | "daily" | "pivot" | "search"

export type MonthDataset = "categories" | "buckets"
export type MonthChartType = "bar" | "pie"
export type MonthBucketKey = "needs" | "wants" | "saved"

export type TrendChartType = "line" | "area" | "bar"
export type TrendRangeMonths = 3 | 6 | 12
export type TrendSeriesKey =
  | "totalSpent"
  | "needsSpent"
  | "wantsSpent"
  | "fixedCosts"
  | "variableSpent"
  | "balance"

export type DailyChartType = "bar" | "line" | "area"
export type DailySeriesKey = "total" | "needs" | "wants"

export type PivotGroupKey =
  | "category"
  | "bucket"
  | "note"
  | "day"
  | "week"
  | "weekday"
  | "dailyCap"
  | "amountRange"
  | "savingsImpact"
  | "mssImpact"
export type PivotMetric = "sum" | "count" | "avg"
export type PivotChartType = "bar" | "line" | "area"
export type SearchFilterField =
  | "date"
  | "month"
  | "amountVnd"
  | "category"
  | "bucket"
  | "note"
  | "weekday"
  | "week"
export type SearchFilterOperator = "eq" | "contains" | "gt" | "gte" | "lt" | "lte"
export type SearchFilterConnector = "and" | "or"
export type SearchFilterCondition = {
  id: string
  connector: SearchFilterConnector
  field: SearchFilterField
  operator: SearchFilterOperator
  value: string
}

export type ReportsConfigV6 = {
  version: 6
  mode: ReportsMode
  month: {
    dataset: MonthDataset
    chartType: MonthChartType
    visibleCategories: ExpenseCategory[]
    visibleBuckets: MonthBucketKey[]
  }
  trend: {
    rangeMonths: TrendRangeMonths
    chartType: TrendChartType
    visibleSeries: TrendSeriesKey[]
  }
  daily: {
    chartType: DailyChartType
    visibleSeries: DailySeriesKey[]
  }
  pivot: {
    rowFields: PivotGroupKey[]
    columnFields: PivotGroupKey[]
    metric: PivotMetric
    chartType: PivotChartType
    visibleSeries: string[]
    colorByAmount: boolean
  }
  search: {
    rowFields: PivotGroupKey[]
    columnFields: PivotGroupKey[]
    metric: PivotMetric
    filters: SearchFilterCondition[]
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeMode(value: unknown): ReportsMode {
  if (value === "trend") return "trend"
  if (value === "daily") return "daily"
  if (value === "pivot") return "pivot"
  if (value === "search") return "search"
  return "month"
}

function normalizeMonthDataset(value: unknown): MonthDataset {
  return value === "buckets" ? "buckets" : "categories"
}

function normalizeMonthChartType(value: unknown): MonthChartType {
  return value === "pie" ? "pie" : "bar"
}

function normalizeMonthBucketKey(value: unknown): MonthBucketKey | null {
  if (value === "needs" || value === "wants" || value === "saved") return value
  return null
}

function normalizeTrendChartType(value: unknown): TrendChartType {
  if (value === "area") return "area"
  if (value === "bar") return "bar"
  return "line"
}

function normalizeRangeMonths(value: unknown): TrendRangeMonths {
  if (value === 3 || value === 6 || value === 12) return value
  return 6
}

function normalizeTrendSeriesKey(value: unknown): TrendSeriesKey | null {
  switch (value) {
    case "totalSpent":
    case "needsSpent":
    case "wantsSpent":
    case "fixedCosts":
    case "variableSpent":
    case "balance":
      return value
    default:
      return null
  }
}

function normalizeDailyChartType(value: unknown): DailyChartType {
  if (value === "line") return "line"
  if (value === "area") return "area"
  return "bar"
}

function normalizeDailySeriesKey(value: unknown): DailySeriesKey | null {
  if (value === "total" || value === "needs" || value === "wants") return value
  return null
}

function normalizePivotGroupKey(value: unknown): PivotGroupKey {
  if (value === "bucket") return "bucket"
  if (value === "note") return "note"
  if (value === "day") return "day"
  if (value === "week") return "week"
  if (value === "weekday") return "weekday"
  if (value === "dailyCap") return "dailyCap"
  if (value === "amountRange") return "amountRange"
  if (value === "savingsImpact") return "savingsImpact"
  if (value === "mssImpact") return "mssImpact"
  return "category"
}

function normalizePivotMetric(value: unknown): PivotMetric {
  if (value === "count") return "count"
  if (value === "avg") return "avg"
  return "sum"
}

function normalizePivotChartType(value: unknown): PivotChartType {
  if (value === "line") return "line"
  if (value === "area") return "area"
  return "bar"
}

function normalizeSearchFilterField(value: unknown): SearchFilterField {
  if (value === "date") return "date"
  if (value === "month") return "month"
  if (value === "amountVnd") return "amountVnd"
  if (value === "category") return "category"
  if (value === "bucket") return "bucket"
  if (value === "note") return "note"
  if (value === "weekday") return "weekday"
  if (value === "week") return "week"
  return "note"
}

function normalizeSearchFilterOperator(value: unknown): SearchFilterOperator {
  if (value === "eq") return "eq"
  if (value === "gt") return "gt"
  if (value === "gte") return "gte"
  if (value === "lt") return "lt"
  if (value === "lte") return "lte"
  return "contains"
}

function normalizeSearchFilterConnector(value: unknown): SearchFilterConnector {
  return value === "or" ? "or" : "and"
}

function normalizePivotFieldList(value: unknown, allowNote = false): PivotGroupKey[] {
  if (!Array.isArray(value)) return []
  return unique(
    value
      .map(normalizePivotGroupKey)
      .filter((x) => allowNote || x !== "note")
      .filter((x): x is PivotGroupKey => !!x),
  )
}

function normalizeExpenseCategory(value: unknown): ExpenseCategory | null {
  if (typeof value !== "string") return null
  const category = value.trim()
  return category ? category : null
}

function normalizeSearchFilterCondition(value: unknown): SearchFilterCondition | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `filter-${Math.random().toString(36).slice(2)}`
  const rawValue = typeof value.value === "string" ? value.value : ""
  return {
    id,
    connector: normalizeSearchFilterConnector(value.connector),
    field: normalizeSearchFilterField(value.field),
    operator: normalizeSearchFilterOperator(value.operator),
    value: rawValue,
  }
}

function unique<T>(items: T[]) {
  const out: T[] = []
  const seen = new Set<T>()
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function defaultReportsConfig(): ReportsConfigV6 {
  return {
    version: 6,
    mode: "month",
    month: {
      dataset: "categories",
      chartType: "bar",
      visibleCategories: [],
      visibleBuckets: ["needs", "wants", "saved"],
    },
    trend: {
      rangeMonths: 6,
      chartType: "line",
      visibleSeries: ["totalSpent", "needsSpent", "wantsSpent", "balance"],
    },
    daily: {
      chartType: "bar",
      visibleSeries: ["needs", "wants"],
    },
    pivot: {
      rowFields: ["category"],
      columnFields: ["bucket"],
      metric: "sum",
      chartType: "bar",
      visibleSeries: [],
      colorByAmount: false,
    },
    search: {
      rowFields: ["category"],
      columnFields: ["bucket"],
      metric: "sum",
      filters: [],
    },
  }
}

export function loadReportsConfig(): ReportsConfigV6 {
  if (typeof localStorage === "undefined") return defaultReportsConfig()

  const raw = localStorage.getItem(REPORTS_CONFIG_STORAGE_KEY)
  if (!raw) return defaultReportsConfig()

  const parsed = safeParseJson(raw)
  if (!isRecord(parsed)) return defaultReportsConfig()

  const defaults = defaultReportsConfig()
  const version = parsed.version
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6
  ) {
    return defaultReportsConfig()
  }

  const monthRaw = isRecord(parsed.month) ? parsed.month : {}
  const trendRaw = isRecord(parsed.trend) ? parsed.trend : {}
  const dailyRaw =
    (version === 2 || version === 3) && isRecord(parsed.daily) ? parsed.daily : {}
  const pivotRaw =
    (version === 3 || version === 4 || version === 5 || version === 6) && isRecord(parsed.pivot)
      ? parsed.pivot
      : {}
  const searchRaw = version === 6 && isRecord(parsed.search) ? parsed.search : {}

  const visibleCategoriesRaw = Array.isArray(monthRaw.visibleCategories)
    ? monthRaw.visibleCategories
    : []
  const visibleCategories = unique(
    visibleCategoriesRaw
      .map(normalizeExpenseCategory)
      .filter((x): x is ExpenseCategory => !!x),
  )

  const visibleBucketsRaw = Array.isArray(monthRaw.visibleBuckets)
    ? monthRaw.visibleBuckets
    : []
  const visibleBuckets = unique(
    visibleBucketsRaw
      .map(normalizeMonthBucketKey)
      .filter((x): x is MonthBucketKey => !!x),
  )

  const visibleSeriesRaw = Array.isArray(trendRaw.visibleSeries)
    ? trendRaw.visibleSeries
    : []
  const visibleSeries = unique(
    visibleSeriesRaw
      .map(normalizeTrendSeriesKey)
      .filter((x): x is TrendSeriesKey => !!x),
  )

  const dailyVisibleSeriesRaw = Array.isArray(dailyRaw.visibleSeries)
    ? dailyRaw.visibleSeries
    : []
  const dailyVisibleSeries = unique(
    dailyVisibleSeriesRaw
      .map(normalizeDailySeriesKey)
      .filter((x): x is DailySeriesKey => !!x),
  )

  const rowFieldsRaw =
    version === 4 || version === 5 || version === 6
      ? normalizePivotFieldList(pivotRaw.rowFields)
      : []
  const columnFieldsRaw =
    version === 4 || version === 5 || version === 6
      ? normalizePivotFieldList(pivotRaw.columnFields)
      : []
  const pivotVisibleSeriesRaw =
    (version === 5 || version === 6) && Array.isArray(pivotRaw.visibleSeries)
      ? pivotRaw.visibleSeries
      : []
  const pivotColorByAmountRaw =
    (version === 5 || version === 6) && typeof pivotRaw.colorByAmount === "boolean"
      ? pivotRaw.colorByAmount
      : false

  const pivotVisibleSeries = unique(
    pivotVisibleSeriesRaw
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )

  const rowGroupLegacy =
    version === 3 ? normalizePivotGroupKey(pivotRaw.rowGroup) : null
  const columnGroupLegacyRaw =
    version === 3 && typeof pivotRaw.columnGroup !== "undefined"
      ? pivotRaw.columnGroup
      : null
  const columnGroupLegacy =
    columnGroupLegacyRaw === "none"
      ? null
      : columnGroupLegacyRaw
        ? normalizePivotGroupKey(columnGroupLegacyRaw)
        : null

  const pivotRowFields =
    rowFieldsRaw.length > 0
      ? rowFieldsRaw
      : rowGroupLegacy
        ? [rowGroupLegacy]
        : defaults.pivot.rowFields
  const pivotColumnFields =
    columnFieldsRaw.length > 0
      ? columnFieldsRaw
      : columnGroupLegacy
        ? [columnGroupLegacy]
      : []

  const searchRowFieldsRaw = version === 6 ? normalizePivotFieldList(searchRaw.rowFields, true) : []
  const searchColumnFieldsRaw = version === 6 ? normalizePivotFieldList(searchRaw.columnFields, true) : []
  const searchFiltersRaw =
    version === 6 && Array.isArray(searchRaw.filters) ? searchRaw.filters : []
  const searchFilters = unique(
    searchFiltersRaw
      .map(normalizeSearchFilterCondition)
      .filter((x): x is SearchFilterCondition => !!x),
  )

  return {
    version: 6,
    mode: normalizeMode(parsed.mode),
    month: {
      dataset: normalizeMonthDataset(monthRaw.dataset),
      chartType: normalizeMonthChartType(monthRaw.chartType),
      visibleCategories,
      visibleBuckets:
        visibleBuckets.length > 0 ? visibleBuckets : defaults.month.visibleBuckets,
    },
    trend: {
      rangeMonths: normalizeRangeMonths(trendRaw.rangeMonths),
      chartType: normalizeTrendChartType(trendRaw.chartType),
      visibleSeries:
        visibleSeries.length > 0 ? visibleSeries : defaults.trend.visibleSeries,
    },
    daily: {
      chartType: normalizeDailyChartType(dailyRaw.chartType),
      visibleSeries:
        dailyVisibleSeries.length > 0
          ? dailyVisibleSeries
          : defaults.daily.visibleSeries,
    },
    pivot: {
      rowFields: pivotRowFields,
      columnFields: pivotColumnFields,
      metric: normalizePivotMetric(pivotRaw.metric),
      chartType: normalizePivotChartType(pivotRaw.chartType),
      visibleSeries: pivotVisibleSeries,
      colorByAmount: pivotColorByAmountRaw,
    },
    search: {
      rowFields: searchRowFieldsRaw.length > 0 ? searchRowFieldsRaw : defaults.search.rowFields,
      columnFields: searchColumnFieldsRaw,
      metric: normalizePivotMetric(searchRaw.metric),
      filters: searchFilters,
    },
  }
}

export function saveReportsConfig(config: ReportsConfigV6) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(REPORTS_CONFIG_STORAGE_KEY, JSON.stringify(config))
}
