/**
 * List rows and board cards of the portal page, built as plain strings.
 *
 * A full page holds 50 of these, and building them as JSX nodes cost 15–30 ms of CPU per page on
 * Workers, above the free plan's 10 ms. The markup here is byte-for-byte the same as the JSX
 * reference components in rows-reference.tsx (a test compares the two).
 *
 * Jira 式：標題右邊是未讀小圓點數字（取代留言按鈕與「N 則未讀」標籤），標題旁沒有標籤、每列沒有留言按鈕、沒有調整重點欄；
 * 其餘欄位照改版前：編號、標題、狀態、分類、附件、建立者、建立日期、最後更新、操作（編輯、刪除；客戶端另有完成）。
 * 整列、整張卡片都能點開詳情（client/row-link.js）；編號與標題是藍色連結。
 */
import { isVideoMime } from '../../shared/attachment-rules';
import { COMPLETE_CONFIRM, statusDotClass, statusLabel, type ReportStatus, type StatusLabels } from '../../shared/status';
import { badgeText, unreadDotLabel } from '../../shared/conversation';
import { formatAbsolute, formatRelative } from '../../shared/time';
import type { Attachment, Report } from '../lib/models';
import { paths } from '../routes/paths';
import { CARD_HOVER_CLASS, REPORT_LINK_CLASS, ROW_CLICK_CLASS, UNREAD_DOT_CLASS } from './chat-classes';
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

/** AttachmentMedia（components.tsx）的字串版：圖片 <img>；mp4 影片抓第一格畫面並疊播放三角形。 */
export function attachmentMediaHtml(src: string, name: string, mime: string | null | undefined, className: string): string {
    if (!isVideoMime(mime)) {
        return `<img src="${esc(src)}" alt="${esc(name)}" class="${className}" loading="lazy"/>`;
    }
    return `<span class="relative block overflow-hidden bg-slate-900 ${className}" data-attachment-video="true"><video muted="" playsinline="" preload="metadata" src="${esc(`${src}#t=0.1`)}" class="pointer-events-none size-full object-cover" aria-hidden="true" tabindex="-1"></video><span class="pointer-events-none absolute inset-0 grid place-items-center"><span class="grid size-7 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80"><svg class="ml-0.5 size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></span></span><span class="sr-only">影片：${esc(name)}</span></span>`;
}

function thumb(href: string, attachment: Pick<Attachment, 'original_name' | 'mime_type'>): string {
    const name = attachment.original_name;
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger="true" data-lightbox-alt="${esc(name)}" title="${isVideoMime(attachment.mime_type) ? '開新分頁播放' : '放大預覽'}">${attachmentMediaHtml(href, name, attachment.mime_type, 'size-full object-cover')}</a>`;
}

function dialogsSrc(ctx: RowContext, publicId: string): string {
    return `${paths.reportDialogs(ctx.slug, publicId)}?back=${encodeURIComponent(ctx.backPath)}`;
}

/** UnreadDot（components.tsx）：標題右邊的未讀小圓點數字；沒有未讀時只留空的容器，讀過或刷新時由 chat-panel.js 填入或清掉。 */
export function unreadDotHtml(publicId: string, unread: number): string {
    const label = esc(unreadDotLabel(unread));
    const dot = unread > 0 ? `<span class="${UNREAD_DOT_CLASS}" data-unread-dot="" title="${label}" aria-label="${label}">${badgeText(unread)}</span>` : '';
    return `<span class="inline-flex shrink-0 items-center" data-unread-slot="${esc(publicId)}">${dot}</span>`;
}

/** ReportLink（components.tsx）：編號與標題的藍色連結；點了開詳情視窗，沒有 JS 時照連結去單頁。 */
export function reportLinkHtml(ctx: RowContext, publicId: string, inner: string, extra = ''): string {
    const id = esc(publicId);
    return `<a href="${esc(paths.report(ctx.slug, publicId))}" class="${REPORT_LINK_CLASS}${extra === '' ? '' : ` ${extra}`}" data-dialog-open="detail-report-${id}" data-report-detail-open="true">${inner}</a>`;
}

const TRASH = '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>';

export function listRowHtml(ctx: RowContext, row: PortalRow): string {
    const { v, slug, isOwner } = ctx;
    const report = row.report;
    const id = esc(report.public_id);
    const deleted = report.client_deleted_at !== null;
    const url = (attachment: Attachment) => paths.attachment(slug, report.public_id, attachment.id);
    const back = `<input type="hidden" name="_back" value="${esc(ctx.backPath)}"/>`;
    let html = `<tr class="block ${ROW_CLICK_CLASS} space-y-1 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle${deleted ? ' bg-slate-50 text-slate-500' : ''}" data-report-row="${id}" data-row-link="detail-report-${id}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<td class="block text-xs font-bold sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-3 sm:align-middle">${reportLinkHtml(ctx, report.public_id, `<span class="sm:hidden">編號 </span><span data-report-number="true">${row.number}</span>`)}</td>`;
    html += `<td class="block sm:table-cell sm:px-4 sm:py-3 sm:align-middle"><div class="flex items-start gap-2">${reportLinkHtml(ctx, report.public_id, esc(report.title), 'min-w-0 break-words text-left font-semibold')}${unreadDotHtml(report.public_id, row.unread)}</div>`;
    if (isOwner && deleted) {
        html += `<span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted="true"><span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">${esc(v.cfg.labels.client)}已刪除</span>${time(v, report.client_deleted_at as string)}</span>`;
    }
    html += '</td>';
    html += `<td class="block sm:table-cell sm:px-3 sm:py-3 sm:align-middle sm:text-center">${statusTextHtml(report.status, v.cfg.statusLabels)}</td>`;
    if (ctx.showCategory) {
        html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle" data-report-category="true"><span class="font-semibold text-slate-500 sm:hidden">分類：</span>${(ctx.categories ?? []).length > 0 ? categorySelectHtml(ctx, report, 'row-category', 'justify-start sm:justify-center') : esc(report.category || '未分類')}</td>`;
    }
    html += '<td class="block empty:hidden sm:table-cell sm:text-center sm:px-3 sm:py-3 sm:align-middle">';
    if (row.attachments.length > 0) {
        html += '<div class="flex flex-wrap gap-1 sm:justify-center">';
        for (const attachment of row.attachments) html += thumb(url(attachment), attachment);
        html += '</div>';
    } else {
        html += '<span class="text-xs text-slate-400">—</span>';
    }
    html += '</td>';
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle" data-report-creator="true"><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>${esc(row.creatorLabel)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span>${time(v, report.created_at)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span>${time(v, report.latest_activity_at, true)}</td>`;
    html += `<td class="block sm:table-cell sm:px-3 sm:py-3 sm:align-middle sm:text-center"><div class="flex flex-wrap gap-2 sm:justify-center"><button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="edit-report-${id}">編輯</button>`;
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
    const url = (attachment: Attachment) => paths.attachment(slug, report.public_id, attachment.id);
    const back = `<input type="hidden" name="_back" value="${esc(ctx.backPath)}"/>`;
    const deleted = report.client_deleted_at !== null;
    let html = `<article class="${ROW_CLICK_CLASS} rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm ${CARD_HOVER_CLASS}${deleted ? ' opacity-70' : ''}" data-kanban-card="true" data-report-id="${id}" data-status="${report.status}" data-board-order="${order}" data-row-link="detail-report-${id}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<div class="flex items-start gap-2"><div class="min-w-0 flex-1"><p class="text-[11px] font-bold">${reportLinkHtml(ctx, report.public_id, `編號 <span data-report-number="true">${row.number}</span>`)}</p>`;
    if ((ctx.categories ?? []).length > 0) {
        html += categorySelectHtml(ctx, report, 'card-category', 'mt-1');
    }
    html += '</div>';
    const complete =
        !isOwner && report.status !== 'completed'
            ? `<form method="post" action="${esc(paths.reportStatus(slug, report.public_id))}" data-confirm="${COMPLETE_CONFIRM}">${back}<input type="hidden" name="status" value="completed"/><button type="submit" class="inline-flex h-8 cursor-pointer items-center rounded-lg px-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-card-action="true" data-complete-report="true">完成</button></form>`
            : '';
    html += `<div class="flex shrink-0 items-center gap-1" data-card-actions="true">${complete}<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="編輯「${title}」" title="編輯" data-card-action="true" data-dialog-open="edit-report-${id}"><svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>`;
    if (isOwner && deleted) {
        html += `<form method="post" action="${esc(paths.reportRestore(slug, report.public_id))}">${back}<button type="submit" class="grid size-8 cursor-pointer place-items-center rounded-lg text-teal-700 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="還原「${title}」" title="還原" data-card-action="true" data-restore-report="true"><svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg></button></form>`;
    }
    html += isOwner
        ? `<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「${title}」" title="刪除" data-card-action="true" data-dialog-open="delete-report-${id}" data-delete-report="true">${TRASH}</button>`
        : `<button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「${title}」" title="刪除" data-card-action="true" data-dialog-open="client-delete-report-${id}" data-client-delete-report="true">${TRASH}</button>`;
    html += '</div></div>';
    html += `<div class="mt-1 flex items-start gap-2">${reportLinkHtml(ctx, report.public_id, esc(report.title), 'min-w-0 break-words text-left text-sm font-semibold leading-5')}${unreadDotHtml(report.public_id, row.unread)}</div>`;
    if (isOwner && deleted) {
        html += `<span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted="true">${esc(v.cfg.labels.client)}已刪除</span>`;
    }
    const first = row.attachments[0];
    if (first) {
        html += `<div class="mt-3 flex items-center gap-2">${thumb(url(first), first)}<span class="text-xs font-medium text-slate-500">${row.attachments.length} 張附件</span></div>`;
    }
    html += `<p class="mt-3 text-xs text-slate-500" data-report-creator="true">建立者：${esc(row.creatorLabel)}</p>`;
    html += `<p class="mt-1 text-xs text-slate-500">更新於 ${time(v, report.latest_activity_at, true)}</p>`;
    html += '</article>';
    return html;
}
