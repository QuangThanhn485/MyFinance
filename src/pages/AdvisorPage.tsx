import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import DatePicker from "@/components/DatePicker"
import MoneyInput from "@/components/MoneyInput"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import LabelValueRow from "@/components/LabelValueRow"
import type { BudgetBucket, ISODate, PurchasePriority } from "@/domain/types"
import { BUCKET_LABELS_VI } from "@/domain/constants"
import { computeBudgets, computeEmergencyFund, computeMinimumSafetySavings } from "@/domain/finance/finance"
import { evaluatePurchaseAdvisor } from "@/domain/finance/advisor"
import { buildForcedPurchaseRescue, type ForcedPurchaseRescueResult } from "@/domain/finance/rescue"
import { formatVnd } from "@/lib/currency"
import { dayOfMonthFromIsoDate, daysInMonth, monthFromIsoDate, todayIso } from "@/lib/date"
import { getMonthToDateTotals, getMonthTotals } from "@/selectors/expenses"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/useAppStore"

export default function AdvisorPage() {
  const data = useAppStore((s) => s.data)
  const addPurchasePlan = useAppStore((s) => s.actions.addPurchasePlan)
  const updatePurchasePlan = useAppStore((s) => s.actions.updatePurchasePlan)
  const deletePurchasePlan = useAppStore((s) => s.actions.deletePurchasePlan)
  const applyRecoveryOption = useAppStore((s) => s.actions.applyRecoveryOption)

  const today = todayIso()
  const month = monthFromIsoDate(today)
  const totals = getMonthTotals(data, month)
  const toDateTotals = getMonthToDateTotals(data, today)
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
  const actualSavingsBalanceVnd = data.settings.actualSavingsBalanceVnd ?? 0
  const flexibleEmergencyBorrowVnd = Math.max(0, actualSavingsBalanceVnd - MSS)
  const emergency = computeEmergencyFund({
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
    targetMonths: data.settings.emergencyFundTargetMonths,
    currentBalanceVnd: data.settings.emergencyFundCurrentVnd,
  })

  const schema = z.object({
    name: z.string().min(1, "Vui lòng nhập tên."),
    priceVnd: z.coerce.number().int().positive("Giá phải > 0."),
    bucket: z.custom<BudgetBucket>(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["low", "med", "high"]),
    forced: z.boolean(),
    note: z.string().max(200).optional(),
  })

  type FormValues = z.infer<typeof schema>

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      priceVnd: 0,
      bucket: "wants",
      targetDate: undefined,
      priority: "med",
      forced: false,
      note: "",
    },
  })

  const [result, setResult] = useState<ReturnType<typeof evaluatePurchaseAdvisor> | null>(null)
  const [forcedRescue, setForcedRescue] = useState<ForcedPurchaseRescueResult | null>(null)
  const [showSafePlan, setShowSafePlan] = useState(false)

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<{
    name: string
    priceVnd: number
    bucket: BudgetBucket
    targetDate?: ISODate
    priority: PurchasePriority
    forced: boolean
  } | null>(null)

  const openForcedRescue = (purchase: { priceVnd: number; bucket: BudgetBucket }) => {
    const rescue = buildForcedPurchaseRescue({
      month,
      today,
      dayOfMonth: dayOfMonthFromIsoDate(today),
      daysInMonth: daysInMonth(month),
      incomeVnd: budgets.incomeVnd,
      fixedCostsVnd: totals.fixedCostsTotal,
      essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
      emergencyFundCurrentVnd: data.settings.emergencyFundCurrentVnd,
      emergencyFundTargetMonths: data.settings.emergencyFundTargetMonths,
      debtPaymentMonthlyVnd: data.settings.debtPaymentMonthlyVnd,
      budgets: {
        wantsBudgetVnd: budgets.wantsBudgetVnd,
        savingsTargetVnd: budgets.savingsTargetVnd,
      },
      spentToDate: {
        totalSpentVnd: totals.fixedCostsTotal + toDateTotals.variableTotalToDateVnd,
        wantsSpentVnd: toDateTotals.variableWantsToDateVnd,
        needsSpentVnd: totals.fixedCostsTotal + toDateTotals.variableNeedsToDateVnd,
      },
      forcedPurchase: purchase,
    })
    setForcedRescue(rescue)
  }

  const runAdvisor = (
    values: Pick<FormValues, "name" | "priceVnd" | "bucket" | "forced">,
  ) => {
    const purchase = {
      name: values.name.trim(),
      priceVnd: Math.trunc(values.priceVnd),
      bucket: values.bucket,
      forced: values.forced,
    }

    const advisor = evaluatePurchaseAdvisor({
      purchase,
      context: {
        incomeVnd: budgets.incomeVnd,
        fixedCostsVnd: totals.fixedCostsTotal,
        essentialVariableBaselineVnd: data.settings.essentialVariableBaselineVnd,
        variableNeedsSpentVnd: toDateTotals.variableNeedsToDateVnd,
        variableWantsSpentVnd: toDateTotals.variableWantsToDateVnd,
        wantsBudgetVnd: budgets.wantsBudgetVnd,
        savingsBudgetVnd: budgets.savingsBudgetVnd,
        emergencyCoverageMonths: emergency.coverageMonths,
        emergencyFundTargetMonths: data.settings.emergencyFundTargetMonths,
      },
    })
    setResult(advisor)
    setShowSafePlan(false)

    if (advisor.impact.isNegligible) {
      setForcedRescue(null)
      return
    }

    if (purchase.forced) {
      openForcedRescue({ priceVnd: purchase.priceVnd, bucket: purchase.bucket })
    } else {
      setForcedRescue(null)
    }
  }

  const priorityLabel: Record<PurchasePriority, string> = {
    low: "Thấp",
    med: "Trung bình",
    high: "Cao",
  }

  const purchasePlans = data.entities.purchasePlans.allIds
    .map((id) => data.entities.purchasePlans.byId[id])
    .filter((pp): pp is NonNullable<typeof pp> => !!pp)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const closeEditPlan = () => {
    setEditingPlanId(null)
    setEditingDraft(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tư vấn mua sắm</h1>
        <p className="text-sm text-muted-foreground">
          Đánh giá “NÊN MUA / CÂN NHẮC / KHÔNG NÊN” và lập kế hoạch tiết kiệm.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card className="md:col-span-2 xl:col-span-2">
          <CardHeader>
            <CardTitle>Nhập món đồ dự định mua</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
              <form
                className="grid gap-4"
                onSubmit={form.handleSubmit((values) => {
                  runAdvisor(values)
                })}
              >
              <div className="grid gap-2">
                <Label>Tên món đồ</Label>
                <Input placeholder="Ví dụ: Tai nghe" {...form.register("name")} />
              </div>
              <div className="grid gap-2">
                <Label>Giá (VND)</Label>
                <Controller
                  control={form.control}
                  name="priceVnd"
                  render={({ field }) => (
                    <MoneyInput
                      placeholder="Ví dụ: 1.200.000"
                      value={Number(field.value) || 0}
                      onValueChange={field.onChange}
                    />
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Bucket</Label>
                  <Select
                    value={form.watch("bucket")}
                    onValueChange={(v) => form.setValue("bucket", v as BudgetBucket)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn bucket" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="needs">{BUCKET_LABELS_VI.needs}</SelectItem>
                      <SelectItem value="wants">{BUCKET_LABELS_VI.wants}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Ưu tiên</Label>
                  <Select
                    value={form.watch("priority")}
                    onValueChange={(v) => form.setValue("priority", v as PurchasePriority)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn mức ưu tiên" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Thấp</SelectItem>
                      <SelectItem value="med">Trung bình</SelectItem>
                      <SelectItem value="high">Cao</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Ngày dự kiến (tuỳ chọn)</Label>
                <Controller
                  control={form.control}
                  name="targetDate"
                  render={({ field }) => (
                    <DatePicker
                      value={(field.value as ISODate | undefined) ?? undefined}
                      onChange={(v) => field.onChange(v)}
                      allowClear
                      placeholder="Chọn ngày (tuỳ chọn)"
                    />
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <div className="font-medium">Chế độ Bắt buộc mua</div>
                  <div className="text-sm text-muted-foreground">
                    BẬT khi bạn BẮT BUỘC PHẢI MUA, app sẽ tạo “Cứu nguy tài chính”.
                  </div>
                </div>
                <Switch
                  checked={form.watch("forced")}
                  onCheckedChange={(checked) => form.setValue("forced", checked)}
                />
              </div>

              <div className="grid gap-2">
                <Label>Ghi chú (tuỳ chọn)</Label>
                <Textarea rows={3} {...form.register("note")} />
              </div>

              <Button type="submit">Phân tích</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
           <CardHeader>
             <CardTitle>Bối cảnh tháng này</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             <LabelValueRow label="Thu nhập" value={formatVnd(budgets.incomeVnd)} />
             <LabelValueRow
               label="Chi phí cố định"
               value={formatVnd(totals.fixedCostsTotal)}
             />
	             <LabelValueRow
	               label="Mong muốn còn lại"
	               value={formatVnd(
	                 Math.max(0, budgets.wantsBudgetVnd - toDateTotals.variableWantsToDateVnd),
	               )}
	             />
             <Separator />
             <LabelValueRow label="MSS (tối thiểu cần giữ)" value={formatVnd(MSS)} />
             <LabelValueRow
               label="Mục tiêu tiết kiệm theo kế hoạch"
               value={formatVnd(savingsMin)}
             />
             <div className="text-xs text-muted-foreground">
               Quỹ khẩn cấp phủ ~{Number.isFinite(emergency.coverageMonths) ? emergency.coverageMonths.toFixed(1) : "—"} tháng
               • Trạng thái: {emergency.status}
             </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Kế hoạch đã lưu</CardTitle>
            <div className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
              {purchasePlans.length} mục
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {purchasePlans.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Chưa có kế hoạch nào. Dùng nút “Lưu kế hoạch” trong kết quả tư vấn.
            </div>
          ) : (
            <div className="space-y-2">
              {purchasePlans.map((pp) => (
                <div key={pp.id} className="rounded-md border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1 font-medium truncate">
                          {pp.name}
                        </div>
                        <Badge variant="secondary">{BUCKET_LABELS_VI[pp.bucket]}</Badge>
                        <Badge variant="outline">Ưu tiên: {priorityLabel[pp.priority]}</Badge>
                        {pp.forced ? <Badge>Bắt buộc</Badge> : null}
                      </div>

                      <div className="grid gap-1 text-sm">
                        <LabelValueRow label="Giá" value={formatVnd(pp.priceVnd)} />
                        <LabelValueRow
                          label="Ngày mục tiêu"
                          value={
                            pp.targetDate ? (
                              <span className="whitespace-nowrap tabular-nums">
                                {pp.targetDate}
                              </span>
                            ) : (
                              "—"
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          form.setValue("name", pp.name)
                          form.setValue("priceVnd", pp.priceVnd)
                          form.setValue("bucket", pp.bucket)
                          form.setValue("targetDate", pp.targetDate ?? undefined)
                          form.setValue("priority", pp.priority)
                          form.setValue("forced", pp.forced)
                          form.setValue("note", "")

                          runAdvisor({
                            name: pp.name,
                            priceVnd: pp.priceVnd,
                            bucket: pp.bucket,
                            forced: pp.forced,
                          })
                          toast.success("Đã áp dụng kế hoạch để phân tích.")
                        }}
                      >
                        Dùng để phân tích
                      </Button>

                      <Dialog
                        open={editingPlanId === pp.id}
                        onOpenChange={(open) => {
                          if (open) {
                            setEditingPlanId(pp.id)
                            setEditingDraft({
                              name: pp.name,
                              priceVnd: pp.priceVnd,
                              bucket: pp.bucket,
                              targetDate: pp.targetDate,
                              priority: pp.priority,
                              forced: pp.forced,
                            })
                          } else {
                            closeEditPlan()
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline">
                            Sửa
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Chỉnh sửa kế hoạch mua</DialogTitle>
                          </DialogHeader>
                          {editingDraft ? (
                            <form
                              className="grid gap-4"
                              onSubmit={(e) => {
                                e.preventDefault()
                                if (!editingPlanId) return
                                const name = editingDraft.name.trim()
                                const priceVnd = Math.trunc(editingDraft.priceVnd)
                                if (!name || priceVnd <= 0) {
                                  toast.error("Vui lòng nhập tên và giá hợp lệ.")
                                  return
                                }
                                updatePurchasePlan(editingPlanId, {
                                  name,
                                  priceVnd,
                                  bucket: editingDraft.bucket,
                                  targetDate: editingDraft.targetDate,
                                  priority: editingDraft.priority,
                                  forced: editingDraft.forced,
                                })
                                toast.success("Đã cập nhật kế hoạch.")
                                closeEditPlan()
                              }}
                            >
                              <div className="grid gap-2">
                                <Label>Tên món đồ</Label>
                                <Input
                                  value={editingDraft.name}
                                  onChange={(e) =>
                                    setEditingDraft((d) =>
                                      d ? { ...d, name: e.target.value } : d,
                                    )
                                  }
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label>Giá (VND)</Label>
                                <MoneyInput
                                  placeholder="Ví dụ: 1.200.000"
                                  value={Number(editingDraft.priceVnd) || 0}
                                  onValueChange={(v) =>
                                    setEditingDraft((d) =>
                                      d ? { ...d, priceVnd: v } : d,
                                    )
                                  }
                                />
                              </div>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <div className="grid gap-2">
                                  <Label>Bucket</Label>
                                  <Select
                                    value={editingDraft.bucket}
                                    onValueChange={(v) =>
                                      setEditingDraft((d) =>
                                        d ? { ...d, bucket: v as BudgetBucket } : d,
                                      )
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Chọn bucket" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="needs">
                                        {BUCKET_LABELS_VI.needs}
                                      </SelectItem>
                                      <SelectItem value="wants">
                                        {BUCKET_LABELS_VI.wants}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid gap-2">
                                  <Label>Ưu tiên</Label>
                                  <Select
                                    value={editingDraft.priority}
                                    onValueChange={(v) =>
                                      setEditingDraft((d) =>
                                        d ? { ...d, priority: v as PurchasePriority } : d,
                                      )
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Chọn mức ưu tiên" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Thấp</SelectItem>
                                      <SelectItem value="med">Trung bình</SelectItem>
                                      <SelectItem value="high">Cao</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="grid gap-2">
                                <Label>Ngày mục tiêu</Label>
                                <DatePicker
                                  value={editingDraft.targetDate ?? undefined}
                                  onChange={(v) =>
                                    setEditingDraft((d) =>
                                      d ? { ...d, targetDate: v } : d,
                                    )
                                  }
                                  allowClear
                                  placeholder="Chọn ngày (tuỳ chọn)"
                                />
                              </div>

                              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                                <div>
                                  <div className="font-medium">Chế độ Bắt buộc mua</div>
                                  <div className="text-sm text-muted-foreground">
                                    BẬT khi bạn BẮT BUỘC PHẢI MUA, app sẽ tạo “Cứu nguy tài chính”.
                                  </div>
                                </div>
                                <Switch
                                  checked={editingDraft.forced}
                                  onCheckedChange={(checked) =>
                                    setEditingDraft((d) =>
                                      d ? { ...d, forced: checked } : d,
                                    )
                                  }
                                />
                              </div>

                              <div className="flex justify-end gap-2 pt-1">
                                <Button type="button" variant="outline" onClick={closeEditPlan}>
                                  Đóng
                                </Button>
                                <Button type="submit">Lưu</Button>
                              </div>
                            </form>
                          ) : null}
                        </DialogContent>
                      </Dialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
                            Xoá
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Xoá kế hoạch?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Hành động này sẽ xoá kế hoạch mua đã lưu. Bạn có thể tạo lại bất cứ lúc nào.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Hủy</AlertDialogCancel>
                            <AlertDialogAction asChild>
                              <Button
                                variant="destructive"
                                onClick={() => {
                                  deletePurchasePlan(pp.id)
                                  if (editingPlanId === pp.id) closeEditPlan()
                                  toast.success("Đã xoá kế hoạch.")
                                }}
                              >
                                Xoá
                              </Button>
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Kết quả tư vấn</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const isNegligible = result.impact.isNegligible
              const isCaseB =
                !isNegligible &&
                result.purchase.bucket === "wants" &&
                result.budgetSnapshot.hasEnoughBudget &&
                result.safetySnapshot.violatesSafety
              const safetyGapVnd = result.safetySnapshot.deficitVnd
              const safetyGapAbsVnd = Math.abs(safetyGapVnd)
              const safetyGapLabel =
                safetyGapVnd < 0
                  ? "Thiếu so với MSS+buffer"
                  : "Dư so với MSS+buffer"
              const bufferPct =
                result.safetySnapshot.minimumSafetySavingsVnd > 0 &&
                result.safetySnapshot.safetyBufferVnd > 0
                  ? Math.round(
                      (result.safetySnapshot.safetyBufferVnd /
                        result.safetySnapshot.minimumSafetySavingsVnd) *
                        100,
                    )
                  : 0
              const badgeLabel =
                isNegligible
                  ? result.recommendation === "NÊN MUA"
                    ? "NÊN MUA (ảnh hưởng không đáng kể)"
                    : result.recommendation
                  : result.recommendation === "CÂN NHẮC" && isCaseB
                  ? "CÂN NHẮC – RỦI RO TÀI CHÍNH"
                  : result.recommendation

              return (
                <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  result.recommendation === "NÊN MUA" && "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent",
                  result.recommendation === "CÂN NHẮC" && "bg-amber-500 hover:bg-amber-500 text-white border-transparent",
                  result.recommendation === "KHÔNG NÊN" && "bg-rose-600 hover:bg-rose-600 text-white border-transparent",
                )}
              >
                {badgeLabel}
              </Badge>
             <div className="text-sm text-muted-foreground">{result.behaviorReminder}</div>
            </div>

             {isNegligible ? (
               <div className="space-y-3">
                 <div className="rounded-md border bg-background p-4 text-sm">
                   <div className="font-medium">
                     Món mua nhỏ, ảnh hưởng tài chính không đáng kể.
                   </div>
                 </div>
                 <div className="rounded-md bg-muted p-3 space-y-2 text-sm">
                   <LabelValueRow
                      label={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Ngân sách Mong muốn"
                          : "Ngân sách Thiết yếu"
                      }
                      labelClassName="text-foreground font-medium"
                      value={
                        <Badge
                          variant={
                            result.budgetSnapshot.hasEnoughBudget
                              ? "default"
                              : "secondary"
                          }
                        >
                          {result.budgetSnapshot.hasEnoughBudget ? "ĐỦ" : "KHÔNG ĐỦ"}
                        </Badge>
                      }
                      valueClassName="font-normal"
                    />
                    <LabelValueRow
                      label={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Mong muốn còn lại"
                          : "Thiết yếu còn lại (theo baseline)"
                      }
                      labelTitle={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Mong muốn còn lại"
                          : "Thiết yếu còn lại (theo baseline)"
                      }
                      value={formatVnd(result.budgetSnapshot.remainingVnd)}
                    />
                    <LabelValueRow
                      label="Giá item"
                      labelTitle="Giá item"
                      value={formatVnd(result.purchase.priceVnd)}
                   />
                 </div>
               </div>
             ) : (
               <div className="grid gap-3 sm:grid-cols-2 text-sm">
                 <div className="rounded-md bg-muted p-3 space-y-2">
                   <LabelValueRow
                      label={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Ngân sách Mong muốn"
                          : "Ngân sách Thiết yếu"
                      }
                      labelClassName="text-foreground font-medium"
                      value={
                        <Badge
                          variant={
                            result.budgetSnapshot.hasEnoughBudget
                              ? "default"
                              : "secondary"
                          }
                        >
                          {result.budgetSnapshot.hasEnoughBudget ? "ĐỦ" : "KHÔNG ĐỦ"}
                        </Badge>
                      }
                      valueClassName="font-normal"
                    />
                    <LabelValueRow
                      label={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Mong muốn còn lại"
                          : "Thiết yếu còn lại (theo baseline)"
                      }
                      labelTitle={
                        result.budgetSnapshot.bucket === "wants"
                          ? "Mong muốn còn lại"
                          : "Thiết yếu còn lại (theo baseline)"
                      }
                      value={formatVnd(result.budgetSnapshot.remainingVnd)}
                    />
                    <LabelValueRow
                      label="Giá item"
                      labelTitle="Giá item"
                      value={formatVnd(result.purchase.priceVnd)}
                    />
                 </div>

                 <div className="rounded-md bg-muted p-3 space-y-2">
                   <LabelValueRow
                     label="An toàn (MSS + buffer)"
                     labelClassName="text-foreground font-medium"
                     value={
                       <Badge
                         variant={
                           result.safetySnapshot.violatesSafety
                             ? "secondary"
                             : "default"
                         }
                       >
                         {result.safetySnapshot.violatesSafety
                           ? "CÓ RỦI RO"
                           : "AN TOÀN"}
                       </Badge>
                     }
                     valueClassName="font-normal"
                   />
                   <LabelValueRow
                     label="Còn lại trước khi mua (dự báo)"
                     labelTitle="Còn lại trước khi mua (dự báo)"
                     value={formatVnd(
                       result.safetySnapshot.remainingBeforePurchaseVnd,
                     )}
                     valueClassName={cn(
                       result.safetySnapshot.violatesSafety && "text-destructive",
                     )}
                   />
                   <LabelValueRow
                     label="Còn lại sau khi mua (dự báo)"
                     labelTitle="Còn lại sau khi mua (dự báo)"
                     value={formatVnd(
                       result.safetySnapshot.remainingAfterPurchaseVnd,
                     )}
                     valueClassName={cn(
                       result.safetySnapshot.violatesSafety && "text-destructive",
                     )}
                   />
                   <LabelValueRow
                     label="MSS cần giữ (+ buffer)"
                     labelTitle="MSS cần giữ (+ buffer)"
                     value={formatVnd(result.safetySnapshot.safetyLockVnd)}
                   />
                   <LabelValueRow
                     label={safetyGapLabel}
                     labelTitle={safetyGapLabel}
                     value={formatVnd(safetyGapAbsVnd)}
                     valueClassName={cn(
                       safetyGapVnd < 0 && "text-destructive",
                     )}
                   />
                   <details className="rounded-md border bg-background p-3 text-sm">
                     <summary className="cursor-pointer select-none font-medium">
                       Giải thích (công thức & nguồn số)
                     </summary>
                     <div className="mt-3 space-y-2">
	                      <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
	                        <div>
	                          RemainingBeforePurchase = I − F − max(E, Thiết yếu đã chi) − Mong muốn đã chi
	                        </div>
	                        <div>
	                          RemainingAfterPurchase = I − F − max(E, Thiết yếu sau khi mua) − Mong muốn sau khi mua
	                        </div>
	                        <div>SafetyLock = MSS + buffer</div>
	                        <div>Deficit = RemainingAfterPurchase − SafetyLock</div>
	                      </div>
	
	                      <div className="space-y-1">
	                        <LabelValueRow label="I" value={formatVnd(budgets.incomeVnd)} />
	                        <LabelValueRow
	                          label="F"
	                          value={formatVnd(result.safetySnapshot.fixedCostsVnd)}
	                        />
	                        <LabelValueRow
	                          label="E"
	                          value={formatVnd(result.safetySnapshot.essentialBaselineVnd)}
	                        />
	                        <LabelValueRow
	                          label="Thiết yếu đã chi (đến hôm nay)"
	                          labelTitle="Chi thiết yếu biến đổi đã ghi trong tháng (đến hôm nay)."
	                          value={formatVnd(
	                            result.safetySnapshot.needsSpentToDateVnd,
	                          )}
	                        />
	                        <LabelValueRow
	                          label="Mong muốn đã chi (đến hôm nay)"
	                          labelTitle="Chi mong muốn đã ghi trong tháng (đến hôm nay)."
	                          value={formatVnd(
	                            result.safetySnapshot.wantsSpentToDateVnd,
	                          )}
	                        />
	                        <LabelValueRow
	                          label="Thiết yếu dự kiến = max(E, thiết yếu đã chi)"
	                          labelTitle="Giữ tối thiểu E cho thiết yếu; nếu đã chi > E thì dùng số đã chi để tránh tính trùng."
	                          value={formatVnd(
	                            Math.max(
	                              result.safetySnapshot.essentialBaselineVnd,
	                              result.safetySnapshot.needsSpentToDateVnd,
	                            ),
	                          )}
	                        />
	                        <Separator />
	                        <LabelValueRow
	                          label="RemainingBeforePurchase"
	                          labelTitle="RemainingBeforePurchase"
	                          value={formatVnd(
	                            result.safetySnapshot.remainingBeforePurchaseVnd,
	                          )}
	                        />
	                        <LabelValueRow
	                          label="Item price"
	                          labelTitle="Item price"
	                          value={formatVnd(result.purchase.priceVnd)}
	                        />
	                        <LabelValueRow
	                          label="Thiết yếu sau khi mua"
	                          labelTitle="= Thiết yếu đã chi + giá item (nếu item thuộc Thiết yếu)."
	                          value={formatVnd(
	                            result.safetySnapshot.needsSpentToDateVnd +
	                              (result.purchase.bucket === "needs"
	                                ? result.purchase.priceVnd
	                                : 0),
	                          )}
	                        />
	                        <LabelValueRow
	                          label="Mong muốn sau khi mua"
	                          labelTitle="= Mong muốn đã chi + giá item (nếu item thuộc Mong muốn)."
	                          value={formatVnd(
	                            result.safetySnapshot.wantsSpentToDateVnd +
	                              (result.purchase.bucket === "wants"
	                                ? result.purchase.priceVnd
	                                : 0),
	                          )}
	                        />
	                        <LabelValueRow
	                          label="Thiết yếu dự kiến sau khi mua = max(E, thiết yếu sau khi mua)"
	                          labelTitle="Dự báo thiết yếu sau khi mua (đảm bảo tối thiểu E)."
	                          value={formatVnd(
	                            Math.max(
	                              result.safetySnapshot.essentialBaselineVnd,
	                              result.safetySnapshot.needsSpentToDateVnd +
	                                (result.purchase.bucket === "needs"
	                                  ? result.purchase.priceVnd
	                                  : 0),
	                            ),
	                          )}
	                        />
	                        <LabelValueRow
	                          label="RemainingAfterPurchase"
	                          labelTitle="RemainingAfterPurchase"
	                          value={formatVnd(
	                            result.safetySnapshot.remainingAfterPurchaseVnd,
                          )}
                        />
                      </div>

                      <Separator />

                      <LabelValueRow
                        label="MSS"
                        value={formatVnd(
                          result.safetySnapshot.minimumSafetySavingsVnd,
                        )}
                      />
                      <LabelValueRow
                        label={`Buffer${bufferPct > 0 ? ` (≈ +${bufferPct}%)` : ""}`}
                        labelTitle={`Buffer${bufferPct > 0 ? ` (≈ +${bufferPct}%)` : ""}`}
                        value={formatVnd(result.safetySnapshot.safetyBufferVnd)}
                      />
                      {result.safetySnapshot.safetyBufferVnd > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          Buffer được cộng vì quỹ khẩn cấp thấp (~{Number.isFinite(result.safetySnapshot.emergencyCoverageMonths)
                            ? result.safetySnapshot.emergencyCoverageMonths.toFixed(1)
                            : "—"} tháng).
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Quỹ khẩn cấp ≥ 3 tháng → buffer = 0.
                        </div>
                      )}
                      <LabelValueRow
                        label="SafetyLock"
                        labelTitle="SafetyLock"
                        value={formatVnd(result.safetySnapshot.safetyLockVnd)}
                      />
                      <LabelValueRow
                        label="Deficit (signed)"
                        labelTitle="Deficit (signed)"
                        value={formatVnd(safetyGapVnd)}
                        valueClassName={cn(
                          safetyGapVnd < 0 && "text-destructive",
                        )}
                      />
                      <LabelValueRow
                        label={safetyGapLabel}
                        labelTitle={safetyGapLabel}
                        value={formatVnd(safetyGapAbsVnd)}
                        valueClassName={cn(
                          safetyGapVnd < 0 && "text-destructive",
                        )}
                      />
	                      <div className="text-xs text-muted-foreground">
	                        Ghi chú: “Còn lại …” là dự báo vì F và E là kế hoạch theo tháng; phần chi các ngày còn lại chưa xảy ra. Dùng `max(E, …)` để tránh tính trùng thiết yếu.
	                      </div>
	                    </div>
	                  </details>
	                </div>
	              </div>
            )}

            {isCaseB ? (
              <div className="rounded-md border bg-background p-4 text-sm space-y-2">
                <div className="font-medium">Bạn có đủ ngân sách Mong muốn để mua món này.</div>
                <div className="text-muted-foreground">
                  Tuy nhiên, nếu mua ngay, phần “Còn lại sau khi mua” có thể thấp hơn MSS (+ buffer).
                  <br />
                  Bạn vẫn có thể mua, nhưng nên chọn một phương án giảm rủi ro.
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={() => {
                      openForcedRescue({
                        priceVnd: result.purchase.priceVnd,
                        bucket: result.purchase.bucket,
                      })
                    }}
                  >
                    Tôi vẫn muốn mua
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowSafePlan(true)
                    }}
                  >
                    Lập kế hoạch an toàn hơn
                  </Button>
                </div>
              </div>
            ) : null}

            {!isNegligible ? (
              <div className="grid gap-2 text-sm">
                {result.reasons.map((r) => (
                  <div key={r} className="text-muted-foreground">
                    • {r}
                  </div>
                ))}
              </div>
            ) : null}

            {actualSavingsBalanceVnd > 0 ? (
              <details className="rounded-md border bg-background p-3 text-sm">
                <summary className="cursor-pointer select-none font-medium">
                  Vùng linh hoạt (chỉ khi khẩn cấp)
                </summary>
                <div className="mt-3 space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Đây là phần <span className="font-medium">tiền thực tế</span> bạn tự nhập ở Cài đặt. Chỉ xem như phương án khẩn cấp và không liên quan “dự báo cuối tháng”.
                  </div>
                  <LabelValueRow
                    label="Số dư tiết kiệm/đầu tư (thực tế)"
                    labelTitle="Số dư tiết kiệm/đầu tư (thực tế)"
                    value={formatVnd(actualSavingsBalanceVnd)}
                  />
                  <LabelValueRow label="MSS" value={formatVnd(MSS)} />
                  <LabelValueRow
                    label="Trên MSS (có thể mượn)"
                    labelTitle="Trên MSS (có thể mượn)"
                    value={formatVnd(flexibleEmergencyBorrowVnd)}
                  />
                </div>
              </details>
            ) : null}

            {result.savingsPlan && (showSafePlan || !isCaseB) ? (
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Lập kế hoạch an toàn hơn</div>
                  {isCaseB ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowSafePlan(false)
                      }}
                    >
                      Ẩn
                    </Button>
                  ) : null}
                </div>

                {result.savingsPlan.isFeasible ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Chờ ~{result.savingsPlan.monthsToSave} tháng, để dành{" "}
                      <span className="font-medium text-foreground whitespace-nowrap tabular-nums">
                        {formatVnd(result.savingsPlan.monthlyTargetVnd)}/tháng
                      </span>
                      .
                    </div>
                    <ul className="text-sm text-muted-foreground list-disc pl-5">
                      <li>Chờ ~{result.savingsPlan.monthsToSave} tháng</li>
                      <li>
                        Cắt Mong muốn ~{" "}
                        <span className="whitespace-nowrap tabular-nums">
                          {formatVnd(result.savingsPlan.monthlyTargetVnd)}/tháng
                        </span>
                      </li>
                      <li>Giảm tiết kiệm tạm thời (không dưới MSS) — xem trong “Cứu nguy tài chính”</li>
                      <li>Tăng thu nhập mục tiêu — xem trong “Cứu nguy tài chính”</li>
                    </ul>
                  </>
                ) : (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <div className="font-medium text-destructive">
                      Hiện tại không khả thi về tài chính.
                    </div>
                    {result.savingsPlan.warning &&
                    result.savingsPlan.warning !== "Hiện tại không khả thi về tài chính." ? (
                      <div className="text-muted-foreground">{result.savingsPlan.warning}</div>
                    ) : null}
                    <div className="text-muted-foreground">
                      Khả dụng theo ngân sách (Mong muốn + Tiết kiệm):{" "}
                      <span className="font-medium text-foreground whitespace-nowrap tabular-nums">
                        {formatVnd(result.savingsPlan.monthlyAvailableForGoalVnd)}/tháng
                      </span>{" "}
                      • Tối thiểu an toàn:{" "}
                      <span className="font-medium text-foreground whitespace-nowrap tabular-nums">
                        {formatVnd(result.savingsPlan.minMonthlySavingVnd)}/tháng
                      </span>
                    </div>
                  </div>
                )}

                <ul className="text-sm text-muted-foreground list-disc pl-5">
                  {result.savingsPlan.cutSuggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const v = form.getValues()
                  if (!v.name.trim() || v.priceVnd <= 0) {
                    toast.error("Vui lòng nhập tên và giá hợp lệ.")
                    return
                  }
                  addPurchasePlan({
                    name: v.name.trim(),
                    priceVnd: Math.trunc(v.priceVnd),
                    bucket: v.bucket,
                    targetDate: (v.targetDate ? (v.targetDate as ISODate) : undefined),
                    priority: v.priority as PurchasePriority,
                    forced: v.forced,
                  })
                  toast.success("Đã lưu kế hoạch mua.")
                }}
              >
                Lưu kế hoạch
              </Button>
            </div>
                </>
              )
            })()}
          </CardContent>
        </Card>
      ) : null}

      {forcedRescue ? (
        <Card>
          <CardHeader>
            <CardTitle>Bảng cứu nguy tài chính (bắt buộc mua)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Tiền còn lại cuối tháng (dự báo)</div>
                <div
                  className={cn(
                    "font-medium whitespace-nowrap tabular-nums",
                    forcedRescue.projectedEndMonthBalanceVnd < forcedRescue.mssVnd &&
                      "text-destructive",
                  )}
                >
                  {formatVnd(forcedRescue.projectedEndMonthBalanceVnd)}
                </div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">MSS (mức tối thiểu cần giữ)</div>
                <div className="font-medium whitespace-nowrap tabular-nums">
                  {formatVnd(forcedRescue.mssVnd)}
                </div>
              </div>
              <div className="rounded-md bg-muted p-3">
                <div className="text-muted-foreground">Thiếu MSS</div>
                <div
                  className={cn(
                    "font-medium whitespace-nowrap tabular-nums",
                    forcedRescue.mssDeficitVnd > 0 && "text-destructive",
                  )}
                >
                  {forcedRescue.mssDeficitVnd > 0 ? formatVnd(forcedRescue.mssDeficitVnd) : "Đạt MSS"}
                </div>
              </div>
            </div>

            {forcedRescue.mssDeficitVnd > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Cần bù trung bình mỗi ngày:</span>
                <span className="font-medium whitespace-nowrap tabular-nums">
                  {formatVnd(forcedRescue.requiredDailyCutVnd)}
                </span>
                <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                  (hoặc {formatVnd(forcedRescue.requiredWeeklyCutVnd)}/tuần)
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Đạt MSS với kế hoạch hiện tại.</div>
            )}

            {forcedRescue.options.length ? (
              <>
                <div className="grid gap-4">
                  {forcedRescue.options.map((o) => {
                    const isRecommended = o.id === forcedRescue.recommendedOptionId
                    return (
                      <Card key={o.id} className={cn(isRecommended && "border-primary")}>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-3">
                            <CardTitle className="text-base">{o.title}</CardTitle>
                            {isRecommended ? <Badge>Khuyến nghị</Badge> : null}
                          </div>
                          <div className="text-sm text-muted-foreground">{o.summary}</div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="grid gap-2 sm:grid-cols-2 text-sm">
                            <div className="rounded-md bg-muted p-3">
                              <div className="text-muted-foreground">Tiền còn lại cuối tháng</div>
                              <div
                                className={cn(
                                  "font-medium whitespace-nowrap tabular-nums",
                                  o.impact.projectedEndMonthBalanceVnd < forcedRescue.mssVnd &&
                                    "text-destructive",
                                )}
                              >
                                {formatVnd(o.impact.projectedEndMonthBalanceVnd)}
                              </div>
                            </div>
                            <div className="rounded-md bg-muted p-3">
                              <div className="text-muted-foreground">So với MSS</div>
                              <div className="font-medium">
                                {o.impact.projectedEndMonthBalanceVnd >= forcedRescue.mssVnd ? (
                                  "ĐẠT MSS"
                                ) : (
                                  <span>
                                    Thiếu{" "}
                                    <span className="whitespace-nowrap tabular-nums">
                                      {formatVnd(
                                        Math.max(
                                          0,
                                          forcedRescue.mssVnd -
                                            o.impact.projectedEndMonthBalanceVnd,
                                        ),
                                      )}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {o.warnings?.length ? (
                            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                              <div className="font-medium text-destructive">Cảnh báo</div>
                              <ul className="list-disc pl-5 text-muted-foreground">
                                {o.warnings.map((w) => (
                                  <li key={w}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <ul className="text-sm text-muted-foreground list-disc pl-5">
                            {o.impact.notes.map((n) => (
                              <li key={n}>{n}</li>
                            ))}
                          </ul>

                          <div className="flex gap-2">
                            <Button
                              variant={isRecommended ? "default" : "secondary"}
                              onClick={() => {
                                const res = applyRecoveryOption({ month: forcedRescue.month, option: o })
                                if (!res.ok) {
                                  toast.error(res.error)
                                  return
                                }
                                toast.success("Đã áp dụng phương án.")
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

                {forcedRescue.recommendedOptionId ? (
                  <Button
                    onClick={() => {
                      const opt = forcedRescue.options.find((o) => o.id === forcedRescue.recommendedOptionId)
                      if (!opt) return
                      const res = applyRecoveryOption({ month: forcedRescue.month, option: opt })
                      if (!res.ok) {
                        toast.error(res.error)
                        return
                      }
                      toast.success("Đã áp dụng phương án khuyến nghị.")
                    }}
                  >
                    Áp dụng phương án khuyến nghị
                  </Button>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
