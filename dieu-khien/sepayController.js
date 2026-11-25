const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');
const sepayConfig = require('../cau-hinh/sepay');

// Hàm tạo ảnh mã QR VietQR động (tự động gắn tiền tố SEVQR chuẩn VietinBank + SePay)
function taoLinkVietQR(soTien, maThanhToan) {
    const bankId = encodeURIComponent(sepayConfig.BANK_ID);
    const accNo = encodeURIComponent(sepayConfig.ACCOUNT_NO);
    const accName = encodeURIComponent(sepayConfig.ACCOUNT_NAME);

    const prefix = (sepayConfig.CONTENT_PREFIX || 'SEVQR').trim();
    const rawInfo = String(maThanhToan || '').trim();
    const fullInfo = rawInfo.toUpperCase().startsWith(prefix.toUpperCase())
        ? rawInfo
        : `${prefix} ${rawInfo}`;

    const addInfo = encodeURIComponent(fullInfo);
    return `https://img.vietqr.io/image/${bankId}-${accNo}-compact2.png?amount=${soTien}&addInfo=${addInfo}&accountName=${accName}`;
}

// Đảm bảo bảng LichSuGiaoDich và các cột thanh toán tồn tại
async function damBaoCauTrucThanhToan(pool) {
    await pool.request().query(`
        IF OBJECT_ID('dbo.LichSuGiaoDich', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.LichSuGiaoDich (
                MaGD INT IDENTITY(1,1) PRIMARY KEY,
                MaGiaoDichSePay VARCHAR(100) NULL,
                MaThanhToan VARCHAR(50) NULL,
                SoTienNhan DECIMAL(18, 0) NOT NULL DEFAULT 0,
                NoiDungCK NVARCHAR(500) NULL,
                NganHang VARCHAR(50) NOT NULL DEFAULT 'VietinBank',
                ThoiGianGD DATETIME NOT NULL DEFAULT GETDATE(),
                TrangThaiXuLy NVARCHAR(100) NOT NULL DEFAULT N'Đã ghi nhận'
            );
        END

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

// Ghi 1 dòng giao dịch vào bảng LichSuGiaoDich trong SQL Server
async function ghiLichSuGiaoDich(pool, { maGiaoDichSePay, maThanhToan, soTienNhan, noiDungCK, trangThaiXuLy }) {
    try {
        await pool.request()
            .input('maGDSePay', sql.VarChar, String(maGiaoDichSePay || ''))
            .input('maTT', sql.VarChar, String(maThanhToan || ''))
            .input('soTien', sql.Decimal(18, 0), Number(soTienNhan || 0))
            .input('noiDung', sql.NVarChar, String(noiDungCK || ''))
            .input('trangThai', sql.NVarChar, String(trangThaiXuLy || 'Đã ghi nhận'))
            .query(`
                INSERT INTO dbo.LichSuGiaoDich (MaGiaoDichSePay, MaThanhToan, SoTienNhan, NoiDungCK, NganHang, ThoiGianGD, TrangThaiXuLy)
                VALUES (@maGDSePay, @maTT, @soTien, @noiDung, 'VietinBank', GETDATE(), @trangThai)
            `);
    } catch (logErr) {
        console.error('Lỗi ghi bảng LichSuGiaoDich:', logErr.message);
    }
}

// API nhận biến động số dư trực tiếp từ SePay (POST /api/payment/webhook)
const nhanWebhookSePay = async (req, res) => {
    try {
        const body = req.body || {};
        const thoiGian = new Date().toLocaleString('vi-VN');

        console.log('====================================================');
        console.log(`📩 [${thoiGian}] NHẬN WEBHOOK TỪ SEPAY:`);
        console.log(JSON.stringify(body, null, 2));
        console.log('====================================================');

        const pool = await ketNoiDb();
        await damBaoCauTrucThanhToan(pool);

        const maGDSePay = String(body.id || body.referenceCode || body.transaction_id || '');
        const loaiGD = String(body.transferType || '').toLowerCase();
        const soTienVao = parseFloat(body.transferAmount || body.amount_in || 0);
        const noiDungGoc = String(body.content || body.transaction_content || body.code || '');
        const noiDungSach = noiDungGoc.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Chỉ xử lý giao dịch tiền vào tài khoản
        if (loaiGD && loaiGD !== 'in') {
            await ghiLichSuGiaoDich(pool, {
                maGiaoDichSePay: maGDSePay,
                maThanhToan: '',
                soTienNhan: soTienVao,
                noiDungCK: noiDungGoc,
                trangThaiXuLy: 'Bỏ qua (Giao dịch tiền ra)'
            });
            return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch tiền ra' });
        }

        // Tìm mã đơn hàng dạng LVxxxxxx trong nội dung chuyển khoản
        const match = noiDungSach.match(/LV\d{6}/);
        if (!match || soTienVao <= 0) {
            await ghiLichSuGiaoDich(pool, {
                maGiaoDichSePay: maGDSePay,
                maThanhToan: '',
                soTienNhan: soTienVao,
                noiDungCK: noiDungGoc,
                trangThaiXuLy: 'Chưa chứa mã đơn LVxxxxxx'
            });
            return res.status(200).json({
                success: true,
                message: 'Webhook đã kết nối thành công (chưa có mã đơn LVxxxxxx)'
            });
        }

        const maLV = match[0];
        const prefix = (sepayConfig.CONTENT_PREFIX || 'SEVQR').trim();
        const maDayDu = `${prefix} ${maLV}`;
        const isThanhToanCOD = /LV\d{6}COD/.test(noiDungSach);
        const maHienThiLog = isThanhToanCOD ? `${maDayDu} COD` : maDayDu;

        // ================= TRƯỜNG HỢP 1: THANH TOÁN NỐT 70% CÒN LẠI (SEVQR LVxxxxxx COD) =================
        if (isThanhToanCOD) {
            // 1A. Kiểm tra bên đơn Sản phẩm
            const donCodSP = await pool.request()
                .input('maDayDu', sql.VarChar, maDayDu)
                .input('maLV', sql.VarChar, maLV)
                .query(`
                    SELECT gh.MaGH, gh.SoLuong, gh.TrangThai,
                           ISNULL(gh.TienCoc, 0) AS TienCoc,
                           sp.GiaTien
                    FROM GioHangSanPham gh
                    INNER JOIN SanPham sp ON gh.MaSanPham = sp.MaSanPham
                    WHERE (gh.MaThanhToan = @maDayDu OR gh.MaThanhToan = @maLV)
                      AND gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang giao hàng')
                `);

            if (donCodSP.recordset.length > 0) {
                const tongConLaiSP = donCodSP.recordset.reduce((sum, x) => {
                    const thanhTien = Number(x.GiaTien || 0) * Number(x.SoLuong || 0);
                    return sum + Math.max(0, thanhTien - Number(x.TienCoc || 0));
                }, 0);

                if (soTienVao >= tongConLaiSP) {
                    await pool.request()
                        .input('maDayDu', sql.VarChar, maDayDu)
                        .input('maLV', sql.VarChar, maLV)
                        .query(`
                            UPDATE GioHangSanPham
                            SET TrangThai = N'Đã thanh toán & Hoàn thành', NgayThem = GETDATE()
                            WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                              AND TrangThai IN (N'Đã đặt cọc (30%)', N'Đang giao hàng')
                        `);

                    await ghiLichSuGiaoDich(pool, {
                        maGiaoDichSePay: maGDSePay,
                        maThanhToan: maHienThiLog,
                        soTienNhan: soTienVao,
                        noiDungCK: noiDungGoc,
                        trangThaiXuLy: 'Đã thu đủ 100% đơn Sản phẩm'
                    });

                    console.log(`✅ ĐÃ THANH TOÁN ĐỦ 100% ĐƠN SẢN PHẨM ${maHienThiLog} (+${soTienVao.toLocaleString('vi-VN')} đ)`);
                    return res.status(200).json({
                        success: true,
                        message: `Đã hoàn tất thanh toán 100% cho đơn sản phẩm ${maHienThiLog}`
                    });
                }

                await ghiLichSuGiaoDich(pool, {
                    maGiaoDichSePay: maGDSePay,
                    maThanhToan: maHienThiLog,
                    soTienNhan: soTienVao,
                    noiDungCK: noiDungGoc,
                    trangThaiXuLy: `Thiếu tiền COD SP (cần ${tongConLaiSP.toLocaleString('vi-VN')} đ)`
                });
                return res.status(200).json({
                    success: true,
                    message: 'Số tiền chuyển chưa đủ phần còn lại (70%)'
                });
            }

            // 1B. Kiểm tra bên đơn Thuê máy
            const donCodMay = await pool.request()
                .input('maDayDu', sql.VarChar, maDayDu)
                .input('maLV', sql.VarChar, maLV)
                .query(`
                    SELECT tm_gh.MaDatMay, tm_gh.SoCong, tm_gh.TrangThai,
                           ISNULL(tm_gh.TienCoc, 0) AS TienCoc,
                           tm.GiaThue
                    FROM GioHangThueMay tm_gh
                    INNER JOIN ThueMay tm ON tm_gh.MaMay = tm.MaMay
                    WHERE (tm_gh.MaThanhToan = @maDayDu OR tm_gh.MaThanhToan = @maLV)
                      AND tm_gh.TrangThai IN (N'Đã đặt cọc (30%)', N'Đang thực hiện', N'Đang thuê / Đã đặt lịch')
                `);

            if (donCodMay.recordset.length > 0) {
                const tongConLaiMay = donCodMay.recordset.reduce((sum, x) => {
                    const thanhTien = Number(x.GiaThue || 0) * Number(x.SoCong || 0);
                    return sum + Math.max(0, thanhTien - Number(x.TienCoc || 0));
                }, 0);

                if (soTienVao >= tongConLaiMay) {
                    await pool.request()
                        .input('maDayDu', sql.VarChar, maDayDu)
                        .input('maLV', sql.VarChar, maLV)
                        .query(`
                            UPDATE GioHangThueMay
                            SET TrangThai = N'Đã thanh toán & Hoàn thành', NgayTao = GETDATE()
                            WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                              AND TrangThai IN (N'Đã đặt cọc (30%)', N'Đang thực hiện', N'Đang thuê / Đã đặt lịch')
                        `);

                    await ghiLichSuGiaoDich(pool, {
                        maGiaoDichSePay: maGDSePay,
                        maThanhToan: maHienThiLog,
                        soTienNhan: soTienVao,
                        noiDungCK: noiDungGoc,
                        trangThaiXuLy: 'Đã thu đủ 100% lịch Thuê máy'
                    });

                    console.log(`✅ ĐÃ THANH TOÁN ĐỦ 100% LỊCH THUÊ MÁY ${maHienThiLog} (+${soTienVao.toLocaleString('vi-VN')} đ)`);
                    return res.status(200).json({
                        success: true,
                        message: `Đã hoàn tất thanh toán 100% cho lịch thuê máy ${maHienThiLog}`
                    });
                }

                await ghiLichSuGiaoDich(pool, {
                    maGiaoDichSePay: maGDSePay,
                    maThanhToan: maHienThiLog,
                    soTienNhan: soTienVao,
                    noiDungCK: noiDungGoc,
                    trangThaiXuLy: `Thiếu tiền COD Thuê máy (cần ${tongConLaiMay.toLocaleString('vi-VN')} đ)`
                });
                return res.status(200).json({
                    success: true,
                    message: 'Số tiền chuyển chưa đủ phần còn lại (70%)'
                });
            }

            await ghiLichSuGiaoDich(pool, {
                maGiaoDichSePay: maGDSePay,
                maThanhToan: maHienThiLog,
                soTienNhan: soTienVao,
                noiDungCK: noiDungGoc,
                trangThaiXuLy: 'Không tìm thấy đơn chờ thu 70%'
            });
            return res.status(200).json({
                success: true,
                message: `Không tìm thấy đơn chờ thu nốt 70% cho mã ${maHienThiLog}`
            });
        }

        // ================= TRƯỜNG HỢP 2: THANH TOÁN CỌC 30% BAN ĐẦU (SEVQR LVxxxxxx) =================
        // 2A. Kiểm tra bên đơn Sản phẩm
        const donSPRes = await pool.request()
            .input('maDayDu', sql.VarChar, maDayDu)
            .input('maLV', sql.VarChar, maLV)
            .query(`
                SELECT MaGH, TrangThai, ISNULL(TienCoc, 0) AS TienCoc
                FROM GioHangSanPham
                WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                  AND TrangThai = N'Chờ thanh toán'
            `);

        if (donSPRes.recordset.length > 0) {
            const tongTienCocSP = donSPRes.recordset.reduce((sum, x) => sum + Number(x.TienCoc), 0);

            if (soTienVao >= tongTienCocSP) {
                await pool.request()
                    .input('maDayDu', sql.VarChar, maDayDu)
                    .input('maLV', sql.VarChar, maLV)
                    .query(`
                        UPDATE GioHangSanPham
                        SET TrangThai = N'Đã đặt cọc (30%)', NgayThem = GETDATE()
                        WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                          AND TrangThai = N'Chờ thanh toán'
                    `);

                await ghiLichSuGiaoDich(pool, {
                    maGiaoDichSePay: maGDSePay,
                    maThanhToan: maDayDu,
                    soTienNhan: soTienVao,
                    noiDungCK: noiDungGoc,
                    trangThaiXuLy: 'Đã chốt cọc 30% đơn Sản phẩm'
                });

                console.log(`✅ ĐÃ CHỐT CỌC TỰ ĐỘNG ĐƠN SẢN PHẨM ${maDayDu} (+${soTienVao.toLocaleString('vi-VN')} đ)`);
                return res.status(200).json({
                    success: true,
                    message: `Đã xác nhận đặt cọc cho đơn sản phẩm ${maDayDu}`
                });
            }

            await ghiLichSuGiaoDich(pool, {
                maGiaoDichSePay: maGDSePay,
                maThanhToan: maDayDu,
                soTienNhan: soTienVao,
                noiDungCK: noiDungGoc,
                trangThaiXuLy: `Thiếu tiền cọc SP (cần ${tongTienCocSP.toLocaleString('vi-VN')} đ)`
            });
            return res.status(200).json({
                success: true,
                message: 'Số tiền chuyển chưa đủ mức cọc 30%'
            });
        }

        // 2B. Kiểm tra bên đơn Thuê máy
        const donMayRes = await pool.request()
            .input('maDayDu', sql.VarChar, maDayDu)
            .input('maLV', sql.VarChar, maLV)
            .query(`
                SELECT MaDatMay, TrangThai, ISNULL(TienCoc, 0) AS TienCoc
                FROM GioHangThueMay
                WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                  AND TrangThai = N'Chờ thanh toán'
            `);

        if (donMayRes.recordset.length > 0) {
            const tongTienCocMay = donMayRes.recordset.reduce((sum, x) => sum + Number(x.TienCoc), 0);

            if (soTienVao >= tongTienCocMay) {
                await pool.request()
                    .input('maDayDu', sql.VarChar, maDayDu)
                    .input('maLV', sql.VarChar, maLV)
                    .query(`
                        UPDATE GioHangThueMay
                        SET TrangThai = N'Đã đặt cọc (30%)', NgayTao = GETDATE()
                        WHERE (MaThanhToan = @maDayDu OR MaThanhToan = @maLV)
                          AND TrangThai = N'Chờ thanh toán'
                    `);

                await ghiLichSuGiaoDich(pool, {
                    maGiaoDichSePay: maGDSePay,
                    maThanhToan: maDayDu,
                    soTienNhan: soTienVao,
                    noiDungCK: noiDungGoc,
                    trangThaiXuLy: 'Đã chốt cọc 30% lịch Thuê máy'
                });

                console.log(`✅ ĐÃ CHỐT CỌC TỰ ĐỘNG LỊCH THUÊ MÁY ${maDayDu} (+${soTienVao.toLocaleString('vi-VN')} đ)`);
                return res.status(200).json({
                    success: true,
                    message: `Đã xác nhận đặt cọc cho lịch thuê máy ${maDayDu}`
                });
            }

            await ghiLichSuGiaoDich(pool, {
                maGiaoDichSePay: maGDSePay,
                maThanhToan: maDayDu,
                soTienNhan: soTienVao,
                noiDungCK: noiDungGoc,
                trangThaiXuLy: `Thiếu tiền cọc Thuê máy (cần ${tongTienCocMay.toLocaleString('vi-VN')} đ)`
            });
            return res.status(200).json({
                success: true,
                message: 'Số tiền chuyển chưa đủ mức cọc 30%'
            });
        }

        await ghiLichSuGiaoDich(pool, {
            maGiaoDichSePay: maGDSePay,
            maThanhToan: maDayDu,
            soTienNhan: soTienVao,
            noiDungCK: noiDungGoc,
            trangThaiXuLy: 'Không tìm thấy đơn chờ thanh toán'
        });

        return res.status(200).json({
            success: true,
            message: `Không tìm thấy đơn chờ thanh toán cho mã ${maDayDu}`
        });
    } catch (err) {
        console.error('❌ Lỗi xử lý Webhook SePay:', err);
        return res.status(200).json({ success: false, message: err.message });
    }
};

// API xem lịch sử giao dịch từ bảng LichSuGiaoDich trong SQL Server (GET /api/payment/webhook-log)
const xemLogWebhookSePay = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        await damBaoCauTrucThanhToan(pool);

        const result = await pool.request().query(`
            SELECT TOP 50
                MaGD,
                MaGiaoDichSePay,
                MaThanhToan,
                SoTienNhan,
                NoiDungCK,
                NganHang,
                CONVERT(varchar(19), ThoiGianGD, 120) AS ThoiGianGD,
                TrangThaiXuLy
            FROM dbo.LichSuGiaoDich
            ORDER BY MaGD DESC
        `);

        res.json({
            success: true,
            tongSoLanNhan: result.recordset.length,
            danhSach: result.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi lấy lịch sử giao dịch: ' + err.message });
    }
};

module.exports = {
    taoLinkVietQR,
    nhanWebhookSePay,
    xemLogWebhookSePay
};