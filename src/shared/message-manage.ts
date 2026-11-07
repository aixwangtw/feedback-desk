/**
 * 這個人能不能編輯、收回這則留言（只有自己發的）：團隊身分發的留言（owner、agent），任何開發者都可以；
 * 客戶端的留言只有發出的那個帳號（沒有帳號的共用客戶身分只能動同樣沒有帳號的留言）。
 * 網頁（單頁、詳情、面板共用的留言泡泡）、編輯與收回的端點、CLI、MCP、巡檢 API 都用這一個函式。
 */
export function canManageMessage(message: { author_type: 'reporter' | 'owner' | 'agent'; author_client_account_id: number | null }, viewer: { isOwner: boolean; clientAccountId: number | null }): boolean {
    if (message.author_type !== 'reporter') {
        return viewer.isOwner;
    }
    return !viewer.isOwner && message.author_client_account_id === viewer.clientAccountId;
}
