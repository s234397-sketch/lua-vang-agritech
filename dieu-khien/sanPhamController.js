const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');

// Hàm hỗ trợ lấy MaDanhMuc từ bảng DanhMucSanPham (tự thêm nếu chưa có)
async function layHoacTaoMaDanhMuc(pool, tenDanhMuc) {
    const tenClean = String(tenDanhMuc || '').trim();
    if (!tenClean) return null;

    await pool.request().query(`
        IF OBJECT_ID('dbo.DanhMucSanPham', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.DanhMucSanPham (
                MaDanhMuc INT IDENTITY(1,1) PRIMARY KEY,
                TenDanhMuc NVARCHAR(100) NOT NULL UNIQUE,
                MoTa NVARCHAR(255) NULL
            );
        END
        IF COL_LENGTH('dbo.SanPham', 'MaDanhMuc') IS NULL
            ALTER TABLE dbo.SanPham ADD MaDanhMuc INT NULL;
    `);

    const checkRes = await pool.request()
        .input('ten', sql.NVarChar, tenClean)
        .query('SELECT MaDanhMuc FROM dbo.DanhMucSanPham WHERE TenDanhMuc = @ten');

    if (checkRes.recordset.length > 0) {
        return checkRes.recordset[0].MaDanhMuc;
    }

    const insertRes = await pool.request()
        .input('ten', sql.NVarChar, tenClean)
        .query(`
            INSERT INTO dbo.DanhMucSanPham (TenDanhMuc)
            OUTPUT INSERTED.MaDanhMuc
            VALUES (@ten)
        `);

    return insertRes.recordset[0].MaDanhMuc;
}

// Lấy danh sách sản phẩm từ CSDL (JOIN với bảng DanhMucSanPham)
const layDanhSachSanPham = async (req, res) => {
    try {
        let pool = await ketNoiDb();
        let result = await pool.request().query(`
            SELECT sp.*, ISNULL(dm.TenDanhMuc, sp.DanhMuc) AS TenDanhMucChuan
            FROM SanPham sp
            LEFT JOIN DanhMucSanPham dm ON sp.MaDanhMuc = dm.MaDanhMuc
            ORDER BY sp.MaSanPham DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Lỗi khi lấy danh sách sản phẩm:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// Thêm sản phẩm mới vào CSDL (tự động gắn khóa ngoại MaDanhMuc)
const themSanPham = async (req, res) => {
    const { tenSanPham, danhMuc, giaTien, hinhAnh, moTa } = req.body;

    if (!tenSanPham || !giaTien || !danhMuc) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ tên sản phẩm, danh mục và giá tiền!' });
    }

    let donViTinh = 'Chai';
    const dmLower = String(danhMuc).toLowerCase();
    if (dmLower.includes('phân') || dmLower.includes('giống')) {
        donViTinh = 'Bao';
    }

    try {
        let pool = await ketNoiDb();
        const maDanhMuc = await layHoacTaoMaDanhMuc(pool, danhMuc);

        await pool.request()
            .input('ten', sql.NVarChar, tenSanPham)
            .input('danhmuc', sql.NVarChar, danhMuc)
            .input('madanhmuc', sql.Int, maDanhMuc)
            .input('giatien', sql.Decimal(18, 0), giaTien)
            .input('donvitinh', sql.NVarChar, donViTinh)
            .input('hinhanh', sql.NVarChar, hinhAnh || '')
            .input('mota', sql.NVarChar, moTa || '')
            .query(`
                INSERT INTO SanPham (TenSanPham, DanhMuc, MaDanhMuc, GiaTien, DonViTinh, HinhAnh, MoTa, TrangThai)
                VALUES (@ten, @danhmuc, @madanhmuc, @giatien, @donvitinh, @hinhanh, @mota, N'Đang bán')
            `);

        res.json({ success: true, message: 'Thêm sản phẩm thành công vào CSDL!' });
    } catch (err) {
        console.error('Lỗi khi thêm sản phẩm:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// Cập nhật sản phẩm (đồng bộ cả DanhMuc và khóa ngoại MaDanhMuc)
const suaSanPham = async (req, res) => {
    const { maSanPham, tenSanPham, danhMuc, giaTien, hinhAnh, moTa } = req.body;

    if (!maSanPham || !tenSanPham || !giaTien || !danhMuc) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin cập nhật sản phẩm!' });
    }

    let donViTinh = 'Chai';
    const dmLower = String(danhMuc).toLowerCase();
    if (dmLower.includes('phân') || dmLower.includes('giống')) {
        donViTinh = 'Bao';
    }

    try {
        let pool = await ketNoiDb();
        const maDanhMuc = await layHoacTaoMaDanhMuc(pool, danhMuc);

        await pool.request()
            .input('id', sql.Int, maSanPham)
            .input('ten', sql.NVarChar, tenSanPham)
            .input('danhmuc', sql.NVarChar, danhMuc)
            .input('madanhmuc', sql.Int, maDanhMuc)
            .input('giatien', sql.Decimal(18, 0), giaTien)
            .input('donvitinh', sql.NVarChar, donViTinh)
            .input('hinhanh', sql.NVarChar, hinhAnh || '')
            .input('mota', sql.NVarChar, moTa || '')
            .query(`
                UPDATE SanPham 
                SET TenSanPham = @ten, DanhMuc = @danhmuc, MaDanhMuc = @madanhmuc, GiaTien = @giatien, 
                    DonViTinh = @donvitinh, HinhAnh = @hinhanh, MoTa = @mota
                WHERE MaSanPham = @id
            `);

        res.json({ success: true, message: 'Cập nhật sản phẩm thành công!' });
    } catch (err) {
        console.error('Lỗi khi sửa sản phẩm:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

// Xóa sản phẩm
const xoaSanPham = async (req, res) => {
    const { id } = req.params;

    try {
        let pool = await ketNoiDb();
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM SanPham WHERE MaSanPham = @id');

        res.json({ success: true, message: 'Xóa sản phẩm thành công!' });
    } catch (err) {
        console.error('Lỗi khi xóa sản phẩm:', err);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};

module.exports = { layDanhSachSanPham, themSanPham, suaSanPham, xoaSanPham };