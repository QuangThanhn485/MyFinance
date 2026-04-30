import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Pencil, Plus, Search, Tags, Trash2, X } from "lucide-react"
import { BUCKET_LABELS_VI } from "@/domain/constants"
import type { BudgetBucket, ExpenseCategory } from "@/domain/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { getExpenseCategoryUsageCounts } from "@/storage/categories"
import { loadExpenseTemplates } from "@/storage/templates"
import { useAppStore } from "@/store/useAppStore"

type FilterMode = "all" | "used" | "free"

export default function CategoriesPage() {
  const data = useAppStore((s) => s.data)
  const addExpenseCategory = useAppStore((s) => s.actions.addExpenseCategory)
  const updateExpenseCategory = useAppStore((s) => s.actions.updateExpenseCategory)
  const deleteExpenseCategory = useAppStore((s) => s.actions.deleteExpenseCategory)

  const [newCategoryLabel, setNewCategoryLabel] = useState("")
  const [newCategoryBucket, setNewCategoryBucket] = useState<BudgetBucket>("needs")
  const [editingCategoryId, setEditingCategoryId] = useState<ExpenseCategory | null>(null)
  const [editingCategoryLabel, setEditingCategoryLabel] = useState("")
  const [editingCategoryBucket, setEditingCategoryBucket] = useState<BudgetBucket>("needs")
  const [query, setQuery] = useState("")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")

  const categoryOptions = useMemo(() => data.expenseCategories, [data.expenseCategories])
  const templatesForCategoryUsage = useMemo(() => loadExpenseTemplates(), [data.updatedAt])
  const categoryUsage = useMemo(
    () => getExpenseCategoryUsageCounts(data, templatesForCategoryUsage),
    [data, templatesForCategoryUsage],
  )

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi")

    return categoryOptions
      .map((category) => {
        const usage = categoryUsage[category.id] ?? {
          expenses: 0,
          fixedCosts: 0,
          templates: 0,
          total: 0,
        }
        return {
          category,
          usage,
          used: usage.total > 0,
        }
      })
      .filter((row) => {
        if (filterMode === "used" && !row.used) return false
        if (filterMode === "free" && row.used) return false
        if (!normalizedQuery) return true
        return row.category.label.toLocaleLowerCase("vi").includes(normalizedQuery)
      })
  }, [categoryOptions, categoryUsage, filterMode, query])

  const usedCount = categoryOptions.filter((category) => {
    const usage = categoryUsage[category.id]
    return usage?.total ? usage.total > 0 : false
  }).length
  const freeCount = Math.max(0, categoryOptions.length - usedCount)

  const handleCreateCategory = () => {
    const result = addExpenseCategory({
      label: newCategoryLabel,
      defaultBucket: newCategoryBucket,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setNewCategoryLabel("")
    setNewCategoryBucket("needs")
    toast.success("Đã thêm danh mục.")
  }

  const startEditCategory = (category: (typeof categoryOptions)[number]) => {
    setEditingCategoryId(category.id)
    setEditingCategoryLabel(category.label)
    setEditingCategoryBucket(category.defaultBucket)
  }

  const handleSaveCategory = () => {
    if (!editingCategoryId) return
    const result = updateExpenseCategory(editingCategoryId, {
      label: editingCategoryLabel,
      defaultBucket: editingCategoryBucket,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setEditingCategoryId(null)
    toast.success("Đã cập nhật danh mục.")
  }

  const handleDeleteCategory = (categoryId: ExpenseCategory) => {
    const usage = categoryUsage[categoryId]
    if (usage?.total) {
      toast.error("Danh mục đang được sử dụng nên không thể xoá.")
      return
    }

    const result = deleteExpenseCategory(categoryId)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    if (editingCategoryId === categoryId) setEditingCategoryId(null)
    toast.success("Đã xoá danh mục.")
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Danh mục chi tiêu</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý danh mục dùng trong chi tiêu, chi phí cố định và mẫu thêm nhanh.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Tổng</div>
            <div className="font-semibold tabular-nums">{categoryOptions.length}</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/20">
            <div className="text-xs text-amber-700 dark:text-amber-300">Đang dùng</div>
            <div className="font-semibold tabular-nums">{usedCount}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">Có thể xoá</div>
            <div className="font-semibold tabular-nums">{freeCount}</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground" />
            <span>Thêm danh mục</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_220px_auto]">
            <div className="grid gap-1.5">
              <Label className="text-xs">Tên danh mục</Label>
              <Input
                value={newCategoryLabel}
                onChange={(event) => setNewCategoryLabel(event.target.value)}
                maxLength={60}
                placeholder="Ví dụ: Thú cưng, Du lịch, Quà tặng..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Bucket mặc định</Label>
              <Select
                value={newCategoryBucket}
                onValueChange={(value) => setNewCategoryBucket(value as BudgetBucket)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                  <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" className="w-full lg:w-auto" onClick={handleCreateCategory}>
                <Plus className="h-4 w-4" />
                Thêm
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Danh sách</CardTitle>
            <div className="flex flex-1 flex-wrap justify-end gap-2">
              <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-8"
                  placeholder="Tìm danh mục"
                />
              </div>
              <Select value={filterMode} onValueChange={(value) => setFilterMode(value as FilterMode)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="used">Đang dùng</SelectItem>
                  <SelectItem value="free">Có thể xoá</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="hidden rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(180px,1fr)_130px_240px_110px] md:gap-3">
            <div>Danh mục</div>
            <div>Bucket</div>
            <div>Mức sử dụng</div>
            <div className="text-right">Thao tác</div>
          </div>

          <div className="max-h-[calc(100vh-330px)] min-h-[260px] space-y-2 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Không có danh mục phù hợp với bộ lọc hiện tại.
              </div>
            ) : (
              rows.map(({ category, usage, used }) => {
                const isLastCategory = categoryOptions.length <= 1
                const isEditing = editingCategoryId === category.id

                return (
                  <div
                    key={category.id}
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      used
                        ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
                        : "bg-background",
                    )}
                  >
                    {isEditing ? (
                      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_auto] lg:items-end">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Tên danh mục</Label>
                          <Input
                            value={editingCategoryLabel}
                            onChange={(event) => setEditingCategoryLabel(event.target.value)}
                            maxLength={60}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Bucket mặc định</Label>
                          <Select
                            value={editingCategoryBucket}
                            onValueChange={(value) =>
                              setEditingCategoryBucket(value as BudgetBucket)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                              <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditingCategoryId(null)}
                          >
                            <X className="h-4 w-4" />
                            Huỷ
                          </Button>
                          <Button type="button" onClick={handleSaveCategory}>
                            Lưu
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_130px_240px_110px] md:items-center">
                        <div className="min-w-0">
                          <div className="truncate font-medium" title={category.label}>
                            {category.label}
                          </div>
                          <div className="truncate text-xs text-muted-foreground" title={category.id}>
                            {category.id}
                          </div>
                        </div>
                        <Badge variant="outline" className="w-fit">
                          {BUCKET_LABELS_VI[category.defaultBucket]}
                        </Badge>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={used ? "secondary" : "outline"}>
                              {used ? `Đang dùng ${usage.total}` : "Chưa dùng"}
                            </Badge>
                            {used ? (
                              <span className="text-xs text-amber-700 dark:text-amber-300">
                                Không thể xoá
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {usage.expenses} chi tiêu · {usage.fixedCosts} cố định · {usage.templates} mẫu
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => startEditCategory(category)}
                            title="Sửa danh mục"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            disabled={used || isLastCategory}
                            title={
                              used
                                ? "Danh mục đang được sử dụng nên không thể xoá."
                                : isLastCategory
                                  ? "Cần giữ ít nhất một danh mục."
                                  : "Xoá danh mục"
                            }
                            onClick={() => handleDeleteCategory(category.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <Separator />
          <div className="text-xs text-muted-foreground">
            Danh mục đã phát sinh dữ liệu được đánh dấu màu vàng và không cho xoá để tránh làm hỏng lịch sử chi tiêu.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
