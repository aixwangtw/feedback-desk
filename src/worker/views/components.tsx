import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';
import { STATUSES, statusDotClass, statusLabel, type ReportStatus } from '../../shared/status';
import { formatAbsolute, formatRelative } from '../../shared/time';
import type { FeedbackConfig } from '../env';
import { paths } from '../routes/paths';
import { ASSET_VERSION } from '../version';

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
    showLogout?: boolean;
    maxWidth?: string;
    headerAction?: Child;
    success?: string;
    children?: Child;
}

export const Layout: FC<LayoutProps> = ({ v, title, project, showLogout, maxWidth = 'max-w-5xl', headerAction, success, children }) => (
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
                    <a href={project ? paths.portal(project.slug) : '/'} class="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
                        <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm">回</span>
                        <span class="min-w-0">
                            <span class="block truncate text-sm font-semibold text-slate-950">{project?.name ?? v.cfg.home.title}</span>
                        </span>
                    </a>
                    <div class="flex shrink-0 items-center gap-2">
                        {headerAction}
                        {project && showLogout ? (
                            <form method="post" action={paths.logout(project.slug)}>
                                <button type="submit" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-logout>登出</button>
                            </form>
                        ) : null}
                    </div>
                </div>
            </header>

            <main class={`relative mx-auto w-full ${maxWidth} px-4 py-8 sm:px-6 sm:py-12 lg:px-8`}>
                {success ? (
                    <div role="status" class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                        {success}
                    </div>
                ) : null}

                {children}
            </main>

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
