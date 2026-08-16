import { describe, expect, it } from "vitest"
import { projectMonthEndFromData } from "@/domain/finance/monthEndForecast"
import type { BudgetBucket, ISODate, YearMonth } from "@/domain/types"
import { daysInMonth } from "@/lib/date"
import { createInitialState, type CttmState } from "@/storage/schema"

function stateForMonth(month: YearMonth): CttmState {
  const state = createInitialState("2026-04-01T00:00:00.000Z")
  state.settingsByMonth[month] = {
    ...state.settings,
    monthlyIncomeVnd: 12_000_000,
    extraIncomeMonthlyVnd: 0,
    debtPaymentMonthlyVnd: 0,
    essentialVariableBaselineVnd: 3_000_000,
    emergencyFundCurrentVnd: 0,
  }
  return state
}

function addExpense(
  state: CttmState,
  input: {
    id: string
    date: ISODate
    amountVnd: number
    bucket: BudgetBucket
  },
) {
  const month = input.date.slice(0, 7) as YearMonth
  state.entities.expenses.byId[input.id] = {
    id: input.id,
    amountVnd: input.amountVnd,
    category: input.bucket === "needs" ? "Food" : "Shopping",
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
}

function addFixedCost(state: CttmState, month: YearMonth, amountVnd: number) {
  state.entities.fixedCosts.byId.fixed = {
    id: "fixed",
    month,
    name: "Fixed",
    amountVnd,
    paidAmountVnd: amountVnd,
    category: "Bills",
    active: true,
    createdAt: `${month}-01T00:00:00.000Z`,
    updatedAt: `${month}-01T00:00:00.000Z`,
  }
  state.entities.fixedCosts.allIds.push("fixed")
}

function addDailySeries(
  state: CttmState,
  month: YearMonth,
  amounts: number[],
  bucket: BudgetBucket = "needs",
) {
  amounts.forEach((amountVnd, index) => {
    if (amountVnd <= 0) return
    addExpense(state, {
      id: `${month}-${bucket}-${index + 1}`,
      date: `${month}-${String(index + 1).padStart(2, "0")}` as ISODate,
      amountVnd,
      bucket,
    })
  })
}

describe("projectMonthEndFromData", () => {
  it("converges to exact actual spending when the last day is closed", () => {
    const state = stateForMonth("2026-04")
    addFixedCost(state, "2026-04", 4_000_000)
    addExpense(state, {
      id: "needs-final",
      date: "2026-04-30",
      amountVnd: 2_900_000,
      bucket: "needs",
    })
    addExpense(state, {
      id: "wants-final",
      date: "2026-04-30",
      amountVnd: 1_219_500,
      bucket: "wants",
    })

    const projection = projectMonthEndFromData({ state, date: "2026-04-30" })

    expect(projection.remainingDaysInMonth).toBe(0)
    expect(projection.projectedNeedsVnd).toBe(2_900_000)
    expect(projection.projectedWantsVnd).toBe(1_219_500)
    expect(projection.projectedSavingsVnd).toBe(3_880_500)
  })

  it("uses the actual number of unclosed days", () => {
    const state = stateForMonth("2026-04")
    addDailySeries(state, "2026-04", Array(20).fill(100_000))

    const closedToday = projectMonthEndFromData({ state, date: "2026-04-20" })
    const openTodayState = stateForMonth("2026-04")
    addDailySeries(openTodayState, "2026-04", Array(19).fill(100_000))
    const openToday = projectMonthEndFromData({ state: openTodayState, date: "2026-04-20" })

    expect(closedToday.observedDays).toBe(20)
    expect(closedToday.remainingDaysInMonth).toBe(10)
    expect(openToday.observedDays).toBe(19)
    expect(openToday.remainingDaysInMonth).toBe(11)
  })

  it("reacts to recent acceleration even when month-to-date totals are nearly equal", () => {
    const accelerating = stateForMonth("2026-04")
    const slowing = stateForMonth("2026-04")
    accelerating.settingsByMonth["2026-04"].essentialVariableBaselineVnd = 0
    slowing.settingsByMonth["2026-04"].essentialVariableBaselineVnd = 0
    addDailySeries(accelerating, "2026-04", [
      0, 0, 0, 0, 0, 0, 0,
      200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000,
    ])
    addDailySeries(slowing, "2026-04", [
      200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000,
      0, 0, 0, 0, 0, 0, 1,
    ])

    const acceleratingProjection = projectMonthEndFromData({
      state: accelerating,
      date: "2026-04-14",
    })
    const slowingProjection = projectMonthEndFromData({
      state: slowing,
      date: "2026-04-14",
    })

    expect(acceleratingProjection.projectedNeedsVnd).toBeGreaterThan(
      slowingProjection.projectedNeedsVnd,
    )
  })

  it("shrinks an early-month estimate toward completed historical months", () => {
    const withoutHistory = stateForMonth("2026-04")
    const withHistory = stateForMonth("2026-04")
    withoutHistory.settingsByMonth["2026-04"].essentialVariableBaselineVnd = 0
    withHistory.settingsByMonth["2026-04"].essentialVariableBaselineVnd = 0
    addExpense(withoutHistory, {
      id: "current",
      date: "2026-04-03",
      amountVnd: 1,
      bucket: "needs",
    })
    addExpense(withHistory, {
      id: "current",
      date: "2026-04-03",
      amountVnd: 1,
      bucket: "needs",
    })
    addDailySeries(withHistory, "2026-02", Array(daysInMonth("2026-02")).fill(100_000))
    addDailySeries(withHistory, "2026-03", Array(daysInMonth("2026-03")).fill(100_000))

    const noHistoryProjection = projectMonthEndFromData({
      state: withoutHistory,
      date: "2026-04-03",
    })
    const historyProjection = projectMonthEndFromData({
      state: withHistory,
      date: "2026-04-03",
    })

    expect(historyProjection.historyMonthsUsed).toBe(2)
    expect(historyProjection.projectedNeedsVnd).toBeGreaterThan(
      noHistoryProjection.projectedNeedsVnd,
    )
  })

  it("deducts an unexplained reconciliation deficit from projected savings", () => {
    const state = stateForMonth("2026-04")
    addExpense(state, {
      id: "tracked",
      date: "2026-04-20",
      amountVnd: 100_000,
      bucket: "needs",
    })
    const withoutReconciliation = projectMonthEndFromData({
      state,
      date: "2026-04-20",
    })
    state.accountBalanceReconciliationsByMonth["2026-04"] = {
      month: "2026-04",
      asOfDate: "2026-04-20",
      actualBalanceVnd: 11_700_000,
      incomeReceivedVnd: 12_000_000,
      updatedAt: "2026-04-20T12:00:00.000Z",
    }

    const reconciled = projectMonthEndFromData({ state, date: "2026-04-20" })

    expect(reconciled.projectedUntrackedVnd).toBe(200_000)
    expect(reconciled.reconciliationAsOfDate).toBe("2026-04-20")
    expect(reconciled.projectedSavingsVnd).toBe(
      withoutReconciliation.projectedSavingsVnd - 200_000,
    )
  })

  it("ignores a zero-balance placeholder saved from an empty reconciliation field", () => {
    const state = stateForMonth("2026-04")
    addExpense(state, {
      id: "tracked",
      date: "2026-04-20",
      amountVnd: 100_000,
      bucket: "needs",
    })
    const withoutReconciliation = projectMonthEndFromData({
      state,
      date: "2026-04-20",
    })
    state.accountBalanceReconciliationsByMonth["2026-04"] = {
      month: "2026-04",
      asOfDate: "2026-04-20",
      actualBalanceVnd: 0,
      incomeReceivedVnd: 12_000_000,
      updatedAt: "2026-04-20T12:00:00.000Z",
    }

    const withPlaceholder = projectMonthEndFromData({ state, date: "2026-04-20" })

    expect(withPlaceholder.projectedUntrackedVnd).toBe(0)
    expect(withPlaceholder.reconciliationAsOfDate).toBeNull()
    expect(withPlaceholder.projectedSavingsVnd).toBe(
      withoutReconciliation.projectedSavingsVnd,
    )

    state.accountBalanceReconciliationsByMonth["2026-04"].actualBalanceConfirmed = true
    const withConfirmedZero = projectMonthEndFromData({ state, date: "2026-04-20" })

    expect(withConfirmedZero.projectedUntrackedVnd).toBeGreaterThan(0)
    expect(withConfirmedZero.projectedSavingsVnd).toBeLessThan(
      withoutReconciliation.projectedSavingsVnd,
    )
  })

  it("uses active spending caps for the unobserved days", () => {
    const uncappedState = stateForMonth("2026-04")
    const cappedState = stateForMonth("2026-04")
    addDailySeries(uncappedState, "2026-04", Array(10).fill(100_000))
    addDailySeries(cappedState, "2026-04", Array(10).fill(100_000))
    cappedState.capsByMonth["2026-04"] = {
      month: "2026-04",
      dailyTotalCapVnd: 50_000,
      appliedAt: "2026-04-10T12:00:00.000Z",
    }

    const uncapped = projectMonthEndFromData({ state: uncappedState, date: "2026-04-10" })
    const capped = projectMonthEndFromData({ state: cappedState, date: "2026-04-10" })

    expect(capped.projectedVariableVnd).toBeLessThan(uncapped.projectedVariableVnd)
  })

  it("includes dated forced purchases but can exclude the purchase currently being assessed", () => {
    const state = stateForMonth("2026-04")
    addExpense(state, {
      id: "tracked",
      date: "2026-04-20",
      amountVnd: 1,
      bucket: "needs",
    })
    state.entities.purchasePlans.byId.forced = {
      id: "forced",
      name: "Required replacement",
      priceVnd: 2_000_000,
      bucket: "wants",
      targetDate: "2026-04-25",
      priority: "high",
      forced: true,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    }
    state.entities.purchasePlans.allIds.push("forced")

    const included = projectMonthEndFromData({ state, date: "2026-04-20" })
    const excluded = projectMonthEndFromData({
      state,
      date: "2026-04-20",
      excludePurchasePlanId: "forced",
    })

    expect(included.committedPurchasesVnd).toBe(2_000_000)
    expect(excluded.committedPurchasesVnd).toBe(0)
    expect(included.projectedWantsVnd).toBeGreaterThan(excluded.projectedWantsVnd)
  })
})
