import { zodResolver } from "@hookform/resolvers/zod"
import { useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import { CATEGORY_LABELS_VI, EXPENSE_CATEGORIES } from "@/domain/constants"
import { computeDebtToIncome, computeEmergencyFund } from "@/domain/finance/finance"
import type { BudgetRule, ExpenseCategory } from "@/domain/types"
import MoneyInput from "@/components/MoneyInput"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import LabelValueRow from "@/components/LabelValueRow"
import { formatVnd } from "@/lib/currency"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"

export default function SettingsPage() {
  const data = useAppStore((s) => s.data)
  const setSettings = useAppStore((s) => s.actions.setSettings)
  const addFixedCost = useAppStore((s) => s.actions.addFixedCost)
  const updateFixedCost = useAppStore((s) => s.actions.updateFixedCost)
  const deleteFixedCost = useAppStore((s) => s.actions.deleteFixedCost)

  const fixedCosts = data.entities.fixedCosts.allIds
    .map((id) => data.entities.fixedCosts.byId[id])
    .filter(Boolean)

  const fixedCostsTotal = fixedCosts.reduce(
    (sum, fc) => sum + (fc.active ? fc.amountVnd : 0),
    0,
  )
  const fixedCostsWithDebtTotal = fixedCostsTotal + Math.max(0, Math.trunc(data.settings.debtPaymentMonthlyVnd ?? 0))

  const emergency = computeEmergencyFund({
    fixedCostsVnd: fixedCostsWithDebtTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    targetMonths: data.settings.emergencyFundTargetMonths,
    currentBalanceVnd: data.settings.emergencyFundCurrentVnd,
  })
  const debt = computeDebtToIncome({
    incomeVnd: data.settings.monthlyIncomeVnd,
    debtPaymentMonthlyVnd: data.settings.debtPaymentMonthlyVnd,
  })

  const ruleTypeDefault =
    data.settings.budgetRule.type === "custom"
      ? "custom"
      : data.settings.budgetRule.type

  const schema = z
    .object({
      monthlyIncomeVnd: z.coerce.number().int().nonnegative(),
      paydayDayOfMonth: z.coerce.number().int().min(1).max(31),
      debtPaymentMonthlyVnd: z.coerce.number().int().nonnegative(),
      emergencyFundTargetMonths: z.coerce.number().int().min(0).max(60),
      emergencyFundCurrentVnd: z.coerce.number().int().nonnegative(),
      actualSavingsBalanceVnd: z.coerce.number().int().nonnegative(),
      essentialVariableBaselineVnd: z.coerce.number().int().nonnegative(),
      customSavingsGoalVnd: z.coerce.number().int().nonnegative(),
      ruleType: z.enum(["50_30_20", "60_20_20", "custom"]),
      customWantsPct: z.coerce.number().int().min(0).max(100),
      customSavingsPct: z.coerce.number().int().min(0).max(100),
    })
    .superRefine((v, ctx) => {
      if (v.ruleType !== "custom") return
      const sum = v.customWantsPct + v.customSavingsPct
      if (sum !== 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mong muốn + Tiết kiệm phải có tổng = 100.",
          path: ["customWantsPct"],
        })
      }
    })

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      monthlyIncomeVnd: data.settings.monthlyIncomeVnd,
      paydayDayOfMonth: data.settings.paydayDayOfMonth,
      debtPaymentMonthlyVnd: data.settings.debtPaymentMonthlyVnd,
      emergencyFundTargetMonths: data.settings.emergencyFundTargetMonths,
      emergencyFundCurrentVnd: data.settings.emergencyFundCurrentVnd,
      actualSavingsBalanceVnd: data.settings.actualSavingsBalanceVnd ?? 0,
      essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
      customSavingsGoalVnd: data.settings.customSavingsGoalVnd ?? 0,
      ruleType: ruleTypeDefault as any,
      customWantsPct:
        data.settings.budgetRule.type === "custom"
          ? Math.round(
              (100 * data.settings.budgetRule.wantsPct) /
                Math.max(
                  1,
                  data.settings.budgetRule.wantsPct +
                    data.settings.budgetRule.savingsPct,
                ),
            )
          : data.settings.budgetRule.type === "60_20_20"
            ? 50
            : 60,
      customSavingsPct:
        data.settings.budgetRule.type === "custom"
          ? 100 -
            Math.round(
              (100 * data.settings.budgetRule.wantsPct) /
                Math.max(
                  1,
                  data.settings.budgetRule.wantsPct +
                    data.settings.budgetRule.savingsPct,
                ),
            )
          : data.settings.budgetRule.type === "60_20_20"
            ? 50
            : 40,
    },
  })

  const [newFcName, setNewFcName] = useState("")
  const [newFcAmountVnd, setNewFcAmountVnd] = useState(0)
  const [newFcCategory, setNewFcCategory] = useState<ExpenseCategory>("Bills")

  const ruleType = form.watch("ruleType")

  const [editingAmountId, setEditingAmountId] = useState<string | null>(null)
  const [editingAmountVnd, setEditingAmountVnd] = useState(0)
  const editingFixedCost = editingAmountId
    ? data.entities.fixedCosts.byId[editingAmountId]
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Thu nhập, chi phí cố định, quy tắc ngân sách và quỹ khẩn cấp.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thiết lập ban đầu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="grid gap-6"
            onSubmit={form.handleSubmit((values) => {
              let budgetRule: BudgetRule
              if (values.ruleType === "custom") {
                budgetRule = {
                  type: "custom",
                  wantsPct: values.customWantsPct,
                  savingsPct: values.customSavingsPct,
                  needsPct: 0,
                }
              } else {
                budgetRule = { type: values.ruleType }
              }

              setSettings({
                monthlyIncomeVnd: values.monthlyIncomeVnd,
                paydayDayOfMonth: values.paydayDayOfMonth,
                debtPaymentMonthlyVnd: values.debtPaymentMonthlyVnd,
                emergencyFundTargetMonths: values.emergencyFundTargetMonths,
                emergencyFundCurrentVnd: values.emergencyFundCurrentVnd,
                actualSavingsBalanceVnd: values.actualSavingsBalanceVnd,
                essentialVariableBaselineVnd: values.essentialVariableBaselineVnd,
                customSavingsGoalVnd: values.customSavingsGoalVnd > 0 ? values.customSavingsGoalVnd : null,
                budgetRule,
              })
              toast.success("Đã lưu cài đặt.")
            })}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Thu nhập ròng tháng (VND)</Label>
                <Controller
                  control={form.control}
                  name="monthlyIncomeVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 15.000.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <Label>Ngày nhận lương (1-31)</Label>
                <Input inputMode="numeric" {...form.register("paydayDayOfMonth")} />
              </div>
              <div className="grid gap-2">
                <Label>Trả nợ mỗi tháng (tuỳ chọn)</Label>
                <Controller
                  control={form.control}
                  name="debtPaymentMonthlyVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 800.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                <div className="text-xs text-muted-foreground">
                  Nợ/thu nhập:{" "}
                  <span
                    className={cn(
                      "font-medium",
                      debt.level === "red"
                        ? "text-destructive"
                        : debt.level === "yellow"
                          ? "text-amber-600"
                          : "text-foreground",
                    )}
                  >
                    {(debt.ratio * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Mục tiêu tiết kiệm theo kế hoạch (tuỳ chọn)</Label>
                <Controller
                  control={form.control}
                  name="customSavingsGoalVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 3.000.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                <div className="text-xs text-muted-foreground">
                  Nếu đặt, app sẽ dùng giá trị lớn hơn giữa mục tiêu này và phần “Tiết kiệm” theo tỷ lệ chia phần còn lại
                  (và không bao giờ thấp hơn MSS = max(5% × thu nhập, 300.000)).
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Số dư tiết kiệm/đầu tư đang có (thực tế — tuỳ chọn)</Label>
                <Controller
                  control={form.control}
                  name="actualSavingsBalanceVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 20.000.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                <div className="text-xs text-muted-foreground">
                  Số dư thực tế bạn đang có trong tài khoản tiết kiệm/đầu tư. Chỉ để theo dõi, không dùng để tính “Dự kiến tiết kiệm cuối tháng”.
                </div>
              </div>
            </div>

            <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Chia phần còn lại thành Mong muốn + Tiết kiệm</Label>
                <Select
                  value={ruleType}
                  onValueChange={(v) => form.setValue("ruleType", v as any)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn quy tắc" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50_30_20">Mong muốn/Tiết kiệm 60/40 (thoải mái)</SelectItem>
                    <SelectItem value="60_20_20">Mong muốn/Tiết kiệm 50/50 (cân bằng)</SelectItem>
                    <SelectItem value="custom">Tuỳ chỉnh Mong muốn/Tiết kiệm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {ruleType === "custom" ? (
                <div className="grid gap-2">
                  <Label>Tuỳ chỉnh Mong muốn/Tiết kiệm (tổng = 100)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="Mong muốn %"
                      {...form.register("customWantsPct")}
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="Tiết kiệm %"
                      {...form.register("customSavingsPct")}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Mong muốn / Tiết kiệm
                  </div>
                  {form.formState.errors.customWantsPct ? (
                    <div className="text-xs text-destructive">
                      {form.formState.errors.customWantsPct.message as string}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground flex items-end">
                  W + S = 100 (áp dụng trên phần còn lại sau khi trừ F và E từ I).
                </div>
              )}
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Mục tiêu quỹ khẩn cấp (tháng)</Label>
                <Input inputMode="numeric" {...form.register("emergencyFundTargetMonths")} />
              </div>
              <div className="grid gap-2">
                <Label>Số dư quỹ khẩn cấp hiện tại (VND)</Label>
                <Controller
                  control={form.control}
                  name="emergencyFundCurrentVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 10.000.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label>Baseline thiết yếu biến đổi (E) (VND)</Label>
                <Controller
                  control={form.control}
                  name="essentialVariableBaselineVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 3.000.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
                <div className="text-xs text-muted-foreground">
                  Dùng để tính N = F + E, từ đó tính mục tiêu quỹ khẩn cấp (N * số tháng).
                </div>
              </div>
            </div>

            <Button type="submit">Lưu cài đặt</Button>
          </form>

          <div className="rounded-md bg-muted p-4 text-sm">
            <div className="font-medium">Tóm tắt quỹ khẩn cấp</div>
            <div className="mt-1 grid gap-1.5">
              <LabelValueRow
                label="N (thiết yếu/tháng)"
                labelTitle="N (thiết yếu/tháng)"
                value={formatVnd(emergency.essentialMonthlyVnd)}
              />
              <LabelValueRow
                label="Mục tiêu"
                labelTitle="Mục tiêu"
                value={formatVnd(emergency.targetVnd)}
              />
              <LabelValueRow
                label="Trạng thái"
                labelTitle="Trạng thái"
                value={
                  <span className="font-medium text-foreground">
                    {emergency.status}
                  </span>
                }
                valueClassName="font-normal"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chi phí cố định (F)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LabelValueRow
            className="text-sm"
            label="Tổng chi phí cố định (F) đang bật"
            labelTitle="Tổng chi phí cố định (F) đang bật"
            value={formatVnd(fixedCostsWithDebtTotal)}
            valueClassName="text-foreground"
          />
          {data.settings.debtPaymentMonthlyVnd > 0 ? (
            <div className="text-xs text-muted-foreground">
              Bao gồm trả nợ:{" "}
              <span className="whitespace-nowrap tabular-nums">
                {formatVnd(data.settings.debtPaymentMonthlyVnd)}
              </span>{" "}
              (thiết lập ở trên).
            </div>
          ) : null}

          <div className="grid gap-2">
            {fixedCosts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Chưa có chi phí cố định. Thêm vài khoản như tiền nhà, điện nước, bảo hiểm…
              </div>
            ) : (
              fixedCosts.map((fc) => (
                <div
                  key={fc.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{fc.name}</div>
                    <div className="text-sm text-muted-foreground">
                      <span className="whitespace-nowrap tabular-nums">
                        {formatVnd(fc.amountVnd)}
                      </span>{" "}
                      • {CATEGORY_LABELS_VI[fc.category]}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Bật</span>
                      <Switch
                        checked={fc.active}
                        onCheckedChange={(checked) =>
                          updateFixedCost(fc.id, { active: checked })
                        }
                      />
                    </div>
                    <Select
                      value={fc.category}
                      onValueChange={(v) =>
                        updateFixedCost(fc.id, { category: v as ExpenseCategory })
                      }
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABELS_VI[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingAmountId(fc.id)
                        setEditingAmountVnd(fc.amountVnd)
                      }}
                    >
                      Sửa số tiền
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        deleteFixedCost(fc.id)
                        toast.success("Đã xóa.")
                      }}
                    >
                      Xóa
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-1">
              <Label>Tên khoản</Label>
              <Input value={newFcName} onChange={(e) => setNewFcName(e.target.value)} placeholder="Ví dụ: Tiền nhà" />
            </div>
            <div className="grid gap-2 sm:col-span-1">
              <Label>Số tiền (VND)</Label>
              <MoneyInput
                placeholder="Ví dụ: 4.500.000"
                value={newFcAmountVnd}
                onValueChange={setNewFcAmountVnd}
              />
            </div>
            <div className="grid gap-2 sm:col-span-1">
              <Label>Danh mục</Label>
              <Select value={newFcCategory} onValueChange={(v) => setNewFcCategory(v as ExpenseCategory)}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="sm:col-span-3">
              <Button
                variant="secondary"
                onClick={() => {
                  if (!newFcName.trim()) {
                    toast.error("Vui lòng nhập tên khoản chi.")
                    return
                  }
                  if (newFcAmountVnd <= 0) {
                    toast.error("Vui lòng nhập số tiền hợp lệ.")
                    return
                  }
                  addFixedCost({
                    name: newFcName.trim(),
                    amountVnd: newFcAmountVnd,
                    category: newFcCategory,
                  })
                  setNewFcName("")
                  setNewFcAmountVnd(0)
                  toast.success("Đã thêm chi phí cố định.")
                }}
              >
                Thêm chi phí cố định
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={editingAmountId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAmountId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa số tiền</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {editingFixedCost ? editingFixedCost.name : "Chi phí cố định"}
            </div>
            <div className="grid gap-2">
              <Label>Số tiền (VND)</Label>
              <MoneyInput
                placeholder="Ví dụ: 1.200.000"
                value={editingAmountVnd}
                onValueChange={setEditingAmountVnd}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!editingAmountId) return
                  if (editingAmountVnd <= 0) {
                    toast.error("Vui lòng nhập số tiền hợp lệ.")
                    return
                  }
                  updateFixedCost(editingAmountId, {
                    amountVnd: editingAmountVnd,
                  })
                  toast.success("Đã cập nhật.")
                  setEditingAmountId(null)
                }}
              >
                Lưu
              </Button>
              <Button variant="outline" onClick={() => setEditingAmountId(null)}>
                Hủy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
