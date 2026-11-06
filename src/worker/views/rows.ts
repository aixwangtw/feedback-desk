/**
 * List rows and board cards of the portal page, built as plain strings.
 *
 * A full page holds 50 of these, and building them as JSX nodes cost 15–30 ms of CPU per page on
 * Workers, above the free plan's 10 ms. The markup here is byte-for-byte the same as the JSX
 * reference components in rows-reference.tsx (a test compares the two).
 *
 * Jira 式：清單只有編號、標題（右邊是未讀小圓點數字）、狀態、建立者、最後更新五欄；看板卡片同樣只留這些。
 * 整列、整張卡片都能點開詳情（client/row-link.js）；編號與標題是藍色連結。
 */
import { statusDotClass, statusLabel, type ReportStatus, type StatusLabels } from '../../shared/status';
import { badgeText, unreadDotLabel } from '../../shared/conversation';
import { formatAbsolute, formatRelative } from '../../shared/time';
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
}

function time(v: ViewContext, at: string, relative = false): string {
    const absolute = formatAbsolute(at, v.cfg.utcOffsetMinutes);
    return `<time datetime="${esc(at)}" title="${esc(`${absolute}（${v.cfg.timezoneName}）`)}">${esc(relative ? formatRelative(at, v.now) : absolute)}</time>`;
}

/** StatusText（components.tsx）：只顯示狀態文字，網頁上沒有改狀態的下拉。 */
function statusTextHtml(status: ReportStatus, labels: StatusLabels): string {
    return `<span class="flex items-center gap-2 sm:justify-center"><span class="size-2.5 shrink-0 rounded-full ${statusDotClass(status)}" aria-hidden="true" data-status-dot="true"></span><span class="text-xs font-semibold text-slate-700" data-status-text="${status}">${esc(statusLabel(status, labels))}</span></span>`;
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

export function listRowHtml(ctx: RowContext, row: PortalRow): string {
    const { v, isOwner } = ctx;
    const report = row.report;
    const id = esc(report.public_id);
    const deleted = report.client_deleted_at !== null;
    let html = `<tr class="block ${ROW_CLICK_CLASS} space-y-1 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle${deleted ? ' bg-slate-50 text-slate-500' : ''}" data-report-row="${id}" data-row-link="detail-report-${id}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<td class="block text-xs font-bold sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-3 sm:align-middle">${reportLinkHtml(ctx, report.public_id, `<span class="sm:hidden">編號 </span><span data-report-number="true">${row.number}</span>`)}</td>`;
    html += `<td class="block sm:table-cell sm:px-4 sm:py-3 sm:align-middle"><div class="flex items-start gap-2">${reportLinkHtml(ctx, report.public_id, esc(report.title), 'min-w-0 break-words text-left font-semibold')}${unreadDotHtml(report.public_id, row.unread)}</div>`;
    if (isOwner && deleted) {
        html += `<span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted="true"><span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">${esc(v.cfg.labels.client)}已刪除</span>${time(v, report.client_deleted_at as string)}</span>`;
    }
    html += '</td>';
    html += `<td class="block sm:table-cell sm:px-3 sm:py-3 sm:align-middle sm:text-center">${statusTextHtml(report.status, v.cfg.statusLabels)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle" data-report-creator="true"><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>${esc(row.creatorLabel)}</td>`;
    html += `<td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span>${time(v, report.latest_activity_at, true)}</td>`;
    html += '</tr>';
    return html;
}

export function boardCardHtml(ctx: RowContext, row: PortalRow, order: number): string {
    const { v, isOwner } = ctx;
    const report = row.report;
    const id = esc(report.public_id);
    const deleted = report.client_deleted_at !== null;
    let html = `<article class="${ROW_CLICK_CLASS} rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm ${CARD_HOVER_CLASS}${deleted ? ' opacity-70' : ''}" data-kanban-card="true" data-report-id="${id}" data-status="${report.status}" data-board-order="${order}" data-row-link="detail-report-${id}" data-dialogs-src="${esc(dialogsSrc(ctx, report.public_id))}">`;
    html += `<p class="text-[11px] font-bold">${reportLinkHtml(ctx, report.public_id, `編號 <span data-report-number="true">${row.number}</span>`)}</p>`;
    html += `<div class="mt-1 flex items-start gap-2">${reportLinkHtml(ctx, report.public_id, esc(report.title), 'min-w-0 break-words text-left text-sm font-semibold leading-5')}${unreadDotHtml(report.public_id, row.unread)}</div>`;
    if (isOwner && deleted) {
        html += `<span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted="true">${esc(v.cfg.labels.client)}已刪除</span>`;
    }
    html += `<p class="mt-3 text-xs text-slate-500" data-report-creator="true">建立者：${esc(row.creatorLabel)}</p>`;
    html += `<p class="mt-1 text-xs text-slate-500">更新於 ${time(v, report.latest_activity_at, true)}</p>`;
    html += '</article>';
    return html;
}
