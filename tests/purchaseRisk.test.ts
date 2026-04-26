import { describe, expect, it } from "vitest"
import { analyzePurchaseRisk } from "@/domain/finance/purchaseRisk"
import type { BudgetBucket, ExpenseCategory, ISODate, YearMonth } from "@/domain/types"
import { createInitialState, type CttmState } from "@/storage/schema"

function stateForMonth(month: YearMonth): CttmState {
  const state = createInitialState("2026-04-15T12:00:00.000Z")
  state.settingsByMonth[month] = {
    ...state.settings,
    monthlyIncomeVnd: 12_000_000,
    extraIncomeMonthlyVnd: 0,
    debtPaymentMonthlyVnd: 1_000_000,
    essentialVariableBaselineVnd: 3_000_000,
    emergencyFundCurrentVnd: 8_000_000,
    emergencyFundTargetMonths: 3,
  }
  return state
}

function addFixedCost(state: CttmState, input: {
  id: string
  month: YearMonth
  amountVnd: number
  category?: ExpenseCategory
}) {
  state.entities.fixedCosts.byId[input.id] = {
    id: input.id,
    month: input.month,
    name: input.id,
    amountVnd: input.amountVnd,
    category: input.category ?? "Bills",
    active: true,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  }
  state.entities.fixedCosts.allIds.push(input.id)
}

function addExpense(state: CttmState, input: {
  id: string
  date: ISODate
  amountVnd: number
  bucket: BudgetBucket
  category?: ExpenseCategory
}) {
  const month = input.date.slice(0, 7) as YearMonth
  const category = input.category ?? (input.bucket === "needs" ? "Food" : "Shopping")

  state.entities.expenses.byId[input.id] = {
    id: input.id,
    amountVnd: input.amountVnd,
    category,
    bucket: input.bucket,
    note: "",
    date: input.date,
    createdAt: `${input.date}T00:00:00.000Z`,
    updatedAt: `${input.date}T00:00:00.000Z`,
  }
  state.entities.expenses.allIds.push(input.id)
  state.indexes.expensesByMonth[month] = [
    ...(state.indexes.expensesByMonth[month] ?? []),
    input.id,
  ]
  state.indexes.expensesByDate[input.date] = [
    ...(state.indexes.expensesByDate[input.date] ?? []),
    input.id,
  ]
  const categoryKey = `${month}|${category}`
  state.indexes.expensesByCategoryMonth[categoryKey] = [
    ...(state.indexes.expensesByCategoryMonth[categoryKey] ?? []),
    input.id,
  ]
  const bucketKey = `${month}|${input.bucket}`
  state.indexes.expensesByBucketMonth[bucketKey] = [
    ...(state.indexes.expensesByBucketMonth[bucketKey] ?? []),
    input.id,
  ]
}

describe("analyzePurchaseRisk", () => {
  it("blocks wants purchases that break bucket, monthly budget, and MSS", () => {
    const state = stateForMonth("2026-04")
    addFixedCost(state, { id: "rent", month: "2026-04", amountVnd: 4_000_000 })
    addExpense(state, {
      id: "food",
      date: "2026-04-05",
      amountVnd: 2_400_000,
      bucket: "needs",
    })
    addExpense(state, {
      id: "shopping",
      date: "2026-04-10",
      amountVnd: 1_800_000,
      bucket: "wants",
    })

    const result = analyzePurchaseRisk({
      state,
      today: "2026-04-15",
      purchase: {
        name: "Gaming console",
        priceVnd: 1_500_000,
        bucket: "wants",
        priority: "low",
        forced: false,
      },
    })

    expect(result.decision).toBe("KHÔNG MUA")
    expect(result.hardStops.length).toBeGreaterThanOrEqual(2)
    expect(result.snapshot.bucketRemainingAfterPurchaseVnd).toBeLessThan(0)
    expect(result.snapshot.projectedEndMonthBalanceAfterPurchaseVnd).toBeLessThan(
      result.snapshot.minimumSafetySavingsVnd,
    )
  })

  it("allows small wants purchases when cash flow, MSS, and emergency coverage stay healthy", () => {
    const state = stateForMonth("2026-04")
    state.settingsByMonth["2026-04"] = {
      ...state.settingsByMonth["2026-04"],
      monthlyIncomeVnd: 15_000_000,
      debtPaymentMonthlyVnd: 0,
      emergencyFundCurrentVnd: 20_000_000,
    }
    addFixedCost(state, { id: "rent", month: "2026-04", amountVnd: 3_000_000 })
    addExpense(state, {
      id: "food",
      date: "2026-04-04",
      amountVnd: 1_000_000,
      bucket: "needs",
    })
    addExpense(state, {
      id: "movie",
      date: "2026-04-06",
      amountVnd: 300_000,
      bucket: "wants",
    })

    const result = analyzePurchaseRisk({
      state,
      today: "2026-04-10",
      purchase: {
        name: "Book",
        priceVnd: 400_000,
        bucket: "wants",
        priority: "med",
        forced: false,
      },
    })

    expect(result.decision).toBe("MUA ĐƯỢC")
    expect(result.hardStops).toHaveLength(0)
    expect(result.riskScore).toBeLessThan(35)
    expect(result.snapshot.emergencyCoverageMonths).toBeGreaterThanOrEqual(3)
  })
})
