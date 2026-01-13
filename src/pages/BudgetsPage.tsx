import { useMemo, useState, type ReactNode } from "react"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import LabelValueRow from "@/components/LabelValueRow"
import MonthPicker from "@/components/MonthPicker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { computeBudgets } from "@/domain/finance/finance"
import type { YearMonth } from "@/domain/types"
import { formatVnd } from "@/lib/currency"
import { dayOfMonthFromIsoDate, daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"

function InfoTip({ children, label = "Giải thích" }: { children: ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          aria-label={label}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  )
}

export default function BudgetsPage() {
  const data = useAppStore((s) => s.data)
  const [month, setMonth] = useState<YearMonth>(monthFromIsoDate(todayIso()))

  const totals = useMemo(() => getMonthTotals(data, month), [data, month])

  const adjustment = data.budgetAdjustmentsByMonth[month] ?? null
  const budgets = computeBudgets({
    incomeVnd: data.settings.monthlyIncomeVnd,
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    rule: data.settings.budgetRule,
    adjustment,
    customSavingsGoalVnd: data.settings.customSavingsGoalVnd,
  })
  const spendingBudgetVnd = Math.max(0, budgets.incomeVnd - budgets.savingsTargetVnd)
  const actualSavingsBalanceVnd = data.settings.actualSavingsBalanceVnd ?? 0

  const needsActual = totals.fixedCostsTotal + totals.variableNeeds
  const wantsActual = totals.variableWants
  const now = todayIso()
  const currentMonth = monthFromIsoDate(now)
  const dim = daysInMonth(month)
  const dom =
    month === currentMonth ? dayOfMonthFromIsoDate(now) : month < currentMonth ? dim : 1
  const isCurrentMonth = month === currentMonth
  const needsPace = dom > 0 ? totals.variableNeeds / dom : 0
  const wantsPace = dom > 0 ? totals.variableWants / dom : 0
  const projectedNeedsEndMonthVnd = isCurrentMonth
    ? Math.max(budgets.essentialVariableBaselineVnd, Math.round(needsPace * dim))
    : totals.variableNeeds
  const projectedWantsEndMonthVnd = isCurrentMonth
    ? Math.round(wantsPace * dim)
    : totals.variableWants
  const projectedVariableEndMonthVnd =
    projectedNeedsEndMonthVnd + projectedWantsEndMonthVnd
  const expectedVariableRemainingVnd = Math.max(
    0,
    projectedVariableEndMonthVnd - totals.variableTotal,
  )
  const projectedSavingsVnd = Math.trunc(
    budgets.incomeVnd - totals.fixedCostsTotal - projectedVariableEndMonthVnd,
  )

  const needsProgress =
    budgets.needsBudgetVnd > 0 ? (needsActual / budgets.needsBudgetVnd) * 100 : 0
  const wantsProgress =
    budgets.wantsBudgetVnd > 0 ? (wantsActual / budgets.wantsBudgetVnd) * 100 : 0
  const projectedSavingsRate = budgets.incomeVnd > 0 ? projectedSavingsVnd / budgets.incomeVnd : 0
  const projectedSavingsGoalRate =
    budgets.savingsTargetVnd > 0 ? projectedSavingsVnd / budgets.savingsTargetVnd : 0
  const savingsProgress = Math.max(0, Math.min(100, projectedSavingsGoalRate * 100))

  const needsRemaining = budgets.needsBudgetVnd - needsActual
  const wantsRemaining = budgets.wantsBudgetVnd - wantsActual
  const totalRemaining = spendingBudgetVnd - totals.totalSpent

  const overspent =
    needsRemaining < 0 || wantsRemaining < 0 || totalRemaining < 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ngân sách</h1>
        <p className="text-sm text-muted-foreground">
          Khung tháng này theo I, F, E. Sau khi trừ F và E từ I, phần còn lại được chia cho W (Mong muốn) và S (Tiết kiệm) và theo dõi thực chi.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Thu nhập tháng: <span className="font-medium text-foreground whitespace-nowrap tabular-nums">{formatVnd(budgets.incomeVnd)}</span>{" "}
          • Chia phần còn lại: Mong muốn {budgets.split.wantsPct}% / Tiết kiệm {budgets.split.savingsPct}%
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">Tháng</div>
          <MonthPicker value={month} onChange={setMonth} className="w-[160px]" />
        </div>
      </div>

      {overspent ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Cảnh báo: đang vượt ngân sách</div>
          <div className="text-muted-foreground">
            Hãy xem mục “Phương án phục hồi” trong popup khi ghi chi tiêu, hoặc siết Mong muốn và đặt cap/ngày.
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cố định + thiết yếu (F + E)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <LabelValueRow
              label="Kế hoạch (F + E)"
              value={formatVnd(budgets.needsBudgetVnd)}
            />
            <LabelValueRow label="Thực chi (F + E)" value={formatVnd(needsActual)} />
            <Progress value={Math.min(100, needsProgress)} />
            <LabelValueRow
              label="Còn lại"
              value={formatVnd(needsRemaining)}
              valueClassName={cn(needsRemaining < 0 && "text-destructive")}
            />
            <div className="text-xs text-muted-foreground">
              F (cố định):{" "}
              <span className="whitespace-nowrap tabular-nums">
                {formatVnd(totals.fixedCostsTotal)}
              </span>{" "}
              • E baseline:{" "}
              <span className="whitespace-nowrap tabular-nums">
                {formatVnd(budgets.essentialVariableBaselineVnd)}
              </span>{" "}
              • E đã chi:{" "}
              <span className="whitespace-nowrap tabular-nums">
                {formatVnd(totals.variableNeeds)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mong muốn (W)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <LabelValueRow label="Kế hoạch" value={formatVnd(budgets.wantsBudgetVnd)} />
            <LabelValueRow label="Thực chi" value={formatVnd(wantsActual)} />
            <Progress value={Math.min(100, wantsProgress)} />
            <LabelValueRow
              label="Còn lại"
              value={formatVnd(wantsRemaining)}
              valueClassName={cn(wantsRemaining < 0 && "text-destructive")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tiết kiệm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-3">
              <div className="text-sm font-medium">Mục tiêu &amp; An toàn</div>
            {actualSavingsBalanceVnd > 0 ? (
              <LabelValueRow
                label="Số dư tiết kiệm/đầu tư (thực tế)"
                labelTrailing={
                  <InfoTip>
                    <div className="font-medium">Số dư tiết kiệm/đầu tư (thực tế)</div>
                    <div className="text-muted-foreground">
                      Đây là số dư bạn tự nhập trong Cài đặt. Con số này là <span className="font-medium">tiền đang có</span>, không phải dự báo và không ảnh hưởng đến “Dự kiến tiết kiệm cuối tháng”.
                    </div>
                  </InfoTip>
                }
                value={formatVnd(actualSavingsBalanceVnd)}
              />
            ) : null}

            <LabelValueRow
              label="Kế hoạch tiết kiệm tháng này (S)"
              labelTrailing={
                <InfoTip>
                  <div className="font-medium">Kế hoạch tiết kiệm tháng này (S)</div>
                  <div className="text-muted-foreground">
                    Đây là phần bạn dự kiến để dành trong tháng, lấy từ phần còn lại sau khi trừ chi phí cố định (F) và thiết yếu (E) từ thu nhập (I).
                  </div>
                </InfoTip>
              }
              value={formatVnd(budgets.savingsTargetVnd)}
            />
            {budgets.savingsTargetShortfallVnd > 0 ? (
              <div className="text-xs text-destructive">
                Không đủ phần còn lại (sau khi trừ F và E) để đạt MSS/mục tiêu tiết kiệm — thiếu{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {formatVnd(budgets.savingsTargetShortfallVnd)}
                </span>
                .
              </div>
            ) : null}

            <LabelValueRow
              label="Tiết kiệm tối thiểu cần giữ (MSS)"
              labelTrailing={
                <InfoTip>
                  <div className="font-medium">Tiết kiệm tối thiểu cần giữ</div>
                  <div className="text-muted-foreground">
                    Mức này giúp bạn giữ “vùng an toàn” tài chính. Không nên dùng cho mua sắm thông thường.
                  </div>
                  <Separator className="my-2" />
                  <div className="text-muted-foreground">
                    MSS = max(5% × Thu nhập tháng, 300.000).
                  </div>
                </InfoTip>
              }
              value={formatVnd(budgets.mssVnd)}
            />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-sm font-medium">Dự báo nếu giữ nhịp hiện tại</div>

            <LabelValueRow
              label="Dự báo tiết kiệm cuối tháng (ước tính)"
              labelTrailing={
                <InfoTip>
                  <div className="font-medium">Dự báo tiết kiệm cuối tháng (ước tính)</div>
                  <div className="text-muted-foreground">
                    Đây là ước tính dựa trên nhịp chi tiêu biến đổi hiện tại. Không phải tiền đang có trong tài khoản và không nên xem như tiền có thể chi ngay.
                  </div>
                  <Separator className="my-2" />
                  <div className="text-muted-foreground">
                    ProjectedSavings = Thu nhập − Cố định − E dự kiến − W dự kiến.
                  </div>
                  <div className="text-muted-foreground">
                    E dự kiến = max(E baseline, E theo nhịp); W dự kiến = W theo nhịp hiện tại.
                  </div>
                </InfoTip>
              }
              value={formatVnd(projectedSavingsVnd)}
              valueClassName={cn(
                projectedSavingsVnd < 0 && "text-destructive",
                budgets.savingsTargetVnd > 0 &&
                  projectedSavingsVnd < budgets.savingsTargetVnd &&
                  "text-destructive",
              )}
            />

            <div className="rounded-md bg-muted/40 p-3 space-y-2 text-xs">
              <LabelValueRow
                className="text-xs"
                label="Cố định (F)"
                value={formatVnd(totals.fixedCostsTotal)}
              />
              <LabelValueRow
                className="text-xs"
                label="Biến đổi đã chi (E + W)"
                value={formatVnd(totals.variableTotal)}
              />
              <LabelValueRow
                className="text-xs"
                label="Thiết yếu dự kiến (E)"
                value={formatVnd(projectedNeedsEndMonthVnd)}
              />
              <LabelValueRow
                className="text-xs"
                label="Mong muốn dự kiến (W)"
                value={formatVnd(projectedWantsEndMonthVnd)}
              />
              <LabelValueRow
                className="text-xs"
                label="Biến đổi còn lại dự kiến"
                value={formatVnd(expectedVariableRemainingVnd)}
              />
              <div className="text-muted-foreground">
                Đây là ước tính (dự báo), không phải tiền có thể chi ngay.
              </div>
            </div>

            <div className="space-y-2">
              <LabelValueRow
                className="text-xs"
                label="Dự báo đạt mục tiêu S (ước tính)"
                labelTrailing={
                  <InfoTip>
                    <div className="font-medium">Dự báo đạt mục tiêu S</div>
                    <div className="text-muted-foreground">
                      S là mục tiêu tiết kiệm tháng. Tỷ lệ = Dự báo tiết kiệm / S.
                    </div>
                    <Separator className="my-2" />
                    <div className="text-muted-foreground">
                      Tỷ lệ tiết kiệm/thu nhập (ước tính):{" "}
                      <span className="whitespace-nowrap tabular-nums">
                        {(projectedSavingsRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </InfoTip>
                }
                value={
                  budgets.savingsTargetVnd > 0
                    ? `${(projectedSavingsGoalRate * 100).toFixed(1)}%`
                    : "—"
                }
                valueClassName={cn(projectedSavingsGoalRate < 1 && "text-destructive")}
              />
              <Progress value={savingsProgress} />
            </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kế hoạch vs thực chi tổng</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <LabelValueRow
            label="Ngân sách chi (I - mục tiêu tiết kiệm)"
            value={formatVnd(spendingBudgetVnd)}
          />
          <LabelValueRow label="Tổng chi" value={formatVnd(totals.totalSpent)} />
          <Separator />
          <LabelValueRow
            label="Còn lại"
            value={formatVnd(totalRemaining)}
            valueClassName={cn(totalRemaining < 0 && "text-destructive")}
          />
        </CardContent>
      </Card>
    </div>
  )
}
