/**
 * JSX versions of the portal list rows and board cards. Production renders them with the string
 * builders in rows.ts (faster on Workers); this file is the readable reference that the test
 * compares against byte for byte.
 */
import type { FC } from 'hono/jsx';
import type { Attachment, Report } from '../lib/models';
import { paths } from '../routes/paths';
import { badgeText } from '../../shared/conversation';
import { ChatButton, cx, StatusText, Time, type ViewContext } from './components';

import { COMPLETE_CONFIRM } from '../../shared/status';
import type { PortalRow } from './portal';
import { CategoryAutosave } from './report';
import { WAITING_STATUS } from '../../shared/status';

const ICON_TRASH = (
    <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>
);

export const Thumb: FC<{ href: string; name: string; size?: string; border?: string; adjustment?: boolean }> = ({ href, name, size = 'size-10', border = 'border-slate-200', adjustment }) => (
    <a href={href} target="_blank" rel="noreferrer" class={`block ${size} overflow-hidden rounded-lg border ${border} bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={name} data-adjustment-image={adjustment ? '' : undefined} title="放大預覽">
        <img src={href} alt={name} class="size-full object-cover" loading="lazy" />
    </a>
);

function dialogsSrc(slug: string, publicId: string, backPath: string): string {
    return `${paths.reportDialogs(slug, publicId)}?back=${encodeURIComponent(backPath)}`;
}

/**
 * 清單與看板上每張單的明顯標記：紅底「N 則未讀」（各自依自己這一方的已讀狀態，點了開對話面板）；
 * 團隊端另有「待審留言 N」（草稿，只有團隊看得到）。等誰的標示＝狀態名稱（等工程師／等{客戶}）。
 */
export const ReportFlags: FC<{ v: ViewContext; row: PortalRow; slug: string; isOwner: boolean; class: string }> = ({ v, row, slug, isOwner, class: extra }) => {
    const report = row.report;
    const drafts = isOwner ? row.drafts ?? 0 : 0;
    const waiting = row.waiting === 'developer' || row.waiting === 'client' ? row.waiting : null;
    if (row.unread <= 0 && drafts <= 0 && waiting === null) {
        return null;
    }
    return (
        <div class={`flex flex-wrap items-center gap-1.5 ${extra}`} data-report-flags>
            {waiting ? (
                <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-700 ring-1 ring-inset ring-slate-200" data-waiting={waiting}>{v.cfg.statusLabels[WAITING_STATUS[waiting]]}</span>
            ) : null}
            {row.unread > 0 ? (
                <button type="button" class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold leading-4 text-white shadow-sm hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-chat-open={report.public_id} data-unread-flag={report.public_id}>{`${badgeText(row.unread)} 則未讀`}</button>
            ) : null}
            {drafts > 0 ? (
                <a href={`${paths.report(slug, report.public_id)}#message-drafts`} class="inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-amber-900 hover:bg-amber-100" data-draft-badge={report.public_id} title="有待審留言，只有團隊看得到">{`待審留言 ${drafts}`}</a>
            ) : null}
        </div>
    );
};

export type RowProps = { v: ViewContext; row: PortalRow; slug: string; isOwner: boolean; backPath: string; showCategory?: boolean; categories?: string[]; attachmentUrl: (report: Report, attachment: Attachment) => string };

export const ListRow: FC<RowProps> = ({ v, row, slug, isOwner, backPath, showCategory, categories, attachmentUrl }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || row.adjustmentAttachments.length > 0;
    const labels = v.cfg.labels;
    return (
        <tr class={cx('block space-y-2 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle', deleted ? 'bg-slate-50 text-slate-500' : null)} data-report-row={report.public_id} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <td class="block text-xs font-bold text-slate-500 sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-2 sm:align-middle"><span class="sm:hidden">編號 </span><span data-report-number>{row.number}</span></td>
            <td class="block sm:table-cell sm:px-4 sm:py-2 sm:align-middle">
                <div class="flex items-start gap-2">
                    <button type="button" class="min-w-0 flex-1 text-left font-semibold text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open={`detail-report-${report.public_id}`} data-report-detail-open>{report.title}</button>
                    <ChatButton publicId={report.public_id} title={report.title} total={row.messagesCount} unread={row.unread} isOwner={isOwner} class="-my-1" />
                </div>
                <ReportFlags v={v} row={row} slug={slug} isOwner={isOwner} class="mt-1" />
                {isOwner && deleted ? (
                    <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted>
                        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">{labels.client}已刪除</span>
                        <Time v={v} at={report.client_deleted_at as string} />
                    </span>
                ) : null}
            </td>
            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center">
                <StatusText status={report.status} labels={v.cfg.statusLabels} />
            </td>
            {showCategory ? (
                <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-category><span class="font-semibold text-slate-500 sm:hidden">分類：</span>{(categories ?? []).length > 0 ? <CategoryAutosave slug={slug} report={report} categories={categories ?? []} backPath={backPath} idPrefix="row-category" compact class="justify-start sm:justify-center" /> : report.category || '未分類'}</td>
            ) : null}
            <td class="block empty:hidden sm:table-cell sm:text-center sm:px-3 sm:py-2 sm:align-middle">
                {row.attachments.length > 0 ? (
                    <div class="flex flex-wrap gap-1 sm:justify-center">
                        {row.attachments.map((attachment) => (
                            <Thumb href={attachmentUrl(report, attachment)} name={attachment.original_name} />
                        ))}
                    </div>
                ) : (
                    <span class="text-xs text-slate-400">—</span>
                )}
            </td>
            <td class="block sm:max-w-64 sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
                <span class="text-xs font-semibold text-slate-500 sm:hidden">調整重點：</span>
                {hasAdjustment ? (
                    <>
                        {report.adjustment_note ? (
                            <button type="button" class="block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title={report.adjustment_note} aria-label={`預覽「${report.title}」的調整重點`} data-dialog-open={`detail-report-${report.public_id}`} data-adjustment-preview><span class="line-clamp-3 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note>{report.adjustment_note}</span></button>
                        ) : null}
                        {row.adjustmentAttachments.length > 0 ? (
                            <div class="mt-1 flex flex-wrap gap-1">
                                {row.adjustmentAttachments.map((attachment) => (
                                    <Thumb href={attachmentUrl(report, attachment)} name={attachment.original_name} border="border-teal-200" adjustment />
                                ))}
                            </div>
                        ) : null}
                    </>
                ) : (
                    <span class="text-xs text-slate-400">—</span>
                )}
            </td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-creator><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>{row.creatorLabel}</td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span><Time v={v} at={report.created_at} /></td>
            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><Time v={v} at={report.latest_activity_at} relative /></td>
            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center">
                <div class="flex flex-wrap gap-2 sm:justify-center">
                    <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open={`edit-report-${report.public_id}`}>編輯</button>
                    {!isOwner && report.status !== 'completed' ? (
                        <form method="post" action={paths.reportStatus(slug, report.public_id)} data-confirm={COMPLETE_CONFIRM}>
                            <input type="hidden" name="_back" value={backPath} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-complete-report>完成</button>
                        </form>
                    ) : null}
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

export const BoardCard: FC<RowProps & { order: number }> = ({ v, row, order, slug, isOwner, backPath, categories, attachmentUrl }) => {
    const report = row.report;
    const deleted = report.client_deleted_at !== null;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || row.adjustmentAttachments.length > 0;
    const firstAttachment = row.attachments[0];
    const firstAdjustment = row.adjustmentAttachments[0];
    return (
        <article class={cx('rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md', deleted ? 'opacity-70' : null)} data-kanban-card data-report-id={report.public_id} data-status={report.status} data-board-order={order} data-dialogs-src={dialogsSrc(slug, report.public_id, backPath)}>
            <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                    <p class="text-[11px] font-bold text-slate-500">編號 <span data-report-number>{row.number}</span></p>
                    <ReportFlags v={v} row={row} slug={slug} isOwner={isOwner} class="mt-1" />
                    {(categories ?? []).length > 0 ? <CategoryAutosave slug={slug} report={report} categories={categories ?? []} backPath={backPath} idPrefix="card-category" compact class="mt-1" /> : null}
                    <button type="button" class="mt-1 block w-full break-words text-left text-sm font-semibold leading-5 text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open={`detail-report-${report.public_id}`} data-report-detail-open>{report.title}</button>
                </div>
                <div class="flex shrink-0 items-center gap-1" data-card-actions>
                    <ChatButton publicId={report.public_id} title={report.title} total={row.messagesCount} unread={row.unread} isOwner={isOwner} />
                    {!isOwner && report.status !== 'completed' ? (
                        <form method="post" action={paths.reportStatus(slug, report.public_id)} data-confirm={COMPLETE_CONFIRM}>
                            <input type="hidden" name="_back" value={backPath} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" class="inline-flex h-8 cursor-pointer items-center rounded-lg px-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-card-action data-complete-report>完成</button>
                        </form>
                    ) : null}
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

            {isOwner && deleted ? (
                <span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted>{v.cfg.labels.client}已刪除</span>
            ) : null}

            {firstAttachment ? (
                <div class="mt-3 flex items-center gap-2">
                    <Thumb href={attachmentUrl(report, firstAttachment)} name={firstAttachment.original_name} />
                    <span class="text-xs font-medium text-slate-500">{row.attachments.length} 張附件</span>
                </div>
            ) : null}

            {hasAdjustment ? (
                <div class="mt-3 rounded-lg border border-teal-100 bg-teal-50/60 p-2" data-adjustment-card>
                    <p class="text-[11px] font-bold text-teal-800">調整重點</p>
                    {report.adjustment_note ? (
                        <button type="button" class="mt-1 block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title={report.adjustment_note} aria-label={`預覽「${report.title}」的調整重點`} data-dialog-open={`detail-report-${report.public_id}`} data-adjustment-preview><span class="line-clamp-2 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note>{report.adjustment_note}</span></button>
                    ) : null}
                    {firstAdjustment ? (
                        <div class="mt-2 flex items-center gap-2">
                            <Thumb href={attachmentUrl(report, firstAdjustment)} name={firstAdjustment.original_name} adjustment />
                            <button type="button" class="rounded text-xs font-medium text-slate-500 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="預覽全部調整圖" data-dialog-open={`detail-report-${report.public_id}`} data-adjustment-preview>{row.adjustmentAttachments.length} 張調整圖</button>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <p class="mt-3 text-xs text-slate-500" data-report-creator>建立者：{row.creatorLabel}</p>
            <p class="mt-3 text-xs text-slate-500">更新於 <Time v={v} at={report.latest_activity_at} relative /></p>
        </article>
    );
};

