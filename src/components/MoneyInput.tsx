import { useEffect, useMemo, useState } from "react"
import { Input, type InputProps } from "@/components/ui/input"
import { formatVndNumber, parseVndInput } from "@/lib/currency"
import { cn } from "@/lib/utils"

type MoneyInputProps = Omit<InputProps, "value" | "onChange" | "type"> & {
  value: number
  onValueChange: (next: number) => void
}

export default function MoneyInput({
  value,
  onValueChange,
  inputMode = "numeric",
  className,
  ...props
}: MoneyInputProps) {
  const formatted = useMemo(
    () => (value > 0 ? formatVndNumber(value) : ""),
    [value],
  )
  const [text, setText] = useState(formatted)

  useEffect(() => setText(formatted), [formatted])

  return (
    <Input
      {...props}
      inputMode={inputMode}
      className={cn("text-right tabular-nums", className)}
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
        setText(next > 0 ? formatVndNumber(next) : "")
        onValueChange(next)
      }}
    />
  )
}
