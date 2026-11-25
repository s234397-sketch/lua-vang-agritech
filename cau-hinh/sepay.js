module.exports = {
    // Cổng chạy server (khớp với link DevTunnels https://6nrbfdzg-3000.asse.devtunnels.ms)
    PORT: 3000,

    // Mã ngân hàng VietinBank theo chuẩn VietQR
    BANK_ID: 'ICB',

    // Số tài khoản VietinBank nhận tiền
    ACCOUNT_NO: '101886851153',

    // Tên chủ tài khoản (viết hoa không dấu)
    ACCOUNT_NAME: 'NGUYEN MINH KHOA',

    // Tiền tố bắt buộc của SePay dành cho ngân hàng VietinBank
    CONTENT_PREFIX: 'SEVQR',

    // Link Webhook đã cấu hình trên my.sepay.vn
    WEBHOOK_URL: 'https://6nrbfdzg-3000.asse.devtunnels.ms/api/payment/webhook'
};