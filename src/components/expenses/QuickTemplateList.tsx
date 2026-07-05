import { useEffect, useMemo, useRef, useState } from "react"
import { Minus, Pencil, Plus, Trash2 } from "lucide-react"
import type { ExpenseCategory, ExpenseCategoryConfig } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ExpenseTemplate } from "@/storage/templates"

type QuickTemplateListProps = {
  templates: ExpenseTemplate[]
  categories: ExpenseCategoryConfig[]
  categoryLabels: Record<string, string>
  quantities: Record<string, number>
  onQuantityChange: (id: string, quantity: number) => void
  onToggleSelectAllVisible: (checked: boolean, visibleTemplates: ExpenseTemplate[]) => void
  onBulkAddSelected?: () => void
  onBulkDelete: () => void
  onQuickAdd: (template: ExpenseTemplate) => void
  onEdit: (template: ExpenseTemplate) => void
  onCreate?: () => void
  showCreateButton?: boolean
}

function QuantityStepper({
  value,
  onChange,
  ariaLabel,
  max = 99,
}: {
  value: number
  onChange: (quantity: number) => void
  ariaLabel: string
  max?: number
}) {
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.trunc(Number.isFinite(n) ? n : 0)))
  // Text cục bộ để cho phép gõ tự do (kể cả rỗng) trong lúc đang focus; đồng bộ lại từ value
  // khi không focus.
  const [text, setText] = useState(String(value))
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setText(String(value))
  }, [value])

  return (
    <div className="inline-flex shrink-0 items-center rounded-md border bg-background">
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        disabled={value <= 0}
        onClick={() => onChange(clamp(value - 1))}
        aria-label={`Giảm ${ariaLabel}`}
        title="Giảm số lượng"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        value={text}
        onFocus={(event) => {
          focusedRef.current = true
          event.currentTarget.select()
        }}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 3)
          setText(digits)
          onChange(digits === "" ? 0 : clamp(parseInt(digits, 10)))
        }}
        onBlur={() => {
          focusedRef.current = false
          const digits = text.replace(/[^\d]/g, "")
          const next = digits === "" ? 0 : clamp(parseInt(digits, 10))
          onChange(next)
          setText(String(next))
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
        className={cn(
          "h-7 w-9 border-x bg-transparent text-center text-sm font-semibold tabular-nums outline-none focus:bg-muted/40",
          value > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted"
        onClick={() => onChange(clamp(value + 1))}
        aria-label={`Tăng ${ariaLabel}`}
        title="Tăng số lượng"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function QuickTemplateList({
  templates,
  categories,
  categoryLabels,
  quantities,
  onQuantityChange,
  onToggleSelectAllVisible,
  onBulkAddSelected,
  onBulkDelete,
  onQuickAdd,
  onEdit,
  onCreate,
  showCreateButton = true,
}: QuickTemplateListProps) {
  const groups = useMemo(() => {
    const orderedCategories = categories.map((category) => category.id)
    const known = new Set(orderedCategories)
    const extraCategories = templates
      .map((template) => template.category)
      .filter((category, index, self) => !known.has(category) && self.indexOf(category) === index)

    return [...orderedCategories, ...extraCategories]
      .map((category) => ({
        category,
        templates: templates
          .filter((template) => template.category === category)
          .sort((a, b) => a.name.localeCompare(b.name, "vi")),
      }))
      .filter((group) => group.templates.length > 0)
  }, [categories, templates])

  const [activeCategory, setActiveCategory] = useState<ExpenseCategory | null>(
    () => groups[0]?.category ?? null,
  )

  useEffect(() => {
    if (groups.length === 0) {
      setActiveCategory(null)
      return
    }
    if (!activeCategory || !groups.some((group) => group.category === activeCategory)) {
      setActiveCategory(groups[0].category)
    }
  }, [activeCategory, groups])

  const visibleTemplates =
    groups.find((group) => group.category === activeCategory)?.templates ?? []

  const qtyOf = (id: string) => Math.max(0, Math.trunc(quantities[id] ?? 0))
  // Số item được chọn (số lượng > 0) và tổng số lượt sẽ thêm.
  const pickedCount = Object.values(quantities).filter((q) => q > 0).length
  const totalQty = Object.values(quantities).reduce(
    (sum, q) => sum + Math.max(0, Math.trunc(q)),
    0,
  )
  const selectedVisibleCount = visibleTemplates.filter((template) => qtyOf(template.id) > 0).length
  const allVisibleSelected =
    visibleTemplates.length > 0 &&
    visibleTemplates.every((template) => qtyOf(template.id) > 0)

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-2">
        {groups.length > 0 ? (
          <Tabs
            value={activeCategory ?? groups[0].category}
            onValueChange={(value) => setActiveCategory(value as ExpenseCategory)}
            className="min-w-0 flex-1"
          >
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="h-8 w-max justify-start">
                {groups.map((group) => (
                  <TabsTrigger
                    key={group.category}
                    value={group.category}
                    className="h-6 px-2 text-xs"
                  >
                    {categoryLabels[group.category] ?? group.category} ({group.templates.length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        ) : (
          <div className="flex-1 text-xs text-muted-foreground">Chưa có mẫu</div>
        )}

        {showCreateButton && onCreate ? (
          <Button type="button" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            Thêm mẫu
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-8 items-center gap-2 overflow-x-auto rounded-md border bg-background px-2 py-1 whitespace-nowrap">
        <label className="inline-flex shrink-0 items-center gap-2 text-xs">
          <Checkbox
            checked={allVisibleSelected}
            disabled={visibleTemplates.length === 0}
            onCheckedChange={(value) =>
              onToggleSelectAllVisible(value === true, visibleTemplates)
            }
            aria-label={allVisibleSelected ? "Bỏ chọn tab hiện tại" : "Chọn tab hiện tại"}
          />
          <span className="text-muted-foreground">
            {allVisibleSelected
              ? "Bỏ chọn tab"
              : selectedVisibleCount > 0
                ? `${selectedVisibleCount}/${visibleTemplates.length} trong tab`
                : "Chọn tab"}
          </span>
        </label>

        <span className="shrink-0 text-xs text-muted-foreground">
          {totalQty > 0
            ? `${pickedCount} item · ${totalQty} lượt`
            : `${visibleTemplates.length} item trong tab`}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onBulkAddSelected}
            disabled={!onBulkAddSelected || totalQty === 0}
          >
            Thêm{totalQty > 0 ? ` (${totalQty})` : ""}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onBulkDelete}
            disabled={pickedCount === 0}
            title="Xóa item đã chọn"
            aria-label="Xóa item đã chọn"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-md border bg-muted/20">
        <div className="h-full overflow-y-auto p-2 space-y-1.5">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Chưa có mẫu phù hợp. Hãy tạo mẫu mới bằng nút Thêm mẫu.
            </div>
          ) : (
            visibleTemplates.map((template) => {
              const qty = qtyOf(template.id)
              const picked = qty > 0
              const secondaryText =
                template.note || categoryLabels[template.category] || template.category

              return (
                <div
                  key={template.id}
                  className={cn(
                    "rounded-md border bg-background p-2 transition-colors",
                    picked
                      ? "border-primary/50 ring-1 ring-primary/25"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    {/* Bộ đếm số lượng: nhập nhiều lượt cho mỗi mẫu trong một lần thêm */}
                    <QuantityStepper
                      value={qty}
                      onChange={(quantity) => onQuantityChange(template.id, quantity)}
                      ariaLabel={`số lượng ${template.name}`}
                    />

                    <div className="min-w-0 space-y-0.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="truncate text-sm font-medium" title={template.name}>
                          {template.name}
                        </div>
                        <div className="whitespace-nowrap text-sm font-semibold tabular-nums">
                          {formatVnd(template.amount)}
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate" title={secondaryText}>
                          {secondaryText}
                        </span>
                        <span className="whitespace-nowrap uppercase tracking-wide">
                          {template.bucket}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => onEdit(template)}
                        aria-label={`Sửa mẫu ${template.name}`}
                        title="Sửa mẫu"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-7 w-7"
                        onClick={() => onQuickAdd(template)}
                        aria-label={`Thêm nhanh 1 khoản từ mẫu ${template.name}`}
                        title="Thêm nhanh 1 khoản vào danh sách chi tiêu"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
