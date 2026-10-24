import { nanoid } from "nanoid"
import { makeOp, type Journal, type JoinInfo, type JournalMeta, type JournalSnapshot } from "@/ledger/journal"
import {
  deletedToTombstones,
  draftsToReach,
  fromSyncDoc,
  legacyBridgeDrafts,
  legacyFingerprint,
  mergeLocalIntoRemote,
  readLegacyLocal,
  readV2,
  readV3Final,
  readLegacyConsumed,
  readV3Genesis,
  tombstoneDrafts,
  toSyncDoc,
  writeLegacyConsumed,
  type KeyValueStorage,
} from "@/ledger/legacy"
import { createInitialState } from "@/storage/schema"
import {
  applyOpInPlace,
  cloneLedgerState,
  diffRecordMaps,
  foldOps,
  OP_SCHEMA_VERSION,
  type FoldEffect,
  type LedgerOp,
  type OpDraft,
  type ServerOp,
} from "@/ledger/ops"
import {
  appendOps,
  estimateAppendBytes,
  freezeV3,
  markMigrationDone,
  readLedgerHead,
  readOps,
  tryAcquireMigration,
  type LedgerHead,
} from "@/ledger/remote"
import {
  cttmToRecords,
  docToRecords,
  emptyLedgerState,
  recordsToDoc,
  templatesToRecords,
  type AppDoc,
  type LedgerState,
  type RecordMap,
} from "@/ledger/records"
import type { DataSourceConfig, UpstashConfig } from "@/storage/dataSource"
import { getClockSkewMs, monotonicIso, setClockSkewMs } from "@/sync/clock"
import { classifySyncError, readServerTimeMs, type SyncRedis } from "@/sync/redisProtocol"

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export interface LedgerStoreAdapter {
  getWorkspace(): "real" | "demo"
  /** Dữ liệu store hiện tại (cttm là dữ liệu thật khi workspace = real) + mẫu chi tiêu. */
  getDoc(): AppDoc
  /** Thay dữ liệu store bằng phép chiếu của sổ cái — KHÔNG được ghi lại thành op. */
  hydrate(doc: AppDoc): void
  runAutoClose(): void
}

export type LedgerBroadcast = { type: "changed"; from: string }

export interface LedgerEnvironment {
  journal: Journal
  legacyStorage: KeyValueStorage
  getConfig(): DataSourceConfig
  createRedis(config: UpstashConfig): Promise<SyncRedis>
  now(): number
  isOnline(): boolean
  isVisible(): boolean
  addListener(type: "visible" | "focus" | "online" | "pageshow" | "storage", handler: (detail?: unknown) => void): () => void
  broadcast?: { post(message: LedgerBroadcast): void; subscribe(handler: (message: LedgerBroadcast) => void): () => void }
  /** Khoá giữa các tab (Web Locks). Thiếu thì engine dùng khoá trong tab — giao thức vẫn an toàn nhờ server. */
  withLock?<T>(name: string, fn: () => Promise<T>): Promise<T>
  defaultDeviceLabel: string
  maxRequestBytes: number
  pollIntervalMs: number
  requestTimeoutMs: number
  pushDelayMs: number
  derivedWritesTimeoutMs: number
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type LedgerPhase =
  | "booting"
  | "local-only"
  | "idle"
  | "syncing"
  | "migrating"
  | "offline"
  | "error"
  | "auth-error"
  | "unsupported"
  | "needs-update"
  | "attention"
  | "paused"

export type LedgerDialogKind = "remote-empty" | "remote-different"
export type LedgerDialogChoice = "reseed" | "merge-local" | "pause"

export type LedgerDialog = { id: number; kind: LedgerDialogKind; remoteLength: number }

export type LedgerNotice = { id: number; kind: "edit-on-deleted"; count: number }

export type LedgerSyncState = {
  mode: DataSourceConfig["mode"]
  phase: LedgerPhase
  /** Số op của máy này chưa được server xác nhận. */
  pending: number
  /** seq cuối của sổ cái đã có trên máy. */
  cursor: number
  remoteLength: number
  joined: boolean
  lastSyncAt?: number
  lastError?: string
  deviceId: string
  deviceLabel: string
  journalKind: Journal["kind"]
  storageError?: string
  dialog: LedgerDialog | null
  notice: LedgerNotice | null
  inFlight: boolean
  derivedWritesAllowed: boolean
}

export type HistoryOp = {
  tx: string
  seq?: number
  cseq: number
  dev: string
  dl?: string
  at: string
  t: LedgerOp["t"]
  key: string
  v?: LedgerOp["v"]
  u?: string[]
  pending: boolean
}

export type HistoryGroup = {
  tx: string
  dev: string
  deviceLabel?: string
  at: string
  pending: boolean
  mine: boolean
  firstSeq?: number
  lastSeq?: number
  ops: HistoryOp[]
}

class ForkDetected extends Error {}
class NeedsAttention extends Error {}

const SYNC_LOCK = "mf4-sync"
const STALE_MIGRATION_MS = 10 * 60_000
const EVENT_THROTTLE_MS = 4000
const MAX_BATCH_OPS = 400

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function emptyJoinInfo(): JoinInfo {
  return { v3Base: null, v3BaseVersion: 0, legacyTombstones: {}, legacyTemplateTombstones: {} }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LedgerEngine {
  private readonly store: LedgerStoreAdapter
  private readonly env: LedgerEnvironment
  private readonly tabId = nanoid(8)
  private listeners = new Set<(state: LedgerSyncState) => void>()
  private state: LedgerSyncState

  private meta!: JournalMeta
  private confirmed: LedgerState = emptyLedgerState()
  /** Op đã nằm trong IndexedDB, chưa được server xác nhận (theo cseq). */
  private outbox: LedgerOp[] = []
  /** Op của tab này đã áp lên giao diện nhưng chưa ghi xong xuống IndexedDB. */
  private unpersisted: Array<{ drafts: OpDraft[]; tx: string; at: string }> = []
  /** confirmed + outbox + unpersisted: thứ người dùng đang thấy. */
  private optimistic: LedgerState = emptyLedgerState()
  private persistChain: Promise<void> = Promise.resolve()
  private localSeq = 0
  private reportedOpIds = new Set<string>()

  private booted = false
  private stopped = true
  private queue: Promise<unknown> = Promise.resolve()
  private disposers: Array<() => void> = []
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private derivedTimer: ReturnType<typeof setTimeout> | null = null
  private redisPromise: Promise<SyncRedis> | null = null
  private redisKey = ""
  private lastWakeAt = 0
  private lastAutoCloseMonth = ""
  private dialogSeq = 0
  private noticeSeq = 0
  private skewMeasured = false
  private fullLogCache: ServerOp[] = []

  constructor(store: LedgerStoreAdapter, env: LedgerEnvironment) {
    this.store = store
    this.env = env
    this.state = {
      mode: env.getConfig().mode,
      phase: "booting",
      pending: 0,
      cursor: 0,
      remoteLength: 0,
      joined: false,
      deviceId: "",
      deviceLabel: env.defaultDeviceLabel,
      journalKind: env.journal.kind,
      dialog: null,
      notice: null,
      inFlight: false,
      derivedWritesAllowed: false,
    }
  }

  // ----- state plumbing ----------------------------------------------------

  getState() {
    return this.state
  }

  subscribe(listener: (state: LedgerSyncState) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<LedgerSyncState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private refreshCounters() {
    const pending = this.outbox.filter((op) => op.cseq > this.meta.ackedCseq).length + this.unpersisted.reduce((n, e) => n + e.drafts.length, 0)
    this.setState({
      pending,
      cursor: this.meta.cursor,
      joined: Boolean(this.meta.genesisId) && !this.meta.join,
      deviceId: this.meta.deviceId,
      deviceLabel: this.meta.deviceLabel,
    })
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Chờ mọi thao tác đang xếp hàng (ghi đĩa, đồng bộ) xong. */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await this.persistChain
      await this.queue
      if (this.unpersisted.length === 0) return
    }
  }

  // ----- boot --------------------------------------------------------------

  /** Mở nhật ký cục bộ, nhập dữ liệu bản cũ nếu là lần đầu, đổ dữ liệu vào store. Không gọi mạng. */
  async boot(): Promise<void> {
    if (this.booted) return
    let snapshot = await this.env.journal.load()
    if (!snapshot) snapshot = await this.env.journal.initialize(this.buildFirstSnapshot())
    this.applySnapshot(snapshot)
    this.hydrateStore(true)
    this.booted = true
    await this.bridgeLegacyIfChanged()
  }

  private buildFirstSnapshot(): JournalSnapshot {
    const legacy = readLegacyLocal(this.env.legacyStorage)
    // Dữ liệu bản cũ của trình duyệt này đã từng được gộp vào sổ cái (IndexedDB vừa bị xoá/dọn):
    // KHÔNG nhập lại bản cũ đã lỗi thời — bắt đầu như máy mới và nhận dữ liệu từ sổ cái.
    const consumed = readLegacyConsumed(this.env.legacyStorage)
    const at = monotonicIso()
    const meta: JournalMeta = {
      schema: 1,
      deviceId: `d_${nanoid(10)}`,
      deviceLabel: legacy.v3.deviceLabel || this.env.defaultDeviceLabel,
      nextCseq: 1,
      ackedCseq: 0,
      cursor: 0,
      join: consumed
        ? emptyJoinInfo()
        : {
            v3Base: legacy.v3.baseTrusted ? legacy.v3.base : null,
            v3BaseVersion: legacy.v3.baseVersion,
            v3Genesis: legacy.v3.genesisId,
            legacyTombstones: legacy.tombstones,
            legacyTemplateTombstones: legacy.templateTombstones,
          },
      legacyHash: legacy.fingerprint,
      legacyImportedAt: at,
      createdAt: this.env.now(),
    }
    const source = consumed ? { cttm: createInitialState(at), templates: [] } : { cttm: legacy.cttm, templates: legacy.templates }
    const records = docToRecords(source)
    const outbox = Object.keys(records).map((key, index) => makeOp({ t: "put", key, v: records[key] }, meta, index + 1, "import-local", at))
    meta.nextCseq = outbox.length + 1
    return { meta, confirmed: emptyLedgerState(), outbox }
  }

  private applySnapshot(snapshot: JournalSnapshot) {
    this.meta = snapshot.meta
    this.confirmed = snapshot.confirmed
    this.outbox = snapshot.outbox.filter((op) => op.cseq > snapshot.meta.ackedCseq)
    this.rebuildOptimistic()
    this.refreshCounters()
  }

  private rebuildOptimistic() {
    const editsOnDeleted: string[] = []
    const onEffect = (op: { key: string } & Partial<LedgerOp>, effect: FoldEffect) => {
      if (effect === "patch-deleted" && op.id && !this.reportedOpIds.has(op.id)) {
        this.reportedOpIds.add(op.id)
        editsOnDeleted.push(op.key)
      }
    }
    let next = foldOps(this.confirmed, this.outbox, onEffect)
    for (const entry of this.unpersisted) {
      next = foldOps(next, entry.drafts.map((draft) => ({ ...draft, at: entry.at })))
    }
    this.optimistic = next
    if (editsOnDeleted.length > 0) {
      this.noticeSeq += 1
      this.setState({ notice: { id: this.noticeSeq, kind: "edit-on-deleted", count: editsOnDeleted.length } })
    }
  }

  /** Dữ liệu thật hiện tại theo sổ cái (để store chuyển từ workspace demo về real). */
  getRealDoc(): AppDoc {
    return recordsToDoc(this.optimistic.records)
  }

  /** Bản ghi thô của trạng thái đang hiển thị — dùng cho kiểm thử và chẩn đoán. */
  getRecords(): RecordMap {
    return this.optimistic.records
  }

  private hydrateStore(force = false) {
    const projection = recordsToDoc(this.optimistic.records)
    if (!force) {
      const current = this.store.getDoc()
      const currentRecords =
        this.store.getWorkspace() === "real" ? docToRecords(current) : templatesToRecords(current.templates)
      const nextRecords = this.store.getWorkspace() === "real" ? docToRecords(projection) : templatesToRecords(projection.templates)
      if (diffRecordMaps(currentRecords, nextRecords).length === 0) return
    }
    this.store.hydrate(projection)
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    if (!this.booted) throw new Error("LedgerEngine.start() trước boot()")
    this.stop()
    this.stopped = false
    const config = this.env.getConfig()
    this.setState({ mode: config.mode, dialog: null, lastError: undefined })
    this.disposers.push(this.env.addListener("storage", (detail) => this.onStorageEvent(detail)))
    this.disposers.push(this.env.addListener("pageshow", () => this.onWake()))
    this.disposers.push(this.env.addListener("visible", () => this.onWake()))
    this.disposers.push(this.env.addListener("focus", () => this.onWake()))
    this.disposers.push(this.env.addListener("online", () => this.onWake(true)))
    if (this.env.broadcast) {
      this.disposers.push(
        this.env.broadcast.subscribe((message) => {
          if (message.from !== this.tabId) void this.reloadFromJournal()
        }),
      )
    }

    if (config.mode !== "upstash" || !config.upstash) {
      this.setState({ phase: "local-only" })
      this.allowDerivedWrites()
      return
    }
    this.setState({ phase: "booting" })
    this.pollTimer = setInterval(() => void this.pollTick(), this.env.pollIntervalMs)
    this.derivedTimer = setTimeout(() => this.allowDerivedWrites(), this.env.derivedWritesTimeoutMs)
    void this.sync("boot")
  }

  stop() {
    this.stopped = true
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    for (const timer of [this.pushTimer, this.retryTimer, this.derivedTimer]) if (timer) clearTimeout(timer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pushTimer = null
    this.retryTimer = null
    this.derivedTimer = null
    this.pollTimer = null
  }

  restart() {
    this.redisPromise = null
    this.redisKey = ""
    if (this.state.phase === "paused") this.setState({ phase: "booting" })
    this.start()
  }

  private allowDerivedWrites() {
    if (this.derivedTimer) {
      clearTimeout(this.derivedTimer)
      this.derivedTimer = null
    }
    if (this.state.derivedWritesAllowed) return
    this.setState({ derivedWritesAllowed: true })
    this.store.runAutoClose()
  }

  /** AppLayout gọi định kỳ; chỉ chạy khi đã có dữ liệu mới nhất (hoặc chế độ local) và một lần mỗi tháng. */
  requestAutoClose(currentMonth: string) {
    if (!this.state.derivedWritesAllowed) return
    if (this.lastAutoCloseMonth === currentMonth) return
    this.lastAutoCloseMonth = currentMonth
    this.store.runAutoClose()
  }

  // ----- local writes ------------------------------------------------------

  /**
   * Store vừa đổi từ `before` sang `after` do MỘT thao tác của người dùng trong tab này.
   * Sinh op tối thiểu, áp lên trạng thái hiển thị, ghi xuống IndexedDB, hẹn đẩy lên server.
   */
  recordLocalChange(before: AppDoc, after: AppDoc, options: { derived?: boolean } = {}) {
    if (!this.booted) return
    const beforeRecords: RecordMap = {}
    const afterRecords: RecordMap = {}
    if (before.cttm !== after.cttm) {
      cttmToRecords(before.cttm, beforeRecords)
      cttmToRecords(after.cttm, afterRecords)
    }
    if (before.templates !== after.templates) {
      templatesToRecords(before.templates, beforeRecords)
      templatesToRecords(after.templates, afterRecords)
    }
    const drafts = diffRecordMaps(beforeRecords, afterRecords).map((draft): OpDraft => {
      // Bản ghi chỉ có trong phép chiếu (mặc định tự sinh) chưa nằm trong sổ cái → patch thành put.
      const upgraded = draft.t === "patch" && !this.optimistic.records[draft.key] ? { t: "put" as const, key: draft.key, v: afterRecords[draft.key] } : draft
      // Dữ liệu tự sinh (sang tháng mới...) chỉ được TẠO nếu chưa ai tạo: máy đến sau là no-op.
      if (options.derived && upgraded.t === "put") return { ...upgraded, t: "init" }
      return upgraded
    })
    if (drafts.length === 0) return
    this.commitDrafts(drafts, `${options.derived ? "auto-" : ""}${nanoid(8)}`, false)
  }

  private commitDrafts(drafts: OpDraft[], tx: string, hydrate: boolean) {
    const at = monotonicIso()
    const working = cloneLedgerState(this.optimistic)
    for (const draft of drafts) applyOpInPlace(working, { ...draft, at })
    this.optimistic = working
    const entry = { drafts, tx, at }
    this.unpersisted.push(entry)
    this.localSeq += 1
    this.persistChain = this.persistChain.then(() => this.persist(entry))
    this.refreshCounters()
    if (hydrate) this.hydrateStore()
    this.schedulePush()
  }

  /** Ghi một thao tác xuống IndexedDB; lỗi thì thử lại mãi (giãn cách), giữ đúng thứ tự các thao tác. */
  private async persist(entry: { drafts: OpDraft[]; tx: string; at: string }) {
    let delay = 500
    for (;;) {
      try {
        const ops = await this.env.journal.append(entry.drafts, entry.tx, entry.at)
        const index = this.unpersisted.indexOf(entry)
        if (index >= 0) this.unpersisted.splice(index, 1)
        this.outbox.push(...ops)
        this.localSeq += 1
        if (this.state.storageError) this.setState({ storageError: undefined })
        this.refreshCounters()
        this.env.broadcast?.post({ type: "changed", from: this.tabId })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Op vẫn nằm trong RAM và vẫn hiển thị; báo rõ để người dùng không đóng tab.
        this.setState({ storageError: `Không ghi được vào bộ nhớ trình duyệt: ${message}` })
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, 30_000)
      }
    }
  }

  /** Chờ các thao tác đang ghi xuống IndexedDB, nhưng không quá `ms` (đĩa lỗi không được chặn đồng bộ). */
  private waitPersisted(ms = 5_000): Promise<void> {
    return Promise.race([this.persistChain, new Promise<void>((resolve) => setTimeout(resolve, ms))])
  }

  // ----- reload from IndexedDB (tab khác vừa ghi / tab được khôi phục từ bfcache) -----

  /** Tải lại từ IndexedDB (xếp hàng sau mọi thao tác đang chạy của tab này). */
  reloadFromJournal(): Promise<void> {
    return this.runExclusive(() => this.reloadFromJournalNow())
  }

  private async reloadFromJournalNow(): Promise<void> {
    if (!this.booted) return
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const seq = this.localSeq
      const snapshot = await this.env.journal.load()
      if (!snapshot) return
      // Tab này vừa ghi thêm trong lúc đọc → bản đọc có thể thiếu op đó; đọc lại. Op chưa ghi xong
      // (unpersisted) luôn được áp lên trên bản đọc trong rebuildOptimistic.
      if (seq !== this.localSeq) continue
      this.applySnapshot(snapshot)
      this.hydrateStore()
      return
    }
  }

  // ----- legacy bridge -----------------------------------------------------

  private onStorageEvent(detail: unknown) {
    const info = detail as { key?: string | null } | undefined
    if (!info || (info.key !== "cttm_v1" && info.key !== "smartSpend.templates.v1" && info.key !== "mf3.tplTombstones")) return
    void this.runExclusive(() => this.bridgeLegacyIfChanged())
  }

  private async bridgeLegacyIfChanged() {
    const fingerprint = legacyFingerprint(this.env.legacyStorage)
    if (fingerprint === this.meta.legacyHash) return
    const legacy = readLegacyLocal(this.env.legacyStorage)
    const drafts = legacy.hasData ? legacyBridgeDrafts(this.optimistic, legacy, this.meta.legacyImportedAt ?? "") : []
    this.meta = await this.env.journal.patchMeta({ legacyHash: fingerprint })
    if (drafts.length > 0) this.commitDrafts(drafts, "legacy-bridge", true)
  }

  // ----- network -----------------------------------------------------------

  private async redis(): Promise<SyncRedis> {
    const config = this.env.getConfig()
    if (!config.upstash) throw new Error("Chưa cấu hình Upstash Redis.")
    const key = `${config.upstash.url}\n${config.upstash.token}`
    if (!this.redisPromise || this.redisKey !== key) {
      this.redisKey = key
      const created = this.env.createRedis(config.upstash)
      this.redisPromise = created
      // Tạo client lỗi (vd. nạp module lúc mất mạng) thì KHÔNG giữ lỗi đó: lần sau tạo lại.
      created.catch(() => {
        if (this.redisPromise === created) this.redisPromise = null
      })
    }
    return this.redisPromise
  }

  private schedulePush() {
    if (this.stopped || this.state.mode !== "upstash") return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.sync("push")
    }, this.env.pushDelayMs)
  }

  private scheduleRetry(ms: number) {
    if (this.stopped) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.sync("retry")
    }, ms)
  }

  private onWake(force = false) {
    if (this.stopped) return
    void this.reloadFromJournal()
    if (this.state.mode !== "upstash") return
    const now = this.env.now()
    if (!force && now - this.lastWakeAt < EVENT_THROTTLE_MS) return
    this.lastWakeAt = now
    void this.sync("wake")
  }

  private async pollTick() {
    if (this.stopped || !this.env.isVisible()) return
    await this.sync("poll")
  }

  /** Đồng bộ ngay (nút "Đồng bộ ngay" cũng bỏ trạng thái tạm dừng). */
  syncNow(options: { resume?: boolean } = {}): Promise<void> {
    if (options.resume && this.state.phase === "paused") this.setState({ phase: "booting" })
    return this.sync("manual")
  }

  private sync(reason: string): Promise<void> {
    return this.runExclusive(async () => {
      if (this.stopped || !this.booted) return
      const config = this.env.getConfig()
      if (config.mode !== "upstash" || !config.upstash) return
      if (this.state.dialog) return
      const blocked = ["paused", "auth-error", "unsupported", "needs-update"].includes(this.state.phase)
      if (blocked && reason !== "manual") return
      await this.waitPersisted()
      const locked = this.env.withLock ? this.env.withLock(SYNC_LOCK, () => this.syncLocked()) : this.syncLocked()
      await locked
    })
  }

  private async syncLocked() {
    this.setState({ inFlight: true })
    try {
      const redis = await this.redis()
      await this.measureSkew(redis)
      await this.reloadFromJournalNow()
      const head = await withTimeout(readLedgerHead(redis, this.meta.deviceId), this.env.requestTimeoutMs, "head")
      this.setState({ remoteLength: head.length })

      if (!this.meta.genesisId || this.meta.join) {
        await this.ensureJoined(redis, head)
        return
      }
      if (!head.genesis) throw this.attention("remote-empty", head)
      if (head.genesis !== this.meta.genesisId || head.length < this.meta.cursor) throw this.attention("remote-different", head)

      if (this.state.phase !== "idle") this.setState({ phase: "syncing" })
      await this.pullTo(redis, head.length)
      if (this.state.phase === "needs-update") return
      this.allowDerivedWrites()
      await this.pushPending(redis)
      this.setState({ phase: "idle", lastSyncAt: this.env.now(), lastError: undefined })
    } catch (error) {
      this.handleSyncError(error)
    } finally {
      this.setState({ inFlight: false })
      this.refreshCounters()
    }
  }

  private async measureSkew(redis: SyncRedis) {
    if (this.skewMeasured) return
    this.skewMeasured = true
    const serverMs = await withTimeout(readServerTimeMs(redis), this.env.requestTimeoutMs, "time").catch(() => null)
    if (serverMs !== null) setClockSkewMs(serverMs - this.env.now())
  }

  private attention(kind: LedgerDialogKind, head: LedgerHead) {
    this.dialogSeq += 1
    this.setState({ dialog: { id: this.dialogSeq, kind, remoteLength: head.length }, phase: "attention" })
    return new NeedsAttention(kind)
  }

  private handleSyncError(error: unknown) {
    if (error instanceof NeedsAttention) return
    if (error instanceof ForkDetected) {
      // Đã xử lý (đổi danh tính) — đồng bộ lại ngay.
      this.scheduleRetry(50)
      return
    }
    const { kind, message } = classifySyncError(error)
    const phase: LedgerPhase =
      kind === "auth" ? "auth-error" : kind === "unsupported" ? "unsupported" : kind === "network" ? "offline" : "error"
    this.setState({ phase, lastError: message })
    if (phase === "offline" || phase === "error") this.scheduleRetry(phase === "offline" ? 15_000 : 60_000)
  }

  // ----- pull --------------------------------------------------------------

  /** Phát lại op mới của server (seq trong (cursor, length]) vào confirmed. */
  private async pullTo(redis: SyncRedis, length: number): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (length <= this.meta.cursor) return
      const ops = await withTimeout(readOps(redis, this.meta.cursor, length), this.env.requestTimeoutMs * 3, "pull")
      let usable = ops
      const unsupported = ops.findIndex((op) => op.sv > OP_SCHEMA_VERSION)
      if (unsupported >= 0) usable = ops.slice(0, unsupported)

      const mineByCseq = new Map(this.outbox.map((op) => [op.cseq, op]))
      let acked = this.meta.ackedCseq
      for (const op of usable) {
        if (op.dev !== this.meta.deviceId) continue
        const local = mineByCseq.get(op.cseq)
        if (local && local.id !== op.id) {
          await this.rotateIdentity()
          throw new ForkDetected()
        }
        if (op.cseq > acked) acked = op.cseq
      }

      const nextConfirmed = foldOps(this.confirmed, usable)
      const cursor = this.meta.cursor + usable.length
      const ok =
        usable.length === 0 ||
        (await this.env.journal.commitPull({ expectedCursor: this.meta.cursor, cursor, confirmed: nextConfirmed, ackedCseq: acked }))
      if (!ok) {
        // Tab khác vừa phát lại trước → tải lại rồi thử tiếp từ cursor mới.
        await this.reloadFromJournalNow()
        continue
      }
      if (usable.length > 0) {
        this.confirmed = nextConfirmed
        this.meta = { ...this.meta, cursor, ackedCseq: Math.max(this.meta.ackedCseq, acked) }
        this.outbox = this.outbox.filter((op) => op.cseq > this.meta.ackedCseq)
        this.rebuildOptimistic()
        this.hydrateStore()
        this.env.broadcast?.post({ type: "changed", from: this.tabId })
      }
      if (unsupported >= 0) {
        this.setState({
          phase: "needs-update",
          lastError: "Sổ cái có dữ liệu từ phiên bản ứng dụng mới hơn. Hãy tải lại trang để cập nhật; thay đổi của bạn vẫn được giữ trên máy.",
        })
      }
      return
    }
    throw new Error("Không phát lại được sổ cái (nhiều tab tranh nhau). Sẽ thử lại.")
  }

  // ----- push --------------------------------------------------------------

  private async pushPending(redis: SyncRedis): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await this.waitPersisted()
      const pending = (await this.env.journal.readOutbox()).filter((op) => op.cseq > this.meta.ackedCseq)
      if (pending.length === 0) return
      if (pending.some((op) => op.dev !== this.meta.deviceId)) {
        await this.reloadFromJournalNow()
        continue
      }
      const batch = this.takeBatch(pending)
      const result = await withTimeout(
        appendOps(redis, {
          deviceId: this.meta.deviceId,
          ops: batch,
          nowMs: this.env.now() + getClockSkewMs(),
          expectedGenesis: this.meta.genesisId ?? "",
          createGenesis: Boolean(this.meta.join?.migrating),
        }),
        this.env.requestTimeoutMs * 2,
        "push",
      )
      if (result.status === "ok") {
        await this.pullTo(redis, result.length)
        continue
      }
      if (result.status === "genesis-mismatch") {
        throw this.attention(result.genesis ? "remote-different" : "remote-empty", await readLedgerHead(redis, this.meta.deviceId))
      }
      if (result.status === "invalid") {
        throw new Error(`Redis từ chối op thứ ${result.index} của lô (dữ liệu không hợp lệ). Thay đổi vẫn được giữ trên máy.`)
      }
      // cseq lệch: có thể lần đẩy trước đã vào server nhưng mất phản hồi → đọc lại sổ cái rồi xét.
      const head = await readLedgerHead(redis, this.meta.deviceId)
      await this.pullTo(redis, head.length)
      const stillPending = (await this.env.journal.readOutbox()).filter((op) => op.cseq > this.meta.ackedCseq)
      if (stillPending.length === 0) return
      const first = stillPending[0].cseq
      if (head.deviceLast >= first) {
        // Server đã có op mang danh tính này mà máy chưa từng tạo (IndexedDB bị khôi phục/sao chép).
        await this.rotateIdentity()
        continue
      }
      if (head.deviceLast < first - 1) {
        // Khoảng hở cseq (op cục bộ bị mất trước khi lên server) → đánh số lại để nối tiếp.
        const snapshot = await this.env.journal.renumberOutbox({ deviceId: this.meta.deviceId, firstCseq: head.deviceLast + 1, ackedCseq: head.deviceLast })
        this.applySnapshot(snapshot)
      }
    }
  }

  private takeBatch(pending: LedgerOp[]): LedgerOp[] {
    const batch: LedgerOp[] = []
    const limit = Math.max(16 * 1024, this.env.maxRequestBytes - 32 * 1024)
    for (const op of pending) {
      if (batch.length >= MAX_BATCH_OPS) break
      if (batch.length > 0 && estimateAppendBytes([...batch, op]) > limit) break
      batch.push(op)
    }
    return batch
  }

  private async rotateIdentity() {
    const deviceId = `d_${nanoid(10)}`
    const snapshot = await this.env.journal.renumberOutbox({ deviceId, firstCseq: 1, ackedCseq: 0 })
    this.applySnapshot(snapshot)
    this.env.broadcast?.post({ type: "changed", from: this.tabId })
  }

  // ----- join / migration --------------------------------------------------

  /** Trạng thái máy này dưới dạng SyncDoc (để gộp bằng threeWayMerge của v3). */
  private localSyncDoc(join: JoinInfo) {
    return toSyncDoc(recordsToDoc(this.optimistic.records), this.optimistic.deleted, {
      tombstones: join.legacyTombstones,
      templateTombstones: join.legacyTemplateTombstones,
    })
  }

  private async ensureJoined(redis: SyncRedis, head: LedgerHead): Promise<void> {
    const join = this.meta.join ?? emptyJoinInfo()

    // Máy này đang dở tay chuyển đổi (đã ghi bộ genesis vào outbox): đẩy nốt.
    if (this.meta.genesisId && join.migrating) {
      if (head.genesis && head.genesis !== this.meta.genesisId) throw this.attention("remote-different", head)
      this.setState({ phase: "migrating" })
      await this.pushPending(redis)
      const remaining = (await this.env.journal.readOutbox()).filter((op) => op.cseq > this.meta.ackedCseq)
      if (remaining.length > 0) {
        this.scheduleRetry(2_000)
        return
      }
      await markMigrationDone(redis, {
        state: "done",
        by: this.meta.deviceId,
        byLabel: this.meta.deviceLabel,
        at: this.env.now(),
        v3Final: join.v3Final,
        v3Genesis: join.v3RemoteGenesis,
      })
      this.meta = await this.env.journal.patchMeta({ join: null })
      writeLegacyConsumed(this.env.legacyStorage, this.meta.genesisId as string, this.env.now())
      this.refreshCounters()
      const latest = await readLedgerHead(redis, this.meta.deviceId)
      await this.pullTo(redis, latest.length)
      this.allowDerivedWrites()
      this.setState({ phase: "idle", lastSyncAt: this.env.now(), lastError: undefined })
      return
    }

    if (!head.genesis) {
      if (head.length > 0) throw new Error("Sổ cái trên Redis thiếu genesis — dừng để bảo vệ dữ liệu.")
      await this.migrateToLedger(redis, head, join)
      return
    }

    if (head.migration?.state === "running" && head.migration.by !== this.meta.deviceId) {
      this.setState({ phase: "migrating", lastError: `Đang chờ ${head.migration.byLabel ?? "thiết bị khác"} chuyển dữ liệu lên sổ cái…` })
      this.scheduleRetry(4_000)
      return
    }

    await this.joinExistingLedger(redis, head, join)
  }

  /** Máy đầu tiên lên v4: khoá, đóng băng v3, gộp snapshot v3 cuối với dữ liệu máy này, ghi genesis. */
  private async migrateToLedger(redis: SyncRedis, head: LedgerHead, join: JoinInfo) {
    this.setState({ phase: "migrating" })
    const mine = { state: "running" as const, by: this.meta.deviceId, byLabel: this.meta.deviceLabel, at: this.env.now() }
    let lock = head.migration
    if (!lock) {
      if (await tryAcquireMigration(redis, mine)) lock = mine
      else lock = (await readLedgerHead(redis, this.meta.deviceId)).migration
    } else if (lock.state === "done") {
      // Đã chuyển đổi xong nhưng sổ cái lẫn genesis đều mất ⇒ database bị xoá: khởi tạo lại từ máy này.
      await markMigrationDone(redis, mine)
      lock = mine
    } else if (lock.by !== this.meta.deviceId && this.env.now() - lock.at > STALE_MIGRATION_MS) {
      // Máy giữ khoá bị tắt trước khi ghi được gì (chưa có genesis) ⇒ tiếp quản an toàn. Nếu hai máy
      // cùng tiếp quản, Lua chỉ cho một genesis thắng; máy kia nhận hộp thoại "sổ cái khác" và gộp.
      await markMigrationDone(redis, mine)
      lock = mine
    }
    if (!lock || lock.by !== this.meta.deviceId) {
      this.setState({ lastError: `Đang chờ ${lock?.byLabel ?? "thiết bị khác"} chuyển dữ liệu lên sổ cái…` })
      this.scheduleRetry(4_000)
      return
    }

    const v3Final = await freezeV3(redis)
    const remote = v3Final > 0 ? await readV3Final(redis, v3Final) : await readV2(redis)
    const v3RemoteGenesis = v3Final > 0 ? await readV3Genesis(redis) : undefined
    const base = join.v3Base && join.v3Genesis && v3RemoteGenesis && join.v3Genesis === v3RemoteGenesis ? join.v3Base : null
    const nowIso = monotonicIso()
    const target = mergeLocalIntoRemote(this.localSyncDoc(join), base, remote, nowIso)
    const records = docToRecords(fromSyncDoc(target))
    const genesisId = `g_${nanoid(12)}`
    const metaForOps = { deviceId: this.meta.deviceId, deviceLabel: this.meta.deviceLabel }
    const ops = Object.keys(records).map((key, index) => makeOp({ t: "put", key, v: records[key] }, metaForOps, index + 1, "migrate", nowIso))
    for (const { draft, at } of tombstoneDrafts(target, records)) ops.push(makeOp(draft, metaForOps, ops.length + 1, "migrate", at))
    const snapshot = await this.env.journal.replace({
      expectedNextCseq: this.meta.nextCseq,
      meta: {
        genesisId,
        cursor: 0,
        ackedCseq: 0,
        nextCseq: ops.length + 1,
        join: { ...join, migrating: true, v3Final, v3RemoteGenesis },
      },
      confirmed: emptyLedgerState(),
      outbox: ops,
    })
    if (!snapshot) {
      this.scheduleRetry(500)
      return
    }
    this.applySnapshot(snapshot)
    this.hydrateStore()
    await this.ensureJoined(redis, await readLedgerHead(redis, this.meta.deviceId))
  }

  /** Sổ cái đã có: gộp dữ liệu máy này (3 chiều với base v3 nếu tin được) rồi chỉ ghi phần khác biệt. */
  private async joinExistingLedger(redis: SyncRedis, head: LedgerHead, join: JoinInfo) {
    this.setState({ phase: "migrating" })
    const all = await withTimeout(readOps(redis, 0, head.length), this.env.requestTimeoutMs * 6, "join")
    if (all.some((op) => op.sv > OP_SCHEMA_VERSION)) {
      this.setState({ phase: "needs-update", lastError: "Sổ cái có dữ liệu từ phiên bản ứng dụng mới hơn. Hãy tải lại trang để cập nhật." })
      return
    }
    const ledger = foldOps(emptyLedgerState(), all)
    const ledgerProjection = recordsToDoc(ledger.records)
    const ledgerDoc = toSyncDoc(ledgerProjection, ledger.deleted)
    const migrationGenesis = head.migration?.v3Genesis
    const base = join.v3Base && join.v3Genesis && migrationGenesis && join.v3Genesis === migrationGenesis ? join.v3Base : null
    const nowIso = monotonicIso()
    const expectedNextCseq = this.meta.nextCseq
    const target = mergeLocalIntoRemote(this.localSyncDoc(join), base, ledgerDoc, nowIso)
    const drafts = draftsToReach(ledger.records, docToRecords(ledgerProjection), fromSyncDoc(target))
    const metaForOps = { deviceId: this.meta.deviceId, deviceLabel: this.meta.deviceLabel }
    const first = head.deviceLast + 1
    const ops = drafts.map((draft, index) => makeOp(draft, metaForOps, first + index, "join", nowIso))
    const snapshot = await this.env.journal.replace({
      expectedNextCseq,
      meta: {
        genesisId: head.genesis ?? undefined,
        cursor: all.length,
        ackedCseq: head.deviceLast,
        nextCseq: first + ops.length,
        join: null,
      },
      confirmed: ledger,
      outbox: ops,
    })
    if (!snapshot) {
      this.scheduleRetry(500)
      return
    }
    this.applySnapshot(snapshot)
    this.hydrateStore()
    this.env.broadcast?.post({ type: "changed", from: this.tabId })
    writeLegacyConsumed(this.env.legacyStorage, this.meta.genesisId as string, this.env.now())
    await this.pushPending(redis)
    this.allowDerivedWrites()
    this.setState({ phase: "idle", lastSyncAt: this.env.now(), lastError: undefined })
  }

  // ----- dialogs -----------------------------------------------------------

  resolveDialog(choice: LedgerDialogChoice, dialogId?: number): Promise<void> {
    const dialog = this.state.dialog
    if (!dialog || (dialogId !== undefined && dialog.id !== dialogId)) return Promise.resolve()
    return this.runExclusive(async () => {
      this.setState({ dialog: null })
      if (choice === "pause") {
        this.setState({ phase: "paused" })
        this.allowDerivedWrites()
        return
      }
      // "reseed" (Redis trống) và "merge-local" (Redis chứa sổ cái khác): coi toàn bộ dữ liệu máy
      // này là chưa đồng bộ rồi gia nhập lại — sổ cái trống thì khởi tạo mới, có sổ cái thì hợp nhất.
      await this.waitPersisted()
      const records = this.optimistic.records
      const at = monotonicIso()
      const metaForOps = { deviceId: this.meta.deviceId, deviceLabel: this.meta.deviceLabel }
      const ops = Object.keys(records).map((key, index) => makeOp({ t: "put", key, v: records[key] }, metaForOps, index + 1, "rejoin", at))
      const tombs = deletedToTombstones(this.optimistic.deleted)
      const snapshot = await this.env.journal.replace({
        expectedNextCseq: this.meta.nextCseq,
        meta: {
          genesisId: undefined,
          cursor: 0,
          ackedCseq: 0,
          nextCseq: ops.length + 1,
          join: { ...emptyJoinInfo(), legacyTombstones: tombs.cttm, legacyTemplateTombstones: tombs.templates },
        },
        confirmed: emptyLedgerState(),
        outbox: ops,
      })
      if (snapshot) this.applySnapshot(snapshot)
      this.setState({ phase: "booting" })
    }).then(() => this.sync("manual"))
  }

  // ----- history / undo / restore -----------------------------------------

  private async fetchFullLog(redis: SyncRedis): Promise<ServerOp[]> {
    const head = await readLedgerHead(redis, this.meta.deviceId)
    if (head.genesis !== this.meta.genesisId) throw new Error("Sổ cái trên Redis không khớp với máy này.")
    if (this.fullLogCache.length > head.length) this.fullLogCache = []
    if (this.fullLogCache.length < head.length) {
      const more = await withTimeout(readOps(redis, this.fullLogCache.length, head.length), this.env.requestTimeoutMs * 6, "history")
      this.fullLogCache = [...this.fullLogCache, ...more]
    }
    return this.fullLogCache
  }

  /** Toàn bộ lịch sử thao tác đọc được: sổ cái server (nếu đã gia nhập) + op chưa gửi. */
  private async historySource(): Promise<{ server: ServerOp[]; pending: LedgerOp[] }> {
    await this.waitPersisted()
    const pending = (await this.env.journal.readOutbox()).filter((op) => op.cseq > this.meta.ackedCseq)
    const config = this.env.getConfig()
    if (config.mode === "upstash" && config.upstash && this.meta.genesisId && !this.meta.join) {
      return { server: await this.fetchFullLog(await this.redis()), pending }
    }
    return { server: [], pending }
  }

  async loadHistory(limit = 200): Promise<HistoryGroup[]> {
    const { server, pending } = await this.historySource()
    const items: HistoryOp[] = [
      ...server.map((op) => ({ seq: op.seq, cseq: op.cseq, dev: op.dev, dl: op.dl, at: op.at, t: op.t, key: op.key, v: op.v, u: op.u, pending: false, tx: op.tx })),
      ...pending.map((op) => ({ cseq: op.cseq, dev: op.dev, dl: op.dl, at: op.at, t: op.t, key: op.key, v: op.v, u: op.u, pending: true, tx: op.tx })),
    ]
    const groups: HistoryGroup[] = []
    for (const item of items) {
      const last = groups[groups.length - 1]
      if (last && last.tx === item.tx && last.dev === item.dev && last.pending === item.pending) {
        last.ops.push(item)
        if (item.seq) last.lastSeq = item.seq
        continue
      }
      groups.push({
        tx: item.tx,
        dev: item.dev,
        deviceLabel: item.dl,
        at: item.at,
        pending: item.pending,
        mine: item.dev === this.meta.deviceId,
        firstSeq: item.seq,
        lastSeq: item.seq,
        ops: [item],
      })
    }
    return groups.reverse().slice(0, limit)
  }

  /** Trạng thái ngay TRƯỚC nhóm thao tác `group` (phát lại sổ cái tới trước nó). */
  private async stateBefore(group: HistoryGroup): Promise<LedgerState> {
    const { server, pending } = await this.historySource()
    if (group.pending || group.firstSeq === undefined) {
      const firstCseq = group.ops[0].cseq
      const base = server.length > 0 ? foldOps(emptyLedgerState(), server) : this.confirmed
      return foldOps(
        base,
        pending.filter((op) => op.cseq < firstCseq),
      )
    }
    return foldOps(
      emptyLedgerState(),
      server.filter((op) => op.seq < (group.firstSeq as number)),
    )
  }

  /** Hoàn tác một nhóm: đưa các bản ghi mà nhóm đó đụng tới về giá trị ngay trước nó. */
  async undoGroup(group: HistoryGroup): Promise<number> {
    const before = await this.stateBefore(group)
    const keys = new Set(group.ops.map((op) => op.key))
    const current: RecordMap = {}
    const target: RecordMap = {}
    for (const key of keys) {
      if (this.optimistic.records[key]) current[key] = this.optimistic.records[key]
      if (before.records[key]) target[key] = before.records[key]
    }
    const drafts = diffRecordMaps(current, target).map((draft) =>
      draft.t === "patch" && !this.optimistic.records[draft.key] ? { t: "put" as const, key: draft.key, v: target[draft.key] } : draft,
    )
    if (drafts.length > 0) this.commitDrafts(drafts, `undo-${group.tx}`, true)
    return drafts.length
  }

  /** Đưa TOÀN BỘ dữ liệu về trạng thái ngay trước nhóm `group`. Lịch sử sau đó vẫn còn nguyên. */
  async restoreBefore(group: HistoryGroup): Promise<number> {
    const before = await this.stateBefore(group)
    const drafts = diffRecordMaps(this.optimistic.records, before.records)
    if (drafts.length > 0) this.commitDrafts(drafts, `restore-${group.firstSeq ?? group.ops[0].cseq}`, true)
    return drafts.length
  }

  /** Xuất toàn bộ sổ cái (JSON Lines) — bản đầy đủ, phát lại được. */
  async exportLedger(): Promise<string> {
    const { server, pending } = await this.historySource()
    return [...server, ...pending].map((op) => JSON.stringify(op)).join("\n")
  }

  pendingCount() {
    return this.state.pending
  }

  dismissNotice() {
    this.setState({ notice: null })
  }

  async setDeviceLabel(label: string) {
    const clean = label.trim().slice(0, 40)
    if (!clean) return
    this.meta = await this.env.journal.patchMeta({ deviceLabel: clean })
    this.refreshCounters()
  }
}
