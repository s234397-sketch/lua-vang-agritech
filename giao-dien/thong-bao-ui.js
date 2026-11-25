(function () {
    if (window.__luaVangNoticeUiLoaded) return;
    window.__luaVangNoticeUiLoaded = true;

    const style = document.createElement('style');
    style.textContent = `
        .lv-notice-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(15, 23, 42, 0.45);
            -webkit-backdrop-filter: blur(3px);
            backdrop-filter: blur(3px);
        }
        .lv-notice-card {
            width: 92%;
            max-width: 28rem;
            padding: 1.5rem;
            color: #1f2937;
            background: #fff;
            border: 1px solid rgba(6, 78, 59, 0.15);
            border-radius: 1.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.28);
            animation: lv-notice-pop 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        .lv-notice-message {
            white-space: pre-line;
            overflow-wrap: anywhere;
        }
        .lv-notice-actions {
            display: flex;
            justify-content: flex-end;
            gap: 0.75rem;
            margin-top: 1.5rem;
        }
        .lv-notice-button {
            min-width: 6rem;
            padding: 0.625rem 1.5rem;
            border: 0;
            border-radius: 0.75rem;
            font: inherit;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 160ms ease, transform 160ms ease;
        }
        .lv-notice-button:focus-visible {
            outline: 3px solid rgba(16, 185, 129, 0.35);
            outline-offset: 2px;
        }
        .lv-notice-primary {
            color: #fff;
            background: #064e3b;
        }
        .lv-notice-primary:hover {
            background: #047857;
        }
        .lv-notice-danger {
            color: #fff;
            background: #dc2626;
        }
        .lv-notice-danger:hover {
            background: #b91c1c;
        }
        .lv-notice-cancel {
            color: #374151;
            background: #e5e7eb;
        }
        .lv-notice-cancel:hover {
            background: #d1d5db;
        }
        @keyframes lv-notice-pop {
            0% { opacity: 0; transform: translateY(8px) scale(0.92); }
            70% { opacity: 1; transform: translateY(0) scale(1.02); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
            .lv-notice-card { animation: none; }
        }
    `;
    document.head.appendChild(style);

    const queue = [];
    let active = false;

    function classify(message) {
        const normalized = message.toLocaleLowerCase('vi');
        if (['lỗi', 'thất bại', 'sai', 'không thể', '❌'].some(term => normalized.includes(term))) {
            return {
                title: 'Có lỗi xảy ra',
                iconColor: '#dc2626',
                iconBackground: '#fef2f2',
                icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            };
        }
        if (['thành công', 'hoàn tất', '✅'].some(term => normalized.includes(term))) {
            return {
                title: 'Thông báo thành công',
                iconColor: '#064e3b',
                iconBackground: '#ecfdf5',
                icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            };
        }
        return {
            title: 'Lúa Vàng thông báo',
            iconColor: '#d97706',
            iconBackground: '#fffbeb',
            icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 11v5m0-8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        };
    }

    function cleanMessage(message) {
        return message.replace(/^\s*(?:(?:✅|❌|⚠️|⏱️)\s*)+/u, '').trim();
    }

    function enqueue(message, isConfirmation) {
        return new Promise(resolve => {
            queue.push({
                message: message == null ? '' : String(message),
                isConfirmation,
                resolve
            });
            renderNext();
        });
    }

    function renderNext() {
        if (active || queue.length === 0) return;
        active = true;

        const item = queue.shift();
        const meta = classify(item.message);
        const destructive = /xóa|hủy|huy|delete|cancel/i.test(item.message);
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/45 backdrop-blur-xs lv-notice-backdrop';
        overlay.setAttribute('role', 'presentation');

        const dialog = document.createElement('section');
        dialog.className = 'rounded-3xl max-w-md w-[92%] p-6 shadow-2xl border border-[#064e3b]/15 lv-notice-card';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'lv-notice-title');
        dialog.setAttribute('aria-describedby', 'lv-notice-message');

        const icon = document.createElement('div');
        icon.className = 'flex h-14 w-14 items-center justify-center rounded-full';
        icon.style.color = meta.iconColor;
        icon.style.backgroundColor = meta.iconBackground;
        icon.innerHTML = meta.icon;
        icon.firstElementChild.setAttribute('width', '28');
        icon.firstElementChild.setAttribute('height', '28');

        const title = document.createElement('h2');
        title.id = 'lv-notice-title';
        title.className = 'mt-4 text-xl font-extrabold text-[#064e3b]';
        title.textContent = item.isConfirmation && destructive ? 'Xác nhận thao tác' : meta.title;

        const body = document.createElement('p');
        body.id = 'lv-notice-message';
        body.className = 'lv-notice-message mt-2 text-sm leading-relaxed text-gray-700';
        body.textContent = cleanMessage(item.message);

        const actions = document.createElement('div');
        actions.className = 'lv-notice-actions';

        const cancel = item.isConfirmation ? document.createElement('button') : null;
        if (cancel) {
            cancel.type = 'button';
            cancel.className = 'lv-notice-button lv-notice-cancel';
            cancel.textContent = 'Hủy bỏ';
        }

        const primary = document.createElement('button');
        primary.type = 'button';
        primary.className = `lv-notice-button ${item.isConfirmation && destructive ? 'lv-notice-danger' : 'lv-notice-primary'}`;
        primary.textContent = item.isConfirmation ? 'Xác nhận' : 'Đóng';

        let closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            active = false;
            item.resolve(result);
            renderNext();
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(item.isConfirmation ? false : undefined);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                close(item.isConfirmation ? true : undefined);
            }
        }

        if (cancel) {
            cancel.addEventListener('click', () => close(false));
            actions.appendChild(cancel);
        }
        primary.addEventListener('click', () => close(item.isConfirmation ? true : undefined));
        actions.appendChild(primary);

        dialog.append(icon, title, body, actions);
        overlay.appendChild(dialog);
        (document.body || document.documentElement).appendChild(overlay);
        document.addEventListener('keydown', onKeyDown);
        (cancel || primary).focus();
    }

    window.hienThongBao = function (noiDung) {
        return enqueue(noiDung, false);
    };

    window.xacNhanThongBao = function (noiDung) {
        return enqueue(noiDung, true);
    };

    window.alert = function (msg) {
        return window.hienThongBao(msg);
    };
})();
