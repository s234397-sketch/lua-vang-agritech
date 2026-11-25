const { ketNoiDb } = require('../cau-hinh/ket-noi-db');

// 1. Lấy danh sách sự kiện
const layDanhSachSuKien = async (req, res) => {
    try {
        let pool = await ketNoiDb();
        let result = await pool.request().query('SELECT * FROM SuKien ORDER BY MaSuKien DESC');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 2. Thêm sự kiện mới
const themSuKien = async (req, res) => {
    try {
        const { tieuDe, thoiGian, diaDiem, moTa } = req.body;
        let pool = await ketNoiDb();
        await pool.request()
            .input('tieuDe', tieuDe)
            .input('thoiGian', thoiGian)
            .input('diaDiem', diaDiem)
            .input('moTa', moTa || '')
            .query(`INSERT INTO SuKien (TieuDe, ThoiGian, DiaDiem, MoTa) 
                    VALUES (@tieuDe, @thoiGian, @diaDiem, @moTa)`);
        res.json({ success: true, message: 'Tạo sự kiện mới thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 3. Chỉnh sửa sự kiện
const suaSuKien = async (req, res) => {
    try {
        const { maSuKien, tieuDe, thoiGian, diaDiem, moTa } = req.body;
        let pool = await ketNoiDb();
        await pool.request()
            .input('maSuKien', maSuKien)
            .input('tieuDe', tieuDe)
            .input('thoiGian', thoiGian)
            .input('diaDiem', diaDiem)
            .input('moTa', moTa || '')
            .query(`UPDATE SuKien SET TieuDe=@tieuDe, ThoiGian=@thoiGian, 
                    DiaDiem=@diaDiem, MoTa=@moTa 
                    WHERE MaSuKien=@maSuKien`);
        res.json({ success: true, message: 'Cập nhật sự kiện thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 4. Xóa sự kiện
const xoaSuKien = async (req, res) => {
    try {
        const { id } = req.params;
        let pool = await ketNoiDb();
        await pool.request()
            .input('id', id)
            .query('DELETE FROM SuKien WHERE MaSuKien = @id');
        res.json({ success: true, message: 'Đã xóa sự kiện thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    layDanhSachSuKien,
    themSuKien,
    suaSuKien,
    xoaSuKien
};