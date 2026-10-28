import type { FC } from 'hono/jsx';
import type { Attachment, Message, Project, Report } from '../lib/models';
import { isStatus, statusLabel } from '../../shared/status';
import { withAgent } from '../lib/agents';
import { MAX_ADJUSTMENT_NOTE } from '../lib/reports';
import { PUBLIC_MAX_SCREENSHOTS, PUBLIC_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from '../lib/uploads';
import { paths } from '../routes/paths';
import { cx, ErrorList, Layout, StatusBadge, StatusSelect, Time, type ViewContext } from './components';
import { RichText } from './rich-text';

/** 已有分類不在專案清單時（例如分類改名後的舊單）仍列出，才能預選與保留。 */
export function editCategoryOptions(categories: string[], current: string | null): string[] {
    return current && !categories.includes(current) ? [...categories, current] : categories;
}

/** 詳細對話框與詳細頁的分類下拉：選了就存（JS），沒有 JS 時按「儲存」。 */
export const CategoryAutosave: FC<{ slug: string; report: Report; categories: string[]; backPath: string; idPrefix: string }> = ({ slug, report, categories, backPath, idPrefix }) => {
    const current = report.category ?? '';
    const id = `${idPrefix}-${report.public_id}`;
    return (
        <form method="post" action={paths.reportCategory(slug, report.public_id)} class="flex flex-wrap items-center gap-2 text-xs" data-category-form data-report-public-id={report.public_id}>
            <input type="hidden" name="_back" value={backPath} />
            <label for={id} class="font-semibold text-slate-600">分類</label>
            <select id={id} name="category" class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10" data-category-autosave>
                <option value="" selected={current === ''}>未分類</option>
                {editCategoryOptions(categories, report.category).map((option) => (
                    <option value={option} selected={option === current}>{option}</option>
                ))}
            </select>
            <noscript><button type="submit" class="font-semibold text-teal-700">儲存</button></noscript>
            <span class="text-[11px] empty:hidden text-slate-500" data-category-feedback aria-live="polite"></span>
        </form>
    );
};

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
export const Activity: FC<ActivityProps> = ({ v, report, messages, messageAttachments, attachmentUrl, viewerIsOwner, compact }) => {
    // Strangers who wrote a public report only see the team label, not which AI tool replied.
    const hideAgents = report.creator_type === 'public' && !viewerIsOwner;
    return (
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
                                <span class={`font-semibold ${nameClass}`} data-chat-author>
                                    {withAgent(message.author_name || authorLabel(v, message.author_type), hideAgents ? null : message.author_agent)}
                                </span>
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
};

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
    /** 專案的開單分類；空陣列表示不分類。 */
    categories?: string[];
    /** Team side only: who is working on it, handoff notes and recent activity. */
    work?: WorkState;
    /** Signed in with a personal team account (claims need a name; the shared owner link has none). */
    canClaim?: boolean;
}

export interface WorkState {
    claim: { by: string; since: string; yours: boolean } | null;
    handoff_notes: Array<{ author: string; created_at: string; note: string }>;
    recent_activity: Array<{ kind: string; by: string; detail: string | null; at: string }>;
}

const EVENT_LABELS: Record<string, string> = {
    created: '開單',
    message: '留言',
    adjustment: '寫調整說明',
    status: '改狀態',
    claim: '認領',
    release: '釋放認領',
    takeover: '接手',
    handoff: '寫交接紀錄',
};

function eventDetail(kind: string, detail: string | null): string {
    if (!detail) {
        return '';
    }
    if (kind === 'status') {
        const [from, to] = detail.split('>');
        return `：${isStatus(from) ? statusLabel(from) : from} → ${isStatus(to) ? statusLabel(to) : to}`;
    }
    return kind === 'takeover' || kind === 'release' ? `（原本是 ${detail}）` : '';
}

const SMALL_BUTTON = 'rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';

/** Claim box, handoff notes and activity log for the team. */
export const WorkPanel: FC<{ v: ViewContext; slug: string; publicId: string; work: WorkState; canClaim: boolean }> = ({ v, slug, publicId, work, canClaim }) => {
    const back = paths.report(slug, publicId);
    return (
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-work-panel>
            <h2 class="text-sm font-semibold text-slate-950">誰在處理</h2>
            {work.claim ? (
                <p class="mt-2 text-sm text-slate-700" data-claim>
                    <span class="font-semibold text-slate-900">{work.claim.by}</span> 認領中（<Time v={v} at={work.claim.since} /> 開始）
                </p>
            ) : (
                <p class="mt-2 text-sm text-slate-500" data-claim-none>目前沒有人認領。</p>
            )}
            {work.claim && !work.claim.yours ? (
                <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" data-claim-warning>
                    已有人認領。改狀態或調整說明前先看下方交接紀錄；要接手請按「接手」，會留下紀錄。
                </p>
            ) : null}
            {canClaim ? (
                <form method="post" action={paths.reportClaim(slug, publicId)} class="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="_back" value={back} />
                    {!work.claim ? (
                        <button type="submit" name="action" value="claim" class={`${SMALL_BUTTON} border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100`} data-claim-button>認領</button>
                    ) : work.claim.yours ? (
                        <button type="submit" name="action" value="release" class={`${SMALL_BUTTON} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} data-release-button>釋放</button>
                    ) : (
                        <button type="submit" name="action" value="takeover" class={`${SMALL_BUTTON} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`} data-takeover-button>接手</button>
                    )}
                </form>
            ) : (
                <p class="mt-3 text-xs text-slate-500">用個人帳號登入才能認領與寫交接紀錄。</p>
            )}

            <h3 class="mt-5 text-sm font-semibold text-slate-950">交接紀錄</h3>
            {work.handoff_notes.length === 0 ? (
                <p class="mt-2 text-xs text-slate-500">還沒有交接紀錄。工作中斷時寫下做到哪、下一步，下一個人（或 AI）讀單時會先看到。</p>
            ) : (
                <ol class="mt-2 grid gap-3" data-handoff-notes>
                    {work.handoff_notes.map((note) => (
                        <li class="rounded-lg bg-slate-50 px-3 py-2">
                            <p class="text-[11px] text-slate-500">
                                <span class="font-semibold text-slate-700">{note.author}</span> · <Time v={v} at={note.created_at} relative />
                            </p>
                            <p class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">{note.note}</p>
                        </li>
                    ))}
                </ol>
            )}
            {canClaim ? (
                <form method="post" action={paths.reportHandoff(slug, publicId)} class="mt-3 grid gap-2" data-handoff-form>
                    <input type="hidden" name="_back" value={back} />
                    <label for="handoff-note" class="sr-only">交接紀錄</label>
                    <textarea id="handoff-note" name="note" required maxlength={5000} rows={3} placeholder="做到哪、下一步、注意事項" class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-5 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"></textarea>
                    <label class="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" name="release" value="1" class="rounded border-slate-300 text-teal-700" />
                        同時釋放我的認領
                    </label>
                    <button type="submit" class={`${SMALL_BUTTON} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>儲存交接紀錄</button>
                </form>
            ) : null}

            {work.recent_activity.length > 0 ? (
                <details class="mt-5" data-activity-log>
                    <summary class="cursor-pointer text-sm font-semibold text-slate-950">最近動態</summary>
                    <ol class="mt-2 grid gap-1.5 text-xs text-slate-600">
                        {work.recent_activity.map((event) => (
                            <li>
                                <Time v={v} at={event.at} relative class="text-slate-400" /> <span class="font-semibold text-slate-800">{event.by}</span> {EVENT_LABELS[event.kind] ?? event.kind}
                                {eventDetail(event.kind, event.detail)}
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
        </section>
    );
};

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
                                {(props.categories ?? []).length > 0 && props.canManage && !isPublicReporter ? (
                                    <div class="mt-2">
                                        <CategoryAutosave slug={slug} report={report} categories={props.categories ?? []} backPath={paths.report(slug, report.public_id)} idPrefix="page-category" />
                                    </div>
                                ) : report.category ? (
                                    <p class="mt-1 text-xs text-slate-500" data-report-category>
                                        分類：<span class="font-semibold text-teal-700">{report.category}</span>
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
                    {props.creatorLabel && !isPublicReporter ? (
                        <p class="-mt-3 px-1 text-xs text-slate-500" data-report-creator>
                            建立者：{props.creatorLabel}
                        </p>
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
                    {isOwner && props.work ? <WorkPanel v={v} slug={slug} publicId={report.public_id} work={props.work} canClaim={props.canClaim === true} /> : null}
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
