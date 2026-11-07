/**
 * 確認視窗的文字（刪除單、收回留言、捨棄待審留言）全部只寫在這裡，畫面由 views/components.tsx 的 ConfirmDialog
 * 與 client/confirm-dialog.js 共用，不用瀏覽器 confirm()。完成、通過不跳確認（團隊端「完成」是可改字的確認留言視窗，另一個功能）。
 * 使用者原話：「點完成跟刪除都要彈出確認視窗」，更正：「通過、完成不跳」。
 */
export interface ConfirmText {
    title: string;
    message: string;
    confirm: string;
    tone: 'danger';
}

export const CONFIRM_CANCEL = '取消';
export const CONFIRM_DELETE = '確認刪除';

/** 刪除單：團隊端是永久刪除，客戶端是從清單移除。要寫明是哪一張單。 */
export function deleteReportText(title: string, viewerIsOwner: boolean): ConfirmText {
    return viewerIsOwner
        ? { title: '確定要刪除這個問題？', message: `「${title}」與它的截圖、留言紀錄會被永久刪除，無法復原。`, confirm: CONFIRM_DELETE, tone: 'danger' }
        : { title: '確定刪除？', message: `「${title}」刪除後會從清單移除，無法自行復原。`, confirm: CONFIRM_DELETE, tone: 'danger' };
}

/** 收回留言：寫明是哪一則（內容前 40 字）。 */
export function withdrawMessageText(body: string): ConfirmText {
    const flat = body.replace(/\s+/g, ' ').trim();
    const excerpt = [...flat].length > 40 ? `${[...flat].slice(0, 40).join('')}…` : flat;
    return { title: '確定要收回這則留言？', message: `${excerpt === '' ? '這則留言' : `「${excerpt}」`}收回後會直接消失，無法復原。`, confirm: '確認收回', tone: 'danger' };
}

export function discardDraftText(): ConfirmText {
    return { title: '確定捨棄這則待審留言？', message: '捨棄後內容與附件都會刪除，無法復原。', confirm: '確認捨棄', tone: 'danger' };
}
