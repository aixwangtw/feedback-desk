import { TAB_LABELS, type ReportStatus, type StatusLabels } from './status';

/**
 * 狀態切換鈕（清單操作欄、看板卡片、詳情右側窄欄、留言串最下面共用）只有一顆，按一下就切換
 * （2026-11-19 使用者：「操作欄位 完成 待處理 … 不用並列3個」「按一下切換 不是2顆」）：
 * 還沒完成的單顯示「完成」，按了改成已完成；已完成的單顯示「待處理」，按了改回待處理（等工程師）。
 * 客戶與開發團隊都能按；「待回覆」不放按鈕，由回覆時自動切換（lib/reports.ts 的 statusAfterMessage）。
 * 元件：views/components.tsx 的 StatusSwitch（JSX）與 views/rows.ts 的 statusSwitchHtml（字串版，逐位元比對）。
 */
export interface StatusSwitchView {
    /** 按下去要改成的狀態。 */
    target: ReportStatus;
    label: string;
    title: string;
}

export const STATUS_SWITCH_COMPLETE_LABEL = '完成';

export function statusSwitchView(status: ReportStatus, labels: StatusLabels): StatusSwitchView {
    if (status === 'completed') {
        return { target: 'new', label: TAB_LABELS.developer, title: `改回「${TAB_LABELS.developer}」（${labels.new}）` };
    }
    return { target: 'completed', label: STATUS_SWITCH_COMPLETE_LABEL, title: `改成「${labels.completed}」` };
}

export function statusSwitchClass(status: ReportStatus, compact: boolean): string {
    const tone = status === 'completed'
        ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-visible:ring-teal-600'
        : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:ring-emerald-600';
    return `inline-flex items-center justify-center rounded-lg border font-semibold transition focus:outline-none focus-visible:ring-2 ${tone} ${compact ? 'h-8 px-2 text-[11px]' : 'min-h-8 px-3 text-xs'}`;
}
