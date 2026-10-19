// 右下角留言對話面板。清單資料是 JSON，一律用 textContent 放進畫面；
// 單一對話的 HTML 由伺服器 Blade 產生（已跳脫），與回饋單頁共用同一份留言樣式。

const THREAD_POLL_MS = 5000;
const LIST_POLL_OPEN_MS = 10000;
const LIST_POLL_CLOSED_MS = 30000;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
        lastThreadHtml: '',
        lastListFetch: 0,
        threadRequest: 0,
    };

    const isOpen = () => !panel.hidden;

    const fetchJson = async (url) => {
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
        updateLauncherBadge(state.items.reduce((sum, item) => sum + item.unread + (item.adjustment_updated ? 1 : 0), 0));
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
        try {
            const data = await fetchJson(root.dataset.listUrl);
            state.items = data.items;
            state.loaded = true;
            updateLauncherBadge(data.unread_total);
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
        document.querySelectorAll(`[data-chat-open="${CSS.escape(data.id)}"]`).forEach((opener) => {
            opener.querySelector('[data-unread-badge]')?.remove();
            if (opener.matches('[data-new-reply-badge]')) {
                opener.remove();
            }
        });

        const item = state.items.find((candidate) => candidate.id === data.id);
        if (item) {
            item.unread = 0;
            item.adjustment_updated = false;
            item.has_update = false;
            recountBadge();
            renderList();
        }
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
        }
        state.currentId = id;
        placeholder.hidden = true;
        threadView.hidden = false;
        setView('thread');
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
        renderList();
        loadList();
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
        if (files.length > MAX_FILES) {
            return `附圖最多 ${MAX_FILES} 張。`;
        }
        if (files.some((file) => !ALLOWED_TYPES.includes(file.type))) {
            return '附圖只接受 JPG、PNG、WebP。';
        }
        if (files.some((file) => file.size > MAX_FILE_BYTES)) {
            return '每張附圖不可超過 10 MB。';
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

        const id = state.currentId;
        sendButton.disabled = true;
        sendButton.textContent = '送出中…';
        errorBox.hidden = true;

        try {
            const response = await fetch(state.postUrl, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });

            if (response.ok) {
                clearComposer();
                if (state.currentId === id) {
                    await loadThread(id, { forceScroll: true });
                }
                loadList();

                return;
            }

            if (response.status === 422) {
                const data = await response.json().catch(() => ({}));
                const firstError = Object.values(data.errors ?? {})[0]?.[0];
                showError(firstError ?? '留言內容有誤，請檢查後再送出。');
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
