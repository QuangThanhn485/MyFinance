import type { BudgetBucket, ISODate, PurchasePriority, YearMonth } from "@/domain/types"
import {
  computeBudgets,
  computeDebtToIncome,
  computeEmergencyFund,
} from "@/domain/finance/finance"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveCapsForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import { monthFromIsoDate, previousMonth, todayIso } from "@/lib/date"
import { getMonthToDateTotals, getMonthTotals } from "@/selectors/expenses"
import { getEffectiveEmergencyFundBalance } from "@/selectors/savings"
import type { CttmState } from "@/storage/schema"
import { getDayLockMonthContext } from "@/storage/dayLock"

export type PurchaseRiskDecision =
  | "MUA ĐƯỢC"
  | "CHỜ"
  | "KHÔNG MUA"
  | "BẮT BUỘC: GIẢM THIỆT HẠI"

export type PurchaseRiskSignalStatus = "pass" | "warn" | "fail"

export type PurchaseRiskSignal = {
  key: string
  label: string
  status: PurchaseRiskSignalStatus
  value: number
  detail: string
}

export type PurchaseRiskInput = {
  state: CttmState
  today?: ISODate
  purchase: {
    id?: string
    name: string
    priceVnd: number
    bucket: BudgetBucket
    priority: PurchasePriority
    forced: boolean
    targetDate?: ISODate
  }
}

export type PurchaseRiskResult = {
  month: YearMonth
  decision: PurchaseRiskDecision
  riskScore: number
  confidencePct: number
  hardStops: string[]
  summary: string
  reasons: string[]
  signals: PurchaseRiskSignal[]
  actionPlan: string[]
  snapshot: {
    incomeVnd: number
    fixedCostsVnd: number
    spendingBudgetVnd: number
    totalSpentVnd: number
    totalRemainingAfterPurchaseVnd: number
    bucketRemainingBeforeVnd: number
    bucketRemainingAfterPurchaseVnd: number
    projectedEndMonthBalanceBeforeVnd: number
    projectedEndMonthBalanceAfterPurchaseVnd: number
    savingsTargetVnd: number
    minimumSafetySavingsVnd: number
    emergencyFundBalanceVnd: number
    emergencyCoverageMonths: number
    emergencyCoverageAfterIfUsedMonths: number
    remainingDaysInMonth: number
    dailyCapAfterPurchaseVnd: number
    essentialDailyNeedAfterPurchaseVnd: number
    variablePaceOverspendVnd: number
    historicalAverageSpendVnd: number
    existingPlanExposureVnd: number
    debtToIncomeRatio: number
    dayLocked: boolean
    remainingStartDate: ISODate
    budgetAdjustmentApplied: boolean
    spendingCapsApplied: boolean
    targetDate?: ISODate
    targetMonth?: YearMonth
  }
  dataQuality: {
    monthsWithHistory: number
    currentMonthExpenseCount: number
    purchasePlansCount: number
    savingsLedgerCount: number
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 100
  return Math.max(0, Math.min(100, Math.round(value)))
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function signal(
  key: string,
  label: string,
  status: PurchaseRiskSignalStatus,
  value: number,
  detail: string,
): PurchaseRiskSignal {
  return { key, label, status, value: Number.isFinite(value) ? value : 0, detail }
}

function monthHistory(state: CttmState, month: YearMonth, count = 6) {
  const rows: Array<{
    month: YearMonth
    totalSpentVnd: number
    variableSpentVnd: number
    savingsVnd: number
  }> = []
  let cursor = previousMonth(month)
  for (let i = 0; i < count; i += 1) {
    const settings = getEffectiveSettingsForMonth(state, cursor)
    const incomeVnd = getMonthlyIncomeTotalVnd(settings)
    const totals = getMonthTotals(state, cursor)
    if (incomeVnd > 0 || totals.totalSpent > 0) {
      rows.push({
        month: cursor,
        totalSpentVnd: totals.totalSpent,
        variableSpentVnd: totals.variableTotal,
        savingsVnd: incomeVnd - totals.totalSpent,
      })
    }
    cursor = previousMonth(cursor)
  }
  return rows
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function analyzePurchaseRisk(input: PurchaseRiskInput): PurchaseRiskResult {
  const state = input.state
  const today = input.today ?? todayIso()
  const month = monthFromIsoDate(today)
  const dayContext = getDayLockMonthContext(today)
  const dim = dayContext.daysInMonth
  const day = Math.max(1, Math.min(dim, dayContext.dayOfMonth))
  const remainingDays = dayContext.remainingDaysInMonth
  const purchase = {
    ...input.purchase,
    name: input.purchase.name.trim(),
    priceVnd: Math.max(0, Math.trunc(input.purchase.priceVnd)),
  }

  const totals = getMonthTotals(state, month)
  const toDate = getMonthToDateTotals(state, today)
  const settings = getEffectiveSettingsForMonth(state, month)
  const adjustment = getEffectiveBudgetAdjustmentForMonth(state, month)
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settings),
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
    rule: settings.budgetRule,
    adjustment,
    customSavingsGoalVnd: settings.customSavingsGoalVnd,
  })
  const caps = getEffectiveCapsForMonth(state, month)
  const emergencyFundBalanceVnd = getEffectiveEmergencyFundBalance(state, month)
  const emergency = computeEmergencyFund({
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: budgets.essentialVariableBaselineVnd,
    targetMonths: settings.emergencyFundTargetMonths,
    currentBalanceVnd: emergencyFundBalanceVnd,
  })
  const debt = computeDebtToIncome({
    incomeVnd: budgets.incomeVnd,
    debtPaymentMonthlyVnd: settings.debtPaymentMonthlyVnd,
  })

  const price = purchase.priceVnd
  const spendingBudgetVnd = Math.max(0, budgets.incomeVnd - budgets.savingsTargetVnd)
  const totalSpentAfterPurchaseVnd = totals.totalSpent + price
  const totalRemainingAfterPurchaseVnd = spendingBudgetVnd - totalSpentAfterPurchaseVnd

  const bucketBudgetVnd =
    purchase.bucket === "wants" ? budgets.wantsBudgetVnd : budgets.essentialVariableBaselineVnd
  const bucketSpentVnd = purchase.bucket === "wants" ? totals.variableWants : totals.variableNeeds
  const bucketRemainingBeforeVnd = bucketBudgetVnd - bucketSpentVnd
  const bucketRemainingAfterPurchaseVnd = bucketRemainingBeforeVnd - price

  const plannedVariableToDateVnd = Math.round(
    (budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd) * (day / dim),
  )
  const variablePaceOverspendVnd = Math.max(
    0,
    toDate.variableTotalToDateVnd - plannedVariableToDateVnd,
  )

  const variableNeedsPaceVnd = toDate.variableNeedsToDateVnd / day
  const variableWantsPaceVnd = toDate.variableWantsToDateVnd / day
  const projectedNeedsEndMonthVnd = Math.max(
    budgets.essentialVariableBaselineVnd,
    Math.round(variableNeedsPaceVnd * dim),
  )
  const projectedWantsEndMonthVnd = Math.max(
    totals.variableWants,
    Math.round(variableWantsPaceVnd * dim),
  )
  const projectedEndMonthBalanceBeforeVnd =
    budgets.incomeVnd -
    totals.fixedCostsTotal -
    projectedNeedsEndMonthVnd -
    projectedWantsEndMonthVnd
  const projectedEndMonthBalanceAfterPurchaseVnd =
    projectedEndMonthBalanceBeforeVnd - price

  const emergencyAfterIfUsedVnd = Math.max(0, emergencyFundBalanceVnd - price)
  const emergencyCoverageAfterIfUsedMonths = ratio(
    emergencyAfterIfUsedVnd,
    emergency.essentialMonthlyVnd,
  )
  const dailyCapAfterPurchaseVnd =
    remainingDays > 0
      ? Math.floor(Math.max(0, totalRemainingAfterPurchaseVnd) / remainingDays)
      : 0
  const essentialRemainingAfterPurchaseVnd = Math.max(
    0,
    budgets.essentialVariableBaselineVnd -
      totals.variableNeeds -
      (purchase.bucket === "needs" ? price : 0),
  )
  const essentialDailyNeedAfterPurchaseVnd =
    remainingDays > 0 ? Math.ceil(essentialRemainingAfterPurchaseVnd / remainingDays) : 0

  const history = monthHistory(state, month, 6)
  const historicalAverageSpendVnd = Math.round(
    average(history.map((row) => row.totalSpentVnd).filter((value) => value > 0)),
  )
  const historicalAverageSavingsVnd = Math.round(
    average(history.map((row) => row.savingsVnd).filter((value) => Number.isFinite(value))),
  )
  const currentMonthExpenseCount = state.indexes.expensesByMonth[month]?.length ?? 0
  const purchasePlans = state.entities.purchasePlans.allIds
    .map((id) => state.entities.purchasePlans.byId[id])
    .filter((plan) => !!plan)
  const existingPlanExposureVnd = purchasePlans.reduce((sum, plan) => {
    if (!plan) return sum
    if (plan.id === purchase.id) return sum
    if (plan.targetDate && plan.targetDate < today) return sum
    return sum + Math.max(0, plan.priceVnd)
  }, 0)
  const savingsLedgerCount = state.entities.savingsTransactions.allIds.length

  let risk = 0
  const hardStops: string[] = []
  const reasons: string[] = []

  if (budgets.incomeVnd <= 0) {
    risk += 100
    hardStops.push("Chưa có thu nhập tháng, không đủ dữ liệu để cho phép mua.")
  }
  if (price <= 0) {
    risk += 100
    hardStops.push("Giá món mua phải lớn hơn 0.")
  }

  const priceIncomeRatio = ratio(price, budgets.incomeVnd)
  if (priceIncomeRatio >= 0.2) risk += 18
  else if (priceIncomeRatio >= 0.1) risk += 10
  else if (priceIncomeRatio >= 0.05) risk += 4

  if (purchase.priority === "low" && purchase.bucket === "wants") {
    risk += 4
    reasons.push("Ưu tiên thấp nhưng dùng ngân sách Mong muốn, nên không được ưu ái trong tháng này.")
  }

  if (bucketRemainingAfterPurchaseVnd < 0) {
    const gap = Math.abs(bucketRemainingAfterPurchaseVnd)
    risk += purchase.bucket === "wants" ? 26 : 16
    risk += Math.min(12, Math.round(ratio(gap, Math.max(1, budgets.incomeVnd)) * 100))
    if (purchase.bucket === "wants" && !purchase.forced) {
      hardStops.push("Mua xong sẽ âm ngân sách Mong muốn.")
    }
  }

  if (totalRemainingAfterPurchaseVnd < 0) {
    risk += 18
    if (!purchase.forced) hardStops.push("Mua xong sẽ vượt ngân sách chi tháng.")
  }

  if (projectedEndMonthBalanceAfterPurchaseVnd < budgets.mssVnd) {
    risk += 30
    if (!purchase.forced) {
      hardStops.push("Dự báo cuối tháng sau mua thấp hơn MSS.")
    }
  } else if (projectedEndMonthBalanceAfterPurchaseVnd < budgets.savingsTargetVnd) {
    risk += 12
    reasons.push("Mua xong vẫn trên MSS nhưng có nguy cơ hụt mục tiêu tiết kiệm tháng.")
  }

  if (emergency.coverageMonths < 1) risk += 20
  else if (emergency.coverageMonths < 3) risk += 10

  if (purchase.forced && emergencyCoverageAfterIfUsedMonths < 1) {
    risk += 15
    reasons.push("Nếu phải dùng quỹ khẩn cấp, mức phủ còn dưới 1 tháng chi thiết yếu.")
  }

  if (variablePaceOverspendVnd > Math.max(50_000, budgets.incomeVnd * 0.01)) {
    risk += 12
    reasons.push("Nhịp chi biến đổi đang vượt kế hoạch đến hôm nay.")
  }

  if (remainingDays > 0 && dailyCapAfterPurchaseVnd < essentialDailyNeedAfterPurchaseVnd) {
    risk += 18
    hardStops.push("Cap/ngày sau mua thấp hơn nhu cầu thiết yếu còn lại.")
  }

  if (debt.ratio > 0.3) risk += 15
  else if (debt.ratio >= 0.2) risk += 8

  if (
    historicalAverageSpendVnd > 0 &&
    totals.totalSpent + price > historicalAverageSpendVnd * 1.15
  ) {
    risk += 8
    reasons.push("Sau mua, chi tháng hiện tại cao hơn đáng kể so với trung bình lịch sử.")
  }

  if (existingPlanExposureVnd > 0 && existingPlanExposureVnd + price > budgets.wantsBudgetVnd) {
    risk += 6
    reasons.push("Các kế hoạch mua đã lưu đang tạo thêm áp lực lên ngân sách tương lai.")
  }

  if (caps?.dailyTotalCapVnd && price > caps.dailyTotalCapVnd) {
    risk += 8
    reasons.push("Giá món mua vượt cap tổng chi/ngày đang áp dụng.")
  }
  if (purchase.bucket === "wants" && caps?.dailyWantsCapVnd !== undefined && caps.dailyWantsCapVnd !== null && price > caps.dailyWantsCapVnd) {
    risk += 8
    reasons.push("Giá món mua vượt cap Mong muốn/ngày đang áp dụng.")
  }

  if (purchase.targetDate && purchase.targetDate > today && purchase.bucket === "wants") {
    reasons.push("Ngày mục tiêu còn ở tương lai; nếu không bắt buộc mua ngay thì chờ đến đúng ngày kế hoạch.")
  }

  const riskScore = clampScore(risk)
  const dataQualityScore =
    (budgets.incomeVnd > 0 ? 25 : 0) +
    (totals.fixedCostsTotal > 0 ? 15 : 0) +
    (currentMonthExpenseCount > 0 ? 20 : 0) +
    (history.length >= 2 ? 20 : history.length > 0 ? 10 : 0) +
    (emergencyFundBalanceVnd > 0 || savingsLedgerCount > 0 ? 15 : 0) +
    (purchasePlans.length > 0 ? 5 : 0)
  const confidencePct = Math.max(45, Math.min(95, dataQualityScore))

  const signals: PurchaseRiskSignal[] = [
    signal(
      "bucket",
      purchase.bucket === "wants" ? "Ngân sách Mong muốn" : "Ngân sách Thiết yếu",
      bucketRemainingAfterPurchaseVnd >= 0 ? "pass" : purchase.bucket === "wants" ? "fail" : "warn",
      bucketRemainingAfterPurchaseVnd,
      bucketRemainingAfterPurchaseVnd >= 0
        ? "Bucket còn dương sau mua."
        : "Bucket sẽ âm sau mua.",
    ),
    signal(
      "mss",
      "MSS cuối tháng",
      projectedEndMonthBalanceAfterPurchaseVnd >= budgets.mssVnd ? "pass" : "fail",
      projectedEndMonthBalanceAfterPurchaseVnd - budgets.mssVnd,
      projectedEndMonthBalanceAfterPurchaseVnd >= budgets.mssVnd
        ? "Dự báo vẫn trên mức an toàn tối thiểu."
        : "Dự báo thủng mức an toàn tối thiểu.",
    ),
    signal(
      "emergency",
      "Quỹ khẩn cấp",
      emergency.coverageMonths >= 3 ? "pass" : emergency.coverageMonths >= 1 ? "warn" : "fail",
      emergency.coverageMonths,
      "Mức phủ quỹ hiện tại theo chi thiết yếu tháng.",
    ),
    signal(
      "pace",
      "Nhịp chi tháng",
      variablePaceOverspendVnd <= Math.max(50_000, budgets.incomeVnd * 0.01) ? "pass" : "warn",
      variablePaceOverspendVnd,
      variablePaceOverspendVnd > 0 ? "Đang vượt nhịp kế hoạch." : "Đang trong nhịp kế hoạch.",
    ),
    signal(
      "daily-cap",
      "Cap/ngày sau mua",
      dailyCapAfterPurchaseVnd >= essentialDailyNeedAfterPurchaseVnd ? "pass" : "fail",
      dailyCapAfterPurchaseVnd,
      "So với nhu cầu thiết yếu còn lại mỗi ngày.",
    ),
    signal(
      "debt",
      "Nợ / thu nhập",
      debt.ratio > 0.3 ? "fail" : debt.ratio >= 0.2 ? "warn" : "pass",
      debt.ratio,
      "Tỷ lệ trả nợ tháng trên thu nhập tháng.",
    ),
  ]

  let decision: PurchaseRiskDecision
  if (purchase.forced) {
    decision = "BẮT BUỘC: GIẢM THIỆT HẠI"
  } else if (hardStops.length > 0 || riskScore >= 70) {
    decision = "KHÔNG MUA"
  } else if (riskScore >= 35) {
    decision = "CHỜ"
  } else {
    decision = "MUA ĐƯỢC"
  }

  const actionPlan: string[] = []
  if (decision === "MUA ĐƯỢC") {
    actionPlan.push("Có thể mua nếu thanh toán bằng dòng tiền tháng, không đụng quỹ khẩn cấp.")
    actionPlan.push("Sau khi mua vẫn phải ghi chi tiêu đúng bucket để các cap còn lại cập nhật.")
  } else if (decision === "CHỜ") {
    const deficit = Math.max(0, price - Math.max(0, bucketRemainingBeforeVnd))
    const monthlyCapacity = Math.max(100_000, historicalAverageSavingsVnd, budgets.savingsTargetVnd)
    const months = Math.max(1, Math.ceil(deficit / monthlyCapacity))
    actionPlan.push(`Chờ tối thiểu khoảng ${months} tháng hoặc giảm giá xuống dưới phần bucket còn lại.`)
    actionPlan.push("Không dùng quỹ khẩn cấp cho món không bắt buộc.")
  } else if (decision === "KHÔNG MUA") {
    actionPlan.push("Không mua trong tháng này. Lý do là hard stop số liệu, không phải cảm tính.")
    actionPlan.push("Chỉ xem lại khi bucket còn dương, cuối tháng vẫn trên MSS và cap/ngày không bóp thiết yếu.")
  } else {
    actionPlan.push("Nếu bắt buộc mua, ưu tiên cắt Mong muốn và tạo kế hoạch nạp lại quỹ ngay sau giao dịch.")
    actionPlan.push("Không coi đây là quyết định tốt; đây là phương án giảm thiệt hại.")
  }

  const summary =
    decision === "MUA ĐƯỢC"
      ? "Các ngưỡng an toàn chính vẫn còn dương sau mua."
      : decision === "CHỜ"
        ? "Không có hard stop tuyệt đối, nhưng rủi ro đủ cao để trì hoãn."
        : decision === "KHÔNG MUA"
          ? "Có hard stop tài chính. Mua bây giờ làm hỏng cấu trúc an toàn."
          : "Món mua bị đánh dấu bắt buộc; engine chuyển sang chế độ kiểm soát thiệt hại."

  return {
    month,
    decision,
    riskScore,
    confidencePct,
    hardStops,
    summary,
    reasons,
    signals,
    actionPlan,
    snapshot: {
      incomeVnd: budgets.incomeVnd,
      fixedCostsVnd: totals.fixedCostsTotal,
      spendingBudgetVnd,
      totalSpentVnd: totals.totalSpent,
      totalRemainingAfterPurchaseVnd,
      bucketRemainingBeforeVnd,
      bucketRemainingAfterPurchaseVnd,
      projectedEndMonthBalanceBeforeVnd,
      projectedEndMonthBalanceAfterPurchaseVnd,
      savingsTargetVnd: budgets.savingsTargetVnd,
      minimumSafetySavingsVnd: budgets.mssVnd,
      emergencyFundBalanceVnd,
      emergencyCoverageMonths: emergency.coverageMonths,
      emergencyCoverageAfterIfUsedMonths,
      remainingDaysInMonth: remainingDays,
      dailyCapAfterPurchaseVnd,
      essentialDailyNeedAfterPurchaseVnd,
      variablePaceOverspendVnd,
      historicalAverageSpendVnd,
      existingPlanExposureVnd,
      debtToIncomeRatio: debt.ratio,
      dayLocked: dayContext.locked,
      remainingStartDate: dayContext.remainingStartDate,
      budgetAdjustmentApplied: !!adjustment,
      spendingCapsApplied: !!caps,
      targetDate: purchase.targetDate,
      targetMonth: purchase.targetDate ? monthFromIsoDate(purchase.targetDate) : undefined,
    },
    dataQuality: {
      monthsWithHistory: history.length,
      currentMonthExpenseCount,
      purchasePlansCount: purchasePlans.length,
      savingsLedgerCount,
    },
  }
}
