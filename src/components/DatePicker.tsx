import Flatpickr from "react-flatpickr"
import { CalendarIcon, X } from "lucide-react"
import { Vietnamese } from "flatpickr/dist/l10n/vn"
import type { ISODate } from "@/domain/types"
import { formatIsoDate, parseIsoDateLocal } from "@/lib/date"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type DatePickerProps = {
  value?: ISODate
  onChange: (next?: ISODate) => void
  placeholder?: string
  disabled?: boolean
  allowClear?: boolean
  className?: string
  ariaLabel?: string
}

export default function DatePicker({
  value,
  onChange,
  placeholder = "Chọn ngày",
  disabled,
  allowClear,
  className,
  ariaLabel,
}: DatePickerProps) {
  const selected = value ? parseIsoDateLocal(value) : undefined

  return (
    <div
      className={cn(
        "group relative flex h-10 w-full items-center rounded-md border border-input bg-background shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground" />
      <Flatpickr
        value={selected}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        options={{
          locale: Vietnamese,
          dateFormat: "d/m/Y",
          allowInput: true,
          clickOpens: true,
          disableMobile: true,
          monthSelectorType: "static",
          position: "auto center",
        }}
        onChange={(dates, _dateStr, instance) => {
          const date = dates?.[0]
          if (!date) {
            if (allowClear) onChange(undefined)
            else if (selected) instance.setDate(selected, false)
            return
          }
          onChange(formatIsoDate(date))
        }}
        className={cn(
          "h-full w-full rounded-md border-0 bg-transparent px-3 py-2 pl-10 text-sm tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
          allowClear ? "pr-10" : "pr-3",
          !value && "text-muted-foreground",
        )}
      />
      {allowClear && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(undefined)}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Xóa ngày</span>
        </Button>
      ) : null}
    </div>
  )
}
