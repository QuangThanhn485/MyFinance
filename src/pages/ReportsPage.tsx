import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRef, type CSSProperties } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  MeasuringStrategy,
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type {
  NameType,
  Payload as TooltipPayload,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent"
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Columns2,
  Info,
  MoveRight,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Table,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import DateRangePicker, {
  type DateRangePreset,
  type DateRangeValue,
} from "@/components/DateRangePicker"
import DatePicker from "@/components/DatePicker"
import LabelValueRow from "@/components/LabelValueRow"
import MoneyInput from "@/components/MoneyInput"
import MonthPicker from "@/components/MonthPicker"
import SearchableSelect, { type SearchableSelectOption } from "@/components/SearchableSelect"
import {
  ChartEmptyState,
  ChartTooltipContent,
  chartGridProps,
  chartLegendProps,
} from "@/components/charts/ChartTooltip"
import { BUCKET_LABELS_VI, getExpenseCategoryLabel } from "@/domain/constants"
import { computeBudgets } from "@/domain/finance/finance"
import { computeAdvancedInsights, type ClusterTier } from "@/domain/finance/insights"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import { formatVnd } from "@/lib/currency"
import {
  addDaysIsoDate,
  dayOfMonthFromIsoDate,
  daysInMonth,
  formatIsoDate,
  monthFromIsoDate,
  parseIsoDateLocal,
  todayIso,
} from "@/lib/date"
import { getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import type { Expense, ISODate, YearMonth } from "@/domain/types"
import type { CttmState } from "@/storage/schema"
import {
  defaultReportsConfig,
  loadReportsConfig,
  resolveSearchFilterOperator,
  saveReportsConfig,
  SEARCH_FIELD_OPERATORS,
  type PivotChartType,
  type PivotGroupKey,
  type PivotMetric,
  type SearchFilterCondition,
  type SearchFilterConnector,
  type SearchFilterField,
  type SearchFilterOperator,
} from "@/storage/reports"

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
]

const PIVOT_SERIES_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--pivot-series-7))",
  "hsl(var(--pivot-series-8))",
  "hsl(var(--pivot-series-9))",
  "hsl(var(--pivot-series-10))",
  "hsl(var(--pivot-series-11))",
  "hsl(var(--pivot-series-12))",
  "hsl(var(--pivot-series-13))",
  "hsl(var(--pivot-series-14))",
  "hsl(var(--pivot-series-15))",
  "hsl(var(--pivot-series-16))",
]

function pivotSeriesColor(index: number) {
  if (index < PIVOT_SERIES_PALETTE.length) {
    return PIVOT_SERIES_PALETTE[index]
  }
  const hue = (index * 137.508 + 18) % 360
  const saturation = 76
  const lightness = 56
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`
}

const CLUSTER_TIER_LABELS: Record<ClusterTier, string> = {
  low: "Thấp",
  mid: "Trung bình",
  high: "Cao",
}

const PIVOT_METRIC_LABELS: Record<PivotMetric, string> = {
  sum: "Tổng chi",
  count: "Số giao dịch",
  avg: "Trung bình/giao dịch",
}

const PIVOT_CHART_LABELS: Record<PivotChartType, string> = {
  bar: "Cột (Bar)",
  line: "Đường (Line)",
  area: "Vùng (Area)",
}

const PIVOT_FIELDS: { id: PivotGroupKey; label: string }[] = [
  { id: "category", label: "Danh mục" },
  { id: "bucket", label: "Bucket" },
  { id: "weekday", label: "Thứ" },
  { id: "day", label: "Ngày" },
  { id: "week", label: "Tuần" },
  { id: "dailyCap", label: "Cap chi mỗi ngày" },
  { id: "amountRange", label: "Mức chi" },
  { id: "savingsImpact", label: "Ảnh hưởng S" },
  { id: "mssImpact", label: "Ảnh hưởng MSS" },
]
const SEARCH_LAYOUT_FIELDS: { id: PivotGroupKey; label: string }[] = [
  { id: "category", label: "Danh mục" },
  { id: "bucket", label: "Bucket" },
  { id: "note", label: "Ghi chú" },
  { id: "weekday", label: "Thứ" },
  { id: "day", label: "Ngày" },
  { id: "week", label: "Tuần" },
  { id: "month", label: "Tháng" },
  { id: "dailyCap", label: "Cap chi mỗi ngày" },
  { id: "amountRange", label: "Mức chi" },
  { id: "savingsImpact", label: "Ảnh hưởng S" },
  { id: "mssImpact", label: "Ảnh hưởng MSS" },
]
const SEARCH_FILTER_FIELDS: { id: SearchFilterField; label: string; hint: string }[] = [
  { id: "date", label: "Ngày", hint: "YYYY-MM-DD hoặc DD/MM/YYYY" },
  { id: "month", label: "Tháng", hint: "YYYY-MM hoặc MM/YYYY" },
  { id: "amountVnd", label: "Số tiền", hint: "VD: 100000" },
  { id: "category", label: "Danh mục", hint: "VD: Ăn uống" },
  { id: "bucket", label: "Bucket", hint: "Thiết yếu / Mong muốn" },
  { id: "note", label: "Ghi chú", hint: "Từ khóa trong ghi chú" },
  { id: "weekday", label: "Thứ", hint: "T2, T3, CN..." },
  { id: "week", label: "Tuần", hint: "VD: 1, 2, 3" },
]
const SEARCH_OPERATOR_LABELS: Record<SearchFilterOperator, string> = {
  eq: "Bằng",
  contains: "Chứa",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
}
const SEARCH_CONNECTOR_LABELS: Record<SearchFilterConnector, string> = {
  and: "AND",
  or: "OR",
}
const SEARCH_CONNECTOR_HINTS: Record<SearchFilterConnector, string> = {
  and: "Thu hẹp — phải khớp cả nhánh trên lẫn điều kiện dưới",
  or: "Mở rộng — chỉ cần khớp nhánh trên hoặc điều kiện dưới",
}
/** Màu đoạn dây nối trên timeline: AND thu hẹp (xanh), OR mở rộng (hổ phách). */
const SEARCH_CONNECTOR_RAIL: Record<SearchFilterConnector, string> = {
  and: "bg-sky-500",
  or: "bg-amber-500",
}
const SEARCH_CONNECTOR_CHIP: Record<SearchFilterConnector, string> = {
  and: "bg-sky-500 text-white",
  or: "bg-amber-500 text-white",
}

function SearchConnectorToggle({
  value,
  effective,
  onChange,
}: {
  value: SearchFilterConnector
  /** false khi toán tử này không được áp dụng (điều kiện rỗng, hoặc là điều kiện hiệu lực đầu tiên). */
  effective: boolean
  onChange: (next: SearchFilterConnector) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-sm">
      {(["and", "or"] as SearchFilterConnector[]).map((connector) => (
        <button
          key={connector}
          type="button"
          aria-pressed={value === connector}
          onClick={() => onChange(connector)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide transition",
            value === connector
              ? cn(SEARCH_CONNECTOR_CHIP[connector], !effective && "opacity-40")
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {SEARCH_CONNECTOR_LABELS[connector]}
        </button>
      ))}
    </div>
  )
}

type SearchValueLabelResolver = (
  field: SearchFilterField,
  value: string,
) => string | undefined

function describeSearchFilterValue(
  filter: SearchFilterCondition,
  resolveLabel?: SearchValueLabelResolver,
) {
  const raw = filter.value.trim()
  if (!raw) return ""
  // Trường chọn-từ-danh-sách lưu mã (vd "Food") -> diễn giải phải đọc ra nhãn ("Ăn uống").
  const label = resolveLabel?.(filter.field, raw)
  if (label) return label
  if (filter.field === "amountVnd") {
    const parsed = parseSearchNumber(raw)
    return parsed === null ? raw : formatVnd(parsed)
  }
  if (filter.field === "date" && isIsoDateValue(raw)) return formatDateLabel(raw)
  if (filter.field === "month" && isYearMonthValue(raw)) return formatMonthLabel(raw)
  return raw
}

function describeSearchCondition(
  filter: SearchFilterCondition,
  resolveLabel?: SearchValueLabelResolver,
) {
  const field = SEARCH_FILTER_FIELDS.find((item) => item.id === filter.field)?.label ?? filter.field
  const operator = SEARCH_OPERATOR_LABELS[filter.operator].toLowerCase()
  return `${field} ${operator} ${describeSearchFilterValue(filter, resolveLabel)}`.trim()
}

const PIVOT_ROW_HEADER_COL_WIDTH = 160
type PivotDragContainer = "available" | "row" | "column"
type PivotDragData = { field: PivotGroupKey; container: PivotDragContainer }
const PIVOT_WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
const WEEKDAY_FULL_LABELS = [
  "Chủ nhật",
  "Thứ hai",
  "Thứ ba",
  "Thứ tư",
  "Thứ năm",
  "Thứ sáu",
  "Thứ bảy",
]

// Phải khai báo SAU PIVOT_WEEKDAY_LABELS: const cấp module khởi tạo theo thứ tự (tránh lỗi TDZ).
const SEARCH_WEEKDAY_OPTIONS: SearchableSelectOption[] = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
  // Giá trị lưu phải đúng nhãn mà `getSearchFilterValue` sinh ra.
  value: PIVOT_WEEKDAY_LABELS[day],
  label: WEEKDAY_FULL_LABELS[day],
  hint: PIVOT_WEEKDAY_LABELS[day],
}))

const SEARCH_WEEK_OPTIONS: SearchableSelectOption[] = [1, 2, 3, 4, 5].map((week) => ({
  value: String(week),
  label: `Tuần ${week}`,
  hint: `ngày ${(week - 1) * 7 + 1}–${week === 5 ? 31 : week * 7}`,
}))

const SEARCH_BUCKET_OPTIONS: SearchableSelectOption[] = (["needs", "wants"] as const).map(
  (bucket) => ({
    value: bucket,
    label: BUCKET_LABELS_VI[bucket],
    hint: bucket,
  }),
)

const PIVOT_AMOUNT_RANGES = [
  { max: 50_000, label: "<= 50k" },
  { max: 200_000, label: "50k-200k" },
  { max: 500_000, label: "200k-500k" },
  { max: 1_000_000, label: "500k-1m" },
  { max: 2_000_000, label: "1m-2m" },
  { max: Number.POSITIVE_INFINITY, label: "> 2m" },
]
const PIVOT_SAVINGS_IMPACT_RANGES = [
  { maxPct: 0.01, label: "<= 1% S" },
  { maxPct: 0.03, label: "1-3% S" },
  { maxPct: 0.05, label: "3-5% S" },
  { maxPct: 0.1, label: "5-10% S" },
  { maxPct: Number.POSITIVE_INFINITY, label: "> 10% S" },
]
const PIVOT_MSS_IMPACT_RANGES = [
  { maxPct: 0.05, label: "<= 5% MSS" },
  { maxPct: 0.1, label: "5-10% MSS" },
  { maxPct: 0.2, label: "10-20% MSS" },
  { maxPct: Number.POSITIVE_INFINITY, label: "> 20% MSS" },
]
type PivotContext = {
  savingsTargetVnd: number
  mssVnd: number
  dailyCapVnd: number
  categoryLabel: (category: string) => string
}

const pivotCollisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  if (pointer.length > 0) return pointer
  const intersections = rectIntersection(args)
  if (intersections.length > 0) return intersections
  return closestCenter(args)
}

function formatMonthLabel(month: YearMonth) {
  const y = month.slice(0, 4)
  const m = month.slice(5, 7)
  return `${m}/${y}`
}

function formatDateLabel(date: ISODate) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

function formatDateRangeLabel(range: DateRangeValue) {
  if (range.start === range.end) return formatDateLabel(range.start)
  return `${formatDateLabel(range.start)} - ${formatDateLabel(range.end)}`
}

function monthStart(month: YearMonth): ISODate {
  return `${month}-01` as ISODate
}

function monthEnd(month: YearMonth): ISODate {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}` as ISODate
}

function currentMonthRange(today: ISODate): DateRangeValue {
  const month = monthFromIsoDate(today)
  return { start: monthStart(month), end: monthEnd(month) }
}

function previousMonthRange(today: ISODate): DateRangeValue {
  const current = parseIsoDateLocal(today)
  current.setDate(1)
  current.setMonth(current.getMonth() - 1)
  const prevMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}` as YearMonth
  return { start: monthStart(prevMonth), end: monthEnd(prevMonth) }
}

function currentYearRange(today: ISODate): DateRangeValue {
  const year = today.slice(0, 4)
  return {
    start: `${year}-01-01` as ISODate,
    end: today,
  }
}

function currentWeekRange(today: ISODate): DateRangeValue {
  const dt = parseIsoDateLocal(today)
  const day = dt.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(dt)
  monday.setDate(dt.getDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: formatIsoDate(monday),
    end: formatIsoDate(sunday),
  }
}

function createReportDateRangePresets(today: ISODate): DateRangePreset[] {
  return [
    {
      id: "last-7-days",
      label: "7 ngày gần đây",
      range: { start: addDaysIsoDate(today, -6), end: today },
    },
    {
      id: "this-week",
      label: "Tuần này",
      range: currentWeekRange(today),
    },
    {
      id: "last-30-days",
      label: "30 ngày gần đây",
      range: { start: addDaysIsoDate(today, -29), end: today },
    },
    {
      id: "this-month",
      label: "Tháng này",
      range: currentMonthRange(today),
    },
    {
      id: "previous-month",
      label: "Tháng trước",
      range: previousMonthRange(today),
    },
    {
      id: "this-year",
      label: "Năm này",
      range: currentYearRange(today),
    },
  ]
}

function getDateRangeDayCount(range: DateRangeValue) {
  const start = parseIsoDateLocal(range.start).getTime()
  const end = parseIsoDateLocal(range.end).getTime()
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.max(1, Math.round((end - start) / msPerDay) + 1)
}

function isoDateSortValue(date: ISODate) {
  return Number(date.replaceAll("-", ""))
}

function getMonthsInDateRange(range: DateRangeValue): YearMonth[] {
  const out: YearMonth[] = []
  const cursor = parseIsoDateLocal(monthStart(monthFromIsoDate(range.start)))
  const endMonth = monthFromIsoDate(range.end)

  while (true) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}` as YearMonth
    out.push(month)
    if (month === endMonth) break
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return out
}

function isWholeMonthInDateRange(month: YearMonth, range: DateRangeValue) {
  return monthStart(month) >= range.start && monthEnd(month) <= range.end
}

function isSingleWholeMonthRange(range: DateRangeValue) {
  const month = monthFromIsoDate(range.start)
  return (
    month === monthFromIsoDate(range.end) &&
    range.start === monthStart(month) &&
    range.end === monthEnd(month)
  )
}

function getExpensesInDateRange(state: CttmState, range: DateRangeValue): Expense[] {
  const out: Expense[] = []
  for (const id of state.entities.expenses.allIds) {
    const expense = state.entities.expenses.byId[id]
    if (!expense) continue
    if (expense.date < range.start || expense.date > range.end) continue
    out.push(expense)
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

function parseSearchNumber(value: string) {
  const normalized = value.replace(/[^\d-]/g, "")
  // Không có chữ số nào -> KHÔNG phải số. Trước đây Number("") = 0 khiến truy vấn chữ
  // bị so sánh như số 0 (vd `Số tiền > abc` khớp mọi giao dịch dương).
  if (!/\d/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSearchQueryForField(field: SearchFilterField, value: string) {
  const trimmed = value.trim()
  if (field === "date") {
    const dateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (dateMatch) {
      return `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`
    }
  }
  if (field === "month") {
    const monthMatch = trimmed.match(/^(\d{1,2})\/(\d{4})$/)
    if (monthMatch) return `${monthMatch[2]}-${monthMatch[1].padStart(2, "0")}`
  }
  return trimmed
}

function isIsoDateValue(value: string): value is ISODate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isYearMonthValue(value: string): value is YearMonth {
  return /^\d{4}-\d{2}$/.test(value)
}

function createSearchFilterCondition(): SearchFilterCondition {
  return {
    id: `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    connector: "and",
    field: "note",
    operator: "contains",
    value: "",
  }
}

/**
 * `eqCandidates`: các dạng viết được coi là "bằng" với giá trị của giao dịch.
 * Cần thiết cho các trường chọn-từ-danh-sách: `text` của chúng là chuỗi ghép (vd "Ăn uống Food")
 * nên nếu so sánh nguyên chuỗi thì toán tử "Bằng" không bao giờ khớp.
 */
function getSearchFilterValue(
  expense: Expense,
  field: SearchFilterField,
  categoryLabel: (category: string) => string,
): { text: string; number: number | null; eqCandidates?: string[] } {
  switch (field) {
    case "date":
      return { text: expense.date, number: isoDateSortValue(expense.date) }
    case "month": {
      const month = monthFromIsoDate(expense.date)
      return { text: month, number: Number(month.replace("-", "")) }
    }
    case "amountVnd":
      return {
        text: String(expense.amountVnd),
        number: expense.amountVnd,
      }
    case "category": {
      const label = categoryLabel(expense.category)
      return {
        text: `${label} ${expense.category}`,
        number: null,
        eqCandidates: [expense.category, label],
      }
    }
    case "bucket": {
      const label = BUCKET_LABELS_VI[expense.bucket]
      return {
        text: `${label} ${expense.bucket}`,
        number: null,
        eqCandidates: [expense.bucket, label],
      }
    }
    case "weekday": {
      const day = parseIsoDateLocal(expense.date).getDay()
      const label = PIVOT_WEEKDAY_LABELS[day] ?? ""
      // Nhãn "T2" (thứ hai) ứng với getDay() = 1 -> KHÔNG được suy số từ nhãn.
      return {
        text: `${label} ${day}`,
        number: day === 0 ? 7 : day,
        eqCandidates: [label],
      }
    }
    case "week": {
      const week = Math.ceil(dayOfMonthFromIsoDate(expense.date) / 7)
      return {
        text: `Tuần ${week} ${week}`,
        number: week,
        eqCandidates: [String(week), `Tuần ${week}`],
      }
    }
    case "note":
    default:
      return { text: expense.note ?? "", number: null }
  }
}

function searchConditionMatches(
  expense: Expense,
  condition: SearchFilterCondition,
  categoryLabel: (category: string) => string,
) {
  const query = normalizeSearchQueryForField(condition.field, condition.value)
  if (!query) return true

  const fieldValue = getSearchFilterValue(expense, condition.field, categoryLabel)
  const leftText = normalizeSearchText(fieldValue.text)
  const rightText = normalizeSearchText(query)
  const leftNumber = fieldValue.number
  const rightNumber = parseSearchNumber(query)

  if (condition.operator === "contains") {
    return leftText.includes(rightText)
  }

  if (condition.operator === "eq") {
    if (fieldValue.eqCandidates) {
      return fieldValue.eqCandidates.some(
        (candidate) => normalizeSearchText(candidate) === rightText,
      )
    }
    if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber
    return leftText === rightText
  }

  if (
    condition.operator === "gt" ||
    condition.operator === "gte" ||
    condition.operator === "lt" ||
    condition.operator === "lte"
  ) {
    if (leftNumber !== null && rightNumber !== null) {
      if (condition.operator === "gt") return leftNumber > rightNumber
      if (condition.operator === "gte") return leftNumber >= rightNumber
      if (condition.operator === "lt") return leftNumber < rightNumber
      return leftNumber <= rightNumber
    }
    const compared = leftText.localeCompare(rightText)
    if (condition.operator === "gt") return compared > 0
    if (condition.operator === "gte") return compared >= 0
    if (condition.operator === "lt") return compared < 0
    return compared <= 0
  }

  return true
}

function searchFiltersMatch(
  expense: Expense,
  filters: SearchFilterCondition[],
  categoryLabel: (category: string) => string,
) {
  const active = filters.filter((filter) => filter.value.trim())
  if (active.length === 0) return true

  return active.reduce((result, filter, index) => {
    const matched = searchConditionMatches(expense, filter, categoryLabel)
    if (index === 0) return matched
    return filter.connector === "or" ? result || matched : result && matched
  }, true)
}

function getDateRangeTotals(state: CttmState, range: DateRangeValue) {
  let variableNeeds = 0
  let variableWants = 0
  let variableTotal = 0

  for (const expense of getExpensesInDateRange(state, range)) {
    variableTotal += expense.amountVnd
    if (expense.bucket === "needs") variableNeeds += expense.amountVnd
    else variableWants += expense.amountVnd
  }

  let fixedCostsTotal = 0
  for (const id of state.entities.fixedCosts.allIds) {
    const fixedCost = state.entities.fixedCosts.byId[id]
    if (!fixedCost || !fixedCost.active) continue
    if (!isWholeMonthInDateRange(fixedCost.month, range)) continue
    fixedCostsTotal += fixedCost.amountVnd
  }

  for (const month of getMonthsInDateRange(range)) {
    if (!isWholeMonthInDateRange(month, range)) continue
    const settingsForMonth = getEffectiveSettingsForMonth(state, month)
    fixedCostsTotal += Math.max(0, Math.trunc(settingsForMonth.debtPaymentMonthlyVnd ?? 0))
  }

  return {
    fixedCostsTotal,
    variableTotal,
    variableNeeds,
    variableWants,
    totalSpent: fixedCostsTotal + variableTotal,
  }
}

function shortenLabel(label: string, max = 14) {
  const t = label.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

type PivotField = { id: PivotGroupKey; label: string }

function PivotDraggableField({
  field,
  active,
}: {
  field: PivotField
  active?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `available:${field.id}`,
    data: { field: field.id, container: "available" } as PivotDragData,
  })
  const style = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={cn(
        "touch-none select-none cursor-grab rounded-full border bg-background px-3 py-1 text-xs font-medium shadow-sm transition active:cursor-grabbing",
        active && "border-primary/50 bg-primary/10 text-foreground",
        isDragging && "opacity-60",
      )}
      {...listeners}
      {...attributes}
    >
      {field.label}
    </button>
  )
}

function PivotDropZone({
  id,
  title,
  children,
  hint,
  className,
}: {
  id: string
  title: string
  children: ReactNode
  hint?: string
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[108px] rounded-lg border-2 border-dashed bg-muted/20 p-3 transition-colors",
        isOver && "border-primary bg-primary/10 ring-2 ring-primary/20",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function PivotFieldPill({
  field,
  container,
  onRemove,
  index,
}: {
  field: PivotGroupKey
  container: PivotDragContainer
  onRemove?: (field: PivotGroupKey) => void
  index?: number
}) {
  const label = PIVOT_FIELDS.find((f) => f.id === field)?.label ?? field
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `${container}:${field}`,
      data: { field, container } as PivotDragData,
    })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "touch-none select-none inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium shadow-sm cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60",
      )}
      {...attributes}
      {...listeners}
    >
      {typeof index === "number" ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular-nums">
          {index + 1}
        </span>
      ) : null}
      <span>{label}</span>
      {onRemove ? (
        <button
          type="button"
          className="rounded-full p-0.5 text-muted-foreground transition hover:text-foreground"
          aria-label={`Bỏ ${label}`}
          onClick={() => onRemove(field)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

type PivotCell = { sum: number; count: number }
type PivotGroupValue = {
  key: string
  label: string
  parts: string[]
  sortValue: number | string
  sortValues?: (number | string)[]
}
type PivotTable = {
  rows: PivotGroupValue[]
  cols: PivotGroupValue[]
  cells: Record<string, Record<string, PivotCell>>
  rowTotals: Record<string, PivotCell>
  colTotals: Record<string, PivotCell>
  grandTotal: PivotCell
}
type ChartInteractionState = {
  activeCoordinate?: { x?: number; y?: number }
  activeLabel?: string
  activePayload?: TooltipPayload<ValueType, NameType>[]
}
type ControlledTooltipState = {
  active: boolean
  coordinate?: { x?: number; y?: number }
  label?: string
  payload?: TooltipPayload<ValueType, NameType>[]
}

function getPivotGroupValue(
  group: PivotGroupKey,
  expense: Expense,
  context: PivotContext,
): PivotGroupValue {
  switch (group) {
    case "bucket": {
      const label = BUCKET_LABELS_VI[expense.bucket]
      return {
        key: expense.bucket,
        label,
        parts: [label],
        sortValue: expense.bucket === "needs" ? 0 : 1,
      }
    }
    case "note": {
      const note = expense.note.trim()
      const label = note || "(Không ghi chú)"
      return {
        key: `note:${note || "__empty"}`,
        label,
        parts: [label],
        sortValue: note ? label : "zzzz",
      }
    }
    case "month": {
      const month = monthFromIsoDate(expense.date)
      return {
        key: month,
        label: formatMonthLabel(month),
        parts: [formatMonthLabel(month)],
        // Sắp theo số (202601 < 202612), không theo chữ ("01/2026" < "12/2025" là sai).
        sortValue: Number(month.replace("-", "")),
      }
    }
    case "day": {
      const label = formatDateLabel(expense.date)
      return {
        key: expense.date,
        label,
        parts: [label],
        sortValue: isoDateSortValue(expense.date),
      }
    }
    case "week": {
      const day = dayOfMonthFromIsoDate(expense.date)
      const week = Math.ceil(day / 7)
      const label = `Tuần ${week}`
      return {
        key: `week-${week}`,
        label,
        parts: [label],
        sortValue: week,
      }
    }
    case "weekday": {
      const day = parseIsoDateLocal(expense.date).getDay()
      const label = PIVOT_WEEKDAY_LABELS[day] ?? "?"
      const sortValue = day === 0 ? 7 : day
      return {
        key: `weekday-${day}`,
        label,
        parts: [label],
        sortValue,
      }
    }
    case "amountRange": {
      return getAmountRangeGroup(expense.amountVnd)
    }
    case "dailyCap": {
      const label = "Cap/ngày (động)"
      return {
        key: "daily-cap-dynamic",
        label,
        parts: [label],
        sortValue: 0,
      }
    }
    case "savingsImpact": {
      return getPercentImpactGroup({
        amountVnd: expense.amountVnd,
        baseVnd: context.savingsTargetVnd,
        ranges: PIVOT_SAVINGS_IMPACT_RANGES,
        keyPrefix: "s-impact",
        emptyLabel: "S = 0",
      })
    }
    case "mssImpact": {
      return getPercentImpactGroup({
        amountVnd: expense.amountVnd,
        baseVnd: context.mssVnd,
        ranges: PIVOT_MSS_IMPACT_RANGES,
        keyPrefix: "mss-impact",
        emptyLabel: "MSS = 0",
      })
    }
    case "category":
    default: {
      const label = context.categoryLabel(expense.category)
      return {
        key: expense.category,
        label,
        parts: [label],
        sortValue: label,
      }
    }
  }
}

function pivotMetricValue(cell: PivotCell | undefined, metric: PivotMetric) {
  if (!cell) return 0
  if (metric === "count") return cell.count
  if (metric === "avg") return cell.count > 0 ? cell.sum / cell.count : 0
  return cell.sum
}

function formatPivotValue(value: number, metric: PivotMetric) {
  if (metric === "count") {
    return new Intl.NumberFormat("vi-VN").format(Math.round(value))
  }
  return formatVnd(Math.round(value))
}

function formatCompactVndTick(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? "")
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)} tỷ`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}tr`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`
  return new Intl.NumberFormat("vi-VN").format(Math.round(n))
}

function formatShortDateAxisLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value.slice(8, 10)}/${value.slice(5, 7)}`
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return value.slice(0, 5)
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(6, 8)}/${value.slice(4, 6)}`
  }
  return value
}

function formatImpactRangeVndHint(input: {
  label: string
  baseVnd: number
  ranges: { maxPct: number; label: string }[]
}) {
  const base = Math.max(0, input.baseVnd)
  if (base <= 0) return null

  const idx = input.ranges.findIndex((r) => r.label === input.label)
  if (idx < 0) return null

  const minPct = idx === 0 ? 0 : input.ranges[idx - 1]?.maxPct ?? 0
  const maxPct = input.ranges[idx]?.maxPct ?? 0

  const minVnd = Math.round(minPct * base)
  if (maxPct === Number.POSITIVE_INFINITY) {
    return `≈ > ${formatVnd(minVnd)}`
  }

  const maxVnd = Math.round(maxPct * base)
  if (idx === 0) return `≈ ≤ ${formatVnd(maxVnd)}`
  return `≈ ${formatVnd(minVnd)} – ${formatVnd(maxVnd)}`
}

function pivotMoneyHeatmapStyle(
  value: number,
  thresholds: number[],
): CSSProperties | undefined {
  if (!(value > 0)) return undefined
  const palette = [
    { bg: "hsl(var(--pivot-heat-1-bg))", accent: "hsl(var(--pivot-heat-1-accent))" },
    { bg: "hsl(var(--pivot-heat-2-bg))", accent: "hsl(var(--pivot-heat-2-accent))" },
    { bg: "hsl(var(--pivot-heat-3-bg))", accent: "hsl(var(--pivot-heat-3-accent))" },
    { bg: "hsl(var(--pivot-heat-4-bg))", accent: "hsl(var(--pivot-heat-4-accent))" },
    { bg: "hsl(var(--pivot-heat-5-bg))", accent: "hsl(var(--pivot-heat-5-accent))" },
  ]

  const bucketIndex = thresholds.reduce((acc, t) => (value > t ? acc + 1 : acc), 0)
  const ratio = thresholds.length > 0 ? bucketIndex / thresholds.length : 0
  const paletteIndex = Math.min(
    palette.length - 1,
    Math.max(0, Math.round(ratio * (palette.length - 1))),
  )
  const colors = palette[paletteIndex]

  return {
    backgroundColor: colors.bg,
    boxShadow: `inset 3px 0 0 ${colors.accent}`,
  }
}

function comparePivotSortValue(a: number | string, b: number | string) {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

function comparePivotSortValues(
  a: (number | string)[],
  b: (number | string)[],
) {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const diff = comparePivotSortValue(a[i] ?? "", b[i] ?? "")
    if (diff !== 0) return diff
  }
  return 0
}

function getAmountRangeGroup(amount: number): PivotGroupValue {
  const safeAmount = Math.max(0, amount)
  const idx = PIVOT_AMOUNT_RANGES.findIndex((r) => safeAmount <= r.max)
  const safeIndex = idx < 0 ? PIVOT_AMOUNT_RANGES.length - 1 : idx
  const range = PIVOT_AMOUNT_RANGES[safeIndex]
  return {
    key: `amount-${safeIndex}`,
    label: range.label,
    parts: [range.label],
    sortValue: safeIndex,
  }
}

function getPercentImpactGroup(input: {
  amountVnd: number
  baseVnd: number
  ranges: { maxPct: number; label: string }[]
  keyPrefix: string
  emptyLabel: string
}): PivotGroupValue {
  const safeBase = Math.max(0, input.baseVnd)
  if (safeBase <= 0) {
    return {
      key: `${input.keyPrefix}-na`,
      label: input.emptyLabel,
      parts: [input.emptyLabel],
      sortValue: Number.POSITIVE_INFINITY,
    }
  }
  const pct = Math.max(0, input.amountVnd) / safeBase
  const idx = input.ranges.findIndex((r) => pct <= r.maxPct)
  const safeIndex = idx < 0 ? input.ranges.length - 1 : idx
  const range = input.ranges[safeIndex]
  return {
    key: `${input.keyPrefix}-${safeIndex}`,
    label: range.label,
    parts: [range.label],
    sortValue: safeIndex,
  }
}

function buildPivotTable(
  expenses: Expense[],
  rowFields: PivotGroupKey[],
  columnFields: PivotGroupKey[],
  metric: PivotMetric,
  context: PivotContext,
): PivotTable {
  const rows = new Map<string, PivotGroupValue>()
  const cols = new Map<string, PivotGroupValue>()
  const cells: Record<string, Record<string, PivotCell>> = {}
  const rowTotals: Record<string, PivotCell> = {}
  const colTotals: Record<string, PivotCell> = {}
  const grandTotal: PivotCell = { sum: 0, count: 0 }

  const rowKeys = rowFields
  const columnKeys = columnFields ?? []
  const hasAmountRange =
    rowFields.includes("amountRange") || columnFields.includes("amountRange")
  const baseRowFields = rowFields.filter((f) => f !== "amountRange")
  const baseColumnFields = columnFields.filter((f) => f !== "amountRange")
  const amountRangeOnly =
    hasAmountRange && baseRowFields.length === 0 && baseColumnFields.length === 0

  const createTotalPart = (): PivotGroupValue => ({
    key: "total",
    label: "Tổng",
    parts: ["Tổng"],
    sortValue: 0,
  })

  if (!hasAmountRange || amountRangeOnly) {
    for (const ex of expenses) {
      const rowParts = rowKeys.length
        ? rowKeys.map((field) => getPivotGroupValue(field, ex, context))
        : [createTotalPart()]
      const rowKey = rowParts.map((p) => p.key).join("||")
      const rowLabelParts = rowParts.map((p) => p.label)
      const rowSortValues = rowParts.map((p) => p.sortValue)
      const row = {
        key: rowKey,
        label: rowLabelParts.join(" · "),
        parts: rowLabelParts,
        sortValue: rowSortValues[0] ?? rowLabelParts[0] ?? "",
        sortValues: rowSortValues,
      }
      rows.set(row.key, row)

      const colParts = columnKeys.length
        ? columnKeys.map((field) => getPivotGroupValue(field, ex, context))
        : []
      const colKey = colParts.length
        ? colParts.map((p) => p.key).join("||")
        : "total"
      const colLabelParts = colParts.length
        ? colParts.map((p) => p.label)
        : ["Tổng"]
      const colSortValues = colParts.map((p) => p.sortValue)
      const col = {
        key: colKey,
        label: colLabelParts.join(" · "),
        parts: colLabelParts,
        sortValue: colSortValues[0] ?? 0,
        sortValues: colSortValues,
      }
      cols.set(col.key, col)

      if (!cells[row.key]) cells[row.key] = {}
      if (!cells[row.key][col.key]) cells[row.key][col.key] = { sum: 0, count: 0 }

      cells[row.key][col.key].sum += ex.amountVnd
      cells[row.key][col.key].count += 1

      if (!rowTotals[row.key]) rowTotals[row.key] = { sum: 0, count: 0 }
      rowTotals[row.key].sum += ex.amountVnd
      rowTotals[row.key].count += 1

      if (!colTotals[col.key]) colTotals[col.key] = { sum: 0, count: 0 }
      colTotals[col.key].sum += ex.amountVnd
      colTotals[col.key].count += 1

      grandTotal.sum += ex.amountVnd
      grandTotal.count += 1
    }
  } else {
    const baseRowPartsMap = new Map<string, PivotGroupValue[]>()
    const baseColPartsMap = new Map<string, PivotGroupValue[]>()
    const baseCells: Record<string, Record<string, PivotCell>> = {}

    for (const ex of expenses) {
      const rowParts = baseRowFields.length
        ? baseRowFields.map((field) => getPivotGroupValue(field, ex, context))
        : [createTotalPart()]
      const colParts = baseColumnFields.length
        ? baseColumnFields.map((field) => getPivotGroupValue(field, ex, context))
        : [createTotalPart()]
      const rowKey = rowParts.map((p) => p.key).join("||")
      const colKey = colParts.map((p) => p.key).join("||")
      baseRowPartsMap.set(rowKey, rowParts)
      baseColPartsMap.set(colKey, colParts)

      if (!baseCells[rowKey]) baseCells[rowKey] = {}
      if (!baseCells[rowKey][colKey]) baseCells[rowKey][colKey] = { sum: 0, count: 0 }
      baseCells[rowKey][colKey].sum += ex.amountVnd
      baseCells[rowKey][colKey].count += 1
    }

    const resolvePart = (
      field: PivotGroupKey,
      baseFields: PivotGroupKey[],
      baseParts: PivotGroupValue[],
      rangePart: PivotGroupValue,
    ) => {
      if (field === "amountRange") return rangePart
      const idx = baseFields.indexOf(field)
      if (idx < 0) return createTotalPart()
      return baseParts[idx]
    }

    for (const [baseRowKey, colMap] of Object.entries(baseCells)) {
      for (const [baseColKey, cell] of Object.entries(colMap)) {
        const rangePart = getAmountRangeGroup(cell.sum)
        const baseRowParts = baseRowPartsMap.get(baseRowKey) ?? [createTotalPart()]
        const baseColParts = baseColPartsMap.get(baseColKey) ?? [createTotalPart()]
        const rowParts = rowKeys.length
          ? rowKeys.map((field) =>
              resolvePart(field, baseRowFields, baseRowParts, rangePart),
            )
          : [createTotalPart()]
        const colParts = columnKeys.length
          ? columnKeys.map((field) =>
              resolvePart(field, baseColumnFields, baseColParts, rangePart),
            )
          : []
        const rowKey = rowParts.map((p) => p.key).join("||")
        const colKey = colParts.length ? colParts.map((p) => p.key).join("||") : "total"
        const rowLabelParts = rowParts.map((p) => p.label)
        const rowSortValues = rowParts.map((p) => p.sortValue)
        const colLabelParts = colParts.length ? colParts.map((p) => p.label) : ["Tổng"]
        const colSortValues = colParts.map((p) => p.sortValue)
        rows.set(rowKey, {
          key: rowKey,
          label: rowLabelParts.join(" · "),
          parts: rowLabelParts,
          sortValue: rowSortValues[0] ?? rowLabelParts[0] ?? "",
          sortValues: rowSortValues,
        })
        cols.set(colKey, {
          key: colKey,
          label: colLabelParts.join(" · "),
          parts: colLabelParts,
          sortValue: colSortValues[0] ?? 0,
          sortValues: colSortValues,
        })

        if (!cells[rowKey]) cells[rowKey] = {}
        if (!cells[rowKey][colKey]) cells[rowKey][colKey] = { sum: 0, count: 0 }
        cells[rowKey][colKey].sum += cell.sum
        cells[rowKey][colKey].count += cell.count

        if (!rowTotals[rowKey]) rowTotals[rowKey] = { sum: 0, count: 0 }
        rowTotals[rowKey].sum += cell.sum
        rowTotals[rowKey].count += cell.count

        if (!colTotals[colKey]) colTotals[colKey] = { sum: 0, count: 0 }
        colTotals[colKey].sum += cell.sum
        colTotals[colKey].count += cell.count

        grandTotal.sum += cell.sum
        grandTotal.count += cell.count
      }
    }
  }

  const rowList = Array.from(rows.values())
  const colList = Array.from(cols.values())

  const sortByMetricDesc = (a: PivotGroupValue, b: PivotGroupValue) => {
    const diff =
      pivotMetricValue(rowTotals[b.key], metric) -
      pivotMetricValue(rowTotals[a.key], metric)
    if (diff !== 0) return diff
    return String(a.label).localeCompare(String(b.label))
  }

  const rowPrimary = rowKeys[0]
  if (rowKeys.length > 1) {
    rowList.sort((a, b) =>
      comparePivotSortValues(a.sortValues ?? [a.sortValue], b.sortValues ?? [b.sortValue]),
    )
  } else if (
    rowPrimary === "month" ||
    rowPrimary === "day" ||
    rowPrimary === "week" ||
    rowPrimary === "weekday" ||
    rowPrimary === "dailyCap" ||
    rowPrimary === "amountRange" ||
    rowPrimary === "savingsImpact" ||
    rowPrimary === "mssImpact"
  ) {
    rowList.sort((a, b) => Number(a.sortValue) - Number(b.sortValue))
  } else {
    rowList.sort(sortByMetricDesc)
  }

  const colPrimary = columnKeys[0]
  if (columnKeys.length > 1) {
    colList.sort((a, b) =>
      comparePivotSortValues(a.sortValues ?? [a.sortValue], b.sortValues ?? [b.sortValue]),
    )
  } else if (!colPrimary) {
    colList.sort((a, b) => Number(a.sortValue) - Number(b.sortValue))
  } else if (
    colPrimary === "month" ||
    colPrimary === "day" ||
    colPrimary === "week" ||
    colPrimary === "weekday" ||
    colPrimary === "dailyCap" ||
    colPrimary === "amountRange" ||
    colPrimary === "savingsImpact" ||
    colPrimary === "mssImpact"
  ) {
    colList.sort((a, b) => Number(a.sortValue) - Number(b.sortValue))
  } else {
    colList.sort((a, b) => {
      const diff =
        pivotMetricValue(colTotals[b.key], metric) -
        pivotMetricValue(colTotals[a.key], metric)
      if (diff !== 0) return diff
      return String(a.label).localeCompare(String(b.label))
    })
  }

  return { rows: rowList, cols: colList, cells, rowTotals, colTotals, grandTotal }
}

export default function ReportsPage() {
  const data = useAppStore((s) => s.data)
  const categoryOptions = useMemo(() => data.expenseCategories, [data.expenseCategories])
  const categoryLabels = useMemo(
    () =>
      Object.fromEntries(
        categoryOptions.map((category) => [category.id, category.label]),
      ) as Record<string, string>,
    [categoryOptions],
  )
  const categoryLabel = (category: string) =>
    categoryLabels[category] ?? getExpenseCategoryLabel(category, categoryOptions)
  const today = todayIso()
  const dateRangePresets = useMemo(() => createReportDateRangePresets(today), [today])
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentMonthRange(today))
  const month = monthFromIsoDate(dateRange.end)
  const monthsInRange = useMemo(() => getMonthsInDateRange(dateRange), [dateRange])
  const isSingleFullMonth = isSingleWholeMonthRange(dateRange)
  const [config, setConfig] = useState(() => loadReportsConfig())
  const [searchResultExpenseIds, setSearchResultExpenseIds] = useState<string[] | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [hiddenLegendKeys, setHiddenLegendKeys] = useState<Set<string>>(() => new Set())
  const [pivotSplitView, setPivotSplitView] = useState<"both" | "table" | "chart">("both")
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(max-width: 639px)").matches
  })
  const [pivotTooltip, setPivotTooltip] = useState<ControlledTooltipState>({
    active: false,
  })
  const lastPivotChartTapRef = useRef<{ label?: string; time: number } | null>(null)
  const pivotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )
  const [activePivotField, setActivePivotField] = useState<PivotGroupKey | null>(
    null,
  )
  const lastPivotOverRef = useRef<{ id: string; data?: PivotDragData } | null>(null)

  useEffect(() => {
    saveReportsConfig(config)
  }, [config])

  useEffect(() => {
    if (typeof window === "undefined") return
    const query = window.matchMedia("(max-width: 639px)")
    const syncViewport = () => setIsNarrowViewport(query.matches)
    syncViewport()
    query.addEventListener("change", syncViewport)
    return () => query.removeEventListener("change", syncViewport)
  }, [])

  useEffect(() => {
    if (!isNarrowViewport) {
      setPivotTooltip({ active: false })
      lastPivotChartTapRef.current = null
    }
  }, [isNarrowViewport])

  const allVariableExpenses = useMemo(
    () =>
      data.entities.expenses.allIds
        .map((id) => data.entities.expenses.byId[id])
        .filter((expense): expense is NonNullable<typeof expense> => !!expense),
    [data.entities.expenses.allIds, data.entities.expenses.byId],
  )
  const totals = useMemo(() => getDateRangeTotals(data, dateRange), [data, dateRange])
  const expenses = useMemo(() => getExpensesInDateRange(data, dateRange), [data, dateRange])
  const referenceMonthTotals = useMemo(() => getMonthTotals(data, month), [data, month])

  const settingsForMonth = useMemo(
    () => getEffectiveSettingsForMonth(data, month),
    [data, month],
  )
  const adjustment = useMemo(
    () => getEffectiveBudgetAdjustmentForMonth(data, month),
    [data, month],
  )
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
    fixedCostsVnd: referenceMonthTotals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })
  const savingsMin = budgets.savingsTargetVnd
  const saved = isSingleFullMonth ? budgets.incomeVnd - totals.totalSpent : 0
  const savingsRate =
    isSingleFullMonth && budgets.incomeVnd > 0 ? saved / budgets.incomeVnd : 0

  const baseDailyCapByMonth = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of monthsInRange) {
      const settings = getEffectiveSettingsForMonth(data, m)
      const monthTotals = getMonthTotals(data, m)
      const monthAdjustment = getEffectiveBudgetAdjustmentForMonth(data, m)
      const monthBudgets = computeBudgets({
        incomeVnd: getMonthlyIncomeTotalVnd(settings),
        fixedCostsVnd: monthTotals.fixedCostsTotal,
        essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
        rule: settings.budgetRule,
        adjustment: monthAdjustment,
        customSavingsGoalVnd: settings.customSavingsGoalVnd,
      })
      const monthlyVariableBudgetVnd = Math.max(
        0,
        monthBudgets.essentialVariableBaselineVnd + monthBudgets.wantsBudgetVnd,
      )
      out[m] = Math.floor(monthlyVariableBudgetVnd / Math.max(1, daysInMonth(m)))
    }
    return out
  }, [data, monthsInRange])

  const baseDailyCapVnd = baseDailyCapByMonth[month] ?? 0

  const dailyCapByDateMap = useMemo(() => {
    const map: Record<string, number> = {}

    for (const m of monthsInRange) {
      const dim = Math.max(1, daysInMonth(m))
      const settings = getEffectiveSettingsForMonth(data, m)
      const monthTotals = getMonthTotals(data, m)
      const monthAdjustment = getEffectiveBudgetAdjustmentForMonth(data, m)
      const monthBudgets = computeBudgets({
        incomeVnd: getMonthlyIncomeTotalVnd(settings),
        fixedCostsVnd: monthTotals.fixedCostsTotal,
        essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
        rule: settings.budgetRule,
        adjustment: monthAdjustment,
        customSavingsGoalVnd: settings.customSavingsGoalVnd,
      })
      const monthlyVariableBudgetVnd = Math.max(
        0,
        monthBudgets.essentialVariableBaselineVnd + monthBudgets.wantsBudgetVnd,
      )
      const spentByDay = Array.from({ length: dim + 1 }, () => 0)

      for (const expense of allVariableExpenses) {
        if (monthFromIsoDate(expense.date) !== m) continue
        const day = dayOfMonthFromIsoDate(expense.date)
        if (day < 1 || day > dim) continue
        spentByDay[day] += expense.amountVnd
      }

      let spentBeforeDay = 0
      for (let day = 1; day <= dim; day += 1) {
        const remainingBudgetVnd = Math.max(0, monthlyVariableBudgetVnd - spentBeforeDay)
        const remainingDays = Math.max(1, dim - day + 1)
        const date = `${m}-${String(day).padStart(2, "0")}`
        map[date] = Math.floor(remainingBudgetVnd / remainingDays)
        spentBeforeDay += spentByDay[day]
      }
    }

    return map
  }, [allVariableExpenses, data, monthsInRange])

  const advancedInsights = useMemo(
    () => computeAdvancedInsights({ expenses, historyExpenses: allVariableExpenses, month, today }),
    [expenses, allVariableExpenses, month, today],
  )
  const trendMax = Math.max(
    advancedInsights.trend?.recentAvg ?? 0,
    advancedInsights.trend?.previousAvg ?? 0,
    1,
  )
  const recentTrendPct = advancedInsights.trend
    ? Math.round((advancedInsights.trend.recentAvg / trendMax) * 100)
    : 0
  const previousTrendPct = advancedInsights.trend
    ? Math.round((advancedInsights.trend.previousAvg / trendMax) * 100)
    : 0

  const pivotTable = useMemo(
    () =>
      buildPivotTable(
        expenses,
        config.pivot.rowFields,
        config.pivot.columnFields,
        config.pivot.metric,
        {
          savingsTargetVnd: budgets.savingsTargetVnd,
          mssVnd: budgets.mssVnd,
          dailyCapVnd: baseDailyCapVnd,
          categoryLabel,
        },
      ),
    [
      expenses,
      config.pivot.rowFields,
      config.pivot.columnFields,
      config.pivot.metric,
      budgets.savingsTargetVnd,
      budgets.mssVnd,
      baseDailyCapVnd,
      categoryLabels,
      categoryOptions,
    ],
  )
  const activeSearchFilters = useMemo(
    () => config.search.filters.filter((filter) => filter.value.trim()),
    [config.search.filters],
  )
  const activeSearchFilterCount = activeSearchFilters.length
  /** Trường nào có tập giá trị hữu hạn thì nhập bằng combobox có tìm kiếm, không gõ tay. */
  const searchValueOptions = useMemo<
    Partial<Record<SearchFilterField, SearchableSelectOption[]>>
  >(
    () => ({
      category: categoryOptions.map((category) => ({
        value: category.id,
        label: category.label,
        hint: category.id,
      })),
      bucket: SEARCH_BUCKET_OPTIONS,
      weekday: SEARCH_WEEKDAY_OPTIONS,
      week: SEARCH_WEEK_OPTIONS,
    }),
    [categoryOptions],
  )
  const resolveSearchValueLabel = (field: SearchFilterField, value: string) =>
    searchValueOptions[field]?.find((option) => option.value === value)?.label
  /**
   * `searchFiltersMatch` chỉ gộp các điều kiện CÓ giá trị, theo thứ tự trái->phải.
   * Nên toán tử AND/OR của điều kiện hiệu lực ĐẦU TIÊN không bao giờ được dùng.
   */
  const firstActiveSearchFilterId = activeSearchFilters[0]?.id ?? null
  /** Số giao dịch còn khớp sau từng bước của chuỗi -> timeline nhìn ra được phễu lọc. */
  const searchStepCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (activeSearchFilters.length === 0) return counts

    const running = new Array<boolean>(allVariableExpenses.length).fill(false)
    activeSearchFilters.forEach((filter, index) => {
      let matchedCount = 0
      allVariableExpenses.forEach((expense, i) => {
        const matched = searchConditionMatches(expense, filter, categoryLabel)
        const next =
          index === 0
            ? matched
            : filter.connector === "or"
              ? running[i] || matched
              : running[i] && matched
        running[i] = next
        if (next) matchedCount += 1
      })
      counts[filter.id] = matchedCount
    })
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSearchFilters, allVariableExpenses, categoryLabels, categoryOptions])
  const searchHasMixedConnectors = useMemo(() => {
    if (activeSearchFilters.length < 3) return false
    const used = new Set(activeSearchFilters.slice(1).map((filter) => filter.connector))
    return used.size > 1
  }, [activeSearchFilters])
  const searchResultExpenseIdSet = useMemo(
    () => (searchResultExpenseIds ? new Set(searchResultExpenseIds) : null),
    [searchResultExpenseIds],
  )
  const searchFilteredExpenses = useMemo(
    () =>
      searchResultExpenseIdSet
        ? allVariableExpenses.filter((expense) => searchResultExpenseIdSet.has(expense.id))
        : [],
    [allVariableExpenses, searchResultExpenseIdSet],
  )
  const searchTable = useMemo(
    () =>
      buildPivotTable(
        searchFilteredExpenses,
        config.search.rowFields,
        config.search.columnFields,
        config.search.metric,
        {
          savingsTargetVnd: budgets.savingsTargetVnd,
          mssVnd: budgets.mssVnd,
          dailyCapVnd: baseDailyCapVnd,
          categoryLabel,
        },
      ),
    [
      searchFilteredExpenses,
      config.search.rowFields,
      config.search.columnFields,
      config.search.metric,
      budgets.savingsTargetVnd,
      budgets.mssVnd,
      baseDailyCapVnd,
      categoryLabels,
      categoryOptions,
    ],
  )
  const pivotChartPrimary = config.pivot.rowFields[0]
  const pivotChartIsTimeline = pivotChartPrimary === "day" || pivotChartPrimary === "week"
  const pivotChartLimit = pivotChartIsTimeline ? null : 8
  const pivotChartRows = pivotChartLimit === null
    ? pivotTable.rows
    : pivotTable.rows.slice(0, pivotChartLimit)
  const pivotHasColumns = config.pivot.columnFields.length > 0
  const pivotMoneyMetric = config.pivot.metric !== "count"
  const pivotHeatmapEnabled = pivotMoneyMetric && config.pivot.colorByAmount
  const pivotHeatmapScale = useMemo(() => {
    if (!pivotHeatmapEnabled) return null
    const values: number[] = []
    for (const row of pivotTable.rows) {
      for (const col of pivotTable.cols) {
        const v = pivotMetricValue(pivotTable.cells[row.key]?.[col.key], config.pivot.metric)
        if (v > 0) values.push(v)
      }
    }
    if (values.length < 2) return null
    values.sort((a, b) => a - b)
    const min = values[0]
    const max = values[values.length - 1]
    if (!(max > min)) return null

    const bins = 5
    const rawThresholds = Array.from({ length: bins - 1 }, (_, idx) => {
      const pct = (idx + 1) / bins
      const at = Math.round((values.length - 1) * pct)
      return values[Math.min(values.length - 1, Math.max(0, at))]
    })
    const thresholds: number[] = []
    for (const t of rawThresholds) {
      if (thresholds.length === 0 || t > thresholds[thresholds.length - 1]) thresholds.push(t)
    }
    if (thresholds.length === 0) thresholds.push(min + (max - min) * 0.5)
    return { thresholds }
  }, [pivotHeatmapEnabled, pivotTable, config.pivot.metric])
  const pivotDefaultSeriesLimit = pivotHasColumns ? 8 : 1
  const pivotAvailableSeries = pivotHasColumns ? pivotTable.cols : []
  const pivotVisibleSeriesKeys = pivotHasColumns
    ? (config.pivot.visibleSeries ?? []).filter((key) =>
        pivotAvailableSeries.some((col) => col.key === key),
      )
    : []
  const pivotDefaultSeriesKeys = pivotHasColumns
    ? pivotAvailableSeries.slice(0, pivotDefaultSeriesLimit).map((col) => col.key)
    : []
  const pivotSeriesKeys =
    pivotHasColumns && pivotVisibleSeriesKeys.length > 0
      ? pivotVisibleSeriesKeys
      : pivotDefaultSeriesKeys
  const pivotSeriesKeySet = new Set(pivotSeriesKeys)
  const pivotUsingDefaultSeries =
    pivotHasColumns && pivotVisibleSeriesKeys.length === 0
  const pivotSeriesColorByKey = new Map(
    pivotAvailableSeries.map((col, index) => [col.key, pivotSeriesColor(index)]),
  )
  const pivotChartColumns = pivotHasColumns
    ? pivotAvailableSeries.filter((col) => pivotSeriesKeySet.has(col.key))
    : []
  const pivotChartSeries = pivotHasColumns
    ? pivotChartColumns.map((col, index) => ({
        key: `series_${index}`,
        label: col.label,
        colKey: col.key,
        color: pivotSeriesColorByKey.get(col.key) ?? CHART_COLORS[0],
      }))
    : [
        {
          key: "value",
          label: PIVOT_METRIC_LABELS[config.pivot.metric],
          colKey: "total",
          color: CHART_COLORS[0],
        },
      ]
  const pivotChartSeriesLimited =
    pivotHasColumns && pivotAvailableSeries.length > pivotChartColumns.length
  const pivotChartSeriesLabelByKey = new Map(
    pivotChartSeries.map((series) => [series.key, series.label]),
  )
  const pivotChartSeriesShortLabelByKey = new Map(
    pivotChartSeries.map((series) => [
      series.key,
      shortenLabel(series.label, 18),
    ]),
  )
  const PIVOT_BASE_DAILY_CAP_DATA_KEY = "pivotBaseDailyCapVnd"
  const PIVOT_BASE_DAILY_CAP_LABEL = "Cap chi/ngày gốc"
  const PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY = "pivotDynamicDailyCapVnd"
  const PIVOT_DYNAMIC_DAILY_CAP_LABEL = "Cap chi/ngày (động)"
  const pivotDailyCapColumnIndex = config.pivot.columnFields.indexOf("dailyCap")
  const pivotDayRowIndex = config.pivot.rowFields.indexOf("day")
  const pivotDailyCapByDayMode =
    config.pivot.metric === "sum" &&
    pivotDayRowIndex >= 0 &&
    pivotDailyCapColumnIndex >= 0 &&
    Object.keys(dailyCapByDateMap).length > 0
  const pivotDateByRowKey = useMemo(() => {
    const out = new Map<string, ISODate>()
    if (pivotDayRowIndex < 0) return out
    for (const row of pivotTable.rows) {
      const date = row.key.split("||")[pivotDayRowIndex]
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        out.set(row.key, date as ISODate)
      }
    }
    return out
  }, [pivotTable.rows, pivotDayRowIndex])
  const pivotDailyCapColumnKeySet = useMemo(() => {
    if (!pivotDailyCapByDayMode || pivotDailyCapColumnIndex < 0) return new Set<string>()
    const out = new Set<string>()
    for (const col of pivotTable.cols) {
      if (col.parts[pivotDailyCapColumnIndex]) {
        out.add(col.key)
      }
    }
    return out
  }, [pivotDailyCapByDayMode, pivotDailyCapColumnIndex, pivotTable.cols])
  const getPivotDailyCapForRowKey = (rowKey: string) => {
    const date = pivotDateByRowKey.get(rowKey)
    if (!date) return baseDailyCapVnd
    return dailyCapByDateMap[date] ?? baseDailyCapByMonth[monthFromIsoDate(date)] ?? baseDailyCapVnd
  }
  const getPivotBaseDailyCapForRowKey = (rowKey: string) => {
    const date = pivotDateByRowKey.get(rowKey)
    if (!date) return baseDailyCapVnd
    return baseDailyCapByMonth[monthFromIsoDate(date)] ?? baseDailyCapVnd
  }
  const getPivotDisplayCellValue = (rowKey: string, colKey: string) => {
    if (pivotDailyCapByDayMode && pivotDailyCapColumnKeySet.has(colKey)) {
      return getPivotDailyCapForRowKey(rowKey)
    }
    return pivotMetricValue(pivotTable.cells[rowKey]?.[colKey], config.pivot.metric)
  }
  const pivotDisplayColTotals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const col of pivotTable.cols) {
      if (pivotDailyCapByDayMode && pivotDailyCapColumnKeySet.has(col.key)) {
        map[col.key] = pivotTable.rows.reduce(
          (sum, row) => sum + getPivotDailyCapForRowKey(row.key),
          0,
        )
      } else {
        map[col.key] = pivotMetricValue(pivotTable.colTotals[col.key], config.pivot.metric)
      }
    }
    return map
  }, [
    pivotTable.cols,
    pivotTable.rows.length,
    pivotTable.colTotals,
    pivotDailyCapByDayMode,
    pivotDailyCapColumnKeySet,
    dailyCapByDateMap,
    pivotDateByRowKey,
    baseDailyCapVnd,
    config.pivot.metric,
  ])
  const pivotChartData = pivotChartRows.map((row) => {
    const label =
      pivotChartPrimary === "day"
        ? formatShortDateAxisLabel(String(row.key.split("||")[0] ?? row.label))
        : pivotChartPrimary === "week"
          ? `W${row.sortValue}`
          : shortenLabel(row.label, 16)
    const dynamicCapForRow = getPivotDailyCapForRowKey(row.key)
    const baseCapForRow = getPivotBaseDailyCapForRowKey(row.key)
    if (!pivotHasColumns) {
      const value = pivotMetricValue(
        pivotTable.rowTotals[row.key],
        config.pivot.metric,
      )
      return {
        name: label,
        value,
        [PIVOT_BASE_DAILY_CAP_DATA_KEY]: baseCapForRow,
        [PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY]: dynamicCapForRow,
      }
    }
    const entry: Record<string, number | string> = {
      name: label,
      [PIVOT_BASE_DAILY_CAP_DATA_KEY]: baseCapForRow,
      [PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY]: dynamicCapForRow,
    }
    pivotChartSeries.forEach((series) => {
      entry[series.key] = getPivotDisplayCellValue(row.key, series.colKey)
    })
    return entry
  })
  const pivotChartLimited = pivotChartLimit !== null && pivotTable.rows.length > pivotChartLimit
  const showPivotDynamicDailyCapLine =
    pivotChartPrimary === "day" &&
    config.pivot.metric === "sum" &&
    Object.keys(dailyCapByDateMap).length > 0
  const showPivotBaseDailyCap =
    pivotChartPrimary === "day" &&
    config.pivot.metric === "sum" &&
    pivotChartData.some((row) => Number(row[PIVOT_BASE_DAILY_CAP_DATA_KEY]) > 0)
  const formatPivotSeriesDisplayName = (name: string) => {
    if (name === PIVOT_BASE_DAILY_CAP_DATA_KEY) return PIVOT_BASE_DAILY_CAP_LABEL
    if (name === PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY) return PIVOT_DYNAMIC_DAILY_CAP_LABEL
    return pivotChartSeriesLabelByKey.get(name) ?? name
  }
  const formatPivotSeriesLegendName = (name: string) => {
    if (name === PIVOT_BASE_DAILY_CAP_DATA_KEY) return PIVOT_BASE_DAILY_CAP_LABEL
    if (name === PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY) return PIVOT_DYNAMIC_DAILY_CAP_LABEL
    return pivotChartSeriesShortLabelByKey.get(name) ?? name
  }
  const togglePivotSeries = (seriesKey: string) => {
    if (!pivotHasColumns) return
    setConfig((s) => {
      const baseKeys =
        s.pivot.visibleSeries && s.pivot.visibleSeries.length > 0
          ? s.pivot.visibleSeries
          : pivotSeriesKeys
      const next = new Set(baseKeys)
      if (next.has(seriesKey)) {
        if (next.size === 1) return s
        next.delete(seriesKey)
      } else {
        next.add(seriesKey)
      }
      return {
        ...s,
        pivot: {
          ...s.pivot,
          visibleSeries: Array.from(next),
        },
      }
    })
  }
  const showAllPivotSeries = () => {
    if (!pivotHasColumns) return
    setConfig((s) => ({
      ...s,
      pivot: {
        ...s.pivot,
        visibleSeries: pivotAvailableSeries.map((col) => col.key),
      },
    }))
  }
  const resetPivotSeries = () => {
    if (!pivotHasColumns) return
    setConfig((s) => ({
      ...s,
      pivot: {
        ...s.pivot,
        visibleSeries: [],
      },
    }))
  }
  const hasPivotRowFields = config.pivot.rowFields.length > 0
  const pivotRowLabel = hasPivotRowFields
    ? config.pivot.rowFields
        .map((field) => PIVOT_FIELDS.find((f) => f.id === field)?.label ?? field)
        .join(" + ")
    : "Tổng"
  const pivotColumnSummary =
    config.pivot.columnFields.length === 0
      ? "Không phân cột"
      : config.pivot.columnFields
          .map((field) => PIVOT_FIELDS.find((f) => f.id === field)?.label ?? field)
          .join(" + ")
  const pivotRowSummaryText = hasPivotRowFields
    ? `${pivotRowLabel} (${config.pivot.rowFields.length} cấp)`
    : "Không phân hàng"
  const pivotColumnSummaryText =
    config.pivot.columnFields.length === 0
      ? pivotColumnSummary
      : `${pivotColumnSummary} (${config.pivot.columnFields.length} cấp)`
  const pivotColumnHeaderDepth = Math.max(1, config.pivot.columnFields.length)
  const pivotRowHeaderLabels = hasPivotRowFields
    ? config.pivot.rowFields.map(
        (field) => PIVOT_FIELDS.find((f) => f.id === field)?.label ?? field,
      )
    : ["Tổng"]
  const pivotRowHeaderDepth = pivotRowHeaderLabels.length
  const pivotRowHeaderColWidth = isNarrowViewport ? 112 : PIVOT_ROW_HEADER_COL_WIDTH
  const pivotRowHeaderLabelWidth = isNarrowViewport ? 96 : 140
  const pivotColumnHeaderLabelWidth = isNarrowViewport ? 112 : 180
  const pivotRowStickyOffsets = pivotRowHeaderLabels.map(
    (_, idx) => idx * pivotRowHeaderColWidth,
  )
  const pivotColumnHeaderRows = useMemo(() => {
    const cols = pivotTable.cols
    return Array.from({ length: pivotColumnHeaderDepth }, (_, level) => {
      const groups: { key: string; label: string; span: number }[] = []
      let index = 0
      while (index < cols.length) {
        const parts = cols[index].parts
        const prefixKey = parts.slice(0, level + 1).join("||") || `col-${index}`
        const label = parts[level] ?? cols[index].label
        let span = 1
        index += 1
        while (index < cols.length) {
          const nextParts = cols[index].parts
          const nextPrefix = nextParts.slice(0, level + 1).join("||")
          if (nextPrefix !== prefixKey) break
          span += 1
          index += 1
        }
        groups.push({ key: `${level}-${prefixKey}-${index}`, label, span })
      }
      return groups
    })
  }, [pivotColumnHeaderDepth, pivotTable.cols])
  const pivotRowSpans = useMemo(() => {
    const spans = pivotTable.rows.map(() => Array(pivotRowHeaderDepth).fill(0))
    if (pivotTable.rows.length === 0) return spans
    for (let level = 0; level < pivotRowHeaderDepth; level += 1) {
      let start = 0
      while (start < pivotTable.rows.length) {
        const baseKey = pivotTable.rows[start].parts.slice(0, level + 1).join("||")
        let end = start + 1
        while (end < pivotTable.rows.length) {
          const nextKey = pivotTable.rows[end].parts
            .slice(0, level + 1)
            .join("||")
          if (nextKey !== baseKey) break
          end += 1
        }
        spans[start][level] = end - start
        start = end
      }
    }
    return spans
  }, [pivotRowHeaderDepth, pivotTable.rows])
  const hasSearchRowFields = config.search.rowFields.length > 0
  const searchRowHeaderLabels = hasSearchRowFields
    ? config.search.rowFields.map(
        (field) => SEARCH_LAYOUT_FIELDS.find((f) => f.id === field)?.label ?? field,
      )
    : ["Tổng"]
  const searchColumnHeaderDepth = Math.max(1, config.search.columnFields.length)
  const searchRowHeaderDepth = searchRowHeaderLabels.length
  const searchRowHeaderColWidth = isNarrowViewport ? 112 : PIVOT_ROW_HEADER_COL_WIDTH
  const searchRowHeaderLabelWidth = isNarrowViewport ? 96 : 140
  const searchColumnHeaderLabelWidth = isNarrowViewport ? 112 : 180
  const searchRowStickyOffsets = searchRowHeaderLabels.map(
    (_, idx) => idx * searchRowHeaderColWidth,
  )
  const searchColumnHeaderRows = useMemo(() => {
    const cols = searchTable.cols
    return Array.from({ length: searchColumnHeaderDepth }, (_, level) => {
      const groups: { key: string; label: string; span: number }[] = []
      let index = 0
      while (index < cols.length) {
        const parts = cols[index].parts
        const prefixKey = parts.slice(0, level + 1).join("||") || `col-${index}`
        const label = parts[level] ?? cols[index].label
        let span = 1
        index += 1
        while (index < cols.length) {
          const nextParts = cols[index].parts
          const nextPrefix = nextParts.slice(0, level + 1).join("||")
          if (nextPrefix !== prefixKey) break
          span += 1
          index += 1
        }
        groups.push({ key: `${level}-${prefixKey}-${index}`, label, span })
      }
      return groups
    })
  }, [searchColumnHeaderDepth, searchTable.cols])
  const searchRowSpans = useMemo(() => {
    const spans = searchTable.rows.map(() => Array(searchRowHeaderDepth).fill(0))
    if (searchTable.rows.length === 0) return spans
    for (let level = 0; level < searchRowHeaderDepth; level += 1) {
      let start = 0
      while (start < searchTable.rows.length) {
        const baseKey = searchTable.rows[start].parts.slice(0, level + 1).join("||")
        let end = start + 1
        while (end < searchTable.rows.length) {
          const nextKey = searchTable.rows[end].parts
            .slice(0, level + 1)
            .join("||")
          if (nextKey !== baseKey) break
          end += 1
        }
        spans[start][level] = end - start
        start = end
      }
    }
    return spans
  }, [searchRowHeaderDepth, searchTable.rows])
  const handlePivotRemove = (field: PivotGroupKey, target: "row" | "column") => {
    setConfig((s) => {
      if (target === "row") {
        return {
          ...s,
          pivot: {
            ...s.pivot,
            rowFields: s.pivot.rowFields.filter((f) => f !== field),
          },
        }
      }
      return {
        ...s,
        pivot: {
          ...s.pivot,
          columnFields: s.pivot.columnFields.filter((f) => f !== field),
        },
      }
    })
  }
  const pivotFieldLabel = (field: PivotGroupKey) =>
    PIVOT_FIELDS.find((f) => f.id === field)?.label ?? field
  const searchFieldLabel = (field: PivotGroupKey) =>
    SEARCH_LAYOUT_FIELDS.find((f) => f.id === field)?.label ?? field
  const handlePivotAssign = (field: PivotGroupKey, target: "row" | "column") => {
    setConfig((s) => {
      const nextRow = s.pivot.rowFields.filter((f) => f !== field)
      const nextColumn = s.pivot.columnFields.filter((f) => f !== field)
      if (target === "row") {
        nextRow.push(field)
      } else {
        nextColumn.push(field)
      }
      return {
        ...s,
        pivot: {
          ...s.pivot,
          rowFields: nextRow,
          columnFields: nextColumn,
        },
      }
    })
  }
  const handlePivotMove = (
    field: PivotGroupKey,
    target: "row" | "column",
    direction: -1 | 1,
  ) => {
    setConfig((s) => {
      const list = target === "row" ? s.pivot.rowFields : s.pivot.columnFields
      const fromIndex = list.indexOf(field)
      const toIndex = fromIndex + direction
      if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) return s
      const next = arrayMove(list, fromIndex, toIndex)
      return {
        ...s,
        pivot: {
          ...s.pivot,
          rowFields: target === "row" ? next : s.pivot.rowFields,
          columnFields: target === "column" ? next : s.pivot.columnFields,
        },
      }
    })
  }

  const handlePivotDragEnd = (event: DragEndEvent) => {
    setActivePivotField(null)
    const activeData = event.active?.data?.current as PivotDragData | undefined
    const over = event.over
    if (!activeData) {
      lastPivotOverRef.current = null
      return
    }

    const fallback = lastPivotOverRef.current
    const overId = (over ? String(over.id) : fallback?.id) ?? null
    if (!overId) {
      lastPivotOverRef.current = null
      return
    }
    const overData = (over?.data?.current ?? fallback?.data) as PivotDragData | undefined

    setConfig((s) => {
      const row = s.pivot.rowFields
      const col = s.pivot.columnFields
      const sourceContainer = activeData.container

      const getIndex = (list: PivotGroupKey[], field: PivotGroupKey) =>
        list.indexOf(field)

      let targetContainer: PivotDragContainer | null = null
      let targetIndex = 0

      if (overId === "pivot-drop-row") {
        targetContainer = "row"
        targetIndex = row.length
      } else if (overId === "pivot-drop-column") {
        targetContainer = "column"
        targetIndex = col.length
      } else if (overData) {
        if (overData.container === "row") {
          targetContainer = "row"
          targetIndex = getIndex(row, overData.field)
        } else if (overData.container === "column") {
          targetContainer = "column"
          targetIndex = getIndex(col, overData.field)
        }
      }

      if (!targetContainer) return s
      if (targetIndex < 0) {
        targetIndex = targetContainer === "row" ? row.length : col.length
      }

      if (sourceContainer === targetContainer) {
        const list = targetContainer === "row" ? row : col
        const fromIndex = getIndex(list, activeData.field)
        if (fromIndex < 0) return s
        const boundedIndex = Math.min(Math.max(targetIndex, 0), Math.max(0, list.length - 1))
        const toIndex =
          overId === "pivot-drop-row" || overId === "pivot-drop-column"
            ? Math.max(0, list.length - 1)
            : boundedIndex
        if (fromIndex === toIndex) return s
        const next = arrayMove(list, fromIndex, toIndex)
        return {
          ...s,
          pivot: {
            ...s.pivot,
            rowFields: targetContainer === "row" ? next : row,
            columnFields: targetContainer === "column" ? next : col,
          },
        }
      }

      const nextRow = row.filter((f) => f !== activeData.field)
      const nextCol = col.filter((f) => f !== activeData.field)

      if (targetContainer === "row") {
        const insertAt = Math.min(Math.max(targetIndex, 0), nextRow.length)
        if (!nextRow.includes(activeData.field)) {
          nextRow.splice(insertAt, 0, activeData.field)
        }
        return {
          ...s,
          pivot: {
            ...s.pivot,
            rowFields: nextRow,
            columnFields: nextCol,
          },
        }
      }

      const insertAt = Math.min(Math.max(targetIndex, 0), nextCol.length)
      if (!nextCol.includes(activeData.field)) {
        nextCol.splice(insertAt, 0, activeData.field)
      }
      return {
        ...s,
        pivot: {
          ...s.pivot,
          rowFields: nextRow,
          columnFields: nextCol,
        },
      }
    })

    lastPivotOverRef.current = null
  }

  const handlePivotDragOver = (event: DragOverEvent) => {
    if (!event.over) return
    lastPivotOverRef.current = {
      id: String(event.over.id),
      data: event.over.data?.current as PivotDragData | undefined,
    }
  }
  const updateSearchFilter = (
    id: string,
    patch: Partial<Omit<SearchFilterCondition, "id">>,
  ) => {
    setSearchResultExpenseIds(null)
    setConfig((s) => ({
      ...s,
      search: {
        ...s.search,
        filters: s.search.filters.map((filter) =>
          filter.id === id ? { ...filter, ...patch } : filter,
        ),
      },
    }))
  }
  const addSearchFilter = () => {
    setSearchResultExpenseIds(null)
    setConfig((s) => ({
      ...s,
      search: {
        ...s.search,
        filters: [...s.search.filters, createSearchFilterCondition()],
      },
    }))
  }
  const removeSearchFilter = (id: string) => {
    setSearchResultExpenseIds(null)
    setConfig((s) => ({
      ...s,
      search: {
        ...s.search,
        filters: s.search.filters.filter((filter) => filter.id !== id),
      },
    }))
  }
  const clearSearchFilters = () => {
    setSearchResultExpenseIds(null)
    setConfig((s) => ({
      ...s,
      search: { ...s.search, filters: [] },
    }))
  }
  const runSearch = () => {
    if (activeSearchFilterCount === 0) {
      setSearchResultExpenseIds(null)
      return
    }
    const resultIds = allVariableExpenses
      .filter((expense) =>
        searchFiltersMatch(expense, config.search.filters, categoryLabel),
      )
      .map((expense) => expense.id)
    setSearchResultExpenseIds(resultIds)
  }
  const handleSearchAssign = (field: PivotGroupKey, target: "row" | "column") => {
    setConfig((s) => {
      const nextRow = s.search.rowFields.filter((f) => f !== field)
      const nextColumn = s.search.columnFields.filter((f) => f !== field)
      if (target === "row") nextRow.push(field)
      else nextColumn.push(field)
      return {
        ...s,
        search: {
          ...s.search,
          rowFields: nextRow,
          columnFields: nextColumn,
        },
      }
    })
  }
  const handleSearchRemove = (field: PivotGroupKey, target: "row" | "column") => {
    setConfig((s) => ({
      ...s,
      search: {
        ...s.search,
        rowFields:
          target === "row" ? s.search.rowFields.filter((f) => f !== field) : s.search.rowFields,
        columnFields:
          target === "column"
            ? s.search.columnFields.filter((f) => f !== field)
            : s.search.columnFields,
      },
    }))
  }
  const handleSearchMove = (
    field: PivotGroupKey,
    target: "row" | "column",
    direction: -1 | 1,
  ) => {
    setConfig((s) => {
      const list = target === "row" ? s.search.rowFields : s.search.columnFields
      const fromIndex = list.indexOf(field)
      const toIndex = fromIndex + direction
      if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) return s
      const next = arrayMove(list, fromIndex, toIndex)
      return {
        ...s,
        search: {
          ...s.search,
          rowFields: target === "row" ? next : s.search.rowFields,
          columnFields: target === "column" ? next : s.search.columnFields,
        },
      }
    })
  }
  const renderSearchSelectedFields = (
    fields: PivotGroupKey[],
    target: "row" | "column",
    title: string,
  ) => (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {fields.length}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {fields.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Chưa chọn trường.
          </div>
        ) : (
          fields.map((field, index) => (
            <div
              key={`search-${target}-${field}`}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-1 text-xs font-medium"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background text-[10px] tabular-nums">
                {index + 1}
              </span>
              <span>{searchFieldLabel(field)}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={index === 0}
                onClick={() => handleSearchMove(field, target, -1)}
                aria-label="Đưa lên"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={index === fields.length - 1}
                onClick={() => handleSearchMove(field, target, 1)}
                aria-label="Đưa xuống"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                onClick={() => handleSearchRemove(field, target)}
                aria-label={`Bỏ ${searchFieldLabel(field)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )

  const smallThreshold =
    budgets.incomeVnd > 0 ? Math.min(50_000, Math.round(budgets.incomeVnd * 0.01)) : 50_000
  const smallWantsExpenses = expenses.filter(
    (e) => e.bucket === "wants" && e.amountVnd <= smallThreshold,
  )
  const smallCount = smallWantsExpenses.length
  const smallSum = smallWantsExpenses.reduce((s, e) => s + e.amountVnd, 0)
  const minLeakageCount = 12
  const minLeakageSum = Math.max(Math.round(budgets.wantsBudgetVnd * 0.1), 300_000)
  const leakageDetected = smallCount >= minLeakageCount && smallSum >= minLeakageSum

  const previousRange = useMemo(() => {
    const days = getDateRangeDayCount(dateRange)
    return {
      start: addDaysIsoDate(dateRange.start, -days),
      end: addDaysIsoDate(dateRange.start, -1),
    }
  }, [dateRange])
  const prevTotals = useMemo(
    () => getDateRangeTotals(data, previousRange),
    [data, previousRange],
  )
  const hasPrev = prevTotals.totalSpent > 0
  const delta = totals.totalSpent - prevTotals.totalSpent
  const deltaPct =
    hasPrev && prevTotals.totalSpent > 0 ? delta / prevTotals.totalSpent : 0

  const isLegendKeyHidden = (key: string) => hiddenLegendKeys.has(key)
  const toggleLegendKey = (key: string) => {
    setHiddenLegendKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const renderLegendLabel = (label: string, key: string) => {
    const hidden = isLegendKeyHidden(key)
    return (
      <span
        className={cn(
          "cursor-pointer select-none transition-colors",
          hidden && "text-muted-foreground line-through opacity-60",
        )}
      >
        {label}
      </span>
    )
  }
  const showChartLegend = !isNarrowViewport
  const formatMoneyAxisTick = (value: unknown) =>
    isNarrowViewport
      ? formatCompactVndTick(value)
      : new Intl.NumberFormat("vi-VN").format(Number(value))
  const reportChartMargin = isNarrowViewport
    ? { left: 0, right: 4, top: 12, bottom: 0 }
    : { left: 8, right: 16, top: 8, bottom: 8 }
  const reportChartYAxisWidth = isNarrowViewport ? 48 : 60
  const reportChartTick = { fontSize: isNarrowViewport ? 11 : 12 }

  const panelBaseClassName =
    "left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-none max-h-[85dvh] rounded-t-xl border-0 border-t p-4 data-[state=open]:[--tw-enter-scale:1] data-[state=closed]:[--tw-exit-scale:1] sm:left-auto sm:right-0 sm:top-0 sm:bottom-auto sm:h-dvh sm:max-h-none sm:rounded-none sm:rounded-l-xl sm:border-l sm:border-t-0 sm:p-6 data-[state=open]:slide-in-from-bottom-2 sm:data-[state=open]:slide-in-from-right-2 data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=closed]:slide-out-to-right-2"
  const controlsPanelClassName = cn(
    panelBaseClassName,
    "p-3 sm:w-[min(92vw,720px)] sm:p-4 lg:w-[50vw] lg:min-w-[560px]",
  )
  const insightsPanelClassName = cn(
    panelBaseClassName,
    "sm:w-[min(92vw,960px)] lg:w-[80vw] lg:min-w-[720px]",
  )
  const summaryPanelClassName = cn(
    panelBaseClassName,
    "sm:w-[min(92vw,720px)] lg:w-[50vw] lg:min-w-[560px]",
  )

  const effectivePivotSplitView =
    isNarrowViewport && pivotSplitView === "both" ? "table" : pivotSplitView
  const pivotShowTable = effectivePivotSplitView !== "chart"
  const pivotShowChart = effectivePivotSplitView !== "table"
  const handlePivotChartTap = (state: ChartInteractionState | null | undefined) => {
    if (!isNarrowViewport) return
    const label = String(state?.activeLabel ?? "")
    const now = Date.now()
    const previous = lastPivotChartTapRef.current
    const isDoubleTap =
      !!previous && previous.label === label && now - previous.time <= 360

    lastPivotChartTapRef.current = { label, time: now }

    if (!isDoubleTap || !state?.activePayload?.length) {
      setPivotTooltip({ active: false })
      return
    }

    setPivotTooltip({
      active: true,
      coordinate: state.activeCoordinate,
      label: state.activeLabel,
      payload: state.activePayload,
    })
  }
  const pivotTooltipProps = isNarrowViewport
    ? {
        active: pivotTooltip.active,
        coordinate: pivotTooltip.coordinate,
        label: pivotTooltip.label,
        payload: pivotTooltip.payload,
      }
    : {}
  const renderMobilePivotSelectedFields = (
    fields: PivotGroupKey[],
    target: "row" | "column",
  ) => {
    const title = target === "row" ? "Hàng" : "Cột"
    const transferLabel = target === "row" ? "Cột" : "Hàng"
    const transferTarget = target === "row" ? "column" : "row"

    return (
      <div className="rounded-md border bg-background p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {fields.length === 0 ? (
          <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Chưa chọn trường nào.
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {fields.map((field, index) => (
              <div
                key={`${target}-${field}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-muted/20 px-2 py-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 truncate text-sm font-medium">
                  {pivotFieldLabel(field)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0}
                    aria-label={`Đưa ${pivotFieldLabel(field)} lên`}
                    onClick={() => handlePivotMove(field, target, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === fields.length - 1}
                    aria-label={`Đưa ${pivotFieldLabel(field)} xuống`}
                    onClick={() => handlePivotMove(field, target, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => handlePivotAssign(field, transferTarget)}
                  >
                    <MoveRight className="h-3.5 w-3.5" />
                    {transferLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Bỏ ${pivotFieldLabel(field)}`}
                    onClick={() => handlePivotRemove(field, target)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  const renderMobilePivotAvailableFields = () => (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Trường dữ liệu
      </div>
      <div className="mt-2 space-y-2">
        {PIVOT_FIELDS.map((field) => {
          const inRow = config.pivot.rowFields.includes(field.id)
          const inColumn = config.pivot.columnFields.includes(field.id)
          const status = inRow ? "Đang ở Hàng" : inColumn ? "Đang ở Cột" : "Chưa dùng"

          return (
            <div
              key={field.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-muted/10 px-2 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{field.label}</div>
                <div className="text-[11px] text-muted-foreground">{status}</div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  type="button"
                  variant={inRow ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 px-2 text-[11px]"
                  onClick={() => handlePivotAssign(field.id, "row")}
                >
                  Hàng
                </Button>
                <Button
                  type="button"
                  variant={inColumn ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 px-2 text-[11px]"
                  onClick={() => handlePivotAssign(field.id, "column")}
                >
                  Cột
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0">
            <h1 className="shrink-0 text-lg font-semibold tracking-tight sm:text-xl">
              Báo cáo
            </h1>
            <div className="mt-1 flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 sm:hidden">
              <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[11px]">
                Chi:{" "}
                <span className="font-semibold tabular-nums">
                  {formatVnd(totals.totalSpent)}
                </span>
              </Badge>
              {leakageDetected ? (
                <Badge variant="destructive" className="shrink-0 whitespace-nowrap text-[11px]">
                  Rò rỉ: {smallCount}×
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex">
            <Badge variant="outline" className="whitespace-nowrap">
              Thu nhập tham chiếu:{" "}
              <span className="ml-1 font-semibold tabular-nums">
                {formatVnd(budgets.incomeVnd)}
              </span>
            </Badge>
            <Badge variant="secondary" className="whitespace-nowrap">
              Tổng chi:{" "}
              <span className="ml-1 font-semibold tabular-nums">
                {formatVnd(totals.totalSpent)}
              </span>
            </Badge>
            {hasPrev ? (
              <Badge
                variant={delta > 0 ? "destructive" : "secondary"}
                className="whitespace-nowrap"
              >
                So với kỳ trước: {delta >= 0 ? "+" : ""}
                {formatVnd(delta)} ({(deltaPct * 100).toFixed(1)}%)
              </Badge>
            ) : null}
            {leakageDetected ? (
              <Badge variant="destructive" className="whitespace-nowrap">
                Rò rỉ: {smallCount}× ≤ {formatVnd(smallThreshold)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 sm:w-auto sm:flex sm:flex-wrap sm:justify-end sm:gap-2 sm:shrink-0">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            presets={dateRangePresets}
            className="w-full sm:w-[330px]"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 w-9 gap-2 px-0 sm:h-8 sm:w-auto sm:px-3"
            onClick={() => setSummaryOpen(true)}
            aria-label="Tóm tắt"
          >
            <Info className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Tóm tắt</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 w-9 gap-2 px-0 sm:h-8 sm:w-auto sm:px-3"
            onClick={() => setInsightsOpen(true)}
            aria-label="Insight"
          >
            <Sparkles className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Insight</span>
          </Button>
        </div>
      </div>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className={cn(summaryPanelClassName, "overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Tóm tắt báo cáo
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm font-medium">Tổng chi trong khoảng</div>
                <div className="text-right text-base font-semibold tabular-nums sm:text-lg">
                  {formatVnd(totals.totalSpent)}
                </div>
              </div>
              <div className="mt-2 grid gap-1 text-sm">
                {isSingleFullMonth ? (
                  <>
                    <LabelValueRow
                      label="Dư/Thiếu (Thu - Chi)"
                      value={formatVnd(saved)}
                    />
                    <LabelValueRow
                      label="Tỉ lệ tiết kiệm"
                      value={`${(savingsRate * 100).toFixed(1)}%`}
                    />
                    <LabelValueRow
                      label="Mục tiêu tiết kiệm theo kế hoạch"
                      value={formatVnd(savingsMin)}
                    />
                  </>
                ) : (
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Dư/thiếu và tỉ lệ tiết kiệm chỉ hiển thị khi khoảng lọc là trọn một tháng.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm font-medium">So với kỳ trước</div>
                {hasPrev ? (
                  <div
                    className={cn(
                      "text-right text-base font-semibold tabular-nums sm:text-lg",
                      delta > 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {delta >= 0 ? "+" : ""}
                    {formatVnd(delta)}
                  </div>
                ) : (
                  <Badge variant="outline" className="whitespace-nowrap">
                    Chưa có dữ liệu
                  </Badge>
                )}
              </div>
              {hasPrev ? (
                <div className="mt-2 grid gap-1 text-sm">
                  <LabelValueRow
                    label={`Kỳ trước (${formatDateRangeLabel(previousRange)})`}
                    value={formatVnd(prevTotals.totalSpent)}
                  />
                  <LabelValueRow
                    label="Tỉ lệ thay đổi"
                    value={`${deltaPct >= 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%`}
                  />
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">
                  Chưa có dữ liệu kỳ trước để so sánh.
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium">Insight “rò rỉ”</div>
                <Badge variant={leakageDetected ? "destructive" : "secondary"}>
                  {leakageDetected ? "Cần chú ý" : "Ổn"}
                </Badge>
              </div>
              <div className="mt-2 grid gap-1 text-sm">
                <LabelValueRow
                  label="Khoản nhỏ (Mong muốn)"
                  value={`≤ ${formatVnd(smallThreshold)}`}
                />
                <LabelValueRow
                  label="Số lần / Tổng"
                  value={`${smallCount} lần • ${formatVnd(smallSum)}`}
                />
                <LabelValueRow
                  label="Ngưỡng cảnh báo"
                  value={`≥ ${minLeakageCount} lần • ≥ ${formatVnd(minLeakageSum)}`}
                />
              </div>
              {leakageDetected ? (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
                  Phát hiện “rò rỉ” ở Mong muốn: nhiều khoản nhỏ lặp lại. Gợi ý đặt cap Mong muốn/ngày và gom mua sắm theo kế hoạch.
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  Chưa thấy dấu hiệu rò rỉ rõ rệt trong khoản nhỏ Mong muốn.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className={cn(insightsPanelClassName, "overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Insight
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Insight nâng cao</CardTitle>
            {advancedInsights.activeDays > 0 ? (
              <div
                className="text-xs text-muted-foreground"
                title="Số ngày có chi trong kỳ phân tích của tháng đang chọn."
              >
                {advancedInsights.activeDays}/{advancedInsights.totalDays} ngày có chi biến đổi (trong kỳ) •{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {formatVnd(Math.round(advancedInsights.totalSpent))}
                </span>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {advancedInsights.activeDays === 0 ? (
            <div className="text-sm text-muted-foreground">
              Chưa có dữ liệu chi tiêu trong tháng để phân tích.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-4 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Nhịp chi theo ngày</div>
                  <Badge variant="outline">Chi biến đổi</Badge>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Nhịp được phân cụm trên toàn bộ lịch sử chi biến đổi để tăng độ ổn định theo thời gian.
                </div>
                {advancedInsights.historicalActiveDays > 0 ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Mẫu lịch sử:{" "}
                    <span className="font-medium text-foreground">
                      {advancedInsights.historicalActiveDays} ngày có chi
                    </span>
                    {advancedInsights.historicalFrom && advancedInsights.historicalTo
                      ? ` (${advancedInsights.historicalFrom} → ${advancedInsights.historicalTo})`
                      : ""}
                  </div>
                ) : null}
                {advancedInsights.zeroDays > 0 ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Ngày không ghi chi biến đổi:{" "}
                    <span className="font-medium text-foreground">
                      {advancedInsights.zeroDays} ngày
                    </span>
                  </div>
                ) : null}
                {advancedInsights.cluster ? (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {advancedInsights.cluster.tiers.map((tier) => {
                        const tierColor =
                          tier.tier === "high"
                            ? "bg-rose-500"
                            : tier.tier === "mid"
                              ? "bg-sky-500"
                              : "bg-emerald-500"
                        return (
                          <div
                            key={tier.tier}
                            className="rounded-md border bg-background/70 p-3"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-semibold">
                                Nhịp {CLUSTER_TIER_LABELS[tier.tier]}
                              </span>
                              <span
                                className="text-[11px] text-muted-foreground text-right leading-tight"
                                title="Số ngày trong kỳ phân tích thuộc nhịp này."
                              >
                                {tier.count}/{advancedInsights.cluster?.sampleDays ?? 0} ngày
                                <span className="block">có chi</span>
                              </span>
                            </div>
                            <div className="mt-2 flex items-end justify-between gap-2">
                              <span
                                className={cn(
                                  "text-base font-semibold tabular-nums",
                                  tier.tier === "high" && "text-destructive",
                                )}
                              >
                                {formatVnd(Math.round(tier.avg))}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                TB/ngày
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                              <div
                                className={cn("h-1.5 rounded-full", tierColor)}
                                style={{ width: `${Math.round(tier.share * 100)}%` }}
                              />
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {Math.round(tier.share * 100)}%
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border bg-background/70 p-3">
                        <div className="text-xs font-semibold">Nguồn chi cao</div>
                        {advancedInsights.cluster.topCategories.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {advancedInsights.cluster.topCategories.slice(0, 3).map((item) => {
                              const label =
                                categoryLabel(item.category)
                              const pct = Math.round(item.share * 100)
                              return (
                                <span
                                  key={item.category}
                                  className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                                >
                                  {label} · {pct}%
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Chưa đủ dữ liệu để tách nguồn chi cao.
                          </div>
                        )}
                      </div>
                      <div className="rounded-md border bg-background/70 p-3">
                        <div className="text-xs font-semibold">Ngày dễ vượt nhịp</div>
                        {advancedInsights.cluster.topWeekdays.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {advancedInsights.cluster.topWeekdays.slice(0, 3).map((item) => {
                              const label = PIVOT_WEEKDAY_LABELS[item.weekday] ?? "?"
                              return (
                                <span
                                  key={`${item.weekday}-${item.avg}`}
                                  className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                                >
                                  {label} · {formatVnd(Math.round(item.avg))}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Chưa có ngày vượt nhịp rõ ràng.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Chưa đủ dữ liệu để phân cụm (cần tối thiểu 7 ngày chi trong toàn bộ lịch sử).
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Tổ hợp danh mục</div>
                  <Badge variant="outline">Theo ngày (toàn lịch sử)</Badge>
                </div>
                {advancedInsights.association ? (
                  <>
                    <div className="mt-3 rounded-md border bg-background/70 p-3">
                      <div className="text-xs text-muted-foreground">
                        Cặp thường đi cùng
                      </div>
                      <div className="mt-1 text-base font-semibold">
                        {`${categoryLabel(advancedInsights.association.base)} + ${categoryLabel(advancedInsights.association.with)}`}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <LabelValueRow
                        className="text-xs"
                        label="Số ngày mẫu"
                        labelTitle="Số ngày có chi dùng để tính tổ hợp"
                        value={`${advancedInsights.association.sampleDays} ngày`}
                      />
                      <LabelValueRow
                        className="text-xs"
                        label="Tần suất"
                        labelTitle="Tần suất"
                        value={`${Math.round(advancedInsights.association.support * 100)}% ngày`}
                      />
                      <LabelValueRow
                        className="text-xs"
                        label="Xác suất đi kèm"
                        labelTitle="Xác suất đi kèm"
                        value={`${Math.round(advancedInsights.association.confidence * 100)}%`}
                      />
                      <LabelValueRow
                        className="text-xs"
                        label="Lift"
                        labelTitle="Lift"
                        value={`${advancedInsights.association.lift.toFixed(2)}x`}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Chưa đủ dữ liệu để rút ra tổ hợp ổn định trên lịch sử chi tiêu.
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 lg:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Xu hướng ngắn hạn</div>
                  {advancedInsights.trend ? (
                    <Badge variant="outline">{advancedInsights.trend.window} ngày</Badge>
                  ) : null}
                </div>
                {advancedInsights.trend ? (
                  <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {advancedInsights.trend.window} ngày gần đây (TB/ngày)
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-foreground">
                            {formatVnd(Math.round(advancedInsights.trend.recentAvg))}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-sky-500"
                            style={{ width: `${recentTrendPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {advancedInsights.trend.window} ngày trước đó (TB/ngày)
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-foreground">
                            {formatVnd(Math.round(advancedInsights.trend.previousAvg))}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-slate-400"
                            style={{ width: `${previousTrendPct}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border bg-background/70 p-3">
                      <div className="text-xs text-muted-foreground">Chênh lệch</div>
                      <div
                        className={cn(
                          "mt-1 text-lg font-semibold tabular-nums",
                          advancedInsights.trend.direction === "up" &&
                            "text-destructive",
                          advancedInsights.trend.direction === "down" &&
                            "text-emerald-600",
                        )}
                      >
                        {advancedInsights.trend.delta >= 0 ? "+" : ""}
                        {formatVnd(Math.round(advancedInsights.trend.delta))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(advancedInsights.trend.deltaPct * 100).toFixed(1)}% so với
                        {` ${advancedInsights.trend.window} ngày trước`}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Chưa đủ dữ liệu để đọc xu hướng ngắn hạn.
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={controlsOpen} onOpenChange={setControlsOpen}>
        <DialogContent className={cn(controlsPanelClassName, "overflow-y-auto")}>
          <DialogHeader className="space-y-0 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5" />
              Tùy chỉnh báo cáo
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {config.mode === "pivot" ? (
              <div className="space-y-3">
                {isNarrowViewport ? (
                  <div className="space-y-3 rounded-lg border bg-muted/5 p-3">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-semibold">Bố cục Pivot</div>
                        <div className="text-xs text-muted-foreground">
                          Chạm để đưa trường vào Hàng/Cột. Dùng mũi tên để đổi thứ tự.
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => {
                            const defaults = defaultReportsConfig()
                            setConfig((s) => ({
                              ...s,
                              pivot: defaults.pivot,
                            }))
                          }}
                        >
                          Reset
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={config.pivot.rowFields.length === 0}
                          onClick={() =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, rowFields: [] },
                            }))
                          }
                        >
                          Bỏ hàng
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={config.pivot.columnFields.length === 0}
                          onClick={() =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, columnFields: [] },
                            }))
                          }
                        >
                          Bỏ cột
                        </Button>
                      </div>
                    </div>

                    {renderMobilePivotAvailableFields()}

                    <div className="grid gap-3">
                      {renderMobilePivotSelectedFields(config.pivot.rowFields, "row")}
                      {renderMobilePivotSelectedFields(config.pivot.columnFields, "column")}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Hàng = {pivotRowSummaryText} • Cột = {pivotColumnSummaryText}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          id="pivot-color-by-amount-mobile"
                          disabled={!pivotMoneyMetric}
                          checked={pivotMoneyMetric && config.pivot.colorByAmount}
                          onCheckedChange={(next) =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, colorByAmount: next === true },
                            }))
                          }
                        />
                        <Label
                          htmlFor="pivot-color-by-amount-mobile"
                          className="min-w-0 truncate text-sm"
                        >
                          Màu theo số tiền
                        </Label>
                      </div>
                    </div>
                  </div>
                ) : (
                <DndContext
                  sensors={pivotSensors}
                  collisionDetection={pivotCollisionDetection}
                  measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                  onDragStart={(event) => {
                    lastPivotOverRef.current = null
                    const data = event.active.data?.current as PivotDragData | undefined
                    setActivePivotField(data?.field ?? null)
                  }}
                  onDragOver={handlePivotDragOver}
                  onDragCancel={() => {
                    setActivePivotField(null)
                    lastPivotOverRef.current = null
                  }}
                  onDragEnd={handlePivotDragEnd}
                >
                  <div className="rounded-lg border bg-muted/5 p-3 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-semibold">Bố cục Pivot</div>
                      <div className="text-xs text-muted-foreground">
                        Kéo chip vào Hàng/Cột. Kéo để đổi thứ tự.
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => {
                          const defaults = defaultReportsConfig()
                          setConfig((s) => ({
                            ...s,
                            pivot: defaults.pivot,
                          }))
                        }}
                      >
                        Reset
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                          disabled={config.pivot.rowFields.length === 0}
                          onClick={() =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, rowFields: [] },
                            }))
                          }
                        >
                          Bỏ hàng
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={config.pivot.columnFields.length === 0}
                          onClick={() =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, columnFields: [] },
                            }))
                          }
                        >
                          Bỏ cột
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border bg-background p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Trường dữ liệu
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {PIVOT_FIELDS.map((field) => (
                            <PivotDraggableField
                              key={field.id}
                              field={field}
                              active={
                                config.pivot.rowFields.includes(field.id) ||
                                config.pivot.columnFields.includes(field.id)
                              }
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <PivotDropZone id="pivot-drop-row" title="Hàng" className="min-h-[96px]">
                          <SortableContext
                            items={config.pivot.rowFields.map((field) => `row:${field}`)}
                            strategy={rectSortingStrategy}
                          >
                            <div className="flex flex-wrap gap-2">
                              {config.pivot.rowFields.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  Kéo chip vào đây
                                </div>
                              ) : (
                                config.pivot.rowFields.map((field, index) => (
                                  <PivotFieldPill
                                    key={`row-${field}`}
                                    field={field}
                                    container="row"
                                    index={index}
                                    onRemove={(f) => handlePivotRemove(f, "row")}
                                  />
                                ))
                              )}
                            </div>
                          </SortableContext>
                        </PivotDropZone>

                        <PivotDropZone
                          id="pivot-drop-column"
                          title="Cột"
                          className="min-h-[96px]"
                        >
                          <SortableContext
                            items={config.pivot.columnFields.map((field) => `column:${field}`)}
                            strategy={rectSortingStrategy}
                          >
                            <div className="flex flex-wrap gap-2">
                              {config.pivot.columnFields.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  Kéo chip vào đây
                                </div>
                              ) : (
                                config.pivot.columnFields.map((field, index) => (
                                  <PivotFieldPill
                                    key={`col-${field}`}
                                    field={field}
                                    container="column"
                                    index={index}
                                    onRemove={(f) => handlePivotRemove(f, "column")}
                                  />
                                ))
                              )}
                            </div>
                          </SortableContext>
                        </PivotDropZone>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Hàng = {pivotRowSummaryText} • Cột = {pivotColumnSummaryText}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          id="pivot-color-by-amount"
                          disabled={!pivotMoneyMetric}
                          checked={pivotMoneyMetric && config.pivot.colorByAmount}
                          onCheckedChange={(next) =>
                            setConfig((s) => ({
                              ...s,
                              pivot: { ...s.pivot, colorByAmount: next === true },
                            }))
                          }
                        />
                        <Label
                          htmlFor="pivot-color-by-amount"
                          className="min-w-0 truncate text-sm"
                        >
                          Màu theo số tiền
                        </Label>
                        <span className="hidden sm:inline whitespace-nowrap text-xs text-muted-foreground">
                          xanh thấp → đỏ cao
                        </span>
                      </div>
                      <div className="hidden h-2 w-20 shrink-0 rounded-full bg-gradient-to-r from-emerald-500/60 via-amber-500/60 to-rose-500/60 sm:block" />
                    </div>
                  </div>

                  <DragOverlay zIndex={10000}>
                    {activePivotField ? (
                      <div className="rounded-full border bg-background px-3 py-1 text-xs font-semibold shadow-xl ring-2 ring-primary/30">
                        {pivotFieldLabel(activePivotField)}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
                )}
              </div>
            ) : config.mode === "search" ? (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Search Data dùng điều kiện lọc và bố cục bảng ngay trong tab Search.
                  Cấu hình này độc lập với Pivot.
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const defaults = defaultReportsConfig()
                      setSearchResultExpenseIds(null)
                      setConfig((s) => ({
                        ...s,
                        search: defaults.search,
                      }))
                    }}
                  >
                    Reset Search Data
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Chưa có tuỳ chỉnh cho chế độ này.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="space-y-2 p-2.5 sm:space-y-3 sm:p-6">
          <Tabs
            value={config.mode}
            onValueChange={(v) =>
              setConfig((s) => ({
                ...s,
                mode: v === "search" ? "search" : "pivot",
              }))
            }
          >
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <div className="col-span-2 min-w-0 sm:col-auto">
                <TabsList className="grid h-auto w-full grid-cols-2 justify-stretch sm:inline-flex sm:h-10 sm:w-max sm:justify-start">
                  <TabsTrigger className="px-2 text-xs sm:px-3 sm:text-sm" value="pivot">
                    Pivot
                  </TabsTrigger>
                  <TabsTrigger className="px-2 text-xs sm:px-3 sm:text-sm" value="search">
                    Search
                  </TabsTrigger>
                </TabsList>
              </div>
              {config.mode === "search" ? null : effectivePivotSplitView === "table" ? null : (
                <Select
                  value={config.pivot.chartType}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      pivot: {
                        ...s.pivot,
                        chartType: v as PivotChartType,
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-full text-xs sm:w-[170px] sm:text-sm">
                    <SelectValue placeholder="Biểu đồ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bar">{PIVOT_CHART_LABELS.bar}</SelectItem>
                    <SelectItem value="line">{PIVOT_CHART_LABELS.line}</SelectItem>
                    <SelectItem value="area">{PIVOT_CHART_LABELS.area}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {config.mode === "pivot" ? (
                <Select
                  value={config.pivot.metric}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      pivot: { ...s.pivot, metric: v as PivotMetric },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-full text-xs sm:w-[190px] sm:text-sm">
                    <SelectValue placeholder="Chỉ số" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Tổng chi</SelectItem>
                    <SelectItem value="count">Số giao dịch</SelectItem>
                    <SelectItem value="avg">TB/giao dịch</SelectItem>
                  </SelectContent>
                </Select>
              ) : config.mode === "search" ? (
                <Select
                  value={config.search.metric}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      search: { ...s.search, metric: v as PivotMetric },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-full text-xs sm:w-[190px] sm:text-sm">
                    <SelectValue placeholder="Chỉ số" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Tổng chi</SelectItem>
                    <SelectItem value="count">Số giao dịch</SelectItem>
                    <SelectItem value="avg">TB/giao dịch</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {config.mode === "pivot" ? (
                <div className="inline-flex w-full items-center rounded-md border bg-background p-0.5 sm:w-auto">
                  <Button
                    type="button"
                    size="sm"
                    variant={effectivePivotSplitView === "table" ? "secondary" : "ghost"}
                    className="h-8 flex-1 gap-2 px-2 text-xs sm:flex-none sm:text-sm"
                    title="Chỉ xem bảng pivot"
                    onClick={() => setPivotSplitView("table")}
                  >
                    <Table className="h-4 w-4" />
                    <span className="hidden sm:inline">Bảng</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={effectivePivotSplitView === "both" ? "secondary" : "ghost"}
                    className="hidden h-8 gap-2 px-2 sm:inline-flex"
                    title="Chia đôi bảng + biểu đồ"
                    onClick={() => setPivotSplitView("both")}
                  >
                    <Columns2 className="h-4 w-4" />
                    <span className="hidden sm:inline">50/50</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={effectivePivotSplitView === "chart" ? "secondary" : "ghost"}
                    className="h-8 flex-1 gap-2 px-2 text-xs sm:flex-none sm:text-sm"
                    title="Chỉ xem biểu đồ pivot"
                    onClick={() => setPivotSplitView("chart")}
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span className="hidden sm:inline">Biểu đồ</span>
                  </Button>
                </div>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 w-full shrink-0 gap-2 text-xs sm:w-auto sm:text-sm"
                onClick={() => setControlsOpen(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Tùy chỉnh
              </Button>
            </div>

            <TabsContent value="search" className="min-w-0 space-y-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
                <Card className="min-w-0">
                  <CardHeader className="space-y-1 pb-3">
                    <CardTitle className="text-base">Điều kiện lọc</CardTitle>
                    <div className="text-xs text-muted-foreground">
                      Chuỗi lọc chạy lần lượt từ trên xuống. Điều kiện chưa nhập giá trị sẽ bị bỏ qua.
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {config.search.filters.length === 0 ? (
                      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                        Chưa có điều kiện nào.
                        <div className="mt-2">
                          <Button type="button" variant="outline" size="sm" onClick={addSearchFilter}>
                            <Plus className="mr-1 h-4 w-4" />
                            Thêm điều kiện đầu tiên
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <ol className="relative">
                        {/* Dây timeline chạy dọc phía sau các nút. Vì đây là phần tử absolute nên nó
                            được vẽ ĐÈ lên các phần tử tĩnh -> các nút/đoạn nối phải có `relative z-10`
                            để nằm trên dây, nếu không số 1,2,3 sẽ bị đường kẻ cắt ngang. */}
                        <div
                          aria-hidden
                          className="absolute left-4 top-3 bottom-3 w-px bg-border"
                        />

                        {config.search.filters.map((filter, index) => {
                          const field = SEARCH_FILTER_FIELDS.find((item) => item.id === filter.field)
                          const valueOptions = searchValueOptions[filter.field]
                          const isActive = filter.value.trim().length > 0
                          const isFirstActive = filter.id === firstActiveSearchFilterId
                          // Toán tử chỉ có hiệu lực khi điều kiện này thực sự được gộp vào chuỗi
                          // và nó không phải mắt xích đầu tiên.
                          const connectorEffective = isActive && !isFirstActive
                          const stepCount = searchStepCounts[filter.id]

                          return (
                            <li key={filter.id}>
                              {index > 0 ? (
                                <div className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3">
                                  <div className="flex h-9 justify-center">
                                    <span
                                      className={cn(
                                        "relative z-10 h-full w-[3px] rounded-full",
                                        connectorEffective
                                          ? SEARCH_CONNECTOR_RAIL[filter.connector]
                                          : "bg-border",
                                      )}
                                    />
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <SearchConnectorToggle
                                      value={filter.connector}
                                      effective={connectorEffective}
                                      onChange={(next) =>
                                        updateSearchFilter(filter.id, { connector: next })
                                      }
                                    />
                                    <span className="text-[11px] text-muted-foreground">
                                      {connectorEffective
                                        ? SEARCH_CONNECTOR_HINTS[filter.connector]
                                        : !isActive
                                          ? "Chưa áp dụng — điều kiện bên dưới còn trống"
                                          : "Chưa áp dụng — đây là mắt xích đầu tiên của chuỗi"}
                                    </span>
                                  </div>
                                </div>
                              ) : null}

                              <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 py-1">
                                <div className="flex justify-center">
                                  <span
                                    className={cn(
                                      "relative z-10 mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums",
                                      isActive
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-dashed bg-background text-muted-foreground",
                                    )}
                                  >
                                    {index + 1}
                                  </span>
                                </div>

                                <div
                                  className={cn(
                                    "min-w-0 rounded-md border bg-muted/20 p-2",
                                    isFirstActive && "border-primary/40 bg-primary/[0.04]",
                                    !isActive && "border-dashed",
                                  )}
                                >
                                  <div className="grid gap-2 sm:grid-cols-[minmax(110px,1fr)_104px_minmax(140px,1.4fr)_auto] sm:items-center">
                                    <Select
                                      value={filter.field}
                                      onValueChange={(value) => {
                                        const nextField = value as SearchFilterField
                                        updateSearchFilter(filter.id, {
                                          field: nextField,
                                          // Toán tử cũ có thể không hợp lệ với trường mới.
                                          operator: resolveSearchFilterOperator(
                                            nextField,
                                            filter.operator,
                                          ),
                                          value: "",
                                        })
                                      }}
                                    >
                                      <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {SEARCH_FILTER_FIELDS.map((item) => (
                                          <SelectItem key={item.id} value={item.id}>
                                            {item.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={filter.operator}
                                      disabled={SEARCH_FIELD_OPERATORS[filter.field].length < 2}
                                      onValueChange={(value) =>
                                        updateSearchFilter(filter.id, {
                                          operator: value as SearchFilterOperator,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {SEARCH_FIELD_OPERATORS[filter.field].map((operator) => (
                                          <SelectItem key={operator} value={operator}>
                                            {SEARCH_OPERATOR_LABELS[operator]}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {filter.field === "date" ? (
                                      <DatePicker
                                        value={isIsoDateValue(filter.value) ? filter.value : undefined}
                                        onChange={(next) =>
                                          updateSearchFilter(filter.id, { value: next ?? "" })
                                        }
                                        placeholder="Chọn ngày"
                                        allowClear
                                        className="h-9 text-xs"
                                      />
                                    ) : filter.field === "month" ? (
                                      <MonthPicker
                                        value={isYearMonthValue(filter.value) ? filter.value : undefined}
                                        onChange={(next) =>
                                          updateSearchFilter(filter.id, { value: next })
                                        }
                                        placeholder="Chọn tháng"
                                        className="h-9 text-xs"
                                      />
                                    ) : filter.field === "amountVnd" ? (
                                      <MoneyInput
                                        value={parseSearchNumber(filter.value) ?? 0}
                                        onValueChange={(next) =>
                                          updateSearchFilter(filter.id, {
                                            value: next > 0 ? String(next) : "",
                                          })
                                        }
                                        placeholder="VD: 100.000"
                                        className="h-9 text-xs"
                                      />
                                    ) : valueOptions ? (
                                      <SearchableSelect
                                        value={filter.value || undefined}
                                        onChange={(next) =>
                                          updateSearchFilter(filter.id, { value: next })
                                        }
                                        options={valueOptions}
                                        placeholder={`Chọn ${(field?.label ?? "giá trị").toLowerCase()}`}
                                        searchPlaceholder="Gõ để tìm..."
                                        ariaLabel={`Giá trị ${field?.label ?? ""}`}
                                        className="h-9 text-xs"
                                      />
                                    ) : (
                                      <Input
                                        className="h-9 text-xs"
                                        value={filter.value}
                                        placeholder={field?.hint ?? "Nhập giá trị"}
                                        onChange={(event) =>
                                          updateSearchFilter(filter.id, { value: event.target.value })
                                        }
                                      />
                                    )}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-9 px-2 text-muted-foreground hover:text-destructive"
                                      onClick={() => removeSearchFilter(filter.id)}
                                      aria-label="Xóa điều kiện"
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>

                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                                    {isFirstActive ? (
                                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-primary">
                                        Bắt đầu chuỗi
                                      </span>
                                    ) : null}
                                    {isActive ? (
                                      <span className="text-muted-foreground">
                                        Sau bước này còn{" "}
                                        <span className="font-semibold tabular-nums text-foreground">
                                          {stepCount ?? 0}
                                        </span>
                                        /{allVariableExpenses.length} giao dịch
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">
                                        Chưa nhập giá trị · điều kiện này bị bỏ qua
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          )
                        })}

                        {/* Nút kết thúc timeline: nối dài chuỗi lọc. */}
                        <li className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 pt-1">
                          <div className="flex justify-center">
                            <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-dashed bg-background text-muted-foreground">
                              <Plus className="h-3.5 w-3.5" />
                            </span>
                          </div>
                          <div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={addSearchFilter}
                            >
                              Thêm điều kiện
                            </Button>
                          </div>
                        </li>
                      </ol>
                    )}

                    {activeSearchFilterCount > 0 ? (
                      <div className="rounded-md border bg-muted/20 p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Diễn giải chuỗi lọc
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {activeSearchFilters.map((filter, index) => (
                            <span key={filter.id} className="flex items-center gap-1.5">
                              {index > 0 ? (
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-bold",
                                    SEARCH_CONNECTOR_CHIP[filter.connector],
                                  )}
                                >
                                  {SEARCH_CONNECTOR_LABELS[filter.connector]}
                                </span>
                              ) : null}
                              <span className="rounded border bg-background px-1.5 py-0.5">
                                {describeSearchCondition(filter, resolveSearchValueLabel)}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {searchHasMixedConnectors ? (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>
                          Chuỗi trộn AND và OR được duyệt lần lượt từ trên xuống, AND{" "}
                          <strong>không</strong> được ưu tiên trước OR. Đọc theo đúng thứ tự các mắt
                          xích trên timeline.
                        </span>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <div className="text-xs text-muted-foreground">
                        {activeSearchFilterCount === 0
                          ? "Chưa có điều kiện hợp lệ."
                          : searchResultExpenseIds
                            ? `${activeSearchFilterCount} điều kiện • ${searchFilteredExpenses.length}/${allVariableExpenses.length} giao dịch khớp`
                            : `${activeSearchFilterCount} điều kiện sẵn sàng • bấm Search để chạy`}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={activeSearchFilterCount === 0}
                          onClick={runSearch}
                        >
                          Search
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={config.search.filters.length === 0}
                          onClick={clearSearchFilters}
                        >
                          Xóa lọc
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="min-w-0">
                  <CardHeader className="space-y-1 pb-3">
                    <CardTitle className="text-base">Bố cục bảng</CardTitle>
                    <div className="text-xs text-muted-foreground">
                      Cấu hình hàng/cột riêng cho Search Data, không ảnh hưởng Pivot.
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Trường dữ liệu
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {SEARCH_LAYOUT_FIELDS.map((field) => {
                          const inRow = config.search.rowFields.includes(field.id)
                          const inColumn = config.search.columnFields.includes(field.id)
                          return (
                            <div
                              key={`search-field-${field.id}`}
                              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md border bg-muted/20 px-2 py-1.5"
                            >
                              <span className="truncate text-xs font-medium">{field.label}</span>
                              <Button
                                type="button"
                                size="sm"
                                variant={inRow ? "secondary" : "ghost"}
                                className="h-7 px-2 text-[11px]"
                                onClick={() => handleSearchAssign(field.id, "row")}
                              >
                                Hàng
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={inColumn ? "secondary" : "ghost"}
                                className="h-7 px-2 text-[11px]"
                                onClick={() => handleSearchAssign(field.id, "column")}
                              >
                                Cột
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="grid gap-3">
                      {renderSearchSelectedFields(config.search.rowFields, "row", "Hàng")}
                      {renderSearchSelectedFields(config.search.columnFields, "column", "Cột")}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {searchResultExpenseIds !== null ? (
                <Card className="min-w-0 overflow-hidden">
                  <CardContent className="min-w-0 space-y-2 p-2 sm:p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-base font-semibold">Kết quả Search Data</div>
                      <Badge variant="secondary">
                        {searchFilteredExpenses.length} giao dịch
                      </Badge>
                    </div>

                    {searchTable.rows.length === 0 ? (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Không có dữ liệu khớp điều kiện lọc.
                      </div>
                    ) : (
                      <div className="relative max-h-[560px] w-full max-w-full overflow-auto overscroll-x-contain rounded-md border border-border/80">
                        <table className="w-max min-w-full border-separate border-spacing-0 border border-border/80 text-xs sm:text-sm">
                          <thead className="sticky top-0 z-30 bg-muted text-xs uppercase text-muted-foreground shadow-[0_2px_0_rgba(0,0,0,0.08)]">
                            {searchColumnHeaderRows.map((headerRow, level) => (
                              <tr key={`search-head-${level}`} className="border-b border-border/70">
                                {level === 0
                                  ? searchRowHeaderLabels.map((label, index) => (
                                    <th
                                      key={`search-row-head-${index}`}
                                      rowSpan={searchColumnHeaderDepth}
                                      className="sticky top-0 z-40 whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-left font-medium sm:px-3"
                                      style={{
                                        left: `${searchRowStickyOffsets[index]}px`,
                                        minWidth: `${searchRowHeaderColWidth}px`,
                                        width: `${searchRowHeaderColWidth}px`,
                                      }}
                                    >
                                      <span
                                        className="block truncate"
                                        style={{ maxWidth: `${searchRowHeaderLabelWidth}px` }}
                                        title={label}
                                      >
                                        {label}
                                      </span>
                                    </th>
                                  ))
                                : null}
                              {headerRow.map((group) => (
                                <th
                                  key={group.key}
                                  colSpan={group.span}
                                  className="whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-center font-medium sm:px-3"
                                >
                                  <span
                                    className="block truncate"
                                    style={{ maxWidth: `${searchColumnHeaderLabelWidth}px` }}
                                    title={group.label}
                                  >
                                    {group.label}
                                  </span>
                                </th>
                              ))}
                              {level === 0 ? (
                                <th
                                  rowSpan={searchColumnHeaderDepth}
                                  className="sticky top-0 z-30 whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-right font-medium sm:px-3"
                                >
                                  Tổng
                                </th>
                              ) : null}
                            </tr>
                          ))}
                        </thead>
                        <tbody>
                          {searchTable.rows.map((row, rowIndex) => (
                            <tr key={row.key} className="bg-background">
                              {searchRowHeaderLabels.map((label, level) => {
                                const span = searchRowSpans[rowIndex]?.[level] ?? 0
                                if (span === 0) return null
                                const cellLabel = row.parts[level] ?? label
                                return (
                                  <td
                                    key={`${row.key}-search-row-${level}`}
                                    rowSpan={span}
                                    className="sticky z-10 border-b border-r border-border/60 bg-background px-2 py-2 align-top font-medium text-foreground sm:px-3"
                                    style={{
                                      left: `${searchRowStickyOffsets[level]}px`,
                                      minWidth: `${searchRowHeaderColWidth}px`,
                                      width: `${searchRowHeaderColWidth}px`,
                                    }}
                                  >
                                    <span
                                      className="block truncate"
                                      style={{ maxWidth: `${searchRowHeaderLabelWidth}px` }}
                                      title={cellLabel}
                                    >
                                      {cellLabel}
                                    </span>
                                  </td>
                                )
                              })}
                              {searchTable.cols.map((col) => (
                                <td
                                  key={`${row.key}-${col.key}`}
                                  className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right tabular-nums sm:px-3"
                                >
                                  {formatPivotValue(
                                    pivotMetricValue(searchTable.cells[row.key]?.[col.key], config.search.metric),
                                    config.search.metric,
                                  )}
                                </td>
                              ))}
                              <td className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-medium tabular-nums sm:px-3">
                                {formatPivotValue(
                                  pivotMetricValue(searchTable.rowTotals[row.key], config.search.metric),
                                  config.search.metric,
                                )}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-muted/40">
                            {searchRowHeaderLabels.map((label, level) => (
                              <td
                                key={`search-total-${level}`}
                                className="sticky z-10 border-b border-r border-border/60 bg-muted/40 px-2 py-2 font-medium sm:px-3"
                                style={{
                                  left: `${searchRowStickyOffsets[level]}px`,
                                  minWidth: `${searchRowHeaderColWidth}px`,
                                  width: `${searchRowHeaderColWidth}px`,
                                }}
                              >
                                {level === 0 ? "Tổng" : ""}
                              </td>
                            ))}
                            {searchTable.cols.map((col) => (
                              <td
                                key={`search-col-total-${col.key}`}
                                className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-medium tabular-nums sm:px-3"
                              >
                                {formatPivotValue(
                                  pivotMetricValue(searchTable.colTotals[col.key], config.search.metric),
                                  config.search.metric,
                                )}
                              </td>
                            ))}
                            <td className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-semibold tabular-nums sm:px-3">
                              {formatPivotValue(
                                pivotMetricValue(searchTable.grandTotal, config.search.metric),
                                config.search.metric,
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="pivot" className="min-w-0 space-y-3">
              <div className={cn("grid min-w-0 gap-4", pivotShowTable && pivotShowChart && "lg:grid-cols-2")}>
                {pivotShowTable ? (
                  <Card className="min-w-0 overflow-hidden">
                    <CardContent className="min-w-0 space-y-2 p-2 sm:p-3">
                      <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
                        <div className="text-base font-semibold">Bảng pivot</div>
                      </div>

                    {pivotTable.rows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        Chưa có dữ liệu để tạo pivot.
                      </div>
                    ) : (
                      <div className="relative max-h-[520px] w-full max-w-full overflow-auto overscroll-x-contain rounded-md border border-border/80">
                        <table className="w-max min-w-full border-separate border-spacing-0 border border-border/80 text-xs sm:text-sm">
                          <thead className="sticky top-0 z-30 bg-muted text-xs uppercase text-muted-foreground shadow-[0_2px_0_rgba(0,0,0,0.08)]">
                            {pivotColumnHeaderRows.map((headerRow, level) => (
                              <tr key={`pivot-head-${level}`} className="border-b border-border/70">
                                {level === 0
                                  ? pivotRowHeaderLabels.map((label, index) => (
                                      <th
                                        key={`pivot-row-head-${index}`}
                                        rowSpan={pivotColumnHeaderDepth}
                                        className="sticky top-0 z-40 whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-left font-medium sm:px-3"
                                        style={{
                                          left: `${pivotRowStickyOffsets[index]}px`,
                                          minWidth: `${pivotRowHeaderColWidth}px`,
                                          width: `${pivotRowHeaderColWidth}px`,
                                        }}
                                      >
                                        <span
                                          className="block truncate"
                                          style={{ maxWidth: `${pivotRowHeaderLabelWidth}px` }}
                                          title={label}
                                        >
                                          {label}
                                        </span>
                                      </th>
                                    ))
                                  : null}
                                {headerRow.map((group) => (
                                  (() => {
                                    const columnFieldAtLevel = config.pivot.columnFields[level]
                                    const hint =
                                      columnFieldAtLevel === "mssImpact"
                                        ? formatImpactRangeVndHint({
                                            label: group.label,
                                            baseVnd: budgets.mssVnd,
                                            ranges: PIVOT_MSS_IMPACT_RANGES,
                                          })
                                        : columnFieldAtLevel === "savingsImpact"
                                          ? formatImpactRangeVndHint({
                                              label: group.label,
                                              baseVnd: budgets.savingsTargetVnd,
                                              ranges: PIVOT_SAVINGS_IMPACT_RANGES,
                                            })
                                          : null

                                    return (
                                      <th
                                        key={group.key}
                                        colSpan={group.span}
                                        className="whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-center font-medium sm:px-3"
                                      >
                                        <span
                                          className="block truncate"
                                          style={{ maxWidth: `${pivotColumnHeaderLabelWidth}px` }}
                                          title={hint ? `${group.label} (${hint})` : group.label}
                                        >
                                          {group.label}
                                        </span>
                                        {hint ? (
                                          <span
                                            className="mt-0.5 block truncate text-[11px] font-normal tabular-nums text-muted-foreground/90"
                                            style={{ maxWidth: `${pivotColumnHeaderLabelWidth}px` }}
                                          >
                                            {hint}
                                          </span>
                                        ) : null}
                                      </th>
                                    )
                                  })()
                                ))}
                                {level === 0 ? (
                                  <th
                                    rowSpan={pivotColumnHeaderDepth}
                                    className="sticky top-0 z-30 whitespace-nowrap border-b border-r border-muted-foreground/25 bg-muted px-2 py-2 text-right font-medium sm:px-3"
                                  >
                                    Tổng
                                  </th>
                                ) : null}
                              </tr>
                            ))}
                          </thead>
                          <tbody>
                            {pivotTable.rows.map((row, rowIndex) => (
                              <tr key={row.key} className="bg-background">
                                {pivotRowHeaderLabels.map((label, level) => {
                                  const span = pivotRowSpans[rowIndex]?.[level] ?? 0
                                  if (span === 0) return null
                                  const cellLabel = row.parts[level] ?? label
                                  return (
                                    <td
                                      key={`${row.key}-row-${level}`}
                                      rowSpan={span}
                                      className="sticky z-10 border-b border-r border-border/60 bg-background px-2 py-2 align-top font-medium text-foreground sm:px-3"
                                      style={{
                                        left: `${pivotRowStickyOffsets[level]}px`,
                                        minWidth: `${pivotRowHeaderColWidth}px`,
                                        width: `${pivotRowHeaderColWidth}px`,
                                      }}
                                    >
                                      <span
                                        className="block truncate"
                                        style={{ maxWidth: `${pivotRowHeaderLabelWidth}px` }}
                                        title={cellLabel}
                                      >
                                        {cellLabel}
                                      </span>
                                    </td>
                                  )
                                })}
                                {pivotTable.cols.map((col) => {
                                  const value = getPivotDisplayCellValue(row.key, col.key)
                                  const style = pivotHeatmapScale
                                    ? pivotMoneyHeatmapStyle(
                                        value,
                                        pivotHeatmapScale.thresholds,
                                      )
                                    : undefined
                                  return (
                                    <td
                                      key={`${row.key}-${col.key}`}
                                      style={style}
                                      className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right tabular-nums transition-colors sm:px-3"
                                    >
                                      {formatPivotValue(value, config.pivot.metric)}
                                    </td>
                                  )
                                })}
                                {(() => {
                                  const value = pivotMetricValue(
                                    pivotTable.rowTotals[row.key],
                                    config.pivot.metric,
                                  )
                                  const style = pivotHeatmapScale
                                    ? pivotMoneyHeatmapStyle(
                                        value,
                                        pivotHeatmapScale.thresholds,
                                      )
                                    : undefined
                                  return (
                                    <td
                                      style={style}
                                      className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-medium tabular-nums transition-colors sm:px-3"
                                    >
                                      {formatPivotValue(value, config.pivot.metric)}
                                    </td>
                                  )
                                })()}
                              </tr>
                            ))}
                            <tr className="bg-muted/40">
                              {pivotRowHeaderLabels.map((label, level) => (
                                <td
                                  key={`pivot-total-${level}`}
                                  className="sticky z-10 border-b border-r border-border/60 bg-muted/40 px-2 py-2 font-medium sm:px-3"
                                  style={{
                                    left: `${pivotRowStickyOffsets[level]}px`,
                                    minWidth: `${pivotRowHeaderColWidth}px`,
                                    width: `${pivotRowHeaderColWidth}px`,
                                  }}
                                >
                                  {level === 0 ? "Tổng" : null}
                                </td>
                              ))}
                              {pivotTable.cols.map((col) => {
                                const value = pivotDisplayColTotals[col.key] ?? 0
                                const style = pivotHeatmapScale
                                  ? pivotMoneyHeatmapStyle(
                                      value,
                                      pivotHeatmapScale.thresholds,
                                    )
                                  : undefined
                                return (
                                  <td
                                    key={`total-${col.key}`}
                                    style={style}
                                    className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-medium tabular-nums transition-colors sm:px-3"
                                  >
                                    {formatPivotValue(value, config.pivot.metric)}
                                  </td>
                                )
                              })}
                              {(() => {
                                const value = pivotMetricValue(
                                  pivotTable.grandTotal,
                                  config.pivot.metric,
                                )
                                const style = pivotHeatmapScale
                                  ? pivotMoneyHeatmapStyle(
                                      value,
                                      pivotHeatmapScale.thresholds,
                                    )
                                  : undefined
                                return (
                                  <td
                                    style={style}
                                    className="whitespace-nowrap border-b border-r border-border/60 px-2 py-2 text-right font-semibold tabular-nums transition-colors sm:px-3"
                                  >
                                    {formatPivotValue(value, config.pivot.metric)}
                                  </td>
                                )
                              })()}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    </CardContent>
                  </Card>
                ) : null}

                {pivotShowChart ? (
                  <Card className="-mx-1 min-w-0 overflow-hidden sm:mx-0">
                    <CardContent className="min-w-0 space-y-2 p-1 sm:p-3">
                      <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
                        <div className="text-base font-semibold">Biểu đồ pivot</div>
                        {pivotHasColumns ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={resetPivotSeries}
                            >
                              Mặc định
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2"
                              onClick={showAllPivotSeries}
                            >
                              Hiện tất cả
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {showPivotBaseDailyCap || showPivotDynamicDailyCapLine ? (
                        <div className="hidden text-xs text-muted-foreground sm:block">
                          {showPivotBaseDailyCap ? (
                            <>
                              Nét đứt = Cap chi/ngày gốc đầu tháng (ngày 1):{" "}
                              <span className="font-semibold text-foreground whitespace-nowrap tabular-nums">
                                {formatVnd(baseDailyCapVnd)}
                              </span>
                            </>
                          ) : null}
                          {showPivotDynamicDailyCapLine ? (
                            <span>{showPivotBaseDailyCap ? " • " : ""}Nét liền = {PIVOT_DYNAMIC_DAILY_CAP_LABEL}</span>
                          ) : null}
                        </div>
                      ) : null}
                    <div className="h-[340px] sm:h-[460px]">
                      {pivotChartData.length === 0 ? (
                        <ChartEmptyState className="min-h-[340px] sm:min-h-[320px]" />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          {config.pivot.chartType === "bar" ? (
                            <ComposedChart
                              data={pivotChartData}
                              margin={reportChartMargin}
                              onClick={handlePivotChartTap}
                            >
                              <CartesianGrid {...chartGridProps} />
                              <XAxis
                                dataKey="name"
                                height={isNarrowViewport ? 24 : 30}
                                minTickGap={isNarrowViewport ? 18 : 5}
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={(v) =>
                                  isNarrowViewport ? shortenLabel(String(v), 6) : String(v)
                                }
                              />
                              <YAxis
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={formatMoneyAxisTick}
                                width={reportChartYAxisWidth}
                              />
                              <Tooltip
                                {...pivotTooltipProps}
                                cursor={false}
                                content={
                                  <ChartTooltipContent
                                    valueFormatter={(v) =>
                                      formatPivotValue(v, config.pivot.metric)
                                    }
                                    nameFormatter={(name) =>
                                      formatPivotSeriesDisplayName(name)
                                    }
                                  />
                                }
                              />
                              {showChartLegend &&
                              (pivotChartSeries.length > 1 ||
                                showPivotDynamicDailyCapLine ||
                                showPivotBaseDailyCap) ? (
                                <Legend
                                  {...chartLegendProps}
                                  onClick={(entry: { dataKey?: unknown; value?: unknown }) => {
                                    const key = String(entry.dataKey ?? entry.value ?? "")
                                    if (key) toggleLegendKey(key)
                                  }}
                                  formatter={(value, entry: { dataKey?: unknown }) => {
                                    const key = String(entry.dataKey ?? value ?? "")
                                    return renderLegendLabel(
                                      formatPivotSeriesLegendName(String(value)),
                                      key,
                                    )
                                  }}
                                />
                              ) : null}
                              {pivotChartSeries.map((series) => (
                                <Bar
                                  key={series.key}
                                  dataKey={series.key}
                                  stackId={
                                    pivotHasColumns && pivotChartSeries.length > 1
                                      ? "pivot"
                                      : undefined
                                  }
                                  fill={series.color}
                                  hide={isLegendKeyHidden(series.key)}
                                  radius={
                                    pivotHasColumns && pivotChartSeries.length > 1
                                      ? 0
                                      : [6, 6, 0, 0]
                                  }
                                />
                              ))}
                              {showPivotDynamicDailyCapLine ? (
                                <Line
                                  dataKey={PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_DYNAMIC_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-3))"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY)}
                                  type="monotone"
                                  isAnimationActive={false}
                                />
                              ) : null}
                              {showPivotBaseDailyCap ? (
                                <Line
                                  dataKey={PIVOT_BASE_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_BASE_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-4))"
                                  strokeDasharray="6 4"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_BASE_DAILY_CAP_DATA_KEY)}
                                  type="linear"
                                  isAnimationActive={false}
                                />
                              ) : null}
                            </ComposedChart>
                          ) : config.pivot.chartType === "area" ? (
                            <AreaChart
                              data={pivotChartData}
                              margin={reportChartMargin}
                              onClick={handlePivotChartTap}
                            >
                              <CartesianGrid {...chartGridProps} />
                              <XAxis
                                dataKey="name"
                                height={isNarrowViewport ? 24 : 30}
                                minTickGap={isNarrowViewport ? 18 : 5}
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={(v) =>
                                  isNarrowViewport ? shortenLabel(String(v), 6) : String(v)
                                }
                              />
                              <YAxis
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={formatMoneyAxisTick}
                                width={reportChartYAxisWidth}
                              />
                              <Tooltip
                                {...pivotTooltipProps}
                                cursor={false}
                                content={
                                  <ChartTooltipContent
                                    valueFormatter={(v) =>
                                      formatPivotValue(v, config.pivot.metric)
                                    }
                                    nameFormatter={(name) =>
                                      formatPivotSeriesDisplayName(name)
                                    }
                                  />
                                }
                              />
                              {showChartLegend &&
                              (pivotChartSeries.length > 1 ||
                                showPivotDynamicDailyCapLine ||
                                showPivotBaseDailyCap) ? (
                                <Legend
                                  {...chartLegendProps}
                                  onClick={(entry: { dataKey?: unknown; value?: unknown }) => {
                                    const key = String(entry.dataKey ?? entry.value ?? "")
                                    if (key) toggleLegendKey(key)
                                  }}
                                  formatter={(value, entry: { dataKey?: unknown }) => {
                                    const key = String(entry.dataKey ?? value ?? "")
                                    return renderLegendLabel(
                                      formatPivotSeriesLegendName(String(value)),
                                      key,
                                    )
                                  }}
                                />
                              ) : null}
                              {pivotChartSeries.map((series) => (
                                <Area
                                  key={series.key}
                                  dataKey={series.key}
                                  stroke={series.color}
                                  fill={series.color}
                                  fillOpacity={0.2}
                                  hide={isLegendKeyHidden(series.key)}
                                  type="monotone"
                                  stackId={
                                    pivotHasColumns && pivotChartSeries.length > 1
                                      ? "pivot"
                                      : undefined
                                  }
                                />
                              ))}
                              {showPivotDynamicDailyCapLine ? (
                                <Line
                                  dataKey={PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_DYNAMIC_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-3))"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY)}
                                  type="monotone"
                                  isAnimationActive={false}
                                />
                              ) : null}
                              {showPivotBaseDailyCap ? (
                                <Line
                                  dataKey={PIVOT_BASE_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_BASE_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-4))"
                                  strokeDasharray="6 4"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_BASE_DAILY_CAP_DATA_KEY)}
                                  type="linear"
                                  isAnimationActive={false}
                                />
                              ) : null}
                            </AreaChart>
                          ) : (
                            <LineChart
                              data={pivotChartData}
                              margin={reportChartMargin}
                              onClick={handlePivotChartTap}
                            >
                              <CartesianGrid {...chartGridProps} />
                              <XAxis
                                dataKey="name"
                                height={isNarrowViewport ? 24 : 30}
                                minTickGap={isNarrowViewport ? 18 : 5}
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={(v) =>
                                  isNarrowViewport ? shortenLabel(String(v), 6) : String(v)
                                }
                              />
                              <YAxis
                                tick={reportChartTick}
                                tickLine={!isNarrowViewport}
                                tickFormatter={formatMoneyAxisTick}
                                width={reportChartYAxisWidth}
                              />
                              <Tooltip
                                {...pivotTooltipProps}
                                cursor={false}
                                content={
                                  <ChartTooltipContent
                                    valueFormatter={(v) =>
                                      formatPivotValue(v, config.pivot.metric)
                                    }
                                    nameFormatter={(name) =>
                                      formatPivotSeriesDisplayName(name)
                                    }
                                  />
                                }
                              />
                              {showChartLegend &&
                              (pivotChartSeries.length > 1 ||
                                showPivotDynamicDailyCapLine ||
                                showPivotBaseDailyCap) ? (
                                <Legend
                                  {...chartLegendProps}
                                  onClick={(entry: { dataKey?: unknown; value?: unknown }) => {
                                    const key = String(entry.dataKey ?? entry.value ?? "")
                                    if (key) toggleLegendKey(key)
                                  }}
                                  formatter={(value, entry: { dataKey?: unknown }) => {
                                    const key = String(entry.dataKey ?? value ?? "")
                                    return renderLegendLabel(
                                      formatPivotSeriesLegendName(String(value)),
                                      key,
                                    )
                                  }}
                                />
                              ) : null}
                              {pivotChartSeries.map((series) => (
                                <Line
                                  key={series.key}
                                  dataKey={series.key}
                                  stroke={series.color}
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(series.key)}
                                  type="monotone"
                                />
                              ))}
                              {showPivotDynamicDailyCapLine ? (
                                <Line
                                  dataKey={PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_DYNAMIC_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-3))"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_DYNAMIC_DAILY_CAP_DATA_KEY)}
                                  type="monotone"
                                  isAnimationActive={false}
                                />
                              ) : null}
                              {showPivotBaseDailyCap ? (
                                <Line
                                  dataKey={PIVOT_BASE_DAILY_CAP_DATA_KEY}
                                  name={PIVOT_BASE_DAILY_CAP_LABEL}
                                  stroke="hsl(var(--chart-4))"
                                  strokeDasharray="6 4"
                                  strokeWidth={2}
                                  dot={false}
                                  hide={isLegendKeyHidden(PIVOT_BASE_DAILY_CAP_DATA_KEY)}
                                  type="linear"
                                  isAnimationActive={false}
                                />
                              ) : null}
                            </LineChart>
                          )}
                        </ResponsiveContainer>
                      )}
                    </div>
                    {pivotHasColumns ? (
                      <div className="rounded-md border bg-muted/20 px-2 py-2">
                        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                          {pivotAvailableSeries.map((col) => {
                            const active = pivotSeriesKeySet.has(col.key)
                            const color =
                              pivotSeriesColorByKey.get(col.key) ?? CHART_COLORS[0]
                            return (
                              <button
                                key={col.key}
                                type="button"
                                onClick={() => togglePivotSeries(col.key)}
                                title={col.label}
                                className={cn(
                                  "flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition",
                                  active
                                    ? "border-primary/60 bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground",
                                )}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="max-w-[140px] truncate">{col.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                    {pivotChartLimited || pivotChartSeriesLimited ? (
                      <div className="text-xs text-muted-foreground">
                        {pivotChartLimited
                          ? `Biểu đồ hiển thị top ${pivotChartLimit} theo giá trị. `
                          : ""}
                        {pivotChartSeriesLimited
                          ? pivotUsingDefaultSeries
                            ? `Đang hiển thị top ${pivotChartColumns.length}/${pivotAvailableSeries.length} cột.`
                            : `Đang hiển thị ${pivotChartColumns.length}/${pivotAvailableSeries.length} cột.`
                          : ""}
                      </div>
                    ) : null}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

