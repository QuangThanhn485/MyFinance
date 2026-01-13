import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type LabelValueRowProps = {
  label: ReactNode
  value: ReactNode
  labelTitle?: string
  labelTrailing?: ReactNode
  className?: string
  labelClassName?: string
  valueClassName?: string
  align?: "center" | "start"
}

export default function LabelValueRow({
  label,
  value,
  labelTitle,
  labelTrailing,
  className,
  labelClassName,
  valueClassName,
  align = "center",
}: LabelValueRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-3",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            labelClassName,
          )}
          title={labelTitle}
        >
          {label}
        </div>
        {labelTrailing ? <div className="shrink-0">{labelTrailing}</div> : null}
      </div>
      <div
        className={cn(
          "whitespace-nowrap font-medium tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  )
}

