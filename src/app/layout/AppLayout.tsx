import { Outlet } from "react-router-dom"
import TopNav from "@/app/layout/TopNav"
import AppOverlays from "@/app/layout/AppOverlays"

export default function AppLayout() {
  return (
    <div className="min-h-dvh bg-background">
      <TopNav />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
      <AppOverlays />
    </div>
  )
}
