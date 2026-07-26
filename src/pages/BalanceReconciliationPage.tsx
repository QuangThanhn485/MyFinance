import { AlertTriangle, Check, CircleDollarSign, Equal, Save, Scale, WalletCards } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import DatePicker from "@/components/DatePicker"
import MoneyInput from "@/components/MoneyInput"
import MonthPicker from "@/components/MonthPicker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { computeAccountReconciliation } from "@/domain/finance/accountReconciliation"
import { computeBudgets } from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import type { ISODate, YearMonth } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import { daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import {
  getFixedCostPaymentSummary,
  getMonthToDateTotals,
  getMonthTotals,
} from "@/selectors/expenses"
import { getEmergencyFundMonthSummary } from "@/selectors/savings"
import { useAppStore } from "@/store/useAppStore"

function defaultAsOfDate(month: YearMonth, currentDate: ISODate): ISODate {
  const currentMonth = monthFromIsoDate(currentDate)
  if (month === currentMonth) return currentDate
  if (month < currentMonth) return `${month}-${String(daysInMonth(month)).padStart(2, "0")}` as ISODate
  return `${month}-01` as ISODate
}

function SignedMoney({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value < 0 && "text-destructive",
        value > 0 && "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {value > 0 ? "+" : ""}{formatVnd(value)}
    </span>
  )
}

export default function BalanceReconciliationPage() {
  const data = useAppStore((state) => state.data)
  const saveReconciliation = useAppStore(
    (state) => state.actions.saveAccountBalanceReconciliation,
  )
  const currentDate = todayIso()
  const currentMonth = monthFromIsoDate(currentDate)
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(currentMonth)

  const settings = useMemo(
    () => getEffectiveSettingsForMonth(data, selectedMonth),
    [data, selectedMonth],
  )
  const plannedIncomeVnd = getMonthlyIncomeTotalVnd(settings)
  const [asOfDate, setAsOfDate] = useState<ISODate>(() =>
    defaultAsOfDate(currentMonth, currentDate),
  )
  const [actualBalanceVnd, setActualBalanceVnd] = useState(0)
  const [incomeReceivedVnd, setIncomeReceivedVnd] = useState(plannedIncomeVnd)
  const [hasActualBalance, setHasActualBalance] = useState(false)

  useEffect(() => {
    const monthSaved = data.accountBalanceReconciliationsByMonth[selectedMonth]
    setAsOfDate(monthSaved?.asOfDate ?? defaultAsOfDate(selectedMonth, currentDate))
    setActualBalanceVnd(monthSaved?.actualBalanceVnd ?? 0)
    setIncomeReceivedVnd(monthSaved?.incomeReceivedVnd ?? getMonthlyIncomeTotalVnd(settings))
    setHasActualBalance(Boolean(monthSaved))
  }, [currentDate, data.accountBalanceReconciliationsByMonth, selectedMonth, settings])

  const monthTotals = useMemo(
    () => getMonthTotals(data, selectedMonth),
    [data, selectedMonth],
  )
  const fixedCosts = useMemo(
    () => getFixedCostPaymentSummary(data, selectedMonth),
    [data, selectedMonth],
  )
  const spendingToDate = useMemo(
    () => getMonthToDateTotals(data, asOfDate).variableTotalToDateVnd,
    [asOfDate, data],
  )
  const emergency = useMemo(
    () => getEmergencyFundMonthSummary(data, selectedMonth),
    [data, selectedMonth],
  )
  const emergencyToDate = useMemo(() => {
    let depositedVnd = 0
    let withdrawnVnd = 0
    for (const transaction of emergency.transactions) {
      if (transaction.date > asOfDate) continue
      if (transaction.type === "deposit") depositedVnd += transaction.amountVnd
      else withdrawnVnd += transaction.amountVnd
    }
    return { depositedVnd, withdrawnVnd }
  }, [asOfDate, emergency.transactions])
  const budgets = useMemo(
    () =>
      computeBudgets({
        incomeVnd: plannedIncomeVnd,
        fixedCostsVnd: monthTotals.fixedCostsTotal,
        essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
        rule: settings.budgetRule,
        adjustment: getEffectiveBudgetAdjustmentForMonth(data, selectedMonth),
        customSavingsGoalVnd: settings.customSavingsGoalVnd,
      }),
    [data, monthTotals.fixedCostsTotal, plannedIncomeVnd, selectedMonth, settings],
  )
  const variableBudgetVnd =
    Math.max(0, budgets.needsBudgetVnd - budgets.fixedCostsVnd) + budgets.wantsBudgetVnd

  const result = useMemo(
    () =>
      computeAccountReconciliation({
        emergencyOpeningVnd: emergency.openingBalanceVnd,
        emergencyDepositedVnd: emergencyToDate.depositedVnd,
        emergencyWithdrawnVnd: emergencyToDate.withdrawnVnd,
        plannedIncomeVnd,
        incomeReceivedVnd,
        fixedCostsPlannedVnd: fixedCosts.plannedVnd,
        fixedCostsPaidVnd: fixedCosts.paidVnd,
        variableBudgetVnd,
        variableSpentVnd: spendingToDate,
        savingsTargetVnd: budgets.savingsTargetVnd,
        actualBalanceVnd,
      }),
    [
      actualBalanceVnd,
      budgets.savingsTargetVnd,
      emergency.openingBalanceVnd,
      emergencyToDate.depositedVnd,
      emergencyToDate.withdrawnVnd,
      fixedCosts.paidVnd,
      fixedCosts.plannedVnd,
      incomeReceivedVnd,
      plannedIncomeVnd,
      spendingToDate,
      variableBudgetVnd,
    ],
  )

  const fixedCostRows = useMemo(
    () =>
      data.entities.fixedCosts.allIds
        .map((id) => data.entities.fixedCosts.byId[id])
        .filter((item) => item?.active && item.month === selectedMonth)
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [data.entities.fixedCosts, selectedMonth],
  )

  const handleSave = () => {
    if (monthFromIsoDate(asOfDate) !== selectedMonth) {
      toast.error(`Ngày đối soát phải thuộc tháng ${selectedMonth}.`)
      return
    }
    saveReconciliation({
      month: selectedMonth,
      asOfDate,
      actualBalanceVnd,
      incomeReceivedVnd,
    })
    setHasActualBalance(true)
    toast.success("Đã lưu kết quả đối soát.")
  }

  const statusLabel = result.status === "matched"
    ? "Khớp số dư"
    : result.status === "surplus"
      ? "Thực tế dư hơn app"
      : "Thực tế thấp hơn app"

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Đối soát số dư</h1>
          <p className="text-sm text-muted-foreground">So sánh toàn bộ tiền trong app với tổng số dư tài khoản thực tế.</p>
        </div>
        <MonthPicker
          value={selectedMonth}
          onChange={setSelectedMonth}
          className="w-full sm:w-52"
          ariaLabel="Chọn tháng đối soát"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-muted-foreground" />
              Số liệu thực tế
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Ngày đối soát</Label>
              <DatePicker
                value={asOfDate}
                onChange={(value) => value && setAsOfDate(value)}
                minDate={`${selectedMonth}-01` as ISODate}
                maxDate={`${selectedMonth}-${String(daysInMonth(selectedMonth)).padStart(2, "0")}` as ISODate}
              />
            </div>
            <div className="grid gap-2">
              <Label>Tổng số dư thực tế của tất cả tài khoản</Label>
              <MoneyInput
                value={actualBalanceVnd}
                onValueChange={(value) => {
                  setActualBalanceVnd(value)
                  setHasActualBalance(true)
                }}
                placeholder="Nhập số dư ngân hàng và tiền mặt"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Thu nhập đã thực nhận trong tháng</Label>
                <span className="text-xs text-muted-foreground">Kế hoạch {formatVnd(plannedIncomeVnd)}</span>
              </div>
              <MoneyInput
                value={incomeReceivedVnd}
                onValueChange={setIncomeReceivedVnd}
                placeholder="Số tiền đã thực nhận"
              />
            </div>
            <Button type="button" onClick={handleSave} disabled={!hasActualBalance}>
              <Save className="h-4 w-4" />
              Lưu đối soát
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-muted-foreground" />
                Kết quả
              </span>
              {hasActualBalance ? (
                <Badge variant={result.status === "deficit" ? "destructive" : result.status === "matched" ? "secondary" : "outline"}>
                  {statusLabel}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasActualBalance ? (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
                Nhập tổng số dư thực tế để bắt đầu đối soát.
              </div>
            ) : (
              <div className="space-y-4">
                <div className={cn(
                  "rounded-md border px-4 py-5",
                  result.status === "deficit" && "border-destructive/40 bg-destructive/5",
                  result.status === "surplus" && "border-emerald-500/40 bg-emerald-500/5",
                )}>
                  <div className="text-sm text-muted-foreground">Chênh lệch thực tế - hệ thống</div>
                  <div className={cn(
                    "mt-1 text-2xl font-bold tabular-nums sm:text-3xl",
                    result.differenceVnd < 0 && "text-destructive",
                    result.differenceVnd > 0 && "text-emerald-700 dark:text-emerald-400",
                  )}>
                    {result.differenceVnd > 0 ? "+" : ""}{formatVnd(result.differenceVnd)}
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Số dư hệ thống</span>
                  <span className="font-semibold tabular-nums">{formatVnd(result.expectedBalanceVnd)}</span>
                  <span className="text-muted-foreground">Số dư thực tế</span>
                  <span className="font-semibold tabular-nums">{formatVnd(result.actualBalanceVnd)}</span>
                </div>
                <Separator />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {result.calculationBalanced ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                  Kiểm tra chéo công thức: {result.calculationBalanced ? "khớp tuyệt đối" : "không khớp"}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
              Cấu phần số dư hệ thống
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
              <span>Quỹ khẩn cấp hiện có</span>
              <SignedMoney value={result.emergencyBalanceVnd} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
              <span>Tiết kiệm tháng còn trong tài khoản</span>
              <SignedMoney value={result.monthlySavingsBalanceVnd} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
              <span>Chi phí cố định chưa thanh toán</span>
              <SignedMoney value={result.fixedCostsBalanceVnd} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
              <span>Ngân sách có thể chi còn lại</span>
              <SignedMoney value={result.variableSpendingBalanceVnd} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
              <span>Thu nhập thực nhận so với tổng phân bổ</span>
              <SignedMoney value={result.incomeAllocationDifferenceVnd} />
            </div>
            <Separator />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-2">
              <span className="font-semibold">Số dư hệ thống</span>
              <span className="text-lg font-bold tabular-nums">{formatVnd(result.expectedBalanceVnd)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Equal className="h-5 w-5 text-muted-foreground" />
              Chi phí cố định
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">Kế hoạch</div>
                <div className="mt-1 font-semibold tabular-nums">{formatVnd(fixedCosts.plannedVnd)}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">Đã chi</div>
                <div className="mt-1 font-semibold tabular-nums">{formatVnd(fixedCosts.paidVnd)}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">Còn lại</div>
                <div className={cn("mt-1 font-semibold tabular-nums", fixedCosts.remainingVnd < 0 && "text-destructive")}>
                  {formatVnd(fixedCosts.remainingVnd)}
                </div>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
              {fixedCostRows.map((fixedCost) => (
                <div key={fixedCost.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-2 last:border-0">
                  <span className="truncate">{fixedCost.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatVnd(fixedCost.paidAmountVnd ?? 0)} / {formatVnd(fixedCost.amountVnd)}
                  </span>
                </div>
              ))}
              {fixedCosts.debtPlannedVnd > 0 || fixedCosts.debtPaidVnd > 0 ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-2 last:border-0">
                  <span className="truncate">Trả nợ hàng tháng</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatVnd(fixedCosts.debtPaidVnd)} / {formatVnd(fixedCosts.debtPlannedVnd)}
                  </span>
                </div>
              ) : null}
              {fixedCostRows.length === 0 && fixedCosts.debtPlannedVnd === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
                  Tháng này chưa có chi phí cố định.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
