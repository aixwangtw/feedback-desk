import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';
import { STATUSES, statusDotClass, statusLabel, type ReportStatus } from '../../shared/status';
import { badgeText, chatButtonLabels } from '../../shared/conversation';
import { formatAbsolute, formatRelative } from '../../shared/time';
import type { FeedbackConfig } from '../env';
import { paths } from '../routes/paths';
import { ASSET_VERSION } from '../version';
import { CHAT_BUTTON_BASE, CHAT_BUTTON_ICON, CHAT_BUTTON_LABELLED, CHAT_ICON_PATHS, CHAT_UNREAD_BADGE } from './chat-classes';

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
 * "留言" button on list rows, board cards and the detail dialog: shown when the report has messages
 * or unread items (always with a label). The red round number is the unread count for this viewer
 * (team: client messages; client: team messages plus 1 for a changed adjustment). Clicking it opens
 * the report's conversation in the chat panel. rows.ts has the string version of the icon variant.
 */
export const ChatButton: FC<{ publicId: string; title: string; total: number; unread: number; isOwner: boolean; label?: string; class?: string }> = ({ publicId, title, total, unread, isOwner, label, class: extra }) => {
    if (total <= 0 && unread <= 0 && !label) {
        return null;
    }
    const labels = chatButtonLabels(title, total, unread);
    return (
        <button type="button" class={cx(CHAT_BUTTON_BASE, label ? CHAT_BUTTON_LABELLED : CHAT_BUTTON_ICON, extra)} data-chat-open={publicId} data-message-count={String(total)} aria-label={labels.ariaLabel} title={labels.title}>
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{raw(CHAT_ICON_PATHS)}</svg>
            {label ? <span>{label}</span> : null}
            {unread > 0 ? <span class={CHAT_UNREAD_BADGE} data-unread-badge="" data-new-reply-badge={isOwner ? undefined : ''}>{badgeText(unread)}</span> : null}
        </button>
    );
};

export const StatusBadge: FC<{ status: ReportStatus }> = ({ status }) => (
    <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${BADGE_CLASSES[status]}`}>{statusLabel(status)}</span>
);

export const StatusSelect: FC<{ status: ReportStatus; id: string; class?: string; autosave?: boolean }> = ({ status, id, class: extra, autosave }) => (
    <select
        name="status"
        id={id}
        class={cx('rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10', extra)}
        data-status-select={autosave ? '' : undefined}
        data-status-autosave={autosave ? '' : undefined}
    >
        {STATUSES.map((option) => (
            <option value={option} data-dot={statusDotClass(option)} selected={status === option}>
                {statusLabel(option)}
            </option>
        ))}
    </select>
);

export const ImageLightbox: FC = () => (
    <dialog data-image-lightbox class="m-auto h-[100dvh] w-screen max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/90 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-2xl" aria-labelledby="image-lightbox-title">
        <div class="flex h-full min-h-0 flex-col bg-slate-950 text-white">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 sm:px-5">
                <h2 id="image-lightbox-title" class="min-w-0 flex-1 truncate text-sm font-semibold" data-lightbox-title>截圖預覽</h2>
                <div class="flex flex-wrap items-center justify-end gap-2">
                    <div class="flex items-center overflow-hidden rounded-lg border border-white/20" role="group" aria-label="縮放控制">
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
    children?: Child;
}

export const Layout: FC<LayoutProps> = ({ v, title, project, projects, showLogout, logoutUrl, passwordLink, maxWidth = 'max-w-5xl', headerAction, success, chatPanel, children }) => (
    <>
    {raw('<!DOCTYPE html>')}
    <html lang="zh-Hant">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="referrer" content="no-referrer" />
            <title>{title}</title>
            <link rel="stylesheet" href={`/assets/app.css?v=${ASSET_VERSION}`} />
            <script type="module" src={`/assets/app.js?v=${ASSET_VERSION}`}></script>
        </head>
        <body class="min-h-screen bg-slate-50 font-sans text-slate-950 antialiased">
            <div class="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-teal-50 to-transparent"></div>

            <header class="relative border-b border-slate-200/80 bg-white/80 backdrop-blur">
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
                    <ul class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="回饋單對話清單" data-chat-list></ul>
                    <p class="p-6 text-center text-sm text-slate-500" data-chat-list-status>載入中…</p>
                </div>

                <div class="flex min-h-0 min-w-0 flex-1 flex-col max-sm:hidden" data-chat-thread-pane>
                    <div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500" data-chat-placeholder>從左側選一張回饋單查看留言。</div>

                    <div class="flex min-h-0 flex-1 flex-col" data-chat-thread-view hidden>
                        <div class="flex shrink-0 items-start gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                            <button type="button" class="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:hidden" data-chat-back>‹ 返回清單</button>
                            <div class="min-w-0 flex-1">
                                <p class="text-xs font-semibold text-slate-500"><span data-chat-thread-number></span> · <span data-chat-thread-status></span><span class="ml-1 rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-600" data-chat-thread-deleted hidden>{v.cfg.labels.client}已刪除</span></p>
                                <h3 class="truncate text-sm font-bold text-slate-950" data-chat-thread-title></h3>
                            </div>
                            <a href="#" class="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-page-link>開啟完整頁</a>
                        </div>

                        <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-4 sm:px-4" aria-live="polite" data-chat-thread></div>

                        <form class="shrink-0 border-t border-slate-200 bg-white p-3" data-chat-form novalidate>
                            <p class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-chat-error hidden></p>
                            <div id="chat-preview" class="mb-2 grid grid-cols-4 gap-2 empty:hidden sm:grid-cols-5" aria-live="polite"></div>
                            <label for="chat-body" class="sr-only">回覆內容</label>
                            <textarea id="chat-body" name="body" rows={2} maxlength={10000} placeholder="輸入回覆…（Ctrl＋Enter 送出）" class="block max-h-40 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-chat-body-input></textarea>
                            <div class="mt-2 flex items-center justify-between gap-2">
                                <label for="chat-screenshots" class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                    附圖
                                    <input id="chat-screenshots" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="chat-preview" data-chat-files />
                                </label>
                                <span class="min-w-0 flex-1 truncate text-[11px] text-slate-500">最多 5 張，每張 10 MB</span>
                                <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60" data-chat-send>送出</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </section>
    </div>
);
