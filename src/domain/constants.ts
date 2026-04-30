import type { BudgetBucket, ExpenseCategory, ExpenseCategoryConfig } from "@/domain/types"

export const DEFAULT_EXPENSE_CATEGORY_DEFINITIONS: Array<
  Pick<ExpenseCategoryConfig, "id" | "label" | "defaultBucket" | "system">
> = [
  { id: "Food", label: "Ăn uống", defaultBucket: "needs", system: true },
  { id: "Transport", label: "Di chuyển", defaultBucket: "needs", system: true },
  { id: "Bills", label: "Hóa đơn", defaultBucket: "needs", system: true },
  { id: "Shopping", label: "Mua sắm", defaultBucket: "wants", system: true },
  { id: "Entertainment", label: "Giải trí", defaultBucket: "wants", system: true },
  { id: "Health", label: "Sức khỏe", defaultBucket: "needs", system: true },
  { id: "Education", label: "Giáo dục", defaultBucket: "needs", system: true },
  { id: "Family", label: "Gia đình", defaultBucket: "needs", system: true },
  { id: "Other", label: "Khác", defaultBucket: "wants", system: true },
]

export const EXPENSE_CATEGORIES: ExpenseCategory[] =
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map((category) => category.id)

export const CATEGORY_LABELS_VI: Record<string, string> = Object.fromEntries(
  DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map((category) => [category.id, category.label]),
)

export const BUCKET_LABELS_VI: Record<BudgetBucket, string> = {
  needs: "Thiết yếu",
  wants: "Mong muốn",
}

export function getExpenseCategoryLabel(
  category: ExpenseCategory,
  categories?: Pick<ExpenseCategoryConfig, "id" | "label">[],
) {
  const configured = categories?.find((item) => item.id === category)
  return configured?.label || CATEGORY_LABELS_VI[category] || category
}

export function getExpenseCategoryOptions(
  categories?: ExpenseCategoryConfig[],
): ExpenseCategoryConfig[] {
  if (!categories?.length) return []
  return categories
}

export function suggestBucketByCategory(
  category: ExpenseCategory,
  categories?: Pick<ExpenseCategoryConfig, "id" | "defaultBucket">[],
): BudgetBucket {
  const configured = categories?.find((item) => item.id === category)
  if (configured) return configured.defaultBucket

  switch (category) {
    case "Food":
    case "Transport":
    case "Bills":
    case "Health":
    case "Education":
    case "Family":
      return "needs"
    case "Shopping":
    case "Entertainment":
    case "Other":
    default:
      return "wants"
  }
}
