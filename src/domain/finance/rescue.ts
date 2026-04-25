import type { BudgetBucket, ISODate, YearMonth } from "@/domain/types"
import {
  clampMoneyVnd,
  computeDebtToIncome,
  computeMinimumSafetySavings,
} from "@/domain/finance/finance"
import { formatVnd } from "@/lib/currency"
import { addDaysIsoDate } from "@/lib/date"

export type OverspendSeverity = "nhẹ" | "trung bình" | "mạnh"

export type CrisisSeverity =
  | "NHẸ"
  | "TRUNG BÌNH"
  | "NẶNG"
  | "NGUY CẤP VỠ NỢ"

export type PlanImpact = {
  projectedEndMonthBalanceVnd: number
  projectedSavingsRate: number
  emergencyFundMonthsToTarget: number | null
  notes: string[]
}

export type PlanAction = {
  caps?: {
    dailyTotalCapVnd?: number | null
    dailyWantsCapVnd?: number | null
    wantsFreezeUntil?: ISODate | null
    note?: string
  }
  budgetAdjustmentDelta?: {
    needsDeltaVnd: number
    wantsDeltaVnd: number
    savingsDeltaVnd: number
    note?: string
    requiresBelowMssConfirm?: boolean
  }
  extraIncomeTargetVnd?: number
  installmentSimulation?: {
    interestRate: number
    tenorMonths: number
    monthlyInstallmentVnd: number
    warning: string
  }
}

export type RecoveryOption = {
  id: string
  title: string
  summary: string
  impact: PlanImpact
  actions: PlanAction
  warnings?: string[]
  recommended?: boolean
}

function computeEmergencyMonthsToTarget(input: {
  essentialMonthlyVnd: number
  emergencyFundCurrentVnd: number
  emergencyFundTargetMonths: number
  projectedMonthlySavingsVnd: number
}) {
  const N = clampMoneyVnd(input.essentialMonthlyVnd)
  const targetMonths = Math.max(0, Math.trunc(input.emergencyFundTargetMonths))
  if (targetMonths === 0 || N === 0) return null

  const target = N * targetMonths
  const current = clampMoneyVnd(input.emergencyFundCurrentVnd)
  const remaining = Math.max(0, target - current)
  if (remaining === 0) return 0

  const monthly = clampMoneyVnd(input.projectedMonthlySavingsVnd)
  if (monthly <= 0) return null
  return Math.ceil(remaining / monthly)
}

function impactFromProjectedSpend(input: {
  incomeVnd: number
  projectedEndMonthSpendVnd: number
  essentialMonthlyVnd: number
  emergencyFundCurrentVnd: number
  emergencyFundTargetMonths: number
  notes?: string[]
}): PlanImpact {
  const I = clampMoneyVnd(input.incomeVnd)
  const spend = clampMoneyVnd(input.projectedEndMonthSpendVnd)
  const balance = I - spend
  const savingsVnd = Math.max(0, balance)
  const savingsRate = I > 0 ? savingsVnd / I : 0
  return {
    projectedEndMonthBalanceVnd: balance,
    projectedSavingsRate: savingsRate,
    emergencyFundMonthsToTarget: computeEmergencyMonthsToTarget({
      essentialMonthlyVnd: input.essentialMonthlyVnd,
      emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
      emergencyFundTargetMonths: input.emergencyFundTargetMonths,
      projectedMonthlySavingsVnd: savingsVnd,
    }),
    notes: input.notes ?? [],
  }
}

function pickRecommended(options: RecoveryOption[]) {
  const score = (o: RecoveryOption) => {
    const warnings = o.warnings?.length ?? 0
    const months = o.impact.emergencyFundMonthsToTarget ?? 9999
    return (
      o.impact.projectedEndMonthBalanceVnd -
      warnings * 800000 -
      months * 500
    )
  }
  return options.slice().sort((a, b) => score(b) - score(a))[0]
}

export type OverspendingResult = {
  month: YearMonth
  alertText: string
  why: {
    daysRemaining: number
    requiredDailyCutVnd: number
    severity: OverspendSeverity
    mssVnd: number
    projectedEndMonthBalanceVnd: number
    mssDeficitVnd: number
    variableSpentToDateVnd: number
    variableRemainingToKeepMssVnd: number
  }
  options: RecoveryOption[]
  recommendedOptionId: string
}

export function evaluateOverspending(input: {
  month: YearMonth
  dayOfMonth: number
  daysInMonth: number
  incomeVnd: number
  budgets: {
    needsBudgetVnd: number
    wantsBudgetVnd: number
    savingsTargetVnd: number
    savingsBudgetVnd: number
  }
  spentToDate: {
    fixedCostsVnd: number
    variableSpentVnd: number
    variableNeedsSpentVnd: number
    variableWantsSpentVnd: number
  }
  emergency: {
    essentialMonthlyVnd: number
    emergencyFundCurrentVnd: number
    emergencyFundTargetMonths: number
  }
}): OverspendingResult | null {
  const day = Math.max(1, Math.trunc(input.dayOfMonth))
  const daysInMonth = Math.max(1, Math.trunc(input.daysInMonth))
  const daysRemaining = Math.max(1, daysInMonth - day)

  const I = clampMoneyVnd(input.incomeVnd)
  if (I <= 0) return null
  const fixedCostsVnd = clampMoneyVnd(input.spentToDate.fixedCostsVnd)
  const variableNeeds = clampMoneyVnd(input.spentToDate.variableNeedsSpentVnd)
  const variableWants = clampMoneyVnd(input.spentToDate.variableWantsSpentVnd)
  const variableSpentRaw = clampMoneyVnd(input.spentToDate.variableSpentVnd)
  const variableSpent = Math.max(variableSpentRaw, variableNeeds + variableWants)

  const MSS = computeMinimumSafetySavings(I)
  const essentialBaselineVnd = Math.max(0, input.budgets.needsBudgetVnd - fixedCostsVnd)
  const needsPace = variableNeeds / day
  const wantsPace = variableWants / day
  const projectedNeedsEndMonthVnd = Math.max(
    essentialBaselineVnd,
    Math.round(needsPace * daysInMonth),
  )
  const projectedWantsEndMonthVnd = Math.round(wantsPace * daysInMonth)
  const projectedEndMonthVariableSpendVnd =
    projectedNeedsEndMonthVnd + projectedWantsEndMonthVnd
  const projectedEndMonthBalanceVnd =
    I - (fixedCostsVnd + projectedEndMonthVariableSpendVnd)
  const mssDeficitVnd = Math.max(0, MSS - projectedEndMonthBalanceVnd)
  if (mssDeficitVnd <= 0) return null

  const variableBudgetToKeepMssVnd = Math.max(0, I - fixedCostsVnd - MSS)
  const variableRemainingToKeepMssVnd = Math.trunc(
    variableBudgetToKeepMssVnd - variableSpent,
  )
  const requiredDailyCutVnd = Math.ceil(mssDeficitVnd / daysRemaining)
  const plannedDailyToKeepMssVnd = variableBudgetToKeepMssVnd / daysInMonth
  const severity: OverspendSeverity =
    requiredDailyCutVnd <= 0.15 * plannedDailyToKeepMssVnd
      ? "nhẹ"
      : requiredDailyCutVnd <= 0.3 * plannedDailyToKeepMssVnd
        ? "trung bình"
        : "mạnh"

  const options: RecoveryOption[] = []

  const projectedWantsRemainingVnd = Math.max(0, projectedWantsEndMonthVnd - variableWants)
  const wantsCutVnd =
    projectedWantsRemainingVnd > 0
      ? Math.min(projectedWantsRemainingVnd, mssDeficitVnd)
      : 0

  if (projectedWantsRemainingVnd > 0) {
    const wantsAllowedRemainingVnd = Math.max(0, projectedWantsRemainingVnd - wantsCutVnd)
    const dailyWantsCapVnd = Math.max(0, Math.floor(wantsAllowedRemainingVnd / daysRemaining))
    options.push({
      id: "mss_cut_wants",
      title: "Phương án 1: Cắt “Mong muốn” để giữ MSS",
      summary:
        wantsCutVnd > 0
          ? `Cắt khoảng ${formatVnd(wantsCutVnd)} từ “Mong muốn” trong phần còn lại của tháng. ${
              dailyWantsCapVnd > 0
                ? `Cap Mong muốn ~${formatVnd(dailyWantsCapVnd)}/ngày.`
                : "Tạm dừng Mong muốn đến cuối tháng."
            }`
          : "Giảm “Mong muốn” trong phần còn lại của tháng để bảo vệ MSS.",
      impact: impactFromProjectedSpend({
        incomeVnd: I,
        projectedEndMonthSpendVnd:
          fixedCostsVnd + Math.max(0, projectedEndMonthVariableSpendVnd - wantsCutVnd),
        essentialMonthlyVnd: input.emergency.essentialMonthlyVnd,
        emergencyFundCurrentVnd: input.emergency.emergencyFundCurrentVnd,
        emergencyFundTargetMonths: input.emergency.emergencyFundTargetMonths,
        notes: ["Ưu tiên hoãn các khoản mua sắm chưa cấp thiết."],
      }),
      actions: {
        caps: {
          dailyWantsCapVnd,
          note: "Giảm Mong muốn để giữ MSS trong tháng này.",
        },
      },
    })
  }

  const remainingBudgetVnd = Math.max(0, variableBudgetToKeepMssVnd - variableSpent)
  const dailyTotalCapVnd = Math.max(0, Math.floor(remainingBudgetVnd / daysRemaining))
  options.push({
    id: "mss_total_cap",
    title: "Phương án 2: Giới hạn tổng chi (biến đổi) để giữ MSS",
    summary:
      dailyTotalCapVnd > 0
        ? `Từ nay đến cuối tháng, giới hạn tổng chi biến đổi ~${formatVnd(dailyTotalCapVnd)}/ngày.`
        : "Từ nay đến cuối tháng, ưu tiên chi tối thiểu và hoãn các khoản chưa cần để bảo vệ MSS.",
    impact: impactFromProjectedSpend({
      incomeVnd: I,
      projectedEndMonthSpendVnd: fixedCostsVnd + variableSpent + dailyTotalCapVnd * daysRemaining,
      essentialMonthlyVnd: input.emergency.essentialMonthlyVnd,
      emergencyFundCurrentVnd: input.emergency.emergencyFundCurrentVnd,
      emergencyFundTargetMonths: input.emergency.emergencyFundTargetMonths,
      notes: ["Nếu vẫn thiếu MSS, cân nhắc kết hợp tăng thu nhập mục tiêu."],
    }),
    actions: {
      caps: {
        dailyTotalCapVnd,
        note: "Giới hạn tổng chi biến đổi để giữ MSS trong tháng này.",
      },
    },
  })

  const alreadyTooLateForMss = variableSpent > variableBudgetToKeepMssVnd
  if (alreadyTooLateForMss) {
    const bestCaseEndBalanceVnd = I - (fixedCostsVnd + variableSpent)
    const incomeNeededVnd = Math.max(0, MSS - bestCaseEndBalanceVnd)
    const perDay = Math.ceil(incomeNeededVnd / Math.max(1, daysRemaining))
    const perWeek = Math.ceil(incomeNeededVnd / Math.ceil(daysRemaining / 7))
    options.push({
      id: "mss_income",
      title: "Phương án 3: Tăng thu nhập mục tiêu (để giữ MSS)",
      summary: `Mục tiêu thêm ${formatVnd(incomeNeededVnd)} (≈ ${formatVnd(perWeek)}/tuần hoặc ${formatVnd(perDay)}/ngày).`,
      impact: impactFromProjectedSpend({
        incomeVnd: I + incomeNeededVnd,
        projectedEndMonthSpendVnd: fixedCostsVnd + projectedEndMonthVariableSpendVnd,
        essentialMonthlyVnd: input.emergency.essentialMonthlyVnd,
        emergencyFundCurrentVnd: input.emergency.emergencyFundCurrentVnd,
        emergencyFundTargetMonths: input.emergency.emergencyFundTargetMonths,
        notes: ["Gợi ý: việc làm thêm hợp pháp, bán đồ không dùng, nhận dự án ngắn hạn."],
      }),
      actions: { extraIncomeTargetVnd: incomeNeededVnd },
    })
  }

  const firstSafe = options.find((o) => o.impact.projectedEndMonthBalanceVnd >= MSS)
  const recommended =
    options.find((o) => o.id === "mss_cut_wants" && o.impact.projectedEndMonthBalanceVnd >= MSS) ??
    options.find((o) => o.id === "mss_total_cap" && o.impact.projectedEndMonthBalanceVnd >= MSS) ??
    firstSafe ??
    options[0]
  for (const o of options) o.recommended = o.id === recommended.id

  return {
    month: input.month,
    alertText: "Với nhịp chi tiêu hiện tại, bạn có nguy cơ không giữ được MSS vào cuối tháng.",
    why: {
      daysRemaining,
      requiredDailyCutVnd,
      severity,
      mssVnd: MSS,
      projectedEndMonthBalanceVnd,
      mssDeficitVnd,
      variableSpentToDateVnd: variableSpent,
      variableRemainingToKeepMssVnd,
    },
    options,
    recommendedOptionId: recommended.id,
  }
}

export type ForcedPurchaseRescueResult = {
  month: YearMonth
  forcedPriceVnd: number
  severity: CrisisSeverity
  projectedEndMonthBalanceVnd: number
  mssVnd: number
  mssDeficitVnd: number
  requiredDailyCutVnd: number
  requiredWeeklyCutVnd: number
  options: RecoveryOption[]
  recommendedOptionId: string
}

export function buildForcedPurchaseRescue(input: {
  month: YearMonth
  today: ISODate
  dayOfMonth: number
  daysInMonth: number
  incomeVnd: number
  fixedCostsVnd: number
  essentialVariableBaselineVnd: number
  emergencyFundCurrentVnd: number
  emergencyFundTargetMonths: number
  debtPaymentMonthlyVnd: number
  budgets: {
    wantsBudgetVnd: number
    savingsTargetVnd: number
  }
  spentToDate: {
    totalSpentVnd: number
    wantsSpentVnd: number
    needsSpentVnd: number
  }
  forcedPurchase: {
    priceVnd: number
    bucket: BudgetBucket
  }
  installment?: {
    interestRate: number
    tenorMonths: number
  }
}): ForcedPurchaseRescueResult {
  const I = clampMoneyVnd(input.incomeVnd)
  const F = clampMoneyVnd(input.fixedCostsVnd)
  const E = clampMoneyVnd(input.essentialVariableBaselineVnd)
  const N = F + E

  const totalSpent = clampMoneyVnd(input.spentToDate.totalSpentVnd)
  const wantsSpent = clampMoneyVnd(input.spentToDate.wantsSpentVnd)
  const needsSpent = clampMoneyVnd(input.spentToDate.needsSpentVnd)
  const P = clampMoneyVnd(input.forcedPurchase.priceVnd)

  const wantsBudgetVnd = clampMoneyVnd(input.budgets.wantsBudgetVnd)
  const savingsTargetVnd = clampMoneyVnd(input.budgets.savingsTargetVnd)
  const purchaseBucket = input.forcedPurchase.bucket

  const totalSpentAfterVnd = totalSpent + P

  // In forced mode, the forced purchase itself cannot be "cut".
  // If it's a WANTS purchase, remove it from the remaining optional wants budget.
  const wantsSpentAfterVnd = wantsSpent + (purchaseBucket === "wants" ? P : 0)
  const wantsRemainingAfterVnd = Math.max(0, wantsBudgetVnd - wantsSpentAfterVnd)

  // Needs spending includes fixed costs + essential variable spending to date.
  // If the forced purchase is NEEDS, it reduces the remaining essentials baseline for the month.
  const needsSpentAfterVnd = needsSpent + (purchaseBucket === "needs" ? P : 0)
  const remainingEssentialsAfterVnd = Math.max(0, N - needsSpentAfterVnd)

  // Baseline: buy the forced item, then still spend remaining essentials + remaining optional wants.
  const projectedBaseSpendVnd =
    totalSpentAfterVnd + remainingEssentialsAfterVnd + wantsRemainingAfterVnd
  const projectedEndMonthBalanceVnd = I - projectedBaseSpendVnd

  const mssVnd = computeMinimumSafetySavings(I)
  const mssDeficitVnd = Math.max(0, mssVnd - projectedEndMonthBalanceVnd)

  const debt = computeDebtToIncome({
    incomeVnd: I,
    debtPaymentMonthlyVnd: input.debtPaymentMonthlyVnd,
  })

  const deficitRatio = I > 0 ? mssDeficitVnd / I : 1
  const emergencyCoverageMonths = N > 0 ? input.emergencyFundCurrentVnd / N : 0

  const severity: CrisisSeverity =
    mssDeficitVnd === 0 && emergencyCoverageMonths >= 3
      ? "NHẸ"
      : deficitRatio <= 0.1
        ? "TRUNG BÌNH"
        : deficitRatio <= 0.25
          ? "NẶNG"
          : debt.ratio > 0.3
            ? "NGUY CẤP VỠ NỢ"
            : "NGUY CẤP VỠ NỢ"

  const day = Math.max(1, Math.trunc(input.dayOfMonth))
  const daysInMonth = Math.max(1, Math.trunc(input.daysInMonth))
  const daysRemaining = Math.max(1, daysInMonth - day + 1)
  const variableSpentAfterVnd = Math.max(0, totalSpentAfterVnd - F)
  const variableBudgetToKeepMssVnd = Math.max(0, I - F - mssVnd)
  const remainingVariableBudgetToKeepMssVnd = Math.trunc(
    variableBudgetToKeepMssVnd - variableSpentAfterVnd,
  )
  const dailyTotalCapVnd = Math.max(
    0,
    Math.floor(Math.max(0, remainingVariableBudgetToKeepMssVnd) / daysRemaining),
  )
  const essentialDailyNeedVnd = Math.ceil(remainingEssentialsAfterVnd / daysRemaining)
  const freezeUntilEnd = addDaysIsoDate(input.today, Math.max(0, daysRemaining - 1))
  const maxSavingsCutVnd = Math.max(0, savingsTargetVnd - mssVnd)

  const requiredDailyCutVnd =
    mssDeficitVnd > 0 ? Math.ceil(mssDeficitVnd / daysRemaining) : 0
  const requiredWeeklyCutVnd =
    mssDeficitVnd > 0 ? Math.ceil(mssDeficitVnd / Math.ceil(daysRemaining / 7)) : 0

  const freezeDays = Math.min(14, daysRemaining)
  const freezeUntil = addDaysIsoDate(input.today, freezeDays)

  const options: RecoveryOption[] = []

  if (mssDeficitVnd > 0) {
    // Option 1: cut wants (cap) to recover MSS
    const cutFromWantsVnd = Math.min(wantsRemainingAfterVnd, mssDeficitVnd)
    if (cutFromWantsVnd > 0) {
      const wantsAllowedRemainingVnd = Math.max(0, wantsRemainingAfterVnd - cutFromWantsVnd)
      const dailyWantsCapVnd = Math.max(0, Math.floor(wantsAllowedRemainingVnd / daysRemaining))
      const remainingAfterWantsCutVnd = Math.max(0, mssDeficitVnd - cutFromWantsVnd)
      options.push({
        id: "fp_cut_wants",
        title: "Phương án 1: Giảm “Mong muốn” để giữ MSS",
        summary:
          remainingAfterWantsCutVnd > 0
            ? `Giảm “Mong muốn” ${formatVnd(cutFromWantsVnd)}. ${
                dailyWantsCapVnd > 0
                  ? `Cap Mong muốn ~${formatVnd(dailyWantsCapVnd)}/ngày.`
                  : `Tạm dừng Mong muốn đến ${freezeUntil}.`
              } Vẫn còn thiếu ~${formatVnd(remainingAfterWantsCutVnd)} so với MSS.`
            : `Giảm “Mong muốn” ${formatVnd(cutFromWantsVnd)}. ${
                dailyWantsCapVnd > 0
                  ? `Cap Mong muốn ~${formatVnd(dailyWantsCapVnd)}/ngày.`
                  : `Tạm dừng Mong muốn đến ${freezeUntil}.`
              }`,
        impact: impactFromProjectedSpend({
          incomeVnd: I,
          projectedEndMonthSpendVnd: projectedBaseSpendVnd - cutFromWantsVnd,
          essentialMonthlyVnd: N,
          emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
          emergencyFundTargetMonths: input.emergencyFundTargetMonths,
          notes: ["Ưu tiên hoãn các khoản mua sắm chưa cấp thiết."],
        }),
        actions: {
          caps: {
            dailyWantsCapVnd,
            wantsFreezeUntil: dailyWantsCapVnd === 0 ? freezeUntil : undefined,
            note: "Giảm Mong muốn để giữ MSS trong tháng này.",
          },
        },
      })
    }

    const freezeSummary =
      wantsRemainingAfterVnd > 0
        ? `Tạm dừng "Mong muốn" đến ${freezeUntilEnd} để tránh phát sinh thêm (~${formatVnd(
            wantsRemainingAfterVnd,
          )}).`
        : `Tạm dừng "Mong muốn" đến ${freezeUntilEnd} để tránh phát sinh thêm.`
    options.push({
      id: "fp_freeze_wants",
      title: "Phương án 2: Hoãn mua sắm, đóng băng Mong muốn",
      summary: freezeSummary,
      impact: impactFromProjectedSpend({
        incomeVnd: I,
        projectedEndMonthSpendVnd: projectedBaseSpendVnd - wantsRemainingAfterVnd,
        essentialMonthlyVnd: N,
        emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
        emergencyFundTargetMonths: input.emergencyFundTargetMonths,
        notes: ["Ưu tiên hoãn các khoản mua chưa cần thiết để giữ MSS."],
      }),
      actions: {
        caps: {
          dailyWantsCapVnd: 0,
          wantsFreezeUntil: freezeUntilEnd,
          note: "Đóng băng Mong muốn để ưu tiên giữ MSS trong tháng này.",
        },
      },
    })

    const remainingVariableCapVnd = Math.max(
      remainingEssentialsAfterVnd,
      dailyTotalCapVnd * daysRemaining,
    )
    const totalCapWarnings: string[] = []
    if (dailyTotalCapVnd < essentialDailyNeedVnd) {
      totalCapWarnings.push(
        "Cap tổng thấp hơn nhu cầu thiết yếu/ngày; cần kết hợp tăng thu nhập hoặc cắt thêm khoản khác.",
      )
    }
    options.push({
      id: "fp_total_cap",
      title: "Phương án 3: Giới hạn tổng chi (biến đổi) để giữ MSS",
      summary:
        dailyTotalCapVnd > 0
          ? `Giới hạn tổng chi biến đổi ~${formatVnd(dailyTotalCapVnd)}/ngày cho đến cuối tháng.`
          : "Từ nay đến cuối tháng, chỉ chi thiết yếu tối thiểu; hoãn các khoản không cần thiết.",
      impact: impactFromProjectedSpend({
        incomeVnd: I,
        projectedEndMonthSpendVnd: totalSpentAfterVnd + remainingVariableCapVnd,
        essentialMonthlyVnd: N,
        emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
        emergencyFundTargetMonths: input.emergencyFundTargetMonths,
        notes: ["Giới hạn tổng chi biến đổi để bảo vệ MSS trong tháng này."],
      }),
      actions: {
        caps: {
          dailyTotalCapVnd,
          note: "Giới hạn tổng chi biến đổi để giữ MSS trong tháng này.",
        },
      },
      warnings: totalCapWarnings.length ? totalCapWarnings : undefined,
    })

    if (maxSavingsCutVnd > 0) {
      options.push({
        id: "fp_reduce_savings",
        title: "Phương án 4: Tạm giảm mục tiêu tiết kiệm (không dưới MSS)",
        summary: `Giảm mục tiêu tiết kiệm khoảng ${formatVnd(
          maxSavingsCutVnd,
        )} trong tháng này nhưng vẫn giữ MSS.`,
        impact: impactFromProjectedSpend({
          incomeVnd: I,
          projectedEndMonthSpendVnd: projectedBaseSpendVnd,
          essentialMonthlyVnd: N,
          emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
          emergencyFundTargetMonths: input.emergencyFundTargetMonths,
          notes: ["Hạ mục tiêu S về MSS trong tháng này để giảm áp lực."],
        }),
        actions: {
          budgetAdjustmentDelta: {
            needsDeltaVnd: 0,
            wantsDeltaVnd: 0,
            savingsDeltaVnd: -maxSavingsCutVnd,
            note: "Giảm tạm mục tiêu tiết kiệm về MSS trong tháng này.",
          },
        },
        warnings: [
          "Nếu vẫn thiếu MSS, cần kết hợp thêm cắt chi hoặc tăng thu nhập.",
        ],
      })
    }

    // If cutting all remaining wants still not enough -> income / installments
    const remainingAfterFreezeWantsVnd = Math.max(0, mssDeficitVnd - wantsRemainingAfterVnd)
    if (remainingAfterFreezeWantsVnd > 0) {
      const perDay = Math.ceil(remainingAfterFreezeWantsVnd / Math.max(1, daysRemaining))
      const perWeek = Math.ceil(remainingAfterFreezeWantsVnd / Math.ceil(daysRemaining / 7))
      options.push({
        id: "fp_income",
        title: "Phương án 5: Tăng thu nhập mục tiêu (để giữ MSS)",
        summary: `Mục tiêu thêm ${formatVnd(remainingAfterFreezeWantsVnd)} (≈ ${formatVnd(perWeek)}/tuần hoặc ${formatVnd(perDay)}/ngày).`,
        impact: impactFromProjectedSpend({
          incomeVnd: I + remainingAfterFreezeWantsVnd,
          projectedEndMonthSpendVnd: projectedBaseSpendVnd - wantsRemainingAfterVnd,
          essentialMonthlyVnd: N,
          emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
          emergencyFundTargetMonths: input.emergencyFundTargetMonths,
          notes: ["Gợi ý: việc làm thêm hợp pháp, bán đồ không dùng, nhận dự án ngắn hạn."],
        }),
        actions: { extraIncomeTargetVnd: remainingAfterFreezeWantsVnd },
      })

      const interestRate = Math.max(0, input.installment?.interestRate ?? 0.12)
      const tenorMonths = Math.max(1, Math.trunc(input.installment?.tenorMonths ?? 6))
      const monthlyInstallmentVnd = Math.ceil((P * (1 + interestRate)) / tenorMonths)
      const installmentWarning =
        debt.ratio > 0.3
          ? "CẢNH BÁO: Nợ/thu nhập > 30%. Tránh vay thêm nếu không cực kỳ cần."
          : "Cảnh báo: Ưu tiên phương án không vay. Nếu bắt buộc trả góp, chọn lãi thấp nhất."
      options.push({
        id: "fp_installments",
        title: "Phương án 6: Mô phỏng trả góp (phương án cuối cùng)",
        summary: `Ước tính trả góp ~${formatVnd(monthlyInstallmentVnd)}/tháng trong ${tenorMonths} tháng (lãi giả định ${(interestRate * 100).toFixed(0)}%).`,
        impact: impactFromProjectedSpend({
          incomeVnd: I,
          projectedEndMonthSpendVnd:
            projectedBaseSpendVnd - wantsRemainingAfterVnd - P + monthlyInstallmentVnd,
          essentialMonthlyVnd: N,
          emergencyFundCurrentVnd: input.emergencyFundCurrentVnd,
          emergencyFundTargetMonths: input.emergencyFundTargetMonths,
          notes: ["Chỉ xem như phương án cuối cùng; cân nhắc kỹ lãi suất và khả năng trả nợ."],
        }),
        warnings: [installmentWarning],
        actions: {
          installmentSimulation: {
            interestRate,
            tenorMonths,
            monthlyInstallmentVnd,
            warning: installmentWarning,
          },
        },
      })
    }
  }

  const nonInstallments = options.filter((o) => o.id !== "fp_installments")
  const recommended =
    (nonInstallments.length ? pickRecommended(nonInstallments) : options[0]) ?? null
  for (const o of options) o.recommended = recommended ? o.id === recommended.id : false

  return {
    month: input.month,
    forcedPriceVnd: P,
    severity,
    projectedEndMonthBalanceVnd,
    mssVnd,
    mssDeficitVnd,
    requiredDailyCutVnd,
    requiredWeeklyCutVnd,
    options,
    recommendedOptionId: recommended?.id ?? "",
  }
}
