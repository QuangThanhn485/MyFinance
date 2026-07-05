import type { ISODate, YearMonth } from "@/domain/types"
import type { CttmState } from "@/storage/schema"
import {
  addDaysIsoDate,
  dayOfMonthFromIsoDate,
  daysInMonth,
  monthFromIsoDate,
} from "@/lib/date"

export type MonthDayContext = {
  date: ISODate
  month: YearMonth
  dayOfMonth: number
  daysInMonth: number
  /** Ngày tham chiếu (thường là hôm nay) đã có ít nhất một khoản chi tiêu (> 0đ) chưa. */
  dateHasExpense: boolean
  /** Ngày bắt đầu tính phần còn lại của tháng: hôm nay, hoặc ngày kế tiếp nếu hôm nay đã chi. */
  remainingStartDate: ISODate
  remainingStartMonth: YearMonth
  remainingStartDayOfMonth: number
  /**
   * Số ngày còn lại trong tháng để phân bổ ngân sách = số ngày theo lịch từ ngày tham chiếu
   * tới cuối tháng. Nếu ngày tham chiếu đã có chi tiêu thì coi như "đã dùng" nên bắt đầu đếm
   * từ ngày kế tiếp (thay cho thao tác "khoá ngày" thủ công). Các ngày khác không bị loại.
   */
  remainingDaysInMonth: number
}

/** Ngày tham chiếu đã có ít nhất một khoản chi tiêu thực (amount > 0) chưa. */
export function dateHasRealExpense(state: CttmState, date: ISODate): boolean {
  const ids = state.indexes.expensesByDate[date] ?? []
  for (const id of ids) {
    const expense = state.entities.expenses.byId[id]
    if (!expense) continue
    if (Number.isFinite(expense.amountVnd) && expense.amountVnd > 0) return true
  }
  return false
}

/**
 * Ngữ cảnh ngày/tháng cho các công thức tài chính.
 *
 * "Số ngày còn lại trong tháng" là số ngày theo lịch từ ngày tham chiếu tới hết tháng (dùng
 * đúng số ngày thực của tháng, ví dụ tháng 7 = 31 ngày). Khi ngày tham chiếu đã phát sinh chi
 * tiêu, nó tự động bị loại (bắt đầu tính từ ngày kế tiếp) — thay cho nút "Khoá ngày" thủ công.
 */
export function getMonthDayContext(state: CttmState, date: ISODate): MonthDayContext {
  const month = monthFromIsoDate(date)
  const dim = daysInMonth(month)
  const day = Math.min(dim, Math.max(1, dayOfMonthFromIsoDate(date)))
  const dateHasExpense = dateHasRealExpense(state, date)

  const remainingStartDayOfMonth = dateHasExpense ? day + 1 : day
  const remainingDaysInMonth = Math.max(0, dim - remainingStartDayOfMonth + 1)

  const lastDayIso = `${month}-${String(dim).padStart(2, "0")}` as ISODate
  const remainingStartDate =
    remainingStartDayOfMonth <= dim
      ? (`${month}-${String(remainingStartDayOfMonth).padStart(2, "0")}` as ISODate)
      : addDaysIsoDate(lastDayIso, 1)
  const remainingStartMonth = monthFromIsoDate(remainingStartDate)

  return {
    date,
    month,
    dayOfMonth: day,
    daysInMonth: dim,
    dateHasExpense,
    remainingStartDate,
    remainingStartMonth,
    remainingStartDayOfMonth: Math.min(dim, remainingStartDayOfMonth),
    remainingDaysInMonth,
  }
}
