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
