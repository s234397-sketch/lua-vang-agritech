const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');

async function damBaoCotNongDan(pool) {
    await pool.request().query(`
        IF COL_LENGTH('NongDan', 'DiaChi') IS NULL
            ALTER TABLE NongDan ADD DiaChi NVARCHAR(255) NULL;
    `);
}

// ================= PHẦN DÀNH CHO NÔNG DÂN (HỒ SƠ & ĐỔI MẬT KHẨU) =================

// 1. Lấy thông tin hồ sơ + thống kê hoạt động cá nhân của nông dân
const layHoSoNongDan = async (req, res) => {
    const { sdt } = req.params;
    if (!sdt) {
        return res.status(400).json({ success: false, message: 'Thiếu số điện thoại!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotNongDan(pool);

        const userRes = await pool.request()
            .input('sdt', sql.VarChar, sdt)
            .query(`
                SELECT HoTen, SoDienThoai, ISNULL(DiaChi, N'') AS DiaChi
                FROM NongDan
                WHERE SoDienThoai = @sdt
            `);

        if (userRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nông dân!' });
        }

        const [spRes, mayRes, skRes] = await Promise.all([
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query(`
                    SELECT
                        COUNT(*) AS SoDon,
                        ISNULL(SUM(
                            CASE
                                WHEN gh.TrangThai = N'Đã thanh toán & Hoàn thành' THEN CAST(sp.GiaTien AS DECIMAL(18,0)) * gh.SoLuong
                                WHEN gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang giao hàng') THEN ISNULL(gh.TienCoc, 0)
                                ELSE 0
                            END
                        ), 0) AS DaChiTieu
                    FROM GioHangSanPham gh
                    INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                    WHERE gh.SoDienThoai = @sdt
                      AND gh.TrangThai NOT IN (N'Trong giỏ', N'Đã hủy')
                `),
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query(`
                    SELECT
                        COUNT(*) AS SoLich,
                        ISNULL(SUM(
                            CASE
                                WHEN tm_gh.TrangThai = N'Đã thanh toán & Hoàn thành' THEN CAST(tm.GiaThue AS DECIMAL(18,0)) * tm_gh.SoCong
                                WHEN tm_gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang thuê / Đã đặt lịch', N'Đang thực hiện') THEN ISNULL(tm_gh.TienCoc, 0)
                                ELSE 0
                            END
                        ), 0) AS DaChiTieu
                    FROM GioHangThueMay tm_gh
                    INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                    WHERE tm_gh.SoDienThoai = @sdt
                      AND tm_gh.TrangThai NOT IN (N'Chờ xác nhận', N'Đã hủy')
                `),
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query('SELECT COUNT(*) AS SoSuKien FROM DangKySuKien WHERE SoDienThoai = @sdt')
        ]);

        const soDonSP = Number(spRes.recordset[0]?.SoDon || 0);
        const soLichMay = Number(mayRes.recordset[0]?.SoLich || 0);
        const soSuKien = Number(skRes.recordset[0]?.SoSuKien || 0);
        const tongChiTieu = Number(spRes.recordset[0]?.DaChiTieu || 0) + Number(mayRes.recordset[0]?.DaChiTieu || 0);

        res.json({
            success: true,
            data: userRes.recordset[0],
            thongKe: {
                soDonSP,
                soLichMay,
                soSuKien,
                tongChiTieu
            }
        });
    } catch (err) {
        console.error('Lỗi lấy hồ sơ nông dân:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 2. Nông dân tự cập nhật Họ tên & Địa chỉ ruộng mặc định
const capNhatHoSoNongDan = async (req, res) => {
    const { soDienThoai, hoTen, diaChi } = req.body;
    if (!soDienThoai || !hoTen || !hoTen.trim()) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Họ tên!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotNongDan(pool);

        const hoTenClean = hoTen.trim();
        const diaChiClean = String(diaChi || '').trim();

        const result = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('hoTen', sql.NVarChar, hoTenClean)
            .input('diaChi', sql.NVarChar, diaChiClean)
            .query(`
                UPDATE NongDan
                SET HoTen = @hoTen,
                    DiaChi = @diaChi
                WHERE SoDienThoai = @sdt
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản để cập nhật!' });
        }

        res.json({
            success: true,
            message: 'Đã lưu thông tin hồ sơ & địa chỉ ruộng mặc định!',
            data: {
                soDienThoai,
                hoTen: hoTenClean,
                diaChi: diaChiClean
            }
        });
    } catch (err) {
        console.error('Lỗi cập nhật hồ sơ:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 3. Nông dân tự đổi mật khẩu
const doiMatKhauNongDan = async (req, res) => {
    const { soDienThoai, matKhauCu, matKhauMoi } = req.body;
    if (!soDienThoai || !matKhauCu || !matKhauMoi) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ mật khẩu cũ và mật khẩu mới!' });
    }
    if (String(matKhauMoi).length < 6) {
        return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự!' });
    }

    try {
        const pool = await ketNoiDb();
        const checkRes = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .query('SELECT MatKhau FROM NongDan WHERE SoDienThoai = @sdt');

        if (checkRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản!' });
        }

        const matKhauHienTai = String(checkRes.recordset[0].MatKhau || '');
        if (matKhauHienTai !== String(matKhauCu)) {
            return res.json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
        }

        await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('mkMoi', sql.NVarChar, String(matKhauMoi))
            .query('UPDATE NongDan SET MatKhau = @mkMoi WHERE SoDienThoai = @sdt');

        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) {
        console.error('Lỗi đổi mật khẩu:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// ================= PHẦN DÀNH CHO ADMIN QUẢN LÝ NÔNG DÂN =================

// 4. Lấy danh sách toàn bộ nông dân kèm tổng chi tiêu, số đơn, địa chỉ ruộng
const layDanhSachNongDanAdmin = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        await damBaoCotNongDan(pool);

        const result = await pool.request().query(`
            SELECT
                nd.HoTen,
                nd.SoDienThoai,
                ISNULL(nd.DiaChi, N'') AS DiaChi,
                ISNULL(sp_agg.SoDonSP, 0) AS SoDonSP,
                ISNULL(sp_agg.ChiTieuSP, 0) AS ChiTieuSP,
                ISNULL(sp_agg.GiaTriSP, 0) AS GiaTriSP,
                ISNULL(may_agg.SoLichMay, 0) AS SoLichMay,
                ISNULL(may_agg.ChiTieuMay, 0) AS ChiTieuMay,
                ISNULL(may_agg.GiaTriMay, 0) AS GiaTriMay,
                ISNULL(sk_agg.SoSuKien, 0) AS SoSuKien,
                (ISNULL(sp_agg.ChiTieuSP, 0) + ISNULL(may_agg.ChiTieuMay, 0)) AS TongChiTieu,
                (ISNULL(sp_agg.GiaTriSP, 0) + ISNULL(may_agg.GiaTriMay, 0)) AS TongGiaTriDon
            FROM NongDan nd
            LEFT JOIN (
                SELECT
                    gh.SoDienThoai,
                    COUNT(*) AS SoDonSP,
                    SUM(CAST(sp.GiaTien AS DECIMAL(18,0)) * gh.SoLuong) AS GiaTriSP,
                    SUM(
                        CASE
                            WHEN gh.TrangThai = N'Đã thanh toán & Hoàn thành' THEN CAST(sp.GiaTien AS DECIMAL(18,0)) * gh.SoLuong
                            WHEN gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang giao hàng') THEN ISNULL(gh.TienCoc, 0)
                            ELSE 0
                        END
                    ) AS ChiTieuSP
                FROM GioHangSanPham gh
                INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                WHERE gh.TrangThai NOT IN (N'Trong giỏ', N'Đã hủy')
                GROUP BY gh.SoDienThoai
            ) sp_agg ON nd.SoDienThoai = sp_agg.SoDienThoai
            LEFT JOIN (
                SELECT
                    tm_gh.SoDienThoai,
                    COUNT(*) AS SoLichMay,
                    SUM(CAST(tm.GiaThue AS DECIMAL(18,0)) * tm_gh.SoCong) AS GiaTriMay,
                    SUM(
                        CASE
                            WHEN tm_gh.TrangThai = N'Đã thanh toán & Hoàn thành' THEN CAST(tm.GiaThue AS DECIMAL(18,0)) * tm_gh.SoCong
                            WHEN tm_gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang thuê / Đã đặt lịch', N'Đang thực hiện') THEN ISNULL(tm_gh.TienCoc, 0)
                            ELSE 0
                        END
                    ) AS ChiTieuMay
                FROM GioHangThueMay tm_gh
                INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                WHERE tm_gh.TrangThai NOT IN (N'Chờ xác nhận', N'Đã hủy')
                GROUP BY tm_gh.SoDienThoai
            ) may_agg ON nd.SoDienThoai = may_agg.SoDienThoai
            LEFT JOIN (
                SELECT SoDienThoai, COUNT(*) AS SoSuKien
                FROM DangKySuKien
                GROUP BY SoDienThoai
            ) sk_agg ON nd.SoDienThoai = sk_agg.SoDienThoai
            ORDER BY TongChiTieu DESC, nd.HoTen ASC
        `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Lỗi lấy danh sách nông dân Admin:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 5. Admin cập nhật thông tin nông dân (Họ tên, Địa chỉ ruộng)
const adminCapNhatNongDan = async (req, res) => {
    const { soDienThoai, hoTen, diaChi } = req.body;
    if (!soDienThoai || !hoTen || !hoTen.trim()) {
        return res.status(400).json({ success: false, message: 'Thiếu số điện thoại hoặc họ tên!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotNongDan(pool);

        await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('hoTen', sql.NVarChar, hoTen.trim())
            .input('diaChi', sql.NVarChar, String(diaChi || '').trim())
            .query(`
                UPDATE NongDan
                SET HoTen = @hoTen,
                    DiaChi = @diaChi
                WHERE SoDienThoai = @sdt
            `);

        res.json({ success: true, message: 'Đã cập nhật thông tin thành viên nông dân!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 6. Admin đặt lại mật khẩu khi nông dân quên
const adminDatLaiMatKhau = async (req, res) => {
    const { soDienThoai, matKhauMoi } = req.body;
    if (!soDienThoai || !matKhauMoi || String(matKhauMoi).length < 6) {
        return res.status(400).json({ success: false, message: 'Mật khẩu đặt lại phải từ 6 ký tự trở lên!' });
    }

    try {
        const pool = await ketNoiDb();
        const result = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('mkMoi', sql.NVarChar, String(matKhauMoi))
            .query('UPDATE NongDan SET MatKhau = @mkMoi WHERE SoDienThoai = @sdt');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nông dân!' });
        }

        res.json({ success: true, message: `Đã đặt lại mật khẩu mới cho SĐT ${soDienThoai}!` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 7. Admin xóa tài khoản nông dân
const adminXoaNongDan = async (req, res) => {
    const { sdt } = req.params;
    if (!sdt) {
        return res.status(400).json({ success: false, message: 'Thiếu số điện thoại!' });
    }

    try {
        const pool = await ketNoiDb();
        const [activeSP, activeMay] = await Promise.all([
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query(`
                    SELECT COUNT(*) AS Dem FROM GioHangSanPham
                    WHERE SoDienThoai = @sdt
                      AND TrangThai IN (N'Đã đặt cọc (30%)', N'Đang giao hàng')
                `),
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query(`
                    SELECT COUNT(*) AS Dem FROM GioHangThueMay
                    WHERE SoDienThoai = @sdt
                      AND TrangThai IN (N'Đã đặt cọc (30%)', N'Đang thuê / Đã đặt lịch', N'Đang thực hiện')
                `)
        ]);

        if ((activeSP.recordset[0]?.Dem || 0) > 0 || (activeMay.recordset[0]?.Dem || 0) > 0) {
            return res.json({
                success: false,
                message: 'Tài khoản này đang có đơn hàng đã cọc hoặc lịch thuê máy đang triển khai, không thể xóa!'
            });
        }

        await pool.request().input('sdt', sql.VarChar, sdt).query('DELETE FROM GioHangSanPham WHERE SoDienThoai = @sdt');
        await pool.request().input('sdt', sql.VarChar, sdt).query('DELETE FROM GioHangThueMay WHERE SoDienThoai = @sdt');
        await pool.request().input('sdt', sql.VarChar, sdt).query('DELETE FROM DangKySuKien WHERE SoDienThoai = @sdt');
        await pool.request().input('sdt', sql.VarChar, sdt).query('DELETE FROM NongDan WHERE SoDienThoai = @sdt');

        res.json({ success: true, message: 'Đã xóa tài khoản nông dân khỏi hệ thống!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

module.exports = {
    layHoSoNongDan,
    capNhatHoSoNongDan,
    doiMatKhauNongDan,
    layDanhSachNongDanAdmin,
    adminCapNhatNongDan,
    adminDatLaiMatKhau,
    adminXoaNongDan
};