/**
 * 右下角對話面板的「未回覆／已回覆」頁籤與自動展開規則（純邏輯；DOM 在 client/chat-panel.js）。
 * 未回覆＝單未完成，且對方最後發言、自己還沒回（伺服器端算好的 awaiting_reply）；待審留言草稿不算回覆。
 */
export const CHAT_TABS = ['awaiting', 'replied'] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

/** 手動收合後記在 sessionStorage，同一次瀏覽不再自動展開。 */
export const CHAT_DISMISSED_KEY = 'feedback-chat-dismissed';

/** The part of Web Storage used here (no DOM lib in the Worker build). */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/**
 * 對方最後發言：看正式留言的最後一則作者；沒有留言時以開單的一方當最後發言者（客戶或公開回報開的單
 * 算客戶方，團隊開的算團隊方）。團隊端看「客戶最後發言」，客戶端看「團隊最後發言」。已完成的單不算。
 */
export function isAwaitingReply(status: string, latestAuthor: 'reporter' | 'owner' | 'agent' | null, creatorType: string, isOwner: boolean): boolean {
    if (status === 'completed') {
        return false;
    }
    const clientSpokeLast = latestAuthor !== null ? latestAuthor === 'reporter' : creatorType === 'client' || creatorType === 'public';
    return isOwner ? clientSpokeLast : !clientSpokeLast;
}

export function filterByTab<T extends { awaiting_reply?: boolean }>(items: T[], tab: ChatTab): T[] {
    return items.filter((item) => (tab === 'awaiting') === (item.awaiting_reply === true));
}

export function chatTabCounts(items: Array<{ awaiting_reply?: boolean }>): Record<ChatTab, number> {
    const awaiting = items.filter((item) => item.awaiting_reply === true).length;
    return { awaiting, replied: items.length - awaiting };
}

/** 有未回覆、且這次瀏覽沒有手動收合過，就自動展開；sessionStorage 不能用時當作沒收合過。 */
export function shouldAutoOpen(awaitingTotal: number, storage: StorageLike | null | undefined): boolean {
    if (awaitingTotal <= 0) {
        return false;
    }
    try {
        return storage?.getItem(CHAT_DISMISSED_KEY) !== '1';
    } catch {
        return true;
    }
}

export function rememberDismissed(storage: StorageLike | null | undefined): void {
    try {
        storage?.setItem(CHAT_DISMISSED_KEY, '1');
    } catch {
        // 私密視窗或封鎖網站資料時寫不進去，只是下次重新整理會再自動展開。
    }
}

/** window.sessionStorage itself can throw (blocked site data); null then. */
export function sessionStorageOrNull(): StorageLike | null {
    try {
        return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
    } catch {
        return null;
    }
}
