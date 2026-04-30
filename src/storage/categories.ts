import {
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS,
  getExpenseCategoryLabel,
  suggestBucketByCategory,
} from "@/domain/constants"
import type {
  BudgetBucket,
  ExpenseCategory,
  ExpenseCategoryConfig,
} from "@/domain/types"
import type { CttmState } from "@/storage/schema"
import type { ExpenseTemplate } from "@/storage/templates"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function normalizeBucket(value: unknown): BudgetBucket {
  return value === "wants" ? "wants" : "needs"
}

function normalizeLabel(value: unknown, fallback: string) {
  const label = typeof value === "string" ? value.trim() : ""
  return label ? label.slice(0, 60) : fallback
}

export function createDefaultExpenseCategories(nowIso: string): ExpenseCategoryConfig[] {
  return DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
}

export function normalizeExpenseCategoryList(
  raw: unknown,
  fallbackNow: string,
): ExpenseCategoryConfig[] {
  const byId = new Map<string, ExpenseCategoryConfig>()
  const defaultById = new Map(
    createDefaultExpenseCategories(fallbackNow).map((category) => [category.id, category]),
  )

  if (!Array.isArray(raw)) return [...defaultById.values()]

  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = coerceString(item.id, "").trim()
    if (!id) continue

    const existing = defaultById.get(id)
    const label = normalizeLabel(item.label, existing?.label ?? id)
    const defaultBucket = normalizeBucket(item.defaultBucket)
    const createdAt = coerceString(item.createdAt, existing?.createdAt ?? fallbackNow)
    const updatedAt = coerceString(item.updatedAt, existing?.updatedAt ?? createdAt)

    byId.set(id, {
      id,
      label,
      defaultBucket,
      system: typeof item.system === "boolean" ? item.system : existing?.system,
      createdAt,
      updatedAt,
    })
  }

  return [...byId.values()]
}

export function makeExpenseCategoryId(label: string, existingIds: Iterable<string>) {
  const existing = new Set(existingIds)
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  const base = `custom_${slug || "danh_muc"}`
  let candidate = base
  let i = 2
  while (existing.has(candidate)) {
    candidate = `${base}_${i}`
    i += 1
  }
  return candidate
}

export function ensureCategoriesForState(state: CttmState): CttmState {
  const now = new Date().toISOString()
  const byId = new Map<string, ExpenseCategoryConfig>()
  for (const category of normalizeExpenseCategoryList(state.expenseCategories, now)) {
    byId.set(category.id, category)
  }

  const used = new Set<ExpenseCategory>()
  for (const id of state.entities.expenses.allIds) {
    const expense = state.entities.expenses.byId[id]
    if (expense?.category) used.add(expense.category)
  }
  for (const id of state.entities.fixedCosts.allIds) {
    const fixedCost = state.entities.fixedCosts.byId[id]
    if (fixedCost?.category) used.add(fixedCost.category)
  }

  for (const category of used) {
    if (byId.has(category)) continue
    byId.set(category, {
      id: category,
      label: getExpenseCategoryLabel(category, [...byId.values()]),
      defaultBucket: suggestBucketByCategory(category, [...byId.values()]),
      system: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  return { ...state, expenseCategories: [...byId.values()] }
}

export function getExpenseCategoryUsageCounts(
  state: CttmState,
  templates: ExpenseTemplate[] = [],
) {
  const counts: Record<
    string,
    { expenses: number; fixedCosts: number; templates: number; total: number }
  > = {}

  const ensure = (category: ExpenseCategory) => {
    counts[category] ??= { expenses: 0, fixedCosts: 0, templates: 0, total: 0 }
    return counts[category]
  }

  for (const id of state.entities.expenses.allIds) {
    const expense = state.entities.expenses.byId[id]
    if (!expense?.category) continue
    ensure(expense.category).expenses += 1
  }

  for (const id of state.entities.fixedCosts.allIds) {
    const fixedCost = state.entities.fixedCosts.byId[id]
    if (!fixedCost?.category) continue
    ensure(fixedCost.category).fixedCosts += 1
  }

  for (const template of templates) {
    if (!template.category) continue
    ensure(template.category).templates += 1
  }

  for (const item of Object.values(counts)) {
    item.total = item.expenses + item.fixedCosts + item.templates
  }

  return counts
}
