import Flatpickr from "react-flatpickr"
import { CalendarIcon } from "lucide-react"
import monthSelectPlugin from "flatpickr/dist/plugins/monthSelect"
import { Vietnamese } from "flatpickr/dist/l10n/vn"
import { useTheme } from "@/app/theme/ThemeProvider"
import type { YearMonth } from "@/domain/types"
import { cn } from "@/lib/utils"

type MonthPickerProps = {
  value: YearMonth
  onChange: (next: YearMonth) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

function parseYearMonthLocal(month: YearMonth): Date {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return new Date(year, m - 1, 1)
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
  ariaLabel = "Chọn tháng",
}: MonthPickerProps) {
  const selected = parseYearMonthLocal(value)
  const { resolvedTheme } = useTheme()
  const monthSelectTheme = resolvedTheme === "dark" ? "dark" : "light"

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
        value={selected}
        disabled={disabled}
        aria-label={ariaLabel}
        options={{
          locale: Vietnamese,
          plugins: [
            monthSelectPlugin({
              shorthand: true,
              dateFormat: "m/Y",
              altFormat: "m/Y",
              theme: monthSelectTheme,
            }),
          ],
          allowInput: true,
          clickOpens: true,
          disableMobile: true,
          position: "auto center",
        }}
        onChange={(dates, _dateStr, instance) => {
          const date = dates?.[0]
          if (!date) {
            instance.setDate(selected, false)
            return
          }
          onChange(formatYearMonth(date))
        }}
        className="h-full w-full rounded-md border-0 bg-transparent px-3 py-2 pl-10 text-sm tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  )
}
