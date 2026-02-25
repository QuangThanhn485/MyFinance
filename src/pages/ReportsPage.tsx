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
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  BarChart3,
  Columns2,
  Info,
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import DndMultiSelect from "@/components/DndMultiSelect"
import LabelValueRow from "@/components/LabelValueRow"
import MonthPicker from "@/components/MonthPicker"
import { BUCKET_LABELS_VI, CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import { computeBudgets } from "@/domain/finance/finance"
import { computeAdvancedInsights, type ClusterTier } from "@/domain/finance/insights"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import { formatVnd } from "@/lib/currency"
import {
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
  parseIsoDateLocal,
  previousMonth,
  todayIso,
} from "@/lib/date"
import { getCategoryTotals, getExpensesByMonth, getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import type { Expense, YearMonth } from "@/domain/types"
import {
  defaultReportsConfig,
  loadReportsConfig,
  saveReportsConfig,
  type DailySeriesKey,
  type MonthBucketKey,
  type PivotChartType,
  type PivotGroupKey,
  type PivotMetric,
  type TrendRangeMonths,
  type TrendSeriesKey,
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
  // High-contrast, mostly color-blind-friendly palette (avoid light yellows on white).
  "#2563eb", // blue
  "#16a34a", // green
  "#dc2626", // red
  "#7c3aed", // purple
  "#0ea5e9", // sky
  "#f97316", // orange
  "#b45309", // amber (darker)
  "#0f766e", // teal (darker)
  "#db2777", // pink
  "#4d7c0f", // lime (darker)
  "#4f46e5", // indigo
  "#be123c", // rose (darker)
  "#0369a1", // blue-cyan (darker)
  "#6d28d9", // violet (darker)
  "#15803d", // green (darker)
  "#c2410c", // burnt orange
]

function pivotSeriesColor(index: number) {
  if (index < PIVOT_SERIES_PALETTE.length) {
    return PIVOT_SERIES_PALETTE[index]
  }
  const hue = (index * 137.508 + 18) % 360
  // Keep all generated colors sufficiently dark for white backgrounds.
  const saturation = 72
  const lightness = 45
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`
}

const MONTH_BUCKET_KEYS: MonthBucketKey[] = ["needs", "wants", "saved"]

const MONTH_BUCKET_LABELS: Record<MonthBucketKey, string> = {
  needs: "Thiết yếu",
  wants: "Mong muốn",
  saved: "Dư (Thu - Chi)",
}

const TREND_SERIES_KEYS: TrendSeriesKey[] = [
  "totalSpent",
  "needsSpent",
  "wantsSpent",
  "fixedCosts",
  "variableSpent",
  "balance",
]

const TREND_SERIES_LABELS: Record<TrendSeriesKey, string> = {
  totalSpent: "Tổng chi",
  needsSpent: "Thiết yếu",
  wantsSpent: "Mong muốn",
  fixedCosts: "Chi phí cố định",
  variableSpent: "Chi biến đổi",
  balance: "Dư/Thiếu (Thu - Chi)",
}

const TREND_SERIES_COLORS: Record<TrendSeriesKey, string> = {
  totalSpent: CHART_COLORS[0],
  needsSpent: CHART_COLORS[1],
  wantsSpent: CHART_COLORS[2],
  fixedCosts: CHART_COLORS[3],
  variableSpent: CHART_COLORS[4],
  balance: CHART_COLORS[5],
}

const DAILY_SERIES_KEYS: DailySeriesKey[] = ["total", "needs", "wants"]

const DAILY_SERIES_LABELS: Record<DailySeriesKey, string> = {
  total: "Tổng chi",
  needs: "Thiết yếu",
  wants: "Mong muốn",
}

const DAILY_SERIES_COLORS: Record<DailySeriesKey, string> = {
  total: CHART_COLORS[0],
  needs: CHART_COLORS[1],
  wants: CHART_COLORS[2],
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
  { id: "amountRange", label: "Mức chi" },
  { id: "savingsImpact", label: "Ảnh hưởng S" },
  { id: "mssImpact", label: "Ảnh hưởng MSS" },
]
const PIVOT_ROW_HEADER_COL_WIDTH = 160
type PivotDragContainer = "available" | "row" | "column"
type PivotDragData = { field: PivotGroupKey; container: PivotDragContainer }
const PIVOT_WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
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
    case "day": {
      const day = dayOfMonthFromIsoDate(expense.date)
      const label = `Ngày ${String(day).padStart(2, "0")}`
      return {
        key: `day-${day}`,
        label,
        parts: [label],
        sortValue: day,
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
      const label = CATEGORY_LABELS_VI[expense.category]
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
    { bg: "rgba(16,185,129,0.22)", accent: "rgba(16,185,129,0.75)" }, // emerald
    { bg: "rgba(132,204,22,0.22)", accent: "rgba(132,204,22,0.75)" }, // lime
    { bg: "rgba(245,158,11,0.24)", accent: "rgba(245,158,11,0.78)" }, // amber
    { bg: "rgba(249,115,22,0.26)", accent: "rgba(249,115,22,0.82)" }, // orange
    { bg: "rgba(244,63,94,0.28)", accent: "rgba(244,63,94,0.82)" }, // rose
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
    rowPrimary === "day" ||
    rowPrimary === "week" ||
    rowPrimary === "weekday" ||
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
    colPrimary === "day" ||
    colPrimary === "week" ||
    colPrimary === "weekday" ||
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
  const [month, setMonth] = useState<YearMonth>(monthFromIsoDate(todayIso()))
  const [config, setConfig] = useState(() => loadReportsConfig())
  const [controlsOpen, setControlsOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [pivotSplitView, setPivotSplitView] = useState<"both" | "table" | "chart">("both")
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

  const totals = useMemo(() => getMonthTotals(data, month), [data, month])
  const categories = useMemo(() => getCategoryTotals(data, month), [data, month])
  const expenses = useMemo(() => getExpensesByMonth(data, month), [data, month])

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
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })
  const savingsMin = budgets.savingsTargetVnd
  const saved = budgets.incomeVnd - totals.totalSpent
  const savingsRate = budgets.incomeVnd > 0 ? saved / budgets.incomeVnd : 0

  const monthCategoryAutoIds = useMemo(() => {
    return EXPENSE_CATEGORIES.map((c) => ({
      id: c,
      value: categories[c] ?? 0,
    }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
      .map((x) => x.id)
  }, [categories])

  const selectedCategoryIds =
    config.month.visibleCategories.length > 0
      ? config.month.visibleCategories
      : monthCategoryAutoIds

  const monthCategoryRows = selectedCategoryIds
    .map((c) => ({
      id: c,
      name: CATEGORY_LABELS_VI[c],
      value: categories[c] ?? 0,
    }))
    .filter((x) => x.value > 0)

  const monthBucketValueByKey: Record<MonthBucketKey, number> = {
    needs: totals.fixedCostsTotal + totals.variableNeeds,
    wants: totals.variableWants,
    saved,
  }

  const monthBucketRows = config.month.visibleBuckets
    .map((k) => ({
      id: k,
      name: MONTH_BUCKET_LABELS[k],
      value: monthBucketValueByKey[k],
    }))
    .filter((x) => x.value > 0)

  const trendMonths = useMemo(() => {
    const count = config.trend.rangeMonths
    const out: YearMonth[] = []
    let cursor = month
    for (let i = 0; i < count; i += 1) {
      out.push(cursor)
      cursor = previousMonth(cursor)
    }
    return out.reverse()
  }, [config.trend.rangeMonths, month])

  const trendData = useMemo(() => {
    return trendMonths.map((m) => {
      const I = getMonthlyIncomeTotalVnd(getEffectiveSettingsForMonth(data, m))
      const t = getMonthTotals(data, m)
      const balance = I - t.totalSpent
      return {
        month: m,
        totalSpent: t.totalSpent,
        needsSpent: t.fixedCostsTotal + t.variableNeeds,
        wantsSpent: t.variableWants,
        fixedCosts: t.fixedCostsTotal,
        variableSpent: t.variableTotal,
        balance,
      }
    })
  }, [data, trendMonths])

  const today = todayIso()

  const dailyData = useMemo(() => {
    const monthLength = daysInMonth(month)
    const maxExpenseDay = expenses.reduce((max, e) => {
      return Math.max(max, dayOfMonthFromIsoDate(e.date))
    }, 1)

    const isCurrentMonth = month === monthFromIsoDate(today)
    const lastDay = isCurrentMonth
      ? Math.min(monthLength, Math.max(dayOfMonthFromIsoDate(today), maxExpenseDay))
      : Math.min(monthLength, Math.max(1, maxExpenseDay))

    const rows = Array.from({ length: lastDay }, (_, idx) => ({
      day: idx + 1,
      total: 0,
      needs: 0,
      wants: 0,
    }))

    for (const e of expenses) {
      const d = dayOfMonthFromIsoDate(e.date)
      if (d < 1 || d > lastDay) continue
      rows[d - 1].total += e.amountVnd
      if (e.bucket === "needs") rows[d - 1].needs += e.amountVnd
      else rows[d - 1].wants += e.amountVnd
    }

    return rows
  }, [expenses, month, today])

  const advancedInsights = useMemo(
    () => computeAdvancedInsights({ expenses, month, today }),
    [expenses, month, today],
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
        },
      ),
    [
      expenses,
      config.pivot.rowFields,
      config.pivot.columnFields,
      config.pivot.metric,
      budgets.savingsTargetVnd,
      budgets.mssVnd,
    ],
  )
  const pivotChartPrimary = config.pivot.rowFields[0]
  const pivotChartLimit =
    pivotChartPrimary === "day" || pivotChartPrimary === "week" ? 31 : 8
  const pivotChartRows = pivotTable.rows.slice(0, pivotChartLimit)
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
  const pivotChartData = pivotChartRows.map((row) => {
    const label =
      pivotChartPrimary === "day"
        ? String(row.sortValue).padStart(2, "0")
        : pivotChartPrimary === "week"
          ? `W${row.sortValue}`
          : shortenLabel(row.label, 16)
    if (!pivotHasColumns) {
      const value = pivotMetricValue(
        pivotTable.rowTotals[row.key],
        config.pivot.metric,
      )
      return { name: label, value }
    }
    const entry: Record<string, number | string> = { name: label }
    pivotChartSeries.forEach((series) => {
      const cell = pivotTable.cells[row.key]?.[series.colKey]
      entry[series.key] = pivotMetricValue(cell, config.pivot.metric)
    })
    return entry
  })
  const pivotChartLimited = pivotTable.rows.length > pivotChartLimit
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
  const pivotRowStickyOffsets = pivotRowHeaderLabels.map(
    (_, idx) => idx * PIVOT_ROW_HEADER_COL_WIDTH,
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

  const top3 = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

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

  const prev = previousMonth(month)
  const prevTotals = getMonthTotals(data, prev)
  const hasPrev = prevTotals.totalSpent > 0
  const delta = totals.totalSpent - prevTotals.totalSpent
  const deltaPct =
    hasPrev && prevTotals.totalSpent > 0 ? delta / prevTotals.totalSpent : 0

  const showDailyTotal = config.daily.visibleSeries.includes("total")
  const showDailyNeeds = config.daily.visibleSeries.includes("needs")
  const showDailyWants = config.daily.visibleSeries.includes("wants")

  const monthTableRows = config.month.dataset === "categories" ? monthCategoryRows : monthBucketRows
  const monthTableTotal = monthTableRows.reduce((sum, row) => sum + row.value, 0)
  const dailyTableSeries =
    config.daily.visibleSeries.length > 0
      ? config.daily.visibleSeries
      : (["total"] as DailySeriesKey[])
  const trendTableSeries =
    config.trend.visibleSeries.length > 0
      ? config.trend.visibleSeries
      : (["totalSpent"] as TrendSeriesKey[])

  const panelBaseClassName =
    "left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-none max-h-[85dvh] rounded-t-xl border-0 border-t p-4 data-[state=open]:[--tw-enter-scale:1] data-[state=closed]:[--tw-exit-scale:1] sm:left-auto sm:right-0 sm:top-0 sm:bottom-auto sm:h-dvh sm:max-h-none sm:rounded-none sm:rounded-l-xl sm:border-l sm:border-t-0 sm:p-6 data-[state=open]:slide-in-from-bottom-2 sm:data-[state=open]:slide-in-from-right-2 data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=closed]:slide-out-to-right-2"
  const controlsPanelClassName = cn(
    panelBaseClassName,
    "p-3 sm:p-4 sm:w-[50vw] sm:min-w-[560px]",
  )
  const insightsPanelClassName = cn(panelBaseClassName, "sm:w-[80vw] sm:min-w-[720px]")
  const summaryPanelClassName = cn(panelBaseClassName, "sm:w-[50vw] sm:min-w-[560px]")

  const pivotShowTable = pivotSplitView !== "chart"
  const pivotShowChart = pivotSplitView !== "table"

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="shrink-0 text-xl font-semibold tracking-tight">Báo cáo</h1>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
            <Badge variant="outline" className="whitespace-nowrap">
              Thu nhập:{" "}
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
                So với {prev}: {delta >= 0 ? "+" : ""}
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

        <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
          <div className="text-sm text-muted-foreground">Tháng</div>
          <MonthPicker value={month} onChange={setMonth} className="w-[140px]" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-2"
            onClick={() => setSummaryOpen(true)}
          >
            <Info className="h-4 w-4" />
            Tóm tắt
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-2"
            onClick={() => setInsightsOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            Insight
          </Button>
        </div>
      </div>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className={cn(summaryPanelClassName, "overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Tóm tắt tháng
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium">Tổng chi</div>
                <div className="text-lg font-semibold whitespace-nowrap tabular-nums">
                  {formatVnd(totals.totalSpent)}
                </div>
              </div>
              <div className="mt-2 grid gap-1 text-sm">
                <LabelValueRow
                  label="Dư/Thiếu (Thu - Chi)"
                  value={formatVnd(saved)}
                />
                <LabelValueRow
                  label="Tỉ lệ tiết kiệm (ước tính)"
                  value={`${(savingsRate * 100).toFixed(1)}%`}
                />
                <LabelValueRow
                  label="Mục tiêu tiết kiệm theo kế hoạch"
                  value={formatVnd(savingsMin)}
                />
              </div>
            </div>

            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium">Xu hướng so với tháng trước</div>
                {hasPrev ? (
                  <div
                    className={cn(
                      "text-lg font-semibold whitespace-nowrap tabular-nums",
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
                    label={`Tháng trước (${prev})`}
                    value={formatVnd(prevTotals.totalSpent)}
                  />
                  <LabelValueRow
                    label="Tỉ lệ thay đổi"
                    value={`${deltaPct >= 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%`}
                  />
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">
                  Chưa có dữ liệu tháng trước để so sánh.
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
                  Kỳ phân tích = tháng đang chọn (đến hôm nay nếu là tháng hiện tại). Nhịp được tính trên các ngày có chi biến đổi.
                </div>
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
                                {tier.count}/{advancedInsights.activeDays} ngày
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
                                CATEGORY_LABELS_VI[item.category] ?? item.category
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
                    Chưa đủ dữ liệu để phân cụm (cần tối thiểu 7 ngày trong tháng và
                    4 ngày có chi).
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Tổ hợp danh mục</div>
                  <Badge variant="outline">Theo ngày</Badge>
                </div>
                {advancedInsights.association ? (
                  <>
                    <div className="mt-3 rounded-md border bg-background/70 p-3">
                      <div className="text-xs text-muted-foreground">
                        Cặp thường đi cùng
                      </div>
                      <div className="mt-1 text-base font-semibold">
                        {`${CATEGORY_LABELS_VI[advancedInsights.association.base] ?? advancedInsights.association.base} + ${CATEGORY_LABELS_VI[advancedInsights.association.with] ?? advancedInsights.association.with}`}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2">
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
                    Chưa đủ dữ liệu để rút ra tổ hợp ổn định.
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
            {config.mode === "month" ? (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Select
                    value={config.month.dataset}
                    onValueChange={(v) =>
                      setConfig((s) => ({
                        ...s,
                        month: {
                          ...s.month,
                          dataset: v === "buckets" ? "buckets" : "categories",
                        },
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn dữ liệu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="categories">Theo danh mục</SelectItem>
                      <SelectItem value="buckets">Theo bucket</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    Kéo thả để thêm/bớt và sắp xếp thứ tự.
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const defaults = defaultReportsConfig()
                      setConfig((s) => ({
                        ...s,
                        month: {
                          ...s.month,
                          chartType: defaults.month.chartType,
                          visibleCategories: [],
                          visibleBuckets: defaults.month.visibleBuckets,
                        },
                      }))
                    }}
                  >
                    Reset
                  </Button>
                </div>

                {config.month.dataset === "categories" ? (
                  <DndMultiSelect
                    allIds={EXPENSE_CATEGORIES}
                    selectedIds={selectedCategoryIds}
                    onSelectedIdsChange={(next) =>
                      setConfig((s) => ({
                        ...s,
                        month: { ...s.month, visibleCategories: next },
                      }))
                    }
                    getLabel={(id) => CATEGORY_LABELS_VI[id]}
                    availableTitle="Danh mục"
                    selectedTitle={
                      config.month.visibleCategories.length > 0
                        ? "Đang hiển thị"
                        : "Đang hiển thị (tự động: top)"
                    }
                  />
                ) : (
                  <DndMultiSelect
                    allIds={MONTH_BUCKET_KEYS}
                    selectedIds={config.month.visibleBuckets}
                    onSelectedIdsChange={(next) =>
                      setConfig((s) => ({
                        ...s,
                        month: { ...s.month, visibleBuckets: next },
                      }))
                    }
                    getLabel={(id) => MONTH_BUCKET_LABELS[id]}
                    availableTitle="Bucket"
                    selectedTitle="Đang hiển thị"
                  />
                )}

                <div className="text-xs text-muted-foreground">
                  Ghi chú: “Theo danh mục” cộng cả chi phí cố định (vd. Hóa đơn).
                </div>
              </div>
            ) : config.mode === "daily" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const defaults = defaultReportsConfig()
                      setConfig((s) => ({ ...s, daily: defaults.daily }))
                    }}
                  >
                    Reset
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Theo tổng ngày (từ đầu tháng), chỉ tính chi biến đổi đã ghi.
                </div>

                <DndMultiSelect
                  allIds={DAILY_SERIES_KEYS}
                  selectedIds={config.daily.visibleSeries}
                  onSelectedIdsChange={(next) =>
                    setConfig((s) => ({
                      ...s,
                      daily: { ...s.daily, visibleSeries: next },
                    }))
                  }
                  getLabel={(id) => DAILY_SERIES_LABELS[id]}
                  availableTitle="Chỉ số"
                  selectedTitle="Đang hiển thị"
                />
              </div>
            ) : config.mode === "trend" ? (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Select
                    value={String(config.trend.rangeMonths)}
                    onValueChange={(v) => {
                      const n = Number(v)
                      const next: TrendRangeMonths | null =
                        n === 3 || n === 6 || n === 12 ? (n as TrendRangeMonths) : null
                      setConfig((s) => ({
                        ...s,
                        trend: {
                          ...s.trend,
                          rangeMonths: next ?? s.trend.rangeMonths,
                        },
                      }))
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Khoảng thời gian" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 tháng gần nhất</SelectItem>
                      <SelectItem value="6">6 tháng gần nhất</SelectItem>
                      <SelectItem value="12">12 tháng gần nhất</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    Kéo thả để thêm/bớt và sắp xếp thứ tự.
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const defaults = defaultReportsConfig()
                      setConfig((s) => ({ ...s, trend: defaults.trend }))
                    }}
                  >
                    Reset
                  </Button>
                </div>

                <DndMultiSelect
                  allIds={TREND_SERIES_KEYS}
                  selectedIds={config.trend.visibleSeries}
                  onSelectedIdsChange={(next) =>
                    setConfig((s) => ({
                      ...s,
                      trend: { ...s.trend, visibleSeries: next },
                    }))
                  }
                  getLabel={(id) => TREND_SERIES_LABELS[id]}
                  availableTitle="Chỉ số"
                  selectedTitle="Đang hiển thị"
                />
              </div>
            ) : config.mode === "pivot" ? (
              <div className="space-y-3">
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-semibold">Bố cục Pivot</div>
                      <div className="text-xs text-muted-foreground">
                        Kéo chip vào Hàng/Cột. Kéo để đổi thứ tự.
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
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

                    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/70 px-3 py-2">
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
                        {PIVOT_FIELDS.find((f) => f.id === activePivotField)?.label ?? ""}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
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
        <CardContent className="space-y-3">
          <Tabs
            value={config.mode}
            onValueChange={(v) =>
              setConfig((s) => ({
                ...s,
                mode:
                  v === "trend"
                    ? "trend"
                    : v === "daily"
                      ? "daily"
                      : v === "pivot"
                        ? "pivot"
                        : "month",
              }))
            }
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 overflow-x-auto pb-1">
                <TabsList className="w-max justify-start">
                  <TabsTrigger value="month">Phân bổ (tháng)</TabsTrigger>
                  <TabsTrigger value="daily">Theo ngày</TabsTrigger>
                  <TabsTrigger value="trend">Xu hướng</TabsTrigger>
                  <TabsTrigger value="pivot">Pivot</TabsTrigger>
                </TabsList>
              </div>
              {config.mode === "month" ? (
                <Select
                  value={config.month.chartType}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      month: { ...s.month, chartType: v === "pie" ? "pie" : "bar" },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[140px] sm:w-[170px]">
                    <SelectValue placeholder="Biểu đồ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bar">Cột (Bar)</SelectItem>
                    <SelectItem value="pie">Tròn (Pie)</SelectItem>
                  </SelectContent>
                </Select>
              ) : config.mode === "daily" ? (
                <Select
                  value={config.daily.chartType}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      daily: {
                        ...s.daily,
                        chartType: v === "line" ? "line" : v === "area" ? "area" : "bar",
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[140px] sm:w-[170px]">
                    <SelectValue placeholder="Biểu đồ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bar">Cột (Bar)</SelectItem>
                    <SelectItem value="line">Đường (Line)</SelectItem>
                    <SelectItem value="area">Vùng (Area)</SelectItem>
                  </SelectContent>
                </Select>
              ) : config.mode === "trend" ? (
                <Select
                  value={config.trend.chartType}
                  onValueChange={(v) =>
                    setConfig((s) => ({
                      ...s,
                      trend: {
                        ...s.trend,
                        chartType: v === "bar" ? "bar" : v === "area" ? "area" : "line",
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-[140px] sm:w-[170px]">
                    <SelectValue placeholder="Biểu đồ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="line">Đường (Line)</SelectItem>
                    <SelectItem value="area">Vùng (Area)</SelectItem>
                    <SelectItem value="bar">Cột (Bar)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
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
                  <SelectTrigger className="h-9 w-[140px] sm:w-[170px]">
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
                  <SelectTrigger className="h-9 w-[150px] sm:w-[190px]">
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
                <div className="inline-flex items-center rounded-md border bg-background p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={pivotSplitView === "table" ? "secondary" : "ghost"}
                    className="h-8 gap-2 px-2"
                    title="Chỉ xem bảng pivot"
                    onClick={() => setPivotSplitView("table")}
                  >
                    <Table className="h-4 w-4" />
                    <span className="hidden sm:inline">Bảng</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={pivotSplitView === "both" ? "secondary" : "ghost"}
                    className="h-8 gap-2 px-2"
                    title="Chia đôi bảng + biểu đồ"
                    onClick={() => setPivotSplitView("both")}
                  >
                    <Columns2 className="h-4 w-4" />
                    <span className="hidden sm:inline">50/50</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={pivotSplitView === "chart" ? "secondary" : "ghost"}
                    className="h-8 gap-2 px-2"
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
                className="h-9 gap-2 shrink-0"
                onClick={() => setControlsOpen(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Tùy chỉnh
              </Button>
            </div>

            <TabsContent value="month" className="space-y-3">
              {/*
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={config.month.dataset}
                    onValueChange={(v) =>
                      setConfig((s) => ({
                        ...s,
                        month: { ...s.month, dataset: v === "buckets" ? "buckets" : "categories" },
                      }))
                    }
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Chọn dữ liệu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="categories">Theo danh mục</SelectItem>
                      <SelectItem value="buckets">Theo bucket</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={config.month.chartType}
                    onValueChange={(v) =>
                      setConfig((s) => ({
                        ...s,
                        month: { ...s.month, chartType: v === "pie" ? "pie" : "bar" },
                      }))
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Chọn loại biểu đồ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Cột (Bar)</SelectItem>
                      <SelectItem value="pie">Tròn (Pie)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const defaults = defaultReportsConfig()
                    setConfig((s) => ({
                      ...s,
                      month: {
                        ...s.month,
                        chartType: defaults.month.chartType,
                        visibleCategories: [],
                        visibleBuckets: defaults.month.visibleBuckets,
                      },
                    }))
                  }}
                >
                  Reset
                </Button>
              </div>
              */}

              {/*
              {config.month.dataset === "categories" ? (
                <DndMultiSelect
                  allIds={EXPENSE_CATEGORIES}
                  selectedIds={selectedCategoryIds}
                  onSelectedIdsChange={(next) =>
                    setConfig((s) => ({
                      ...s,
                      month: { ...s.month, visibleCategories: next },
                    }))
                  }
                  getLabel={(id) => CATEGORY_LABELS_VI[id]}
                  availableTitle="Danh mục"
                  selectedTitle={
                    config.month.visibleCategories.length > 0
                      ? "Đang hiển thị"
                      : "Đang hiển thị (tự động: top)"
                  }
                />
              ) : (
                <DndMultiSelect
                  allIds={MONTH_BUCKET_KEYS}
                  selectedIds={config.month.visibleBuckets}
                  onSelectedIdsChange={(next) =>
                    setConfig((s) => ({
                      ...s,
                      month: { ...s.month, visibleBuckets: next },
                    }))
                  }
                  getLabel={(id) => MONTH_BUCKET_LABELS[id]}
                  availableTitle="Bucket"
                  selectedTitle="Đang hiển thị"
                />
              )}
              */}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="h-[320px]">
                {config.month.dataset === "categories" ? (
                  monthCategoryRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Chưa có dữ liệu để vẽ biểu đồ.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      {config.month.chartType === "pie" ? (
                        <PieChart>
                          <Tooltip cursor={false} formatter={(v) => formatVnd(Number(v))} />
                          <Legend />
                          <Pie
                            data={monthCategoryRows}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={110}
                            labelLine={false}
                            label={(p) =>
                              `${shortenLabel(String(p.name), 12)} ${(p.percent * 100).toFixed(0)}%`
                            }
                          >
                            {monthCategoryRows.map((_, idx) => (
                              <Cell
                                key={`cat-${idx}`}
                                fill={CHART_COLORS[idx % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                        </PieChart>
                      ) : (
                        <BarChart
                          data={monthCategoryRows}
                          layout="vertical"
                          margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            type="number"
                            tickFormatter={(v) =>
                              new Intl.NumberFormat("vi-VN").format(Number(v))
                            }
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={130}
                            tickFormatter={(v) => shortenLabel(String(v), 18)}
                          />
                          <Tooltip formatter={(v) => formatVnd(Number(v))} />
                          <Legend />
                          <Bar dataKey="value" name="VND" radius={[0, 6, 6, 0]}>
                            {monthCategoryRows.map((_, idx) => (
                              <Cell
                                key={`bar-${idx}`}
                                fill={CHART_COLORS[idx % CHART_COLORS.length]}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  )
                ) : monthBucketRows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Chưa có dữ liệu để vẽ biểu đồ.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {config.month.chartType === "pie" ? (
                      <PieChart>
                        <Tooltip cursor={false} formatter={(v) => formatVnd(Number(v))} />
                        <Legend />
                        <Pie
                          data={monthBucketRows}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={110}
                          labelLine={false}
                          label={(p) =>
                            `${shortenLabel(String(p.name), 12)} ${(p.percent * 100).toFixed(0)}%`
                          }
                        >
                          {monthBucketRows.map((_, idx) => (
                            <Cell
                              key={`bucket-${idx}`}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    ) : (
                      <BarChart data={monthBucketRows} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name"
                          tickFormatter={(v) => shortenLabel(String(v), 14)}
                        />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip formatter={(v) => formatVnd(Number(v))} />
                        <Legend />
                        <Bar dataKey="value" name="VND" radius={[6, 6, 0, 0]}>
                          {monthBucketRows.map((_, idx) => (
                            <Cell
                              key={`bucket-bar-${idx}`}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                )}
                </div>

                <div className="rounded-md border bg-background">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="text-sm font-medium truncate">
                      {config.month.dataset === "categories" ? "Danh mục" : "Bucket"}
                    </div>
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {monthTableRows.length} mục
                    </Badge>
                  </div>
                  {monthTableRows.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-muted-foreground">
                      Chưa có dữ liệu để hiển thị bảng.
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-muted/40">
                          <tr className="border-b">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground truncate">
                              Tên
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap tabular-nums">
                              Số tiền
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap tabular-nums">
                              Tỷ lệ
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthTableRows.map((row) => (
                            <tr key={row.name} className="border-b last:border-b-0">
                              <td className="px-3 py-2 truncate" title={row.name}>
                                {row.name}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                                {formatVnd(row.value)}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                                {monthTableTotal > 0
                                  ? `${Math.round((row.value / monthTableTotal) * 100)}%`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/*
              <div className="text-xs text-muted-foreground">
                Ghi chú: “Chi theo danh mục” đã cộng cả chi phí cố định vào danh mục tương ứng (vd. Hóa đơn).
              </div>
              */}
            </TabsContent>

            <TabsContent value="daily" className="space-y-3">
              {/*
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={config.daily.chartType}
                    onValueChange={(v) =>
                      setConfig((s) => ({
                        ...s,
                        daily: {
                          ...s.daily,
                          chartType: v === "line" ? "line" : v === "area" ? "area" : "bar",
                        },
                      }))
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Loại biểu đồ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Cột (Bar)</SelectItem>
                      <SelectItem value="line">Đường (Line)</SelectItem>
                      <SelectItem value="area">Vùng (Area)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const defaults = defaultReportsConfig()
                    setConfig((s) => ({ ...s, daily: defaults.daily }))
                  }}
                >
                  Reset
                </Button>
              </div>
              */}

              <div className="text-xs text-muted-foreground">
                Chi theo từng ngày (từ đầu tháng), chỉ tính chi biến đổi đã ghi.
              </div>

              {/*
              <DndMultiSelect
                allIds={DAILY_SERIES_KEYS}
                selectedIds={config.daily.visibleSeries}
                onSelectedIdsChange={(next) =>
                  setConfig((s) => ({
                    ...s,
                    daily: { ...s.daily, visibleSeries: next },
                  }))
                }
                getLabel={(id) => DAILY_SERIES_LABELS[id]}
                availableTitle="Chỉ số"
                selectedTitle="Đang hiển thị"
              />
              */}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="h-[320px]">
                {dailyData.every((r) => r.total === 0 && r.needs === 0 && r.wants === 0) ? (
                  <div className="text-sm text-muted-foreground">
                    Chưa có dữ liệu để vẽ biểu đồ.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {config.daily.chartType === "bar" ? (
                      <ComposedChart
                        data={dailyData}
                        margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="day" tickFormatter={(v) => String(v)} />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          cursor={false}
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => `Ngày ${v}`}
                        />
                        <Legend />
                        {showDailyNeeds ? (
                          <Bar
                            dataKey="needs"
                            name={DAILY_SERIES_LABELS.needs}
                            fill={DAILY_SERIES_COLORS.needs}
                            stackId={showDailyWants ? "a" : undefined}
                            radius={[6, 6, 0, 0]}
                          />
                        ) : null}
                        {showDailyWants ? (
                          <Bar
                            dataKey="wants"
                            name={DAILY_SERIES_LABELS.wants}
                            fill={DAILY_SERIES_COLORS.wants}
                            stackId={showDailyNeeds ? "a" : undefined}
                            radius={[6, 6, 0, 0]}
                          />
                        ) : null}
                        {!showDailyNeeds && !showDailyWants && showDailyTotal ? (
                          <Bar
                            dataKey="total"
                            name={DAILY_SERIES_LABELS.total}
                            fill={DAILY_SERIES_COLORS.total}
                            radius={[6, 6, 0, 0]}
                          />
                        ) : null}
                        {showDailyTotal && (showDailyNeeds || showDailyWants) ? (
                          <Line
                            dataKey="total"
                            name={DAILY_SERIES_LABELS.total}
                            stroke={DAILY_SERIES_COLORS.total}
                            strokeWidth={2}
                            dot={false}
                            type="monotone"
                          />
                        ) : null}
                      </ComposedChart>
                    ) : config.daily.chartType === "area" ? (
                      <AreaChart
                        data={dailyData}
                        margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="day" tickFormatter={(v) => String(v)} />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          cursor={false}
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => `Ngày ${v}`}
                        />
                        <Legend />
                        {config.daily.visibleSeries.map((k) => (
                          <Area
                            key={k}
                            dataKey={k}
                            name={DAILY_SERIES_LABELS[k]}
                            stroke={DAILY_SERIES_COLORS[k]}
                            fill={DAILY_SERIES_COLORS[k]}
                            fillOpacity={0.18}
                            type="monotone"
                          />
                        ))}
                      </AreaChart>
                    ) : (
                      <LineChart
                        data={dailyData}
                        margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="day" tickFormatter={(v) => String(v)} />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          cursor={false}
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => `Ngày ${v}`}
                        />
                        <Legend />
                        {config.daily.visibleSeries.map((k) => (
                          <Line
                            key={k}
                            dataKey={k}
                            name={DAILY_SERIES_LABELS[k]}
                            stroke={DAILY_SERIES_COLORS[k]}
                            strokeWidth={2}
                            dot={false}
                            type="monotone"
                          />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                )}
                </div>

                <div className="rounded-md border bg-background">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="text-sm font-medium truncate">Bảng theo ngày</div>
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {dailyData.length} ngày
                    </Badge>
                  </div>
                  {dailyData.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-muted-foreground">
                      Chưa có dữ liệu để hiển thị bảng.
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-muted/40">
                          <tr className="border-b">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                              Ngày
                            </th>
                            {dailyTableSeries.map((k) => (
                              <th
                                key={k}
                                className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap tabular-nums"
                              >
                                {DAILY_SERIES_LABELS[k]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dailyData.map((row) => (
                            <tr key={row.day} className="border-b last:border-b-0">
                              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                                {row.day}
                              </td>
                              {dailyTableSeries.map((k) => (
                                <td
                                  key={k}
                                  className="px-3 py-2 text-right whitespace-nowrap tabular-nums"
                                >
                                  {formatVnd(row[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="trend" className="space-y-3">
              {/*
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={String(config.trend.rangeMonths)}
                    onValueChange={(v) => {
                      const n = Number(v)
                      const next: TrendRangeMonths | null =
                        n === 3 || n === 6 || n === 12 ? (n as TrendRangeMonths) : null
                      setConfig((s) => ({
                        ...s,
                        trend: {
                          ...s.trend,
                          rangeMonths: next ?? s.trend.rangeMonths,
                        },
                      }))
                    }}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Khoảng thời gian" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 tháng gần nhất</SelectItem>
                      <SelectItem value="6">6 tháng gần nhất</SelectItem>
                      <SelectItem value="12">12 tháng gần nhất</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={config.trend.chartType}
                    onValueChange={(v) =>
                      setConfig((s) => ({
                        ...s,
                        trend: { ...s.trend, chartType: v === "bar" ? "bar" : v === "area" ? "area" : "line" },
                      }))
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Loại biểu đồ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="line">Đường (Line)</SelectItem>
                      <SelectItem value="area">Vùng (Area)</SelectItem>
                      <SelectItem value="bar">Cột (Bar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const defaults = defaultReportsConfig()
                    setConfig((s) => ({
                      ...s,
                      trend: defaults.trend,
                    }))
                  }}
                >
                  Reset
                </Button>
              </div>
              */}

              {/*
              <DndMultiSelect
                allIds={TREND_SERIES_KEYS}
                selectedIds={config.trend.visibleSeries}
                onSelectedIdsChange={(next) =>
                  setConfig((s) => ({
                    ...s,
                    trend: { ...s.trend, visibleSeries: next },
                  }))
                }
                getLabel={(id) => TREND_SERIES_LABELS[id]}
                availableTitle="Chỉ số"
                selectedTitle="Đang hiển thị"
              />
              */}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="h-[320px]">
                {trendData.every((r) => r.totalSpent === 0 && r.variableSpent === 0 && r.fixedCosts === 0) ? (
                  <div className="text-sm text-muted-foreground">
                    Chưa có dữ liệu để vẽ biểu đồ.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {config.trend.chartType === "bar" ? (
                      <BarChart data={trendData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="month"
                          tickFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <Legend />
                        {config.trend.visibleSeries.includes("balance") ? (
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        ) : null}
                        {config.trend.visibleSeries.map((k) => (
                          <Bar
                            key={k}
                            dataKey={k}
                            name={TREND_SERIES_LABELS[k]}
                            fill={TREND_SERIES_COLORS[k]}
                            radius={[6, 6, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    ) : config.trend.chartType === "area" ? (
                      <AreaChart data={trendData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="month"
                          tickFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <Legend />
                        {config.trend.visibleSeries.includes("balance") ? (
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        ) : null}
                        {config.trend.visibleSeries.map((k) => (
                          <Area
                            key={k}
                            dataKey={k}
                            name={TREND_SERIES_LABELS[k]}
                            stroke={TREND_SERIES_COLORS[k]}
                            fill={TREND_SERIES_COLORS[k]}
                            fillOpacity={0.18}
                            type="monotone"
                          />
                        ))}
                      </AreaChart>
                    ) : (
                      <LineChart data={trendData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="month"
                          tickFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <YAxis
                          tickFormatter={(v) =>
                            new Intl.NumberFormat("vi-VN").format(Number(v))
                          }
                        />
                        <Tooltip
                          formatter={(v, name) => [formatVnd(Number(v)), String(name)]}
                          labelFormatter={(v) => formatMonthLabel(v as YearMonth)}
                        />
                        <Legend />
                        {config.trend.visibleSeries.includes("balance") ? (
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        ) : null}
                        {config.trend.visibleSeries.map((k) => (
                          <Line
                            key={k}
                            dataKey={k}
                            name={TREND_SERIES_LABELS[k]}
                            stroke={TREND_SERIES_COLORS[k]}
                            strokeWidth={2}
                            dot={false}
                            type="monotone"
                          />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                )}
                </div>

                <div className="rounded-md border bg-background">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="text-sm font-medium truncate">Bảng theo tháng</div>
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {trendData.length} tháng
                    </Badge>
                  </div>
                  {trendData.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-muted-foreground">
                      Chưa có dữ liệu để hiển thị bảng.
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-muted/40">
                          <tr className="border-b">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                              Tháng
                            </th>
                            {trendTableSeries.map((k) => (
                              <th
                                key={k}
                                className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap tabular-nums"
                              >
                                {TREND_SERIES_LABELS[k]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {trendData.map((row) => (
                            <tr key={row.month} className="border-b last:border-b-0">
                              <td className="px-3 py-2 whitespace-nowrap">
                                {formatMonthLabel(row.month)}
                              </td>
                              {trendTableSeries.map((k) => (
                                <td
                                  key={k}
                                  className="px-3 py-2 text-right whitespace-nowrap tabular-nums"
                                >
                                  {formatVnd(row[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="pivot" className="space-y-3">
              <div className={cn("grid gap-4", pivotShowTable && pivotShowChart && "lg:grid-cols-2")}>
                {pivotShowTable ? (
                  <Card>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-base font-semibold">Bảng pivot</div>
                      </div>

                    {pivotTable.rows.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        Chưa có dữ liệu để tạo pivot.
                      </div>
                    ) : (
                      <div className="relative max-h-[520px] overflow-auto rounded-md border border-border/80">
                        <table className="min-w-max w-full text-sm border-separate border-spacing-0 border border-border/80">
                          <thead className="sticky top-0 z-30 bg-muted text-xs uppercase text-muted-foreground shadow-[0_2px_0_rgba(0,0,0,0.08)]">
                            {pivotColumnHeaderRows.map((headerRow, level) => (
                              <tr key={`pivot-head-${level}`} className="border-b border-border/70">
                                {level === 0
                                  ? pivotRowHeaderLabels.map((label, index) => (
                                      <th
                                        key={`pivot-row-head-${index}`}
                                        rowSpan={pivotColumnHeaderDepth}
                                        className="sticky top-0 z-40 bg-muted px-3 py-2 text-left font-medium whitespace-nowrap border-b border-border/70 border-r border-border/70"
                                        style={{
                                          left: `${pivotRowStickyOffsets[index]}px`,
                                          minWidth: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                          width: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                        }}
                                      >
                                        <span
                                          className="block max-w-[140px] truncate"
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
                                        className="bg-muted px-3 py-2 text-center font-medium whitespace-nowrap border-b border-border/70 border-r border-border/70"
                                      >
                                        <span
                                          className="block max-w-[180px] truncate"
                                          title={hint ? `${group.label} (${hint})` : group.label}
                                        >
                                          {group.label}
                                        </span>
                                        {hint ? (
                                          <span className="mt-0.5 block max-w-[180px] truncate text-[11px] font-normal tabular-nums text-muted-foreground/90">
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
                                    className="sticky top-0 z-30 bg-muted px-3 py-2 text-right font-medium whitespace-nowrap border-b border-border/70 border-r border-border/70"
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
                                      className="sticky z-10 bg-background px-3 py-2 align-top font-medium text-foreground border-b border-border/60 border-r border-border/60"
                                      style={{
                                        left: `${pivotRowStickyOffsets[level]}px`,
                                        minWidth: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                        width: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                      }}
                                    >
                                      <span
                                        className="block max-w-[140px] truncate"
                                        title={cellLabel}
                                      >
                                        {cellLabel}
                                      </span>
                                    </td>
                                  )
                                })}
                                {pivotTable.cols.map((col) => {
                                  const cell =
                                    pivotTable.cells[row.key]?.[col.key]
                                  const value = pivotMetricValue(
                                    cell,
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
                                      key={`${row.key}-${col.key}`}
                                      style={style}
                                      className="px-3 py-2 text-right tabular-nums whitespace-nowrap border-b border-border/60 border-r border-border/60 transition-colors"
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
                                      className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap border-b border-border/60 border-r border-border/60 transition-colors"
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
                                  className="sticky z-10 bg-muted/40 px-3 py-2 font-medium border-b border-border/60 border-r border-border/60"
                                  style={{
                                    left: `${pivotRowStickyOffsets[level]}px`,
                                    minWidth: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                    width: `${PIVOT_ROW_HEADER_COL_WIDTH}px`,
                                  }}
                                >
                                  {level === 0 ? "Tổng" : null}
                                </td>
                              ))}
                              {pivotTable.cols.map((col) => {
                                const value = pivotMetricValue(
                                  pivotTable.colTotals[col.key],
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
                                    key={`total-${col.key}`}
                                    style={style}
                                    className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap border-b border-border/60 border-r border-border/60 transition-colors"
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
                                    className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap border-b border-border/60 border-r border-border/60 transition-colors"
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
                  <Card>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-base font-semibold">Biểu đồ pivot</div>
                        {pivotHasColumns ? (
                          <div className="flex items-center gap-2">
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
                    <div className="h-[460px]">
                      {pivotChartData.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Chưa có dữ liệu để vẽ biểu đồ.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          {config.pivot.chartType === "bar" ? (
                            <BarChart
                              data={pivotChartData}
                              margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" />
                              <YAxis
                                tickFormatter={(v) =>
                                  new Intl.NumberFormat("vi-VN").format(Number(v))
                                }
                              />
                              <Tooltip
                                cursor={false}
                                formatter={(v, name) => [
                                  formatPivotValue(Number(v), config.pivot.metric),
                                  pivotChartSeriesLabelByKey.get(String(name)) ??
                                    String(name),
                                ]}
                              />
                              {pivotChartSeries.length > 1 ? (
                                <Legend
                                  formatter={(value) =>
                                    pivotChartSeriesShortLabelByKey.get(String(value)) ??
                                    value
                                  }
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
                                  radius={
                                    pivotHasColumns && pivotChartSeries.length > 1
                                      ? 0
                                      : [6, 6, 0, 0]
                                  }
                                />
                              ))}
                            </BarChart>
                          ) : config.pivot.chartType === "area" ? (
                            <AreaChart
                              data={pivotChartData}
                              margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" />
                              <YAxis
                                tickFormatter={(v) =>
                                  new Intl.NumberFormat("vi-VN").format(Number(v))
                                }
                              />
                              <Tooltip
                                cursor={false}
                                formatter={(v, name) => [
                                  formatPivotValue(Number(v), config.pivot.metric),
                                  pivotChartSeriesLabelByKey.get(String(name)) ??
                                    String(name),
                                ]}
                              />
                              {pivotChartSeries.length > 1 ? (
                                <Legend
                                  formatter={(value) =>
                                    pivotChartSeriesShortLabelByKey.get(String(value)) ??
                                    value
                                  }
                                />
                              ) : null}
                              {pivotChartSeries.map((series) => (
                                <Area
                                  key={series.key}
                                  dataKey={series.key}
                                  stroke={series.color}
                                  fill={series.color}
                                  fillOpacity={0.2}
                                  type="monotone"
                                  stackId={
                                    pivotHasColumns && pivotChartSeries.length > 1
                                      ? "pivot"
                                      : undefined
                                  }
                                />
                              ))}
                            </AreaChart>
                          ) : (
                            <LineChart
                              data={pivotChartData}
                              margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" />
                              <YAxis
                                tickFormatter={(v) =>
                                  new Intl.NumberFormat("vi-VN").format(Number(v))
                                }
                              />
                              <Tooltip
                                cursor={false}
                                formatter={(v, name) => [
                                  formatPivotValue(Number(v), config.pivot.metric),
                                  pivotChartSeriesLabelByKey.get(String(name)) ??
                                    String(name),
                                ]}
                              />
                              {pivotChartSeries.length > 1 ? (
                                <Legend
                                  formatter={(value) =>
                                    pivotChartSeriesShortLabelByKey.get(String(value)) ??
                                    value
                                  }
                                />
                              ) : null}
                              {pivotChartSeries.map((series) => (
                                <Line
                                  key={series.key}
                                  dataKey={series.key}
                                  stroke={series.color}
                                  strokeWidth={2}
                                  dot={false}
                                  type="monotone"
                                />
                              ))}
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

      <Card>
        <CardHeader>
          <CardTitle>Top 3 danh mục</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {top3.length === 0 ? (
            <div className="text-sm text-muted-foreground">Chưa có dữ liệu.</div>
          ) : (
            <div className="grid gap-2">
              {top3.map(([category, value], idx) => {
                const label =
                  (CATEGORY_LABELS_VI as Record<string, string>)[category] ??
                  category
                return (
                  <LabelValueRow
                    key={category}
                    className="text-sm"
                    label={`${idx + 1}. ${label}`}
                    labelTitle={`${idx + 1}. ${label}`}
                    labelClassName="text-foreground font-medium"
                    value={formatVnd(value)}
                    valueClassName="text-muted-foreground"
                  />
                )
              })}
            </div>
          )}
          <Separator />
          <div className="text-xs text-muted-foreground">
            Lưu ý: Chi phí cố định được cộng vào danh mục tương ứng trong “Chi theo danh mục”.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

