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
      <Toaster richColors closeButton />
    </BrowserRouter>
  </React.StrictMode>,
)
