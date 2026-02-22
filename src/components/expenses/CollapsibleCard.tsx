import type { ReactNode } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CollapsibleCardProps = {
  title: string
  icon?: ReactNode
  summary?: ReactNode
  collapsed: boolean
  onToggle: () => void
  className?: string
  contentClassName?: string
  headerActions?: ReactNode
  children?: ReactNode
}

export default function CollapsibleCard({
  title,
  icon,
  summary,
  collapsed,
  onToggle,
  className,
  contentClassName,
  headerActions,
  children,
}: CollapsibleCardProps) {
  if (collapsed) {
    return (
      <Card className={cn("h-full min-h-0", className)}>
        <div className="flex h-full min-h-0 flex-col items-center gap-2 px-1 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggle}
            aria-label={`Mở rộng ${title}`}
            aria-expanded={false}
            title={`Mở rộng ${title}`}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden">
            {icon ? (
              <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
            ) : null}
            <span
              className="max-h-full overflow-hidden text-[11px] font-semibold leading-none tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180"
              title={title}
            >
              {title}
            </span>
          </div>

          {typeof summary === "string" || typeof summary === "number" ? (
            <span className="sr-only">{summary}</span>
          ) : null}
        </div>
      </Card>
    )
  }

  return (
    <Card className={cn("h-full min-h-0 flex flex-col", className)}>
      <CardHeader className="py-3 px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="text-muted-foreground">{icon}</span> : null}
            <CardTitle className="truncate text-sm font-semibold">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onToggle}
              aria-label={`Thu gọn ${title}`}
              aria-expanded
              title={`Thu gọn ${title}`}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("flex-1 min-h-0 px-4 pb-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
