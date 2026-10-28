import type { FC } from 'hono/jsx';
import { STATUSES, statusDotClass, statusLabel, type ReportStatus } from '../../shared/status';
import type { Attachment, Project, Report } from '../lib/models';
import { paths } from '../routes/paths';
import { ChatButton, cx, ErrorList, Layout, Pagination, Time, type ViewContext } from './components';
import { AdjustmentBlock, CategoryAutosave, editCategoryOptions } from './report';
import { UNREAD_FILTER_CLASS, UNREAD_SUMMARY_TONES } from './chat-classes';
import { HONEYPOT_FIELD } from './pages';
import { RichText } from './rich-text';
import { boardCardHtml, listRowHtml, type RowContext } from './rows';
import { buildPayload, payloadScript, PORTAL_ROWS_ELEMENT_ID, SERVER_ROW_LIMIT } from './rows-client';
import { raw } from 'hono/html';
import { projectCategories } from '../../shared/categories';

export interface PortalRow {
    report: Report;
    number: number;
    creatorLabel: string;
    attachments: Attachment[];
    adjustmentAttachments: Attachment[];
    /**
     * Unread items for the viewer side: client messages for the team; team messages plus 1 for a
     * changed adjustment for the client. The red number on the chat button.
     */
    unread: number;
    /** All messages on the report. */
    messagesCount: number;
}

export interface PortalFormState {
    /** Which form failed validation. */
    bag: 'default' | 'editReport';
    errors: string[];
    issues?: Array<{ title: string; description: string; category?: string }>;
    editing?: { publicId: string; title: string; description: string; category?: string; remove: string[] };
}

export interface PortalProps {
    v: ViewContext;
    project: Project;
    isOwner: boolean;
    rows: PortalRow[];
    totalCount: number;
    filteredTotal: number;
    statusCounts: Record<ReportStatus, number>;
    sort: string;
    direction: 'asc' | 'desc';
    selectedStatus: ReportStatus | null;
    /** 分類篩選；'' 為全部，'_none' 為未分類。 */
    selectedCategory?: string;
    keyword: string;
    viewMode: 'list' | 'board';
    deletedFilter: 'only' | 'hide' | null;
    /** Team side: list only reports with unread client messages. */
    unreadOnly: boolean;
    /** Team side: reports in the whole project with unread client messages (0 for the client). */
    unreadReportCount: number;
    creator: string;
    creatorOptions: Array<[string, string]>;
    page: number;
    lastPage: number;
    /** Current page path with query, sent back by forms as `_back`. */
    backPath: string;
    success?: string;
    passwordLink?: boolean;
    /** 免登入訪客：不顯示登出，表單加防機器人欄位。 */
    guest?: boolean;
    projects?: Array<{ name: string; slug: string }>;
    form?: PortalFormState;
}

const INPUT = 'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10';
const FILTER_SELECT = 'min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10';
function query(base: Record<string, string | number | null | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(base)) {
        if (value !== null && value !== undefined && value !== '') {
            params.set(key, String(value));
        }
    }
    return params.toString();
}

const Thumb: FC<{ href: string; name: string; size?: string; border?: string; adjustment?: boolean }> = ({ href, name, size = 'size-10', border = 'border-slate-200', adjustment }) => (
    <a href={href} target="_blank" rel="noreferrer" class={`block ${size} overflow-hidden rounded-lg border ${border} bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600`} data-lightbox-trigger data-lightbox-alt={name} data-adjustment-image={adjustment ? '' : undefined} title="放大預覽">
        <img src={href} alt={name} class="size-full object-cover" loading="lazy" />
    </a>
);

export const PortalPage: FC<PortalProps> = (props) => {
    const { v, project, isOwner, rows, sort, direction, selectedStatus, keyword, viewMode, deletedFilter, creator } = props;
    const unreadOnly = isOwner && props.unreadOnly;
    const labels = v.cfg.labels;
    const slug = project.slug;
    const baseQuery: Record<string, string | number | null> = {
        view: viewMode,
        q: keyword,
        status: selectedStatus,
        category: props.selectedCategory ? props.selectedCategory : null,
        deleted: isOwner ? deletedFilter : null,
        creator: isOwner ? creator : null,
        unread: unreadOnly ? 1 : null,
        // The default order leaves sort and direction out of the links.
        sort: sort === 'conversation' ? null : sort,
        direction: sort === 'conversation' ? null : direction,
        page: props.page > 1 ? props.page : null,
    };
    const portalUrl = (overrides: Record<string, string | number | null> = {}, forget: string[] = []): string => {
        const merged: Record<string, string | number | null> = { ...baseQuery, ...overrides };
        for (const key of forget) {
            delete merged[key];
        }
        return `${paths.portal(slug)}?${query(merged)}`;
    };
    const sortUrl = (column: string): string => portalUrl({ sort: column, direction: sort === column && direction === 'asc' ? 'desc' : 'asc' }, ['page']);
    const statusUrl = (status: ReportStatus): string =>
        `${paths.portal(slug)}?${query({ status, category: props.selectedCategory ? props.selectedCategory : null, creator: isOwner ? creator : null, unread: unreadOnly ? 1 : null, view: viewMode === 'board' ? 'board' : null, q: keyword })}`;
    const sortMark = (column: string): string => (sort === column ? (direction === 'asc' ? '↑' : '↓') : '');
    const ariaSort = (column: string): string => (sort === column ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    const form = props.form;
    const issueRows = form?.bag === 'default' && form.issues && form.issues.length > 0 ? form.issues : [{ title: '', description: '' }];
    const pageStatusCounts: Record<string, number> = {};
    for (const row of rows) {
        pageStatusCounts[row.report.status] = (pageStatusCounts[row.report.status] ?? 0) + 1;
    }
    const filtered = viewMode === 'board' || keyword !== '' || selectedStatus !== null || (props.selectedCategory ?? '') !== '' || (isOwner && (deletedFilter !== null || creator !== '' || unreadOnly));
    const attachmentUrl = (report: Report, attachment: Attachment) => paths.attachment(slug, report.public_id, attachment.id);
    const categories = projectCategories(project);
    const showCategory = categories.length > 0;
    const rowContext: RowContext = { v, slug, isOwner, backPath: props.backPath, showCategory, categories };
    // Long pages hand row rendering to the browser (same row builders) to stay within the CPU budget.
    const clientRender = rows.length > SERVER_ROW_LIMIT;
    const sortHeader = (column: string, label: string, thClass: string) => (
        <th class={thClass} aria-sort={ariaSort(column)}>
            <a href={sortUrl(column)} class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
                {label} {sort === column ? <span aria-hidden="true">{sortMark(column)}</span> : null}
            </a>
        </th>
    );

    return (
        <Layout v={v} title={`問題清單｜${project.name}`} project={project} projects={isOwner ? props.projects : undefined} showLogout={!props.guest} passwordLink={props.passwordLink} maxWidth="max-w-[96rem]" success={props.success} chatPanel={{ slug, viewer: isOwner ? 'owner' : 'client' }}>
            <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p class="text-sm font-semibold text-teal-700">{v.cfg.portalTitle}</p>
                    <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">問題清單</h1>
                    <p class="mt-2 text-sm leading-6 text-slate-600">{viewMode === 'board' ? '拖拉卡片到其他欄，即可更新狀態；各欄預設與右下角留言對話相同：有新留言的最前，再來是有留言的單（依最新留言時間），沒有留言的依建立時間，新的在前。' : '狀態可直接在表格中切換，點欄名即可排序；預設與右下角留言對話相同：有新留言的最前，再來是有留言的單（依最新留言時間），沒有留言的依建立時間，新的在前。'}</p>
                    <ul class="mt-2 grid gap-x-6 sm:grid-cols-[auto_1fr] text-sm leading-6 text-slate-600" data-status-guide>
                        <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class={`size-2.5 rounded-full ${statusDotClass('new')}`} aria-hidden="true"></span>待處理</span><span>已收到{labels.client}的回報，等{labels.owner}處理。</span></li>
                        <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class={`size-2.5 rounded-full ${statusDotClass('needs_input')}`} aria-hidden="true"></span>待審核</span><span>{labels.owner}已改好並寫了調整說明，請{labels.client}確認。</span></li>
                        <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class={`size-2.5 rounded-full ${statusDotClass('completed')}`} aria-hidden="true"></span>已完成</span><span>{labels.client}確認沒問題，該問題修復成功。</span></li>
                    </ul>
                    <p class="mt-2 text-sm leading-6 text-slate-600" data-preview-guide>可點開預覽：{viewMode === 'board' ? '卡片標題、附件縮圖、調整說明、調整圖（「N 張調整圖」）。' : '標題、圖片縮圖、調整說明、調整附圖。'}</p>
                </div>
                <button type="button" data-dialog-open="new-issues" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">＋ 新增問題</button>
            </div>

            <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="issue-list-heading">
                <h2 id="issue-list-heading" class="sr-only">已登記問題</h2>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
                    <p class="font-semibold" data-report-count>共 {props.totalCount} 題{filtered ? `（篩選後 ${props.filteredTotal} 題）` : ''}</p>
                    <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-status-summary>
                        {STATUSES.map((status) => (
                            <li data-summary-status={status}>
                                <a href={statusUrl(status)} class="rounded font-semibold text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-status-summary-item={status} data-label={statusLabel(status)}>{statusLabel(status)} {props.statusCounts[status] ?? 0} 題</a>
                            </li>
                        ))}
                    </ul>
                    <nav class="ml-auto inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1" aria-label="顯示模式">
                        <a href={portalUrl({ view: 'list' })} class={cx('inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', viewMode === 'list' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950')} aria-current={viewMode === 'list' ? 'page' : undefined} data-view-mode="list">☷ 列表</a>
                        <a href={portalUrl({ view: 'board' })} class={cx('inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', viewMode === 'board' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950')} aria-current={viewMode === 'board' ? 'page' : undefined} data-view-mode="board">▦ 看板</a>
                    </nav>
                </div>

                {isOwner ? (
                    <div
                        class={cx('flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm', props.unreadReportCount > 0 ? UNREAD_SUMMARY_TONES.alert : UNREAD_SUMMARY_TONES.calm)}
                        data-unread-summary
                        data-unread-only={unreadOnly ? '1' : '0'}
                        data-unread-only-url={portalUrl({ unread: 1 }, ['page'])}
                    >
                        <p class="font-semibold" data-unread-summary-text>{props.unreadReportCount > 0 ? <>有 <span data-unread-report-count>{props.unreadReportCount}</span> 張單有未讀留言</> : '目前沒有未讀留言'}</p>
                        {unreadOnly ? (
                            <a href={portalUrl({}, ['unread', 'page'])} class="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-unread-filter="show-all">顯示全部</a>
                        ) : props.unreadReportCount > 0 ? (
                            <a href={portalUrl({ unread: 1 }, ['page'])} class={UNREAD_FILTER_CLASS} data-unread-filter="unread-only">只看未讀留言</a>
                        ) : null}
                    </div>
                ) : null}

                <form method="get" class="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex md:items-center md:justify-end">
                    <input type="hidden" name="view" value={viewMode} />
                    {unreadOnly ? <input type="hidden" name="unread" value="1" /> : null}
                    <label class="relative col-span-2 block min-w-0 md:mr-auto md:w-80">
                        <span class="sr-only">搜尋問題</span>
                        <svg viewBox="0 0 24 24" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                        <input type="search" name="q" value={keyword} maxlength={100} placeholder="搜尋標題或問題說明…" autocomplete="off" class="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-keyword-search />
                        {keyword !== '' ? (
                            <a href={portalUrl({}, ['q', 'page'])} class="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="清除搜尋" title="清除搜尋">×</a>
                        ) : null}
                    </label>
                    <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">篩選狀態
                        <select name="status" data-auto-submit class={FILTER_SELECT}>
                            <option value="">全部</option>
                            {STATUSES.map((status) => (
                                <option value={status} selected={selectedStatus === status}>{statusLabel(status)}</option>
                            ))}
                        </select>
                    </label>
                    {showCategory ? (
                        <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">分類
                            <select name="category" data-auto-submit data-category-filter class={FILTER_SELECT}>
                                <option value="">全部</option>
                                {categories.map((option) => (
                                    <option value={option} selected={props.selectedCategory === option}>{option}</option>
                                ))}
                                <option value="_none" selected={props.selectedCategory === '_none'}>未分類</option>
                            </select>
                        </label>
                    ) : null}
                    {isOwner ? (
                        <>
                            <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">建立者
                                <select name="creator" data-auto-submit data-creator-filter class={FILTER_SELECT}>
                                    <option value="">全部</option>
                                    {props.creatorOptions.map(([value, name]) => (
                                        <option value={value} selected={creator === value}>{name}</option>
                                    ))}
                                </select>
                            </label>
                            <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">{labels.client}已刪除
                                <select name="deleted" data-auto-submit data-deleted-filter class={FILTER_SELECT}>
                                    <option value="">一併顯示</option>
                                    <option value="hide" selected={deletedFilter === 'hide'}>隱藏</option>
                                    <option value="only" selected={deletedFilter === 'only'}>只看已刪除</option>
                                </select>
                            </label>
                        </>
                    ) : null}
                    <label class={cx('grid min-w-0 gap-1 text-xs font-semibold text-slate-600', viewMode === 'list' ? 'md:hidden' : 'md:flex md:items-center md:gap-2')}>排序欄位
                        <select name="sort" data-auto-submit class={FILTER_SELECT}>
                            <option value="conversation" selected={sort === 'conversation'}>預設（新留言優先）</option>
                            <option value="latest_activity_at" selected={sort === 'latest_activity_at'}>最後更新</option>
                            <option value="created_at" selected={sort === 'created_at'}>建立時間</option>
                            <option value="title" selected={sort === 'title'}>問題</option>
                            <option value="status" selected={sort === 'status'}>狀態</option>
                        </select>
                    </label>
                    {sort !== 'conversation' ? (
                        <label class={cx('grid min-w-0 gap-1 text-xs font-semibold text-slate-600', viewMode === 'list' ? 'md:hidden' : 'md:flex md:items-center md:gap-2')}>順序
                            <select name="direction" data-auto-submit class={FILTER_SELECT}>
                                <option value="desc" selected={direction === 'desc'}>新到舊／降冪</option>
                                <option value="asc" selected={direction === 'asc'}>舊到新／升冪</option>
                            </select>
                        </label>
                    ) : null}
                    {viewMode === 'list' && sort !== 'conversation' ? (
                        <a href={portalUrl({}, ['sort', 'direction', 'page'])} class="col-span-2 hidden rounded text-xs font-semibold text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline" data-sort-reset>恢復預設排序（新留言優先）</a>
                    ) : null}
                </form>

                {viewMode === 'list' ? (
                    <div class="sm:overflow-x-auto" data-list-view>
                        <table class="block w-full border-collapse text-left text-sm sm:table sm:min-w-[64rem]" data-report-table>
                            <thead class="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 sm:table-header-group">
                                <tr>
                                    <th class="whitespace-nowrap min-w-16 w-16 px-4 text-center py-3.5">編號</th>
                                    {sortHeader('title', '標題', 'whitespace-nowrap min-min-w-48 w-64 max-w-64 px-4 text-left py-3.5')}
                                    {sortHeader('status', '狀態', 'whitespace-nowrap min-w-36 px-4 py-3.5 text-center')}
                                    {showCategory ? <th class="whitespace-nowrap w-28 px-4 py-3.5 text-center">分類</th> : null}
                                    <th class="whitespace-nowrap w-44 px-4 text-center py-3.5">圖片</th>
                                    <th class="whitespace-nowrap min-w-48 w-64 max-w-64 px-4 text-left py-3.5">調整說明</th>
                                    <th class="whitespace-nowrap w-28 px-4 py-3.5 text-center">建立者</th>
                                    {sortHeader('created_at', '建立日期', 'whitespace-nowrap w-32 px-4 text-center py-3.5')}
                                    {sortHeader('latest_activity_at', '最後更新', 'whitespace-nowrap w-28 px-4 py-3.5 text-center')}
                                    <th class="whitespace-nowrap w-36 px-4 py-3.5 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody class="block divide-y divide-slate-100 sm:table-row-group">
                                {rows.length === 0 ? (
                                    <tr class="block sm:table-row"><td colspan={showCategory ? 10 : 9} class="block px-6 sm:table-cell py-14 text-center text-sm text-slate-500">目前沒有問題，請按「新增問題」登記第一筆。</td></tr>
                                ) : (
                                    clientRender ? null : raw(rows.map((row) => listRowHtml(rowContext, row)).join(''))
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div class="overflow-x-auto overscroll-x-contain bg-slate-100/70 p-4" data-kanban-board data-status-filter={selectedStatus ?? ''}>
                        <div class="grid min-w-full grid-flow-col auto-cols-[minmax(17rem,85vw)] items-start gap-4 sm:auto-cols-[19rem] xl:auto-cols-[minmax(18rem,1fr)]" role="region" aria-label="問題狀態看板">
                            {STATUSES.map((boardStatus) => {
                                const columnClass = boardStatus === 'new' ? 'border-slate-200 bg-slate-50' : boardStatus === 'needs_input' ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/70';
                                const columnRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.report.status === boardStatus);
                                return (
                                    <section class={`overflow-hidden rounded-xl border ${columnClass}`} aria-labelledby={`kanban-heading-${boardStatus}`} data-kanban-column data-status={boardStatus}>
                                        <header class="flex items-center justify-between gap-3 border-b border-black/5 px-3.5 py-3">
                                            <h3 id={`kanban-heading-${boardStatus}`} class="flex items-center gap-2 text-sm font-bold text-slate-900"><span class={`size-2.5 rounded-full ${statusDotClass(boardStatus)}`} aria-hidden="true"></span>{statusLabel(boardStatus)}</h3>
                                            <span class="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-black/10" title="本頁／專案總數"><span data-kanban-page-count>{pageStatusCounts[boardStatus] ?? 0}</span> / <span data-kanban-total-count={boardStatus}>{props.statusCounts[boardStatus] ?? 0}</span></span>
                                        </header>
                                        <div class="grid min-h-36 content-start gap-3 p-3" data-kanban-list data-status={boardStatus}>
                                            {clientRender ? null : raw(columnRows.map(({ row, index }) => boardCardHtml(rowContext, row, index)).join(''))}
                                            <p class="py-8 text-center text-xs text-slate-400" data-kanban-empty hidden={columnRows.length > 0}>本頁沒有問題</p>
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                        <p class="mt-3 text-xs text-slate-500">欄位數字為「本頁／專案總數」。看板每頁最多顯示 50 題。</p>
                        <div class="sr-only" aria-live="polite" data-kanban-announcer></div>
                    </div>
                )}
            </section>

            {clientRender ? <script type="application/json" id={PORTAL_ROWS_ELEMENT_ID}>{raw(payloadScript(buildPayload(rowContext, viewMode, rows)))}</script> : null}

            <div class="mt-5">
                <Pagination page={props.page} lastPage={props.lastPage} total={props.filteredTotal} perPage={50} url={(page) => portalUrl({ page: page > 1 ? page : null })} />
            </div>

            {/* Per-report dialogs are fetched from /dialogs the first time one is opened, which keeps the
                page small enough to render within the Workers CPU budget. After a failed edit, that
                report's dialogs are rendered here directly so the edit dialog can reopen with errors. */}
            <div id="report-dialogs" data-report-dialogs>
                {rows
                    .filter((row) => form?.bag === 'editReport' && form.editing?.publicId === row.report.public_id)
                    .map((row) => (
                        <ReportDialogs v={v} row={row} slug={slug} isOwner={isOwner} backPath={props.backPath} attachmentUrl={attachmentUrl} categories={categories} form={form} />
                    ))}
            </div>

            <NewIssuesDialog slug={slug} form={form} issueRows={issueRows} categories={categories} guest={props.guest === true} turnstileSiteKey={props.guest && v.cfg.publicReporting.turnstileSiteKey !== '' && v.cfg.publicReporting.turnstileSecretKey !== '' ? v.cfg.publicReporting.turnstileSiteKey : ''} />
        </Layout>
    );
};

type RowProps = { v: ViewContext; row: PortalRow; slug: string; isOwner: boolean; backPath: string; attachmentUrl: (report: Report, attachment: Attachment) => string };

export const ReportDialogs: FC<RowProps & { categories: string[]; form?: PortalFormState }> = ({ v, row, slug, isOwner, backPath, attachmentUrl, categories, form }) => {
    const report = row.report;
    const hasAdjustment = (report.adjustment_note ?? '') !== '' || row.adjustmentAttachments.length > 0;
    const editing = form?.bag === 'editReport' && form.editing?.publicId === report.public_id ? form.editing : null;
    const editErrors = editing ? form?.errors ?? [] : [];
    return (
        <>
            <dialog id={`detail-report-${report.public_id}`} class="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby={`detail-report-title-${report.public_id}`} data-report-detail>
                <div class="grid max-h-[calc(100dvh-2rem)] min-w-0 gap-4 overflow-y-auto p-5 sm:p-7">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-500">編號 {row.number} · {statusLabel(report.status)}</p>
                            <h2 id={`detail-report-title-${report.public_id}`} class="mt-1 break-words text-lg font-bold text-slate-950">{report.title}</h2>
                            {categories.length > 0 ? (
                                <div class="mt-2">
                                    <CategoryAutosave slug={slug} report={report} categories={categories} backPath={backPath} idPrefix="detail-category" />
                                </div>
                            ) : null}
                        </div>
                        <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                    </div>
                    <div data-report-description><RichText text={report.description} compact /></div>
                    {row.attachments.length > 0 ? (
                        <div class="flex flex-wrap gap-2">
                            {row.attachments.map((attachment) => (
                                <Thumb href={attachmentUrl(report, attachment)} name={attachment.original_name} size="size-20" />
                            ))}
                        </div>
                    ) : null}
                    {hasAdjustment ? (
                        <div class="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
                            <AdjustmentBlock report={report} adjustmentAttachments={row.adjustmentAttachments} attachmentUrl={(attachment) => attachmentUrl(report, attachment)} compact />
                        </div>
                    ) : null}
                    {row.creatorLabel ? <p class="text-xs text-slate-500" data-report-creator>建立者：{row.creatorLabel}</p> : null}
                    <p class="text-xs text-slate-500">建立：<Time v={v} at={report.created_at} />　最後更新：<Time v={v} at={report.latest_activity_at} /></p>
                    {isOwner ? null : <p class="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-900" data-message-hint>有問題或補充，可以點「開啟對話」直接留言給{v.cfg.labels.owner}。</p>}
                    <div class="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                        <ChatButton publicId={report.public_id} title={report.title} total={row.messagesCount} unread={row.unread} isOwner={isOwner} label="開啟對話" />
                        <a href={paths.report(slug, report.public_id)} class="inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">查看留言紀錄</a>
                    </div>
                </div>
            </dialog>

            <dialog id={`edit-report-${report.public_id}`} class="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby={`edit-report-title-${report.public_id}`} data-open-on-load={editErrors.length > 0 ? '' : undefined}>
                <form method="post" action={paths.reportUpdate(slug, report.public_id)} class="grid max-h-[calc(100dvh-2rem)] min-w-0 gap-5 overflow-y-auto p-5 sm:p-7" data-upload-form>
<input type="hidden" name="_back" value={backPath} />
                    <input type="hidden" name="editing_report" value={report.public_id} />
                    <div class="flex items-start justify-between gap-3">
                        <h2 id={`edit-report-title-${report.public_id}`} class="text-lg font-bold text-slate-950">編輯問題</h2>
                        <button type="button" class="grid size-9 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                    </div>

                    <ErrorList errors={editErrors} />

                    <div>
                        <label for={`edit-title-${report.public_id}`} class="mb-2 block text-sm font-semibold text-slate-800">問題標題 <span class="text-rose-600">*</span></label>
                        <input id={`edit-title-${report.public_id}`} name="title" value={editing ? editing.title : report.title} required maxlength={160} class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" />
                    </div>
                    {categories.length > 0 ? (
                        <div>
                            <label for={`edit-category-${report.public_id}`} class="mb-2 block text-sm font-semibold text-slate-800">分類</label>
                            <select id={`edit-category-${report.public_id}`} name="category" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-edit-category>
                                <option value="" selected={(editing ? editing.category ?? '' : report.category ?? '') === ''}>未分類</option>
                                {editCategoryOptions(categories, report.category).map((option) => (
                                    <option value={option} selected={option === (editing ? editing.category ?? '' : report.category ?? '')}>{option}</option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                    <div>
                        <label for={`edit-description-${report.public_id}`} class="mb-2 block text-sm font-semibold text-slate-800">問題說明 <span class="text-rose-600">*</span></label>
                        <textarea id={`edit-description-${report.public_id}`} name="description" required maxlength={10000} rows={6} class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{editing ? editing.description : report.description}</textarea>
                    </div>

                    {row.attachments.length > 0 ? (
                        <fieldset>
                            <legend class="mb-2 text-sm font-semibold text-slate-800">目前截圖 <span class="font-normal text-slate-500">（勾選要刪除的）</span></legend>
                            <div class="grid grid-cols-3 gap-3 sm:grid-cols-5">
                                {row.attachments.map((attachment) => (
                                    <label class="group relative block cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 has-[:checked]:border-rose-400 has-[:checked]:opacity-50">
                                        <img src={attachmentUrl(report, attachment)} alt={attachment.original_name} class="aspect-video w-full object-cover" loading="lazy" />
                                        <span class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-rose-700">
                                            <input type="checkbox" name="remove_attachments[]" value={String(attachment.id)} checked={editing ? editing.remove.includes(String(attachment.id)) : false} class="rounded border-slate-300 text-rose-600 focus:ring-rose-600" />
                                            刪除
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    ) : null}

                    <div>
                        <label for={`edit-screenshots-${report.public_id}`} class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 新增截圖<input id={`edit-screenshots-${report.public_id}`} type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target={`edit-preview-${report.public_id}`} data-upload-url={`${paths.uploads(slug)}?purpose=report`} data-upload-name="upload_ids[]" data-upload-max="5" data-upload-max-bytes={String(10 * 1024 * 1024)} /></label>
                        <span class="ml-2 text-xs text-slate-500">截圖總數最多 5 張，每張 10 MB</span>
                        <div id={`edit-preview-${report.public_id}`} class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                    </div>

                    <div class="flex justify-end gap-3 border-t border-slate-100 pt-5">
                        <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close>取消</button>
                        <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">儲存變更</button>
                    </div>
                </form>
            </dialog>

            {isOwner ? (
                <dialog id={`delete-report-${report.public_id}`} class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby={`delete-report-title-${report.public_id}`}>
                    <form method="post" action={paths.reportDestroy(slug, report.public_id)} class="grid gap-4 p-5 sm:p-6">
                        <h2 id={`delete-report-title-${report.public_id}`} class="text-lg font-bold text-slate-950">確定要刪除這個問題？</h2>
                        <p class="text-sm leading-6 text-slate-600">「{report.title}」與它的截圖、留言紀錄會被永久刪除，無法復原。</p>
                        <div class="flex justify-end gap-3">
                            <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close autofocus>取消</button>
                            <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2">確認刪除</button>
                        </div>
                    </form>
                </dialog>
            ) : (
                <dialog id={`client-delete-report-${report.public_id}`} class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby={`client-delete-report-title-${report.public_id}`}>
                    <form method="post" action={paths.reportClientDestroy(slug, report.public_id)} class="grid gap-4 p-5 sm:p-6">
                        <h2 id={`client-delete-report-title-${report.public_id}`} class="text-lg font-bold text-slate-950">確定刪除？</h2>
                        <p class="text-sm leading-6 text-slate-600">「{report.title}」刪除後會從清單移除，無法自行復原。</p>
                        <div class="flex justify-end gap-3">
                            <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close autofocus>取消</button>
                            <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2">確認刪除</button>
                        </div>
                    </form>
                </dialog>
            )}
        </>
    );
};

const IssueFieldset: FC<{ slug: string; index: string; number: string; title?: string; description?: string; category?: string; categories: string[] }> = ({ slug, index, number, title, description, category, categories }) => (
    <fieldset class="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5" data-issue-row>
        <div class="flex items-center justify-between gap-3">
            <legend class="text-sm font-bold text-slate-900">問題 <span data-issue-number>{number}</span></legend>
            <button type="button" class="text-xs font-semibold text-rose-700 hover:text-rose-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-remove-issue>移除</button>
        </div>
        <div class="mt-4 grid gap-4">
            {categories.length > 0 ? (
                <div>
                    <label for={`issue-category-${index}`} class="mb-2 block text-sm font-semibold text-slate-800">分類 <span class="text-rose-600">*</span></label>
                    <select id={`issue-category-${index}`} name={`issues[${index}][category]`} required class={INPUT} data-issue-category>
                        <option value="">請選擇分類</option>
                        {categories.map((option) => (
                            <option value={option} selected={option === category}>{option}</option>
                        ))}
                    </select>
                </div>
            ) : null}
            <div>
                <label for={`issue-title-${index}`} class="mb-2 block text-sm font-semibold text-slate-800">問題標題 <span class="text-rose-600">*</span></label>
                <input id={`issue-title-${index}`} name={`issues[${index}][title]`} value={title ?? ''} required maxlength={160} placeholder="例如：答案儲存後重新整理會消失" class={INPUT} />
            </div>
            <div>
                <label for={`issue-description-${index}`} class="mb-2 block text-sm font-semibold text-slate-800">問題說明 <span class="text-rose-600">*</span></label>
                <textarea id={`issue-description-${index}`} name={`issues[${index}][description]`} required maxlength={10000} rows={4} placeholder="請說明操作步驟、預期結果與實際結果。" class={`${INPUT} resize-y leading-6`}>{description ?? ''}</textarea>
            </div>
            <div>
                <label for={`issue-screenshots-${index}`} class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 上傳截圖<input id={`issue-screenshots-${index}`} type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target={`issue-preview-${index}`} data-upload-url={`${paths.uploads(slug)}?purpose=report`} data-upload-name={`issues[${index}][upload_ids][]`} data-upload-max="5" data-upload-max-bytes={String(10 * 1024 * 1024)} /></label>
                <span class="ml-2 text-xs text-slate-500">最多 5 張，每張 10 MB</span>
                <div id={`issue-preview-${index}`} class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
            </div>
        </div>
    </fieldset>
);

const NewIssuesDialog: FC<{ slug: string; form?: PortalFormState; issueRows: Array<{ title: string; description: string; category?: string }>; categories: string[]; guest: boolean; turnstileSiteKey: string }> = ({ slug, form, issueRows, categories, guest, turnstileSiteKey }) => {
    const errors = form?.bag === 'default' ? form.errors : [];
    return (
        <dialog id="new-issues" class="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="new-issues-title" data-issue-entry data-open-on-load={errors.length > 0 ? '' : undefined}>
            <div class="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto p-5 sm:p-7">
                <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-5">
                    <div>
                        <h2 id="new-issues-title" class="text-lg font-bold text-slate-950">新增問題</h2>
                        <p class="mt-1 text-sm text-slate-600">可以一次加入多個問題；每一列會建立成獨立項目。</p>
                    </div>
                    <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                </div>

                <ErrorList errors={errors} class="mt-5" heading="請修正以下內容：" />

                <form method="post" action={paths.reportsStore(slug)} class="mt-5 grid min-w-0 gap-5" data-issue-form data-upload-form>
                    {guest ? (
                        <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
                            <label for={HONEYPOT_FIELD}>Website</label>
                            <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabindex={-1} autocomplete="off" />
                        </div>
                    ) : null}
                    {turnstileSiteKey !== '' ? (
                        <>
                            <div class="cf-turnstile" data-sitekey={turnstileSiteKey} data-turnstile></div>
                            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                        </>
                    ) : null}
                    <div class="grid min-w-0 gap-5" data-issue-list>
                        {issueRows.map((issue, index) => (
                            <IssueFieldset slug={slug} index={String(index)} number={String(index + 1)} title={issue.title} description={issue.description} category={issue.category} categories={categories} />
                        ))}
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                        <button type="button" class="inline-flex min-h-10 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-add-issue>＋ 再加一個問題</button>
                        <div class="flex gap-3">
                            <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close>取消</button>
                            <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出全部問題</button>
                        </div>
                    </div>
                </form>

                <template data-issue-template>
                    <IssueFieldset slug={slug} index="__INDEX__" number="" categories={categories} />
                </template>
            </div>
        </dialog>
    );
};

/** 編輯時可選的分類：設定的分類，加上這張單原本、已不在設定裡的舊分類，避免存檔時遺失。 */
export { editCategoryOptions };
