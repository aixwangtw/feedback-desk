/**
 * 「完成」鈕（清單、看板卡片、詳情右側窄欄共用）的樣式與提示文字，只寫這一份。
 * 客戶端按了先確認再把單改成已完成；開發團隊端按了跳出可改字的確認留言視窗，單維持等客戶、留言附「通過」按鈕，不直接結案。
 * 元件：views/components.tsx 的 CompleteButton（JSX）與 views/rows.ts 的 completeButtonHtml（字串版，逐位元比對）。
 */
export function completeButtonClass(compact: boolean): string {
    return `inline-flex items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${compact ? 'h-8 px-2 text-[11px]' : 'min-h-8 px-3 text-xs'}`;
}

/** 團隊端按鈕的提示文字（滑鼠移上去才看得到，不佔版面）。 */
export function teamCompleteTitle(clientLabel: string, approveLabel: string): string {
    return `發一則確認留言，請${clientLabel}按「${approveLabel}」確認；單維持等${clientLabel}，不會直接結案`;
}
