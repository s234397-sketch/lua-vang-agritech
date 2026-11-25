const { ketNoiDb } = require('../cau-hinh/ket-noi-db');

const dangKySuKien = async (req, res) => {
    try {
        const { maSuKien, tieuDeSuKien, hoTen, soDienThoai, diaChi } = req.body;
        const cleanPhone = String(soDienThoai || '').trim();
        const cleanName = String(hoTen || '').trim() || 'Nông dân';
        const cleanAddress = String(diaChi || '').trim();

        if (!cleanPhone) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập số điện thoại đăng ký!'
            });
        }

        const pool = await ketNoiDb();

        let title = String(tieuDeSuKien || '').trim();
        if (!title && maSuKien) {
            const evRes = await pool.request()
                .input('maSuKien', maSuKien)
                .query('SELECT TOP 1 TieuDe FROM SuKien WHERE MaSuKien = @maSuKien');
            if (evRes.recordset && evRes.recordset[0] && evRes.recordset[0].TieuDe) {
                title = String(evRes.recordset[0].TieuDe).trim();
            }
        }

        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin sự kiện cần đăng ký!'
            });
        }

        const dupRes = await pool.request()
            .input('tieuDeSuKien', title)
            .input('soDienThoai', cleanPhone)
            .query(`SELECT TOP 1 MaDK FROM DangKySuKien
                    WHERE TieuDeSuKien = @tieuDeSuKien AND SoDienThoai = @soDienThoai`);

        if (dupRes.recordset && dupRes.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Số điện thoại này đã đăng ký tham gia sự kiện này rồi!'
            });
        }

        await pool.request()
            .input('tieuDeSuKien', title)
            .input('hoTen', cleanName)
            .input('soDienThoai', cleanPhone)
            .input('diaChi', cleanAddress)
            .query(`INSERT INTO DangKySuKien (TieuDeSuKien, HoTen, SoDienThoai)
                    VALUES (@tieuDeSuKien, @hoTen, @soDienThoai)`);

        res.json({ success: true, message: 'Đăng ký tham gia sự kiện thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu đăng ký sự kiện', error: err.message });
    }
};

const layDanhSachDangKy = async (req, res) => {
    try {
        const pool = await ketNoiDb();
        const result = await pool.request().query('SELECT * FROM DangKySuKien ORDER BY MaDK DESC');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const xoaDangKySuKien = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await ketNoiDb();
        await pool.request()
            .input('id', id)
            .query('DELETE FROM DangKySuKien WHERE MaDK = @id');
        res.json({ success: true, message: 'Xóa nông dân khỏi sự kiện thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    dangKySuKien,
    layDanhSachDangKy,
    xoaDangKySuKien
};