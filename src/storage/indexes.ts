import type { BudgetBucket, Expense, ExpenseCategory } from "@/domain/types"
import type { EntityTable, ExpenseIndexes } from "@/storage/schema"
import { createEmptyExpenseIndexes } from "@/storage/schema"

function monthFromDate(date: string) {
  return date.slice(0, 7)
}

function keyCategoryMonth(month: string, category: ExpenseCategory) {
  return `${month}|${category}`
}

function keyBucketMonth(month: string, bucket: BudgetBucket) {
  return `${month}|${bucket}`
}

function addIdToIndex(
  index: Record<string, string[]>,
  key: string,
  id: string,
): Record<string, string[]> {
  const current = index[key]
  if (current?.includes(id)) return index
  return { ...index, [key]: current ? [...current, id] : [id] }
}

function removeIdFromIndex(
  index: Record<string, string[]>,
  key: string,
  id: string,
): Record<string, string[]> {
  const current = index[key]
  if (!current) return index
  if (!current.includes(id)) return index
  const next = current.filter((x) => x !== id)
  if (next.length === 0) {
    const { [key]: _removed, ...rest } = index
    return rest
  }
  return { ...index, [key]: next }
}

export function addExpenseToIndexes(
  indexes: ExpenseIndexes,
  expense: Expense,
): ExpenseIndexes {
  const month = monthFromDate(expense.date)
  return {
    ...indexes,
    expensesByDate: addIdToIndex(indexes.expensesByDate, expense.date, expense.id),
    expensesByMonth: addIdToIndex(indexes.expensesByMonth, month, expense.id),
    expensesByCategoryMonth: addIdToIndex(
      indexes.expensesByCategoryMonth,
      keyCategoryMonth(month, expense.category),
      expense.id,
    ),
    expensesByBucketMonth: addIdToIndex(
      indexes.expensesByBucketMonth,
      keyBucketMonth(month, expense.bucket),
      expense.id,
    ),
  }
}

export function removeExpenseFromIndexes(
  indexes: ExpenseIndexes,
  expense: Expense,
): ExpenseIndexes {
  const month = monthFromDate(expense.date)
  return {
    ...indexes,
    expensesByDate: removeIdFromIndex(
      indexes.expensesByDate,
      expense.date,
      expense.id,
    ),
    expensesByMonth: removeIdFromIndex(indexes.expensesByMonth, month, expense.id),
    expensesByCategoryMonth: removeIdFromIndex(
      indexes.expensesByCategoryMonth,
      keyCategoryMonth(month, expense.category),
      expense.id,
    ),
    expensesByBucketMonth: removeIdFromIndex(
      indexes.expensesByBucketMonth,
      keyBucketMonth(month, expense.bucket),
      expense.id,
    ),
  }
}

export function updateExpenseInIndexes(
  indexes: ExpenseIndexes,
  before: Expense,
  after: Expense,
): ExpenseIndexes {
  if (
    before.date === after.date &&
    before.category === after.category &&
    before.bucket === after.bucket
  ) {
    return indexes
  }
  return addExpenseToIndexes(removeExpenseFromIndexes(indexes, before), after)
}

export function rebuildExpenseIndexesFromEntities(
  expenses: EntityTable<Expense>,
): ExpenseIndexes {
  const indexes = createEmptyExpenseIndexes()
  for (const id of expenses.allIds) {
    const expense = expenses.byId[id]
    if (!expense) continue
    const month = monthFromDate(expense.date)

    ;(indexes.expensesByDate[expense.date] ??= []).push(expense.id)
    ;(indexes.expensesByMonth[month] ??= []).push(expense.id)
    ;(
      indexes.expensesByCategoryMonth[keyCategoryMonth(month, expense.category)] ??=
        []
    ).push(expense.id)
    ;(
      indexes.expensesByBucketMonth[keyBucketMonth(month, expense.bucket)] ??= []
    ).push(expense.id)
  }
  return indexes
}

export function normalizeIndexes(indexes: ExpenseIndexes): ExpenseIndexes {
  const out = createEmptyExpenseIndexes()
  const parts: (keyof ExpenseIndexes)[] = [
    "expensesByDate",
    "expensesByMonth",
    "expensesByCategoryMonth",
    "expensesByBucketMonth",
  ]

  for (const part of parts) {
    const source = indexes[part] as Record<string, string[]>
    for (const [key, ids] of Object.entries(source)) {
      const unique = Array.from(new Set(ids))
      if (unique.length > 0) (out[part] as Record<string, string[]>)[key] = unique
    }
  }
  return out
}

