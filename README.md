# CK Library

Ứng dụng quản lý thư viện dùng Google Sheets làm nơi lưu dữ liệu và Google Apps Script làm backend bảo vệ thao tác quản trị.

## Chức năng

- Quản lý khu vực đặt kệ sách: ID, tên khu vực, ghi chú.
- Quản lý kệ sách: ID, tên kệ, khu vực đặt kệ, ghi chú.
- Quản lý sách: loại sách, chủ đề, tên sách, tác giả, nhà xuất bản, năm, kệ, trạng thái, giá bìa, giá mua, phí mượn, ghi chú.
- Giao diện công khai để xem kho sách và gửi yêu cầu mượn.
- Quản lý người mượn, phiếu mượn, cảnh báo quá hạn.
- Luật mượn: tối đa 5 quyển đang mượn/người, hạn tối đa 7 ngày, chặn người trong danh sách đen.
- Quản lý thu chi: tài trợ, cho thuê, bán sách, nhận đặt cọc, mua sách, sửa sách, hoàn cọc và mục khác.

## Cài đặt Google Apps Script

1. Mở link Apps Script hiện có.
2. Thay nội dung `Code.gs` bằng file `apps-script/Code.gs` trong thư mục này.
3. Vào **Project Settings > Script properties**, thêm:
   - `ADMIN_TOKEN`: mã bí mật do bạn tự đặt.
4. Chạy hàm `setupSheets` một lần để tạo/căn chỉnh các sheet dữ liệu.
5. Deploy lại Web App:
   - Execute as: `Me`
   - Who has access: `Anyone`
6. Nếu URL Web App mới khác URL cũ, cập nhật `CONFIG.apiUrl` trong `assets/app.js`.

## Chạy giao diện

Mở file `index.html` bằng trình duyệt hoặc đưa toàn bộ thư mục này lên GitHub Pages/hosting tĩnh.

Khi bấm **Quản trị**, nhập đúng `ADMIN_TOKEN` để mở các màn hình thêm/sửa/xóa.

## Gợi ý bảo vệ mã nguồn và bản quyền

- Nếu muốn bảo vệ source code thật sự, giữ repository GitHub ở chế độ **Private** và triển khai giao diện qua Apps Script Web App hoặc dịch vụ hosting riêng.
- Nếu dùng GitHub Pages công khai từ repo public, người khác luôn có thể xem HTML/CSS/JS phía trình duyệt. Backend Apps Script vẫn bảo vệ dữ liệu nếu `ADMIN_TOKEN` không bị chia sẻ.
- Thêm file `LICENSE` hoặc thông báo bản quyền riêng để xác lập quyền sở hữu.
- Bật branch protection cho nhánh `main`, tắt quyền push của người khác, bật 2FA cho tài khoản GitHub.

## Cấu trúc dữ liệu trong Google Sheet

- `areas`
- `shelves`
- `books`
- `borrowers`
- `loans`
- `finance`
