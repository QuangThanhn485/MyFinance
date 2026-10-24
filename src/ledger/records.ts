import { DEFAULT_EXPENSE_CATEGORY_DEFINITIONS } from "@/domain/constants"
import type {
  AccountBalanceReconciliation,
  BudgetAdjustment,
  ExpenseCategoryConfig,
  Settings,
  SpendingCaps,
} from "@/domain/types"
import { ensureCategoriesForState } from "@/storage/categories"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import { createDefaultSettings, createInitialState, type CttmState, type EntityTable, type MonthLockSnapshot } from "@/storage/schema"
import type { ExpenseTemplate } from "@/storage/templates"

/**
 * Ánh xạ giữa trạng thái ứng dụng (CttmState + mẫu chi tiêu) và tập bản ghi của sổ cái.
 *
 * Mỗi bản ghi có khoá `<collection>/<id>` và một object field phẳng. Sổ cái chỉ biết tới bản
 * ghi; mọi thứ khác (indexes, updatedAt tổng, thứ tự allIds) đều dựng lại được từ bản ghi.
 */

export const COLLECTIONS = [
  "settings",
  "monthSettings",
  "category",
  "expense",
  "fixedCost",
  "purchasePlan",
  "savingsTx",
  "budgetAdj",
  "caps",
  "monthLock",
  "reconciliation",
  "openingSource",
  "template",
] as const

export type Collection = (typeof COLLECTIONS)[number]
export type Fields = Record<string, unknown>
export type RecordMap = Record<string, Fields>

export type LedgerState = {
  records: RecordMap
  /** key → thời điểm xoá (ISO). Giữ vĩnh viễn: lệnh xoá không bao giờ hết hạn. */
  deleted: Record<string, string>
}

export type AppDoc = {
  cttm: CttmState
  templates: ExpenseTemplate[]
}

const COLLECTION_SET = new Set<string>(COLLECTIONS)

export const ENTITY_COLLECTIONS = {
  expenses: "expense",
  fixedCosts: "fixedCost",
  purchasePlans: "purchasePlan",
  savingsTransactions: "savingsTx",
} as const satisfies Record<keyof CttmState["entities"], Collection>

type EntityKind = keyof typeof ENTITY_COLLECTIONS

const ENTITY_KINDS = Object.keys(ENTITY_COLLECTIONS) as EntityKind[]

/** Mốc cố định cho dữ liệu dựng lại (không phụ thuộc giờ máy) để phép chiếu tất định. */
const PROJECTION_EPOCH = "2000-01-01T00:00:00.000Z"

export function emptyLedgerState(): LedgerState {
  return { records: {}, deleted: {} }
}

export function recordKey(collection: Collection, id: string) {
  return `${collection}/${id}`
}

export function splitRecordKey(key: string): { collection: Collection; id: string } | null {
  const slash = key.indexOf("/")
  if (slash <= 0 || slash === key.length - 1) return null
  const collection = key.slice(0, slash)
  if (!COLLECTION_SET.has(collection)) return null
  return { collection: collection as Collection, id: key.slice(slash + 1) }
}

export function isValidRecordKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= 300 && splitRecordKey(key) !== null
}

// ---------------------------------------------------------------------------
// State → records
// ---------------------------------------------------------------------------

function putMonthMap<T>(out: RecordMap, collection: Collection, map: Record<string, T> | undefined) {
  if (!map) return
  for (const [month, value] of Object.entries(map)) {
    if (value && typeof value === "object") out[`${collection}/${month}`] = value as unknown as Fields
  }
}

export function cttmToRecords(cttm: CttmState, out: RecordMap = {}): RecordMap {
  out["settings/global"] = cttm.settings as unknown as Fields
  putMonthMap(out, "monthSettings", cttm.settingsByMonth)
  for (const category of cttm.expenseCategories) {
    if (category && typeof category.id === "string" && category.id) out[`category/${category.id}`] = category as unknown as Fields
  }
  for (const kind of ENTITY_KINDS) {
    const collection = ENTITY_COLLECTIONS[kind]
    const byId = cttm.entities[kind].byId as Record<string, unknown>
    for (const id of Object.keys(byId)) {
      const entity = byId[id]
      if (entity && typeof entity === "object") out[`${collection}/${id}`] = entity as Fields
    }
  }
  putMonthMap(out, "budgetAdj", cttm.budgetAdjustmentsByMonth)
  putMonthMap(out, "caps", cttm.capsByMonth)
  putMonthMap(out, "monthLock", cttm.monthLocksByMonth)
  putMonthMap(out, "reconciliation", cttm.accountBalanceReconciliationsByMonth)
  for (const [month, source] of Object.entries(cttm.emergencyFundOpeningSourcesByMonth ?? {})) {
    if (source === "auto" || source === "manual") out[`openingSource/${month}`] = { source }
  }
  return out
}

export function templatesToRecords(templates: ExpenseTemplate[], out: RecordMap = {}): RecordMap {
  for (const template of templates) {
    if (template && typeof template.id === "string" && template.id) out[`template/${template.id}`] = template as unknown as Fields
  }
  return out
}

export function docToRecords(doc: AppDoc): RecordMap {
  return templatesToRecords(doc.templates, cttmToRecords(doc.cttm))
}

// ---------------------------------------------------------------------------
// Records → state (phép chiếu)
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORY_ORDER = new Map(DEFAULT_EXPENSE_CATEGORY_DEFINITIONS.map((category, index) => [category.id, index]))

function compareByCreatedThenId(a: { id: string; createdAt?: string }, b: { id: string; createdAt?: string }) {
  const ca = a.createdAt ?? ""
  const cb = b.createdAt ?? ""
  if (ca !== cb) return ca < cb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function compareCategories(a: ExpenseCategoryConfig, b: ExpenseCategoryConfig) {
  const da = DEFAULT_CATEGORY_ORDER.get(a.id)
  const db = DEFAULT_CATEGORY_ORDER.get(b.id)
  if (da !== undefined || db !== undefined) {
    if (da === undefined) return 1
    if (db === undefined) return -1
    return da - db
  }
  return compareByCreatedThenId(a, b)
}

function sortTable<T extends { id: string; createdAt?: string }>(byId: Record<string, T>): EntityTable<T> {
  const allIds = Object.keys(byId).sort((a, b) => compareByCreatedThenId(byId[a], byId[b]))
  return { byId, allIds }
}

/**
 * Dựng CttmState + mẫu chi tiêu từ bản ghi. Bản ghi được dùng nguyên tham chiếu khi có thể
 * (entity, mẫu) để so khác giữa hai lần thao tác chỉ phải so những gì thực sự đổi.
 */
export function recordsToDoc(records: RecordMap): AppDoc {
  const cttm = createInitialState(PROJECTION_EPOCH)
  const categories: ExpenseCategoryConfig[] = []
  const templates: ExpenseTemplate[] = []
  const tables: Record<EntityKind, Record<string, { id: string; createdAt?: string }>> = {
    expenses: {},
    fixedCosts: {},
    purchasePlans: {},
    savingsTransactions: {},
  }
  const kindByCollection = new Map<string, EntityKind>(ENTITY_KINDS.map((kind) => [ENTITY_COLLECTIONS[kind], kind]))

  for (const key of Object.keys(records)) {
    const parsed = splitRecordKey(key)
    const fields = records[key]
    if (!parsed || !fields || typeof fields !== "object") continue
    const { collection, id } = parsed
    switch (collection) {
      case "settings":
        if (id === "global") cttm.settings = { ...createDefaultSettings(), ...(fields as Partial<Settings>) }
        break
      case "monthSettings":
        cttm.settingsByMonth[id] = { ...createDefaultSettings(), ...(fields as Partial<Settings>) }
        break
      case "category":
        categories.push({ ...(fields as unknown as ExpenseCategoryConfig), id })
        break
      case "expense":
      case "fixedCost":
      case "purchasePlan":
      case "savingsTx": {
        const kind = kindByCollection.get(collection) as EntityKind
        tables[kind][id] = (fields.id === id ? fields : { ...fields, id }) as { id: string }
        break
      }
      case "budgetAdj":
        cttm.budgetAdjustmentsByMonth[id] = fields as unknown as BudgetAdjustment
        break
      case "caps":
        cttm.capsByMonth[id] = fields as unknown as SpendingCaps
        break
      case "monthLock":
        cttm.monthLocksByMonth[id] = fields as unknown as MonthLockSnapshot
        break
      case "reconciliation":
        cttm.accountBalanceReconciliationsByMonth[id] = fields as unknown as AccountBalanceReconciliation
        break
      case "openingSource":
        if (fields.source === "auto" || fields.source === "manual") cttm.emergencyFundOpeningSourcesByMonth[id] = fields.source
        break
      case "template":
        templates.push((fields.id === id ? fields : { ...fields, id }) as unknown as ExpenseTemplate)
        break
    }
  }

  for (const kind of ENTITY_KINDS) {
    ;(cttm.entities as Record<EntityKind, EntityTable<unknown>>)[kind] = sortTable(tables[kind])
  }
  // Sổ cái chưa có danh mục nào (chưa từng nhập dữ liệu) → giữ bộ mặc định của createInitialState.
  if (categories.length > 0) cttm.expenseCategories = categories.sort(compareCategories)
  cttm.indexes = rebuildExpenseIndexesFromEntities(cttm.entities.expenses)
  templates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Bảo đảm luôn có danh mục cho mọi expense/fixedCost (phép chiếu không bao giờ để UI thiếu danh mục).
  const withCategories = ensureCategoriesForState(cttm)
  withCategories.expenseCategories = withCategories.expenseCategories.sort(compareCategories)
  return { cttm: withCategories, templates }
}

// ---------------------------------------------------------------------------
// So sánh giá trị JSON
// ---------------------------------------------------------------------------

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined || a === null || b === null) return false
  if (typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const arrB = b as unknown[]
    if (a.length !== arrB.length) return false
    for (let i = 0; i < a.length; i += 1) if (!jsonEqual(a[i], arrB[i])) return false
    return true
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  for (const key of Object.keys(ra)) {
    if (ra[key] === undefined) continue
    if (!jsonEqual(ra[key], rb[key])) return false
  }
  for (const key of Object.keys(rb)) {
    if (rb[key] === undefined) continue
    if (!(key in ra) || ra[key] === undefined) return false
  }
  return true
}

/** Bỏ field undefined (JSON không mang được) — dùng trước khi ghi op. */
export function compactFields(fields: Fields): Fields {
  const out: Fields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
