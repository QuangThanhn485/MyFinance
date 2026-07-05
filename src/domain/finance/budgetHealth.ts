import { clampMoneyVnd } from "@/domain/finance/finance"
import { normalizeFinanceDay, normalizeFinanceDaysInMonth } from "@/domain/finance/pace"

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

/**
 * Dự báo tổng chi của một nhóm tới cuối tháng bằng cách ngoại suy nhịp hiện tại
 * (đã chi / số ngày đã qua × số ngày trong tháng). Cuối tháng thì trả về đúng số đã chi.
 */
export function projectMonthEndVnd(
  spentToDateVnd: number,
  dayOfMonth: number,
  daysInMonth: number,
) {
  const day = normalizeFinanceDay(dayOfMonth)
  const dim = normalizeFinanceDaysInMonth(daysInMonth)
  const spent = clampMoneyVnd(spentToDateVnd)
  if (day >= dim) return spent
  return Math.round(spent * (dim / day))
}

/**
 * Cảnh báo sức khỏe ngân sách sau khi ghi chi tiêu.
 *
 * Nguyên tắc: chỉ cảnh báo khi THẬT SỰ cần — tức là một nhóm ngân sách (Mong muốn hoặc
 * Thiết yếu) đã vượt định mức tháng, hoặc theo nhịp hiện tại sẽ vượt ĐÁNG KỂ vào cuối tháng.
 * Không cảnh báo theo "nhịp tuyến tính từng ngày" (chi tiêu vốn dồn cục), không cảnh báo sớm
 * khi mới đầu tháng, và bỏ qua các sai lệch nhỏ. Trường hợp nghiêm trọng đe dọa MSS đã có
 * modal cảnh báo vượt chi riêng nên ở đây không lặp lại.
 */
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
  const day = normalizeFinanceDay(input.dayOfMonth)
  const dim = normalizeFinanceDaysInMonth(input.daysInMonth)

  const I = clampMoneyVnd(input.monthlyIncomeVnd)
  if (I <= 0) return []

  const E = clampMoneyVnd(input.planned.essentialMonthlyVnd)
  const W = clampMoneyVnd(input.planned.wantsMonthlyVnd)

  const actualWants = clampMoneyVnd(input.actualToDate.wantsVnd)
  const actualEssential = clampMoneyVnd(input.actualToDate.essentialSpentVnd)

  // Chỉ dùng dự báo (ngoại suy nhịp) sau khi đã qua ~1/3 tháng và tối thiểu 10 ngày, tránh báo
  // động sớm khi một khoản chi đơn lẻ làm "nhịp" nhảy vọt. Trước mốc đó chỉ báo khi ĐÃ vượt.
  const projectionReady = day >= Math.max(10, Math.ceil(dim / 3)) && day < dim
  // Chỉ báo dự báo khi vượt >10% ngân sách nhóm.
  const OVERSHOOT_RATIO = 1.1

  const fmt = new Intl.NumberFormat("vi-VN")
  const warnings: BudgetHealthWarning[] = []

  // ----- Mong muốn (W) -----
  if (W > 0) {
    const projectedWants = projectionReady ? projectMonthEndVnd(actualWants, day, dim) : actualWants
    const wantsFloorVnd = Math.max(200_000, Math.round(W * 0.05))
    if (actualWants > W) {
      const overVnd = actualWants - W
      warnings.push({
        type: "PACE_WANTS",
        severity: "danger",
        title: "Đã vượt ngân sách 'Mong muốn' tháng",
        summary: `Đã chi 'Mong muốn' ${fmt.format(actualWants)}₫, vượt ${fmt.format(overVnd)}₫ so với ngân sách tháng (${fmt.format(W)}₫). Phần vượt sẽ lấn vào tiết kiệm.`,
        details: {
          wantsBudgetVnd: W,
          wantsSpentToDateVnd: actualWants,
          projectedWantsVnd: actualWants,
          overspendVnd: overVnd,
          thresholdVnd: wantsFloorVnd,
        },
        suggestions: [
          "Tạm dừng các khoản 'Mong muốn' chưa cấp thiết tới đầu tháng sau.",
          "Nếu vẫn cần mua, bù lại bằng cách giảm chi trong tuần tới.",
        ],
      })
    } else if (
      projectionReady &&
      projectedWants > Math.round(W * OVERSHOOT_RATIO) &&
      projectedWants - W >= wantsFloorVnd
    ) {
      const overVnd = projectedWants - W
      warnings.push({
        type: "PACE_WANTS",
        severity: "warning",
        title: "Dự báo vượt ngân sách 'Mong muốn'",
        summary: `Với nhịp hiện tại, 'Mong muốn' cuối tháng ước tính ~${fmt.format(projectedWants)}₫, vượt ~${fmt.format(overVnd)}₫ so với ngân sách (${fmt.format(W)}₫).`,
        details: {
          wantsBudgetVnd: W,
          wantsSpentToDateVnd: actualWants,
          projectedWantsVnd: projectedWants,
          overspendVnd: overVnd,
          thresholdVnd: wantsFloorVnd,
        },
        suggestions: [
          "Giảm nhịp 'Mong muốn' vài ngày tới để về đúng ngân sách.",
          "Ưu tiên khoản thật sự cần; hoãn khoản có thể chờ.",
        ],
      })
    }
  }

  // ----- Thiết yếu (E) -----
  if (E > 0) {
    const projectedEssential = projectionReady
      ? projectMonthEndVnd(actualEssential, day, dim)
      : actualEssential
    const essentialFloorVnd = Math.max(300_000, Math.round(E * 0.05))
    if (actualEssential > E) {
      const overVnd = actualEssential - E
      warnings.push({
        type: "ESSENTIAL_SAFETY_CAP",
        severity: "danger",
        title: "Chi 'Thiết yếu' đã vượt định mức tháng",
        summary: `Thiết yếu đã chi ${fmt.format(actualEssential)}₫, vượt ${fmt.format(overVnd)}₫ so với định mức (${fmt.format(E)}₫). Phần vượt sẽ lấn vào 'Mong muốn' hoặc tiết kiệm.`,
        details: {
          essentialBaselineVnd: E,
          essentialSpentToDateVnd: actualEssential,
          projectedEssentialVnd: actualEssential,
          overspendVnd: overVnd,
          thresholdVnd: essentialFloorVnd,
        },
        suggestions: [
          "Rà lại chi 'Thiết yếu' gần đây xem có khoản nào thực ra là 'Mong muốn'.",
          "Nếu định mức Thiết yếu (E) đang thấp hơn thực tế, chỉnh lại trong Cài đặt.",
        ],
      })
    } else if (
      projectionReady &&
      projectedEssential > Math.round(E * OVERSHOOT_RATIO) &&
      projectedEssential - E >= essentialFloorVnd
    ) {
      const overVnd = projectedEssential - E
      warnings.push({
        type: "ESSENTIAL_SAFETY_CAP",
        severity: "warning",
        title: "Dự báo 'Thiết yếu' vượt định mức",
        summary: `Với nhịp hiện tại, 'Thiết yếu' cuối tháng ước tính ~${fmt.format(projectedEssential)}₫, vượt ~${fmt.format(overVnd)}₫ so với định mức (${fmt.format(E)}₫).`,
        details: {
          essentialBaselineVnd: E,
          essentialSpentToDateVnd: actualEssential,
          projectedEssentialVnd: projectedEssential,
          overspendVnd: overVnd,
          thresholdVnd: essentialFloorVnd,
        },
        suggestions: [
          "Theo dõi chi 'Thiết yếu' vài ngày tới, tránh phát sinh không bắt buộc.",
          "Cân nhắc điều chỉnh định mức Thiết yếu nếu nhu cầu thực tế cao hơn.",
        ],
      })
    }
  }

  return warnings
}
