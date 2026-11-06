import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';
import { statusDotClass, statusLabel, type ReportStatus, type StatusLabels } from '../../shared/status';
import { badgeText, unreadDotLabel } from '../../shared/conversation';
import { formatAbsolute, formatRelative } from '../../shared/time';
import type { FeedbackConfig } from '../env';
import type { Notifications } from '../lib/notifications';
import { charSlice } from '../../shared/text';
import { paths } from '../routes/paths';
import { ASSET_VERSION } from '../version';
import { attachmentTitle } from '../../shared/attachment-list';
import { isVideoMime, MESSAGE_ACCEPT, MESSAGE_HINT, MESSAGE_UPLOAD_LABEL } from '../../shared/attachment-rules';
import { CHAT_ICON_PATHS, REPORT_LINK_CLASS, UNREAD_DOT_CLASS } from './chat-classes';

/** Values every view needs: configuration and the current time. */
export interface ViewContext {
    cfg: FeedbackConfig;
    now: number;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const Time: FC<{ v: ViewContext; at: string; relative?: boolean; class?: string }> = ({ v, at, relative, class: className }) => {
    const absolute = formatAbsolute(at, v.cfg.utcOffsetMinutes);
    const text = relative ? formatRelative(at, v.now) : absolute;
    return (
        <time datetime={at} title={`${absolute}（${v.cfg.timezoneName}）`} class={className}>
            {text}
        </time>
    );
};

const BADGE_CLASSES: Record<ReportStatus, string> = {
    new: 'bg-slate-100 text-slate-700 ring-slate-200',
    needs_input: 'bg-amber-50 text-amber-800 ring-amber-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

/**
 * 標題右邊的未讀小圓點數字（取代以前的留言按鈕與「N 則未讀」標籤）：純指示，不能點。
 * 沒有未讀時只留空的容器，讀過或面板刷新時由 chat-panel.js 填入或清掉。rows.ts 的 unreadDotHtml 是同一份 HTML 的字串版。
 */
export const UnreadDot: FC<{ publicId: string; unread: number }> = ({ publicId, unread }) => (
    <span class="inline-flex shrink-0 items-center" data-unread-slot={publicId}>
        {unread > 0 ? <span class={UNREAD_DOT_CLASS} data-unread-dot="" title={unreadDotLabel(unread)} aria-label={unreadDotLabel(unread)}>{badgeText(unread)}</span> : null}
    </span>
);

/**
 * 清單、看板上的編號與標題：藍色連結色，hover 底線與手指游標。點了開詳情視窗（沒有 JS 時照連結去單頁）；
 * 整列、整張卡片的點擊由 client/row-link.js 處理，這裡只管連結本身。rows.ts 的 reportLinkHtml 是同一份 HTML 的字串版。
 */
export const ReportLink: FC<{ slug: string; publicId: string; class?: string; children?: Child }> = ({ slug, publicId, class: extra, children }) => (
    <a href={paths.report(slug, publicId)} class={cx(REPORT_LINK_CLASS, extra)} data-dialog-open={`detail-report-${publicId}`} data-report-detail-open>{children}</a>
);

/**
 * 附件縮圖的內容：圖片照舊用 <img>；mp4 影片用 <video muted preload="metadata"> 抓第一格畫面（#t=0.1），
 * 疊播放三角形，尺寸跟圖片縮圖一樣（class 同一組）。外層連結的 data-attachment-video 讓燈箱略過，影片直接在新分頁播放。
 * rows.ts 的 attachmentMediaHtml 是同一份 HTML 的字串版。
 */
export const AttachmentMedia: FC<{ src: string; name: string; mime: string | null | undefined; class: string }> = ({ src, name, mime, class: className }) =>
    isVideoMime(mime) ? (
        <span class={`relative block overflow-hidden bg-slate-900 ${className}`} data-attachment-video>
            <video muted playsinline preload="metadata" src={`${src}#t=0.1`} class="pointer-events-none size-full object-cover" aria-hidden="true" tabindex={-1}></video>
            <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="grid size-7 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80">
                    <svg class="ml-0.5 size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </span>
            </span>
            <span class="sr-only">影片：{name}</span>
        </span>
    ) : (
        <img src={src} alt={name} class={className} loading="lazy" />
    );

/** 詳情視窗的附件縮圖；影片顯示第一格畫面＋播放三角形，點了在新分頁播放（相簿的 data-lightbox-play 才在燈箱播放）。 */
export const Thumb: FC<{ href: string; name: string; mime: string | null | undefined; size?: string }> = ({ href, name, mime, size = 'size-20' }) => (
    <a href={href} target="_blank" rel="noreferrer" class={`block ${size} overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={name} title={attachmentLinkTitle(mime)}>
        <AttachmentMedia src={href} name={name} mime={mime} class="size-full object-cover" />
    </a>
);

/** 附件的一行短標題：檔名去掉副檔名，太長截斷加省略號，滑鼠移上去看完整檔名（留言、待審留言共用）。 */
export const AttachmentCaption: FC<{ name: string; class?: string }> = ({ name, class: className }) => (
    <span class={cx('block truncate text-[11px] leading-4 text-slate-600', className)} title={name} data-attachment-title>{attachmentTitle(name)}</span>
);

/** 附件縮圖連結的 title：圖片放大預覽、影片開新分頁播放。 */
export function attachmentLinkTitle(mime: string | null | undefined): string {
    return isVideoMime(mime) ? '開新分頁播放' : '放大預覽';
}

export const StatusBadge: FC<{ status: ReportStatus; labels: StatusLabels }> = ({ status, labels }) => (
    <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${BADGE_CLASSES[status]}`} data-status-badge={status}>{statusLabel(status, labels)}</span>
);

/**
 * 清單列的狀態欄：只顯示狀態文字（狀態由留言自動切換、客戶按「完成」，網頁上沒有下拉）。
 * rows.ts 的 statusTextHtml 是同一份 HTML 的字串版。
 */
export const StatusText: FC<{ status: ReportStatus; labels: StatusLabels }> = ({ status, labels }) => (
    <span class="flex items-center gap-2 sm:justify-center">
        <span class={`size-2.5 shrink-0 rounded-full ${statusDotClass(status)}`} aria-hidden="true" data-status-dot></span>
        <span class="text-xs font-semibold text-slate-700" data-status-text={status}>{statusLabel(status, labels)}</span>
    </span>
);

export const ImageLightbox: FC = () => (
    <dialog data-image-lightbox class="m-auto h-[100dvh] w-screen max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/90 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-2xl" aria-labelledby="image-lightbox-title">
        <div class="flex h-full min-h-0 flex-col bg-slate-950 text-white">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 sm:px-5">
                <h2 id="image-lightbox-title" class="min-w-0 flex-1 truncate text-sm font-semibold" data-lightbox-title>截圖預覽</h2>
                <div class="flex flex-wrap items-center justify-end gap-2">
                    <div class="flex items-center overflow-hidden rounded-lg border border-white/20" role="group" aria-label="縮放控制" data-lightbox-zoom-group>
                        <button type="button" class="grid size-10 place-items-center text-lg transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-zoom-out aria-label="縮小">−</button>
                        <output class="min-w-14 border-x border-white/20 px-2 text-center text-xs tabular-nums text-slate-200" data-lightbox-scale>100%</output>
                        <button type="button" class="grid size-10 place-items-center text-lg transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-zoom-in aria-label="放大">＋</button>
                    </div>
                    <button type="button" class="min-h-10 rounded-lg border border-white/20 px-3 text-xs font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-reset>重設</button>
                    <a href="#" target="_blank" rel="noreferrer" class="inline-flex min-h-10 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-original>開啟原圖</a>
                    <button type="button" class="grid size-10 place-items-center rounded-lg bg-white text-xl text-slate-950 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-close aria-label="關閉截圖預覽">×</button>
                </div>
            </div>
            <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6" data-lightbox-stage>
                <img src="" alt="" class="max-h-full max-w-full origin-center object-contain transition-transform duration-150" data-lightbox-image />
                <video controls playsinline class="max-h-full max-w-full bg-black" data-lightbox-video hidden></video>
            </div>
        </div>
    </dialog>
);

export interface LayoutProps {
    v: ViewContext;
    title: string;
    project?: { name: string; slug: string } | null;
    projects?: Array<{ name: string; slug: string }>;
    showLogout?: boolean;
    logoutUrl?: string;
    /** Show the "my account" link (signed in with an account, not an entry link). */
    passwordLink?: boolean;
    maxWidth?: string;
    headerAction?: Child;
    success?: string;
    /** Signed-in project members get the bottom-right chat panel. */
    chatPanel?: { slug: string; viewer: 'owner' | 'client' };
    /** 頁首通知鈴鐺（登出旁）；沒有登入身分時不給。 */
    bell?: Notifications | null;
    children?: Child;
}

/** Excerpt width of a bell item, in characters. */
const BELL_EXCERPT_CHARS = 80;

/**
 * 頁首通知鈴鐺：只列對方發的、自己還沒讀的留言；點了開啟該單留言處（開單即標已讀）。
 * 團隊端另列待審留言；客戶端永遠沒有草稿，用語寫「新留言」。
 */
export const NotificationBell: FC<{ v: ViewContext; bell: Notifications }> = ({ v, bell }) => {
    const labels = v.cfg.labels;
    return (
        <details class="relative" data-notification-bell data-bell-count={String(bell.total)}>
            <summary class="relative grid size-10 cursor-pointer list-none place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden" aria-label={`通知（${bell.total} 則新留言）`} title="通知">
                <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {bell.total > 0 ? (
                    <span class="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white" data-bell-badge>{badgeText(bell.total)}</span>
                ) : null}
            </summary>
            <div class="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ring-1 ring-black/5">
                <p class="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">{bell.isOwner ? `${labels.client}的新留言` : `${labels.owner}的新留言`}</p>
                <div class="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
                    {bell.items.length === 0 ? (
                        <p class="px-4 py-6 text-center text-sm text-slate-500">目前沒有新留言</p>
                    ) : (
                        bell.items.map((item) => {
                            const excerpt = charSlice(item.excerpt, BELL_EXCERPT_CHARS);
                            return (
                                <a href={`${paths.report(item.projectSlug, item.publicId)}#conversation`} class="block border-b border-slate-100 px-4 py-3 transition hover:bg-teal-50" data-bell-item={item.publicId}>
                                    <span class="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                        <span class="truncate">{item.projectName}</span>
                                        <Time v={v} at={item.at} relative class="shrink-0" />
                                    </span>
                                    <span class="mt-0.5 flex items-center gap-2">
                                        <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{item.title}</span>
                                        <span class="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{badgeText(item.unread)}</span>
                                    </span>
                                    <span class="mt-1 block text-xs leading-5 text-slate-600">{excerpt.length < item.excerpt.length ? `${excerpt}…` : excerpt}</span>
                                </a>
                            );
                        })
                    )}
                </div>
                {bell.drafts.length > 0 ? (
                    <div class="border-t border-amber-200 bg-amber-50/70">
                        <p class="px-4 pt-2.5 text-xs font-semibold text-amber-900">待審留言（只有{labels.owner}看得到）</p>
                        {bell.drafts.map((draft) => (
                            <a href={`${paths.report(draft.projectSlug, draft.publicId)}#message-drafts`} class="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-amber-100" data-bell-draft={draft.publicId}>
                                <span class="min-w-0 truncate"><span class="text-[11px] text-amber-800">{draft.projectName}｜</span>{draft.title}</span>
                                <span class="shrink-0 rounded-full border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900">待審留言 {draft.count}</span>
                            </a>
                        ))}
                    </div>
                ) : null}
            </div>
        </details>
    );
};

export const Layout: FC<LayoutProps> = ({ v, title, project, projects, showLogout, logoutUrl, passwordLink, maxWidth = 'max-w-5xl', headerAction, success, chatPanel, bell, children }) => (
    <>
    {raw('<!DOCTYPE html>')}
    <html lang="zh-Hant">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="referrer" content="no-referrer" />
            <title>{title}</title>
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            <link rel="stylesheet" href={`/assets/app.css?v=${ASSET_VERSION}`} />
            <script type="module" src={`/assets/app.js?v=${ASSET_VERSION}`}></script>
        </head>
        <body class="min-h-screen bg-slate-50 font-sans text-slate-950 antialiased">
            <div class="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-teal-50 to-transparent"></div>

            <header class="relative z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur">
                <div class={`mx-auto flex ${maxWidth} items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8`}>
                    <div class="flex min-w-0 items-center gap-3">
                        <a href={project ? paths.portal(project.slug) : '/'} class="flex shrink-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
                            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm">回</span>
                        </a>
                        {projects && projects.length > 1 ? (
                            <div class="flex min-w-0 items-center gap-2">
                                <label for="project-switcher" class="sr-only">切換專案</label>
                                <select
                                    id="project-switcher"
                                    data-project-switcher
                                    class="block max-w-[15rem] sm:max-w-xs truncate rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm font-bold text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10 cursor-pointer"
                                >
                                    {projects.map((p) => (
                                        <option value={paths.portal(p.slug)} selected={p.slug === project?.slug}>
                                            📁 {p.name}
                                        </option>
                                    ))}
                                </select>
                                <a href={paths.ownerProjects()} class="hidden sm:inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-teal-700 transition" title="專案總覽">
                                    專案總覽
                                </a>
                            </div>
                        ) : (
                            <a href={project ? paths.portal(project.slug) : '/'} class="min-w-0">
                                <span class="block truncate text-sm font-semibold text-slate-950">{project?.name ?? v.cfg.home.title}</span>
                            </a>
                        )}
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        {headerAction}
                        {project && passwordLink ? (
                            <a href={paths.account(project.slug)} class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-account-link>我的帳號</a>
                        ) : null}
                        {bell ? <NotificationBell v={v} bell={bell} /> : null}
                        {(project || logoutUrl) && showLogout ? (
                            <form method="post" action={logoutUrl ?? (project ? paths.logout(project.slug) : paths.ownerGlobalLogout())}>
                                <button type="submit" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-logout>登出</button>
                            </form>
                        ) : null}
                    </div>
                </div>
            </header>

            <main class={cx('relative mx-auto w-full px-4 py-8 sm:px-6 sm:py-12 lg:px-8', maxWidth, chatPanel ? 'pb-28 sm:pb-28' : null)}>
                {success ? (
                    <div role="status" class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                        {success}
                    </div>
                ) : null}

                {children}
            </main>

            {chatPanel ? <ChatPanel v={v} slug={chatPanel.slug} viewer={chatPanel.viewer} /> : null}

            <ImageLightbox />
        </body>
    </html>
    </>
);

export const ErrorList: FC<{ errors: string[]; class?: string; heading?: string }> = ({ errors, class: className, heading }) =>
    errors.length === 0 ? null : (
        <div role="alert" class={cx('rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800', className)}>
            {heading ? <p class="font-semibold">{heading}</p> : null}
            <ul class={cx('list-disc space-y-1 pl-5', heading ? 'mt-2' : null)}>
                {errors.map((error) => (
                    <li>{error}</li>
                ))}
            </ul>
        </div>
    );

/** Laravel's Tailwind pagination view, with Chinese text. */
export const Pagination: FC<{ page: number; lastPage: number; total: number; perPage: number; url: (page: number) => string }> = ({ page, lastPage, total, perPage, url }) => {
    if (lastPage <= 1) {
        return null;
    }
    const first = (page - 1) * perPage + 1;
    const last = Math.min(total, page * perPage);
    const pages: Array<number | '...'> = [];
    if (lastPage <= 13) {
        for (let i = 1; i <= lastPage; i++) pages.push(i);
    } else if (page <= 8) {
        for (let i = 1; i <= 10; i++) pages.push(i);
        pages.push('...', lastPage - 1, lastPage);
    } else if (page > lastPage - 8) {
        pages.push(1, 2, '...');
        for (let i = lastPage - 9; i <= lastPage; i++) pages.push(i);
    } else {
        pages.push(1, 2, '...');
        for (let i = page - 3; i <= page + 3; i++) pages.push(i);
        pages.push('...', lastPage - 1, lastPage);
    }
    const linkClass = 'inline-flex items-center px-4 py-2 text-sm font-medium text-gray-800 bg-white border border-gray-300 leading-5 rounded-md hover:text-gray-700 focus:outline-none focus:ring ring-gray-300 focus:border-blue-300 active:bg-gray-100 active:text-gray-800 transition ease-in-out duration-150 hover:bg-gray-100';
    const disabledClass = 'inline-flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 cursor-not-allowed leading-5 rounded-md';
    const arrowLeft = <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>;
    const arrowRight = <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" /></svg>;
    return (
        <nav role="navigation" aria-label="分頁">
            <div class="flex gap-2 items-center justify-between sm:hidden">
                {page <= 1 ? <span class={disabledClass}>« 上一頁</span> : <a href={url(page - 1)} rel="prev" class={linkClass}>« 上一頁</a>}
                {page < lastPage ? <a href={url(page + 1)} rel="next" class={linkClass}>下一頁 »</a> : <span class={disabledClass}>下一頁 »</span>}
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:gap-2 sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700 leading-5">
                        顯示第 <span class="font-medium">{first}</span> 到 <span class="font-medium">{last}</span> 筆，共 <span class="font-medium">{total}</span> 筆
                    </p>
                </div>
                <div>
                    <span class="inline-flex rtl:flex-row-reverse shadow-sm rounded-md">
                        {page <= 1 ? (
                            <span aria-disabled="true" aria-label="上一頁">
                                <span class="inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 cursor-not-allowed rounded-l-md leading-5" aria-hidden="true">{arrowLeft}</span>
                            </span>
                        ) : (
                            <a href={url(page - 1)} rel="prev" class="inline-flex items-center px-2 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-l-md leading-5 hover:text-gray-400 focus:outline-none focus:ring ring-gray-300 focus:border-blue-300 active:bg-gray-100 active:text-gray-500 transition ease-in-out duration-150" aria-label="上一頁">{arrowLeft}</a>
                        )}
                        {pages.map((item) =>
                            item === '...' ? (
                                <span aria-disabled="true">
                                    <span class="inline-flex items-center px-4 py-2 -ml-px text-sm font-medium text-gray-700 bg-white border border-gray-300 cursor-default leading-5">...</span>
                                </span>
                            ) : item === page ? (
                                <span aria-current="page">
                                    <span class="inline-flex items-center px-4 py-2 -ml-px text-sm font-medium text-gray-700 bg-gray-200 border border-gray-300 cursor-default leading-5">{item}</span>
                                </span>
                            ) : (
                                <a href={url(item)} class="inline-flex items-center px-4 py-2 -ml-px text-sm font-medium text-gray-700 bg-white border border-gray-300 leading-5 hover:text-gray-700 focus:outline-none focus:ring ring-gray-300 focus:border-blue-300 active:bg-gray-100 active:text-gray-700 transition ease-in-out duration-150 hover:bg-gray-100" aria-label={`前往第 ${item} 頁`}>
                                    {item}
                                </a>
                            ),
                        )}
                        {page < lastPage ? (
                            <a href={url(page + 1)} rel="next" class="inline-flex items-center px-2 py-2 -ml-px text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-r-md leading-5 hover:text-gray-400 focus:outline-none focus:ring ring-gray-300 focus:border-blue-300 active:bg-gray-100 active:text-gray-500 transition ease-in-out duration-150" aria-label="下一頁">{arrowRight}</a>
                        ) : (
                            <span aria-disabled="true" aria-label="下一頁">
                                <span class="inline-flex items-center px-2 py-2 -ml-px text-sm font-medium text-gray-500 bg-white border border-gray-300 cursor-not-allowed rounded-r-md leading-5" aria-hidden="true">{arrowRight}</span>
                            </span>
                        )}
                    </span>
                </div>
            </div>
        </nav>
    );
};

/**
 * Bottom-right chat panel. The list and the conversations come from endpoints that need a project
 * sign-in; the script puts list texts in with textContent and conversations as server-escaped HTML.
 */
export const ChatPanel: FC<{ v: ViewContext; slug: string; viewer: 'owner' | 'client' }> = ({ v, slug, viewer }) => (
    <div data-chat-root data-list-url={paths.conversations(slug)} data-thread-url-template={paths.conversation(slug, '__REPORT__')} data-viewer={viewer}>
        <button type="button" class="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-teal-700 text-white shadow-lg shadow-teal-900/20 transition hover:bg-teal-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/40 sm:bottom-6 sm:right-6" aria-controls="chat-panel" aria-expanded="false" data-chat-launcher>
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{raw(CHAT_ICON_PATHS)}</svg>
            <span class="sr-only">開啟留言對話</span>
            <span class="absolute -right-1 -top-1 min-w-6 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-xs font-bold leading-4 text-white ring-2 ring-white" data-chat-launcher-badge hidden></span>
        </button>

        <section id="chat-panel" class="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(42rem,calc(100dvh-8rem))] sm:w-[min(56rem,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl" role="dialog" aria-modal="false" aria-labelledby="chat-panel-title" data-chat-panel data-view="list" hidden>
            <header class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-teal-700 px-4 py-3 text-white">
                <h2 id="chat-panel-title" class="text-sm font-bold">留言對話</h2>
                <button type="button" class="grid size-9 place-items-center rounded-lg text-xl transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="關閉留言對話" data-chat-close>×</button>
            </header>

            <div class="flex min-h-0 flex-1">
                <div class="flex min-h-0 w-full flex-col border-slate-200 sm:w-72 sm:shrink-0 sm:border-r" data-chat-list-pane>
                    <div class="shrink-0 border-b border-slate-100 p-3">
                        <label for="chat-search" class="sr-only">搜尋標題</label>
                        <input id="chat-search" type="search" placeholder="搜尋標題或編號" autocomplete="off" class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-chat-search />
                    </div>
                    <div class="flex shrink-0 gap-1 border-b border-slate-100 px-3 pt-2" role="tablist" aria-label="對話分類" data-chat-tabs>
                        <button type="button" role="tab" aria-selected="true" class="-mb-px border-b-2 border-teal-700 px-2.5 pb-2 text-xs font-semibold text-teal-800" data-chat-tab="awaiting">未回覆 <span data-chat-tab-count="awaiting">0</span></button>
                        <button type="button" role="tab" aria-selected="false" class="-mb-px border-b-2 border-transparent px-2.5 pb-2 text-xs font-semibold text-slate-500 hover:text-slate-900" data-chat-tab="replied">已回覆 <span data-chat-tab-count="replied">0</span></button>
                    </div>
                    <ul class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="回饋單對話清單" data-chat-list></ul>
                    <p class="p-6 text-center text-sm text-slate-500" data-chat-list-status>載入中…</p>
                </div>

                <div class="flex min-h-0 min-w-0 flex-1 flex-col max-sm:hidden" data-chat-thread-pane>
                    <div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500" data-chat-placeholder>載入中…</div>

                    <div class="flex min-h-0 flex-1 flex-col" data-chat-thread-view hidden>
                        <div class="flex shrink-0 items-start gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                            <button type="button" class="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:hidden" data-chat-back>‹ 返回清單</button>
                            <div class="min-w-0 flex-1">
                                <p class="text-xs font-semibold text-slate-500"><span data-chat-thread-number></span> · <span data-chat-thread-status></span><span class="ml-1 rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-600" data-chat-thread-deleted hidden>{v.cfg.labels.client}已刪除</span></p>
                                <h3 class="truncate text-sm font-bold text-slate-950" data-chat-thread-title></h3>
                            </div>
                            <a href="#" class="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-page-link>開啟完整頁</a>
                        </div>

                        <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-4 sm:px-4" data-chat-scroll>
                            <div aria-live="polite" data-chat-thread></div>
                            {/* 待審留言（只有開發團隊）：與單頁、詳情視窗同一份畫面（report.tsx 的 DraftsSection），顯示在留言串最下面。 */}
                            {viewer === 'owner' ? <div class="mt-4 overflow-hidden rounded-xl empty:hidden" data-chat-drafts></div> : null}
                        </div>

                        <form class="shrink-0 border-t border-slate-200 bg-white p-3" data-chat-form novalidate>
                            <p class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-chat-error data-attachment-error hidden></p>
                            <div id="chat-preview" class="mb-2 flex flex-wrap items-start gap-2 empty:hidden" aria-live="polite"></div>
                            <label for="chat-body" class="sr-only">回覆內容</label>
                            <textarea id="chat-body" name="body" rows={2} maxlength={10000} placeholder="輸入回覆…（Ctrl＋Enter 送出）" class="block max-h-40 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-chat-body-input></textarea>
                            <div class="mt-2 flex items-center justify-between gap-2">
                                <label for="chat-screenshots" class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                    {MESSAGE_UPLOAD_LABEL}
                                    <input id="chat-screenshots" type="file" accept={MESSAGE_ACCEPT} multiple class="sr-only" data-image-input data-attachment-composer data-preview-target="chat-preview" data-chat-files />
                                </label>
                                <span class="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={MESSAGE_HINT}>{MESSAGE_HINT}</span>
                                <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60" data-chat-send>送出</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </section>
    </div>
);
