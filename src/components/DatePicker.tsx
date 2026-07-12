import { useMemo } from "react"
import Flatpickr from "react-flatpickr"
import { CalendarIcon, X } from "lucide-react"
import { Vietnamese } from "flatpickr/dist/l10n/vn"
import type { Options } from "flatpickr/dist/types/options"
import type { ISODate } from "@/domain/types"
import { formatIsoDate } from "@/lib/date"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Khớp với `dateFormat: "d/m/Y"` của flatpickr. */
function toDisplayDate(value?: ISODate): string {
  if (!value) return ""
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
}

type FlatpickrInstanceLike = {
  input: HTMLInputElement
  calendarContainer: HTMLElement
  /** flatpickr's internal reposition helper (exposed on the instance). */
  _positionCalendar?: () => void
}

const MOBILE_CALENDAR_CLASS = "cttm-flatpickr-mobile"

function positionCalendarInMobileViewport(instance: FlatpickrInstanceLike) {
  if (typeof window === "undefined") return

  const calendar = instance.calendarContainer
  if (!calendar) return

  if (window.innerWidth >= 640) {
    // Desktop: flatpickr tự định vị lịch bằng inline `top`/`left` (vì lịch được appendTo body).
    // TUYỆT ĐỐI không xoá các inline style đó — trước đây nhánh này xoá vô điều kiện, nên mỗi lần
    // đổi tháng/năm lịch mất vị trí và văng ra ngoài viewport ("biến mất").
    // Chỉ dọn khi TRƯỚC ĐÓ ta thật sự đã áp style mobile (vd vừa resize từ mobile sang desktop),
    // rồi để flatpickr tự đặt lại vị trí.
    if (!calendar.classList.contains(MOBILE_CALENDAR_CLASS)) return
    calendar.classList.remove(MOBILE_CALENDAR_CLASS)
    ;["position", "left", "right", "top", "transform", "width", "maxWidth"].forEach((prop) => {
      calendar.style.removeProperty(prop)
    })
    instance._positionCalendar?.()
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

    calendar.classList.add(MOBILE_CALENDAR_CLASS)
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
  // react-flatpickr render input là CONTROLLED: <input value={props.value?.toString()} />.
  // Nếu truyền Date, React đổ thẳng Date.toString() ("Tue Dec 01 2026 00:00:00 GMT+0700...") vào ô
  // input mỗi lần re-render, ghi đè chuỗi flatpickr đã format -> hiện chữ tiếng Anh.
  // => Truyền sẵn chuỗi đúng định dạng d/m/Y; flatpickr tự parse lại theo `dateFormat`.
  // Chuỗi "" khi rỗng giữ input luôn ở chế độ controlled và khiến flatpickr clear đúng cách.
  const displayValue = useMemo(() => toDisplayDate(value), [value])

  // Options cũng phải ổn định: object mới mỗi render khiến react-flatpickr gọi flatpickr.set(...)
  // và redraw không cần thiết.
  const options = useMemo<Options>(
    () => ({
      locale: Vietnamese,
      dateFormat: "d/m/Y",
      allowInput: false,
      clickOpens: true,
      disableMobile: true,
      monthSelectorType: "dropdown",
      position: "auto center",
      appendTo: typeof document === "undefined" ? undefined : document.body,
    }),
    [],
  )

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
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        options={options}
        onReady={(_dates, _dateStr, instance) => {
          instance.input.readOnly = true
          instance.input.setAttribute("inputmode", "none")
          instance.input.setAttribute("autocomplete", "off")
        }}
        onOpen={(_dates, _dateStr, instance) => {
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
            else if (displayValue) instance.setDate(displayValue, false)
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
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onChange(undefined)
          }}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Xóa ngày</span>
        </Button>
      ) : null}
    </div>
  )
}
