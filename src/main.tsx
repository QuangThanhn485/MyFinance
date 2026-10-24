import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { Toaster } from "sonner"
import { DataSourceProvider } from "@/app/DataSourceProvider"
import App from "@/app/App"
import { ThemeProvider, useTheme } from "@/app/theme/ThemeProvider"
import { startLedger } from "@/ledger/appLedger"
import { initializeTheme } from "@/lib/theme"
import "flatpickr/dist/flatpickr.css"
import "flatpickr/dist/plugins/monthSelect/style.css"
import "@/index.css"

initializeTheme()

// Toaster nằm NGOÀI DataSourceProvider để thông báo lỗi đồng bộ luôn hiển thị được,
// kể cả khi cây ứng dụng chưa mount.
function AppToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme}
      richColors
      position="top-right"
      duration={2500}
      visibleToasts={2}
      closeButton={false}
      offset={{ top: 72, right: 16 }}
      toastOptions={{
        className:
          "pointer-events-none max-w-[360px] w-[calc(100vw-1.5rem)] sm:w-auto",
      }}
    />
  )
}

// Mở sổ cái (IndexedDB) và đổ dữ liệu vào store TRƯỚC khi render: không thao tác nào có thể
// chạy trên dữ liệu chưa tải xong. startLedger không bao giờ reject.
void startLedger().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <DataSourceProvider>
            <App />
          </DataSourceProvider>
          <AppToaster />
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>,
  )
})
