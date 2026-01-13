import { useEffect, useMemo, useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { Info } from "lucide-react"
import { CATEGORY_LABELS_VI, BUCKET_LABELS_VI, EXPENSE_CATEGORIES, suggestBucketByCategory } from "@/domain/constants"
import type { BudgetBucket, ExpenseCategory, ISODate } from "@/domain/types"
import DatePicker from "@/components/DatePicker"
import MoneyInput from "@/components/MoneyInput"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
  todayIso,
} from "@/lib/date"
import {
  getExpensesByDate,
  getMonthTotals,
  getMonthToDateTotals,
} from "@/selectors/expenses"
import { useAppStore } from "@/store/useAppStore"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { computeBudgets } from "@/domain/finance/finance"
import {
  evaluateBudgetHealth,
  type BudgetHealthWarning,
} from "@/domain/finance/budgetHealth"
import { computePaceSurplus, computeRecoveryCaps, computeTodayCaps } from "@/domain/finance/dailySafeCap"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import LabelValueRow from "@/components/LabelValueRow"
import {
  getRecentExpenseTemplates,
  loadExpenseTemplates,
  touchExpenseTemplate,
  upsertExpenseTemplate,
  type ExpenseTemplate,
} from "@/storage/templates"
import type { CttmState } from "@/storage/schema"

export default function ExpensesPage() {
  const data = useAppStore((s) => s.data)
  const overspending = useAppStore((s) => s.ui.overspending)
  const addExpense = useAppStore((s) => s.actions.addExpense)
  const updateExpense = useAppStore((s) => s.actions.updateExpense)
  const deleteExpense = useAppStore((s) => s.actions.deleteExpense)

  const [selectedDate, setSelectedDate] = useState<ISODate>(todayIso())
  const [healthWarnings, setHealthWarnings] = useState<BudgetHealthWarning[]>([])
  const [healthDialogOpen, setHealthDialogOpen] = useState(false)
  const [healthWarningsDate, setHealthWarningsDate] = useState<ISODate | null>(null)
  const [lastHealthModalSignature, setLastHealthModalSignature] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ExpenseTemplate[]>(() =>
    loadExpenseTemplates(),
  )

  const recentTemplates = useMemo(
    () => getRecentExpenseTemplates(templates, 6),
    [templates],
  )

  const expensesToday = useMemo(
    () => getExpensesByDate(data, selectedDate),
    [data, selectedDate],
  )

  const dailyTotal = expensesToday.reduce((sum, ex) => sum + ex.amountVnd, 0)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIsoDate(selectedDate, -i))
  const weekTotal = weekDates.reduce(
    (sum, d) => sum + getExpensesByDate(data, d).reduce((s2, ex) => s2 + ex.amountVnd, 0),
    0,
  )
  const month = monthFromIsoDate(selectedDate)
  const dom = dayOfMonthFromIsoDate(selectedDate)
  const dim = daysInMonth(month)
  const monthTotals = getMonthTotals(data, month)
  const monthToDateTotals = useMemo(
    () => getMonthToDateTotals(data, selectedDate),
    [data, selectedDate],
  )

  useEffect(() => {
    if (!healthWarningsDate || healthWarningsDate === selectedDate) return
    setHealthWarnings([])
    setHealthDialogOpen(false)
    setHealthWarningsDate(null)
    setLastHealthModalSignature(null)
  }, [healthWarningsDate, selectedDate])

  useEffect(() => {
    setLastHealthModalSignature(null)
  }, [selectedDate])

  const budgets = computeBudgets({
    incomeVnd: data.settings.monthlyIncomeVnd,
    fixedCostsVnd: monthTotals.fixedCostsTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    rule: data.settings.budgetRule,
    adjustment: data.budgetAdjustmentsByMonth[month] ?? null,
    customSavingsGoalVnd: data.settings.customSavingsGoalVnd,
  })

  const needsSpentTodayVnd = expensesToday.reduce(
    (sum, ex) => sum + (ex.bucket === "needs" ? ex.amountVnd : 0),
    0,
  )
  const wantsSpentTodayVnd = expensesToday.reduce(
    (sum, ex) => sum + (ex.bucket === "wants" ? ex.amountVnd : 0),
    0,
  )

  const todayCaps = computeTodayCaps({
    daysInMonth: dim,
    essentialBaselineMonthlyVnd: budgets.essentialVariableBaselineVnd,
    wantsBudgetMonthlyVnd: budgets.wantsBudgetVnd,
    needsSpentTodayVnd,
    wantsSpentTodayVnd,
  })

  const recoveryCaps = computeRecoveryCaps({
    dayOfMonth: dom,
    daysInMonth: dim,
    plannedMonthlyNeedsVariableVnd: budgets.essentialVariableBaselineVnd,
    plannedMonthlyWantsVnd: budgets.wantsBudgetVnd,
    actualNeedsToDateVnd: monthToDateTotals.variableNeedsToDateVnd,
    actualWantsToDateVnd: monthToDateTotals.variableWantsToDateVnd,
    needsSpentTodayVnd,
    wantsSpentTodayVnd,
  })

  const paceSurplus = computePaceSurplus({
    dayOfMonth: dom,
    daysInMonth: dim,
    plannedMonthlyNeedsVariableVnd: budgets.essentialVariableBaselineVnd,
    plannedMonthlyWantsVnd: budgets.wantsBudgetVnd,
    actualNeedsToDateVnd: monthToDateTotals.variableNeedsToDateVnd,
    actualWantsToDateVnd: monthToDateTotals.variableWantsToDateVnd,
  })

  const formSchema = z.object({
    amountVnd: z.coerce.number().int().positive({ message: "Số tiền phải > 0." }),
    category: z.custom<ExpenseCategory>(),
    bucket: z.custom<BudgetBucket>(),
    note: z.string().max(200).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((v) => v as ISODate),
  })

  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amountVnd: 0,
      category: "Food",
      bucket: "needs",
      note: "",
      date: selectedDate,
    },
  })

  const [editingId, setEditingId] = useState<string | null>(null)

  const editingExpense = editingId ? data.entities.expenses.byId[editingId] : null

  const computeBudgetHealthWarnings = (state: CttmState, date: ISODate) => {
    const month = monthFromIsoDate(date)
    const dom = dayOfMonthFromIsoDate(date)
    const dim = daysInMonth(month)

    const totalsForBudget = getMonthTotals(state, month)
    const adjustment = state.budgetAdjustmentsByMonth[month] ?? null
    const budgets = computeBudgets({
      incomeVnd: state.settings.monthlyIncomeVnd,
      fixedCostsVnd: totalsForBudget.fixedCostsTotal,
      essentialVariableBaselineVnd: state.settings.essentialVariableBaselineVnd,
      rule: state.settings.budgetRule,
      adjustment,
      customSavingsGoalVnd: state.settings.customSavingsGoalVnd,
    })

    const toDate = getMonthToDateTotals(state, date)
    const warnings = evaluateBudgetHealth({
      dayOfMonth: dom,
      daysInMonth: dim,
      monthlyIncomeVnd: budgets.incomeVnd,
      planned: {
        essentialMonthlyVnd: budgets.essentialVariableBaselineVnd,
        wantsMonthlyVnd: budgets.wantsBudgetVnd,
      },
      actualToDate: {
        variableTotalVnd: toDate.variableTotalToDateVnd,
        wantsVnd: toDate.variableWantsToDateVnd,
        essentialSpentVnd: toDate.essentialNeedsToDateVnd,
      },
    })
    return warnings
  }

  const runBudgetHealthChecks = (date: ISODate) => {
    const store = useAppStore.getState()
    const warnings = computeBudgetHealthWarnings(store.data, date)
    const warningSignature = warnings.length
      ? `${date}|${warnings.map((w) => w.type).sort().join("|")}`
      : null

    setHealthWarnings(warnings)
    setHealthWarningsDate(date)

    if (!warningSignature) {
      setHealthDialogOpen(false)
      setLastHealthModalSignature(null)
      return
    }

    if (store.ui.overspending) {
      setHealthDialogOpen(false)
      setLastHealthModalSignature(warningSignature)
      return
    }

    if (warningSignature === lastHealthModalSignature) {
      setHealthDialogOpen(false)
      setLastHealthModalSignature(warningSignature)
      return
    }

    setHealthDialogOpen(true)
    setLastHealthModalSignature(warningSignature)
  }

  const editForm = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: editingExpense
      ? {
          amountVnd: editingExpense.amountVnd,
          category: editingExpense.category,
          bucket: editingExpense.bucket,
          note: editingExpense.note,
          date: editingExpense.date,
        }
      : undefined,
  })

  const applyTemplate = (t: ExpenseTemplate) => {
    form.setValue("amountVnd", t.amount)
    form.setValue("category", t.category)
    form.setValue("bucket", t.bucket === "NEEDS" ? "needs" : "wants")
    form.setValue("note", t.note ?? "")

    setTemplates(touchExpenseTemplate(t.id))
  }

  const handleAddExpense = (
    values: FormValues,
    options?: { saveTemplate?: boolean },
  ) => {
    try {
      addExpense({
        amountVnd: values.amountVnd,
        category: values.category,
        bucket: values.bucket,
        note: values.note ?? "",
        date: values.date,
      })

      if (options?.saveTemplate) {
        const name = values.note?.trim()
          ? `${CATEGORY_LABELS_VI[values.category]} • ${values.note.trim()}`
          : CATEGORY_LABELS_VI[values.category]

        const nextTemplates = upsertExpenseTemplate({
          name,
          amountVnd: values.amountVnd,
          category: values.category,
          bucket: values.bucket,
          note: values.note ?? "",
        })
        setTemplates(nextTemplates)
        toast.success("Đã thêm chi tiêu và lưu mẫu.")
      } else {
        toast.success("Đã thêm chi tiêu.")
      }

      runBudgetHealthChecks(values.date)
      form.reset({
        amountVnd: 0,
        category: values.category,
        bucket: values.bucket,
        note: "",
        date: values.date,
      })
    } catch {
      toast.error("Không thể thêm chi tiêu.")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ghi chi tiêu</h1>
        <p className="text-sm text-muted-foreground">
          Thêm nhanh chi tiêu hằng ngày và chỉnh sửa khi cần.
        </p>
      </div>

      {healthWarnings.length ? (
        <div
          className={cn(
            "rounded-md border p-4",
            healthWarnings.some((w) => w.severity === "danger")
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-medium">Cảnh báo nhịp chi tiêu</div>
              <div className="text-sm text-muted-foreground">
                {healthWarnings.map((w) => w.title).join(" • ")}
              </div>
              <div className="text-xs text-muted-foreground">
                Ghi chú: các cảnh báo này chỉ dùng chi biến đổi (không tính chi phí cố định).
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setHealthDialogOpen(true)}>
                Xem chi tiết
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setHealthWarnings([])
                  setHealthDialogOpen(false)
                  setHealthWarningsDate(null)
                }}
              >
                Ẩn
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Thống kê nhanh</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2">
              <div className="grid gap-2">
                <span className="text-muted-foreground">Ngày chọn</span>
                <DatePicker
                  value={selectedDate}
                  onChange={(v) => {
                    if (!v) return
                    setSelectedDate(v)
                    form.setValue("date", v)
                  }}
                />
              </div>
              <LabelValueRow label="Tổng ngày" value={formatVnd(dailyTotal)} />
              <LabelValueRow label="7 ngày gần nhất" value={formatVnd(weekTotal)} />
              <LabelValueRow
                label="Tháng đến nay (gồm chi phí cố định)"
                value={formatVnd(monthTotals.totalSpent)}
              />
              <Separator />
              <LabelValueRow
                label="Thiết yếu hôm nay còn được chi"
                value={formatVnd(todayCaps.needsRemainingTodayVnd)}
              />
              <LabelValueRow
                label="Mong muốn hôm nay còn được chi"
                value={formatVnd(todayCaps.wantsRemainingTodayVnd)}
              />
              <LabelValueRow
                label="Thiết yếu cap hồi phục hôm nay còn được chi"
                labelTrailing={
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                      >
                        <Info className="h-4 w-4" />
                        <span className="sr-only">Giải thích</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs text-sm">
                      Cap hồi phục điều chỉnh theo nhịp tháng: nếu vượt nhịp thì siết mạnh
                      hơn theo phần còn lại/ngày; nếu thấp hơn nhịp thì nới nhẹ
                      (tối đa +20% so với baseline).
                    </PopoverContent>
                  </Popover>
                }
                value={formatVnd(recoveryCaps.needsRemainingTodayVnd)}
              />
              <LabelValueRow
                label="Mong muốn cap hồi phục hôm nay còn được chi"
                value={formatVnd(recoveryCaps.wantsRemainingTodayVnd)}
              />
              <Separator />
              <LabelValueRow
                label="Thiết yếu dư so với nhịp"
                labelTrailing={
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                      >
                        <Info className="h-4 w-4" />
                        <span className="sr-only">Giải thích</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs text-sm">
                      Dư so với kế hoạch tính đến hôm nay (planned-to-date).
                    </PopoverContent>
                  </Popover>
                }
                value={formatVnd(paceSurplus.needsSurplusToPaceVnd)}
              />
              <LabelValueRow
                label="Mong muốn dư so với nhịp"
                value={formatVnd(paceSurplus.wantsSurplusToPaceVnd)}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Gợi ý: nhập nhanh bằng “Hôm nay chi”, app sẽ cảnh báo khi chi tiêu biến đổi vượt kế hoạch (không tính chi phí cố định).
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-1 xl:col-span-2">
          <CardHeader>
            <CardTitle>Thêm chi tiêu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentTemplates.length ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Mẫu gần đây</div>
                  <div className="text-xs text-muted-foreground">
                    Chạm để điền nhanh
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentTemplates.map((t) => (
                    <Button
                      key={t.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 max-w-full"
                      onClick={() => applyTemplate(t)}
                      title={t.name}
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="ml-2 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatVnd(t.amount)}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => handleAddExpense(values))}
            >
              <div className="grid gap-2">
                <Label>Số tiền (VND)</Label>
                <Controller
                  control={form.control}
                  name="amountVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 35.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                {form.formState.errors.amountVnd ? (
                  <div className="text-xs text-destructive">
                    {form.formState.errors.amountVnd.message}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Danh mục</Label>
                  <Select
                    value={form.watch("category")}
                    onValueChange={(v) => {
                      const category = v as ExpenseCategory
                      form.setValue("category", category)
                      form.setValue("bucket", suggestBucketByCategory(category))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn danh mục" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS_VI[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Bucket</Label>
                  <Select
                    value={form.watch("bucket")}
                    onValueChange={(v) => form.setValue("bucket", v as BudgetBucket)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn bucket" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                      <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Ghi chú</Label>
                <Textarea rows={3} placeholder="Ví dụ: ăn trưa" {...form.register("note")} />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Ngày</Label>
                  <Controller
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <DatePicker
                        value={field.value as unknown as ISODate}
                        onChange={(v) => v && field.onChange(v)}
                      />
                    )}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      const amount = Number(form.getValues("amountVnd"))
                      if (!Number.isFinite(amount) || amount <= 0) {
                        toast.error("Vui lòng nhập số tiền hợp lệ.")
                        return
                      }
                      addExpense({
                        amountVnd: Math.trunc(amount),
                        category: form.getValues("category"),
                        bucket: form.getValues("bucket"),
                        note: "Hôm nay chi",
                        date: selectedDate,
                      })
                      toast.success("Đã ghi “Hôm nay chi”.")
                      runBudgetHealthChecks(selectedDate)
                    }}
                  >
                    Hôm nay chi
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button type="submit">Thêm</Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="whitespace-normal text-xs sm:text-sm"
                  onClick={() => {
                    form.handleSubmit((values) =>
                      handleAddExpense(values, { saveTemplate: true }),
                    )()
                  }}
                >
                  Thêm &amp; Lưu mẫu
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Dialog open={healthDialogOpen} onOpenChange={setHealthDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Phản hồi sau khi thêm chi tiêu</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {overspending ? (
              <div className="rounded-md border bg-muted p-3 text-sm">
                Lưu ý: hiện có cảnh báo MSS. Phần dưới là cảnh báo nhịp chi tiêu theo ngân sách (không tính chi phí cố định).
              </div>
            ) : null}

            {healthWarnings.length === 0 ? (
              <div className="text-muted-foreground">Không có cảnh báo nặng.</div>
            ) : null}

            <div className="grid gap-3">
              {healthWarnings.map((w) => {
                const badgeVariant = w.severity === "danger" ? "destructive" : "outline"
                const badgeLabel = w.severity === "danger" ? "ĐỎ" : "Cảnh báo"

                const rows: Array<{ label: string; key: string; kind: "vnd" | "number" }> =
                  w.type === "PACE_VARIABLE"
                    ? [
                        { label: "Kế hoạch/tháng (E + W)", key: "plannedMonthlyVariableVnd", kind: "vnd" },
                        { label: "Kế hoạch đến hôm nay", key: "plannedToDateVariableVnd", kind: "vnd" },
                        { label: "Thực chi đến hôm nay", key: "actualToDateVariableVnd", kind: "vnd" },
                        { label: "Vượt (overspend)", key: "overspendVnd", kind: "vnd" },
                        { label: "Tolerance", key: "toleranceVnd", kind: "vnd" },
                      ]
                    : w.type === "PACE_WANTS"
                      ? [
                          { label: "W/tháng", key: "plannedMonthlyWantsVnd", kind: "vnd" },
                          { label: "W kế hoạch đến hôm nay", key: "plannedToDateWantsVnd", kind: "vnd" },
                          { label: "W thực chi đến hôm nay", key: "actualToDateWantsVnd", kind: "vnd" },
                          { label: "Vượt (overspend)", key: "overspendVnd", kind: "vnd" },
                          { label: "Tolerance", key: "toleranceVnd", kind: "vnd" },
                        ]
                      : [
                          { label: "E/tháng", key: "essentialMonthlyVnd", kind: "vnd" },
                          { label: "Thiết yếu đã chi", key: "essentialSpentToDateVnd", kind: "vnd" },
                          { label: "E còn lại", key: "remainingEssentialVnd", kind: "vnd" },
                          { label: "Ngày còn lại", key: "remainingDays", kind: "number" },
                          { label: "Cap thiết yếu/ngày (còn lại)", key: "remainingEssentialDailyCapVnd", kind: "vnd" },
                          { label: "Baseline E/ngày", key: "essentialDailyBaselineVnd", kind: "vnd" },
                        ]

                return (
                  <Card
                    key={w.type}
                    className={cn(
                      w.severity === "danger"
                        ? "border-destructive/40"
                        : "border-amber-500/40",
                    )}
                  >
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base">{w.title}</CardTitle>
                        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{w.summary}</div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-md bg-muted p-3 space-y-2">
                        {rows.map((r) => {
                          const value = w.details[r.key] ?? 0
                          const formatted =
                            r.kind === "number"
                              ? new Intl.NumberFormat("vi-VN").format(value)
                              : formatVnd(value)

                          return (
                            <LabelValueRow
                              key={r.key}
                              label={r.label}
                              labelTitle={r.label}
                              value={formatted}
                              valueClassName={cn(
                                r.key === "overspendVnd" &&
                                  value > 0 &&
                                  "text-destructive",
                              )}
                            />
                          )
                        })}
                        <div className="text-xs text-muted-foreground">
                          Kế hoạch đến hôm nay = Kế hoạch/tháng × (ngày / số ngày trong tháng). Không bao gồm chi phí cố định.
                        </div>
                      </div>

                      <Separator />

                      <div>
                        <div className="font-medium">Bạn có thể làm gì tiếp theo</div>
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                          {w.suggestions.slice(0, 3).map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setHealthDialogOpen(false)}>
                Đóng
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Danh sách chi tiêu ({selectedDate})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {expensesToday.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Chưa có chi tiêu nào cho ngày này.
            </div>
          ) : (
            <div className="space-y-2">
              {expensesToday.map((ex) => (
                <div
                  key={ex.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3"
                >
                    <div className="min-w-0">
                      <div className="font-medium">
                        <span className="whitespace-nowrap tabular-nums">
                          {formatVnd(ex.amountVnd)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          • {CATEGORY_LABELS_VI[ex.category]} • {BUCKET_LABELS_VI[ex.bucket]}
                        </span>
                      </div>
                      {ex.note ? (
                        <div className="text-sm text-muted-foreground truncate">
                          {ex.note}
                        </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Dialog open={editingId === ex.id} onOpenChange={(open) => setEditingId(open ? ex.id : null)}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">Sửa</Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Chỉnh sửa chi tiêu</DialogTitle>
                        </DialogHeader>
                        {editingExpense ? (
                          <form
                            className="grid gap-4"
                            onSubmit={editForm.handleSubmit((values) => {
                              updateExpense(ex.id, {
                                amountVnd: values.amountVnd,
                                category: values.category,
                                bucket: values.bucket,
                                note: values.note ?? "",
                                date: values.date,
                              })
                              toast.success("Đã cập nhật.")
                              setEditingId(null)
                            })}
                          >
                            <div className="grid gap-2">
                              <Label>Số tiền (VND)</Label>
                              <Controller
                                control={editForm.control}
                                name="amountVnd"
                                render={({ field }) => (
                                  <MoneyInput
                                    placeholder="Ví dụ: 35.000"
                                    value={Number(field.value) || 0}
                                    onValueChange={field.onChange}
                                  />
                                )}
                              />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="grid gap-2">
                                <Label>Danh mục</Label>
                                <Select
                                  value={editForm.watch("category")}
                                  onValueChange={(v) => {
                                    const category = v as ExpenseCategory
                                    editForm.setValue("category", category)
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Chọn danh mục" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {EXPENSE_CATEGORIES.map((c) => (
                                      <SelectItem key={c} value={c}>
                                        {CATEGORY_LABELS_VI[c]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label>Bucket</Label>
                                <Select
                                  value={editForm.watch("bucket")}
                                  onValueChange={(v) => editForm.setValue("bucket", v as BudgetBucket)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Chọn bucket" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                                    <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="grid gap-2">
                              <Label>Ngày</Label>
                              <Controller
                                control={editForm.control}
                                name="date"
                                render={({ field }) => (
                                  <DatePicker
                                    value={field.value as unknown as ISODate}
                                    onChange={(v) => v && field.onChange(v)}
                                  />
                                )}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label>Ghi chú</Label>
                              <Textarea rows={3} {...editForm.register("note")} />
                            </div>
                            <div className="flex gap-2">
                              <Button type="submit">Lưu</Button>
                              <Button type="button" variant="outline" onClick={() => setEditingId(null)}>Hủy</Button>
                            </div>
                          </form>
                        ) : (
                          <div className={cn("text-sm text-muted-foreground")}>
                            Không tìm thấy dữ liệu.
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        deleteExpense(ex.id)
                        toast.success("Đã xóa.")
                      }}
                    >
                      Xóa
                    </Button>
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
