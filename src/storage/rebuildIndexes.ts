import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import type { CttmState } from "@/storage/schema"

export function rebuildIndexes(state: CttmState): CttmState {
  return {
    ...state,
    indexes: rebuildExpenseIndexesFromEntities(state.entities.expenses),
  }
}

