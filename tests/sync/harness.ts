import type { Expense, FixedCost } from "@/domain/types"
import type { DataSourceConfig } from "@/storage/dataSource"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import { normalizeCttmStateFromRaw } from "@/storage/localStorage"
import { createInitialState, type CttmState } from "@/storage/schema"
import type { KeyValueStorage } from "@/sync/localMeta"
import { CAS_COMMIT_LUA, type SyncRedis } from "@/sync/redisProtocol"
import type { SyncedTemplates } from "@/sync/snapshot"
import { SyncEngine, type SyncEnvironment, type SyncStoreAdapter } from "@/sync/syncEngine"

// ---------------------------------------------------------------------------
// FakeStorage
// ---------------------------------------------------------------------------

export class FakeStorage implements KeyValueStorage {
  map = new Map<string, string>()
  quotaBytes = Number.POSITIVE_INFINITY

  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string) {
    let total = value.length
    for (const [k, v] of this.map) if (k !== key) total += v.length
    if (total > this.quotaBytes) throw new DOMException("QuotaExceededError", "QuotaExceededError")
    this.map.set(key, value)
  }

  removeItem(key: string) {
    this.map.delete(key)
  }
}

// ---------------------------------------------------------------------------
// FakeRedis — chạy đúng logic của CAS_COMMIT_LUA bằng JS
// ---------------------------------------------------------------------------

type FailureKind = "network" | "auth" | "commit-then-lose-response"

export class FakeRedis implements SyncRedis {
  store = new Map<string, string>()
  zsets = new Map<string, Map<string, number>>()
  sets = new Map<string, Set<string>>()
  evalCalls = 0
  commits = 0
  private failures: Array<{ kind: FailureKind; remaining: number }> = []
  private holds = new Map<string, Promise<void>>()

  failNext(kind: FailureKind, count = 1) {
    this.failures.push({ kind, remaining: count })
  }

  /** Giữ lệnh EVAL của một thiết bị lại cho tới khi gọi release — để ép ra xung đột CAS thật. */
  holdEvalFor(deviceId: string) {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = () => {
        this.holds.delete(deviceId)
        resolve()
      }
    })
    this.holds.set(deviceId, promise)
    return release
  }

  private maybeFail(context: "read" | "write") {
    const active = this.failures.find((f) => f.remaining > 0)
    if (!active) return null
    if (active.kind === "commit-then-lose-response" && context === "read") return null
    active.remaining -= 1
    if (active.kind === "network") throw new Error("TypeError: Failed to fetch")
    if (active.kind === "auth") throw new Error("Unauthorized: invalid token")
    return active.kind
  }

  flushAll() {
    this.store.clear()
    this.zsets.clear()
    this.sets.clear()
  }

  async ping() {
    this.maybeFail("read")
    return "PONG"
  }

  async get(key: string) {
    this.maybeFail("read")
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  async set(key: string, value: string, opts?: { nx?: boolean }) {
    this.maybeFail("write")
    if (opts?.nx && this.store.has(key)) return null
    this.store.set(key, value)
    return "OK"
  }

  async mget(...keys: string[]) {
    this.maybeFail("read")
    return keys.map((key) => (this.store.has(key) ? (this.store.get(key) as string) : null))
  }

  async zrange(key: string, _min: number | string, _max: number | string, opts?: { withScores?: boolean }) {
    this.maybeFail("read")
    const entries = this.sortedEntries(key)
    if (opts?.withScores) return entries.flatMap(([member, score]) => [member, String(score)])
    return entries.map(([member]) => member)
  }

  async sadd(key: string, ...members: string[]) {
    this.maybeFail("write")
    const set = this.sets.get(key) ?? new Set<string>()
    for (const member of members) set.add(member)
    this.sets.set(key, set)
    return members.length
  }

  async srem(key: string, ...members: string[]) {
    this.maybeFail("write")
    const set = this.sets.get(key)
    if (!set) return 0
    for (const member of members) set.delete(member)
    return members.length
  }

  async smembers(key: string) {
    this.maybeFail("read")
    return [...(this.sets.get(key) ?? [])]
  }

  async time() {
    this.maybeFail("read")
    const ms = Date.now()
    return [String(Math.floor(ms / 1000)), String((ms % 1000) * 1000)]
  }

  private sortedEntries(key: string): Array<[string, number]> {
    const zset = this.zsets.get(key) ?? new Map<string, number>()
    return [...zset.entries()].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1))
  }

  async eval(script: string, keys: string[], args: (string | number)[]) {
    if (script !== CAS_COMMIT_LUA) throw new Error(`FakeRedis: unknown script`)
    try {
      const head = JSON.parse(String(args[2])) as { deviceId?: string }
      const hold = head.deviceId ? this.holds.get(head.deviceId) : undefined
      if (hold) await hold
    } catch {
      // head không phải JSON → bỏ qua hold
    }
    const failure = this.maybeFail("write")
    this.evalCalls += 1
    const result = this.runCas(keys, args.map(String))
    if (failure === "commit-then-lose-response") throw new Error("TypeError: Failed to fetch")
    return result
  }

  private runCas(keys: string[], args: string[]) {
    const [versionKey, headKey, historyKey, pinsKey, genesisKey] = keys
    const [expectedRaw, payload, headJson, nowRaw, snapPrefix, keepRecentRaw, keepDaysRaw, genesisCandidate, maxBytesRaw] = args
    const cur = Number.parseInt(this.store.get(versionKey) ?? "0", 10)
    if (cur !== Number.parseInt(expectedRaw, 10)) {
      return [0, cur, this.store.get(headKey) ?? "", this.store.get(genesisKey) ?? ""]
    }
    if (payload.length > Number.parseInt(maxBytesRaw, 10)) return [-1, cur, "too-large", ""]
    const nv = cur + 1
    let now = Number.parseInt(nowRaw, 10)
    const history = this.zsets.get(historyKey) ?? new Map<string, number>()
    this.zsets.set(historyKey, history)
    const last = this.sortedEntries(historyKey).at(-1)
    if (last && last[1] >= now) now = last[1] + 1
    if (cur === 0 && !this.store.has(genesisKey)) this.store.set(genesisKey, genesisCandidate)
    this.store.set(`${snapPrefix}${nv}`, payload)
    history.set(String(nv), now)
    this.store.set(headKey, headJson)
    this.store.set(versionKey, String(nv))
    this.commits += 1

    const keepRecent = Number.parseInt(keepRecentRaw, 10)
    const keepDays = Number.parseInt(keepDaysRaw, 10)
    const pinned = this.sets.get(pinsKey) ?? new Set<string>()
    const all = this.sortedEntries(historyKey)
    const n = all.length
    const seenDay = new Set<number>()
    let removed = 0
    for (let i = n; i >= 1; i -= 1) {
      const [ver, score] = all[i - 1]
      const day = Math.floor(score / 86_400_000)
      const keep = pinned.has(ver) || n - i < keepRecent || (now - score <= keepDays * 86_400_000 && !seenDay.has(day))
      seenDay.add(day)
      if (!keep) {
        history.delete(ver)
        this.store.delete(`${snapPrefix}${ver}`)
        removed += 1
      }
    }
    return [1, nv, this.store.get(genesisKey) ?? "", removed]
  }

  version() {
    return Number.parseInt(this.store.get("mf3:version") ?? "0", 10)
  }
}

// ---------------------------------------------------------------------------
// FakeStore — mô phỏng zustand store của một thiết bị
// ---------------------------------------------------------------------------

export class FakeStore implements SyncStoreAdapter {
  data: CttmState
  templates: SyncedTemplates = { items: [], tombstones: {} }
  workspace: "real" | "demo" = "real"
  autoCloseImpl: ((state: CttmState) => CttmState) | null = null
  private dataListeners = new Set<(data: CttmState) => void>()
  private persistedListeners = new Set<(data: CttmState) => void>()

  constructor(
    private readonly storage: KeyValueStorage,
    initial: CttmState,
  ) {
    this.data = initial
    this.storage.setItem("cttm_v1", JSON.stringify(initial))
  }

  getData() {
    return this.data
  }

  getWorkspace() {
    return this.workspace
  }

  replaceRealData(next: CttmState) {
    if (this.workspace === "real") {
      this.data = next
      for (const listener of this.dataListeners) listener(next)
    } else {
      this.storage.setItem("cttm_v1", JSON.stringify(next))
    }
  }

  flushPendingSave() {
    // Giống saveCttmState thật: đánh dấu writeSeq trước khi ghi.
    const seq = Number.parseInt(this.storage.getItem("mf3.writeSeq") ?? "0", 10) + 1
    this.storage.setItem("mf3.writeSeq", String(seq))
    this.storage.setItem("cttm_v1", JSON.stringify(this.data))
    for (const listener of this.persistedListeners) listener(this.data)
  }

  /** Mô phỏng một tab build MỚI khác ghi đĩa (có bump writeSeq). Trả về newValue để fire storage event. */
  writeAsNewBuildTab(state: CttmState) {
    const seq = Number.parseInt(this.storage.getItem("mf3.writeSeq") ?? "0", 10) + 1
    this.storage.setItem("mf3.writeSeq", String(seq))
    const raw = JSON.stringify(state)
    this.storage.setItem("cttm_v1", raw)
    return raw
  }

  subscribeData(listener: (data: CttmState) => void) {
    this.dataListeners.add(listener)
    return () => {
      this.dataListeners.delete(listener)
    }
  }

  subscribePersisted(listener: (data: CttmState) => void) {
    this.persistedListeners.add(listener)
    return () => {
      this.persistedListeners.delete(listener)
    }
  }

  loadRealFromDisk() {
    return normalizeCttmStateFromRaw(this.storage.getItem("cttm_v1"))
  }

  getTemplates() {
    return this.templates
  }

  replaceTemplates(templates: SyncedTemplates) {
    this.templates = templates
  }

  runAutoClose() {
    if (!this.autoCloseImpl) return
    const next = this.autoCloseImpl(this.data)
    if (next !== this.data) this.mutate(() => next)
  }

  /** Mô phỏng một thao tác của người dùng (set() trong zustand). */
  mutate(fn: (state: CttmState) => CttmState) {
    this.data = fn(this.data)
    for (const listener of this.dataListeners) listener(this.data)
  }
}

// ---------------------------------------------------------------------------
// Device = storage + store + engine + env
// ---------------------------------------------------------------------------

export type Device = {
  name: string
  storage: FakeStorage
  store: FakeStore
  engine: SyncEngine
  env: SyncEnvironment
  fire: (type: "visible" | "focus" | "online" | "storage" | "templates", detail?: unknown) => void
  online: { value: boolean }
  visible: { value: boolean }
}

export const TEST_CONFIG: DataSourceConfig = {
  mode: "upstash",
  upstash: { url: "https://example.upstash.io", token: "token" },
  updatedAt: 0,
}

export function createDevice(
  name: string,
  redis: FakeRedis,
  initial: CttmState,
  options: { config?: DataSourceConfig; label?: string } = {},
): Device {
  const storage = new FakeStorage()
  const store = new FakeStore(storage, initial)
  const handlers = new Map<string, Set<(detail?: unknown) => void>>()
  const online = { value: true }
  const visible = { value: true }
  const config = options.config ?? TEST_CONFIG
  const env: SyncEnvironment = {
    storage,
    getConfig: () => config,
    createRedis: async () => redis,
    now: () => Date.now(),
    isOnline: () => online.value,
    isVisible: () => visible.value,
    addListener: (type, handler) => {
      const set = handlers.get(type) ?? new Set()
      set.add(handler)
      handlers.set(type, set)
      return () => {
        set.delete(handler)
      }
    },
    appBuild: "test",
    maxRequestBytes: 900 * 1024,
    pollIntervalMs: 45_000,
    bootTimeoutMs: 12_000,
    requestTimeoutMs: 20_000,
  }
  const engine = new SyncEngine(store, env)
  if (options.label) {
    const meta = JSON.parse(storage.getItem("mf3.meta") ?? "{}")
    storage.setItem("mf3.meta", JSON.stringify({ ...meta, deviceLabel: options.label }))
  }
  return {
    name,
    storage,
    store,
    engine,
    env,
    online,
    visible,
    fire: (type, detail) => {
      for (const handler of handlers.get(type) ?? []) handler(detail)
    },
  }
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

/** Trạng thái "máy mới cài": mọi thứ mặc định — engine coi là trống. */
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

export async function settle(ms = 0) {
  const { vi } = await import("vitest")
  await vi.advanceTimersByTimeAsync(ms)
}
