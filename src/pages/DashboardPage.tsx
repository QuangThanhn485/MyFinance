import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import {
  computeBudgets,
  computeEmergencyFund,
  computeMinimumSafetySavings,
} from "@/domain/finance/finance"
import {
  computeRemainingDailySpendingCap,
  resolveEffectiveDailyTotalCapVnd,
} from "@/domain/finance/dailySafeCap"
import type { ExpenseCategory } from "@/domain/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LabelValueRow from "@/components/LabelValueRow"
import { Label } from "@/components/ui/label"
import MoneyInput from "@/components/MoneyInput"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatVnd } from "@/lib/currency"
import {
  addDaysIsoDate,
  monthFromIsoDate,
  todayIso,
} from "@/lib/date"
import { cn } from "@/lib/utils"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import { getDayLockMonthContext } from "@/storage/dayLock"
import { getCategoryTotals, getExpensesByDate, getMonthTotals } from "@/selectors/expenses"
import { getEffectiveEmergencyFundBalance } from "@/selectors/savings"
import { useAppStore } from "@/store/useAppStore"

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatCoverageMonths(value: number) {
  if (!Number.isFinite(value)) return "-"
  return `${value.toFixed(1)} tháng`
}

type MetricCardProps = {
  title: string
  value: string
  subValue?: string
  danger?: boolean
}

function MetricCard({ title, value, subValue, danger = false }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className={cn("text-xl font-semibold tabular-nums", danger && "text-destructive")}>
            {value}
          </div>
          {subValue ? <div className="text-xs text-muted-foreground">{subValue}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const data = useAppStore((s) => s.data)
  const addExpense = useAppStore((s) => s.actions.addExpense)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getDayLockMonthContext(today)
  const totals = getMonthTotals(data, month)
  const settingsForMonth = getEffectiveSettingsForMonth(data, month)
  const todayExpenses = getExpensesByDate(data, today)
  const todaySpent = todayExpenses.reduce((sum, ex) => sum + ex.amountVnd, 0)

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIsoDate(today, -i))
  const weekSpent = weekDates.reduce(
    (sum, date) =>
      sum + getExpensesByDate(data, date).reduce((innerSum, ex) => innerSum + ex.amountVnd, 0),
    0,
  )

  const adjustment = getEffectiveBudgetAdjustmentForMonth(data, month)
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })

  const savingsMin = budgets.savingsTargetVnd
  const MSS = computeMinimumSafetySavings(budgets.incomeVnd)

  const todayLocked = dayContext.locked
  const monthLocked = isMonthLocked(data, month)
  const daysRemaining = dayContext.remainingDaysInMonth
  const remainingDailyCap = computeRemainingDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: savingsMin,
    totalSpentVnd: totals.totalSpent,
    remainingDaysInMonth: daysRemaining,
  })
  const spendingBudgetVnd = remainingDailyCap.spendingBudgetVnd
  const totalRemaining = remainingDailyCap.totalRemainingVnd
  const essentialRemaining = budgets.essentialVariableBaselineVnd - totals.variableNeeds
  const wantsRemaining = budgets.wantsBudgetVnd - totals.variableWants
  const caps = getEffectiveCapsForMonth(data, month)
  const shownDailyCap = resolveEffectiveDailyTotalCapVnd({
    computedDailyTotalCapVnd: remainingDailyCap.dailyTotalCapVnd,
    appliedDailyTotalCapVnd: caps?.dailyTotalCapVnd,
  })

  const emergency = computeEmergencyFund({
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: budgets.essentialVariableBaselineVnd,
    targetMonths: settingsForMonth.emergencyFundTargetMonths,
    currentBalanceVnd: getEffectiveEmergencyFundBalance(data, month),
  })
  const emergencyProgress = clampPct(
    emergency.targetVnd > 0 ? (emergency.currentVnd / emergency.targetVnd) * 100 : 0,
  )

  const wantsFreezeActive =
    caps?.wantsFreezeUntil && today <= caps.wantsFreezeUntil ? true : false

  const spendingProgressPct =
    spendingBudgetVnd > 0 ? (totals.totalSpent / spendingBudgetVnd) * 100 : 0
  const essentialProgressPct =
    budgets.essentialVariableBaselineVnd > 0
      ? (totals.variableNeeds / budgets.essentialVariableBaselineVnd) * 100
      : 0
  const wantsProgressPct =
    budgets.wantsBudgetVnd > 0 ? (totals.variableWants / budgets.wantsBudgetVnd) * 100 : 0
  const spendingProgress = clampPct(spendingProgressPct)
  const essentialProgress = clampPct(essentialProgressPct)
  const wantsProgress = clampPct(wantsProgressPct)
  const projectedSavingsNow = budgets.incomeVnd - totals.totalSpent

  const categoryRows = useMemo(() => {
    const categories = getCategoryTotals(data, month)
    return Object.entries(categories)
      .map(([category, amountVnd]) => ({
        category,
        amountVnd,
      }))
      .sort((a, b) => b.amountVnd - a.amountVnd)
      .slice(0, 5)
  }, [data, month])
  const topCategoryMax = categoryRows[0]?.amountVnd ?? 0

  const [quickAmountVnd, setQuickAmountVnd] = useState(0)
  const [quickCategory, setQuickCategory] = useState<ExpenseCategory>("Food")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tổng quan</h1>
          <p className="text-sm text-muted-foreground">Tháng {month} • Theo dõi nhanh tình hình chi tiêu.</p>
        </div>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">MSS: </span>
          <span className="font-semibold tabular-nums">{formatVnd(MSS)}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard title="Chi hôm nay" value={formatVnd(todaySpent)} />
        <MetricCard title="7 ngày gần nhất" value={formatVnd(weekSpent)} />
        <MetricCard title="Chi tháng đến nay" value={formatVnd(totals.totalSpent)} />
        <MetricCard
          title="Còn lại ngân sách chi"
          value={formatVnd(totalRemaining)}
          danger={totalRemaining < 0}
        />
        <MetricCard
          title="Cap chi mỗi ngày"
          value={formatVnd(shownDailyCap)}
          subValue={`${daysRemaining} ngày còn lại${todayLocked ? " (đã khoá hôm nay)" : ""}`}
        />
        <MetricCard
          title="Quỹ khẩn cấp phủ được"
          value={formatCoverageMonths(emergency.coverageMonths)}
          subValue={emergency.status}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Tiến độ ngân sách tháng</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <LabelValueRow
                label="Ngân sách chi tháng"
                value={formatVnd(spendingBudgetVnd)}
                valueClassName="font-semibold"
              />
              <LabelValueRow
                label="Đã chi"
                value={formatVnd(totals.totalSpent)}
                valueClassName={cn(totals.totalSpent > spendingBudgetVnd && "text-destructive")}
              />
              <LabelValueRow
                label="Còn lại"
                value={formatVnd(totalRemaining)}
                valueClassName={cn(totalRemaining < 0 && "text-destructive")}
              />

              <div className="space-y-1.5 pt-1">
                <LabelValueRow
                  label="Tổng chi / ngân sách"
                  value={`${Math.max(0, spendingProgressPct).toFixed(0)}%`}
                  className="text-sm"
                  valueClassName={cn(spendingProgressPct > 100 && "text-destructive")}
                />
                <Progress value={spendingProgress} />
              </div>
              <div className="space-y-1.5">
                <LabelValueRow
                  label="Thiết yếu biến đổi (E)"
                  value={`${Math.max(0, essentialProgressPct).toFixed(0)}%`}
                  className="text-sm"
                  valueClassName={cn(essentialProgressPct > 100 && "text-destructive")}
                />
                <Progress value={essentialProgress} />
              </div>
              <div className="space-y-1.5">
                <LabelValueRow
                  label="Mong muốn (W)"
                  value={`${Math.max(0, wantsProgressPct).toFixed(0)}%`}
                  className="text-sm"
                  valueClassName={cn(wantsProgressPct > 100 && "text-destructive")}
                />
                <Progress value={wantsProgress} />
              </div>

              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <LabelValueRow
                  label="E còn lại"
                  value={formatVnd(essentialRemaining)}
                  valueClassName={cn(essentialRemaining < 0 && "text-destructive")}
                />
                <LabelValueRow
                  label="W còn lại"
                  value={formatVnd(wantsRemaining)}
                  valueClassName={cn(wantsRemaining < 0 && "text-destructive")}
                />
                <LabelValueRow
                  label="Tiết kiệm tạm tính"
                  value={formatVnd(projectedSavingsNow)}
                  valueClassName={cn(projectedSavingsNow < 0 && "text-destructive")}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Danh mục chi nhiều nhất</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {categoryRows.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Chưa có dữ liệu chi tiêu trong tháng.
                </div>
              ) : (
                categoryRows.map((row) => {
                  const width =
                    topCategoryMax > 0 ? Math.max(6, (row.amountVnd / topCategoryMax) * 100) : 0
                  const label =
                    CATEGORY_LABELS_VI[row.category as ExpenseCategory] ?? row.category
                  return (
                    <div key={row.category} className="space-y-1.5">
                      <LabelValueRow label={label} value={formatVnd(row.amountVnd)} className="text-sm" />
                      <div className="h-2 rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, width)}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Ghi nhanh hôm nay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <Label>Số tiền (VND)</Label>
                <MoneyInput
                  placeholder="Ví dụ: 35.000"
                  value={quickAmountVnd}
                  onValueChange={setQuickAmountVnd}
                />
              </div>
              <div className="grid gap-2">
                <Label>Danh mục</Label>
                <Select
                  value={quickCategory}
                  onValueChange={(value) => setQuickCategory(value as ExpenseCategory)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn danh mục" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {CATEGORY_LABELS_VI[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  if (monthLocked) {
                    toast.error(`Tháng ${month} đã chốt báo cáo nên không thể thêm chi tiêu.`)
                    return
                  }
                  if (todayLocked) {
                    toast.error("Hôm nay đã khoá. Mở khoá tại Ghi chi tiêu để thêm dữ liệu.")
                    return
                  }
                  if (quickAmountVnd <= 0) {
                    toast.error("Vui lòng nhập số tiền hợp lệ.")
                    return
                  }
                  addExpense({
                    amountVnd: quickAmountVnd,
                    category: quickCategory,
                    date: today,
                    note: "Hôm nay chi",
                  })
                  setQuickAmountVnd(0)
                  toast.success("Đã ghi chi tiêu.")
                }}
              >
                Ghi chi tiêu
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Quỹ khẩn cấp & an toàn</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <LabelValueRow label="Hiện có" value={formatVnd(emergency.currentVnd)} />
              <LabelValueRow label="Mục tiêu" value={formatVnd(emergency.targetVnd)} />
              <LabelValueRow
                label="Phủ được"
                value={formatCoverageMonths(emergency.coverageMonths)}
              />
              <Progress value={emergencyProgress} />

              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {wantsFreezeActive ? (
                  <div className="font-medium text-destructive">
                    Đang đóng băng Mong muốn đến {caps?.wantsFreezeUntil}
                  </div>
                ) : (
                  <div className="text-muted-foreground">Không có đóng băng Mong muốn.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
