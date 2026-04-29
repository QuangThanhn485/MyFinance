import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { ChartColumn, ListChecks, Lock, LockOpen, PlusSquare } from "lucide-react"
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
import {
  getDayLockMonthContext,
  isDayLocked,
  loadDayLockMemory,
  saveDayLockMemory,
  setDayLocked,
  type DayLockMemory,
} from "@/storage/dayLock"
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
  if (warning.type === "PACE_VARIABLE" || warning.type === "PACE_WANTS") {
    return Math.max(0, Math.round(warning.details.overspendVnd ?? 0))
  }
  if (warning.type === "ESSENTIAL_SAFETY_CAP") {
    const dailyBaseline = Math.max(0, Math.round(warning.details.essentialDailyBaselineVnd ?? 0))
    const dailyCap = Math.max(0, Math.round(warning.details.remainingEssentialDailyCapVnd ?? 0))
    return Math.max(0, dailyBaseline - dailyCap)
  }
  return 0
}

function warningDeltaThreshold(warning: BudgetHealthWarning) {
  if (warning.type === "ESSENTIAL_SAFETY_CAP") {
    const dailyBaseline = Math.max(0, Math.round(warning.details.essentialDailyBaselineVnd ?? 0))
    return Math.max(20_000, Math.round(dailyBaseline * 0.2))
  }
  const tolerance = Math.max(0, Math.round(warning.details.toleranceVnd ?? 0))
  return Math.max(30_000, tolerance)
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
  const [dayLockMemory, setDayLockMemory] = useState<DayLockMemory>(() =>
    loadDayLockMemory(),
  )
  const warningPopupMemoryRef = useRef<WarningPopupMemory>(warningPopupMemory)
  const [lastAppliedTemplateId, setLastAppliedTemplateId] = useState<string | null>(
    null,
  )
  const [templates, setTemplates] = useState<ExpenseTemplate[]>(() =>
    loadExpenseTemplates(),
  )
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [templateEditor, setTemplateEditor] = useState<
    | { mode: "create" }
    | { mode: "edit"; templateId: string }
    | null
  >(null)
  const [addExpenseDialogOpen, setAddExpenseDialogOpen] = useState(false)
  const [bulkDeleteTemplatesOpen, setBulkDeleteTemplatesOpen] = useState(false)
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null)
  const [highlightExpenseId, setHighlightExpenseId] = useState<string | null>(null)

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

  useEffect(() => {
    saveDayLockMemory(dayLockMemory)
  }, [dayLockMemory])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window === "undefined" ? true : window.innerWidth >= 1024,
  )
  const [pageHeight, setPageHeight] = useState<number | null>(null)

  const sortedTemplates = useMemo(
    () => getAllExpenseTemplatesSorted(templates),
    [templates],
  )

  useEffect(() => {
    setSelectedTemplateIds((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(sortedTemplates.map((template) => template.id))
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
      })
      return next
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
  const dayContext = getDayLockMonthContext(selectedDate, dayLockMemory)
  const dom = dayContext.dayOfMonth
  const dim = dayContext.daysInMonth
  const currentMonth = monthFromIsoDate(todayIso())
  const selectedMonthPast = month < currentMonth
  const selectedMonthLocked = isMonthLocked(data, month)
  const selectedDateLocked = !selectedMonthPast && dayContext.locked
  const showDayLockActions = !selectedMonthPast && !selectedMonthLocked
  const selectedDateReadOnly = selectedMonthLocked || selectedDateLocked
  const remainingDaysInMonth = selectedDateLocked
    ? dayContext.remainingDaysInMonth
    : Math.max(0, dim - dom + 1)
  const capLabelSuffix = selectedDateLocked ? "ngày kế tiếp" : "hôm nay"
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
  const essentialRemainingVnd = budgets.essentialVariableBaselineVnd - monthTotals.variableNeeds
  const wantsRemainingVnd = budgets.wantsBudgetVnd - monthTotals.variableWants

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

  useEffect(() => {
    form.setValue("date", selectedDate)
  }, [form, selectedDate])

  useEffect(() => {
    if (!addExpenseDialogOpen) return
    const timer = window.setTimeout(() => form.setFocus("amountVnd"), 24)
    return () => window.clearTimeout(timer)
  }, [addExpenseDialogOpen, form])

  const formDate = form.watch("date") as unknown as ISODate
  const formDateMonth = monthFromIsoDate(formDate)
  const formMonthLocked = isMonthLocked(data, formDateMonth)
  const formDateLocked = isDayLocked(formDate, dayLockMemory)
  const formDateReadOnly = formMonthLocked || formDateLocked

  const [editingId, setEditingId] = useState<string | null>(null)

  const editingExpense = editingId ? data.entities.expenses.byId[editingId] : null

  const computeBudgetHealthWarnings = (state: CttmState, date: ISODate) => {
    const dayContext = getDayLockMonthContext(date, dayLockMemory)
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

    setHealthWarnings(warnings)
    setHealthWarningsDate(date)

    if (warnings.length === 0) {
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
    setHealthDialogOpen(hasNewWarning)

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
    if (isDayLocked(selectedDate, dayLockMemory)) {
      toast.error(`Ngày ${selectedDate} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`)
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
    if (selectedTemplateIds.size === 0) return

    const storeData = useAppStore.getState().data
    const targetMonth = monthFromIsoDate(selectedDate)
    if (isMonthLocked(storeData, targetMonth)) {
      toast.error(`Tháng ${targetMonth} đã chốt báo cáo nên không thể thêm chi tiêu.`)
      return
    }
    if (isDayLocked(selectedDate, dayLockMemory)) {
      toast.error(`Ngày ${selectedDate} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`)
      return
    }

    const selectedTemplates = sortedTemplates.filter((template) =>
      selectedTemplateIds.has(template.id),
    )
    if (selectedTemplates.length === 0) return

    const baseline = computeBudgetHealthWarnings(storeData, selectedDate)
    const addedIds: string[] = []

    selectedTemplates.forEach((template) => {
      const templateNote = template.note?.trim() ? template.note : template.name
      const id = addExpense({
        amountVnd: template.amount,
        category: template.category,
        bucket: template.bucket === "NEEDS" ? "needs" : "wants",
        note: templateNote,
        date: selectedDate,
      })
      addedIds.push(id)
    })

    let nextTemplates = templates
    selectedTemplates.forEach((template) => {
      nextTemplates = touchExpenseTemplate(template.id)
    })
    setTemplates(nextTemplates)

    const lastId = addedIds[addedIds.length - 1]
    if (lastId) {
      setHighlightExpenseId(lastId)
      scrollToExpense(lastId)
    }

    runBudgetHealthChecks(selectedDate, baseline)
    toast.success(`Đã thêm ${selectedTemplates.length} item vào danh sách chi tiêu.`)
  }

  const saveTemplateFromFormValues = (values: FormValues) => {
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
      if (isDayLocked(values.date, dayLockMemory)) {
        toast.error(`Ngày ${values.date} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`)
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
    if (selectedTemplateIds.size === 0) return
    const count = selectedTemplateIds.size
    const nextTemplates = templates.filter((template) => !selectedTemplateIds.has(template.id))
    saveExpenseTemplates(nextTemplates)
    setTemplates(nextTemplates)
    setSelectedTemplateIds(new Set())
    setBulkDeleteTemplatesOpen(false)
    toast.success(`Đã xóa ${count} item thêm nhanh.`)
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
    if (isDayLocked(expense.date, dayLockMemory)) {
      toast.error(`Ngày ${expense.date} đã khoá. Mở khoá để xóa dữ liệu.`)
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
      className="flex flex-col gap-3 overflow-hidden"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Ghi chi tiêu</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Bố cục một màn hình: thống kê, thêm chi tiêu và danh sách trong ngày.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[170px] sm:w-[200px]">
            <DatePicker
              value={selectedDate}
              onChange={(value) => value && setSelectedDate(value)}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedDate(todayIso())}>
            Hôm nay
          </Button>
          {showDayLockActions ? (
            <>
              <Button
                type="button"
                variant={selectedDateLocked ? "secondary" : "outline"}
                size="sm"
                disabled={selectedDateLocked}
                onClick={() =>
                  setDayLockMemory((prev) =>
                    setDayLocked({ date: selectedDate, locked: true, memory: prev }),
                  )
                }
              >
                <Lock className="mr-1.5 h-4 w-4" />
                Khoá
              </Button>
              <Button
                type="button"
                variant={selectedDateLocked ? "default" : "outline"}
                size="sm"
                disabled={!selectedDateLocked}
                onClick={() =>
                  setDayLockMemory((prev) =>
                    setDayLocked({ date: selectedDate, locked: false, memory: prev }),
                  )
                }
              >
                <LockOpen className="mr-1.5 h-4 w-4" />
                Mở khoá
              </Button>
            </>
          ) : null}
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
              <div className="font-medium">Cảnh báo nhịp chi tiêu</div>
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

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full flex flex-col gap-3 lg:flex-row">
          <div
            style={panelStyle(statsCollapsed, 0.9)}
            className="min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-3"
          >
            <CollapsibleCard
              title="Thống kê nhanh"
              icon={<ChartColumn className="h-4 w-4" />}
              collapsed={statsCollapsed}
              onToggle={() => setStatsCollapsed((prev) => !prev)}
              summary={`Hôm nay: ${formatVnd(dailyTotal)}`}
              contentClassName="h-full min-h-0"
            >
              <div className="h-full overflow-y-auto pr-1 text-sm space-y-2">
                {selectedDateLocked ? (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground">
                    {remainingDaysInMonth > 0 ? (
                      <>
                        Ngày {selectedDate} đã khoá. Các cap bên dưới đang tính theo{" "}
                        <span className="font-medium text-foreground">ngày kế tiếp</span>.
                      </>
                    ) : (
                      <>
                        Ngày {selectedDate} đã khoá và không còn ngày nào trong tháng này.
                      </>
                    )}
                  </div>
                ) : null}
                <LabelValueRow label="Tổng ngày" value={formatVnd(dailyTotal)} />
                <LabelValueRow label="7 ngày gần nhất" value={formatVnd(weekTotal)} />
                <LabelValueRow
                  label="Tháng đến nay (gồm cố định)"
                  value={formatVnd(monthTotals.totalSpent)}
                />
                <Separator />
                <LabelValueRow
                  label="Còn được chi để giữ tiết kiệm"
                  value={formatVnd(remainingDailyCap.totalRemainingVnd)}
                  valueClassName={cn(remainingDailyCap.totalRemainingVnd < 0 && "text-destructive")}
                />
                <LabelValueRow
                  label="Ngày còn lại trong tháng"
                  value={new Intl.NumberFormat("vi-VN").format(remainingDaysInMonth)}
                />
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        Cap tổng {capLabelSuffix}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Ngân sách chi còn lại / số ngày còn lại
                      </div>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-lg font-semibold tabular-nums",
                        shownDailyTotalCapVnd <= 0 && "text-destructive",
                      )}
                    >
                      {formatVnd(shownDailyTotalCapVnd)}
                    </div>
                  </div>
                </div>
                <Separator />
                <LabelValueRow
                  label="Thiết yếu còn trong tháng"
                  value={formatVnd(essentialRemainingVnd)}
                  valueClassName={cn(essentialRemainingVnd < 0 && "text-destructive")}
                />
                <LabelValueRow
                  label="Mong muốn còn trong tháng"
                  value={formatVnd(wantsRemainingVnd)}
                  valueClassName={cn(wantsRemainingVnd < 0 && "text-destructive")}
                />
              </div>
            </CollapsibleCard>
          </div>

          <div
            style={panelStyle(addCollapsed, 1.3)}
            className="min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-1"
          >
            <CollapsibleCard
              title="Thêm chi tiêu"
              icon={<PlusSquare className="h-4 w-4" />}
              collapsed={addCollapsed}
              onToggle={() => setAddCollapsed((prev) => !prev)}
              summary={`${sortedTemplates.length} item thêm nhanh`}
              contentClassName="h-full min-h-0"
              headerActions={
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setTemplateEditor({ mode: "create" })}
                  >
                    Thêm mẫu
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedDateReadOnly}
                    title={
                      selectedMonthLocked
                        ? `Tháng ${selectedDate.slice(0, 7)} đã chốt báo cáo nên không thể thêm chi tiêu.`
                        : selectedDateLocked
                          ? `Ngày ${selectedDate} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`
                          : undefined
                    }
                    onClick={() => {
                      form.reset({
                        amountVnd: 0,
                        category: "Food",
                        bucket: "needs",
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
              <div className="h-full min-h-0">
                <QuickTemplateList
                  templates={sortedTemplates}
                  selectedIds={selectedTemplateIds}
                  onToggleSelect={(id, checked) => {
                    setSelectedTemplateIds((prev) => {
                      const next = new Set(prev)
                      if (checked) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }}
                  onToggleSelectAllVisible={(checked, visibleTemplates) => {
                    setSelectedTemplateIds((prev) => {
                      const next = new Set(prev)
                      if (checked) visibleTemplates.forEach((template) => next.add(template.id))
                      else visibleTemplates.forEach((template) => next.delete(template.id))
                      return next
                    })
                  }}
                  onClearSelection={() => setSelectedTemplateIds(new Set())}
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
            className="min-h-0 transition-[flex-basis,min-width,max-width] duration-200 ease-out lg:order-2"
          >
            <CollapsibleCard
              title="Danh sách chi tiêu"
              icon={<ListChecks className="h-4 w-4" />}
              collapsed={listCollapsed}
              onToggle={() => setListCollapsed((prev) => !prev)}
              summary={`${expensesToday.length} item • ${formatVnd(dailyTotal)}`}
              contentClassName="h-full min-h-0"
              headerActions={
                selectedMonthLocked ? (
                  <Badge variant="outline">Đã chốt tháng</Badge>
                ) : selectedDateLocked ? (
                  <Badge variant="secondary">Đã khoá ngày</Badge>
                ) : null
              }
            >
              <div className="h-full min-h-0 flex flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-2">
                  <span className="truncate text-sm text-muted-foreground">Ngày {selectedDate}</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{formatVnd(dailyTotal)}</span>
                </div>
                <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
                  {expensesToday.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Chưa có chi tiêu nào cho ngày này.
                    </div>
                  ) : (
                    expensesToday.map((expense) => {
                      const expenseMonth = monthFromIsoDate(expense.date)
                      const expenseMonthLocked = isMonthLocked(data, expenseMonth)
                      const expenseDateLocked = isDayLocked(expense.date, dayLockMemory)
                      const expenseReadOnly = expenseMonthLocked || expenseDateLocked

                      return (
                        <div
                          key={expense.id}
                          data-expense-id={expense.id}
                          className={cn(
                            "rounded-md border p-3",
                            highlightExpenseId === expense.id && "border-primary/40 bg-primary/5 ring-1 ring-primary/20",
                          )}
                        >
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
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
                                {CATEGORY_LABELS_VI[expense.category]} • {BUCKET_LABELS_VI[expense.bucket]}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={expenseReadOnly}
                                title={
                                  expenseMonthLocked
                                    ? `Tháng ${expenseMonth} đã chốt báo cáo nên không thể sửa.`
                                    : expenseDateLocked
                                      ? `Ngày ${expense.date} đã khoá. Mở khoá để sửa dữ liệu.`
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
                                    : expenseDateLocked
                                      ? `Ngày ${expense.date} đã khoá. Mở khoá để xóa dữ liệu.`
                                      : undefined
                                }
                                onClick={() => setDeleteExpenseId(expense.id)}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                    form.setValue("bucket", suggestBucketByCategory(category))
                  }}
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

            <div className="flex flex-wrap justify-end gap-2 pt-1">
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
                    : formDateLocked
                      ? `Ngày ${formDate} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`
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
                    : formDateLocked
                      ? `Ngày ${formDate} đã khoá. Mở khoá để thêm hoặc sửa dữ liệu.`
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
                const originalDateLocked = isDayLocked(editingExpense.date, dayLockMemory)
                const nextDateLocked = isDayLocked(values.date, dayLockMemory)

                if (isMonthLocked(storeData, originalMonth) || isMonthLocked(storeData, nextMonth)) {
                  toast.error(
                    `Tháng đã chốt báo cáo (${isMonthLocked(storeData, originalMonth) ? originalMonth : nextMonth}) nên không thể cập nhật.`,
                  )
                  return
                }
                if (originalDateLocked || nextDateLocked) {
                  toast.error(
                    `Ngày đã khoá (${originalDateLocked ? editingExpense.date : values.date}). Mở khoá để cập nhật dữ liệu.`,
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
                    onValueChange={(v) => editForm.setValue("category", v as ExpenseCategory)}
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
              <div className="flex justify-end gap-2">
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

      <AlertDialog open={bulkDeleteTemplatesOpen} onOpenChange={setBulkDeleteTemplatesOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa item thêm nhanh</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn sắp xóa {selectedTemplateIds.size} item đã chọn. Các khoản chi đã ghi sẽ không bị ảnh hưởng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDeleteTemplates}
            >
              Xóa ({selectedTemplateIds.size})
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
