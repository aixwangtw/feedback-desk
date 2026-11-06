import type { FC } from 'hono/jsx';
import type { Attachment, Message, Project, Report } from '../lib/models';
import type { DraftView } from '../lib/drafts';
import type { Notifications } from '../lib/notifications';
import { COMPLETE_CONFIRM, isStatus, statusLabel, type StatusLabels } from '../../shared/status';
import { COMPLETION_APPROVE_LABEL, defaultCompletionBody } from '../../shared/completion';
import { buildTimeline, latestCompletionRequestId, type TimelineStatusEvent } from '../../shared/timeline';
import type { AlbumItem } from '../lib/album';
import { isDeveloperSideAuthor, withAgent } from '../lib/agents';
import { MAX_MESSAGE } from '../lib/reports';
import { PUBLIC_MAX_SCREENSHOTS, PUBLIC_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from '../lib/uploads';
import { paths } from '../routes/paths';
import { AttachmentCaption, AttachmentMedia, attachmentLinkTitle, cx, Layout, StatusBadge, Time, type ViewContext } from './components';
import { IMAGE_ACCEPT, isVideoMime, MESSAGE_ACCEPT, MESSAGE_HINT, MESSAGE_UPLOAD_LABEL } from '../../shared/attachment-rules';
import { RichText } from './rich-text';

/** 已有分類不在專案清單時（例如分類改名後的舊單）仍列出，才能預選與保留。 */
export function editCategoryOptions(categories: string[], current: string | null): string[] {
    return current && !categories.includes(current) ? [...categories, current] : categories;
}

/** 詳細對話框與詳細頁的分類下拉：選了就存（JS），沒有 JS 時按「儲存」。 */
export const CategoryAutosave: FC<{ slug: string; report: Report; categories: string[]; backPath: string; idPrefix: string; compact?: boolean; class?: string }> = ({ slug, report, categories, backPath, idPrefix, compact, class: extra }) => {
    const current = report.category ?? '';
    const id = `${idPrefix}-${report.public_id}`;
    return (
        <form method="post" action={paths.reportCategory(slug, report.public_id)} class={cx('flex flex-wrap items-center gap-2 text-xs', extra)} data-category-form data-report-public-id={report.public_id}>
            <input type="hidden" name="_back" value={backPath} />
            <label for={id} class={compact ? 'sr-only' : 'font-semibold text-slate-600'}>分類</label>
            <select id={id} name="category" class={cx(compact ? 'h-8 w-28 shrink-0 px-2 py-0' : 'px-2 py-1', 'rounded-lg border border-slate-300 bg-white text-xs shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10')} data-category-autosave>
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
        {showHeading ? <h2 class={`${compact ? 'text-sm' : 'text-base'} font-semibold text-slate-950`}>調整重點</h2> : null}
        {showHeading ? <p class="mt-0.5 text-xs text-slate-400">留言重點整理，會隨時更新</p> : null}
        {report.adjustment_note ? (
            <div class="mt-2" data-adjustment-note><RichText text={report.adjustment_note} compact={compact} /></div>
        ) : adjustmentAttachments.length === 0 ? (
            <p class="mt-2 text-sm text-slate-400">尚未填寫。</p>
        ) : null}

        {adjustmentAttachments.length > 0 ? (
            <div class={`mt-3 ${compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}`}>
                {adjustmentAttachments.map((attachment) => (
                    <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class={`${compact ? 'block size-20' : 'group relative'} overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={attachment.original_name} data-adjustment-image title={attachmentLinkTitle(attachment.mime_type)}>
                        <AttachmentMedia src={attachmentUrl(attachment)} name={attachment.original_name} mime={attachment.mime_type} class={`${compact ? 'size-full' : 'aspect-video w-full'} object-cover`} />
                    </a>
                ))}
            </div>
        ) : null}
    </div>
);

export interface ActivityProps {
    v: ViewContext;
    slug: string;
    report: Report;
    messages: Message[];
    messageAttachments: Map<number, Attachment[]>;
    attachmentUrl: (attachment: Attachment) => string;
    /** The viewer's own side (team or client/reporter) is shown on the right. */
    viewerIsOwner: boolean;
    /** Smaller thumbnails, for the chat panel. */
    compact?: boolean;
    /** 狀態變更（時間軸裡置中的一行）；沒給就只有留言。 */
    statusEvents?: TimelineStatusEvent[];
    /** 看的人能不能按確認留言上的「通過」：只有客戶端（能結案的一方）、單還沒完成。 */
    canApprove?: boolean;
}

function authorLabel(v: ViewContext, type: Message['author_type']): string {
    return type === 'owner' ? v.cfg.labels.owner : type === 'agent' ? 'Vibe coding' : v.cfg.labels.client;
}

/** 留言作者顯示名稱（留言泡泡與相簿來源共用）；陌生人寫的公開單不讓看的人知道是哪個 AI 工具回的。 */
export function messageAuthorLabel(v: ViewContext, report: Pick<Report, 'creator_type'>, message: Message, viewerIsOwner: boolean): string {
    const hideAgents = report.creator_type === 'public' && !viewerIsOwner;
    return withAgent(message.author_name || authorLabel(v, message.author_type), hideAgents ? null : message.author_agent, isDeveloperSideAuthor(message));
}

const BUBBLE_CLASSES: Record<Message['author_type'], [string, string]> = {
    agent: ['bg-violet-50 ring-violet-200', 'text-violet-800'],
    owner: ['bg-teal-50 ring-teal-200', 'text-teal-800'],
    reporter: ['bg-amber-50 ring-amber-200', 'text-amber-800'],
};

/**
 * 活動時間軸：留言泡泡與狀態變更依時間排在一起，單頁、詳情視窗、右下角面板共用。自己這一方的留言靠右；
 * 狀態變更是置中的一行，團隊端另顯示是誰改的，客戶端只顯示改成什麼狀態。
 * 「請確認完成」的留言：客戶端（canApprove）在最新一則上看到「通過」按鈕，團隊端看不到也按不了。
 */
export const Activity: FC<ActivityProps> = ({ v, slug, report, messages, messageAttachments, attachmentUrl, viewerIsOwner, compact, statusEvents, canApprove }) => {
    const entries = buildTimeline(messages, statusEvents ?? []);
    const approveId = canApprove ? latestCompletionRequestId(messages) : null;
    return (
    <ol class="grid grid-cols-[minmax(0,1fr)] gap-4" data-chat-messages>
        {entries.length === 0 ? (
            <li class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500" data-chat-empty>還沒有留言，新的處理進度會顯示在這裡。</li>
        ) : (
            entries.map((entry) => {
                if (entry.type === 'status') {
                    const to = isStatus(entry.to) ? statusLabel(entry.to, v.cfg.statusLabels) : entry.to;
                    const who = viewerIsOwner ? `${withAgent(entry.actor, entry.agent, entry.developerSide)} ` : '';
                    return (
                        <li class="flex justify-center" data-chat-event="status" data-status-to={entry.to}>
                            <p class="max-w-full rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-600">{who}將狀態改為「<span class="font-semibold text-slate-800">{to}</span>」 <Time v={v} at={entry.at} relative class="text-slate-400" /></p>
                        </li>
                    );
                }
                const message = entry.message;
                const isMine = viewerIsOwner === (message.author_type !== 'reporter');
                const [bubbleClass, nameClass] = BUBBLE_CLASSES[message.author_type] ?? BUBBLE_CLASSES.reporter;
                const attachments = messageAttachments.get(message.id) ?? [];
                const isRequest = message.is_completion_request === 1;
                return (
                    <li class={cx('flex', isMine ? 'justify-end' : 'justify-start')} data-chat-message data-author={message.author_type} data-side={isMine ? 'mine' : 'theirs'}>
                        <div class={cx('flex min-w-0 max-w-[88%] flex-col sm:max-w-[80%]', isMine ? 'items-end' : 'items-start')}>
                            <div class={cx('flex flex-wrap items-baseline gap-x-2 px-1 text-xs', isMine ? 'flex-row-reverse' : null)}>
                                <span class={`font-semibold ${nameClass}`} data-chat-author>
                                    {messageAuthorLabel(v, report, message, viewerIsOwner)}
                                </span>
                                <Time v={v} at={message.created_at} relative class="text-slate-500" />
                            </div>
                            <div class={cx('mt-1 min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 ring-1 ring-inset', bubbleClass, isMine ? 'rounded-tr-md' : 'rounded-tl-md')}>
                                {isRequest ? <p class="mb-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800" data-completion-request-badge>請確認完成</p> : null}
                                <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-chat-body>{message.body}</p>
                                {isRequest && approveId === message.id ? (
                                    <form method="post" action={paths.reportStatus(slug, report.public_id)} class="mt-2" data-completion-approve-form>
                                        <input type="hidden" name="_back" value={paths.report(slug, report.public_id)} />
                                        <input type="hidden" name="status" value="completed" />
                                        <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60" data-completion-approve={report.public_id}>{COMPLETION_APPROVE_LABEL}</button>
                                    </form>
                                ) : null}
                                {attachments.length > 0 ? (
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        {attachments.map((attachment) =>
                                            isVideoMime(attachment.mime_type) ? (
                                                <div class="min-w-0 w-full max-w-md">
                                                    <video controls playsinline preload="metadata" src={attachmentUrl(attachment)} class={`${compact ? 'max-h-48' : 'max-h-72'} w-full rounded-lg border border-white bg-black shadow-sm`} title={attachment.original_name} data-chat-video></video>
                                                    <AttachmentCaption name={attachment.original_name} class="mt-0.5" />
                                                </div>
                                            ) : (
                                                <div class={`min-w-0 ${compact ? 'w-20' : 'w-24 sm:w-28'}`}>
                                                <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class={`block ${compact ? 'size-20' : 'size-24 sm:size-28'} overflow-hidden rounded-lg border border-white bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={attachment.original_name} title="放大預覽" data-chat-attachment>
                                                    <img src={attachmentUrl(attachment)} alt={attachment.original_name} class="size-full object-cover" loading="lazy" />
                                                </a>
                                                <AttachmentCaption name={attachment.original_name} class="mt-0.5" />
                                                </div>
                                            ),
                                        )}
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

/**
 * 相簿：這張單所有附件集中顯示（客戶原始附件＋每則留言的圖片與影片；草稿附件只有團隊看得到，見 lib/album.ts）。
 * 單頁、詳情視窗、右下角面板共用；縮圖直接用原檔、lazy 載入，點圖放大、點影片在燈箱播放，標示來自哪則留言與時間。
 * 預設收合，標題顯示張數；定時刷新時 data-keep-open 讓展開狀態保留。沒有附件就不顯示。
 */
export const Album: FC<{ v: ViewContext; items: AlbumItem[] }> = ({ v, items }) =>
    items.length === 0 ? null : (
        <details class="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm" data-chat-album data-keep-open="album">
            <summary class="cursor-pointer font-semibold text-slate-800">相簿 <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" data-album-count>{items.length}</span></summary>
            <ul class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5" data-album-grid>
                {items.map((item) => (
                    <li class="min-w-0" data-album-item data-album-kind={item.kind}>
                        <a href={item.url} target="_blank" rel="noreferrer" class="block aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-play data-lightbox-alt={item.name} title={item.isVideo ? '播放影片' : '放大預覽'}>
                            <AttachmentMedia src={item.url} name={item.name} mime={item.isVideo ? 'video/mp4' : 'image/jpeg'} class="size-full object-cover" />
                        </a>
                        <p class="mt-1 truncate text-[11px] leading-4 text-slate-600" title={item.source} data-album-source>
                            {item.kind === 'draft' ? <span class="font-semibold text-amber-800">{item.source}（只有{v.cfg.labels.owner}看得到）</span> : item.source}
                        </p>
                        <Time v={v} at={item.at} relative class="block text-[11px] leading-4 text-slate-400" />
                    </li>
                ))}
            </ul>
        </details>
    );

/** 對話內容：相簿＋活動時間軸。單頁（activity 端點）、詳情視窗、右下角面板（對話端點）共用。 */
export const Thread: FC<ActivityProps & { album: AlbumItem[] }> = ({ album, ...activity }) => (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Album v={activity.v} items={album} />
        <Activity {...activity} />
    </div>
);

/**
 * 過去的處理說明：舊「調整重點」，網頁已不能編輯，有內容才顯示，唯讀、預設收合。
 * panel：右下角面板用（data-chat-adjustment，詳情視窗載入時會拿掉這份，因為視窗自己已經顯示）。
 */
export const PastNotes: FC<{ report: Report; adjustmentAttachments: Attachment[]; attachmentUrl: (attachment: Attachment) => string; panel?: boolean }> = ({ report, adjustmentAttachments, attachmentUrl, panel }) => {
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || adjustmentAttachments.length > 0;
    if (!hasAdjustment) {
        return null;
    }
    return (
        <details class={cx('rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm', panel ? 'mb-4' : null)} data-past-notes data-chat-adjustment={panel ? '' : undefined} data-keep-open={panel ? 'past-notes' : `past-notes-${report.public_id}`}>
            <summary class="cursor-pointer font-semibold text-slate-700">過去的處理說明</summary>
            <div class="mt-2">
                <AdjustmentBlock report={report} adjustmentAttachments={adjustmentAttachments} attachmentUrl={attachmentUrl} compact showHeading={false} />
            </div>
        </details>
    );
};

/** What the chat panel shows for one report: the past notes (collapsed, only when there are any), the album and the timeline. */
export const ConversationFragment: FC<ActivityProps & { adjustmentAttachments: Attachment[]; album: AlbumItem[] }> = (props) => {
    const { report, adjustmentAttachments } = props;
    return (
        <>
            <PastNotes report={report} adjustmentAttachments={adjustmentAttachments} attachmentUrl={props.attachmentUrl} panel />
            <Thread {...props} compact />
        </>
    );
};

export interface ReportPageProps extends Omit<ActivityProps, 'viewerIsOwner' | 'compact' | 'slug'> {
    /** 相簿（客戶端不含待審留言的附件）。 */
    album: AlbumItem[];
    project: Project;
    sequenceNumber: number | null;
    isPublicReporter: boolean;
    canManage: boolean;
    isOwner: boolean;
    attachments: Attachment[];
    adjustmentAttachments: Attachment[];
    success?: string;
    privateReportUrl?: string;
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
    /** 待審留言（草稿）：只有開發團隊的單頁有。 */
    drafts?: DraftView[];
    /** 草稿編輯失敗時，那則草稿的錯誤與剛輸入的內容。 */
    draftErrors?: { id: number; errors: string[]; old: string };
    /** 頁首通知鈴鐺。 */
    bell?: Notifications | null;
}

/**
 * 待審留言（草稿）的顯示與操作，單頁、清單／看板的詳情視窗、右下角對話面板三處共用這一份（伺服器端渲染）；
 * 後兩者經對話端點的 drafts_html 取得，按鈕行為由 client/message-drafts.js 處理，送出一律走 paths.draftSend。
 * 只有開發團隊拿得到；按「送出」才變成正式留言。
 * anchor：只有單頁放 id="message-drafts"（通知與清單的連結要跳到這裡），視窗與面板重複出現，不放 id。
 */
export const DraftsSection: FC<{ v: ViewContext; slug: string; publicId: string; drafts: DraftView[]; draftErrors?: { id: number; errors: string[]; old: string }; anchor?: boolean }> = ({ v, slug, publicId, drafts, draftErrors, anchor }) => {
    const labels = v.cfg.labels;
    const base = `${paths.report(slug, publicId)}/drafts`;
    const back = paths.report(slug, publicId);
    return (
        <div id={anchor ? 'message-drafts' : undefined} class="border-t border-amber-200 bg-amber-50/70 px-5 py-4 sm:px-7" data-message-drafts>
            <h3 class="text-sm font-bold text-amber-900">
                待審留言 {drafts.length}
                <span class="ml-2 text-xs font-normal text-amber-800">只有{labels.owner}看得到，按「送出」才會發給{labels.client}</span>
            </h3>
            <ol class="mt-3 grid gap-3">
                {drafts.map((draft) => {
                    const errors = draftErrors?.id === draft.id ? draftErrors.errors : [];
                    return (
                        <li class="rounded-xl border border-dashed border-amber-400 bg-white p-3.5 shadow-sm" data-message-draft={String(draft.id)} data-draft-send-url={paths.draftSend(slug, publicId, draft.id)}>
                            <div class="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                                <span class="font-semibold text-amber-900">{withAgent(draft.display_author, draft.author_agent, true)}</span>
                                <Time v={v} at={draft.updated_at} relative />
                                {draft.replaces_message_id !== null ? (
                                    <span class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900" data-draft-replaces={String(draft.replaces_message_id)}>修改原留言</span>
                                ) : null}
                            </div>
                            {draft.replaces_body !== null ? (
                                <details class="mt-2 text-xs text-slate-600">
                                    <summary class="cursor-pointer">原留言內容</summary>
                                    <p class="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 leading-5">{draft.replaces_body}</p>
                                </details>
                            ) : null}
                            <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-draft-body>{draft.body}</p>
                            {draft.files.length > 0 ? (
                                <div class="mt-2 flex flex-wrap gap-2">
                                    {draft.files.map((file, index) =>
                                        isVideoMime(file.mime_type) ? (
                                            <div class="min-w-0 w-full max-w-md">
                                                <video controls playsinline preload="metadata" src={`${base}/${draft.id}/files/${index}`} class="max-h-60 w-full rounded-lg border border-slate-200 bg-black" title={file.original_name} data-draft-video></video>
                                                <AttachmentCaption name={file.original_name} class="mt-0.5" />
                                            </div>
                                        ) : (
                                            <div class="min-w-0 w-24">
                                            <a href={`${base}/${draft.id}/files/${index}`} target="_blank" rel="noreferrer" class="block size-24 overflow-hidden rounded-lg border border-slate-200 bg-white" data-lightbox-trigger data-lightbox-alt={file.original_name}>
                                                <img src={`${base}/${draft.id}/files/${index}`} alt={file.original_name} class="size-full object-cover" loading="lazy" />
                                            </a>
                                            <AttachmentCaption name={file.original_name} class="mt-0.5" />
                                            </div>
                                        ),
                                    )}
                                </div>
                            ) : null}
                            <div class="mt-3 flex flex-wrap items-center gap-2">
                                <form method="post" action={paths.draftSend(slug, publicId, draft.id)} data-draft-form="send">
                                    <input type="hidden" name="_back" value={back} />
                                    <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-draft-send>送出</button>
                                </form>
                                <form method="post" action={`${base}/${draft.id}/discard`} data-confirm="確定捨棄這則待審留言？" data-draft-form="discard">
                                    <input type="hidden" name="_back" value={back} />
                                    <button type="submit" class="inline-flex min-h-9 items-center rounded-lg border border-rose-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-draft-discard>捨棄</button>
                                </form>
                                <p class="w-full rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-draft-error hidden></p>
                                <details class="w-full" open={errors.length > 0} data-draft-editor>
                                    <summary class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">編輯</summary>
                                    <form method="post" action={`${base}/${draft.id}/update`} class="mt-2 grid gap-2" data-draft-form="update">
                                        <input type="hidden" name="_back" value={back} />
                                        <textarea name="body" aria-label="待審留言內容" data-draft-edit-body required maxlength={MAX_MESSAGE} rows={5} class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{errors.length > 0 ? draftErrors?.old ?? '' : draft.body}</textarea>
                                        {errors.map((error) => (
                                            <p class="text-xs text-rose-700">{error}</p>
                                        ))}
                                        <div class="flex flex-wrap gap-2">
                                            <button type="submit" class="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">儲存草稿（不送出）</button>
                                            <button type="button" class="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-teal-800" data-draft-save-send>照這樣直接送出</button>
                                        </div>
                                    </form>
                                </details>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};

export interface WorkState {
    claim: { by: string; since: string; yours: boolean } | null;
    handoff_notes: Array<{ author: string; created_at: string; note: string }>;
    recent_activity: Array<{ kind: string; by: string; detail: string | null; at: string }>;
}

const EVENT_LABELS: Record<string, string> = {
    created: '開單',
    message: '留言',
    adjustment: '寫調整重點',
    status: '改狀態',
    claim: '認領',
    release: '釋放認領',
    takeover: '接手',
    handoff: '寫交接紀錄',
};

function eventDetail(kind: string, detail: string | null, labels: StatusLabels): string {
    if (!detail) {
        return '';
    }
    if (kind === 'status') {
        const [from, to] = detail.split('>');
        return `：${isStatus(from) ? statusLabel(from, labels) : from} → ${isStatus(to) ? statusLabel(to, labels) : to}`;
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
                    已有人認領。改狀態前先看下方交接紀錄；要接手請按「接手」，會留下紀錄。
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
                                {eventDetail(event.kind, event.detail, v.cfg.statusLabels)}
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
        </section>
    );
};

/**
 * Jira 式右側窄欄的動態部分：狀態、「完成」鈕、建立者、時間（詳情視窗與單頁共用；詳情視窗靠對話端點的 side_html 隨狀態更新）。
 * 完成鈕：客戶端按了確認後直接把單改成已完成；開發團隊端按了只會跳出確認留言視窗（RequestCompletionDialog），
 * 單維持等客戶，不會直接結案。編輯、刪除等操作在 DetailActions，不隨狀態更新。
 */
export const DetailSide: FC<{ v: ViewContext; slug: string; report: Report; isOwner: boolean; canManage: boolean; creatorLabel: string | null }> = ({ v, slug, report, isOwner, canManage, creatorLabel }) => {
    const labels = v.cfg.labels;
    const id = report.public_id;
    return (
        <div class="grid gap-4" data-detail-side>
            <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">狀態</p>
                <div class="mt-1.5" data-report-status-badge={id}>
                    <StatusBadge status={report.status} labels={v.cfg.statusLabels} />
                </div>
            </div>
            {canManage && report.status !== 'completed' ? (
                <div data-detail-complete>
                    {isOwner ? (
                        <>
                            <button type="button" class="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-dialog-open={`request-completion-${id}`} data-request-completion={id} title={`發一則確認留言，請${labels.client}確認；不會直接結案`}>完成</button>
                            <p class="mt-1 text-[11px] leading-4 text-slate-500">會發確認留言請{labels.client}按「{COMPLETION_APPROVE_LABEL}」，不會直接結案。</p>
                        </>
                    ) : (
                        <form method="post" action={paths.reportStatus(slug, id)} data-confirm={COMPLETE_CONFIRM} data-completion-approve-form>
                            <input type="hidden" name="_back" value={paths.report(slug, id)} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" class="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-complete-report>完成</button>
                        </form>
                    )}
                </div>
            ) : null}
            <dl class="grid gap-3 text-xs">
                {creatorLabel ? <div><dt class="text-slate-500">建立者</dt><dd class="mt-0.5 font-medium text-slate-800" data-report-creator>{creatorLabel}</dd></div> : null}
                <div><dt class="text-slate-500">建立時間</dt><dd class="mt-0.5 font-medium text-slate-800"><Time v={v} at={report.created_at} /></dd></div>
                <div><dt class="text-slate-500">最後更新</dt><dd class="mt-0.5 font-medium text-slate-800"><Time v={v} at={report.latest_activity_at} relative /></dd></div>
                {isOwner && report.client_deleted_at ? (
                    <div data-client-deleted><dt class="text-slate-500">{labels.client}已刪除</dt><dd class="mt-0.5 font-medium text-slate-800"><Time v={v} at={report.client_deleted_at} /></dd></div>
                ) : null}
            </dl>
        </div>
    );
};

const ACTION_BUTTON = 'inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';

/** 詳情視窗右側窄欄下方的操作：編輯、還原、刪除、完整頁、在對話面板開啟。 */
export const DetailActions: FC<{ slug: string; report: Report; isOwner: boolean; backPath: string }> = ({ slug, report, isOwner, backPath }) => {
    const id = report.public_id;
    return (
        <div class="flex flex-wrap gap-2 border-t border-slate-100 pt-3" data-detail-actions>
            <button type="button" class={ACTION_BUTTON} data-dialog-open={`edit-report-${id}`}>編輯</button>
            {isOwner && report.client_deleted_at ? (
                <form method="post" action={paths.reportRestore(slug, id)}>
                    <input type="hidden" name="_back" value={backPath} />
                    <button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                </form>
            ) : null}
            <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open={isOwner ? `delete-report-${id}` : `client-delete-report-${id}`} data-delete-report={isOwner ? '' : undefined} data-client-delete-report={isOwner ? undefined : ''}>刪除</button>
            <a href={paths.report(slug, id)} class={ACTION_BUTTON}>完整頁</a>
            <button type="button" class={ACTION_BUTTON} data-chat-open={id}>在對話面板開啟</button>
        </div>
    );
};

/**
 * 開發團隊按「完成」後的確認視窗：可改字的確認留言（預設文字見 shared/completion.ts）。
 * 送出只會發一則附「通過」按鈕的留言，單維持等客戶，不會結案。詳情視窗與單頁共用；client/completion.js 送出。
 */
export const RequestCompletionDialog: FC<{ v: ViewContext; slug: string; report: Report }> = ({ v, slug, report }) => {
    const labels = v.cfg.labels;
    const id = report.public_id;
    return (
        <dialog id={`request-completion-${id}`} class="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby={`request-completion-title-${id}`} data-request-completion-dialog>
            <form method="post" action={paths.reportRequestCompletion(slug, id)} class="grid gap-4 p-5 sm:p-6" data-request-completion-form>
                <input type="hidden" name="_back" value={paths.report(slug, id)} />
                <h2 id={`request-completion-title-${id}`} class="text-lg font-bold text-slate-950">請{labels.client}確認完成</h2>
                <p class="text-sm leading-6 text-slate-600">會發出下面這則留言，留言上有「{COMPLETION_APPROVE_LABEL}」按鈕。這張單維持「{v.cfg.statusLabels.needs_input}」，要{labels.client}按「{COMPLETION_APPROVE_LABEL}」才會變成已完成。可以先改字。</p>
                <label for={`request-completion-body-${id}`} class="sr-only">確認留言內容</label>
                <textarea id={`request-completion-body-${id}`} name="body" rows={4} required maxlength={MAX_MESSAGE} class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-request-completion-body>{defaultCompletionBody(labels.client)}</textarea>
                <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-request-completion-error hidden></p>
                <div class="flex justify-end gap-3">
                    <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close>取消</button>
                    <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60" data-request-completion-send>送出確認留言</button>
                </div>
            </form>
        </dialog>
    );
};

export const ReportPage: FC<ReportPageProps> = (props) => {
    const { v, project, report, isOwner, isPublicReporter, attachmentUrl } = props;
    const labels = v.cfg.labels;
    const slug = project.slug;
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
            bell={props.bell}
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

            <div class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 overflow-x-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
                    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
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
                        </div>

                        <div class="mt-5" data-report-description><RichText text={report.description} /></div>

                        {props.attachments.length > 0 ? (
                            <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {props.attachments.map((attachment) => (
                                    <a href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt={attachment.original_name}>
                                        <AttachmentMedia src={attachmentUrl(attachment)} name={attachment.original_name} mime={attachment.mime_type} class="aspect-video w-full object-cover transition group-hover:scale-[1.02]" />
                                        <span class="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">{attachmentLinkTitle(attachment.mime_type)}</span>
                                    </a>
                                ))}
                            </div>
                        ) : null}

                        <div class="mt-5 empty:hidden" id="adjustment">
                            <PastNotes report={report} adjustmentAttachments={props.adjustmentAttachments} attachmentUrl={attachmentUrl} />
                        </div>
                    </section>

                    <section id="conversation" class="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm" data-conversation>
                        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
                            <div class="min-w-0">
                                {isOwner || readOnly ? (
                                    <h2 class="text-base font-semibold text-slate-950">活動</h2>
                                ) : (
                                    <>
                                        <h2 class="text-lg font-bold text-slate-950">留言給{labels.owner}</h2>
                                        <p class="mt-1 text-sm leading-6 text-slate-600" data-message-hint>有問題或補充可以直接在這裡留言，我們會看到並回覆</p>
                                    </>
                                )}
                            </div>
                            {props.canManage ? (
                                <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-open={report.public_id}>在對話面板開啟</button>
                            ) : null}
                        </div>

                        <div class="bg-slate-50/60 px-4 py-5 sm:px-7" data-activity data-refresh-url={paths.reportActivity(slug, report.public_id)} data-etag={props.activityEtag}>
                            <Thread v={v} slug={slug} report={report} messages={props.messages} messageAttachments={props.messageAttachments} attachmentUrl={attachmentUrl} viewerIsOwner={isOwner} statusEvents={props.statusEvents} canApprove={props.canApprove} album={props.album} />
                        </div>

                        {isOwner && props.drafts && props.drafts.length > 0 ? <DraftsSection v={v} slug={slug} publicId={report.public_id} drafts={props.drafts} draftErrors={props.draftErrors} anchor /> : null}

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
                                    <div id="message-preview" class="flex flex-wrap items-start gap-3 empty:hidden" aria-live="polite"></div>
                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                        <div class="flex flex-wrap items-center gap-3">
                                            <label for="message-screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                                {isPublicReporter ? '加入截圖' : MESSAGE_UPLOAD_LABEL}
                                                <input id="message-screenshots" type="file" accept={isPublicReporter ? IMAGE_ACCEPT : MESSAGE_ACCEPT} multiple class="sr-only" data-image-input data-attachment-composer="page" data-preview-target="message-preview" data-upload-url={`${paths.uploads(slug)}?purpose=message&report=${encodeURIComponent(report.public_id)}`} data-upload-name="upload_ids[]" data-upload-max={String(isPublicReporter ? PUBLIC_MAX_SCREENSHOTS : 5)} data-upload-max-bytes={String(maxMessageBytes)} data-upload-allow-video={isPublicReporter ? undefined : ''} />
                                            </label>
                                            <span class="text-xs text-slate-500">{isPublicReporter ? `截圖最多 ${PUBLIC_MAX_SCREENSHOTS} 張，每張 5 MB。` : `${MESSAGE_HINT}。`}</span>
                                        </div>
                                        <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出訊息</button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </section>
                </div>

                <aside class="grid min-w-0 gap-4 lg:sticky lg:top-6">
                    {props.canManage ? (
                        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-report-status-panel data-detail-side-box>
                            <DetailSide v={v} slug={slug} report={report} isOwner={isOwner} canManage={props.canManage} creatorLabel={props.creatorLabel && !isPublicReporter ? props.creatorLabel : null} />
                        </section>
                    ) : (
                        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-detail-side-box>
                            <DetailSide v={v} slug={slug} report={report} isOwner={false} canManage={false} creatorLabel={null} />
                        </section>
                    )}
                    {isOwner && props.work ? <WorkPanel v={v} slug={slug} publicId={report.public_id} work={props.work} canClaim={props.canClaim === true} /> : null}
                </aside>
            </div>
            {isOwner && props.canManage ? <RequestCompletionDialog v={v} slug={slug} report={report} /> : null}
        </Layout>
    );
};
