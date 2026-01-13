import { Navigate, Route, Routes } from "react-router-dom"
import AppLayout from "@/app/layout/AppLayout"
import AdvisorPage from "@/pages/AdvisorPage"
import BudgetsPage from "@/pages/BudgetsPage"
import DashboardPage from "@/pages/DashboardPage"
import ExpensesPage from "@/pages/ExpensesPage"
import ImportExportPage from "@/pages/ImportExportPage"
import ReportsPage from "@/pages/ReportsPage"
import SettingsPage from "@/pages/SettingsPage"

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/budgets" element={<BudgetsPage />} />
        <Route path="/advisor" element={<AdvisorPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/import-export" element={<ImportExportPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

