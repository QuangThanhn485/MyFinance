# Thiết kế: Sync v4 "Ledger" — đồng bộ bằng sổ cái thao tác, không còn ghi đè trạng thái

> **Trạng thái (24/10/2026): ĐÃ TRIỂN KHAI** trên nhánh `feat/sync-v4-ledger` — mã nguồn `src/ledger/*`, kiểm thử `tests/ledger/*`. Mục 1 mô tả v3 (đối chiếu commit `2a24733`); mục 11 ghi những điểm khác so với đề xuất, quy trình deploy và cách quay lại. Nguồn sự thật cho Lua là `src/ledger/remote.ts`. Thuật ngữ kỹ thuật giữ tiếng Anh.

---

## 0. Tóm tắt một đoạn

v3 vẫn đồng bộ bằng cách **gửi nguyên trạng thái** của thiết bị lên mây, rồi đắp quanh đó CAS, 3-way merge, tombstone có hạn, ngưỡng mass-delete, base, writeSeq, lịch sử snapshot… Mỗi lớp vá một đường mất dữ liệu nhưng không lớp nào loại bỏ được *nguyên nhân*: **một thiết bị có quyền nói "thế giới bây giờ là S"**. v4 bỏ hẳn quyền đó. Thiết bị chỉ được **ghi thêm sự kiện** ("thêm khoản chi X", "đổi field `amountVnd` của X thành 50.000", "xoá X") vào một **sổ cái chỉ-ghi-thêm** trên Redis, thứ tự do server cấp. Dữ liệu của mọi thiết bị = phát lại sổ cái. Không có lệnh nào trong app xoá hay ghi đè sổ cái ⇒ không cần backup mỗi lần lưu: **lịch sử chính là dữ liệu**, mọi trạng thái quá khứ đều dựng lại được, mọi thay đổi đều hoàn tác được.

---

## 1. Vì sao v3 vẫn mong manh — bằng chứng

### 1.1 Lỗi gốc

PUSH của v3 gửi `buildLocalDoc()` = **RAM của tab** (`syncEngine.ts:898`) và CAS chỉ kiểm tra "anh đã thấy version N" (`syncEngine.ts:903`, Lua `redisProtocol.ts:33-36`). Nhưng *version đã thấy* nằm trong `mf3.meta` dùng chung cả trình duyệt, còn *dữ liệu* nằm trong RAM riêng từng tab. Hai thứ này lệch nhau là đủ để một bản thiếu dữ liệu thắng CAS hợp lệ. Không có guard nào ở phía push (guard mass-delete chỉ chạy lúc pull ở máy khác, `syncEngine.ts:729-733`, và bỏ qua khi xoá < 20 mục, `merge.ts:644-650`).

### 1.2 Hai lỗi đã tái hiện bằng harness hiện có

File test: `C:\Users\THANH~1.NGU\AppData\Local\Temp\claude\c--Tool-MyFinance\75b1cae9-acf0-4dd0-9d43-a2b58c4b85dd\scratchpad\zz-repro.test.ts` (đặt vào `tests/sync/` để chạy).

**R1 — Tab có RAM cũ xoá im lặng dữ liệu vừa nhập (nghiêm trọng).**
1. Laptop mở app ở tab 1, rồi điều hướng tab 1 sang trang khác (trang vào back/forward cache, hoặc tab bị trình duyệt đóng băng).
2. Mở app ở tab 2, nhập 3 khoản chi → push v2. Điện thoại nhận đủ 3 khoản.
3. Bấm Back ở tab 1 → trang khôi phục với RAM cũ, sự kiện `storage` đã bị lỡ → `visibilitychange` → `syncNow` → `pull`: `version === meta.baseVersion` (meta đã được tab 2 cập nhật) → `isDirty()` so RAM cũ với `baseHash` → true → push RAM cũ (`syncEngine.ts:667-669`, `507-512`).
4. Đóng tab 2, dùng tiếp tab 1.

Kết quả đo được: Redis head, RAM laptop, **đĩa laptop** và điện thoại đều chỉ còn `ex_seed, ex_next`; 3 khoản chi biến mất, **không hộp thoại nào**. Bản duy nhất còn lại nằm trong `mf3:snap:2`, sẽ bị retention xoá sau 20 lần push/60 ngày.

**R2 — Khoản đã xoá sống lại trên mọi thiết bị sau 90 ngày (sai số liệu im lặng).**
1. Xoá một khoản nhập trùng 5.000.000đ. Một điện thoại cũ còn giữ khoản đó, cất đi.
2. 95 ngày sau, có một lần merge thật → `mergeTombstones` bỏ tombstone > 90 ngày (`merge.ts:62`, `189-190`).
3. Điện thoại cũ mở lúc chưa có mạng, nhập một khoản, rồi có mạng → 3-way: local == base có khoản trùng, remote thiếu và **không còn tombstone** → giữ lại (`merge.ts:143-155`) → push.

Kết quả đo được: khoản 5.000.000đ xuất hiện lại trên mọi thiết bị, tổng chi tháng 9 bị đội lên, không cảnh báo.

### 1.3 Rủi ro phụ (không tái hiện, nêu để cân nhắc)

- **localStorage bị chính các bản sao lưu chiếm chỗ**: `cttm_v1` + `mf3.base` + 3 bản `mf3.history` + `cttm_backup_last_v1` ≈ 6 bản đầy đủ trong quota ~5 MB. Khi đầy, `saveCttmState` lỗi chỉ được `console.error` (`localStorage.ts:274-276`) — người dùng không biết dữ liệu không còn được ghi xuống đĩa. Đây chính là cái giá của "backup mỗi lần lưu".
- **Mojibake ghi vào dữ liệu thật**: chuỗi tiếng Việt hỏng mã hoá trong `applyRecoveryOption` (`useAppStore.ts:1221`, `1225`, `1281`) được lưu vào `capsByMonth[].note` và đồng bộ đi mọi máy. Có từ commit `e8dd212` (02/2026), độc lập với sync — sửa riêng.

---

## 2. Nguyên lý mới (bất biến)

| # | Bất biến | Hệ quả |
|---|---|---|
| L1 | **Thiết bị không bao giờ gửi trạng thái, chỉ gửi thao tác** (op) mô tả đúng phần nó đổi. | Thiết bị cũ/tab cũ không biết dữ liệu của người khác thì cũng không thể xoá nó. Đóng R1 và sự cố A→B→A gốc theo cấu trúc, không theo heuristic. |
| L2 | **Sổ cái trên server chỉ ghi thêm.** Không có code path nào trong app gọi `DEL`/`LSET`/`LTRIM`/`SET` lên sổ cái. | Không có gì bị ghi đè ⇒ không cần snapshot/backup; lịch sử = dữ liệu. |
| L3 | **Thứ tự toàn cục do server cấp** (`seq` tăng dần trong Lua). Đồng hồ máy chỉ để hiển thị. | Mọi thiết bị phát lại cùng một chuỗi ⇒ cùng một kết quả. Hết tie-break theo `updatedAt`, hết lệch giờ. |
| L4 | **Xoá là một op vĩnh viễn**, không có TTL. | Đóng R2: phát lại luôn thấy lệnh xoá. |
| L5 | **Ghi là idempotent**: mỗi op có `(deviceId, cseq)`; server bỏ qua op đã nhận. | Mất response, retry, hai tab cùng đẩy — không trùng, không mất. |
| L6 | **Hàm phát lại (fold) thuần và tất định**, dùng chung mọi thiết bị; op có `sv` (schema version) — gặp `sv` lạ thì dừng áp dụng và khoá push. | Không có chuyện build cũ hiểu sai op của build mới rồi ghi bậy. |
| L7 | **RAM không bao giờ được ghi xuống như nguồn sự thật.** Nguồn sự thật cục bộ = IndexedDB (trạng thái đã xác nhận + hàng đợi op chưa gửi). | Tab cũ chỉ có thể *thêm* op của chính nó; tab nào cũng dựng lại được sự thật từ IndexedDB. |

---

## 3. Mô hình dữ liệu

### 3.1 Bản ghi (record)

`CttmState` được chiếu thành tập bản ghi `(collection, key) → fields`. Ánh xạ cố định, viết một lần trong `src/ledger/records.ts`:

| collection | key | Nguồn trong `CttmState` |
|---|---|---|
| `expense`, `fixedCost`, `purchasePlan`, `savingsTx` | id | `entities.*.byId` |
| `category` | id | `expenseCategories[]` |
| `settings` | `global` | `settings` (`budgetRule` là 1 field) |
| `monthSettings` | `YYYY-MM` | `settingsByMonth` |
| `budgetAdj`, `caps`, `monthLock`, `reconciliation` | `YYYY-MM` | các map theo tháng tương ứng |
| `openingSource` | `YYYY-MM` | `emergencyFundOpeningSourcesByMonth` (field `source`) |
| `template` | id | `smartSpend.templates.v1` — chuyển vào sổ cái, bỏ ghi trực tiếp ở `ExpensesPage.tsx:798`, `892`, `913` |

Không đồng bộ: `indexes` (dựng lại), `updatedAt` tổng, `migrations`, UI prefs, workspace demo.

### 3.2 Op

```ts
type Op = {
  sv: 1                    // schema version của op
  dev: string              // deviceId
  cseq: number             // bộ đếm tăng dần theo thiết bị, cấp trong transaction IndexedDB
  at: string               // giờ máy, chỉ để hiển thị nhật ký
  t: "put" | "patch" | "del" | "init"
  c: Collection
  k: string
  v?: Record<string, unknown>   // put/init: toàn bộ field; patch: chỉ field đổi ({"$unset":true} để xoá field)
  tx?: string              // gom các op của một thao tác người dùng (để hoàn tác cả cụm)
}
// Server gắn thêm: seq (thứ tự toàn cục), sat (giờ server)
```

### 3.3 Ngữ nghĩa phát lại (áp theo `seq` tăng dần)

| op | Bản ghi chưa có | Bản ghi đang sống | Bản ghi đã xoá |
|---|---|---|---|
| `put` | tạo | thay toàn bộ | tạo lại (hồi sinh **có chủ đích**: khôi phục, hoàn tác xoá) |
| `patch` | bỏ qua | gán từng field | bỏ qua — engine báo "thay đổi của bạn rơi vào mục đã bị xoá ở máy khác [Khôi phục]" |
| `del` | ghi nhận đã xoá | xoá | bỏ qua |
| `init` | tạo | bỏ qua | bỏ qua |

- `init` dành cho dữ liệu tự sinh (sang tháng mới: `monthSettings`, fixed cost clone id tất định `fc_<tháng>_<hash>` như hiện tại `useAppStore.ts:322`, `monthLock`): hai máy cùng sang tháng thì máy đến sau là no-op; người dùng đã xoá bản clone thì máy khác không thể sinh lại.
- Hai máy sửa **khác field** của cùng bản ghi → giữ cả hai. Sửa **cùng field** → op đến sau thắng; giá trị cũ vẫn nằm trong sổ cái, hoàn tác được.
- Tập `deleted` (chỉ key) giữ vĩnh viễn trong trạng thái đã phát lại — vài KB, không bao giờ dọn.

---

## 4. Giao thức trên Upstash Redis

### 4.1 Key

| Key | Kiểu | Nội dung |
|---|---|---|
| `mf4:log` | LIST | Mỗi phần tử = 1 op JSON đã gắn `seq`, `sat`. `seq` = vị trí (1-based). Chỉ `RPUSH` trong Lua. |
| `mf4:dev` | HASH | `deviceId → cseq lớn nhất đã nhận` (khoá idempotency). |
| `mf4:genesis` | STRING | Id của sổ cái; đổi/mất ⇒ DB bị thay/xoá sạch ⇒ dừng, hỏi người dùng. |
| `mf4:migration` | STRING | Khoá + cờ hoàn tất của lần chuyển đổi v3 → v4. |

Không còn: `mf3:snap:*`, `mf3:history`, `mf3:pins`, `mf3:head`.

### 4.2 Lua APPEND (không dùng `cjson`, chỉ nối chuỗi)

```lua
-- KEYS[1]=mf4:log KEYS[2]=mf4:dev KEYS[3]=mf4:genesis
-- ARGV[1]=deviceId ARGV[2]=firstCseq ARGV[3]=serverNowHint ARGV[4]=expectedGenesis
-- ARGV[5..n]=op JSON, mỗi chuỗi bắt đầu bằng '{' (op thứ i có cseq = firstCseq + i - 5)
if (redis.call('GET', KEYS[3]) or '') ~= ARGV[4] then return {-2, redis.call('GET', KEYS[3]) or ''} end
local last = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
local first = tonumber(ARGV[2])
if first > last + 1 then return {-1, last} end              -- hở cseq: client gửi lại từ last+1
local seq = redis.call('LLEN', KEYS[1])
for i = 5, #ARGV do
  local op = ARGV[i]
  if string.sub(op, 1, 1) ~= '{' or string.len(op) > 16384 then return {-3, i} end
  local cseq = first + (i - 5)
  if cseq > last then
    seq = seq + 1
    redis.call('RPUSH', KEYS[1], '{"seq":' .. seq .. ',"sat":' .. ARGV[3] .. ',' .. string.sub(op, 2))
    last = cseq
  end
end
redis.call('HSET', KEYS[2], ARGV[1], last)
return {1, last, seq}
```

- Op cũ (cseq ≤ last) bị bỏ qua ⇒ retry sau khi mất response là an toàn (L5).
- Không có nhánh nào ghi đè hay xoá; script chỉ nối thêm.
- Lô tối đa 200 op/lần (giới hạn request 1 MB của gói miễn phí).

### 4.3 Đọc

- **Poll**: `LLEN mf4:log` (1 lệnh, vài byte) mỗi 45 s khi tab hiện, 0 khi ẩn; thêm khi `focus`/`online`/`visible`.
- **Pull**: `LRANGE mf4:log cursor cursor+499` lặp tới hết. Kiểm tra `seq` liền mạch; lệch ⇒ dừng, báo lỗi, không áp dụng.
- Máy mới: phát lại từ đầu. Ước lượng ~10 op/ngày ⇒ ~1 MB/năm; 5 năm ≈ vài giây tải một lần duy nhất. (Checkpoint phía server chỉ thêm khi thật sự cần, và là cache dựng lại được — không phải bản sao lưu.)

### 4.4 Phát hiện bất thường

- **Trùng danh tính thiết bị** (IndexedDB bị khôi phục từ bản cũ, cseq lùi): khi pull thấy `HGET mf4:dev <tôi>` ≥ `nextCseq` của tôi ⇒ đổi deviceId mới, đánh số lại op chưa gửi. Không op nào bị bỏ qua oan.
- **Sổ cái ngắn hơn cursor** hoặc `genesis` khác ⇒ DB bị xoá/đổi ⇒ dừng push, hỏi người dùng (có thể khởi tạo lại sổ cái từ dữ liệu máy này).
- **Op có `sv` lạ** ⇒ dừng phát lại tại đó, khoá push, banner "Cần tải lại ứng dụng".

---

## 5. Phía client

### 5.1 IndexedDB `myfinance-ledger`

| Store | Nội dung |
|---|---|
| `kv/meta` | `deviceId`, `nextCseq`, `cursor` (seq cuối đã phát lại), `genesisId` |
| `kv/confirmed` | Trạng thái đã phát lại tới `cursor` (records + `deleted`) — là **cache dựng lại được** từ server, không phải bản sao lưu |
| `outbox` | Op chưa được server xác nhận, theo `cseq` |

Mọi ghi đi trong transaction IndexedDB ⇒ hai tab không thể cấp trùng `cseq`, không thể ghi đè nhau. Gọi `navigator.storage.persist()` để giảm nguy cơ trình duyệt dọn dữ liệu.

### 5.2 Luồng một thao tác người dùng

```
action (vd addExpense)
  └─ commit(fn): before = store.data; after = fn(before)
       ops = diffRecords(before, after)            // chỉ field thực sự đổi; record mới = put (init nếu là dữ liệu tự sinh)
       store.data = after                          // UI cập nhật ngay
       IDB tx: gán cseq, ghi outbox                 // bền vững trong vài ms
       BroadcastChannel('mf4').post('changed')      // tab khác dựng lại từ IDB
       schedulePush(1 s)
```

- Logic nghiệp vụ hiện tại (`ensureMonthConfigurationFromPrevious`, `applyRecoveryOption`, validation danh mục…) **giữ nguyên** dạng hàm thuần `before → after`; chỉ thay chỗ `set()` bằng `commit()`. `diffRecords` so hai trạng thái của **cùng một tick, cùng một tab** nên chính xác tuyệt đối — khác hẳn việc suy luận xoá từ hai bản ở hai thời điểm/hai máy.
- Trong test và dev: assert `project(apply(before, ops)) == after` cho mọi action để bắt sai lệch ánh xạ.
- `touch()`/`CttmState.updatedAt` không còn ý nghĩa đồng bộ.

### 5.3 Push / pull / rebase

- **Push**: đọc outbox theo `cseq` → Lua APPEND → server trả `last` → xoá op ≤ `last` khỏi outbox khi chúng đã xuất hiện trong lần pull. Hai tab đẩy trùng thì server tự loại.
- **Pull**: lấy op mới → phát lại lên `confirmed` → `store.data = project(confirmed + outbox)` (rebase op chưa gửi lên trên). Một `patch` của tôi rơi vào bản ghi đã bị máy khác xoá ⇒ thông báo rõ kèm nút khôi phục.
- **Không bao giờ** đẩy RAM, không hash cả tài liệu, không base, không 3-way merge, không ngưỡng mass-delete.

### 5.4 Nhiều tab

Tab nhận `changed` qua BroadcastChannel, hoặc khi `pageshow`/`visibilitychange` (bao trường hợp bfcache lỡ sự kiện của R1) ⇒ đọc lại IndexedDB và dựng lại `store.data`. Kể cả khi tab không dựng lại kịp, điều tệ nhất có thể xảy ra là nó tạo `patch` từ một giá trị cũ cho đúng field người dùng vừa sửa — vẫn là một op riêng trong sổ cái, hoàn tác được — chứ không thể xoá dữ liệu nó không biết.

---

## 6. Khôi phục mà không cần backup

| Nhu cầu | Cách làm trong v4 |
|---|---|
| Xem ai đổi gì, lúc nào | **Nhật ký thay đổi** = đọc sổ cái: "10:05 · Laptop · Thêm chi 50.000đ Ăn trưa". |
| Hoàn tác một thao tác | Phát lại tới `seq - 1` để lấy giá trị trước ⇒ ghi thêm op ngược (`put` giá trị cũ / `del`). |
| Quay về thời điểm T | Phát lại tới T ⇒ `diffRecords(hiện tại, tại T)` ⇒ ghi thêm một cụm op. Lịch sử sau T vẫn còn nguyên. |
| Sao lưu ngoài | Nút "Tải sổ cái (.jsonl)" do người dùng chủ động — đầy đủ, phát lại được. |

Bị xoá khỏi code: `mf3.base`, `mf3.history`, `mf3.conflicts`, `cttm_backup_last_v1`, `writeSeq`, `lastPersistedHash`, `baseUntrusted`, retention/pins, hộp thoại `no-base`/`mass-delete`/`legacy-changed`, `threeWayMerge` (chỉ còn dùng một lần khi chuyển đổi).

---

## 7. Chuyển đổi v3 → v4 (một lần)

1. Build v4 boot, `mf4:log` rỗng, `mf3:version > 0`: lấy khoá `mf4:migration` (SET NX, hết hạn 120 s).
2. Đọc snapshot v3 mới nhất, gộp với local bằng `threeWayMerge` hiện có **một lần cuối** → trạng thái S.
3. Tạo `mf4:genesis`, ghi S thành các op `put` (gom `tx = "migrate"`), theo lô 200, rồi đặt `mf4:migration = done`.
4. **Đóng băng v3**: `SET mf3:version "frozen-v4"`. Tab build cũ đọc ra 0 → mở hộp thoại, mọi CAS trượt vĩnh viễn (`tonumber` trả nil) ⇒ không thể ghi. `mf3:*` giữ nguyên để rollback.
5. Thiết bị thứ hai lên v4: chờ `migration = done` → pull → so local (v3) với trạng thái sổ cái bằng `threeWayMerge(base, local, ledger)` → `diffRecords(ledger, merged)` → chỉ đẩy phần thay đổi của nó.
6. Local-only (chưa bật Upstash): sinh op `put` từ `cttm_v1` vào outbox; khi bật Upstash, đẩy toàn bộ.
7. `cttm_v1` cuối cùng của v3 được để nguyên tại chỗ 30 ngày như lưới an toàn của *lần chuyển đổi* (không phải cơ chế thường trực), sau đó xoá.

**Rollback**: deploy lại build v3, `SET mf3:version <số cũ>`; dữ liệu nhập trong thời gian chạy v4 lấy lại bằng cách xuất sổ cái.

---

## 8. Kịch bản kiểm thử bắt buộc

| # | Kịch bản | Kỳ vọng |
|---|---|---|
| T1 | R1: tab bfcache với RAM cũ | Không mất khoản nào trên mọi máy |
| T2 | R2: máy cũ 95 ngày, thao tác offline | Khoản đã xoá không sống lại |
| T3 | Sự cố gốc A→B→A (v3 doc mục 1.1) | Không mất tuần dữ liệu của B |
| T4 | Server ghi xong, mất response, client retry 3 lần | Đúng 1 bản trong sổ cái |
| T5 | Hai tab cùng đẩy outbox một lúc | Không trùng, không hở `cseq` |
| T6 | Hai máy cùng sang tháng mới | 1 bộ fixed cost, 1 `monthLock` |
| T7 | Máy A xoá, máy B (offline) sửa cùng khoản | Xoá giữ nguyên, B được báo và khôi phục được bằng 1 nút |
| T8 | Hai máy sửa khác field cùng khoản | Giữ cả hai |
| T9 | IndexedDB khôi phục từ bản cũ (cseq lùi) | Phát hiện, đổi deviceId, không op nào bị bỏ |
| T10 | Op `sv` lạ | Dừng áp dụng, khoá push, không ghi gì |
| T11 | DB bị xoá sạch/đổi URL | Dừng, hỏi; không tự đẩy |
| T12 | Chuyển đổi v3 với 2 máy lệch nhau, cả hai lên v4 gần như cùng lúc | Kết quả = merge của cả hai, v3 bị đóng băng |
| T13 | Mọi action của store | `project(apply(before, diff)) == after` |
| T14 | Hoàn tác / quay về thời điểm | Đúng trạng thái, lịch sử sau đó còn nguyên |

Tests miền nghiệp vụ hiện có (`tests/*.test.ts`) chạy nguyên trạng ở chế độ local.

---

## 9. Giới hạn trung thực và lựa chọn backend

1. **Dữ liệu chưa kịp gửi vẫn nằm ở trình duyệt.** Safari có thể dọn storage của web app không cài lên màn hình chính sau 7 ngày không dùng. v4 thu hẹp cửa sổ này xuống vài giây (push 1 s sau thao tác, hiển thị "N thay đổi chưa gửi"), nhưng không web app nào loại bỏ hoàn toàn được.
2. **Token Upstash nằm trong trình duyệt** ⇒ về nguyên tắc ai có token đều xoá được DB. v4 đảm bảo *code của app* không bao giờ xoá; muốn *hạ tầng* cũng cấm xoá thì cần backend riêng (mục 3).
3. **Lựa chọn backend.** Giao thức tách sau interface `LedgerRemote { append, read, length }`:
   - **Upstash (khuyến nghị bước 1)**: giữ nguyên hạ tầng, Docker/nginx tĩnh không đổi, chỉ cần EVAL (v3 đã dùng).
   - **Postgres (Neon) + API serverless (bước 2 tuỳ chọn)**: bảng `ops(seq bigserial, dev, cseq, body jsonb, unique(dev, cseq))`, role của API không có quyền `DELETE/UPDATE`, Neon có point-in-time restore ở tầng hạ tầng. Đổi lại phải thêm API + xác thực + deploy backend. Chuyển từ Upstash sang chỉ là chép sổ cái và thay một module.
4. **Cùng một field sửa đồng thời trên hai máy**: op đến sau thắng; giá trị kia vẫn trong sổ cái và hiện trong nhật ký.

---

## 10. Kế hoạch triển khai

| Bước | Nội dung | File chính |
|---|---|---|
| 1 | Lõi thuần: record mapping, op, fold, diff, project + test thuộc tính | MỚI `src/ledger/{records,ops,fold,diff}.ts` |
| 2 | Journal IndexedDB (outbox, confirmed, cursor, deviceId) + BroadcastChannel | MỚI `src/ledger/localJournal.ts`; dev dep `fake-indexeddb` cho test |
| 3 | Remote Upstash: Lua APPEND, LLEN, LRANGE; FakeRedis LIST trong harness | MỚI `src/ledger/upstashRemote.ts`, `tests/ledger/harness.ts` |
| 4 | Engine: push/pull/rebase, poll, các gate mục 4.4, trạng thái cho UI | MỚI `src/ledger/engine.ts` |
| 5 | Store: `commit()` thay `set()` cho dữ liệu; templates đi qua sổ cái; bỏ debounce lưu cả tài liệu | SỬA `src/store/useAppStore.ts`, `src/storage/templates.ts`, `src/pages/ExpensesPage.tsx` |
| 6 | Chuyển đổi v3 → v4 + đóng băng v3 | MỚI `src/ledger/migrateV3.ts` |
| 7 | UI: pill trạng thái, Nhật ký thay đổi, Hoàn tác, Quay về thời điểm, Tải sổ cái | SỬA `SyncStatusPill.tsx`, `ImportExportPage.tsx`, `DataSourceProvider.tsx` |
| 8 | Xoá `src/sync/*` (trừ phần `threeWayMerge` dùng cho chuyển đổi), sửa mojibake | |
| 9 | Smoke test trên Upstash thật (EVAL + LIST), sau đó tải lại app trên mọi thiết bị | |

---

## 11. Triển khai thực tế (24/10/2026)

### 11.1 Khác so với đề xuất

| Chỗ | Đề xuất | Thực tế | Lý do |
|---|---|---|---|
| cseq trong `APPEND_LUA` | bỏ qua op đã nhận | **bắt buộc nối tiếp đúng** `last + 1`, lệch ⇒ `{-1, last}`, không ghi gì | Bỏ qua âm thầm sẽ nuốt op của máy trùng danh tính. Client đọc lại sổ cái rồi tự xử lý (mất phản hồi / trùng danh tính / hở cseq). |
| Đọc trạng thái | `LLEN` | `HEAD_LUA`: LLEN + genesis + trạng thái chuyển đổi + cseq cuối của máy, 1 request | Ít request, đủ thông tin để phát hiện đổi/xoá database. |
| Sinh op | action tự sinh op | store giữ nguyên, `appLedger` so trạng thái **trước/sau của cùng một thao tác** trong cùng tab | Không phải sửa ~25 action; diff hai trạng thái liên tiếp là chính xác tuyệt đối. Test `tests/ledger/store.test.ts` kiểm từng action. |
| Genesis khi chuyển đổi | chỉ `put` | `put` + **`del` cho mọi tombstone v3 còn hiệu lực** | Thiếu `del`, máy gia nhập sau còn giữ bản cũ làm mục đã xoá sống lại (đã có test tái hiện). |
| Khoá chuyển đổi | SET NX, hết hạn | SET NX không hết hạn; máy khác chỉ tiếp quản khi khoá > 10 phút **và** chưa có genesis | Không bao giờ có hai bộ genesis chen nhau. |
| Mẫu chi nhanh | — | nằm trong store (`templates`), `src/storage/templates.ts` đọc/ghi qua store | Đồng bộ và hoàn tác như mọi dữ liệu khác. |

Đã xoá: `src/sync/syncEngine.ts`, `appSync.ts`, `localMeta.ts`, `src/storage/backups.ts`, phần ghi snapshot/CAS/ghim của `redisProtocol.ts`. Giữ `merge.ts`, `snapshot.ts` (chỉ dùng một lần khi chuyển đổi) và phần ĐỌC v3/v2.

Sửa kèm: chuỗi tiếng Việt hỏng mã hoá trong `useAppStore.ts` (ghi chú hạn mức chi, dữ liệu demo, thông báo lỗi nhập file); nhập file JSON dùng chung bộ chuẩn hoá (file thiếu `entities` trước đây làm app ném lỗi).

### 11.2 Đã kiểm chứng

- `npx vitest run`: 144 test, gồm R1, R2, sự cố A→B→A, mất phản hồi, hai tab cùng đẩy, sang tháng mới trên hai máy, xoá-vs-sửa, sửa khác field, trùng danh tính, op phiên bản mới, Redis bị xoá, mất mạng + tải lại trang, hoàn tác/quay về, chuyển đổi v3 với hai máy lệch nhau, tombstone v3, store thật qua mọi action + khởi động lại.
- `tests/ledger/redisConformance.test.ts` trên **Redis 7.2.5 thật**: mọi script Lua cho kết quả và nội dung sổ cái giống hệt bản mô phỏng; script CAS của v3 trượt vĩnh viễn sau khi đóng băng.
- E2E trên **Edge thật** (Playwright) + client `@upstash/redis` thật qua REST giả trỏ vào Redis thật, dữ liệu cỡ prod (900 khoản chi, 70 chi phí cố định, ~264 KB): chuyển đổi 1.041 op, hai máy lệch nhau hội tụ đúng, hai tab thấy nhau ngay, mất mạng rồi có lại, không op nào trùng, seq liền mạch. E2E phát hiện và đã sửa: client Redis nạp lỗi lúc mất mạng bị cache vĩnh viễn (v3 cũng mắc).

### 11.2b Kiểm thử trình duyệt nhiều thiết bị (`e2e/sync/`)

27 kịch bản trên Edge thật + Redis thật + proxy chèn lỗi mạng, mỗi kịch bản kiểm 6 bất biến (xem `e2e/sync/README.md`): chuyển đổi v3 với 5 kiểu máy, hai máy tranh nhau chuyển đổi, 3 máy/4 tab thêm-sửa-xoá đan xen, sửa khác field/cùng field, xoá-vs-sửa offline, offline lâu, tab bị đóng băng, bfcache, mất phản hồi 30%, lỗi mạng 20%, đóng tab ngay sau khi nhập, sang tháng mới đồng thời, lệch giờ +1 năm, IndexedDB bị xoá, Redis bị xoá, nhập file, xoá toàn bộ + quay về, hoàn tác chéo máy, 300 khoản dồn, token sai, tab bản cũ, mạng bật/tắt liên tục, stress ngẫu nhiên 300 thao tác (6 seed). Kết quả: 27/27 kịch bản, ~5.900 kiểm tra, 0 lỗi; bản build production thao tác thuần giao diện: 35/35. Bộ test bắt được cả 3 lỗi cài thử (Lua nhận lại lô → trùng op; sửa làm sống lại mục đã xoá; bỏ lệnh xoá).

Sửa thêm trong đợt này: đọc sổ cái chấp nhận replica trả thiếu (nhận phần liền mạch, lần sau lấy nốt); đánh dấu `mf4.legacyConsumed` để khi trình duyệt xoá IndexedDB mà còn `cttm_v1` cũ thì máy bắt đầu như máy mới, không nhập lại dữ liệu lỗi thời.

Đã biết, chấp nhận: hai trường dạng cộng dồn được tính trên máy rồi ghi giá trị tuyệt đối — `useCount` của mẫu chi nhanh (chỉ ảnh hưởng thứ tự gợi ý) và điều chỉnh ngân sách khi áp dụng "gói cứu" — nếu hai máy làm cùng lúc trước khi đồng bộ thì một lần cộng bị thay; giá trị cũ vẫn nằm trong nhật ký.

### 11.3 Deploy lên prod

1. **Trước deploy** (khuyến nghị, không bắt buộc): trên mỗi thiết bị, Dữ liệu → "Tải file sao lưu" — chỉ để yên tâm; quy trình bên dưới không xoá dữ liệu v3 nào.
2. Deploy bản mới (Vercel/Docker như cũ, không có backend mới).
3. Mở app trên **một** thiết bị trước (thiết bị dùng nhiều nhất). Nó sẽ: nhập dữ liệu máy → khoá chuyển đổi → đóng băng v3 → gộp snapshot v3 cuối với thay đổi chưa đồng bộ của máy → ghi genesis. Pill hiện "Đang chuyển dữ liệu lên sổ cái…" rồi "Đã đồng bộ · #N".
4. Mở app trên từng thiết bị còn lại (**tải lại trang** nếu tab đang mở). Mỗi máy tự gộp phần chưa đồng bộ của nó (3 chiều với điểm đồng bộ v3 cuối của chính nó) và chỉ ghi phần khác biệt.
5. Tab bản cũ chưa tải lại sẽ hiện hộp thoại "Redis không còn dữ liệu đồng bộ…" — **đừng chọn gì, chỉ cần tải lại trang**. Bản cũ không thể ghi lên Redis nữa; thứ đã nhập ở tab cũ vẫn nằm trong `cttm_v1` của máy đó và được bản mới nhận vào (khoản chi/danh mục/mẫu mới; không lùi cài đặt).
6. Kiểm tra: Dữ liệu → Nhật ký thay đổi có dòng "Chuyển dữ liệu lên sổ cái" và các dòng "Gộp dữ liệu của một thiết bị…".

### 11.4 Quay lại v3 (nếu cần)

Dữ liệu v3 trên Redis (`mf3:*`) và `cttm_v1` trên mỗi máy không bị sửa/xoá. Để quay lại:
1. Trên một máy v4: Dữ liệu → "Tải file sao lưu" (trạng thái mới nhất, gồm mọi thay đổi sau khi chuyển đổi).
2. Deploy lại build v3; `SET mf3:version <giá trị trong mf4:v3final>` trên Upstash console.
3. Nhập file ở bước 1 trên một máy v3 để đưa thay đổi thời v4 trở lại.

### 11.5 Giới hạn còn lại

- Op chưa kịp gửi chỉ nằm trên máy; app gửi sau ~1 giây và hiện "N thay đổi chưa gửi". Trình duyệt chặn IndexedDB ⇒ chạy bằng bộ nhớ tạm và cảnh báo đỏ.
- Token Upstash vẫn ở trình duyệt: code app không bao giờ xoá sổ cái, nhưng muốn hạ tầng cũng cấm xoá thì cần backend riêng (mục 9).
- Chế độ chỉ lưu trên máy: outbox giữ toàn bộ lịch sử và được phát lại mỗi lần mở app (đo trên máy tính: 30.000 op ≈ 17–42 ms, chiếu ra dữ liệu 3.000 khoản ≈ 4–8 ms; điện thoại có thể chậm hơn vài lần); chưa có nén lịch sử.
