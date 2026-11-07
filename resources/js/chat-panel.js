// 右下角留言對話面板。清單資料是 JSON，一律用 textContent 放進畫面；
// 單一對話的 HTML 由伺服器 Blade 產生（已跳脫），與回饋單頁共用同一份留言樣式。

import { orderConversations } from './chat-order';
import { renderMessageDrafts } from './message-drafts';
import { EMPTY_THREAD_TEXT, autoSelectTarget, rememberDismissed, shouldAutoOpen, tabCounts, visibleItems } from './chat-tabs';
import { clearReportUnread } from './report-read';
import { isEditingMessage, replaceKeepingOpen } from './thread-details';
import { badgeText, countUnreadReports, unreadById, unreadSummary, withUnreadInLabel, withUnreadInTitle } from './chat-unread';

const THREAD_POLL_MS = 5000;
const LIST_POLL_OPEN_MS = 10000;
const LIST_POLL_CLOSED_MS = 60000;
// 附件的檢查規則（張數、大小、格式）由 attachment-composer.js 依伺服器帶來的 data-attachment-rules 處理。
// 與 portal.blade.php、message-badges.blade.php、unread-dot.blade.php 相同的樣式。
const SUMMARY_TONES = {
    alert: ['border-rose-200', 'bg-rose-50', 'text-rose-900'],
    calm: ['border-slate-200', 'bg-white', 'text-slate-600'],
};
const UNREAD_FILTER_CLASS = 'rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2';
const DOT_CLASS = 'grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white';
const ITEM_BADGE_CLASS = 'absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white';

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
    const scroller = $('[data-chat-scroll]');
    const threadNumber = $('[data-chat-thread-number]');
    const threadStatus = $('[data-chat-thread-status]');
    const threadTitle = $('[data-chat-thread-title]');
    const threadDeleted = $('[data-chat-thread-deleted]');
    const pageLink = $('[data-chat-page-link]');
    const form = $('[data-chat-form]');
    const bodyInput = $('[data-chat-body-input]');
    const fileInput = $('[data-chat-files]');
    const sendButton = $('[data-chat-send]');
    const errorBox = $('[data-chat-error]');
    // 待審留言（只有開發團隊的頁面有這個容器）：顯示在留言串最下面，與單頁、詳情視窗同一份（message-drafts.js）。
    const draftsBox = $('[data-chat-drafts]');
    // 相簿鈕與附件頁：附件不放在對話串裡，點標題列的相簿鈕切到附件格狀頁，可返回對話。
    const albumOpen = $('[data-chat-album-open]');
    const albumCount = $('[data-chat-album-count]');
    const albumPane = $('[data-chat-album-pane]');
    const albumBody = $('[data-chat-album-body]');
    const albumBack = $('[data-chat-album-back]');

    const state = {
        items: [],
        loaded: false,
        currentId: null,
        postUrl: null,
        lastThreadHtml: '',
        lastAlbumHtml: '',
        albumCounts: new Map(),
        savedScroll: null,
        albumFlashTimer: null,
        albumFor: null,
        lastListFetch: 0,
        threadRequest: 0,
        tab: 'awaiting',
        autoOpenChecked: false,
        // 客戶端頁面載入時自動彈出的面板：先「偷看」第一張，不標已讀，等使用者真的操作才標（見 confirmRead）。
        peek: false,
    };

    const sessionStore = (() => {
        try {
            return window.sessionStorage;
        } catch {
            return null;
        }
    })();

    const tabButtons = [...root.querySelectorAll('[data-chat-tab]')];
    const renderTabs = () => {
        const counts = tabCounts(state.items);
        tabButtons.forEach((button) => {
            const active = button.dataset.chatTab === state.tab;
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            button.classList.toggle('border-teal-700', active);
            button.classList.toggle('text-teal-800', active);
            button.classList.toggle('border-transparent', !active);
            button.classList.toggle('text-slate-500', !active);
            const count = button.querySelector('[data-chat-tab-count]');
            if (count) {
                count.textContent = String(counts[button.dataset.chatTab] ?? 0);
            }
        });
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
        // 只動 message-badges 元件產生的留言按鈕（有 data-message-count），回饋單頁的「在對話面板開啟」不加數字。
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

    // 標題右邊的未讀小圓點數字（清單、看板，純指示不能點）：依面板的未讀資料補上、更新或拿掉。
    const syncUnreadDots = (unread) => {
        document.querySelectorAll('[data-unread-slot]').forEach((slot) => {
            const count = unread.get(slot.dataset.unreadSlot);
            if (count === undefined) {
                return;
            }
            let dot = slot.querySelector('[data-unread-dot]');
            if (count <= 0) {
                dot?.remove();

                return;
            }
            if (!dot) {
                dot = el('span', DOT_CLASS);
                dot.dataset.unreadDot = '';
                slot.append(dot);
            }
            dot.textContent = badgeText(count);
            dot.title = `${count} 則未讀留言`;
            dot.setAttribute('aria-label', `${count} 則未讀留言`);
        });
    };

    // 客戶端清單／看板上的「重點已更新」標籤：這張單已讀過（面板資料不再標示更新）就拿掉。
    const syncAdjustmentTags = () => {
        document.querySelectorAll('[data-adjustment-updated]').forEach((tag) => {
            const item = state.items.find((candidate) => candidate.id === tag.dataset.adjustmentUpdated);
            if (item && !item.adjustment_updated) {
                tag.remove();
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
        syncUnreadDots(unreadById(state.items));
        syncAdjustmentTags();
        if (isOwnerViewer) {
            syncUnreadSummary(countUnreadReports(state.items));
        }
    };

    const renderList = () => {
        const keyword = search.value.trim().toLowerCase();
        renderTabs();
        const tabItems = visibleItems(state.items, state.tab);
        const items = visibleItems(state.items, state.tab, keyword);

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
            if ((item.drafts_count ?? 0) > 0) {
                // 只有開發團隊的清單資料有 drafts_count。
                const chip = el('span', 'shrink-0 rounded border border-dashed border-amber-500 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900', '有草稿');
                chip.dataset.chatDraftChip = item.id;
                top.insertBefore(chip, top.lastChild);
            }

            const bottom = el('div', 'mt-1 flex items-center gap-2');
            const previewText = item.preview === null
                ? '還沒有留言'
                : `${item.preview_is_mine ? '你：' : ''}${item.preview}`;
            bottom.append(el('span', `min-w-0 flex-1 truncate text-xs ${item.preview === null ? 'italic text-slate-400' : (item.has_update ? 'text-slate-800' : 'text-slate-500')}`, previewText));
            if (item.adjustment_updated) {
                // 調整重點更新不算未讀留言：低調的文字標籤，不用紅色數字。
                bottom.append(el('span', 'shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-500', '重點已更新'));
            }
            if (item.unread > 0) {
                const badge = el('span', 'shrink-0 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[11px] font-bold leading-4 text-white', item.unread > 99 ? '99+' : item.unread);
                badge.setAttribute('aria-label', `${item.unread} 則未讀`);
                bottom.append(badge);
            }

            const meta = el('div', 'mt-1 flex items-center gap-1.5 text-[10px] text-slate-400');
            if (item.creator) {
                meta.append(el('span', 'truncate', item.creator), el('span', null, '·'));
            }
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
            listStatus.textContent = state.items.length === 0
                ? '還沒有回饋單。'
                : (keyword === '' ? (state.tab === 'awaiting' ? '沒有等你回覆的單。' : '沒有等對方回覆的單。') : '沒有符合的回饋單。');
        }
    };

    const loadList = async () => {
        state.lastListFetch = Date.now();
        try {
            const data = await fetchJson(root.dataset.listUrl);
            const openId = isOpen() && !state.peek ? openConversationId() : null;
            state.items = reorder(data.items);
            state.loaded = true;
            // 正在看的那張每次刷新都會標為已讀；清單若比它早一步取回，仍當作已讀。
            const openItem = state.items.find((item) => item.id === openId);
            if (openItem && (openItem.unread > 0 || openItem.adjustment_updated)) {
                openItem.unread = 0;
                openItem.adjustment_updated = false;
                openItem.has_update = false;
                recountBadge();
            } else {
                updateLauncherBadge(data.unread_total);
            }
            syncPage();
            if (!state.autoOpenChecked) {
                // 開頁面時有「對方最後發言、自己還沒回」的單就自動展開；這次瀏覽手動收合過就不再自動展開。
                state.autoOpenChecked = true;
                if (!isOpen() && shouldAutoOpen(data.awaiting_total ?? 0, sessionStore)) {
                    state.tab = 'awaiting';
                    openPanel({ autoSelect: false });
                    setView('list');
                    // 團隊端有沒送出的待審留言時，直接打開第一張有草稿的單（草稿顯示在留言串最下面）。
                    const firstDraft = state.items.find((item) => (item.drafts_count ?? 0) > 0);
                    if (firstDraft) {
                        openThread(firstDraft.id);
                    } else {
                        // 沒人操作就彈出來的面板，客戶端只偷看第一張、不標已讀，避免漏看新留言。
                        state.peek = !isOwnerViewer;
                        selectFirst();
                    }
                }
            }
            if (isOpen()) {
                renderList();
                if (state.currentId === null) {
                    selectFirst();
                }
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

    // 對話或附件頁二選一：附件頁隱藏留言串與輸入框。
    // 切到附件頁前記下對話的捲動位置（隱藏後瀏覽器會把捲動歸零），返回時還原；原本在最底就回到最底（含期間新來的留言）。
    const setAlbumView = (show) => {
        if (show && scroller.hidden === false) {
            state.savedScroll = { top: scroller.scrollTop, atBottom: isNearBottom() };
        }
        albumPane.hidden = !show;
        scroller.hidden = show;
        form.hidden = show;
        if (!show && state.savedScroll) {
            const { top, atBottom } = state.savedScroll;
            state.savedScroll = null;
            scroller.scrollTop = atBottom ? scroller.scrollHeight : top;
        }
    };

    // 有新附件時：數字更新、徽章短暫變色並加上「有新附件」提示（只在同一張單的對話裡比較，換單不提示）。
    const noteAlbumCount = (id, total) => {
        const previous = state.albumCounts.get(id);
        state.albumCounts.set(id, total);
        albumCount.textContent = String(total);
        if (previous !== undefined && total > previous) {
            albumOpen.dataset.albumNew = '1';
            albumOpen.title = `有 ${total - previous} 個新附件`;
            window.clearTimeout(state.albumFlashTimer);
            state.albumFlashTimer = window.setTimeout(() => {
                delete albumOpen.dataset.albumNew;
                albumOpen.title = '';
            }, 4000);
        }
    };

    const withoutTimes = (html) => html.replace(/(<time\b[^>]*>)[^<]*(<\/time>)/g, '$1$2');

    const isNearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

    const applyThread = (data, { forceScroll }) => {
        threadNumber.textContent = `編號 ${data.number}`;
        threadStatus.textContent = data.status;
        threadTitle.textContent = data.title;
        threadTitle.title = data.title;
        threadDeleted.hidden = !data.deleted;
        pageLink.href = data.page_url;
        state.postUrl = data.post_url;
        const albumTotal = data.album_count ?? 0;
        noteAlbumCount(data.id, albumTotal);
        if (typeof data.album_html === 'string' && data.album_html !== state.lastAlbumHtml) {
            state.lastAlbumHtml = data.album_html;
            albumBody.innerHTML = data.album_html === '' ? '<p class="py-10 text-center text-sm text-slate-500" data-album-empty>這張單還沒有附件。</p>' : data.album_html;
        }
        if (draftsBox && typeof data.drafts_html === 'string') {
            const openId = data.id;
            renderMessageDrafts(draftsBox, data.drafts_html, {
                onChanged: () => {
                    loadThread(openId, { forceScroll: true });
                    loadList();
                },
            });
        }

        if (data.html !== state.lastThreadHtml && !isEditingMessage(thread)) {
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
                // 刷新時保留使用者展開的相簿與過去的處理說明。
                replaceKeepingOpen(thread, () => {
                    thread.innerHTML = data.html;
                });
            }
            state.lastThreadHtml = data.html;
            if (stickToBottom) {
                scroller.scrollTop = scroller.scrollHeight;
            }
        }

        // 開啟對話即標為已讀，清單與徽章先在本地歸零，下次刷新再以伺服器為準。
        // 同頁清單／看板上這張單的紅色未讀數字與上方未讀提示一併更新。
        if (!state.peek) {
            clearReportUnread(data.id);
        }

        const item = state.items.find((candidate) => candidate.id === data.id);
        if (item && state.peek) {
            renderList();
        } else if (item) {
            item.unread = 0;
            item.adjustment_updated = false;
            item.has_update = false;
            recountBadge();
            renderList();
        }
        syncPage();
    };

    const threadUrl = (id) => {
        const url = state.items.find((item) => item.id === id)?.thread_url
            ?? root.dataset.threadUrlTemplate.replace('__REPORT__', encodeURIComponent(id));

        return state.peek ? `${url}${url.includes('?') ? '&' : '?'}peek=1` : url;
    };

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
        draftsBox?.replaceChildren();
        delete draftsBox?.dataset.signature;
        form.reset();
        errorBox.hidden = true;
        errorBox.textContent = '';
    };

    const openThread = (id) => {
        if (state.currentId !== id) {
            clearComposer();
            state.lastAlbumHtml = '';
            albumBody.replaceChildren();
            albumCount.textContent = '0';
            delete albumOpen.dataset.albumNew;
            state.lastThreadHtml = '';
            thread.replaceChildren(el('p', 'p-6 text-center text-sm text-slate-500', '載入中…'));
            threadTitle.textContent = state.items.find((item) => item.id === id)?.title ?? '';
        }
        state.currentId = id;
        if (!albumPane.hidden && state.albumFor !== id) {
            setAlbumView(false);
        }
        state.albumFor = id;
        placeholder.hidden = true;
        threadView.hidden = false;
        setView('thread');
        // 點到的那張留在原位，先前開著的那張回到依規則的位置。
        state.items = reorder(state.items, id);
        renderList();
        loadThread(id, { forceScroll: true });
    };

    // 右側不留空白：兩欄並排時自動選第一張，清單空了就顯示「目前沒有回饋單」；手機一次只看一欄，不自動選（會在使用者沒看到時標已讀）。
    const selectFirst = ({ force = false } = {}) => {
        if (!isOpen() || !state.loaded || !window.matchMedia('(min-width: 640px)').matches) {
            return;
        }
        const target = autoSelectTarget(visibleItems(state.items, state.tab, search.value), {
            currentId: state.currentId,
            viewing: !threadView.hidden,
            force,
        });
        if (target.action === 'open') {
            openThread(target.id);
        } else if (target.action === 'empty') {
            clearComposer();
            state.currentId = null;
            state.lastThreadHtml = '';
            state.threadRequest += 1;
            threadView.hidden = true;
            placeholder.textContent = EMPTY_THREAD_TEXT;
            placeholder.hidden = false;
            renderList();
        }
    };

    // 偷看中的對話：使用者在右側對話區真的操作（滾輪、點擊、按鍵、聚焦）才標已讀。
    const confirmRead = () => {
        if (!state.peek) {
            return;
        }
        state.peek = false;
        if (state.currentId !== null && !threadView.hidden) {
            loadThread(state.currentId);
        }
    };

    ['wheel', 'touchmove', 'pointerdown', 'keydown', 'focusin'].forEach((type) => {
        threadPane.addEventListener(type, confirmRead, { passive: true });
    });

    document.addEventListener('feedback:messages-changed', () => {
        if (isOpen() && state.currentId !== null) {
            loadThread(state.currentId);
            loadList();
        }
    });

    albumOpen.addEventListener('click', () => setAlbumView(true));
    albumBack.addEventListener('click', () => setAlbumView(false));

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

    const openPanel = ({ autoSelect = true } = {}) => {
        if (isOpen()) {
            return;
        }
        panel.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        document.body.classList.add('max-sm:overflow-hidden');
        state.items = reorder(state.items, null);
        renderList();
        if (autoSelect) {
            selectFirst();
        }
        loadList();
    };

    const closePanel = () => {
        rememberDismissed(sessionStore);
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('max-sm:overflow-hidden');
        launcher.focus({ preventScroll: true });
    };

    tabButtons.forEach((button) => button.addEventListener('click', () => {
        state.peek = false;
        state.tab = button.dataset.chatTab;
        renderList();
        selectFirst({ force: true });
    }));

    launcher.addEventListener('click', () => {
        if (isOpen()) {
            closePanel();

            return;
        }
        state.peek = false;
        openPanel();
        if (state.currentId === null) {
            setView('list');
            search.focus({ preventScroll: true });
        }
    });

    $('[data-chat-close]').addEventListener('click', closePanel);
    $('[data-chat-back]').addEventListener('click', showList);
    search.addEventListener('input', () => {
        state.peek = false;
        renderList();
        selectFirst({ force: true });
    });

    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-chat-item]');
        if (button) {
            state.peek = false;
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
        state.peek = false;
        openPanel({ autoSelect: false });
        openThread(opener.dataset.chatOpen);
    });

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    const send = async () => {
        if (!state.postUrl || sendButton.disabled) {
            return;
        }
        if (bodyInput.value.trim() === '') {
            showError('請輸入留言內容。');
            bodyInput.focus();

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
                showError('圖片／影片太大，請縮小或減少個數後再試。');
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

    // 面板開著：對話每 5 秒、清單每 10 秒刷新；關著：只每 60 秒更新右下角未讀數。分頁在背景時不刷新。
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

    // 詳情視窗內開啟留言也算已讀：本地歸零，下次刷新再以伺服器為準。
    document.addEventListener('feedback:report-read', (event) => {
        const item = state.items.find((candidate) => candidate.id === event.detail?.id);
        if (item && (item.unread > 0 || item.adjustment_updated)) {
            item.unread = 0;
            item.adjustment_updated = false;
            item.has_update = false;
            recountBadge();
            renderList();
            syncPage();
        }
    });

    loadList();
}
