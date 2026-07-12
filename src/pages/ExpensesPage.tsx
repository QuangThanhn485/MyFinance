import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { CalendarClock, ChartColumn, ListChecks, PlusSquare } from "lucide-react"
import { BUCKET_LABELS_VI, getExpenseCategoryLabel, suggestBucketByCategory } from "@/domain/constants"
import type { BudgetBucket, Expense, ExpenseCategory, ISODate } from "@/domain/types"
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
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
  isMonthLocked,
} from "@/domain/finance/monthLock"
import {
  evaluateBudgetHealth,
  type BudgetHealthWarning,
  type BudgetHealthWarningType,
} from "@/domain/finance/budgetHealth"
import {
  computeRemainingDailySpendingCap,
  resolveEffectiveDailyTotalCapVnd,
} from "@/domain/finance/dailySafeCap"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import LabelValueRow from "@/components/LabelValueRow"
import {
  getAllExpenseTemplatesSorted,
  loadExpenseTemplates,
  saveExpenseTemplates,
  touchExpenseTemplate,
  updateExpenseTemplate,
  upsertExpenseTemplate,
  type ExpenseTemplate,
} from "@/storage/templates"
import { getMonthDayContext } from "@/storage/dayLock"
import type { CttmState } from "@/storage/schema"
import CollapsibleCard from "@/components/expenses/CollapsibleCard"
import QuickTemplateList from "@/components/expenses/QuickTemplateList"
import QuickTemplateEditorDrawer, { type QuickTemplateFormValues } from "@/components/expenses/QuickTemplateEditorDrawer"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const STATS_COLLAPSED_KEY = "expenses.panel.stats.collapsed"
const ADD_COLLAPSED_KEY = "expenses.panel.add.collapsed"
const LIST_COLLAPSED_KEY = "expenses.panel.list.collapsed"
const WARNING_POPUP_MEMORY_KEY = "expenses.warning.popup.memory.v2"

type WarningPopupMemoryEntry = {
  date: ISODate
  severity: BudgetHealthWarning["severity"]
  score: number
}

type WarningPopupMemory = Record<string, WarningPopupMemoryEntry>

function loadWarningPopupMemory(): WarningPopupMemory {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(WARNING_POPUP_MEMORY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const next: WarningPopupMemory = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const item = value as Partial<WarningPopupMemoryEntry>
      if (typeof item.date !== "string") continue
      if (item.severity !== "warning" && item.severity !== "danger") continue
      if (typeof item.score !== "number" || !Number.isFinite(item.score)) continue
      next[key] = {
        date: item.date as ISODate,
        severity: item.severity,
        score: Math.max(0, Math.round(item.score)),
      }
    }
    return next
  } catch {
    return {}
  }
}

function saveWarningPopupMemory(memory: WarningPopupMemory) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(WARNING_POPUP_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // ignore
  }
}

function warningMemoryKey(month: string, type: BudgetHealthWarningType) {
  return `${month}:${type}`
}

function warningSeverityRank(severity: BudgetHealthWarning["severity"]) {
  return severity === "danger" ? 2 : 1
}

function warningScore(warning: BudgetHealthWarning) {
  return Math.max(0, Math.round(warning.details.overspendVnd ?? 0))
}

function warningDeltaThreshold(warning: BudgetHealthWarning) {
  // Chỉ coi là "xấu đi rõ rệt" khi phần vượt tăng thêm ít nhất bằng ngưỡng vật chất của nhóm
  // (tối thiểu 100k), để tránh popup lặp lại mỗi lần thêm chi tiêu.
  return Math.max(100_000, Math.round(warning.details.thresholdVnd ?? 0))
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function readCollapsedState(key: string, fallback = false) {
  if (typeof localStorage === "undefined") return fallback
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return fallback
  }
}

function usePersistentCollapsedState(key: string, fallback = false) {
  const [value, setValue] = useState(() => readCollapsedState(key, fallback))

  useEffect(() => {
    if (typeof localStorage === "undefined") return
    try {
      localStorage.setItem(key, value ? "1" : "0")
    } catch {
      // ignore
    }
  }, [key, value])

  return [value, setValue] as const
}

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
  const [warningPopupMemory, setWarningPopupMemory] = useState<WarningPopupMemory>(
    () => loadWarningPopupMemory(),
  )
  const warningPopupMemoryRef = useRef<WarningPopupMemory>(warningPopupMemory)
  const [lastAppliedTemplateId, setLastAppliedTemplateId] = useState<string | null>(
    null,
  )
  const [templates, setTemplates] = useState<ExpenseTemplate[]>(() =>
    loadExpenseTemplates(),
  )
  // Số lượng mỗi mẫu muốn thêm trong lần này (id -> số lượng). > 0 nghĩa là đang chọn.
  const [templateQuantities, setTemplateQuantities] = useState<Record<string, number>>({})
  const [templateEditor, setTemplateEditor] = useState<
    | { mode: "create" }
    | { mode: "edit"; templateId: string }
    | null
  >(null)
  const [addExpenseDialogOpen, setAddExpenseDialogOpen] = useState(false)
  const [bulkDeleteTemplatesOpen, setBulkDeleteTemplatesOpen] = useState(false)
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null)
  const [highlightExpenseId, setHighlightExpenseId] = useState<string | null>(null)
  const today = todayIso()
  const selectedDateIsToday = selectedDate === today

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

  const [statsCollapsed, setStatsCollapsed] = usePersistentCollapsedState(
    STATS_COLLAPSED_KEY,
    false,
  )
  const [addCollapsed, setAddCollapsed] = usePersistentCollapsedState(
    ADD_COLLAPSED_KEY,
    false,
  )
  const [listCollapsed, setListCollapsed] = usePersistentCollapsedState(
    LIST_COLLAPSED_KEY,
    false,
  )

  useEffect(() => {
    warningPopupMemoryRef.current = warningPopupMemory
    saveWarningPopupMemory(warningPopupMemory)
  }, [warningPopupMemory])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window === "undefined" ? true : window.innerWidth >= 1024,
  )
  const [pageHeight, setPageHeight] = useState<number | null>(null)

  const sortedTemplates = useMemo(
    () => getAllExpenseTemplatesSorted(templates, categoryLabels),
    [categoryLabels, templates],
  )

  useEffect(() => {
    setTemplateQuantities((prev) => {
      const ids = Object.keys(prev)
      if (ids.length === 0) return prev
      const valid = new Set(sortedTemplates.map((template) => template.id))
      let changed = false
      const next: Record<string, number> = {}
      for (const id of ids) {
        if (valid.has(id) && prev[id] > 0) next[id] = prev[id]
        else changed = true
      }
      return changed ? next : prev
    })
  }, [sortedTemplates])

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
  const dayContext = getMonthDayContext(data, selectedDate)
  const currentMonth = monthFromIsoDate(today)
  const selectedMonthPast = month < currentMonth
  const selectedMonthLocked = isMonthLocked(data, month)
  const selectedDateReadOnly = selectedMonthLocked

  // Các chỉ số cấp-THÁNG (cap/ngày, ngân sách còn lại, ngày đã trôi qua) phản
  // ánh VỊ TRÍ HIỆN TẠI trong tháng được chọn — KHÔNG phụ thuộc ngày đang xem/nhập:
  //  - Tháng hiện tại: tính theo HÔM NAY.
  //  - Tháng đã qua: coi như đã hết tháng (0 ngày còn lại, đã trôi qua hết tháng).
  //  - Tháng tương lai: chưa bắt đầu (còn nguyên tháng).
  // Ngày còn lại vẫn tự động loại các ngày đã phát sinh chi tiêu (thay cho "khoá ngày").
  const isSelectedCurrentMonth = month === currentMonth
  const todayContext = getMonthDayContext(data, today)
  const remainingDaysInMonth = isSelectedCurrentMonth
    ? todayContext.remainingDaysInMonth
    : selectedMonthPast
      ? 0
      : dayContext.daysInMonth
  const monthRefHasExpenseToday = isSelectedCurrentMonth && todayContext.dateHasExpense
  const monthTotals = getMonthTotals(data, month)

  useEffect(() => {
    if (!healthWarningsDate || healthWarningsDate === selectedDate) return
    setHealthWarnings([])
    setHealthDialogOpen(false)
    setHealthWarningsDate(null)
  }, [healthWarningsDate, selectedDate])

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useLayoutEffect(() => {
    const recalc = () => {
      if (!rootRef.current || !isDesktop) {
        setPageHeight(null)
        return
      }
      const rect = rootRef.current.getBoundingClientRect()
      const height = window.innerHeight - rect.top - 8
      setPageHeight(Math.max(520, Math.floor(height)))
    }

    recalc()
    window.addEventListener("resize", recalc)
    return () => window.removeEventListener("resize", recalc)
  }, [isDesktop])

  useEffect(() => {
    if (!highlightExpenseId) return
    const timer = window.setTimeout(() => setHighlightExpenseId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlightExpenseId])

  const settingsForMonth = useMemo(() => getEffectiveSettingsForMonth(data, month), [data, month])
  const adjustment = useMemo(() => getEffectiveBudgetAdjustmentForMonth(data, month), [data, month])
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
    fixedCostsVnd: monthTotals.fixedCostsTotal,
    essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
    rule: settingsForMonth.budgetRule,
    adjustment,
    customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
  })

  const caps = getEffectiveCapsForMonth(data, month)
  const remainingDailyCap = computeRemainingDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: budgets.savingsTargetVnd,
    totalSpentVnd: monthTotals.totalSpent,
    remainingDaysInMonth,
  })
  const shownDailyTotalCapVnd = resolveEffectiveDailyTotalCapVnd({
    computedDailyTotalCapVnd: remainingDailyCap.dailyTotalCapVnd,
    appliedDailyTotalCapVnd: caps?.dailyTotalCapVnd,
  })
  // Thanh "Còn lại ngân sách tháng" dùng base là ngân sách biến đổi có thể chi:
  // 100% = Thiết yếu (E) + Mong muốn (W), không gồm phí cố định. Phần sáng của
  // Progress là phần đã chi; số tiền bên phải vẫn là phần còn lại.
  const monthlyVariableBudgetVnd =
    budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd
  const monthlyVariableRemainingVnd =
    monthlyVariableBudgetVnd - monthTotals.variableTotal
  const budgetProgressRemainingVnd = Math.max(0, monthlyVariableRemainingVnd)
  const budgetSpentPct =
    monthlyVariableBudgetVnd > 0
      ? clampPct((monthTotals.variableTotal / monthlyVariableBudgetVnd) * 100)
      : 0
  const budgetRemainingPct =
    monthlyVariableBudgetVnd > 0
      ? clampPct((budgetProgressRemainingVnd / monthlyVariableBudgetVnd) * 100)
      : 0
  // Thanh "Ngày đã trôi qua trong tháng" = tổng ngày − số ngày còn lại (theo nghiệp vụ). Vì ngày
  // đã có chi tiêu bị loại khỏi "ngày còn lại", nên khi hôm nay phát sinh chi tiêu thì ngày còn
  // lại giảm 1 và ngày đã trôi qua tăng 1 tương ứng.
  const daysElapsedInMonth = Math.max(0, dayContext.daysInMonth - remainingDaysInMonth)
  const daysElapsedPct = Math.max(
    0,
    Math.min(100, (daysElapsedInMonth / dayContext.daysInMonth) * 100),
  )
  // Cap đang tính cho ngày kế tiếp (không phải hôm nay) khi hôm nay đã phát sinh chi tiêu.
  const capForNextDay = monthRefHasExpenseToday && remainingDaysInMonth > 0

  const selectedDateToDateTotals = getMonthToDateTotals(data, selectedDate)
  const selectedDaySpentBeforeDateVnd =
    monthTotals.fixedCostsTotal +
    Math.max(0, selectedDateToDateTotals.variableTotalToDateVnd - dailyTotal)
  const selectedDayDailyCap = computeRemainingDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: budgets.savingsTargetVnd,
    totalSpentVnd: selectedDaySpentBeforeDateVnd,
    remainingDaysInMonth: Math.max(1, dayContext.daysInMonth - dayContext.dayOfMonth + 1),
  })
  const shownSelectedDayCapVnd = resolveEffectiveDailyTotalCapVnd({
    computedDailyTotalCapVnd: selectedDayDailyCap.dailyTotalCapVnd,
    appliedDailyTotalCapVnd: caps?.dailyTotalCapVnd,
  })
  const selectedDayRemainingVnd = shownSelectedDayCapVnd - dailyTotal
  const selectedDayRemainingPct =
    shownSelectedDayCapVnd > 0
      ? clampPct((Math.max(0, selectedDayRemainingVnd) / shownSelectedDayCapVnd) * 100)
      : 0
  const selectedDayUsedPct =
    shownSelectedDayCapVnd > 0
      ? clampPct((dailyTotal / shownSelectedDayCapVnd) * 100)
      : dailyTotal > 0
        ? 100
        : 0
  const dailyAllowanceTitle = selectedDateIsToday
    ? "Còn được chi hôm nay"
    : "Còn được chi ngày này"
  const dailyAllowanceWarning =
    budgets.incomeVnd <= 0
      ? "Chưa thiết lập thu nhập để tính hạn mức."
      : shownSelectedDayCapVnd <= 0 && selectedDayRemainingVnd <= 0
        ? "Không còn hạn mức khả dụng cho ngày này."
        : selectedDayRemainingVnd < 0
          ? `Vượt hạn mức ngày ${formatVnd(Math.abs(selectedDayRemainingVnd))}.`
          : null

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
      category: defaultCategory,
      bucket: suggestBucketByCategory(defaultCategory, categoryOptions),
      note: "",
      date: selectedDate,
    },
  })

  useEffect(() => {
    form.setValue("date", selectedDate)
  }, [form, selectedDate])

  useEffect(() => {
    const current = form.getValues("category")
    if (categoryOptions.some((category) => category.id === current)) return
    form.setValue("category", defaultCategory)
    form.setValue("bucket", suggestBucketByCategory(defaultCategory, categoryOptions))
  }, [categoryOptions, defaultCategory, form])

  useEffect(() => {
    if (!addExpenseDialogOpen) return
    const timer = window.setTimeout(() => form.setFocus("amountVnd"), 24)
    return () => window.clearTimeout(timer)
  }, [addExpenseDialogOpen, form])

  const formDate = form.watch("date") as unknown as ISODate
  const formDateMonth = monthFromIsoDate(formDate)
  const formMonthLocked = isMonthLocked(data, formDateMonth)
  const formDateReadOnly = formMonthLocked

  const [editingId, setEditingId] = useState<string | null>(null)

  const editingExpense = editingId ? data.entities.expenses.byId[editingId] : null

  const computeBudgetHealthWarnings = (state: CttmState, date: ISODate) => {
    const dayContext = getMonthDayContext(state, date)
    const month = dayContext.month
    const dom = dayContext.dayOfMonth
    const dim = dayContext.daysInMonth

    const totalsForBudget = getMonthTotals(state, month)
    const settingsForMonth = getEffectiveSettingsForMonth(state, month)
    const adjustment = getEffectiveBudgetAdjustmentForMonth(state, month)
    const budgets = computeBudgets({
      incomeVnd: getMonthlyIncomeTotalVnd(settingsForMonth),
      fixedCostsVnd: totalsForBudget.fixedCostsTotal,
      essentialVariableBaselineVnd: settingsForMonth.essentialVariableBaselineVnd,
      rule: settingsForMonth.budgetRule,
      adjustment,
      customSavingsGoalVnd: settingsForMonth.customSavingsGoalVnd,
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

  const runBudgetHealthChecks = (
    date: ISODate,
    baselineWarnings?: BudgetHealthWarning[],
  ) => {
    const store = useAppStore.getState()
    const warnings = computeBudgetHealthWarnings(store.data, date)
    const month = monthFromIsoDate(date)
    const popupMemory = warningPopupMemoryRef.current

    setHealthWarningsDate(date)

    if (warnings.length === 0) {
      setHealthWarnings([])
      setHealthDialogOpen(false)
      setWarningPopupMemory((prev) => {
        const prefix = `${month}:`
        const next: WarningPopupMemory = { ...prev }
        let changed = false
        for (const key of Object.keys(next)) {
          if (!key.startsWith(prefix)) continue
          delete next[key]
          changed = true
        }
        if (changed) {
          warningPopupMemoryRef.current = next
          return next
        }
        return prev
      })
      return
    }

    if (store.ui.overspending) {
      setHealthDialogOpen(false)
      return
    }

    const baselineByTypeFull = new Map(
      (baselineWarnings ?? []).map((w) => [w.type, w] as const),
    )
    const activeTypeSet = new Set(warnings.map((w) => w.type))
    const triggeredTypes = new Set<BudgetHealthWarningType>()

    warnings.forEach((warning) => {
      const baseline = baselineByTypeFull.get(warning.type)
      const currentSeverity = warningSeverityRank(warning.severity)
      const baselineSeverity = baseline ? warningSeverityRank(baseline.severity) : 0
      const currentScore = warningScore(warning)
      const baselineScore = baseline ? warningScore(baseline) : 0
      const grewFromThisAction = currentScore - baselineScore
      const deltaThreshold = warningDeltaThreshold(warning)

      const becameWorseNow =
        !baseline ||
        currentSeverity > baselineSeverity ||
        grewFromThisAction >= deltaThreshold

      if (!becameWorseNow) return

      const memory = popupMemory[warningMemoryKey(month, warning.type)]
      if (!memory) {
        triggeredTypes.add(warning.type)
        return
      }

      if (currentSeverity > warningSeverityRank(memory.severity)) {
        triggeredTypes.add(warning.type)
        return
      }

      const rearmThreshold = Math.max(
        deltaThreshold,
        Math.round(Math.max(memory.score, baselineScore) * 0.15),
      )
      if (currentScore >= memory.score + rearmThreshold) {
        triggeredTypes.add(warning.type)
      }
    })

    const hasNewWarning = triggeredTypes.size > 0
    // Chỉ hiện banner + tự bật popup khi lần thêm này làm cảnh báo XẤU ĐI RÕ RỆT. Nếu không có
    // gì mới/nặng hơn thì im lặng, tránh cảnh báo lặp lại mỗi lần nhập chi tiêu.
    if (hasNewWarning) {
      setHealthWarnings(warnings)
      setHealthDialogOpen(true)
    }

    setWarningPopupMemory((prev) => {
      const next: WarningPopupMemory = { ...prev }
      const prefix = `${month}:`
      let changed = false

      for (const key of Object.keys(next)) {
        if (!key.startsWith(prefix)) continue
        const type = key.slice(prefix.length) as BudgetHealthWarningType
        if (!activeTypeSet.has(type)) {
          delete next[key]
          changed = true
        }
      }

      if (hasNewWarning) {
        warnings.forEach((warning) => {
          if (!triggeredTypes.has(warning.type)) return
          const key = warningMemoryKey(month, warning.type)
          const nextValue: WarningPopupMemoryEntry = {
            date,
            severity: warning.severity,
            score: warningScore(warning),
          }
          const prevValue = next[key]
          if (
            !prevValue ||
            prevValue.date !== nextValue.date ||
            prevValue.severity !== nextValue.severity ||
            prevValue.score !== nextValue.score
          ) {
            next[key] = nextValue
            changed = true
          }
        })
      }

      if (changed) {
        warningPopupMemoryRef.current = next
        return next
      }
      return prev
    })
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

  const editingTemplate = useMemo(() => {
    if (!templateEditor || templateEditor.mode !== "edit") return null
    return templates.find((template) => template.id === templateEditor.templateId) ?? null
  }, [templateEditor, templates])

  const scrollToExpense = (expenseId: string, behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const row = listScrollRef.current?.querySelector<HTMLElement>(
        `[data-expense-id="${expenseId}"]`,
      )
      if (!row) return
      row.scrollIntoView({ block: "nearest", behavior })
    })
  }

  const applyTemplate = (template: ExpenseTemplate) => {
    form.setValue("amountVnd", template.amount)
    form.setValue("category", template.category)
    form.setValue("bucket", template.bucket === "NEEDS" ? "needs" : "wants")
    form.setValue("note", template.note ?? "")
    setLastAppliedTemplateId(template.id)
    form.setFocus("amountVnd")
  }

  const addExpenseFromTemplate = (template: ExpenseTemplate) => {
    const storeData = useAppStore.getState().data
    const targetMonth = monthFromIsoDate(selectedDate)
    if (isMonthLocked(storeData, targetMonth)) {
      toast.error(`Tháng ${targetMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`)
      return
    }
    const baseline = computeBudgetHealthWarnings(storeData, selectedDate)
    const templateNote = template.note?.trim() ? template.note : template.name
    const newId = addExpense({
      amountVnd: template.amount,
      category: template.category,
      bucket: template.bucket === "NEEDS" ? "needs" : "wants",
      note: templateNote,
      date: selectedDate,
    })

    setTemplates(touchExpenseTemplate(template.id))
    setHighlightExpenseId(newId)
    scrollToExpense(newId)
    runBudgetHealthChecks(selectedDate, baseline)
    toast.success(`Đã thêm nhanh: ${template.name}.`)
  }

  const addSelectedTemplates = () => {
    const picked = Object.entries(templateQuantities)
      .map(([id, qty]) => ({
        template: sortedTemplates.find((template) => template.id === id),
        qty: Math.max(0, Math.trunc(qty)),
      }))
      .filter(
        (item): item is { template: ExpenseTemplate; qty: number } =>
          !!item.template && item.qty > 0,
      )
    if (picked.length === 0) return

    const storeData = useAppStore.getState().data
    const targetMonth = monthFromIsoDate(selectedDate)
    if (isMonthLocked(storeData, targetMonth)) {
      toast.error(`Tháng ${targetMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`)
      return
    }

    const baseline = computeBudgetHealthWarnings(storeData, selectedDate)
    const addedIds: string[] = []

    picked.forEach(({ template, qty }) => {
      const templateNote = template.note?.trim() ? template.note : template.name
      for (let i = 0; i < qty; i += 1) {
        const id = addExpense({
          amountVnd: template.amount,
          category: template.category,
          bucket: template.bucket === "NEEDS" ? "needs" : "wants",
          note: templateNote,
          date: selectedDate,
        })
        addedIds.push(id)
      }
    })

    let nextTemplates = templates
    picked.forEach(({ template }) => {
      nextTemplates = touchExpenseTemplate(template.id)
    })
    setTemplates(nextTemplates)
    setTemplateQuantities({})

    const lastId = addedIds[addedIds.length - 1]
    if (lastId) {
      setHighlightExpenseId(lastId)
      scrollToExpense(lastId)
    }

    runBudgetHealthChecks(selectedDate, baseline)
    toast.success(`Đã thêm ${addedIds.length} khoản chi vào danh sách.`)
  }

  const saveTemplateFromFormValues = (values: FormValues) => {
    const label = categoryLabel(values.category)
    const name = values.note?.trim()
      ? `${label} • ${values.note.trim()}`
      : label

    const nextTemplates = upsertExpenseTemplate({
      name,
      amountVnd: values.amountVnd,
      category: values.category,
      bucket: values.bucket,
      note: values.note ?? "",
    })
    setTemplates(nextTemplates)
    return nextTemplates
  }

  const handleAddExpense = (
    values: FormValues,
    options?: { saveTemplate?: boolean; closeDialog?: boolean },
  ) => {
    try {
      const storeData = useAppStore.getState().data
      const targetMonth = monthFromIsoDate(values.date)
      if (isMonthLocked(storeData, targetMonth)) {
        toast.error(`Tháng ${targetMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`)
        return
      }
      const baseline = computeBudgetHealthWarnings(
        storeData,
        values.date,
      )
      const newId = addExpense({
        amountVnd: values.amountVnd,
        category: values.category,
        bucket: values.bucket,
        note: values.note ?? "",
        date: values.date,
      })

      if (options?.saveTemplate) {
        saveTemplateFromFormValues(values)
        toast.success("Đã thêm chi tiêu và lưu mẫu.")
      } else {
        toast.success("Đã thêm chi tiêu.")
      }

      if (!options?.saveTemplate && lastAppliedTemplateId) {
        setTemplates(touchExpenseTemplate(lastAppliedTemplateId))
      }
      setLastAppliedTemplateId(null)

      setHighlightExpenseId(newId)
      scrollToExpense(newId)

      runBudgetHealthChecks(values.date, baseline)
      form.reset({
        amountVnd: 0,
        category: values.category,
        bucket: values.bucket,
        note: "",
        date: values.date,
      })
      if (options?.closeDialog) {
        setAddExpenseDialogOpen(false)
      } else {
        form.setFocus("amountVnd")
      }
    } catch {
      toast.error("Không thể thêm chi tiêu.")
    }
  }

  const handleSaveTemplateOnly = (values: FormValues) => {
    try {
      saveTemplateFromFormValues(values)
      setLastAppliedTemplateId(null)
      toast.success("Đã lưu mẫu.")
    } catch {
      toast.error("Không thể lưu mẫu.")
    }
  }

  const handleTemplateSave = (values: QuickTemplateFormValues) => {
    if (!templateEditor) return

    if (templateEditor.mode === "edit") {
      const nextTemplates = updateExpenseTemplate(templateEditor.templateId, {
        name: values.name,
        amount: values.amountVnd,
        category: values.category,
        bucket: values.bucket,
        note: values.note,
      })
      setTemplates(nextTemplates)
      setTemplateEditor(null)
      toast.success("Đã cập nhật item thêm nhanh.")
      return
    }

    const nextTemplates = upsertExpenseTemplate({
      name: values.name,
      amountVnd: values.amountVnd,
      category: values.category,
      bucket: values.bucket === "NEEDS" ? "needs" : "wants",
      note: values.note,
    })
    setTemplates(nextTemplates)
    setTemplateEditor(null)
    toast.success("Đã tạo item thêm nhanh.")
  }

  const handleBulkDeleteTemplates = () => {
    const pickedIds = new Set(
      Object.entries(templateQuantities)
        .filter(([, qty]) => qty > 0)
        .map(([id]) => id),
    )
    if (pickedIds.size === 0) return
    const count = pickedIds.size
    const nextTemplates = templates.filter((template) => !pickedIds.has(template.id))
    saveExpenseTemplates(nextTemplates)
    setTemplates(nextTemplates)
    setTemplateQuantities({})
    setBulkDeleteTemplatesOpen(false)
    toast.success(`Đã xóa ${count} item thêm nhanh.`)
  }

  // Xóa chi tiêu: ngày HÔM NAY xóa ngay không hỏi; ngày trong quá khứ vẫn hỏi xác nhận để tránh
  // xóa nhầm dữ liệu cũ.
  const requestDeleteExpense = (expense: Expense) => {
    const storeData = useAppStore.getState().data
    const expenseMonth = monthFromIsoDate(expense.date)
    if (isMonthLocked(storeData, expenseMonth)) {
      toast.error(`Tháng ${expenseMonth} đã chốt báo cáo nên không thể xóa.`)
      return
    }
    if (expense.date === today) {
      deleteExpense(expense.id)
      toast.success("Đã xóa.")
      return
    }
    setDeleteExpenseId(expense.id)
  }

  const handleDeleteExpenseConfirmed = () => {
    if (!deleteExpenseId) return
    const expense = data.entities.expenses.byId[deleteExpenseId]
    if (!expense) {
      setDeleteExpenseId(null)
      return
    }

    const expenseMonth = monthFromIsoDate(expense.date)
    const storeData = useAppStore.getState().data
    if (isMonthLocked(storeData, expenseMonth)) {
      toast.error(`Tháng ${expenseMonth} đã chốt báo cáo nên không thể xóa.`)
      setDeleteExpenseId(null)
      return
    }
    deleteExpense(deleteExpenseId)
    setDeleteExpenseId(null)
    toast.success("Đã xóa.")
  }

  const panelStyle = (collapsed: boolean, weight: number) => {
    if (!isDesktop) return undefined
    if (collapsed) {
      return {
        flex: "0 0 72px",
        minWidth: "72px",
        transition: "flex-basis 200ms ease, min-width 200ms ease",
      }
    }
    return {
      flex: `${weight} 1 0%`,
      minWidth: "0",
      transition: "flex-basis 200ms ease, min-width 200ms ease",
    }
  }

  return (
    <div
      ref={rootRef}
      style={pageHeight ? { height: pageHeight } : undefined}
      className="flex flex-col gap-2 sm:gap-3 lg:overflow-hidden"
    >
      <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Ghi chi tiêu</h1>
          <p className="hidden text-xs text-muted-foreground sm:block sm:text-sm">
            Chọn ngày, thêm khoản mới hoặc dùng mẫu nhanh.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="min-w-[170px] flex-1 sm:w-[200px] sm:flex-none">
            <DatePicker
              value={selectedDate}
              onChange={(value) => value && setSelectedDate(value)}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedDate(today)}>
            Hôm nay
          </Button>
        </div>
      </div>

      {healthWarnings.length ? (
        <div
          className={cn(
            "rounded-md border p-3",
            healthWarnings.some((w) => w.severity === "danger")
              ? "border-destructive/40 bg-destructive/5"
              : "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="font-medium">Cảnh báo ngân sách</div>
              <div className="text-xs text-muted-foreground sm:text-sm">
                {healthWarnings.map((w) => w.title).join(" • ")}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setHealthDialogOpen(true)}>
                Xem chi tiết
              </Button>
              <Button
                size="sm"
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

      <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        <div className="flex flex-col gap-2 sm:gap-3 lg:h-full lg:flex-row">
          <div
            style={panelStyle(statsCollapsed, 0.9)}
            className="order-3 min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-3"
          >
            <CollapsibleCard
              title="Thống kê nhanh"
              icon={<ChartColumn className="h-4 w-4" />}
              collapsed={statsCollapsed}
              onToggle={() => setStatsCollapsed((prev) => !prev)}
              summary={`${selectedDateIsToday ? "Hôm nay" : "Ngày này"}: ${formatVnd(dailyTotal)}`}
              contentClassName="lg:h-full lg:min-h-0"
            >
              <div className="space-y-3 text-sm lg:h-full lg:overflow-y-auto lg:pr-1">
                {/* Nhịp chi gần đây */}
                <div className="space-y-1.5">
                  <LabelValueRow label="Chi ngày này" value={formatVnd(dailyTotal)} />
                  <LabelValueRow label="7 ngày gần nhất" value={formatVnd(weekTotal)} />
                  <LabelValueRow
                    label="Tháng đến nay (gồm cố định)"
                    value={formatVnd(monthTotals.totalSpent)}
                  />
                </div>

                <div
                  className={cn(
                    "expenses-water-card p-3",
                    selectedDayRemainingVnd < 0 && "expenses-water-card-danger",
                  )}
                  // Mực nước = phần hạn mức đã dùng: càng chi, nước càng dâng.
                  style={{ "--water-level": `${selectedDayUsedPct}%` } as CSSProperties}
                  role="progressbar"
                  aria-label={dailyAllowanceTitle}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(selectedDayUsedPct)}
                  aria-valuetext={`Đã dùng ${selectedDayUsedPct.toFixed(0)}%, còn lại ${selectedDayRemainingPct.toFixed(0)}%`}
                >
                  <div className="expenses-water-body" aria-hidden />
                  <div className="expenses-water-surface" aria-hidden>
                    <span className="expenses-water-wave expenses-water-wave-back" />
                    <span className="expenses-water-wave expenses-water-wave-front" />
                  </div>
                  <div className="expenses-water-content">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground/80">{dailyAllowanceTitle}</div>
                        <div
                          className={cn(
                            "mt-0.5 break-words text-lg font-semibold tabular-nums text-foreground",
                            selectedDayRemainingVnd < 0
                              ? "text-destructive"
                              : "text-cyan-800 dark:text-cyan-200",
                          )}
                        >
                          {formatVnd(selectedDayRemainingVnd)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-medium text-foreground/75">
                      <span className="min-w-0 truncate">Hạn mức {formatVnd(shownSelectedDayCapVnd)}</span>
                      <span className="min-w-0 truncate text-right">{selectedDayUsedPct.toFixed(0)}%</span>
                    </div>
                    {dailyAllowanceWarning ? (
                      <div className="mt-1 text-[11px] font-medium text-destructive">
                        {dailyAllowanceWarning}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Còn lại ngân sách tháng = phần E + W chưa dùng; không tính phí cố định. */}
                <div className="space-y-1.5">
                  <LabelValueRow
                    label="Còn lại ngân sách tháng"
                    value={formatVnd(monthlyVariableRemainingVnd)}
                    valueClassName={cn(monthlyVariableRemainingVnd < 0 && "text-destructive")}
                  />
                  <Progress
                    value={budgetSpentPct}
                    aria-label="Còn lại ngân sách tháng"
                    aria-valuetext={`Đã chi ${budgetSpentPct.toFixed(0)}%, còn lại ${budgetRemainingPct.toFixed(0)}% ngân sách tháng`}
                  />
                </div>

                {/* Ngày đã trôi qua trong tháng — đối chiếu với ngân sách còn lại ở trên. */}
                <div className="space-y-1.5">
                  <LabelValueRow
                    label="Ngày đã trôi qua trong tháng"
                    value={`${daysElapsedInMonth}/${dayContext.daysInMonth} ngày`}
                  />
                  <Progress value={daysElapsedPct} />
                </div>

                {capForNextDay ? (
                  <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Cap chi mỗi ngày
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Cho ngày kế tiếp
                      </span>
                    </div>
                    <div
                      className={cn(
                        "break-words text-xl font-semibold tabular-nums text-amber-700 sm:text-2xl dark:text-amber-400",
                        shownDailyTotalCapVnd <= 0 && "text-destructive",
                      )}
                    >
                      {formatVnd(shownDailyTotalCapVnd)}
                    </div>
                  </div>
                ) : null}
              </div>
            </CollapsibleCard>
          </div>

          <div
            style={panelStyle(addCollapsed, 1.3)}
            className="order-1 min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-1"
          >
            <CollapsibleCard
              title="Thêm chi tiêu"
              icon={<PlusSquare className="h-4 w-4" />}
              collapsed={addCollapsed}
              onToggle={() => setAddCollapsed((prev) => !prev)}
              summary={`${sortedTemplates.length} item thêm nhanh`}
              className="border-primary/30 bg-primary/5 lg:border-border lg:bg-card"
              contentClassName="lg:h-full lg:min-h-0"
              headerActions={
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
                    onClick={() => setTemplateEditor({ mode: "create" })}
                  >
                    <span className="sm:hidden">Mẫu</span>
                    <span className="hidden sm:inline">Thêm mẫu</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
                    disabled={selectedDateReadOnly}
                    title={
                      selectedMonthLocked
                        ? `Tháng ${selectedDate.slice(0, 7)} đã chốt báo cáo nên không thể thêm chi tiêu.`
                        : undefined
                    }
                    onClick={() => {
                      form.reset({
                        amountVnd: 0,
                        category: defaultCategory,
                        bucket: suggestBucketByCategory(defaultCategory, categoryOptions),
                        note: "",
                        date: selectedDate,
                      })
                      setAddExpenseDialogOpen(true)
                    }}
                  >
                    Thêm
                  </Button>
                </div>
              }
            >
              <div className="lg:h-full lg:min-h-0">
                <QuickTemplateList
                  templates={sortedTemplates}
                  categories={categoryOptions}
                  categoryLabels={categoryLabels}
                  quantities={templateQuantities}
                  onQuantityChange={(id, quantity) => {
                    setTemplateQuantities((prev) => {
                      const next = { ...prev }
                      const clamped = Math.max(0, Math.min(99, Math.trunc(quantity)))
                      if (clamped > 0) next[id] = clamped
                      else delete next[id]
                      return next
                    })
                  }}
                  onToggleSelectAllVisible={(checked, visibleTemplates) => {
                    setTemplateQuantities((prev) => {
                      const next = { ...prev }
                      visibleTemplates.forEach((template) => {
                        if (checked) {
                          if (!(next[template.id] > 0)) next[template.id] = 1
                        } else {
                          delete next[template.id]
                        }
                      })
                      return next
                    })
                  }}
                  onBulkAddSelected={addSelectedTemplates}
                  onBulkDelete={() => setBulkDeleteTemplatesOpen(true)}
                  onQuickAdd={addExpenseFromTemplate}
                  onEdit={(template) => setTemplateEditor({ mode: "edit", templateId: template.id })}
                  showCreateButton={false}
                />
              </div>
            </CollapsibleCard>
          </div>

          <div
            style={panelStyle(listCollapsed, 1.1)}
            className="order-2 min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-2"
          >
            <CollapsibleCard
              title="Danh sách chi tiêu"
              icon={<ListChecks className="h-4 w-4" />}
              collapsed={listCollapsed}
              onToggle={() => setListCollapsed((prev) => !prev)}
              summary={`${expensesToday.length} item • ${formatVnd(dailyTotal)}`}
              contentClassName="lg:h-full lg:min-h-0"
              headerActions={
                selectedMonthLocked ? (
                  <Badge variant="outline">Đã chốt tháng</Badge>
                ) : null
              }
            >
              <div className="flex flex-col lg:h-full lg:min-h-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-2">
                  <span className="truncate text-sm text-muted-foreground">Ngày {selectedDate}</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{formatVnd(dailyTotal)}</span>
                </div>
                <div ref={listScrollRef} className="space-y-2 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                  {expensesToday.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Chưa có chi tiêu nào cho ngày này.
                    </div>
                  ) : (
                    expensesToday.map((expense) => {
                      const expenseMonth = monthFromIsoDate(expense.date)
                      const expenseMonthLocked = isMonthLocked(data, expenseMonth)
                      const expenseReadOnly = expenseMonthLocked

                      return (
                        <div
                          key={expense.id}
                          data-expense-id={expense.id}
                          className={cn(
                            "rounded-md border p-3",
                            highlightExpenseId === expense.id && "border-primary/40 bg-primary/5 ring-1 ring-primary/20",
                          )}
                        >
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                            <div className="min-w-0">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                                <span className="truncate text-sm text-muted-foreground" title={expense.note || "Không có ghi chú"}>
                                  {expense.note || "Không có ghi chú"}
                                </span>
                                <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                                  {formatVnd(expense.amountVnd)}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {categoryLabel(expense.category)} • {BUCKET_LABELS_VI[expense.bucket]}
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1 sm:flex-nowrap">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={expenseReadOnly}
                                title={
                                  expenseMonthLocked
                                    ? `Tháng ${expenseMonth} đã chốt báo cáo nên không thể sửa.`
                                    : undefined
                                }
                                onClick={() => setEditingId(expense.id)}
                              >
                                Sửa
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={expenseReadOnly}
                                title={
                                  expenseMonthLocked
                                    ? `Tháng ${expenseMonth} đã chốt báo cáo nên không thể xóa.`
                                    : undefined
                                }
                                onClick={() => requestDeleteExpense(expense)}
                              >
                                Xóa
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </CollapsibleCard>
          </div>
        </div>
      </div>

      <Dialog open={addExpenseDialogOpen} onOpenChange={setAddExpenseDialogOpen}>
        <DialogContent className="bottom-0 left-0 right-0 top-auto max-h-[92dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl border-x-0 border-b-0 p-4 sm:left-[50%] sm:top-[50%] sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-6">
          <DialogHeader>
            <DialogTitle>Thêm chi tiêu</DialogTitle>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) =>
              handleAddExpense(values, { closeDialog: true }),
            )}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              const target = event.target as HTMLElement
              if (target.tagName === "TEXTAREA") return
              event.preventDefault()
              if (event.ctrlKey || event.metaKey) {
                form.handleSubmit((values) =>
                  handleAddExpense(values, { saveTemplate: true, closeDialog: true }),
                )()
                return
              }
              form.handleSubmit((values) =>
                handleAddExpense(values, { closeDialog: true }),
              )()
            }}
          >
            <div className="grid gap-2 sm:grid-cols-3">
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
                      showSteppers
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <Label>Danh mục</Label>
                <Select
                  value={form.watch("category")}
                  onValueChange={(v) => {
                    const category = v as ExpenseCategory
                    form.setValue("category", category)
                    form.setValue("bucket", suggestBucketByCategory(category, categoryOptions))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn danh mục" />
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

            {form.formState.errors.amountVnd ? (
              <div className="text-xs text-destructive">
                {form.formState.errors.amountVnd.message}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <div className="grid gap-2">
                <Label>Ghi chú</Label>
                <Textarea rows={3} placeholder="Ví dụ: ăn trưa" {...form.register("note")} />
              </div>
              <div className="grid gap-2">
                <Label>Ngày</Label>
                <Controller
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <DatePicker
                      value={field.value as unknown as ISODate}
                      onChange={(v) => {
                        if (!v) return
                        field.onChange(v)
                        setSelectedDate(v)
                      }}
                    />
                  )}
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1 [&>button]:w-full sm:[&>button]:w-auto">
              <Button type="button" variant="outline" onClick={() => setAddExpenseDialogOpen(false)}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => form.handleSubmit(handleSaveTemplateOnly)()}
              >
                Lưu mẫu
              </Button>
              <Button
                type="submit"
                disabled={formDateReadOnly}
                title={
                  formMonthLocked
                    ? `Tháng ${formDateMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`
                    : undefined
                }
              >
                Thêm
              </Button>
              <Button
                type="button"
                disabled={formDateReadOnly}
                title={
                  formMonthLocked
                    ? `Tháng ${formDateMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`
                    : undefined
                }
                onClick={() =>
                  form.handleSubmit((values) =>
                    handleAddExpense(values, { saveTemplate: true, closeDialog: true }),
                  )()
                }
              >
                Lưu mẫu và thêm
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <QuickTemplateEditorDrawer
        open={templateEditor !== null}
        mode={templateEditor?.mode ?? "create"}
        template={editingTemplate}
        categories={categoryOptions}
        onOpenChange={(open) => {
          if (!open) setTemplateEditor(null)
        }}
        onSave={handleTemplateSave}
      />

      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa chi tiêu</DialogTitle>
          </DialogHeader>
          {editingExpense ? (
            <form
              className="grid gap-4"
              onSubmit={editForm.handleSubmit((values) => {
                const storeData = useAppStore.getState().data
                const originalMonth = monthFromIsoDate(editingExpense.date)
                const nextMonth = monthFromIsoDate(values.date)
                if (isMonthLocked(storeData, originalMonth) || isMonthLocked(storeData, nextMonth)) {
                  toast.error(
                    `Tháng đã chốt báo cáo (${isMonthLocked(storeData, originalMonth) ? originalMonth : nextMonth}) nên không thể cập nhật.`,
                  )
                  return
                }

                updateExpense(editingExpense.id, {
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
                      showSteppers
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
                      editForm.setValue("bucket", suggestBucketByCategory(category, categoryOptions))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn danh mục" />
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
              <div className="flex flex-wrap justify-end gap-2 [&>button]:w-full sm:[&>button]:w-auto">
                <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                  Hủy
                </Button>
                <Button type="submit">Lưu</Button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-muted-foreground">Không tìm thấy dữ liệu.</div>
          )}
        </DialogContent>
      </Dialog>

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

            <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
              Popup chỉ tự bật khi lần thêm này làm cảnh báo <span className="text-foreground font-medium">xấu đi rõ rệt</span>{" "}
              (mới vượt ngưỡng, tăng cấp độ, hoặc vượt sâu hơn đáng kể). Cảnh báo cũ từ
              các ngày trước sẽ giữ ở banner để theo dõi, tránh lặp popup liên tục.
            </div>

            {healthWarnings.length === 0 ? (
              <div className="text-muted-foreground">Không có cảnh báo nặng.</div>
            ) : null}

            <div className="grid gap-3">
              {healthWarnings.map((w) => {
                const badgeVariant = w.severity === "danger" ? "destructive" : "outline"
                const badgeLabel = w.severity === "danger" ? "ĐỎ" : "Cảnh báo"

                const rows: Array<{ label: string; key: string; kind: "vnd" | "number" }> =
                  w.type === "PACE_WANTS"
                    ? [
                        { label: "Ngân sách 'Mong muốn'/tháng", key: "wantsBudgetVnd", kind: "vnd" },
                        { label: "Đã chi đến nay", key: "wantsSpentToDateVnd", kind: "vnd" },
                        { label: "Dự báo cuối tháng", key: "projectedWantsVnd", kind: "vnd" },
                        { label: "Vượt ngân sách", key: "overspendVnd", kind: "vnd" },
                      ]
                    : [
                        { label: "Định mức 'Thiết yếu'/tháng", key: "essentialBaselineVnd", kind: "vnd" },
                        { label: "Đã chi đến nay", key: "essentialSpentToDateVnd", kind: "vnd" },
                        { label: "Dự báo cuối tháng", key: "projectedEssentialVnd", kind: "vnd" },
                        { label: "Vượt định mức", key: "overspendVnd", kind: "vnd" },
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

            <div className="flex flex-wrap justify-end gap-2 pt-1 [&>button]:w-full sm:[&>button]:w-auto">
              <Button variant="outline" onClick={() => setHealthDialogOpen(false)}>
                Đóng
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteTemplatesOpen} onOpenChange={setBulkDeleteTemplatesOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa item thêm nhanh</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn sắp xóa {Object.values(templateQuantities).filter((q) => q > 0).length} item đã chọn. Các khoản chi đã ghi sẽ không bị ảnh hưởng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDeleteTemplates}
            >
              Xóa ({Object.values(templateQuantities).filter((q) => q > 0).length})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteExpenseId !== null} onOpenChange={(open) => !open && setDeleteExpenseId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa chi tiêu này?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này sẽ xóa bản ghi chi tiêu khỏi danh sách trong ngày.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteExpenseConfirmed}
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
