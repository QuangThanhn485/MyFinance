import type { Expense, FixedCost } from "@/domain/types"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import { createInitialState, type CttmState } from "@/storage/schema"

/** Trạng thái "máy mới cài": mọi thứ mặc định. */
export function makeState(nowIso = "2026-09-01T00:00:00.000Z"): CttmState {
  return createInitialState(nowIso)
}

/** Trạng thái đã có cấu hình do người dùng nhập (không còn trống). */
export function makeConfiguredState(nowIso = "2026-09-01T00:00:00.000Z"): CttmState {
  const state = createInitialState(nowIso)
  state.settings = { ...state.settings, monthlyIncomeVnd: 20_000_000 }
  return state
}

export function withExpense(
  state: CttmState,
  input: { id: string; amountVnd: number; date: string; note?: string; at?: string; category?: string },
): CttmState {
  const at = input.at ?? `${input.date}T08:00:00.000Z`
  const expense: Expense = {
    id: input.id,
    amountVnd: input.amountVnd,
    category: input.category ?? "Food",
    bucket: "needs",
    note: input.note ?? "",
    date: input.date as Expense["date"],
    createdAt: at,
    updatedAt: at,
  }
  const byId = { ...state.entities.expenses.byId, [input.id]: expense }
  const allIds = state.entities.expenses.allIds.includes(input.id) ? state.entities.expenses.allIds : [...state.entities.expenses.allIds, input.id]
  const expenses = { byId, allIds }
  return {
    ...state,
    updatedAt: at,
    entities: { ...state.entities, expenses },
    indexes: rebuildExpenseIndexesFromEntities(expenses),
  }
}

export function withoutExpense(state: CttmState, id: string, deletedAt: string): CttmState {
  const { [id]: _removed, ...rest } = state.entities.expenses.byId
  const expenses = { byId: rest, allIds: state.entities.expenses.allIds.filter((x) => x !== id) }
  return {
    ...state,
    updatedAt: deletedAt,
    entities: { ...state.entities, expenses },
    indexes: rebuildExpenseIndexesFromEntities(expenses),
    tombstones: { ...(state.tombstones ?? {}), [id]: deletedAt },
  }
}

export function withFixedCost(state: CttmState, input: { id: string; month: string; name: string; amountVnd: number; at?: string }): CttmState {
  const at = input.at ?? `${input.month}-01T00:00:00.000Z`
  const fixedCost: FixedCost = {
    id: input.id,
    month: input.month as FixedCost["month"],
    name: input.name,
    amountVnd: input.amountVnd,
    paidAmountVnd: 0,
    category: "Bills",
    active: true,
    createdAt: at,
    updatedAt: at,
  }
  const byId = { ...state.entities.fixedCosts.byId, [input.id]: fixedCost }
  const allIds = state.entities.fixedCosts.allIds.includes(input.id) ? state.entities.fixedCosts.allIds : [...state.entities.fixedCosts.allIds, input.id]
  return { ...state, updatedAt: at, entities: { ...state.entities, fixedCosts: { byId, allIds } } }
}

export function expenseIds(state: CttmState) {
  return [...state.entities.expenses.allIds].sort()
}
