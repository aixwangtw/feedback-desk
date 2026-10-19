import type { FC } from 'hono/jsx';
import { charSlice } from '../../shared/text';
import type { Attachment, Message, Project, Report } from '../lib/models';
import { MAX_ADJUSTMENT_NOTE } from '../lib/reports';
import { PUBLIC_MAX_SCREENSHOTS, PUBLIC_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from '../lib/uploads';
import { paths } from '../routes/paths';
import { ErrorList, Layout, StatusBadge, StatusSelect, Time, type ViewContext } from './components';
import { RichText } from './rich-text';

/** Read-only adjustment block shared by the client and the team. */
export const AdjustmentBlock: FC<{
    report: Report;
    adjustmentAttachments: Attachment[];
    attachmentUrl: (attachment: Attachment) => string;
    compact?: boolean;
}> = ({ report, adjustmentAttachments, attachmentUrl, compact }) => (
    <div data-adjustment>
        <h2 class={`${compact ? 'text-sm' : 'text-base'} font-semibold text-slate-950`}>調整說明</h2>
        {report.adjustment_note ? (
            <div class="mt-2" data-adjustment-note><RichText text={report.adjustment_note} compact={compact} /></div>
        ) : adjustmentAttachments.length === 0 ? (
            <p class="mt-2 text-sm text-slate-400">尚未填寫。</p>
        ) : null}

        {adjustmentAttachments.length > 0 ? (
            <div class={`mt-3 ${compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}`}>
                {adjustmentAttachments.map((attachment) => (
                    <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class={`${compact ? 'block size-20' : 'group relative'} overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={attachment.original_name} data-adjustment-image title="放大預覽">
                        <img src={attachmentUrl(attachment)} alt={attachment.original_name} class={`${compact ? 'size-full' : 'aspect-video w-full'} object-cover`} loading="lazy" />
                    </a>
                ))}
            </div>
        ) : null}
    </div>
);

export interface ActivityProps {
    v: ViewContext;
    report: Report;
    messages: Message[];
    messageAttachments: Map<number, Attachment[]>;
    attachmentUrl: (attachment: Attachment) => string;
}

function authorLabel(v: ViewContext, type: Message['author_type']): string {
    return type === 'owner' ? v.cfg.labels.owner : type === 'agent' ? 'Vibe coding' : v.cfg.labels.client;
}

export const Activity: FC<ActivityProps> = ({ v, report, messages, messageAttachments, attachmentUrl }) => (
    <>
        <div class="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <h2 class="text-base font-semibold text-slate-950">處理紀錄</h2>
            <StatusBadge status={report.status} />
        </div>

        <div class="mt-5 grid gap-5">
            {messages.length === 0 ? (
                <div class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">已收到回報，新的處理進度會顯示在這裡。</div>
            ) : (
                messages.map((message) => {
                    const avatar = message.author_type === 'agent' ? 'bg-violet-100 text-violet-700' : message.author_type === 'owner' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600';
                    const attachments = messageAttachments.get(message.id) ?? [];
                    return (
                        <article class="flex gap-3">
                            <div class={`grid size-9 shrink-0 place-items-center rounded-full ${avatar} text-xs font-bold`}>{charSlice(authorLabel(v, message.author_type), 1)}</div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <p class="text-sm font-semibold text-slate-900">{message.author_name || authorLabel(v, message.author_type)}</p>
                                    <Time v={v} at={message.created_at} relative class="text-xs text-slate-500" />
                                </div>
                                <p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
                                {attachments.length > 0 ? (
                                    <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        {attachments.map((attachment) => (
                                            <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt={attachment.original_name}>
                                                <img src={attachmentUrl(attachment)} alt={attachment.original_name} class="aspect-video w-full object-cover" loading="lazy" />
                                                <span class="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大預覽</span>
                                            </a>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </article>
                    );
                })
            )}
        </div>
    </>
);

export interface ReportPageProps extends ActivityProps {
    project: Project;
    sequenceNumber: number | null;
    isPublicReporter: boolean;
    canManage: boolean;
    isOwner: boolean;
    attachments: Attachment[];
    adjustmentAttachments: Attachment[];
    success?: string;
    privateReportUrl?: string;
    adjustmentErrors?: string[];
    adjustmentOld?: string;
    messageErrors?: string[];
    messageOld?: string;
    /** ETag of the activity fragment, so the first poll can already get 304. */
    activityEtag?: string;
}

export const ReportPage: FC<ReportPageProps> = (props) => {
    const { v, project, report, isOwner, isPublicReporter, attachmentUrl } = props;
    const labels = v.cfg.labels;
    const slug = project.slug;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || props.adjustmentAttachments.length > 0;
    const adjustmentErrors = props.adjustmentErrors ?? [];
    const messageErrors = props.messageErrors ?? [];
    const readOnly = isPublicReporter && project.public_reporting_enabled !== 1;
    const maxMessageBytes = isPublicReporter ? PUBLIC_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;

    return (
        <Layout
            v={v}
            title={`${report.title}｜${project.name}`}
            project={isPublicReporter ? null : project}
            showLogout={props.canManage}
            success={props.success}
            headerAction={
                <a href={isPublicReporter ? paths.home() : paths.portal(slug)} class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">{isPublicReporter ? '回首頁' : '返回問題清單'}</a>
            }
        >
            {props.privateReportUrl ? (
                <section class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" data-private-url-notice>
                    <h2 class="font-semibold">存下這個網址才能回來看</h2>
                    <p class="mt-1 leading-6">這是這張單的私密網址，知道網址的人都能看到並留言。這個畫面只顯示這一次；同一個瀏覽器之後從首頁也找得到這張單。</p>
                    <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input readonly value={props.privateReportUrl} aria-label="私密網址" class="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" data-copy-source data-private-url />
                        <button type="button" class="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600" data-copy-button>複製網址</button>
                    </div>
                </section>
            ) : null}

            <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div class="grid gap-6">
                    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                        <div class="flex flex-wrap items-start justify-between gap-4">
                            <div class="min-w-0">
                                <h1 class="text-2xl font-bold tracking-tight text-slate-950">
                                    {props.sequenceNumber !== null ? (
                                        <span class="mr-1 text-slate-400">編號 <span data-report-number>{props.sequenceNumber}</span>｜</span>
                                    ) : null}
                                    {report.title}
                                </h1>
                                {isOwner && report.client_deleted_at ? (
                                    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500" data-client-deleted>
                                        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">{labels.client}已刪除</span>
                                        <Time v={v} at={report.client_deleted_at} />
                                        <form method="post" action={paths.reportRestore(slug, report.public_id)}>
<input type="hidden" name="_back" value={paths.report(slug, report.public_id)} />
                                            <button type="submit" class="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                                        </form>
                                    </div>
                                ) : null}
                            </div>
                            <StatusBadge status={report.status} />
                        </div>

                        <div class="mt-5" data-report-description><RichText text={report.description} /></div>

                        {props.attachments.length > 0 ? (
                            <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {props.attachments.map((attachment) => (
                                    <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt={attachment.original_name}>
                                        <img src={attachmentUrl(attachment)} alt={attachment.original_name} class="aspect-video w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
                                        <span class="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大預覽</span>
                                    </a>
                                ))}
                            </div>
                        ) : null}
                    </section>

                    {isOwner || hasAdjustment ? (
                        <section id="adjustment" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                            <AdjustmentBlock report={report} adjustmentAttachments={props.adjustmentAttachments} attachmentUrl={attachmentUrl} />

                            {isOwner ? (
                                <details class="mt-5 border-t border-slate-100 pt-4" open={adjustmentErrors.length > 0} data-adjustment-editor>
                                    <summary class="cursor-pointer text-sm font-semibold text-teal-800">編輯調整說明（僅{labels.owner}）</summary>
                                    <form method="post" action={paths.reportAdjustment(slug, report.public_id)} class="mt-4 grid gap-4" data-upload-form>
                                        <ErrorList errors={adjustmentErrors} />
                                        <div>
                                            <label for="adjustment_note" class="mb-2 block text-xs font-semibold text-slate-600">說明文字（再次調整時請接在原內容後面補寫）</label>
                                            <textarea id="adjustment_note" name="adjustment_note" maxlength={MAX_ADJUSTMENT_NOTE} rows={6} class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{adjustmentErrors.length > 0 ? props.adjustmentOld ?? '' : report.adjustment_note ?? ''}</textarea>
                                        </div>

                                        {props.adjustmentAttachments.length > 0 ? (
                                            <fieldset>
                                                <legend class="mb-2 text-xs font-semibold text-slate-600">目前調整圖片 <span class="font-normal text-slate-500">（勾選要刪除的）</span></legend>
                                                <div class="grid grid-cols-3 gap-3 sm:grid-cols-5">
                                                    {props.adjustmentAttachments.map((attachment) => (
                                                        <label class="group relative block cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 has-[:checked]:border-rose-400 has-[:checked]:opacity-50">
                                                            <img src={attachmentUrl(attachment)} alt={attachment.original_name} class="aspect-video w-full object-cover" loading="lazy" />
                                                            <span class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-rose-700">
                                                                <input type="checkbox" name="remove_adjustment_attachments[]" value={String(attachment.id)} class="rounded border-slate-300 text-rose-600 focus:ring-rose-600" />
                                                                刪除
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </fieldset>
                                        ) : null}

                                        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <label for="adjustment-images" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                                加入調整圖片
                                                <input id="adjustment-images" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="adjustment-preview" data-upload-url={`${paths.uploads(slug)}?purpose=adjustment&report=${encodeURIComponent(report.public_id)}`} data-upload-name="upload_ids[]" data-upload-max="5" data-upload-max-bytes={String(MAX_IMAGE_BYTES)} />
                                            </label>
                                            <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">儲存調整說明</button>
                                        </div>
                                        <div id="adjustment-preview" class="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                                    </form>
                                </details>
                            ) : null}
                        </section>
                    ) : null}

                    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" data-activity data-refresh-url={paths.reportActivity(slug, report.public_id)} data-etag={props.activityEtag}>
                        <Activity v={v} report={report} messages={props.messages} messageAttachments={props.messageAttachments} attachmentUrl={attachmentUrl} />
                    </section>

                    {readOnly ? (
                        <section class="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 sm:p-7" data-reporting-closed>已停止收件，這張單只能查看，不能再留言。</section>
                    ) : (
                        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                            <h2 class="text-base font-semibold text-slate-950">補充訊息</h2>
                            <form method="post" action={paths.reportMessages(slug, report.public_id)} class="mt-4 grid gap-4" data-upload-form>
<input type="hidden" name="_back" value={paths.report(slug, report.public_id)} />
                                <div>
                                    <label for="body" class="sr-only">訊息內容</label>
                                    <textarea id="body" name="body" required maxlength={10000} rows={4} placeholder={`補充操作步驟、回答${labels.owner}問題，或提供新的發現…`} class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{props.messageOld ?? ''}</textarea>
                                    {messageErrors.map((error) => (
                                        <p class="mt-2 text-xs text-rose-700">{error}</p>
                                    ))}
                                </div>
                                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    {isPublicReporter ? <span class="text-xs text-slate-500">截圖最多 {PUBLIC_MAX_SCREENSHOTS} 張，每張 5 MB。</span> : null}
                                    <label for="message-screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                        加入截圖
                                        <input id="message-screenshots" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="message-preview" data-upload-url={`${paths.uploads(slug)}?purpose=message&report=${encodeURIComponent(report.public_id)}`} data-upload-name="upload_ids[]" data-upload-max={String(isPublicReporter ? PUBLIC_MAX_SCREENSHOTS : 5)} data-upload-max-bytes={String(maxMessageBytes)} />
                                    </label>
                                    <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出訊息</button>
                                </div>
                                <div id="message-preview" class="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                            </form>
                        </section>
                    )}
                </div>

                <aside class="grid gap-4 lg:sticky lg:top-6">
                    {props.canManage ? (
                        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h2 class="text-sm font-semibold text-slate-950">更新狀態</h2>
                            <form method="post" action={paths.reportStatus(slug, report.public_id)} class="mt-4 grid gap-3">
<input type="hidden" name="_back" value={paths.report(slug, report.public_id)} />
                                <label for="status" class="sr-only">處理狀態</label>
                                <StatusSelect id="status" status={report.status} class="w-full" />
                                <button type="submit" class="rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2">儲存狀態</button>
                            </form>
                        </section>
                    ) : null}

                    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 class="text-sm font-semibold text-slate-950">回報資訊</h2>
                        <dl class="mt-4 grid gap-4 text-xs">
                            <div><dt class="text-slate-500">建立時間</dt><dd class="mt-1 font-medium text-slate-800"><Time v={v} at={report.created_at} /></dd></div>
                            <div><dt class="text-slate-500">最後更新</dt><dd class="mt-1 font-medium text-slate-800"><Time v={v} at={report.latest_activity_at} relative /></dd></div>
                        </dl>
                    </section>
                </aside>
            </div>
        </Layout>
    );
};
