# Chi Tiêu Thông Minh

Ứng dụng quản lý chi tiêu cá nhân (React) chạy **hoàn toàn trên trình duyệt** (không backend), lưu dữ liệu vào **LocalStorage** theo schema **normalized + indexes** để truy vấn nhanh.

## Chạy dự án

Yêu cầu: Node.js 20+.

```bash
npm install
npm run dev
```

Mở `http://localhost:5173`.

Build production:
docker ps
docker stop heuristic_bell
docker rm heuristic_bell

docker build --no-cache --pull -t myfinance:prod .
docker run --rm -p 8001:80 --name myfinance_prod myfinance:prod
```bash
npm run build
npm run preview
```
## Docker (production)
Build image:
```bash
docker build -t myfinance:prod .
```

Clean build (no cache):
```bash
docker build --no-cache --pull -t myfinance:prod .
docker build --no-cache -t myfinance:prod .
```

Run:
```bash
docker run --rm -p 8080:80 myfinance:prod
```

Open http://localhost:8080.


## Điều hướng (7 trang)
1) Tổng quan  
2) Ghi chi tiêu  
3) Ngân sách  
4) Tư vấn mua sắm  
5) Báo cáo  
6) Cài đặt  
7) Xuất / Nhập dữ liệu  

## LocalStorage schema (cttm_v1)

Key duy nhất: `cttm_v1`

Nguyên tắc:
- Tiền lưu **số nguyên VND** (không dùng float).
- Ngày lưu `YYYY-MM-DD` (local timezone).
- Có `schemaVersion`, `updatedAt`, `migrations`.
- Dữ liệu **normalized** trong `entities.*` và **indexes** để truy vấn O(k) theo ngày/tháng.

### Dạng dữ liệu chính (tóm tắt)
- `settings`: thu nhập, quy tắc ngân sách, quỹ khẩn cấp, trả nợ, payday…
- `entities.expenses`: `byId` + `allIds`
- `entities.fixedCosts`: chi phí cố định (tự tính vào Needs)
- `entities.purchasePlans`: lưu các kế hoạch mua (tùy chọn)
- `indexes`:
  - `expensesByDate[YYYY-MM-DD] -> [expenseIds]`
  - `expensesByMonth[YYYY-MM] -> [expenseIds]`
  - `expensesByCategoryMonth[YYYY-MM|Category] -> [expenseIds]`
  - `expensesByBucketMonth[YYYY-MM|needs|wants] -> [expenseIds]`
- `budgetAdjustmentsByMonth[YYYY-MM]`: điều chỉnh ngân sách trong tháng (reallocate / giảm tiết kiệm…)
- `capsByMonth[YYYY-MM]`: cap/ngày và đóng băng Wants (nếu có)

### Rebuild indexes
Trang **Xuất / Nhập dữ liệu** có nút **Rebuild indexes** để khôi phục index khi import/không đồng bộ.

## Công thức & logic tài chính (deterministic)

Các hàm thuần (pure functions) nằm tại:
- `src/domain/finance/finance.ts`: ngân sách, tỉ lệ, quỹ khẩn cấp, MSS…
- `src/domain/finance/advisor.ts`: Purchase Advisor (nên mua/cân nhắc/không nên)
- `src/domain/finance/rescue.ts`: Overspending rescue + Forced Purchase Rescue Engine

### Ngân sách theo quy tắc
Với thu nhập `I`:
- `NeedsBudget = I * needsPct`
- `WantsBudget = I * wantsPct`
- `SavingsBudget = I * savingsPct`

Chi phí cố định thuộc **Needs** tự động.

### Quỹ khẩn cấp
- `N = F + E`
  - `F`: tổng chi phí cố định/tháng
  - `E`: baseline thiết yếu biến đổi (user nhập hoặc dùng từ lịch sử)
- `EmergencyFundTarget = N * targetMonths`
- `EmergencyCoverageMonths = EmergencyFundCurrent / N`

### MSS (Minimum Safety Savings)
- `MSS = max(0.05 * I, 300000)`

### Overspending alert (CRITICAL)
Khi thêm chi tiêu, app tính ngay:
- `PlannedDailyBudget = MonthlyBudget / DaysInMonth`
- `PlannedMonthToDate = PlannedDailyBudget * dayOfMonth`
- `Overspend = ActualMonthToDate - PlannedMonthToDate`
- Dự báo nếu giữ nhịp hiện tại: `projectedOvershoot`

Sau đó hiển thị **Overspending Modal** với >= 3 phương án phục hồi (có số liệu + tác động). Nút **Áp dụng phương án** sẽ tự động đặt `capsByMonth` và/hoặc `budgetAdjustmentsByMonth`.

### Forced Purchase Rescue (CRITICAL)
Trong **chế độ Bắt buộc mua**, app sinh kế hoạch cứu nguy (>= 4 phương án) kèm:
- `Deficit` + `Severity`
- Các phương án A–E: cắt Wants, reallocate, giảm tiết kiệm (bounded), tăng thu nhập an toàn, mô phỏng trả góp (cảnh báo).

## TailwindCSS + shadcn/ui
Dự án đã được cấu hình sẵn:
- Tailwind: `tailwind.config.ts`, `postcss.config.cjs`, `src/index.css`
- shadcn/ui components: `src/components/ui/*`, config: `components.json`

Nếu bạn muốn tự dựng lại từ đầu (tham khảo):
```bash
# Tailwind
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# shadcn/ui
npx shadcn@latest init
```

