import { clampMoneyVnd } from "@/domain/finance/finance"

export type BudgetHealthWarningType =
  | "PACE_VARIABLE"
  | "PACE_WANTS"
  | "ESSENTIAL_SAFETY_CAP"

export type BudgetHealthWarningSeverity = "warning" | "danger"

export type BudgetHealthWarning = {
  type: BudgetHealthWarningType
  severity: BudgetHealthWarningSeverity
  title: string
  summary: string
  details: Record<string, number>
  suggestions: string[]
}

export function computePaceToleranceVnd(monthlyIncomeVnd: number) {
  const I = clampMoneyVnd(monthlyIncomeVnd)
  return Math.max(0, Math.trunc(Math.min(Math.round(0.01 * I), 50_000)))
}

export function evaluateBudgetHealth(input: {
  dayOfMonth: number
  daysInMonth: number
  monthlyIncomeVnd: number
  planned: {
    essentialMonthlyVnd: number
    wantsMonthlyVnd: number
  }
  actualToDate: {
    variableTotalVnd: number
    wantsVnd: number
    essentialSpentVnd: number
  }
}): BudgetHealthWarning[] {
  const day = Math.max(1, Math.trunc(input.dayOfMonth))
  const dim = Math.max(1, Math.trunc(input.daysInMonth))

  const I = clampMoneyVnd(input.monthlyIncomeVnd)
  if (I <= 0) return []

  const E = clampMoneyVnd(input.planned.essentialMonthlyVnd)
  const W = clampMoneyVnd(input.planned.wantsMonthlyVnd)
  const plannedMonthlyVariableVnd = E + W

  const toleranceVnd = computePaceToleranceVnd(I)

  const actualVariableToDateVnd = clampMoneyVnd(input.actualToDate.variableTotalVnd)
  const actualWantsToDateVnd = clampMoneyVnd(input.actualToDate.wantsVnd)
  const essentialSpentToDateVnd = clampMoneyVnd(input.actualToDate.essentialSpentVnd)

  const plannedToDateVariableVnd = Math.round(
    plannedMonthlyVariableVnd * (day / dim),
  )
  const plannedToDateWantsVnd = Math.round(W * (day / dim))

  const warnings: BudgetHealthWarning[] = []

  const variableOverspendVnd = actualVariableToDateVnd - plannedToDateVariableVnd
  if (variableOverspendVnd > toleranceVnd) {
    const fmt = new Intl.NumberFormat("vi-VN")
    warnings.push({
      type: "PACE_VARIABLE",
      severity: "warning",
      title: "Chi biến đổi đang vượt nhịp kế hoạch",
      summary: `Bạn đang chi vượt khoảng ${fmt.format(variableOverspendVnd)} ₫ so với kế hoạch đến hôm nay.`,
      details: {
        plannedMonthlyVariableVnd,
        plannedToDateVariableVnd,
        actualToDateVariableVnd: actualVariableToDateVnd,
        overspendVnd: variableOverspendVnd,
        toleranceVnd,
      },
      suggestions: [
        "Giảm chi 'Mong muốn' trong vài ngày tới để kéo nhịp về kế hoạch.",
        "Đặt cap tổng chi tiêu/ngày cho phần còn lại của tháng.",
        "Hoãn các khoản mua chưa cần thiết sang tuần sau.",
      ],
    })
  }

  const wantsOverspendVnd = actualWantsToDateVnd - plannedToDateWantsVnd
  if (wantsOverspendVnd > toleranceVnd) {
    const fmt = new Intl.NumberFormat("vi-VN")
    warnings.push({
      type: "PACE_WANTS",
      severity: "warning",
      title: "Mong muốn đang vượt nhịp kế hoạch",
      summary: `Bạn đang chi 'Mong muốn' vượt khoảng ${fmt.format(wantsOverspendVnd)} ₫ so với kế hoạch đến hôm nay.`,
      details: {
        plannedMonthlyWantsVnd: W,
        plannedToDateWantsVnd,
        actualToDateWantsVnd: actualWantsToDateVnd,
        overspendVnd: wantsOverspendVnd,
        toleranceVnd,
      },
      suggestions: [
        "Giảm mua sắm/giải trí trong vài ngày tới.",
        "Đặt cap 'Mong muốn'/ngày cho phần còn lại của tháng.",
        "Nếu cần mua lớn, cân nhắc chờ sang tháng sau hoặc lên kế hoạch tiết kiệm.",
      ],
    })
  }

  const remainingDays = Math.max(0, dim - day)
  const remainingEssentialVnd = Math.trunc(E - essentialSpentToDateVnd)
  const remainingEssentialDailyCapVnd = remainingEssentialVnd / Math.max(1, remainingDays)
  const essentialDailyBaselineVnd = dim > 0 ? E / dim : 0

  if (remainingEssentialDailyCapVnd < essentialDailyBaselineVnd) {
    warnings.push({
      type: "ESSENTIAL_SAFETY_CAP",
      severity: "danger",
      title: "Cảnh báo đỏ: Thiết yếu (E) đang bị bóp nghẹt",
      summary:
        "Nếu tiếp tục theo nhịp này, phần 'Thiết yếu' còn lại mỗi ngày sẽ thấp hơn baseline E/ngày.",
      details: {
        essentialMonthlyVnd: E,
        essentialSpentToDateVnd,
        remainingDays,
        remainingEssentialVnd,
        essentialDailyBaselineVnd: Math.round(essentialDailyBaselineVnd),
        remainingEssentialDailyCapVnd: Math.floor(remainingEssentialDailyCapVnd),
      },
      suggestions: [
        "Ưu tiên giữ 'Thiết yếu': tạm hoãn các khoản 'Mong muốn'.",
        "Theo dõi chi thiết yếu mỗi ngày và tránh phát sinh không bắt buộc.",
        "Nếu baseline E hiện quá thấp so với thực tế, điều chỉnh E trong Cài đặt.",
      ],
    })
  }

  return warnings
}
