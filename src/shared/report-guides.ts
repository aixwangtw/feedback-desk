/**
 * 清單頁說明與標示用的固定文字（網頁、測試共用；與 Laravel 版畫面文字一致）。
 */

/** 同一個人在這段時間內重複送出標題、說明都一樣的單會自動合併（lib/merge.ts）。 */
export const AUTO_MERGE_MINUTES = 30;

/** 清單頁的自動合併說明（客戶端與團隊端共用）。 */
export const AUTO_MERGE_GUIDE = `同一個人 ${AUTO_MERGE_MINUTES} 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張）。`;

/**
 * 開發團隊端標題右邊的「待審留言」標示：這張單有還沒送出的回覆草稿。草稿送出前客戶還沒收到回覆，單會停在「待處理」；
 * 送出後依留言規則自動改成「待回覆」（2026-11-20 使用者問「有些等工程師的都有需要審核的留言?」）。客戶端不顯示。
 */
export const DRAFT_BADGE_LABEL = '待審留言';

/** 標示文字：一則只寫「待審留言」，多則接數字。 */
export function draftBadgeText(count: number): string {
    return count > 1 ? `${DRAFT_BADGE_LABEL} ${count}` : DRAFT_BADGE_LABEL;
}

export function draftBadgeTitle(count: number): string {
    return `有 ${count} 則待審留言；點開這張單在留言區下方審核，按「送出」後會自動改成待回覆`;
}

export const DRAFT_BADGE_CLASS = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-300';
