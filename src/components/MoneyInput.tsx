import { forwardRef, useEffect, useMemo, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Input, type InputProps } from "@/components/ui/input"
import { formatVndNumber, parseVndInput } from "@/lib/currency"
import { cn } from "@/lib/utils"

type MoneyInputProps = Omit<InputProps, "value" | "onChange" | "type"> & {
  value: number
  onValueChange: (next: number) => void
  showSteppers?: boolean
  stepVnd?: number
}

const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    value,
    onValueChange,
    inputMode = "numeric",
    className,
    showSteppers = false,
    stepVnd = 1000,
    ...props
  },
  ref,
) {
  const formatted = useMemo(
    () => (value > 0 ? formatVndNumber(value) : ""),
    [value],
  )
  const [text, setText] = useState(formatted)

  useEffect(() => setText(formatted), [formatted])

  const commitValue = (nextRaw: number) => {
    const next = Math.max(0, Math.trunc(Number.isFinite(nextRaw) ? nextRaw : 0))
    setText(next > 0 ? formatVndNumber(next) : "")
    onValueChange(next)
  }

  const input = (
    <Input
      ref={ref}
      {...props}
      inputMode={inputMode}
      className={cn("text-right tabular-nums", showSteppers && "border-0 text-center focus-visible:ring-0 focus-visible:ring-offset-0", className)}
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        const cleaned = raw.replace(/[^\d]/g, "")
        if (!cleaned) {
          setText("")
          onValueChange(0)
          return
        }
        const next = parseVndInput(raw)
        commitValue(next)
      }}
    />
  )

  if (showSteppers) {
    const step = Math.max(1, Math.trunc(stepVnd))
    return (
      <div
        className={cn(
          "grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          props.disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <button
          type="button"
          className="flex h-10 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          disabled={props.disabled || value <= 0}
          onClick={() => commitValue(value - step)}
          aria-label={`Giảm ${formatVndNumber(step)} đồng`}
        >
          <Minus className="h-4 w-4" />
        </button>
        {input}
        <button
          type="button"
          className="flex h-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          disabled={props.disabled}
          onClick={() => commitValue(value + step)}
          aria-label={`Tăng ${formatVndNumber(step)} đồng`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    input
  )
})

MoneyInput.displayName = "MoneyInput"

export default MoneyInput
