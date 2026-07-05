import { describe, expect, it } from "vitest"
import { evaluateBudgetHealth } from "@/domain/finance/budgetHealth"

const base = {
  monthlyIncomeVnd: 10_000_000,
  planned: { essentialMonthlyVnd: 3_000_000, wantsMonthlyVnd: 2_000_000 },
}

describe("evaluateBudgetHealth", () => {
  it("stays silent early in the month for normal lumpy spending", () => {
    // Ngày 5, đã chi 600k/2tr ngân sách Mong muốn — hoàn toàn bình thường, KHÔNG cảnh báo.
    const warnings = evaluateBudgetHealth({
      ...base,
      dayOfMonth: 5,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 600_000, wantsVnd: 600_000, essentialSpentVnd: 0 },
    })
    expect(warnings).toHaveLength(0)
  })

  it("warns (danger) when the monthly wants budget is already exceeded, even early", () => {
    const warnings = evaluateBudgetHealth({
      ...base,
      dayOfMonth: 5,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 2_500_000, wantsVnd: 2_500_000, essentialSpentVnd: 0 },
    })
    const wants = warnings.find((w) => w.type === "PACE_WANTS")
    expect(wants?.severity).toBe("danger")
    expect(wants?.details.overspendVnd).toBe(500_000)
  })

  it("warns when the current pace clearly projects a wants overspend (past the early-month gate)", () => {
    // Ngày 20/30, đã chi 1.6tr -> dự báo 2.4tr > 2tr + biên 10%, vượt 400k >= sàn 200k.
    const warnings = evaluateBudgetHealth({
      ...base,
      dayOfMonth: 20,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 1_600_000, wantsVnd: 1_600_000, essentialSpentVnd: 0 },
    })
    const wants = warnings.find((w) => w.type === "PACE_WANTS")
    expect(wants?.severity).toBe("warning")
    expect(wants?.details.projectedWantsVnd).toBe(2_400_000)
    expect(wants?.details.overspendVnd).toBe(400_000)
  })

  it("does not warn when the projected overshoot is within the 10% margin", () => {
    // Ngày 20/30, đã chi 1.4tr -> dự báo 2.1tr, chỉ vượt 5% -> KHÔNG cảnh báo.
    const warnings = evaluateBudgetHealth({
      ...base,
      dayOfMonth: 20,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 1_400_000, wantsVnd: 1_400_000, essentialSpentVnd: 0 },
    })
    expect(warnings.some((w) => w.type === "PACE_WANTS")).toBe(false)
  })

  it("warns (danger) when essentials exceed the monthly baseline", () => {
    const warnings = evaluateBudgetHealth({
      ...base,
      dayOfMonth: 15,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 3_500_000, wantsVnd: 0, essentialSpentVnd: 3_500_000 },
    })
    const essential = warnings.find((w) => w.type === "ESSENTIAL_SAFETY_CAP")
    expect(essential?.severity).toBe("danger")
    expect(essential?.details.overspendVnd).toBe(500_000)
  })

  it("returns no warnings when there is no income", () => {
    const warnings = evaluateBudgetHealth({
      monthlyIncomeVnd: 0,
      planned: { essentialMonthlyVnd: 3_000_000, wantsMonthlyVnd: 2_000_000 },
      dayOfMonth: 20,
      daysInMonth: 30,
      actualToDate: { variableTotalVnd: 9_000_000, wantsVnd: 5_000_000, essentialSpentVnd: 4_000_000 },
    })
    expect(warnings).toHaveLength(0)
  })
})
