import { describe, expect, it } from "vitest"
import { buildForcedPurchaseRescue } from "@/domain/finance/rescue"

describe("buildForcedPurchaseRescue", () => {
  it("does not double-count forced WANTS purchases in the baseline projection", () => {
    const res = buildForcedPurchaseRescue({
      month: "2026-01",
      today: "2026-01-05",
      dayOfMonth: 5,
      daysInMonth: 31,
      incomeVnd: 8_500_000,
      fixedCostsVnd: 3_000_000,
      essentialVariableBaselineVnd: 3_000_000,
      emergencyFundCurrentVnd: 0,
      emergencyFundTargetMonths: 3,
      debtPaymentMonthlyVnd: 0,
      budgets: { wantsBudgetVnd: 2_000_000, savingsTargetVnd: 1_000_000 },
      spentToDate: { totalSpentVnd: 3_000_000, wantsSpentVnd: 0, needsSpentVnd: 3_000_000 },
      forcedPurchase: { priceVnd: 1_000_000, bucket: "wants" },
    })

    expect(res.projectedEndMonthBalanceVnd).toBe(500_000)
    expect(res.mssVnd).toBe(425_000)
    expect(res.mssDeficitVnd).toBe(0)
    expect(res.options).toHaveLength(0)
  })

  it("cuts only remaining optional wants (cannot cut the forced purchase itself)", () => {
    const res = buildForcedPurchaseRescue({
      month: "2026-01",
      today: "2026-01-05",
      dayOfMonth: 5,
      daysInMonth: 31,
      incomeVnd: 7_500_000,
      fixedCostsVnd: 3_000_000,
      essentialVariableBaselineVnd: 3_000_000,
      emergencyFundCurrentVnd: 0,
      emergencyFundTargetMonths: 3,
      debtPaymentMonthlyVnd: 0,
      budgets: { wantsBudgetVnd: 2_000_000, savingsTargetVnd: 1_000_000 },
      spentToDate: { totalSpentVnd: 3_000_000, wantsSpentVnd: 0, needsSpentVnd: 3_000_000 },
      forcedPurchase: { priceVnd: 1_000_000, bucket: "wants" },
    })

    expect(res.mssDeficitVnd).toBeGreaterThan(0)

    const cut = res.options.find((o) => o.id === "fp_cut_wants")
    expect(cut).toBeTruthy()

    const cutAmountVnd =
      (cut?.impact.projectedEndMonthBalanceVnd ?? 0) - res.projectedEndMonthBalanceVnd

    const wantsRemainingAfterVnd = Math.max(0, 2_000_000 - 1_000_000)
    expect(cutAmountVnd).toBeGreaterThan(0)
    expect(cutAmountVnd).toBeLessThanOrEqual(wantsRemainingAfterVnd)
  })
})

