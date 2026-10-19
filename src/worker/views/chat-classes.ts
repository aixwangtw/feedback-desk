/**
 * Markup pieces of the chat buttons shared by the JSX views, the string row builders (rows.ts, also
 * bundled into the browser script) and the chat panel script. Plain strings only, so the browser
 * bundle does not pull in JSX.
 */

/** Speech-bubble icon of the chat launcher and the chat buttons. */
export const CHAT_ICON_PATHS = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"></path><path d="M8.5 10.5h7M8.5 13.5h4.5"></path>';

export const CHAT_BUTTON_BASE = 'relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg align-middle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';
export const CHAT_BUTTON_ICON = 'size-8 text-slate-500 hover:bg-teal-50 hover:text-teal-700';
export const CHAT_BUTTON_LABELLED = 'min-h-10 border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-800 hover:bg-teal-100';
export const CHAT_UNREAD_BADGE = 'absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white';

/** Team-side summary above the list ("有 N 張單有未讀留言" / "目前沒有未讀留言"). */
export const UNREAD_SUMMARY_TONES = {
    alert: 'border-rose-200 bg-rose-50 text-rose-900',
    calm: 'border-slate-200 bg-white text-slate-600',
} as const;

/** "只看未讀留言" link; the chat panel script adds it back when unread reports appear again. */
export const UNREAD_FILTER_CLASS = 'rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2';
