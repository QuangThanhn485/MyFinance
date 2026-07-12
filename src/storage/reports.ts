export const REPORTS_CONFIG_STORAGE_KEY = "smartSpend.reports.v1"

export type ReportsMode = "pivot" | "search"

export type PivotGroupKey =
  | "category"
  | "bucket"
  | "note"
  | "month"
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
  // Config cũ có thể còn lưu "month" / "daily" / "trend" -> các tab đó đã bị bỏ, đưa về Pivot.
  if (value === "search") return "search"
  return "pivot"
}

function normalizePivotGroupKey(value: unknown): PivotGroupKey {
  if (value === "bucket") return "bucket"
  if (value === "note") return "note"
  if (value === "month") return "month"
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

/**
 * Toán tử hợp lệ theo từng trường. Các trường chọn từ danh sách (danh mục, bucket, thứ) chỉ
 * so sánh bằng/chứa — so sánh lớn/nhỏ trên chúng không có ý nghĩa.
 * Phần tử đầu tiên là toán tử mặc định của trường.
 */
export const SEARCH_FIELD_OPERATORS: Record<SearchFilterField, SearchFilterOperator[]> = {
  date: ["eq", "gt", "gte", "lt", "lte"],
  month: ["eq", "gt", "gte", "lt", "lte"],
  amountVnd: ["eq", "gt", "gte", "lt", "lte"],
  category: ["eq", "contains"],
  bucket: ["eq"],
  note: ["contains", "eq"],
  weekday: ["eq"],
  week: ["eq", "gt", "gte", "lt", "lte"],
}

export function resolveSearchFilterOperator(
  field: SearchFilterField,
  operator: SearchFilterOperator,
): SearchFilterOperator {
  const allowed = SEARCH_FIELD_OPERATORS[field]
  return allowed.includes(operator) ? operator : allowed[0]
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

function normalizeSearchFilterCondition(value: unknown): SearchFilterCondition | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `filter-${Math.random().toString(36).slice(2)}`
  const rawValue = typeof value.value === "string" ? value.value : ""
  const field = normalizeSearchFilterField(value.field)
  return {
    id,
    connector: normalizeSearchFilterConnector(value.connector),
    field,
    // Config cũ có thể lưu toán tử không còn hợp lệ với trường (vd Danh mục + ">").
    operator: resolveSearchFilterOperator(field, normalizeSearchFilterOperator(value.operator)),
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
    mode: "pivot",
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

  const pivotRaw =
    (version === 3 || version === 4 || version === 5 || version === 6) && isRecord(parsed.pivot)
      ? parsed.pivot
      : {}
  const searchRaw = version === 6 && isRecord(parsed.search) ? parsed.search : {}

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
