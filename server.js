const express = require('express');
const cors = require('cors');
const path = require('path');
const { ketNoiDb } = require('./cau-hinh/ket-noi-db');
const sepayConfig = require('./cau-hinh/sepay');

// Import các controller
const { dangKy, dangNhap } = require('./dieu-khien/authController');
const { layDanhSachSanPham, themSanPham, suaSanPham, xoaSanPham } = require('./dieu-khien/sanPhamController');
const { layDanhSachThueMay, themThueMay, suaThueMay, xoaThueMay } = require('./dieu-khien/thueMayController');
const { layDanhSachSuKien, themSuKien, suaSuKien, xoaSuKien } = require('./dieu-khien/suKienController');
const { dangKySuKien, layDanhSachDangKy, xoaDangKySuKien } = require('./dieu-khien/dangKySuKienController');
const { layTinNhan, guiTinNhan, adminPing, trangThaiAdmin, adminOffline } = require('./dieu-khien/tuVanController');
const { nhanWebhookSePay, xemLogWebhookSePay } = require('./dieu-khien/sepayController');
const {
    donDepDonQuaHan10Phut,
    layGioHang,
    themSanPhamVaoGio,
    capNhatSanPhamGio,
    xoaSanPhamGio,
    datMuaSanPham,
    layLichDaDatMay,
    themThueMayVaoGio,
    capNhatThueMayGio,
    xoaThueMayGio,
    xacNhanThueMay,
    layTatCaDonHangAdmin,
    capNhatTrangThaiDonSP,
    capNhatTrangThaiDonMay
} = require('./dieu-khien/gioHangController');
const { layThongKeTongHop } = require('./dieu-khien/thongKeController');
const {
    layHoSoNongDan,
    capNhatHoSoNongDan,
    doiMatKhauNongDan,
    layDanhSachNongDanAdmin,
    adminCapNhatNongDan,
    adminDatLaiMatKhau,
    adminXoaNongDan
} = require('./dieu-khien/nongDanController');

const app = express();
const PORT = process.env.PORT || sepayConfig.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ trang chủ và tự động chuyển hướng sang mobile khi truy cập bằng điện thoại
app.get('/', (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    if (isMobile) {
        return res.sendFile(path.join(__dirname, 'giao-dien', 'mobile.html'));
    }
    res.sendFile(path.join(__dirname, 'giao-dien', 'trang-chu.html'));
});
app.get('/mobile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'giao-dien', 'mobile.html'));
});
app.use(express.static(path.join(__dirname, 'giao-dien')));
app.use(express.static(path.join(__dirname)));

// API Đăng ký / Đăng nhập
app.post('/api/dang-ky', dangKy);
app.post('/api/dang-nhap', dangNhap);

// API Hồ sơ cá nhân & Đổi mật khẩu của Nông dân
app.get('/api/nong-dan/ho-so/:sdt', layHoSoNongDan);
app.put('/api/nong-dan/ho-so', capNhatHoSoNongDan);
app.put('/api/nong-dan/doi-mat-khau', doiMatKhauNongDan);

// API Sản phẩm
app.get('/api/san-pham', layDanhSachSanPham);
app.post('/api/them-san-pham', themSanPham);
app.put('/api/sua-san-pham', suaSanPham);
app.delete('/api/xoa-san-pham/:id', xoaSanPham);

// API Thuê Máy
app.get('/api/thue-may', layDanhSachThueMay);
app.get('/api/thue-may/:maMay/lich-da-dat', layLichDaDatMay);
app.post('/api/them-thue-may', themThueMay);
app.put('/api/sua-thue-may', suaThueMay);
app.delete('/api/xoa-thue-may/:id', xoaThueMay);

// API Sự Kiện
app.get('/api/su-kien', layDanhSachSuKien);
app.post('/api/them-su-kien', themSuKien);
app.put('/api/sua-su-kien', suaSuKien);
app.delete('/api/xoa-su-kien/:id', xoaSuKien);

// API Đăng Ký Sự Kiện
app.post('/api/dang-ky-su-kien', dangKySuKien);
app.get('/api/danh-sach-dang-ky', layDanhSachDangKy);
app.delete('/api/dang-ky-su-kien/:id', xoaDangKySuKien);

// API SePay Webhook nhận biến động số dư VietinBank
app.post('/api/payment/webhook', nhanWebhookSePay);
app.get('/api/payment/webhook-log', xemLogWebhookSePay);

// API Giỏ Hàng Riêng Của Từng Nông Dân
app.get('/api/gio-hang/:sdt', layGioHang);
app.post('/api/gio-hang/san-pham', themSanPhamVaoGio);
app.put('/api/gio-hang/san-pham', capNhatSanPhamGio);
app.delete('/api/gio-hang/san-pham/:id', xoaSanPhamGio);
app.post('/api/gio-hang/san-pham/dat-mua', datMuaSanPham);

app.post('/api/gio-hang/thue-may', themThueMayVaoGio);
app.put('/api/gio-hang/thue-may', capNhatThueMayGio);
app.delete('/api/gio-hang/thue-may/:id', xoaThueMayGio);
app.post('/api/gio-hang/thue-may/xac-nhan', xacNhanThueMay);

// API Admin Quản Lý Đơn Hàng & Thuê Máy Của Nông Dân
app.get('/api/admin/don-hang', layTatCaDonHangAdmin);
app.put('/api/admin/don-hang/san-pham', capNhatTrangThaiDonSP);
app.put('/api/admin/don-hang/thue-may', capNhatTrangThaiDonMay);

// API Admin Quản Lý Tài Khoản Nông Dân
app.get('/api/admin/nong-dan', layDanhSachNongDanAdmin);
app.put('/api/admin/nong-dan/cap-nhat', adminCapNhatNongDan);
app.put('/api/admin/nong-dan/dat-lai-mat-khau', adminDatLaiMatKhau);
app.delete('/api/admin/nong-dan/:sdt', adminXoaNongDan);

// API Admin Thống Kê Trang Chủ (Ngày / Tháng / Năm)
app.get('/api/admin/thong-ke', layThongKeTongHop);

// API Tư Vấn & Chat Trực Tuyến
app.get('/api/tin-nhan', layTinNhan);
app.post('/api/tin-nhan', guiTinNhan);

// API trạng thái admin online
app.post('/api/admin-ping', adminPing);
app.get('/api/admin-trang-thai', trangThaiAdmin);
app.post('/api/admin-offline', adminOffline);

// Hàm khởi động server
async function startServer() {
    try {
        await ketNoiDb();
        console.log('✅ Kết nối SQL Server (LuaVangDB) thành công!');

        await donDepDonQuaHan10Phut();
        setInterval(() => {
            donDepDonQuaHan10Phut();
        }, 15000);
    } catch (err) {
        console.error('❌ Lỗi kết nối SQL Server:', err.message);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Lúa Vàng API đang chạy tại http://localhost:${PORT}`);
        console.log(`🔗 Webhook SePay sẵn sàng tại: ${sepayConfig.WEBHOOK_URL}`);
    });
}

startServer();