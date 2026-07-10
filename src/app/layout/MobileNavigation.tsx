import { NavLink, useLocation } from "react-router-dom"
import {
  BarChart3,
  Database,
  LayoutDashboard,
  MoreHorizontal,
  PiggyBank,
  Receipt,
  Settings,
  ShoppingCart,
  Tags,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { useState, type ComponentType } from "react"
import ThemeToggle from "@/components/ThemeToggle"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type MobileNavItem = {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
}

const PRIMARY_NAV_ITEMS: MobileNavItem[] = [
  { label: "Tổng quan", to: "/dashboard", icon: LayoutDashboard },
  { label: "Ngân sách", to: "/budgets", icon: PiggyBank },
  { label: "Ghi chi", to: "/expenses", icon: Receipt },
  { label: "Báo cáo", to: "/reports", icon: BarChart3 },
]

const MORE_NAV_ITEMS: MobileNavItem[] = [
  { label: "Tư vấn mua sắm", to: "/advisor", icon: ShoppingCart },
  { label: "Nâng cap ngày", to: "/daily-cap-planner", icon: TrendingUp },
  { label: "Cài đặt", to: "/settings", icon: Settings },
  { label: "Danh mục", to: "/categories", icon: Tags },
  { label: "Dữ liệu", to: "/import-export", icon: Database },
]

function isActiveRoute(pathname: string, to: string) {
  if (to === "/import-export" && pathname === "/data") return true
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function MobileAppBar() {
  return (
    <header className="md:hidden w-screen max-w-[100vw] shrink-0 overflow-hidden border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-12 items-center gap-2.5 px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight tracking-tight">
            Chi Tiêu Thông Minh
          </div>
          <div className="hidden truncate text-[11px] leading-tight text-muted-foreground min-[390px]:block">
            Quản lý chi tiêu cá nhân
          </div>
        </div>
        <ThemeToggle compact className="h-8 w-8" />
      </div>
    </header>
  )
}

function BottomNavLink({
  item,
  prominent = false,
}: {
  item: MobileNavItem
  prominent?: boolean
}) {
  const Icon = item.icon

  if (prominent) {
    return (
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          cn(
            "relative -top-2 flex min-w-0 w-full flex-col items-center justify-start gap-1 text-[11px] font-semibold leading-none transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isActive ? "text-primary" : "text-foreground active:text-primary",
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-lg transition-transform",
                isActive
                  ? "scale-105 border-primary bg-primary text-primary-foreground shadow-primary/30"
                  : "border-primary/40 bg-primary text-primary-foreground shadow-primary/25 active:scale-95",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
            </span>
            <span className="sr-only">{item.label}</span>
          </>
        )}
      </NavLink>
    )
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "flex min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium leading-none transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground active:bg-muted/70",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "h-5 w-5 shrink-0",
              item.to === "/expenses" && isActive ? "scale-110" : "",
            )}
          />
          <span className="max-w-full truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

export function MobileBottomNav() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE_NAV_ITEMS.some((item) => isActiveRoute(location.pathname, item.to))

  return (
    <>
      <nav className="z-40 w-screen max-w-[100vw] shrink-0 overflow-visible border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto grid h-[58px] w-full max-w-lg grid-cols-5 items-stretch gap-1 px-2 py-1">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <BottomNavLink key={item.to} item={item} prominent={item.to === "/expenses"} />
          ))}
          <button
            type="button"
            aria-label="Mở thêm chức năng"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium leading-none transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              moreActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground active:bg-muted/70",
            )}
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" />
            <span className="max-w-full truncate">Thêm</span>
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent
          className="bottom-0 left-0 right-0 top-auto max-h-[82dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 p-0 sm:max-w-none"
          aria-label="Thêm chức năng"
        >
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <DialogTitle className="pr-8 text-base">Thêm chức năng</DialogTitle>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {MORE_NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const active = isActiveRoute(location.pathname, item.to)

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-card active:bg-muted/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                        active ? "bg-primary/15" : "bg-muted/50 text-muted-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
