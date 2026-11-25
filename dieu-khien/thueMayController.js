const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');

// Hàm hỗ trợ lấy MaLoaiMay từ bảng LoaiMay (tự thêm nếu chưa có)
async function layHoacTaoMaLoaiMay(pool, tenLoaiMay) {
    const tenClean = String(tenLoaiMay || '').trim();
    if (!tenClean) return null;

    await pool.request().query(`
        IF OBJECT_ID('dbo.LoaiMay', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.LoaiMay (
                MaLoaiMay INT IDENTITY(1,1) PRIMARY KEY,
                TenLoaiMay NVARCHAR(100) NOT NULL UNIQUE,
                MoTa NVARCHAR(255) NULL
            );
        END
        IF COL_LENGTH('dbo.ThueMay', 'MaLoaiMay') IS NULL
            ALTER TABLE dbo.ThueMay ADD MaLoaiMay INT NULL;
    `);

    const checkRes = await pool.request()
        .input('ten', sql.NVarChar, tenClean)
        .query('SELECT MaLoaiMay FROM dbo.LoaiMay WHERE TenLoaiMay = @ten');

    if (checkRes.recordset.length > 0) {
        return checkRes.recordset[0].MaLoaiMay;
    }

    const insertRes = await pool.request()
        .input('ten', sql.NVarChar, tenClean)
        .query(`
            INSERT INTO dbo.LoaiMay (TenLoaiMay)
            OUTPUT INSERTED.MaLoaiMay
            VALUES (@ten)
        `);

    return insertRes.recordset[0].MaLoaiMay;
}

// 1. Lấy danh sách thiết bị thuê (JOIN với bảng LoaiMay)
const layDanhSachThueMay = async (req, res) => {
    try {
        let pool = await ketNoiDb();
        let result = await pool.request().query(`
            SELECT tm.*, ISNULL(lm.TenLoaiMay, tm.LoaiMay) AS TenLoaiMayChuan
            FROM ThueMay tm
            LEFT JOIN LoaiMay lm ON tm.MaLoaiMay = lm.MaLoaiMay
            ORDER BY tm.MaMay DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 2. Thêm thiết bị thuê mới (tự động gắn khóa ngoại MaLoaiMay)
const themThueMay = async (req, res) => {
    try {
        const { tenMay, loaiMay, giaThue, donViTinh, hinhAnh, moTa, trangThai } = req.body;
        let pool = await ketNoiDb();
        const maLoaiMay = await layHoacTaoMaLoaiMay(pool, loaiMay);

        await pool.request()
            .input('tenMay', sql.NVarChar, tenMay)
            .input('loaiMay', sql.NVarChar, loaiMay)
            .input('maLoaiMay', sql.Int, maLoaiMay)
            .input('giaThue', sql.Decimal(18, 0), giaThue)
            .input('donViTinh', sql.NVarChar, donViTinh || 'công')
            .input('hinhAnh', sql.NVarChar, hinhAnh || 'default.jpg')
            .input('moTa', sql.NVarChar, moTa || '')
            .input('trangThai', sql.NVarChar, trangThai || 'Sẵn sàng')
            .query(`
                INSERT INTO ThueMay (TenMay, LoaiMay, MaLoaiMay, GiaThue, DonViTinh, HinhAnh, MoTa, TrangThai) 
                VALUES (@tenMay, @loaiMay, @maLoaiMay, @giaThue, @donViTinh, @hinhAnh, @moTa, @trangThai)
            `);
        res.json({ success: true, message: 'Thêm thiết bị thuê thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 3. Chỉnh sửa thiết bị thuê (đồng bộ cả LoaiMay và khóa ngoại MaLoaiMay)
const suaThueMay = async (req, res) => {
    try {
        const { maMay, tenMay, loaiMay, giaThue, donViTinh, hinhAnh, moTa, trangThai } = req.body;
        let pool = await ketNoiDb();
        const maLoaiMay = await layHoacTaoMaLoaiMay(pool, loaiMay);

        await pool.request()
            .input('maMay', sql.Int, maMay)
            .input('tenMay', sql.NVarChar, tenMay)
            .input('loaiMay', sql.NVarChar, loaiMay)
            .input('maLoaiMay', sql.Int, maLoaiMay)
            .input('giaThue', sql.Decimal(18, 0), giaThue)
            .input('donViTinh', sql.NVarChar, donViTinh)
            .input('hinhAnh', sql.NVarChar, hinhAnh)
            .input('moTa', sql.NVarChar, moTa)
            .input('trangThai', sql.NVarChar, trangThai)
            .query(`
                UPDATE ThueMay 
                SET TenMay = @tenMay, LoaiMay = @loaiMay, MaLoaiMay = @maLoaiMay, GiaThue = @giaThue, 
                    DonViTinh = @donViTinh, HinhAnh = @hinhAnh, MoTa = @moTa, TrangThai = @trangThai 
                WHERE MaMay = @maMay
            `);
        res.json({ success: true, message: 'Cập nhật thiết bị thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// 4. Xóa thiết bị thuê
const xoaThueMay = async (req, res) => {
    try {
        const { id } = req.params;
        let pool = await ketNoiDb();
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM ThueMay WHERE MaMay = @id');
        res.json({ success: true, message: 'Đã xóa thiết bị thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = {
    layDanhSachThueMay,
    themThueMay,
    suaThueMay,
    xoaThueMay
};