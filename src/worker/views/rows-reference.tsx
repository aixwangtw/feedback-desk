/**
 * JSX versions of the portal list rows and board cards. Production renders them with the string
 * builders in rows.ts (faster on Workers); this file is the readable reference that the test
 * compares against byte for byte.
 */
import type { FC } from 'hono/jsx';
import { CARD_HOVER_CLASS, ROW_CLICK_CLASS } from './chat-classes';
import { paths } from '../routes/paths';
import { cx, ReportLink, StatusText, Time, UnreadDot, type ViewContext } from './components';
import type { PortalRow } from './portal';

function dialogsSrc(slug: string, publicId: string, backPath: string): string {
    return `${paths.reportDialogs(slug, publicId)}?back=${encodeURIComponent(backPath)}`;
}

export type RowProps = { v: ViewContext; row: PortalRow; slug: string; isOwner: boolean; backPath: string };

export const ListRow: FC<RowProps> = ({ v, row, slug, isOwner, backPath }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    const labels = v.cfg.labels;
    return (
        <tr class={cx('block', ROW_CLICK_CLASS, 'space-y-1 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle', deleted ? 'bg-slate-50 text-slate-500' : null)} data-report-row={report.public_id} data-row-link={`detail-report-${report.public_id}`} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <td class="block text-xs font-bold sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-3 sm:align-middle">
                <ReportLink slug={slug} publicId={report.public_id}><span class="sm:hidden">編號 </span><span data-report-number>{row.number}</span></ReportLink>
            </td>
            <td class="block sm:table-cell sm:px-4 sm:py-3 sm:align-middle">
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
            <td class="block sm:table-cell sm:px-3 sm:py-3 sm:align-middle sm:text-center">
                <StatusText status={report.status} labels={v.cfg.statusLabels} />
            </td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle" data-report-creator><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>{row.creatorLabel}</td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-3 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><Time v={v} at={report.latest_activity_at} relative /></td>
        </tr>
    );
};

export const BoardCard: FC<RowProps & { order: number }> = ({ v, row, order, slug, isOwner, backPath }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    return (
        <article class={cx(ROW_CLICK_CLASS, 'rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm', CARD_HOVER_CLASS, deleted ? 'opacity-70' : null)} data-kanban-card data-report-id={report.public_id} data-status={report.status} data-board-order={order} data-row-link={`detail-report-${report.public_id}`} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <p class="text-[11px] font-bold"><ReportLink slug={slug} publicId={report.public_id}>編號 <span data-report-number>{row.number}</span></ReportLink></p>
            <div class="mt-1 flex items-start gap-2">
                <ReportLink slug={slug} publicId={report.public_id} class="min-w-0 break-words text-left text-sm font-semibold leading-5">{report.title}</ReportLink>
                <UnreadDot publicId={report.public_id} unread={row.unread} />
            </div>
            {isOwner && deleted ? (
                <span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted>{v.cfg.labels.client}已刪除</span>
            ) : null}
            <p class="mt-3 text-xs text-slate-500" data-report-creator>建立者：{row.creatorLabel}</p>
            <p class="mt-1 text-xs text-slate-500">更新於 <Time v={v} at={report.latest_activity_at} relative /></p>
        </article>
    );
};
