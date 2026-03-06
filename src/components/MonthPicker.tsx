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

export default function MonthPicker({ value, onChange, disabled, className }: MonthPickerProps) {
  const selected = parseYearMonthLocal(value)
  const { resolvedTheme } = useTheme()
  const monthSelectTheme = resolvedTheme === "dark" ? "dark" : "light"

  return (
    <div className="relative">
      <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Flatpickr
        key={monthSelectTheme}
        value={selected}
        disabled={disabled}
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
        }}
        onChange={(dates, _dateStr, instance) => {
          const date = dates?.[0]
          if (!date) {
            instance.setDate(selected, false)
            return
          }
          onChange(formatYearMonth(date))
        }}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
    </div>
  )
}
