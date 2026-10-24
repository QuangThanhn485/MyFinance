import { IDBFactory } from "fake-indexeddb"
import { vi } from "vitest"
import { LedgerEngine, type LedgerBroadcast, type LedgerEnvironment, type LedgerStoreAdapter } from "@/ledger/engine"
import { IndexedDbJournal } from "@/ledger/journal"
import type { KeyValueStorage } from "@/ledger/legacy"
import { APPEND_LUA, FREEZE_V3_LUA, HEAD_LUA, LEDGER_KEYS } from "@/ledger/remote"
import type { AppDoc } from "@/ledger/records"
import type { DataSourceConfig } from "@/storage/dataSource"
import { createInitialState, type CttmState } from "@/storage/schema"
import type { ExpenseTemplate } from "@/storage/templates"
import type { SyncRedis } from "@/sync/redisProtocol"
import { encodeSnapshot, hashDoc, stripForSync, type HeadV3, type SnapshotV3, type SyncDoc } from "@/sync/snapshot"

// ---------------------------------------------------------------------------
// FakeStorage (localStorage của bản cũ)
// ---------------------------------------------------------------------------

export class FakeStorage implements KeyValueStorage {
  map = new Map<string, string>()
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

// ---------------------------------------------------------------------------
// FakeRedis — chạy đúng logic của các script Lua bằng JS
// ---------------------------------------------------------------------------

type FailureKind = "network" | "lose-response"

export class FakeRedis implements SyncRedis {
  strings = new Map<string, string>()
  lists = new Map<string, string[]>()
  hashes = new Map<string, Map<string, string>>()
  appendCalls = 0
  /** Số lần LRANGE kế tiếp chỉ trả về một nửa (giả lập replica đọc trễ). */
  truncateLrange = 0
  private failures: Array<{ kind: FailureKind; remaining: number }> = []

  /** Lỗi mạng cho n lệnh kế tiếp; "lose-response": lệnh ghi CÓ chạy trên server nhưng client nhận lỗi. */
  failNext(kind: FailureKind, count = 1) {
    this.failures.push({ kind, remaining: count })
  }

  clearFailures() {
    this.failures = []
  }

  private failure(isAppend: boolean): FailureKind | null {
    const active = this.failures.find((f) => f.remaining > 0)
    if (!active) return null
    if (active.kind === "lose-response" && !isAppend) return null
    active.remaining -= 1
    if (active.kind === "network") throw new Error("TypeError: Failed to fetch")
    return active.kind
  }

  flushAll() {
    this.strings.clear()
    this.lists.clear()
    this.hashes.clear()
  }

  log(): Array<Record<string, unknown>> {
    return (this.lists.get(LEDGER_KEYS.log) ?? []).map((raw) => JSON.parse(raw))
  }

  async ping() {
    this.failure(false)
    return "PONG"
  }
  async get(key: string) {
    this.failure(false)
    return this.strings.get(key) ?? null
  }
  async set(key: string, value: string, opts?: { nx?: boolean }) {
    this.failure(false)
    if (opts?.nx && this.strings.has(key)) return null
    this.strings.set(key, value)
    return "OK"
  }
  async mget(...keys: string[]) {
    this.failure(false)
    return keys.map((key) => this.strings.get(key) ?? null)
  }
  async lrange(key: string, start: number, stop: number) {
    this.failure(false)
    const items = (this.lists.get(key) ?? []).slice(start, stop + 1)
    if (this.truncateLrange > 0) {
      this.truncateLrange -= 1
      return items.slice(0, Math.floor(items.length / 2))
    }
    return items
  }
  async time() {
    this.failure(false)
    const ms = Date.now()
    return [String(Math.floor(ms / 1000)), String((ms % 1000) * 1000)]
  }

  async eval(script: string, keys: string[], args: (string | number)[]) {
    const argv = args.map(String)
    if (script === HEAD_LUA) {
      this.failure(false)
      const [log, genesis, migration, dev] = keys
      return [(this.lists.get(log) ?? []).length, this.strings.get(genesis) ?? "", this.strings.get(migration) ?? "", this.hashes.get(dev)?.get(argv[0]) ?? "0"]
    }
    if (script === FREEZE_V3_LUA) {
      this.failure(false)
      const [versionKey, finalKey] = keys
      const existing = this.strings.get(finalKey)
      if (existing !== undefined) return existing
      const v = this.strings.get(versionKey)
      if (v === undefined) {
        this.strings.set(finalKey, "0")
        return "0"
      }
      if (!/^-?\d+$/.test(v)) return v
      this.strings.set(versionKey, `frozen-v4:${v}`)
      this.strings.set(finalKey, v)
      return v
    }
    if (script === APPEND_LUA) {
      const failure = this.failure(true)
      this.appendCalls += 1
      const result = this.runAppend(keys, argv)
      if (failure === "lose-response") throw new Error("TypeError: Failed to fetch")
      return result
    }
    throw new Error("FakeRedis: unknown script")
  }

  private runAppend(keys: string[], argv: string[]) {
    const [logKey, devKey, genesisKey] = keys
    const ops = argv.slice(5)
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i]
      if (op[0] !== "{" || op[1] === "}" || op.length > 65536) return [-3, i + 1]
    }
    const log = this.lists.get(logKey) ?? []
    let genesis = this.strings.get(genesisKey)
    if (genesis === undefined) {
      if (argv[4] === "" || argv[4] !== argv[3] || log.length !== 0) return [-2, ""]
      genesis = argv[4]
      this.strings.set(genesisKey, genesis)
    } else if (genesis !== argv[3]) {
      return [-2, genesis]
    }
    const devs = this.hashes.get(devKey) ?? new Map<string, string>()
    this.hashes.set(devKey, devs)
    let last = Number.parseInt(devs.get(argv[0]) ?? "0", 10)
    if (Number.parseInt(argv[1], 10) !== last + 1) return [-1, last]
    let seq = log.length
    for (const op of ops) {
      seq += 1
      log.push(`{"seq":${seq},"sat":${argv[2]},${op.slice(1)}`)
    }
    this.lists.set(logKey, log)
    last += ops.length
    devs.set(argv[0], String(last))
    return [1, last, seq, genesis]
  }

  /** Ghi thẳng một op thô vào sổ cái (giả lập build mới hơn/đối tượng lạ). */
  pushRaw(op: Record<string, unknown>) {
    const log = this.lists.get(LEDGER_KEYS.log) ?? []
    log.push(JSON.stringify({ seq: log.length + 1, sat: Date.now(), ...op }))
    this.lists.set(LEDGER_KEYS.log, log)
  }
}

// ---------------------------------------------------------------------------
// Dữ liệu Sync v3 (để kiểm thử chuyển đổi)
// ---------------------------------------------------------------------------

export async function seedV3Remote(redis: FakeRedis, input: { version: number; genesis: string; doc: SyncDoc }) {
  const data = { cttm: stripForSync(input.doc.cttm) as unknown as CttmState, templates: input.doc.templates }
  const contentHash = hashDoc({ cttm: data.cttm, templates: data.templates })
  const snapshot: SnapshotV3 = { schema: 3, version: input.version, contentHash, committedAt: Date.now(), deviceId: "dev_v3", data }
  const encoded = await encodeSnapshot(snapshot)
  const head: HeadV3 = {
    schema: 3,
    version: input.version,
    contentHash,
    genesisId: input.genesis,
    deviceId: "dev_v3",
    deviceLabel: "v3",
    committedAt: snapshot.committedAt,
    bytes: encoded.bytes,
    enc: encoded.enc,
    appBuild: "v3",
  }
  redis.strings.set("mf3:version", String(input.version))
  redis.strings.set("mf3:head", JSON.stringify(head))
  redis.strings.set(`mf3:snap:${input.version}`, encoded.payload)
  redis.strings.set("mf3:genesis", input.genesis)
}

/** localStorage của một máy đã chạy Sync v3. */
export function seedV3Local(storage: FakeStorage, input: { local: CttmState; base?: SyncDoc | null; baseVersion?: number; genesis?: string; templates?: ExpenseTemplate[] }) {
  storage.setItem("cttm_v1", JSON.stringify(input.local))
  if (input.templates) storage.setItem("smartSpend.templates.v1", JSON.stringify(input.templates))
  if (input.base) storage.setItem("mf3.base", JSON.stringify(input.base))
  storage.setItem(
    "mf3.meta",
    JSON.stringify({ deviceId: "dev_old", deviceLabel: "Máy cũ", baseVersion: input.baseVersion ?? 0, dirty: true, genesisId: input.genesis }),
  )
}

// ---------------------------------------------------------------------------
// FakeStore — đóng vai zustand store của một tab
// ---------------------------------------------------------------------------

export class FakeStore implements LedgerStoreAdapter {
  doc: AppDoc = { cttm: createInitialState("2026-01-01T00:00:00.000Z"), templates: [] }
  workspace: "real" | "demo" = "real"
  engine: LedgerEngine | null = null
  autoClose: ((state: CttmState) => CttmState) | null = null

  getWorkspace() {
    return this.workspace
  }
  getDoc() {
    return this.doc
  }
  hydrate(doc: AppDoc) {
    this.doc = doc
  }
  runAutoClose() {
    if (this.autoClose) this.act(this.autoClose, { derived: true })
  }
  /** Một thao tác người dùng (set() trong zustand). */
  act(fn: (state: CttmState) => CttmState, options: { derived?: boolean } = {}) {
    const before = this.doc
    const cttm = fn(before.cttm)
    if (cttm === before.cttm) return
    this.doc = { cttm, templates: before.templates }
    this.engine?.recordLocalChange(before, this.doc, options)
  }
  actTemplates(fn: (templates: ExpenseTemplate[]) => ExpenseTemplate[]) {
    const before = this.doc
    this.doc = { cttm: before.cttm, templates: fn(before.templates) }
    this.engine?.recordLocalChange(before, this.doc)
  }
}

// ---------------------------------------------------------------------------
// Trình duyệt (chung IndexedDB + localStorage + BroadcastChannel) và tab
// ---------------------------------------------------------------------------

class BroadcastHub {
  private members = new Set<{ handler: (message: LedgerBroadcast) => void; tab: Tab }>()
  join(tab: Tab): NonNullable<LedgerEnvironment["broadcast"]> {
    return {
      post: (message) => {
        for (const member of this.members) {
          if (member.tab === tab || member.tab.muted) continue
          queueMicrotask(() => member.handler(message))
        }
      },
      subscribe: (handler) => {
        const entry = { handler, tab }
        this.members.add(entry)
        return () => this.members.delete(entry)
      },
    }
  }
}

export type Browser = {
  name: string
  factory: IDBFactory
  storage: FakeStorage
  hub: BroadcastHub
  config: DataSourceConfig
}

export type Tab = {
  browser: Browser
  store: FakeStore
  engine: LedgerEngine
  /** Tab đang nằm trong bfcache / bị đóng băng: không nhận BroadcastChannel. */
  muted: boolean
  fire: (type: "visible" | "focus" | "online" | "pageshow" | "storage", detail?: unknown) => void
}

export const UPSTASH_CONFIG: DataSourceConfig = {
  mode: "upstash",
  upstash: { url: "https://example.upstash.io", token: "token" },
  updatedAt: 0,
}

export function createBrowser(name: string, options: { config?: DataSourceConfig; storage?: FakeStorage } = {}): Browser {
  return {
    name,
    factory: new IDBFactory(),
    storage: options.storage ?? new FakeStorage(),
    hub: new BroadcastHub(),
    config: options.config ?? { ...UPSTASH_CONFIG },
  }
}

export async function openTab(browser: Browser, redis: FakeRedis, options: { start?: boolean } = {}): Promise<Tab> {
  const store = new FakeStore()
  const handlers = new Map<string, Set<(detail?: unknown) => void>>()
  const tab = { browser, store, muted: false } as Tab
  const env: LedgerEnvironment = {
    journal: new IndexedDbJournal(browser.factory),
    legacyStorage: browser.storage,
    getConfig: () => browser.config,
    createRedis: async () => redis,
    now: () => Date.now(),
    isOnline: () => true,
    isVisible: () => !tab.muted,
    addListener: (type, handler) => {
      const set = handlers.get(type) ?? new Set()
      set.add(handler)
      handlers.set(type, set)
      return () => {
        set.delete(handler)
      }
    },
    broadcast: browser.hub.join(tab),
    defaultDeviceLabel: browser.name,
    maxRequestBytes: 900 * 1024,
    pollIntervalMs: 45_000,
    requestTimeoutMs: 20_000,
    pushDelayMs: 800,
    derivedWritesTimeoutMs: 12_000,
  }
  const engine = new LedgerEngine(store, env)
  store.engine = engine
  tab.engine = engine
  tab.fire = (type, detail) => {
    for (const handler of handlers.get(type) ?? []) handler(detail)
  }
  await engine.boot()
  if (options.start !== false) {
    engine.start()
    await settle(tab)
  }
  return tab
}

export async function settle(...tabs: Tab[]) {
  for (let round = 0; round < 3; round += 1) {
    for (const tab of tabs) await tab.engine.whenIdle()
    await vi.advanceTimersByTimeAsync(0)
  }
}

export async function sync(...tabs: Tab[]) {
  for (const tab of tabs) {
    await tab.engine.whenIdle()
    await tab.engine.syncNow()
    await tab.engine.whenIdle()
  }
}

export function ids(tab: Tab, kind: keyof CttmState["entities"] = "expenses") {
  return Object.keys(tab.store.doc.cttm.entities[kind].byId).sort()
}

export function useLedgerTimers() {
  // fake-indexeddb cần setImmediate thật; chỉ giả lập đồng hồ và hẹn giờ của engine.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
}
