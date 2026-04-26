import { type ReactNode, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Database,
  Gauge,
  LockKeyhole,
  Save,
  Scale,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react"
import DatePicker from "@/components/DatePicker"
import LabelValueRow from "@/components/LabelValueRow"
import MoneyInput from "@/components/MoneyInput"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { BUCKET_LABELS_VI } from "@/domain/constants"
import type { BudgetBucket, ISODate, PurchasePriority } from "@/domain/types"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import {
  analyzePurchaseRisk,
  type PurchaseRiskDecision,
  type PurchaseRiskResult,
  type PurchaseRiskSignal,
} from "@/domain/finance/purchaseRisk"
import {
  buildForcedPurchaseRescue,
  type ForcedPurchaseRescueResult,
} from "@/domain/finance/rescue"
import { formatVnd } from "@/lib/currency"
import { monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { getMonthToDateTotals, getMonthTotals } from "@/selectors/expenses"
import { getEffectiveEmergencyFundBalance } from "@/selectors/savings"
import { getDayLockMonthContext } from "@/storage/dayLock"
import { useAppStore } from "@/store/useAppStore"

const formSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên món mua."),
  priceVnd: z.coerce.number().int().positive("Giá phải lớn hơn 0."),
  bucket: z.enum(["needs", "wants"]),
  priority: z.enum(["low", "med", "high"]),
  forced: z.boolean(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

type FormValues = z.infer<typeof formSchema>

const priorityLabel: Record<PurchasePriority, string> = {
  low: "Thấp",
  med: "Trung bình",
  high: "Cao",
}

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`
}

function months(value: number) {
  if (!Number.isFinite(value)) return "Không giới hạn"
  return `${value.toFixed(1)} tháng`
}

function decisionMeta(decision: PurchaseRiskDecision) {
  switch (decision) {
    case "MUA ĐƯỢC":
      return {
        icon: CheckCircle2,
        badge: "bg-emerald-600 text-white hover:bg-emerald-600",
        panel: "border-emerald-500/50 bg-emerald-500/5",
      }
    case "CHỜ":
      return {
        icon: CalendarClock,
        badge: "bg-amber-500 text-white hover:bg-amber-500",
        panel: "border-amber-500/50 bg-amber-500/5",
      }
    case "BẮT BUỘC: GIẢM THIỆT HẠI":
      return {
        icon: ShieldAlert,
        badge: "bg-orange-600 text-white hover:bg-orange-600",
        panel: "border-orange-500/50 bg-orange-500/5",
      }
    default:
      return {
        icon: XCircle,
        badge: "bg-destructive text-destructive-foreground hover:bg-destructive",
        panel: "border-destructive/50 bg-destructive/5",
      }
  }
}

function signalTone(status: PurchaseRiskSignal["status"]) {
  if (status === "pass") {
    return {
      icon: CheckCircle2,
      badge: "border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
      label: "Đạt",
    }
  }
  if (status === "warn") {
    return {
      icon: AlertTriangle,
      badge: "border-amber-500/50 text-amber-700 dark:text-amber-300",
      label: "Cảnh báo",
    }
  }
  return {
    icon: XCircle,
    badge: "border-destructive/50 text-destructive",
    label: "Fail",
  }
}

function signalValue(signal: PurchaseRiskSignal) {
  if (signal.key === "emergency") return months(signal.value)
  if (signal.key === "debt") return pct(signal.value)
  return formatVnd(signal.value)
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: "good" | "warn" | "bad"
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-background p-3",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "bad" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 min-w-0 break-words text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function SignalRow({ signal }: { signal: PurchaseRiskSignal }) {
  const tone = signalTone(signal.status)
  const Icon = tone.icon

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          <div className="min-w-0 font-medium">{signal.label}</div>
          <Badge variant="outline" className={tone.badge}>
            {tone.label}
          </Badge>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{signal.detail}</div>
      </div>
      <div className="text-left text-sm font-semibold tabular-nums sm:text-right">
        {signalValue(signal)}
      </div>
    </div>
  )
}

function ForcedRescuePanel({
  rescue,
  onApply,
}: {
  rescue: ForcedPurchaseRescueResult
  onApply: (optionId: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Kế hoạch giảm thiệt hại bắt buộc
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricTile label="Mức độ" value={rescue.severity} tone="bad" />
          <MetricTile
            label="Dự báo cuối tháng"
            value={formatVnd(rescue.projectedEndMonthBalanceVnd)}
            tone={rescue.projectedEndMonthBalanceVnd >= rescue.mssVnd ? "good" : "bad"}
          />
          <MetricTile label="MSS" value={formatVnd(rescue.mssVnd)} />
          <MetricTile
            label="Thiếu MSS"
            value={rescue.mssDeficitVnd > 0 ? formatVnd(rescue.mssDeficitVnd) : "Không thiếu"}
            tone={rescue.mssDeficitVnd > 0 ? "bad" : "good"}
          />
        </div>

        {rescue.mssDeficitVnd > 0 ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            Cần bù tối thiểu{" "}
            <span className="font-semibold tabular-nums">
              {formatVnd(rescue.requiredDailyCutVnd)}/ngày
            </span>{" "}
            hoặc{" "}
            <span className="font-semibold tabular-nums">
              {formatVnd(rescue.requiredWeeklyCutVnd)}/tuần
            </span>{" "}
            để quay lại MSS.
          </div>
        ) : null}

        <div className="space-y-3">
          {rescue.options.map((option) => {
            const recommended = option.id === rescue.recommendedOptionId
            return (
              <div
                key={option.id}
                className={cn(
                  "rounded-md border bg-background p-4",
                  recommended && "border-primary/60",
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold">{option.title}</div>
                      {recommended ? <Badge>Khuyến nghị</Badge> : null}
                    </div>
                    <div className="text-sm text-muted-foreground">{option.summary}</div>
                  </div>
                  <Button
                    size="sm"
                    variant={recommended ? "default" : "secondary"}
                    onClick={() => onApply(option.id)}
                  >
                    Áp dụng
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MetricTile
                    label="Cuối tháng sau phương án"
                    value={formatVnd(option.impact.projectedEndMonthBalanceVnd)}
                    tone={
                      option.impact.projectedEndMonthBalanceVnd >= rescue.mssVnd
                        ? "good"
                        : "bad"
                    }
                  />
                  <MetricTile
                    label="Tốc độ tiết kiệm dự báo"
                    value={pct(option.impact.projectedSavingsRate)}
                  />
                </div>

                {option.warnings?.length ? (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    {option.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export default function AdvisorPage() {
  const data = useAppStore((s) => s.data)
  const addPurchasePlan = useAppStore((s) => s.actions.addPurchasePlan)
  const deletePurchasePlan = useAppStore((s) => s.actions.deletePurchasePlan)
  const applyRecoveryOption = useAppStore((s) => s.actions.applyRecoveryOption)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getDayLockMonthContext(today)

  const currentMonth = useMemo(() => {
    const settings = getEffectiveSettingsForMonth(data, month)
    const totals = getMonthTotals(data, month)
    const toDate = getMonthToDateTotals(data, today)
    const adjustment = getEffectiveBudgetAdjustmentForMonth(data, month)
    const budgets = computeBudgets({
      incomeVnd: getMonthlyIncomeTotalVnd(settings),
      fixedCostsVnd: totals.fixedCostsTotal,
      essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
      rule: settings.budgetRule,
      adjustment,
      customSavingsGoalVnd: settings.customSavingsGoalVnd,
    })
    const emergencyFundCurrentVnd = getEffectiveEmergencyFundBalance(data, month)

    return { settings, totals, toDate, budgets, emergencyFundCurrentVnd }
  }, [data, month, today])

  const purchasePlans = useMemo(
    () =>
      data.entities.purchasePlans.allIds
        .map((id) => data.entities.purchasePlans.byId[id])
        .filter((plan): plan is NonNullable<typeof plan> => !!plan)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data.entities.purchasePlans],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      priceVnd: 0,
      bucket: "wants",
      priority: "med",
      forced: false,
      targetDate: undefined,
    },
  })

  const [result, setResult] = useState<PurchaseRiskResult | null>(null)
  const [forcedRescue, setForcedRescue] = useState<ForcedPurchaseRescueResult | null>(null)

  const buildRescue = (purchase: { priceVnd: number; bucket: BudgetBucket }) =>
    buildForcedPurchaseRescue({
      month,
      today,
      dayOfMonth: dayContext.dayOfMonth,
      daysInMonth: dayContext.daysInMonth,
      remainingDaysInMonth: dayContext.remainingDaysInMonth,
      remainingStartDate: dayContext.remainingStartDate,
      incomeVnd: currentMonth.budgets.incomeVnd,
      fixedCostsVnd: currentMonth.totals.fixedCostsTotal,
      essentialVariableBaselineVnd: currentMonth.settings.essentialVariableBaselineVnd,
      emergencyFundCurrentVnd: currentMonth.emergencyFundCurrentVnd,
      emergencyFundTargetMonths: currentMonth.settings.emergencyFundTargetMonths,
      debtPaymentMonthlyVnd: currentMonth.settings.debtPaymentMonthlyVnd,
      budgets: {
        wantsBudgetVnd: currentMonth.budgets.wantsBudgetVnd,
        savingsTargetVnd: currentMonth.budgets.savingsTargetVnd,
      },
      spentToDate: {
        totalSpentVnd:
          currentMonth.totals.fixedCostsTotal + currentMonth.toDate.variableTotalToDateVnd,
        wantsSpentVnd: currentMonth.toDate.variableWantsToDateVnd,
        needsSpentVnd:
          currentMonth.totals.fixedCostsTotal + currentMonth.toDate.variableNeedsToDateVnd,
      },
      forcedPurchase: purchase,
    })

  const runAdvisor = (values: FormValues, planId?: string) => {
    const purchase = {
      id: planId,
      name: values.name.trim(),
      priceVnd: Math.trunc(values.priceVnd),
      bucket: values.bucket as BudgetBucket,
      priority: values.priority as PurchasePriority,
      forced: values.forced,
      targetDate: values.targetDate as ISODate | undefined,
    }

    const next = analyzePurchaseRisk({ state: data, today, purchase })
    setResult(next)
    setForcedRescue(
      purchase.forced ? buildRescue({ priceVnd: purchase.priceVnd, bucket: purchase.bucket }) : null,
    )
  }

  const saveCurrentPlan = form.handleSubmit((values) => {
    addPurchasePlan({
      name: values.name.trim(),
      priceVnd: Math.trunc(values.priceVnd),
      bucket: values.bucket as BudgetBucket,
      priority: values.priority as PurchasePriority,
      forced: values.forced,
      targetDate: values.targetDate as ISODate | undefined,
    })
    toast.success("Đã lưu kế hoạch mua.")
  })

  const applyForcedOption = (optionId: string) => {
    if (!forcedRescue) return
    const option = forcedRescue.options.find((item) => item.id === optionId)
    if (!option) return
    const applied = applyRecoveryOption({ month: forcedRescue.month, option })
    if (!applied.ok) {
      toast.error(applied.error)
      return
    }
    toast.success("Đã áp dụng phương án giảm thiệt hại.")
  }

  const decision = result ? decisionMeta(result.decision) : null
  const DecisionIcon = decision?.icon

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tư vấn mua sắm</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Công cụ này không hỏi bạn có thích món đó không. Nó kiểm tra dòng tiền, MSS,
            quỹ khẩn cấp, nhịp chi tiêu, nợ, cap còn lại, lịch sử tháng trước và kế hoạch
            mua đã lưu trước khi đưa kết luận.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dayContext.locked ? (
            <Badge variant="outline" className="gap-1 border-primary/40">
              <LockKeyhole className="h-3.5 w-3.5" />
              Ngày đã khóa, còn lại tính từ {dayContext.remainingStartDate}
            </Badge>
          ) : (
            <Badge variant="outline">Còn lại tính từ hôm nay</Badge>
          )}
          <Badge variant="secondary" className="tabular-nums">
            {month}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5" />
              Quyết định cần kiểm tra
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((values) => runAdvisor(values))}
            >
              <div className="grid gap-2">
                <Label>Tên món mua</Label>
                <Input placeholder="Ví dụ: Laptop, điện thoại, khóa học..." {...form.register("name")} />
                {form.formState.errors.name ? (
                  <div className="text-xs text-destructive">{form.formState.errors.name.message}</div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label>Giá</Label>
                <Controller
                  control={form.control}
                  name="priceVnd"
                  render={({ field }) => (
                    <MoneyInput
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                      placeholder="0"
                    />
                  )}
                />
                {form.formState.errors.priceVnd ? (
                  <div className="text-xs text-destructive">
                    {form.formState.errors.priceVnd.message}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Bucket</Label>
                  <Select
                    value={form.watch("bucket")}
                    onValueChange={(value) => form.setValue("bucket", value as BudgetBucket)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                      <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Mức ưu tiên</Label>
                  <Select
                    value={form.watch("priority")}
                    onValueChange={(value) => form.setValue("priority", value as PurchasePriority)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Thấp</SelectItem>
                      <SelectItem value="med">Trung bình</SelectItem>
                      <SelectItem value="high">Cao</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Ngày mục tiêu</Label>
                <Controller
                  control={form.control}
                  name="targetDate"
                  render={({ field }) => (
                    <DatePicker
                      value={field.value as ISODate | undefined}
                      onChange={(value) => field.onChange(value)}
                      allowClear
                      placeholder="Không bắt buộc"
                    />
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
                <div className="min-w-0">
                  <div className="font-medium">Bắt buộc mua</div>
                  <div className="text-sm text-muted-foreground">
                    Bật khi đây là khoản cần xử lý, không phải mong muốn có thể hoãn.
                  </div>
                </div>
                <Switch
                  checked={form.watch("forced")}
                  onCheckedChange={(checked) => form.setValue("forced", checked)}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="submit">
                  <Gauge className="h-4 w-4" />
                  Phân tích
                </Button>
                <Button type="button" variant="secondary" onClick={() => void saveCurrentPlan()}>
                  <Save className="h-4 w-4" />
                  Lưu kế hoạch
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className={cn(result && decision?.panel)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Kết luận lạnh bằng số
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result && decision && DecisionIcon ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <DecisionIcon className="h-5 w-5" />
                      <Badge className={decision.badge}>{result.decision}</Badge>
                      <Badge variant="outline" className="tabular-nums">
                        Tin cậy {result.confidencePct}%
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{result.summary}</div>
                  </div>
                  <div className="min-w-[120px]">
                    <div className="text-right text-xs text-muted-foreground">Risk score</div>
                    <div className="text-right text-2xl font-semibold tabular-nums">
                      {result.riskScore}/100
                    </div>
                  </div>
                </div>

                <Progress value={result.riskScore} />

                {result.hardStops.length ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                      <ShieldAlert className="h-4 w-4" />
                      Hard stop
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {result.hardStops.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  {result.actionPlan.map((item) => (
                    <div key={item} className="rounded-md border bg-background p-3 text-sm">
                      {item}
                    </div>
                  ))}
                </div>

                {result.reasons.length ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {result.reasons.map((reason) => (
                      <div key={reason}>• {reason}</div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Nhập món mua và bấm Phân tích. Chưa có kết luận khi chưa có giá và bucket.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Dữ liệu đang được engine sử dụng
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Thu nhập tháng" value={formatVnd(currentMonth.budgets.incomeVnd)} />
            <MetricTile label="Chi cố định + nợ" value={formatVnd(currentMonth.totals.fixedCostsTotal)} />
            <MetricTile
              label="Ngân sách chi còn lại"
              value={formatVnd(
                Math.max(
                  0,
                  currentMonth.budgets.incomeVnd -
                    currentMonth.budgets.savingsTargetVnd -
                    currentMonth.totals.totalSpent,
                ),
              )}
            />
            <MetricTile
              label="Quỹ khẩn cấp hiện tại"
              value={formatVnd(currentMonth.emergencyFundCurrentVnd)}
            />
            <MetricTile label="MSS" value={formatVnd(currentMonth.budgets.mssVnd)} />
            <MetricTile label="Mục tiêu tiết kiệm" value={formatVnd(currentMonth.budgets.savingsTargetVnd)} />
            <MetricTile label="Mong muốn còn lại" value={formatVnd(currentMonth.budgets.wantsBudgetVnd - currentMonth.totals.variableWants)} />
            <MetricTile label="Ngày còn lại" value={`${dayContext.remainingDaysInMonth} ngày`} />
          </div>

          {result ? (
            <>
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricTile
                  label="Bucket sau mua"
                  value={formatVnd(result.snapshot.bucketRemainingAfterPurchaseVnd)}
                  tone={result.snapshot.bucketRemainingAfterPurchaseVnd >= 0 ? "good" : "bad"}
                />
                <MetricTile
                  label="Cuối tháng sau mua"
                  value={formatVnd(result.snapshot.projectedEndMonthBalanceAfterPurchaseVnd)}
                  tone={
                    result.snapshot.projectedEndMonthBalanceAfterPurchaseVnd >=
                    result.snapshot.minimumSafetySavingsVnd
                      ? "good"
                      : "bad"
                  }
                />
                <MetricTile
                  label="Cap/ngày sau mua"
                  value={formatVnd(result.snapshot.dailyCapAfterPurchaseVnd)}
                  tone={
                    result.snapshot.dailyCapAfterPurchaseVnd >=
                    result.snapshot.essentialDailyNeedAfterPurchaseVnd
                      ? "good"
                      : "bad"
                  }
                />
                <MetricTile
                  label="Nợ / thu nhập"
                  value={pct(result.snapshot.debtToIncomeRatio)}
                  tone={
                    result.snapshot.debtToIncomeRatio > 0.3
                      ? "bad"
                      : result.snapshot.debtToIncomeRatio >= 0.2
                        ? "warn"
                        : "good"
                  }
                />
                <MetricTile
                  label="Nhịp chi vượt kế hoạch"
                  value={formatVnd(result.snapshot.variablePaceOverspendVnd)}
                  tone={result.snapshot.variablePaceOverspendVnd > 0 ? "warn" : "good"}
                />
                <MetricTile
                  label="Quỹ khẩn cấp phủ"
                  value={months(result.snapshot.emergencyCoverageMonths)}
                  tone={
                    result.snapshot.emergencyCoverageMonths >= 3
                      ? "good"
                      : result.snapshot.emergencyCoverageMonths >= 1
                        ? "warn"
                        : "bad"
                  }
                />
                <MetricTile
                  label="Trung bình chi lịch sử"
                  value={formatVnd(result.snapshot.historicalAverageSpendVnd)}
                />
                <MetricTile
                  label="Kế hoạch mua đang treo"
                  value={formatVnd(result.snapshot.existingPlanExposureVnd)}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {result.signals.map((signal) => (
                  <SignalRow key={signal.key} signal={signal} />
                ))}
              </div>

              <div className="rounded-md border bg-background p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Activity className="h-4 w-4" />
                  Chất lượng dữ liệu
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <LabelValueRow label="Tháng lịch sử" value={result.dataQuality.monthsWithHistory} />
                  <LabelValueRow label="Giao dịch tháng này" value={result.dataQuality.currentMonthExpenseCount} />
                  <LabelValueRow label="Kế hoạch đã lưu" value={result.dataQuality.purchasePlansCount} />
                  <LabelValueRow label="Biến động quỹ" value={result.dataQuality.savingsLedgerCount} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {result.snapshot.dayLocked
                      ? `Khóa ngày: còn lại từ ${result.snapshot.remainingStartDate}`
                      : "Ngày hiện tại chưa khóa"}
                  </Badge>
                  <Badge variant="outline">
                    {result.snapshot.budgetAdjustmentApplied
                      ? "Có điều chỉnh ngân sách"
                      : "Không có điều chỉnh ngân sách"}
                  </Badge>
                  <Badge variant="outline">
                    {result.snapshot.spendingCapsApplied ? "Có cap chi tiêu" : "Chưa có cap chi tiêu"}
                  </Badge>
                  {result.snapshot.targetDate ? (
                    <Badge variant="outline">Mục tiêu: {result.snapshot.targetDate}</Badge>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {forcedRescue ? <ForcedRescuePanel rescue={forcedRescue} onApply={applyForcedOption} /> : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Kế hoạch mua đã lưu</CardTitle>
            <Badge variant="secondary" className="tabular-nums">
              {purchasePlans.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {purchasePlans.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Chưa có kế hoạch nào. Lưu món mua để lần sau phân tích lại bằng dữ liệu mới.
            </div>
          ) : (
            <div className="space-y-3">
              {purchasePlans.map((plan) => (
                <div key={plan.id} className="rounded-md border bg-background p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 font-semibold">{plan.name}</div>
                        <Badge variant="outline">{BUCKET_LABELS_VI[plan.bucket]}</Badge>
                        <Badge variant="secondary">{priorityLabel[plan.priority]}</Badge>
                        {plan.forced ? <Badge>Bắt buộc</Badge> : null}
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-3">
                        <LabelValueRow label="Giá" value={formatVnd(plan.priceVnd)} />
                        <LabelValueRow label="Ngày mục tiêu" value={plan.targetDate ?? "Không có"} />
                        <LabelValueRow label="Cập nhật" value={plan.updatedAt.slice(0, 10)} />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          form.setValue("name", plan.name)
                          form.setValue("priceVnd", plan.priceVnd)
                          form.setValue("bucket", plan.bucket)
                          form.setValue("priority", plan.priority)
                          form.setValue("forced", plan.forced)
                          form.setValue("targetDate", plan.targetDate)
                          runAdvisor(
                            {
                              name: plan.name,
                              priceVnd: plan.priceVnd,
                              bucket: plan.bucket,
                              priority: plan.priority,
                              forced: plan.forced,
                              targetDate: plan.targetDate,
                            },
                            plan.id,
                          )
                        }}
                      >
                        <Gauge className="h-4 w-4" />
                        Phân tích lại
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline">
                            <Trash2 className="h-4 w-4" />
                            Xóa
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Xóa kế hoạch mua?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Kế hoạch "{plan.name}" sẽ bị xóa khỏi danh sách. Dữ liệu chi tiêu
                              thực tế không bị ảnh hưởng.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Hủy</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                deletePurchasePlan(plan.id)
                                toast.success("Đã xóa kế hoạch mua.")
                              }}
                            >
                              Xóa
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
