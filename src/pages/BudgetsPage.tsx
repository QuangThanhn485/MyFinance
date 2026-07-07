import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Info, SlidersHorizontal } from "lucide-react"
import LabelValueRow from "@/components/LabelValueRow"
import MonthPicker from "@/components/MonthPicker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getExpenseCategoryLabel } from "@/domain/constants"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getMonthlyIncomeTotalVnd,
  getEffectiveSettingsForMonth,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import type { YearMonth } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import {
  daysInMonth,
  monthFromIsoDate,
  todayIso,
} from "@/lib/date"
import { getCategoryTotals, getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { getMonthDayContext } from "@/storage/dayLock"

const BUDGETS_COMPACT_KEY = "smartSpend.ui.budgetsCompact.v1"

type DrawerTab = "details" | "explain" | "settings"

function InfoTip({
  children,
  label = "Giải thích",
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={label}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function KpiCard({
  label,
  value,
  hint,
  danger,
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  danger?: boolean
  onClick?: () => void
}) {
  const className = cn(
    "rounded-xl border bg-card p-3 text-left shadow-sm transition-colors",
    onClick &&
      "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  )

  const content = (
    <>
      <div className="text-[11px] font-medium text-muted-foreground truncate">{label}</div>
      <div
        className={cn(
          "mt-1 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-xl",
          danger && "text-destructive",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground truncate">{hint}</div>
      ) : (
        <div className="mt-1 h-4" aria-hidden />
      )}
    </>
  )

  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}

function LegendRow({
  color,
  label,
  value,
  pctIncome,
  valueClassName,
}: {
  color: string
  label: string
  value: number
  pctIncome?: number
  valueClassName?: string
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      {pctIncome !== undefined ? (
        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
          {pctIncome.toFixed(0)}%
        </span>
      ) : null}
      <span className={cn("w-24 shrink-0 text-right font-medium tabular-nums sm:w-28", valueClassName)}>
        {formatVnd(value)}
      </span>
    </div>
  )
}

// Bảng màu + mã ngắn cho từng vùng ngân sách. Màu F/E/W/S là bảng categorical đã được kiểm tra
// bằng validator dataviz (phân biệt tốt cho người mù màu, tương phản đạt chuẩn). Định nghĩa theo
// theme trong index.css (--budget-*). Còn lại/Vượt/Chưa phân bổ dùng token trung tính/trạng thái.
const SEG_STYLE: Record<string, { color: string; code: string; onColor: string }> = {
  fixed: { color: "var(--budget-fixed)", code: "F", onColor: "text-white" },
  essential: { color: "var(--budget-essential)", code: "E", onColor: "text-white" },
  wants: { color: "var(--budget-wants)", code: "W", onColor: "text-white" },
  savings: { color: "var(--budget-savings)", code: "S", onColor: "text-white" },
  remaining: { color: "hsl(var(--muted-foreground) / 0.22)", code: "Còn lại", onColor: "text-foreground/80" },
  unallocated: { color: "hsl(var(--muted-foreground) / 0.18)", code: "Dư", onColor: "text-foreground/80" },
  over: { color: "hsl(var(--destructive))", code: "Vượt", onColor: "text-white" },
}

type BarSegment = {
  key: string
  pct: number
  color: string
  code: string
  onColor: string
  title: string
}

// Thanh chồng có nhãn: mỗi vùng có mã (F/E/W/S…) ngay trên thanh + khe 2px màu nền để tách bạch
// ranh giới — nhìn là biết vùng nào thuộc trường nào, không cần dò legend.
function SegmentedBar({ segments }: { segments: BarSegment[] }) {
  // Hover một vùng -> các vùng khác mờ đi để làm nổi bật vùng đang hover.
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded-md">
      {segments.map((s) =>
        s.pct > 0 ? (
          <div
            key={s.key}
            className={cn(
              "flex h-full min-w-0 items-center justify-center transition-opacity duration-150",
              hovered && hovered !== s.key ? "opacity-25" : "opacity-100",
            )}
            style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            title={s.title}
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
          >
            {s.pct >= 6 ? (
              <span className={cn("truncate px-1 text-[11px] font-semibold leading-none", s.onColor)}>
                {s.code}
              </span>
            ) : null}
          </div>
        ) : null,
      )}
    </div>
  )
}

function BudgetHeader({
  month,
  onMonthChange,
  onOpenDrawer,
  locked,
  compactMode,
}: {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
  onOpenDrawer: () => void
  locked: boolean
  compactMode: boolean
}) {
  return (
    <div className="z-30 -mx-3 sm:-mx-4 md:sticky md:top-0 lg:-mx-6">
      <div className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div
          className={cn(
            "flex flex-col items-start gap-3 px-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 lg:px-6",
            compactMode ? "py-2.5" : "py-3",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
                Ngân sách
              </h1>
              {locked ? (
                <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Đã chốt
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              Báo cáo chi tiêu theo tháng (I, F, E, W, S)
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <div className="hidden sm:block text-xs text-muted-foreground">Tháng</div>
            <MonthPicker value={month} onChange={onMonthChange} className="w-[140px]" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Mở chi tiết & cài đặt"
              onClick={onOpenDrawer}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AllocationCard({
  incomeVnd,
  fixedVnd,
  essentialVnd,
  wantsVnd,
  savingsVnd,
  onOpenDetails,
  compactMode,
  note,
}: {
  incomeVnd: number
  fixedVnd: number
  essentialVnd: number
  wantsVnd: number
  savingsVnd: number
  onOpenDetails: () => void
  compactMode: boolean
  note?: string
}) {
  const segments = useMemo(() => {
    const income = Math.max(0, incomeVnd)
    const base = [
      { key: "fixed", label: "Cố định (F)", value: Math.max(0, fixedVnd) },
      { key: "essential", label: "Thiết yếu (E)", value: Math.max(0, essentialVnd) },
      { key: "wants", label: "Mong muốn (W)", value: Math.max(0, wantsVnd) },
      { key: "savings", label: "Tiết kiệm (S)", value: Math.max(0, savingsVnd) },
    ]
    const sum = base.reduce((acc, item) => acc + item.value, 0)
    const unallocated = Math.max(0, income - sum)
    const overflow = Math.max(0, sum - income)
    const denom = Math.max(1, income, sum)
    const items = [...base]
    if (unallocated > 0) {
      items.push({ key: "unallocated", label: "Chưa phân bổ", value: unallocated })
    }
    if (overflow > 0) {
      items.push({ key: "over", label: "Vượt thu nhập", value: overflow })
    }
    return {
      overflow,
      items: items.map((item) => ({
        ...item,
        ...SEG_STYLE[item.key],
        pctIncome: income > 0 ? (item.value / income) * 100 : 0,
        pctBar: (item.value / denom) * 100,
      })),
    }
  }, [essentialVnd, fixedVnd, incomeVnd, savingsVnd, wantsVnd])

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row flex-wrap items-start justify-between gap-2",
          compactMode ? "pb-2" : "pb-3",
        )}
      >
        <div className="min-w-0">
          <CardTitle className="text-base">Kế hoạch phân bổ</CardTitle>
          <div className="text-xs text-muted-foreground truncate">Thu nhập chia cho F · E · W · S</div>
        </div>
        <div className="flex items-center gap-1">
          <InfoTip label="Giải thích kế hoạch phân bổ">
            <div className="font-medium">Kế hoạch phân bổ</div>
            <div className="text-muted-foreground">
              Từ thu nhập I: trừ Cố định (F) và Thiết yếu (E); phần còn lại chia cho Mong muốn (W) và Tiết kiệm (S). Tiết kiệm được ưu tiên tối thiểu bằng mục tiêu đã đặt (hoặc MSS), nên Mong muốn có thể nhỏ.
            </div>
          </InfoTip>
          <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
            Chi tiết
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", compactMode ? "space-y-3" : "space-y-4")}>
        {segments.overflow > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive font-medium">
            Kế hoạch đang vượt thu nhập: {formatVnd(segments.overflow)}
          </div>
        ) : null}

        <SegmentedBar
          segments={segments.items.map((it) => ({
            key: it.key,
            pct: it.pctBar,
            color: it.color,
            code: it.code,
            onColor: it.onColor,
            title: `${it.label}: ${formatVnd(it.value)} (${it.pctIncome.toFixed(0)}%)`,
          }))}
        />

        <div className="space-y-2">
          {segments.items.map((it) => (
            <LegendRow
              key={it.key}
              color={it.color}
              label={it.label}
              value={it.value}
              pctIncome={it.pctIncome}
            />
          ))}
        </div>

        {note ? (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{note}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SpendingProgressCard({
  spendingBudgetVnd,
  spentVnd,
  fixedVnd,
  essentialVnd,
  wantsVnd,
  remainingVnd,
  onOpenDetails,
  compactMode,
}: {
  spendingBudgetVnd: number
  spentVnd: number
  fixedVnd: number
  essentialVnd: number
  wantsVnd: number
  remainingVnd: number
  onOpenDetails: () => void
  compactMode: boolean
}) {
  const view = useMemo(() => {
    const total = Math.max(0, spendingBudgetVnd)
    const fixed = Math.max(0, fixedVnd)
    const essential = Math.max(0, essentialVnd)
    const wants = Math.max(0, wantsVnd)
    const spent = fixed + essential + wants
    const remaining = Math.max(0, total - spent)
    const over = Math.max(0, spent - total)
    const denom = Math.max(1, total, spent)
    const bars = [
      { key: "fixed", label: "Cố định (F)", value: fixed },
      { key: "essential", label: "Thiết yếu (E)", value: essential },
      { key: "wants", label: "Mong muốn (W)", value: wants },
      { key: "remaining", label: "Còn lại", value: remaining },
      { key: "over", label: "Vượt ngân sách", value: over },
    ]
      .filter((b) => b.value > 0)
      .map((b) => ({ ...b, ...SEG_STYLE[b.key], pct: (b.value / denom) * 100 }))
    return { total, fixed, essential, wants, spent, remaining, over, bars }
  }, [essentialVnd, fixedVnd, spendingBudgetVnd, wantsVnd])

  const overByVnd = view.over
  const progressPct = view.total > 0 ? (view.spent / view.total) * 100 : 0

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row flex-wrap items-start justify-between gap-2",
          compactMode ? "pb-2" : "pb-3",
        )}
      >
        <div className="min-w-0">
          <CardTitle className="text-base">Tiến độ chi tiêu</CardTitle>
          <div className="text-xs text-muted-foreground truncate">Đã chi trên ngân sách chi (I − S)</div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
          Chi tiết
        </Button>
      </CardHeader>
      <CardContent className={cn("pt-0", compactMode ? "space-y-3" : "space-y-4")}>
        <div className="space-y-2 text-sm">
          <LabelValueRow label="Ngân sách chi (I − S)" value={formatVnd(spendingBudgetVnd)} />
          <LabelValueRow
            label="Đã chi"
            value={formatVnd(spentVnd)}
            valueClassName={cn(overByVnd > 0 && "text-destructive")}
          />
          <LabelValueRow
            label="Còn lại"
            value={formatVnd(remainingVnd)}
            valueClassName={cn(remainingVnd < 0 && "text-destructive")}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Mức dùng ngân sách</span>
            <span className={cn("font-medium tabular-nums", overByVnd > 0 && "text-destructive")}>
              {Math.max(0, progressPct).toFixed(0)}%
            </span>
          </div>
          {/* Thanh chồng: từng khoản đã chi (F · E · W) tách bạch + phần còn lại là đoạn riêng,
              có mã trên thanh và khe ngăn — không trộn kiểu biểu đồ bánh gây khó đọc. */}
          <SegmentedBar
            segments={view.bars.map((b) => ({
              key: b.key,
              pct: b.pct,
              color: b.color,
              code: b.code,
              onColor: b.onColor,
              title: `${b.label}: ${formatVnd(b.value)}`,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <LegendRow color={SEG_STYLE.fixed.color} label="Cố định (F)" value={view.fixed} />
          <LegendRow color={SEG_STYLE.essential.color} label="Thiết yếu (E)" value={view.essential} />
          <LegendRow color={SEG_STYLE.wants.color} label="Mong muốn (W)" value={view.wants} />
          <LegendRow
            color={overByVnd > 0 ? SEG_STYLE.over.color : SEG_STYLE.remaining.color}
            label={overByVnd > 0 ? "Vượt ngân sách" : "Còn lại"}
            value={overByVnd > 0 ? overByVnd : view.remaining}
            valueClassName={overByVnd > 0 ? "text-destructive" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CategoryCard({
  title,
  subtitle,
  planLabel,
  planVnd,
  actualLabel,
  actualVnd,
  actualValueClassName,
  remainingLabel = "Còn lại",
  remainingVnd,
  progressPct,
  status,
  statusTone = "muted",
  onOpenDetails,
  compactMode,
}: {
  title: string
  subtitle?: string
  planLabel: string
  planVnd: number
  actualLabel: string
  actualVnd: number
  actualValueClassName?: string
  remainingLabel?: string
  remainingVnd: number
  progressPct: number
  status?: string
  statusTone?: "muted" | "danger" | "ok" | "warn"
  onOpenDetails: () => void
  compactMode: boolean
}) {
  const statusClass =
    statusTone === "danger"
      ? "text-destructive"
      : statusTone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : statusTone === "ok"
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground"

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row flex-wrap items-start justify-between gap-2",
          compactMode ? "pb-2" : "pb-3",
        )}
      >
        <div className="min-w-0">
          <CardTitle className="text-base truncate">{title}</CardTitle>
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
          Chi tiết
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="space-y-2 text-sm">
          <LabelValueRow label={planLabel} value={formatVnd(planVnd)} />
          <LabelValueRow
            label={actualLabel}
            value={formatVnd(actualVnd)}
            valueClassName={actualValueClassName}
          />
          <LabelValueRow
            label={remainingLabel}
            value={formatVnd(remainingVnd)}
            valueClassName={cn(remainingVnd < 0 && "text-destructive")}
          />
        </div>
        <div className="space-y-2">
          {status ? (
            <div className={cn("text-xs font-medium", statusClass)}>{status}</div>
          ) : null}
          <Progress value={Math.max(0, Math.min(100, progressPct))} />
        </div>
      </CardContent>
    </Card>
  )
}

function LeftDrawer({
  open,
  onOpenChange,
  tab,
  onTabChange,
  sectionId,
  month,
  compactMode,
  onCompactModeChange,
  incomeVnd,
  fixedCostsVnd,
  essentialBaselineVnd,
  wantsBudgetVnd,
  savingsTargetVnd,
  mssVnd,
  spendingBudgetVnd,
  spentVnd,
  remainingVnd,
  projectedSavingsVnd,
  projectedNeedsEndMonthVnd,
  projectedWantsEndMonthVnd,
  expectedVariableRemainingVnd,
  topCategories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
  sectionId: string | null
  month: YearMonth
  compactMode: boolean
  onCompactModeChange: (next: boolean) => void
  incomeVnd: number
  fixedCostsVnd: number
  essentialBaselineVnd: number
  wantsBudgetVnd: number
  savingsTargetVnd: number
  mssVnd: number
  spendingBudgetVnd: number
  spentVnd: number
  remainingVnd: number
  projectedSavingsVnd: number
  projectedNeedsEndMonthVnd: number
  projectedWantsEndMonthVnd: number
  expectedVariableRemainingVnd: number
  topCategories: Array<{ category: string; label: string; totalVnd: number }>
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || !sectionId) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(sectionId)
      if (!el) return
      el.scrollIntoView({ block: "start", behavior: "smooth" })
    }, 50)
    return () => window.clearTimeout(t)
  }, [open, sectionId, tab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-0 top-0 h-viewport max-h-none w-[100vw] max-w-[100vw] translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 border-r p-0 gap-0 sm:w-[460px]"
        aria-label="Chi tiết & cài đặt ngân sách"
      >
        <Tabs
          value={tab}
          onValueChange={(v) => onTabChange(v as DrawerTab)}
          className="flex h-viewport flex-col"
        >
          <div className="border-b bg-background p-4">
            <div className="min-w-0">
              <div className="font-semibold tracking-tight truncate">Ngân sách</div>
              <div className="text-xs text-muted-foreground truncate">Tháng {month}</div>
            </div>
            <TabsList className="mt-3 w-full">
              <TabsTrigger value="details" className="flex-1">
                Chi tiết
              </TabsTrigger>
              <TabsTrigger value="explain" className="flex-1">
                Giải thích
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">
                Cài đặt
              </TabsTrigger>
            </TabsList>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="details" className="mt-0 space-y-6">
              <section id="budget-details-overview" className="space-y-3">
                <div className="text-sm font-semibold">Tổng quan</div>
                <div className="rounded-lg border bg-card p-3 space-y-2 text-sm">
                  <LabelValueRow label="Thu nhập (I)" value={formatVnd(incomeVnd)} />
                  <LabelValueRow label="Cố định (F)" value={formatVnd(fixedCostsVnd)} />
                  <LabelValueRow
                    label="Thiết yếu baseline (E)"
                    value={formatVnd(essentialBaselineVnd)}
                  />
                  <Separator />
                  <LabelValueRow label="Mong muốn (W)" value={formatVnd(wantsBudgetVnd)} />
                  <LabelValueRow
                    label="Tiết kiệm mục tiêu (S)"
                    value={formatVnd(savingsTargetVnd)}
                  />
                  <LabelValueRow label="MSS" value={formatVnd(mssVnd)} />
                </div>
              </section>

              <section id="budget-details-progress" className="space-y-3">
                <div className="text-sm font-semibold">Tiến độ chi tiêu</div>
                <div className="rounded-lg border bg-card p-3 space-y-2 text-sm">
                  <LabelValueRow
                    label="Ngân sách chi (I − S)"
                    value={formatVnd(spendingBudgetVnd)}
                  />
                  <LabelValueRow label="Đã chi" value={formatVnd(spentVnd)} />
                  <LabelValueRow
                    label="Còn lại"
                    value={formatVnd(remainingVnd)}
                    valueClassName={cn(remainingVnd < 0 && "text-destructive")}
                  />
                  <div className="text-xs text-muted-foreground">
                    Xem giao dịch chi tiết ở{" "}
                    <Link to="/expenses" className="underline underline-offset-2">
                      Ghi chi tiêu
                    </Link>
                    .
                  </div>
                </div>
              </section>

              <section id="budget-details-forecast" className="space-y-3">
                <div className="text-sm font-semibold">Dự báo (ước tính)</div>
                <div className="rounded-lg border bg-card p-3 space-y-2 text-sm">
                  <LabelValueRow
                    label="Dự báo tiết kiệm cuối tháng"
                    value={formatVnd(projectedSavingsVnd)}
                    valueClassName={cn(projectedSavingsVnd < 0 && "text-destructive")}
                  />
                  <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-xs">
                    <LabelValueRow
                      className="text-xs"
                      label="Thiết yếu dự kiến (E)"
                      value={formatVnd(projectedNeedsEndMonthVnd)}
                    />
                    <LabelValueRow
                      className="text-xs"
                      label="Mong muốn dự kiến (W)"
                      value={formatVnd(projectedWantsEndMonthVnd)}
                    />
                    <LabelValueRow
                      className="text-xs"
                      label="Biến đổi còn lại dự kiến"
                      value={formatVnd(expectedVariableRemainingVnd)}
                    />
                    <div className="text-muted-foreground">
                      Dự báo là ước tính theo nhịp hiện tại, không phải tiền có thể chi ngay.
                    </div>
                  </div>
                </div>
              </section>

              <section id="budget-details-top" className="space-y-3">
                <div className="text-sm font-semibold">Top danh mục</div>
                <div className="rounded-lg border bg-card p-3 space-y-2 text-sm">
                  {topCategories.length ? (
                    <div className="space-y-2">
                      {topCategories.map((c) => (
                        <LabelValueRow
                          key={c.category}
                          label={c.label}
                          value={formatVnd(c.totalVnd)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Chưa có dữ liệu trong tháng này.
                    </div>
                  )}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="explain" className="mt-0 space-y-6">
              <section id="budget-explain-core" className="space-y-3">
                <div className="text-sm font-semibold">Các khái niệm chính</div>
                <div className="rounded-lg border bg-card p-3 text-sm space-y-3">
                  <div>
                    <div className="font-medium">I — Thu nhập tháng</div>
                    <div className="text-muted-foreground">
                      Thu nhập tham chiếu để phân bổ ngân sách tháng.
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">F — Cố định</div>
                    <div className="text-muted-foreground">
                      Chi phí cố định mỗi tháng (tiền nhà, điện nước, khoản trả nợ...).
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">E — Thiết yếu (baseline)</div>
                    <div className="text-muted-foreground">
                      Mức chi thiết yếu biến đổi dự kiến trong tháng (ăn uống, đi lại...).
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">W — Mong muốn</div>
                    <div className="text-muted-foreground">
                      Ngân sách cho chi tiêu không thiết yếu.
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">S — Tiết kiệm</div>
                    <div className="text-muted-foreground">
                      Mục tiêu tiết kiệm tháng. Ngân sách chi được tính là{" "}
                      <span className="font-medium">I − S</span>.
                    </div>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    “Dự báo” là ước tính theo nhịp chi tiêu hiện tại, không phải tiền có thể chi ngay.
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="settings" className="mt-0 space-y-6">
              <section id="budget-settings-ui" className="space-y-3">
                <div className="text-sm font-semibold">Hiển thị</div>
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">Compact mode</div>
                      <div className="text-xs text-muted-foreground truncate">
                        Giảm spacing để xem được nhiều thông tin hơn.
                      </div>
                    </div>
                    <Switch
                      checked={compactMode}
                      onCheckedChange={onCompactModeChange}
                      aria-label="Bật compact mode"
                    />
                  </div>
                </div>
              </section>

              <section id="budget-settings-system" className="space-y-3">
                <div className="text-sm font-semibold">Cài đặt hệ thống</div>
                <div className="rounded-lg border bg-card p-3 text-sm space-y-2">
                  <div className="text-muted-foreground text-xs">
                    Các tham số ngân sách (tỉ lệ W/S, baseline E, quỹ khẩn cấp...) được chỉnh ở màn hình Cài đặt.
                  </div>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link to="/settings">Đi tới Cài đặt</Link>
                  </Button>
                </div>
              </section>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default function BudgetsPage() {
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
  const [month, setMonth] = useState<YearMonth>(monthFromIsoDate(todayIso()))

  const locked = isMonthLocked(data, month)

  const [compactMode, setCompactMode] = useState(() => {
    try {
      return localStorage.getItem(BUDGETS_COMPACT_KEY) === "1"
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(BUDGETS_COMPACT_KEY, compactMode ? "1" : "0")
    } catch {
      // ignore
    }
  }, [compactMode])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("details")
  const [drawerSectionId, setDrawerSectionId] = useState<string | null>(null)

  const openDrawer = (tab: DrawerTab, sectionId?: string) => {
    setDrawerTab(tab)
    setDrawerSectionId(sectionId ?? null)
    setDrawerOpen(true)
  }

  const totals = useMemo(() => getMonthTotals(data, month), [data, month])
  const settingsForMonth = getEffectiveSettingsForMonth(data, month)
  const adjustment = getEffectiveBudgetAdjustmentForMonth(data, month)

  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })

  const spendingBudgetVnd = Math.max(0, budgets.incomeVnd - budgets.savingsTargetVnd)
  const essentialActual = totals.variableNeeds
  const wantsActual = totals.variableWants

  const now = todayIso()
  const currentMonth = monthFromIsoDate(now)
  const currentDayContext = getMonthDayContext(data, now)
  const dim = daysInMonth(month)
  const dom =
    month === currentMonth ? currentDayContext.dayOfMonth : month < currentMonth ? dim : 1
  const isCurrentMonth = month === currentMonth
  const needsPace = dom > 0 ? totals.variableNeeds / dom : 0
  const wantsPace = dom > 0 ? totals.variableWants / dom : 0

  const projectedNeedsEndMonthVnd = isCurrentMonth
    ? Math.max(budgets.essentialVariableBaselineVnd, Math.round(needsPace * dim))
    : totals.variableNeeds
  const projectedWantsEndMonthVnd = isCurrentMonth
    ? Math.round(wantsPace * dim)
    : totals.variableWants
  const projectedVariableEndMonthVnd =
    projectedNeedsEndMonthVnd + projectedWantsEndMonthVnd
  const expectedVariableRemainingVnd = Math.max(
    0,
    projectedVariableEndMonthVnd - totals.variableTotal,
  )
  const projectedSavingsVnd = Math.trunc(
    budgets.incomeVnd - totals.fixedCostsTotal - projectedVariableEndMonthVnd,
  )

  const essentialProgress =
    budgets.essentialVariableBaselineVnd > 0
      ? (essentialActual / budgets.essentialVariableBaselineVnd) * 100
      : 0
  const wantsProgress =
    budgets.wantsBudgetVnd > 0 ? (wantsActual / budgets.wantsBudgetVnd) * 100 : 0

  const essentialRemaining = budgets.essentialVariableBaselineVnd - essentialActual
  const wantsRemaining = budgets.wantsBudgetVnd - wantsActual
  const totalRemaining = spendingBudgetVnd - totals.totalSpent

  // Ghi chú giải thích khi Mong muốn bị thu hẹp: mục tiêu tiết kiệm (theo mục tiêu tự đặt / MSS)
  // được ưu tiên và chiếm phần lớn ngân sách còn lại sau F + E — đây KHÔNG phải lỗi tính toán.
  const splitSavingsVnd = Math.floor((budgets.remainderVnd * budgets.split.savingsPct) / 100)
  const wantsPctIncome = budgets.incomeVnd > 0 ? (budgets.wantsBudgetVnd / budgets.incomeVnd) * 100 : 0
  const allocationNote =
    budgets.savingsTargetShortfallVnd > 0
      ? `Ngân sách còn lại sau Cố định + Thiết yếu chưa đủ cho mục tiêu tiết kiệm (còn thiếu ${formatVnd(
          budgets.savingsTargetShortfallVnd,
        )}). Mong muốn đã về 0.`
      : budgets.savingsTargetVnd > splitSavingsVnd && wantsPctIncome < 12
        ? `Mong muốn nhỏ vì mục tiêu tiết kiệm (${formatVnd(
            budgets.savingsTargetVnd,
          )}) được ưu tiên, chiếm phần lớn ngân sách còn lại sau Cố định + Thiết yếu. Muốn Mong muốn nhiều hơn, hãy giảm mục tiêu tiết kiệm trong Cài đặt.`
        : undefined

  // Card "Tiết kiệm" phản ánh DỰ BÁO tiết kiệm cuối tháng theo nhịp chi thực tế — giống
  // "Triển vọng tháng này" của Dashboard. projectedSavingsVnd đã tự xử lý theo tháng:
  //   · Tháng hiện tại: ngoại suy phần còn lại của tháng theo nhịp chi (không coi toàn bộ tiền
  //     chưa tiêu là tiết kiệm).
  //   · Tháng đã qua: = I − đã chi thực tế (dùng chi thực, không ép sàn E) nên tháng đã đạt
  //     mục tiêu vẫn hiển thị đúng là đạt.
  // Verdict 3 mức theo mục tiêu S và ngưỡng an toàn MSS (khớp Dashboard).
  const savingsForecastVnd = projectedSavingsVnd
  const savingsMet = savingsForecastVnd >= budgets.savingsTargetVnd
  const savingsAboveMss = savingsForecastVnd >= budgets.mssVnd
  const savingsTone: "ok" | "warn" | "danger" = savingsMet
    ? "ok"
    : savingsAboveMss
      ? "warn"
      : "danger"
  const savingsGoalRate =
    budgets.savingsTargetVnd > 0
      ? savingsForecastVnd / budgets.savingsTargetVnd
      : savingsForecastVnd >= 0
        ? 1
        : 0
  const savingsProgress = Math.max(0, Math.min(100, savingsGoalRate * 100))
  const savingsRemainingToGoalVnd = Math.max(0, budgets.savingsTargetVnd - savingsForecastVnd)
  const savingsVerdict = savingsMet
    ? isCurrentMonth
      ? "Đang đúng hướng đạt mục tiêu"
      : "Đạt mục tiêu tiết kiệm"
    : savingsAboveMss
      ? "Có nguy cơ hụt mục tiêu tiết kiệm"
      : "Dưới mức an toàn tối thiểu (MSS)"

  const topCategories = useMemo(() => {
    const totalsByCategory = getCategoryTotals(data, month)
    return Object.entries(totalsByCategory)
      .map(([category, totalVnd]) => ({ category, label: categoryLabel(category), totalVnd }))
      .sort((a, b) => b.totalVnd - a.totalVnd)
      .slice(0, 8)
  }, [categoryLabels, categoryOptions, data, month])

  const rootGap = compactMode ? "space-y-4" : "space-y-5"

  return (
    <div className={rootGap}>
      <BudgetHeader
        month={month}
        onMonthChange={setMonth}
        onOpenDrawer={() => openDrawer("details", "budget-details-overview")}
        locked={locked}
        compactMode={compactMode}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Thu nhập (I)"
          value={formatVnd(budgets.incomeVnd)}
          hint={`Quy tắc W/S ${budgets.split.wantsPct}/${budgets.split.savingsPct}`}
          onClick={() => openDrawer("details", "budget-details-overview")}
        />
        <KpiCard
          label="Tiết kiệm (S)"
          value={formatVnd(budgets.savingsTargetVnd)}
          hint={`MSS ${formatVnd(budgets.mssVnd)}`}
          onClick={() => openDrawer("details", "budget-details-overview")}
        />
        <KpiCard
          label="Ngân sách chi (I − S)"
          value={formatVnd(spendingBudgetVnd)}
          hint="Budget tháng"
          onClick={() => openDrawer("details", "budget-details-progress")}
        />
        <KpiCard
          label="Đã chi"
          value={formatVnd(totals.totalSpent)}
          hint="F + E + W"
          onClick={() => openDrawer("details", "budget-details-progress")}
        />
        <KpiCard
          label="Còn lại"
          value={formatVnd(totalRemaining)}
          hint={totalRemaining < 0 ? "Vượt ngân sách" : "Trong giới hạn"}
          danger={totalRemaining < 0}
          onClick={() => openDrawer("details", "budget-details-progress")}
        />
      </div>

      <div
        className={cn(
          "grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]",
          compactMode && "gap-3",
        )}
      >
        <AllocationCard
          incomeVnd={budgets.incomeVnd}
          fixedVnd={totals.fixedCostsTotal}
          essentialVnd={budgets.essentialVariableBaselineVnd}
          wantsVnd={budgets.wantsBudgetVnd}
          savingsVnd={budgets.savingsTargetVnd}
          note={allocationNote}
          onOpenDetails={() => openDrawer("details", "budget-details-overview")}
          compactMode={compactMode}
        />
        <SpendingProgressCard
          spendingBudgetVnd={spendingBudgetVnd}
          spentVnd={totals.totalSpent}
          fixedVnd={totals.fixedCostsTotal}
          essentialVnd={totals.variableNeeds}
          wantsVnd={totals.variableWants}
          remainingVnd={totalRemaining}
          onOpenDetails={() => openDrawer("details", "budget-details-progress")}
          compactMode={compactMode}
        />
      </div>

      <div className={cn("grid gap-4 lg:grid-cols-3", compactMode && "gap-3")}>
        <CategoryCard
          title="Thiết yếu (E)"
          subtitle="Chi thiết yếu biến đổi (ăn uống, đi lại...)"
          planLabel="Định mức"
          planVnd={budgets.essentialVariableBaselineVnd}
          actualLabel="Đã chi"
          actualVnd={essentialActual}
          remainingVnd={essentialRemaining}
          progressPct={essentialProgress}
          status={
            essentialRemaining < 0
              ? `Vượt ${formatVnd(Math.abs(essentialRemaining))}`
              : undefined
          }
          statusTone={essentialRemaining < 0 ? "danger" : "muted"}
          onOpenDetails={() => openDrawer("details", "budget-details-overview")}
          compactMode={compactMode}
        />
        <CategoryCard
          title="Mong muốn"
          subtitle="W"
          planLabel="Kế hoạch"
          planVnd={budgets.wantsBudgetVnd}
          actualLabel="Đã chi"
          actualVnd={wantsActual}
          remainingVnd={wantsRemaining}
          progressPct={wantsProgress}
          status={wantsRemaining < 0 ? `Vượt ${formatVnd(Math.abs(wantsRemaining))}` : undefined}
          statusTone={wantsRemaining < 0 ? "danger" : "muted"}
          onOpenDetails={() => openDrawer("details", "budget-details-overview")}
          compactMode={compactMode}
        />
        <CategoryCard
          title="Tiết kiệm"
          subtitle={isCurrentMonth ? "S — dự báo cuối tháng theo nhịp chi" : "S — tiết kiệm thực tế"}
          planLabel="Mục tiêu S"
          planVnd={budgets.savingsTargetVnd}
          actualLabel={isCurrentMonth ? "Dự báo cuối tháng" : "Tiết kiệm thực tế"}
          actualVnd={savingsForecastVnd}
          actualValueClassName={cn(
            savingsTone === "danger" && "text-destructive",
            savingsTone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
          remainingVnd={savingsRemainingToGoalVnd}
          remainingLabel="Còn thiếu để đạt S"
          progressPct={savingsProgress}
          status={savingsVerdict}
          statusTone={savingsTone}
          onOpenDetails={() => openDrawer("details", "budget-details-forecast")}
          compactMode={compactMode}
        />
      </div>

      <LeftDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        sectionId={drawerSectionId}
        month={month}
        compactMode={compactMode}
        onCompactModeChange={setCompactMode}
        incomeVnd={budgets.incomeVnd}
        fixedCostsVnd={totals.fixedCostsTotal}
        essentialBaselineVnd={budgets.essentialVariableBaselineVnd}
        wantsBudgetVnd={budgets.wantsBudgetVnd}
        savingsTargetVnd={budgets.savingsTargetVnd}
        mssVnd={budgets.mssVnd}
        spendingBudgetVnd={spendingBudgetVnd}
        spentVnd={totals.totalSpent}
        remainingVnd={totalRemaining}
        projectedSavingsVnd={projectedSavingsVnd}
        projectedNeedsEndMonthVnd={projectedNeedsEndMonthVnd}
        projectedWantsEndMonthVnd={projectedWantsEndMonthVnd}
        expectedVariableRemainingVnd={expectedVariableRemainingVnd}
        topCategories={topCategories}
      />
    </div>
  )
}
