// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REDIS_KEYS, readLegacySnapshot } from "@/sync/redisProtocol"
import { legacyChecksum } from "@/sync/snapshot"
import {
  createDevice,
  expenseIds,
  FakeRedis,
  makeState,
  settle,
  withExpense,
  withFixedCost,
  withoutExpense,
  type Device,
} from "./harness"

async function boot(device: Device) {
  device.engine.start()
  await device.engine.whenIdle()
  await settle(0)
}

async function pushNow(device: Device) {
  // dirty-check 300ms + push debounce 2500ms
  await settle(300)
  await settle(2500)
  await device.engine.whenIdle()
  await settle(0)
}

async function poll(device: Device) {
  await settle(45_000)
  await device.engine.whenIdle()
  await settle(0)
}

describe("SyncEngine — 4 đường mất dữ liệu đã được đóng", () => {
  let redis: FakeRedis

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"))
    redis = new FakeRedis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("(1) tab cũ để mở suốt tuần không thể ghi đè dữ liệu máy khác", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 10_000, date: "2026-08-28" })
    const A = createDevice("A", redis, seed, { label: "A" })
    await boot(A)
    await pushNow(A)
    expect(redis.version()).toBe(1)

    const B = createDevice("B", redis, makeState(), { label: "B" })
    await boot(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_seed"])

    // B dùng cả tuần
    for (let i = 1; i <= 5; i += 1) {
      vi.setSystemTime(new Date(`2026-09-0${i}T12:00:00.000Z`))
      B.store.mutate((s) => withExpense(s, { id: `ex_b${i}`, amountVnd: 50_000 * i, date: `2026-09-0${i}` }))
      await pushNow(B)
    }
    expect(redis.version()).toBe(6)

    // Tab A vẫn mở suốt tuần: tick auto-close mỗi phút không đổi gì → không push, không đè
    const evalsBefore = redis.evalCalls
    for (let minute = 0; minute < 60; minute += 1) {
      A.engine.requestAutoClose("2026-09")
      await settle(60_000)
    }
    await A.engine.whenIdle()
    expect(redis.evalCalls).toBe(evalsBefore)
    expect(redis.version()).toBe(6)
    // và A đã tự kéo về dữ liệu tuần của B qua poll
    expect(expenseIds(A.store.data)).toEqual(["ex_b1", "ex_b2", "ex_b3", "ex_b4", "ex_b5", "ex_seed"])

    // A ghi thêm 1 khoản: kết quả = tuần của B + khoản mới, không mất gì
    A.store.mutate((s) => withExpense(s, { id: "ex_a_new", amountVnd: 1_000, date: "2026-09-05" }))
    await pushNow(A)
    expect(redis.version()).toBe(7)
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_a_new", "ex_b1", "ex_b2", "ex_b3", "ex_b4", "ex_b5", "ex_seed"])
  })

  it("(2) boot lỗi mạng: không bao giờ push dữ liệu cũ, tự merge khi mạng trở lại", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 10_000, date: "2026-08-28" })
    const A = createDevice("A", redis, seed, { label: "A" })
    await boot(A)
    await pushNow(A)
    expect(redis.version()).toBe(1)
    const B = createDevice("B", redis, makeState(), { label: "B" })
    await boot(B)
    B.store.mutate((s) => withExpense(s, { id: "ex_b_week", amountVnd: 99_000, date: "2026-09-03" }))
    await pushNow(B)
    expect(redis.version()).toBe(2)

    // A mở lại với bản cũ trong bộ nhớ, mạng lỗi lúc boot (đo lệch giờ + đọc version đều thất bại)
    A.engine.stop()
    redis.failNext("network", 2)
    A.engine.restart()
    await A.engine.whenIdle()
    await settle(0)
    expect(A.engine.getState().pushGate).toBe(false)
    expect(["offline", "degraded"]).toContain(A.engine.getState().phase)

    // Người dùng thao tác trên A khi chưa pull được
    A.store.mutate((s) => withExpense(s, { id: "ex_a_offline", amountVnd: 5_000, date: "2026-09-05" }))
    const evalsBefore = redis.evalCalls
    await pushNow(A)
    expect(redis.evalCalls).toBe(evalsBefore) // KHÔNG có push nào khi chưa pull thành công
    expect(redis.version()).toBe(2)

    // Mạng trở lại → pull → merge → push
    A.fire("online")
    await A.engine.whenIdle()
    await settle(0)
    await pushNow(A)
    expect(redis.version()).toBe(3)
    expect(expenseIds(A.store.data)).toEqual(["ex_a_offline", "ex_b_week", "ex_seed"])
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_a_offline", "ex_b_week", "ex_seed"])
  })

  it("(3) ranh giới tháng: dữ liệu dẫn xuất chỉ sinh sau khi pull, id tất định nên không nhân đôi", async () => {
    const seed = withFixedCost(makeState(), { id: "fc_aug", month: "2026-08", name: "Tiền nhà", amountVnd: 5_000_000 })
    const cloneFor = (month: string) => (s: ReturnType<typeof makeState>) => {
      if (s.entities.fixedCosts.byId[`fc_${month}_x`]) return s
      return withFixedCost(s, { id: `fc_${month}_x`, month, name: "Tiền nhà", amountVnd: 5_000_000 })
    }
    // A đã đồng bộ từ tháng 8 (có điểm chung với Redis)
    const A = createDevice("A", redis, seed, { label: "A" })
    expect(A.engine.getState().derivedWritesAllowed).toBe(false)
    await boot(A)
    await pushNow(A)
    expect(redis.version()).toBe(1)

    // B dùng trong tháng 9: sang tháng → clone chi phí cố định, rồi ghi chi tiêu
    const B = createDevice("B", redis, makeState(), { label: "B" })
    B.store.autoCloseImpl = cloneFor("2026-09")
    await boot(B)
    await pushNow(B)
    expect(B.store.data.entities.fixedCosts.allIds).toContain("fc_2026-09_x")
    B.store.mutate((s) => withExpense(s, { id: "ex_b_sep", amountVnd: 70_000, date: "2026-09-02" }))
    await pushNow(B)

    // A mở lại sau ranh giới tháng với bản cũ trong bộ nhớ: auto-close bị hoãn tới sau pull
    A.engine.stop()
    let autoCloseRuns = 0
    A.store.autoCloseImpl = (s) => {
      autoCloseRuns += 1
      return cloneFor("2026-09")(s)
    }
    A.engine.restart()
    expect(A.engine.getState().derivedWritesAllowed).toBe(false)
    await A.engine.whenIdle()
    await settle(0)
    expect(autoCloseRuns).toBeGreaterThan(0)
    // Sau pull A đã có clone của B (cùng id) → không tạo bản thứ hai
    const fcIds = A.store.data.entities.fixedCosts.allIds.filter((id) => id.startsWith("fc_2026-09"))
    expect(fcIds).toEqual(["fc_2026-09_x"])
    expect(expenseIds(A.store.data)).toEqual(["ex_b_sep"])
    await pushNow(A)
    // Không có gì mới để đẩy
    expect(A.engine.getState().dirty).toBe(false)
  })

  it("(4) xung đột thật sự (hai máy cùng sửa khi chưa thấy nhau) được merge, không đè", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 10_000, date: "2026-08-28" })
    const A = createDevice("A", redis, seed, { label: "A" })
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState(), { label: "B" })
    await boot(B)

    // B sửa và bắt đầu push; lệnh ghi của B bị giữ lại ngay trước khi Redis thực thi
    const release = redis.holdEvalFor(B.engine.getState().deviceId)
    B.store.mutate((s) => withExpense(s, { id: "ex_b1", amountVnd: 2, date: "2026-09-05" }))
    await settle(300)
    await settle(2500)
    // Trong lúc đó A ghi và commit trước → version 2
    A.store.mutate((s) => withExpense(s, { id: "ex_a1", amountVnd: 1, date: "2026-09-05" }))
    await pushNow(A)
    expect(redis.version()).toBe(2)
    // Thả B: CAS trượt (expected 1 ≠ 2) → pull → merge → push lại thành v3, không đè A
    release()
    await B.engine.whenIdle()
    await settle(0)
    expect(redis.version()).toBe(3)
    expect(expenseIds(B.store.data)).toEqual(["ex_a1", "ex_b1", "ex_seed"])
    await poll(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_a1", "ex_b1", "ex_seed"])
  })
})

describe("SyncEngine — bảo vệ và khôi phục", () => {
  let redis: FakeRedis

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"))
    redis = new FakeRedis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("xoá có tombstone lan sang máy khác; sửa sau khi xoá được giữ lại", async () => {
    let seed = makeState()
    seed = withExpense(seed, { id: "ex_1", amountVnd: 1, date: "2026-09-01" })
    seed = withExpense(seed, { id: "ex_2", amountVnd: 2, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState())
    await boot(B)

    // A xoá ex_1 lúc 10:05, B sửa ex_2 lúc 10:06 rồi A xoá ex_2 lúc 10:04 (trước khi B sửa)
    A.store.mutate((s) => withoutExpense(s, "ex_1", "2026-09-05T10:05:00.000Z"))
    A.store.mutate((s) => withoutExpense(s, "ex_2", "2026-09-05T10:04:00.000Z"))
    await pushNow(A)
    B.store.mutate((s) => withExpense(s, { id: "ex_2", amountVnd: 222, date: "2026-09-01", at: "2026-09-05T10:06:00.000Z" }))
    await pushNow(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_2"]) // ex_1 bị xoá theo tombstone, ex_2 giữ vì sửa sau khi xoá
    expect(B.store.data.entities.expenses.byId.ex_2.amountVnd).toBe(222)
    expect(B.engine.getState().conflictsCount).toBeGreaterThan(0)
    await poll(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_2"])
  })

  it("xoá hàng loạt ở máy khác phải qua hộp thoại; 'giữ máy này' không mất gì và bản Redis được ghim", async () => {
    let seed = makeState()
    for (let i = 0; i < 30; i += 1) seed = withExpense(seed, { id: `ex_${i}`, amountVnd: i + 1, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState())
    await boot(B)
    expect(expenseIds(B.store.data)).toHaveLength(30)

    // B "reset all"
    B.store.mutate((s) => {
      const tomb: Record<string, string> = {}
      for (const id of s.entities.expenses.allIds) tomb[id] = "2026-09-05T11:00:00.000Z"
      return { ...makeState(), tombstones: tomb }
    })
    await pushNow(B)
    const resetVersion = redis.version()

    await poll(A)
    const dialog = A.engine.getState().dialog
    expect(dialog?.kind).toBe("mass-delete")
    expect(expenseIds(A.store.data)).toHaveLength(30) // chưa áp dụng gì

    await A.engine.resolveDialog("keep-local")
    await A.engine.whenIdle()
    await settle(0)
    expect(A.engine.getState().dialog).toBeNull()
    expect(expenseIds(A.store.data)).toHaveLength(30)
    expect(redis.version()).toBe(resetVersion + 1)
    expect(redis.sets.get(REDIS_KEYS.pins)?.has(String(resetVersion))).toBe(true)
  })

  it("Redis bị xoá sạch: không tự đẩy bản cũ lên mù, hỏi người dùng", async () => {
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    await boot(A)
    await pushNow(A)
    expect(redis.version()).toBe(1)
    redis.flushAll()
    await poll(A)
    expect(A.engine.getState().dialog?.kind).toBe("remote-reset")
    await A.engine.resolveDialog("push-local")
    await A.engine.whenIdle()
    await settle(0)
    expect(redis.version()).toBe(1)
    expect(redis.store.get(REDIS_KEYS.genesis)).toBeTruthy()
  })

  it("máy mới có dữ liệu riêng: hộp thoại no-base, gộp giữ cả hai", async () => {
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_a", amountVnd: 1, date: "2026-09-01" }))
    await boot(A)
    await pushNow(A)
    const C = createDevice("C", redis, withExpense(makeState(), { id: "ex_c", amountVnd: 2, date: "2026-09-02" }))
    await boot(C)
    expect(C.engine.getState().dialog?.kind).toBe("no-base")
    await C.engine.resolveDialog("merge")
    await C.engine.whenIdle()
    await settle(0)
    expect(expenseIds(C.store.data)).toEqual(["ex_a", "ex_c"])
    expect(redis.version()).toBe(2)
    await poll(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_a", "ex_c"])
  })

  it("mất response sau khi Redis đã ghi: không tạo bản trùng, không mất", async () => {
    const A = createDevice("A", redis, makeState())
    await boot(A)
    A.store.mutate((s) => withExpense(s, { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    redis.failNext("commit-then-lose-response", 1)
    await pushNow(A)
    // lần đầu: commit xong nhưng client nhận lỗi mạng → phase offline; wake → pre-push pull thấy head của chính mình
    A.fire("online")
    await A.engine.whenIdle()
    await settle(0)
    await pushNow(A)
    expect(redis.version()).toBe(1)
    expect(A.engine.getState().dirty).toBe(false)
    expect(A.engine.getState().baseVersion).toBe(1)
  })

  it("khôi phục một bản cũ từ lịch sử Redis và ghim", async () => {
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    await boot(A)
    await pushNow(A)
    A.store.mutate((s) => withoutExpense(s, "ex_1", "2026-09-05T10:10:00.000Z"))
    await pushNow(A)
    expect(expenseIds(A.store.data)).toEqual([])
    const history = await A.engine.listRemoteHistory()
    expect(history.map((h) => h.version)).toEqual([2, 1])
    await A.engine.restoreRemoteVersion(1, "replace")
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_1"])
    expect(redis.version()).toBe(3)
    expect(redis.sets.get(REDIS_KEYS.pins)?.has("2")).toBe(true)
  })

  it("khôi phục bản cũ hồi sinh được mục đã xoá trên MỌI thiết bị (thắng tombstone)", async () => {
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_1", amountVnd: 1, date: "2026-09-01" }))
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState())
    await boot(B)
    A.store.mutate((s) => withoutExpense(s, "ex_1", "2026-09-05T10:10:00.000Z"))
    await pushNow(A)
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual([])
    vi.setSystemTime(new Date("2026-09-05T10:20:00.000Z"))
    await A.engine.restoreRemoteVersion(1, "replace")
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_1"])
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_1"])
    await poll(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_1"])
    // và chế độ "gộp" cũng lấy lại được mục đã xoá ngay trên một máy
    A.store.mutate((s) => withoutExpense(s, "ex_1", "2026-09-05T10:30:00.000Z"))
    await pushNow(A)
    vi.setSystemTime(new Date("2026-09-05T10:40:00.000Z"))
    await A.engine.restoreRemoteVersion(1, "merge")
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_1"])
  })

  it("tab build cũ ghi đè cttm_v1 bằng bản cũ: RAM không mất gì, đĩa được sửa lại, Redis không mất", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 1, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    A.store.mutate((s) => withExpense(s, { id: "ex_new", amountVnd: 2, date: "2026-09-02" }))
    await pushNow(A)
    expect(redis.version()).toBe(2)
    A.fire("storage", { key: "cttm_v1", newValue: JSON.stringify(seed) })
    expect(expenseIds(A.store.data)).toEqual(["ex_new", "ex_seed"])
    expect(expenseIds(A.store.loadRealFromDisk())).toEqual(["ex_new", "ex_seed"])
    await pushNow(A)
    expect(redis.version()).toBe(2)

    // Tab cũ ghi đè đĩa khi tab mới đã đóng → lần boot sau không được suy luận "đã xoá"
    A.engine.stop()
    A.storage.setItem("cttm_v1", JSON.stringify(seed))
    A.store.data = A.store.loadRealFromDisk()
    A.engine.restart()
    await A.engine.whenIdle()
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_new", "ex_seed"])
    await pushNow(A)
    const head = JSON.parse(redis.store.get("mf3:head") ?? "{}")
    const snap = JSON.parse(redis.store.get(`mf3:snap:${head.version}`) ?? "{}")
    expect(Object.keys(snap.data.cttm.entities.expenses.byId).sort()).toEqual(["ex_new", "ex_seed"])
  })

  it("tab build cũ ghi settings cũ: không làm lùi settings; tab build mới ghi settings mới: được nhận", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 1, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    A.store.mutate((s) => ({ ...s, settings: { ...s.settings, monthlyIncomeVnd: 30_000_000 } }))
    await pushNow(A)
    // Tab build cũ (không bump writeSeq) ghi bản có income cũ
    A.fire("storage", { key: "cttm_v1", newValue: JSON.stringify(seed) })
    expect(A.store.data.settings.monthlyIncomeVnd).toBe(30_000_000)
    expect(expenseIds(A.store.data)).toEqual(["ex_seed"])
    // Tab build mới ghi income khác (có bump writeSeq) → nhận
    const other = { ...A.store.data, settings: { ...A.store.data.settings, monthlyIncomeVnd: 35_000_000 } }
    A.fire("storage", { key: "cttm_v1", newValue: A.store.writeAsNewBuildTab(other) })
    expect(A.store.data.settings.monthlyIncomeVnd).toBe(35_000_000)
  })

  it("đĩa bị tiến trình lạ ghi thiếu entity, người dùng thao tác offline rồi mới có mạng: không mất entity", async () => {
    let seed = makeState()
    seed = withExpense(seed, { id: "ex_a", amountVnd: 1, date: "2026-09-01" })
    seed = withExpense(seed, { id: "ex_b", amountVnd: 2, date: "2026-09-02" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState())
    await boot(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_a", "ex_b"])

    // Tab build cũ ghi đè đĩa thiếu ex_b (không tombstone) khi tab mới đã đóng
    A.engine.stop()
    const stale = withoutExpense(seed, "ex_b", "2026-09-05T09:00:00.000Z")
    delete stale.tombstones
    A.storage.setItem("cttm_v1", JSON.stringify(stale))
    A.store.data = A.store.loadRealFromDisk()
    // Mở lại khi mất mạng, thao tác một chút (dirty), rồi mạng trở lại
    redis.failNext("network", 2)
    A.engine.restart()
    await A.engine.whenIdle()
    await settle(0)
    A.store.mutate((s) => withExpense(s, { id: "ex_c", amountVnd: 3, date: "2026-09-05" }))
    await settle(300)
    A.fire("online")
    await A.engine.whenIdle()
    await settle(0)
    await pushNow(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_a", "ex_b", "ex_c"])
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_a", "ex_b", "ex_c"])
  })

  it("'xoá toàn bộ' không bị huỷ ngầm khi máy khác vừa push; mục máy khác mới thêm được giữ", async () => {
    let seed = makeState()
    for (let i = 0; i < 3; i += 1) seed = withExpense(seed, { id: `ex_${i}`, amountVnd: 1, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    const B = createDevice("B", redis, makeState())
    await boot(B)
    B.store.mutate((s) => withExpense(s, { id: "ex_b_new", amountVnd: 9, date: "2026-09-05" }))
    await pushNow(B)
    // A "xoá toàn bộ" (tombstone cho mọi id A biết) khi chưa poll
    A.store.mutate((s) => {
      const tomb: Record<string, string> = {}
      for (const id of s.entities.expenses.allIds) tomb[id] = "2026-09-05T11:00:00.000Z"
      return { ...makeState(), tombstones: tomb }
    })
    await pushNow(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_b_new"])
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_b_new"])
  })

  it("khôi phục 'thay thế' hồi sinh cả mục mà máy khác đã xoá SAU bản đó; 'gộp' giữ nguyên settings hiện tại", async () => {
    let seed = makeState()
    seed = withExpense(seed, { id: "ex_x", amountVnd: 1, date: "2026-09-01" })
    seed = withExpense(seed, { id: "ex_y", amountVnd: 2, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A) // v1: x, y
    const B = createDevice("B", redis, makeState())
    await boot(B)
    A.store.mutate((s) => withExpense(s, { id: "ex_z", amountVnd: 3, date: "2026-09-02" }))
    await pushNow(A) // v2: x, y, z
    await poll(B)
    B.store.mutate((s) => withoutExpense(s, "ex_x", "2026-09-05T10:05:00.000Z"))
    await pushNow(B) // v3: y, z (+tombstone x) — A chưa poll
    vi.setSystemTime(new Date("2026-09-05T10:20:00.000Z"))
    await A.engine.restoreRemoteVersion(1, "replace")
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_x", "ex_y"])
    await poll(B)
    expect(expenseIds(B.store.data)).toEqual(["ex_x", "ex_y"])

    // "gộp" v2 (có z) vào hiện tại sau khi đổi settings: lấy lại z, settings không lùi
    A.store.mutate((s) => ({ ...s, settings: { ...s.settings, monthlyIncomeVnd: 30_000_000 } }))
    await pushNow(A)
    vi.setSystemTime(new Date("2026-09-05T10:40:00.000Z"))
    await A.engine.restoreRemoteVersion(2, "merge")
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_x", "ex_y", "ex_z"])
    expect(A.store.data.settings.monthlyIncomeVnd).toBe(30_000_000)
  })

  it("hai tab cùng máy: thay đổi của tab kia được gộp, không đè", async () => {
    const seed = withExpense(makeState(), { id: "ex_seed", amountVnd: 1, date: "2026-09-01" })
    const A = createDevice("A", redis, seed)
    await boot(A)
    await pushNow(A)
    // Tab này có thay đổi chưa lưu; tab kia vừa ghi đĩa một thay đổi khác
    A.store.mutate((s) => withExpense(s, { id: "ex_tab1", amountVnd: 2, date: "2026-09-02" }))
    const otherTab = withExpense(A.store.loadRealFromDisk(), { id: "ex_tab2", amountVnd: 3, date: "2026-09-03" })
    A.fire("storage", { key: "cttm_v1", newValue: JSON.stringify(otherTab) })
    expect(expenseIds(A.store.data)).toEqual(["ex_seed", "ex_tab1", "ex_tab2"])
  })
})

describe("SyncEngine — migration từ key cũ (v2)", () => {
  let redis: FakeRedis

  function seedLegacy(state: ReturnType<typeof makeState>) {
    const values = { cttm_v1: JSON.stringify(state), "smartSpend.ui.theme.v1": "dark" }
    const payload = {
      schemaVersion: 2,
      manifest: { schemaVersion: 1, revision: 1, updatedAt: 1, keyCount: 2, keys: Object.keys(values).sort(), checksum: legacyChecksum(values) },
      values,
    }
    redis.store.set(REDIS_KEYS.legacySnapshot, JSON.stringify(payload))
    return payload.manifest.checksum
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"))
    redis = new FakeRedis()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("máy trống nhận bản cũ, tạo v3, lưu trữ bản cũ và thay key cũ bằng marker rỗng", async () => {
    const legacyState = withExpense(makeState(), { id: "ex_old", amountVnd: 5, date: "2026-08-20" })
    seedLegacy(legacyState)
    const A = createDevice("A", redis, makeState())
    await boot(A)
    await pushNow(A)
    expect(expenseIds(A.store.data)).toEqual(["ex_old"])
    expect(redis.version()).toBe(1)
    expect(redis.store.has(REDIS_KEYS.legacyArchive)).toBe(true)
    // Marker cố ý không parse được như snapshot v2 (build cũ sẽ coi remote là rỗng)
    expect(await readLegacySnapshot(redis)).toBeNull()
    const marker = JSON.parse(redis.store.get(REDIS_KEYS.legacySnapshot) ?? "{}")
    expect(marker.supersededBy).toBe("v3")
    expect(marker.schemaVersion).toBe(3)
    expect(JSON.parse(redis.store.get(REDIS_KEYS.legacyArchive) ?? "{}").values.cttm_v1).toContain("ex_old")
  })

  it("máy có dữ liệu khác bản cũ: hỏi người dùng, gộp giữ cả hai", async () => {
    seedLegacy(withExpense(makeState(), { id: "ex_old", amountVnd: 5, date: "2026-08-20" }))
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_local", amountVnd: 7, date: "2026-09-01" }))
    await boot(A)
    expect(A.engine.getState().dialog?.kind).toBe("migrate-v2")
    await A.engine.resolveDialog("merge")
    await A.engine.whenIdle()
    await settle(0)
    expect(expenseIds(A.store.data)).toEqual(["ex_local", "ex_old"])
    expect(redis.version()).toBe(1)
  })

  it("thiết bị chạy bản cũ ghi thêm sau khi đã migrate: phát hiện khi boot và gộp", async () => {
    const A = createDevice("A", redis, withExpense(makeState(), { id: "ex_a", amountVnd: 1, date: "2026-09-01" }))
    await boot(A)
    await pushNow(A)
    expect(redis.version()).toBe(1)
    // App cũ trên máy khác ghi mù vào key cũ
    seedLegacy(withExpense(makeState(), { id: "ex_from_old_build", amountVnd: 9, date: "2026-09-04" }))
    const A2 = createDevice("A2", redis, A.store.data)
    A2.storage.map = new Map(A.storage.map)
    await boot(A2)
    expect(A2.engine.getState().dialog?.kind).toBe("legacy-changed")
    await A2.engine.resolveDialog("merge")
    await A2.engine.whenIdle()
    await settle(0)
    expect(expenseIds(A2.store.data)).toEqual(["ex_a", "ex_from_old_build"])
    expect(redis.version()).toBe(2)
  })
})
