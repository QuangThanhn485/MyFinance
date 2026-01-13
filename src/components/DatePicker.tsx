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
}

export default function DatePicker({
  value,
  onChange,
  placeholder = "Chọn ngày",
  disabled,
  allowClear,
  className,
}: DatePickerProps) {
  const selected = value ? parseIsoDateLocal(value) : undefined

  return (
    <div className="relative w-full">
      <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Flatpickr
        value={selected}
        placeholder={placeholder}
        disabled={disabled}
        options={{
          locale: Vietnamese,
          dateFormat: "d/m/Y",
          allowInput: true,
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
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          !value && "text-muted-foreground",
          className,
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
