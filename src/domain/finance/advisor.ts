import type { BudgetBucket } from "@/domain/types"
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

export type PurchaseAdvisorResult = {
  purchase: {
    name: string
    priceVnd: number
    bucket: BudgetBucket
    forced: boolean
  }
  impact: {
    ratio: number
    thresholdVnd: number
    isNegligible: boolean
  }
  recommendation: PurchaseRecommendation
  reasons: string[]
  behaviorReminder: string
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

export function evaluatePurchaseAdvisor(input: {
  purchase: {
    name: string
    priceVnd: number
    bucket: BudgetBucket
    forced: boolean
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

  const price = clampMoneyVnd(input.purchase.priceVnd)
  const bucket = input.purchase.bucket

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

  const remainingBeforePurchaseVnd = Math.trunc(
    I - F - essentialProjectedBeforeVnd - wantsSpent,
  )
  const remainingAfterPurchaseVnd = Math.trunc(
    I - F - essentialProjectedAfterVnd - wantsSpentAfterVnd,
  )

  const safetyMultiplier = coverage >= 3 ? 1 : coverage >= 1 ? 1.3 : 1.5
  const safetyBufferVnd = Math.max(0, Math.round((safetyMultiplier - 1) * MSS))
  const safetyLockVnd = MSS + safetyBufferVnd

  const deficitVnd = Math.trunc(remainingAfterPurchaseVnd - safetyLockVnd)
  const deficitIfBuyVnd = Math.max(0, -deficitVnd)

  const reasons: string[] = []
  const violatesSafety = remainingAfterPurchaseVnd < safetyLockVnd

  let recommendation: PurchaseRecommendation
  if (bucket === "wants") {
    recommendation = budgetSnapshot.hasEnoughBudget
      ? violatesSafety
        ? "CÂN NHẮC"
        : "NÊN MUA"
      : "KHÔNG NÊN"
  } else {
    recommendation = violatesSafety
      ? "CÂN NHẮC"
      : budgetSnapshot.hasEnoughBudget
        ? "NÊN MUA"
        : "CÂN NHẮC"
  }

  const behaviorReminder =
    price <= 1_000_000
      ? "Gợi ý hành vi: chờ 24 giờ trước khi quyết định."
      : "Gợi ý hành vi: chờ 7 ngày trước khi quyết định."

  const isHighValue = price >= Math.max(1_000_000, Math.round(0.1 * I))
  const shouldDowngradeForLowEmergency =
    !input.purchase.forced && bucket === "wants" && coverage < 3 && isHighValue

  if (recommendation === "NÊN MUA" && shouldDowngradeForLowEmergency) {
    recommendation = "CÂN NHẮC"
  }

  if (input.purchase.forced) {
    reasons.push(
      "Bạn đang bật chế độ BẮT BUỘC PHẢI MUA. Ứng dụng sẽ chuyển sang “Cứu nguy tài chính” để giảm rủi ro.",
    )
  }

  if (isNegligibleImpact) {
    reasons.push("Món mua nhỏ, ảnh hưởng tài chính không đáng kể.")
    return {
      purchase: {
        name: input.purchase.name,
        priceVnd: price,
        bucket,
        forced: input.purchase.forced,
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
  } else {
    if (budgetSnapshot.hasEnoughBudget) {
      reasons.push("Khoản này nằm trong baseline “Thiết yếu (E)” của tháng.")
    } else {
      reasons.push(
        `Khoản này vượt baseline “Thiết yếu (E)” còn lại ${formatVnd(essentialRemainingVnd)} và có thể làm giảm “Mong muốn”/“Tiết kiệm”.`,
      )
    }
  }

  if (violatesSafety) {
    reasons.push(
      `Nếu mua ngay, bạn sẽ thiếu khoảng ${formatVnd(deficitIfBuyVnd)} so với mức cần giữ (MSS + buffer).`,
    )
  }

  if (safetyMultiplier > 1) {
    const pct = Math.round((safetyMultiplier - 1) * 100)
    reasons.push(
      `Quỹ khẩn cấp < 3 tháng (hiện ~${coverage.toFixed(1)}). Ứng dụng cộng thêm buffer ~${pct}% vào MSS để giảm rủi ro.`,
    )
  }

  if (shouldDowngradeForLowEmergency) {
    reasons.push(
      `Món này thuộc nhóm giá trị cao. Khi quỹ khẩn cấp < 3 tháng (hiện ~${coverage.toFixed(1)}), mua sắm có thể ảnh hưởng mục tiêu an toàn tài chính.`,
    )
  }

  const shouldBuildPlan =
    !input.purchase.forced && (recommendation === "KHÔNG NÊN" || violatesSafety)

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
        `Dư địa để dành theo ngân sách (Mong muốn + Tiết kiệm) chỉ ${formatVnd(monthlyAvailableForGoalVnd)}/tháng, thấp hơn mức tối thiểu ${formatVnd(minMonthlySavingVnd)}/tháng.`,
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
        reasons.push("Kế hoạch tiết kiệm dự kiến > 60 tháng → khó khả thi.")
        monthsToSave = 60
      }
    }

    const cutSuggestions: string[] = []
    if (isFeasible) {
      if (bucket === "wants") {
        cutSuggestions.push(
          `Giảm mua sắm/giải trí ~${formatVnd(monthlyTargetVnd)}/tháng trong ${monthsToSave} tháng.`,
        )
        if (price > wantsRemainingVnd) {
          cutSuggestions.push(
            "Tạm hoãn các khoản mua sắm không cần thiết cho đến khi đủ quỹ.",
          )
        }
      } else {
        cutSuggestions.push(
          `Chuẩn bị quỹ riêng ~${formatVnd(monthlyTargetVnd)}/tháng để tránh ảnh hưởng ngân sách thiết yếu.`,
        )
      }
    } else {
      cutSuggestions.push(
        "Hiện tại không khả thi về tài chính. Ưu tiên tăng thu nhập/giảm chi phí cố định và nâng quỹ khẩn cấp trước.",
      )
    }

    return {
      purchase: {
        name: input.purchase.name,
        priceVnd: price,
        bucket,
        forced: input.purchase.forced,
      },
      impact: {
        ratio: impactRatio,
        thresholdVnd: impactThresholdVnd,
        isNegligible: false,
      },
      recommendation,
      reasons,
      behaviorReminder,
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
    },
    impact: {
      ratio: impactRatio,
      thresholdVnd: impactThresholdVnd,
      isNegligible: false,
    },
    recommendation,
    reasons,
    behaviorReminder,
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
