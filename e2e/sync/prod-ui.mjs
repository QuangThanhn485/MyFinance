// Bản build production (vite preview), thao tác HOÀN TOÀN qua giao diện. Chạy: APP_URL=http://127.0.0.1:5198 node prod-ui.mjs
import { APP, Checker, cmd, newDevice, readIdb, readLog, referenceFold, resetRedis, seed, sleep, stable, startInfra, stopInfra } from "./lib.mjs"

const check = new Checker("prod-ui")

async function open(device, path = "/expenses") {
  const page = await device.context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`${APP}${path}`)
  await page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu"), null, { timeout: 30_000 })
  const tab = { page, errors, device }
  device.tabs.push(tab)
  return tab
}

const pill = (tab) => tab.page.locator("a[href='/data'].fixed").innerText().catch(() => "")

async function settleUi(tabs) {
  for (let round = 0; round < 40; round += 1) {
    for (const t of tabs) await t.page.evaluate(() => window.dispatchEvent(new Event("focus"))).catch(() => {})
    await sleep(700)
    const length = Number(await cmd("LLEN", "mf4:log"))
    const idbs = await Promise.all(tabs.map((t) => readIdb(t)))
    const pills = await Promise.all(tabs.map(pill))
    if (idbs.every((i) => i.outbox === 0 && i.meta?.cursor === length) && pills.every((p) => p.includes("Đã đồng bộ"))) return
  }
  throw new Error("UI không hội tụ")
}

async function addViaForm(tab, amount, note) {
  const { page } = tab
  await page.getByRole("button", { name: "Thêm", exact: true }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder("Ví dụ: 35.000").fill(String(amount))
  await dialog.getByPlaceholder("Ví dụ: ăn trưa").fill(note)
  await dialog.getByRole("button", { name: "Thêm", exact: true }).click()
  await sleep(400)
  await dismissDialogs(tab)
}

const dialogTitles = []
async function dismissDialogs(tab) {
  for (let i = 0; i < 4; i += 1) {
    const dialogs = tab.page.locator("[role=dialog], [role=alertdialog]")
    if ((await dialogs.count()) === 0) return
    const title = (await dialogs.first().locator("h2").first().innerText().catch(() => "?")).trim()
    dialogTitles.push(title)
    await tab.page.keyboard.press("Escape")
    await sleep(250)
  }
}

async function deleteViaList(tab, note) {
  await dismissDialogs(tab)
  const row = tab.page.getByText(note, { exact: true }).first().locator("xpath=ancestor::*[.//button[contains(@class,'bg-destructive')]][1]")
  await row.locator("button.bg-destructive").first().click()
  await sleep(300)
  const confirm = tab.page.getByRole("alertdialog").getByRole("button", { name: /Xóa/ })
  if (await confirm.count()) await confirm.first().click()
}

const visible = (tab, note) => tab.page.getByText(note, { exact: true }).count()

const browser = await startInfra()
try {
  await resetRedis(seed.remote)
  const A = await newDevice(browser, "A", { local: seed.localA })
  const B = await newDevice(browser, "B", { local: seed.localB })
  const a1 = await open(A)
  await settleUi([a1])
  const b1 = await open(B)
  await settleUi([a1, b1])
  check.ok("v3 đã đóng băng sau chuyển đổi", (await cmd("GET", "mf3:version")) === "frozen-v4:12")

  console.log("• A nhập 2 khoản qua form, B nhập 1 khoản qua form + 1 khoản từ nút thêm nhanh")
  await addViaForm(a1, 45000, "UI-A-1")
  await addViaForm(a1, 12000, "UI-A-2")
  await addViaForm(b1, 30000, "UI-B-1")
  await b1.page.getByRole("button", { name: "Thêm nhanh 1 khoản từ mẫu Ăn trưa" }).click()
  await sleep(400)
  await dismissDialogs(b1)
  await settleUi([a1, b1])
  for (const note of ["UI-A-1", "UI-A-2", "UI-B-1"]) {
    check.ok(`A thấy "${note}" đúng 1 lần`, (await visible(a1, note)) === 1)
    check.ok(`B thấy "${note}" đúng 1 lần`, (await visible(b1, note)) === 1)
  }

  console.log("• B xoá UI-A-1 (do A tạo) qua danh sách; A mở thêm tab thứ 2 và xoá UI-B-1")
  await deleteViaList(b1, "UI-A-1")
  const a2 = await open(A)
  await deleteViaList(a2, "UI-B-1")
  await settleUi([a1, a2, b1])
  for (const tab of [a1, a2, b1]) {
    check.ok("UI-A-1 đã biến mất trên mọi màn hình", (await visible(tab, "UI-A-1")) === 0)
    check.ok("UI-B-1 đã biến mất trên mọi màn hình", (await visible(tab, "UI-B-1")) === 0)
    check.ok("UI-A-2 vẫn còn đúng 1", (await visible(tab, "UI-A-2")) === 1)
  }

  console.log("• B mất mạng, nhập qua form; A nhập cùng lúc; B có mạng lại")
  await B.context.setOffline(true)
  await addViaForm(b1, 9000, "UI-B-offline")
  await addViaForm(a1, 8000, "UI-A-while-B-offline")
  check.ok("B hiện trạng thái chưa gửi khi offline", /chưa gửi|Mất kết nối/.test(await pill(b1)), await pill(b1))
  await B.context.setOffline(false)
  await b1.page.evaluate(() => window.dispatchEvent(new Event("online")))
  await settleUi([a1, a2, b1])
  for (const tab of [a1, a2, b1]) {
    check.ok("UI-B-offline có đúng 1", (await visible(tab, "UI-B-offline")) === 1)
    check.ok("UI-A-while-B-offline có đúng 1", (await visible(tab, "UI-A-while-B-offline")) === 1)
  }

  console.log("• Kiểm tra sâu: IndexedDB mọi máy == phát lại độc lập của sổ cái; sổ cái không trùng")
  const log = await readLog()
  const reference = stable(referenceFold(log).records)
  check.ok("sổ cái: seq liền mạch", log.every((op, i) => op.seq === i + 1))
  check.ok("sổ cái: id op duy nhất", new Set(log.map((op) => op.id)).size === log.length)
  for (const [name, tab] of [["A", a1], ["B", b1]]) {
    const idb = await readIdb(tab)
    check.ok(`${name}: IndexedDB khớp sổ cái`, stable(idb.confirmed.records) === reference)
    check.ok(`${name}: không còn op chờ`, idb.outbox === 0)
  }
  for (const tab of [a1, a2, b1]) check.ok("không có lỗi JS", tab.errors.length === 0, tab.errors.join(" | "))
  check.ok("cttm_v1 bản cũ không bị đụng", (await a1.page.evaluate(() => localStorage.getItem("cttm_v1"))) === seed.localA.cttm_v1)

  console.log("• Nhật ký thay đổi: hoàn tác lệnh xoá UI-A-1 từ giao diện trang Dữ liệu (trên B)")
  await b1.page.goto(`${APP}/data`)
  await b1.page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu"))
  const entry = b1.page.getByText(/^Xoá khoản chi/).first()
  await entry.waitFor({ timeout: 15_000 })
  const histRow = b1.page.locator("div.rounded-md.border.bg-background").filter({ hasText: "Xoá khoản chi" }).nth(1)
  await histRow.getByRole("button", { name: "Hoàn tác" }).click()
  await b1.page.getByRole("alertdialog").getByRole("button", { name: "Hoàn tác" }).click()
  await sleep(500)
  await b1.page.goto(`${APP}/expenses`)
  await b1.page.waitForFunction(() => !document.body.innerText.includes("Đang tải dữ liệu"))
  await settleUi([a1, a2, b1])
  const restoredA = await visible(a1, "UI-A-1")
  const restoredB = await visible(b1, "UI-A-1")
  check.ok("hoàn tác qua giao diện: UI-A-1 trở lại đúng 1 lần trên A và B", restoredA === 1 && restoredB === 1, `A=${restoredA} B=${restoredB}`)
  check.ok("UI-B-1 vẫn đang bị xoá (chỉ hoàn tác đúng thao tác đã chọn)", (await visible(a1, "UI-B-1")) === 0)
} catch (error) {
  check.failures.push(`LỖI: ${error.message.slice(0, 3000)}`)
} finally {
  await resetRedis()
  await stopInfra(browser)
}
console.log("Hộp thoại đã gặp và đóng:", JSON.stringify([...new Set(dialogTitles)]))
console.log(`\nBẢN BUILD PRODUCTION, THAO TÁC QUA GIAO DIỆN: ${check.passed} kiểm tra đạt, ${check.failures.length} lỗi`)
for (const f of check.failures) console.log("  ✗", f)
process.exit(check.failures.length ? 1 : 0)
