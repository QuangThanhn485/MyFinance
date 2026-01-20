import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { Toaster } from "sonner"
import App from "@/app/App"
import "flatpickr/dist/themes/airbnb.css"
import "flatpickr/dist/plugins/monthSelect/style.css"
import "@/index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
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
    </BrowserRouter>
  </React.StrictMode>,
)
