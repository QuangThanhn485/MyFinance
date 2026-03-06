import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { Toaster } from "sonner"
import App from "@/app/App"
import { ThemeProvider, useTheme } from "@/app/theme/ThemeProvider"
import { initializeTheme } from "@/lib/theme"
import "flatpickr/dist/flatpickr.css"
import "flatpickr/dist/plugins/monthSelect/style.css"
import "@/index.css"

initializeTheme()

function AppShell() {
  const { resolvedTheme } = useTheme()
  return (
    <>
      <App />
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
    </>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
