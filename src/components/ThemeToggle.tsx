import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/app/theme/ThemeProvider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { ThemePreference } from "@/lib/theme"

const THEME_OPTIONS: {
  value: ThemePreference
  label: string
  icon: typeof Sun
}[] = [
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
  { value: "system", label: "Theo hệ thống", icon: Monitor },
]

export default function ThemeToggle({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { preference, resolvedTheme, setPreference, toggleTheme } = useTheme()
  const CurrentIcon = resolvedTheme === "dark" ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={cn(compact ? "" : "w-full justify-start", className)}
          title={compact ? "Đổi giao diện" : undefined}
          aria-label="Đổi giao diện sáng/tối"
          onDoubleClick={(event) => {
            event.preventDefault()
            toggleTheme()
          }}
        >
          <CurrentIcon className="h-4 w-4" />
          {!compact ? <span>Giao diện</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "center" : "end"} className="w-44">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon
          const active = preference === option.value
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setPreference(option.value)}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
              </span>
              {active ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

