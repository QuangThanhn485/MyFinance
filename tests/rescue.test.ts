import { describe, expect, it } from "vitest"
import { evaluateOverspending } from "@/domain/finance/rescue"

describe("evaluateOverspending", () => {
  it("uses actual spending on the final day when measuring the MSS deficit", () => {
    const result = evaluateOverspending({
      month: "2026-04",
      dayOfMonth: 30,
      daysInMonth: 30,
      incomeVnd: 12_000_000,
      budgets: {
        needsBudgetVnd: 7_000_000,
        wantsBudgetVnd: 4_600_000,
        savingsTargetVnd: 600_000,
        savingsBudgetVnd: 600_000,
      },
      spentToDate: {
        fixedCostsVnd: 4_000_000,
        variableSpentVnd: 7_500_000,
        variableNeedsSpentVnd: 2_900_000,
        variableWantsSpentVnd: 4_600_000,
      },
      emergency: {
        essentialMonthlyVnd: 7_000_000,
        emergencyFundCurrentVnd: 21_000_000,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(result).not.toBeNull()
    expect(result?.why.projectedEndMonthBalanceVnd).toBe(500_000)
    expect(result?.why.mssDeficitVnd).toBe(100_000)
  })
})
