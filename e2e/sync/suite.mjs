// Bộ kịch bản đa thiết bị trên Edge thật. Chạy: node suite.mjs [tên kịch bản...]
import {
  act,
  Checker,
  closeDevices,
  cmd,
  faults,
  fullState,
  newDevice,
  openTab,
  quickState,
  readLog,
  referenceFold,
  resetRedis,
  rng,
  seed,
  settle,
  sleep,
  startInfra,
  stats,
  stopInfra,
  verify,
  APP,
} from "./lib.mjs"

const BASE_LOCAL = { cttm_v1: seed.localA.cttm_v1, "smartSpend.templates.v1": seed.localA["smartSpend.templates.v1"] }
const BASE_COUNT = 903 // 900 + ex_v12 + ex_A1 + ex_A2

/** Máy A khởi tạo sổ cái từ dữ liệu sẵn có (không có v3 trên Redis); các máy khác là máy mới. */
async function baseline(browser, names) {
  await resetRedis()
  const devices = []
  const a = await newDevice(browser, names[0], { local: BASE_LOCAL })
  await openTab(a)
  await settle(a.tabs)
  devices.push(a)
  for (const name of names.slice(1)) {
    const d = await newDevice(browser, name)
    await openTab(d)
    devices.push(d)
  }
  await settle(devices.flatMap((d) => d.tabs))
  return devices
}

const all = (devices) => devices.flatMap((d) => d.tabs)

const SCENARIOS = {
  async "01 chuyển đổi v3 thật: 5 máy (lệch base, có thay đổi chưa đẩy, máy mới, base không tin được)"(browser, check) {
    await resetRedis(seed.remote)
    const A = await newDevice(browser, "A-laptop", { local: seed.localA })
    await openTab(A)
    await settle(A.tabs)
    check.ok("v3 bị đóng băng", (await cmd("GET", "mf3:version")) === "frozen-v4:12")
    const others = await Promise.all([
      newDevice(browser, "B-phone", { local: seed.localB }),
      newDevice(browser, "C-new"),
      newDevice(browser, "D-tablet", { local: seed.localD }),
      newDevice(browser, "E-untrusted", { local: seed.localE }),
    ])
    await Promise.all(others.map((d) => openTab(d)))
    const devices = [A, ...others]
    await settle(all(devices))
    const { reference } = await verify(check, devices, {
      notes: { "A chưa đồng bộ 1": 1, "A chưa đồng bộ 2": 1, "B sửa offline": 1, "đẩy lên v12 từ máy A": 1, "E chưa đồng bộ": 1 },
      expenseCount: 903,
    })
    check.ok("B sửa ex_0005 = 999.000 được giữ", reference.records["expense/ex_0005"]?.amountVnd === 999000)
    check.ok("B xoá ex_0010 được giữ (kể cả khi E còn bản cũ)", !reference.records["expense/ex_0010"])
    check.ok("mẫu chi nhanh không bị nhân đôi", Object.keys(reference.records).filter((k) => k.startsWith("template/")).length === 2)
    return devices
  },

  async "02 hai máy v3 cùng mở bản mới một lúc (tranh nhau chuyển đổi)"(browser, check) {
    await resetRedis(seed.remote)
    const [A, B] = await Promise.all([newDevice(browser, "A", { local: seed.localA }), newDevice(browser, "B", { local: seed.localB })])
    await Promise.all([openTab(A), openTab(B)])
    const devices = [A, B]
    await settle(all(devices))
    const migration = JSON.parse(await cmd("GET", "mf4:migration"))
    check.ok("chỉ một máy chuyển đổi", migration.state === "done")
    const genesisPuts = (await readLog()).filter((op) => op.tx === "migrate").map((op) => op.dev)
    check.ok("bộ genesis do đúng MỘT thiết bị ghi", new Set(genesisPuts).size === 1)
    const { reference } = await verify(check, devices, { notes: { "A chưa đồng bộ 1": 1, "A chưa đồng bộ 2": 1, "B sửa offline": 1 }, expenseCount: 902 })
    check.ok("thay đổi của B còn nguyên", reference.records["expense/ex_0005"]?.amountVnd === 999000 && !reference.records["expense/ex_0010"])
    return devices
  },

  async "03 ba máy cùng thêm 20 khoản đan xen, mạng trễ ngẫu nhiên"(browser, check) {
    const devices = await baseline(browser, ["A", "B", "C"])
    faults.delayMax = 200
    const notes = {}
    await Promise.all(
      devices.map(async (d) => {
        for (let i = 0; i < 20; i += 1) {
          const note = `S03-${d.name}-${i}`
          notes[note] = 1
          await act.add(d.tabs[0], note, 1000 + i)
          if (i % 4 === 3) await act.sync(d.tabs[0])
        }
      }),
    )
    await settle(all(devices))
    await verify(check, devices, { notes, prefixes: ["S03-"], expenseCount: BASE_COUNT + 60 })
    return devices
  },

  async "04 một máy 3 tab cùng thêm (đồng thời) + đồng bộ đồng thời"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await openTab(A)
    await openTab(A)
    const notes = {}
    await Promise.all(
      A.tabs.map(async (tab, t) => {
        for (let i = 0; i < 15; i += 1) {
          const note = `S04-tab${t}-${i}`
          notes[note] = 1
          await act.add(tab, note)
        }
      }),
    )
    await Promise.all(A.tabs.map((tab) => act.sync(tab)))
    await settle(all([A, B]))
    await verify(check, [A, B], { notes, prefixes: ["S04-"], expenseCount: BASE_COUNT + 45 })
    return [A, B]
  },

  async "05 ba máy sửa KHÁC field của cùng một khoản cùng lúc"(browser, check) {
    const devices = await baseline(browser, ["A", "B", "C"])
    await act.add(devices[0].tabs[0], "S05-X", 5000, "2026-10-01")
    await settle(all(devices))
    await Promise.all([
      act.edit(devices[0].tabs[0], "S05-X", { amountVnd: 123_000 }),
      act.edit(devices[1].tabs[0], "S05-X", { date: "2026-10-15" }),
      act.edit(devices[2].tabs[0], "S05-X", { category: "Transport" }),
    ])
    await Promise.all(all(devices).map((t) => act.sync(t)))
    await settle(all(devices))
    const { reference } = await verify(check, devices, { notes: { "S05-X": 1 } })
    const x = Object.values(reference.records).find((r) => r.note === "S05-X")
    check.ok("cả 3 field đều được giữ", x?.amountVnd === 123000 && x?.date === "2026-10-15" && x?.category === "Transport", JSON.stringify(x))
    return devices
  },

  async "06 ba máy sửa CÙNG field cùng lúc: mọi máy hội tụ một giá trị, lịch sử giữ đủ 3"(browser, check) {
    const devices = await baseline(browser, ["A", "B", "C"])
    await act.add(devices[0].tabs[0], "S06-X", 5000)
    await settle(all(devices))
    faults.delayMax = 150
    await Promise.all(devices.map((d, i) => act.edit(d.tabs[0], "S06-X", { amountVnd: 100_000 * (i + 1) })))
    await Promise.all(all(devices).map((t) => act.sync(t)))
    await settle(all(devices))
    const { reference, log } = await verify(check, devices, { notes: { "S06-X": 1 } })
    const x = Object.values(reference.records).find((r) => r.note === "S06-X")
    check.ok("giá trị cuối là một trong 3 giá trị đã nhập", [100000, 200000, 300000].includes(x?.amountVnd), String(x?.amountVnd))
    const patches = log.filter((op) => op.t === "patch" && op.v?.amountVnd >= 100000 && op.key === Object.keys(reference.records).find((k) => reference.records[k] === x))
    check.ok("sổ cái giữ đủ 3 lần sửa (khôi phục được giá trị nào cũng được)", patches.length === 3, `${patches.length}`)
    return devices
  },

  async "07 A xoá, B (mất mạng) sửa cùng khoản"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(A.tabs[0], "S07-X", 5000)
    await settle(all([A, B]))
    await B.context.setOffline(true)
    await act.edit(B.tabs[0], "S07-X", { amountVnd: 999 })
    await act.del(A.tabs[0], "S07-X")
    await settle(A.tabs)
    await B.context.setOffline(false)
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S07-X": 0 } })
    return [A, B]
  },

  async "08 B mất mạng lâu: A thêm/sửa/xoá 30 lần (cả khoản B tạo), B làm 17 thao tác offline"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    const notes = {}
    for (let i = 0; i < 6; i += 1) {
      await act.add(B.tabs[0], `S08-Bold-${i}`)
      notes[`S08-Bold-${i}`] = 1
    }
    await settle(all([A, B]))
    await B.context.setOffline(true)
    for (let i = 0; i < 20; i += 1) {
      await act.add(A.tabs[0], `S08-A-${i}`)
      notes[`S08-A-${i}`] = 1
    }
    for (let i = 0; i < 5; i += 1) await act.edit(A.tabs[0], `S08-A-${i}`, { amountVnd: 55_555 })
    for (const i of [0, 1, 2]) {
      await act.del(A.tabs[0], `S08-Bold-${i}`)
      notes[`S08-Bold-${i}`] = 0
    }
    for (const i of [10, 11]) {
      await act.del(A.tabs[0], `S08-A-${i}`)
      notes[`S08-A-${i}`] = 0
    }
    await settle(A.tabs)
    for (let i = 0; i < 10; i += 1) {
      await act.add(B.tabs[0], `S08-Boff-${i}`)
      notes[`S08-Boff-${i}`] = 1
    }
    for (const i of [0, 3, 4, 5]) await act.edit(B.tabs[0], `S08-Bold-${i}`, { note: `S08-Bold-${i}`, amountVnd: 4_444 })
    await act.del(B.tabs[0], `S08-Bold-5`)
    notes["S08-Bold-5"] = 0
    await act.del(B.tabs[0], `S08-Boff-9`)
    notes["S08-Boff-9"] = 0
    check.ok("B vẫn lưu được khi offline", (await quickState(B.tabs[0])).pending > 0)
    await B.context.setOffline(false)
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B], { notes, prefixes: ["S08-"] })
    const b3 = Object.values(reference.records).find((r) => r.note === "S08-Bold-3")
    check.ok("sửa offline của B trên khoản còn sống được giữ", b3?.amountVnd === 4444)
    return [A, B]
  },

  async "09 tab bị trình duyệt đóng băng (RAM cũ) thao tác ngay khi được đánh thức"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    const tab1 = A.tabs[0]
    const tab2 = await openTab(A)
    await act.add(tab1, "S09-shared", 1000)
    await settle(all([A, B]))
    const cdp = await A.context.newCDPSession(tab1.page)
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" })
    const notes = { "S09-shared": 1 }
    for (let i = 0; i < 5; i += 1) {
      await act.add(tab2, `S09-tab2-${i}`)
      notes[`S09-tab2-${i}`] = 1
    }
    await act.del(tab2, "S09-shared")
    notes["S09-shared"] = 0
    await act.sync(tab2)
    for (let i = 0; i < 3; i += 1) {
      await act.add(B.tabs[0], `S09-B-${i}`)
      notes[`S09-B-${i}`] = 1
    }
    await act.sync(B.tabs[0])
    await cdp.send("Page.setWebLifecycleState", { state: "active" })
    // Ngay khi được đánh thức, trước khi kịp tải lại: thao tác trên RAM cũ.
    await act.run(tab1, () => {
      const s = window.__t.useAppStore.getState()
      s.actions.addExpense({ amountVnd: 7, category: "Food", note: "S09-tab1-after-wake", date: "2026-10-24" })
      const shared = Object.values(s.data.entities.expenses.byId).find((e) => e.note === "S09-shared")
      if (shared) window.__t.useAppStore.getState().actions.updateExpense(shared.id, { amountVnd: 8888 })
    })
    notes["S09-tab1-after-wake"] = 1
    await settle(all([A, B]))
    await verify(check, [A, B], { notes, prefixes: ["S09-"], expenseCount: BASE_COUNT + 9 })
    return [A, B]
  },

  async "10 mất phản hồi sau khi Redis ĐÃ ghi (30% lệnh ghi) — client tự gửi lại"(browser, check) {
    const devices = await baseline(browser, ["A", "B"])
    faults.failAfter = 0.3
    faults.onlyWrites = true
    faults.random = rng(10)
    const notes = {}
    await Promise.all(
      devices.map(async (d) => {
        for (let i = 0; i < 25; i += 1) {
          const note = `S10-${d.name}-${i}`
          notes[note] = 1
          await act.add(d.tabs[0], note)
          if (i % 3 === 0) await act.sync(d.tabs[0])
        }
      }),
    )
    for (let i = 0; i < 5; i += 1) for (const t of all(devices)) await act.sync(t)
    const injected = stats.failAfter
    faults.onlyWrites = false
    await settle(all(devices))
    check.ok("đã thực sự chèn lỗi mất phản hồi", injected > 0, `${injected} lần`)
    await verify(check, devices, { notes, prefixes: ["S10-"], expenseCount: BASE_COUNT + 50 })
    return devices
  },

  async "11 lỗi mạng trước khi tới Redis (20%) + trễ ngẫu nhiên cho mọi lệnh"(browser, check) {
    const devices = await baseline(browser, ["A", "B", "C"])
    faults.failBefore = 0.2
    faults.failAfter = 0.1
    faults.delayMax = 120
    faults.random = rng(11)
    const notes = {}
    await Promise.all(
      devices.map(async (d) => {
        for (let i = 0; i < 15; i += 1) {
          const note = `S11-${d.name}-${i}`
          notes[note] = 1
          await act.add(d.tabs[0], note)
          if (i % 2) await act.sync(d.tabs[0])
        }
      }),
    )
    await settle(all(devices))
    check.ok("đã thực sự chèn lỗi", stats.failBefore > 0)
    await verify(check, devices, { notes, prefixes: ["S11-"], expenseCount: BASE_COUNT + 45 })
    return devices
  },

  async "12 đóng tab ngay sau khi nhập (chưa kịp gửi) rồi mở lại"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(A.tabs[0], "S12-before-close")
    await sleep(250)
    await A.tabs[0].page.close()
    A.tabs.length = 0
    await openTab(A)
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S12-before-close": 1 }, expenseCount: BASE_COUNT + 1 })
    return [A, B]
  },

  async "13 hai máy cùng sang tháng mới khi mất mạng (dữ liệu tự sinh)"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.run(A.tabs[0], () => {
      const a = window.__t.useAppStore.getState().actions
      for (const name of ["Nhà T12", "Điện T12", "Mạng T12"]) a.addFixedCost({ month: "2026-12", name, amountVnd: 1_000_000 })
    })
    await settle(all([A, B]))
    await A.context.setOffline(true)
    await B.context.setOffline(true)
    await act.run(A.tabs[0], () => window.__t.useAppStore.getState().actions.ensureSettingsForMonth("2027-01"))
    await act.run(B.tabs[0], () => window.__t.useAppStore.getState().actions.ensureSettingsForMonth("2027-01"))
    await A.context.setOffline(false)
    await B.context.setOffline(false)
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B])
    const fc = Object.values(reference.records).filter((r) => r.month === "2027-01" && r.amountVnd === 1_000_000)
    check.ok("đúng 3 chi phí cố định tháng 2027-01 (không nhân đôi)", fc.length === 3, `${fc.length}`)
    check.ok("đúng 1 cấu hình tháng 2027-01", Boolean(reference.records["monthSettings/2027-01"]))
    return [A, B]
  },

  async "14 máy lệch giờ +1 năm: thứ tự theo server, không theo đồng hồ máy"(browser, check) {
    await resetRedis()
    const A = await newDevice(browser, "A", { local: BASE_LOCAL })
    await openTab(A)
    await settle(A.tabs)
    const B = await newDevice(browser, "B-future", { clockOffsetMs: 365 * 86_400_000 })
    await openTab(B)
    await act.add(A.tabs[0], "S14-X", 1000)
    await settle(all([A, B]))
    await act.edit(B.tabs[0], "S14-X", { amountVnd: 111 })
    await act.add(B.tabs[0], "S14-B", 2000)
    await settle(all([A, B]))
    await act.edit(A.tabs[0], "S14-X", { amountVnd: 222 })
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B], { notes: { "S14-X": 1, "S14-B": 1 } })
    const x = Object.values(reference.records).find((r) => r.note === "S14-X")
    check.ok("sửa đến sau (máy giờ đúng) thắng sửa của máy giờ tương lai", x?.amountVnd === 222, String(x?.amountVnd))
    return [A, B]
  },

  async "15 trình duyệt xoá IndexedDB (còn cttm_v1 cũ lỗi thời)"(browser, check) {
    await resetRedis(seed.remote)
    const A = await newDevice(browser, "A", { local: seed.localA })
    await openTab(A)
    await settle(A.tabs)
    const B = await newDevice(browser, "B", { local: seed.localB })
    await openTab(B)
    await settle(all([A, B]))
    await act.run(A.tabs[0], () => {
      const s = window.__t.useAppStore.getState()
      s.actions.deleteExpense("ex_0020")
      window.__t.useAppStore.getState().actions.updateExpense("ex_0030", { amountVnd: 4242 })
    })
    await settle(all([A, B]))
    for (const tab of B.tabs) await tab.page.close()
    B.tabs.length = 0
    const wipe = await B.context.newPage()
    await wipe.goto(`${APP}/__seed`)
    const deleted = await wipe.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase("myfinance-ledger")
      req.onsuccess = () => resolve("ok")
      req.onerror = () => resolve("error")
      req.onblocked = () => resolve("blocked")
    }))
    await wipe.close()
    check.ok("đã xoá IndexedDB của B", deleted === "ok", deleted)
    await openTab(B)
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B], { expenseCount: 901 })
    check.ok("khoản A đã xoá không sống lại từ cttm_v1 cũ", !reference.records["expense/ex_0020"])
    check.ok("sửa mới của A không bị bản cũ đè", reference.records["expense/ex_0030"]?.amountVnd === 4242)
    check.ok("sửa offline cũ của B vẫn còn", reference.records["expense/ex_0005"]?.amountVnd === 999000)
    return [A, B]
  },

  async "16 Redis bị xoá sạch: khởi tạo lại từ A, B gộp phần riêng vào"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(A.tabs[0], "S16-A-before", 1)
    await settle(all([A, B]))
    await cmd("FLUSHDB")
    await act.add(B.tabs[0], "S16-B-after-wipe", 2)
    await act.sync(A.tabs[0])
    check.ok("A hỏi trước khi làm gì", (await quickState(A.tabs[0])).dialog === "remote-empty")
    await act.run(A.tabs[0], () => window.__t.engine.resolveDialog("reseed"))
    await settle(A.tabs)
    await act.sync(B.tabs[0])
    check.ok("B nhận ra sổ cái khác", (await quickState(B.tabs[0])).dialog === "remote-different")
    await act.run(B.tabs[0], () => window.__t.engine.resolveDialog("merge-local"))
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S16-A-before": 1, "S16-B-after-wipe": 1 }, expenseCount: BASE_COUNT + 2 })
    return [A, B]
  },

  async "17 A nhập file (thay toàn bộ) trong lúc B đang thêm khoản offline"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await B.context.setOffline(true)
    await act.add(B.tabs[0], "S17-B-offline", 1)
    await act.run(A.tabs[0], () => {
      const s = window.__t.useAppStore.getState()
      const data = JSON.parse(JSON.stringify(s.data))
      for (const id of ["ex_0001", "ex_0002", "ex_0003", "ex_0004", "ex_0006"]) {
        delete data.entities.expenses.byId[id]
        data.entities.expenses.allIds = data.entities.expenses.allIds.filter((x) => x !== id)
      }
      for (let i = 0; i < 3; i += 1) {
        const id = `ex_imp${i}`
        data.entities.expenses.byId[id] = { id, amountVnd: 1000, category: "Food", bucket: "needs", note: `S17-IMP-${i}`, date: "2026-10-24", createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z" }
        data.entities.expenses.allIds.push(id)
      }
      return s.actions.importJson(JSON.stringify(data))
    })
    await settle(A.tabs)
    await B.context.setOffline(false)
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B], { notes: { "S17-B-offline": 1, "S17-IMP-0": 1, "S17-IMP-1": 1, "S17-IMP-2": 1 }, expenseCount: BASE_COUNT - 5 + 3 + 1 })
    check.ok("5 khoản bị file nhập loại bỏ đã xoá trên mọi máy", ["ex_0001", "ex_0002", "ex_0003", "ex_0004", "ex_0006"].every((id) => !reference.records[`expense/${id}`]))
    return [A, B]
  },

  async "18 A xoá toàn bộ dữ liệu; B quay về trước thời điểm đó"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(B.tabs[0], "S18-marker", 1)
    await settle(all([A, B]))
    const before = (await fullState(A.tabs[0])).expenseCount
    await act.run(A.tabs[0], () => window.__t.useAppStore.getState().actions.resetAll())
    await settle(all([A, B]))
    check.ok("đã xoá toàn bộ", (await fullState(B.tabs[0])).expenseCount === 0)
    const restored = await act.run(B.tabs[0], async () => {
      const engine = window.__t.engine
      const history = await engine.loadHistory()
      const reset = history.find((g) => g.ops.filter((o) => o.t === "del").length > 100)
      return reset ? engine.restoreBefore(reset) : -1
    })
    check.ok("tìm thấy và khôi phục thao tác xoá toàn bộ", restored > 0, String(restored))
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S18-marker": 1 }, prefixes: ["S18-"], expenseCount: before })
    return [A, B]
  },

  async "19 B hoàn tác lệnh xoá do A thực hiện"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(A.tabs[0], "S19-X", 1)
    await settle(all([A, B]))
    await act.del(A.tabs[0], "S19-X")
    await settle(all([A, B]))
    const undone = await act.run(B.tabs[0], async () => {
      const engine = window.__t.engine
      const history = await engine.loadHistory()
      const group = history.find((g) => g.ops.some((o) => o.t === "del" && o.key.startsWith("expense/")))
      return group ? engine.undoGroup(group) : -1
    })
    check.ok("hoàn tác được", undone === 1, String(undone))
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S19-X": 1 }, expenseCount: BASE_COUNT + 1 })
    return [A, B]
  },

  async "20 nhập dồn 300 khoản trên một máy (đẩy theo lô)"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    const before = stats.appends
    await act.run(A.tabs[0], () => {
      for (let i = 0; i < 300; i += 1) window.__t.useAppStore.getState().actions.addExpense({ amountVnd: 1000 + i, category: "Food", note: `S20-${i}`, date: "2026-10-24" })
    })
    await settle(all([A, B]))
    const notes = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`S20-${i}`, 1]))
    await verify(check, [A, B], { notes, prefixes: ["S20-"], expenseCount: BASE_COUNT + 300 })
    check.ok("không gửi từng op một (gom lô)", stats.appends - before < 300, `${stats.appends - before} lệnh ghi`)
    return [A, B]
  },

  async "21 máy B dùng token sai: không ghi được gì, dữ liệu giữ trên máy, sửa token thì lên"(browser, check) {
    await resetRedis()
    const A = await newDevice(browser, "A", { local: BASE_LOCAL })
    await openTab(A)
    await settle(A.tabs)
    const B = await newDevice(browser, "B", { token: "wrong-token" })
    await openTab(B)
    await act.add(B.tabs[0], "S21-B", 1)
    await act.sync(B.tabs[0])
    const state = await quickState(B.tabs[0])
    check.ok("B báo lỗi token", state.phase === "auth-error", state.phase)
    check.ok("B không ghi gì lên Redis", (await readLog()).every((op) => !String(op.v?.note ?? "").startsWith("S21")))
    await act.run(B.tabs[0], () => {
      localStorage.setItem("smartSpend.storage.config.v1", JSON.stringify({ mode: "upstash", upstash: { url: "http://127.0.0.1:8079", token: "e2e-token" }, updatedAt: 2 }))
      window.__t.engine.restart()
    })
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S21-B": 1 }, expenseCount: BASE_COUNT + 1 })
    return [A, B]
  },

  async "22 tab bản cũ (chưa tải lại) ghi thêm vào cttm_v1 sau khi đã lên sổ cái"(browser, check) {
    await resetRedis(seed.remote)
    const A = await newDevice(browser, "A", { local: seed.localA })
    await openTab(A)
    const tab2 = await openTab(A)
    await settle(A.tabs)
    await act.run(A.tabs[0], () => window.__t.useAppStore.getState().actions.setSettings({ monthlyIncomeVnd: 30_000_000 }))
    await settle(A.tabs)
    // "Tab bản cũ" (RAM cũ: thu nhập 14tr) ghi cttm_v1 kèm một khoản mới.
    await act.run(tab2, () => {
      const old = JSON.parse(localStorage.getItem("cttm_v1"))
      old.entities.expenses.byId.ex_oldtab = { id: "ex_oldtab", amountVnd: 5000, category: "Food", bucket: "needs", note: "S22-OLDTAB", date: "2026-10-24", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      old.entities.expenses.allIds.push("ex_oldtab")
      localStorage.setItem("cttm_v1", JSON.stringify(old))
    })
    A.local = null // cttm_v1 thay đổi có chủ đích trong kịch bản này
    await sleep(500)
    await settle(A.tabs)
    const { reference } = await verify(check, [A], { notes: { "S22-OLDTAB": 1 }, expenseCount: 904 })
    check.ok("tab bản cũ không làm lùi cài đặt", reference.records["settings/global"]?.monthlyIncomeVnd === 30_000_000)
    return [A]
  },

  async "23 bốn tab một máy, mạng chập chờn bật/tắt liên tục"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    for (let i = 0; i < 3; i += 1) await openTab(A)
    const notes = {}
    const random = rng(23)
    await Promise.all(
      A.tabs.map(async (tab, t) => {
        for (let i = 0; i < 10; i += 1) {
          const note = `S23-t${t}-${i}`
          notes[note] = 1
          await act.add(tab, note)
          if (random.chance(0.3)) await act.sync(tab)
        }
      }),
    )
    for (let flip = 0; flip < 6; flip += 1) {
      await A.context.setOffline(flip % 2 === 0)
      await Promise.all(A.tabs.map((tab) => act.sync(tab)))
      await sleep(150)
    }
    await A.context.setOffline(false)
    await settle(all([A, B]))
    await verify(check, [A, B], { notes, prefixes: ["S23-"], expenseCount: BASE_COUNT + 40 })
    return [A, B]
  },

  async "24 STRESS ngẫu nhiên: 3 máy/4 tab, 300 thao tác thêm-sửa-xoá chéo nhau, lỗi mạng + offline ngẫu nhiên"(browser, check) {
    const devices = await baseline(browser, ["A", "B", "C"])
    await openTab(devices[0])
    const tabs = all(devices)
    const random = rng(Number(process.env.STRESS_SEED ?? 2024))
    const added = new Set()
    const deleted = new Set()
    faults.failBefore = 0.08
    faults.failAfter = 0.12
    faults.delayMax = 100
    faults.random = rng(Number(process.env.STRESS_SEED ?? 2024) + 1)
    let counter = 0
    for (let round = 0; round < 5; round += 1) {
      await Promise.all(
        tabs.map(async (tab, t) => {
          for (let i = 0; i < 15; i += 1) {
            const roll = random.next()
            if (roll < 0.45) {
              const note = `S24-${t}-${counter++}`
              added.add(note)
              await act.add(tab, note, 1000 + random.int(100000))
            } else {
              const visible = await act.run(tab, () => Object.values(window.__t.useAppStore.getState().data.entities.expenses.byId).map((e) => e.note).filter((n) => n.startsWith("S24-")))
              if (!visible.length) continue
              const note = random.pick(visible)
              if (roll < 0.8) await act.edit(tab, note, { amountVnd: 1 + random.int(999999), date: `2026-10-${String(1 + random.int(28)).padStart(2, "0")}` })
              else if (await act.del(tab, note)) deleted.add(note)
            }
            if (random.chance(0.15)) await act.sync(tab)
          }
        }),
      )
      const offlineDevice = random.pick(devices)
      await offlineDevice.context.setOffline(true)
      await Promise.all(tabs.map((tab) => act.sync(tab)))
      await offlineDevice.context.setOffline(false)
    }
    await settle(tabs)
    const notes = {}
    for (const note of added) notes[note] = deleted.has(note) ? 0 : 1
    await verify(check, devices, { notes, prefixes: ["S24-"], expenseCount: BASE_COUNT + added.size - deleted.size })
    check.ok("đã chạy đủ tải", added.size > 100 && deleted.size > 10, `${added.size} thêm, ${deleted.size} xoá, ${stats.failBefore + stats.failAfter} lỗi mạng chèn`)
    return devices
  },
}

Object.assign(SCENARIOS, {
  async "25 hai máy sửa qua lại cùng một khoản 40 lần (đan xen, mạng trễ)"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(A.tabs[0], "S25-X", 1)
    await settle(all([A, B]))
    faults.delayMax = 80
    const random = rng(25)
    await Promise.all(
      [A, B].map(async (d, k) => {
        for (let i = 0; i < 20; i += 1) {
          await act.edit(d.tabs[0], "S25-X", k === 0 ? { amountVnd: 1000 + i } : { date: `2026-10-${String(1 + i).padStart(2, "0")}` })
          if (random.chance(0.5)) await act.sync(d.tabs[0])
        }
      }),
    )
    await settle(all([A, B]))
    const { reference } = await verify(check, [A, B], { notes: { "S25-X": 1 } })
    const x = Object.values(reference.records).find((r) => r.note === "S25-X")
    check.ok("lần sửa cuối của mỗi máy trên field của nó đều được giữ", x?.amountVnd === 1019 && x?.date === "2026-10-20", JSON.stringify({ a: x?.amountVnd, d: x?.date }))
    return [A, B]
  },

  async "26 B tắt đồng bộ (chỉ lưu máy), nhập/xoá, rồi bật lại"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    await act.add(B.tabs[0], "S26-before", 1)
    await settle(all([A, B]))
    const setMode = (tab, mode) =>
      act.run(tab, (mode) => {
        localStorage.setItem("smartSpend.storage.config.v1", JSON.stringify({ mode, upstash: { url: "http://127.0.0.1:8079", token: "e2e-token" }, updatedAt: Date.now() }))
        window.__t.engine.restart()
      }, mode)
    await setMode(B.tabs[0], "localStorage")
    for (let i = 0; i < 3; i += 1) await act.add(B.tabs[0], `S26-local-${i}`)
    await act.del(B.tabs[0], "S26-before")
    await act.add(A.tabs[0], "S26-A-meanwhile")
    await settle(A.tabs)
    check.ok("khi chỉ lưu máy, B không ghi lên Redis", (await readLog()).every((op) => !String(op.v?.note ?? "").startsWith("S26-local")))
    await setMode(B.tabs[0], "upstash")
    await settle(all([A, B]))
    await verify(check, [A, B], { notes: { "S26-before": 0, "S26-local-0": 1, "S26-local-1": 1, "S26-local-2": 1, "S26-A-meanwhile": 1 }, prefixes: ["S26-"] })
    return [A, B]
  },

  async "27 rời trang sang trang khác rồi bấm Back (bfcache), thao tác ngay"(browser, check) {
    const [A, B] = await baseline(browser, ["A", "B"])
    const tab = A.tabs[0]
    await tab.page.goto(`${APP}/__seed`)
    for (let i = 0; i < 4; i += 1) await act.add(B.tabs[0], `S27-B-${i}`)
    await settle(B.tabs)
    await tab.page.goBack()
    await tab.page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu"))
    const restoredFromCache = await tab.page.evaluate(() => Boolean(window.__t))
    if (!restoredFromCache) {
      const { installApi } = await import("./lib.mjs")
      await installApi(tab.page)
    }
    await act.add(tab, "S27-A-after-back")
    await settle(all([A, B]))
    check.ok(`(thông tin) tab ${restoredFromCache ? "được khôi phục từ bfcache" : "được tải lại"}`, true)
    await verify(check, [A, B], { notes: { "S27-B-0": 1, "S27-B-1": 1, "S27-B-2": 1, "S27-B-3": 1, "S27-A-after-back": 1 }, expenseCount: BASE_COUNT + 5 })
    return [A, B]
  },
})

// ---------------------------------------------------------------- chạy
const only = process.argv.slice(2)
const browser = await startInfra()
const results = []
for (const [name, run] of Object.entries(SCENARIOS)) {
  if (only.length && !only.some((key) => name.startsWith(key))) continue
  const check = new Checker(name)
  const started = Date.now()
  faults.off()
  faults.onlyWrites = false
  faults.random = rng(name.length)
  let devices = []
  try {
    devices = (await run(browser, check)) ?? []
  } catch (error) {
    check.failures.push(`LỖI: ${error.message.slice(0, 600)}`)
  } finally {
    await closeDevices(devices)
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name, passed: check.passed, failures: check.failures, seconds })
  console.log(`${check.failures.length ? "✗" : "✓"} ${name} — ${check.passed} kiểm tra đạt${check.failures.length ? `, ${check.failures.length} LỖI` : ""} (${seconds}s)`)
  for (const failure of check.failures.slice(0, 8)) console.log(`    ✗ ${failure}`)
}
await resetRedis()
await stopInfra(browser)
const failed = results.filter((r) => r.failures.length)
const totalChecks = results.reduce((n, r) => n + r.passed, 0)
console.log(`\nTỔNG: ${results.length - failed.length}/${results.length} kịch bản đạt, ${totalChecks} kiểm tra đạt, ${failed.reduce((n, r) => n + r.failures.length, 0)} lỗi. Request tới Redis: ${stats.requests}, lỗi mạng đã chèn: ${stats.failBefore + stats.failAfter}.`)
process.exit(failed.length ? 1 : 0)
