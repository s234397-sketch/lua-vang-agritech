const { sql, ketNoiDb } = require('../cau-hinh/ket-noi-db');
const { Groq } = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

let gemini = null;
if (process.env.GEMINI_API_KEY) {
    const { GoogleGenAI } = require('@google/genai');
    gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

const DANH_SACH_MODEL_GROQ = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

let adminLastSeen = 0;
const ADMIN_ONLINE_MS = 30 * 1000;

const adminDangOnline = () => Date.now() - adminLastSeen < ADMIN_ONLINE_MS;

const adminPing = (req, res) => {
    adminLastSeen = Date.now();
    res.json({ success: true });
};

const trangThaiAdmin = (req, res) => {
    res.json({ success: true, online: adminDangOnline() });
};

const adminOffline = (req, res) => {
    adminLastSeen = 0;
    res.json({ success: true });
};

function lamSachTinAI(text) {
    return String(text || '')
        .replace(/^🤖 \[Trợ lý AI Lúa Vàng\]:\s*/i, '')
        .replace(/\n\n⏳ \(Hệ thống[\s\S]*$/, '')
        .trim();
}

async function taoPromptHeThong(pool) {
    const [resSanPham, resThueMay, resSuKien] = await Promise.all([
        pool.request().query(`
            SELECT TenSanPham, DanhMuc, GiaTien, DonViTinh, MoTa, TrangThai 
            FROM SanPham
        `),
        pool.request().query(`
            SELECT TenMay, LoaiMay, GiaThue, DonViTinh, MoTa, TrangThai 
            FROM ThueMay
        `),
        pool.request().query(`
            SELECT TieuDe, ThoiGian, DiaDiem, MoTa 
            FROM SuKien
        `)
    ]);

    const dsSanPham = resSanPham.recordset.map(sp => {
        const gia = Number(sp.GiaTien).toLocaleString('vi-VN');
        const moTaNgan = (sp.MoTa || '').slice(0, 120);
        return `- [${sp.DanhMuc}] ${sp.TenSanPham}: ${gia} đ/${sp.DonViTinh} (${sp.TrangThai || 'Đang bán'}) - ${moTaNgan}`;
    }).join('\n') || 'Chưa có sản phẩm.';

    const dsThueMay = resThueMay.recordset.map(m => {
        const gia = Number(m.GiaThue).toLocaleString('vi-VN');
        const moTaNgan = (m.MoTa || '').slice(0, 110);
        return `- [${m.LoaiMay}] ${m.TenMay}: ${gia} đ/${m.DonViTinh || 'công'} (${m.TrangThai || 'Sẵn sàng'}) - ${moTaNgan}`;
    }).join('\n') || 'Chưa có dịch vụ thuê máy.';

    const dsSuKien = resSuKien.recordset.map(sk => {
        return `- ${sk.TieuDe} | Thời gian: ${sk.ThoiGian} | Địa điểm: ${sk.DiaDiem} (${sk.MoTa || ''})`;
    }).join('\n') || 'Chưa có sự kiện nào.';

    return `Bạn là Trợ lý AI nông nghiệp chuyên nghiệp của hệ thống 'Lúa Vàng' tại miền Tây.
Phong cách trả lời: Ngắn gọn (3-5 câu), thân thiện (xưng 'Dạ bà con' / 'em'), rõ ràng, báo đúng giá tiền VNĐ.

DƯỚI ĐÂY LÀ DỮ LIỆU THỰC TẾ CỦA HỆ THỐNG LÚA VÀNG (CHỈ ĐƯỢC TƯ VẤN DỰA TRÊN DỮ LIỆU NÀY):

1. THÔNG TIN LIÊN HỆ CHÍNH THỨC:
- Hotline tư vấn kỹ thuật: 1900 6868
- Zalo hỗ trợ: 0988 123 456
- Email: hotro@luavang.vn
- Đặt mua sản phẩm tại mục "Sản phẩm", đặt thuê máy tại mục "Thuê máy", đăng ký hội thảo tại mục "Sự kiện" trên website.

2. DANH SÁCH SẢN PHẨM ĐANG BÁN (Giống lúa, Phân bón, Thuốc BVTV):
${dsSanPham}

3. DỊCH VỤ CHO THUÊ MÁY NÔNG NGHIỆP:
${dsThueMay}

4. SỰ KIỆN & HỘI THẢO SẮP DIỄN RA:
${dsSuKien}

QUY TẮC BẮT BUỘC:
- Được phép sử dụng kiến thức chuyên gia nông nghiệp để giải đáp mọi thắc mắc của bà con về kỹ thuật trồng lúa, chăm sóc cây trồng, thời tiết, sâu bệnh, thổ nhưỡng và đời sống nhà nông.
- Khi tư vấn thuốc BVTV, phân bón, giống lúa hoặc thuê máy: ưu tiên giới thiệu ĐÚNG tên và GIÁ BÁN các mặt hàng đang có ở mục 2 và mục 3.
- Nếu bà con hỏi các chủ đề khác ngoài nông nghiệp hoặc trò chuyện thông thường, hãy trả lời tự nhiên, thông minh và thân thiện.
- Chỉ không được tự bịa ra tên sản phẩm, giá tiền, số điện thoại hoặc địa chỉ kho bãi giả của cửa hàng Lúa Vàng. Nếu cửa hàng chưa kinh doanh mặt hàng bà con hỏi, vẫn tư vấn kỹ thuật/hoạt chất bình thường và gợi ý bà con liên hệ Hotline 1900 6868 hoặc Zalo 0988 123 456 để đặt hàng riêng.`;
}

async function hoiAI(lichSu, systemPrompt) {
    for (const model of DANH_SACH_MODEL_GROQ) {
        try {
            const completion = await groq.chat.completions.create({
                model,
                messages: [{ role: "system", content: systemPrompt }, ...lichSu]
            });
            const text = completion.choices[0]?.message?.content;
            if (text && text.trim()) return text.trim();
        } catch (err) {
            console.error(`Groq model ${model} lỗi:`, err.status, err.message);
        }
    }

    if (gemini) {
        try {
            const cauHoiCuoi = lichSu[lichSu.length - 1].content;
            const r = await gemini.models.generateContent({
                model: "gemini-2.5-flash",
                contents: cauHoiCuoi,
                config: { systemInstruction: systemPrompt }
            });
            if (r.text && r.text.trim()) return r.text.trim();
        } catch (err) {
            console.error('Gemini lỗi:', err.status || '', err.message);
        }
    }

    throw new Error('Tất cả AI đều lỗi');
}

const layTinNhan = async (req, res) => {
    try {
        const isAdminView = String(req.query.admin || '').trim() === '1';
        const soDienThoai = String(req.query.soDienThoai || '').trim();

        const pool = await ketNoiDb();

        if (isAdminView) {
            const result = await pool.request().query(`
                SELECT Id, NguoiGui, HoTen, SoDienThoai, NoiDung,
                       CONVERT(varchar(19), NgayGui, 126) AS NgayGui
                FROM TinNhanTuVan
                ORDER BY Id ASC
            `);
            return res.json({ success: true, data: result.recordset });
        }

        if (!soDienThoai || soDienThoai === 'khach') {
            return res.status(401).json({
                success: false,
                requireLogin: true,
                message: 'Vui lòng đăng nhập để xem lịch sử tư vấn của bạn!'
            });
        }

        const result = await pool.request()
            .input('soDienThoai', sql.VarChar, soDienThoai)
            .query(`
                SELECT Id, NguoiGui, HoTen, SoDienThoai, NoiDung,
                       CONVERT(varchar(19), NgayGui, 126) AS NgayGui
                FROM TinNhanTuVan
                WHERE SoDienThoai = @soDienThoai
                ORDER BY Id ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const guiTinNhan = async (req, res) => {
    try {
        const { nguoiGui, hoTen, soDienThoai, noiDung } = req.body;
        const sdtClean = String(soDienThoai || '').trim();
        const noiDungClean = String(noiDung || '').trim();

        if (!sdtClean || sdtClean === 'khach') {
            return res.status(401).json({
                success: false,
                requireLogin: true,
                message: 'Vui lòng đăng nhập để gửi tin nhắn tư vấn!'
            });
        }

        if (!noiDungClean) {
            return res.status(400).json({
                success: false,
                message: 'Nội dung tin nhắn không được để trống!'
            });
        }

        const pool = await ketNoiDb();

        await pool.request()
            .input('nguoiGui', sql.VarChar, nguoiGui)
            .input('hoTen', sql.NVarChar, hoTen || 'Nông dân')
            .input('soDienThoai', sql.VarChar, sdtClean)
            .input('noiDung', sql.NVarChar, noiDungClean)
            .query(`INSERT INTO TinNhanTuVan (NguoiGui, HoTen, SoDienThoai, NoiDung, NgayGui) 
                    VALUES (@nguoiGui, @hoTen, @soDienThoai, @noiDung, GETDATE())`);

        if (nguoiGui === 'nong-dan' && !adminDangOnline()) {
            let noiDungPhanHoi = '';
            try {
                const [systemPrompt, ketQua] = await Promise.all([
                    taoPromptHeThong(pool),
                    pool.request()
                        .input('sdt', sql.VarChar, sdtClean)
                        .query(`SELECT TOP 6 NguoiGui, NoiDung FROM TinNhanTuVan 
                                WHERE SoDienThoai = @sdt ORDER BY NgayGui DESC, Id DESC`)
                ]);

                const lichSu = ketQua.recordset.reverse().map(m => ({
                    role: m.NguoiGui === 'nong-dan' ? 'user' : 'assistant',
                    content: m.NguoiGui === 'nong-dan' ? m.NoiDung : lamSachTinAI(m.NoiDung)
                }));

                const cauTraLoiAI = (await hoiAI(lichSu, systemPrompt)) || "Xin lỗi bà con, hệ thống đang bận.";
                noiDungPhanHoi = `🤖 [Trợ lý AI Lúa Vàng]: ${cauTraLoiAI}\n\n⏳ (Hệ thống đã ghi nhận câu hỏi, Admin sẽ trực tiếp hỗ trợ thêm cho bà con trong thời gian ngắn nhất ạ!)`;
            } catch (aiErr) {
                console.error('Lỗi AI:', aiErr);
                noiDungPhanHoi = `🤖 [Trợ lý AI Lúa Vàng]: Dạ bà con ơi, hiện tại hệ thống AI đang bận một chút, Admin sẽ trực tiếp giải đáp thắc mắc cho bà con ngay nhé!`;
            }

            await pool.request()
                .input('nguoiGui', sql.VarChar, 'admin')
                .input('hoTen', sql.NVarChar, hoTen || 'Nông dân')
                .input('soDienThoai', sql.VarChar, sdtClean)
                .input('noiDung', sql.NVarChar, noiDungPhanHoi)
                .query(`INSERT INTO TinNhanTuVan (NguoiGui, HoTen, SoDienThoai, NoiDung, NgayGui) 
                        VALUES (@nguoiGui, @hoTen, @soDienThoai, @noiDung, GETDATE())`);
        }

        res.json({ success: true, message: 'Gửi tin nhắn thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

module.exports = { layTinNhan, guiTinNhan, adminPing, trangThaiAdmin, adminOffline };