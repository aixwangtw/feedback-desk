// 右下角對話面板的「未回覆／已回覆」頁籤與自動展開規則（純邏輯，DOM 在 chat-panel.js）。
// 未回覆＝對方最後發言、自己還沒回（伺服器端算好的 awaiting_reply）；待審留言草稿不算回覆。

export const CHAT_TABS = ['awaiting', 'replied'];

/** 手動收合後記在 sessionStorage，同一次瀏覽不再自動展開。 */
export const CHAT_DISMISSED_KEY = 'feedback-chat-dismissed';

export const filterByTab = (items, tab) => items.filter((item) => (tab === 'awaiting') === (item.awaiting_reply === true));

export const tabCounts = (items) => ({
    awaiting: items.filter((item) => item.awaiting_reply === true).length,
    replied: items.filter((item) => item.awaiting_reply !== true).length,
});

/** 有未回覆、且這次瀏覽沒有手動收合過，就自動展開；sessionStorage 不能用時當作沒收合過。 */
export const shouldAutoOpen = (awaitingTotal, storage) => {
    if (awaitingTotal <= 0) {
        return false;
    }
    try {
        return storage?.getItem(CHAT_DISMISSED_KEY) !== '1';
    } catch {
        return true;
    }
};

export const rememberDismissed = (storage) => {
    try {
        storage?.setItem(CHAT_DISMISSED_KEY, '1');
    } catch {
        // 私密視窗或封鎖網站資料時寫不進去，只是下次重新整理會再自動展開。
    }
};

/** 目前頁籤＋搜尋關鍵字篩出來的清單（面板畫出來的就是這份，自動選第一張也看這份）。 */
export const visibleItems = (items, tab, keyword = '') => {
    const needle = keyword.trim().toLowerCase();
    const tabItems = filterByTab(items, tab);
    if (needle === '') {
        return tabItems;
    }

    return tabItems.filter((item) => item.title.toLowerCase().includes(needle) || String(item.number) === needle.replace(/^#/, ''));
};

/**
 * 面板兩欄並排時右側不留空白：清單是空的就顯示「目前沒有回饋單」，否則選中第一張。
 * force＝使用者剛切頁籤或改搜尋，一律改選第一張；否則已經在看某張對話就不動它。
 * @returns {{action: 'keep'|'open'|'empty', id?: string}}
 */
export const autoSelectTarget = (items, { currentId = null, viewing = false, force = false } = {}) => {
    if (items.length === 0) {
        return { action: 'empty' };
    }
    if (viewing && currentId !== null && (!force || items[0].id === currentId)) {
        return { action: 'keep' };
    }

    return { action: 'open', id: items[0].id };
};

export const EMPTY_THREAD_TEXT = '目前沒有回饋單';
