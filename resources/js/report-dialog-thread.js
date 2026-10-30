// 清單／看板的單張詳情視窗：開啟時直接載入這張單的留言串（伺服器 Blade 已跳脫的 HTML），可在視窗內留言。
// 載入即算已讀（與對話面板同一個端點），並通知對話面板同步紅色未讀數字。

const POLL_MS = 5000;

const fetchThread = async (url) => {
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
    });
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return response.json();
};

const setupThread = (section) => {
    const dialog = section.closest('dialog');
    const body = section.querySelector('[data-dialog-thread-body]');
    const form = section.querySelector('[data-dialog-thread-form]');
    const input = section.querySelector('[data-dialog-thread-input]');
    const sendButton = section.querySelector('[data-dialog-thread-send]');
    const errorBox = section.querySelector('[data-dialog-thread-error]');
    const reportId = section.dataset.reportId;
    let lastHtml = '';
    let timer = null;

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    const markRead = () => {
        document.querySelectorAll(`[data-chat-open="${CSS.escape(reportId)}"] [data-unread-badge], [data-adjustment-updated="${CSS.escape(reportId)}"]`).forEach((badge) => badge.remove());
        document.dispatchEvent(new CustomEvent('feedback:report-read', { detail: { id: reportId } }));
    };

    const load = async ({ scrollToEnd = false } = {}) => {
        try {
            const data = await fetchThread(section.dataset.threadUrl);
            if (data.html !== lastHtml) {
                const template = document.createElement('template');
                template.innerHTML = data.html;
                // 調整重點已在視窗上方顯示，這裡只放留言串。
                template.content.querySelectorAll('[data-chat-adjustment]').forEach((node) => node.remove());
                const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
                body.replaceChildren(template.content);
                lastHtml = data.html;
                if (scrollToEnd || nearEnd) {
                    body.scrollTop = body.scrollHeight;
                }
            }
            markRead();
        } catch (error) {
            if (lastHtml === '') {
                const message = document.createElement('p');
                message.className = 'py-4 text-center text-sm text-slate-500';
                message.textContent = error.status === 404 ? '找不到這張回饋單，可能已被刪除。' : '留言載入失敗，請稍後再試。';
                body.replaceChildren(message);
            }
        }
    };

    const send = async () => {
        if (input.value.trim() === '' && (form.querySelector('input[type=file]')?.files.length ?? 0) === 0) {
            input.focus();

            return;
        }
        sendButton.disabled = true;
        sendButton.textContent = '送出中…';
        errorBox.hidden = true;
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            if (response.ok) {
                form.reset();
                document.getElementById(`dialog-preview-${reportId}`)?.replaceChildren();
                await load({ scrollToEnd: true });

                return;
            }
            if (response.status === 422) {
                const data = await response.json().catch(() => ({}));
                showError(Object.values(data.errors ?? {})[0]?.[0] ?? '留言內容有誤，請檢查後再送出。');
            } else if (response.status === 419) {
                showError('頁面停留太久已過期，請重新整理頁面後再送出。');
            } else if (response.status === 413) {
                showError('附圖太大，請縮小或減少張數後再試。');
            } else if (response.status === 429) {
                showError('送出太頻繁，請稍候再試。');
            } else {
                showError('送出失敗，請稍後再試。');
            }
        } catch {
            showError('網路連線失敗，留言尚未送出。');
        } finally {
            sendButton.disabled = false;
            sendButton.textContent = '送出留言';
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        send();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
        }
    });

    const start = () => {
        load({ scrollToEnd: true });
        window.clearInterval(timer);
        timer = window.setInterval(() => {
            if (!document.hidden && dialog.open) {
                load();
            }
        }, POLL_MS);
    };

    // 視窗開啟（showModal 會加上 open 屬性）時載入，關閉時停止刷新。
    new MutationObserver(() => {
        if (dialog.open) {
            start();
        } else {
            window.clearInterval(timer);
        }
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
};

document.querySelectorAll('[data-dialog-thread]').forEach(setupThread);
