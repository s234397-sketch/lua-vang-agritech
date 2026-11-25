const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');

// Xử lý Đăng ký tài khoản nông dân
const dangKy = async (req, res) => {
    const { fullname, phone, address, password } = req.body;

    if (!fullname || !phone || !password) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các thông tin bắt buộc!' });
    }

    try {
        let pool = await ketNoiDb();

        // Kiểm tra trùng bên bảng Quản trị viên và Nông dân
        const [checkAdmin, checkPhone] = await Promise.all([
            pool.request()
                .input('phone', sql.VarChar, phone)
                .query(`
                    IF OBJECT_ID('dbo.QuanTriVien', 'U') IS NOT NULL
                        SELECT MaAdmin FROM QuanTriVien WHERE TenDangNhap = @phone
                    ELSE
                        SELECT 1 AS Empty WHERE 1 = 0
                `),
            pool.request()
                .input('phone', sql.VarChar, phone)
                .query('SELECT MaNongDan FROM NongDan WHERE SoDienThoai = @phone')
        ]);

        if (checkAdmin.recordset.length > 0 || checkPhone.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký tài khoản trước đó!' });
        }

        await pool.request()
            .input('fullname', sql.NVarChar, fullname)
            .input('phone', sql.VarChar, phone)
            .input('address', sql.NVarChar, address || '')
            .input('password', sql.NVarChar, password)
            .query(`
                INSERT INTO NongDan (HoTen, SoDienThoai, DiaChi, MatKhau)
                VALUES (@fullname, @phone, @address, @password)
            `);

        res.json({ success: true, message: 'Đăng ký tài khoản thành công và đã lưu vào CSDL!' });
    } catch (err) {
        console.error('Lỗi khi lưu CSDL:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống server: ' + err.message });
    }
};

// Xử lý Đăng nhập (Tách riêng bảng QuanTriVien và NongDan)
const dangNhap = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
    }

    try {
        let pool = await ketNoiDb();

        // 1. Kiểm tra đăng nhập bên bảng QuanTriVien trước
        const adminRes = await pool.request()
            .input('username', sql.VarChar, username)
            .input('password', sql.NVarChar, password)
            .query(`
                IF OBJECT_ID('dbo.QuanTriVien', 'U') IS NOT NULL
                    SELECT MaAdmin, TenDangNhap, HoTen, VaiTro
                    FROM QuanTriVien
                    WHERE TenDangNhap = @username AND MatKhau = @password
                ELSE
                    SELECT 1 AS Empty WHERE 1 = 0
            `);

        if (adminRes.recordset.length > 0) {
            const admin = adminRes.recordset[0];
            return res.json({
                success: true,
                message: 'Đăng nhập Quản trị viên thành công!',
                user: {
                    id: admin.MaAdmin,
                    name: admin.HoTen,
                    phone: admin.TenDangNhap,
                    address: 'Hệ thống Lúa Vàng',
                    vaiTro: admin.VaiTro,
                    role: 'admin'
                }
            });
        }

        // 2. Nếu không phải Admin, kiểm tra bên bảng NongDan
        const farmerRes = await pool.request()
            .input('phone', sql.VarChar, username)
            .input('password', sql.NVarChar, password)
            .query(`
                SELECT MaNongDan, HoTen, SoDienThoai, ISNULL(DiaChi, N'') AS DiaChi
                FROM NongDan
                WHERE SoDienThoai = @phone AND MatKhau = @password
            `);

        if (farmerRes.recordset.length === 0) {
            return res.status(401).json({ success: false, message: 'Số điện thoại hoặc mật khẩu không chính xác!' });
        }

        const user = farmerRes.recordset[0];
        res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            user: {
                id: user.MaNongDan,
                name: user.HoTen,
                phone: user.SoDienThoai,
                address: user.DiaChi,
                diaChi: user.DiaChi,
                role: 'nong-dan'
            }
        });
    } catch (err) {
        console.error('Lỗi khi đăng nhập:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống server: ' + err.message });
    }
};

module.exports = { dangKy, dangNhap };