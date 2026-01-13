import type { BudgetBucket, ExpenseCategory } from "@/domain/types"

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Food",
  "Transport",
  "Bills",
  "Shopping",
  "Entertainment",
  "Health",
  "Education",
  "Family",
  "Other",
]

export const CATEGORY_LABELS_VI: Record<ExpenseCategory, string> = {
  Food: "Ăn uống",
  Transport: "Di chuyển",
  Bills: "Hóa đơn",
  Shopping: "Mua sắm",
  Entertainment: "Giải trí",
  Health: "Sức khỏe",
  Education: "Giáo dục",
  Family: "Gia đình",
  Other: "Khác",
}

export const BUCKET_LABELS_VI: Record<BudgetBucket, string> = {
  needs: "Thiết yếu",
  wants: "Mong muốn",
}

export function suggestBucketByCategory(category: ExpenseCategory): BudgetBucket {
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

