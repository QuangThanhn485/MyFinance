import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  WalletCards,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import DatePicker from "@/components/DatePicker"
import { CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import {
  getEffectiveSettingsForMonth,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import type {
  BudgetRule,
  ExpenseCategory,
  ISODate,
  SavingsTransactionType,
  Settings,
  YearMonth,
} from "@/domain/types"
import MoneyInput from "@/components/MoneyInput"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import LabelValueRow from "@/components/LabelValueRow"
import { formatVnd } from "@/lib/currency"
import { monthFromIsoDate, previousMonth, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { getActualMonthlySavingsVnd, getEmergencyFundMonthSummary } from "@/selectors/savings"
import { useAppStore } from "@/store/useAppStore"

const MONTH_LABELS = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
] as const

const SAVINGS_REASONS = [
  "Y tế",
  "Gia đình",
  "Sửa chữa",
  "Mất việc/thu nhập",
  "Khẩn cấp khác",
  "Nạp lại quỹ",
  "Điều chỉnh số dư",
] as const

function toYearMonth(year: number, month1To12: number): YearMonth {
  return `${year}-${String(month1To12).padStart(2, "0")}` as YearMonth
}

function defaultDateForMonth(month: YearMonth, currentMonth: YearMonth): ISODate {
  return (month === currentMonth ? todayIso() : `${month}-01`) as ISODate
}

function toRuleType(settings: Settings): "50_30_20" | "60_20_20" | "custom" {
  return settings.budgetRule.type === "custom" ? "custom" : settings.budgetRule.type
}

function toCustomRulePercents(settings: Settings) {
  if (settings.budgetRule.type === "custom") {
    const total = Math.max(1, settings.budgetRule.wantsPct + settings.budgetRule.savingsPct)
    const wants = Math.round((100 * settings.budgetRule.wantsPct) / total)
    return { customWantsPct: wants, customSavingsPct: 100 - wants }
  }
  if (settings.budgetRule.type === "60_20_20") {
    return { customWantsPct: 50, customSavingsPct: 50 }
  }
  return { customWantsPct: 60, customSavingsPct: 40 }
}

export default function SettingsPage() {
  const data = useAppStore((s) => s.data)
  const setSettingsForMonth = useAppStore((s) => s.actions.setSettingsForMonth)
  const ensureSettingsForMonth = useAppStore((s) => s.actions.ensureSettingsForMonth)
  const addFixedCost = useAppStore((s) => s.actions.addFixedCost)
  const updateFixedCost = useAppStore((s) => s.actions.updateFixedCost)
  const deleteFixedCost = useAppStore((s) => s.actions.deleteFixedCost)
  const addSavingsTransaction = useAppStore((s) => s.actions.addSavingsTransaction)
  const deleteSavingsTransaction = useAppStore((s) => s.actions.deleteSavingsTransaction)

  const currentMonth = monthFromIsoDate(todayIso())
  const currentYear = Number(currentMonth.slice(0, 4))
  const currentMonthIndex = Number(currentMonth.slice(5, 7))

  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(currentMonth)

  useEffect(() => {
    const monthIndex = Number(selectedMonth.slice(5, 7))
    const nextMonth = toYearMonth(selectedYear, monthIndex)
    if (nextMonth !== selectedMonth) {
      setSelectedMonth(nextMonth)
    }
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    if (selectedMonth >= currentMonth) {
      ensureSettingsForMonth(selectedMonth)
    }
  }, [currentMonth, ensureSettingsForMonth, selectedMonth])

  const selectedMonthLocked = isMonthLocked(data, selectedMonth)
  const hasOwnSettings = !!data.settingsByMonth[selectedMonth]
  const settingsForMonth = useMemo(
    () => getEffectiveSettingsForMonth(data, selectedMonth),
    [data, selectedMonth],
  )

  const fixedCosts = useMemo(
    () =>
      data.entities.fixedCosts.allIds
        .map((id) => data.entities.fixedCosts.byId[id])
        .filter((fc): fc is NonNullable<typeof fc> => !!fc && fc.month === selectedMonth),
    [data, selectedMonth],
  )
  const latestFixedCostMonth = useMemo<YearMonth | null>(() => {
    const hasByMonth = new Set<YearMonth>()
    for (const id of data.entities.fixedCosts.allIds) {
      const fc = data.entities.fixedCosts.byId[id]
      if (!fc?.month) continue
      hasByMonth.add(fc.month)
    }

    let cursor = previousMonth(selectedMonth)
    for (let i = 0; i < 240; i += 1) {
      if (hasByMonth.has(cursor)) return cursor
      cursor = previousMonth(cursor)
    }
    return null
  }, [data.entities.fixedCosts, selectedMonth])

  const debtPaymentMonthlyVnd = Math.max(0, Math.trunc(settingsForMonth.debtPaymentMonthlyVnd ?? 0))
  const emergencyFundSummary = useMemo(
    () => getEmergencyFundMonthSummary(data, selectedMonth),
    [data, selectedMonth],
  )
  const actualMonthlySavingsVnd = useMemo(
    () => getActualMonthlySavingsVnd(data, selectedMonth),
    [data, selectedMonth],
  )

  const schema = z
    .object({
      monthlyIncomeVnd: z.coerce.number().int().nonnegative(),
      extraIncomeMonthlyVnd: z.coerce.number().int().nonnegative(),
      paydayDayOfMonth: z.coerce.number().int().min(1).max(31),
      debtPaymentMonthlyVnd: z.coerce.number().int().nonnegative(),
      emergencyFundTargetMonths: z.coerce.number().int().min(0).max(60),
      emergencyFundCurrentVnd: z.coerce.number().int().nonnegative(),
      essentialVariableBaselineVnd: z.coerce.number().int().nonnegative(),
      customSavingsGoalVnd: z.coerce.number().int().nonnegative(),
      ruleType: z.enum(["50_30_20", "60_20_20", "custom"]),
      customWantsPct: z.coerce.number().int().min(0).max(100),
      customSavingsPct: z.coerce.number().int().min(0).max(100),
    })
    .superRefine((v, ctx) => {
      if (v.ruleType !== "custom") return
      if (v.customWantsPct + v.customSavingsPct !== 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mong muốn + Tiết kiệm phải có tổng = 100.",
          path: ["customWantsPct"],
        })
      }
    })

  type FormValues = z.infer<typeof schema>

  const defaultFormValues = useMemo<FormValues>(() => {
    const custom = toCustomRulePercents(settingsForMonth)
    return {
      monthlyIncomeVnd: settingsForMonth.monthlyIncomeVnd,
      extraIncomeMonthlyVnd: settingsForMonth.extraIncomeMonthlyVnd ?? 0,
      paydayDayOfMonth: settingsForMonth.paydayDayOfMonth,
      debtPaymentMonthlyVnd,
      emergencyFundTargetMonths: settingsForMonth.emergencyFundTargetMonths,
      emergencyFundCurrentVnd: settingsForMonth.emergencyFundCurrentVnd,
      essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
      customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd ?? 0,
      ruleType: toRuleType(settingsForMonth),
      customWantsPct: custom.customWantsPct,
      customSavingsPct: custom.customSavingsPct,
    }
  }, [settingsForMonth, debtPaymentMonthlyVnd])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  })

  useEffect(() => {
    form.reset(defaultFormValues)
  }, [defaultFormValues, form, selectedMonth])

  const [newFcName, setNewFcName] = useState("")
  const [newFcAmountVnd, setNewFcAmountVnd] = useState(0)
  const [newFcCategory, setNewFcCategory] = useState<ExpenseCategory>("Bills")
  const [createFixedCostOpen, setCreateFixedCostOpen] = useState(false)

  const [editingAmountId, setEditingAmountId] = useState<string | null>(null)
  const [editingAmountVnd, setEditingAmountVnd] = useState(0)
  const editingFixedCost = editingAmountId ? data.entities.fixedCosts.byId[editingAmountId] : null
  const [fundDialogType, setFundDialogType] = useState<SavingsTransactionType | null>(null)
  const [fundAmountVnd, setFundAmountVnd] = useState(0)
  const [fundDate, setFundDate] = useState<ISODate>(() =>
    defaultDateForMonth(currentMonth, currentMonth),
  )
  const [fundReason, setFundReason] = useState<string>("Khẩn cấp khác")
  const [fundNote, setFundNote] = useState("")

  const ruleType = form.watch("ruleType")

  useEffect(() => {
    setCreateFixedCostOpen(false)
    setNewFcName("")
    setNewFcAmountVnd(0)
    setNewFcCategory("Bills")
    setFundDialogType(null)
    setFundAmountVnd(0)
    setFundDate(defaultDateForMonth(selectedMonth, currentMonth))
    setFundReason("Khẩn cấp khác")
    setFundNote("")
  }, [selectedMonth])

  const resetFixedCostDraft = () => {
    setNewFcName("")
    setNewFcAmountVnd(0)
    setNewFcCategory("Bills")
  }

  const openFundDialog = (type: SavingsTransactionType) => {
    setFundDialogType(type)
    setFundAmountVnd(0)
    setFundDate(defaultDateForMonth(selectedMonth, currentMonth))
    setFundReason(type === "deposit" ? "Nạp lại quỹ" : "Khẩn cấp khác")
    setFundNote("")
  }

  const handleCreateSavingsTransaction = () => {
    if (!fundDialogType) return
    if (fundAmountVnd <= 0) {
      toast.error("Vui lòng nhập số tiền hợp lệ.")
      return
    }
    if (monthFromIsoDate(fundDate) !== selectedMonth) {
      toast.error(`Ngày biến động phải thuộc tháng ${selectedMonth}.`)
      return
    }
    if (fundDialogType === "withdraw" && fundAmountVnd > emergencyFundSummary.effectiveBalanceVnd) {
      toast.error("Số tiền rút lớn hơn số dư quỹ hiện tại.")
      return
    }
    addSavingsTransaction({
      type: fundDialogType,
      amountVnd: fundAmountVnd,
      reason: fundReason,
      note: fundNote,
      date: fundDate,
    })
    toast.success(fundDialogType === "deposit" ? "Đã nạp quỹ." : "Đã ghi nhận rút quỹ.")
    setFundDialogType(null)
  }

  const handleCreateFixedCost = () => {
    if (!newFcName.trim()) {
      toast.error("Vui lòng nhập tên khoản chi.")
      return
    }
    if (newFcAmountVnd <= 0) {
      toast.error("Vui lòng nhập số tiền hợp lệ.")
      return
    }
    addFixedCost({
      month: selectedMonth,
      name: newFcName.trim(),
      amountVnd: newFcAmountVnd,
      category: newFcCategory,
    })
    resetFixedCostDraft()
    setCreateFixedCostOpen(false)
    toast.success("Đã thêm chi phí cố định.")
  }

  const handleRestoreFixedCostsFromLatestMonth = () => {
    if (!latestFixedCostMonth) return

    const sourceFixedCosts = data.entities.fixedCosts.allIds
      .map((id) => data.entities.fixedCosts.byId[id])
      .filter(
        (fc): fc is NonNullable<typeof fc> => !!fc && fc.month === latestFixedCostMonth,
      )

    if (sourceFixedCosts.length === 0) {
      toast.error("Không tìm thấy dữ liệu để khôi phục.")
      return
    }

    for (const fc of sourceFixedCosts) {
      const newId = addFixedCost({
        month: selectedMonth,
        name: fc.name,
        amountVnd: fc.amountVnd,
        category: fc.category,
      })
      if (!fc.active) {
        updateFixedCost(newId, { active: false })
      }
    }

    toast.success(
      `Đã sao chép ${sourceFixedCosts.length} khoản từ ${latestFixedCostMonth} sang ${selectedMonth}.`,
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cài đặt theo tháng</h1>
        <p className="text-sm text-muted-foreground">
          Mỗi tháng có cấu hình riêng. Tháng mới mặc định kế thừa cấu hình tháng trước.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Chọn tháng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => setSelectedYear((y) => y - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-center font-semibold">{selectedYear}</div>
              <Button type="button" variant="outline" size="icon" onClick={() => setSelectedYear((y) => y + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MONTH_LABELS.map((label, index) => {
                const month = toYearMonth(selectedYear, index + 1)
                const isPast = month < currentMonth
                const isCurrent = month === currentMonth
                const isSelected = month === selectedMonth
                const locked = isMonthLocked(data, month)

                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => setSelectedMonth(month)}
                    className={cn(
                      "rounded-md border px-2 py-2 text-left text-sm transition-colors",
                      isPast && "bg-muted/50 text-muted-foreground",
                      isCurrent && "border-primary ring-1 ring-primary/30",
                      isSelected && "bg-primary/10 text-foreground",
                    )}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <span className="truncate">{label}</span>
                      {locked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {hasOwnSettings
                ? `Tháng ${selectedMonth} đang có cấu hình riêng.`
                : `Tháng ${selectedMonth} đang kế thừa từ tháng gần nhất trước đó.`}
            </div>
          </CardContent>
        </Card>

        <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Cấu hình tháng {selectedMonth}</span>
                {selectedMonthLocked ? (
                  <span className="text-xs text-muted-foreground">Đã chốt (vẫn có thể chỉnh chuẩn hoá)</span>
                ) : null}
              </CardTitle>
            </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => {
                let budgetRule: BudgetRule
                if (values.ruleType === "custom") {
                  budgetRule = {
                    type: "custom",
                    needsPct: 0,
                    wantsPct: values.customWantsPct,
                    savingsPct: values.customSavingsPct,
                  }
                } else {
                  budgetRule = { type: values.ruleType }
                }

                setSettingsForMonth({
                  month: selectedMonth,
                  patch: {
                    monthlyIncomeVnd: values.monthlyIncomeVnd,
                    extraIncomeMonthlyVnd: values.extraIncomeMonthlyVnd,
                    paydayDayOfMonth: values.paydayDayOfMonth,
                    debtPaymentMonthlyVnd: values.debtPaymentMonthlyVnd,
                    emergencyFundTargetMonths: values.emergencyFundTargetMonths,
                    emergencyFundCurrentVnd: values.emergencyFundCurrentVnd,
                    essentialVariableBaselineVnd: values.essentialVariableBaselineVnd,
                    customSavingsGoalVnd: values.customSavingsGoalVnd > 0 ? values.customSavingsGoalVnd : null,
                    budgetRule,
                  },
                })
                  toast.success(`Đã lưu cấu hình tháng ${selectedMonth}.`)
              })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Lương cứng tháng (VND)</Label>
                  <Controller
                    control={form.control}
                    name="monthlyIncomeVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 15.000.000" />
                    )}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Thu nhập thêm tháng (VND)</Label>
                  <Controller
                    control={form.control}
                    name="extraIncomeMonthlyVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 2.000.000" />
                    )}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Ngày nhận lương (1-31)</Label>
                  <Input inputMode="numeric" {...form.register("paydayDayOfMonth")} />
                </div>
                <div className="grid gap-2">
                  <Label>Trả nợ hàng tháng (VND)</Label>
                  <Controller
                    control={form.control}
                    name="debtPaymentMonthlyVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 800.000" />
                    )}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Quy tắc chia Wants/Savings</Label>
                <Select value={ruleType} onValueChange={(v) => form.setValue("ruleType", v as FormValues["ruleType"])}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn quy tắc" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50_30_20">Mong muốn/Tiết kiệm 60/40</SelectItem>
                    <SelectItem value="60_20_20">Mong muốn/Tiết kiệm 50/50</SelectItem>
                    <SelectItem value="custom">Tuỳ chỉnh</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {ruleType === "custom" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input inputMode="numeric" placeholder="Mong muốn %" {...form.register("customWantsPct")} />
                  <Input inputMode="numeric" placeholder="Tiết kiệm %" {...form.register("customSavingsPct")} />
                  {form.formState.errors.customWantsPct ? (
                    <div className="sm:col-span-2 text-xs text-destructive">{form.formState.errors.customWantsPct.message as string}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Baseline thiết yếu biến đổi (E)</Label>
                  <Controller
                    control={form.control}
                    name="essentialVariableBaselineVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 3.000.000" />
                    )}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Mục tiêu tiết kiệm tuỳ chọn</Label>
                  <Controller
                    control={form.control}
                    name="customSavingsGoalVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 4.000.000" />
                    )}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Mục tiêu quỹ khẩn cấp (tháng)</Label>
                  <Input inputMode="numeric" {...form.register("emergencyFundTargetMonths")} />
                </div>
                <div className="grid gap-2">
                  <Label>Số dư quỹ đầu tháng</Label>
                  <Controller
                    control={form.control}
                    name="emergencyFundCurrentVnd"
                    render={({ field }) => (
                      <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 12.000.000" />
                    )}
                  />
                </div>
              </div>

              <Button type="submit">Lưu cấu hình tháng</Button>
            </form>

            <Separator />

            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <WalletCards className="h-4 w-4 text-muted-foreground" />
                  <span>Biến động quỹ khẩn cấp</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => openFundDialog("withdraw")}>
                    <ArrowDownCircle className="mr-1.5 h-4 w-4" />
                    Rút quỹ
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => openFundDialog("deposit")}>
                    <ArrowUpCircle className="mr-1.5 h-4 w-4" />
                    Nạp lại
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 rounded-md bg-background p-3">
                <LabelValueRow
                  label="Số dư đầu tháng"
                  value={formatVnd(emergencyFundSummary.openingBalanceVnd)}
                />
                <LabelValueRow label="Đã nạp trong tháng" value={formatVnd(emergencyFundSummary.depositedVnd)} />
                <LabelValueRow label="Đã rút trong tháng" value={formatVnd(emergencyFundSummary.withdrawnVnd)} />
                <Separator />
                <LabelValueRow
                  label="Số dư hiện tại sau biến động"
                  value={formatVnd(emergencyFundSummary.effectiveBalanceVnd)}
                  valueClassName="font-semibold"
                />
                <LabelValueRow
                  label="Tiết kiệm tháng này sẽ chuyển sang tháng sau"
                  labelTitle="Tiết kiệm tháng này sẽ chuyển sang tháng sau"
                  value={formatVnd(actualMonthlySavingsVnd)}
                />
              </div>

              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1">
                {emergencyFundSummary.transactions.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-background p-3 text-muted-foreground">
                    Chưa có biến động quỹ trong tháng này.
                  </div>
                ) : (
                  emergencyFundSummary.transactions.map((tx) => (
                    <div key={tx.id} className="rounded-md border bg-background p-3">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "font-medium tabular-nums",
                                tx.type === "withdraw" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
                              )}
                            >
                              {tx.type === "withdraw" ? "-" : "+"}
                              {formatVnd(tx.amountVnd)}
                            </span>
                            <span className="text-xs text-muted-foreground">{tx.date}</span>
                          </div>
                          <div className="truncate text-sm text-muted-foreground" title={tx.note || tx.reason}>
                            {tx.reason}{tx.note ? ` • ${tx.note}` : ""}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            deleteSavingsTransaction(tx.id)
                            toast.success("Đã xoá biến động quỹ.")
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Xoá biến động quỹ</span>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Chi phí cố định • {selectedMonth}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{fixedCosts.length} khoản</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCreateFixedCostOpen(true)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Thêm khoản
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-h-[calc(100vh-180px)] gap-2 overflow-y-auto pr-1">
              {fixedCosts.length === 0 ? (
                <div className="space-y-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  <div>Tháng này chưa có chi phí cố định.</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setCreateFixedCostOpen(true)}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Thêm khoản đầu tiên
                    </Button>
                    {latestFixedCostMonth ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleRestoreFixedCostsFromLatestMonth}
                      >
                        Khôi phục từ {latestFixedCostMonth}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                fixedCosts.map((fc) => (
                  <div key={fc.id} className="rounded-md border p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium" title={fc.name}>{fc.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {formatVnd(fc.amountVnd)} • {CATEGORY_LABELS_VI[fc.category]}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={fc.active}
                          onCheckedChange={(checked) => updateFixedCost(fc.id, { active: checked })}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingAmountId(fc.id)
                            setEditingAmountVnd(fc.amountVnd)
                          }}
                        >
                          Sửa số tiền
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            deleteFixedCost(fc.id)
                            toast.success("Đã xoá.")
                          }}
                        >
                          Xoá
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 w-[180px]">
                      <Select
                        value={fc.category}
                        onValueChange={(v) => updateFixedCost(fc.id, { category: v as ExpenseCategory })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{CATEGORY_LABELS_VI[c]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={fundDialogType !== null}
        onOpenChange={(open) => {
          if (!open) setFundDialogType(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{fundDialogType === "deposit" ? "Nạp lại quỹ khẩn cấp" : "Rút quỹ khẩn cấp"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Số tiền (VND)</Label>
              <MoneyInput
                value={fundAmountVnd}
                onValueChange={setFundAmountVnd}
                placeholder="Ví dụ: 1.000.000"
              />
            </div>
            <div className="grid gap-2">
              <Label>Ngày</Label>
              <DatePicker value={fundDate} onChange={(value) => value && setFundDate(value)} />
            </div>
            <div className="grid gap-2">
              <Label>Lý do</Label>
              <Select value={fundReason} onValueChange={setFundReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAVINGS_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú</Label>
              <Input
                value={fundNote}
                onChange={(event) => setFundNote(event.target.value)}
                maxLength={200}
                placeholder="Tuỳ chọn"
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm">
              <LabelValueRow label="Số dư hiện tại" value={formatVnd(emergencyFundSummary.effectiveBalanceVnd)} />
              {fundDialogType === "withdraw" ? (
                <LabelValueRow
                  label="Sau khi rút"
                  value={formatVnd(Math.max(0, emergencyFundSummary.effectiveBalanceVnd - fundAmountVnd))}
                />
              ) : (
                <LabelValueRow
                  label="Sau khi nạp"
                  value={formatVnd(emergencyFundSummary.effectiveBalanceVnd + Math.max(0, fundAmountVnd))}
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFundDialogType(null)}>
                Huỷ
              </Button>
              <Button type="button" onClick={handleCreateSavingsTransaction}>
                {fundDialogType === "deposit" ? "Nạp quỹ" : "Rút quỹ"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createFixedCostOpen}
        onOpenChange={(open) => {
          setCreateFixedCostOpen(open)
          if (!open) resetFixedCostDraft()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Thêm chi phí cố định</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Tên khoản cố định</Label>
              <Input
                value={newFcName}
                onChange={(event) => setNewFcName(event.target.value)}
                placeholder="Ví dụ: Tiền nhà"
              />
            </div>
            <div className="grid gap-2">
              <Label>Số tiền (VND)</Label>
              <MoneyInput
                value={newFcAmountVnd}
                onValueChange={setNewFcAmountVnd}
                placeholder="Ví dụ: 4.500.000"
              />
            </div>
            <div className="grid gap-2">
              <Label>Danh mục</Label>
              <Select value={newFcCategory} onValueChange={(v) => setNewFcCategory(v as ExpenseCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS_VI[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateFixedCostOpen(false)}>
                Huỷ
              </Button>
              <Button type="button" onClick={handleCreateFixedCost}>
                Thêm khoản
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingAmountId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAmountId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa số tiền</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {editingFixedCost ? editingFixedCost.name : "Chi phí cố định"}
            </div>
            <div className="grid gap-2">
              <Label>Số tiền (VND)</Label>
              <MoneyInput value={editingAmountVnd} onValueChange={setEditingAmountVnd} placeholder="Ví dụ: 1.200.000" />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!editingAmountId) return
                  if (editingAmountVnd <= 0) {
                    toast.error("Vui lòng nhập số tiền hợp lệ.")
                    return
                  }
                  updateFixedCost(editingAmountId, { amountVnd: editingAmountVnd })
                  toast.success("Đã cập nhật.")
                  setEditingAmountId(null)
                }}
              >
                Lưu
              </Button>
              <Button variant="outline" onClick={() => setEditingAmountId(null)}>
                Huỷ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
