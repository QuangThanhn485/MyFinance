// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LEDGER_KEYS } from "@/ledger/remote"
import type { CttmState } from "@/storage/schema"
import { makeConfiguredState, makeState, withExpense, withFixedCost, withoutExpense } from "../sync/fixtures"
import {
  createBrowser,
  FakeRedis,
  ids,
  openTab,
  seedV3Local,
  seedV3Remote,
  settle,
  sync,
  useLedgerTimers,
  type Tab,
} from "./harness"

function editExpense(state: CttmState, id: string, patch: Record<string, unknown>): CttmState {
  const existing = state.entities.expenses.byId[id]
  return {
    ...state,
    entities: {
      ...state.entities,
      expenses: { ...state.entities.expenses, byId: { ...state.entities.expenses.byId, [id]: { ...existing, ...patch, updatedAt: new Date().toISOString() } } },
    },
  }
}

async function freshDevice(name: string, redis: FakeRedis, seed?: CttmState) {
  const browser = createBrowser(name)
  if (seed) browser.storage.setItem("cttm_v1", JSON.stringify(seed))
  return openTab(browser, redis)
}

describe("Sổ cái — các đường mất dữ liệu cũ không còn tồn tại", () => {
  let redis: FakeRedis
  beforeEach(() => {
    useLedgerTimers()
    vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"))
    redis = new FakeRedis()
  })
  afterEach(() => vi.useRealTimers())

  it("R1: tab có RAM cũ (bfcache, lỡ sự kiện) không xoá được dữ liệu tab kia vừa nhập", async () => {
    const laptop1 = await freshDevice("laptop", redis, withExpense(makeConfiguredState(), { id: "ex_seed", amountVnd: 1, date: "2026-10-01" }))
    await sync(laptop1)
    const phone = await freshDevice("phone", redis)
    await sync(phone)
    expect(ids(phone)).toEqual(["ex_seed"])

    const laptop2 = await openTab(laptop1.browser, redis)
    laptop1.muted = true // vào bfcache: không nhận BroadcastChannel nào
    for (const id of ["ex_a", "ex_b", "ex_c"]) laptop2.store.act((s) => withExpense(s, { id, amountVnd: 100_000, date: "2026-10-20" }))
    await sync(laptop2)

    // Tab 1 quay lại với RAM cũ và người dùng thao tác NGAY, trước khi kịp tải lại.
    laptop1.muted = false
    expect(ids(laptop1)).toEqual(["ex_seed"])
    laptop1.store.act((s) => withExpense(s, { id: "ex_next", amountVnd: 20_000, date: "2026-10-20" }))
    laptop1.store.act((s) => editExpense(s, "ex_seed", { note: "sửa từ tab cũ" }))
    await sync(laptop1)
    await sync(phone)

    const expected = ["ex_a", "ex_b", "ex_c", "ex_next", "ex_seed"]
    expect(ids(phone)).toEqual(expected)
    expect(ids(laptop1)).toEqual(expected)
    expect(phone.store.doc.cttm.entities.expenses.byId.ex_seed.note).toBe("sửa từ tab cũ")
  })

  it("R2: khoản đã xoá không bao giờ sống lại, kể cả máy cũ để 200 ngày rồi thao tác offline", async () => {
    let seed = makeConfiguredState()
    seed = withExpense(seed, { id: "ex_dup", amountVnd: 5_000_000, date: "2026-10-01", note: "nhập trùng" })
    seed = withExpense(seed, { id: "ex_ok", amountVnd: 50_000, date: "2026-10-01" })
    const a = await freshDevice("A", redis, seed)
    await sync(a)
    const old = await freshDevice("old-phone", redis)
    await sync(old)
    expect(ids(old)).toEqual(["ex_dup", "ex_ok"])
    old.engine.stop()

    a.store.act((s) => withoutExpense(s, "ex_dup", new Date().toISOString()))
    await sync(a)

    vi.setSystemTime(new Date("2027-05-08T10:00:00.000Z"))
    redis.failNext("network", 50)
    old.engine.start()
    await settle(old)
    old.store.act((s) => withExpense(s, { id: "ex_old", amountVnd: 3, date: "2027-05-08" }))
    await settle(old)
    redis.clearFailures()
    await sync(old)
    await sync(a)

    expect(ids(a)).toEqual(["ex_ok", "ex_old"])
    expect(ids(old)).toEqual(["ex_ok", "ex_old"])
  })

  it("sự cố gốc A→B→A: máy mở lại sau một tuần không ghi đè tuần dữ liệu của máy kia", async () => {
    const a = await freshDevice("A", redis, withExpense(makeConfiguredState(), { id: "ex_seed", amountVnd: 10_000, date: "2026-10-01" }))
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    a.engine.stop()

    for (let day = 1; day <= 7; day += 1) {
      b.store.act((s) => withExpense(s, { id: `ex_b${day}`, amountVnd: 50_000 * day, date: `2026-10-2${day}` }))
      await sync(b)
    }

    // A mở lại: trước khi kịp kéo về, nó tự sinh dữ liệu tháng mới và người dùng sửa cài đặt.
    a.store.act((s) => ({ ...s, settings: { ...s.settings, paydayDayOfMonth: 5 } }))
    a.engine.start()
    await sync(a, b)

    expect(ids(a)).toEqual(["ex_b1", "ex_b2", "ex_b3", "ex_b4", "ex_b5", "ex_b6", "ex_b7", "ex_seed"])
    expect(ids(b)).toEqual(ids(a))
    expect(b.store.doc.cttm.settings.paydayDayOfMonth).toBe(5)
  })

  it("mất phản hồi sau khi Redis đã ghi: thử lại không tạo bản trùng, không mất", async () => {
    const a = await freshDevice("A", redis, makeConfiguredState())
    await sync(a)
    const before = redis.log().length
    a.store.act((s) => withExpense(s, { id: "ex_1", amountVnd: 1, date: "2026-10-20" }))
    redis.failNext("lose-response", 1)
    await sync(a)
    expect(a.engine.getState().phase).toBe("offline")
    await sync(a)
    const added = redis.log().slice(before).filter((op) => op.key === "expense/ex_1")
    expect(added).toHaveLength(1)
    expect(a.engine.getState().pending).toBe(0)
  })

  it("hai tab cùng đẩy outbox một lúc: mỗi op vào sổ cái đúng một lần", async () => {
    const t1 = await freshDevice("laptop", redis, makeConfiguredState())
    await sync(t1)
    const t2 = await openTab(t1.browser, redis)
    t1.store.act((s) => withExpense(s, { id: "ex_t1", amountVnd: 1, date: "2026-10-20" }))
    t2.store.act((s) => withExpense(s, { id: "ex_t2", amountVnd: 2, date: "2026-10-20" }))
    await settle(t1, t2)
    await Promise.all([t1.engine.syncNow(), t2.engine.syncNow()])
    await sync(t1, t2)
    const keys = redis.log().map((op) => op.key)
    expect(keys.filter((k) => k === "expense/ex_t1")).toHaveLength(1)
    expect(keys.filter((k) => k === "expense/ex_t2")).toHaveLength(1)
    expect(ids(t1)).toEqual(["ex_t1", "ex_t2"])
    expect(ids(t2)).toEqual(["ex_t1", "ex_t2"])
  })

  it("hai máy cùng sang tháng mới: dữ liệu tự sinh chỉ có một bộ, máy đến sau là no-op", async () => {
    const seed = withFixedCost(makeConfiguredState(), { id: "fc_rent", month: "2026-10", name: "Nhà", amountVnd: 5_000_000 })
    const a = await freshDevice("A", redis, seed)
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    const rollover = (paid: number) => (s: CttmState) =>
      withFixedCost({ ...s, settingsByMonth: { ...s.settingsByMonth, "2026-11": { ...s.settings, emergencyFundCurrentVnd: paid } } }, {
        id: "fc_2026-11_rent",
        month: "2026-11",
        name: "Nhà",
        amountVnd: 5_000_000,
      })
    a.store.act(rollover(1_000), { derived: true })
    b.store.act(rollover(2_000), { derived: true })
    await sync(a, b, a)
    expect(ids(a, "fixedCosts")).toEqual(["fc_2026-11_rent", "fc_rent"])
    expect(ids(b, "fixedCosts")).toEqual(ids(a, "fixedCosts"))
    expect(a.store.doc.cttm.settingsByMonth["2026-11"].emergencyFundCurrentVnd).toBe(1_000)
    expect(b.store.doc.cttm.settingsByMonth["2026-11"].emergencyFundCurrentVnd).toBe(1_000)
  })

  it("A xoá, B (offline) sửa cùng khoản: xoá được giữ, B được báo", async () => {
    const a = await freshDevice("A", redis, withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" }))
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    a.store.act((s) => withoutExpense(s, "ex_1", new Date().toISOString()))
    await sync(a)
    b.store.act((s) => editExpense(s, "ex_1", { amountVnd: 999 }))
    await sync(b)
    expect(ids(b)).toEqual([])
    expect(ids(a)).toEqual([])
    expect(b.engine.getState().notice?.kind).toBe("edit-on-deleted")
  })

  it("hai máy sửa KHÁC field của cùng khoản: giữ cả hai", async () => {
    const a = await freshDevice("A", redis, withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" }))
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    a.store.act((s) => editExpense(s, "ex_1", { amountVnd: 777 }))
    b.store.act((s) => editExpense(s, "ex_1", { note: "ghi chú của B" }))
    await sync(a, b, a)
    for (const tab of [a, b]) {
      expect(tab.store.doc.cttm.entities.expenses.byId.ex_1.amountVnd).toBe(777)
      expect(tab.store.doc.cttm.entities.expenses.byId.ex_1.note).toBe("ghi chú của B")
    }
  })

  it("hai máy trùng danh tính (IndexedDB bị sao chép/khôi phục): phát hiện, đổi danh tính, không op nào bị bỏ", async () => {
    const a = await freshDevice("A", redis, makeConfiguredState())
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    // B mang đúng danh tính của A với bộ đếm cseq tụt về sau A.
    const aMeta = await a.engine["env"].journal.load()
    await b.engine["env"].journal.patchMeta({ deviceId: aMeta!.meta.deviceId, nextCseq: aMeta!.meta.nextCseq, ackedCseq: aMeta!.meta.ackedCseq })
    await b.engine.reloadFromJournal()
    a.store.act((s) => withExpense(s, { id: "ex_a", amountVnd: 1, date: "2026-10-20" }))
    b.store.act((s) => withExpense(s, { id: "ex_b", amountVnd: 2, date: "2026-10-20" }))
    await sync(a)
    await sync(b)
    await vi.advanceTimersByTimeAsync(100)
    await sync(b, a)
    expect(ids(a)).toEqual(["ex_a", "ex_b"])
    expect(ids(b)).toEqual(["ex_a", "ex_b"])
    expect(b.engine.getState().deviceId).not.toBe(a.engine.getState().deviceId)
  })

  it("op từ phiên bản mới hơn: dừng phát lại, khoá ghi, không làm hỏng gì", async () => {
    const a = await freshDevice("A", redis, makeConfiguredState())
    await sync(a)
    const lengthBefore = redis.log().length
    redis.pushRaw({ sv: 99, id: "x", dev: "d_future", cseq: 1, at: new Date().toISOString(), tx: "t", t: "magic", key: "expense/zz" })
    a.store.act((s) => withExpense(s, { id: "ex_1", amountVnd: 1, date: "2026-10-20" }))
    await sync(a)
    expect(a.engine.getState().phase).toBe("needs-update")
    expect(redis.log().length).toBe(lengthBefore + 1)
    expect(a.engine.getState().pending).toBeGreaterThan(0)
  })

  it("Redis bị xoá sạch: hỏi trước, đẩy lại từ máy này; máy kia gộp vào sổ cái mới", async () => {
    const a = await freshDevice("A", redis, withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" }))
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    b.store.act((s) => withExpense(s, { id: "ex_b", amountVnd: 2, date: "2026-10-02" }))
    redis.flushAll()
    await sync(a)
    expect(a.engine.getState().dialog?.kind).toBe("remote-empty")
    expect(redis.log()).toHaveLength(0)
    await a.engine.resolveDialog("reseed")
    await settle(a)
    expect(ids(a)).toEqual(["ex_1"])
    await sync(b)
    expect(b.engine.getState().dialog?.kind).toBe("remote-different")
    await b.engine.resolveDialog("merge-local")
    await settle(b)
    await sync(a)
    expect(ids(a)).toEqual(["ex_1", "ex_b"])
    expect(ids(b)).toEqual(["ex_1", "ex_b"])
  })

  it("mất mạng: thao tác nằm trong outbox, tải lại trang vẫn còn, có mạng thì lên sổ cái", async () => {
    const a = await freshDevice("A", redis, makeConfiguredState())
    await sync(a)
    redis.failNext("network", 1000)
    a.store.act((s) => withExpense(s, { id: "ex_off", amountVnd: 1, date: "2026-10-20" }))
    await sync(a)
    expect(a.engine.getState().phase).toBe("offline")
    a.engine.stop()
    // "Tải lại trang": tab mới trên cùng trình duyệt
    const reloaded = await openTab(a.browser, redis, { start: false })
    expect(ids(reloaded)).toEqual(["ex_off"])
    expect(reloaded.engine.getState().pending).toBe(1)
    redis.clearFailures()
    reloaded.engine.start()
    await sync(reloaded)
    expect(reloaded.engine.getState().pending).toBe(0)
    const b = await freshDevice("B", redis)
    await sync(b)
    expect(ids(b)).toEqual(["ex_off"])
  })

  it("không tạo được client Redis lúc mất mạng (nạp module lỗi) thì lần sau vẫn thử lại, không kẹt vĩnh viễn", async () => {
    const browser = createBrowser("A")
    browser.storage.setItem("cttm_v1", JSON.stringify(makeConfiguredState()))
    const a = await openTab(browser, redis, { start: false })
    const env = a.engine["env"]
    let attempts = 0
    env.createRedis = async () => {
      attempts += 1
      if (attempts === 1) throw new Error("TypeError: Failed to fetch dynamically imported module")
      return redis
    }
    a.engine.start()
    await settle(a)
    expect(a.engine.getState().phase).toBe("offline")
    await sync(a)
    expect(a.engine.getState().phase).toBe("idle")
    expect(redis.log().length).toBeGreaterThan(0)
  })

  it("replica đọc trễ (LRANGE trả thiếu): nhận phần liền mạch, lần sau lấy nốt, không báo lỗi", async () => {
    const a = await freshDevice("A", redis, makeConfiguredState())
    for (let i = 0; i < 10; i += 1) a.store.act((s) => withExpense(s, { id: `ex_${i}`, amountVnd: i + 1, date: "2026-10-20" }))
    await sync(a)
    redis.truncateLrange = 3
    const b = await freshDevice("B", redis)
    await sync(b, b, b)
    expect(b.engine.getState().phase).toBe("idle")
    expect(ids(b)).toEqual(ids(a))
  })

  it("IndexedDB bị xoá nhưng còn cttm_v1 cũ: không nhập lại dữ liệu lỗi thời, không hồi sinh, không đè", async () => {
    const seed = withExpense(withExpense(makeConfiguredState(), { id: "ex_x", amountVnd: 1, date: "2026-10-01" }), { id: "ex_y", amountVnd: 2, date: "2026-10-01" })
    const a = await freshDevice("A", redis, seed)
    await sync(a)
    const browserB = createBrowser("B")
    browserB.storage.setItem("cttm_v1", JSON.stringify(withExpense(seed, { id: "ex_b", amountVnd: 3, date: "2026-10-02" })))
    const b = await openTab(browserB, redis)
    await sync(b, a)
    a.store.act((s) => withoutExpense(s, "ex_x", new Date().toISOString()))
    a.store.act((s) => editExpense(s, "ex_y", { amountVnd: 777 }))
    await sync(a)
    b.engine.stop()
    // Trình duyệt dọn IndexedDB của B (localStorage còn bản cũ có ex_x, ex_y=2).
    browserB.factory = new (await import("fake-indexeddb")).IDBFactory()
    const b2 = await openTab(browserB, redis)
    await sync(b2, a)
    expect(ids(b2)).toEqual(["ex_b", "ex_y"])
    expect(b2.store.doc.cttm.entities.expenses.byId.ex_y.amountVnd).toBe(777)
    expect(ids(a)).toEqual(["ex_b", "ex_y"])
    expect(redis.log().filter((op) => op.key === "expense/ex_b" && op.t === "put")).toHaveLength(1)
  })

  it("tab khác trên cùng máy thấy thay đổi ngay (BroadcastChannel)", async () => {
    const t1 = await freshDevice("laptop", redis, makeConfiguredState())
    await sync(t1)
    const t2 = await openTab(t1.browser, redis)
    t2.store.act((s) => withExpense(s, { id: "ex_t2", amountVnd: 2, date: "2026-10-20" }))
    await settle(t2, t1)
    expect(ids(t1)).toEqual(["ex_t2"])
  })
})

describe("Hoàn tác & quay về thời điểm cũ (không cần bản sao lưu)", () => {
  let redis: FakeRedis
  beforeEach(() => {
    useLedgerTimers()
    vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"))
    redis = new FakeRedis()
  })
  afterEach(() => vi.useRealTimers())

  async function setup(): Promise<Tab> {
    const a = await freshDevice("A", redis, makeConfiguredState())
    await sync(a)
    for (const id of ["ex_1", "ex_2", "ex_3"]) {
      vi.setSystemTime(Date.now() + 60_000)
      a.store.act((s) => withExpense(s, { id, amountVnd: 1, date: "2026-10-20" }))
      await sync(a)
    }
    a.store.act((s) => withoutExpense(s, "ex_2", new Date().toISOString()))
    await sync(a)
    return a
  }

  it("hoàn tác lệnh xoá đưa khoản chi trở lại trên mọi thiết bị", async () => {
    const a = await setup()
    const history = await a.engine.loadHistory()
    const del = history.find((group) => group.ops.some((op) => op.t === "del" && op.key === "expense/ex_2"))!
    await a.engine.undoGroup(del)
    await sync(a)
    const b = await freshDevice("B", redis)
    await sync(b)
    expect(ids(b)).toEqual(["ex_1", "ex_2", "ex_3"])
  })

  it("quay về trước một thời điểm; lịch sử phía sau vẫn còn để quay lại", async () => {
    const a = await setup()
    let history = await a.engine.loadHistory()
    const addFirst = history.find((group) => group.ops.some((op) => op.key === "expense/ex_1" && op.t === "put"))!
    await a.engine.restoreBefore(addFirst)
    await sync(a)
    expect(ids(a)).toEqual([])
    history = await a.engine.loadHistory()
    const restore = history[0]
    expect(restore.tx.startsWith("restore-")).toBe(true)
    await a.engine.undoGroup(restore)
    await sync(a)
    expect(ids(a)).toEqual(["ex_1", "ex_3"])
  })
})

describe("Chuyển đổi dữ liệu đang chạy trên Sync v3", () => {
  let redis: FakeRedis
  beforeEach(() => {
    useLedgerTimers()
    vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"))
    redis = new FakeRedis()
  })
  afterEach(() => vi.useRealTimers())

  it("hai máy lệch nhau cùng lên v4: không mất thay đổi chưa đồng bộ của máy nào, v3 bị đóng băng", async () => {
    // Lịch sử v3: base chung v4 = {ex_1}; v5 (máy A đã đẩy) = {ex_1, ex_2}
    const v4 = withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" })
    const v5 = withExpense(v4, { id: "ex_2", amountVnd: 2, date: "2026-10-02" })
    await seedV3Remote(redis, { version: 5, genesis: "gen_v3", doc: { cttm: v5, templates: { items: [], tombstones: {} } } })

    // Máy A: đã ở v5, thêm ex_a chưa kịp đẩy.
    const browserA = createBrowser("A")
    seedV3Local(browserA.storage, {
      local: withExpense(v5, { id: "ex_a", amountVnd: 10, date: "2026-10-23" }),
      base: { cttm: v5, templates: { items: [], tombstones: {} } },
      baseVersion: 5,
      genesis: "gen_v3",
    })
    // Máy B: còn ở v4, sửa ex_1 và thêm ex_b, chưa đẩy.
    const browserB = createBrowser("B")
    const bLocal = withExpense(withExpense(v4, { id: "ex_1", amountVnd: 111, date: "2026-10-01", at: "2026-10-23T09:00:00.000Z" }), {
      id: "ex_b",
      amountVnd: 20,
      date: "2026-10-23",
    })
    seedV3Local(browserB.storage, { local: bLocal, base: { cttm: v4, templates: { items: [], tombstones: {} } }, baseVersion: 4, genesis: "gen_v3" })

    const a = await openTab(browserA, redis)
    const b = await openTab(browserB, redis)
    await sync(a, b, a)

    const expected = ["ex_1", "ex_2", "ex_a", "ex_b"]
    expect(ids(a)).toEqual(expected)
    expect(ids(b)).toEqual(expected)
    expect(a.store.doc.cttm.entities.expenses.byId.ex_1.amountVnd).toBe(111)
    expect(redis.strings.get("mf3:version")).toBe("frozen-v4:5")
    expect(JSON.parse(redis.strings.get(LEDGER_KEYS.migration) as string).state).toBe("done")
    // Dữ liệu v3 trên Redis và localStorage bản cũ vẫn còn nguyên để quay lại.
    expect(redis.strings.get("mf3:snap:5")).toBeTruthy()
    expect(browserB.storage.getItem("cttm_v1")).toBe(JSON.stringify(bLocal))
  })

  it("mục đã xoá trong v3 không sống lại khi máy có base cũ (còn giữ mục đó) gia nhập sau", async () => {
    const v4 = withExpense(withExpense(makeConfiguredState(), { id: "ex_keep", amountVnd: 1, date: "2026-10-01" }), { id: "ex_gone", amountVnd: 2, date: "2026-10-01" })
    const v5 = withoutExpense(v4, "ex_gone", "2026-10-22T10:00:00.000Z")
    await seedV3Remote(redis, { version: 5, genesis: "gen_v3", doc: { cttm: v5, templates: { items: [], tombstones: {} } } })
    const browserA = createBrowser("A")
    seedV3Local(browserA.storage, { local: v5, base: { cttm: v5, templates: { items: [], tombstones: {} } }, baseVersion: 5, genesis: "gen_v3" })
    const browserB = createBrowser("B")
    const bLocal = withExpense(v4, { id: "ex_b", amountVnd: 3, date: "2026-10-23" })
    seedV3Local(browserB.storage, { local: bLocal, base: { cttm: v4, templates: { items: [], tombstones: {} } }, baseVersion: 4, genesis: "gen_v3" })
    const a = await openTab(browserA, redis)
    const b = await openTab(browserB, redis)
    await sync(a, b, a)
    expect(ids(a)).toEqual(["ex_b", "ex_keep"])
    expect(ids(b)).toEqual(["ex_b", "ex_keep"])
  })

  it("máy thứ hai chờ máy đang chuyển đổi, không chen ghi", async () => {
    await seedV3Remote(redis, { version: 3, genesis: "gen_v3", doc: { cttm: withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" }), templates: { items: [], tombstones: {} } } })
    redis.strings.set(LEDGER_KEYS.migration, JSON.stringify({ state: "running", by: "d_other", byLabel: "Máy khác", at: Date.now() }))
    const b = await freshDevice("B", redis, withExpense(makeConfiguredState(), { id: "ex_b", amountVnd: 1, date: "2026-10-02" }))
    await sync(b)
    expect(b.engine.getState().phase).toBe("migrating")
    expect(redis.log()).toHaveLength(0)
    expect(redis.strings.get("mf3:version")).toBe("3")
  })

  it("tab bản cũ ghi thêm sau khi máy đã lên sổ cái: nhận khoản mới, không lùi cài đặt", async () => {
    const a = await freshDevice("A", redis, withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" }))
    await sync(a)
    a.store.act((s) => ({ ...s, settings: { ...s.settings, monthlyIncomeVnd: 30_000_000 } }))
    await sync(a)
    // Tab bản cũ (RAM cũ: lương 20tr) ghi cttm_v1 kèm một khoản chi mới.
    vi.setSystemTime(Date.now() + 60_000)
    const oldTab = withExpense(makeConfiguredState(), { id: "ex_1", amountVnd: 1, date: "2026-10-01" })
    a.browser.storage.setItem("cttm_v1", JSON.stringify(withExpense(oldTab, { id: "ex_oldtab", amountVnd: 5, date: "2026-10-24", at: new Date().toISOString() })))
    a.fire("storage", { key: "cttm_v1" })
    await settle(a)
    await sync(a)
    expect(ids(a)).toEqual(["ex_1", "ex_oldtab"])
    expect(a.store.doc.cttm.settings.monthlyIncomeVnd).toBe(30_000_000)
  })
})
