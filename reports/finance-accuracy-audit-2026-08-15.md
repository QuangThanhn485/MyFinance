# Rà soát độ chính xác tài chính ngày 15/08/2026

Nguồn kiểm tra: `D:\myfinance-backup-2026-08-15.json`, cập nhật lúc `2026-08-15T08:30:44.508Z`.

## Kết luận

- Không phát hiện dữ liệu hỏng, ID trùng, bản ghi mồ côi, index sai, ngày/số tiền không hợp lệ hoặc phân bổ ngân sách lệch tổng.
- Số dư hệ thống tại 15/08 là **27.315.311 ₫**. Hai cách tính độc lập cho cùng một kết quả.
- Các chỉ số tháng 08 hiện tại về quỹ khẩn cấp, phí cố định, ngân sách biến đổi, cap hôm nay và cap ngày kế tiếp đều khớp.
- Đã phát hiện và sửa việc UI gọi nhầm “ngân sách đã dùng” là “tiền đã chi thực tế”.
- Dữ liệu lịch sử trước tháng 07 và một số cấu hình tương lai chưa đủ để xem là sổ dòng tiền chính xác tuyệt đối.

## Số liệu đã xác nhận

| Chỉ số tại 15/08 | Giá trị |
|---|---:|
| Thu nhập tháng | 14.000.000 ₫ |
| Phí cố định kế hoạch | 6.517.900 ₫ |
| Phí cố định đã trả | 6.287.900 ₫ |
| Ngân sách biến đổi E + W | 3.482.100 ₫ |
| Chi biến đổi đã ghi nhận | 1.626.000 ₫ |
| Ngân sách đã dùng (F kế hoạch + E/W đã chi) | 8.143.900 ₫ |
| Dòng tiền thực chi đã ghi nhận (F đã trả + E/W đã chi) | 7.913.900 ₫ |
| Ngân sách biến đổi còn lại | 1.856.100 ₫ |
| Tiết kiệm tháng đang giữ | 4.000.000 ₫ |
| Quỹ khẩn cấp hiện có | 21.229.211 ₫ |
| Phí cố định còn phải trả | 230.000 ₫ |
| Số dư hệ thống | 27.315.311 ₫ |

Đối chiếu dòng tiền: `21.571.211 + 14.000.000 - 342.000 - 6.287.900 - 1.626.000 = 27.315.311 ₫`.

Đối chiếu các ngăn tiền: `21.229.211 + 4.000.000 + 230.000 + 1.856.100 = 27.315.311 ₫`.

## Cap ngày

- Ngày 15/08 đã chi 83.000 ₫.
- Cap toàn ngày 15/08 là 114.064 ₫; còn được chi 31.064 ₫.
- Vì ngày 15/08 đã phát sinh chi, ngày này được xem là đã chốt. Cap từ 16/08 là 116.006 ₫ cho 16 ngày còn lại.
- UI của Daily Cap Planner đã được sửa để không gọi 116.006 ₫ là “Cap hôm nay”.

## Dự báo

- Dự báo tiết kiệm cuối tháng tại thời điểm backup là **4.074.578 ₫**, không phải số dư tạm thời 5.856.100 ₫.
- Dự báo dùng lịch sử, nhịp tháng hiện tại, 7 ngày gần nhất, xu hướng có trọng số, hiệu ứng thứ trong tuần, cap đang áp dụng và số ngày còn lại.
- Đây là ước lượng từ dữ liệu đã ghi nhận. Khoản chi không nhập vào app chỉ được phản ánh sau khi đối soát số dư.

## Vấn đề dữ liệu còn lại

1. Tháng 01-06 đã khóa nhưng toàn bộ `Số tiền đã chi` của phí cố định bằng 0. Đây là dữ liệu cũ trước khi có tính năng theo dõi thanh toán, nên không thể dựng lại dòng tiền lịch sử chính xác tuyệt đối.
2. Hai lần đối soát cũ của tháng 07 và 08 không có snapshot công thức. App hiện không dùng lại đối soát cũ nếu phí cố định đã thay đổi sau lần lưu.
3. Số dư quỹ tự động của tháng 09 đang lưu 30.254.711 ₫, trong khi tính lại từ dữ liệu tại 15/08 là 27.085.311 ₫. Đây là cấu hình tương lai tạm thời và sẽ thay đổi khi tháng 08 tiếp tục phát sinh chi.
4. Tháng 12 có cấu hình nhưng chưa có phí cố định; tháng 07/2027 là cấu hình rời sau khoảng trống nhiều tháng. Không nên dùng các tháng này để dự báo cho đến khi cấu hình đủ.
5. Có ba khoản chi `1 ₫`: hai khoản ngày 16/05 có ghi “cân bằng” và một khoản “Du lịch” ngày 21/06. Đây có vẻ là bản ghi điều chỉnh/giữ chỗ, không phải dòng tiền thực; tổng lịch sử vì vậy lệch 3 ₫ về mặt kỹ thuật.

## Sửa đổi đã áp dụng

- Dashboard hiển thị `Đã chi thực tế đến nay` bằng phí cố định đã trả + chi biến đổi đã ghi.
- Budgets và Reports gọi đúng số gồm phí cố định kế hoạch là `Đã dùng ngân sách`.
- Reports dùng engine dự báo cho tiết kiệm cuối tháng hiện tại, thống nhất với Dashboard.
- Reports so dự báo cả tháng hiện tại với cả tháng trước, không còn so nửa tháng hiện tại với trọn tháng trước.
- Daily Cap Planner phân biệt cap hôm nay và cap từ ngày kế tiếp.
- Bổ sung bộ kiểm toán chạy lại bằng `npm run audit:data -- <backup.json> <report.md>`.

## Kiểm chứng

- 99/99 test vượt qua.
- Production build vượt qua.
- Kiểm tra trình duyệt desktop 1440 px và mobile 390 px: không tràn ngang, số liệu và nhãn mới hiển thị đúng.
