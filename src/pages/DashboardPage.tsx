import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { computeBudgets, computeEmergencyFund } from "@/domain/finance/finance"
import {
  computeRemainingDailySpendingCap,
  projectMonthEndFromPace,
  resolveEffectiveDailyTotalCapVnd,
} from "@/domain/finance/dailySafeCap"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LabelValueRow from "@/components/LabelValueRow"
import { Progress } from "@/components/ui/progress"
import { formatVnd } from "@/lib/currency"
import { addDaysIsoDate, monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import { getMonthDayContext } from "@/storage/dayLock"
import { getExpensesByDate, getMonthTotals } from "@/selectors/expenses"
import { getEffectiveEmergencyFundBalance } from "@/selectors/savings"
import { useAppStore } from "@/store/useAppStore"

type Tone = "ok" | "warn" | "danger" | "neutral"

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatCoverageMonths(value: number) {
  if (!Number.isFinite(value)) return "-"
  return `${value.toFixed(1)} tháng`
}

function toneTextClass(tone: Tone) {
  switch (tone) {
    case "ok":
      return "text-emerald-700 dark:text-emerald-400"
    case "warn":
      return "text-amber-600 dark:text-amber-400"
    case "danger":
      return "text-destructive"
    default:
      return ""
  }
}

function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {children}
    </span>
  )
}

function MetricCard({
  title,
  value,
  subValue,
  tone = "neutral",
}: {
  title: string
  value: string
  subValue?: string
  tone?: Tone
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className={cn("break-words text-lg font-semibold tabular-nums sm:text-xl", toneTextClass(tone))}>
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

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getMonthDayContext(data, today)
  const daysRemaining = dayContext.remainingDaysInMonth

  const totals = getMonthTotals(data, month)
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
  const caps = getEffectiveCapsForMonth(data, month)

  const incomeConfigured = budgets.incomeVnd > 0
  const MSS = budgets.mssVnd
  const savingsTarget = budgets.savingsTargetVnd

  // Nhịp chi
  const todaySpent = getExpensesByDate(data, today).reduce((sum, ex) => sum + ex.amountVnd, 0)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIsoDate(today, -i))
  const weekSpent = weekDates.reduce(
    (sum, date) =>
      sum + getExpensesByDate(data, date).reduce((inner, ex) => inner + ex.amountVnd, 0),
    0,
  )
  const avgPerDay7 = Math.round(weekSpent / 7)

  // Cap ngày & ngân sách chi
  const remainingDailyCap = computeRemainingDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: savingsTarget,
    totalSpentVnd: totals.totalSpent,
    remainingDaysInMonth: daysRemaining,
  })
  const spendingBudgetVnd = remainingDailyCap.spendingBudgetVnd
  const totalRemaining = remainingDailyCap.totalRemainingVnd
  const shownDailyCap = resolveEffectiveDailyTotalCapVnd({
    computedDailyTotalCapVnd: remainingDailyCap.dailyTotalCapVnd,
    appliedDailyTotalCapVnd: caps?.dailyTotalCapVnd,
  })
  const remainingTodayVnd = shownDailyCap - todaySpent
  const todayUsagePct =
    shownDailyCap > 0 ? clampPct((todaySpent / shownDailyCap) * 100) : todaySpent > 0 ? 100 : 0
  const appliedCapLimiting =
    caps?.dailyTotalCapVnd != null && caps.dailyTotalCapVnd < remainingDailyCap.dailyTotalCapVnd

  // Dự báo cuối tháng: ngoại suy nhịp chi thực tế cho những ngày còn lại (KHÔNG coi toàn bộ tiền
  // chưa tiêu là tiết kiệm). Nếu đang chi vượt hạn mức thì dự báo tiết kiệm sẽ tụt theo.
  const projection = projectMonthEndFromPace({
    incomeVnd: budgets.incomeVnd,
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: budgets.essentialVariableBaselineVnd,
    variableNeedsToDateVnd: totals.variableNeeds,
    variableWantsToDateVnd: totals.variableWants,
    dayOfMonth: dayContext.dayOfMonth,
    daysInMonth: dayContext.daysInMonth,
  })
  const projectedSavingsEndMonthVnd = projection.projectedSavingsVnd
  const projectedTotalSpendVnd = projection.projectedTotalSpendVnd
  const savingsGoalPct =
    savingsTarget > 0
      ? clampPct((projectedSavingsEndMonthVnd / savingsTarget) * 100)
      : projectedSavingsEndMonthVnd >= 0
        ? 100
        : 0
  const savingsMet = projectedSavingsEndMonthVnd >= savingsTarget
  const aboveMss = projectedSavingsEndMonthVnd >= MSS
  const monthTone: Tone = savingsMet ? "ok" : aboveMss ? "warn" : "danger"
  const monthVerdict = savingsMet
    ? "Theo nhịp hiện tại, đang đúng hướng đạt mục tiêu tiết kiệm."
    : aboveMss
      ? "Theo nhịp hiện tại, có nguy cơ hụt mục tiêu tiết kiệm."
      : "Theo nhịp hiện tại, tiết kiệm cuối tháng sẽ dưới mức an toàn (MSS)."

  // Quỹ khẩn cấp
  const emergency = computeEmergencyFund({
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: budgets.essentialVariableBaselineVnd,
    targetMonths: settingsForMonth.emergencyFundTargetMonths,
    currentBalanceVnd: getEffectiveEmergencyFundBalance(data, month),
  })
  const emergencyProgress = clampPct(
    emergency.targetVnd > 0 ? (emergency.currentVnd / emergency.targetVnd) * 100 : 0,
  )
  const emergencyTone: Tone =
    emergency.coverageMonths >= 3 ? "ok" : emergency.coverageMonths >= 1 ? "warn" : "danger"

  const wantsFreezeActive = !!(caps?.wantsFreezeUntil && today <= caps.wantsFreezeUntil)

  const dailyStatusTone: Tone =
    !incomeConfigured || (shownDailyCap <= 0 && totalRemaining <= 0)
      ? "danger"
      : remainingTodayVnd >= 0
        ? "ok"
        : "danger"
  const dailyStatusText = !incomeConfigured
    ? "Chưa thiết lập thu nhập để tính hạn mức."
    : totalRemaining <= 0 && shownDailyCap <= 0
      ? "Đã dùng hết ngân sách chi của tháng."
      : remainingTodayVnd >= 0
        ? `Hôm nay còn có thể chi ${formatVnd(remainingTodayVnd)}.`
        : `Hôm nay đã vượt hạn mức ${formatVnd(Math.abs(remainingTodayVnd))}.`

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Tổng quan</h1>
          <p className="text-sm text-muted-foreground">
            Tháng {month} • {daysRemaining} ngày còn lại trong tháng.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="min-w-0 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">MSS: </span>
            <span className="font-semibold tabular-nums">{formatVnd(MSS)}</span>
          </div>
          <Button asChild size="sm">
            <Link to="/expenses">Ghi chi tiêu</Link>
          </Button>
        </div>
      </div>

      {!incomeConfigured ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <span className="font-medium">Chưa thiết lập thu nhập.</span>{" "}
          <Link to="/settings" className="underline underline-offset-2">
            Vào Cài đặt
          </Link>{" "}
          để nhập thu nhập, chi phí cố định và mục tiêu tiết kiệm — bảng điều khiển sẽ có ý nghĩa.
        </div>
      ) : null}

      {wantsFreezeActive || appliedCapLimiting ? (
        <div className="flex flex-wrap gap-2">
          {wantsFreezeActive ? (
            <StatusPill tone="danger">
              Đóng băng “Mong muốn” đến {caps?.wantsFreezeUntil}
            </StatusPill>
          ) : null}
          {appliedCapLimiting ? (
            <StatusPill tone="warn">
              Đang áp cap chi thủ công {formatVnd(caps?.dailyTotalCapVnd ?? 0)}/ngày
            </StatusPill>
          ) : null}
        </div>
      ) : null}

      {/* Các chỉ số cần nhìn nhanh nhất */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Còn được chi hôm nay"
          value={formatVnd(remainingTodayVnd)}
          subValue={`Hạn mức ${formatVnd(shownDailyCap)}/ngày`}
          tone={remainingTodayVnd < 0 ? "danger" : "ok"}
        />
        <MetricCard
          title="Còn lại ngân sách tháng"
          value={formatVnd(totalRemaining)}
          subValue={`${daysRemaining} ngày còn lại`}
          tone={totalRemaining < 0 ? "danger" : "neutral"}
        />
        <MetricCard
          title="Dự báo tiết kiệm cuối tháng"
          value={formatVnd(projectedSavingsEndMonthVnd)}
          subValue={`Mục tiêu ${formatVnd(savingsTarget)}`}
          tone={monthTone}
        />
        <MetricCard
          title="Quỹ khẩn cấp phủ được"
          value={formatCoverageMonths(emergency.coverageMonths)}
          subValue={emergency.status}
          tone={emergencyTone}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Hôm nay */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Chi tiêu hôm nay</CardTitle>
            <StatusPill tone={dailyStatusTone}>
              {remainingTodayVnd >= 0 ? "Trong hạn mức" : "Vượt hạn mức"}
            </StatusPill>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Còn được chi hôm nay</div>
                <div
                  className={cn(
                    "text-2xl font-semibold tabular-nums sm:text-3xl",
                    toneTextClass(remainingTodayVnd < 0 ? "danger" : "ok"),
                  )}
                >
                  {formatVnd(remainingTodayVnd)}
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-xs text-muted-foreground">Đã chi hôm nay</div>
                <div className="text-lg font-semibold tabular-nums">{formatVnd(todaySpent)}</div>
              </div>
            </div>
            <Progress value={todayUsagePct} />
            <div className="space-y-2 text-sm">
              <LabelValueRow label="Hạn mức chi mỗi ngày" value={formatVnd(shownDailyCap)} />
              <LabelValueRow label="Số ngày còn lại trong tháng" value={`${daysRemaining}`} />
            </div>
            <div className={cn("text-sm font-medium", toneTextClass(dailyStatusTone))}>
              {dailyStatusText}
            </div>
          </CardContent>
        </Card>

        {/* Triển vọng tháng */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Triển vọng tháng này</CardTitle>
            <StatusPill tone={monthTone}>
              {savingsMet ? "Đúng hướng" : aboveMss ? "Cần chú ý" : "Rủi ro"}
            </StatusPill>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground">Dự báo tiết kiệm cuối tháng</div>
              <div className={cn("text-2xl font-semibold tabular-nums sm:text-3xl", toneTextClass(monthTone))}>
                {formatVnd(projectedSavingsEndMonthVnd)}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">{monthVerdict}</div>
            </div>
            <div className="space-y-1.5">
              <LabelValueRow
                className="text-sm"
                label="So với mục tiêu tiết kiệm"
                value={`${savingsGoalPct.toFixed(0)}%`}
                valueClassName={cn(toneTextClass(monthTone))}
              />
              <Progress value={savingsGoalPct} />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <LabelValueRow label="Ngân sách chi (I − S)" value={formatVnd(spendingBudgetVnd)} />
              <LabelValueRow label="Đã chi tháng đến nay" value={formatVnd(totals.totalSpent)} />
              <LabelValueRow
                label="Dự báo chi cả tháng"
                value={formatVnd(projectedTotalSpendVnd)}
                valueClassName={cn(projectedTotalSpendVnd > spendingBudgetVnd && "text-destructive")}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Nhịp chi gần đây */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nhịp chi gần đây</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <LabelValueRow label="Chi hôm nay" value={formatVnd(todaySpent)} />
            <LabelValueRow label="7 ngày gần nhất" value={formatVnd(weekSpent)} />
            <LabelValueRow label="Trung bình 7 ngày/ngày" value={formatVnd(avgPerDay7)} />
            <LabelValueRow
              label="Chi tháng đến nay"
              value={formatVnd(totals.totalSpent)}
              valueClassName="font-semibold"
            />
          </CardContent>
        </Card>

        {/* Quỹ khẩn cấp */}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Quỹ khẩn cấp &amp; an toàn</CardTitle>
            <StatusPill tone={emergencyTone}>{emergency.status}</StatusPill>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Phủ được</div>
                <div className={cn("text-xl font-semibold tabular-nums sm:text-2xl", toneTextClass(emergencyTone))}>
                  {formatCoverageMonths(emergency.coverageMonths)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground sm:text-right">
                chi thiết yếu/tháng
                <div className="text-sm font-medium text-foreground tabular-nums">
                  {formatVnd(emergency.essentialMonthlyVnd)}
                </div>
              </div>
            </div>
            <Progress value={emergencyProgress} />
            <div className="grid gap-2">
              <LabelValueRow label="Hiện có" value={formatVnd(emergency.currentVnd)} />
              <LabelValueRow label="Mục tiêu" value={formatVnd(emergency.targetVnd)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
