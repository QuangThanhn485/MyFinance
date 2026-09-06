# Tài liệu thiết kế: Đồng bộ đa thiết bị không mất dữ liệu cho MyFinance (Sync v3 "Guarded Snapshot")

> **Trạng thái (06/09/2026): ĐÃ TRIỂN KHAI** — Giai đoạn 1–3 gộp trong một lần: `src/sync/{snapshot,merge,redisProtocol,localMeta,syncEngine,appSync,clock}.ts`, store/provider/trang Dữ liệu viết lại theo mục 4–5. Khác biệt so với đề xuất: không dùng BroadcastChannel/Web Locks (dùng `storage` event + 3-way merge cho multi-tab, mọi tab đều có thể push vì CAS đã bảo vệ); retention 60 ngày; marker key cũ dùng `schemaVersion: 3` để build cũ coi remote là rỗng thay vì tải về snapshot rỗng. Test: `tests/sync/*`.
>
> **Bổ sung sau review đối kháng (cùng ngày):** (1) merge KHÔNG BAO GIỜ suy luận xoá từ việc thiếu id — xoá chỉ đi qua tombstone (mọi đường xoá trong app đều ghi tombstone: xoá lẻ, xoá danh mục, import, reset, khôi phục "thay thế"); (2) `mf3.meta.lastPersistedHash`/`baseUntrusted`: lúc boot nếu đĩa khác bản app ghi lần cuối (tab build cũ ghi đè) thì không dùng base để phân xử và luôn gộp lại với Redis trước khi push; (3) `mf3.writeSeq` phân biệt tab build mới với nguồn ghi lạ trong storage event — nguồn lạ chỉ được nhận thêm entity/tombstone, không lùi settings; (4) khôi phục "thay thế" đặt updatedAt=now cho toàn bộ bản khôi phục (thắng mọi tombstone), "gộp" chỉ gộp entity/mẫu và giữ nguyên cấu hình hiện tại; (5) thứ tự danh mục sau merge tất định; (6) "máy trống" không tính khi có tombstone (xoá toàn bộ không bị huỷ ngầm); (7) committedAt hiệu chỉnh theo lệch giờ server; (8) hộp thoại đối chiếu id, gộp lại từ local hiện tại lúc chọn; (9) "tạm dừng" chỉ được bỏ khi bấm "Đồng bộ ngay".

> Đối tượng: developer triển khai. Mọi `file:dòng` dưới đây đã được mở và đối chiếu trên working tree hiện tại (commit `e7f15f0`). Thuật ngữ kỹ thuật giữ tiếng Anh.

---

# 1. Nguyên nhân gốc (tóm tắt forensic)

## 1.1 Timeline A → B → A

| Bước | Thiết bị | Sự kiện | Code path | Redis giữ gì |
|---|---|---|---|---|
| 0 | A, B | Đã sync, cùng dữ liệu D0 | `smartSpend.storage.localMeta.v1 = {revision: R0}` (`dataSource.ts:209-223`) | D0 (1 key `myfinance:storage:snapshot`, `dataSource.ts:54`) |
| 1 | A | Ghi 1 khoản chi → `set()` → subscriber (`useAppStore.ts:1316-1319`) → `debouncedSave` 400 ms (`localStorage.ts:241-254`) → `setItem('cttm_v1')` → monkey-patch (`dataSource.ts:652-658`) → `bumpLocalRevision` = `Date.now()` (`:230-235`, `:177-180`) → `scheduleUpload` 2.5 s (`:609-619`) → `redis.set` mù (`:424`) | | D_A0, rev R_A0 |
| 2 | A | **Nhánh 1**: tab A để mở. `AppLayout.tsx:43-49` gọi `autoClose()` lúc mount và mỗi 60 s → `set({data: autoClosePreviousMonthIfNeeded(s.data)})` (`useAppStore.ts:1308-1310`). Kể cả khi hàm domain trả cùng reference, partial là object mới nên zustand notify; selector trả `{workspace, data}` mới → `Object.is` sai (`node_modules/zustand/middleware.js:253-257`) → ghi lại `cttm_v1` y nguyên → bump rev → upload D_A0 mỗi ~63 s | | D_A0, rev = tick mới nhất của A |
| 3 | B | Mở app, bootCheck (`DataSourceProvider.tsx:282-330`) → `compareLocalAndRemote` (`dataSource.ts:580-598`) → `remote.revision > local.revision` → `download-remote` (`:39-47`) → `downloadUpstashToLocal` ghi đè + `removeItem` key không có trong manifest (`:534-535`), **không** `writeLastBackup` → reload (`DataSourceProvider.tsx:63-69`) | | D_A0 |
| 4 | B | Dùng cả tuần (28/08 → 04/09). Mỗi thao tác upload D_Bk. Nhánh 1: Redis dao động D_Bk ↔ D_A0, dữ liệu B chỉ sống ≤ 60 s mỗi lượt. Nếu B boot lại → bước 3 lặp lại → B mất ngày hôm trước | | D_B7 hoặc D_A0 |
| 5 | A | **Nhánh 3**: mở lại A sau ranh giới tháng. Module load `useAppStore.ts:549-553`: `autoClosePreviousMonthIfNeeded` tạo `settingsByMonth['2026-09']`, clone fixedCosts (`:291-302`), tạo monthLock (`:346-349`) → `saveCttmState` **trước React**, patch đã cài (`dataSource.ts:685`) → rev = now > R_B7. bootCheck → `local-newer` (`:591-592`) → `upload-local` (`:44`) → `uploadLocalToUpstash` không hỏi, không backup (`DataSourceProvider.tsx:297-301`). Song song timer 2.5 s cũng upload | | **D_A0' — tuần của B biến mất** |
| 5' | A | **Nhánh 2**: không có ranh giới tháng, bootCheck lỗi mạng/adblock → `catch` (`DataSourceProvider.tsx:318-323`) → `toast.error` bị nuốt (Toaster nằm trong children đang bị chặn: `main.tsx:20-32`, `:41-43`, `DataSourceProvider.tsx:352`) → app chạy tiếp mode upstash → `AppLayout` mount → `autoClose()` → ~3 s sau upload D_A0 đè D_B7. Lỗi upload chỉ `console.error` (`dataSource.ts:634`), tick 60 s thử lại vô hạn | | D_A0 |
| 5'' | A | **Nhánh 4**: nếu `relation === 'diverged'` → dialog `boot-diverged`, nhưng `blockApp = bootChecking && !pendingDecision` (`DataSourceProvider.tsx:348`) → children render ngay dưới dialog → upload nền vẫn xảy ra. Thực tế nhánh này gần như bất khả vì `nextRevision` luôn > previous (`:177-180`) | | |
| 6 | B | Boot online kế tiếp → `remote-newer` → download D_A0 → bản sao cuối cùng của D_B7 bị xoá im lặng | | D_A0 ở cả 3 nơi |

## 1.2 Bốn đường mất dữ liệu độc lập

1. **Tab cũ mở lâu ngày** – tick 60 s ghi lại y nguyên → bump `Date.now()` → blind SET (`AppLayout.tsx:43-49` → `useAppStore.ts:1308-1319` → `dataSource.ts:652-658` → `:230-235` → `:609-642` → `:424`).
2. **bootCheck lỗi → app chạy tiếp** – `catch` không khoá upload, config vẫn `mode: 'upstash'` nên `scheduleUpload` (`:611-612`) vẫn chạy.
3. **Ranh giới tháng → "local-newer" giả** – module-load save (`useAppStore.ts:549-553`) tự phong local mới hơn bằng đồng hồ máy.
4. **Dialog không chặn app** – `:348` để children render, upload nền sau 2.5 s.

## 1.3 Vì sao không khôi phục được

- Redis chỉ có **một** key, ghi đè tại chỗ, không GET trước, không NX/XX, không EVAL, không lịch sử (`dataSource.ts:405-447`).
- Client download **không** `writeLastBackup` (`:488-578`); `writeLastBackup` chỉ được gọi ở `reset_demo_seed` / `import_overwrite` / `reset_all` (`useAppStore.ts:601`, `:1255`, `:1295`). Hơn nữa `cttm_backup_last_v1` (`backups.ts:4`) có prefix `cttm_` → nằm **trong** snapshot (`dataSource.ts:66`, `:86-89`) và bị đồng bộ/ghi đè cùng.
- Xoá entity không tombstone (`useAppStore.ts:944-958`) nên không thể merge lại kể cả khi có hai bản.
- `readLastBackup` (`backups.ts:44-60`) có 0 caller trong `src/` → không có UI khôi phục.

## 1.4 Bối cảnh lịch sử: lớp bảo vệ từng tồn tại và đã bị gỡ

Đối chiếu `git log -- src/storage/dataSource.ts src/app/DataSourceProvider.tsx`:

- **Trước commit `8aafe32` (08/07/2026)**, `flushUpload` gọi `getRemoteWriteConflict()` trước khi upload: so `remote.revision`/`remote.checksum` với `smartSpend.storage.lastSync.v1` của trình duyệt này; nếu Redis đã đổi kể từ lần sync cuối → **không upload**, bắn sự kiện `myfinance-storage-conflict`, provider mở dialog `background-diverged` ("Redis đã thay đổi từ nơi khác"). `activateMode('upstash')` cũng có 3 dialog riêng cho `local-newer` / `remote-newer` / `diverged`.
- Commit `8aafe32` ("Remove unused conflict handling logic and simplify decision-making") **xoá toàn bộ** các nhánh trên (−197 dòng). Từ đó upload nền trở thành blind write.
- Commit `e1f1725` (01/08/2026, "Fix startup data sync reload loop") chỉ thêm lại dialog `boot-diverged` cho trường hợp `revision` bằng nhau — nhánh gần như không bao giờ đạt tới.

Guard cũ là check-then-act phía client (vẫn có cửa sổ một round-trip), nhưng đủ để chặn kịch bản A → B → A. Thiết kế mới (mục 4) đưa ý tưởng này về đúng chỗ: **compare-and-swap nguyên tử trên server** thay vì kiểm tra rồi ghi ở client.

---

# 2. Nguyên tắc thiết kế (invariants)

| # | Bất biến giao thức mới PHẢI giữ | Hiện trạng vi phạm ở đâu |
|---|---|---|
| I1 | **Không bao giờ ghi remote mà không chứng minh đã thấy version remote hiện hành.** Mọi ghi = compare-and-swap trên counter do server cấp. | `redis.set` vô điều kiện (`dataSource.ts:424`); "mới hơn" quyết định bằng `Date.now()` client (`:177-180`, `:591-596`). |
| I2 | **Thứ tự toàn cục do server quyết định**, đồng hồ client chỉ dùng tie-break cấp entity và luôn có log bản thua. | `revision = Date.now()` là thứ tự toàn cục (`:230-235`). |
| I3 | **Mọi lần thay head đều giữ bản trước đó** (retention ≥ 20 bản + 1 bản/ngày × 30 ngày + pins), và client giữ bản local trước mỗi lần apply remote. | Không lịch sử trên Redis; download không backup (`:529-544`). |
| I4 | **Xoá luôn là tombstone**; merge không bao giờ suy luận xoá từ việc "thiếu id" khi không có base chung. | `deleteExpense` xoá khỏi `byId` (`useAppStore.ts:948-955`), tương tự `:818`, `:991`, `:1098`, `:745`. |
| I5 | **Không có đường ghi nào ngoài SyncEngine.** Việc ghi localStorage không phải tín hiệu upload; dirty được xác định bằng content-hash (bỏ `updatedAt`, `indexes`). | Monkey-patch `Storage.prototype` (`:644-683`) biến mọi `setItem` thành upload; `touch()` (`useAppStore.ts:175-177`) đổi `updatedAt` mỗi set. |
| I6 | **Push chỉ mở sau khi pull thành công ít nhất một lần trong phiên** (pushGate). Lỗi boot → app chạy local-first, push khoá, trạng thái hiển thị cố định ngoài children. | `catch` boot chỉ toast rồi cho chạy tiếp (`DataSourceProvider.tsx:318-323`); toast bị nuốt. |
| I7 | **Dialog phá huỷ chặn cả render lẫn push**; mọi thao tác xoá hàng loạt (reset/import/mass-delete từ merge/fast-forward) phải qua xác nhận và ghim head trước. | `blockApp = bootChecking && !pendingDecision` (`:348`); `resetAll`/`importJson` không ghim gì. |
| I8 | **Nguồn sự thật cho engine là `useAppStore.getState().data`**, không phải localStorage; mọi pull/push/apply đi qua một mutex; không `window.location.reload`. | Engine hiện đọc localStorage (`:248-253`); rehydrate bằng reload (`DataSourceProvider.tsx:63-69`). |
| I9 | **Một máy, nhiều tab = một nguồn sự thật trên đĩa**: mọi ghi `cttm_v1` là read-modify-write dưới Web Lock; tab khác rehydrate khi nhận sự kiện. | Mỗi tab ghi nguyên document từ RAM riêng (`localStorage.ts:250`), không lock. |
| I10 | **Dữ liệu tự sinh (autoClose/ensureMonth) phải tất định** trên mọi thiết bị: cùng input → cùng id/cùng nội dung. | Clone fixedCost với `nanoid` mới mỗi máy (`useAppStore.ts:293`). |

---

# 3. Các pattern chuẩn đã xem xét

Điểm là trung bình 3 giám khảo (thang 70).

| Họ pattern | Ý tưởng | Điểm mạnh | Điểm yếu | Điểm TB | Kịch bản critic vẫn mất dữ liệu |
|---|---|---|---|---|---|
| **harden** – Guarded Snapshot (CAS + base 3-way + tombstone + history ring) | Giữ mô hình 1 document; bọc bằng server version + EVAL CAS, base snapshot để 3-way merge, ring lịch sử LPUSH server-side, boot gate, hash guard | Ít thay đổi nhất (CttmState chỉ thêm `tombstones?`), Lua ghi version cuối cùng nên không brick, LPUSH không tốn request size, lộ trình 2 bước | Ring 10 bản bị xả nhanh; boot gate chặn UI; key INTERNAL đặt prefix `cttm_/smartSpend.` bị build cũ xoá; claim templates có `updatedAt` sai (`templates.ts:10-20`) | **48.7** (49/49/48) | 2 tab cùng trình duyệt (leader giữ RAM cũ ghi đè `cttm_v1` rồi push — high); nhân đôi fixedCost qua tháng (high, corruption); debounce cũ nổ sau applyRemote → revert (medium) |
| **cas-3way** – SNAPCAS3 | Như harden nhưng retention ZSET 20+30 ngày+pins, IDB ring, conflict log, pushGate local-first, allowlist key, gzip, dedupe fixedCost | Recoverability tốt nhất; UX local-first; đã nghĩ tới dedupe clone | Lua INCR trước SET → OOM brick sync; engine đọc localStorage thay vì store; guard chỉ ở nhánh merge; suy luận xoá từ legacyBase | **48.3** (47/48/50) | Race 400 ms store vs localStorage (high); 2 tab (high); push state rỗng qua fast-forward (medium); flushdb → seed bản cũ (medium); legacy 3-way xoá âm thầm (medium) |
| **oplog** – Append-only op log + fold | Mỗi action = op; ZSET oplog + Lua CAS theo tail seq; fold thuần; compaction 3 snapshot | Chặn 4 đường triệt để ở tầng giao thức; không ai ghi cả state | Refactor ~25 action (`useAppStore.ts:583-1310`), phải tái hiện chính xác `ensureMonthConfigurationFromPrevious`/`autoClose` (`:198-350`) dạng op; op versioning vĩnh viễn; boot async; IDB bắt buộc | **42.0** (42/41/43) | opId trùng giữa 2 tab (high); RMW race pending (high); op bị trim sau 2 compaction → replay không idempotent (medium); LWW cấp entity mất field (medium) |
| **crdt-lww** – per-path LWW map + HLC + tombstones | Chiếu CttmState thành map `path → {value, hlc, deleted}`; HASH trên Redis; Lua merge từng field; undo-log | Merge per-entity không thể "đè"; không sửa action; key INTERNAL nằm ngoài prefix cũ | Baseline chụp sau module-load autoClose → không diff; sidecar 1 MB serialize mỗi 400 ms; Lua COPY/HSCAN chưa chứng minh trên Upstash; pagination OFFSET bỏ sót | **40.7** (39/41/42) | Demo workspace + applyRemote → tombstone cả tuần của B (high, tái hiện đúng báo cáo); 2 tab (high); flushdb → cloud rỗng vĩnh viễn (medium); coexist app cũ đè settings (medium) |

**Kết luận**: 2/3 giám khảo chọn **harden**, 1/3 chọn cas-3way; hai thiết kế cùng họ và khác nhau chủ yếu ở lớp lịch sử/UX. Kiến trúc khuyến nghị = **harden làm xương sống + ghép các graft từ cas-3way/oplog/crdt** để đóng toàn bộ breakingScenarios mà critic tìm thấy.

---

# 4. Kiến trúc khuyến nghị: Sync v3 "Guarded Snapshot"

## 4.1 Sơ đồ luồng

```
┌──────────── Tab (mỗi tab) ────────────┐
│ useAppStore.set()                     │
│   └─ subscribe((s)=>s.data)  [I5]     │
│        └─ engine.onLocalChange(data)  │
│             ├─ contentHash ≠ last? ── no ─▶ (bỏ qua)
│             └─ yes ─▶ persistLocal() [Web Lock 'mf3.write', RMW, I9]
│                        └─ meta.dirty=true ─▶ schedulePush(2.5s)
│                                                   │
│ SyncEngine (mutex: 1 op/lúc, I8)                  ▼
│   boot ─▶ PULL ─▶ pushGate=true ─▶ (dirty? PUSH)  │
│   PUSH: preflight GET ver ─▶ (≠base? PULL+merge) ─▶ EVAL CAS ─▶ base=local
│   PULL: GET head+snap ─▶ verify ─▶ 3-way merge ─▶ guard ─▶ applyRemote(setState)
│   poll 45s visible / focus / online / BroadcastChannel                  │
└─────────────────────────────────────────────────────────────────────────┘
                     │ REST (@upstash/redis 1.38.0, singleton, autoPipelining off)
                     ▼
┌──────────── Upstash Redis ────────────┐
│ mf3:version (STRING int)  ◀ commit point, poll target
│ mf3:head    (STRING JSON) ◀ metadata + contentHash + genesisId
│ mf3:snap:<n> (STRING)     ◀ bất biến, chỉ retention xoá
│ mf3:history (ZSET)  mf3:pins (SET)  mf3:genesis  mf3:devices (HASH)
│ myfinance:storage:snapshot (v2, chỉ đọc để migrate)
└───────────────────────────────────────┘
```

## 4.2 Redis data model

Prefix `mf3:` (không trùng bất kỳ key cũ nào). Client chỉ dùng các lệnh đã chứng minh trong `node_modules/@upstash/redis/chunk-2X4SLXT7.mjs`: `eval` (:996), `evalsha` (:1010), `scriptLoad` (:2226), `get`/`set` (`SetCommand` :2247, hỗ trợ `nx/ex/px`), `hset`/`hgetall` (:1518), `zrange` (:2875), `sadd/srem/smembers`, `time` (:2425), `del`, `pipeline` (:3056). Lệnh trong Lua do server thực thi.

| Key | Type | Nội dung | Mục đích | Kích thước |
|---|---|---|---|---|
| `mf3:version` | STRING int | Counter monotonic, tăng +1 duy nhất bên trong Lua **và ghi cuối cùng** (commit point) | CAS target; poll 1 GET ~50 B | < 20 B |
| `mf3:head` | STRING JSON | `{schema:3, version, contentHash, genesisId, deviceId, deviceLabel, committedAt, bytes, enc:'json'|'gzip+b64', appBuild}` | Quyết định có cần tải snap; hiển thị "máy nào ghi"; verify hash. Dùng STRING thay HASH để **tránh** `hgetall` trả mảng phẳng khi `automaticDeserialization:false` (`dataSource.ts:142`, `chunk:351`) | ~300 B |
| `mf3:snap:<n>` | STRING (JSON, tuỳ chọn gzip+base64) | `{schema:3, version, contentHash, data:{cttm: CttmState (không kèm indexes), templates}, tombstones:{id: deletedAtISO}, committedAt, deviceId}` | Bất biến; đơn vị pull/merge/khôi phục | 150–700 KB raw / 30–120 KB gzip |
| `mf3:history` | ZSET score=committedAt (clamp đơn điệu), member=version | Danh mục snap còn giữ | Retention: 20 gần nhất + bản mới nhất mỗi ngày trong 30 ngày + pins | ≤ ~60 phần tử |
| `mf3:pins` | SET member=version | Bản ghim (trước import/reset/restore, hoặc thủ công) | Không bị retention xoá | < 1 KB |
| `mf3:genesis` | STRING | nanoid tạo khi version 0→1 (`SET NX` trong Lua) | Phát hiện flushdb / đổi DB (graft oplog) | ~20 B |
| `mf3:devices` | HASH deviceId → JSON | `{label, lastSeenAt, lastVersionSeen, appBuild}` | Chẩn đoán, không tham gia merge; ghi best-effort ngoài CAS | < 2 KB |
| `myfinance:storage:snapshot` | STRING JSON v2 | **Chỉ đọc** để migration; sau khi v3 tồn tại ghi lại 1 lần với `supersededBy:'v3'` (mục 6) | Tương thích/rollback | như hiện tại |

## 4.3 Local data model

| Key | Sync? | Nội dung |
|---|---|---|
| `cttm_v1` | DATA | `CttmState` giữ nguyên shape (`schema.ts:45-64`) + field tuỳ chọn mới `tombstones?: Record<string, string>` (deletedAt ISO; dọn sau 90 ngày). Build cũ vẫn load được vì `loadCttmStateFromKey` spread `...state` và chỉ kiểm tra `schemaVersion` (`localStorage.ts:82-85`). |
| `smartSpend.templates.v1` | DATA | Thêm `updatedAt` vào `ExpenseTemplate` (`templates.ts:10-20` hiện **không** có). |
| `mf3.meta` | INTERNAL | `{deviceId, deviceLabel, redisUrl, genesisId, baseVersion, baseHash, lastPersistedHash, dirty, dirtySince, lastPullAt, lastPushAt, lastError, phase, pushGate, lastIssuedIso, skewMs}` |
| `mf3.base` | INTERNAL | Bản `data` (đã normalize + stableStringify, không indexes) đúng bằng snap tại `baseVersion` → ancestor cho 3-way. Khi tổng localStorage > 3.5 MB hoặc `QuotaExceededError` → chuyển sang IndexedDB `mf3/base`; nếu IDB không có → lưu gzip+b64; nếu vẫn không được → "base digest" (`id → updatedAt` + hash settings/tháng). |
| `mf3.history` (IndexedDB, fallback localStorage 3 bản) | INTERNAL | Ring 10 bản full-state `{at, reason:'before-apply-remote'|'before-merge'|'before-restore'|'before-conflict', version, data}` |
| `mf3.conflicts` | INTERNAL | ≤ 200 `{at, kind, dataKind, id|month|field, winner, loser, remoteVersion, deviceIdRemote}`; tràn → gộp thành 1 bản "loser snapshot" trong IDB + badge |
| `cttm_backup_last_v1` | **không sync** | Giữ hành vi cũ (`backups.ts:29-42`), thêm reason `sync_pull`; **loại khỏi** allowlist sync. |
| `smartSpend.reports.v1`, `smartSpend.ui.*`, `expenses.panel.*`, `expenses.warning.popup.memory.v2`, `cttm_active_workspace_v1`, `cttm_v1_demo` | **không sync** | Per-device. Khi pull **không** xoá gì (bỏ logic `dataSource.ts:534-535`). |
| Xoá | | `smartSpend.storage.localMeta.v1`, `smartSpend.storage.lastSync.v1`, `smartSpend.storage.remoteCleanup.v1` (đọc 1 lần để migrate rồi `removeItem`). |

**Lý do prefix `mf3.`**: build cũ coi mọi key `cttm_/smartSpend./expenses.` là app-data (`dataSource.ts:66`, `:86-89`), upload chúng (`:248-253`) và xoá chúng khi download (`:534-535`). Prefix lạ giúp tab build cũ không thể đụng meta/base v3 (graft crdt).

**Allowlist sync** (`SYNCED_DOCS`): `cttm_v1` (strip `indexes`), `smartSpend.templates.v1`. Payload giảm ~3–4× so với hiện tại (không còn indexes, backup, demo, UI keys).

## 4.4 Ordering & đồng hồ

- **Thứ tự toàn cục** = `mf3:version`, chỉ tăng trong Lua sau khi CAS đạt. Không còn `nextRevision`/`bumpLocalRevision` (`dataSource.ts:177-180`, `:230-235`).
- **Tie-break cấp entity** = `updatedAt` (`types.ts:26,38,50,65`, reconciliation `:95`), `appliedAt` (`:114`, `:123`), `closedAt` (`schema.ts:39`). Chỉ dùng khi **cả hai bên** đều khác base; bản thua luôn vào `mf3.conflicts`.
- **`monotonicIso()`** thay `nowIso()` (`useAppStore.ts:171-173`): `max(Date.now() + skewMs, lastIssued + 1 ms)`, `lastIssued` lưu trong `mf3.meta`. Cùng máy không bao giờ lùi.
- **Skew**: mỗi boot gọi `redis.time()` (`TimeCommand` `chunk:2425`) 1 lần → `skewMs = serverMs − Date.now()`; `|skew| > 5 phút` → banner cảnh báo và mọi conflict trong phiên gắn cờ `skewSuspect`.
- Không dùng HLC/vector clock: snapshot-CAS chỉ cần server counter; tie-break entity có log là đủ (I2).

## 4.5 Lua script CAS_COMMIT (thật, dùng bằng `redis.eval` / `evalsha`)

```lua
-- KEYS[1]=mf3:version  KEYS[2]=mf3:head  KEYS[3]=mf3:history
-- KEYS[4]=mf3:pins     KEYS[5]=mf3:genesis
-- ARGV[1]=expectedVersion  ARGV[2]=snapshotPayload  ARGV[3]=headJson
-- ARGV[4]=nowMs  ARGV[5]=snapPrefix ('mf3:snap:')  ARGV[6]=keepRecent (20)
-- ARGV[7]=keepDays (30)  ARGV[8]=genesisIdIfNew  ARGV[9]=maxBytes
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur ~= tonumber(ARGV[1]) then
  -- CAS trượt: KHÔNG ghi gì, trả head hiện hành để client khỏi GET thêm
  return {0, cur, redis.call('GET', KEYS[2]) or '', redis.call('GET', KEYS[5]) or ''}
end
if string.len(ARGV[2]) > tonumber(ARGV[9]) then
  return {-1, cur, 'too-large', ''}
end
local nv  = cur + 1
local now = tonumber(ARGV[4])
local last = redis.call('ZRANGE', KEYS[3], -1, -1, 'WITHSCORES')
if last[2] and tonumber(last[2]) >= now then now = tonumber(last[2]) + 1 end  -- score đơn điệu
if cur == 0 then redis.call('SET', KEYS[5], ARGV[8], 'NX') end

-- (1) snapshot bất biến  (2) history  (3) head  (4) version = COMMIT POINT
redis.call('SET', ARGV[5] .. nv, ARGV[2])
redis.call('ZADD', KEYS[3], now, nv)
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[1], nv)

-- (5) retention SAU commit: lỗi ở đây chỉ để lại rác, không bao giờ để lại head lệch version
local keepRecent, keepDays = tonumber(ARGV[6]), tonumber(ARGV[7])
local pinned = {}
for _, v in ipairs(redis.call('SMEMBERS', KEYS[4])) do pinned[v] = true end
local all = redis.call('ZRANGE', KEYS[3], 0, -1, 'WITHSCORES')
local n, seenDay, removed = #all / 2, {}, 0
for i = n, 1, -1 do
  local ver, score = all[2*i-1], tonumber(all[2*i])
  local day = math.floor(score / 86400000)
  local keep = pinned[ver] or ((n - i) < keepRecent)
    or (((now - score) <= keepDays * 86400000) and not seenDay[day])
  seenDay[day] = true
  if not keep then
    redis.call('ZREM', KEYS[3], ver); redis.call('DEL', ARGV[5] .. ver); removed = removed + 1
  end
end
return {1, nv, redis.call('GET', KEYS[5]) or '', removed}
```

Ghi chú:
- Redis chạy script đơn luồng → CAS thật; Upstash REST không có WATCH giữa 2 request và `/multi-exec` (`chunk:3056`) không rẽ nhánh được, nên EVAL là cách duy nhất.
- Thứ tự ghi **snap → history → head → version** (sửa bug INCR-trước-SET của cas-3way): nếu SET thất bại giữa chừng (maxmemory), `version` vẫn = cur, lần push sau ghi đè lại `snap:<cur+1>` — idempotent.
- `redis.call('GET')` trả `false` khi nil → `or '0'` hợp lệ.
- Không có fallback NX+MULTI: nếu deployment không cho EVAL → phase `degraded`, **không push** (critic harden chứng minh fallback vừa có cửa sổ ghi đè vừa không có lịch sử).
- `ARGV[9]` kiểm tra kích thước phía server để fail sớm; client đã đo `JSON.stringify(body).length ≤ 700 KB` trước khi gửi (free plan ~1 MB, JSON-in-JSON phình 20–40%).

## 4.6 Giao thức sync (pseudo-code)

Tất cả hàm chạy trong `engine.runExclusive(fn)` (promise queue) — chỉ 1 pull/push/apply/restore tại một thời điểm trong 1 tab (I8).

### A. BOOT (`DataSourceProvider` useEffect [] → `engine.start()`)

```
A1. Render children NGAY (local-first). pushGate=false; phase='booting'; pill 'Đang đồng bộ…' ngoài children.
A2. meta = readMeta(); nếu thiếu → migrateFromV2LocalMeta() (mục 6). base = readBase().
A3. mode !== 'upstash' → phase='local-only'; return.
A4. redis = getRedis()  // singleton, enableAutoPipelining:false
A5. [skew] t = await redis.time(); meta.skewMs = t − Date.now()
A6. r = await PULL('boot')  (timeout 8 s bằng Promise.race vì client không nhận signal)
     lỗi → phase='degraded'|'auth-error'(401), pushGate=false, banner; retry backoff 5s→15s→60s→5m + on 'online'/'focus'/'visible'. return.
A7. pushGate=true; phase='idle'. Nếu isDirty() → schedulePush(0).
A8. HSET mf3:devices (best-effort). Bắt đầu poll (mục 4.9), leader election, listeners.
A9. Chỉ SAU A6 mới chạy autoClosePreviousMonthIfNeeded trên data đã merge (hoãn module-load :549-553 ở mode upstash, timeout 3 s thì chạy local).
```

### B. LOCAL WRITE (thay `useAppStore.ts:1316-1319`)

```
B1. useAppStore.subscribe((s)=>s.data, onData)           // Object.is trên reference
    useAppStore.subscribe((s)=>s.workspace, onWorkspace)
B2. onData(data):
      if engine.applyingRemote → persistLocal(data, {fromRemote:true}); return
      if workspace==='demo' → debouncedSave('cttm_v1_demo', data); return   // demo không sync
      h = contentHash(stripForSync(data))   // FNV-1a 64 sync, bỏ indexes/updatedAt/migrations, JSON round-trip để loại undefined
      if h === meta.lastPersistedHash → return          // autoClose tick, touch() không đổi gì → 0 ghi, 0 request
      debouncedSave(data)  // 400 ms, có .flush()/.cancel()
B3. debouncedSave khi nổ → persistLocal(data):
      navigator.locks.request('mf3.write', async () => {
        disk = parse(localStorage.cttm_v1); 
        if hash(disk) !== meta.lastPersistedHash && hash(disk) !== h   // tab khác đã ghi
            data = threeWayMerge(tabBase, data, disk).merged; setState({data}) (applying flag)
        localStorage.cttm_v1 = JSON(data); meta.lastPersistedHash = h; meta.dirty = true; dirtySince ??= now
        writeMeta()
      })
      bc.post({type:'local-changed', hash:h}); schedulePush(2500 ms, maxWait 15 s)
B4. 'pagehide' / 'visibilitychange:hidden' → debouncedSave.flush() đồng bộ.
B5. Delete actions ghi tombstone (I4); add* xoá tombstone nếu id trùng.
```

### C. PULL(reason)

```
C1. v = int(await redis.get('mf3:version') ?? 0)
C2. if v === 0:
      if meta.baseVersion > 0 → phase='remote-reset' → DIALOG (chặn), return          // flushdb/đổi DB
      legacy = await readLegacyV2Snapshot(); if legacy → MIGRATION (mục 6); else remote rỗng → return {empty:true}
C3. if v < meta.baseVersion → đọc lại sau 2 s (replica stale); vẫn < → DIALOG 'remote-rewound', return
C4. if v === meta.baseVersion → return {changed:false}     // ĐƯỢC TÍNH là pull thành công (mở pushGate)
C5. [head, raw] = await redis.pipeline().get('mf3:head').get(`mf3:snap:${v}`).exec()
    head = JSON.parse(head); if head.genesisId !== meta.genesisId && meta.genesisId → DIALOG 'remote-reset'
    if raw null (retention vừa xoá) → lặp C1 tối đa 3 lần
    snap = decode(raw); verify snap.version===v && contentHash(snap.data)===head.contentHash; sai → lastError, return (không apply)
C6. remote = normalizeCttmState(snap.data.cttm, {now: head.committedAt}) + rebuildExpenseIndexesFromEntities (indexes.ts:106) + ensureCategoriesForState (categories.ts:94)
C7. debouncedSave.flush(); local = useAppStore.getState().data   // I8: nguồn sự thật là store
    localDirty = meta.dirty || hash(local) !== meta.baseHash
C8. if !localDirty || isSeedableEmptyState(local) (useAppStore.ts:368):
        merged = remote; conflicts = []                       // fast-forward
    elif base != null: {merged, conflicts, stats} = threeWayMerge(base, local, remote)
    else: → DIALOG 'no-base' (preview 2-way union, không suy xoá), return
C9. GUARD (áp cho fast-forward lẫn merge): deleted = entity có ở local, mất ở merged
    if deleted > 0 && (deleted ≥ 5 || deleted ≥ 10% || merged trống mà local không trống)
        → DIALOG 'mass-delete' {Áp dụng | Giữ local & ghim remote | Xem khác biệt}; pushGate=false tới khi trả lời
C10. writeLocalHistory('before-apply-remote'|'before-merge', local); writeLastBackup(reason:'sync_pull')
C11. applyRemote(merged) (mục 4.8); setBase(remote, v, head.contentHash)   // base = REMOTE, không phải merged
     appendConflicts(conflicts); meta.dirty = hash(merged) !== head.contentHash
C12. bc.post({type:'pulled', version:v}); toast 'Đã nhận N thay đổi từ <deviceLabel>' nếu có thay đổi
C13. return {changed:true, needPush: meta.dirty}
```

### D. PUSH

```
D1. Guard: mode upstash && pushGate && navigator.onLine && !dialogOpen && workspace==='real'; else giữ dirty, return
D2. r = await PULL('pre-push'); if !isDirty() → return          // pull-before-push bắt buộc
D3. debouncedSave.flush(); local = getState().data
    body = buildSnapshotV3(local, tombstones, templates); head = {...}
    enc: gzip+b64 qua CompressionStream nếu có và raw > 300 KB
    if JSON.stringify(body).length > LIMIT (700 KB free / 7 MB paid) → phase='too-large', banner, return (không thử ghi)
D4. res = await evalsha(sha, KEYS5, [String(meta.baseVersion), payload, headJson, String(Date.now()+skew), 'mf3:snap:', '20', '30', genesisCandidate, String(LIMIT)])
    NOSCRIPT → eval(SRC) rồi scriptLoad
D5. res[0]===1 → meta.baseVersion=res[1]; baseHash=head.contentHash; genesisId ??= res[2]; setBase(local); dirty=false; pushFailures=0; bc.post('pushed')
D6. res[0]===0 → headNow = JSON.parse(res[2])
        if headNow.deviceId===deviceId && headNow.contentHash===head.contentHash → coi như thành công (push của mình sau retry mất response)
        else pushFailures++; quay lại D2 (PULL sẽ merge); tối đa 6 vòng với jitter 200–1500 ms; quá → phase='contended', backoff 30 s, KHÔNG BAO GIỜ ghi đè
D7. res[0]===-1 → too-large như D3
D8. Lỗi mạng (client tự retry 5 lần chỉ khi fetch throw, chunk:168-190; HTTP !ok throw không retry :193-200):
      'failed to fetch' → giữ dirty, backoff 2s·2^n (max 5 phút), retry on online/visible/focus (KHÔNG đổi phase sang degraded)
      401 → phase='auth-error', dừng auto-retry, banner yêu cầu token
      'max daily request limit' / 'rate limit' → backoff 10 phút
```

### E. CONFLICT / DIALOG

- Xung đột cấp entity/field: **không dialog**, merge tự động, bản thua vào `mf3.conflicts` (badge "N xung đột cần xem", nút "Khôi phục bản thua thành bản ghi mới").
- Dialog chỉ cho: `no-base`, `remote-reset`/`remote-rewound`, `mass-delete`, `migrate-v2`, `needs-update` (head.schema > 3), `too-large`. Khi dialog mở: `pushGate=false`, poll dừng, **children vẫn render** nhưng mọi thao tác ghi vẫn được lưu local (không mất). Mỗi lựa chọn: ghi `mf3.history('before-conflict')` → thao tác → push CAS `expected = version vừa thấy`; trượt → pull lại, mở lại dialog với số liệu mới.
- Lựa chọn "Giữ local, ghi lên Redis" vẫn qua CAS; remote cũ vẫn nằm trong `mf3:snap:<v>` (history) và được tự ghim.

### F. OFFLINE

- `navigator.onLine === false` hoặc fetch throw → không gọi Redis; `meta.dirty` persist qua reload.
- `online`/`focus`/`visible` → `runExclusive(PULL → PUSH)`.
- Hai máy cùng offline rồi lần lượt online: máy 1 CAS expected=base==head → OK; máy 2 CAS trượt → pull → 3-way với base chung → push. Kết quả = union thay đổi hai bên + tombstone.

### G. MULTI-TAB cùng máy (I9)

- `BroadcastChannel('mf3')`; fallback `storage` event trên `cttm_v1`/`mf3.meta`.
- **Mọi tab (kể cả leader)** khi nhận `local-changed`/`pulled`/`pushed`: đọc lại `cttm_v1` + `mf3.meta` → `applyingRemote=true; setState({data})` nếu hash khác data đang có. Không gọi Redis.
- Mọi ghi `cttm_v1`/`mf3.meta` đi qua `navigator.locks.request('mf3.write')` + read-modify-write (B3). Không có Web Locks → dùng `storage` event để merge thay vì overwrite.
- Leader (poll/push): `navigator.locks.request('mf3.leader', {ifAvailable:true})` **ưu tiên tab visible**; heartbeat 15 s vào `mf3.meta.leaderSeenAt`; tab khác chiếm khi > 45 s (tránh leader bị Chrome freeze giữ lock). Non-leader dirty → post `dirty`, leader push; nếu leader không phản hồi 5 s thì tự push (CAS bảo vệ).

## 4.7 Merge semantics theo từng loại dữ liệu trong CttmState

Ký hiệu: b=base, l=local, r=remote. Quy tắc chung 3-way: `eq(l,r)→l; l==b→r; r==b→l; cả hai đổi→tie-break, thua → conflicts`.

| dataKind | Quy tắc | Xoá | Ví dụ |
|---|---|---|---|
| `entities.expenses` / `fixedCosts` / `purchasePlans` / `savingsTransactions` (`schema.ts:52-57`) | Theo id trên `b∪l∪r`. Cả hai đổi khác nhau → `updatedAt` lớn hơn thắng (monotonicIso), bằng → remote (đã commit) thắng; thua → conflicts `both-edited`. `allIds` rebuild = thứ tự local + id mới theo `createdAt` rồi id. | Tombstone `tombstones[id]`. Có base: id ở b, vắng ở một bên **và có tombstone** → xoá, TRỪ khi bên kia sửa với `updatedAt > deletedAt` → giữ + conflicts `delete-vs-edit`. Xoá thắng cũng ghi conflicts (để lệch giờ không thành mất im lặng). Không base: chỉ xoá khi có tombstone rõ ràng. | A xoá `ex_1` 09:00, B sửa note 09:05 → giữ bản B, log. A xoá `ex_2`, B không đụng → xoá ở B sau pull. |
| `fixedCosts` – clone tháng mới (`useAppStore.ts:291-302`) | **I10**: id clone = `fc_${targetMonth}_${djb2(sourceId)}` (checksum có sẵn `dataSource.ts:168-175`); `createdAt/updatedAt` = `${targetMonth}-01T00:00:00Z` (tất định). Post-merge `dedupeClonedFixedCosts`: cùng month, cùng (name, amountVnd, category), `paidAmountVnd=0`, chỉ có ở một bên, không có trong base → giữ id nhỏ hơn, bản kia vào conflicts `dedupe` (bảo vệ dữ liệu tạo trước khi fix). | Như trên | A và B đều qua 01/09 → cùng `fc_2026-09_<hash>` → không nhân đôi. |
| `expenseCategories[]` (`types.ts:9-16`) | Map theo id, 3-way; `updatedAt` tie-break; thứ tự = local, id chỉ có ở remote nối vào cuối; `system=true` không bao giờ xoá; sau merge `ensureCategoriesForState` với `now = head.committedAt` (tất định). | Tombstone `cat:<id>`. Bị xoá một bên nhưng bên kia còn expense/fixedCost tham chiếu → giữ, conflicts `category-in-use` (tái tạo guard `deleteExpenseCategory` `:745`). | A xoá 'Pets', B thêm expense 'Pets' → giữ cả hai. |
| `settings` (`types.ts:73-85`, không `updatedAt`) | **Per-field** 3-way (11 field; `budgetRule` deep-equal như 1 field). Cả hai đổi khác nhau → remote thắng, conflicts `settings-field` với `{field, localValue, remoteValue}`. **Không** dùng `CttmState.updatedAt` làm tie-break (bị `touch()` bump ở mọi action). | Không xoá | A đổi `monthlyIncomeVnd`, B đổi `paydayDayOfMonth` → giữ cả hai. |
| `settingsByMonth` | Mức 1 theo key tháng (base-diff); mức 2 per-field như settings. Tháng do autoClose tự sinh: nếu `emergencyFundOpeningSourcesByMonth[m]` một bên `'manual'` → bên manual thắng cả tháng; cả hai `'auto'` → tính lại từ merged bằng `ensureMonthConfigurationFromPrevious(merged, m)` (`:198-322`). | Key ở b mất ở một bên → xoá chỉ khi bên kia không đổi; ngược lại giữ. | A auto-seed 2026-09, B sửa tay → B thắng. |
| `budgetAdjustmentsByMonth` (`types.ts:110-116`) | Theo tháng; cả hai đổi → `appliedAt` lớn hơn; thua → log. | Như settingsByMonth | |
| `capsByMonth` (`:118-126`) | Theo tháng; `appliedAt` lớn hơn; `source:'seed'` luôn thua source khác. | Như trên | |
| `monthLocksByMonth` (`schema.ts:38-43`) | Coi lock là **derived**: sau merge, với tháng có lock ở bất kỳ bên nào, rebuild `snapshot.settings/budgetAdjustment/caps` từ merged; `closedAt` = sớm nhất; nếu lock cũ khác bản rebuild → conflicts `month-lock-rebuilt`. Tránh lock stale từ tab ẩn đè cấu hình thật (critic harden #3). | Không có action unlock → merge không xoá lock. | A khoá 01/09 00:00:30 với settings stale, B đã sửa tháng 8 → lock dùng settings merged, `closedAt` của A. |
| `accountBalanceReconciliationsByMonth` (`types.ts:87-96`) | Theo tháng; `updatedAt` lớn hơn; thua → log, badge "quan trọng". Validation ở `localStorage.ts` áp lại sau merge. | Như settingsByMonth | |
| `emergencyFundOpeningSourcesByMonth` | Theo tháng; `'manual'` thắng `'auto'`; cả hai manual → theo bên thắng ở settingsByMonth. | Như trên | |
| `indexes` (`schema.ts:31-36`) | **Không sync, không merge, không hash.** Strip khỏi payload; rebuild bằng `rebuildExpenseIndexesFromEntities` (`indexes.ts:106`, đã dùng ở `localStorage.ts:230-232`). | n/a | |
| `schemaVersion`/`updatedAt`/`migrations` | `schemaVersion` phải bằng 1; `updatedAt = max(l, r)` (loại khỏi hash); `migrations` union theo `(from,to,at)`. | n/a | |
| `smartSpend.templates.v1` | Entity theo id (thêm `updatedAt`); cả hai đổi → field-level: `useCount=max`, `lastUsedAt=max`, field khác theo `lastUsedAt` lớn hơn. | Tombstone `tpl:<id>` | |
| UI keys, reports, demo, backup, workspace | Không sync, không xoá khi pull. | n/a | |

Merge là hàm thuần `threeWayMerge(base, local, remote, ctx) → {merged, conflicts, stats}` trong `src/sync/merge/*`, có property test giao hoán cho nhánh fast-forward và test bảng cho từng dòng trên.

## 4.8 Store rehydration (không reload)

1. Xoá `downloadAndReload` (`DataSourceProvider.tsx:63-69`) và mọi `window.location.reload`.
2. Thêm action `replaceData(next, {source:'remote'|'restore'})` vào `Actions` (`useAppStore.ts:72-162`): `set(() => ({ data: next }))` — partial merge cấp 1 của zustand 5 nên `ui`, `workspace`, `actions` giữ nguyên; mọi `useAppStore(selector)` re-render tự nhiên; handler đọc `useAppStore.getState().data` (vd `ExpensesPage`) thấy dữ liệu mới ở lần gọi kế.
3. `applyRemote(merged)`: `debouncedSave.cancel()` → `engine.applyingRemote = true` → `replaceData(merged)` → subscriber B2 thấy cờ → `persistLocal` **ngay** (không debounce, dưới Web Lock) và `meta.dirty = hash(merged) !== head.contentHash` → cờ tắt. Toàn bộ chạy đồng bộ trong cùng tick sau khi `await` network đã xong, không có `await` xen giữa (đóng race 400 ms).
4. Nếu `workspace === 'demo'`: engine **queue** delta, không setState, không merge với data demo (local cho merge luôn lấy từ store khi ở real; ở demo thì khoá push). `setWorkspace` (`:561-575`) gọi `engine.rebaseline()` sau khi load real để không sinh diff giả.
5. Form đang sửa entity bị remote xoá: component đọc `byId[id]` nhận `undefined` → đóng êm + toast.
6. Tab follower: `parseCttmState(localStorage.cttm_v1)` (tách từ `loadCttmStateFromKey` `localStorage.ts:71-235`) → `replaceData` với cờ applying.

## 4.9 Change detection & request budget

Upstash REST không có push. Ba lớp:

1. **Poll** `GET mf3:version` (~50 B) mỗi **45 s** khi `document.visibilityState === 'visible'`, **300 s** khi visible nhưng idle > 10 phút, **0** khi hidden; chỉ leader tab.
2. **Sự kiện** `visibilitychange→visible`, `focus`, `online` → PULL ngay (throttle 5 s). Mỗi PUSH đã kèm PULL (pre-flight).
3. **Cùng máy**: BroadcastChannel/`storage` event (mục G).

Ước lượng/thiết bị/ngày (8 h visible, 5 h active): ~340 poll + ~50 push (1 GET pre-flight + 1 EVAL) + ~30 pull do focus/online (1 pipeline = 1 request) + 2 boot ≈ **450–550 request**; 2 thiết bị ≈ 1 100/ngày; tab ẩn = 0. Giả định EVAL tính 1 request (chưa kiểm chứng — mục 9). Hiện trạng tab mở 24/7 = 1 440 upload/ngày chỉ để gây hại.

## 4.10 Xử lý lỗi & hiển thị trạng thái

- `SyncStatusPill` render **ngoài children** (sibling trong `DataSourceProvider`), `<Toaster>` chuyển ra ngoài provider (`main.tsx:20-32` → sibling của `DataSourceProvider` `:41-43`).
- Phase: `local-only | booting | idle | syncing | offline | degraded | contended | too-large | auth-error | conflict | needs-update`. Pill xanh "Đã đồng bộ v{n} · {device} · HH:MM"; vàng "Chưa đồng bộ từ HH:MM [Thử lại]"; đỏ "Lỗi: {message} [Chi tiết]"; badge "N xung đột".
- `getStorageErrorMessage` (`dataSource.ts:459-486`) giữ nguyên; thêm case `NOSCRIPT`/`unknown command 'eval'`.
- Không còn `console.error` im lặng (`:634`); mọi lỗi vào `meta.lastError` + pill.
- `QuotaExceededError` ở `persistLocal`/`setBase`: banner "Hết dung lượng trình duyệt", giữ store dirty và **ưu tiên push** (Redis an toàn hơn local khi local đầy), chuyển base/history sang IDB.
- Fetch treo: `Promise.race` timeout 30 s cho push/pull, reset `inFlight`.

---

# 5. Kế hoạch triển khai theo giai đoạn

## Giai đoạn 0 — Hôm nay (vài giờ): hotfix ngừng chảy máu

Hợp nhất `phase0Hotfix` của 3 giám khảo, sắp theo thứ tự nên làm. Không đổi giao thức, không đổi schema.

| # | File:dòng | Thay đổi | Đường bị chặn | Thời gian |
|---|---|---|---|---|
| H1 | `useAppStore.ts:1308-1310` | `set((s) => { const next = autoClosePreviousMonthIfNeeded(s.data); return next === s.data ? s : { data: next } })` — trả chính `s` để zustand không notify listener khi không đổi. | (1) tại gốc | 15' |
| H2 | `useAppStore.ts:1316-1319` | Tách thành `useAppStore.subscribe((s) => s.data, (data) => debouncedSave(getStorageKeyForWorkspace(useAppStore.getState().workspace), data))` (Object.is trên reference); `setWorkspace` (`:565`) đã tự `saveCttmState` nên không cần subscribe workspace. | (1) lớp 2 | 15' |
| H3 | `dataSource.ts:652-658`, `:660-666` | `patchedSetItem`: `const prev = this.getItem(key); originalSetItem.call(this, key, value); if (this !== window.localStorage || suppressMirror || !isAppDataKey(key) || prev === value) return;`. `removeItem` chỉ bump khi `prev !== null`. Ghi lại y nguyên không còn bump/upload — kể cả nhánh `repairLegacyEmergencyOpening` (`useAppStore.ts:247`). | (1) lớp 3 | 20' |
| H4 | `dataSource.ts:405-424` | Read-before-write: trước `redis.set`, `const remote = await getRemoteManifest(config)`; đọc `DATA_SOURCE_LAST_SYNC_KEY` (`:51`, ghi ở `:444` và `:538-543`). Nếu `remote && remote.keyCount > 0 && (!lastSync || (remote.revision !== lastSync.revision && remote.checksum !== lastSync.checksum))` → `throw new StorageSyncError('Redis đã được thiết bị khác cập nhật; hãy Tải Redis về trước')` + `dispatchDataSourceEvent()`; chỉ cho ghi đè khi `options.force === true` (từ dialog). Cửa sổ đè giảm từ "luôn luôn" xuống ~1 RTT. | (1)(2)(3) — điểm chung | 1 h |
| H5 | `dataSource.ts:423-424` | Giữ bản trước khi ghi: `prevRaw` là chuỗi GET ở H4; `const p = redis.pipeline(); if (prevRaw) { p.lpush('myfinance:storage:history', prevRaw); p.ltrim('myfinance:storage:history', 0, 9) } p.set(REMOTE_SNAPSHOT_KEY, payload); await p.exec()` (`LPushCommand` `chunk:1986`, `LTrimCommand` `:2021`, `Pipeline` `:3056`). Thêm `listRemoteHistory()`/`restoreRemoteHistory(i)` tối giản (`lrange`/`lindex` `:2000`/`:1926`) + 1 nút ở `ImportExportPage.tsx:325-329`. Redis từ 0 bản lịch sử → 10. | Khôi phục | 2 h |
| H6 | `dataSource.ts:39-47` + `DataSourceProvider.tsx:297-301` | `getBootSyncAction`: `'local-newer'` → `'resolve-conflict'`; chỉ giữ `'upload-local'` khi `!remoteHasData`. bootCheck nhánh `upload-local` chỉ chạy khi remote thật sự rỗng. | (3) | 30' |
| H7 | `DataSourceProvider.tsx:348` | `const blockApp = bootChecking || !!pendingDecision` → dialog chặn children → `AppLayout` không mount → không autoClose/upload nền. Dialog vẫn render vì nằm ngoài `{!blockApp ? children : null}` (`:352`). | (4) | 15' |
| H8 | `dataSource.ts:609-612` + `DataSourceProvider.tsx:318-323` | `export let uploadsArmed = false; export function setUploadsArmed(v)`; `scheduleUpload` return sớm khi `!uploadsArmed`. Provider chỉ `setUploadsArmed(true)` sau khi `compareLocalAndRemote` thành công (nhánh `none` `:303-306`, sau upload/download OK, sau khi người dùng chọn trong dialog). `catch` giữ `false`, retry compare on `online`/`focus`. | (2) | 1 h |
| H9 | `main.tsx:20-32`, `:41-43` | Chuyển `<Toaster>` ra ngoài `<DataSourceProvider>` (sibling trong `ThemeProvider`). `flushUpload` `:634` đổi `console.error` → `toast.error(getStorageErrorMessage(...))`. Thêm banner nhỏ trong provider khi `!uploadsArmed`: "Chưa kiểm tra được Redis — thay đổi chỉ lưu máy này". | (2) hiển thị | 30' |
| H10 | `dataSource.ts:529-531` | Bên trong `withStorageMirrorSuppressed`, trước vòng `setItem`: lưu `localStorage.getItem('cttm_v1')` vào `mf.prevLocal.v1` = `{at, raw}` (prefix **không** khớp `APP_DATA_PREFIXES` `:66` để không bị gom vào snapshot/xoá bởi `:534-535`). Thêm nút "Khôi phục bản local trước lần tải" ở `ImportExportPage` (đọc key → `importJson`). Đóng bước 18 forensic. | Khôi phục | 1 h |
| H11 | `DataSourceProvider.tsx:224-227`, `:153-156` | Thay `downloadAndReload` không hỏi bằng `setPendingDecision({kind:'activate-upstash-remote-differs', ...})` tái dùng dialog (`getDecisionCopy` `:428-458`); mọi download đi qua H10. | Bật mode không còn xoá local | 30' |
| H12 | `dataSource.ts:136-147` | `createRedis` cache singleton theo `url+token` (giữ `upstash-sync-token` cho `readYourWrites`, `chunk:162-164`); thêm `enableAutoPipelining: false` (mặc định `true` ở `chunk:4480`, `cloudflare.mjs:53-59`) để GET→SET của H4/H5 không bị gộp/đảo thứ tự trong cùng microtask. | Đúng đắn H4/H5 | 30' |
| H13 | `AppLayout.tsx:43-49` | `setInterval` chỉ gọi `autoClose()` khi `monthFromIsoDate(todayIso())` khác giá trị lần trước (`useRef`); giữ lời gọi lúc mount. Phòng thủ chiều sâu. | (1) | 20' |

**Test giai đoạn 0** (`tests/dataSource.test.ts` viết thêm): tick 60 s × 100 → 0 `setItem` bump / 0 upload; boot lỗi mạng → không upload sau 10 s dù có `set()`; local-newer với remote có data → dialog, không upload; dialog mở → `AppLayout` không mount; upload khi remote đổi → throw; download ghi `mf.prevLocal.v1`.

**Tiêu chí hoàn thành**: chạy lại 4 kịch bản forensic bằng harness (mục 8) → không có nhánh nào ghi Redis mà không qua dialog; Redis luôn có ≥ 1 bản trước.

**Rủi ro**: H4 vẫn có cửa sổ ~1 RTT (chấp nhận đến Giai đoạn 1); `getRemoteManifest` tải cả snapshot (+1 request lớn mỗi upload) — tạm chấp nhận.

## Giai đoạn 1 — Giao thức an toàn (CAS + history + change detection + no reload), ~3–4 người-ngày

**File**:
- MỚI `src/sync/redisProtocol.ts` (key `mf3:*`, `CAS_COMMIT` Lua + sha cache, `readVersion`, `readHeadAndSnap` (pipeline), `casCommit`, `listHistory` (`zrange withScores`), `pin/unpin`, `touchDevice`, `getRedis` singleton).
- MỚI `src/sync/snapshot.ts` (`SYNCED_DOCS`, `stripForSync`, `contentHash` FNV-1a 64 sync + canonical JSON round-trip, `encode/decode` gzip+b64 với fallback).
- MỚI `src/sync/syncEngine.ts` (state machine, `runExclusive`, pushGate, PULL/PUSH như 4.6 với merge tạm = fast-forward hoặc dialog `no-base`, poll/focus/online, backoff, BroadcastChannel + Web Locks leader, history local IDB).
- MỚI `src/sync/rehydrate.ts` (`applyRemote` qua `replaceData`).
- MỚI `src/sync/localMeta.ts` (`mf3.meta`, `mf3.base`, IDB adapter, migrate 3 key meta cũ).
- SỬA `src/store/useAppStore.ts`: `:1316-1319` → 2 subscribe + hash guard + cờ applying; thêm `replaceData`; `nowIso` → `monotonicIso`; hoãn `:549-553` ở mode upstash.
- SỬA `src/storage/localStorage.ts`: tách `normalizeCttmState(parsed, {now})` khỏi `:71-235`; `createDebouncedSaver` (`:241-254`) expose `flush()/cancel()`, bọc try/catch QuotaExceeded.
- VIẾT LẠI `src/app/DataSourceProvider.tsx`: bỏ bootCheck/compare/upload/download/reload/blockApp; expose `{config, syncState, saveUpstash, activateMode, syncNow, listHistory, restore, pin}`; dialog kinds mới; `SyncStatusPill` ngoài children.
- SỬA `src/storage/dataSource.ts`: XOÁ `:644-685` monkey-patch, `:609-642`, `:405-447`, `:488-578`, `:580-598`, `:39-47`, `:177-180`, `:209-256`; GIỮ config helpers, `createRedis`, `parseUpstashConfigInput`, `testUpstashConnection`, `getStorageErrorMessage`, `checksum/stableStringify` (chuyển sang `snapshot.ts`); `getRemoteSnapshot` (`:316-329`) đổi tên `readLegacyV2Snapshot`.
- SỬA `src/pages/ImportExportPage.tsx`: bỏ `collectLocalSnapshot` (`:41`), 2 nút blind (`:325-329`) → "Đồng bộ ngay", bảng lịch sử Redis (version/thời điểm/device/bytes → Khôi phục/Ghim), lịch sử local.
- SỬA `src/main.tsx`: Toaster sibling.

**Test**: `tests/sync/redisProtocol.test.ts` (mock Redis chạy logic CAS bằng JS tương đương Lua: trượt không ghi, thứ tự ghi, retention, genesis), `tests/sync/syncEngine.test.ts` (pushGate khi boot fail; CAS trượt → pull → retry; response mất → head.deviceId match → thành công; remote-reset → dialog; contended có giới hạn; offline queue; quota).

**Tiêu chí**: 4 kịch bản forensic + flushdb + mất mạng giữa push đều pass; 0 `window.location.reload` trong `src/`; `grep Storage.prototype src` = 0.

**Rủi ro**: Upstash plan chặn EVAL (phải xác nhận ngày đầu — nếu chặn, giai đoạn 1 dừng ở degraded không push); request size với dữ liệu thật (đo `cttm_v1` của người dùng trước).

## Giai đoạn 2 — Merge semantics đầy đủ (tombstone/3-way), ~3–4 người-ngày

**File**: MỚI `src/sync/merge/{threeWayMerge,entityTable,monthMaps,settings,categories,templates,fixedCostClone}.ts`; SỬA `schema.ts:45-64` (+`tombstones?`), `createInitialState` (`:95-116`); `useAppStore.ts` delete actions (`:745`, `:818`, `:944-958`, `:991`, `:1098`) ghi tombstone, add* xoá tombstone; `:291-302` id clone tất định; `importJson` (`:1240-1291`) và `resetAll` (`:1294-1306`) → `engine.pinHead('before-import'|'before-reset')` **bắt buộc** (offline → từ chối, disable nút `ImportExportPage`) + tombstone cho id biến mất + dialog ghi rõ "áp dụng cho MỌI thiết bị"; `templates.ts:10-20` thêm `updatedAt`; `mf3.conflicts` + UI "Khôi phục bản thua".

**Test**: `tests/sync/threeWayMerge.test.ts` — mỗi dòng bảng 4.7 ≥ 2 case; kịch bản "base→A sửa 1, B thêm 40 xoá 1"; delete-vs-edit; clone tháng 2 máy → 1 bộ fc; lock derived; mass-delete guard ở cả 3 đường; category-in-use; property test `merge(b,l,r)` khi `l==b` bằng `r` và ngược lại.

**Tiêu chí**: không còn dialog `no-base` cho máy đã có base; kịch bản 2 máy cùng qua tháng không nhân đôi; conflict log có bản thua cho mọi tie-break.

**Rủi ro**: sai ngữ nghĩa month-maps hiếm gặp — giảm bằng conflict log + guard; migration dữ liệu có clone `nanoid` cũ — dedupe heuristic.

## Giai đoạn 3 — Dọn dẹp, ~2 người-ngày

- Xoá hẳn `withStorageMirrorSuppressed`, `DATA_SOURCE_LOCAL_META_KEY`/`LAST_SYNC_KEY`/`REMOTE_CLEANUP_KEY`, `cleanupUpstashLegacyKeys` sau 60 ngày.
- Tách UI prefs khỏi mọi luồng dữ liệu (allowlist tường minh).
- Export/Import đầy đủ: export gồm `tombstones`, `templates`, `mf3.meta.deviceId`; import qua flow `replaceData` + pin.
- Migration framework thật: `SCHEMA_VERSION` 1→2 với `migrations[]` được ghi (`schema.ts:19-24`), `localStorage.ts:82-85` **throw** thay vì trả state rỗng im lặng; engine hiển thị lỗi và không đẩy state rỗng.
- `SettingsPage`: chọn plan (free/paid) → poll interval + LIMIT; tên thiết bị; nút "Xoá dữ liệu sync v3 trên Redis" (có export trước).

**Test**: migration v1→v2 giả lập; JSON hỏng → lỗi hiển thị, không ghi Redis.

---

# 6. Migration & tương thích ngược

**Trạng thái đầu**: Redis có `myfinance:storage:snapshot` (v2, `values['cttm_v1']` + UI keys, `dataSource.ts:24-28`); local có `cttm_v1` + `smartSpend.storage.localMeta.v1`.

**Lần đầu build mới boot ở mode upstash** (`engine.start` → C2):
1. `migrateFromV2LocalMeta()`: tạo `deviceId`, `baseVersion=0`, `base=null`, đọc `lastSync` cũ (`:51`) để biết local có thay đổi chưa upload (checksum bằng → local "sạch"); xoá 3 key meta cũ.
2. `GET mf3:version` = null → `readLegacyV2Snapshot()` (verify như `:321-327`) → `remote = normalizeCttmState(values['cttm_v1'])`, templates từ `values['smartSpend.templates.v1']`; bỏ qua mọi key khác.
3. Quyết định:
   - `isSeedableEmptyState(local)` → fast-forward remote, push `expected=0` (Lua tạo version 1 + genesis).
   - `hash(local) === hash(remote)` hoặc `lastSync.checksum === hash(local)` (local chưa đổi từ lần sync cuối) → dùng remote làm base, push nếu khác.
   - Khác nhau → dialog `migrate-v2` (không chặn app, chặn push): preview 2-way **union** (không suy xoá vì v2 không tombstone; entity có ở local nhưng vắng ở remote và `createdAt < lastSync.updatedAt` được liệt kê riêng "có thể đã bị xoá nơi khác" để người dùng chọn nhóm hồi sinh — chống zombie, graft oplog), settings per-field hiển thị hai cột. Mặc định "Gộp cả hai". Trước khi ghi: `mf3.history('before-migration')` + `writeLastBackup`.
4. Push CAS `expected=0` → version 1; `mf3:genesis` được SET NX. Legacy key **không bị xoá/ghi** lúc này.
5. Sau khi v3 tồn tại, build mới ghi lại legacy key **một lần** với `{schemaVersion:2, manifest:{keyCount:0, keys:[], checksum, revision: Date.now()}, values:{}, supersededBy:'v3'}`: tab build cũ khi `compareLocalAndRemote` thấy `remoteHasData=false` → chỉ `upload-local` lên v2 (vô hại với v3), **không** download bản v2 cũ đè local. Bản v2 gốc được LPUSH vào `myfinance:storage:history` (đã có từ H5) để rollback.
6. Thiết bị thứ hai chạy build mới: `mf3:version` có, `baseVersion=0` → local trống → fast-forward; local có data → dialog `no-base` (2-way union, có nhóm "có thể đã xoá"); sau đó có base bình thường. Hai máy migrate đồng thời: máy 2 CAS `expected=0` trượt → pull v1 → merge → push v2.

**App cũ còn chạy** (tab chưa reload / PWA cache): chỉ đọc/ghi legacy key, không biết `mf3:*` → không thể phá v3. Dữ liệu nó ghi vào v2: build mới mỗi boot và mỗi 30 phút `GET` legacy key (1 request), so **`manifest.checksum`** (không so `updatedAt` vì tick 60 s của app cũ bump `updatedAt` mỗi phút) với `legacyImportedChecksum` → khác → banner "Thiết bị chạy bản cũ vừa ghi dữ liệu [Gộp vào] [Bỏ qua]"; gộp = union + edit-wins, không suy xoá. Khuyến nghị mạnh trong UI: cập nhật mọi thiết bị trong vài ngày.

**Rollback**: `cttm_v1` vẫn schemaVersion 1 (field `tombstones` bị build cũ bỏ qua nhờ spread); key `mf3.*` local nằm ngoài prefix nên build cũ không đụng; Redis: khôi phục legacy key từ `myfinance:storage:history[0]` hoặc từ `mf3:snap:<n>` bằng script `scripts/rollback-v3.ts`; key `mf3:*` là additive, có thể giữ hoặc DEL sau khi export.

---

# 7. Khôi phục dữ liệu

## 7.1 Cho lần sau (sau Giai đoạn 1)

| Tầng | Ở đâu | Cửa sổ | Cách khôi phục |
|---|---|---|---|
| 1 | Redis `mf3:snap:<n>` + `mf3:history` | 20 bản gần nhất + 1 bản/ngày × 30 ngày | Trang Dữ liệu → Lịch sử → "Khôi phục thành bản mới" (apply + push CAS, bản hiện tại vẫn trong history) hoặc "Hợp nhất vào hiện tại" (3-way với base=∅ → union) |
| 2 | Redis `mf3:pins` | 180 ngày / vô hạn | Tự ghim trước import/reset/restore/mass-delete; ghim thủ công |
| 3 | Local IDB `mf3.history` (10 bản) + `cttm_backup_last_v1` (`sync_pull`) + `mf3.base` | vài ngày dùng | "Lịch sử local" → Khôi phục (qua `replaceData` + push) |
| 4 | `mf3.conflicts` | 200 entry | "Khôi phục bản thua" (ghi đè hoặc tạo id mới) |
| 5 | Export JSON (`useAppStore.ts:1236`) | thủ công | Nhắc export khi > 30 ngày |

Mất dữ liệu chỉ còn có thể xảy ra khi người dùng chủ động chọn ở dialog; kể cả khi đó tầng 1–3 vẫn có bản trước.

## 7.2 Thành thật: dữ liệu tuần 28/08–04/09 của người dùng còn ở đâu không?

Sau khi cả A, Redis và B đều là D_A0 (bước 6 forensic), **trong app không còn bản sao nào**. Các khả năng còn lại, theo thứ tự đáng thử:

1. **localStorage của B** — chỉ còn nếu B **chưa** boot online kể từ lúc Redis bị đè. Cách lấy: tắt mạng (hoặc chặn `*.upstash.io`) **trước** khi mở B → DevTools → Application → Local Storage → copy `cttm_v1` → lưu file; hoặc nếu tab B vẫn đang mở (chưa reload) → Dữ liệu → "Tải file sao lưu" (`exportJson`). Nếu B đã boot online thì `cttm_v1` đã bị `downloadUpstashToLocal` ghi đè (`:531-535`) — không còn.
2. **`cttm_backup_last_v1` trên B** — chỉ có nếu trong tuần B từng `importJson`/`resetAll`/`resetDemoAndSeed`; và key này cũng bị đồng bộ nên nhiều khả năng đã là bản của A.
3. **LevelDB của Chrome** (`%LocalAppData%\Google\Chrome\User Data\Default\Local Storage\leveldb\*.ldb|*.log`) trên B: giá trị cũ có thể chưa bị compact. Đóng Chrome, copy thư mục, dùng công cụ đọc LevelDB (vd. `ccl_chrome_indexeddb`/`leveldb-dump`) tìm chuỗi `"schemaVersion":1` có `expenses` với `date` trong 28/08–04/09. Không đảm bảo.
4. **Upstash**: chỉ có nếu plan trả phí và đã bật daily backup (console Upstash → Backups). Free plan: không.
5. **Redis legacy keys** `myfinance:storage:version:*`: đã bị `cleanupUpstashLegacyKeys` (`:385-398`) xoá từ lần upload thủ công đầu tiên — không còn.

Kết luận: nếu B đã boot online, dữ liệu tuần đó **mất**, trừ forensic LevelDB (xác suất thấp). Nên hướng dẫn người dùng thực hiện mục 1 **ngay** trước khi mở B lần nữa.

---

# 8. Test plan

**Harness** (`tests/sync/harness.ts`):
- `FakeStorage` (Map-based `Storage`) × 2 thiết bị (A, B), mỗi thiết bị có thể có nhiều tab (mỗi tab = 1 instance store + engine, chia sẻ cùng `FakeStorage`, `FakeBroadcastChannel`, `FakeLocks`).
- `FakeRedis` implement `get/set/pipeline/eval/evalsha/scriptLoad/zrange/sadd/smembers/time/hset` với `eval` chạy bản JS tương đương `CAS_COMMIT` (kiểm tra CAS, thứ tự ghi, retention, genesis); có `failNext(n, kind)` để mô phỏng fetch throw / 401 / mất response sau khi server đã ghi.
- `vi.useFakeTimers()` cho debounce 400 ms, push 2.5 s, poll 45 s, tick 60 s; `advanceDays()`.

**Test bắt buộc**:

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| T1 | (1) Tab A mở 7 ngày (tick 60 s × 10 080), B nhập 200 expense | A: 0 push khi không đổi; Redis head luôn chứa 200 expense của B; A hội tụ về B sau ≤ 45 s |
| T2 | (2) A boot với `failNext(fetch)` rồi mạng hồi | A không push tới khi PULL thành công; sau đó merge, không mất gì của B |
| T3 | (3) A boot sau ranh giới tháng, module-load autoClose | không `local-newer`; kết quả = tuần của B + monthLock derived + 1 bộ fixedCost tháng mới (không nhân đôi) |
| T4 | (4) Dialog `no-base`/`mass-delete` mở | 0 EVAL trong lúc mở; children vẫn dùng được; thao tác ghi lưu local |
| T5 | Clock skew ±1 h / ±1 ngày ở A | ordering không đổi; conflict tie-break sai bên → có log; `monotonicIso` không lùi |
| T6 | Mất mạng giữa push (server ghi, response mất, client retry) | không duplicate, không mất; CAS trượt được nhận diện là push của mình |
| T7 | Multi-tab: T1 leader hidden, T2 nhập 10 expense, T1 tick/pull | 10 expense còn nguyên (RMW dưới lock), cả hai tab cùng hash |
| T8 | Race 400 ms: add expense rồi PULL trong 100 ms | expense không mất (flush trước merge) |
| T9 | flushdb / đổi URL | dialog `remote-reset`, không tự push expected=0, không fast-forward |
| T10 | resetAll ở A; B poll | B: dialog `mass-delete`, head được ghim trước |
| T11 | `cttm_v1` hỏng/schemaVersion lạ ở A | không push state rỗng; lỗi hiển thị |
| T12 | Demo workspace ở A khi B push | delta queue, không trộn demo vào real, không tombstone giả khi quay về real |
| T13 | Migration v2: local ≠ remote, có `lastSync` | union + nhóm "có thể đã xoá"; legacy key được history hoá; máy 2 migrate đồng thời không mất |
| T14 | Retention: 60 push trong 1 ngày + 40 ngày | giữ 20 gần nhất + mốc ngày + pins; snap bị xoá không còn trong history |
| T15 | Payload > LIMIT | phase `too-large`, không gửi, local giữ dirty |
| T16 | Property: `hash(normalize(parse(serialize(x)))) === hash(x)` với mọi fixture; `merge(b,l,r)` khi `l===b` → `r` | pass |

Tests hiện có (`tests/storeSavings.test.ts`, `accountReconciliationStorage.test.ts`, `dayLock.test.ts`, `templates.test.ts`) chạy với engine ở `local-only` — không cần harness Redis.

---

# 9. Điều còn chưa giải quyết / cần người dùng quyết

1. **Upstash plan có cho EVAL/EVALSHA không, và cách tính request cho lệnh trong script?** Phải smoke-test trên DB thật ngày đầu Giai đoạn 1. Nếu bị chặn: không có fallback an toàn → sync chỉ hoạt động ở chế độ "pull + degraded", cần nâng plan hoặc đổi backend.
2. **Giới hạn request size** (giả định free ~1 MB, paid ~10 MB) và **kích thước `cttm_v1` thật** của người dùng — cần script đo trước khi chốt LIMIT/gzip/poll interval. Dữ liệu > ~5 năm ở free plan không gzip sẽ chạm trần; chunking chưa thiết kế.
3. **Ngữ nghĩa `resetAll`/`importJson`** đổi từ "máy này" thành "mọi thiết bị" (có ghim + xác nhận). Cần người dùng đồng ý copy UI; thêm lựa chọn "Chỉ máy này = ngắt sync".
4. **Workspace demo và UI prefs không còn sync** (thay đổi hành vi có chủ ý).
5. **Sửa cùng một field của cùng một entity trên 2 máy trước khi sync**: LWW theo `updatedAt`, bản thua vào conflict log — không merge giá trị. Chấp nhận cho app cá nhân một người dùng?
6. **Retention 30 ngày**: phát hiện mất sau > 30 ngày chỉ còn pins/export. Có muốn nâng lên 90 ngày (tốn storage Redis ~3×)?
7. **Bảo mật**: token Upstash vẫn trong localStorage; không mã hoá dữ liệu trên Redis — ngoài phạm vi.
8. **Thời điểm ép nâng cấp mọi thiết bị**: giai đoạn coexist với app cũ là best-effort (xoá trên app cũ không lan sang). Đề xuất: bật v3 khi người dùng xác nhận đã reload tất cả thiết bị.
9. **Có bật Upstash daily backup** (plan trả phí) làm lớp cuối cùng không?
10. **Quyết định ngay hôm nay**: hướng dẫn người dùng mở thiết bị B **offline** để cứu bản `cttm_v1` (mục 7.2) trước bất kỳ deploy nào.