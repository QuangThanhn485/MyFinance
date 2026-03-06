import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { NavLink, useLocation } from "react-router-dom"
import {
  ArrowLeftRight,
  BarChart3,
  ChevronRight,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PiggyBank,
  Receipt,
  Settings,
  ShoppingCart,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import ThemeToggle from "@/components/ThemeToggle"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type NavLeaf = {
  id: string
  type: "leaf"
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
}

type NavGroup = {
  id: string
  type: "group"
  label: string
  icon: ComponentType<{ className?: string }>
  children: NavLeaf[]
}

type NavNode = NavLeaf | NavGroup

const NAV_TREE: NavNode[] = [
  {
    id: "dashboard",
    type: "leaf",
    label: "Tổng quan",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "manage",
    type: "group",
    label: "Quản lý",
    icon: Wallet,
    children: [
      {
        id: "expenses",
        type: "leaf",
        label: "Ghi chi tiêu",
        to: "/expenses",
        icon: Receipt,
      },
      {
        id: "budgets",
        type: "leaf",
        label: "Ngân sách",
        to: "/budgets",
        icon: PiggyBank,
      },
    ],
  },
  {
    id: "analyze",
    type: "group",
    label: "Phân tích",
    icon: BarChart3,
    children: [
      {
        id: "advisor",
        type: "leaf",
        label: "Tư vấn mua sắm",
        to: "/advisor",
        icon: ShoppingCart,
      },
      {
        id: "reports",
        type: "leaf",
        label: "Báo cáo",
        to: "/reports",
        icon: BarChart3,
      },
    ],
  },
  {
    id: "system",
    type: "group",
    label: "Hệ thống",
    icon: Settings,
    children: [
      {
        id: "settings",
        type: "leaf",
        label: "Cài đặt",
        to: "/settings",
        icon: Settings,
      },
      {
        id: "import-export",
        type: "leaf",
        label: "Xuất/Nhập",
        to: "/import-export",
        icon: ArrowLeftRight,
      },
    ],
  },
]

function containsRoute(group: NavGroup, pathname: string) {
  return group.children.some((child) => pathname === child.to || pathname.startsWith(`${child.to}/`))
}

function getDefaultOpenGroups(pathname: string) {
  const open: Record<string, boolean> = {}
  NAV_TREE.forEach((node) => {
    if (node.type === "group") {
      open[node.id] = containsRoute(node, pathname)
    }
  })
  return open
}

function NavRow({
  label,
  icon: Icon,
  to,
  collapsed,
  onNavigate,
  depth = 0,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  to: string
  collapsed: boolean
  onNavigate?: () => void
  depth?: number
}) {
  return (
    <NavLink
      to={to}
      title={label}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-transparent",
          depth > 0 ? "text-[13px] font-medium" : "text-sm font-medium",
          collapsed ? "justify-center px-2" : "justify-start",
          isActive
            ? "bg-primary/10 text-foreground shadow-sm before:bg-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "flex items-center justify-center rounded-lg transition-colors",
              depth > 0 ? "h-7 w-7" : "h-8 w-8",
              isActive
                ? "bg-primary/15 text-primary"
                : "bg-muted/30 text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "shrink-0",
                depth > 0 ? "h-4 w-4" : "h-[18px] w-[18px]",
                collapsed ? "opacity-95" : "",
              )}
            />
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-left", collapsed ? "sr-only" : "")}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  )
}

export default function SideNav({
  collapsed,
  onCollapsedChange,
  onNavigate,
  className,
}: {
  collapsed: boolean
  onCollapsedChange?: (next: boolean) => void
  onNavigate?: () => void
  className?: string
}) {
  const location = useLocation()

  const initialOpen = useMemo(() => getDefaultOpenGroups(location.pathname), [])
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen)
  const [collapsedPopoverGroupId, setCollapsedPopoverGroupId] = useState<string | null>(null)
  const collapsedPopoverCloseTimerRef = useRef<number | null>(null)

  const clearCollapsedPopoverCloseTimer = () => {
    if (collapsedPopoverCloseTimerRef.current === null) return
    window.clearTimeout(collapsedPopoverCloseTimerRef.current)
    collapsedPopoverCloseTimerRef.current = null
  }

  const scheduleCollapsedPopoverClose = () => {
    clearCollapsedPopoverCloseTimer()
    collapsedPopoverCloseTimerRef.current = window.setTimeout(() => {
      setCollapsedPopoverGroupId(null)
    }, 120)
  }

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev }
      NAV_TREE.forEach((node) => {
        if (node.type !== "group") return
        if (containsRoute(node, location.pathname)) {
          next[node.id] = true
        }
      })
      return next
    })
  }, [location.pathname])

  const widthClass = collapsed ? "w-[72px]" : "w-[240px]"

  return (
    <aside
      className={cn(
        "h-dvh sticky top-0 border-r bg-muted/20 backdrop-blur supports-[backdrop-filter]:bg-background/70",
        "flex flex-col shrink-0 transition-[width] duration-200",
        widthClass,
        className,
      )}
    >
      <div
        className={cn(
          "h-14 flex items-center",
          collapsed ? "justify-center px-2" : "gap-2 px-3",
        )}
      >
        {!collapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shadow-sm">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">
              Chi Tiêu Thông Minh
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              Quản lý chi tiêu cá nhân
            </div>
          </div>
        </div>
        ) : null}

        {onCollapsedChange ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
            title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </Button>
        ) : null}
      </div>

      <Separator />

      <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-1.5" : "px-2.5")}>
        <div className="space-y-1.5">
          {NAV_TREE.map((node) => {
            if (node.type === "leaf") {
              return (
                <NavRow
                  key={node.id}
                  label={node.label}
                  icon={node.icon}
                  to={node.to}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              )
            }

            const groupActive = containsRoute(node, location.pathname)
            const isOpen = openGroups[node.id] ?? false
            const GroupIcon = node.icon

            if (collapsed) {
              const open = collapsedPopoverGroupId === node.id
              return (
                <Popover
                  key={node.id}
                  open={open}
                  onOpenChange={(nextOpen) =>
                    setCollapsedPopoverGroupId(nextOpen ? node.id : null)
                  }
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      title={node.label}
                      onPointerEnter={() => {
                        clearCollapsedPopoverCloseTimer()
                        setCollapsedPopoverGroupId(node.id)
                      }}
                      onPointerLeave={() => scheduleCollapsedPopoverClose()}
                      className={cn(
                        "group relative w-full flex items-center gap-2 rounded-lg px-2 py-2 transition-colors justify-center",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-transparent",
                        groupActive
                          ? "bg-primary/10 text-foreground shadow-sm before:bg-primary"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                          groupActive || open
                            ? "bg-primary/15 text-primary"
                            : "bg-muted/30 text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
                        )}
                      >
                        <GroupIcon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="sr-only">{node.label}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={8}
                    className="w-64 p-2"
                    onPointerEnter={() => clearCollapsedPopoverCloseTimer()}
                    onPointerLeave={() => scheduleCollapsedPopoverClose()}
                  >
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                      {node.label}
                    </div>
                    <Separator className="my-1" />
                    <div className="space-y-1">
                      {node.children.map((child) => (
                        <NavRow
                          key={child.id}
                          label={child.label}
                          icon={child.icon}
                          to={child.to}
                          collapsed={false}
                          onNavigate={() => {
                            setCollapsedPopoverGroupId(null)
                            onNavigate?.()
                          }}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )
            }

            return (
              <div key={node.id} className="pt-2">
                <button
                  type="button"
                  title={node.label}
                  onClick={() =>
                    setOpenGroups((s) => ({
                      ...s,
                      [node.id]: !(s[node.id] ?? false),
                    }))
                  }
                  className={cn(
                    "group w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold tracking-wide transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "justify-start",
                    isOpen || groupActive
                      ? "bg-muted/40 text-foreground"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      isOpen || groupActive
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/30 text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
                    )}
                  >
                    <GroupIcon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{node.label}</span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 opacity-70 transition-transform duration-200",
                      isOpen ? "rotate-90" : "rotate-0",
                    )}
                  />
                </button>

                {isOpen ? (
                  <div className="mt-1 ml-3 border-l border-border/60 pl-3 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="space-y-1">
                      {node.children.map((child) => (
                        <NavRow
                          key={child.id}
                          label={child.label}
                          icon={child.icon}
                          to={child.to}
                          collapsed={collapsed}
                          onNavigate={onNavigate}
                          depth={1}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </nav>

      <Separator />

      <div className={cn("py-2", collapsed ? "px-1.5" : "px-2.5")}>
        <ThemeToggle compact={collapsed} />
      </div>

      <Separator />

      <div
        className={cn(
          "px-3 py-2 text-[11px] text-muted-foreground",
          collapsed ? "hidden" : "block",
        )}
      >
        Mẹo: dùng menu để chuyển nhanh giữa các màn hình.
      </div>
    </aside>
  )
}
