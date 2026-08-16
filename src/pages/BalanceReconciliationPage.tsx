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
import { resolveAccountReconciliationForm } from "@/domain/finance/accountReconciliation"
import {
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import type { ISODate, YearMonth } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import { daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { getAccountReconciliation } from "@/selectors/accountReconciliation"
import { getFixedCostPaymentSummary } from "@/selectors/expenses"
import { useAppStore } from "@/store/useAppStore"

function SignedMoney({ value }: { value: number }) {
  const normalizedValue = Object.is(value, -0) ? 0 : value
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        normalizedValue < 0 && "text-destructive",
        normalizedValue > 0 && "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {normalizedValue > 0 ? "+" : ""}{formatVnd(normalizedValue)}
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
  const initialForm = resolveAccountReconciliationForm({
    selectedMonth: currentMonth,
    currentMonth,
    currentDate,
    plannedIncomeVnd,
    saved: data.accountBalanceReconciliationsByMonth[currentMonth],
  })
  const [asOfDate, setAsOfDate] = useState<ISODate>(initialForm.asOfDate)
  const [actualBalanceVnd, setActualBalanceVnd] = useState(initialForm.actualBalanceVnd)
  const [incomeReceivedVnd, setIncomeReceivedVnd] = useState(initialForm.incomeReceivedVnd)
  const [hasActualBalance, setHasActualBalance] = useState(initialForm.hasActualBalance)

  const resolvedForm = useMemo(
    () => resolveAccountReconciliationForm({
      selectedMonth,
      currentMonth,
      currentDate,
      plannedIncomeVnd,
      saved: data.accountBalanceReconciliationsByMonth[selectedMonth],
    }),
    [
      currentDate,
      currentMonth,
      data.accountBalanceReconciliationsByMonth,
      plannedIncomeVnd,
      selectedMonth,
    ],
  )

  useEffect(() => {
    setAsOfDate(resolvedForm.asOfDate)
    setActualBalanceVnd(resolvedForm.actualBalanceVnd)
    setIncomeReceivedVnd(resolvedForm.incomeReceivedVnd)
    setHasActualBalance(resolvedForm.hasActualBalance)
  }, [resolvedForm])

  const canCalculate =
    hasActualBalance && monthFromIsoDate(asOfDate) === selectedMonth

  const fixedCosts = useMemo(
    () => canCalculate ? getFixedCostPaymentSummary(data, selectedMonth) : null,
    [canCalculate, data, selectedMonth],
  )

  const result = useMemo(
    () => {
      if (!canCalculate) return null
      return getAccountReconciliation(data, {
        month: selectedMonth,
        asOfDate,
        actualBalanceVnd,
        incomeReceivedVnd,
      })
    },
    [
      actualBalanceVnd,
      asOfDate,
      canCalculate,
      data,
      incomeReceivedVnd,
      selectedMonth,
    ],
  )

  const fixedCostRows = useMemo(
    () => {
      if (!canCalculate) return []
      return data.entities.fixedCosts.allIds
        .map((id) => data.entities.fixedCosts.byId[id])
        .filter((item) => item?.active && item.month === selectedMonth)
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    },
    [canCalculate, data.entities.fixedCosts, selectedMonth],
  )

  const handleSave = () => {
    if (monthFromIsoDate(asOfDate) !== selectedMonth) {
      toast.error(`Ngày đối soát phải thuộc tháng ${selectedMonth}.`)
      return
    }
    if (!hasActualBalance || !result) {
      toast.error("Hãy nhập tổng số dư thực tế trước khi lưu đối soát.")
      return
    }
    saveReconciliation({
      month: selectedMonth,
      asOfDate,
      actualBalanceVnd,
      actualBalanceConfirmed: true,
      incomeReceivedVnd,
      calculationSnapshot: {
        emergencyOpeningVnd: result.emergencyOpeningVnd,
        emergencyDepositedVnd: result.emergencyDepositedVnd,
        emergencyWithdrawnVnd: result.emergencyWithdrawnVnd,
        plannedIncomeVnd: result.plannedIncomeVnd,
        fixedCostsPlannedVnd: result.fixedCostsPlannedVnd,
        fixedCostsPaidVnd: result.fixedCostsPaidVnd,
        variableBudgetVnd: result.variableBudgetVnd,
        variableSpentVnd: result.variableSpentVnd,
        savingsTargetVnd: result.savingsTargetVnd,
      },
    })
    setHasActualBalance(true)
    toast.success("Đã lưu kết quả đối soát.")
  }

  const statusLabel = result
    ? result.status === "matched"
      ? "Khớp số dư"
      : result.status === "surplus"
        ? "Thực tế dư hơn app"
        : "Thực tế thấp hơn app"
    : null

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
                minDate={selectedMonth === currentMonth ? currentDate : `${selectedMonth}-01` as ISODate}
                maxDate={selectedMonth === currentMonth
                  ? currentDate
                  : `${selectedMonth}-${String(daysInMonth(selectedMonth)).padStart(2, "0")}` as ISODate}
              />
            </div>
            <div className="grid gap-2">
              <Label>Tổng số dư thực tế của tất cả tài khoản</Label>
              <MoneyInput
                value={actualBalanceVnd}
                showZero={hasActualBalance}
                onValueChange={(value) => {
                  setActualBalanceVnd(value)
                  setHasActualBalance(true)
                }}
                onEmpty={() => {
                  setActualBalanceVnd(0)
                  setHasActualBalance(false)
                }}
                placeholder="Nhập số dư ngân hàng và tiền mặt"
              />
              {resolvedForm.hasStaleCurrentMonthSave ? (
                <div className="text-xs text-amber-700 dark:text-amber-400">
                  Bản đối soát gần nhất (ngày {data.accountBalanceReconciliationsByMonth[selectedMonth]?.asOfDate.split("-").reverse().join("/")}) chưa có số dư thực tế hợp lệ cho hôm nay; hãy nhập lại số dư.
                </div>
              ) : null}
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
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canCalculate}
            >
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
              {result ? (
                <Badge variant={result.status === "deficit" ? "destructive" : result.status === "matched" ? "secondary" : "outline"}>
                  {statusLabel}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
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

      {result && fixedCosts ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
              Số liệu hệ thống tại ngày đối soát
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Quỹ khẩn cấp hiện có</div>
                <div className="mt-1 truncate text-base font-semibold tabular-nums" title={formatVnd(result.emergencyBalanceVnd)}>
                  {formatVnd(result.emergencyBalanceVnd)}
                </div>
                <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  Đầu {formatVnd(result.emergencyOpeningVnd)} · Nạp {formatVnd(result.emergencyDepositedVnd)} · Rút {formatVnd(result.emergencyWithdrawnVnd)}
                </div>
              </div>
              <div className="min-w-0 bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Tiết kiệm tháng đang giữ</div>
                <div className={cn(
                  "mt-1 truncate text-base font-semibold tabular-nums",
                  result.monthlySavingsBalanceVnd < 0 && "text-destructive",
                )} title={formatVnd(result.monthlySavingsBalanceVnd)}>
                  {formatVnd(result.monthlySavingsBalanceVnd)}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Mục tiêu {formatVnd(result.savingsTargetVnd)}
                </div>
              </div>
              <div className="min-w-0 bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Phí cố định còn phải trả</div>
                <div className={cn(
                  "mt-1 truncate text-base font-semibold tabular-nums",
                  result.fixedCostsBalanceVnd < 0 && "text-destructive",
                )} title={formatVnd(result.fixedCostsBalanceVnd)}>
                  {formatVnd(result.fixedCostsBalanceVnd)}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Đã trả {formatVnd(result.fixedCostsPaidVnd)}
                </div>
              </div>
              <div className="min-w-0 bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Ngân sách có thể chi còn lại</div>
                <div className={cn(
                  "mt-1 truncate text-base font-semibold tabular-nums",
                  result.variableSpendingBalanceVnd < 0 && "text-destructive",
                )} title={formatVnd(result.variableSpendingBalanceVnd)}>
                  {formatVnd(result.variableSpendingBalanceVnd)}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Đã ghi {formatVnd(result.variableSpentVnd)} / {formatVnd(result.variableBudgetVnd)}
                </div>
              </div>
            </div>

            <Separator />
            <div className="text-xs font-medium uppercase text-muted-foreground">Dòng tiền dùng để đối soát</div>
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <span className="text-muted-foreground">Quỹ khẩn cấp tại ngày đối soát</span>
                <SignedMoney value={result.emergencyBalanceVnd} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <span className="text-muted-foreground">Thu nhập đã thực nhận</span>
                <SignedMoney value={result.incomeReceivedVnd} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <span className="text-muted-foreground">Chi phí cố định đã trả</span>
                <SignedMoney value={-result.fixedCostsPaidVnd} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <span className="text-muted-foreground">Chi tiêu đã ghi nhận</span>
                <SignedMoney value={-result.variableSpentVnd} />
              </div>
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
      ) : null}
    </div>
  )
}
