// 清單／看板的單張詳細視窗：開啟時直接載入這張單的留言串（伺服器 JSX 已跳脫的 HTML，與對話面板同一個端點），
// 可在視窗內留言、附圖。載入即算已讀，並通知對話面板同步紅色未讀數字、上方未讀提示與右下角數字。
// 附圖跟其他表單一樣：每張圖各用一個 PUT 串流上傳，留言只帶回傳的 upload id（Workers 免費方案每請求 CPU 10 ms）。

const POLL_MS = 5000;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const fetchThread = async (url) => {
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
    });
    // 伺服器以 ETag 回 304 時，瀏覽器會交回快取的 200 內容。
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return response.json();
};

const readError = async (response, fallback) => {
    const data = await response.json().catch(() => ({}));
    if (response.status === 422) {
        return data.message ?? Object.values(data.errors ?? {})[0]?.[0] ?? '留言內容有誤，請檢查後再送出。';
    }
    if (response.status === 413) {
        return '附圖太大，請縮小或減少張數後再試。';
    }
    if (response.status === 429) {
        return '送出太頻繁，請稍候再試。';
    }
    if (response.status === 403 && data.message) {
        return data.message;
    }

    return fallback;
};

const setupThread = (section) => {
    const dialog = section.closest('dialog');
    const body = section.querySelector('[data-dialog-thread-body]');
    const form = section.querySelector('[data-dialog-thread-form]');
    const input = section.querySelector('[data-dialog-thread-input]');
    const fileInput = section.querySelector('[data-dialog-thread-files]');
    const sendButton = section.querySelector('[data-dialog-thread-send]');
    const errorBox = section.querySelector('[data-dialog-thread-error]');
    const reportId = section.dataset.reportId;
    const state = { lastHtml: '', timer: null, uploadUrl: null, maxFiles: DEFAULT_MAX_FILES, maxBytes: DEFAULT_MAX_FILE_BYTES, request: 0 };

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    // 同頁的紅色數字先在本地拿掉；對話面板收到事件後重算上方提示與右下角數字。
    const markRead = () => {
        document.querySelectorAll(`[data-chat-open="${CSS.escape(reportId)}"] [data-unread-badge]`).forEach((badge) => badge.remove());
        document.dispatchEvent(new CustomEvent('feedback:report-read', { detail: { id: reportId } }));
    };

    const load = async ({ scrollToEnd = false } = {}) => {
        const requestId = ++state.request;
        try {
            const data = await fetchThread(section.dataset.threadUrl);
            if (requestId !== state.request) {
                return;
            }
            state.uploadUrl = data.upload_url;
            state.maxFiles = data.max_files ?? DEFAULT_MAX_FILES;
            state.maxBytes = data.max_bytes ?? DEFAULT_MAX_FILE_BYTES;
            if (data.html !== state.lastHtml) {
                const template = document.createElement('template');
                template.innerHTML = data.html;
                // 調整說明已在視窗上方顯示，這裡只放留言串。
                template.content.querySelectorAll('[data-chat-adjustment]').forEach((node) => node.remove());
                const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
                body.replaceChildren(template.content);
                state.lastHtml = data.html;
                if (scrollToEnd || nearEnd) {
                    body.scrollTop = body.scrollHeight;
                }
            }
            markRead();
        } catch (error) {
            if (requestId === state.request && state.lastHtml === '') {
                const message = document.createElement('p');
                message.className = 'py-4 text-center text-sm text-slate-500';
                message.textContent = error.status === 404 ? '找不到這張回饋單，可能已被刪除。' : '留言載入失敗，請稍後再試。';
                body.replaceChildren(message);
            }
        }
    };

    const validateFiles = () => {
        const files = Array.from(fileInput.files);
        if (files.length > state.maxFiles) {
            return `附圖最多 ${state.maxFiles} 張。`;
        }
        if (files.some((file) => !ALLOWED_TYPES.includes(file.type))) {
            return '附圖只接受 JPG、PNG、WebP。';
        }
        if (files.some((file) => file.size > state.maxBytes)) {
            return `每張附圖不可超過 ${Math.round(state.maxBytes / 1024 / 1024)} MB。`;
        }

        return null;
    };

    fileInput.addEventListener('change', () => {
        const problem = validateFiles();
        if (problem) {
            showError(problem);
        } else {
            errorBox.hidden = true;
        }
    });

    const send = async () => {
        if (sendButton.disabled) {
            return;
        }
        if (input.value.trim() === '') {
            showError('請輸入留言內容。');
            input.focus();

            return;
        }
        const problem = validateFiles();
        if (problem) {
            showError(problem);

            return;
        }
        sendButton.disabled = true;
        sendButton.textContent = '送出中…';
        errorBox.hidden = true;
        try {
            const params = new URLSearchParams();
            params.set('body', input.value);
            const files = Array.from(fileInput.files);
            if (files.length > 0 && !state.uploadUrl) {
                await load();
            }
            for (const [index, file] of files.entries()) {
                sendButton.textContent = `上傳附圖 ${index}/${files.length}…`;
                const upload = await fetch(state.uploadUrl, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': file.type || 'application/octet-stream',
                        'X-Filename': encodeURIComponent(file.name),
                    },
                    credentials: 'same-origin',
                });
                const result = await upload.clone().json().catch(() => ({}));
                if (!upload.ok || !result.id) {
                    showError(result.message ? `「${file.name}」${result.message}` : await readError(upload, '附圖上傳失敗，請稍後再試。'));

                    return;
                }
                params.append('upload_ids[]', result.id);
            }
            sendButton.textContent = '送出中…';
            const response = await fetch(form.action, {
                method: 'POST',
                body: params,
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            if (response.ok) {
                form.reset();
                document.getElementById(`dialog-preview-${reportId}`)?.replaceChildren();
                await load({ scrollToEnd: true });

                return;
            }
            showError(await readError(response, '送出失敗，請稍後再試。'));
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

    const stop = () => {
        window.clearInterval(state.timer);
        state.timer = null;
    };

    dialog.addEventListener('close', stop);

    return {
        // 每次開啟都重新載入（也就重新標為已讀），開著時每 5 秒刷新；分頁在背景時不刷新。
        open() {
            load({ scrollToEnd: true });
            stop();
            state.timer = window.setInterval(() => {
                if (!document.hidden && dialog.open) {
                    load();
                }
            }, POLL_MS);
        },
    };
};

const threads = new WeakMap();

/** Called after a report dialog is shown; dialogs without a thread section are ignored. */
export const openDialogThread = (dialog) => {
    const section = dialog?.querySelector('[data-dialog-thread]');
    if (!section) {
        return;
    }
    let thread = threads.get(section);
    if (!thread) {
        thread = setupThread(section);
        threads.set(section, thread);
    }
    thread.open();
};
