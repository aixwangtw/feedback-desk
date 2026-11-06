/**
 * Markup pieces of the chat buttons shared by the JSX views, the string row builders (rows.ts, also
 * bundled into the browser script) and the chat panel script. Plain strings only, so the browser
 * bundle does not pull in JSX.
 */

/** Speech-bubble icon of the chat launcher and the chat buttons. */
export const CHAT_ICON_PATHS = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"></path><path d="M8.5 10.5h7M8.5 13.5h4.5"></path>';


/** Team-side summary above the list ("有 N 張單有未讀留言" / "目前沒有未讀留言"). */
export const UNREAD_SUMMARY_TONES = {
    alert: 'border-rose-200 bg-rose-50 text-rose-900',
    calm: 'border-slate-200 bg-white text-slate-600',
} as const;

/** "只看未讀留言" link; the chat panel script adds it back when unread reports appear again. */
export const UNREAD_FILTER_CLASS = 'rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2';

/** 清單、看板標題右邊的未讀小圓點數字：純指示，不能點（chat-panel.js 讀過、刷新時更新）。 */
export const UNREAD_DOT_CLASS = 'grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white';

/** 清單、看板的編號與標題：藍色連結色，滑鼠移上去出現底線與手指游標（照 Jira）。樣式只寫這一份。 */
export const REPORT_LINK_CLASS = 'cursor-pointer text-blue-700 underline-offset-2 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/** 清單整列、看板整張卡片可點（client/row-link.js）：游標與 hover 效果。 */
export const ROW_CLICK_CLASS = 'cursor-pointer';
export const CARD_HOVER_CLASS = 'transition hover:-translate-y-0.5 hover:shadow-lg';
