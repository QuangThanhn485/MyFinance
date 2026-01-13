import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/dashboard", label: "Tổng quan" },
  { to: "/expenses", label: "Ghi chi tiêu" },
  { to: "/budgets", label: "Ngân sách" },
  { to: "/advisor", label: "Tư vấn mua sắm" },
  { to: "/reports", label: "Báo cáo" },
  { to: "/settings", label: "Cài đặt" },
  { to: "/import-export", label: "Xuất/Nhập" },
]

export default function TopNav() {
  return (
    <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-3">
        <div className="font-semibold tracking-tight whitespace-nowrap">
          Chi Tiêu Thông Minh
        </div>
        <nav className="flex-1 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-2 text-sm rounded-md transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}
