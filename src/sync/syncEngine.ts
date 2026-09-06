import type { DataSourceConfig, UpstashConfig } from "@/storage/dataSource"
import { normalizeCttmStateFromRaw } from "@/storage/localStorage"
import { createDefaultSettings, type CttmState } from "@/storage/schema"
import { normalizeTemplateList } from "@/storage/templates"
import { getClockSkewMs, setClockSkewMs, seedLastIssuedMs, getLastIssuedMs } from "@/sync/clock"
import {
  appendConflicts,
  clearConflicts,
  clearLegacyLocalMeta,
  pushLocalHistory,
  readBase,
  readConflicts,
  readLegacyLastSync,
  readLocalHistory,
  readMeta,
  readWriteSeq,
  updateMeta,
  writeBase,
  type KeyValueStorage,
  type LocalHistoryEntry,
  type SyncMeta,
} from "@/sync/localMeta"
import { countMissingEntities, isMassDelete, threeWayMerge, type ConflictEntry, type MergeResult } from "@/sync/merge"
import {
  archiveLegacyAndMarkSuperseded,
  markLegacySuperseded,
  casCommit,
  classifySyncError,
  listHistory,
  pinVersion,
  readGenesis,
  readHeadAndSnapshot,
  readLegacySnapshot,
  readServerTimeMs,
  readSnapshotPayload,
  readVersion,
  unpinVersion,
  type HistoryEntry,
  type SyncRedis,
} from "@/sync/redisProtocol"
import {
  decodeSnapshot,
  encodeSnapshot,
  estimateRequestBytes,
  hashDoc,
  hashState,
  stableStringify,
  stripForSync,
  SYNC_SCHEMA,
  type HeadV3,
  type SnapshotV3,
  type SyncDoc,
  type SyncedTemplates,
} from "@/sync/snapshot"

// ---------------------------------------------------------------------------
// Adapters — engine không import store/window trực tiếp để test được với 2 thiết bị giả.
// ---------------------------------------------------------------------------

export interface SyncStoreAdapter {
  getData(): CttmState
  getWorkspace(): "real" | "demo"
  /** Ghi dữ liệu workspace "real" (vào store nếu đang ở real, nếu không thì chỉ ghi đĩa). */
  replaceRealData(next: CttmState): void
  /** Ép ghi ngay phần đang chờ debounce xuống localStorage. */
  flushPendingSave(): void
  subscribeData(listener: (data: CttmState) => void): () => void
  subscribePersisted(listener: (data: CttmState) => void): () => void
  loadRealFromDisk(): CttmState
  getTemplates(): SyncedTemplates
  replaceTemplates(templates: SyncedTemplates): void
  runAutoClose(): void
}

export interface SyncEnvironment {
  storage: KeyValueStorage
  getConfig(): DataSourceConfig
  createRedis(config: UpstashConfig): Promise<SyncRedis>
  now(): number
  isOnline(): boolean
  isVisible(): boolean
  addListener(type: "visible" | "focus" | "online" | "storage" | "templates", handler: (detail?: unknown) => void): () => void
  appBuild: string
  /** Giới hạn byte cho một request (tuỳ plan Upstash). */
  maxRequestBytes: number
  pollIntervalMs: number
  bootTimeoutMs: number
  requestTimeoutMs: number
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type SyncPhase =
  | "local-only"
  | "booting"
  | "idle"
  | "syncing"
  | "offline"
  | "degraded"
  | "auth-error"
  | "too-large"
  | "unsupported"
  | "conflict"
  | "contended"
  | "paused"

export type SyncDialogKind = "no-base" | "remote-reset" | "mass-delete" | "migrate-v2" | "legacy-changed"

export type SyncDialog = {
  id: number
  kind: SyncDialogKind
  remoteVersion: number
  remoteHead?: HeadV3 | null
  localDoc: SyncDoc
  remoteDoc: SyncDoc | null
  mergedDoc: SyncDoc | null
  stats?: { missing: number; total: number; mergedTotal: number; remoteAdded: number }
  conflicts?: ConflictEntry[]
  legacyChecksum?: string
}

export type SyncDialogChoice =
  | "merge"
  | "keep-local"
  | "use-remote"
  | "apply"
  | "push-local"
  | "ignore"
  | "pause"

export type SyncState = {
  mode: DataSourceConfig["mode"]
  phase: SyncPhase
  pushGate: boolean
  dirty: boolean
  baseVersion: number
  remoteVersion: number
  remoteDeviceLabel?: string
  remoteCommittedAt?: number
  lastError?: string
  lastPullAt?: number
  lastPushAt?: number
  conflictsCount: number
  dialog: SyncDialog | null
  deviceId: string
  deviceLabel: string
  derivedWritesAllowed: boolean
  inFlight: boolean
}

type PullOutcome =
  | { ok: true; changed: boolean; needPush: boolean }
  | { ok: false; reason: "dialog" | "error" | "not-upstash" }

class SyncAbort extends Error {}

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

const DEFAULT_SETTINGS_JSON = stableStringify(createDefaultSettings())

function settingsAreDefault(settings: CttmState["settings"]) {
  return stableStringify({ ...createDefaultSettings(), ...settings }) === DEFAULT_SETTINGS_JSON
}

/**
 * "Trống" = chưa có gì do người dùng tạo. Cấu hình tháng tự sinh từ mặc định (app tạo lúc
 * mở lần đầu) vẫn tính là trống, để một máy mới cài chỉ việc kéo dữ liệu về, không hỏi.
 */
function isEmptyDoc(doc: SyncDoc) {
  const s = doc.cttm
  return (
    s.entities.expenses.allIds.length === 0 &&
    s.entities.fixedCosts.allIds.length === 0 &&
    s.entities.purchasePlans.allIds.length === 0 &&
    s.entities.savingsTransactions.allIds.length === 0 &&
    Object.keys(s.accountBalanceReconciliationsByMonth).length === 0 &&
    Object.keys(s.budgetAdjustmentsByMonth).length === 0 &&
    Object.keys(s.capsByMonth).length === 0 &&
    // Có tombstone nghĩa là người dùng đã CHỦ ĐỘNG xoá (kể cả "xoá toàn bộ") → không phải máy trống.
    Object.keys(s.tombstones ?? {}).length === 0 &&
    // monthLocks là dữ liệu dẫn xuất (auto-close tháng trước lúc mở app) → không tính.
    doc.templates.items.length === 0 &&
    settingsAreDefault(s.settings) &&
    Object.values(s.settingsByMonth).every((monthSettings) => settingsAreDefault(monthSettings))
  )
}

function countEntities(state: CttmState) {
  return (
    state.entities.expenses.allIds.length +
    state.entities.fixedCosts.allIds.length +
    state.entities.purchasePlans.allIds.length +
    state.entities.savingsTransactions.allIds.length
  )
}

/** Bản thô đúng như thiết bị kia đã hash — dùng để đối chiếu head.contentHash trước khi chuẩn hoá. */
function rawDocFromSnapshotData(data: SnapshotV3["data"]): SyncDoc {
  return {
    cttm: data.cttm as CttmState,
    templates: {
      items: Array.isArray(data.templates?.items) ? data.templates.items : [],
      tombstones: data.templates?.tombstones && typeof data.templates.tombstones === "object" ? data.templates.tombstones : {},
    },
  }
}

function docFromSnapshotData(data: SnapshotV3["data"]): SyncDoc {
  const cttm = normalizeCttmStateFromRaw(JSON.stringify(data.cttm ?? {}))
  const templates: SyncedTemplates = {
    items: normalizeTemplateList(data.templates?.items ?? []),
    tombstones: data.templates?.tombstones && typeof data.templates.tombstones === "object" ? data.templates.tombstones : {},
  }
  return { cttm, templates }
}

function docFromLegacyValues(values: Record<string, string>): SyncDoc | null {
  const raw = values["cttm_v1"]
  if (typeof raw !== "string" || !raw) return null
  const cttm = normalizeCttmStateFromRaw(raw)
  let items: SyncedTemplates["items"] = []
  const templatesRaw = values["smartSpend.templates.v1"]
  if (typeof templatesRaw === "string" && templatesRaw) {
    try {
      items = normalizeTemplateList(JSON.parse(templatesRaw))
    } catch {
      items = []
    }
  }
  return { cttm, templates: { items, tombstones: {} } }
}

function stripDocForUpload(doc: SyncDoc): SnapshotV3["data"] {
  return {
    cttm: stripForSync(doc.cttm) as unknown as CttmState,
    templates: { items: doc.templates.items, tombstones: doc.templates.tombstones ?? {} },
  }
}

const PUSH_DEBOUNCE_MS = 2500
const EVENT_THROTTLE_MS = 5000
const MAX_CAS_ATTEMPTS = 5

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private readonly store: SyncStoreAdapter
  private readonly env: SyncEnvironment
  private listeners = new Set<(state: SyncState) => void>()
  private state: SyncState
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = true
  private disposers: Array<() => void> = []
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private dirtyCheckTimer: ReturnType<typeof setTimeout> | null = null
  private bootAllowTimer: ReturnType<typeof setTimeout> | null = null
  private lastEventSyncAt = 0
  private applyingRemote = false
  private lastDiskState: CttmState | null = null
  private dialogSeq = 0
  private redisPromise: Promise<SyncRedis> | null = null
  private redisKey = ""
  private lastAutoCloseMonth = ""
  private generation = 0
  private seenWriteSeq = 0

  constructor(store: SyncStoreAdapter, env: SyncEnvironment) {
    this.store = store
    this.env = env
    const meta = readMeta(env.storage)
    seedLastIssuedMs(meta.lastIssuedMs ?? 0)
    this.state = {
      mode: env.getConfig().mode,
      phase: "local-only",
      pushGate: false,
      dirty: meta.dirty,
      baseVersion: meta.baseVersion,
      remoteVersion: meta.baseVersion,
      conflictsCount: readConflicts(env.storage).length,
      dialog: null,
      deviceId: meta.deviceId,
      deviceLabel: meta.deviceLabel,
      derivedWritesAllowed: false,
      inFlight: false,
      lastPullAt: meta.lastPullAt,
      lastPushAt: meta.lastPushAt,
      lastError: meta.lastError,
    }
  }

  // ----- state plumbing ----------------------------------------------------

  getState() {
    return this.state
  }

  subscribe(listener: (state: SyncState) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private meta(): SyncMeta {
    return readMeta(this.env.storage)
  }

  private patchMeta(patch: Partial<SyncMeta>) {
    const next = updateMeta(this.env.storage, { ...patch, lastIssuedMs: Math.max(getLastIssuedMs(), patch.lastIssuedMs ?? 0) })
    this.setState({
      dirty: next.dirty,
      baseVersion: next.baseVersion,
      lastPullAt: next.lastPullAt,
      lastPushAt: next.lastPushAt,
      lastError: next.lastError,
    })
    return next
  }

  /** Ghi nhận "bản trên đĩa hiện tại là do chính app ghi" — không đổi state UI. */
  private notePersisted(state: CttmState) {
    this.lastDiskState = state
    this.seenWriteSeq = readWriteSeq(this.env.storage)
    updateMeta(this.env.storage, { lastPersistedHash: hashState(state) })
  }

  /** Lúc khởi động: đĩa khác bản app ghi lần cuối ⇒ có tiến trình khác (tab build cũ...) đã ghi. */
  private detectForeignDiskWrite() {
    try {
      const meta = this.meta()
      const diskHash = hashState(this.store.loadRealFromDisk())
      if (!meta.lastPersistedHash) {
        updateMeta(this.env.storage, { lastPersistedHash: diskHash })
      } else if (diskHash !== meta.lastPersistedHash) {
        updateMeta(this.env.storage, { baseUntrusted: true })
      }
    } catch {
      // không đọc được đĩa → giữ nguyên
    }
    this.seenWriteSeq = readWriteSeq(this.env.storage)
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Chờ mọi thao tác đang xếp hàng (pull/push/dialog) hoàn tất — dùng cho test và UI. */
  whenIdle(): Promise<void> {
    return this.queue.then(() => undefined)
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    this.stop()
    this.stopped = false
    const config = this.env.getConfig()
    this.setState({ mode: config.mode, dialog: null, lastError: undefined })

    this.detectForeignDiskWrite()
    this.disposers.push(this.store.subscribeData((data) => this.onLocalData(data)))
    this.disposers.push(this.store.subscribePersisted((data) => this.notePersisted(data)))
    this.disposers.push(this.env.addListener("storage", (detail) => this.onStorageEvent(detail)))
    this.disposers.push(this.env.addListener("templates", () => this.scheduleDirtyCheck()))

    if (config.mode !== "upstash" || !config.upstash) {
      this.setState({ phase: "local-only", pushGate: false, derivedWritesAllowed: true })
      this.store.runAutoClose()
      return
    }

    this.setState({ phase: "booting", pushGate: false, derivedWritesAllowed: false })
    this.disposers.push(this.env.addListener("visible", () => this.onWakeSignal()))
    this.disposers.push(this.env.addListener("focus", () => this.onWakeSignal()))
    this.disposers.push(this.env.addListener("online", () => this.onWakeSignal(true)))
    this.pollTimer = setInterval(() => void this.pollTick(), this.env.pollIntervalMs)
    this.bootAllowTimer = setTimeout(() => this.allowDerivedWrites(), this.env.bootTimeoutMs)

    this.generation += 1
    const generation = this.generation
    void this.runExclusive(async () => {
      // start() có thể được gọi lại (StrictMode, đổi cấu hình) trước khi boot cũ chạy tới đây.
      if (generation !== this.generation || this.stopped) return
      await this.measureClockSkew()
      const outcome = await this.pullSafely("boot", this.env.bootTimeoutMs)
      if (generation !== this.generation) return
      if (outcome.ok) {
        this.setState({ pushGate: true, phase: this.state.dialog ? "conflict" : "idle" })
        this.allowDerivedWrites()
        if (outcome.needPush || this.isDirty()) this.schedulePush(0)
      }
    })
  }

  stop() {
    this.stopped = true
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    if (this.pushTimer) clearTimeout(this.pushTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.dirtyCheckTimer) clearTimeout(this.dirtyCheckTimer)
    if (this.bootAllowTimer) clearTimeout(this.bootAllowTimer)
    this.pushTimer = null
    this.pollTimer = null
    this.dirtyCheckTimer = null
    this.bootAllowTimer = null
  }

  restart() {
    this.redisPromise = null
    this.redisKey = ""
    this.start()
  }

  private allowDerivedWrites() {
    if (this.bootAllowTimer) {
      clearTimeout(this.bootAllowTimer)
      this.bootAllowTimer = null
    }
    if (this.state.derivedWritesAllowed) return
    this.setState({ derivedWritesAllowed: true })
    this.store.runAutoClose()
  }

  /** AppLayout gọi lúc mount và định kỳ; chỉ chạy khi đã có dữ liệu remote (hoặc local-only). */
  requestAutoClose(currentMonth: string) {
    if (!this.state.derivedWritesAllowed) return
    if (this.lastAutoCloseMonth === currentMonth) return
    this.lastAutoCloseMonth = currentMonth
    this.store.runAutoClose()
  }

  // ----- redis -------------------------------------------------------------

  private async redis(): Promise<SyncRedis> {
    const config = this.env.getConfig()
    if (!config.upstash) throw new Error("Chưa cấu hình Upstash Redis.")
    const key = `${config.upstash.url}\n${config.upstash.token}`
    if (!this.redisPromise || this.redisKey !== key) {
      this.redisKey = key
      this.redisPromise = this.env.createRedis(config.upstash)
    }
    return this.redisPromise
  }

  private async measureClockSkew() {
    try {
      const redis = await this.redis()
      const serverMs = await withTimeout(readServerTimeMs(redis), this.env.requestTimeoutMs, "TIME")
      if (serverMs !== null) setClockSkewMs(serverMs - this.env.now())
    } catch {
      // không bắt buộc
    }
  }

  // ----- local change tracking ---------------------------------------------

  private onLocalData(_data: CttmState) {
    if (this.applyingRemote) return
    this.scheduleDirtyCheck()
  }

  private scheduleDirtyCheck() {
    if (this.stopped || this.state.mode !== "upstash") return
    if (this.dirtyCheckTimer) clearTimeout(this.dirtyCheckTimer)
    this.dirtyCheckTimer = setTimeout(() => {
      this.dirtyCheckTimer = null
      const dirty = this.isDirty()
      const meta = this.meta()
      if (dirty && !meta.dirty) this.patchMeta({ dirty: true, dirtySince: this.env.now() })
      else if (dirty !== this.state.dirty) this.setState({ dirty })
      if (dirty) this.schedulePush(PUSH_DEBOUNCE_MS)
    }, 300)
  }

  private buildLocalDoc(): SyncDoc {
    const cttm = this.store.getWorkspace() === "real" ? this.store.getData() : this.store.loadRealFromDisk()
    return { cttm, templates: this.store.getTemplates() }
  }

  isDirty(): boolean {
    const meta = this.meta()
    const doc = this.buildLocalDoc()
    if (!meta.baseHash) return !isEmptyDoc(doc)
    return hashDoc(doc) !== meta.baseHash
  }

  private schedulePush(delayMs: number) {
    if (this.stopped || this.state.mode !== "upstash") return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.runExclusive(() => this.push())
    }, delayMs)
  }

  private onStorageEvent(detail: unknown) {
    const info = detail as { key?: string | null; newValue?: string | null } | undefined
    if (!info || info.key !== "cttm_v1" || !info.newValue) return
    if (this.applyingRemote || this.store.getWorkspace() !== "real") return
    let disk: CttmState
    try {
      disk = normalizeCttmStateFromRaw(info.newValue)
    } catch {
      return
    }
    const memory = this.store.getData()
    const memoryHash = hashState(memory)
    // writeSeq tăng ⇒ bản ghi đến từ một tab build mới (đáng tin); không tăng ⇒ nguồn ghi lạ
    // (tab build cũ với RAM cũ) → chỉ nhận thêm entity/tombstone, KHÔNG để nó lùi settings.
    const seq = readWriteSeq(this.env.storage)
    const fromNewBuild = seq > this.seenWriteSeq
    this.seenWriteSeq = seq
    if (memoryHash === hashState(disk)) return
    // Gộp kiểu union + tombstone (không có base): không bao giờ để một bản ghi đĩa "cũ hơn"
    // xoá dữ liệu trong RAM.
    const templates = this.store.getTemplates()
    const nowIso = new Date(this.env.now()).toISOString()
    const merged = fromNewBuild
      ? threeWayMerge(null, { cttm: memory, templates }, { cttm: disk, templates }, { now: nowIso })
      : threeWayMerge(null, { cttm: disk, templates }, { cttm: memory, templates }, { now: nowIso })
    // Luôn ghi lại đĩa bằng bản đã gộp — kể cả khi RAM không đổi — để sửa bản đĩa bị ghi cũ.
    this.applyLocal(merged.merged.cttm)
  }

  private applyLocal(next: CttmState) {
    this.applyingRemote = true
    try {
      this.store.replaceRealData(next)
      this.store.flushPendingSave()
      this.notePersisted(next)
    } finally {
      this.applyingRemote = false
    }
    this.scheduleDirtyCheck()
  }

  private onWakeSignal(force = false) {
    if (this.stopped || this.state.mode !== "upstash") return
    const now = this.env.now()
    if (!force && now - this.lastEventSyncAt < EVENT_THROTTLE_MS) return
    this.lastEventSyncAt = now
    void this.syncNow()
  }

  private async pollTick() {
    if (this.stopped || this.state.mode !== "upstash") return
    if (!this.env.isVisible() || this.state.dialog) return
    if (["auth-error", "unsupported", "paused", "too-large"].includes(this.state.phase)) return
    await this.runExclusive(async () => {
      const outcome = await this.pullSafely("poll", this.env.requestTimeoutMs)
      if (outcome.ok) {
        if (!this.state.pushGate) this.setState({ pushGate: true, phase: "idle" })
        this.allowDerivedWrites()
        if (outcome.needPush || this.isDirty()) await this.push()
      }
    })
  }

  /** Người dùng bấm "Đồng bộ ngay" (resume) hoặc tab quay lại foreground (không resume khi đang tạm dừng). */
  syncNow(options: { resume?: boolean } = {}): Promise<void> {
    if (this.state.mode !== "upstash") return Promise.resolve()
    if (this.state.phase === "paused" && !options.resume) return Promise.resolve()
    return this.runExclusive(async () => {
      if (this.state.phase === "paused") this.setState({ phase: "booting" })
      const outcome = await this.pullSafely("manual", this.env.requestTimeoutMs)
      if (outcome.ok) {
        this.setState({ pushGate: true, phase: this.state.dialog ? "conflict" : "idle" })
        this.allowDerivedWrites()
        if (outcome.needPush || this.isDirty()) await this.push()
      }
    })
  }

  // ----- PULL --------------------------------------------------------------

  private async pullSafely(reason: string, timeoutMs: number): Promise<PullOutcome> {
    this.setState({ inFlight: true })
    try {
      const outcome = await withTimeout(this.pull(reason), timeoutMs, `pull:${reason}`)
      if (outcome.ok) this.patchMeta({ lastError: undefined, lastPullAt: this.env.now() })
      return outcome
    } catch (error) {
      if (error instanceof SyncAbort) return { ok: false, reason: "dialog" }
      this.recordError(error)
      return { ok: false, reason: "error" }
    } finally {
      this.setState({ inFlight: false })
    }
  }

  private recordError(error: unknown) {
    const { kind, message } = classifySyncError(error)
    const phase: SyncPhase =
      kind === "auth" ? "auth-error" : kind === "unsupported" ? "unsupported" : kind === "too-large" ? "too-large" : kind === "network" ? "offline" : "degraded"
    this.patchMeta({ lastError: message })
    this.setState({ phase, lastError: message, pushGate: false })
  }

  private async pull(reason: string): Promise<PullOutcome> {
    const config = this.env.getConfig()
    if (config.mode !== "upstash" || !config.upstash) return { ok: false, reason: "not-upstash" }
    const redis = await this.redis()
    const meta = this.meta()
    const version = await readVersion(redis)
    this.setState({ remoteVersion: version })

    if (version === 0) {
      if (meta.baseVersion > 0) {
        this.openDialog({ kind: "remote-reset", remoteVersion: 0, remoteDoc: null, mergedDoc: null })
        throw new SyncAbort()
      }
      if (!meta.legacyMigrated) return this.migrateFromLegacy(redis, meta)
      return { ok: true, changed: false, needPush: !isEmptyDoc(this.buildLocalDoc()) }
    }

    if (version < meta.baseVersion) {
      this.openDialog({ kind: "remote-reset", remoteVersion: version, remoteDoc: null, mergedDoc: null })
      throw new SyncAbort()
    }

    if (reason === "boot") {
      // Database bị tạo lại có thể trùng số version một cách tình cờ → đối chiếu genesis mỗi lần boot.
      if (meta.genesisId && meta.baseVersion > 0) {
        const remoteGenesis = await readGenesis(redis)
        if (remoteGenesis && remoteGenesis !== meta.genesisId) {
          this.openDialog({ kind: "remote-reset", remoteVersion: version, remoteDoc: null, mergedDoc: null })
          throw new SyncAbort()
        }
      }
      await this.checkLegacyChanged(redis, meta)
    }

    this.store.flushPendingSave()
    const local = this.buildLocalDoc()
    const localHash = hashDoc(local)
    // Đĩa từng bị tiến trình ngoài engine ghi (phát hiện lúc boot) → base không còn đáng tin:
    // không dùng base để phân xử, và kể cả khi remote chưa đổi vẫn gộp lại với Redis trước khi push.
    const driftSuspect = !!this.meta().baseUntrusted

    if (version === meta.baseVersion && !driftSuspect) {
      return { ok: true, changed: false, needPush: this.isDirty() }
    }

    const { head, payload } = await readHeadAndSnapshot(redis, version)
    if (!head) throw new Error("Không đọc được head đồng bộ trên Redis.")
    if (meta.genesisId && head.genesisId && head.genesisId !== meta.genesisId) {
      this.openDialog({ kind: "remote-reset", remoteVersion: version, remoteHead: head, remoteDoc: null, mergedDoc: null })
      throw new SyncAbort()
    }
    let snapshotPayload = payload
    if (!snapshotPayload) {
      // Có thể retention vừa xoá đúng bản này giữa hai lệnh; đọc lại theo head.version.
      snapshotPayload = await readSnapshotPayload(redis, head.version)
      if (!snapshotPayload) throw new Error("Snapshot trên Redis không còn tồn tại.")
    }
    const snapshot = await decodeSnapshot(snapshotPayload)
    if (!snapshot) throw new Error("Snapshot trên Redis không đọc được.")
    // Đối chiếu hash trên bản THÔ (đúng thứ thiết bị kia đã hash); chuẩn hoá chỉ dùng cho merge/apply.
    let rawHash: string
    try {
      rawHash = hashDoc(rawDocFromSnapshotData(snapshot.data))
    } catch {
      rawHash = ""
    }
    if (rawHash !== head.contentHash) throw new Error("Snapshot trên Redis không khớp head (hash).")
    const remote = docFromSnapshotData(snapshot.data)
    const remoteHash = hashDoc(remote)
    this.setState({ remoteDeviceLabel: head.deviceLabel, remoteCommittedAt: head.committedAt })

    const localDirty = meta.dirty || (meta.baseHash ? localHash !== meta.baseHash : !isEmptyDoc(local))
    const base = meta.baseVersion > 0 && !driftSuspect ? readBase(this.env.storage) : null
    const nowIso = new Date(this.env.now()).toISOString()

    let merged: SyncDoc
    let conflicts: ConflictEntry[] = []
    let mergeResult: MergeResult | null = null

    if (!localDirty || isEmptyDoc(local) || localHash === remoteHash || localHash === head.contentHash) {
      merged = remote
    } else if (base) {
      mergeResult = threeWayMerge(base, local, remote, { now: nowIso, remoteVersion: head.version })
      merged = mergeResult.merged
      conflicts = mergeResult.conflicts
    } else if (driftSuspect && meta.baseVersion > 0) {
      mergeResult = threeWayMerge(null, local, remote, { now: nowIso, remoteVersion: head.version })
      merged = mergeResult.merged
      conflicts = mergeResult.conflicts
    } else {
      const union = threeWayMerge(null, local, remote, { now: nowIso, remoteVersion: head.version })
      this.openDialog({
        kind: "no-base",
        remoteVersion: head.version,
        remoteHead: head,
        remoteDoc: remote,
        mergedDoc: union.merged,
        conflicts: union.conflicts,
        stats: this.guardStats(local, union.merged, union.stats.remoteAdded),
      })
      throw new SyncAbort()
    }

    const stats = this.guardStats(local, merged, mergeResult?.stats.remoteAdded ?? 0)
    if (isMassDelete(stats.missing, stats.total, stats.mergedTotal)) {
      this.openDialog({ kind: "mass-delete", remoteVersion: head.version, remoteHead: head, remoteDoc: remote, mergedDoc: merged, conflicts, stats })
      throw new SyncAbort()
    }

    const changed = this.commitPull({ local, merged, remote, head, conflicts })
    return { ok: true, changed, needPush: hashDoc(merged) !== head.contentHash }
  }

  private guardStats(local: SyncDoc, merged: SyncDoc, remoteAdded: number) {
    const { missing, total } = countMissingEntities(local.cttm, merged.cttm)
    return { missing, total, mergedTotal: countEntities(merged.cttm), remoteAdded }
  }

  private commitPull(input: { local: SyncDoc; merged: SyncDoc; remote: SyncDoc; head: HeadV3; conflicts: ConflictEntry[] }) {
    const { local, merged, remote, head, conflicts } = input
    const mergedHash = hashDoc(merged)
    const changed = mergedHash !== hashDoc(local)
    if (changed) {
      pushLocalHistory(this.env.storage, { at: this.env.now(), reason: "before-apply-remote", version: head.version, doc: local })
      this.applyDoc(merged)
    }
    writeBase(this.env.storage, remote)
    if (conflicts.length > 0) appendConflicts(this.env.storage, conflicts)
    const stillDirty = mergedHash !== head.contentHash
    this.patchMeta({
      baseVersion: head.version,
      baseHash: head.contentHash,
      genesisId: head.genesisId || this.meta().genesisId,
      dirty: stillDirty,
      dirtySince: stillDirty ? this.env.now() : undefined,
      lastPullAt: this.env.now(),
      // Local == remote == base → base lại đáng tin. Nếu còn dirty, push thành công sẽ xoá cờ.
      baseUntrusted: stillDirty ? this.meta().baseUntrusted : false,
    })
    this.setState({ conflictsCount: readConflicts(this.env.storage).length, remoteVersion: head.version })
    return changed
  }

  private applyDoc(doc: SyncDoc) {
    this.applyingRemote = true
    try {
      this.store.replaceRealData(doc.cttm)
      this.store.flushPendingSave()
      this.store.replaceTemplates(doc.templates)
      this.notePersisted(doc.cttm)
    } finally {
      this.applyingRemote = false
    }
  }

  // ----- legacy / migration ------------------------------------------------

  private async migrateFromLegacy(redis: SyncRedis, meta: SyncMeta): Promise<PullOutcome> {
    const legacy = await readLegacySnapshot(redis)
    const local = this.buildLocalDoc()
    if (!legacy || legacy.keyCount === 0 || legacy.supersededBy) {
      this.patchMeta({ legacyMigrated: true })
      clearLegacyLocalMeta(this.env.storage)
      return { ok: true, changed: false, needPush: !isEmptyDoc(local) }
    }
    const remote = docFromLegacyValues(legacy.values)
    if (!remote || !legacy.checksumValid) {
      // Không đọc được bản cũ: giữ nguyên key cũ, coi remote như rỗng nhưng ghi nhớ checksum để không hỏi lại.
      this.patchMeta({ legacyMigrated: true, legacyImportedChecksum: legacy.checksum })
      return { ok: true, changed: false, needPush: !isEmptyDoc(local) }
    }

    const lastSync = readLegacyLastSync(this.env.storage)
    const localHash = hashDoc(local)
    const remoteHash = hashDoc(remote)
    const localWasSyncedWithThis = !!lastSync && !!lastSync.checksum && lastSync.checksum === legacy.checksum
    const nowIso = new Date(this.env.now()).toISOString()

    if (isEmptyDoc(local)) {
      this.applyDoc(remote)
      this.finishLegacyMigration(legacy.checksum)
      return { ok: true, changed: true, needPush: true }
    }
    if (localHash === remoteHash || localWasSyncedWithThis) {
      // Local là bản mới nhất (bằng hoặc có thêm thay đổi offline) → đẩy local lên làm v3 đầu tiên.
      this.finishLegacyMigration(legacy.checksum)
      return { ok: true, changed: false, needPush: true }
    }

    const union = threeWayMerge(null, local, remote, { now: nowIso })
    this.openDialog({
      kind: "migrate-v2",
      remoteVersion: 0,
      remoteDoc: remote,
      mergedDoc: union.merged,
      conflicts: union.conflicts,
      stats: this.guardStats(local, union.merged, union.stats.remoteAdded),
      legacyChecksum: legacy.checksum,
    })
    void meta
    throw new SyncAbort()
  }

  private finishLegacyMigration(checksum: string) {
    this.patchMeta({ legacyMigrated: true, legacyImportedChecksum: checksum })
    clearLegacyLocalMeta(this.env.storage)
  }

  /** Sau khi push v3 lần đầu thành công: lưu bản cũ vào kho và thay key cũ bằng marker rỗng. */
  private async supersedeLegacyIfNeeded(redis: SyncRedis) {
    try {
      const legacy = await readLegacySnapshot(redis)
      if (!legacy || legacy.supersededBy || legacy.keyCount === 0) return
      await archiveLegacyAndMarkSuperseded(redis, legacy.raw, this.env.now())
      this.patchMeta({ legacyImportedChecksum: legacy.checksum })
    } catch {
      // best-effort
    }
  }

  private async checkLegacyChanged(redis: SyncRedis, meta: SyncMeta) {
    let legacy
    try {
      legacy = await readLegacySnapshot(redis)
    } catch {
      return
    }
    if (!legacy || legacy.keyCount === 0 || legacy.supersededBy) return
    if (legacy.checksum === meta.legacyImportedChecksum) return
    const remote = docFromLegacyValues(legacy.values)
    if (!remote) return
    const local = this.buildLocalDoc()
    const nowIso = new Date(this.env.now()).toISOString()
    const union = threeWayMerge(null, local, remote, { now: nowIso })
    if (!union.stats.changed) {
      this.patchMeta({ legacyImportedChecksum: legacy.checksum })
      return
    }
    this.openDialog({
      kind: "legacy-changed",
      remoteVersion: this.state.remoteVersion,
      remoteDoc: remote,
      mergedDoc: union.merged,
      conflicts: union.conflicts,
      stats: this.guardStats(local, union.merged, union.stats.remoteAdded),
      legacyChecksum: legacy.checksum,
    })
    throw new SyncAbort()
  }

  // ----- PUSH --------------------------------------------------------------

  private async push(): Promise<void> {
    if (this.stopped) return
    const config = this.env.getConfig()
    if (config.mode !== "upstash" || !config.upstash) return
    if (!this.state.pushGate || this.state.dialog || !this.env.isOnline()) return
    if (["auth-error", "unsupported", "paused"].includes(this.state.phase)) return

    this.setState({ inFlight: true, phase: "syncing" })
    try {
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        const pre = await this.pullSafely("pre-push", this.env.requestTimeoutMs)
        if (!pre.ok) return
        if (!this.isDirty()) {
          this.patchMeta({ dirty: false, dirtySince: undefined })
          this.setState({ phase: "idle" })
          return
        }
        const redis = await this.redis()
        const meta = this.meta()
        this.store.flushPendingSave()
        const local = this.buildLocalDoc()
        const hash = hashDoc(local)
        // Mốc thời gian đã hiệu chỉnh theo giờ server (đo lúc boot) để retention lịch sử không bị
        // một máy đặt sai giờ làm lệch.
        const committedAt = this.env.now() + getClockSkewMs()
        const expected = meta.baseVersion
        const snapshot: SnapshotV3 = {
          schema: SYNC_SCHEMA,
          version: expected + 1,
          contentHash: hash,
          committedAt,
          deviceId: meta.deviceId,
          data: stripDocForUpload(local),
        }
        const encoded = await encodeSnapshot(snapshot)
        if (estimateRequestBytes(encoded.payload) > this.env.maxRequestBytes) {
          this.setState({ phase: "too-large", lastError: "Dữ liệu vượt giới hạn dung lượng một lần đồng bộ của Upstash. Thay đổi vẫn được lưu trên máy này." })
          this.patchMeta({ lastError: this.state.lastError })
          return
        }
        const genesisCandidate = meta.genesisId ?? `gen_${meta.deviceId}_${committedAt.toString(36)}`
        const head: HeadV3 = {
          schema: SYNC_SCHEMA,
          version: expected + 1,
          contentHash: hash,
          genesisId: genesisCandidate,
          deviceId: meta.deviceId,
          deviceLabel: meta.deviceLabel,
          committedAt,
          bytes: encoded.bytes,
          enc: encoded.enc,
          appBuild: this.env.appBuild,
        }
        const result = await withTimeout(
          casCommit(redis, {
            expectedVersion: expected,
            payload: encoded.payload,
            head,
            nowMs: committedAt,
            genesisCandidate,
            maxBytes: this.env.maxRequestBytes,
          }),
          this.env.requestTimeoutMs * 2,
          "push",
        )

        if (result.status === "ok") {
          writeBase(this.env.storage, local)
          this.notePersisted(local.cttm)
          this.patchMeta({
            baseVersion: result.version,
            baseHash: hash,
            genesisId: result.genesisId || genesisCandidate,
            dirty: false,
            dirtySince: undefined,
            lastPushAt: this.env.now(),
            lastError: undefined,
            baseUntrusted: false,
          })
          this.setState({ phase: "idle", remoteVersion: result.version, remoteDeviceLabel: meta.deviceLabel, remoteCommittedAt: committedAt })
          if (expected === 0) await this.supersedeLegacyIfNeeded(redis)
          return
        }
        if (result.status === "too-large") {
          this.setState({ phase: "too-large", lastError: "Redis từ chối vì snapshot quá lớn." })
          return
        }
        // CAS trượt. Nếu head hiện tại chính là bản mình vừa gửi (mất response) thì coi như xong.
        if (result.head && result.head.deviceId === meta.deviceId && result.head.contentHash === hash) {
          writeBase(this.env.storage, local)
          this.notePersisted(local.cttm)
          this.patchMeta({ baseVersion: result.version, baseHash: hash, genesisId: result.head.genesisId, dirty: false, dirtySince: undefined, lastPushAt: this.env.now(), baseUntrusted: false })
          this.setState({ phase: "idle", remoteVersion: result.version })
          return
        }
        this.setState({ remoteVersion: result.version })
        // vòng lặp: pullSafely ở đầu vòng sẽ merge bản mới rồi thử lại
      }
      this.setState({ phase: "contended", lastError: "Thiết bị khác đang ghi liên tục; sẽ thử lại sau." })
      this.schedulePush(30_000)
    } catch (error) {
      this.recordError(error)
    } finally {
      this.setState({ inFlight: false })
      if (this.state.phase === "syncing") this.setState({ phase: "idle" })
    }
  }

  // ----- dialogs -----------------------------------------------------------

  private openDialog(input: Omit<SyncDialog, "id" | "localDoc">) {
    this.dialogSeq += 1
    const dialog: SyncDialog = { ...input, id: this.dialogSeq, localDoc: this.buildLocalDoc() }
    this.setState({ dialog, phase: "conflict", pushGate: false })
  }

  resolveDialog(choice: SyncDialogChoice, dialogId?: number): Promise<void> {
    const dialog = this.state.dialog
    if (!dialog) return Promise.resolve()
    // UI có thể bấm vào một hộp thoại đã bị thay bằng hộp thoại khác (wake/poll) → bỏ qua.
    if (dialogId !== undefined && dialog.id !== dialogId) return Promise.resolve()
    return this.runExclusive(async () => {
      this.setState({ dialog: null, inFlight: true })
      try {
        await this.applyDialogChoice(dialog, choice)
      } catch (error) {
        if (!(error instanceof SyncAbort)) this.recordError(error)
      } finally {
        this.setState({ inFlight: false })
        if (!this.state.dialog && this.state.phase === "conflict") this.setState({ phase: "idle" })
      }
    })
  }

  /** Gộp lại từ bản local HIỆN TẠI (có thể đã đổi trong lúc hộp thoại mở), không dùng bản chụp lúc mở. */
  private recomputeUnion(remote: SyncDoc, nowIso: string): MergeResult {
    this.store.flushPendingSave()
    return threeWayMerge(null, this.buildLocalDoc(), remote, { now: nowIso })
  }

  private async applyDialogChoice(dialog: SyncDialog, choice: SyncDialogChoice) {
    const nowMs = this.env.now()
    const nowIso = new Date(nowMs).toISOString()
    const localSnapshotForHistory = () => {
      this.store.flushPendingSave()
      pushLocalHistory(this.env.storage, { at: nowMs, reason: `before-${dialog.kind}-${choice}`, version: dialog.remoteVersion, doc: this.buildLocalDoc() })
    }

    if (choice === "pause") {
      this.setState({ phase: "paused", pushGate: false })
      this.allowDerivedWrites()
      return
    }

    switch (dialog.kind) {
      case "migrate-v2": {
        const legacyChecksum = dialog.legacyChecksum ?? ""
        if (choice === "use-remote" && dialog.remoteDoc) {
          localSnapshotForHistory()
          this.applyDoc(dialog.remoteDoc)
        } else if (choice === "merge" && dialog.remoteDoc) {
          localSnapshotForHistory()
          const union = this.recomputeUnion(dialog.remoteDoc, nowIso)
          this.applyDoc(union.merged)
          if (union.conflicts.length) appendConflicts(this.env.storage, union.conflicts)
        }
        this.finishLegacyMigration(legacyChecksum)
        this.setState({ pushGate: true, conflictsCount: readConflicts(this.env.storage).length })
        this.allowDerivedWrites()
        await this.push()
        return
      }
      case "legacy-changed": {
        if (choice === "merge" && dialog.remoteDoc) {
          localSnapshotForHistory()
          const union = this.recomputeUnion(dialog.remoteDoc, nowIso)
          this.applyDoc(union.merged)
          if (union.conflicts.length) appendConflicts(this.env.storage, union.conflicts)
        }
        this.patchMeta({ legacyImportedChecksum: dialog.legacyChecksum })
        // Đặt lại marker để build cũ tiếp tục coi remote là rỗng (không tải về/xoá local của nó).
        try {
          await markLegacySuperseded(await this.redis(), nowMs)
        } catch {
          // best-effort
        }
        this.setState({ pushGate: true, conflictsCount: readConflicts(this.env.storage).length })
        this.allowDerivedWrites()
        const outcome = await this.pullSafely("after-legacy", this.env.requestTimeoutMs)
        if (outcome.ok && this.isDirty()) await this.push()
        return
      }
      case "no-base":
      case "mass-delete": {
        if (!dialog.remoteHead || !dialog.remoteDoc) return
        const redis = await this.redis()
        if (choice === "keep-local") {
          // Ghim bản remote để không bao giờ mất, rồi cho local thắng qua CAS.
          await pinVersion(redis, dialog.remoteVersion)
          writeBase(this.env.storage, dialog.remoteDoc)
          this.patchMeta({ baseVersion: dialog.remoteVersion, baseHash: dialog.remoteHead.contentHash, genesisId: dialog.remoteHead.genesisId, dirty: true, dirtySince: nowMs })
          this.setState({ pushGate: true })
          this.allowDerivedWrites()
          await this.push()
          return
        }
        localSnapshotForHistory()
        const currentLocal = this.buildLocalDoc()
        let target: SyncDoc
        let conflicts: ConflictEntry[] = []
        if (choice === "use-remote") {
          target = dialog.remoteDoc
        } else {
          // Gộp lại từ local hiện tại; dùng base nếu còn đáng tin, không thì union.
          const meta = this.meta()
          const base = meta.baseVersion > 0 && !meta.baseUntrusted ? readBase(this.env.storage) : null
          const result = threeWayMerge(base, currentLocal, dialog.remoteDoc, { now: nowIso, remoteVersion: dialog.remoteVersion })
          target = result.merged
          conflicts = result.conflicts
        }
        this.commitPull({ local: currentLocal, merged: target, remote: dialog.remoteDoc, head: dialog.remoteHead, conflicts })
        this.setState({ pushGate: true })
        this.allowDerivedWrites()
        if (this.isDirty()) await this.push()
        return
      }
      case "remote-reset": {
        const redis = await this.redis()
        if (choice === "use-remote" && dialog.remoteVersion > 0) {
          localSnapshotForHistory()
          this.patchMeta({ baseVersion: 0, baseHash: undefined, genesisId: undefined, dirty: false })
          writeBase(this.env.storage, null)
          const { head, payload } = await readHeadAndSnapshot(redis, dialog.remoteVersion)
          const snapshot = payload ? await decodeSnapshot(payload) : null
          if (!head || !snapshot) throw new Error("Không đọc được bản trên Redis.")
          const remote = docFromSnapshotData(snapshot.data)
          this.commitPull({ local: this.buildLocalDoc(), merged: remote, remote, head, conflicts: [] })
          this.setState({ pushGate: true })
          this.allowDerivedWrites()
          return
        }
        // push-local: coi remote hiện tại là điểm xuất phát mới, local sẽ ghi lên qua CAS.
        const genesis = (await readGenesis(redis)) ?? undefined
        writeBase(this.env.storage, null)
        this.patchMeta({ baseVersion: dialog.remoteVersion, baseHash: undefined, genesisId: genesis, dirty: true, dirtySince: nowMs })
        this.setState({ pushGate: true })
        this.allowDerivedWrites()
        await this.push()
        return
      }
      default:
        return
    }
  }

  // ----- history / restore / pins -------------------------------------------

  async listRemoteHistory(): Promise<HistoryEntry[]> {
    const redis = await this.redis()
    return withTimeout(listHistory(redis), this.env.requestTimeoutMs, "history")
  }

  async pinRemoteVersion(version: number, pinned: boolean) {
    const redis = await this.redis()
    if (pinned) await pinVersion(redis, version)
    else await unpinVersion(redis, version)
  }

  /** Ghim head hiện tại trước các thao tác phá huỷ (import/reset). Trả về false nếu không làm được. */
  async pinHead(): Promise<boolean> {
    if (this.state.mode !== "upstash") return true
    try {
      const redis = await this.redis()
      const version = await withTimeout(readVersion(redis), this.env.requestTimeoutMs, "pinHead")
      if (version > 0) await pinVersion(redis, version)
      return true
    } catch {
      return false
    }
  }

  /**
   * Chuẩn bị bản khôi phục.
   * - "replace": người dùng tái khẳng định TOÀN BỘ bản cũ → mọi entity/mẫu trong bản khôi phục
   *   nhận updatedAt = now (thắng mọi tombstone ở mọi thiết bị, kể cả xoá xảy ra sau bản đó);
   *   mục hiện có nhưng không nằm trong bản khôi phục được ghi tombstone (như import).
   * - "merge": chỉ lấy lại entity/mẫu đang thiếu; settings, cấu hình tháng, danh mục... giữ nguyên
   *   bản hiện tại.
   */
  private prepareRestoreTarget(local: SyncDoc, restored: SyncDoc, mode: "replace" | "merge", nowIso: string): SyncDoc {
    const kinds = ["expenses", "fixedCosts", "purchasePlans", "savingsTransactions"] as const
    const localTomb = local.cttm.tombstones ?? {}
    const revivedTomb: Record<string, string> = { ...(restored.cttm.tombstones ?? {}) }
    const entities = { ...restored.cttm.entities }
    for (const kind of kinds) {
      const table = restored.cttm.entities[kind]
      const byId: Record<string, { id: string; updatedAt: string }> = {}
      for (const id of table.allIds) {
        const entity = table.byId[id] as { id: string; updatedAt: string }
        const deletedLocally = !local.cttm.entities[kind].byId[id] || !!localTomb[id]
        byId[id] = mode === "replace" || deletedLocally ? { ...entity, updatedAt: nowIso } : entity
        delete revivedTomb[id]
      }
      ;(entities as Record<string, unknown>)[kind] = { byId, allIds: [...table.allIds] }
    }
    const localTemplateIds = new Set(local.templates.items.map((item) => item.id))
    const templates: SyncedTemplates = {
      items: restored.templates.items.map((item) =>
        mode === "replace" || !localTemplateIds.has(item.id) ? { ...item, updatedAt: nowIso } : item,
      ),
      tombstones: { ...(restored.templates.tombstones ?? {}) },
    }
    for (const item of templates.items) delete templates.tombstones[item.id]

    if (mode === "replace") {
      for (const kind of kinds) {
        for (const id of local.cttm.entities[kind].allIds) {
          if (!(entities[kind] as { byId: Record<string, unknown> }).byId[id]) revivedTomb[id] = nowIso
        }
      }
      const restoredTemplateIds = new Set(templates.items.map((item) => item.id))
      for (const item of local.templates.items) if (!restoredTemplateIds.has(item.id)) templates.tombstones[item.id] = nowIso
      return { cttm: { ...restored.cttm, entities, tombstones: revivedTomb }, templates }
    }

    const revived: SyncDoc = { cttm: { ...restored.cttm, entities, tombstones: revivedTomb }, templates }
    const localWithoutTomb: SyncDoc = {
      cttm: { ...local.cttm, tombstones: Object.fromEntries(Object.entries(localTomb).filter(([id]) => !this.docHasId(revived, id))) },
      templates: local.templates,
    }
    const union = threeWayMerge(null, localWithoutTomb, revived, { now: nowIso }).merged
    // Chỉ entity/mẫu được gộp; phần cấu hình giữ nguyên bản hiện tại.
    return {
      cttm: {
        ...union.cttm,
        settings: local.cttm.settings,
        settingsByMonth: local.cttm.settingsByMonth,
        budgetAdjustmentsByMonth: local.cttm.budgetAdjustmentsByMonth,
        capsByMonth: local.cttm.capsByMonth,
        monthLocksByMonth: local.cttm.monthLocksByMonth,
        accountBalanceReconciliationsByMonth: local.cttm.accountBalanceReconciliationsByMonth,
        emergencyFundOpeningSourcesByMonth: local.cttm.emergencyFundOpeningSourcesByMonth,
      },
      templates: union.templates,
    }
  }

  private docHasId(doc: SyncDoc, id: string) {
    for (const kind of ["expenses", "fixedCosts", "purchasePlans", "savingsTransactions"] as const) {
      if (doc.cttm.entities[kind].byId[id]) return true
    }
    return false
  }

  async restoreRemoteVersion(version: number, mode: "replace" | "merge"): Promise<void> {
    await this.runExclusive(async () => {
      const redis = await this.redis()
      const payload = await withTimeout(readSnapshotPayload(redis, version), this.env.requestTimeoutMs, "restore")
      const snapshot = payload ? await decodeSnapshot(payload) : null
      if (!snapshot) throw new Error("Không đọc được bản này trên Redis.")
      const remote = docFromSnapshotData(snapshot.data)
      const local = this.buildLocalDoc()
      pushLocalHistory(this.env.storage, { at: this.env.now(), reason: `before-restore-${version}`, version, doc: local })
      await this.pinHead()
      const nowIso = new Date(this.env.now()).toISOString()
      const target = this.prepareRestoreTarget(local, remote, mode, nowIso)
      this.applyDoc(target)
      this.patchMeta({ dirty: true, dirtySince: this.env.now() })
      this.setState({ pushGate: true })
      await this.push()
    })
  }

  getLocalHistory(): LocalHistoryEntry[] {
    return readLocalHistory(this.env.storage)
  }

  async restoreLocalHistory(index: number, mode: "replace" | "merge"): Promise<void> {
    await this.runExclusive(async () => {
      const entry = readLocalHistory(this.env.storage)[index]
      if (!entry) throw new Error("Không tìm thấy bản lưu này.")
      const local = this.buildLocalDoc()
      pushLocalHistory(this.env.storage, { at: this.env.now(), reason: `before-local-restore`, version: entry.version, doc: local })
      if (this.state.mode === "upstash") await this.pinHead()
      const nowIso = new Date(this.env.now()).toISOString()
      const target = this.prepareRestoreTarget(local, entry.doc, mode, nowIso)
      this.applyDoc(target)
      if (this.state.mode === "upstash") {
        this.patchMeta({ dirty: true, dirtySince: this.env.now() })
        this.setState({ pushGate: true })
        await this.push()
      }
    })
  }

  getConflicts(): ConflictEntry[] {
    return readConflicts(this.env.storage)
  }

  clearConflictLog() {
    clearConflicts(this.env.storage)
    this.setState({ conflictsCount: 0 })
  }
}
