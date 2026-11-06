/**
 * 右下角對話面板裡的待審留言（只有開發團隊拿得到）：草稿帶進輸入框、送出時走草稿的送出端點。
 * 純邏輯放這裡，DOM 在 client/chat-panel.js。
 */

/** 輸入框是空的、或還是上次帶入的草稿原文時，才用（新的）草稿內容覆蓋；使用者改過就保留他的文字。 */
export function shouldFillComposer(currentText: string, lastLoadedBody: string | null): boolean {
    return currentText.trim() === '' || currentText === lastLoadedBody;
}

export function nextDraftIndex(index: number, total: number): number {
    return total <= 0 ? 0 : (index + 1) % total;
}

/** 草稿說明列：誰寫的、第幾則、附件會一起送出。 */
export function draftMeta(draft: { author: string; attachments_count: number }, index: number, total: number): string {
    const parts = [`${draft.author}寫的`];
    if (total > 1) {
        parts.push(`第 ${index + 1}／${total} 則`);
    }
    if (draft.attachments_count > 0) {
        parts.push(`附件 ${draft.attachments_count} 個會一起送出`);
    }
    return parts.join('・');
}

/** 送出草稿時的表單內容：只有輸入框文字（伺服器會去頭尾空白、空白會被拒絕），不帶面板選的附圖。 */
export function draftSendParams(body: string): URLSearchParams {
    return new URLSearchParams([['body', body]]);
}

/** 面板裡草稿附件的呈現方式：影片直接播、圖片縮圖點了開大圖（網址是草稿附件路由，只有開發團隊拿得到）。 */
export function draftAttachmentViews(draft: { attachments?: Array<{ url: string; name: string; is_video: boolean }> }): Array<{ kind: 'video' | 'image'; url: string; name: string }> {
    return (draft.attachments ?? []).map((file) => ({ kind: file.is_video ? 'video' : 'image', url: file.url, name: file.name }));
}
