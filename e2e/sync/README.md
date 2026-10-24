# E2E đồng bộ đa thiết bị (trình duyệt thật)

Kiểm thử sổ cái v4 trên **Microsoft Edge thật** (Playwright), client `@upstash/redis` thật, Lua chạy trên **Redis thật**. Mỗi "thiết bị" là một profile trình duyệt riêng (localStorage + IndexedDB tách biệt); nhiều tab trong một profile dùng chung IndexedDB như thật.

Giữa app và Redis có một proxy REST giả lập Upstash (`lib.mjs`) có thể **chèn lỗi mạng**: cắt kết nối trước khi lệnh tới Redis, cắt phản hồi SAU khi Redis đã ghi, trễ ngẫu nhiên.

## Chạy

Cần: Edge, một `redis-server` để thử (test sẽ `FLUSHDB` — **không dùng Redis đang chứa dữ liệu**).

```bash
# 1. Redis thử, không lưu đĩa (ví dụ bản Windows)
redis-server --port 6399 --save "" --appendonly no
# 2. Dữ liệu mẫu cỡ prod (900 khoản chi, Sync v3 trên Redis + 5 kiểu máy v3)
npx vite-node e2e/sync/seed.ts
# 3. App
npx vite --port 5199 --strictPort --host 127.0.0.1
# 4. 27 kịch bản (thao tác qua store thật của app); có thể truyền tiền tố tên kịch bản để chạy riêng
node e2e/sync/suite.mjs            # hoặc: node e2e/sync/suite.mjs 08 24
STRESS_SEED=99 node e2e/sync/suite.mjs 24
# 5. Bản build production, chỉ thao tác qua giao diện
npm run build && npx vite preview --port 5198 --strictPort --host 127.0.0.1
APP_URL=http://127.0.0.1:5198 node e2e/sync/prod-ui.mjs
```

Biến môi trường: `E2E_REDIS_PORT` (mặc định 6399), `APP_URL` (mặc định `http://127.0.0.1:5199`), `STRESS_SEED`.

## Bất biến kiểm tra sau MỌI kịch bản (`verify` trong `lib.mjs`)

1. Sổ cái: seq liền mạch; id op duy nhất; cseq của mỗi thiết bị liền mạch 1..n (không trùng, không hở).
2. Mọi tab: không còn op chờ, đã ở cuối sổ, dữ liệu **giống từng byte** với bản phát lại sổ cái do bộ test tự viết (độc lập với code app).
3. Giao diện mỗi tab hiển thị đúng sổ cái.
4. IndexedDB mỗi thiết bị: outbox trống, trạng thái đã xác nhận == bản phát lại độc lập.
5. `cttm_v1` của bản cũ không bị ghi.
6. Kỳ vọng nghiệp vụ theo ghi chú đánh dấu: mỗi khoản xuất hiện đúng 1 lần (0 nếu đã xoá), không bao giờ 2.

Bộ test đã được kiểm chứng là bắt được lỗi: cài thử Lua nhận lại lô đã gửi (→ trùng op), sửa làm sống lại mục đã xoá, bỏ qua lệnh xoá — cả ba đều bị phát hiện.
