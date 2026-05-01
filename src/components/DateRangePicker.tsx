import { CalendarDays } from "lucide-react"
import type { ISODate } from "@/domain/types"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import DatePicker from "@/components/DatePicker"
import { cn } from "@/lib/utils"

export type DateRangeValue = {
  start: ISODate
  end: ISODate
}

export type DateRangePreset = {
  id: string
  label: string
  range: DateRangeValue
}

type DateRangePickerProps = {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  presets?: DateRangePreset[]
  className?: string
}

function formatDateLabel(date: ISODate) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

function normalizeDateRange(range: DateRangeValue): DateRangeValue {
  return range.start <= range.end
    ? range
    : { start: range.end, end: range.start }
}

export default function DateRangePicker({
  value,
  onChange,
  presets = [],
  className,
}: DateRangePickerProps) {
  const activePreset = presets.find(
    (preset) =>
      preset.range.start === value.start && preset.range.end === value.end,
  )

  const updateStart = (start?: ISODate) => {
    if (!start) return
    onChange(normalizeDateRange({ start, end: value.end }))
  }

  const updateEnd = (end?: ISODate) => {
    if (!end) return
    onChange(normalizeDateRange({ start: value.start, end }))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-10 min-w-[260px] justify-start gap-2 bg-background px-3 font-normal shadow-sm",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left tabular-nums">
            {activePreset ? `${activePreset.label}: ` : ""}
            {formatDateLabel(value.start)} - {formatDateLabel(value.end)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,520px)] p-3">
        <div className="grid gap-3">
          {presets.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {presets.map((preset) => {
                const active =
                  preset.range.start === value.start &&
                  preset.range.end === value.end
                return (
                  <Button
                    key={preset.id}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    className="justify-start"
                    onClick={() => onChange(preset.range)}
                  >
                    {preset.label}
                  </Button>
                )
              })}
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Từ ngày</div>
              <DatePicker
                value={value.start}
                onChange={updateStart}
                ariaLabel="Từ ngày"
              />
            </div>
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Đến ngày</div>
              <DatePicker
                value={value.end}
                onChange={updateEnd}
                ariaLabel="Đến ngày"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
