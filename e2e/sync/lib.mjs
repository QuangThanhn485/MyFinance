// Hạ tầng E2E: Redis thật (RESP) + Upstash REST giả có chèn lỗi + Edge thật + kiểm bất biến.
import http from "node:http"
import net from "node:net"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

export const HERE = dirname(fileURLToPath(import.meta.url))
export const APP = process.env.APP_URL ?? "http://127.0.0.1:5199"
export const PROXY_PORT = 8079
const REDIS_PORT = Number(process.env.E2E_REDIS_PORT ?? 6399)
export const seed = JSON.parse(readFileSync(join(HERE, "seed.json"), "utf8"))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- PRNG có seed (tái lập được)
export function rng(seedValue) {
  let s = seedValue >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)], chance: (p) => next() < p }
}

// ---------------------------------------------------------------- RESP
function respClient(port) {
  const socket = net.createConnection({ port, host: "127.0.0.1" })
  let buffer = Buffer.alloc(0)
  const pending = []
  const parse = (offset) => {
    const end = buffer.indexOf("\r\n", offset)
    if (end < 0) return null
    const type = String.fromCharCode(buffer[offset])
    const line = buffer.toString("utf8", offset + 1, end)
    const next = end + 2
    if (type === "+") return [{ simple: line }, next]
    if (type === "-") return [new Error(line), next]
    if (type === ":") return [Number(line), next]
    if (type === "$") {
      const n = Number(line)
      if (n < 0) return [null, next]
      if (buffer.length < next + n + 2) return null
      return [buffer.toString("utf8", next, next + n), next + n + 2]
    }
    if (type === "*") {
      const n = Number(line)
      if (n < 0) return [null, next]
      const items = []
      let cursor = next
      for (let i = 0; i < n; i += 1) {
        const item = parse(cursor)
        if (!item) return null
        items.push(item[0])
        cursor = item[1]
      }
      return [items, cursor]
    }
    throw new Error("RESP type " + type)
  }
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const parsed = parse(0)
      if (!parsed) break
      buffer = buffer.subarray(parsed[1])
      const waiter = pending.shift()
      if (parsed[0] instanceof Error) waiter.reject(parsed[0])
      else waiter.resolve(parsed[0])
    }
  })
  return {
    command(args) {
      const parts = [`*${args.length}\r\n`]
      for (const arg of args) {
        const text = typeof arg === "string" ? arg : JSON.stringify(arg)
        parts.push(`$${Buffer.byteLength(text)}\r\n${text}\r\n`)
      }
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject })
        socket.write(parts.join(""))
      })
    },
    close: () => socket.end(),
  }
}
export const redis = respClient(REDIS_PORT)
const plain = (v) => (v && typeof v === "object" && "simple" in v ? v.simple : Array.isArray(v) ? v.map(plain) : v)
export const cmd = async (...args) => plain(await redis.command(args.map(String)))

// ---------------------------------------------------------------- Upstash REST giả có chèn lỗi
export const stats = { requests: 0, failBefore: 0, failAfter: 0, appends: 0 }
export const faults = {
  failBefore: 0, // xác suất cắt kết nối TRƯỚC khi lệnh chạy
  failAfter: 0, // xác suất lệnh ĐÃ chạy trên Redis nhưng phản hồi bị mất
  delayMax: 0, // trễ ngẫu nhiên 0..delayMax ms
  onlyWrites: false,
  random: rng(1),
  off() {
    this.failBefore = 0
    this.failAfter = 0
    this.delayMax = 0
  },
}
const encode = (v, b64) => {
  if (v && typeof v === "object" && "simple" in v) return v.simple === "OK" || !b64 ? v.simple : Buffer.from(v.simple).toString("base64")
  if (typeof v === "string") return b64 ? Buffer.from(v, "utf8").toString("base64") : v
  if (Array.isArray(v)) return v.map((x) => encode(x, b64))
  return v
}
const proxy = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  if (req.method === "OPTIONS") return res.writeHead(204).end()
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", async () => {
    stats.requests += 1
    if (req.headers.authorization !== "Bearer e2e-token") return res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "WRONGPASS invalid or missing auth token" }))
    const command = JSON.parse(body)
    const isAppend = Array.isArray(command) && String(command[0]).toLowerCase() === "eval" && String(command[1]).includes("RPUSH")
    if (isAppend) stats.appends += 1
    const eligible = !faults.onlyWrites || isAppend
    if (faults.delayMax > 0) await sleep(faults.random.int(faults.delayMax))
    if (eligible && faults.random.chance(faults.failBefore)) {
      stats.failBefore += 1
      return req.socket.destroy()
    }
    const b64 = String(req.headers["upstash-encoding"] ?? "").toLowerCase() === "base64"
    let out
    try {
      out = { result: encode(await redis.command(command.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))), b64) }
    } catch (error) {
      out = { error: error.message }
    }
    if (eligible && faults.random.chance(faults.failAfter)) {
      stats.failAfter += 1
      return req.socket.destroy()
    }
    res.writeHead(out.error ? 400 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(out))
  })
})

export async function startInfra() {
  await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r))
  return chromium.launch({ channel: "msedge", headless: true })
}
export async function stopInfra(browser) {
  await browser.close()
  proxy.close()
  redis.close()
}

// ---------------------------------------------------------------- phát lại sổ cái ĐỘC LẬP (không dùng code app)
export function referenceFold(ops) {
  const records = {}
  const deleted = {}
  for (const op of ops) {
    const k = op.key
    if (op.t === "put") {
      records[k] = compact(op.v)
      delete deleted[k]
    } else if (op.t === "init") {
      if (!records[k] && !deleted[k]) records[k] = compact(op.v)
    } else if (op.t === "patch") {
      if (!records[k]) continue
      const next = { ...records[k] }
      for (const [f, v] of Object.entries(op.v ?? {})) if (v !== undefined) next[f] = v
      for (const f of op.u ?? []) delete next[f]
      records[k] = next
    } else if (op.t === "del") {
      delete records[k]
      if (!deleted[k]) deleted[k] = op.at
    }
  }
  return { records, deleted }
}
const compact = (v) => Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined))
export function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`
}

export async function readLog() {
  const raw = await cmd("LRANGE", "mf4:log", "0", "-1")
  return raw.map((r) => JSON.parse(r))
}

// ---------------------------------------------------------------- thiết bị / tab
const UPSTASH_CONFIG = (token = "e2e-token") => JSON.stringify({ mode: "upstash", upstash: { url: `http://127.0.0.1:${PROXY_PORT}`, token }, updatedAt: 1 })

export async function newDevice(browser, name, { local = null, clockOffsetMs = 0, token } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (clockOffsetMs) {
    await context.addInitScript((offset) => {
      const RealDate = Date
      class ShiftedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(RealDate.now() + offset)
          else super(...args)
        }
        static now() {
          return RealDate.now() + offset
        }
      }
      globalThis.Date = ShiftedDate
    }, clockOffsetMs)
  }
  await context.route(`${APP}/__seed`, (route) => route.fulfill({ contentType: "text/html", body: "<html><body>seed</body></html>" }))
  const setup = await context.newPage()
  await setup.goto(`${APP}/__seed`)
  await setup.evaluate(
    ({ local, config }) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(local ?? {})) localStorage.setItem(k, v)
      localStorage.setItem("smartSpend.storage.config.v1", config)
    },
    { local, config: UPSTASH_CONFIG(token) },
  )
  await setup.close()
  const device = { name, context, tabs: [], local }
  return device
}

export async function openTab(device, path = "/data") {
  const page = await device.context.newPage()
  const tab = { device, page, name: `${device.name}#${device.tabs.length + 1}`, errors: [] }
  page.on("pageerror", (err) => tab.errors.push(err.message))
  await page.goto(`${APP}${path}`)
  await page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu"), null, { timeout: 30_000 })
  await installApi(page)
  device.tabs.push(tab)
  return tab
}

export async function installApi(page) {
  await page.evaluate(async () => {
    // Dùng đúng URL module mà app đã nạp (Vite gắn ?t=... sau khi file đổi) để lấy cùng một instance.
    const urls = performance.getEntriesByType("resource").map((e) => e.name)
    const loaded = (path) => urls.filter((u) => new URL(u).pathname === path).pop() ?? path
    const [storeMod, ledgerMod, recordsMod, opsMod, tplMod] = await Promise.all([
      import(loaded("/src/store/useAppStore.ts")),
      import(loaded("/src/ledger/appLedger.ts")),
      import(loaded("/src/ledger/records.ts")),
      import(loaded("/src/ledger/ops.ts")),
      import(loaded("/src/storage/templates.ts")),
    ])
    window.__t = {
      useAppStore: storeMod.useAppStore,
      engine: ledgerMod.getLedgerEngine(),
      docToRecords: recordsMod.docToRecords,
      recordsToDoc: recordsMod.recordsToDoc,
      diff: opsMod.diffRecordMaps,
      tpl: tplMod,
    }
  })
}

// ---------------------------------------------------------------- thao tác (qua store THẬT của app)
export const act = {
  add: (tab, note, amountVnd = 10_000, date = "2026-10-24") =>
    tab.page.evaluate(({ note, amountVnd, date }) => {
      const s = window.__t.useAppStore.getState()
      const id = s.actions.addExpense({ amountVnd, category: "Food", note, date })
      window.__t.useAppStore.getState().actions.clearOverspending()
      return id
    }, { note, amountVnd, date }),
  edit: (tab, note, patch) =>
    tab.page.evaluate(({ note, patch }) => {
      const s = window.__t.useAppStore.getState()
      const found = Object.values(s.data.entities.expenses.byId).find((e) => e.note === note)
      if (!found) return false
      s.actions.updateExpense(found.id, patch)
      return true
    }, { note, patch }),
  del: (tab, note) =>
    tab.page.evaluate((note) => {
      const s = window.__t.useAppStore.getState()
      const found = Object.values(s.data.entities.expenses.byId).find((e) => e.note === note)
      if (!found) return false
      s.actions.deleteExpense(found.id)
      return true
    }, note),
  run: (tab, fn, arg) => tab.page.evaluate(fn, arg),
  sync: (tab) => tab.page.evaluate(() => window.__t.engine.syncNow({ resume: true })).catch((e) => `ERR ${e.message}`),
}

export async function quickState(tab) {
  return tab.page.evaluate(() => {
    const s = window.__t.engine.getState()
    return { phase: s.phase, pending: s.pending, cursor: s.cursor, dialog: s.dialog?.kind ?? null, joined: s.joined, lastError: s.lastError ?? null, deviceId: s.deviceId, notice: s.notice?.kind ?? null }
  })
}

export async function fullState(tab) {
  return tab.page.evaluate(() => {
    const t = window.__t
    const st = t.useAppStore.getState()
    const records = t.engine.getRecords()
    const drift = t.diff(t.docToRecords({ cttm: st.data, templates: st.templates }), t.docToRecords(t.recordsToDoc(records)))
    const notes = {}
    for (const e of Object.values(st.data.entities.expenses.byId)) notes[e.note] = (notes[e.note] ?? 0) + 1
    const s = t.engine.getState()
    return { phase: s.phase, pending: s.pending, cursor: s.cursor, records, drift: drift.length, driftSample: drift.slice(0, 3), notes, expenseCount: Object.keys(st.data.entities.expenses.byId).length, legacy: localStorage.getItem("cttm_v1") }
  })
}

export async function readIdb(tab) {
  return tab.page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("myfinance-ledger")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(["kv", "outbox"], "readonly")
          const out = {}
          tx.objectStore("kv").get("meta").onsuccess = (e) => (out.meta = e.target.result)
          tx.objectStore("kv").get("confirmed").onsuccess = (e) => (out.confirmed = e.target.result)
          tx.objectStore("outbox").count().onsuccess = (e) => (out.outbox = e.target.result)
          tx.oncomplete = () => {
            db.close()
            resolve(out)
          }
        }
      }),
  )
}

/** Đồng bộ mọi tab cho tới khi tất cả đứng yên ở cùng điểm cuối sổ cái. */
export async function settle(tabs, { rounds = 15, keepFaults = false } = {}) {
  if (!keepFaults) faults.off()
  let last = null
  for (let round = 0; round < rounds; round += 1) {
    for (const tab of tabs) await act.sync(tab)
    const length = Number(await cmd("LLEN", "mf4:log"))
    const states = await Promise.all(tabs.map(quickState))
    last = { length, states: states.map((s, i) => ({ tab: tabs[i].name, ...s })) }
    if (states.every((s) => s.pending === 0 && s.cursor === length && !s.dialog && s.phase === "idle")) return last
    await sleep(400)
  }
  throw new Error(`Không hội tụ: ${JSON.stringify(last)}`)
}

// ---------------------------------------------------------------- kiểm bất biến
export class Checker {
  constructor(name) {
    this.name = name
    this.failures = []
    this.passed = 0
  }
  ok(label, condition, detail = "") {
    if (condition) this.passed += 1
    else this.failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    return condition
  }
}

/**
 * Bất biến cho MỌI kịch bản:
 *  1. Sổ cái: seq liền mạch, id op duy nhất, (thiết bị, cseq) duy nhất và liền mạch 1..n.
 *  2. Mọi tab: không còn op chờ, đã ở cuối sổ, bản ghi == phát lại ĐỘC LẬP của sổ cái (byte-by-byte).
 *  3. Giao diện mỗi tab hiển thị đúng sổ cái (store == phép chiếu bản ghi).
 *  4. IndexedDB mỗi thiết bị: outbox trống, confirmed == phát lại độc lập.
 *  5. cttm_v1 bản cũ không bị đụng tới.
 *  6. Kỳ vọng nghiệp vụ: mỗi ghi chú đánh dấu có đúng số lần mong đợi (0 = đã xoá, 1 = còn, không bao giờ 2).
 */
export async function verify(check, devices, { notes = {}, prefixes = [], expenseCount } = {}) {
  const log = await readLog()
  check.ok("sổ cái: seq liền mạch", log.every((op, i) => op.seq === i + 1))
  check.ok("sổ cái: id op duy nhất", new Set(log.map((op) => op.id)).size === log.length)
  const byDev = new Map()
  for (const op of log) byDev.set(op.dev, [...(byDev.get(op.dev) ?? []), op.cseq])
  for (const [dev, seqs] of byDev) check.ok(`sổ cái: cseq của ${dev} liền mạch 1..n, không trùng`, seqs.every((c, i) => c === i + 1), seqs.slice(0, 5).join(","))
  const reference = referenceFold(log)
  const refStable = stable(reference.records)
  const tabs = devices.flatMap((d) => d.tabs)
  let anyState = null
  for (const tab of tabs) {
    const st = await fullState(tab)
    anyState ??= st
    check.ok(`${tab.name}: không còn op chờ`, st.pending === 0, `${st.pending}`)
    check.ok(`${tab.name}: ở cuối sổ cái`, st.cursor === log.length, `${st.cursor}/${log.length}`)
    check.ok(`${tab.name}: dữ liệu == phát lại độc lập của sổ cái`, stable(st.records) === refStable)
    check.ok(`${tab.name}: giao diện hiển thị đúng sổ cái`, st.drift === 0, JSON.stringify(st.driftSample).slice(0, 200))
    for (const [note, count] of Object.entries(notes)) check.ok(`${tab.name}: "${note}" xuất hiện ${count} lần`, (st.notes[note] ?? 0) === count, `thực tế ${st.notes[note] ?? 0}`)
    for (const prefix of prefixes) {
      const dup = Object.entries(st.notes).filter(([n, c]) => n.startsWith(prefix) && c > 1)
      check.ok(`${tab.name}: không có khoản trùng (${prefix}*)`, dup.length === 0, JSON.stringify(dup.slice(0, 3)))
    }
    if (expenseCount !== undefined) check.ok(`${tab.name}: tổng số khoản = ${expenseCount}`, st.expenseCount === expenseCount, `${st.expenseCount}`)
    if (tab.device.local?.cttm_v1) check.ok(`${tab.name}: cttm_v1 bản cũ nguyên vẹn`, st.legacy === tab.device.local.cttm_v1)
    check.ok(`${tab.name}: không có lỗi JS`, tab.errors.length === 0, tab.errors.slice(0, 2).join(" | "))
  }
  for (const device of devices) {
    if (!device.tabs.length) continue
    const idb = await readIdb(device.tabs[0])
    check.ok(`${device.name}: IndexedDB outbox trống`, idb.outbox === 0, `${idb.outbox}`)
    check.ok(`${device.name}: IndexedDB confirmed == phát lại độc lập`, stable(idb.confirmed?.records ?? {}) === refStable)
  }
  return { log, reference, state: anyState }
}

export async function closeDevices(devices) {
  for (const d of devices) await d.context.close().catch(() => {})
}

export async function resetRedis(remote = null) {
  await cmd("FLUSHDB")
  if (remote) for (const [k, v] of Object.entries(remote)) await cmd("SET", k, v)
}
