import type { FC } from 'hono/jsx';
import type { Attachment, Message, Project, Report } from '../lib/models';
import { MAX_ADJUSTMENT_NOTE } from '../lib/reports';
import { PUBLIC_MAX_SCREENSHOTS, PUBLIC_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from '../lib/uploads';
import { paths } from '../routes/paths';
import { cx, ErrorList, Layout, StatusBadge, StatusSelect, Time, type ViewContext } from './components';
import { RichText } from './rich-text';

/** Read-only adjustment block shared by the client and the team. */
export const AdjustmentBlock: FC<{
    report: Report;
    adjustmentAttachments: Attachment[];
    attachmentUrl: (attachment: Attachment) => string;
    compact?: boolean;
    showHeading?: boolean;
}> = ({ report, adjustmentAttachments, attachmentUrl, compact, showHeading = true }) => (
    <div data-adjustment>
        {showHeading ? <h2 class={`${compact ? 'text-sm' : 'text-base'} font-semibold text-slate-950`}>調整說明</h2> : null}
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
    /** The viewer's own side (team or client/reporter) is shown on the right. */
    viewerIsOwner: boolean;
    /** Smaller thumbnails, for the chat panel. */
    compact?: boolean;
}

function authorLabel(v: ViewContext, type: Message['author_type']): string {
    return type === 'owner' ? v.cfg.labels.owner : type === 'agent' ? 'Vibe coding' : v.cfg.labels.client;
}

const BUBBLE_CLASSES: Record<Message['author_type'], [string, string]> = {
    agent: ['bg-violet-50 ring-violet-200', 'text-violet-800'],
    owner: ['bg-teal-50 ring-teal-200', 'text-teal-800'],
    reporter: ['bg-amber-50 ring-amber-200', 'text-amber-800'],
};

/** Message thread as chat bubbles; shared by the report page and the chat panel. */
export const Activity: FC<ActivityProps> = ({ v, messages, messageAttachments, attachmentUrl, viewerIsOwner, compact }) => (
    <ol class="grid gap-4" data-chat-messages>
        {messages.length === 0 ? (
            <li class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500" data-chat-empty>還沒有留言，新的處理進度會顯示在這裡。</li>
        ) : (
            messages.map((message) => {
                const isMine = viewerIsOwner === (message.author_type !== 'reporter');
                const [bubbleClass, nameClass] = BUBBLE_CLASSES[message.author_type] ?? BUBBLE_CLASSES.reporter;
                const attachments = messageAttachments.get(message.id) ?? [];
                return (
                    <li class={cx('flex', isMine ? 'justify-end' : 'justify-start')} data-chat-message data-author={message.author_type} data-side={isMine ? 'mine' : 'theirs'}>
                        <div class={cx('flex min-w-0 max-w-[88%] flex-col sm:max-w-[80%]', isMine ? 'items-end' : 'items-start')}>
                            <div class={cx('flex flex-wrap items-baseline gap-x-2 px-1 text-xs', isMine ? 'flex-row-reverse' : null)}>
                                <span class={`font-semibold ${nameClass}`} data-chat-author>{message.author_name || authorLabel(v, message.author_type)}</span>
                                <Time v={v} at={message.created_at} relative class="text-slate-500" />
                            </div>
                            <div class={cx('mt-1 min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 ring-1 ring-inset', bubbleClass, isMine ? 'rounded-tr-md' : 'rounded-tl-md')}>
                                <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-chat-body>{message.body}</p>
                                {attachments.length > 0 ? (
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        {attachments.map((attachment) => (
                                            <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class={`block ${compact ? 'size-20' : 'size-24 sm:size-28'} overflow-hidden rounded-lg border border-white bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={attachment.original_name} title="放大預覽" data-chat-attachment>
                                                <img src={attachmentUrl(attachment)} alt={attachment.original_name} class="size-full object-cover" loading="lazy" />
                                            </a>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </li>
                );
            })
        )}
    </ol>
);

/** What the chat panel shows for one report: the adjustment (collapsed unless new) and the thread. */
export const ConversationFragment: FC<ActivityProps & { adjustmentAttachments: Attachment[]; adjustmentWasNew: boolean }> = (props) => {
    const { report, adjustmentAttachments, adjustmentWasNew } = props;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || adjustmentAttachments.length > 0;
    return (
        <>
            {hasAdjustment ? (
                <details class="mb-4 rounded-xl border border-teal-100 bg-teal-50/50 px-3.5 py-2.5 text-sm" open={adjustmentWasNew} data-chat-adjustment>
                    <summary class="cursor-pointer font-semibold text-teal-900">
                        調整說明
                        {adjustmentWasNew ? <span class="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">有更新</span> : null}
                    </summary>
                    <div class="mt-2">
                        <AdjustmentBlock report={report} adjustmentAttachments={adjustmentAttachments} attachmentUrl={props.attachmentUrl} compact showHeading={false} />
                    </div>
                </details>
            ) : null}
            <Activity {...props} compact />
        </>
    );
};

export interface ReportPageProps extends Omit<ActivityProps, 'viewerIsOwner' | 'compact'> {
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
    /** Who created the report (account name), shown to project members. */
    creatorLabel?: string;
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
            chatPanel={props.canManage ? { slug, viewer: isOwner ? 'owner' : 'client' } : undefined}
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
                                {props.creatorLabel && !isPublicReporter ? (
                                    <p class="mt-1 text-xs text-slate-500" data-report-creator>
                                        建立者：{props.creatorLabel}
                                    </p>
                                ) : null}
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
                            {!isOwner && !readOnly ? <p class="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600" data-adjustment-message-hint>看完有問題，可直接在下方留言</p> : null}

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

                    <section id="conversation" class="rounded-2xl border border-slate-200 bg-white shadow-sm" data-conversation>
                        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
                            <div class="min-w-0">
                                {isOwner || readOnly ? (
                                    <h2 class="text-base font-semibold text-slate-950">留言</h2>
                                ) : (
                                    <>
                                        <h2 class="text-lg font-bold text-slate-950">留言給{labels.owner}</h2>
                                        <p class="mt-1 text-sm leading-6 text-slate-600" data-message-hint>有問題或補充可以直接在這裡留言，我們會看到並回覆</p>
                                    </>
                                )}
                            </div>
                            <div class="flex items-center gap-2">
                                {props.canManage ? (
                                    <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-open={report.public_id}>在對話面板開啟</button>
                                ) : null}
                                <StatusBadge status={report.status} />
                            </div>
                        </div>

                        <div class="bg-slate-50/60 px-4 py-5 sm:px-7" data-activity data-refresh-url={paths.reportActivity(slug, report.public_id)} data-etag={props.activityEtag}>
                            <Activity v={v} report={report} messages={props.messages} messageAttachments={props.messageAttachments} attachmentUrl={attachmentUrl} viewerIsOwner={isOwner} />
                        </div>

                        {readOnly ? (
                            <p class="border-t border-slate-100 px-5 py-4 text-sm text-slate-600 sm:px-7" data-reporting-closed>已停止收件，這張單只能查看，不能再留言。</p>
                        ) : (
                            <div id="message-form" class="border-t border-slate-100 px-5 py-4 sm:px-7" data-message-section data-message-form>
                                <form method="post" action={paths.reportMessages(slug, report.public_id)} class="grid gap-3" data-upload-form>
<input type="hidden" name="_back" value={paths.report(slug, report.public_id)} />
                                    <div>
                                        <label for="body" class="sr-only">訊息內容</label>
                                        <textarea id="body" name="body" required maxlength={10000} rows={3} placeholder={`補充操作步驟、回答${labels.owner}問題，或提供新的發現…`} class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{props.messageOld ?? ''}</textarea>
                                        {messageErrors.map((error) => (
                                            <p class="mt-2 text-xs text-rose-700">{error}</p>
                                        ))}
                                    </div>
                                    <div id="message-preview" class="grid grid-cols-3 gap-3 empty:hidden sm:grid-cols-5" aria-live="polite"></div>
                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                        <div class="flex flex-wrap items-center gap-3">
                                            <label for="message-screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                                加入截圖
                                                <input id="message-screenshots" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="message-preview" data-upload-url={`${paths.uploads(slug)}?purpose=message&report=${encodeURIComponent(report.public_id)}`} data-upload-name="upload_ids[]" data-upload-max={String(isPublicReporter ? PUBLIC_MAX_SCREENSHOTS : 5)} data-upload-max-bytes={String(maxMessageBytes)} />
                                            </label>
                                            <span class="text-xs text-slate-500">{isPublicReporter ? `截圖最多 ${PUBLIC_MAX_SCREENSHOTS} 張，每張 5 MB。` : '截圖最多 5 張，每張 10 MB。'}</span>
                                        </div>
                                        <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出訊息</button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </section>
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
