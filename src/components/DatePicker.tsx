import Flatpickr from "react-flatpickr"
import { CalendarIcon, X } from "lucide-react"
import { Vietnamese } from "flatpickr/dist/l10n/vn"
import type { ISODate } from "@/domain/types"
import { formatIsoDate, parseIsoDateLocal } from "@/lib/date"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type FlatpickrInstanceLike = {
  input: HTMLInputElement
  calendarContainer: HTMLElement
}

function positionCalendarInMobileViewport(instance: FlatpickrInstanceLike) {
  if (typeof window === "undefined") return

  const calendar = instance.calendarContainer
  if (window.innerWidth >= 640) {
    calendar.classList.remove("cttm-flatpickr-mobile")
    ;["position", "left", "right", "top", "transform", "width", "maxWidth"].forEach((prop) => {
      calendar.style.removeProperty(prop)
    })
    return
  }

  const place = () => {
    const viewport = window.visualViewport
    const viewportHeight = viewport?.height ?? window.innerHeight
    const viewportOffsetTop = viewport?.offsetTop ?? 0
    const inputRect = instance.input.getBoundingClientRect()
    const calendarHeight = calendar.offsetHeight || 320
    const bottomReserve = 88
    const sideGap = 12
    const width = Math.min(328, Math.max(296, window.innerWidth - sideGap * 2))

    let top = viewportOffsetTop + inputRect.bottom + 8
    const maxTop = viewportOffsetTop + viewportHeight - calendarHeight - bottomReserve
    if (top > maxTop) top = Math.max(viewportOffsetTop + sideGap, maxTop)
    top = Math.max(viewportOffsetTop + sideGap, top)

    calendar.classList.add("cttm-flatpickr-mobile")
    calendar.style.position = "fixed"
    calendar.style.left = `${Math.round((window.innerWidth - width) / 2)}px`
    calendar.style.right = "auto"
    calendar.style.top = `${Math.round(top)}px`
    calendar.style.transform = "none"
    calendar.style.width = `${Math.round(width)}px`
    calendar.style.maxWidth = `calc(100vw - ${sideGap * 2}px)`
  }

  window.requestAnimationFrame(place)
  window.setTimeout(place, 80)
}

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
          allowInput: false,
          clickOpens: true,
          disableMobile: true,
          monthSelectorType: "static",
          position: "auto center",
          appendTo: typeof document === "undefined" ? undefined : document.body,
        }}
        onReady={(_dates, _dateStr, instance) => {
          instance.input.readOnly = true
          instance.input.setAttribute("inputmode", "none")
          instance.input.setAttribute("autocomplete", "off")
        }}
        onOpen={(_dates, _dateStr, instance) => {
          instance.input.blur()
          positionCalendarInMobileViewport(instance)
        }}
        onMonthChange={(_dates, _dateStr, instance) => {
          positionCalendarInMobileViewport(instance)
        }}
        onYearChange={(_dates, _dateStr, instance) => {
          positionCalendarInMobileViewport(instance)
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
