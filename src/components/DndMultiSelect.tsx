import { useMemo, type CSSProperties, type ReactNode } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const AVAILABLE_ID = "available"
const SELECTED_ID = "selected"

function DroppablePanel(props: {
  id: string
  className?: string
  children: ReactNode
}) {
  const { id, className, children } = props
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isOver && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      {children}
    </div>
  )
}

function SortableChip(props: {
  id: string
  label: string
  trailing?: ReactNode
  className?: string
}) {
  const { id, label, trailing, className } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm shadow-sm",
        isDragging && "opacity-50",
        className,
      )}
    >
      <div
        className="flex items-center gap-2 min-w-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  )
}

export default function DndMultiSelect<T extends string>(props: {
  allIds: T[]
  selectedIds: T[]
  onSelectedIdsChange: (next: T[]) => void
  getLabel: (id: T) => string
  availableTitle?: string
  selectedTitle?: string
  helpText?: string
  className?: string
}) {
  const {
    allIds,
    selectedIds,
    onSelectedIdsChange,
    getLabel,
    availableTitle = "Có thể thêm",
    selectedTitle = "Đang hiển thị",
    helpText = "Kéo thả để thêm/bớt và sắp xếp thứ tự hiển thị.",
    className,
  } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const availableIds = useMemo(
    () => allIds.filter((id) => !selectedSet.has(id)),
    [allIds, selectedSet],
  )

  const findContainer = (id: string): typeof AVAILABLE_ID | typeof SELECTED_ID => {
    if (id === AVAILABLE_ID || id === SELECTED_ID) return id
    if (selectedSet.has(id as T)) return SELECTED_ID
    return AVAILABLE_ID
  }

  const onDragEnd = (event: DragEndEvent) => {
    const active = String(event.active.id) as T
    const over = event.over?.id ? String(event.over.id) : null
    if (!over || active === over) return

    const activeContainer = findContainer(active)
    const overContainer = findContainer(over)

    // Reorder inside selected
    if (activeContainer === SELECTED_ID && overContainer === SELECTED_ID) {
      const oldIndex = selectedIds.indexOf(active)
      const newIndex = selectedIds.indexOf(over as T)
      if (oldIndex < 0 || newIndex < 0) return
      onSelectedIdsChange(arrayMove(selectedIds, oldIndex, newIndex))
      return
    }

    // Move from available -> selected
    if (activeContainer === AVAILABLE_ID && overContainer === SELECTED_ID) {
      const overIndex = selectedIds.indexOf(over as T)
      const insertAt = overIndex >= 0 ? overIndex : selectedIds.length
      const next = selectedIds.slice()
      next.splice(Math.max(0, insertAt), 0, active)
      onSelectedIdsChange(next)
      return
    }

    // Move from selected -> available
    if (activeContainer === SELECTED_ID && overContainer === AVAILABLE_ID) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== active))
      return
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-xs text-muted-foreground">{helpText}</div>
      <DndContext
        sensors={sensors}
      collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DroppablePanel
            id={AVAILABLE_ID}
            className="rounded-md border bg-muted/20 p-3"
          >
            <div className="text-sm font-medium">{availableTitle}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <SortableContext items={availableIds} strategy={rectSortingStrategy}>
                {availableIds.map((id) => (
                  <SortableChip
                    key={id}
                    id={id}
                    label={getLabel(id)}
                    className="bg-background"
                  />
                ))}
              </SortableContext>
            </div>
          </DroppablePanel>

          <DroppablePanel
            id={SELECTED_ID}
            className="rounded-md border bg-background p-3"
          >
            <div className="text-sm font-medium">{selectedTitle}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <SortableContext items={selectedIds} strategy={rectSortingStrategy}>
                {selectedIds.map((id) => (
                  <SortableChip
                    key={id}
                    id={id}
                    label={getLabel(id)}
                    trailing={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full"
                        onClick={() =>
                          onSelectedIdsChange(selectedIds.filter((x) => x !== id))
                        }
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Gỡ</span>
                      </Button>
                    }
                  />
                ))}
              </SortableContext>
            </div>
          </DroppablePanel>
        </div>
      </DndContext>
    </div>
  )
}
