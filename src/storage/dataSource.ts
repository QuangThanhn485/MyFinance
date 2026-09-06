/**
 * Cấu hình nguồn dữ liệu (localStorage | Upstash Redis).
 *
 * Từ Sync v3, file này CHỈ giữ cấu hình và các helper tiện ích. Toàn bộ logic
 * đồng bộ nằm ở src/sync/* — không còn monkey-patch Storage.prototype, không còn
 * upload/download ghi đè mù.
 */

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

export const DATA_SOURCE_CONFIG_KEY = "smartSpend.storage.config.v1"
export const DATA_SOURCE_CHANGED_EVENT = "myfinance-storage-sync"

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined"

export class StorageSyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = "StorageSyncError"
    this.cause = options?.cause
  }
}

export function dispatchDataSourceEvent() {
  if (!isBrowser()) return
  window.dispatchEvent(new CustomEvent(DATA_SOURCE_CHANGED_EVENT))
}

export function addDataSourceListener(listener: () => void) {
  if (!isBrowser()) return () => {}
  window.addEventListener(DATA_SOURCE_CHANGED_EVENT, listener)
  return () => window.removeEventListener(DATA_SOURCE_CHANGED_EVENT, listener)
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
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

export function getDataSourceConfig(): DataSourceConfig {
  if (!isBrowser()) return { mode: "localStorage", updatedAt: Date.now() }
  const config = safeParse<DataSourceConfig | null>(localStorage.getItem(DATA_SOURCE_CONFIG_KEY), null)
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
    return "Dữ liệu vượt giới hạn request của Upstash Redis."
  }
  if (normalized.includes("max daily request limit")) {
    return "Upstash Redis đã vượt giới hạn request trong ngày."
  }
  if (normalized.includes("rate limit")) {
    return "Upstash Redis đang giới hạn tần suất request. Hãy thử lại sau."
  }

  return fallback
}
