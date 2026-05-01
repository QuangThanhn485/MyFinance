import type { ReactNode } from "react"
import { BarChart3 } from "lucide-react"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"

export type ChartTooltipPayloadItem = {
  name?: string | number
  value?: string | number
  color?: string
  fill?: string
  stroke?: string
  dataKey?: string | number
}

type ChartTooltipContentProps = {
  active?: boolean
  payload?: ChartTooltipPayloadItem[]
  label?: string | number
  hideLabel?: boolean
  className?: string
  valueFormatter?: (value: number, item: ChartTooltipPayloadItem) => string
  nameFormatter?: (name: string, item: ChartTooltipPayloadItem) => string
  labelFormatter?: (label: string | number | undefined) => string
}

function defaultValueFormatter(value: number) {
  return formatVnd(value)
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel,
  className,
  valueFormatter = defaultValueFormatter,
  nameFormatter,
  labelFormatter,
}: ChartTooltipContentProps) {
  const rows = payload?.filter((item) => item.value !== undefined && item.value !== null) ?? []

  if (!active || rows.length === 0) return null

  return (
    <div
      className={cn(
        "max-h-[280px] min-w-[180px] max-w-[280px] overflow-auto rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg",
        className,
      )}
    >
      {!hideLabel && label !== undefined ? (
        <div className="mb-2 border-b pb-1.5 text-xs font-medium text-muted-foreground">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </div>
      ) : null}
      <div className="space-y-1.5">
        {rows.map((item, index) => {
          const rawValue = Number(item.value)
          const displayValue = Number.isFinite(rawValue)
            ? valueFormatter(rawValue, item)
            : String(item.value)
          const rawName = String(item.name ?? item.dataKey ?? "")
          const displayName = nameFormatter ? nameFormatter(rawName, item) : rawName
          const color = item.color ?? item.fill ?? item.stroke ?? "hsl(var(--primary))"

          return (
            <div key={`${rawName}-${index}`} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {displayName}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{displayValue}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ChartEmptyState({
  children = "Chưa có dữ liệu để vẽ biểu đồ.",
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      <div className="grid justify-items-center gap-2">
        <BarChart3 className="h-5 w-5" />
        <div>{children}</div>
      </div>
    </div>
  )
}

export const chartGridProps = {
  strokeDasharray: "3 3",
  vertical: false,
} as const

export const chartLegendProps = {
  iconType: "circle" as const,
  wrapperStyle: { paddingTop: 8, fontSize: 12 },
} as const
