// 右下角對話清單的排序，與 FeedbackConversationController::sortKey 同一套規則：
// 1. 有未讀的最前，依最新留言時間新到舊；
// 2. 其次有留言但已讀的，依最新留言時間新到舊；
// 3. 沒有留言的最後，依建立時間新到舊。
// 同時間再依編號新到舊。

const tierOf = (item) => {
    if (item.unread > 0) {
        return 2;
    }

    return item.messages_count > 0 ? 1 : 0;
};

const timeOf = (item, tier) => {
    const iso = tier > 0 && item.latest_at ? item.latest_at : item.created_at;
    const time = Date.parse(iso ?? '');

    return Number.isNaN(time) ? 0 : time;
};

export const compareConversations = (a, b) => {
    const tierA = tierOf(a);
    const tierB = tierOf(b);
    if (tierA !== tierB) {
        return tierB - tierA;
    }

    const timeDiff = timeOf(b, tierB) - timeOf(a, tierA);
    if (timeDiff !== 0) {
        return timeDiff;
    }

    return (b.number ?? 0) - (a.number ?? 0);
};

/**
 * 依規則排序；keepId 那張（正在看的對話）維持在 previousIds 裡的原位，
 * 避免一開啟就因為變成已讀而在清單裡跳走，等離開那張對話或重開面板再歸位。
 */
export const orderConversations = (items, { keepId = null, previousIds = [] } = {}) => {
    const sorted = [...items].sort(compareConversations);
    if (keepId === null) {
        return sorted;
    }

    const previousIndex = previousIds.indexOf(keepId);
    const currentIndex = sorted.findIndex((item) => item.id === keepId);
    if (previousIndex < 0 || currentIndex < 0) {
        return sorted;
    }

    const [kept] = sorted.splice(currentIndex, 1);
    sorted.splice(Math.min(previousIndex, sorted.length), 0, kept);

    return sorted;
};
