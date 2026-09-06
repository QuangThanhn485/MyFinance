import { getDataSourceConfig } from "@/storage/dataSource"
import { saveCttmState } from "@/storage/localStorage"
import { STORAGE_KEY } from "@/storage/schema"
import {
  loadExpenseTemplates,
  loadTemplateTombstones,
  replaceExpenseTemplatesFromSync,
  TEMPLATES_CHANGED_EVENT,
} from "@/storage/templates"
import { flushPendingSave, loadRealDataFromDisk, subscribePersisted, useAppStore } from "@/store/useAppStore"
import { createUpstashClient } from "@/sync/redisProtocol"
import { SyncEngine, type SyncEnvironment, type SyncStoreAdapter } from "@/sync/syncEngine"

/**
 * Nối SyncEngine với store thật, localStorage thật và window. Đây là nơi DUY NHẤT
 * biết về cả hai phía; engine và store không import lẫn nhau.
 */

export const APP_BUILD: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_BUILD) || "dev"

/** Giới hạn an toàn cho plan Upstash miễn phí (1 MB/request). Snapshot lớn được nén gzip trước khi đo. */
const MAX_REQUEST_BYTES = 900 * 1024

const storeAdapter: SyncStoreAdapter = {
  getData: () => useAppStore.getState().data,
  getWorkspace: () => useAppStore.getState().workspace,
  replaceRealData: (next) => {
    const state = useAppStore.getState()
    if (state.workspace === "real") {
      state.actions.replaceData(next)
    } else {
      saveCttmState(STORAGE_KEY, next)
    }
  },
  flushPendingSave: () => flushPendingSave(),
  subscribeData: (listener) => useAppStore.subscribe((s) => s.data, listener),
  subscribePersisted: (listener) => subscribePersisted(listener),
  loadRealFromDisk: () => loadRealDataFromDisk(),
  getTemplates: () => ({ items: loadExpenseTemplates(), tombstones: loadTemplateTombstones() }),
  replaceTemplates: (templates) => replaceExpenseTemplatesFromSync(templates.items, templates.tombstones ?? {}),
  runAutoClose: () => useAppStore.getState().actions.autoClosePreviousMonthIfNeeded(),
}

function browserEnvironment(): SyncEnvironment {
  return {
    storage: window.localStorage,
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
        case "focus": {
          const fn = () => handler()
          window.addEventListener("focus", fn)
          return () => window.removeEventListener("focus", fn)
        }
        case "online": {
          const fn = () => handler()
          window.addEventListener("online", fn)
          return () => window.removeEventListener("online", fn)
        }
        case "storage": {
          const fn = (event: StorageEvent) => handler({ key: event.key, newValue: event.newValue })
          window.addEventListener("storage", fn)
          return () => window.removeEventListener("storage", fn)
        }
        case "templates": {
          const fn = () => handler()
          window.addEventListener(TEMPLATES_CHANGED_EVENT, fn)
          return () => window.removeEventListener(TEMPLATES_CHANGED_EVENT, fn)
        }
        default:
          return () => {}
      }
    },
    appBuild: APP_BUILD,
    maxRequestBytes: MAX_REQUEST_BYTES,
    pollIntervalMs: 45_000,
    bootTimeoutMs: 12_000,
    requestTimeoutMs: 20_000,
  }
}

let engine: SyncEngine | null = null

export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine(storeAdapter, browserEnvironment())
  return engine
}
