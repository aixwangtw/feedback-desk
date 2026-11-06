// 右下角對話面板裡的待審留言（只有開發團隊拿得到）：草稿帶進輸入框、送出時走草稿的送出端點。
// 純邏輯放這裡，DOM 在 chat-panel.js。

/** 輸入框是空的、或還是上次帶入的草稿原文時，才用（新的）草稿內容覆蓋；使用者改過就保留他的文字。 */
export const shouldFillComposer = (currentText, lastLoadedBody) => currentText.trim() === '' || currentText === lastLoadedBody;

export const nextDraftIndex = (index, total) => (total <= 0 ? 0 : (index + 1) % total);

export const draftMeta = (draft, index, total) => {
    const parts = [`${draft.author}寫的`];
    if (total > 1) {
        parts.push(`第 ${index + 1}／${total} 則`);
    }
    if (draft.attachments_count > 0) {
        parts.push(`附件 ${draft.attachments_count} 個會一起送出`);
    }

    return parts.join('・');
};

/** 送出草稿時的表單欄位：只有 CSRF token 與輸入框文字（伺服器會去頭尾空白、空白會被拒絕）。 */
export const draftFormFields = (token, body) => [['_token', token], ['body', body]];

/** 面板裡草稿附件的呈現方式：影片直接播、圖片縮圖點了開大圖（網址都是 feedback.drafts.file，只有開發團隊拿得到）。 */
export const draftAttachmentViews = (draft) => (draft.attachments ?? []).map((file) => ({
    kind: file.is_video ? 'video' : 'image',
    url: file.url,
    name: file.name,
}));
