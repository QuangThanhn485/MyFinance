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
import { getExpenseCategoryLabel } from "@/domain/constants"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { getEmergencyFundMonthSummary } from "@/selectors/savings"
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
  }, [currentMonth, data.updatedAt, ensureSettingsForMonth, selectedMonth])

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
  const emergencyFundWithdrawals = useMemo(
    () => emergencyFundSummary.transactions.filter((tx) => tx.type === "withdraw"),
    [emergencyFundSummary.transactions],
  )
  const emergencyFundDeposits = useMemo(
    () => emergencyFundSummary.transactions.filter((tx) => tx.type === "deposit"),
    [emergencyFundSummary.transactions],
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

  const categoryOptions = useMemo(() => data.expenseCategories, [data.expenseCategories])
  const categoryLabels = useMemo(
    () =>
      Object.fromEntries(
        categoryOptions.map((category) => [category.id, category.label]),
      ) as Record<string, string>,
    [categoryOptions],
  )
  const defaultCategory = categoryOptions[0]?.id ?? "Other"
  const categoryLabel = (category: ExpenseCategory) =>
    categoryLabels[category] ?? getExpenseCategoryLabel(category, categoryOptions)

  const [newFcName, setNewFcName] = useState("")
  const [newFcAmountVnd, setNewFcAmountVnd] = useState(0)
  const [newFcCategory, setNewFcCategory] = useState<ExpenseCategory>(defaultCategory)
  const [createFixedCostOpen, setCreateFixedCostOpen] = useState(false)

  const [editingAmountId, setEditingAmountId] = useState<string | null>(null)
  const [editingAmountVnd, setEditingAmountVnd] = useState(0)
  const editingFixedCost = editingAmountId ? data.entities.fixedCosts.byId[editingAmountId] : null
  const [fundDialogType, setFundDialogType] = useState<SavingsTransactionType | null>(null)
  const [fundHistoryOpen, setFundHistoryOpen] = useState(false)
  const [fundHistoryTab, setFundHistoryTab] = useState<SavingsTransactionType>("withdraw")
  const [fundAmountVnd, setFundAmountVnd] = useState(0)
  const [fundDate, setFundDate] = useState<ISODate>(() =>
    defaultDateForMonth(currentMonth, currentMonth),
  )
  const [fundReason, setFundReason] = useState<string>("Khẩn cấp khác")
  const [fundNote, setFundNote] = useState("")

  const ruleType = form.watch("ruleType")
  const fundHistoryGroups = useMemo(
    () => [
      {
        key: "withdraw" as const,
        label: "Rút quỹ",
        totalVnd: emergencyFundSummary.withdrawnVnd,
        transactions: emergencyFundWithdrawals,
        icon: ArrowDownCircle,
        amountPrefix: "-",
        amountClassName: "text-destructive",
        emptyText: "Chưa có khoản rút.",
      },
      {
        key: "deposit" as const,
        label: "Nạp lại",
        totalVnd: emergencyFundSummary.depositedVnd,
        transactions: emergencyFundDeposits,
        icon: ArrowUpCircle,
        amountPrefix: "+",
        amountClassName: "text-emerald-700 dark:text-emerald-400",
        emptyText: "Chưa có khoản nạp.",
      },
    ],
    [
      emergencyFundDeposits,
      emergencyFundSummary.depositedVnd,
      emergencyFundSummary.withdrawnVnd,
      emergencyFundWithdrawals,
    ],
  )
  const activeFundHistoryGroup =
    fundHistoryGroups.find((group) => group.key === fundHistoryTab) ?? fundHistoryGroups[0]

  useEffect(() => {
    if (categoryOptions.some((category) => category.id === newFcCategory)) return
    setNewFcCategory(defaultCategory)
  }, [categoryOptions, defaultCategory, newFcCategory])

  useEffect(() => {
    setCreateFixedCostOpen(false)
    setNewFcName("")
    setNewFcAmountVnd(0)
    setNewFcCategory(defaultCategory)
    setFundDialogType(null)
    setFundHistoryOpen(false)
    setFundHistoryTab("withdraw")
    setFundAmountVnd(0)
    setFundDate(defaultDateForMonth(selectedMonth, currentMonth))
    setFundReason("Khẩn cấp khác")
    setFundNote("")
  }, [currentMonth, defaultCategory, selectedMonth])

  const resetFixedCostDraft = () => {
    setNewFcName("")
    setNewFcAmountVnd(0)
    setNewFcCategory(defaultCategory)
  }

  const openFundDialog = (type: SavingsTransactionType) => {
    setFundDialogType(type)
    setFundAmountVnd(0)
    setFundDate(defaultDateForMonth(selectedMonth, currentMonth))
    setFundReason(type === "deposit" ? "Nạp lại quỹ" : "Khẩn cấp khác")
    setFundNote("")
  }

  const openFundHistoryDialog = () => {
    setFundHistoryTab(emergencyFundWithdrawals.length > 0 ? "withdraw" : "deposit")
    setFundHistoryOpen(true)
  }

  const renderFundHistoryGroup = (
    group: (typeof fundHistoryGroups)[number],
    density: "desktop" | "mobile" = "desktop",
  ) => {
    const Icon = group.icon

    return (
      <div
        key={group.key}
        className={cn(
          "flex min-h-0 flex-col rounded-md border bg-background",
          density === "mobile" && "h-full",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b px-2.5 py-2 sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className={cn("h-4 w-4 shrink-0", group.amountClassName)} />
            <span className="truncate text-sm font-medium sm:text-base">{group.label}</span>
          </div>
          <div className="shrink-0 text-right">
            <div className={cn("text-sm font-semibold tabular-nums sm:text-base", group.amountClassName)} title={formatVnd(group.totalVnd)}>
              {formatVnd(group.totalVnd)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {group.transactions.length} giao dịch
            </div>
          </div>
        </div>

        <div
          className={cn(
            "grid content-start overflow-y-auto",
            density === "mobile" ? "min-h-0 flex-1 gap-1.5 p-1.5" : "max-h-[42vh] min-h-32 gap-2 p-2",
          )}
        >
          {group.transactions.length === 0 ? (
            <div className="grid min-h-28 place-items-center rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              {group.emptyText}
            </div>
          ) : (
            group.transactions.map((tx) => (
              <div key={tx.id} className="rounded-md border bg-muted/10 px-2.5 py-2 sm:p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn("text-sm font-semibold tabular-nums sm:text-base", group.amountClassName)}>
                        {group.amountPrefix}
                        {formatVnd(tx.amountVnd)}
                      </span>
                      <span className="text-[11px] text-muted-foreground sm:text-xs">{tx.date}</span>
                    </div>
                    <div className="mt-0.5 break-words text-xs text-muted-foreground sm:mt-1 sm:text-sm">
                      {tx.reason}{tx.note ? ` • ${tx.note}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
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
    )
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
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Cài đặt theo tháng</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Mỗi tháng có cấu hình riêng. Tháng mới mặc định kế thừa cấu hình tháng trước.
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:h-[calc(100dvh-8rem)] lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3 sm:space-y-4">
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

        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>Cấu hình tháng {selectedMonth}</span>
              {selectedMonthLocked ? (
                <span className="text-xs text-muted-foreground">Đã chốt (vẫn có thể chỉnh chuẩn hoá)</span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="grid gap-3"
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
              <div className="grid gap-3 sm:grid-cols-2">
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

              <div className="grid gap-3 sm:grid-cols-2">
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

              <div className="grid gap-3 sm:grid-cols-2">
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

              <div className="grid gap-3 sm:grid-cols-2">
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

            <div className="rounded-md border bg-muted/20 p-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <WalletCards className="h-4 w-4 text-muted-foreground" />
                  <span>Biến động quỹ khẩn cấp</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => openFundDialog("withdraw")}
                  >
                    <ArrowDownCircle className="mr-1.5 h-4 w-4" />
                    Rút quỹ
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    onClick={() => openFundDialog("deposit")}
                  >
                    <ArrowUpCircle className="mr-1.5 h-4 w-4" />
                    Nạp lại
                  </Button>
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md bg-background px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <WalletCards className="h-3.5 w-3.5" />
                    <span>Số dư đầu tháng</span>
                  </div>
                  <div
                    className="mt-1 truncate font-semibold tabular-nums"
                    title={formatVnd(emergencyFundSummary.openingBalanceVnd)}
                  >
                    {formatVnd(emergencyFundSummary.openingBalanceVnd)}
                  </div>
                </div>
                <div className="rounded-md bg-background px-2.5 py-2 ring-1 ring-primary/15">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <WalletCards className="h-3.5 w-3.5" />
                    <span>Số dư hiện tại</span>
                  </div>
                  <div
                    className="mt-1 truncate text-base font-semibold tabular-nums"
                    title={formatVnd(emergencyFundSummary.effectiveBalanceVnd)}
                  >
                    {formatVnd(emergencyFundSummary.effectiveBalanceVnd)}
                  </div>
                </div>
                <div className="rounded-md border bg-background/70 px-2.5 py-2">
                  <div className="grid h-full gap-2 sm:grid-rows-[auto_auto]">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-muted-foreground">
                        Lịch sử • {emergencyFundSummary.transactionCount} giao dịch
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <ArrowDownCircle className="h-3.5 w-3.5" />
                          {emergencyFundWithdrawals.length} rút
                        </span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          {emergencyFundDeposits.length} nạp
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full self-end"
                      onClick={openFundHistoryDialog}
                    >
                      Xem lịch sử
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:flex lg:h-[calc(100dvh-8rem)] lg:min-h-0 lg:flex-col lg:overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>Chi phí cố định • {selectedMonth}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{fixedCosts.length} khoản</span>
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
          <CardContent className="space-y-3 p-2 sm:p-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <div className="flex flex-col gap-2 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
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
                  <div key={fc.id} className="rounded-md border p-2.5">
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5" title={fc.name}>{fc.name}</div>
                        <div className="truncate text-sm leading-5 text-muted-foreground" title={`${formatVnd(fc.amountVnd)} • ${categoryLabel(fc.category)}`}>
                          {formatVnd(fc.amountVnd)} • {categoryLabel(fc.category)}
                        </div>
                      </div>
                      <div className="w-full lg:order-2">
                        <Select
                          value={fc.category}
                          onValueChange={(v) => updateFixedCost(fc.id, { category: v as ExpenseCategory })}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 lg:order-3">
                        <Switch
                          checked={fc.active}
                          onCheckedChange={(checked) => updateFixedCost(fc.id, { active: checked })}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 px-3 text-sm"
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
                          className="h-9 px-3 text-sm"
                          onClick={() => {
                            deleteFixedCost(fc.id)
                            toast.success("Đã xoá.")
                          }}
                        >
                          Xoá
                        </Button>
                      </div>
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
            <div className="flex flex-wrap justify-end gap-2 [&>button]:w-full sm:[&>button]:w-auto">
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

      <Dialog open={fundHistoryOpen} onOpenChange={setFundHistoryOpen}>
        <DialogContent className="max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:max-h-[100dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:grid-rows-[auto_1fr] max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-none max-sm:border-0 max-sm:p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-4 pb-3 pr-12 pt-4 text-left sm:border-0 sm:p-0 sm:pr-8">
            <DialogTitle>
              <span className="sm:hidden">Biến động quỹ</span>
              <span className="hidden sm:inline">Biến động quỹ khẩn cấp • {selectedMonth}</span>
            </DialogTitle>
            <DialogDescription>
              Tháng {selectedMonth} • {emergencyFundSummary.transactionCount} giao dịch
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 max-sm:min-h-0 max-sm:grid-rows-[auto_auto_1fr] max-sm:overflow-hidden max-sm:p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border bg-muted/20 px-2.5 py-2 sm:px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <WalletCards className="h-3.5 w-3.5" />
                  <span>Số dư đầu tháng</span>
                </div>
                <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base" title={formatVnd(emergencyFundSummary.openingBalanceVnd)}>
                  {formatVnd(emergencyFundSummary.openingBalanceVnd)}
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 px-2.5 py-2 ring-1 ring-primary/15 sm:px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <WalletCards className="h-3.5 w-3.5" />
                  <span>Số dư hiện tại</span>
                </div>
                <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base" title={formatVnd(emergencyFundSummary.effectiveBalanceVnd)}>
                  {formatVnd(emergencyFundSummary.effectiveBalanceVnd)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:hidden">
              {fundHistoryGroups.map((group) => {
                const Icon = group.icon
                const selected = fundHistoryTab === group.key

                return (
                  <button
                    key={group.key}
                    type="button"
                    className={cn(
                      "grid min-w-0 gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors",
                      selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                    onClick={() => setFundHistoryTab(group.key)}
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", group.amountClassName)} />
                      <span className="truncate">{group.label}</span>
                    </span>
                    <span className={cn("truncate font-semibold tabular-nums", selected && group.amountClassName)}>
                      {formatVnd(group.totalVnd)}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="min-h-0 sm:hidden">
              {renderFundHistoryGroup(activeFundHistoryGroup, "mobile")}
            </div>

            <div className="hidden gap-3 sm:grid lg:grid-cols-2">
              {fundHistoryGroups.map((group) => renderFundHistoryGroup(group))}
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
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap justify-end gap-2 [&>button]:w-full sm:[&>button]:w-auto">
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
            <div className="flex flex-wrap gap-2 [&>button]:w-full sm:[&>button]:w-auto">
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
