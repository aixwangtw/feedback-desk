/**
 * List rows and board cards of the portal page, built as plain strings.
 *
 * A full page holds 50 of these, and building them as JSX nodes cost 15–30 ms of CPU per page on
 * Workers, above the free plan's 10 ms. The markup here is byte-for-byte the same as the JSX
 * reference components in rows-reference.tsx (a test compares the two).
 */
import { COMPLETE_CONFIRM, statusDotClass, statusLabel, WAITING_STATUS, type ReportStatus, type StatusLabels } from '../../shared/status';
import { badgeText, chatButtonLabels } from '../../shared/conversation';
import { formatAbsolute, formatRelative } from '../../shared/time';
import type { Attachment, Report } from '../lib/models';
import { paths } from '../routes/paths';
import { CHAT_BUTTON_BASE, CHAT_BUTTON_ICON, CHAT_ICON_PATHS, CHAT_UNREAD_BADGE } from './chat-classes';
import type { ViewContext } from './components';
import type { PortalRow } from './portal';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };

export function esc(value: unknown): string {
    const text = String(value);
    return /[&<>'"]/.test(text) ? text.replace(/[&<>'"]/g, (char) => ESCAPES[char]) : text;
}

export interface RowContext {
    v: ViewContext;
    slug: string;
    isOwner: boolean;
    backPath: string;
    /** 有設定開單分類的站：列表多一欄分類。 */
    showCategory?: boolean;
    /** 專案的開單分類；有值時分類欄與看板卡片顯示可直接切換的下拉。 */
    categories?: string[];
}

/** 與 views/report.tsx 的 CategoryAutosave（compact）輸出相同的 HTML。 */
export function categorySelectHtml(ctx: RowContext, report: Report, idPrefix: string, extraClass: string): string {
    const categories = ctx.categories ?? [];
    const current = report.category ?? '';
    const options = current !== '' && !categories.includes(current) ? [...categories, current] : categories;
    const id = esc(`${idPrefix}-${report.public_id}`);
    let html = `<form method="post" action="${esc(paths.reportCategory(ctx.slug, report.public_id))}" class="flex flex-wrap items-center gap-2 text-xs ${extraClass}" data-category-form="true" data-report-public-id="${esc(report.public_id)}">`;
    html += `<input type="hidden" name="_back" value="${esc(ctx.backPath)}"/><label for="${id}" class="sr-only">分類</label>`;
    html += `<select id="${id}" name="category" class="h-8 w-28 shrink-0 px-2 py-0 rounded-lg border border-slate-300 bg-white text-xs shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10" data-category-autosave="true">`;
    html += `<option value=""${current === '' ? ' selected=""' : ''}>未分類</option>`;
    for (const option of options) {
        html += `<option value="${esc(option)}"${option === current ? ' selected=""' : ''}>${esc(option)}</option>`;
    }
    html += '</select><noscript><button type="submit" class="font-semibold text-teal-700">儲存</button></noscript><span class="text-[11px] empty:hidden text-slate-500" data-category-feedback="true" aria-live="polite"></span></form>';
    return html;
}

function time(v: ViewContext, at: string, relative = false): string {
    const absolute = formatAbsolute(at, v.cfg.utcOffsetMinutes);
    return `<time datetime="${esc(at)}" title="${esc(`${absolute}（${v.cfg.timezoneName}）`)}">${esc(relative ? formatRelative(at, v.now) : absolute)}</time>`;
}


/** StatusText（components.tsx）：只顯示狀態文字，網頁上沒有改狀態的下拉。 */
function statusTextHtml(status: ReportStatus, labels: StatusLabels): string {
    return `<span class="flex items-center gap-2 sm:justify-center"><span class="size-2.5 shrink-0 rounded-full ${statusDotClass(status)}" aria-hidden="true" data-status-dot="true"></span><span class="text-xs font-semibold text-slate-700" data-status-text="${status}">${esc(statusLabel(status, labels))}</span></span>`;
}

function thumb(href: string, name: string, border = 'border-slate-200', adjustment = false): string {
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border ${border} bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger="true" data-lightbox-alt="${esc(name)}"${adjustment ? ' data-adjustment-image=""' : ''} title="放大預覽"><img src="${esc(href)}" alt="${esc(name)}" class="size-full object-cover" loading="lazy"/></a>`;
}

function dialogsSrc(ctx: RowContext, publicId: string): string {
    return `${paths.reportDialogs(ctx.slug, publicId)}?back=${encodeURIComponent(ctx.backPath)}`;
}

/** Icon variant of ChatButton (components.tsx); empty without messages and unread items. */
export function chatButtonHtml(isOwner: boolean, publicId: string, title: string, row: Pick<PortalRow, 'unread' | 'messagesCount'>, extra = ''): string {
    const total = row.messagesCount;
    const unread = row.unread;
    if (total <= 0 && unread <= 0) {
        return '';
    }
    const labels = chatButtonLabels(title, total, unread);
    let html = `<button type="button" class="${CHAT_BUTTON_BASE} ${CHAT_BUTTON_ICON}${extra === '' ? '' : ` ${extra}`}" data-chat-open="${esc(publicId)}" data-message-count="${total}" aria-label="${esc(labels.ariaLabel)}" title="${esc(labels.title)}">`;
    html += `<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CHAT_ICON_PATHS}</svg>`;
    if (unread > 0) {
        html += `<span class="${CHAT_UNREAD_BADGE}" data-unread-badge=""${isOwner ? '' : ' data-new-reply-badge=""'}>${badgeText(unread)}</span>`;
    }
    return `${html}</button>`;
}

/** ReportFlags in rows-reference.tsx: 紅底「N 則未讀」與團隊端「待審留言 N」。 */
export function reportFlagsHtml(ctx: RowContext, row: PortalRow, extra: string): string {
    const id = esc(row.report.public_id);
    const drafts = ctx.isOwner ? row.drafts ?? 0 : 0;
    const waiting = row.waiting === 'developer' || row.waiting === 'client' ? row.waiting : null;
    if (row.unread <= 0 && drafts <= 0 && waiting === null) {
        return '';
    }
    let html = `<div class="flex flex-wrap items-center gap-1.5 ${extra}" data-report-flags="true">`;
    if (waiting) {
        html += `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-700 ring-1 ring-inset ring-slate-200" data-waiting="${waiting}">${esc(ctx.v.cfg.statusLabels[WAITING_STATUS[waiting]])}</span>`;
    }
    if (row.unread > 0) {
        html += `<button type="button" class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold leading-4 text-white shadow-sm hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-chat-open="${id}" data-unread-flag="${id}">${badgeText(row.unread)} 則未讀</button>`;
    }
    if (drafts > 0) {
        html += `<a href="${esc(`${paths.report(ctx.slug, row.report.public_id)}#message-drafts`)}" class="inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-amber-900 hover:bg-amber-100" data-draft-badge="${id}" title="有待審留言，只有團隊看得到">待審留言 ${drafts}</a>`;
    }
    return `${html}</div>`;
}

const TRASH = '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>';

export function listRowHtml(ctx: RowContext, row: PortalRow): string {
    const { v, slug, isOwner } = ctx;
    const report = row.report;
    const id = esc(report.public_id);
    const title = esc(report.title);
    const deleted = report.client_deleted_at !== null;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || row.adjustmentAttachments.length > 0;
    const url = (attachment: Attachment) => paths.attachment(slug, report.public_id, attachment.id);
    const back = `<input type="hidden" name="_back" value="${esc(ctx.backPath)}"/>`;
    let html = `<tr class="block space-y-2 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle${deleted ? ' bg-slate-50 text-slate-500' : ''}" data-report-row="${id}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<td class="block text-xs font-bold text-slate-500 sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-2 sm:align-middle"><span class="sm:hidden">編號 </span><span data-report-number="true">${row.number}</span></td>`;
    html += `<td class="block sm:table-cell sm:px-4 sm:py-2 sm:align-middle"><div class="flex items-start gap-2"><button type="button" class="min-w-0 flex-1 text-left font-semibold text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-${id}" data-report-detail-open="true">${title}</button>${chatButtonHtml(isOwner, report.public_id, report.title, row, '-my-1')}</div>${reportFlagsHtml(ctx, row, 'mt-1')}`;
    if (isOwner && deleted) {
        html += `<span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted="true"><span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">${esc(v.cfg.labels.client)}已刪除</span>${time(v, report.client_deleted_at as string)}</span>`;
    }
    html += '</td>';
    html += `<td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center">${statusTextHtml(report.status, v.cfg.statusLabels)}</td>`;
    if (ctx.showCategory) {
        html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-category="true"><span class="font-semibold text-slate-500 sm:hidden">分類：</span>${(ctx.categories ?? []).length > 0 ? categorySelectHtml(ctx, report, 'row-category', 'justify-start sm:justify-center') : esc(report.category || '未分類')}</td>`;
    }
    html += '<td class="block empty:hidden sm:table-cell sm:text-center sm:px-3 sm:py-2 sm:align-middle">';
    if (row.attachments.length > 0) {
        html += '<div class="flex flex-wrap gap-1 sm:justify-center">';
        for (const attachment of row.attachments) html += thumb(url(attachment), attachment.original_name);
        html += '</div>';
    } else {
        html += '<span class="text-xs text-slate-400">—</span>';
    }
    html += '</td>';
    html += '<td class="block sm:max-w-64 sm:table-cell sm:px-3 sm:py-2 sm:align-middle"><span class="text-xs font-semibold text-slate-500 sm:hidden">調整重點：</span>';
    if (hasAdjustment) {
        if (report.adjustment_note) {
            const note = esc(report.adjustment_note);
            html += `<button type="button" class="block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title="${note}" aria-label="預覽「${title}」的調整重點" data-dialog-open="detail-report-${id}" data-adjustment-preview="true"><span class="line-clamp-3 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note="true">${note}</span></button>`;
        }
        if (row.adjustmentAttachments.length > 0) {
            html += '<div class="mt-1 flex flex-wrap gap-1">';
            for (const attachment of row.adjustmentAttachments) html += thumb(url(attachment), attachment.original_name, 'border-teal-200', true);
            html += '</div>';
        }
    } else {
        html += '<span class="text-xs text-slate-400">—</span>';
    }
    html += '</td>';
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-creator="true"><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>${esc(row.creatorLabel)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span>${time(v, report.created_at)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span>${time(v, report.latest_activity_at, true)}</td>`;
    html += `<td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center"><div class="flex flex-wrap gap-2 sm:justify-center"><button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="edit-report-${id}">編輯</button>`;
    if (!isOwner && report.status !== 'completed') {
        html += `<form method="post" action="${esc(paths.reportStatus(slug, report.public_id))}" data-confirm="${COMPLETE_CONFIRM}">${back}<input type="hidden" name="status" value="completed"/><button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-complete-report="true">完成</button></form>`;
    }
    if (isOwner && deleted) {
        html += `<form method="post" action="${esc(paths.reportRestore(slug, report.public_id))}">${back}<button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report="true">還原</button></form>`;
    }
    html += isOwner
        ? `<button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="delete-report-${id}" data-delete-report="true">刪除</button>`
        : `<button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="client-delete-report-${id}" data-client-delete-report="true">刪除</button>`;
    html += '</div></td></tr>';
    return html;
}

export function boardCardHtml(ctx: RowContext, row: PortalRow, order: number): string {
    const { v, slug, isOwner } = ctx;
    const report = row.report;
    const id = esc(report.public_id);
    const title = esc(report.title);
    const deleted = report.client_deleted_at !== null;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || row.adjustmentAttachments.length > 0;
    const url = (attachment: Attachment) => paths.attachment(slug, report.public_id, attachment.id);
    const back = `<input type="hidden" name="_back" value="${esc(ctx.backPath)}"/>`;
    let html = `<article class="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md${deleted ? ' opacity-70' : ''}" data-kanban-card="true" data-report-id="${id}" data-status="${report.status}" data-board-order="${order}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<div class="flex items-start gap-2"><div class="min-w-0 flex-1"><p class="text-[11px] font-bold text-slate-500">編號 <span data-report-number="true">${row.number}</span></p>${reportFlagsHtml(ctx, row, 'mt-1')}`;
    if ((ctx.categories ?? []).length > 0) {
        html += categorySelectHtml(ctx, report, 'card-category', 'mt-1');
    }
    html += `<button type="button" class="mt-1 block w-full break-words text-left text-sm font-semibold leading-5 text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-${id}" data-report-detail-open="true">${title}</button></div>`;
    const complete =
        !isOwner && report.status !== 'completed'
            ? `<form method="post" action="${esc(paths.reportStatus(slug, report.public_id))}" data-confirm="${COMPLETE_CONFIRM}">${back}<input type="hidden" name="status" value="completed"/><button type="submit" class="inline-flex h-8 cursor-pointer items-center rounded-lg px-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-card-action="true" data-complete-report="true">完成</button></form>`
            : '';
    html += `<div class="flex shrink-0 items-center gap-1" data-card-actions="true">${chatButtonHtml(isOwner, report.public_id, report.title, row)}${complete}<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="編輯「${title}」" title="編輯" data-card-action="true" data-dialog-open="edit-report-${id}"><svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>`;
    if (isOwner && deleted) {
        html += `<form method="post" action="${esc(paths.reportRestore(slug, report.public_id))}">${back}<button type="submit" class="grid size-8 cursor-pointer place-items-center rounded-lg text-teal-700 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="還原「${title}」" title="還原" data-card-action="true" data-restore-report="true"><svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg></button></form>`;
    }
    html += isOwner
        ? `<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「${title}」" title="刪除" data-card-action="true" data-dialog-open="delete-report-${id}" data-delete-report="true">${TRASH}</button>`
        : `<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「${title}」" title="刪除" data-card-action="true" data-dialog-open="client-delete-report-${id}" data-client-delete-report="true">${TRASH}</button>`;
    html += '</div></div>';
    if (isOwner && deleted) {
        html += `<span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted="true">${esc(v.cfg.labels.client)}已刪除</span>`;
    }
    const first = row.attachments[0];
    if (first) {
        html += `<div class="mt-3 flex items-center gap-2">${thumb(url(first), first.original_name)}<span class="text-xs font-medium text-slate-500">${row.attachments.length} 張附件</span></div>`;
    }
    if (hasAdjustment) {
        html += '<div class="mt-3 rounded-lg border border-teal-100 bg-teal-50/60 p-2" data-adjustment-card="true"><p class="text-[11px] font-bold text-teal-800">調整重點</p>';
        if (report.adjustment_note) {
            const note = esc(report.adjustment_note);
            html += `<button type="button" class="mt-1 block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title="${note}" aria-label="預覽「${title}」的調整重點" data-dialog-open="detail-report-${id}" data-adjustment-preview="true"><span class="line-clamp-2 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note="true">${note}</span></button>`;
        }
        const firstAdjustment = row.adjustmentAttachments[0];
        if (firstAdjustment) {
            html += `<div class="mt-2 flex items-center gap-2">${thumb(url(firstAdjustment), firstAdjustment.original_name, 'border-slate-200', true)}<button type="button" class="rounded text-xs font-medium text-slate-500 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="預覽全部調整圖" data-dialog-open="detail-report-${id}" data-adjustment-preview="true">${row.adjustmentAttachments.length} 張調整圖</button></div>`;
        }
        html += '</div>';
    }
    html += `<p class="mt-3 text-xs text-slate-500" data-report-creator="true">建立者：${esc(row.creatorLabel)}</p>`;
    html += `<p class="mt-3 text-xs text-slate-500">更新於 ${time(v, report.latest_activity_at, true)}</p>`;
    html += '</article>';
    return html;
}
