export type DataSourceMode = "localStorage" | "upstash"

export type UpstashConfig = {
  url: string
  token: string
}

export type DataSourceConfig = {
  mode: DataSourceMode
  upstash?: UpstashConfig
  updatedAt: number
}

export type StorageManifest = {
  schemaVersion: 1
  revision: number
  updatedAt: number
  keyCount: number
  keys: string[]
  checksum: string
  keyPrefix?: string
}

export type StorageComparison = {
  local: StorageManifest
  remote: StorageManifest | null
  remoteHasData: boolean
  relation: "same" | "local-newer" | "remote-newer" | "diverged" | "remote-empty"
}

export const DATA_SOURCE_CONFIG_KEY = "smartSpend.storage.config.v1"
export const DATA_SOURCE_LOCAL_META_KEY = "smartSpend.storage.localMeta.v1"
export const DATA_SOURCE_LAST_SYNC_KEY = "smartSpend.storage.lastSync.v1"

const REMOTE_MANIFEST_KEY = "myfinance:storage:manifest"
const LEGACY_REMOTE_KEY_PREFIX = "myfinance:storage:key:"
const REMOTE_VERSION_KEY_PREFIX = "myfinance:storage:version:"

const INTERNAL_KEYS = new Set([
  DATA_SOURCE_CONFIG_KEY,
  DATA_SOURCE_LOCAL_META_KEY,
  DATA_SOURCE_LAST_SYNC_KEY,
])

const APP_DATA_PREFIXES = ["cttm_", "smartSpend.", "expenses."]
const STORAGE_EVENT_NAME = "myfinance-storage-sync"

let suppressMirror = false
let patchInstalled = false
let uploadTimer: number | null = null
let uploadInFlight = false
let uploadAgain = false

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined"
const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null

export class StorageSyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = "StorageSyncError"
    this.cause = options?.cause
  }
}

export function isAppDataKey(key: string) {
  if (INTERNAL_KEYS.has(key)) return false
  return APP_DATA_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function dispatchDataSourceEvent() {
  if (!isBrowser()) return
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME))
}

export function addDataSourceListener(listener: () => void) {
  if (!isBrowser()) return () => {}
  window.addEventListener(STORAGE_EVENT_NAME, listener)
  return () => window.removeEventListener(STORAGE_EVENT_NAME, listener)
}

export function sanitizeUpstashConfig(config: UpstashConfig): UpstashConfig {
  return {
    url: stripInputValue(config.url).replace(/\/+$/, ""),
    token: stripInputValue(config.token),
  }
}

function extractEnvValue(input: string, envName: string) {
  const escapedName = envName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = input.match(new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s\\r\\n]+))`))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function stripInputValue(input: string) {
  let value = input.trim()
  const assignment = value.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/s)
  if (assignment) value = assignment[1].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

export function parseUpstashConfigInput(urlInput: string, tokenInput: string): UpstashConfig {
  const combined = `${urlInput}\n${tokenInput}`
  return sanitizeUpstashConfig({
    url: extractEnvValue(combined, "UPSTASH_REDIS_REST_URL") ?? urlInput,
    token: extractEnvValue(combined, "UPSTASH_REDIS_REST_TOKEN") ?? tokenInput,
  })
}

async function createRedis(config: UpstashConfig) {
  const { Redis } = await import("@upstash/redis/cloudflare")
  const sanitized = sanitizeUpstashConfig(config)
  return new Redis({
    url: sanitized.url,
    token: sanitized.token,
    automaticDeserialization: false,
    enableTelemetry: false,
    keepAlive: false,
    readYourWrites: true,
  })
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

function checksum(values: Record<string, string>) {
  const input = stableStringify(values)
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

function nextRevision(previous = 0) {
  const now = Date.now()
  return now > previous ? now : previous + 1
}

export function getDataSourceConfig(): DataSourceConfig {
  if (!isBrowser()) return { mode: "localStorage", updatedAt: Date.now() }
  const config = safeParse<DataSourceConfig | null>(
    localStorage.getItem(DATA_SOURCE_CONFIG_KEY),
    null,
  )
  if (!config || (config.mode !== "localStorage" && config.mode !== "upstash")) {
    return { mode: "localStorage", updatedAt: Date.now() }
  }
  return config
}

export function saveDataSourceConfig(config: DataSourceConfig) {
  if (!isBrowser()) return
  localStorage.setItem(DATA_SOURCE_CONFIG_KEY, JSON.stringify(config))
  dispatchDataSourceEvent()
}

export function setDataSourceMode(mode: DataSourceMode, upstash?: UpstashConfig) {
  const current = getDataSourceConfig()
  saveDataSourceConfig({
    mode,
    upstash: upstash ? sanitizeUpstashConfig(upstash) : current.upstash,
    updatedAt: Date.now(),
  })
}

type LocalMeta = { revision: number; updatedAt: number }
type LastSyncMeta = { direction: "upload" | "download"; revision: number; updatedAt: number; checksum?: string }

function getLocalMeta(): LocalMeta {
  if (!isBrowser()) return { revision: 0, updatedAt: 0 }
  return safeParse<LocalMeta>(localStorage.getItem(DATA_SOURCE_LOCAL_META_KEY), {
    revision: 0,
    updatedAt: 0,
  })
}

function setLocalMeta(meta: LocalMeta) {
  if (!isBrowser()) return
  localStorage.setItem(DATA_SOURCE_LOCAL_META_KEY, JSON.stringify(meta))
}

function setLastSyncMeta(meta: LastSyncMeta) {
  if (!isBrowser()) return
  localStorage.setItem(DATA_SOURCE_LAST_SYNC_KEY, JSON.stringify(meta))
}

export function bumpLocalRevision() {
  const current = getLocalMeta()
  const next = { revision: nextRevision(current.revision), updatedAt: Date.now() }
  setLocalMeta(next)
  return next
}

export function collectLocalSnapshot(ensureMeta = true) {
  const values: Record<string, string> = {}
  if (!isBrowser()) {
    return buildSnapshot(values, { revision: 0, updatedAt: 0 })
  }

  if (ensureMeta && getLocalMeta().revision === 0) {
    const hasData = collectLocalSnapshot(false).manifest.keyCount > 0
    if (hasData) setLocalMeta({ revision: Date.now(), updatedAt: Date.now() })
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !isAppDataKey(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) values[key] = value
  }

  return buildSnapshot(values, getLocalMeta())
}

function buildSnapshot(values: Record<string, string>, meta: LocalMeta) {
  const keys = Object.keys(values).sort()
  return {
    values,
    manifest: {
      schemaVersion: 1 as const,
      revision: meta.revision,
      updatedAt: meta.updatedAt,
      keyCount: keys.length,
      keys,
      checksum: checksum(values),
    },
  }
}

export async function testUpstashConnection(config: UpstashConfig) {
  const redis = await createRedis(config)
  try {
    await redis.ping()
  } catch (error) {
    throw new StorageSyncError(
      getStorageErrorMessage(error, "Không thể kết nối Upstash Redis. Hãy kiểm tra REST URL và token."),
      { cause: error },
    )
  }
}

function parseRemoteValue<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") return safeParse(value, fallback)
  if (value && typeof value === "object") return value as T
  return fallback
}

export async function getRemoteManifest(config: UpstashConfig): Promise<StorageManifest | null> {
  const redis = await createRedis(config)
  const raw = await redis.get(REMOTE_MANIFEST_KEY)
  const manifest = parseRemoteValue<StorageManifest | null>(raw, null)
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.keys)) {
    return null
  }
  return manifest
}

const remoteValueKey = (key: string, manifest?: Pick<StorageManifest, "keyPrefix">) =>
  `${manifest?.keyPrefix ?? LEGACY_REMOTE_KEY_PREFIX}${encodeURIComponent(key)}`

const remoteVersionKeyPrefix = (revision: number) => `${REMOTE_VERSION_KEY_PREFIX}${revision}:key:`

type RedisClient = Awaited<ReturnType<typeof createRedis>>

async function cleanupRemoteSnapshot(redis: RedisClient, manifest: StorageManifest | null, keepKeyPrefix: string) {
  if (!manifest || (manifest.keyPrefix ?? LEGACY_REMOTE_KEY_PREFIX) === keepKeyPrefix) return

  for (const key of manifest.keys) {
    await redis.del(remoteValueKey(key, manifest))
  }
}

export async function uploadLocalToUpstash(config: UpstashConfig) {
  const redis = await createRedis(config)
  const snapshot = collectLocalSnapshot(true)
  const updatedAt = Date.now()
  const revision = nextRevision(snapshot.manifest.revision)
  const keyPrefix = remoteVersionKeyPrefix(revision)
  const manifest: StorageManifest = {
    ...snapshot.manifest,
    revision,
    updatedAt,
    keyPrefix,
  }

  const previousManifest = await getRemoteManifest(config)
  for (const [key, value] of Object.entries(snapshot.values)) {
    try {
      await redis.set(remoteValueKey(key, manifest), value)
    } catch (error) {
      throw new StorageSyncError(
        `Không thể ghi key "${key}" (${formatBytes(byteLength(value))}) lên Redis. ${getStorageErrorMessage(
          error,
          "Redis từ chối thao tác ghi.",
        )}`,
        { cause: error },
      )
    }
  }

  try {
    await redis.set(REMOTE_MANIFEST_KEY, JSON.stringify(manifest))
  } catch (error) {
    throw new StorageSyncError(
      `Dữ liệu đã ghi xong nhưng không thể ghi manifest đồng bộ. ${getStorageErrorMessage(
        error,
        "Redis từ chối thao tác ghi manifest.",
      )}`,
      { cause: error },
    )
  }

  try {
    await cleanupRemoteSnapshot(redis, previousManifest, keyPrefix)
  } catch (error) {
    console.warn("Uploaded new Redis snapshot but could not clean previous snapshot:", error)
  }

  setLocalMeta({ revision, updatedAt })
  setLastSyncMeta({ direction: "upload", revision, updatedAt, checksum: manifest.checksum })
  dispatchDataSourceEvent()
  return manifest
}

function byteLength(value: string) {
  return textEncoder ? textEncoder.encode(value).length : value.length
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function getStorageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof StorageSyncError) return error.message

  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = rawMessage.replace(/command was: .+$/i, "").trim()
  const normalized = message.toLowerCase()

  if (normalized.includes("invalid url") || normalized.includes("should pass a url starting with https")) {
    return "REST URL không hợp lệ. Hãy dùng URL bắt đầu bằng https:// từ Upstash."
  }
  if (normalized.includes("unauthorized") || normalized.includes("wrongpass") || normalized.includes("invalid token")) {
    return "REST token không hợp lệ hoặc đã hết quyền truy cập."
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
    return "Trình duyệt không gọi được Upstash Redis. Hãy kiểm tra mạng, ad-blocker/proxy, hoặc thử tải lại trang."
  }
  if (normalized.includes("max request size")) {
    return "Một phần dữ liệu vượt giới hạn request của Upstash Redis. Cần tách dữ liệu thành nhiều phần nhỏ hơn."
  }
  if (normalized.includes("max daily request limit")) {
    return "Upstash Redis đã vượt giới hạn request trong ngày."
  }
  if (normalized.includes("rate limit")) {
    return "Upstash Redis đang giới hạn tần suất request. Hãy thử lại sau."
  }

  return fallback
}

export async function downloadUpstashToLocal(config: UpstashConfig) {
  const redis = await createRedis(config)
  const manifest = await getRemoteManifest(config)
  if (!manifest) return null

  const remoteValues: Record<string, string> = {}
  const missingKeys: string[] = []
  for (const key of manifest.keys) {
    const value = await redis.get(remoteValueKey(key, manifest))
    if (typeof value === "string") {
      remoteValues[key] = value
    } else if (value !== null && value !== undefined) {
      remoteValues[key] = JSON.stringify(value)
    } else {
      missingKeys.push(key)
    }
  }

  if (missingKeys.length > 0) {
    throw new StorageSyncError(
      `Manifest Redis đang trỏ tới ${missingKeys.length} key không còn tồn tại. LocalStorage chưa bị thay đổi.`,
    )
  }

  if (Object.keys(remoteValues).length !== manifest.keyCount || checksum(remoteValues) !== manifest.checksum) {
    throw new StorageSyncError(
      "Dữ liệu Redis không khớp manifest đồng bộ. LocalStorage chưa bị thay đổi.",
    )
  }

  const localSnapshot = collectLocalSnapshot(false)
  const previousMeta = getLocalMeta()
  const previousLastSync = localStorage.getItem(DATA_SOURCE_LAST_SYNC_KEY)
  const remoteKeySet = new Set(manifest.keys)

  try {
    withStorageMirrorSuppressed(() => {
      for (const [key, value] of Object.entries(remoteValues)) {
        localStorage.setItem(key, value)
      }
      for (const key of localSnapshot.manifest.keys) {
        if (!remoteKeySet.has(key)) localStorage.removeItem(key)
      }
      setLocalMeta({ revision: manifest.revision, updatedAt: manifest.updatedAt })
      setLastSyncMeta({
        direction: "download",
        revision: manifest.revision,
        updatedAt: Date.now(),
        checksum: manifest.checksum,
      })
    })
  } catch (error) {
    try {
      withStorageMirrorSuppressed(() => {
        for (const key of manifest.keys) {
          if (!Object.prototype.hasOwnProperty.call(localSnapshot.values, key)) localStorage.removeItem(key)
        }
        for (const [key, value] of Object.entries(localSnapshot.values)) {
          localStorage.setItem(key, value)
        }
        setLocalMeta(previousMeta)
        if (previousLastSync === null) {
          localStorage.removeItem(DATA_SOURCE_LAST_SYNC_KEY)
        } else {
          localStorage.setItem(DATA_SOURCE_LAST_SYNC_KEY, previousLastSync)
        }
      })
    } catch (rollbackError) {
      throw new StorageSyncError(
        "Không thể ghi Redis về localStorage và cũng không thể khôi phục đầy đủ dữ liệu local trước đó.",
        { cause: rollbackError },
      )
    }

    throw new StorageSyncError(
      `Không thể ghi Redis về localStorage. Dữ liệu local trước đó đã được khôi phục. ${getStorageErrorMessage(
        error,
        "Trình duyệt từ chối ghi dữ liệu vào localStorage.",
      )}`,
      { cause: error },
    )
  }
  dispatchDataSourceEvent()
  return manifest
}

export async function compareLocalAndRemote(config: UpstashConfig): Promise<StorageComparison> {
  const local = collectLocalSnapshot(true).manifest
  const remote = await getRemoteManifest(config)
  const remoteHasData = Boolean(remote && remote.keyCount > 0)

  if (!remoteHasData || !remote) {
    return { local, remote, remoteHasData: false, relation: "remote-empty" }
  }
  if (local.checksum === remote.checksum && local.keyCount === remote.keyCount) {
    return { local, remote, remoteHasData, relation: "same" }
  }
  if (local.revision > remote.revision) {
    return { local, remote, remoteHasData, relation: "local-newer" }
  }
  if (remote.revision > local.revision) {
    return { local, remote, remoteHasData, relation: "remote-newer" }
  }
  return { local, remote, remoteHasData, relation: "diverged" }
}

export function withStorageMirrorSuppressed<T>(fn: () => T): T {
  suppressMirror = true
  try {
    return fn()
  } finally {
    suppressMirror = false
  }
}

function scheduleUpload() {
  if (suppressMirror || !isBrowser()) return
  const config = getDataSourceConfig()
  if (config.mode !== "upstash" || !config.upstash) return

  if (uploadTimer !== null) window.clearTimeout(uploadTimer)
  uploadTimer = window.setTimeout(() => {
    uploadTimer = null
    void flushUpload()
  }, 900)
}

async function flushUpload() {
  if (uploadInFlight) {
    uploadAgain = true
    return
  }

  const config = getDataSourceConfig()
  if (config.mode !== "upstash" || !config.upstash) return

  uploadInFlight = true
  try {
    await uploadLocalToUpstash(config.upstash)
  } catch (error) {
    console.error("Failed to mirror localStorage to Upstash Redis:", error)
  } finally {
    uploadInFlight = false
    if (uploadAgain) {
      uploadAgain = false
      scheduleUpload()
    }
  }
}

export function installStorageWriteThrough() {
  if (patchInstalled || !isBrowser()) return
  patchInstalled = true

  const originalSetItem = Storage.prototype.setItem
  const originalRemoveItem = Storage.prototype.removeItem
  const originalClear = Storage.prototype.clear

  Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
    originalSetItem.call(this, key, value)
    if (this !== window.localStorage || suppressMirror || !isAppDataKey(key)) return
    bumpLocalRevision()
    dispatchDataSourceEvent()
    scheduleUpload()
  }

  Storage.prototype.removeItem = function patchedRemoveItem(key: string) {
    originalRemoveItem.call(this, key)
    if (this !== window.localStorage || suppressMirror || !isAppDataKey(key)) return
    bumpLocalRevision()
    dispatchDataSourceEvent()
    scheduleUpload()
  }

  Storage.prototype.clear = function patchedClear() {
    const appKeys: string[] = []
    if (this === window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (key && isAppDataKey(key)) appKeys.push(key)
      }
    }

    originalClear.call(this)
    if (this !== window.localStorage || suppressMirror || appKeys.length === 0) return
    bumpLocalRevision()
    dispatchDataSourceEvent()
    scheduleUpload()
  }
}

installStorageWriteThrough()
