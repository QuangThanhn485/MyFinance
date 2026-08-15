import { useEffect, useMemo, useState } from "react"
import { Check, Circle, Info, Minus, Plus } from "lucide-react"
import MoneyInput from "@/components/MoneyInput"
import { Input } from "@/components/ui/input"
import {
  computeDailyCapRaisePlanByCeiling,
  computeDailyCapRaisePlanByDays,
  computeExtraSavingsDailyPlan,
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
import { addDaysIsoDate, daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { getMonthTotals } from "@/selectors/expenses"
import { getMonthDayContext } from "@/storage/dayLock"
import { useAppStore } from "@/store/useAppStore"

type ControlMode = "days" | "ceiling" | "extraSavings"

function MetricTile({
  label,
  value,
  subValue,
  accent = "default",
}: {
  label: string
  value: string
  subValue: string
  accent?: "default" | "success" | "danger"
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-card px-4 py-4 sm:px-5">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 truncate text-xl font-semibold tabular-nums sm:text-2xl",
          accent === "success" && "text-emerald-500",
          accent === "danger" && "text-destructive",
        )}
        title={value}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{subValue}</div>
    </div>
  )
}

function ResultMetric({ label, value, subValue }: { label: string; value: string; subValue: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/60 px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 truncate text-lg font-semibold tabular-nums" title={value}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{subValue}</div>
    </div>
  )
}

function formatShortDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

function formatFullDate(date: string) {
  return `${formatShortDate(date)}/${date.slice(0, 4)}`
}

export default function DailyCapPlannerPage() {
  const data = useAppStore((state) => state.data)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getMonthDayContext(data, today)
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
  const monthDays = daysInMonth(month)
  const baseDailyCapVnd = Math.floor(
    Math.max(0, budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd) /
      Math.max(1, monthDays),
  )
  const maxPlanDays = Math.max(0, dayContext.remainingDaysInMonth - 1)

  const [controlMode, setControlMode] = useState<ControlMode>("days")
  const [targetCapVnd, setTargetCapVnd] = useState(() => shownDailyCapVnd + 20_000)
  const [planDays, setPlanDays] = useState(() => Math.min(10, Math.max(1, maxPlanDays)))
  const [manualCeilingVnd, setManualCeilingVnd] = useState(() =>
    Math.max(0, shownDailyCapVnd - 20_000),
  )
  const [extraSavingsTargetVnd, setExtraSavingsTargetVnd] = useState(() =>
    Math.min(500_000, Math.max(0, remainingCap.totalRemainingVnd)),
  )
  const [extraSavingsPlanDays, setExtraSavingsPlanDays] = useState(() =>
    Math.min(10, Math.max(1, dayContext.remainingDaysInMonth)),
  )

  useEffect(() => {
    setTargetCapVnd((value) => Math.max(shownDailyCapVnd, value))
  }, [shownDailyCapVnd])

  useEffect(() => {
    if (maxPlanDays <= 0) {
      setPlanDays(0)
      return
    }
    setPlanDays((value) => Math.min(Math.max(1, value), maxPlanDays))
  }, [maxPlanDays])

  useEffect(() => {
    if (dayContext.remainingDaysInMonth <= 0) {
      setExtraSavingsPlanDays(0)
      return
    }
    setExtraSavingsPlanDays((value) =>
      Math.min(dayContext.remainingDaysInMonth, Math.max(1, value)),
    )
  }, [dayContext.remainingDaysInMonth])

  const targetSliderMaxVnd = Math.ceil(
    Math.max(shownDailyCapVnd + 50_000, targetCapVnd, 50_000) / 10_000,
  ) * 10_000
  const targetSliderProgress =
    targetSliderMaxVnd > shownDailyCapVnd
      ? Math.min(
          100,
          Math.max(
            0,
            ((targetCapVnd - shownDailyCapVnd) / (targetSliderMaxVnd - shownDailyCapVnd)) * 100,
          ),
        )
      : 0
  const currentSurplusAgainstBaseVnd =
    remainingCap.totalRemainingVnd - baseDailyCapVnd * dayContext.remainingDaysInMonth
  const maxExtraSavingsBySelectedDaysVnd = Math.max(
    0,
    currentSurplusAgainstBaseVnd + baseDailyCapVnd * extraSavingsPlanDays,
  )
  const extraSavingsSliderMaxVnd =
    Math.ceil(
      Math.max(100_000, maxExtraSavingsBySelectedDaysVnd, extraSavingsTargetVnd) /
        100_000,
    ) * 100_000
  const extraSavingsSliderProgress =
    extraSavingsSliderMaxVnd > 0
      ? Math.min(100, Math.max(0, (extraSavingsTargetVnd / extraSavingsSliderMaxVnd) * 100))
      : 0

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
  const zeroSpendToTargetPlan = useMemo(
    () =>
      computeDailyCapRaisePlanByCeiling({
        totalRemainingVnd: remainingCap.totalRemainingVnd,
        remainingDaysInMonth: dayContext.remainingDaysInMonth,
        currentDailyCapVnd: shownDailyCapVnd,
        targetDailyCapVnd: targetCapVnd,
        dailyCeilingVnd: 0,
      }),
    [dayContext.remainingDaysInMonth, remainingCap.totalRemainingVnd, shownDailyCapVnd, targetCapVnd],
  )
  const extraSavingsPlan = useMemo(
    () =>
      computeExtraSavingsDailyPlan({
        totalRemainingVnd: remainingCap.totalRemainingVnd,
        remainingDaysInMonth: dayContext.remainingDaysInMonth,
        planDays: extraSavingsPlanDays,
        baseDailyCapVnd,
        targetExtraSavingsVnd: extraSavingsTargetVnd,
      }),
    [
      baseDailyCapVnd,
      dayContext.remainingDaysInMonth,
      extraSavingsPlanDays,
      extraSavingsTargetVnd,
      remainingCap.totalRemainingVnd,
    ],
  )

  const isExtraSavingsMode = controlMode === "extraSavings"
  const activeFeasible = isExtraSavingsMode
    ? extraSavingsPlan.feasible
    : controlMode === "days"
      ? byDaysPlan.feasible
      : byCeilingPlan.feasible
  const activeAlreadyAtTarget =
    !isExtraSavingsMode &&
    (controlMode === "days" ? byDaysPlan.alreadyAtTarget : byCeilingPlan.alreadyAtTarget)
  const activePlanDays = isExtraSavingsMode
    ? extraSavingsPlan.planDays
    : controlMode === "days"
      ? byDaysPlan.planDays
      : (byCeilingPlan.daysNeeded ?? 0)
  const activeCeilingVnd = isExtraSavingsMode
    ? extraSavingsPlan.requiredDailyCeilingVnd
    : controlMode === "days"
      ? byDaysPlan.requiredDailyCeilingVnd
      : manualCeilingVnd
  const activeRemainingDaysAfterPlan = isExtraSavingsMode
    ? extraSavingsPlan.remainingDaysAfterPlan
    : controlMode === "days"
      ? byDaysPlan.remainingDaysAfterPlan
      : byCeilingPlan.remainingDaysAfterPlan
  const activeProjectedRemainingVnd = isExtraSavingsMode
    ? extraSavingsPlan.projectedRemainingAfterPlanVnd
    : controlMode === "days"
      ? byDaysPlan.projectedRemainingAfterPlanVnd
      : byCeilingPlan.projectedRemainingAfterPlanVnd
  const activeProjectedCapVnd = isExtraSavingsMode
    ? extraSavingsPlan.requiredDailyCeilingVnd
    : controlMode === "days"
      ? byDaysPlan.projectedDailyCapAfterPlanVnd
      : byCeilingPlan.projectedDailyCapAfterPlanVnd
  const activeMaxAchievableVnd = isExtraSavingsMode
    ? extraSavingsPlan.maxExtraSavingsVnd
    : controlMode === "days"
      ? byDaysPlan.maxAchievableDailyCapVnd
      : byCeilingPlan.maxAchievableDailyCapVnd
  const activeDailyReductionVnd = isExtraSavingsMode
    ? extraSavingsPlan.dailyReductionFromBaseVnd
    : Math.max(0, shownDailyCapVnd - activeCeilingVnd)
  const activeAllowedSpendVnd = isExtraSavingsMode
    ? extraSavingsPlan.allowedSpendVnd
    : activeCeilingVnd * activePlanDays

  const planStartDate = dayContext.remainingStartDate
  const planEndDate =
    activePlanDays > 0 ? addDaysIsoDate(planStartDate, activePlanDays - 1) : planStartDate
  const afterPlanStartDate = addDaysIsoDate(planEndDate, 1)
  const monthEndLabel = `${String(monthDays).padStart(2, "0")}/${month.slice(5, 7)}`
  const timelineFirstWidth = Math.min(
    65,
    Math.max(
      35,
      dayContext.remainingDaysInMonth > 0
        ? (activePlanDays / dayContext.remainingDaysInMonth) * 100
        : 50,
    ),
  )

  const resultTitle = isExtraSavingsMode
    ? activeFeasible
      ? `Giữ tối đa ${formatVnd(activeCeilingVnd)}/ngày trong ${activePlanDays} ngày`
      : `Chưa thể tiết kiệm thêm ${formatVnd(extraSavingsTargetVnd)} sau ${activePlanDays} ngày`
    : activeAlreadyAtTarget
    ? `Cap hiện tại đã đạt ${formatVnd(targetCapVnd)}`
    : activeFeasible
      ? controlMode === "days"
        ? `Chi tối đa ${formatVnd(activeCeilingVnd)}/ngày trong ${activePlanDays} ngày`
        : `Giữ mức ${formatVnd(activeCeilingVnd)}/ngày trong ${activePlanDays} ngày`
      : `Mục tiêu ${formatVnd(targetCapVnd)} chưa khả thi`
  const resultDescription = isExtraSavingsMode
    ? activeFeasible
      ? activeRemainingDaysAfterPlan > 0
        ? `Sau đó có thể trở lại cap gốc ${formatVnd(baseDailyCapVnd)}/ngày và vẫn giữ thêm ${formatVnd(extraSavingsPlan.projectedExtraSavingsVnd)}.`
        : `Cuối tháng dự kiến giữ thêm ${formatVnd(extraSavingsPlan.projectedExtraSavingsVnd)}, ngoài mục tiêu hiện có.`
      : `Ngân sách còn lại đang thiếu ${formatVnd(extraSavingsPlan.shortfallVnd)} so với mục tiêu này.`
    : activeAlreadyAtTarget
    ? "Bạn không cần giảm thêm mức chi hiện tại."
    : activeFeasible
      ? `Từ ngày ${formatShortDate(afterPlanStartDate)}, cap ngày dự kiến tăng lên ${formatVnd(activeProjectedCapVnd)}.`
      : `Cap cao nhất theo cấu hình này là ${formatVnd(activeMaxAchievableVnd)}.`

  const decreasePlanDays = () => setPlanDays((value) => Math.max(1, value - 1))
  const increasePlanDays = () => setPlanDays((value) => Math.min(maxPlanDays, value + 1))

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 pb-3 sm:space-y-6 sm:pb-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-sky-500">
            Ngân sách tháng {month.slice(5, 7)} / {month.slice(0, 4)}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-3xl">Lập kế hoạch cap ngày</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Điều chỉnh cap hoặc chủ động giữ lại một khoản tiết kiệm thêm.
          </p>
        </div>
        <div className="flex w-fit shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Dữ liệu đến {formatFullDate(today)}
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Tổng quan ngân sách">
        <MetricTile
          label={dayContext.dateHasExpense ? "Cap từ ngày kế tiếp" : "Cap hôm nay"}
          value={formatVnd(shownDailyCapVnd)}
          subValue={
            appliedCapIsLimiting
              ? `Đang giới hạn ở ${formatVnd(caps?.dailyTotalCapVnd ?? 0)}`
              : dayContext.dateHasExpense
                ? `Áp dụng từ ${formatFullDate(dayContext.remainingStartDate)}`
                : "Mức có thể chi trong ngày"
          }
        />
        <MetricTile
          label="Còn được chi"
          value={formatVnd(remainingCap.totalRemainingVnd)}
          subValue={`Cho ${dayContext.remainingDaysInMonth} ngày còn lại`}
          accent={remainingCap.totalRemainingVnd < 0 ? "danger" : "default"}
        />
        <MetricTile
          label="Mục tiêu tiết kiệm"
          value={formatVnd(budgets.savingsTargetVnd)}
          subValue="Đã được giữ riêng khỏi ngân sách"
          accent="success"
        />
      </section>

      <section className="rounded-lg border border-border/80 bg-card/35 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold sm:text-lg">Thiết lập kế hoạch</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Chọn mục tiêu và cách kiểm soát chi tiêu.</p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
          <div className="min-w-0 rounded-lg border border-border/70 bg-background/55 p-4">
            <div className="text-[11px] font-semibold uppercase text-sky-500">Bước 1</div>
            <div className="relative mt-3 min-w-0">
              <MoneyInput
                aria-label={isExtraSavingsMode ? "Số tiền muốn tiết kiệm thêm" : "Cap muốn đạt"}
                value={isExtraSavingsMode ? extraSavingsTargetVnd : targetCapVnd}
                onValueChange={
                  isExtraSavingsMode ? setExtraSavingsTargetVnd : setTargetCapVnd
                }
                onBlur={
                  isExtraSavingsMode
                    ? undefined
                    : () => setTargetCapVnd((value) => Math.max(shownDailyCapVnd, value))
                }
                placeholder={
                  isExtraSavingsMode ? "Nhập số tiền muốn tiết kiệm thêm" : "Nhập cap muốn đạt"
                }
                className="h-12 min-w-0 bg-background pr-24 text-left text-lg font-semibold"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                {isExtraSavingsMode ? "₫" : "₫ / ngày"}
              </span>
            </div>
            <input
              aria-label={
                isExtraSavingsMode
                  ? "Điều chỉnh số tiền muốn tiết kiệm thêm"
                  : "Điều chỉnh cap muốn đạt"
              }
              type="range"
              min={isExtraSavingsMode ? 0 : shownDailyCapVnd}
              max={isExtraSavingsMode ? extraSavingsSliderMaxVnd : targetSliderMaxVnd}
              step={isExtraSavingsMode ? 10_000 : 1_000}
              value={isExtraSavingsMode ? extraSavingsTargetVnd : targetCapVnd}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (isExtraSavingsMode) setExtraSavingsTargetVnd(value)
                else setTargetCapVnd(value)
              }}
              className="daily-cap-range mt-6 w-full"
              style={{
                background: `linear-gradient(to right, rgb(14 165 233) 0%, rgb(14 165 233) ${isExtraSavingsMode ? extraSavingsSliderProgress : targetSliderProgress}%, hsl(var(--muted)) ${isExtraSavingsMode ? extraSavingsSliderProgress : targetSliderProgress}%, hsl(var(--muted)) 100%)`,
              }}
            />
            <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">
                {isExtraSavingsMode ? "0 ₫" : `${formatVnd(shownDailyCapVnd)} hiện tại`}
              </span>
              <span className="shrink-0">
                {isExtraSavingsMode
                  ? `Khả thi: ${formatVnd(maxExtraSavingsBySelectedDaysVnd)}`
                  : formatVnd(targetSliderMaxVnd)}
              </span>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-border/70 bg-background/55 p-4">
            <div className="text-[11px] font-semibold uppercase text-sky-500">
              Bước 2 · Chọn cách kiểm soát
            </div>
            <div
              className="mt-3 grid grid-cols-1 gap-1 rounded-lg bg-muted/60 p-1 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Cách kiểm soát chi tiêu"
            >
              <button
                type="button"
                role="radio"
                aria-checked={controlMode === "days"}
                onClick={() => setControlMode("days")}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  controlMode === "days"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {controlMode === "days" ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                Chọn số ngày
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={controlMode === "ceiling"}
                onClick={() => setControlMode("ceiling")}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  controlMode === "ceiling"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {controlMode === "ceiling" ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                Chọn mức chi/ngày
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={controlMode === "extraSavings"}
                onClick={() => setControlMode("extraSavings")}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  controlMode === "extraSavings"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {controlMode === "extraSavings" ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : (
                  <Circle className="h-4 w-4 shrink-0" />
                )}
                Tiết kiệm thêm
              </button>
            </div>

            {controlMode === "days" ? (
              <div className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border/70 px-3 sm:px-4">
                <span className="min-w-0 text-sm text-muted-foreground">Giữ mức chi thấp trong</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title="Giảm một ngày"
                    aria-label="Giảm một ngày"
                    disabled={planDays <= 1 || maxPlanDays <= 0}
                    onClick={decreasePlanDays}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-[72px] text-center text-base font-semibold tabular-nums">
                    {planDays} ngày
                  </span>
                  <button
                    type="button"
                    title="Tăng một ngày"
                    aria-label="Tăng một ngày"
                    disabled={planDays >= maxPlanDays || maxPlanDays <= 0}
                    onClick={increasePlanDays}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : controlMode === "ceiling" ? (
              <div className="mt-4 grid min-h-14 grid-cols-1 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:px-4">
                <span className="text-sm text-muted-foreground">Mức chi tối đa mỗi ngày</span>
                <MoneyInput
                  aria-label="Mức chi tối đa mỗi ngày"
                  value={manualCeilingVnd}
                  onValueChange={setManualCeilingVnd}
                  showSteppers
                  stepVnd={1_000}
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-2">
                <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 sm:px-4">
                  <span className="min-w-0 text-sm text-muted-foreground">Đạt mục tiêu trong</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Giảm một ngày"
                      aria-label="Giảm thời hạn một ngày"
                      disabled={extraSavingsPlanDays <= 1}
                      onClick={() =>
                        setExtraSavingsPlanDays((value) => Math.max(1, value - 1))
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <div className="relative w-[92px]">
                      <Input
                        aria-label="Số ngày để đạt khoản tiết kiệm thêm"
                        inputMode="numeric"
                        value={extraSavingsPlanDays || ""}
                        onChange={(event) => {
                          const raw = event.target.value.replace(/[^\d]/g, "")
                          if (!raw) {
                            setExtraSavingsPlanDays(0)
                            return
                          }
                          setExtraSavingsPlanDays(
                            Math.min(
                              dayContext.remainingDaysInMonth,
                              Math.max(1, Math.trunc(Number(raw))),
                            ),
                          )
                        }}
                        onBlur={() =>
                          setExtraSavingsPlanDays((value) =>
                            Math.min(
                              dayContext.remainingDaysInMonth,
                              Math.max(1, value),
                            ),
                          )
                        }
                        className="h-9 pr-10 text-center font-semibold tabular-nums"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                        ngày
                      </span>
                    </div>
                    <button
                      type="button"
                      title="Tăng một ngày"
                      aria-label="Tăng thời hạn một ngày"
                      disabled={extraSavingsPlanDays >= dayContext.remainingDaysInMonth}
                      onClick={() =>
                        setExtraSavingsPlanDays((value) =>
                          Math.min(dayContext.remainingDaysInMonth, value + 1),
                        )
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3 px-1 text-xs text-muted-foreground sm:px-2">
                  <span>Cap gốc ngày 1</span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">
                    {formatVnd(baseDailyCapVnd)}/ngày
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        className={cn(
          "rounded-lg border p-4 sm:p-5",
          activeFeasible
            ? "border-emerald-500/35 bg-emerald-500/[0.07]"
            : "border-destructive/35 bg-destructive/[0.06]",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div
              className={cn(
                "text-[11px] font-semibold uppercase",
                activeFeasible ? "text-emerald-500" : "text-destructive",
              )}
            >
              Kế hoạch đề xuất
            </div>
            <h2 className="mt-1.5 text-xl font-semibold sm:text-2xl">{resultTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{resultDescription}</p>
          </div>
          <div
            className={cn(
              "flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
              activeFeasible
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {activeFeasible ? <Check className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
            {activeFeasible ? "Có thể đạt" : "Chưa thể đạt"}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {activeFeasible ? (
            isExtraSavingsMode ? (
              <>
                <ResultMetric
                  label="Chênh với cap gốc"
                  value={
                    extraSavingsPlan.dailyIncreaseFromBaseVnd > 0
                      ? `+${formatVnd(extraSavingsPlan.dailyIncreaseFromBaseVnd)}`
                      : activeDailyReductionVnd > 0
                        ? `−${formatVnd(activeDailyReductionVnd)}`
                        : formatVnd(0)
                  }
                  subValue="mỗi ngày"
                />
                <ResultMetric
                  label="Tổng được chi"
                  value={formatVnd(activeAllowedSpendVnd)}
                  subValue={`trong ${activePlanDays} ngày kiểm soát`}
                />
                <ResultMetric
                  label="Tiết kiệm thêm"
                  value={formatVnd(extraSavingsPlan.projectedExtraSavingsVnd)}
                  subValue={`đạt sau ${activePlanDays} ngày`}
                />
              </>
            ) : (
              <>
                <ResultMetric
                  label="Cần giảm mỗi ngày"
                  value={formatVnd(activeDailyReductionVnd)}
                  subValue="so với cap hiện tại"
                />
                <ResultMetric
                  label={`Tổng chi trong ${activePlanDays} ngày`}
                  value={formatVnd(activeAllowedSpendVnd)}
                  subValue="mức tối đa"
                />
                <ResultMetric
                  label="Ngân sách còn lại"
                  value={formatVnd(activeProjectedRemainingVnd)}
                  subValue={`cho ${activeRemainingDaysAfterPlan} ngày sau`}
                />
              </>
            )
          ) : (
            isExtraSavingsMode ? (
              <>
                <ResultMetric
                  label="Có thể tiết kiệm thêm"
                  value={formatVnd(extraSavingsPlan.maxExtraSavingsVnd)}
                  subValue="nếu dừng chi"
                />
                <ResultMetric
                  label="Còn thiếu"
                  value={formatVnd(extraSavingsPlan.shortfallVnd)}
                  subValue="so với mục tiêu"
                />
                <ResultMetric
                  label="Thời gian còn lại"
                  value={`${activePlanDays} ngày`}
                  subValue="thời hạn đã chọn"
                />
              </>
            ) : (
              <>
                <ResultMetric
                  label="Cap cao nhất"
                  value={formatVnd(activeMaxAchievableVnd)}
                  subValue="theo cấu hình hiện tại"
                />
                <ResultMetric
                  label="Còn được chi"
                  value={formatVnd(remainingCap.totalRemainingVnd)}
                  subValue="ngân sách khả dụng"
                />
                <ResultMetric
                  label="Thời gian còn lại"
                  value={`${dayContext.remainingDaysInMonth} ngày`}
                  subValue="trong tháng này"
                />
              </>
            )
          )}
        </div>

        {activeFeasible && isExtraSavingsMode && activePlanDays > 0 ? (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">Lộ trình tiết kiệm thêm</div>
            {activeRemainingDaysAfterPlan > 0 ? (
              <>
                <div
                  className="mt-2 hidden min-h-12 overflow-hidden rounded-lg border border-border/70 sm:grid"
                  style={{ gridTemplateColumns: `${timelineFirstWidth}% minmax(0, 1fr)` }}
                >
                  <div className="flex min-w-0 items-center justify-center bg-amber-500/20 px-3 py-2 text-center text-xs font-medium text-amber-600 dark:text-amber-400">
                    {formatShortDate(planStartDate)}–{formatShortDate(planEndDate)} · Giữ {formatVnd(activeCeilingVnd)}/ngày
                  </div>
                  <div className="flex min-w-0 items-center justify-center bg-emerald-500/15 px-3 py-2 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {formatShortDate(afterPlanStartDate)}–{monthEndLabel} · Trở lại cap gốc {formatVnd(baseDailyCapVnd)}/ngày
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:hidden">
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {formatShortDate(planStartDate)}–{formatShortDate(planEndDate)} · Giữ {formatVnd(activeCeilingVnd)}/ngày
                  </div>
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {formatShortDate(afterPlanStartDate)}–{monthEndLabel} · Trở lại cap gốc {formatVnd(baseDailyCapVnd)}/ngày
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-2 flex min-h-12 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {formatShortDate(planStartDate)}–{monthEndLabel} · Giữ tối đa {formatVnd(activeCeilingVnd)}/ngày
              </div>
            )}
          </div>
        ) : activeFeasible && !activeAlreadyAtTarget && activePlanDays > 0 ? (
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">Lộ trình trong tháng</div>
            <div
              className="mt-2 hidden min-h-12 overflow-hidden rounded-lg border border-border/70 sm:grid"
              style={{ gridTemplateColumns: `${timelineFirstWidth}% minmax(0, 1fr)` }}
            >
              <div className="flex min-w-0 items-center justify-center bg-amber-500/20 px-3 py-2 text-center text-xs font-medium text-amber-600 dark:text-amber-400">
                {formatShortDate(planStartDate)}–{formatShortDate(planEndDate)} · Giữ {formatVnd(activeCeilingVnd)}/ngày
              </div>
              <div className="flex min-w-0 items-center justify-center bg-emerald-500/15 px-3 py-2 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {formatShortDate(afterPlanStartDate)}–{monthEndLabel} · Cap tăng lên {formatVnd(activeProjectedCapVnd)}/ngày
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:hidden">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                {formatShortDate(planStartDate)}–{formatShortDate(planEndDate)} · Giữ {formatVnd(activeCeilingVnd)}/ngày
              </div>
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {formatShortDate(afterPlanStartDate)}–{monthEndLabel} · Cap tăng lên {formatVnd(activeProjectedCapVnd)}/ngày
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-start gap-2 border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {isExtraSavingsMode
              ? activeFeasible
                ? `Sau ${activePlanDays} ngày, phần dư so với cap gốc ngày 1 được giữ ngoài mục tiêu tiết kiệm hiện có.`
                : `Dù chi 0 ₫ trong ${activePlanDays} ngày đã chọn, chỉ tích lũy được ${formatVnd(extraSavingsPlan.maxExtraSavingsVnd)} so với cap gốc.`
              : activeFeasible
              ? "Cách tính: ngân sách còn lại sau giai đoạn kiểm soát ÷ số ngày còn lại."
              : zeroSpendToTargetPlan.feasible && zeroSpendToTargetPlan.daysNeeded !== null
                ? `Mức chi 0 đ/ngày cần ít nhất ${zeroSpendToTargetPlan.daysNeeded} ngày để đạt mục tiêu này.`
                : "Ngay cả khi dừng chi trong phần còn lại của tháng, mục tiêu này vẫn chưa đạt được."}
          </span>
        </div>
      </section>
    </div>
  )
}
