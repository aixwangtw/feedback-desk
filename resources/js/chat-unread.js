// 清單頁未讀狀態（上方「有 N 張單有未讀留言」提示、各單留言按鈕的紅色數字）怎麼跟著右下角面板的未讀資料更新。
// 只放純邏輯，DOM 套用在 chat-panel.js；與伺服器端 portal.blade.php、message-badges.blade.php 的顯示規則一致。

/** 紅色圓形數字的文字，超過 99 顯示 99+。 */
export const badgeText = (count) => (count > 99 ? '99+' : String(count));

/** 有未讀的單有幾張（開發者端清單上方提示的 N）。 */
export const countUnreadReports = (items) => items.filter((item) => item.unread > 0).length;

/**
 * 面板資料裡每張單的未讀數，以 public_id 為鍵。
 * 正在看的那張（openId）一律當 0：開著的對話每次刷新都會標為已讀，清單資料可能比它早一步取回。
 */
export const unreadById = (items, openId = null) => new Map(items.map((item) => [item.id, item.id === openId ? 0 : item.unread]));

/**
 * 清單上方提示要顯示的樣子，與伺服器端相同：
 * N > 0 時紅底「有 N 張單有未讀留言」並有「只看未讀留言」；N = 0 時白底「目前沒有未讀留言」不給篩選；
 * 正在看「只看未讀留言」時一律只給「顯示全部」。
 *
 * @returns {{ count: number, tone: 'alert'|'calm', filter: 'unread-only'|'show-all'|null }}
 */
export const unreadSummary = (count, { unreadOnly = false } = {}) => {
    let filter = null;
    if (unreadOnly) {
        filter = 'show-all';
    } else if (count > 0) {
        filter = 'unread-only';
    }

    return { count, tone: count > 0 ? 'alert' : 'calm', filter };
};

/** 留言按鈕的 aria-label／title 換成新的未讀數（拿掉舊的未讀片段再視需要補上）。 */
export const withUnreadInLabel = (label, count) => {
    const base = label.replace(/，\d+ 則未讀(?=）$)/, '');
    if (count <= 0) {
        return base;
    }

    return base.endsWith('）') ? `${base.slice(0, -1)}，${count} 則未讀）` : `${base}，${count} 則未讀`;
};

export const withUnreadInTitle = (title, count) => {
    const base = title.replace(/，未讀 \d+$/, '');

    return count > 0 ? `${base}，未讀 ${count}` : base;
};
