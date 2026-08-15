import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Lock,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  WalletCards,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import DatePicker from "@/components/DatePicker"
import {
  getEffectiveSettingsForMonth,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import type {
  BudgetRule,
  ExpenseCategory,
  FixedCost,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

type FixedCostEditDraft = {
  id: string
  name: string
  amountVnd: number
  paidAmountVnd: number
  category: ExpenseCategory
  active: boolean
}

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
  const fixedCostsSummary = useMemo(
    () =>
      fixedCosts.reduce(
        (summary, fixedCost) => {
          if (!fixedCost.active) return summary
          const plannedVnd = Math.max(0, Math.trunc(fixedCost.amountVnd))
          const paidVnd = Math.max(0, Math.trunc(fixedCost.paidAmountVnd ?? 0))
          return {
            plannedVnd: summary.plannedVnd + plannedVnd,
            paidVnd: summary.paidVnd + paidVnd,
          }
        },
        { plannedVnd: 0, paidVnd: 0 },
      ),
    [fixedCosts],
  )
  const fixedCostsPaidPct =
    fixedCostsSummary.plannedVnd > 0
      ? Math.round((fixedCostsSummary.paidVnd / fixedCostsSummary.plannedVnd) * 100)
      : 0
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
      debtPaymentPaidVnd: z.coerce.number().int().nonnegative(),
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
      debtPaymentPaidVnd: Math.max(0, Math.trunc(settingsForMonth.debtPaymentPaidVnd ?? 0)),
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
  const defaultCategory = categoryOptions[0]?.id ?? "Other"

  const [newFcName, setNewFcName] = useState("")
  const [newFcAmountVnd, setNewFcAmountVnd] = useState(0)
  const [newFcCategory, setNewFcCategory] = useState<ExpenseCategory>(defaultCategory)
  const [createFixedCostOpen, setCreateFixedCostOpen] = useState(false)

  const [editingFixedCostDraft, setEditingFixedCostDraft] =
    useState<FixedCostEditDraft | null>(null)
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

  const openFixedCostEditor = (fixedCost: FixedCost) => {
    setEditingFixedCostDraft({
      id: fixedCost.id,
      name: fixedCost.name,
      amountVnd: Math.max(0, Math.trunc(fixedCost.amountVnd)),
      paidAmountVnd: Math.max(0, Math.trunc(fixedCost.paidAmountVnd ?? 0)),
      category: fixedCost.category,
      active: fixedCost.active,
    })
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
      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Cài đặt theo tháng</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Mỗi tháng có cấu hình riêng. Tháng mới mặc định kế thừa cấu hình tháng trước.
          </p>
        </div>
        <Button
          type="submit"
          form="month-settings-form"
          className="w-full shrink-0 sm:w-auto sm:min-w-52"
          disabled={!form.formState.isDirty}
        >
          <Save className="mr-1.5 h-4 w-4" />
          Lưu cấu hình tháng
        </Button>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start xl:grid-cols-[240px_minmax(0,1fr)_minmax(360px,0.8fr)]">
        <div className="space-y-3 sm:space-y-4 lg:sticky lg:top-20">
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

              <div className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                {hasOwnSettings
                  ? `Tháng ${selectedMonth} đang có cấu hình riêng.`
                  : `Tháng ${selectedMonth} đang kế thừa từ tháng gần nhất trước đó.`}
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="min-w-0 space-y-3 sm:space-y-4">
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
              id="month-settings-form"
              className="grid gap-5"
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
                    debtPaymentPaidVnd: values.debtPaymentPaidVnd,
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
              <section className="grid gap-3">
                <div className="border-b pb-2 text-sm font-semibold">Thu nhập</div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(140px,0.45fr)]">
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
                  <div className="grid gap-2">
                    <Label>Ngày nhận lương (1-31)</Label>
                    <Input inputMode="numeric" {...form.register("paydayDayOfMonth")} />
                  </div>
                </div>
              </section>

              <section className="grid gap-3">
                <div className="border-b pb-2 text-sm font-semibold">Phân bổ ngân sách</div>
                <div className="grid gap-2">
                  <Label>Quy tắc chia Mong muốn/Tiết kiệm</Label>
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
              </section>

              <section className="grid gap-3">
                <div className="border-b pb-2 text-sm font-semibold">Nợ và quỹ khẩn cấp</div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="grid gap-2">
                    <Label>Trả nợ kế hoạch (VND)</Label>
                    <Controller
                      control={form.control}
                      name="debtPaymentMonthlyVnd"
                      render={({ field }) => (
                        <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 800.000" />
                      )}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Trả nợ đã chi (VND)</Label>
                    <Controller
                      control={form.control}
                      name="debtPaymentPaidVnd"
                      render={({ field }) => (
                        <MoneyInput value={Number(field.value) || 0} onValueChange={field.onChange} placeholder="Ví dụ: 800.000" />
                      )}
                    />
                  </div>
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
              </section>

            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <WalletCards className="h-4 w-4 text-muted-foreground" />
                Quỹ khẩn cấp
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openFundDialog("withdraw")}
                >
                  <ArrowDownCircle className="mr-1.5 h-4 w-4" />
                  Rút quỹ
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => openFundDialog("deposit")}
                >
                  <ArrowUpCircle className="mr-1.5 h-4 w-4" />
                  Nạp lại
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border bg-muted/15 px-3 py-3">
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
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-3">
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
                <div className="rounded-md border bg-muted/15 px-3 py-3">
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
          </CardContent>
        </Card>

        </div>

        <Card
          id="fixed-costs"
          className="scroll-mt-4 lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:flex xl:max-h-[calc(100dvh-6rem)] xl:min-h-0 xl:flex-col xl:overflow-hidden"
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Chi phí cố định</CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span>{selectedMonth}</span>
                  <span aria-hidden="true">•</span>
                  <span>{fixedCosts.length} khoản</span>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => setCreateFixedCostOpen(true)}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Thêm khoản
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div className="overflow-hidden rounded-md border bg-muted/15">
              <div className="grid grid-cols-3 divide-x text-center">
                <div className="min-w-0 px-2 py-3 sm:px-4">
                  <div className="text-xs text-muted-foreground">Kế hoạch</div>
                  <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base" title={formatVnd(fixedCostsSummary.plannedVnd)}>
                    {formatVnd(fixedCostsSummary.plannedVnd)}
                  </div>
                </div>
                <div className="min-w-0 px-2 py-3 sm:px-4">
                  <div className="text-xs text-muted-foreground">Đã chi</div>
                  <div className="mt-1 truncate text-sm font-semibold tabular-nums sm:text-base" title={formatVnd(fixedCostsSummary.paidVnd)}>
                    {formatVnd(fixedCostsSummary.paidVnd)}
                  </div>
                </div>
                <div className="min-w-0 px-2 py-3 sm:px-4">
                  <div className="text-xs text-muted-foreground">
                    {fixedCostsSummary.paidVnd > fixedCostsSummary.plannedVnd ? "Vượt kế hoạch" : "Còn lại"}
                  </div>
                  <div
                    className={cn(
                      "mt-1 truncate text-sm font-semibold tabular-nums sm:text-base",
                      fixedCostsSummary.paidVnd > fixedCostsSummary.plannedVnd && "text-destructive",
                    )}
                    title={formatVnd(Math.abs(fixedCostsSummary.plannedVnd - fixedCostsSummary.paidVnd))}
                  >
                    {formatVnd(Math.abs(fixedCostsSummary.plannedVnd - fixedCostsSummary.paidVnd))}
                  </div>
                </div>
              </div>
              <div className="border-t px-3 py-2.5 sm:px-4">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Tiến độ thanh toán</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">
                    {fixedCostsPaidPct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      fixedCostsPaidPct > 100 ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, fixedCostsPaidPct))}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-2.5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              {fixedCosts.length === 0 ? (
                <div className="space-y-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
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
                fixedCosts.map((fc) => {
                  const plannedAmountVnd = Math.max(0, Math.trunc(fc.amountVnd))
                  const paidAmountVnd = Math.max(0, Math.trunc(fc.paidAmountVnd ?? 0))
                  const progressPct =
                    plannedAmountVnd > 0 ? (paidAmountVnd / plannedAmountVnd) * 100 : 0
                  const isOverPlan = paidAmountVnd > plannedAmountVnd
                  const isComplete = plannedAmountVnd > 0 && paidAmountVnd >= plannedAmountVnd
                  const categoryLabel =
                    categoryOptions.find((category) => category.id === fc.category)?.label ??
                    fc.category

                  return (
                    <div
                      key={fc.id}
                      className={cn(
                        "min-w-0 rounded-md border bg-background p-3",
                        !fc.active && "bg-muted/20",
                      )}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                              !fc.active
                                ? "bg-muted text-muted-foreground"
                                : isOverPlan
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : isComplete
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "border-primary/30 bg-primary/10 text-primary",
                            )}
                            title={
                              !fc.active
                                ? "Đã tạm dừng"
                                : isOverPlan
                                  ? "Vượt kế hoạch"
                                  : isComplete
                                    ? "Đã hoàn tất"
                                    : "Đang thanh toán"
                            }
                          >
                            {!fc.active ? (
                              <PauseCircle className="h-4 w-4" />
                            ) : isOverPlan ? (
                              <TriangleAlert className="h-4 w-4" />
                            ) : isComplete ? (
                              <CircleCheck className="h-4 w-4" />
                            ) : (
                              <span className="h-2.5 w-2.5 rounded-full bg-current" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-5" title={fc.name}>
                              {fc.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground" title={categoryLabel}>
                              {categoryLabel}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2 min-w-0">
                          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs tabular-nums">
                            <span className="font-medium text-foreground">
                              {formatVnd(paidAmountVnd)} / {formatVnd(plannedAmountVnd)}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 font-medium",
                                isOverPlan
                                  ? "text-destructive"
                                  : isComplete
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-muted-foreground",
                              )}
                            >
                              {Math.round(progressPct)}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-[width] duration-300",
                                !fc.active
                                  ? "bg-muted-foreground/50"
                                  : isOverPlan
                                    ? "bg-destructive"
                                    : isComplete
                                      ? "bg-emerald-500"
                                      : "bg-primary",
                              )}
                              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                            />
                          </div>
                        </div>
                        <div className="col-start-2 row-start-1 flex items-center justify-end gap-0.5 self-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                                aria-label={`Thao tác khác cho ${fc.name}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openFixedCostEditor(fc)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Chỉnh sửa
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => updateFixedCost(fc.id, { active: !fc.active })}
                              >
                                {fc.active ? (
                                  <PauseCircle className="mr-2 h-4 w-4" />
                                ) : (
                                  <PlayCircle className="mr-2 h-4 w-4" />
                                )}
                                {fc.active ? "Tạm dừng" : "Kích hoạt"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  deleteFixedCost(fc.id)
                                  toast.success("Đã xoá.")
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Xoá khoản
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  )
                })
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
        open={editingFixedCostDraft !== null}
        onOpenChange={(open) => {
          if (!open) setEditingFixedCostDraft(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa chi phí cố định</DialogTitle>
            <DialogDescription>{selectedMonth}</DialogDescription>
          </DialogHeader>
          {editingFixedCostDraft ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Tên khoản chi</Label>
                <Input
                  value={editingFixedCostDraft.name}
                  onChange={(event) =>
                    setEditingFixedCostDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label>Danh mục</Label>
                <Select
                  value={editingFixedCostDraft.category}
                  onValueChange={(value) =>
                    setEditingFixedCostDraft((current) =>
                      current ? { ...current, category: value as ExpenseCategory } : current,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Kế hoạch (VND)</Label>
                  <MoneyInput
                    value={editingFixedCostDraft.amountVnd}
                    onValueChange={(value) =>
                      setEditingFixedCostDraft((current) =>
                        current ? { ...current, amountVnd: value } : current,
                      )
                    }
                    placeholder="Ví dụ: 1.200.000"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Đã chi (VND)</Label>
                  <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
                    <MoneyInput
                      value={editingFixedCostDraft.paidAmountVnd}
                      onValueChange={(value) =>
                        setEditingFixedCostDraft((current) =>
                          current ? { ...current, paidAmountVnd: value } : current,
                        )
                      }
                      placeholder="0"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Điền đủ số tiền kế hoạch"
                      aria-label="Điền đủ số tiền kế hoạch"
                      disabled={
                        editingFixedCostDraft.paidAmountVnd ===
                        editingFixedCostDraft.amountVnd
                      }
                      onClick={() =>
                        setEditingFixedCostDraft((current) =>
                          current
                            ? { ...current, paidAmountVnd: current.amountVnd }
                            : current,
                        )
                      }
                    >
                      <CheckCheck className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Tính vào ngân sách tháng</div>
                  <div className="text-xs text-muted-foreground">
                    Tắt khi khoản này tạm thời không áp dụng.
                  </div>
                </div>
                <Switch
                  checked={editingFixedCostDraft.active}
                  onCheckedChange={(checked) =>
                    setEditingFixedCostDraft((current) =>
                      current ? { ...current, active: checked } : current,
                    )
                  }
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingFixedCostDraft(null)}
                >
                  Huỷ
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const draft = editingFixedCostDraft
                    if (!draft.name.trim()) {
                      toast.error("Vui lòng nhập tên khoản chi.")
                      return
                    }
                    if (draft.amountVnd <= 0) {
                      toast.error("Vui lòng nhập số tiền kế hoạch hợp lệ.")
                      return
                    }
                    updateFixedCost(draft.id, {
                      name: draft.name.trim(),
                      amountVnd: draft.amountVnd,
                      paidAmountVnd: draft.paidAmountVnd,
                      category: draft.category,
                      active: draft.active,
                    })
                    toast.success("Đã cập nhật.")
                    setEditingFixedCostDraft(null)
                  }}
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  Lưu thay đổi
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
