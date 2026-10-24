import { LedgerEngine, type LedgerBroadcast, type LedgerEnvironment, type LedgerStoreAdapter } from "@/ledger/engine"
import { IndexedDbJournal, MemoryJournal, type Journal } from "@/ledger/journal"
import { getDataSourceConfig } from "@/storage/dataSource"
import { bindTemplateSource, notifyTemplatesChanged } from "@/storage/templates"
import { bindRealDataProvider, hydrateStoreFromLedger, isDerivedWrite, isHydrating, useAppStore } from "@/store/useAppStore"
import { createUpstashClient } from "@/sync/redisProtocol"

/**
 * Nối LedgerEngine với store thật, IndexedDB, BroadcastChannel, Web Locks và sự kiện trình duyệt.
 * Đây là nơi DUY NHẤT biết cả hai phía; engine và store không import lẫn nhau.
 */

/** Giới hạn an toàn cho một request của gói Upstash miễn phí (1 MB). */
const MAX_REQUEST_BYTES = 900 * 1024

const storeAdapter: LedgerStoreAdapter = {
  getWorkspace: () => useAppStore.getState().workspace,
  getDoc: () => {
    const state = useAppStore.getState()
    return { cttm: state.data, templates: state.templates }
  },
  hydrate: (doc) => {
    hydrateStoreFromLedger(doc)
    notifyTemplatesChanged()
  },
  runAutoClose: () => useAppStore.getState().actions.autoClosePreviousMonthIfNeeded(),
}

function defaultDeviceLabel() {
  if (typeof navigator === "undefined") return "Thiết bị"
  const ua = navigator.userAgent || ""
  if (/iphone|ipad/i.test(ua)) return "iPhone/iPad"
  if (/android/i.test(ua)) return "Android"
  if (/macintosh/i.test(ua)) return "Mac"
  if (/windows/i.test(ua)) return "Windows"
  if (/linux/i.test(ua)) return "Linux"
  return "Trình duyệt"
}

function browserBroadcast(): LedgerEnvironment["broadcast"] {
  if (typeof BroadcastChannel === "undefined") return undefined
  const channel = new BroadcastChannel("mf4-ledger")
  return {
    post: (message) => {
      try {
        channel.postMessage(message)
      } catch {
        // tab đang đóng
      }
    },
    subscribe: (handler) => {
      const fn = (event: MessageEvent<LedgerBroadcast>) => {
        if (event.data && event.data.type === "changed") handler(event.data)
      }
      channel.addEventListener("message", fn)
      return () => channel.removeEventListener("message", fn)
    },
  }
}

function browserLock(): LedgerEnvironment["withLock"] {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks || typeof locks.request !== "function") return undefined
  return <T,>(name: string, fn: () => Promise<T>) => locks.request(name, () => fn()) as Promise<T>
}

function browserEnvironment(journal: Journal): LedgerEnvironment {
  return {
    journal,
    legacyStorage: window.localStorage,
    getConfig: () => getDataSourceConfig(),
    createRedis: (config) => createUpstashClient(config),
    now: () => Date.now(),
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    isVisible: () => (typeof document === "undefined" ? true : document.visibilityState === "visible"),
    addListener: (type, handler) => {
      switch (type) {
        case "visible": {
          const fn = () => {
            if (document.visibilityState === "visible") handler()
          }
          document.addEventListener("visibilitychange", fn)
          return () => document.removeEventListener("visibilitychange", fn)
        }
        case "focus":
        case "online":
        case "pageshow": {
          const fn = () => handler()
          window.addEventListener(type, fn)
          return () => window.removeEventListener(type, fn)
        }
        case "storage": {
          const fn = (event: StorageEvent) => handler({ key: event.key })
          window.addEventListener("storage", fn)
          return () => window.removeEventListener("storage", fn)
        }
        default:
          return () => {}
      }
    },
    broadcast: browserBroadcast(),
    withLock: browserLock(),
    defaultDeviceLabel: defaultDeviceLabel(),
    maxRequestBytes: MAX_REQUEST_BYTES,
    pollIntervalMs: 45_000,
    requestTimeoutMs: 20_000,
    pushDelayMs: 800,
    derivedWritesTimeoutMs: 12_000,
  }
}

function pickJournal(factory?: IDBFactory): Journal {
  const idb = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined)
  return idb ? new IndexedDbJournal(idb) : new MemoryJournal()
}

/** Mọi thay đổi `data` (workspace real) và `templates` của store đi vào sổ cái thành op. */
function wireStore(engine: LedgerEngine) {
  bindTemplateSource({
    get: () => useAppStore.getState().templates,
    set: (next) => useAppStore.getState().actions.setTemplates(next),
  })
  bindRealDataProvider(() => engine.getRealDoc())
  return useAppStore.subscribe((state, prev) => {
    if (isHydrating()) return
    const templatesChanged = state.templates !== prev.templates
    const dataChanged = state.data !== prev.data && state.workspace === "real" && prev.workspace === "real"
    if (!templatesChanged && !dataChanged) return
    engine.recordLocalChange(
      { cttm: dataChanged ? prev.data : state.data, templates: prev.templates },
      { cttm: state.data, templates: state.templates },
      { derived: isDerivedWrite() },
    )
  })
}

let engine: LedgerEngine | null = null
let startPromise: Promise<LedgerEngine> | null = null
let unwire: (() => void) | null = null

/**
 * Khởi động sổ cái: mở IndexedDB, nhập dữ liệu bản cũ nếu là lần đầu, đổ dữ liệu vào store rồi
 * bắt đầu đồng bộ nền. Gọi một lần trước khi render. Không bao giờ reject.
 */
export function startLedger(options: { indexedDB?: IDBFactory; journal?: Journal } = {}): Promise<LedgerEngine> {
  if (startPromise) return startPromise
  startPromise = (async () => {
    let created = new LedgerEngine(storeAdapter, browserEnvironment(options.journal ?? pickJournal(options.indexedDB)))
    try {
      await created.boot()
    } catch (error) {
      console.error("Không mở được nhật ký IndexedDB, chuyển sang bộ nhớ tạm:", error)
      created = new LedgerEngine(storeAdapter, browserEnvironment(new MemoryJournal()))
      await created.boot()
    }
    engine = created
    unwire = wireStore(created)
    created.start()
    try {
      void (navigator as Navigator & { storage?: StorageManager }).storage?.persist?.()
    } catch {
      // không bắt buộc
    }
    return created
  })()
  return startPromise
}

export function getLedgerEngine(): LedgerEngine {
  if (!engine) throw new Error("Sổ cái chưa khởi động (startLedger).")
  return engine
}

/** Chỉ dùng trong test: tháo engine hiện tại để khởi động lại từ đầu. */
export function resetLedgerForTests() {
  engine?.stop()
  unwire?.()
  unwire = null
  engine = null
  startPromise = null
  bindTemplateSource(null)
  bindRealDataProvider(null)
}
