import type { BudgetBucket, PurchasePriority } from "@/domain/types"
import { clampMoneyVnd, computeMinimumSafetySavings } from "@/domain/finance/finance"
import { formatVnd } from "@/lib/currency"

export type PurchaseRecommendation = "NÊN MUA" | "CÂN NHẮC" | "KHÔNG NÊN"

export type PurchaseBudgetSnapshot = {
  bucket: BudgetBucket
  label: string
  plannedMonthlyVnd: number
  spentToDateVnd: number
  remainingVnd: number
  hasEnoughBudget: boolean
}

export type PurchaseDecisionSignal = {
  key: string
  label: string
  status: "good" | "warn" | "bad"
  detail: string
}

export type PurchaseDecisionEngine = {
  riskScore: number
  confidencePct: number
  hardStops: string[]
  signals: PurchaseDecisionSignal[]
  pace: {
    plannedToDateVnd: number
    actualToDateVnd: number
    overspendVnd: number
    toleranceVnd: number
  }
}

export type PurchaseAdvisorResult = {
  purchase: {
    name: string
    priceVnd: number
    bucket: BudgetBucket
    forced: boolean
    priority?: PurchasePriority
  }
  impact: {
    ratio: number
    thresholdVnd: number
    isNegligible: boolean
  }
  recommendation: PurchaseRecommendation
  reasons: string[]
  behaviorReminder: string
  decisionEngine: PurchaseDecisionEngine
  budgetSnapshot: PurchaseBudgetSnapshot
  safetySnapshot: {
    violatesSafety: boolean
    emergencyCoverageMonths: number
    fixedCostsVnd: number
    essentialBaselineVnd: number
    needsSpentToDateVnd: number
    wantsSpentToDateVnd: number
    variableSpentToDateVnd: number
    minimumSafetySavingsVnd: number
    safetyBufferVnd: number
    safetyLockVnd: number
    remainingBeforePurchaseVnd: number
    remainingAfterPurchaseVnd: number
    deficitVnd: number
    deficitIfBuyVnd: number
  }
  savingsPlan?: {
    isFeasible: boolean
    warning?: string
    monthsToSave: number
    minMonthlySavingVnd: number
    monthlyAvailableForGoalVnd: number
    monthlyTargetVnd: number
    cutSuggestions: string[]
  }
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function severityByCoverage(coverage: number): "good" | "warn" | "bad" {
  if (coverage >= 3) return "good"
  if (coverage >= 1) return "warn"
  return "bad"
}

function baseRecommendation(input: {
  bucket: BudgetBucket
  hasEnoughBudget: boolean
  violatesSafety: boolean
}): PurchaseRecommendation {
  const { bucket, hasEnoughBudget, violatesSafety } = input
  if (bucket === "wants") {
    if (!hasEnoughBudget) return "KHÔNG NÊN"
    return violatesSafety ? "CÂN NHẮC" : "NÊN MUA"
  }
  if (hasEnoughBudget && !violatesSafety) return "NÊN MUA"
  return "CÂN NHẮC"
}

export function evaluatePurchaseAdvisor(input: {
  purchase: {
    name: string
    priceVnd: number
    bucket: BudgetBucket
    forced: boolean
    priority?: PurchasePriority
  }
  context: {
    incomeVnd: number
    fixedCostsVnd: number
    essentialVariableBaselineVnd: number
    variableNeedsSpentVnd: number
    variableWantsSpentVnd: number
    wantsBudgetVnd: number
    savingsBudgetVnd: number
    emergencyCoverageMonths: number
    emergencyFundTargetMonths: number
    dayOfMonth?: number
    daysInMonth?: number
  }
}): PurchaseAdvisorResult {
  const I = clampMoneyVnd(input.context.incomeVnd)
  const F = clampMoneyVnd(input.context.fixedCostsVnd)
  const Ebaseline = clampMoneyVnd(input.context.essentialVariableBaselineVnd)
  const needsSpent = clampMoneyVnd(input.context.variableNeedsSpentVnd)
  const wantsSpent = clampMoneyVnd(input.context.variableWantsSpentVnd)
  const wantsBudget = clampMoneyVnd(input.context.wantsBudgetVnd)
  const savingsBudget = clampMoneyVnd(input.context.savingsBudgetVnd)
  const coverage = Number.isFinite(input.context.emergencyCoverageMonths)
    ? input.context.emergencyCoverageMonths
    : 0

  const dim = Math.max(1, Math.trunc(input.context.daysInMonth ?? 30))
  const dom = Math.max(1, Math.min(dim, Math.trunc(input.context.dayOfMonth ?? dim)))
  const price = clampMoneyVnd(input.purchase.priceVnd)
  const bucket = input.purchase.bucket
  const priority = input.purchase.priority ?? "med"

  const MSS = computeMinimumSafetySavings(I)
  const impactThresholdVnd =
    I > 0 ? Math.min(500_000, Math.max(1, Math.round(0.05 * I))) : 500_000
  const impactRatio = I > 0 ? price / I : 0
  const isNegligibleImpact =
    !input.purchase.forced && price > 0 && price <= impactThresholdVnd

  const wantsRemainingVnd = Math.max(0, wantsBudget - wantsSpent)
  const essentialRemainingVnd = Math.max(0, Ebaseline - needsSpent)
  const variableSpentToDateVnd = needsSpent + wantsSpent

  const budgetSnapshot: PurchaseBudgetSnapshot =
    bucket === "wants"
      ? {
          bucket,
          label: "Mong muốn",
          plannedMonthlyVnd: wantsBudget,
          spentToDateVnd: wantsSpent,
          remainingVnd: wantsRemainingVnd,
          hasEnoughBudget: wantsRemainingVnd >= price,
        }
      : {
          bucket,
          label: "Thiết yếu",
          plannedMonthlyVnd: Ebaseline,
          spentToDateVnd: needsSpent,
          remainingVnd: essentialRemainingVnd,
          hasEnoughBudget: essentialRemainingVnd >= price,
        }

  const wantsSpentAfterVnd = wantsSpent + (bucket === "wants" ? price : 0)
  const needsSpentAfterVnd = needsSpent + (bucket === "needs" ? price : 0)
  const essentialProjectedBeforeVnd = Math.max(Ebaseline, needsSpent)
  const essentialProjectedAfterVnd = Math.max(Ebaseline, needsSpentAfterVnd)

  const remainingBeforePurchaseVnd = Math.trunc(I - F - essentialProjectedBeforeVnd - wantsSpent)
  const remainingAfterPurchaseVnd = Math.trunc(I - F - essentialProjectedAfterVnd - wantsSpentAfterVnd)

  const safetyMultiplier = coverage >= 3 ? 1 : coverage >= 1 ? 1.3 : 1.5
  const safetyBufferVnd = Math.max(0, Math.round((safetyMultiplier - 1) * MSS))
  const safetyLockVnd = MSS + safetyBufferVnd
  const deficitVnd = Math.trunc(remainingAfterPurchaseVnd - safetyLockVnd)
  const deficitIfBuyVnd = Math.max(0, -deficitVnd)
  const violatesSafety = remainingAfterPurchaseVnd < safetyLockVnd

  const plannedNeedsToDateVnd = Math.round((Ebaseline * dom) / dim)
  const plannedWantsToDateVnd = Math.round((wantsBudget * dom) / dim)
  const plannedToDateVnd = plannedNeedsToDateVnd + plannedWantsToDateVnd
  const actualToDateVnd = variableSpentToDateVnd
  const paceOverspendVnd = Math.max(0, actualToDateVnd - plannedToDateVnd)
  const wantsPaceOverspendVnd = Math.max(0, wantsSpent - plannedWantsToDateVnd)
  const toleranceVnd = I > 0 ? Math.min(Math.round(0.01 * I), 50_000) : 50_000
  const severePaceThresholdVnd = Math.max(Math.round(0.05 * I), 300_000)
  const paceOver = paceOverspendVnd > toleranceVnd
  const wantsPaceOver = wantsPaceOverspendVnd > toleranceVnd

  const hardStops: string[] = []
  if (
    !input.purchase.forced &&
    bucket === "wants" &&
    !budgetSnapshot.hasEnoughBudget &&
    coverage < 1
  ) {
    hardStops.push("Ngân sách Mong muốn không đủ và quỹ khẩn cấp dưới 1 tháng.")
  }
  if (!input.purchase.forced && deficitIfBuyVnd > Math.max(Math.round(0.1 * I), 1_000_000)) {
    hardStops.push("Thiếu hụt sau mua vượt ngưỡng an toàn nghiêm trọng.")
  }
  if (
    !input.purchase.forced &&
    bucket === "wants" &&
    coverage < 0.5 &&
    price >= Math.max(impactThresholdVnd, 500_000)
  ) {
    hardStops.push("Quỹ khẩn cấp dưới 0.5 tháng cho khoản mua Mong muốn.")
  }
  if (!input.purchase.forced && bucket === "wants" && paceOverspendVnd > severePaceThresholdVnd) {
    hardStops.push("Nhịp chi hiện tại đang vượt mạnh kế hoạch tháng.")
  }

  let riskScore = 0
  if (!budgetSnapshot.hasEnoughBudget) riskScore += bucket === "wants" ? 32 : 18
  if (violatesSafety) {
    const penalty = 15 + Math.round((deficitIfBuyVnd / Math.max(1, I)) * 120)
    riskScore += Math.min(40, penalty)
  }
  if (coverage < 1) riskScore += 20
  else if (coverage < 3) riskScore += 10
  if (paceOver) riskScore += 12
  if (wantsPaceOver && bucket === "wants") riskScore += 8
  if (price >= Math.max(1_000_000, Math.round(0.1 * I))) riskScore += 8
  if (priority === "low" && bucket === "wants") riskScore += 4
  if (priority === "high" && bucket === "needs") riskScore -= 8
  if (input.purchase.forced) riskScore += 6
  riskScore = Math.max(0, Math.min(100, riskScore))
  if (hardStops.length > 0) riskScore = Math.max(riskScore, 78)

  let confidencePct = 75
  if (hardStops.length > 0) confidencePct = 92
  else if (riskScore < 25) confidencePct = 85
  else if (riskScore < 50) confidencePct = 80
  else if (riskScore < 75) confidencePct = 76
  else confidencePct = 88
  if (Math.abs(price - impactThresholdVnd) <= Math.max(10_000, Math.round(impactThresholdVnd * 0.1))) {
    confidencePct = Math.max(55, confidencePct - 6)
  }

  let recommendation = baseRecommendation({
    bucket,
    hasEnoughBudget: budgetSnapshot.hasEnoughBudget,
    violatesSafety,
  })

  const isHighValue = price >= Math.max(1_000_000, Math.round(0.1 * I))
  const shouldDowngradeForLowEmergency =
    !input.purchase.forced && bucket === "wants" && coverage < 3 && isHighValue
  if (recommendation === "NÊN MUA" && shouldDowngradeForLowEmergency) {
    recommendation = "CÂN NHẮC"
  }

  if (!isNegligibleImpact) {
    if (hardStops.length > 0) {
      recommendation = "KHÔNG NÊN"
    } else if (recommendation === "NÊN MUA" && riskScore >= 55) {
      recommendation = "CÂN NHẮC"
    } else if (recommendation === "CÂN NHẮC" && riskScore >= 82) {
      recommendation = "KHÔNG NÊN"
    }
  }

  const isCaseB = bucket === "wants" && budgetSnapshot.hasEnoughBudget && violatesSafety
  if (isCaseB && recommendation === "KHÔNG NÊN") {
    recommendation = "CÂN NHẮC"
  }

  const signals: PurchaseDecisionSignal[] = [
    {
      key: "budget",
      label: `Ngân sách ${budgetSnapshot.label}`,
      status: budgetSnapshot.hasEnoughBudget ? "good" : "bad",
      detail: budgetSnapshot.hasEnoughBudget
        ? `Còn ${formatVnd(budgetSnapshot.remainingVnd)}`
        : `Thiếu ${formatVnd(Math.max(0, price - budgetSnapshot.remainingVnd))}`,
    },
    {
      key: "safety",
      label: "SafetyLock (MSS + buffer)",
      status: violatesSafety ? "bad" : "good",
      detail: violatesSafety
        ? `Thiếu ${formatVnd(deficitIfBuyVnd)} sau khi mua`
        : `Dư ${formatVnd(Math.max(0, deficitVnd))} sau khi mua`,
    },
    {
      key: "emergency",
      label: "Quỹ khẩn cấp",
      status: severityByCoverage(coverage),
      detail: `Độ phủ ~${Number.isFinite(coverage) ? coverage.toFixed(1) : "-"} tháng`,
    },
    {
      key: "pace",
      label: "Nhịp chi tháng",
      status: paceOver ? "warn" : "good",
      detail: paceOver
        ? `Vượt nhịp ${formatVnd(paceOverspendVnd)}`
        : "Đang bám nhịp kế hoạch",
    },
    {
      key: "impact",
      label: "Mức ảnh hưởng món mua",
      status: isNegligibleImpact ? "good" : impactRatio >= 0.1 ? "warn" : "good",
      detail: `${clampPct(impactRatio * 100)}% thu nhập tháng`,
    },
  ]

  const reasons: string[] = []
  reasons.push(
    `Điểm rủi ro hiện tại: ${riskScore}/100 (độ tin cậy ${confidencePct}%).`,
  )
  if (input.purchase.forced) {
    reasons.push("Đang bật chế độ BẮT BUỘC MUA, hệ thống chỉ tối ưu giảm thiệt hại.")
  }

  if (isNegligibleImpact) {
    reasons.push("Món mua nhỏ, ảnh hưởng tài chính không đáng kể.")
    const behaviorReminder =
      recommendation === "NÊN MUA"
        ? "Quyết định máy: có thể mua, vẫn ghi nhận vào ngân sách để giữ kỷ luật."
        : "Quyết định máy: cân nhắc lại vì ngân sách bucket hiện không đủ."

    return {
      purchase: {
        name: input.purchase.name,
        priceVnd: price,
        bucket,
        forced: input.purchase.forced,
        priority,
      },
      impact: {
        ratio: impactRatio,
        thresholdVnd: impactThresholdVnd,
        isNegligible: true,
      },
      recommendation:
        bucket === "wants"
          ? budgetSnapshot.hasEnoughBudget
            ? "NÊN MUA"
            : "KHÔNG NÊN"
          : budgetSnapshot.hasEnoughBudget
            ? "NÊN MUA"
            : "CÂN NHẮC",
      reasons,
      behaviorReminder,
      decisionEngine: {
        riskScore,
        confidencePct,
        hardStops: [],
        signals,
        pace: {
          plannedToDateVnd,
          actualToDateVnd,
          overspendVnd: 0,
          toleranceVnd,
        },
      },
      budgetSnapshot,
      safetySnapshot: {
        violatesSafety: false,
        emergencyCoverageMonths: coverage,
        fixedCostsVnd: F,
        essentialBaselineVnd: Ebaseline,
        needsSpentToDateVnd: needsSpent,
        wantsSpentToDateVnd: wantsSpent,
        variableSpentToDateVnd,
        minimumSafetySavingsVnd: MSS,
        safetyBufferVnd: 0,
        safetyLockVnd: 0,
        remainingBeforePurchaseVnd,
        remainingAfterPurchaseVnd,
        deficitVnd: 0,
        deficitIfBuyVnd: 0,
      },
    }
  }

  if (bucket === "wants") {
    if (!budgetSnapshot.hasEnoughBudget) {
      reasons.push(
        `Ngân sách “Mong muốn” còn lại ${formatVnd(wantsRemainingVnd)} chưa đủ cho giá ${formatVnd(price)}.`,
      )
    } else {
      reasons.push("Bạn có đủ ngân sách “Mong muốn” để mua món này.")
    }
  } else if (budgetSnapshot.hasEnoughBudget) {
    reasons.push("Khoản này nằm trong baseline “Thiết yếu (E)” của tháng.")
  } else {
    reasons.push(
      `Khoản này vượt baseline “Thiết yếu (E)” còn lại ${formatVnd(essentialRemainingVnd)}.`,
    )
  }

  if (violatesSafety) {
    reasons.push(
      `Sau khi mua sẽ thiếu ${formatVnd(deficitIfBuyVnd)} so với SafetyLock (MSS + buffer).`,
    )
  }

  if (paceOver) {
    reasons.push(
      `Nhịp chi đang vượt kế hoạch ${formatVnd(paceOverspendVnd)} (tolerance ${formatVnd(toleranceVnd)}).`,
    )
  }

  if (shouldDowngradeForLowEmergency) {
    reasons.push(
      `Món giá trị cao trong khi quỹ khẩn cấp < 3 tháng (~${coverage.toFixed(1)}).`,
    )
  }

  if (hardStops.length > 0) {
    for (const stop of hardStops) reasons.push(`Điểm chặn: ${stop}`)
  }

  let behaviorReminder = "Quyết định máy: giữ kỷ luật chi tiêu theo cap ngày và MSS."
  if (recommendation === "NÊN MUA") {
    behaviorReminder = "Quyết định máy: có thể mua trong điều kiện hiện tại."
  } else if (recommendation === "CÂN NHẮC") {
    behaviorReminder = "Quyết định máy: chỉ mua khi có kế hoạch bù cụ thể."
  } else {
    behaviorReminder = "Quyết định máy: chưa nên mua ở trạng thái tài chính hiện tại."
  }

  const shouldBuildPlan =
    !input.purchase.forced &&
    (recommendation === "KHÔNG NÊN" || violatesSafety || riskScore >= 55)

  if (shouldBuildPlan) {
    const minMonthlySavingVnd = computeMinimumSafetySavings(I)
    const monthlyAvailableForGoalVnd = clampMoneyVnd(wantsBudget + savingsBudget)

    let isFeasible = true
    let warning: string | undefined = undefined
    let monthlyTargetVnd = minMonthlySavingVnd
    let monthsToSave = 60

    if (monthlyAvailableForGoalVnd < minMonthlySavingVnd) {
      isFeasible = false
      warning = "Hiện tại không khả thi về tài chính."
      reasons.push(
        `Khả dụng theo kế hoạch chỉ ${formatVnd(monthlyAvailableForGoalVnd)}/tháng, thấp hơn mức tối thiểu ${formatVnd(minMonthlySavingVnd)}/tháng.`,
      )
    } else {
      const suggested = Math.max(Math.round(0.1 * I), Math.ceil(price / 6))
      monthlyTargetVnd = Math.min(
        monthlyAvailableForGoalVnd,
        Math.max(minMonthlySavingVnd, suggested),
      )

      const requiredFor60 = Math.max(minMonthlySavingVnd, Math.ceil(price / 60))
      if (requiredFor60 <= monthlyAvailableForGoalVnd) {
        monthlyTargetVnd = Math.max(monthlyTargetVnd, requiredFor60)
      }

      monthsToSave = Math.ceil(price / Math.max(1, monthlyTargetVnd))
      if (monthsToSave > 60) {
        isFeasible = false
        warning =
          "Kế hoạch tiết kiệm dự kiến > 60 tháng: không khả thi với mức thu nhập/ngân sách hiện tại."
        reasons.push("Kế hoạch tiết kiệm dự kiến > 60 tháng.")
        monthsToSave = 60
      }
    }

    const cutSuggestions: string[] = []
    if (isFeasible) {
      if (bucket === "wants") {
        cutSuggestions.push(
          `Giảm mua sắm/giải trí khoảng ${formatVnd(monthlyTargetVnd)}/tháng trong ${monthsToSave} tháng.`,
        )
      } else {
        cutSuggestions.push(
          `Tạo quỹ riêng khoảng ${formatVnd(monthlyTargetVnd)}/tháng để không phá vỡ E/W/S.`,
        )
      }
      if (paceOver) {
        cutSuggestions.push(
          `Giảm chi biến đổi thêm khoảng ${formatVnd(Math.ceil(paceOverspendVnd / Math.max(1, dim - dom + 1)))}/ngày để kéo nhịp về kế hoạch.`,
        )
      }
    } else {
      cutSuggestions.push(
        "Ưu tiên nâng thu nhập hoặc giảm chi phí cố định trước khi triển khai mua món này.",
      )
    }

    return {
      purchase: {
        name: input.purchase.name,
        priceVnd: price,
        bucket,
        forced: input.purchase.forced,
        priority,
      },
      impact: {
        ratio: impactRatio,
        thresholdVnd: impactThresholdVnd,
        isNegligible: false,
      },
      recommendation,
      reasons,
      behaviorReminder,
      decisionEngine: {
        riskScore,
        confidencePct,
        hardStops,
        signals,
        pace: {
          plannedToDateVnd,
          actualToDateVnd,
          overspendVnd: paceOverspendVnd,
          toleranceVnd,
        },
      },
      budgetSnapshot,
      safetySnapshot: {
        violatesSafety,
        emergencyCoverageMonths: coverage,
        fixedCostsVnd: F,
        essentialBaselineVnd: Ebaseline,
        needsSpentToDateVnd: needsSpent,
        wantsSpentToDateVnd: wantsSpent,
        variableSpentToDateVnd,
        minimumSafetySavingsVnd: MSS,
        safetyBufferVnd,
        safetyLockVnd,
        remainingBeforePurchaseVnd,
        remainingAfterPurchaseVnd,
        deficitVnd,
        deficitIfBuyVnd,
      },
      savingsPlan: {
        isFeasible,
        warning,
        monthsToSave,
        minMonthlySavingVnd,
        monthlyAvailableForGoalVnd,
        monthlyTargetVnd,
        cutSuggestions,
      },
    }
  }

  return {
    purchase: {
      name: input.purchase.name,
      priceVnd: price,
      bucket,
      forced: input.purchase.forced,
      priority,
    },
    impact: {
      ratio: impactRatio,
      thresholdVnd: impactThresholdVnd,
      isNegligible: false,
    },
    recommendation,
    reasons,
    behaviorReminder,
    decisionEngine: {
      riskScore,
      confidencePct,
      hardStops,
      signals,
      pace: {
        plannedToDateVnd,
        actualToDateVnd,
        overspendVnd: paceOverspendVnd,
        toleranceVnd,
      },
    },
    budgetSnapshot,
    safetySnapshot: {
      violatesSafety,
      emergencyCoverageMonths: coverage,
      fixedCostsVnd: F,
      essentialBaselineVnd: Ebaseline,
      needsSpentToDateVnd: needsSpent,
      wantsSpentToDateVnd: wantsSpent,
      variableSpentToDateVnd,
      minimumSafetySavingsVnd: MSS,
      safetyBufferVnd,
      safetyLockVnd,
      remainingBeforePurchaseVnd,
      remainingAfterPurchaseVnd,
      deficitVnd,
      deficitIfBuyVnd,
    },
  }
}
