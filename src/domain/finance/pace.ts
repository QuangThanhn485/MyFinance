export function normalizeFinanceDay(value: number) {
  return Math.max(1, Math.trunc(value))
}

export function normalizeFinanceDaysInMonth(value: number) {
  return Math.max(1, Math.trunc(value))
}

export function computePacedAmountToDateVnd(input: {
  monthlyAmountVnd: number
  dayOfMonth: number
  daysInMonth: number
}) {
  return Math.round(input.monthlyAmountVnd * (input.dayOfMonth / input.daysInMonth))
}
