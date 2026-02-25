import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import AppOverlays from "@/app/layout/AppOverlays"
import SideNav from "@/app/layout/SideNav"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useAppStore } from "@/store/useAppStore"
import { PanelLeftOpen } from "lucide-react"

const SIDEBAR_COLLAPSED_KEY = "smartSpend.ui.sidebarCollapsed.v1"

export default function AppLayout() {
  const autoClose = useAppStore((s) => s.actions.autoClosePreviousMonthIfNeeded)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
    } catch {
      return false
    }
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0")
    } catch {
      // ignore
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    autoClose()
    const timer = window.setInterval(() => {
      autoClose()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [autoClose])

  const mainContainerClassName = "flex-1 w-full px-3 sm:px-4 lg:px-6 py-4 sm:py-6"

  return (
    <div className="min-h-dvh bg-background">
      <div className="flex min-h-dvh">
        <SideNav
          className="hidden md:flex"
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />

        <div className="min-w-0 flex-1 flex flex-col">
          <header className="md:hidden sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="h-14 px-4 flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Mở menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <PanelLeftOpen className="h-5 w-5" />
              </Button>
              <div className="font-semibold tracking-tight truncate">
                Chi Tiêu Thông Minh
              </div>
            </div>
          </header>

          <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <DialogContent
              className="left-0 top-0 h-dvh w-[280px] max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-0 p-0 sm:max-w-[85vw]"
              aria-label="Menu"
            >
              <SideNav
                className="w-full"
                collapsed={false}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </DialogContent>
          </Dialog>

          <main className={mainContainerClassName}>
            <Outlet />
          </main>
        </div>
      </div>
      <AppOverlays />
    </div>
  )
}
