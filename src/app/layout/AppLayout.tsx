import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import AppOverlays from "@/app/layout/AppOverlays"
import { MobileAppBar, MobileBottomNav } from "@/app/layout/MobileNavigation"
import SideNav from "@/app/layout/SideNav"
import { useAppStore } from "@/store/useAppStore"

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

  // Khung ứng dụng cao đúng bằng viewport và tự khóa cuộn: document KHÔNG cuộn, chỉ <main> cuộn
  // nội bộ. Chiều cao dùng `h-full` (= 100%) dựa trên chuỗi % html→body→#root đã khóa ở
  // index.css, nên hoàn toàn không phụ thuộc việc trình duyệt có hỗ trợ đơn vị dvh/vh hay không.
  // Cùng với `body { overflow: hidden }`, điều này loại bỏ hẳn thanh cuộn thứ hai và khoảng hở
  // dưới sidebar ở các trang dài như /settings.
  const mainContainerClassName =
    "flex-1 min-h-0 w-full overflow-x-hidden overflow-y-auto px-3 sm:px-5 lg:px-6 pt-2 sm:pt-6 pb-2 sm:pb-6"

  return (
    <div className="h-full w-full max-w-[100vw] overflow-hidden bg-background">
      <div className="flex h-full w-full max-w-full">
        <SideNav
          className="hidden md:flex"
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />

        <div className="min-w-0 min-h-0 flex-1 flex flex-col">
          <MobileAppBar />

          <main className={mainContainerClassName}>
            <Outlet />
          </main>
          <MobileBottomNav />
        </div>
      </div>
      <AppOverlays />
    </div>
  )
}

