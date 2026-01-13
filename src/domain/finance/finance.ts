import type { BudgetAdjustment, BudgetRule } from "@/domain/types"

export type RemainderSplitPercents = {
  wantsPct: number
  savingsPct: number
}

export type ComputedBudgets = {
  incomeVnd: number
  fixedCostsVnd: number
  essentialVariableBaselineVnd: number
  remainderVnd: number
  needsBudgetVnd: number
  wantsBudgetVnd: number
  savingsBudgetVnd: number
  savingsTargetVnd: number
  savingsTargetShortfallVnd: number
  split: RemainderSplitPercents
  mssVnd: number
}

export function clampMoneyVnd(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

export function getRemainderSplitPercents(rule: BudgetRule): RemainderSplitPercents {
  if (rule.type === "50_30_20") return { wantsPct: 60, savingsPct: 40 }
  if (rule.type === "60_20_20") return { wantsPct: 50, savingsPct: 50 }

  const wants = Math.max(0, Math.trunc(rule.wantsPct))
  const savings = Math.max(0, Math.trunc(rule.savingsPct))
  const total = wants + savings
  if (!Number.isFinite(total) || total <= 0) {
    return { wantsPct: 60, savingsPct: 40 }
  }
  const wantsPct = Math.max(0, Math.min(100, Math.round((wants / total) * 100)))
  const savingsPct = 100 - wantsPct
  return { wantsPct, savingsPct }
}

export function computeBudgets(input: {
  incomeVnd: number
  fixedCostsVnd: number
  essentialVariableBaselineVnd: number
  rule: BudgetRule
  adjustment?: BudgetAdjustment | null
  customSavingsGoalVnd?: number | null
}): ComputedBudgets {
  const incomeVnd = clampMoneyVnd(input.incomeVnd)
  const fixedCostsVnd = clampMoneyVnd(input.fixedCostsVnd)

  const delta = input.adjustment
  const essentialVariableBaselineVnd = clampMoneyVnd(input.essentialVariableBaselineVnd) + (delta?.needsDeltaVnd ?? 0)
  const essentialBaselineAdjVnd = Math.max(0, Math.trunc(essentialVariableBaselineVnd))

  const remainderVnd = Math.max(0, incomeVnd - fixedCostsVnd - essentialBaselineAdjVnd)
  const split = getRemainderSplitPercents(input.rule)

  const baseSavingsFromSplitVnd = Math.floor((remainderVnd * split.savingsPct) / 100)
  const savingsAfterDeltaVnd = Math.max(
    0,
    Math.trunc(baseSavingsFromSplitVnd + (delta?.savingsDeltaVnd ?? 0)),
  )

  const customGoalVnd = clampMoneyVnd(input.customSavingsGoalVnd ?? 0)
  const mssVnd = computeMinimumSafetySavings(incomeVnd)
  const savingsTargetDesiredVnd = Math.max(savingsAfterDeltaVnd, customGoalVnd, mssVnd)

  const savingsTargetVnd = Math.min(remainderVnd, savingsTargetDesiredVnd)
  const savingsTargetShortfallVnd = Math.max(0, savingsTargetDesiredVnd - remainderVnd)
  const wantsBudgetVnd = Math.max(0, remainderVnd - savingsTargetVnd)

  return {
    incomeVnd,
    fixedCostsVnd,
    essentialVariableBaselineVnd: essentialBaselineAdjVnd,
    remainderVnd,
    needsBudgetVnd: fixedCostsVnd + essentialBaselineAdjVnd,
    wantsBudgetVnd,
    savingsBudgetVnd: savingsTargetVnd,
    savingsTargetVnd,
    savingsTargetShortfallVnd,
    split,
    mssVnd,
  }
}

export function computeMinimumSafetySavings(incomeVnd: number) {
  const I = clampMoneyVnd(incomeVnd)
  return Math.max(Math.round(0.05 * I), 300000)
}

export function computeDebtToIncome(input: {
  incomeVnd: number
  debtPaymentMonthlyVnd: number
}) {
  const I = clampMoneyVnd(input.incomeVnd)
  const D = clampMoneyVnd(input.debtPaymentMonthlyVnd)
  const ratio = I > 0 ? D / I : 0
  const level = ratio > 0.3 ? "red" : ratio >= 0.2 ? "yellow" : "ok"
  return { ratio, level }
}

export function computeEmergencyFund(input: {
  fixedCostsVnd: number
  essentialVariableBaselineVnd: number
  targetMonths: number
  currentBalanceVnd: number
}) {
  const F = clampMoneyVnd(input.fixedCostsVnd)
  const E = clampMoneyVnd(input.essentialVariableBaselineVnd)
  const N = F + E
  const targetMonths = Math.max(0, Math.trunc(input.targetMonths))
  const targetVnd = N * targetMonths
  const currentVnd = clampMoneyVnd(input.currentBalanceVnd)
  const coverageMonths = N > 0 ? currentVnd / N : Number.POSITIVE_INFINITY

  const status =
    coverageMonths < 1
      ? "Rất rủi ro"
      : coverageMonths < 3
        ? "Cần củng cố"
        : coverageMonths < 6
          ? "Ổn"
          : coverageMonths >= targetMonths && targetMonths > 0
            ? "Tốt"
            : "Ổn"

  return {
    essentialMonthlyVnd: N,
    targetVnd,
    currentVnd,
    coverageMonths,
    status,
  }
}
