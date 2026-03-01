import { describe, expect, it } from "vitest"
import { evaluatePurchaseAdvisor } from "@/domain/finance/advisor"

describe("evaluatePurchaseAdvisor", () => {
  it("treats small items (<= impact threshold) as negligible when not forced", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Coffee", priceVnd: 500_000, bucket: "wants", forced: false },
      context: {
        incomeVnd: 10_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 2_000_000,
        savingsBudgetVnd: 1_000_000,
        emergencyCoverageMonths: 4,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.impact.thresholdVnd).toBe(500_000)
    expect(res.impact.isNegligible).toBe(true)
    expect(res.recommendation).toBe("NÊN MUA")
    expect(res.safetySnapshot.violatesSafety).toBe(false)
  })

  it("does not apply the negligible-impact guard when forced", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Coffee", priceVnd: 50_000, bucket: "wants", forced: true },
      context: {
        incomeVnd: 10_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 2_000_000,
        savingsBudgetVnd: 1_000_000,
        emergencyCoverageMonths: 4,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.impact.isNegligible).toBe(false)
  })

  it("returns 'CÂN NHẮC' when wants budget is enough but SafetyLock is violated (case B)", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Headphones", priceVnd: 1_000_000, bucket: "wants", forced: false },
      context: {
        incomeVnd: 6_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 2_500_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 2_000_000,
        savingsBudgetVnd: 0,
        emergencyCoverageMonths: 0.5,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.budgetSnapshot.hasEnoughBudget).toBe(true)
    expect(res.safetySnapshot.violatesSafety).toBe(true)
    expect(res.recommendation).toBe("CÂN NHẮC")
    expect(res.safetySnapshot.deficitIfBuyVnd).toBe(950_000)
  })

  it("does not block NEEDS purchases based on wants budget", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Medicine", priceVnd: 600_000, bucket: "needs", forced: false },
      context: {
        incomeVnd: 10_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 0,
        savingsBudgetVnd: 0,
        emergencyCoverageMonths: 4,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.budgetSnapshot.bucket).toBe("needs")
    expect(res.recommendation).toBe("NÊN MUA")
    expect(res.recommendation).not.toBe("KHÔNG NÊN")
  })

  it("downgrades high-value wants items when emergency coverage is < 3 months", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Phone", priceVnd: 1_500_000, bucket: "wants", forced: false },
      context: {
        incomeVnd: 10_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 2_000_000,
        savingsBudgetVnd: 1_000_000,
        emergencyCoverageMonths: 2.5,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.safetySnapshot.violatesSafety).toBe(false)
    expect(res.budgetSnapshot.hasEnoughBudget).toBe(true)
    expect(res.recommendation).toBe("CÂN NHẮC")
  })

  it("marks the savings plan infeasible when planned monthly capacity is too low", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Laptop", priceVnd: 2_000_000, bucket: "wants", forced: false },
      context: {
        incomeVnd: 10_000_000,
        fixedCostsVnd: 3_000_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 0,
        variableWantsSpentVnd: 0,
        wantsBudgetVnd: 0,
        savingsBudgetVnd: 0,
        emergencyCoverageMonths: 4,
        emergencyFundTargetMonths: 3,
      },
    })

    expect(res.recommendation).toBe("KHÔNG NÊN")
    expect(res.savingsPlan?.monthlyAvailableForGoalVnd).toBe(0)
    expect(res.savingsPlan?.isFeasible).toBe(false)
    expect(res.savingsPlan?.warning).toBeTruthy()
  })

  it("uses pace + emergency hard-stop for risky wants purchases", () => {
    const res = evaluatePurchaseAdvisor({
      purchase: { name: "Gaming Console", priceVnd: 2_500_000, bucket: "wants", forced: false, priority: "low" },
      context: {
        incomeVnd: 12_000_000,
        fixedCostsVnd: 5_500_000,
        essentialVariableBaselineVnd: 3_000_000,
        variableNeedsSpentVnd: 2_700_000,
        variableWantsSpentVnd: 2_100_000,
        wantsBudgetVnd: 1_500_000,
        savingsBudgetVnd: 400_000,
        emergencyCoverageMonths: 0.4,
        emergencyFundTargetMonths: 3,
        dayOfMonth: 8,
        daysInMonth: 30,
      },
    })

    expect(res.decisionEngine.hardStops.length).toBeGreaterThan(0)
    expect(res.recommendation).toBe("KHÔNG NÊN")
    expect(res.decisionEngine.riskScore).toBeGreaterThanOrEqual(78)
  })
})
