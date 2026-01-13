import { useState } from "react"
import { toast } from "sonner"
import { CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import { computeBudgets, computeEmergencyFund, computeMinimumSafetySavings } from "@/domain/finance/finance"
import type { ExpenseCategory } from "@/domain/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import LabelValueRow from "@/components/LabelValueRow"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import MoneyInput from "@/components/MoneyInput"
import { formatVnd } from "@/lib/currency"
import { addDaysIsoDate, dayOfMonthFromIsoDate, daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { getExpensesByDate, getMonthTotals } from "@/selectors/expenses"
import { useAppStore } from "@/store/useAppStore"
import { cn } from "@/lib/utils"

export default function DashboardPage() {
  const data = useAppStore((s) => s.data)
  const addExpense = useAppStore((s) => s.actions.addExpense)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const totals = getMonthTotals(data, month)
  const todayExpenses = getExpensesByDate(data, today)
  const todaySpent = todayExpenses.reduce((sum, ex) => sum + ex.amountVnd, 0)

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIsoDate(today, -i))
  const weekSpent = weekDates.reduce(
    (sum, date) => sum + getExpensesByDate(data, date).reduce((s2, ex) => s2 + ex.amountVnd, 0),
    0,
  )

  const adjustment = data.budgetAdjustmentsByMonth[month] ?? null
  const budgets = computeBudgets({
    incomeVnd: data.settings.monthlyIncomeVnd,
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    rule: data.settings.budgetRule,
    adjustment,
    customSavingsGoalVnd: data.settings.customSavingsGoalVnd,
  })
  const savingsMin = budgets.savingsTargetVnd
  const MSS = computeMinimumSafetySavings(budgets.incomeVnd)
  const spendingBudgetVnd = Math.max(0, budgets.incomeVnd - savingsMin)

  const essentialRemaining = budgets.essentialVariableBaselineVnd - totals.variableNeeds
  const wantsRemaining = budgets.wantsBudgetVnd - totals.variableWants
  const totalRemaining = spendingBudgetVnd - totals.totalSpent

  const dim = daysInMonth(month)
  const dom = dayOfMonthFromIsoDate(today)
  const daysRemaining = Math.max(0, dim - dom)
  const recommendedDailyCap =
    daysRemaining > 0 ? Math.floor(Math.max(0, totalRemaining) / daysRemaining) : 0

  const caps = data.capsByMonth[month]
  const shownDailyCap = caps?.dailyTotalCapVnd ?? recommendedDailyCap

  const emergency = computeEmergencyFund({
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    targetMonths: data.settings.emergencyFundTargetMonths,
    currentBalanceVnd: data.settings.emergencyFundCurrentVnd,
  })
  const emergencyProgress =
    emergency.targetVnd > 0
      ? Math.min(100, (emergency.currentVnd / emergency.targetVnd) * 100)
      : 0

  const wantsFreezeActive =
    caps?.wantsFreezeUntil && today <= caps.wantsFreezeUntil ? true : false

  const [quickAmountVnd, setQuickAmountVnd] = useState(0)
  const [quickCategory, setQuickCategory] = useState<ExpenseCategory>("Food")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tổng quan</h1>
        <p className="text-sm text-muted-foreground">
          Theo dõi chi tiêu hôm nay, tháng này và giới hạn an toàn cho những ngày
          còn lại.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Hôm nay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm">
              <LabelValueRow label="Đã chi hôm nay" value={formatVnd(todaySpent)} />
              <LabelValueRow label="7 ngày gần nhất" value={formatVnd(weekSpent)} />
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Thêm nhanh</div>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>Số tiền (VND)</Label>
                  <MoneyInput
                    placeholder="Ví dụ: 35.000"
                    value={quickAmountVnd}
                    onValueChange={setQuickAmountVnd}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Danh mục</Label>
                  <Select
                    value={quickCategory}
                    onValueChange={(v) => setQuickCategory(v as ExpenseCategory)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn danh mục" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS_VI[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    const amountVnd = quickAmountVnd
                    if (amountVnd <= 0) {
                      toast.error("Vui lòng nhập số tiền hợp lệ.")
                      return
                    }
                    addExpense({
                      amountVnd,
                      category: quickCategory,
                      date: today,
                      note: "Hôm nay chi",
                    })
                    setQuickAmountVnd(0)
                    toast.success("Đã ghi chi tiêu.")
                  }}
                >
                  Hôm nay chi
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tháng này</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm">
              <LabelValueRow label="Đã chi (tháng đến nay)" value={formatVnd(totals.totalSpent)} />
              <LabelValueRow label="Ngân sách chi (tháng)" value={formatVnd(spendingBudgetVnd)} />
              <LabelValueRow
                label="Còn lại"
                value={formatVnd(totalRemaining)}
                valueClassName={cn(totalRemaining < 0 && "text-destructive")}
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm space-y-2">
              <LabelValueRow
                label={`Cap chi tiêu/ngày (${daysRemaining} ngày còn lại)`}
                labelTitle={`Cap chi tiêu/ngày (${daysRemaining} ngày còn lại)`}
                value={formatVnd(shownDailyCap)}
                valueClassName="text-base font-semibold"
              />
              {caps?.dailyTotalCapVnd != null ? (
                <div className="text-xs text-muted-foreground">
                  (đang áp dụng cap đã đặt)
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quỹ khẩn cấp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm">
              <LabelValueRow label="Hiện có" value={formatVnd(emergency.currentVnd)} />
              <LabelValueRow label="Mục tiêu" value={formatVnd(emergency.targetVnd)} />
              <LabelValueRow
                label="Phủ được"
                value={
                  Number.isFinite(emergency.coverageMonths)
                    ? `${emergency.coverageMonths.toFixed(1)} tháng`
                    : "—"
                }
              />
              <LabelValueRow label="Trạng thái" value={emergency.status} />
            </div>
            <Progress value={emergencyProgress} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Khung tháng này (F/E/W)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-2">
              <LabelValueRow
                label="Cố định (F — đã ghi nhận đầu tháng)"
                value={formatVnd(totals.fixedCostsTotal)}
              />
              <LabelValueRow
                label="Thiết yếu biến đổi (E) còn lại"
                value={formatVnd(essentialRemaining)}
                valueClassName={cn(essentialRemaining < 0 && "text-destructive")}
              />
              <LabelValueRow
                label="Mong muốn (W) còn lại"
                value={formatVnd(wantsRemaining)}
                valueClassName={cn(wantsRemaining < 0 && "text-destructive")}
              />
              {wantsFreezeActive ? (
                <div className="text-xs text-destructive">
                  Đang đóng băng Mong muốn đến {caps?.wantsFreezeUntil}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nhắc nhanh</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <div>
              Nếu cảm thấy “rò rỉ” (nhiều khoản nhỏ), hãy đặt cap Mong muốn/ngày và ưu tiên bữa ăn/di chuyển tối giản.
            </div>
            <LabelValueRow
              className="text-sm"
              label="MSS (tiết kiệm tối thiểu cần giữ)"
              value={formatVnd(MSS)}
              labelClassName="text-muted-foreground"
              valueClassName="text-foreground"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
