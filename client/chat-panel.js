// 右下角留言對話面板。清單資料是 JSON，一律用 textContent 放進畫面；
// 單一對話的 HTML 由伺服器 JSX 產生（已跳脫），與回饋單頁共用同一份留言樣式。
// 附圖跟其他表單一樣：每張圖各用一個 PUT 串流上傳，留言只帶回傳的 upload id（Workers 免費方案每請求 CPU 10 ms）。

import { badgeText, countUnreadReports, orderConversations, unreadById, unreadSummary, withUnreadInLabel, withUnreadInTitle } from '../src/shared/conversation';
import { CHAT_UNREAD_BADGE, UNREAD_FILTER_CLASS, UNREAD_SUMMARY_TONES } from '../src/worker/views/chat-classes';

const THREAD_POLL_MS = 5000;
const LIST_POLL_OPEN_MS = 10000;
const LIST_POLL_CLOSED_MS = 30000;
// 預設上限；開啟對話後以伺服器回傳的該單上限為準（公開回報的單較少）。
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// 與伺服器端清單、留言按鈕相同的樣式。
const SUMMARY_TONES = {
    alert: UNREAD_SUMMARY_TONES.alert.split(' '),
    calm: UNREAD_SUMMARY_TONES.calm.split(' '),
};
const ITEM_BADGE_CLASS = CHAT_UNREAD_BADGE;

const root = document.querySelector('[data-chat-root]');

if (root) {
    const $ = (selector) => root.querySelector(selector);
    const launcher = $('[data-chat-launcher]');
    const launcherBadge = $('[data-chat-launcher-badge]');
    const panel = $('[data-chat-panel]');
    const listPane = $('[data-chat-list-pane]');
    const threadPane = $('[data-chat-thread-pane]');
    const list = $('[data-chat-list]');
    const listStatus = $('[data-chat-list-status]');
    const search = $('[data-chat-search]');
    const placeholder = $('[data-chat-placeholder]');
    const threadView = $('[data-chat-thread-view]');
    const thread = $('[data-chat-thread]');
    const threadNumber = $('[data-chat-thread-number]');
    const threadStatus = $('[data-chat-thread-status]');
    const threadTitle = $('[data-chat-thread-title]');
    const threadDeleted = $('[data-chat-thread-deleted]');
    const pageLink = $('[data-chat-page-link]');
    const form = $('[data-chat-form]');
    const bodyInput = $('[data-chat-body-input]');
    const fileInput = $('[data-chat-files]');
    const preview = document.getElementById('chat-preview');
    const sendButton = $('[data-chat-send]');
    const errorBox = $('[data-chat-error]');

    const state = {
        items: [],
        loaded: false,
        currentId: null,
        postUrl: null,
        uploadUrl: null,
        lastThreadHtml: '',
        lastListFetch: 0,
        listRequest: 0,
        // 切到別張後才送失敗的留言內文，以單的 public_id 為鍵；回到那張時填回輸入框。
        failedDrafts: new Map(),
        maxFiles: DEFAULT_MAX_FILES,
        maxFileBytes: DEFAULT_MAX_FILE_BYTES,
        threadRequest: 0,
    };

    const isOpen = () => !panel.hidden;

    // 正在看的那張對話：重排時固定在清單原位，不會一點開變已讀就跳走；離開那張或重開面板時才歸位。
    const openConversationId = () => (state.currentId !== null && !threadView.hidden ? state.currentId : null);
    const reorder = (items, keepId = openConversationId()) => orderConversations(items, {
        keepId,
        previousIds: state.items.map((item) => item.id),
    });

    const fetchJson = async (url) => {
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

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }

        return node;
    };

    const updateLauncherBadge = (count) => {
        launcherBadge.hidden = count <= 0;
        launcherBadge.textContent = count > 99 ? '99+' : String(count);
        launcher.setAttribute('aria-label', count > 0 ? `開啟留言對話，${count} 則未讀` : '開啟留言對話');
    };

    const recountBadge = () => {
        updateLauncherBadge(state.items.reduce((sum, item) => sum + item.unread, 0));
    };

    const isOwnerViewer = root.dataset.viewer === 'owner';

    // 同頁清單／看板上各單留言按鈕的紅色數字。
    const syncPageBadges = (unread) => {
        // 只動留言按鈕（有 data-message-count），回饋單頁的「在對話面板開啟」不加數字。
        document.querySelectorAll('[data-chat-open][data-message-count]').forEach((button) => {
            const count = unread.get(button.dataset.chatOpen);
            if (count === undefined) {
                return;
            }
            let badge = button.querySelector('[data-unread-badge]');
            if (count <= 0) {
                badge?.remove();
            } else {
                if (!badge) {
                    badge = el('span', ITEM_BADGE_CLASS);
                    badge.dataset.unreadBadge = '';
                    if (!isOwnerViewer) {
                        badge.dataset.newReplyBadge = '';
                    }
                    button.append(badge);
                }
                badge.textContent = badgeText(count);
            }
            const label = button.getAttribute('aria-label');
            if (label !== null) {
                button.setAttribute('aria-label', withUnreadInLabel(label, count));
            }
            const title = button.getAttribute('title');
            if (title !== null) {
                button.setAttribute('title', withUnreadInTitle(title, count));
            }
        });
    };

    // 開發者端清單上方「有 N 張單有未讀留言」提示與「只看未讀留言」篩選。
    const syncUnreadSummary = (count) => {
        const summary = document.querySelector('[data-unread-summary]');
        const text = summary?.querySelector('[data-unread-summary-text]');
        if (!summary || !text) {
            return;
        }
        const view = unreadSummary(count, { unreadOnly: summary.dataset.unreadOnly === '1' });
        summary.classList.remove(...SUMMARY_TONES.alert, ...SUMMARY_TONES.calm);
        summary.classList.add(...SUMMARY_TONES[view.tone]);

        if (view.count > 0) {
            const number = el('span', null, view.count);
            number.dataset.unreadReportCount = '';
            text.replaceChildren('有 ', number, ' 張單有未讀留言');
        } else {
            text.replaceChildren('目前沒有未讀留言');
        }

        const filter = summary.querySelector('[data-unread-filter]');
        if (view.filter === 'unread-only' && !filter) {
            const link = el('a', UNREAD_FILTER_CLASS, '只看未讀留言');
            link.href = summary.dataset.unreadOnlyUrl;
            link.dataset.unreadFilter = '';
            text.after(link);
        } else if (view.filter === null) {
            filter?.remove();
        }
    };

    // 面板讀過或清單刷新後，用面板已有的未讀資料同步整頁，不另外向伺服器要資料。
    const syncPage = () => {
        if (!state.loaded) {
            return;
        }
        syncPageBadges(unreadById(state.items));
        if (isOwnerViewer) {
            syncUnreadSummary(countUnreadReports(state.items));
        }
    };

    const renderList = () => {
        const keyword = search.value.trim().toLowerCase();
        const items = keyword === ''
            ? state.items
            : state.items.filter((item) => item.title.toLowerCase().includes(keyword) || String(item.number) === keyword.replace(/^#/, ''));

        list.replaceChildren(...items.map((item) => {
            const li = el('li');
            const button = el('button', 'block w-full px-3 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:bg-teal-50');
            button.type = 'button';
            button.dataset.chatItem = item.id;
            if (item.id === state.currentId) {
                button.classList.add('bg-teal-50');
                button.setAttribute('aria-current', 'true');
            }

            const top = el('div', 'flex items-baseline gap-2');
            top.append(
                el('span', 'shrink-0 text-xs font-bold text-slate-400', `#${item.number}`),
                el('span', `min-w-0 flex-1 truncate text-sm ${item.has_update ? 'font-bold text-slate-950' : 'font-semibold text-slate-800'}`, item.title),
                el('span', 'shrink-0 text-[11px] text-slate-400', item.latest_label ?? ''),
            );

            const bottom = el('div', 'mt-1 flex items-center gap-2');
            const previewText = item.preview === null
                ? '還沒有留言'
                : `${item.preview_is_mine ? '你：' : ''}${item.preview}`;
            bottom.append(el('span', `min-w-0 flex-1 truncate text-xs ${item.preview === null ? 'italic text-slate-400' : (item.has_update ? 'text-slate-800' : 'text-slate-500')}`, previewText));
            if (item.adjustment_updated) {
                bottom.append(el('span', 'shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white', '調整說明更新'));
            }
            if (item.unread > 0) {
                const badge = el('span', 'shrink-0 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[11px] font-bold leading-4 text-white', item.unread > 99 ? '99+' : item.unread);
                badge.setAttribute('aria-label', `${item.unread} 則未讀`);
                bottom.append(badge);
            }

            const meta = el('div', 'mt-1 flex items-center gap-1.5 text-[10px] text-slate-400');
            meta.append(el('span', null, item.status));
            if (item.deleted) {
                meta.append(el('span', 'rounded-full bg-slate-200 px-1.5 text-slate-600', '已刪除'));
            }

            button.append(top, bottom, meta);
            li.append(button);

            return li;
        }));

        listStatus.hidden = items.length > 0;
        if (!state.loaded) {
            listStatus.hidden = false;
            listStatus.textContent = '載入中…';
        } else if (items.length === 0) {
            listStatus.textContent = state.items.length === 0 ? '還沒有回饋單。' : '沒有符合的回饋單。';
        }
    };

    const loadList = async () => {
        state.lastListFetch = Date.now();
        // 定時器、送出後與切回分頁可能同時要清單；只採用最後發出的那次，舊回應不覆蓋新資料。
        const requestId = ++state.listRequest;
        try {
            const data = await fetchJson(root.dataset.listUrl);
            if (requestId !== state.listRequest) {
                return;
            }
            const openId = isOpen() ? openConversationId() : null;
            state.items = reorder(data.items);
            state.loaded = true;
            // 正在看的那張每次刷新都會標為已讀；清單若比它早一步取回，仍當作已讀。
            const openItem = state.items.find((item) => item.id === openId);
            if (openItem && openItem.unread > 0) {
                openItem.unread = 0;
                openItem.adjustment_updated = false;
                openItem.has_update = false;
                recountBadge();
            } else {
                updateLauncherBadge(data.unread_total);
            }
            syncPage();
            if (isOpen()) {
                renderList();
            }
        } catch {
            if (isOpen() && !state.loaded) {
                listStatus.hidden = false;
                listStatus.textContent = '清單載入失敗，請稍後再試。';
            }
        }
    };

    const setView = (view) => {
        panel.dataset.view = view;
        // 手機寬度一次只顯示清單或對話；桌機兩欄並排。
        listPane.classList.toggle('max-sm:hidden', view === 'thread');
        threadPane.classList.toggle('max-sm:hidden', view !== 'thread');
    };

    const withoutTimes = (html) => html.replace(/(<time\b[^>]*>)[^<]*(<\/time>)/g, '$1$2');

    const isNearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;

    const applyThread = (data, { forceScroll }) => {
        threadNumber.textContent = `編號 ${data.number}`;
        threadStatus.textContent = data.status;
        threadTitle.textContent = data.title;
        threadTitle.title = data.title;
        threadDeleted.hidden = !data.deleted;
        pageLink.href = data.page_url;
        state.postUrl = data.post_url;
        state.uploadUrl = data.upload_url;
        state.maxFiles = data.max_files ?? DEFAULT_MAX_FILES;
        state.maxFileBytes = data.max_bytes ?? DEFAULT_MAX_FILE_BYTES;

        if (data.html !== state.lastThreadHtml) {
            const stickToBottom = forceScroll || isNearBottom();
            if (state.lastThreadHtml !== '' && withoutTimes(data.html) === withoutTimes(state.lastThreadHtml)) {
                // 只有「幾分鐘前」變了：就地更新時間文字，不重建留言與縮圖。
                const fresh = document.createElement('template');
                fresh.innerHTML = data.html;
                const freshTimes = fresh.content.querySelectorAll('time');
                thread.querySelectorAll('time').forEach((time, index) => {
                    time.textContent = freshTimes[index]?.textContent ?? time.textContent;
                });
            } else {
                const previousAdjustment = state.lastThreadHtml === '' ? null : thread.querySelector('[data-chat-adjustment]');
                thread.innerHTML = data.html;
                // 刷新時保留使用者展開／收合的調整說明。
                const adjustment = thread.querySelector('[data-chat-adjustment]');
                if (previousAdjustment && adjustment) {
                    adjustment.open = previousAdjustment.open;
                }
            }
            state.lastThreadHtml = data.html;
            if (stickToBottom) {
                thread.scrollTop = thread.scrollHeight;
            }
        }

        // 開啟對話即標為已讀，清單與徽章先在本地歸零，下次刷新再以伺服器為準。
        // 同頁清單／看板上這張單的紅色未讀數字與上方未讀提示一併更新。
        document.querySelectorAll(`[data-chat-open="${CSS.escape(data.id)}"] [data-unread-badge]`).forEach((badge) => badge.remove());

        const item = state.items.find((candidate) => candidate.id === data.id);
        if (item) {
            item.unread = 0;
            item.adjustment_updated = false;
            item.has_update = false;
            recountBadge();
            renderList();
        }
        syncPage();
    };

    const threadUrl = (id) => state.items.find((item) => item.id === id)?.thread_url
        ?? root.dataset.threadUrlTemplate.replace('__REPORT__', encodeURIComponent(id));

    const loadThread = async (id, { forceScroll = false } = {}) => {
        const requestId = ++state.threadRequest;
        try {
            const data = await fetchJson(threadUrl(id));
            if (requestId !== state.threadRequest || state.currentId !== id) {
                return;
            }
            applyThread(data, { forceScroll });
        } catch (error) {
            if (requestId !== state.threadRequest || state.currentId !== id) {
                return;
            }
            if (state.lastThreadHtml === '') {
                thread.replaceChildren(el('p', 'p-6 text-center text-sm text-slate-500', error.status === 404 ? '找不到這張回饋單，可能已被刪除。' : '對話載入失敗，請稍後再試。'));
            }
        }
    };

    const clearComposer = () => {
        form.reset();
        preview.replaceChildren();
        errorBox.hidden = true;
        errorBox.textContent = '';
    };

    const openThread = (id) => {
        if (state.currentId !== id) {
            clearComposer();
            state.lastThreadHtml = '';
            thread.replaceChildren(el('p', 'p-6 text-center text-sm text-slate-500', '載入中…'));
            threadTitle.textContent = state.items.find((item) => item.id === id)?.title ?? '';
            const draft = state.failedDrafts.get(id);
            if (draft) {
                state.failedDrafts.delete(id);
                bodyInput.value = draft.body;
                showError(`上次送出失敗（${draft.message}），內容已填回，${draft.hadFiles ? '附圖請重新選擇後' : ''}再送出一次。`);
            }
        }
        state.currentId = id;
        placeholder.hidden = true;
        threadView.hidden = false;
        setView('thread');
        // 點到的那張留在原位，先前開著的那張回到依規則的位置。
        state.items = reorder(state.items, id);
        renderList();
        loadThread(id, { forceScroll: true });
    };

    const showList = () => {
        setView('list');
        if (window.matchMedia('(max-width: 639px)').matches) {
            state.currentId = null;
            state.lastThreadHtml = '';
            threadView.hidden = true;
            placeholder.hidden = false;
        }
        state.items = reorder(state.items);
        renderList();
        search.focus({ preventScroll: true });
    };

    const openPanel = () => {
        if (isOpen()) {
            return;
        }
        panel.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        document.body.classList.add('max-sm:overflow-hidden');
        state.items = reorder(state.items, null);
        renderList();
        loadList();
        // 關掉前開著的那張對話：重開時立刻刷新並標為已讀，不等下一次輪詢。
        if (state.currentId !== null && !threadView.hidden) {
            loadThread(state.currentId);
        }
    };

    const closePanel = () => {
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('max-sm:overflow-hidden');
        launcher.focus({ preventScroll: true });
    };

    launcher.addEventListener('click', () => {
        if (isOpen()) {
            closePanel();

            return;
        }
        openPanel();
        if (state.currentId === null) {
            setView('list');
            search.focus({ preventScroll: true });
        }
    });

    $('[data-chat-close]').addEventListener('click', closePanel);
    $('[data-chat-back]').addEventListener('click', showList);
    search.addEventListener('input', renderList);

    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-chat-item]');
        if (button) {
            openThread(button.dataset.chatItem);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) {
            closePanel();
        }
    });

    // 清單／看板上的「新留言 N」「留言 N」「有新回覆」與詳情視窗的「開啟對話」。
    document.addEventListener('click', (event) => {
        const opener = event.target.closest('[data-chat-open]');
        if (!opener) {
            return;
        }
        event.preventDefault();
        opener.closest('dialog')?.close();
        openPanel();
        openThread(opener.dataset.chatOpen);
    });

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    const validateFiles = () => {
        const files = Array.from(fileInput.files);
        if (files.length > state.maxFiles) {
            return `附圖最多 ${state.maxFiles} 張。`;
        }
        if (files.some((file) => !ALLOWED_TYPES.includes(file.type))) {
            return '附圖只接受 JPG、PNG、WebP。';
        }
        if (files.some((file) => file.size > state.maxFileBytes)) {
            return `每張附圖不可超過 ${Math.round(state.maxFileBytes / 1024 / 1024)} MB。`;
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
        if (!state.postUrl || sendButton.disabled) {
            return;
        }
        if (bodyInput.value.trim() === '') {
            showError('請輸入留言內容。');
            bodyInput.focus();

            return;
        }
        const problem = validateFiles();
        if (problem) {
            showError(problem);

            return;
        }

        // 上傳要逐張等待，期間使用者可能切到別張對話；這次送出一律用開始時那張單的網址。
        const id = state.currentId;
        const postUrl = state.postUrl;
        const uploadUrl = state.uploadUrl;
        const stillHere = () => state.currentId === id;
        const body = bodyInput.value;
        const hadFiles = fileInput.files.length > 0;
        const fail = (message) => {
            if (stillHere()) {
                showError(message);
            } else {
                // 已切到別張：輸入框已清空，先把內文存起來，回到這張時填回並說明。
                state.failedDrafts.set(id, { body, message: message.replace(/。$/, ''), hadFiles });
            }
        };
        sendButton.disabled = true;
        sendButton.textContent = '送出中…';
        errorBox.hidden = true;

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

        try {
            const params = new URLSearchParams();
            params.set('body', body);
            const files = Array.from(fileInput.files);
            for (const [index, file] of files.entries()) {
                sendButton.textContent = `上傳附圖 ${index}/${files.length}…`;
                const upload = await fetch(uploadUrl, {
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
                    fail(result.message ? `「${file.name}」${result.message}` : await readError(upload, '附圖上傳失敗，請稍後再試。'));

                    return;
                }
                params.append('upload_ids[]', result.id);
            }
            sendButton.textContent = '送出中…';

            const response = await fetch(postUrl, {
                method: 'POST',
                body: params,
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });

            if (response.ok) {
                // 已切到別張時，輸入框屬於那張單，不清掉。
                if (stillHere()) {
                    clearComposer();
                    await loadThread(id, { forceScroll: true });
                }
                loadList();

                return;
            }

            fail(await readError(response, '送出失敗，請稍後再試。'));
        } catch {
            fail('網路連線失敗，留言尚未送出。');
        } finally {
            sendButton.disabled = false;
            sendButton.textContent = '送出';
        }
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        send();
    });

    bodyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
        }
    });

    // 面板開著：對話每 5 秒、清單每 10 秒刷新；關著：只每 30 秒更新右下角未讀數。分頁在背景時不刷新。
    window.setInterval(() => {
        if (document.hidden) {
            return;
        }
        if (isOpen() && state.currentId !== null && !threadView.hidden) {
            loadThread(state.currentId);
        }
        const listInterval = isOpen() ? LIST_POLL_OPEN_MS : LIST_POLL_CLOSED_MS;
        if (Date.now() - state.lastListFetch >= listInterval) {
            loadList();
        }
    }, THREAD_POLL_MS);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - state.lastListFetch >= THREAD_POLL_MS) {
            loadList();
        }
    });

    loadList();
}
