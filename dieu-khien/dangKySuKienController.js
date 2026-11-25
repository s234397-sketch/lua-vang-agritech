const { ketNoiDb } = require('../cau-hinh/ket-noi-db');

// 1. Lưu thông tin nông dân đăng ký tham gia sự kiện
const dangKySuKien = async (req, res) => {
    try {
        const { tieuDeSuKien, hoTen, soDienThoai } = req.body;
        let pool = await ketNoiDb();
        await pool.request()
            .input('tieuDeSuKien', tieuDeSuKien)
            .input('hoTen', hoTen || 'Nông dân')
            .input('soDienThoai', soDienThoai || 'Chưa cập nhật')
            .query(`INSERT INTO DangKySuKien (TieuDeSuKien, HoTen, SoDienThoai) 
                    VALUES (@tieuDeSuKien, @hoTen, @soDienThoai)`);
        res.json({ success: true, message: 'Đăng ký tham gia thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 2. Lấy danh sách đại biểu đã đăng ký cho Admin xem
const layDanhSachDangKy = async (req, res) => {
    try {
        let pool = await ketNoiDb();
        let result = await pool.request().query('SELECT * FROM DangKySuKien ORDER BY MaDK DESC');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 3. Xóa nông dân ra khỏi danh sách đăng ký sự kiện theo MaDK
const xoaDangKySuKien = async (req, res) => {
    try {
        const { id } = req.params;
        let pool = await ketNoiDb();
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