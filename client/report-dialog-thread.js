// 清單／看板的單張詳情視窗（右側滑出）：開啟時直接載入這張單的相簿＋活動時間軸（伺服器 JSX 已跳脫的 HTML，與對話面板同一個端點），
// 可在視窗內留言、附圖。載入即算已讀，並通知對話面板同步紅色未讀數字、上方未讀提示與右下角數字；
// 右側窄欄（狀態、完成鈕、時間）與清單上這張單的狀態文字跟著對話端點更新。
// 附圖跟其他表單一樣：每張圖各用一個 PUT 串流上傳，留言只帶回傳的 upload id（Workers 免費方案每請求 CPU 10 ms）。

import { fileProblem } from '../src/shared/attachment-rules';
import { bindAttachmentComposer } from './attachment-composer.js';
import { draftsSignature, renderMessageDrafts } from './message-drafts.js';
import { clearReportUnread } from './report-read.js';
import { replaceKeepingOpen } from './thread-details.js';
import { statusDotClass } from '../src/shared/status';

const POLL_MS = 5000;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

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
        return '圖片／影片太大，請縮小或減少檔案數後再試。';
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
    // 待審留言（只有開發團隊拿得到，客戶端這個容器不存在）：顯示在留言串最下面，與單頁、面板同一份。
    const draftsBox = section.querySelector('[data-dialog-thread-drafts]');
    const reportId = section.dataset.reportId;
    const state = { lastHtml: '', timer: null, uploadUrl: null, maxFiles: DEFAULT_MAX_FILES, maxBytes: DEFAULT_MAX_FILE_BYTES, request: 0 };

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    // 同頁的紅色數字先在本地拿掉；對話面板收到事件後重算上方提示與右下角數字。
    const sideBox = dialog.querySelector('[data-detail-side-box]');
    let lastSide = '';

    // 右側窄欄（狀態、完成鈕、時間）：留言可能讓狀態改變，跟著伺服器的最新結果更新；清單、看板上這張單的狀態文字也一起換。
    const applySide = (data) => {
        if (sideBox && typeof data.side_html === 'string') {
            // 相對時間（「3 分鐘前」）每次不同，先拿掉再比。
            const signature = draftsSignature(data.side_html);
            if (signature !== lastSide) {
                lastSide = signature;
                sideBox.innerHTML = data.side_html;
            }
        }
        if (typeof data.status_value === 'string') {
            document.querySelectorAll(`[data-report-row="${CSS.escape(reportId)}"] [data-status-text], [data-kanban-card][data-report-id="${CSS.escape(reportId)}"] [data-status-text]`).forEach((text) => {
                text.textContent = data.status;
                text.dataset.statusText = data.status_value;
                const dot = text.parentElement?.querySelector('[data-status-dot]');
                if (dot) {
                    dot.className = `size-2.5 shrink-0 rounded-full ${statusDotClass(data.status_value)}`;
                }
            });
        }
    };

    // 同頁的紅色數字先在本地拿掉；對話面板收到事件後重算上方提示與右下角數字。
    const markRead = () => {
        clearReportUnread(reportId);
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
            state.allowVideo = data.allow_video === true;
            if (data.html !== state.lastHtml) {
                const template = document.createElement('template');
                template.innerHTML = data.html;
                // 調整重點已在視窗上方顯示，這裡只放留言串。
                template.content.querySelectorAll('[data-chat-adjustment]').forEach((node) => node.remove());
                // 使用者展開的相簿、過去的處理說明換新後維持展開。
                replaceKeepingOpen(body, () => body.replaceChildren(template.content));
                state.lastHtml = data.html;
                if (scrollToEnd) {
                    // 送出留言後，把輸入框帶回畫面內，看得到剛送出的那則。
                    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
            applySide(data);
            if (draftsBox && typeof data.drafts_html === 'string') {
                renderMessageDrafts(draftsBox, data.drafts_html, { onChanged: () => load({ scrollToEnd: true }) });
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

    // 與伺服器同一份規則（src/shared/attachment-rules.ts）：圖片每張 10 MB、mp4 影片每支 50 MB、最多 5 個檔。
    const validateFiles = () => fileProblem(Array.from(fileInput.files), { maxFiles: state.maxFiles, maxImageBytes: state.maxBytes, allowVideo: state.allowVideo === true });

    // 按「附件」選檔與拖進輸入區走同一套檢查與預覽（client/attachment-composer.js）。
    bindAttachmentComposer(fileInput, () => ({ maxFiles: state.maxFiles, maxImageBytes: state.maxBytes, allowVideo: state.allowVideo === true }));

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
                sendButton.textContent = `上傳圖片／影片 ${index}/${files.length}…`;
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
                    showError(result.message ? `「${file.name}」${result.message}` : await readError(upload, '圖片／影片上傳失敗，請稍後再試。'));

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
            load();
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
