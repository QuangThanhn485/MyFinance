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
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import type { YearMonth } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import {
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
  todayIso,
} from "@/lib/date"
import { getCategoryTotals, getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts"

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
          "mt-1 text-xl font-semibold tracking-tight tabular-nums whitespace-nowrap",
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

function SegmentChip({
  active,
  color,
  label,
  value,
  pctOfIncome,
  onClick,
}: {
  active: boolean
  color: string
  label: string
  value: number
  pctOfIncome: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-muted text-foreground border-border"
          : "bg-background hover:bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
      <span className="text-foreground tabular-nums whitespace-nowrap">
        {pctOfIncome.toFixed(0)}% • {formatVnd(value)}
      </span>
    </button>
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
    <div className="sticky top-14 md:top-0 z-30 -mx-3 sm:-mx-4 lg:-mx-6">
      <div className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6",
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

          <div className="flex items-center gap-2">
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
}: {
  incomeVnd: number
  fixedVnd: number
  essentialVnd: number
  wantsVnd: number
  savingsVnd: number
  onOpenDetails: () => void
  compactMode: boolean
}) {
  const [highlight, setHighlight] = useState<string | null>(null)

  const segments = useMemo(() => {
    const income = Math.max(0, incomeVnd)
    const fixed = Math.max(0, fixedVnd)
    const essential = Math.max(0, essentialVnd)
    const wants = Math.max(0, wantsVnd)
    const savings = Math.max(0, savingsVnd)
    const sum = fixed + essential + wants + savings
    const unallocated = Math.max(0, income - sum)
    const overflow = Math.max(0, sum - income)
    const barDenominator = Math.max(1, income + overflow)

    const pctOfIncome = (value: number) => (income > 0 ? (value / income) * 100 : 0)
    const pctOfBar = (value: number) => (value / barDenominator) * 100

    const items = [
      {
        key: "fixed",
        label: "Cố định (F)",
        value: fixed,
        pctIncome: pctOfIncome(fixed),
        pctBar: pctOfBar(fixed),
        color: "hsl(var(--chart-6))",
      },
      {
        key: "essential",
        label: "Thiết yếu (E)",
        value: essential,
        pctIncome: pctOfIncome(essential),
        pctBar: pctOfBar(essential),
        color: "hsl(var(--chart-1))",
      },
      {
        key: "wants",
        label: "Mong muốn (W)",
        value: wants,
        pctIncome: pctOfIncome(wants),
        pctBar: pctOfBar(wants),
        color: "hsl(var(--chart-5))",
      },
      {
        key: "savings",
        label: "Tiết kiệm (S)",
        value: savings,
        pctIncome: pctOfIncome(savings),
        pctBar: pctOfBar(savings),
        color: "hsl(var(--chart-2))",
      },
      {
        key: "unallocated",
        label: "Chưa phân bổ",
        value: unallocated,
        pctIncome: pctOfIncome(unallocated),
        pctBar: pctOfBar(unallocated),
        color: "hsl(var(--muted-foreground) / 0.25)",
      },
      {
        key: "overflow",
        label: "Vượt thu nhập",
        value: overflow,
        pctIncome: pctOfIncome(overflow),
        pctBar: pctOfBar(overflow),
        color: "hsl(var(--destructive))",
      },
    ].filter((x) => x.value > 0)

    return { overflow, items }
  }, [essentialVnd, fixedVnd, incomeVnd, savingsVnd, wantsVnd])

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row items-start justify-between gap-2",
          compactMode ? "pb-2" : "pb-3",
        )}
      >
        <div className="min-w-0">
          <CardTitle className="text-base">Kế hoạch phân bổ</CardTitle>
          <div className="text-xs text-muted-foreground truncate">Chạm chip để highlight</div>
        </div>
        <div className="flex items-center gap-1">
          <InfoTip label="Giải thích kế hoạch phân bổ">
            <div className="font-medium">Kế hoạch phân bổ</div>
            <div className="text-muted-foreground">
              Kế hoạch được tính theo I (thu nhập tháng). Sau khi trừ F và E, phần còn lại được chia cho W và S theo tỉ lệ đã cài đặt.
            </div>
          </InfoTip>
          <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
            Chi tiết
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {segments.overflow > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive font-medium">
              Kế hoạch đang vượt thu nhập: {formatVnd(segments.overflow)}
            </div>
          ) : null}

          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div className="flex h-full w-full">
              {segments.items.map((it) => {
                const dimmed = highlight && highlight !== it.key
                return (
                  <div
                    key={it.key}
                    className={cn("h-full transition-opacity", dimmed && "opacity-30")}
                    style={{ width: `${it.pctBar}%`, backgroundColor: it.color }}
                    title={`${it.label}: ${formatVnd(it.value)}`}
                  />
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {segments.items
              .filter((x) => ["fixed", "essential", "wants", "savings"].includes(x.key))
              .map((it) => (
                <SegmentChip
                  key={it.key}
                  active={highlight === it.key}
                  color={it.color}
                  label={it.label}
                  value={it.value}
                  pctOfIncome={it.pctIncome}
                  onClick={() => setHighlight((prev) => (prev === it.key ? null : it.key))}
                />
              ))}
          </div>
        </div>
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
  const overByVnd = remainingVnd < 0 ? Math.abs(remainingVnd) : 0
  const usage = useMemo(() => {
    const total = Math.max(0, spendingBudgetVnd)
    const fixed = Math.max(0, fixedVnd)
    const essential = Math.max(0, essentialVnd)
    const wants = Math.max(0, wantsVnd)
    const spent = fixed + essential + wants
    const remaining = Math.max(0, total - spent)

    const items = [
      {
        key: "fixed",
        label: "Cố định (F)",
        value: fixed,
        color: "hsl(var(--chart-6))",
      },
      {
        key: "essential",
        label: "Thiết yếu (E)",
        value: essential,
        color: "hsl(var(--chart-1))",
      },
      {
        key: "wants",
        label: "Mong muốn (W)",
        value: wants,
        color: "hsl(var(--chart-5))",
      },
      {
        key: "remaining",
        label: "Còn lại",
        value: remaining,
        color: "hsl(var(--chart-2))",
      },
    ].filter((x) => x.value > 0)

    return { items }
  }, [essentialVnd, fixedVnd, spendingBudgetVnd, wantsVnd])

  const progressPct = spendingBudgetVnd > 0 ? (spentVnd / spendingBudgetVnd) * 100 : 0

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row items-start justify-between gap-2",
          compactMode ? "pb-2" : "pb-3",
        )}
      >
        <div className="min-w-0">
          <CardTitle className="text-base">Tiến độ chi tiêu</CardTitle>
          <div className="text-xs text-muted-foreground truncate">Ngân sách chi = I − S</div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
          Chi tiết
        </Button>
      </CardHeader>
      <CardContent className={cn("pt-0", compactMode ? "space-y-3" : "space-y-4")}>
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <div className="h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={usage.items}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={38}
                  outerRadius={54}
                  paddingAngle={1}
                  stroke="transparent"
                >
                  {usage.items.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: unknown, name: unknown) => {
                    const v = typeof value === "number" ? value : 0
                    return [formatVnd(v), String(name)]
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 text-sm">
            <LabelValueRow label="Ngân sách chi" value={formatVnd(spendingBudgetVnd)} />
            <LabelValueRow label="Đã chi" value={formatVnd(spentVnd)} />
            <Separator />
            <LabelValueRow
              label="Còn lại"
              value={formatVnd(remainingVnd)}
              valueClassName={cn(remainingVnd < 0 && "text-destructive")}
            />

            {overByVnd > 0 ? (
              <div className="text-xs font-medium text-destructive">
                Vượt ngân sách: {formatVnd(overByVnd)}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Đang trong giới hạn.</div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <LabelValueRow
            className="text-xs"
            label="Mức sử dụng ngân sách"
            value={`${Math.max(0, Math.min(999, progressPct)).toFixed(1)}%`}
            valueClassName={cn(overByVnd > 0 && "text-destructive")}
          />
          <Progress value={Math.max(0, Math.min(100, progressPct))} />
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
  remainingLabel?: string
  remainingVnd: number
  progressPct: number
  status?: string
  statusTone?: "muted" | "danger" | "ok"
  onOpenDetails: () => void
  compactMode: boolean
}) {
  const statusClass =
    statusTone === "danger"
      ? "text-destructive"
      : statusTone === "ok"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-muted-foreground"

  return (
    <Card>
      <CardHeader
        className={cn(
          "flex-row items-start justify-between gap-2",
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
          <LabelValueRow label={actualLabel} value={formatVnd(actualVnd)} />
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
  topCategories: Array<{ category: string; totalVnd: number }>
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
        className="left-0 top-0 h-dvh w-[100vw] sm:w-[460px] max-w-[100vw] translate-x-0 translate-y-0 rounded-none border-0 border-r p-0 gap-0"
        aria-label="Chi tiết & cài đặt ngân sách"
      >
        <Tabs
          value={tab}
          onValueChange={(v) => onTabChange(v as DrawerTab)}
          className="flex h-dvh flex-col"
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
                          label={c.category}
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
                  <div className="flex items-center justify-between gap-3">
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
    incomeVnd: settingsForMonth.monthlyIncomeVnd,
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })

  const spendingBudgetVnd = Math.max(0, budgets.incomeVnd - budgets.savingsTargetVnd)
  const needsActual = totals.fixedCostsTotal + totals.variableNeeds
  const wantsActual = totals.variableWants

  const now = todayIso()
  const currentMonth = monthFromIsoDate(now)
  const dim = daysInMonth(month)
  const dom =
    month === currentMonth ? dayOfMonthFromIsoDate(now) : month < currentMonth ? dim : 1
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

  const needsProgress =
    budgets.needsBudgetVnd > 0 ? (needsActual / budgets.needsBudgetVnd) * 100 : 0
  const wantsProgress =
    budgets.wantsBudgetVnd > 0 ? (wantsActual / budgets.wantsBudgetVnd) * 100 : 0

  const needsRemaining = budgets.needsBudgetVnd - needsActual
  const wantsRemaining = budgets.wantsBudgetVnd - wantsActual
  const totalRemaining = spendingBudgetVnd - totals.totalSpent

  const projectedSavingsGoalRate =
    budgets.savingsTargetVnd > 0 ? projectedSavingsVnd / budgets.savingsTargetVnd : 0
  const savingsProgress = Math.max(0, Math.min(100, projectedSavingsGoalRate * 100))
  const savingsRemainingToGoalVnd = Math.max(0, budgets.savingsTargetVnd - projectedSavingsVnd)

  const topCategories = useMemo(() => {
    const totalsByCategory = getCategoryTotals(data, month)
    return Object.entries(totalsByCategory)
      .map(([category, totalVnd]) => ({ category, totalVnd }))
      .sort((a, b) => b.totalVnd - a.totalVnd)
      .slice(0, 8)
  }, [data, month])

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
          hint={`W ${budgets.split.wantsPct}% • S ${budgets.split.savingsPct}%`}
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
          title="Thiết yếu & cố định"
          subtitle="F + E"
          planLabel="Kế hoạch"
          planVnd={budgets.needsBudgetVnd}
          actualLabel="Đã chi"
          actualVnd={needsActual}
          remainingVnd={needsRemaining}
          progressPct={needsProgress}
          status={needsRemaining < 0 ? `Vượt ${formatVnd(Math.abs(needsRemaining))}` : undefined}
          statusTone={needsRemaining < 0 ? "danger" : "muted"}
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
          subtitle="S (ước tính theo nhịp)"
          planLabel="Mục tiêu S"
          planVnd={budgets.savingsTargetVnd}
          actualLabel="Dự báo cuối tháng"
          actualVnd={projectedSavingsVnd}
          remainingVnd={savingsRemainingToGoalVnd}
          remainingLabel="Còn thiếu để đạt S"
          progressPct={savingsProgress}
          status={
            projectedSavingsVnd >= budgets.savingsTargetVnd
              ? "Dự kiến đạt mục tiêu"
              : `Thiếu ${formatVnd(savingsRemainingToGoalVnd)}`
          }
          statusTone={projectedSavingsVnd >= budgets.savingsTargetVnd ? "ok" : "danger"}
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
