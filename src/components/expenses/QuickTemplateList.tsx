import { useEffect, useMemo, useState } from "react"
import { CheckSquare, Pencil, Plus, Trash2 } from "lucide-react"
import { CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import type { ExpenseCategory } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ExpenseTemplate } from "@/storage/templates"

type QuickTemplateListProps = {
  templates: ExpenseTemplate[]
  selectedIds: Set<string>
  onToggleSelect: (id: string, checked: boolean) => void
  onToggleSelectAllVisible: (checked: boolean, visibleTemplates: ExpenseTemplate[]) => void
  onClearSelection: () => void
  onBulkAddSelected?: () => void
  onBulkDelete: () => void
  onQuickAdd: (template: ExpenseTemplate) => void
  onEdit: (template: ExpenseTemplate) => void
  onCreate?: () => void
  showCreateButton?: boolean
}

export default function QuickTemplateList({
  templates,
  selectedIds,
  onToggleSelect,
  onToggleSelectAllVisible,
  onClearSelection,
  onBulkAddSelected,
  onBulkDelete,
  onQuickAdd,
  onEdit,
  onCreate,
  showCreateButton = true,
}: QuickTemplateListProps) {
  const groups = useMemo(
    () =>
      EXPENSE_CATEGORIES.map((category) => ({
        category,
        templates: templates
          .filter((template) => template.category === category)
          .sort((a, b) => a.name.localeCompare(b.name, "vi")),
      }))
        .filter((group) => group.templates.length > 0)
        .sort((a, b) =>
          CATEGORY_LABELS_VI[a.category].localeCompare(CATEGORY_LABELS_VI[b.category], "vi"),
        ),
    [templates],
  )

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
  const selectedCount = selectedIds.size
  const allVisibleSelected =
    visibleTemplates.length > 0 &&
    visibleTemplates.every((template) => selectedIds.has(template.id))

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
                    {CATEGORY_LABELS_VI[group.category]} ({group.templates.length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        ) : (
          <div className="flex-1 text-xs text-muted-foreground">Chưa có mẫu</div>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-xs"
          disabled={visibleTemplates.length === 0}
          onClick={() => onToggleSelectAllVisible(!allVisibleSelected, visibleTemplates)}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          {allVisibleSelected ? "Bỏ chọn" : "Chọn tab"}
        </Button>

        {showCreateButton && onCreate ? (
          <Button type="button" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            Thêm mẫu
          </Button>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="flex min-h-8 items-center gap-2 overflow-x-auto rounded-md border bg-background px-2 py-1 whitespace-nowrap">
          <span className="shrink-0 text-xs font-medium text-foreground">
            {selectedCount} item đang chọn
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onBulkAddSelected}
            disabled={!onBulkAddSelected}
          >
            Thêm ({selectedCount})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onBulkDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xoá ({selectedCount})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onClearSelection}
          >
            Bỏ chọn
          </Button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 rounded-md border bg-muted/20">
        <div className="h-full overflow-y-auto p-2 space-y-1.5">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Chưa có mẫu phù hợp. Hãy tạo mẫu mới bằng nút Thêm mẫu.
            </div>
          ) : (
            visibleTemplates.map((template) => {
              const checked = selectedIds.has(template.id)
              const secondaryText = template.note || CATEGORY_LABELS_VI[template.category]

              return (
                <div
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('[data-stop-select="true"]')) return
                    onToggleSelect(template.id, !checked)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    const target = event.target as HTMLElement
                    if (target.closest('[data-stop-select="true"]')) return
                    event.preventDefault()
                    onToggleSelect(template.id, !checked)
                  }}
                  className={cn(
                    "rounded-md border bg-background p-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    !checked && "hover:border-muted-foreground/40",
                    checked && "border-primary/50 ring-1 ring-primary/25",
                  )}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    <Checkbox
                      data-stop-select="true"
                      checked={checked}
                      onCheckedChange={(value) => onToggleSelect(template.id, value === true)}
                      aria-label={`Chọn mẫu ${template.name}`}
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
                        data-stop-select="true"
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
                        data-stop-select="true"
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-7 w-7"
                        onClick={() => onQuickAdd(template)}
                        aria-label={`Thêm nhanh từ mẫu ${template.name}`}
                        title="Thêm nhanh vào danh sách chi tiêu"
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
