/**
 * JSX versions of the portal list rows and board cards. Production renders them with the string
 * builders in rows.ts (faster on Workers); this file is the readable reference that the test
 * compares against byte for byte.
 */
import type { FC } from 'hono/jsx';
import { CARD_HOVER_CLASS, ROW_CLICK_CLASS } from './chat-classes';
import { paths } from '../routes/paths';
import { AttachmentThumbs, CompleteButton, cx, ReportLink, StatusText, Time, UnreadDot, type ViewContext } from './components';
import type { PortalRow } from './portal';
import { CategoryAutosave } from './report';

const ICON_TRASH = (
    <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
);

function dialogsSrc(slug: string, publicId: string, backPath: string): string {
    return `${paths.reportDialogs(slug, publicId)}?back=${encodeURIComponent(backPath)}`;
}

export type RowProps = { v: ViewContext; row: PortalRow; slug: string; isOwner: boolean; backPath: string; showCategory?: boolean; categories?: string[] };

export const ListRow: FC<RowProps> = ({ v, row, slug, isOwner, backPath, showCategory, categories }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    const labels = v.cfg.labels;
    return (
        <tr class={cx('block', ROW_CLICK_CLASS, 'space-y-1 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle', deleted ? 'bg-slate-50 text-slate-500' : null)} data-report-row={report.public_id} data-row-link={`detail-report-${report.public_id}`} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <td class="block text-xs font-bold sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-2 sm:py-3 sm:align-middle">
                <ReportLink slug={slug} publicId={report.public_id}><span class="sm:hidden">編號 </span><span data-report-number>{row.number}</span></ReportLink>
            </td>
            <td class="block sm:table-cell sm:px-3 sm:py-3 sm:align-middle">
                <div class="flex items-start gap-2">
                    <ReportLink slug={slug} publicId={report.public_id} class="min-w-0 break-words text-left font-semibold">{report.title}</ReportLink>
                    <UnreadDot publicId={report.public_id} unread={row.unread} />
                </div>
                {isOwner && deleted ? (
                    <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted>
                        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">{labels.client}已刪除</span>
                        <Time v={v} at={report.client_deleted_at as string} />
                    </span>
                ) : null}
            </td>
            <td class="block sm:table-cell sm:px-2 sm:py-3 sm:align-middle sm:text-center">
                <StatusText status={report.status} labels={v.cfg.statusLabels} />
            </td>
            {showCategory ? (
                <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-2 sm:py-3 sm:align-middle" data-report-category><span class="font-semibold text-slate-500 sm:hidden">分類：</span>{(categories ?? []).length > 0 ? <CategoryAutosave slug={slug} report={report} categories={categories ?? []} backPath={backPath} idPrefix="row-category" compact class="justify-start sm:justify-center" /> : report.category || '未分類'}</td>
            ) : null}
            <td class="block sm:table-cell sm:text-center sm:px-2 sm:py-3 sm:align-middle">
                <AttachmentThumbs publicId={report.public_id} thumbs={row.thumbs} total={row.thumbTotal} />
            </td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-2 sm:py-3 sm:align-middle" data-report-creator><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>{row.creatorLabel}</td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-2 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span><Time v={v} at={report.created_at} short /></td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-2 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><Time v={v} at={report.latest_activity_at} relative /></td>
            <td class="block sm:table-cell sm:whitespace-nowrap sm:px-2 sm:py-3 sm:align-middle sm:text-center">
                <div class="flex flex-nowrap items-center gap-1 sm:justify-center" data-report-row-actions>
                    <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open={`edit-report-${report.public_id}`}>編輯</button>
                    <CompleteButton slug={slug} publicId={report.public_id} status={report.status} isOwner={isOwner} clientLabel={labels.client} backPath={backPath} />
                    {isOwner && deleted ? (
                        <form method="post" action={paths.reportRestore(slug, report.public_id)}>
<input type="hidden" name="_back" value={backPath} />
                            <button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                        </form>
                    ) : null}
                    {isOwner ? (
                        <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open={`delete-report-${report.public_id}`} data-delete-report>刪除</button>
                    ) : (
                        <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open={`client-delete-report-${report.public_id}`} data-client-delete-report>刪除</button>
                    )}
                </div>
            </td>
        </tr>
    );
};

export const BoardCard: FC<RowProps & { order: number }> = ({ v, row, order, slug, isOwner, backPath, categories }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    return (
        <article class={cx(ROW_CLICK_CLASS, 'rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm', CARD_HOVER_CLASS, deleted ? 'opacity-70' : null)} data-kanban-card data-report-id={report.public_id} data-status={report.status} data-board-order={order} data-row-link={`detail-report-${report.public_id}`} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                    <p class="text-[11px] font-bold"><ReportLink slug={slug} publicId={report.public_id}>編號 <span data-report-number>{row.number}</span></ReportLink></p>
                    {(categories ?? []).length > 0 ? <CategoryAutosave slug={slug} report={report} categories={categories ?? []} backPath={backPath} idPrefix="card-category" compact class="mt-1" /> : null}
                </div>
                <div class="flex shrink-0 items-center gap-1" data-card-actions>
                    <CompleteButton slug={slug} publicId={report.public_id} status={report.status} isOwner={isOwner} clientLabel={v.cfg.labels.client} backPath={backPath} compact cardAction />
                    <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label={`編輯「${report.title}」`} title="編輯" data-card-action data-dialog-open={`edit-report-${report.public_id}`}>
                        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    {isOwner && deleted ? (
                        <form method="post" action={paths.reportRestore(slug, report.public_id)}>
<input type="hidden" name="_back" value={backPath} />
                            <button type="submit" class="grid size-8 cursor-pointer place-items-center rounded-lg text-teal-700 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label={`還原「${report.title}」`} title="還原" data-card-action data-restore-report>
                                <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                            </button>
                        </form>
                    ) : null}
                    {isOwner ? (
                        <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label={`刪除「${report.title}」`} title="刪除" data-card-action data-dialog-open={`delete-report-${report.public_id}`} data-delete-report>{ICON_TRASH}</button>
                    ) : (
                        <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label={`刪除「${report.title}」`} title="刪除" data-card-action data-dialog-open={`client-delete-report-${report.public_id}`} data-client-delete-report>{ICON_TRASH}</button>
                    )}
                </div>
            </div>
            <div class="mt-1 flex items-start gap-2">
                <ReportLink slug={slug} publicId={report.public_id} class="min-w-0 break-words text-left text-sm font-semibold leading-5">{report.title}</ReportLink>
                <UnreadDot publicId={report.public_id} unread={row.unread} />
            </div>
            {isOwner && deleted ? (
                <span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted>{v.cfg.labels.client}已刪除</span>
            ) : null}
            <AttachmentThumbs publicId={report.public_id} thumbs={row.thumbs} total={row.thumbTotal} card />
            <p class="mt-3 text-xs text-slate-500" data-report-creator>建立者：{row.creatorLabel}</p>
            <p class="mt-1 text-xs text-slate-500">更新於 <Time v={v} at={report.latest_activity_at} relative /></p>
        </article>
    );
};
