# DocHub

Hệ thống quản lý, lưu trữ và phân quyền tài liệu đa người dùng (Multi-tenant) tích hợp Google Drive và Supabase.

## Tính năng chính
- Xác thực và phân quyền bằng Supabase Auth & Google OAuth 2.0.
- Kết nối Google Drive cá nhân của từng khách hàng (Bring Your Own Storage - BYOS).
- Cách ly dữ liệu độc lập giữa các khách hàng thông qua Supabase Row Level Security (RLS).
- Quản lý, tải lên và xem trước tài liệu trực tiếp trên giao diện Web.

## Cấu hình môi trường
Sao chép `.env.example` thành `.env` và điền thông tin:
```bash
cp .env.example .env
```
