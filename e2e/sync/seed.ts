// Chạy từ thư mục dự án: npx vite-node e2e/sync/seed.ts  → tạo e2e/sync/seed.json
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Expense, FixedCost, SavingsTransaction } from "@/domain/types"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import { createInitialState, type CttmState } from "@/storage/schema"
import { encodeSnapshot, hashDoc, stripForSync, type HeadV3, type SyncDoc } from "@/sync/snapshot"

let seed = 20261024
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]
const pad = (n: number, w = 2) => String(n).padStart(w, "0")

function buildState(): CttmState {
  const state = createInitialState("2026-01-01T00:00:00.000Z")
  state.settings = { ...state.settings, monthlyIncomeVnd: 14_000_000, essentialVariableBaselineVnd: 3_000_000 }
  state.expenseCategories.push({ id: "custom_thu_cung", label: "Thú cưng", defaultBucket: "wants", system: false, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" })
  const notes = ["Ăn trưa", "Cà phê", "Bữa chính 33k", "Xăng xe", "Grab", "Siêu thị", "Thuốc", "Sinh tố bơ", "Đồ dùng", "Ăn tối"]
  const categories = ["Food", "Transport", "Shopping", "Health", "Entertainment", "custom_thu_cung"]
  const expenses: Record<string, Expense> = {}
  for (let i = 1; i <= 900; i += 1) {
    const month = 1 + Math.floor(((i - 1) / 900) * 10)
    const day = 1 + Math.floor(rand() * 28)
    const date = `2026-${pad(month)}-${pad(day)}` as Expense["date"]
    const at = `${date}T0${Math.floor(rand() * 9)}:00:00.000Z`
    const id = `ex_${pad(i, 4)}`
    expenses[id] = { id, amountVnd: Math.round(rand() * 200) * 1000 + 5000, category: pick(categories), bucket: rand() > 0.3 ? "needs" : "wants", note: pick(notes), date, createdAt: at, updatedAt: at }
  }
  state.entities.expenses = { byId: expenses, allIds: Object.keys(expenses) }
  const fixed: Record<string, FixedCost> = {}
  for (let m = 1; m <= 10; m += 1) {
    for (const [k, name] of ["Tiền nhà", "Điện", "Nước", "Internet", "Bảo hiểm", "Gửi xe", "Điện thoại"].entries()) {
      const id = `fc_2026-${pad(m)}_${k}`
      fixed[id] = { id, month: `2026-${pad(m)}` as FixedCost["month"], name, amountVnd: [4_000_000, 600_000, 150_000, 250_000, 500_000, 120_000, 100_000][k], paidAmountVnd: m < 10 ? [4_000_000, 600_000, 150_000, 250_000, 500_000, 120_000, 100_000][k] : 0, category: "Bills", active: true, createdAt: `2026-${pad(m)}-01T00:00:00.000Z`, updatedAt: `2026-${pad(m)}-01T00:00:00.000Z` }
    }
  }
  state.entities.fixedCosts = { byId: fixed, allIds: Object.keys(fixed) }
  const savings: Record<string, SavingsTransaction> = {}
  for (let i = 1; i <= 23; i += 1) {
    const id = `st_${pad(i)}`
    const date = `2026-${pad(1 + (i % 10))}-15` as SavingsTransaction["date"]
    savings[id] = { id, fund: "emergency", type: i % 3 === 0 ? "withdraw" : "deposit", amountVnd: 500_000 * (1 + (i % 4)), reason: i % 3 === 0 ? "Khẩn cấp" : "Nạp quỹ", note: "", date, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z` }
  }
  state.entities.savingsTransactions = { byId: savings, allIds: Object.keys(savings) }
  for (let m = 1; m <= 11; m += 1) {
    const month = `2026-${pad(m)}`
    state.settingsByMonth[month] = { ...state.settings, emergencyFundCurrentVnd: 5_000_000 + m * 1_000_000 }
    state.emergencyFundOpeningSourcesByMonth[month] = "auto"
    if (m <= 9) state.monthLocksByMonth[month] = { closedAt: `2026-${pad(m + 1)}-01T00:00:30.000Z`, settings: state.settingsByMonth[month], budgetAdjustment: null, caps: null }
  }
  state.accountBalanceReconciliationsByMonth["2026-08"] = { month: "2026-08", asOfDate: "2026-08-09", actualBalanceVnd: 21_000_000, actualBalanceConfirmed: true, incomeReceivedVnd: 14_000_000, updatedAt: "2026-08-09T10:00:00.000Z" }
  state.indexes = rebuildExpenseIndexesFromEntities(state.entities.expenses)
  return state
}

function withExpense(state: CttmState, expense: Expense): CttmState {
  const expenses = { byId: { ...state.entities.expenses.byId, [expense.id]: expense }, allIds: [...state.entities.expenses.allIds.filter((id) => id !== expense.id), expense.id] }
  return { ...state, entities: { ...state.entities, expenses }, indexes: rebuildExpenseIndexesFromEntities(expenses) }
}

const templates = [
  { id: "tpl_cafe", name: "Cà phê sáng", amount: 30000, category: "Food", bucket: "NEEDS", note: "Cà phê", createdAt: "2026-03-01T00:00:00.000Z", lastUsedAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", useCount: 40 },
  { id: "tpl_lunch", name: "Ăn trưa", amount: 45000, category: "Food", bucket: "NEEDS", note: "Ăn trưa", createdAt: "2026-03-01T00:00:00.000Z", lastUsedAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z", useCount: 80 },
]

async function main() {
  const v11 = buildState()
  const v12 = withExpense(v11, { id: "ex_v12", amountVnd: 120_000, category: "Food", bucket: "needs", note: "đẩy lên v12 từ máy A", date: "2026-10-22", createdAt: "2026-10-22T10:00:00.000Z", updatedAt: "2026-10-22T10:00:00.000Z" })
  const docOf = (cttm: CttmState): SyncDoc => ({ cttm, templates: { items: templates as never, tombstones: {} } })

  const data = { cttm: stripForSync(v12) as unknown as CttmState, templates: { items: templates as never, tombstones: {} } }
  const contentHash = hashDoc(data)
  const snapshot = { schema: 3 as const, version: 12, contentHash, committedAt: Date.parse("2026-10-22T10:00:00.000Z"), deviceId: "dev_laptop", data }
  const encoded = await encodeSnapshot(snapshot)
  const head: HeadV3 = { schema: 3, version: 12, contentHash, genesisId: "gen_prod", deviceId: "dev_laptop", deviceLabel: "Laptop", committedAt: snapshot.committedAt, bytes: encoded.bytes, enc: encoded.enc, appBuild: "v3" }

  // Máy A (laptop): đang ở v12, thêm 2 khoản chưa kịp đẩy.
  let localA = withExpense(v12, { id: "ex_A1", amountVnd: 35_000, category: "Food", bucket: "needs", note: "A chưa đồng bộ 1", date: "2026-10-23", createdAt: "2026-10-23T08:00:00.000Z", updatedAt: "2026-10-23T08:00:00.000Z" })
  localA = withExpense(localA, { id: "ex_A2", amountVnd: 60_000, category: "Transport", bucket: "needs", note: "A chưa đồng bộ 2", date: "2026-10-23", createdAt: "2026-10-23T09:00:00.000Z", updatedAt: "2026-10-23T09:00:00.000Z" })
  // Máy B (điện thoại): còn ở v11, sửa ex_0005 và xoá ex_0010, chưa đẩy.
  let localB = withExpense(v11, { ...v11.entities.expenses.byId.ex_0005, amountVnd: 999_000, note: "B sửa offline", updatedAt: "2026-10-23T12:00:00.000Z" })
  const { ex_0010: _gone, ...restB } = localB.entities.expenses.byId
  localB = { ...localB, entities: { ...localB.entities, expenses: { byId: restB, allIds: Object.keys(restB) } }, tombstones: { ex_0010: "2026-10-23T12:05:00.000Z" } }

  const config = (url: string) => JSON.stringify({ mode: "upstash", upstash: { url, token: "e2e-token" }, updatedAt: 1 })
  const out = {
    remote: { "mf3:version": "12", "mf3:head": JSON.stringify(head), "mf3:snap:12": encoded.payload, "mf3:genesis": "gen_prod" },
    snapshotEncoding: encoded.enc,
    snapshotBytes: encoded.payload.length,
    localA: { cttm_v1: JSON.stringify(localA), "smartSpend.templates.v1": JSON.stringify(templates), "mf3.base": JSON.stringify(docOf(v12)), "mf3.meta": JSON.stringify({ deviceId: "dev_laptop", deviceLabel: "Laptop", baseVersion: 12, dirty: true, genesisId: "gen_prod" }) },
    localB: { cttm_v1: JSON.stringify(localB), "smartSpend.templates.v1": JSON.stringify(templates), "mf3.base": JSON.stringify(docOf(v11)), "mf3.meta": JSON.stringify({ deviceId: "dev_phone", deviceLabel: "Điện thoại", baseVersion: 11, dirty: true, genesisId: "gen_prod" }) },
    // Máy D: v3 đang ở đúng v12, không có thay đổi nào chưa đẩy.
    localD: { cttm_v1: JSON.stringify(v12), "smartSpend.templates.v1": JSON.stringify(templates), "mf3.base": JSON.stringify(docOf(v12)), "mf3.meta": JSON.stringify({ deviceId: "dev_tablet", deviceLabel: "Máy tính bảng", baseVersion: 12, dirty: false, genesisId: "gen_prod" }) },
    // Máy E: base v3 "không đáng tin" (bị tab lạ ghi đè), có thêm một khoản riêng → gộp kiểu hợp nhất.
    localE: { cttm_v1: JSON.stringify(withExpense(v11, { id: "ex_E1", amountVnd: 77_000, category: "Food", bucket: "needs", note: "E chưa đồng bộ", date: "2026-10-23", createdAt: "2026-10-23T07:00:00.000Z", updatedAt: "2026-10-23T07:00:00.000Z" })), "smartSpend.templates.v1": JSON.stringify(templates), "mf3.base": JSON.stringify(docOf(v11)), "mf3.meta": JSON.stringify({ deviceId: "dev_old", deviceLabel: "Máy cũ", baseVersion: 11, dirty: true, baseUntrusted: true, genesisId: "gen_prod" }) },
    configFor: config("__URL__"),
    expected: { expenseCount: 900 + 1 + 2 - 1, edited: { id: "ex_0005", amountVnd: 999_000 }, deleted: "ex_0010", present: ["ex_v12", "ex_A1", "ex_A2", "ex_0005"] },
  }
  const here = dirname(fileURLToPath(import.meta.url))
  writeFileSync(join(here, "seed.json"), JSON.stringify(out))
  console.log("seed.json written", { snapshotEncoding: encoded.enc, snapshotBytes: encoded.payload.length, cttmBytes: out.localA.cttm_v1.length })
}

void main()
