import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import LabelValueRow from "@/components/LabelValueRow"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"
import { getEffectiveSettingsForMonth } from "@/domain/finance/monthLock"

function SeverityBadge({ severity }: { severity: "nhẹ" | "trung bình" | "mạnh" }) {
  const variant =
    severity === "nhẹ" ? "secondary" : severity === "trung bình" ? "outline" : "destructive"
  const label =
    severity === "nhẹ" ? "Nhẹ" : severity === "trung bình" ? "Trung bình" : "Mạnh"
  return <Badge variant={variant}>{label}</Badge>
}

export default function OverspendingModal() {
  const data = useAppStore((s) => s.data)
  const overspending = useAppStore((s) => s.ui.overspending)
  const applyRecoveryOption = useAppStore((s) => s.actions.applyRecoveryOption)
  const clearOverspending = useAppStore((s) => s.actions.clearOverspending)

  if (!overspending) return null
  const settingsForMonth = getEffectiveSettingsForMonth(data, overspending.month)
  const actualSavingsBalanceVnd = settingsForMonth.actualSavingsBalanceVnd ?? 0

  const recommended =
    overspending.options.find((o) => o.id === overspending.recommendedOptionId) ??
    overspending.options[0]
  const flexibleEmergencyBorrowVnd = Math.max(
    0,
    actualSavingsBalanceVnd - overspending.why.mssVnd,
  )

  return (
    <Dialog open onOpenChange={(open) => !open && clearOverspending()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cảnh báo an toàn (MSS)</DialogTitle>
          <DialogDescription>
            <div className="space-y-1">
              <div>{overspending.alertText}</div>
              <div className="text-xs text-muted-foreground">
                Chỉ tính chi biến đổi; chi phí cố định chỉ dùng để tính ngân sách tháng.
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <LabelValueRow
              label="Tiền còn lại cuối tháng (dự báo)"
              labelTitle="Tiền còn lại cuối tháng (dự báo)"
              value={formatVnd(overspending.why.projectedEndMonthBalanceVnd)}
              valueClassName={cn(
                overspending.why.projectedEndMonthBalanceVnd <
                  overspending.why.mssVnd && "text-destructive",
              )}
            />
            <LabelValueRow
              label="MSS (mức tối thiểu cần giữ)"
              labelTitle="MSS (mức tối thiểu cần giữ)"
              value={formatVnd(overspending.why.mssVnd)}
            />
            <LabelValueRow
              label="Thiếu MSS (dự báo)"
              labelTitle="Thiếu MSS (dự báo)"
              value={formatVnd(overspending.why.mssDeficitVnd)}
              valueClassName="text-destructive"
            />
            <LabelValueRow
              label="Đã chi (biến đổi) đến hôm nay"
              labelTitle="Đã chi (biến đổi) đến hôm nay"
              value={formatVnd(overspending.why.variableSpentToDateVnd)}
            />
            <LabelValueRow
              className="sm:col-span-2"
              label="Còn có thể chi (biến đổi) để giữ MSS"
              labelTitle="Còn có thể chi (biến đổi) để giữ MSS"
              value={formatVnd(
                Math.max(0, overspending.why.variableRemainingToKeepMssVnd),
              )}
              valueClassName={cn(
                overspending.why.variableRemainingToKeepMssVnd < 0 &&
                  "text-destructive",
              )}
            />
            {overspending.why.variableRemainingToKeepMssVnd < 0 ? (
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                Bạn đã vượt mức chi để vẫn giữ MSS trong tháng này khoảng{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {formatVnd(
                    Math.abs(overspending.why.variableRemainingToKeepMssVnd),
                  )}
                </span>
                .
              </div>
            ) : null}
          </div>

          {actualSavingsBalanceVnd > 0 ? (
            <details className="rounded-md border bg-background p-3 text-sm">
              <summary className="cursor-pointer select-none font-medium">
                Vùng linh hoạt (chỉ khi khẩn cấp)
              </summary>
              <div className="mt-3 space-y-2">
                <div className="text-sm text-muted-foreground">
                  Đây là phần <span className="font-medium">tiền thực tế</span> bạn tự nhập ở Cài đặt. Chỉ xem như phương án khẩn cấp (không phải dự báo).
                </div>
                <LabelValueRow
                  label="Số dư tiết kiệm/đầu tư (thực tế)"
                  labelTitle="Số dư tiết kiệm/đầu tư (thực tế)"
                  value={formatVnd(actualSavingsBalanceVnd)}
                />
                <LabelValueRow label="MSS" value={formatVnd(overspending.why.mssVnd)} />
                <LabelValueRow
                  label="Trên MSS (có thể mượn)"
                  labelTitle="Trên MSS (có thể mượn)"
                  value={formatVnd(flexibleEmergencyBorrowVnd)}
                />
              </div>
            </details>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SeverityBadge severity={overspending.why.severity} />
            <span className="text-muted-foreground">
              Cần giảm trung bình mỗi ngày còn lại để giữ MSS:
            </span>
            <span className="font-medium whitespace-nowrap tabular-nums">
              {formatVnd(overspending.why.requiredDailyCutVnd)}
            </span>
            <span className="text-muted-foreground">
              (còn {overspending.why.daysRemaining} ngày)
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Button
              onClick={() => {
                const res = applyRecoveryOption({
                  month: overspending.month,
                  option: recommended,
                })
                if (!res.ok) {
                  toast.error(res.error)
                  return
                }
                toast.success("Đã áp dụng phương án khuyến nghị.")
                clearOverspending()
              }}
            >
              Áp dụng phương án khuyến nghị
            </Button>
            <Button variant="outline" onClick={() => clearOverspending()}>
              Đóng
            </Button>
          </div>

          <div className="grid gap-4">
            {overspending.options.map((option) => {
              const isRecommended = option.id === overspending.recommendedOptionId
              return (
                <Card
                  key={option.id}
                  className={cn(isRecommended && "border-primary")}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{option.title}</CardTitle>
                      {isRecommended ? <Badge>Khuyến nghị</Badge> : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {option.summary}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 text-sm">
                      <div className="rounded-md bg-muted p-3">
                        <div className="text-muted-foreground">Tiền còn lại cuối tháng</div>
                        <div
                          className={cn(
                            "font-medium whitespace-nowrap tabular-nums",
                            option.impact.projectedEndMonthBalanceVnd < overspending.why.mssVnd &&
                              "text-destructive",
                          )}
                        >
                          {formatVnd(option.impact.projectedEndMonthBalanceVnd)}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted p-3">
                        <div className="text-muted-foreground">So với MSS</div>
                        <div className="font-medium">
                          {option.impact.projectedEndMonthBalanceVnd >=
                          overspending.why.mssVnd ? (
                            "ĐẠT MSS"
                          ) : (
                            <span>
                              Thiếu{" "}
                              <span className="whitespace-nowrap tabular-nums">
                                {formatVnd(
                                  Math.max(
                                    0,
                                    overspending.why.mssVnd -
                                      option.impact.projectedEndMonthBalanceVnd,
                                  ),
                                )}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {option.warnings?.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="font-medium text-destructive">Cảnh báo</div>
                        <ul className="list-disc pl-5 text-muted-foreground">
                          {option.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {option.impact.notes?.length ? (
                      <ul className="text-sm text-muted-foreground list-disc pl-5">
                        {option.impact.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div>
                      <Button
                        variant={isRecommended ? "default" : "secondary"}
                        onClick={() => {
                          const res = applyRecoveryOption({
                            month: overspending.month,
                            option,
                          })
                          if (!res.ok) {
                            toast.error(res.error)
                            return
                          }
                          toast.success("Đã áp dụng phương án.")
                          clearOverspending()
                        }}
                      >
                        Áp dụng phương án
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
