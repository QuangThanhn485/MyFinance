import { CheckSquare, Pencil, Plus, Trash2 } from "lucide-react"
import { CATEGORY_LABELS_VI } from "@/domain/constants"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { ExpenseTemplate } from "@/storage/templates"

type QuickTemplateListProps = {
  templates: ExpenseTemplate[]
  selectedIds: Set<string>
  searchValue: string
  onSearchChange: (next: string) => void
  onToggleSelect: (id: string, checked: boolean) => void
  onToggleSelectAllVisible: (checked: boolean) => void
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
  searchValue,
  onSearchChange,
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
  const selectedCount = selectedIds.size
  const allVisibleSelected =
    templates.length > 0 && templates.every((template) => selectedIds.has(template.id))

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Item thêm nhanh</h3>
        {showCreateButton && onCreate ? (
          <Button type="button" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Thêm mẫu
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Tìm theo tên, danh mục, ghi chú..."
          aria-label="Tìm mẫu thêm nhanh"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => onToggleSelectAllVisible(!allVisibleSelected)}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
          <span>{templates.length} mẫu</span>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>{selectedCount} item đang được chọn</span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={onBulkDelete}>
                <Trash2 className="h-4 w-4" />
                Xoá ({selectedCount})
              </Button>
              <Button type="button" size="sm" onClick={onBulkAddSelected} disabled={!onBulkAddSelected}>
                Thêm ({selectedCount})
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>
                Bỏ chọn
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 rounded-md border bg-muted/20">
        <div className="h-full overflow-y-auto p-2 space-y-2">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Chưa có mẫu phù hợp. Hãy tạo mẫu mới bằng nút “Thêm mẫu”.
            </div>
          ) : (
            templates.map((template) => {
              const checked = selectedIds.has(template.id)
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
                    "rounded-md border bg-background p-2.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    !checked && "hover:border-muted-foreground/40",
                    checked && "border-primary/50 ring-1 ring-primary/25",
                  )}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                    <Checkbox
                      data-stop-select="true"
                      checked={checked}
                      onCheckedChange={(value) => onToggleSelect(template.id, value === true)}
                      aria-label={`Chọn mẫu ${template.name}`}
                      className="mt-1"
                    />

                    <div className="min-w-0 space-y-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="truncate text-sm font-medium" title={template.name}>
                          {template.name}
                        </div>
                        <div className="whitespace-nowrap text-sm font-semibold tabular-nums">
                          {formatVnd(template.amount)}
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate" title={CATEGORY_LABELS_VI[template.category]}>
                          {CATEGORY_LABELS_VI[template.category]}
                        </span>
                        <span className="whitespace-nowrap uppercase tracking-wide">
                          {template.bucket}
                        </span>
                      </div>
                      {template.note ? (
                        <div className="truncate text-xs text-muted-foreground" title={template.note}>
                          {template.note}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        data-stop-select="true"
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        onClick={() => onEdit(template)}
                        aria-label={`Sửa mẫu ${template.name}`}
                        title="Sửa mẫu"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        data-stop-select="true"
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="h-8 w-8"
                        onClick={() => onQuickAdd(template)}
                        aria-label={`Thêm nhanh từ mẫu ${template.name}`}
                        title="Thêm nhanh vào danh sách chi tiêu"
                      >
                        <Plus className="h-4 w-4" />
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
