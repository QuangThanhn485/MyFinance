import { describe, expect, it } from "vitest"
import { evaluateBudgetHealth } from "@/domain/finance/budgetHealth"

describe("evaluateBudgetHealth", () => {
  it("triggers wants pace overspend on day 5 when 600k exceeds tolerance", () => {
    const warnings = evaluateBudgetHealth({
      dayOfMonth: 5,
      daysInMonth: 30,
      monthlyIncomeVnd: 10_000_000,
      planned: { essentialMonthlyVnd: 3_000_000, wantsMonthlyVnd: 2_000_000 },
      actualToDate: {
        variableTotalVnd: 600_000,
        wantsVnd: 600_000,
        essentialSpentVnd: 0,
      },
    })

    const wants = warnings.find((w) => w.type === "PACE_WANTS")
    expect(wants).toBeTruthy()

    expect(warnings.some((w) => w.type === "PACE_VARIABLE")).toBe(false)

    expect(wants?.details.plannedToDateWantsVnd).toBe(333_333)
    expect(wants?.details.overspendVnd).toBe(266_667)
    expect(wants?.details.toleranceVnd).toBe(50_000)
  })
})

