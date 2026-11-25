const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');
const { taoLinkVietQR } = require('./sepayController');
const sepayConfig = require('../cau-hinh/sepay');

const THOI_GIAN_GIU_DON_GIAY = 600; // 10 phút = 600 giây

// ================= HÀM HỖ TRỢ KIỂM TRA LỊCH THUÊ MÁY =================
function kiemTraTrungKhungGio(gioA, gioB) {
    if (!gioA || !gioB) return false;
    if (gioA === gioB) return true;
    if (gioA.startsWith('Cả ngày') || gioB.startsWith('Cả ngày')) return true;
    return false;
}

function anSoDienThoai(sdt) {
    const s = String(sdt || '').trim();
    if (s.length < 7) return s;
    return s.slice(0, 4) + '***' + s.slice(-3);
}

function rutGonTen(hoTen) {
    const parts = String(hoTen || 'Nông dân').trim().split(/\s+/);
    if (parts.length <= 1) return parts[0];
    const tenCuoi = parts.pop();
    return parts.join(' ') + ' ' + tenCuoi[0] + '.';
}

async function damBaoCotThanhToan(pool) {
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
}

function taoMaThanhToan() {
    const prefix = (sepayConfig.CONTENT_PREFIX || 'SEVQR').trim();
    return `${prefix} LV${Math.floor(100000 + Math.random() * 900000)}`;
}

// ================= TỰ ĐỘNG TRẢ ĐƠN QUÁ HẠN 10 PHÚT VỀ GIỎ HÀNG =================
async function donDepDonQuaHan10Phut(poolParam = null) {
    try {
        const pool = poolParam || await ketNoiDb();
        await damBaoCotThanhToan(pool);

        // 1. Trả các đơn Sản phẩm 'Chờ thanh toán' quá 10 phút về lại 'Trong giỏ'
        const spQuaHan = await pool.request()
            .input('hanGiay', sql.Int, THOI_GIAN_GIU_DON_GIAY)
            .query(`
                SELECT MaGH, SoDienThoai, MaSanPham, SoLuong
                FROM GioHangSanPham
                WHERE TrangThai = N'Chờ thanh toán'
                  AND NgayThem IS NOT NULL
                  AND DATEDIFF(SECOND, NgayThem, GETDATE()) >= @hanGiay
            `);

        for (const item of spQuaHan.recordset) {
            const existRes = await pool.request()
                .input('sdt', sql.VarChar, item.SoDienThoai)
                .input('maSP', sql.Int, item.MaSanPham)
                .input('id', sql.Int, item.MaGH)
                .query(`
                    SELECT MaGH FROM GioHangSanPham
                    WHERE SoDienThoai = @sdt
                      AND MaSanPham = @maSP
                      AND TrangThai = N'Trong giỏ'
                      AND MaGH <> @id
                `);

            if (existRes.recordset.length > 0) {
                await pool.request()
                    .input('targetId', sql.Int, existRes.recordset[0].MaGH)
                    .input('sl', sql.Int, item.SoLuong)
                    .query('UPDATE GioHangSanPham SET SoLuong = SoLuong + @sl WHERE MaGH = @targetId');

                await pool.request()
                    .input('id', sql.Int, item.MaGH)
                    .query('DELETE FROM GioHangSanPham WHERE MaGH = @id');
            } else {
                await pool.request()
                    .input('id', sql.Int, item.MaGH)
                    .query(`
                        UPDATE GioHangSanPham
                        SET TrangThai = N'Trong giỏ',
                            MaThanhToan = NULL,
                            TienCoc = NULL,
                            NgayThem = GETDATE()
                        WHERE MaGH = @id
                    `);
            }
        }

        // 2. Trả các lịch Thuê máy 'Chờ thanh toán' quá 10 phút về 'Chờ xác nhận' -> Mở lại khung giờ trống
        const mayQuaHan = await pool.request()
            .input('hanGiay', sql.Int, THOI_GIAN_GIU_DON_GIAY)
            .query(`
                UPDATE GioHangThueMay
                SET TrangThai = N'Chờ xác nhận',
                    MaThanhToan = NULL,
                    TienCoc = NULL,
                    NgayTao = GETDATE()
                OUTPUT INSERTED.MaDatMay
                WHERE TrangThai = N'Chờ thanh toán'
                  AND NgayTao IS NOT NULL
                  AND DATEDIFF(SECOND, NgayTao, GETDATE()) >= @hanGiay
            `);

        if (spQuaHan.recordset.length > 0 || mayQuaHan.recordset.length > 0) {
            console.log(`⏱️ [Quá hạn 10 phút] Đã trả ${spQuaHan.recordset.length} đơn SP & ${mayQuaHan.recordset.length} lịch thuê máy về giỏ hàng.`);
        }
    } catch (err) {
        console.error('Lỗi tự động trả đơn quá hạn 10 phút:', err.message);
    }
}

async function kiemTraMayDaBiDat(pool, maMay, ngayThue, khungGio, boQuaMaDatMay = null) {
    if (!ngayThue || !khungGio) return null;

    // Dọn dẹp ngay các đơn quá hạn 10 phút trước khi kiểm tra trùng ca
    await donDepDonQuaHan10Phut(pool);

    const req = pool.request()
        .input('maMay', sql.Int, parseInt(maMay))
        .input('ngayThue', sql.NVarChar, String(ngayThue).trim());

    let query = `
        SELECT MaDatMay, KhungGio, TrangThai
        FROM GioHangThueMay
        WHERE MaMay = @maMay
          AND CONVERT(VARCHAR(10), NgayThue, 23) = @ngayThue
          AND TrangThai IN (
              N'Chờ thanh toán',
              N'Đã đặt cọc (30%)',
              N'Đang thuê / Đã đặt lịch',
              N'Đang thực hiện',
              N'Đã thanh toán & Hoàn thành'
          )
    `;

    if (boQuaMaDatMay) {
        req.input('boQuaId', sql.Int, parseInt(boQuaMaDatMay));
        query += ` AND MaDatMay <> @boQuaId`;
    }

    const result = await req.query(query);
    return result.recordset.find(row => kiemTraTrungKhungGio(row.KhungGio, khungGio)) || null;
}

// 1. Lấy toàn bộ 3 mục (Sản phẩm, Thuê máy, Sự kiện) của 1 tài khoản nông dân theo SĐT
const layGioHang = async (req, res) => {
    const { sdt } = req.params;
    if (!sdt) {
        return res.status(400).json({ success: false, message: 'Thiếu số điện thoại tài khoản!' });
    }

    try {
        const pool = await ketNoiDb();
        await donDepDonQuaHan10Phut(pool);

        const [resSanPham, resThueMay, resSuKien] = await Promise.all([
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .input('hanGiay', sql.Int, THOI_GIAN_GIU_DON_GIAY)
                .query(`
                    SELECT gh.MaGH, gh.SoLuong, gh.TrangThai,
                           gh.MaThanhToan, ISNULL(gh.TienCoc, 0) AS TienCoc,
                           CONVERT(varchar(19), gh.NgayThem, 126) AS NgayThem,
                           CASE
                               WHEN gh.TrangThai = N'Chờ thanh toán' AND gh.NgayThem IS NOT NULL
                               THEN IIF(@hanGiay - DATEDIFF(SECOND, gh.NgayThem, GETDATE()) > 0,
                                        @hanGiay - DATEDIFF(SECOND, gh.NgayThem, GETDATE()), 0)
                               ELSE 0
                           END AS GiayConLai,
                           sp.MaSanPham, sp.TenSanPham, sp.DanhMuc, sp.GiaTien, sp.DonViTinh, sp.HinhAnh
                    FROM GioHangSanPham gh
                    INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                    WHERE gh.SoDienThoai = @sdt
                    ORDER BY gh.MaGH DESC
                `),
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .input('hanGiay', sql.Int, THOI_GIAN_GIU_DON_GIAY)
                .query(`
                    SELECT tm_gh.MaDatMay, tm_gh.SoCong,
                           CONVERT(VARCHAR(10), tm_gh.NgayThue, 23) AS NgayThue,
                           tm_gh.KhungGio, tm_gh.GhiChu, tm_gh.TrangThai,
                           tm_gh.MaThanhToan, ISNULL(tm_gh.TienCoc, 0) AS TienCoc,
                           CONVERT(varchar(19), tm_gh.NgayTao, 126) AS NgayTao,
                           CASE
                               WHEN tm_gh.TrangThai = N'Chờ thanh toán' AND tm_gh.NgayTao IS NOT NULL
                               THEN IIF(@hanGiay - DATEDIFF(SECOND, tm_gh.NgayTao, GETDATE()) > 0,
                                        @hanGiay - DATEDIFF(SECOND, tm_gh.NgayTao, GETDATE()), 0)
                               ELSE 0
                           END AS GiayConLai,
                           tm.MaMay, tm.TenMay, tm.LoaiMay, tm.GiaThue, tm.DonViTinh, tm.HinhAnh
                    FROM GioHangThueMay tm_gh
                    INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                    WHERE tm_gh.SoDienThoai = @sdt
                    ORDER BY tm_gh.MaDatMay DESC
                `),
            pool.request()
                .input('sdt', sql.VarChar, sdt)
                .query(`
                    SELECT dk.MaDK, dk.TieuDeSuKien, dk.HoTen, dk.SoDienThoai,
                           CONVERT(varchar(19), dk.NgayDangKy, 126) AS NgayDangKy,
                           sk.ThoiGian, sk.DiaDiem, sk.MoTa
                    FROM DangKySuKien dk
                    LEFT JOIN SuKien sk ON LTRIM(RTRIM(dk.TieuDeSuKien)) = LTRIM(RTRIM(sk.TieuDe))
                    WHERE dk.SoDienThoai = @sdt
                    ORDER BY dk.MaDK DESC
                `)
        ]);

        const tongCocSP = {};
        const tongConLaiSP = {};
        resSanPham.recordset.forEach(item => {
            if (item.MaThanhToan && item.TrangThai !== 'Đã hủy') {
                const thanhTien = Number(item.GiaTien || 0) * Number(item.SoLuong || 0);
                const tienCoc = Number(item.TienCoc || 0);
                const conLai = Math.max(0, thanhTien - tienCoc);

                tongCocSP[item.MaThanhToan] = (tongCocSP[item.MaThanhToan] || 0) + tienCoc;
                tongConLaiSP[item.MaThanhToan] = (tongConLaiSP[item.MaThanhToan] || 0) + conLai;
            }
        });

        const dsSanPham = resSanPham.recordset.map(item => {
            const tongCocDon = item.MaThanhToan ? (tongCocSP[item.MaThanhToan] || 0) : 0;
            const tongConLaiDon = item.MaThanhToan ? (tongConLaiSP[item.MaThanhToan] || 0) : 0;
            const maThanhToanCOD = item.MaThanhToan ? `${item.MaThanhToan} COD` : '';

            return {
                ...item,
                TongCocDon: tongCocDon,
                TongConLaiDon: tongConLaiDon,
                MaThanhToanCOD: maThanhToanCOD,
                QrUrl: (item.MaThanhToan && tongCocDon > 0) ? taoLinkVietQR(tongCocDon, item.MaThanhToan) : '',
                QrUrlCOD: (maThanhToanCOD && tongConLaiDon > 0) ? taoLinkVietQR(tongConLaiDon, maThanhToanCOD) : ''
            };
        });

        const tongCocMay = {};
        const tongConLaiMay = {};
        resThueMay.recordset.forEach(item => {
            if (item.MaThanhToan && item.TrangThai !== 'Đã hủy') {
                const thanhTien = Number(item.GiaThue || 0) * Number(item.SoCong || 0);
                const tienCoc = Number(item.TienCoc || 0);
                const conLai = Math.max(0, thanhTien - tienCoc);

                tongCocMay[item.MaThanhToan] = (tongCocMay[item.MaThanhToan] || 0) + tienCoc;
                tongConLaiMay[item.MaThanhToan] = (tongConLaiMay[item.MaThanhToan] || 0) + conLai;
            }
        });

        const dsThueMay = resThueMay.recordset.map(item => {
            const tongCocDon = item.MaThanhToan ? (tongCocMay[item.MaThanhToan] || 0) : 0;
            const tongConLaiDon = item.MaThanhToan ? (tongConLaiMay[item.MaThanhToan] || 0) : 0;
            const maThanhToanCOD = item.MaThanhToan ? `${item.MaThanhToan} COD` : '';

            return {
                ...item,
                TongCocDon: tongCocDon,
                TongConLaiDon: tongConLaiDon,
                MaThanhToanCOD: maThanhToanCOD,
                QrUrl: (item.MaThanhToan && tongCocDon > 0) ? taoLinkVietQR(tongCocDon, item.MaThanhToan) : '',
                QrUrlCOD: (maThanhToanCOD && tongConLaiDon > 0) ? taoLinkVietQR(tongConLaiDon, maThanhToanCOD) : ''
            };
        });

        res.json({
            success: true,
            sanPham: dsSanPham,
            thueMay: dsThueMay,
            suKien: resSuKien.recordset,
            bankInfo: {
                bankName: 'VietinBank',
                accountNo: sepayConfig.ACCOUNT_NO,
                accountName: sepayConfig.ACCOUNT_NAME
            }
        });
    } catch (err) {
        console.error('Lỗi lấy giỏ hàng:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 2. Thêm sản phẩm vào giỏ hàng HOẶC tạo đơn đặt cọc 30% ngay qua SePay
const themSanPhamVaoGio = async (req, res) => {
    const { soDienThoai, maSanPham, soLuong, trangThai } = req.body;
    if (!soDienThoai || !maSanPham) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin tài khoản hoặc sản phẩm!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);
        const slThem = Math.max(1, parseInt(soLuong) || 1);

        if (trangThai === 'Chờ thanh toán' || trangThai === 'Đã đặt hàng') {
            const spRes = await pool.request()
                .input('maSP', sql.Int, maSanPham)
                .query('SELECT TenSanPham, GiaTien FROM SanPham WHERE MaSanPham = @maSP');

            if (spRes.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm!' });
            }

            const giaTien = Number(spRes.recordset[0].GiaTien || 0);
            const tongTien = giaTien * slThem;
            const tienCoc = Math.round(tongTien * 0.3);
            const maTT = taoMaThanhToan();

            await pool.request()
                .input('sdt', sql.VarChar, soDienThoai)
                .input('maSP', sql.Int, maSanPham)
                .input('sl', sql.Int, slThem)
                .input('mtt', sql.VarChar, maTT)
                .input('tienCoc', sql.Decimal(18, 0), tienCoc)
                .query(`
                    INSERT INTO GioHangSanPham (SoDienThoai, MaSanPham, SoLuong, TrangThai, MaThanhToan, TienCoc, NgayThem)
                    VALUES (@sdt, @maSP, @sl, N'Chờ thanh toán', @mtt, @tienCoc, GETDATE())
                `);

            return res.json({
                success: true,
                message: 'Đã tạo đơn đặt cọc 30%! Vui lòng thanh toán trong 10 phút.',
                maThanhToan: maTT,
                tongTien,
                tienCoc,
                giayConLai: THOI_GIAN_GIU_DON_GIAY,
                qrUrl: taoLinkVietQR(tienCoc, maTT),
                bankInfo: {
                    bankName: 'VietinBank',
                    accountNo: sepayConfig.ACCOUNT_NO,
                    accountName: sepayConfig.ACCOUNT_NAME
                }
            });
        }

        const check = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('maSP', sql.Int, maSanPham)
            .query(`
                SELECT MaGH FROM GioHangSanPham 
                WHERE SoDienThoai = @sdt AND MaSanPham = @maSP AND TrangThai = N'Trong giỏ'
            `);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('maGH', sql.Int, check.recordset[0].MaGH)
                .input('sl', sql.Int, slThem)
                .query('UPDATE GioHangSanPham SET SoLuong = SoLuong + @sl WHERE MaGH = @maGH');
        } else {
            await pool.request()
                .input('sdt', sql.VarChar, soDienThoai)
                .input('maSP', sql.Int, maSanPham)
                .input('sl', sql.Int, slThem)
                .query(`
                    INSERT INTO GioHangSanPham (SoDienThoai, MaSanPham, SoLuong, TrangThai, NgayThem)
                    VALUES (@sdt, @maSP, @sl, N'Trong giỏ', GETDATE())
                `);
        }

        res.json({ success: true, message: 'Đã thêm sản phẩm vào giỏ hàng!' });
    } catch (err) {
        console.error('Lỗi thêm sản phẩm vào giỏ:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 3. Cập nhật số lượng sản phẩm trong giỏ
const capNhatSanPhamGio = async (req, res) => {
    const { maGH, soLuong } = req.body;
    try {
        const pool = await ketNoiDb();
        if (parseInt(soLuong) <= 0) {
            await pool.request()
                .input('id', sql.Int, maGH)
                .query('DELETE FROM GioHangSanPham WHERE MaGH = @id');
        } else {
            await pool.request()
                .input('id', sql.Int, maGH)
                .input('sl', sql.Int, parseInt(soLuong))
                .query('UPDATE GioHangSanPham SET SoLuong = @sl WHERE MaGH = @id');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Xóa sản phẩm khỏi giỏ / đơn hàng
const xoaSanPhamGio = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM GioHangSanPham WHERE MaGH = @id');
        res.json({ success: true, message: 'Đã xóa mục sản phẩm!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Nông dân xác nhận đặt mua các sản phẩm đang trong giỏ -> Tạo QR đặt cọc 30% SePay
const datMuaSanPham = async (req, res) => {
    const { soDienThoai } = req.body;
    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);

        const gioRes = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .query(`
                SELECT gh.MaGH, gh.SoLuong, sp.GiaTien
                FROM GioHangSanPham gh
                INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                WHERE gh.SoDienThoai = @sdt AND gh.TrangThai = N'Trong giỏ'
            `);

        const items = gioRes.recordset;
        if (items.length === 0) {
            return res.json({ success: false, message: 'Không có sản phẩm nào trong giỏ để đặt mua!' });
        }

        const tongTien = items.reduce((sum, x) => sum + Number(x.GiaTien) * Number(x.SoLuong), 0);
        const tongTienCoc = Math.round(tongTien * 0.3);
        const maTT = taoMaThanhToan();

        let daPhanBo = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const thanhTienItem = Number(item.GiaTien) * Number(item.SoLuong);
            const cocItem = (i === items.length - 1)
                ? (tongTienCoc - daPhanBo)
                : Math.round(thanhTienItem * 0.3);
            daPhanBo += cocItem;

            await pool.request()
                .input('maGH', sql.Int, item.MaGH)
                .input('mtt', sql.VarChar, maTT)
                .input('coc', sql.Decimal(18, 0), cocItem)
                .query(`
                    UPDATE GioHangSanPham
                    SET TrangThai = N'Chờ thanh toán',
                        MaThanhToan = @mtt,
                        TienCoc = @coc,
                        NgayThem = GETDATE()
                    WHERE MaGH = @maGH
                `);
        }

        res.json({
            success: true,
            message: 'Đã tạo đơn đặt cọc 30%! Vui lòng thanh toán trong 10 phút.',
            maThanhToan: maTT,
            tongTien,
            tienCoc: tongTienCoc,
            giayConLai: THOI_GIAN_GIU_DON_GIAY,
            qrUrl: taoLinkVietQR(tongTienCoc, maTT),
            bankInfo: {
                bankName: 'VietinBank',
                accountNo: sepayConfig.ACCOUNT_NO,
                accountName: sepayConfig.ACCOUNT_NAME
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. API Lấy lịch đã đặt minh bạch của từng máy (tự mở lại ca quá hạn 10 phút trước khi trả kết quả)
const layLichDaDatMay = async (req, res) => {
    try {
        const maMay = parseInt(req.params.maMay);
        if (!maMay) {
            return res.status(400).json({ success: false, message: 'Thiếu mã máy!' });
        }

        const pool = await ketNoiDb();
        await donDepDonQuaHan10Phut(pool);

        const result = await pool.request()
            .input('maMay', sql.Int, maMay)
            .query(`
                SELECT tm_gh.MaDatMay,
                       CONVERT(VARCHAR(10), tm_gh.NgayThue, 23) AS NgayThue,
                       tm_gh.KhungGio, tm_gh.SoCong, tm_gh.GhiChu, tm_gh.TrangThai,
                       tm_gh.SoDienThoai, nd.HoTen, tm.DonViTinh
                FROM GioHangThueMay tm_gh
                LEFT JOIN NongDan nd ON tm_gh.SoDienThoai = nd.SoDienThoai
                LEFT JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                WHERE tm_gh.MaMay = @maMay
                  AND tm_gh.TrangThai <> N'Đã hủy'
                ORDER BY tm_gh.NgayThue ASC, tm_gh.MaDatMay ASC
            `);

        const lichDaDat = [];
        const lichTrongGio = [];

        result.recordset.forEach(r => {
            if (r.TrangThai === 'Chờ xác nhận') {
                lichTrongGio.push({
                    NgayThue: r.NgayThue,
                    KhungGio: r.KhungGio
                });
            } else {
                lichDaDat.push({
                    MaDatMay: r.MaDatMay,
                    NgayThue: r.NgayThue,
                    KhungGio: r.KhungGio,
                    SoCong: r.SoCong,
                    DonViTinh: r.DonViTinh || 'công',
                    KhuVuc: r.GhiChu || 'Khu vực lân cận',
                    NguoiThue: `${rutGonTen(r.HoTen)} (${anSoDienThoai(r.SoDienThoai)})`,
                    TrangThai: r.TrangThai
                });
            }
        });

        res.json({ success: true, lichDaDat, lichTrongGio });
    } catch (err) {
        console.error('Lỗi lấy lịch đã đặt máy:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 7. Thêm dịch vụ thuê máy vào giỏ HOẶC đặt lịch thuê ngay kèm QR cọc 30% SePay (giữ lịch tối đa 10 phút)
const themThueMayVaoGio = async (req, res) => {
    const { soDienThoai, maMay, soCong, ngayThue, khungGio, ghiChu, trangThai } = req.body;
    if (!soDienThoai || !maMay) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin tài khoản hoặc thiết bị!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);
        const cong = Math.max(1, parseInt(soCong) || 1);
        const ngayStr = String(ngayThue || '').trim();
        const gioStr = String(khungGio || '').trim();

        // Tự động lấy địa chỉ ruộng mặc định của nông dân nếu ghi chú trống
        let ghiChuFinal = String(ghiChu || '').trim();
        if (!ghiChuFinal) {
            const ndRes = await pool.request()
                .input('sdt', sql.VarChar, soDienThoai)
                .query(`
                    IF COL_LENGTH('NongDan', 'DiaChi') IS NOT NULL
                        SELECT DiaChi FROM NongDan WHERE SoDienThoai = @sdt
                    ELSE
                        SELECT N'' AS DiaChi
                `);
            if (ndRes.recordset.length > 0 && ndRes.recordset[0].DiaChi) {
                ghiChuFinal = String(ndRes.recordset[0].DiaChi).trim();
            }
        }

        if (trangThai === 'Chờ thanh toán' || trangThai === 'Đang thuê / Đã đặt lịch') {
            if (!ngayStr || !gioStr) {
                return res.json({ success: false, message: 'Vui lòng chọn đầy đủ Ngày thuê và Khung giờ!' });
            }
            const donTrung = await kiemTraMayDaBiDat(pool, maMay, ngayStr, gioStr);
            if (donTrung) {
                return res.json({
                    success: false,
                    message: `Rất tiếc, khung giờ "${gioStr}" ngày ${ngayStr} vừa có nông dân khác đặt trước. Vui lòng chọn khung giờ trống khác!`
                });
            }

            const mayRes = await pool.request()
                .input('maMay', sql.Int, maMay)
                .query('SELECT TenMay, GiaThue FROM ThueMay WHERE MaMay = @maMay');

            if (mayRes.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị máy!' });
            }

            const giaThue = Number(mayRes.recordset[0].GiaThue || 0);
            const tongTien = giaThue * cong;
            const tienCoc = Math.round(tongTien * 0.3);
            const maTT = taoMaThanhToan();

            await pool.request()
                .input('sdt', sql.VarChar, soDienThoai)
                .input('maMay', sql.Int, maMay)
                .input('cong', sql.Int, cong)
                .input('ngayThue', sql.NVarChar, ngayStr)
                .input('khungGio', sql.NVarChar, gioStr)
                .input('ghiChu', sql.NVarChar, ghiChuFinal)
                .input('mtt', sql.VarChar, maTT)
                .input('tienCoc', sql.Decimal(18, 0), tienCoc)
                .query(`
                    INSERT INTO GioHangThueMay (SoDienThoai, MaMay, SoCong, NgayThue, KhungGio, GhiChu, TrangThai, MaThanhToan, TienCoc, NgayTao)
                    VALUES (@sdt, @maMay, @cong, @ngayThue, @khungGio, @ghiChu, N'Chờ thanh toán', @mtt, @tienCoc, GETDATE())
                `);

            return res.json({
                success: true,
                message: 'Đã giữ lịch thuê máy trong 10 phút! Vui lòng quét mã QR cọc 30%.',
                maThanhToan: maTT,
                tongTien,
                tienCoc,
                giayConLai: THOI_GIAN_GIU_DON_GIAY,
                qrUrl: taoLinkVietQR(tienCoc, maTT),
                bankInfo: {
                    bankName: 'VietinBank',
                    accountNo: sepayConfig.ACCOUNT_NO,
                    accountName: sepayConfig.ACCOUNT_NAME
                }
            });
        }

        const check = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .input('maMay', sql.Int, maMay)
            .input('ngayThue', sql.NVarChar, ngayStr)
            .input('khungGio', sql.NVarChar, gioStr)
            .query(`
                SELECT MaDatMay FROM GioHangThueMay 
                WHERE SoDienThoai = @sdt
                  AND MaMay = @maMay
                  AND ISNULL(CONVERT(VARCHAR(10), NgayThue, 23), '') = @ngayThue
                  AND ISNULL(KhungGio, '') = @khungGio
                  AND TrangThai = N'Chờ xác nhận'
            `);

        if (check.recordset.length > 0) {
            await pool.request()
                .input('id', sql.Int, check.recordset[0].MaDatMay)
                .input('cong', sql.Int, cong)
                .input('ghiChu', sql.NVarChar, ghiChuFinal)
                .query(`
                    UPDATE GioHangThueMay 
                    SET SoCong = SoCong + @cong,
                        GhiChu = CASE WHEN @ghiChu <> '' THEN @ghiChu ELSE GhiChu END
                    WHERE MaDatMay = @id
                `);
        } else {
            await pool.request()
                .input('sdt', sql.VarChar, soDienThoai)
                .input('maMay', sql.Int, maMay)
                .input('cong', sql.Int, cong)
                .input('ngayThue', sql.NVarChar, ngayStr)
                .input('khungGio', sql.NVarChar, gioStr)
                .input('ghiChu', sql.NVarChar, ghiChuFinal)
                .query(`
                    INSERT INTO GioHangThueMay (SoDienThoai, MaMay, SoCong, NgayThue, KhungGio, GhiChu, TrangThai, NgayTao)
                    VALUES (@sdt, @maMay, @cong, @ngayThue, @khungGio, @ghiChu, N'Chờ xác nhận', GETDATE())
                `);
        }

        res.json({ success: true, message: 'Đã thêm dịch vụ thuê máy vào giỏ!' });
    } catch (err) {
        console.error('Lỗi thêm thuê máy:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 8. Cập nhật thông tin thuê máy
const capNhatThueMayGio = async (req, res) => {
    const { maDatMay, soCong, ngayThue, khungGio, ghiChu } = req.body;
    try {
        const pool = await ketNoiDb();
        if (parseInt(soCong) <= 0) {
            await pool.request()
                .input('id', sql.Int, maDatMay)
                .query('DELETE FROM GioHangThueMay WHERE MaDatMay = @id');
        } else {
            await pool.request()
                .input('id', sql.Int, maDatMay)
                .input('cong', sql.Int, parseInt(soCong))
                .input('ngayThue', sql.NVarChar, ngayThue || '')
                .input('khungGio', sql.NVarChar, khungGio || '')
                .input('ghiChu', sql.NVarChar, ghiChu || '')
                .query(`
                    UPDATE GioHangThueMay 
                    SET SoCong = @cong, NgayThue = @ngayThue, KhungGio = @khungGio, GhiChu = @ghiChu 
                    WHERE MaDatMay = @id
                `);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 9. Xóa / Hủy mục thuê máy
const xoaThueMayGio = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM GioHangThueMay WHERE MaDatMay = @id');
        res.json({ success: true, message: 'Đã xóa dịch vụ thuê máy!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 10. Nông dân xác nhận lịch thuê máy từ giỏ -> Khóa khung giờ & tạo QR cọc 30% SePay (giữ 10 phút)
const xacNhanThueMay = async (req, res) => {
    const { soDienThoai } = req.body;
    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);

        const dsCho = await pool.request()
            .input('sdt', sql.VarChar, soDienThoai)
            .query(`
                SELECT tm_gh.MaDatMay, tm_gh.MaMay, tm_gh.SoCong,
                       CONVERT(VARCHAR(10), tm_gh.NgayThue, 23) AS NgayThue,
                       tm_gh.KhungGio, tm.TenMay, tm.GiaThue
                FROM GioHangThueMay tm_gh
                INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                WHERE tm_gh.SoDienThoai = @sdt AND tm_gh.TrangThai = N'Chờ xác nhận'
            `);

        const items = dsCho.recordset;
        if (items.length === 0) {
            return res.json({ success: false, message: 'Không có dịch vụ thuê máy nào trong giỏ để xác nhận!' });
        }

        const danhSachHopLe = [];
        for (const item of items) {
            if (!item.NgayThue || !item.KhungGio) {
                return res.json({
                    success: false,
                    message: `Vui lòng chọn đủ Ngày thuê và Khung giờ cho "${item.TenMay}" trước khi xác nhận!`
                });
            }

            const trungTrongGio = danhSachHopLe.find(
                x => x.MaMay === item.MaMay && x.NgayThue === item.NgayThue && kiemTraTrungKhungGio(x.KhungGio, item.KhungGio)
            );
            if (trungTrongGio) {
                return res.json({
                    success: false,
                    message: `Bạn đang chọn 2 khung giờ trùng nhau cho "${item.TenMay}" vào ngày ${item.NgayThue}. Vui lòng chỉnh lại!`
                });
            }

            const donTrung = await kiemTraMayDaBiDat(pool, item.MaMay, item.NgayThue, item.KhungGio, item.MaDatMay);
            if (donTrung) {
                return res.json({
                    success: false,
                    message: `Máy "${item.TenMay}" khung giờ "${item.KhungGio}" ngày ${item.NgayThue} đã có người đặt trước. Vui lòng đổi khung giờ khác!`
                });
            }

            danhSachHopLe.push(item);
        }

        const tongTien = items.reduce((sum, x) => sum + Number(x.GiaThue) * Number(x.SoCong), 0);
        const tongTienCoc = Math.round(tongTien * 0.3);
        const maTT = taoMaThanhToan();

        let daPhanBo = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const thanhTienItem = Number(item.GiaThue) * Number(item.SoCong);
            const cocItem = (i === items.length - 1)
                ? (tongTienCoc - daPhanBo)
                : Math.round(thanhTienItem * 0.3);
            daPhanBo += cocItem;

            await pool.request()
                .input('id', sql.Int, item.MaDatMay)
                .input('mtt', sql.VarChar, maTT)
                .input('coc', sql.Decimal(18, 0), cocItem)
                .query(`
                    UPDATE GioHangThueMay 
                    SET TrangThai = N'Chờ thanh toán',
                        MaThanhToan = @mtt,
                        TienCoc = @coc,
                        NgayTao = GETDATE()
                    WHERE MaDatMay = @id
                `);
        }

        res.json({
            success: true,
            message: 'Đã giữ khung giờ trong 10 phút! Vui lòng quét mã QR đặt cọc 30%.',
            maThanhToan: maTT,
            tongTien,
            tienCoc: tongTienCoc,
            giayConLai: THOI_GIAN_GIU_DON_GIAY,
            qrUrl: taoLinkVietQR(tongTienCoc, maTT),
            bankInfo: {
                bankName: 'VietinBank',
                accountNo: sepayConfig.ACCOUNT_NO,
                accountName: sepayConfig.ACCOUNT_NAME
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ================= PHẦN DÀNH CHO ADMIN QUẢN LÝ =================

// 11. Admin lấy toàn bộ đơn mua sản phẩm & lịch thuê máy
const layTatCaDonHangAdmin = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        await donDepDonQuaHan10Phut(pool);

        const [resDonSP, resDonMay] = await Promise.all([
            pool.request().query(`
                SELECT gh.MaGH, gh.SoDienThoai, gh.SoLuong, gh.TrangThai,
                       gh.MaThanhToan, ISNULL(gh.TienCoc, 0) AS TienCoc,
                       CONVERT(varchar(19), gh.NgayThem, 126) AS NgayThem,
                       sp.TenSanPham, sp.DanhMuc, sp.GiaTien, sp.DonViTinh,
                       nd.HoTen, nd.DiaChi
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
                       tm.TenMay, tm.LoaiMay, tm.GiaThue, tm.DonViTinh,
                       nd.HoTen, nd.DiaChi
                FROM GioHangThueMay tm_gh
                INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                LEFT JOIN NongDan nd ON tm_gh.SoDienThoai = nd.SoDienThoai
                ORDER BY tm_gh.MaDatMay DESC
            `)
        ]);

        res.json({
            success: true,
            donSanPham: resDonSP.recordset,
            donThueMay: resDonMay.recordset
        });
    } catch (err) {
        console.error('Lỗi lấy danh sách đơn hàng Admin:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// 12. Cập nhật trạng thái đơn sản phẩm
const capNhatTrangThaiDonSP = async (req, res) => {
    const { maGH, trangThai } = req.body;
    if (!maGH || !trangThai) {
        return res.status(400).json({ success: false, message: 'Thiếu mã đơn hoặc trạng thái!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);

        if (trangThai === 'Trong giỏ') {
            const itemRes = await pool.request()
                .input('id', sql.Int, maGH)
                .query(`
                    SELECT MaGH, SoDienThoai, MaSanPham, SoLuong, TrangThai
                    FROM GioHangSanPham
                    WHERE MaGH = @id
                `);

            if (itemRes.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng!' });
            }

            const item = itemRes.recordset[0];
            const choPhepTraGio = ['Chờ thanh toán', 'Đã đặt hàng', 'Đã đặt cọc (30%)'];
            if (!choPhepTraGio.includes(item.TrangThai)) {
                return res.json({
                    success: false,
                    message: `Không thể trả về giỏ vì đơn đang ở trạng thái "${item.TrangThai}"!`
                });
            }

            const existRes = await pool.request()
                .input('sdt', sql.VarChar, item.SoDienThoai)
                .input('maSP', sql.Int, item.MaSanPham)
                .input('id', sql.Int, maGH)
                .query(`
                    SELECT MaGH FROM GioHangSanPham
                    WHERE SoDienThoai = @sdt
                      AND MaSanPham = @maSP
                      AND TrangThai = N'Trong giỏ'
                      AND MaGH <> @id
                `);

            if (existRes.recordset.length > 0) {
                await pool.request()
                    .input('targetId', sql.Int, existRes.recordset[0].MaGH)
                    .input('sl', sql.Int, item.SoLuong)
                    .query('UPDATE GioHangSanPham SET SoLuong = SoLuong + @sl WHERE MaGH = @targetId');

                await pool.request()
                    .input('id', sql.Int, maGH)
                    .query('DELETE FROM GioHangSanPham WHERE MaGH = @id');
            } else {
                await pool.request()
                    .input('id', sql.Int, maGH)
                    .query(`
                        UPDATE GioHangSanPham
                        SET TrangThai = N'Trong giỏ',
                            MaThanhToan = NULL,
                            TienCoc = NULL,
                            NgayThem = GETDATE()
                        WHERE MaGH = @id
                    `);
            }

            return res.json({ success: true, message: 'Đã hủy đơn và trả sản phẩm lại giỏ hàng!' });
        }

        const infoRes = await pool.request()
            .input('id', sql.Int, maGH)
            .query(`
                SELECT gh.MaGH, gh.SoDienThoai, gh.SoLuong, gh.TrangThai AS TrangThaiCu,
                       ISNULL(gh.TienCoc, 0) AS TienCoc,
                       sp.TenSanPham, sp.GiaTien,
                       nd.HoTen
                FROM GioHangSanPham gh
                INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                LEFT JOIN NongDan nd ON gh.SoDienThoai = nd.SoDienThoai
                WHERE gh.MaGH = @id
            `);

        const donInfo = infoRes.recordset[0];

        await pool.request()
            .input('id', sql.Int, maGH)
            .input('trangThai', sql.NVarChar, trangThai)
            .query('UPDATE GioHangSanPham SET TrangThai = @trangThai WHERE MaGH = @id');

        if (trangThai === 'Đang giao hàng' && donInfo && donInfo.TrangThaiCu !== 'Đang giao hàng') {
            try {
                const thanhTien = Number(donInfo.GiaTien || 0) * Number(donInfo.SoLuong || 0);
                const tienCoc = Number(donInfo.TienCoc || 0);
                const conLai = Math.max(0, thanhTien - tienCoc);

                const noiDungTin = conLai > 0
                    ? `📦 [Thông báo giao hàng]: Đơn hàng #SP${donInfo.MaGH} (${donInfo.TenSanPham}) đang được giao đến bạn. Vui lòng chuẩn bị ${conLai.toLocaleString('vi-VN')} đ tiền mặt hoặc mở Giỏ hàng để quét QR thanh toán nốt 70% nhé!`
                    : `📦 [Thông báo giao hàng]: Đơn hàng #SP${donInfo.MaGH} (${donInfo.TenSanPham}) đang được giao đến bạn. Bà con chú ý điện thoại nhận hàng nhé!`;

                await pool.request()
                    .input('hoTen', sql.NVarChar, donInfo.HoTen || 'Nông dân')
                    .input('sdt', sql.VarChar, donInfo.SoDienThoai)
                    .input('noiDung', sql.NVarChar, noiDungTin)
                    .query(`
                        INSERT INTO TinNhanTuVan (NguoiGui, HoTen, SoDienThoai, NoiDung, NgayGui)
                        VALUES ('admin', @hoTen, @sdt, @noiDung, GETDATE())
                    `);
            } catch (chatErr) {
                console.error('Lỗi gửi tin nhắn tự động khi giao hàng:', chatErr.message);
            }
        }

        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn sản phẩm!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 13. Admin / Nông dân cập nhật trạng thái đơn thuê máy
const capNhatTrangThaiDonMay = async (req, res) => {
    const { maDatMay, trangThai } = req.body;
    if (!maDatMay || !trangThai) {
        return res.status(400).json({ success: false, message: 'Thiếu mã phiếu thuê hoặc trạng thái!' });
    }

    try {
        const pool = await ketNoiDb();
        await damBaoCotThanhToan(pool);

        if (trangThai === 'Chờ xác nhận') {
            const phieuRes = await pool.request()
                .input('id', sql.Int, maDatMay)
                .query('SELECT MaDatMay, TrangThai FROM GioHangThueMay WHERE MaDatMay = @id');

            if (phieuRes.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu thuê máy!' });
            }

            const choPhepTraGioMay = ['Chờ thanh toán', 'Đã đặt cọc (30%)', 'Đang thuê / Đã đặt lịch'];
            if (!choPhepTraGioMay.includes(phieuRes.recordset[0].TrangThai)) {
                return res.json({
                    success: false,
                    message: `Không thể trả về giỏ vì lịch thuê đang ở trạng thái "${phieuRes.recordset[0].TrangThai}"!`
                });
            }

            await pool.request()
                .input('id', sql.Int, maDatMay)
                .query(`
                    UPDATE GioHangThueMay
                    SET TrangThai = N'Chờ xác nhận',
                        MaThanhToan = NULL,
                        TienCoc = NULL,
                        NgayTao = GETDATE()
                    WHERE MaDatMay = @id
                `);

            return res.json({ success: true, message: 'Đã hủy lịch và đưa dịch vụ thuê máy trở lại giỏ hàng!' });
        }

        const infoRes = await pool.request()
            .input('id', sql.Int, maDatMay)
            .query(`
                SELECT tm_gh.MaDatMay, tm_gh.MaMay, tm_gh.SoDienThoai, tm_gh.SoCong,
                       CONVERT(VARCHAR(10), tm_gh.NgayThue, 23) AS NgayThue,
                       tm_gh.KhungGio, tm_gh.TrangThai AS TrangThaiCu,
                       ISNULL(tm_gh.TienCoc, 0) AS TienCoc,
                       tm.TenMay, tm.GiaThue,
                       nd.HoTen
                FROM GioHangThueMay tm_gh
                INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                LEFT JOIN NongDan nd ON tm_gh.SoDienThoai = nd.SoDienThoai
                WHERE tm_gh.MaDatMay = @id
            `);

        const phieu = infoRes.recordset[0];
        if (!phieu) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu thuê máy!' });
        }

        if (['Chờ thanh toán', 'Đã đặt cọc (30%)', 'Đang thuê / Đã đặt lịch', 'Đang thực hiện', 'Đã thanh toán & Hoàn thành'].includes(trangThai)) {
            const donTrung = await kiemTraMayDaBiDat(pool, phieu.MaMay, phieu.NgayThue, phieu.KhungGio, maDatMay);
            if (donTrung) {
                return res.json({
                    success: false,
                    message: `Không thể chuyển sang "${trangThai}" vì khung giờ "${phieu.KhungGio}" ngày ${phieu.NgayThue} đã có nông dân khác đặt trước!`
                });
            }
        }

        await pool.request()
            .input('id', sql.Int, maDatMay)
            .input('trangThai', sql.NVarChar, trangThai)
            .query('UPDATE GioHangThueMay SET TrangThai = @trangThai WHERE MaDatMay = @id');

        if (trangThai === 'Đang thực hiện' && phieu.TrangThaiCu !== 'Đang thực hiện') {
            try {
                const thanhTien = Number(phieu.GiaThue || 0) * Number(phieu.SoCong || 0);
                const tienCoc = Number(phieu.TienCoc || 0);
                const conLai = Math.max(0, thanhTien - tienCoc);

                const noiDungTin = conLai > 0
                    ? `🚜 [Thông báo điều máy]: Phiếu thuê #TM${phieu.MaDatMay} (${phieu.TenMay}) đã xuất phát phục vụ đồng ruộng ngày ${phieu.NgayThue} (${phieu.KhungGio}). Phần còn lại ${conLai.toLocaleString('vi-VN')} đ bà con có thể trả tiền mặt hoặc mở Giỏ hàng quét QR trả nốt 70% nhé!`
                    : `🚜 [Thông báo điều máy]: Phiếu thuê #TM${phieu.MaDatMay} (${phieu.TenMay}) đã xuất phát phục vụ đồng ruộng ngày ${phieu.NgayThue} (${phieu.KhungGio}). Bà con chú ý điện thoại phối hợp nhé!`;

                await pool.request()
                    .input('hoTen', sql.NVarChar, phieu.HoTen || 'Nông dân')
                    .input('sdt', sql.VarChar, phieu.SoDienThoai)
                    .input('noiDung', sql.NVarChar, noiDungTin)
                    .query(`
                        INSERT INTO TinNhanTuVan (NguoiGui, HoTen, SoDienThoai, NoiDung, NgayGui)
                        VALUES ('admin', @hoTen, @sdt, @noiDung, GETDATE())
                    `);
            } catch (chatErr) {
                console.error('Lỗi gửi tin nhắn tự động khi điều máy:', chatErr.message);
            }
        }

        res.json({ success: true, message: 'Đã cập nhật trạng thái lịch thuê máy!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
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
};