const { ketNoiDb } = require('../cau-hinh/ket-noi-db');

// API lấy toàn bộ dữ liệu phục vụ thống kê theo Ngày / Tháng / Năm cho Trang chủ Admin
const layThongKeTongHop = async (req, res) => {
    try {
        const pool = await ketNoiDb();

        // Đảm bảo các cột thanh toán tồn tại để tránh lỗi truy vấn trên DB cũ
        await pool.request().query(`
            IF COL_LENGTH('GioHangSanPham', 'MaThanhToan') IS NULL
                ALTER TABLE GioHangSanPham ADD MaThanhToan VARCHAR(50) NULL;
            IF COL_LENGTH('GioHangSanPham', 'TienCoc') IS NULL
                ALTER TABLE GioHangSanPham ADD TienCoc DECIMAL(18, 0) NULL;
            IF COL_LENGTH('GioHangThueMay', 'MaThanhToan') IS NULL
                ALTER TABLE GioHangThueMay ADD MaThanhToan VARCHAR(50) NULL;
            IF COL_LENGTH('GioHangThueMay', 'TienCoc') IS NULL
                ALTER TABLE GioHangThueMay ADD TienCoc DECIMAL(18, 0) NULL;
        `);

        const [resSP, resMay, resSuKien, resDangKySK, resNongDan] = await Promise.all([
            pool.request().query(`
                SELECT gh.MaGH, gh.SoDienThoai, gh.SoLuong, gh.TrangThai,
                       gh.MaThanhToan, ISNULL(gh.TienCoc, 0) AS TienCoc,
                       CONVERT(varchar(19), gh.NgayThem, 126) AS NgayThem,
                       sp.MaSanPham, sp.TenSanPham, sp.DanhMuc, sp.GiaTien, sp.DonViTinh,
                       nd.HoTen
                FROM GioHangSanPham gh
                INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                LEFT JOIN NongDan nd ON gh.SoDienThoai = nd.SoDienThoai
                ORDER BY gh.MaGH DESC
            `),
            pool.request().query(`
                SELECT tm_gh.MaDatMay, tm_gh.SoDienThoai, tm_gh.SoCong,
                       CONVERT(VARCHAR(10), tm_gh.NgayThue, 23) AS NgayThue,
                       tm_gh.KhungGio, tm_gh.GhiChu, tm_gh.TrangThai,
                       tm_gh.MaThanhToan, ISNULL(tm_gh.TienCoc, 0) AS TienCoc,
                       CONVERT(varchar(19), tm_gh.NgayTao, 126) AS NgayTao,
                       tm.MaMay, tm.TenMay, tm.LoaiMay, tm.GiaThue, tm.DonViTinh,
                       nd.HoTen
                FROM GioHangThueMay tm_gh
                INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                LEFT JOIN NongDan nd ON tm_gh.SoDienThoai = nd.SoDienThoai
                ORDER BY tm_gh.MaDatMay DESC
            `),
            pool.request().query(`
                SELECT * FROM SuKien
            `),
            pool.request().query(`
                SELECT dk.MaDK, dk.TieuDeSuKien, dk.HoTen, dk.SoDienThoai,
                       CONVERT(varchar(19), dk.NgayDangKy, 126) AS NgayDangKy
                FROM DangKySuKien dk
                ORDER BY dk.MaDK DESC
            `),
            pool.request().query(`
                SELECT COUNT(*) AS TongNongDan FROM NongDan
            `)
        ]);

        res.json({
            success: true,
            donSanPham: resSP.recordset || [],
            donThueMay: resMay.recordset || [],
            danhSachSuKien: resSuKien.recordset || [],
            dangKySuKien: resDangKySK.recordset || [],
            tongNongDan: resNongDan.recordset[0]?.TongNongDan || 0
        });
    } catch (err) {
        console.error('Lỗi lấy thống kê tổng hợp Admin:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

module.exports = {
    layThongKeTongHop
};