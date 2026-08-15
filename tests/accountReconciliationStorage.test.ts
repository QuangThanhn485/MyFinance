// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { loadCttmStateFromKey } from "@/storage/localStorage"
import { createInitialState } from "@/storage/schema"

const STORAGE_KEY = "cttm_reconciliation_snapshot_test"

beforeEach(() => {
  localStorage.clear()
})

describe("account reconciliation storage", () => {
  it("preserves a valid calculation snapshot", () => {
    const state = createInitialState("2026-08-15T00:00:00.000Z")
    state.accountBalanceReconciliationsByMonth["2026-08"] = {
      month: "2026-08",
      asOfDate: "2026-08-15",
      actualBalanceVnd: 27_315_311,
      incomeReceivedVnd: 14_000_000,
      calculationSnapshot: {
        emergencyOpeningVnd: 21_571_211,
        emergencyDepositedVnd: 0,
        emergencyWithdrawnVnd: 342_000,
        plannedIncomeVnd: 14_000_000,
        fixedCostsPlannedVnd: 6_517_900,
        fixedCostsPaidVnd: 6_287_900,
        variableBudgetVnd: 3_482_100,
        variableSpentVnd: 1_626_000,
        savingsTargetVnd: 4_000_000,
      },
      updatedAt: "2026-08-15T00:00:00.000Z",
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const loaded = loadCttmStateFromKey(STORAGE_KEY)

    expect(
      loaded.accountBalanceReconciliationsByMonth["2026-08"].calculationSnapshot,
    ).toEqual(state.accountBalanceReconciliationsByMonth["2026-08"].calculationSnapshot)
  })

  it("keeps legacy reconciliations without inventing a snapshot", () => {
    const state = createInitialState("2026-08-09T00:00:00.000Z")
    state.accountBalanceReconciliationsByMonth["2026-08"] = {
      month: "2026-08",
      asOfDate: "2026-08-09",
      actualBalanceVnd: 28_278_000,
      incomeReceivedVnd: 14_000_000,
      updatedAt: "2026-08-09T13:17:30.183Z",
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const loaded = loadCttmStateFromKey(STORAGE_KEY)

    expect(
      loaded.accountBalanceReconciliationsByMonth["2026-08"].calculationSnapshot,
    ).toBeUndefined()
  })
})
