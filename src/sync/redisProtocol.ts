import { getStorageErrorMessage, sanitizeUpstashConfig, type UpstashConfig } from "@/storage/dataSource"
import { legacyChecksum, type HeadV3 } from "@/sync/snapshot"

/**
 * Kết nối Upstash Redis + các hàm ĐỌC dữ liệu của cơ chế cũ (Sync v3 snapshot, v2) để chuyển
 * đổi lên sổ cái v4. Không còn hàm nào ghi theo kiểu snapshot.
 */

export const REDIS_KEYS = {
  version: "mf3:version",
  head: "mf3:head",
  genesis: "mf3:genesis",
  snapPrefix: "mf3:snap:",
  legacySnapshot: "myfinance:storage:snapshot",
} as const

/** Tập lệnh tối thiểu app cần. FakeRedis trong test cũng implement đúng interface này. */
export interface SyncRedis {
  ping(): Promise<unknown>
  get(key: string): Promise<unknown>
  set(key: string, value: string, opts?: { nx?: boolean }): Promise<unknown>
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>
  mget(...keys: string[]): Promise<unknown>
  lrange(key: string, start: number, stop: number): Promise<unknown>
  time(): Promise<unknown>
}

const clientCache = new Map<string, Promise<SyncRedis>>()

export function createUpstashClient(config: UpstashConfig): Promise<SyncRedis> {
  const sanitized = sanitizeUpstashConfig(config)
  const cacheKey = `${sanitized.url}\n${sanitized.token}`
  const cached = clientCache.get(cacheKey)
  if (cached) return cached

  const created = (async () => {
    const { Redis } = await import("@upstash/redis/cloudflare")
    const supportsTimeout = typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function"
    const redis = new Redis({
      url: sanitized.url,
      token: sanitized.token,
      automaticDeserialization: false,
      enableAutoPipelining: false,
      enableTelemetry: false,
      keepAlive: false,
      readYourWrites: true,
      retry: { retries: 3, backoff: (attempt: number) => Math.min(2_000, 150 * 2 ** attempt) },
      ...(supportsTimeout ? { signal: () => (AbortSignal as any).timeout(25_000) as AbortSignal } : {}),
    })
    return redis as unknown as SyncRedis
  })()

  clientCache.set(cacheKey, created)
  created.catch(() => clientCache.delete(cacheKey))
  return created
}

export function resetUpstashClientCache() {
  clientCache.clear()
}

// ---------------------------------------------------------------------------
// Parsing helpers (automaticDeserialization = false → mọi thứ là chuỗi thô)
// ---------------------------------------------------------------------------

export function asString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

export function asInt(value: unknown, fallback = 0): number {
  const text = asString(value)
  if (text === null) return fallback
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : fallback
}

export function parseHead(raw: unknown): HeadV3 | null {
  const text = asString(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as HeadV3
    if (!parsed || parsed.schema !== 3 || typeof parsed.version !== "number") return null
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function readHeadAndSnapshot(
  redis: SyncRedis,
  version: number,
): Promise<{ head: HeadV3 | null; payload: string | null }> {
  const result = await redis.mget(REDIS_KEYS.head, `${REDIS_KEYS.snapPrefix}${version}`)
  const list = Array.isArray(result) ? result : [null, null]
  return { head: parseHead(list[0]), payload: asString(list[1]) }
}

export async function readSnapshotPayload(redis: SyncRedis, version: number) {
  return asString(await redis.get(`${REDIS_KEYS.snapPrefix}${version}`))
}

export async function readServerTimeMs(redis: SyncRedis): Promise<number | null> {
  try {
    const raw = await redis.time()
    const list = Array.isArray(raw) ? raw : []
    const sec = asInt(list[0], -1)
    const usec = asInt(list[1], 0)
    if (sec < 0) return null
    return sec * 1000 + Math.floor(usec / 1000)
  } catch {
    return null
  }
}

export async function pingRedis(redis: SyncRedis) {
  await redis.ping()
}

// ---------------------------------------------------------------------------
// Legacy (v2) — chỉ đọc để migrate, cộng thêm một lần đánh dấu "đã thay thế"
// ---------------------------------------------------------------------------

export type LegacyV2Snapshot = {
  raw: string
  values: Record<string, string>
  revision: number
  updatedAt: number
  checksum: string
  keyCount: number
  checksumValid: boolean
  supersededBy?: string
}

export async function readLegacySnapshot(redis: SyncRedis): Promise<LegacyV2Snapshot | null> {
  const raw = asString(await redis.get(REDIS_KEYS.legacySnapshot))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      schemaVersion?: number
      manifest?: { revision?: number; updatedAt?: number; checksum?: string; keyCount?: number }
      values?: Record<string, string>
      supersededBy?: string
    }
    if (!parsed || parsed.schemaVersion !== 2 || !parsed.manifest || !parsed.values || typeof parsed.values !== "object") {
      return null
    }
    const values = parsed.values
    const checksum = parsed.manifest.checksum ?? ""
    return {
      raw,
      values,
      revision: Number(parsed.manifest.revision ?? 0),
      updatedAt: Number(parsed.manifest.updatedAt ?? 0),
      checksum,
      keyCount: Object.keys(values).length,
      checksumValid: legacyChecksum(values) === checksum,
      supersededBy: parsed.supersededBy,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type SyncErrorKind = "network" | "auth" | "rate-limit" | "too-large" | "unsupported" | "unknown"

export function classifySyncError(error: unknown): { kind: SyncErrorKind; message: string } {
  const raw = error instanceof Error ? error.message : String(error)
  const normalized = raw.toLowerCase()
  // Lỗi do chính engine ném (hash không khớp, snapshot thiếu...) phải giữ nguyên câu chữ để chẩn đoán.
  const message = getStorageErrorMessage(error, raw.replace(/command was: .+$/i, "").trim() || "Không thể kết nối Upstash Redis.")
  if (normalized.includes("unauthorized") || normalized.includes("wrongpass") || normalized.includes("invalid token")) {
    return { kind: "auth", message }
  }
  if (normalized.includes("max request size") || normalized.includes("too-large")) {
    return { kind: "too-large", message: "Dữ liệu vượt giới hạn request của Upstash Redis." }
  }
  if (normalized.includes("max daily request limit") || normalized.includes("rate limit")) {
    return { kind: "rate-limit", message }
  }
  // Upstash nối "command was: [\"eval\", ...]" vào MỌI lỗi của lệnh EVAL → chỉ dựa vào mã lỗi thật.
  if (normalized.includes("unknown command") || normalized.includes("noscript") || normalized.includes("not allowed")) {
    return { kind: "unsupported", message: "Upstash Redis không cho phép chạy script (EVAL). Đồng bộ ghi đã bị khoá để bảo vệ dữ liệu." }
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("abort") ||
    normalized.includes("timeout") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound")
  ) {
    return { kind: "network", message: "Không kết nối được Upstash Redis. Thay đổi vẫn được lưu trên máy này và sẽ đồng bộ khi có mạng." }
  }
  return { kind: "unknown", message }
}
