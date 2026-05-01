import { useEffect, useMemo, useState } from "react"
import { Calculator, CalendarDays, Gauge, Target, TrendingUp } from "lucide-react"
import LabelValueRow from "@/components/LabelValueRow"
import MoneyInput from "@/components/MoneyInput"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  computeDailyCapRaisePlanByCeiling,
  computeDailyCapRaisePlanByDays,
  computeRemainingDailySpendingCap,
  resolveEffectiveDailyTotalCapVnd,
} from "@/domain/finance/dailySafeCap"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import { formatVnd } from "@/lib/currency"
import { monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { getMonthTotals } from "@/selectors/expenses"
import { getDayLockMonthContext } from "@/storage/dayLock"
import { useAppStore } from "@/store/useAppStore"

function clampPositiveInt(value: string, fallback: number) {
  const parsed = Number(value.replace(/[^\d]/g, ""))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.trunc(parsed))
}

function MetricTile({
  label,
  value,
  subValue,
  danger,
}: {
  label: string
  value: string
  subValue?: string
  danger?: boolean
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-semibold tabular-nums", danger && "text-destructive")}>
        {value}
      </div>
      {subValue ? <div className="mt-0.5 text-xs text-muted-foreground">{subValue}</div> : null}
    </div>
  )
}

export default function DailyCapPlannerPage() {
  const data = useAppStore((s) => s.data)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getDayLockMonthContext(today)
  const totals = useMemo(() => getMonthTotals(data, month), [data, month])
  const settings = useMemo(() => getEffectiveSettingsForMonth(data, month), [data, month])
  const adjustment = useMemo(() => getEffectiveBudgetAdjustmentForMonth(data, month), [data, month])
  const budgets = useMemo(
    () =>
      computeBudgets({
        incomeVnd: getMonthlyIncomeTotalVnd(settings),
        fixedCostsVnd: totals.fixedCostsTotal,
        essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
        rule: settings.budgetRule,
        adjustment,
        customSavingsGoalVnd: settings.customSavingsGoalVnd,
      }),
    [adjustment, settings, totals.fixedCostsTotal],
  )
  const remainingCap = useMemo(
    () =>
      computeRemainingDailySpendingCap({
        incomeVnd: budgets.incomeVnd,
        savingsTargetVnd: budgets.savingsTargetVnd,
        totalSpentVnd: totals.totalSpent,
        remainingDaysInMonth: dayContext.remainingDaysInMonth,
      }),
    [budgets.incomeVnd, budgets.savingsTargetVnd, dayContext.remainingDaysInMonth, totals.totalSpent],
  )
  const caps = getEffectiveCapsForMonth(data, month)
  const computedDailyCapVnd = remainingCap.dailyTotalCapVnd
  const shownDailyCapVnd = resolveEffectiveDailyTotalCapVnd({
    computedDailyTotalCapVnd: computedDailyCapVnd,
    appliedDailyTotalCapVnd: caps?.dailyTotalCapVnd,
  })
  const appliedCapIsLimiting =
    caps?.dailyTotalCapVnd !== undefined &&
    caps.dailyTotalCapVnd !== null &&
    caps.dailyTotalCapVnd < computedDailyCapVnd
  const maxPlanDays = Math.max(0, dayContext.remainingDaysInMonth - 1)

  const [targetCapVnd, setTargetCapVnd] = useState(() =>
    Math.max(120_000, shownDailyCapVnd + 20_000),
  )
  const [planDays, setPlanDays] = useState(() => Math.min(10, Math.max(1, maxPlanDays)))
  const [manualCeilingVnd, setManualCeilingVnd] = useState(() =>
    Math.max(0, shownDailyCapVnd - 20_000),
  )

  useEffect(() => {
    if (maxPlanDays <= 0) {
      setPlanDays(0)
      return
    }
    setPlanDays((value) => Math.min(Math.max(1, value), maxPlanDays))
  }, [maxPlanDays])

  const byDaysPlan = useMemo(
    () =>
      computeDailyCapRaisePlanByDays({
        totalRemainingVnd: remainingCap.totalRemainingVnd,
        remainingDaysInMonth: dayContext.remainingDaysInMonth,
        currentDailyCapVnd: shownDailyCapVnd,
        targetDailyCapVnd: targetCapVnd,
        planDays,
      }),
    [dayContext.remainingDaysInMonth, planDays, remainingCap.totalRemainingVnd, shownDailyCapVnd, targetCapVnd],
  )
  const byCeilingPlan = useMemo(
    () =>
      computeDailyCapRaisePlanByCeiling({
        totalRemainingVnd: remainingCap.totalRemainingVnd,
        remainingDaysInMonth: dayContext.remainingDaysInMonth,
        currentDailyCapVnd: shownDailyCapVnd,
        targetDailyCapVnd: targetCapVnd,
        dailyCeilingVnd: manualCeilingVnd,
      }),
    [
      dayContext.remainingDaysInMonth,
      manualCeilingVnd,
      remainingCap.totalRemainingVnd,
      shownDailyCapVnd,
      targetCapVnd,
    ],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Phân tích nâng cap ngày</h1>
          <p className="text-sm text-muted-foreground">
            Tháng {month} · Dữ liệu tính từ {dayContext.remainingStartDate}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dayContext.locked ? <Badge variant="secondary">Hôm nay đã khoá</Badge> : null}
          {appliedCapIsLimiting ? <Badge variant="outline">Cap áp dụng đang giới hạn</Badge> : null}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Cap đang hiển thị" value={formatVnd(shownDailyCapVnd)} />
        <MetricTile label="Cap theo số liệu" value={formatVnd(computedDailyCapVnd)} />
        <MetricTile
          label="Còn được chi"
          value={formatVnd(remainingCap.totalRemainingVnd)}
          danger={remainingCap.totalRemainingVnd < 0}
        />
        <MetricTile label="Ngày còn lại" value={`${dayContext.remainingDaysInMonth} ngày`} />
        <MetricTile label="Mục tiêu tiết kiệm" value={formatVnd(budgets.savingsTargetVnd)} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span>Mục tiêu cap</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end">
            <div className="grid gap-1.5">
              <Label>Cap muốn đạt</Label>
              <MoneyInput
                value={targetCapVnd}
                onValueChange={setTargetCapVnd}
                placeholder="Ví dụ: 120.000"
                showSteppers
                stepVnd={10_000}
              />
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Cap sau kế hoạch = floor((còn được chi hiện tại - trần chi mỗi ngày * số ngày giữ trần) / ngày còn lại sau kế hoạch).
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span>Theo số ngày giữ trần</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label>Số ngày</Label>
                <Input
                  inputMode="numeric"
                  value={planDays}
                  onChange={(event) =>
                    setPlanDays(Math.min(maxPlanDays, clampPositiveInt(event.target.value, planDays)))
                  }
                />
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <LabelValueRow
                  label="Số ngày tối đa có thể mô phỏng"
                  value={`${maxPlanDays} ngày`}
                />
                <LabelValueRow
                  label="Ngày còn lại sau kế hoạch"
                  value={`${byDaysPlan.remainingDaysAfterPlan} ngày`}
                />
              </div>
            </div>

            <Separator />

            {byDaysPlan.feasible ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Gauge className="h-4 w-4" />
                    Trần cần giữ
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatVnd(byDaysPlan.requiredDailyCeilingVnd)}
                  </div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4" />
                    Cap sau {planDays} ngày
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatVnd(byDaysPlan.projectedDailyCapAfterPlanVnd)}
                  </div>
                </div>
                <LabelValueRow
                  label="Giảm so với cap đang hiển thị"
                  value={formatVnd(byDaysPlan.dailyReductionFromCurrentCapVnd)}
                />
                <LabelValueRow
                  label={`Tổng được chi trong ${planDays} ngày`}
                  value={formatVnd(byDaysPlan.allowedSpendDuringPlanVnd)}
                />
                <LabelValueRow
                  label="Cần giữ lại cho phần ngày sau"
                  value={formatVnd(byDaysPlan.requiredReserveForAfterPlanVnd)}
                />
                <LabelValueRow
                  label="Còn lại sau kế hoạch"
                  value={formatVnd(byDaysPlan.projectedRemainingAfterPlanVnd)}
                />
              </div>
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                Không đạt được {formatVnd(targetCapVnd)} sau {planDays} ngày, kể cả khi chi 0 đ/ngày.
                Cap tối đa với {planDays} ngày là {formatVnd(byDaysPlan.maxAchievableDailyCapVnd)}.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-muted-foreground" />
              <span>Theo trần chi chủ động</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label>Trần bạn có thể giữ mỗi ngày</Label>
              <MoneyInput
                value={manualCeilingVnd}
                onValueChange={setManualCeilingVnd}
                placeholder="Ví dụ: 80.000"
                showSteppers
                stepVnd={10_000}
              />
            </div>

            <Separator />

            {byCeilingPlan.feasible ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-background p-3">
                  <div className="text-sm text-muted-foreground">Số ngày cần giữ</div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    {byCeilingPlan.daysNeeded === 0 ? "0 ngày" : `${byCeilingPlan.daysNeeded} ngày`}
                  </div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-sm text-muted-foreground">Cap sau kế hoạch</div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatVnd(byCeilingPlan.projectedDailyCapAfterPlanVnd)}
                  </div>
                </div>
                <LabelValueRow
                  label="Ngày còn lại sau kế hoạch"
                  value={`${byCeilingPlan.remainingDaysAfterPlan} ngày`}
                />
                <LabelValueRow
                  label="Còn được chi sau kế hoạch"
                  value={formatVnd(byCeilingPlan.projectedRemainingAfterPlanVnd)}
                />
              </div>
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                Với trần {formatVnd(manualCeilingVnd)}/ngày, không thể nâng cap lên {formatVnd(targetCapVnd)} trong tháng này.
                Cap cao nhất mô phỏng được là {formatVnd(byCeilingPlan.maxAchievableDailyCapVnd)}.
              </div>
            )}

            {appliedCapIsLimiting ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Cap hiển thị đang bị chặn bởi cap áp dụng {formatVnd(caps?.dailyTotalCapVnd ?? 0)}. Mô phỏng này tính phần cap theo số liệu; cap hiển thị sẽ không vượt cap áp dụng nếu bạn chưa chỉnh giới hạn đó.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
