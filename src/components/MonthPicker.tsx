import { useMemo } from "react"
import Flatpickr from "react-flatpickr"
import { CalendarIcon } from "lucide-react"
import monthSelectPlugin from "flatpickr/dist/plugins/monthSelect"
import { Vietnamese } from "flatpickr/dist/l10n/vn"
import type { Options } from "flatpickr/dist/types/options"
import { useTheme } from "@/app/theme/ThemeProvider"
import type { YearMonth } from "@/domain/types"
import { cn } from "@/lib/utils"

type MonthPickerProps = {
  value?: YearMonth
  onChange: (next: YearMonth) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
  placeholder?: string
}

/** Khớp với `dateFormat: "m/Y"` của monthSelectPlugin. */
function toDisplayMonth(month?: YearMonth): string {
  if (!month) return ""
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`
}

function formatYearMonth(date: Date): YearMonth {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}` as YearMonth
}

export default function MonthPicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = "Chọn tháng",
  ariaLabel = "Chọn tháng",
}: MonthPickerProps) {
  const { resolvedTheme } = useTheme()
  const monthSelectTheme = resolvedTheme === "dark" ? "dark" : "light"

  // react-flatpickr render input controlled (<input value={props.value?.toString()} />), nên truyền
  // Date sẽ đổ Date.toString() tiếng Anh vào ô input mỗi lần re-render. Truyền sẵn chuỗi m/Y.
  const displayValue = useMemo(() => toDisplayMonth(value), [value])

  // QUAN TRỌNG: `plugins` phải ổn định. Trước đây options (kèm monthSelectPlugin mới) được tạo lại
  // mỗi render -> react-flatpickr gọi flatpickr.set("plugins", ...) -> redraw() liên tục -> lưới
  // chọn tháng bị dựng lại/nhấp nháy và lag, chọn xong không dùng lại được.
  const options = useMemo<Options>(
    () => ({
      locale: Vietnamese,
      plugins: [
        monthSelectPlugin({
          shorthand: true,
          dateFormat: "m/Y",
          altFormat: "m/Y",
          theme: monthSelectTheme,
        }),
      ],
      // Input là controlled (React nắm `value`), nên cho gõ tay sẽ bị React ghi đè và react-flatpickr
      // dựng Date từ chuỗi dở dang. Chỉ chọn bằng lưới tháng.
      allowInput: false,
      clickOpens: true,
      disableMobile: true,
      position: "auto center",
    }),
    [monthSelectTheme],
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
        key={monthSelectTheme}
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        options={options}
        onReady={(_dates, _dateStr, instance) => {
          instance.input.readOnly = true
          instance.input.setAttribute("inputmode", "none")
          instance.input.setAttribute("autocomplete", "off")
        }}
        onChange={(dates, _dateStr, instance) => {
          const date = dates?.[0]
          if (!date) {
            if (displayValue) instance.setDate(displayValue, false)
            return
          }
          onChange(formatYearMonth(date))
        }}
        className={cn(
          "h-full w-full rounded-md border-0 bg-transparent px-3 py-2 pl-10 text-sm tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
          !value && "text-muted-foreground",
        )}
      />
    </div>
  )
}
