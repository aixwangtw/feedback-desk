<x-feedback.layout :title="'問題清單｜'.$project->name" :$project max-width="max-w-[96rem]">
    @php
        $baseQuery = array_filter([
            'view' => $viewMode,
            'q' => $keyword,
            'status' => $selectedStatus?->value,
            'deleted' => $isOwner ? $deletedFilter : null,
            'creator' => $isOwner ? $creator : null,
            'sort' => $sort,
            'direction' => $direction,
            'page' => request()->integer('page') > 1 ? request()->integer('page') : null,
        ], fn ($value) => $value !== null && $value !== '');
        $portalUrl = function (array $overrides = [], array $forget = []) use ($project, $baseQuery): string {
            $query = array_merge($baseQuery, $overrides);

            foreach ($forget as $key) {
                unset($query[$key]);
            }

            return route('feedback.portal', $project).'?'.http_build_query($query);
        };
        $sortUrl = function (string $column) use ($portalUrl, $sort, $direction): string {
            $nextDirection = $sort === $column && $direction === 'asc' ? 'desc' : 'asc';

            return $portalUrl([
                'sort' => $column,
                'direction' => $nextDirection,
            ], ['page']);
        };
        $statusUrl = fn (\App\Enums\FeedbackReportStatus $status): string => route('feedback.portal', $project).'?'.http_build_query(array_filter([
            'status' => $status->value,
            'creator' => $isOwner ? $creator : null,
            'view' => $viewMode === 'board' && $status->isSelectable() ? 'board' : null,
            'q' => $keyword,
        ]));
        $sortMark = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? '↑' : '↓')
            : '↕';
        $ariaSort = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? 'ascending' : 'descending')
            : 'none';
        $issueRows = old('issues', [['title' => '', 'description' => '']]);
        $editingReport = old('editing_report');
        $boardStatuses = \App\Enums\FeedbackReportStatus::selectable();
        $pageStatusCounts = $reports->getCollection()->countBy(fn ($report) => $report->status->value);
    @endphp

    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <p class="text-sm font-semibold text-teal-700">範例專案</p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">問題清單</h1>
            <p class="mt-2 text-sm leading-6 text-slate-600">每個問題各自追蹤狀態與討論；{{ $viewMode === 'board' ? '拖拉卡片即可更新狀態。' : '狀態可直接在表格中切換，點選欄名即可排序。' }}</p>
        </div>
        <button type="button" data-dialog-open="new-issues" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">＋ 新增問題</button>
    </div>

    <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="issue-list-heading">
        <h2 id="issue-list-heading" class="sr-only">已登記問題</h2>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
            <p class="font-semibold" data-report-count>共 {{ $totalCount }} 題@if ($viewMode === 'board' || $keyword !== '' || $selectedStatus || ($isOwner && ($deletedFilter || $creator !== '')))（篩選後 {{ $reports->total() }} 題）@endif</p>
            <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-status-summary>
                @foreach ([\App\Enums\FeedbackReportStatus::New, \App\Enums\FeedbackReportStatus::InProgress, \App\Enums\FeedbackReportStatus::NeedsInput, \App\Enums\FeedbackReportStatus::Completed, \App\Enums\FeedbackReportStatus::Failed] as $summaryStatus)
                    @php
                        $summaryCount = $statusCounts[$summaryStatus->value] ?? 0;
                        $summaryOptional = ! $summaryStatus->isSelectable();
                    @endphp
                    <li data-summary-status="{{ $summaryStatus->value }}" data-summary-optional="{{ $summaryOptional ? '1' : '0' }}"{!! $summaryOptional && $summaryCount === 0 ? ' hidden' : '' !!}><a href="{{ $statusUrl($summaryStatus) }}" class="rounded font-semibold text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-status-summary-item="{{ $summaryStatus->value }}" data-label="{{ $summaryStatus->label() }}">{{ $summaryStatus->label() }} {{ $summaryCount }} 題</a></li>
                @endforeach
            </ul>
            <nav class="ml-auto inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1" aria-label="顯示模式">
                <a href="{{ $portalUrl(['view' => 'list']) }}" @class(['inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', 'bg-white text-slate-950 shadow-sm' => $viewMode === 'list', 'text-slate-600 hover:text-slate-950' => $viewMode !== 'list']) @if ($viewMode === 'list') aria-current="page" @endif data-view-mode="list">☷ 列表</a>
                <a href="{{ $portalUrl(['view' => 'board']) }}" @class(['inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', 'bg-white text-slate-950 shadow-sm' => $viewMode === 'board', 'text-slate-600 hover:text-slate-950' => $viewMode !== 'board']) @if ($viewMode === 'board') aria-current="page" @endif data-view-mode="board">▦ 看板</a>
            </nav>
        </div>

        <form method="GET" class="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex md:items-center md:justify-end">
            <input type="hidden" name="view" value="{{ $viewMode }}">
            <label class="relative col-span-2 block min-w-0 md:mr-auto md:w-80">
                <span class="sr-only">搜尋問題</span>
                <svg viewBox="0 0 24 24" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                <input type="search" name="q" value="{{ $keyword }}" maxlength="100" placeholder="搜尋標題或問題說明…" autocomplete="off" class="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-keyword-search>
                @if ($keyword !== '')
                    <a href="{{ $portalUrl([], ['q', 'page']) }}" class="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="清除搜尋" title="清除搜尋">×</a>
                @endif
            </label>
            <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">篩選狀態
                <select name="status" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="">全部</option>
                    @foreach ($viewMode === 'board' ? \App\Enums\FeedbackReportStatus::selectable() : \App\Enums\FeedbackReportStatus::cases() as $statusOption)
                        <option value="{{ $statusOption->value }}" @selected($selectedStatus === $statusOption)>{{ $statusOption->label() }}</option>
                    @endforeach
                </select>
            </label>
            @if ($isOwner)
                <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">建立者
                    <select name="creator" data-auto-submit data-creator-filter class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                        <option value="">全部</option>
                        @foreach ($creatorOptions as $creatorValue => $creatorName)
                            <option value="{{ $creatorValue }}" @selected($creator === $creatorValue)>{{ $creatorName }}</option>
                        @endforeach
                    </select>
                </label>
                <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">老師已刪除
                    <select name="deleted" data-auto-submit data-deleted-filter class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                        <option value="">一併顯示</option>
                        <option value="hide" @selected($deletedFilter === 'hide')>隱藏</option>
                        <option value="only" @selected($deletedFilter === 'only')>只看已刪除</option>
                    </select>
                </label>
            @endif
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 @if ($viewMode === 'list') md:hidden @else md:flex md:items-center md:gap-2 @endif">排序欄位
                <select name="sort" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="latest_activity_at" @selected($sort === 'latest_activity_at')>最後更新</option>
                    <option value="created_at" @selected($sort === 'created_at')>建立時間</option>
                    <option value="title" @selected($sort === 'title')>問題</option>
                    <option value="status" @selected($sort === 'status')>狀態</option>
                </select>
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 @if ($viewMode === 'list') md:hidden @else md:flex md:items-center md:gap-2 @endif">順序
                <select name="direction" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="desc" @selected($direction === 'desc')>新到舊／降冪</option>
                    <option value="asc" @selected($direction === 'asc')>舊到新／升冪</option>
                </select>
            </label>
        </form>

        @if ($viewMode === 'list')
        <div class="sm:overflow-x-auto" data-list-view>
            <table class="block w-full border-collapse text-left text-sm sm:table sm:min-w-[56rem]" data-report-table>
                <thead class="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 sm:table-header-group">
                    <tr>
                        <th class="w-16 px-4 py-3.5">編號</th>
                        <th class="min-w-72 px-5 py-3.5" aria-sort="{{ $ariaSort('title') }}"><a href="{{ $sortUrl('title') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">標題 <span aria-hidden="true">{{ $sortMark('title') }}</span></a></th>
                        <th class="w-36 px-4 py-3.5" aria-sort="{{ $ariaSort('status') }}"><a href="{{ $sortUrl('status') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">狀態 <span aria-hidden="true">{{ $sortMark('status') }}</span></a></th>
                        @if ($isOwner)
                            <th class="w-28 px-4 py-3.5">建立者</th>
                        @endif
                        <th class="w-44 px-4 py-3.5">圖片</th>
                        <th class="w-56 px-4 py-3.5">調整說明</th>
                        <th class="w-32 px-4 py-3.5" aria-sort="{{ $ariaSort('created_at') }}"><a href="{{ $sortUrl('created_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">建立日期 <span aria-hidden="true">{{ $sortMark('created_at') }}</span></a></th>
                        <th class="w-28 px-4 py-3.5" aria-sort="{{ $ariaSort('latest_activity_at') }}"><a href="{{ $sortUrl('latest_activity_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">最後更新 <span aria-hidden="true">{{ $sortMark('latest_activity_at') }}</span></a></th>
                        <th class="w-36 px-4 py-3.5">操作</th>
                    </tr>
                </thead>
                <tbody class="block divide-y divide-slate-100 sm:table-row-group">
                    @forelse ($reports as $report)
                        <tr class="block space-y-2 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle @if ($report->isDeletedByClient()) bg-slate-50 text-slate-500 @endif" data-report-row="{{ $report->public_id }}">
                            <td class="block text-xs font-bold text-slate-500 sm:table-cell sm:px-3 sm:py-2 sm:align-middle"><span class="sm:hidden">編號 </span><span data-report-number>{{ $sequenceNumbers[$report->id] }}</span></td>
                            <td class="block sm:table-cell sm:px-4 sm:py-2 sm:align-middle">
                                <button type="button" class="text-left font-semibold text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-{{ $report->public_id }}" data-report-detail-open>{{ $report->title }}</button>
                                @if ($isOwner && $report->isDeletedByClient())
                                    <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted>
                                        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">老師已刪除</span>
                                        <x-feedback.time :at="$report->client_deleted_at" />
                                    </span>
                                @endif
                            </td>
                            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
                                <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="grid">
                                    @csrf
                                    @method('PATCH')
                                    <label for="status-{{ $report->public_id }}" class="sr-only">「{{ $report->title }}」的狀態</label>
                                    <x-feedback.status-select id="status-{{ $report->public_id }}" :status="$report->status" class="w-full !px-2 !py-1 !text-xs" data-status-select data-status-autosave />
                                    <noscript><button type="submit" class="text-xs font-semibold text-teal-700">儲存</button></noscript>
                                    <span class="text-[11px] empty:hidden text-slate-500" data-status-feedback aria-live="polite"></span>
                                </form>
                            </td>
                            @if ($isOwner)
                                <td class="block text-xs text-slate-600 sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-creator><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>{{ $report->creatorLabel() }}</td>
                            @endif
                            <td class="block empty:hidden sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
                                @if ($report->feedbackAttachments->isNotEmpty())
                                    <div class="flex flex-wrap gap-1">
                                        @foreach ($report->feedbackAttachments as $attachment)
                                            <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽">
                                                <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                            </a>
                                        @endforeach
                                    </div>
                                @else
                                    <span class="text-xs text-slate-400">—</span>
                                @endif
                            </td>
                            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
                                <span class="text-xs font-semibold text-slate-500 sm:hidden">調整說明：</span>
                                @if ($report->hasAdjustment())
                                    @if (filled($report->adjustment_note))
                                        <button type="button" class="block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title="{{ $report->adjustment_note }}" aria-label="預覽「{{ $report->title }}」的調整說明" data-dialog-open="detail-report-{{ $report->public_id }}" data-adjustment-preview><span class="line-clamp-3 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note>{{ $report->adjustment_note }}</span></button>
                                    @endif
                                    @if ($report->adjustmentAttachments->isNotEmpty())
                                        <div class="mt-1 flex flex-wrap gap-1">
                                            @foreach ($report->adjustmentAttachments as $attachment)
                                                <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border border-teal-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" data-adjustment-image title="放大預覽">
                                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                                </a>
                                            @endforeach
                                        </div>
                                    @endif
                                @else
                                    <span class="text-xs text-slate-400">—</span>
                                @endif
                            </td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span><x-feedback.time :at="$report->created_at" /></td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><x-feedback.time :at="$report->latest_activity_at" relative /></td>
                            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
                                <div class="flex flex-wrap gap-2">
                                    <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="edit-report-{{ $report->public_id }}">編輯</button>
                                    @if ($isOwner && $report->isDeletedByClient())
                                        <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                                            @csrf
                                            @method('PATCH')
                                            <button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                                        </form>
                                    @endif
                                    @if ($isOwner)
                                        <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="delete-report-{{ $report->public_id }}" data-delete-report>刪除</button>
                                    @else
                                        <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="client-delete-report-{{ $report->public_id }}" data-client-delete-report>刪除</button>
                                    @endif
                                </div>
                            </td>
                        </tr>
                    @empty
                        <tr class="block sm:table-row"><td colspan="9" class="block px-6 sm:table-cell py-14 text-center text-sm text-slate-500">目前沒有問題，請按「新增問題」登記第一筆。</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        @else
            <div class="overflow-x-auto overscroll-x-contain bg-slate-100/70 p-4" data-kanban-board data-status-filter="{{ $selectedStatus?->value }}">
                <div class="grid min-w-full grid-flow-col auto-cols-[minmax(17rem,85vw)] items-start gap-4 sm:auto-cols-[19rem] xl:auto-cols-[minmax(18rem,1fr)]" role="region" aria-label="問題狀態看板">
                    @foreach ($boardStatuses as $boardStatus)
                        @php
                            [$columnClass, $dotClass] = match ($boardStatus) {
                                \App\Enums\FeedbackReportStatus::New => ['border-slate-200 bg-slate-50', 'bg-slate-500'],
                                \App\Enums\FeedbackReportStatus::InProgress => ['border-blue-200 bg-blue-50/70', 'bg-blue-500'],
                                \App\Enums\FeedbackReportStatus::NeedsInput => ['border-amber-200 bg-amber-50/70', 'bg-amber-500'],
                                \App\Enums\FeedbackReportStatus::Completed => ['border-emerald-200 bg-emerald-50/70', 'bg-emerald-500'],
                                \App\Enums\FeedbackReportStatus::Failed => ['border-rose-200 bg-rose-50/70', 'bg-rose-500'],
                            };
                            $columnReports = $reports->getCollection()->filter(fn ($report) => $report->status === $boardStatus);
                        @endphp
                        <section class="overflow-hidden rounded-xl border {{ $columnClass }}" aria-labelledby="kanban-heading-{{ $boardStatus->value }}" data-kanban-column data-status="{{ $boardStatus->value }}" data-selectable="{{ $boardStatus->isSelectable() ? '1' : '0' }}">
                            <header class="flex items-center justify-between gap-3 border-b border-black/5 px-3.5 py-3">
                                <h3 id="kanban-heading-{{ $boardStatus->value }}" class="flex items-center gap-2 text-sm font-bold text-slate-900"><span class="size-2.5 rounded-full {{ $dotClass }}" aria-hidden="true"></span>{{ $boardStatus->label() }}</h3>
                                <span class="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-black/10" title="本頁／專案總數"><span data-kanban-page-count>{{ $pageStatusCounts[$boardStatus->value] ?? 0 }}</span> / <span data-kanban-total-count="{{ $boardStatus->value }}">{{ $statusCounts[$boardStatus->value] ?? 0 }}</span></span>
                            </header>
                            <div class="grid min-h-36 content-start gap-3 p-3" data-kanban-list data-status="{{ $boardStatus->value }}">
                                @foreach ($columnReports as $report)
                                    <article class="cursor-grab rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing @if ($report->isDeletedByClient()) opacity-70 @endif" data-kanban-card data-report-id="{{ $report->public_id }}" data-status="{{ $report->status->value }}" data-board-order="{{ $reports->getCollection()->search(fn ($item) => $item->is($report)) }}" title="拖拉卡片可改變狀態">
                                        <div class="flex items-start gap-2">
                                            <div class="min-w-0 flex-1">
                                                <p class="text-[11px] font-bold text-slate-500">編號 <span data-report-number>{{ $sequenceNumbers[$report->id] }}</span>@if ($isOwner)<span class="ml-1.5 font-semibold text-slate-400" data-report-creator>· {{ $report->creatorLabel() }}</span>@endif</p>
                                                <button type="button" class="mt-1 block w-full break-words text-left text-sm font-semibold leading-5 text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-{{ $report->public_id }}" data-report-detail-open>{{ $report->title }}</button>
                                            </div>
                                            <div class="flex shrink-0 items-center gap-1" data-card-actions>
                                                <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="編輯「{{ $report->title }}」" title="編輯" data-card-action data-dialog-open="edit-report-{{ $report->public_id }}">
                                                    <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                                </button>
                                                @if ($isOwner && $report->isDeletedByClient())
                                                    <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                                                        @csrf
                                                        @method('PATCH')
                                                        <button type="submit" class="grid size-8 cursor-pointer place-items-center rounded-lg text-teal-700 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="還原「{{ $report->title }}」" title="還原" data-card-action data-restore-report>
                                                            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                                                        </button>
                                                    </form>
                                                @endif
                                                @if ($isOwner)
                                                    <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「{{ $report->title }}」" title="刪除" data-card-action data-dialog-open="delete-report-{{ $report->public_id }}" data-delete-report>
                                                        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
                                                    </button>
                                                @else
                                                    <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" aria-label="刪除「{{ $report->title }}」" title="刪除" data-card-action data-dialog-open="client-delete-report-{{ $report->public_id }}" data-client-delete-report>
                                                        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
                                                    </button>
                                                @endif
                                            </div>
                                        </div>

                                        @if ($isOwner && $report->isDeletedByClient())
                                            <span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted>老師已刪除</span>
                                        @endif

                                        @if ($report->feedbackAttachments->isNotEmpty())
                                            <div class="mt-3 flex items-center gap-2">
                                                @php $attachment = $report->feedbackAttachments->first(); @endphp
                                                <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽">
                                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                                </a>
                                                <span class="text-xs font-medium text-slate-500">{{ $report->feedbackAttachments->count() }} 張附件</span>
                                            </div>
                                        @endif

                                        @if ($report->hasAdjustment())
                                            <div class="mt-3 rounded-lg border border-teal-100 bg-teal-50/60 p-2" data-adjustment-card>
                                                <p class="text-[11px] font-bold text-teal-800">調整說明</p>
                                                @if (filled($report->adjustment_note))
                                                    <button type="button" class="mt-1 block w-full rounded text-left hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" title="{{ $report->adjustment_note }}" aria-label="預覽「{{ $report->title }}」的調整說明" data-dialog-open="detail-report-{{ $report->public_id }}" data-adjustment-preview><span class="line-clamp-2 whitespace-pre-line break-words text-xs leading-5 text-slate-700" data-adjustment-note>{{ $report->adjustment_note }}</span></button>
                                                @endif
                                                @if ($report->adjustmentAttachments->isNotEmpty())
                                                    @php $adjustmentImage = $report->adjustmentAttachments->first(); @endphp
                                                    <div class="mt-2 flex items-center gap-2">
                                                        <a href="{{ route('feedback.attachments.show', [$project, $report, $adjustmentImage]) }}" target="_blank" rel="noreferrer" class="block size-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $adjustmentImage->original_name }}" data-adjustment-image title="放大預覽">
                                                            <img src="{{ route('feedback.attachments.show', [$project, $report, $adjustmentImage]) }}" alt="{{ $adjustmentImage->original_name }}" class="size-full object-cover" loading="lazy">
                                                        </a>
                                                        <button type="button" class="rounded text-xs font-medium text-slate-500 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="預覽全部調整圖" data-dialog-open="detail-report-{{ $report->public_id }}" data-adjustment-preview>{{ $report->adjustmentAttachments->count() }} 張調整圖</button>
                                                    </div>
                                                @endif
                                            </div>
                                        @endif

                                        <p class="mt-3 text-xs text-slate-500">更新於 <x-feedback.time :at="$report->latest_activity_at" relative /></p>
                                        <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="mt-3 grid gap-1 border-t border-slate-100 pt-3" data-kanban-status-form>
                                            @csrf
                                            @method('PATCH')
                                            <label for="board-status-{{ $report->public_id }}" class="text-[11px] font-semibold text-slate-600">移至其他狀態</label>
                                            <x-feedback.status-select id="board-status-{{ $report->public_id }}" :status="$report->status" class="w-full !px-2 !py-1.5 !text-xs" data-status-select data-status-autosave />
                                            <noscript><button type="submit" class="text-xs font-semibold text-teal-700">儲存</button></noscript>
                                            <span class="min-h-4 text-[11px] text-slate-500" data-status-feedback aria-live="polite"></span>
                                        </form>
                                    </article>
                                @endforeach
                                <p class="py-8 text-center text-xs text-slate-400" data-kanban-empty @if ($columnReports->isNotEmpty()) hidden @endif>本頁沒有問題</p>
                            </div>
                        </section>
                    @endforeach
                </div>
                <p class="mt-3 text-xs text-slate-500">欄位數字為「本頁／專案總數」。看板每頁最多顯示 50 題。</p>
                <div class="sr-only" aria-live="polite" data-kanban-announcer></div>
            </div>
        @endif
    </section>

    <div class="mt-5">{{ $reports->links() }}</div>

    @foreach ($reports as $report)
        @php
            $isEditing = $editingReport === $report->public_id;
            $editErrors = $isEditing ? $errors->getBag('editReport') : null;
        @endphp
        <dialog id="detail-report-{{ $report->public_id }}" class="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="detail-report-title-{{ $report->public_id }}" data-report-detail>
            <div class="grid max-h-[calc(100dvh-2rem)] min-w-0 gap-4 overflow-y-auto p-5 sm:p-7">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-500">編號 {{ $sequenceNumbers[$report->id] }} · {{ $report->status->label() }}@if ($isOwner) · 建立者：{{ $report->creatorLabel() }}@endif</p>
                        <h2 id="detail-report-title-{{ $report->public_id }}" class="mt-1 break-words text-lg font-bold text-slate-950">{{ $report->title }}</h2>
                    </div>
                    <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                </div>
                <p class="whitespace-pre-line break-words text-sm leading-6 text-slate-700">{{ $report->description }}</p>
                @if ($report->feedbackAttachments->isNotEmpty())
                    <div class="flex flex-wrap gap-2">
                        @foreach ($report->feedbackAttachments as $attachment)
                            <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block size-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽">
                                <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                            </a>
                        @endforeach
                    </div>
                @endif
                @if ($report->hasAdjustment())
                    <div class="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
                        @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report, 'compact' => true])
                    </div>
                @endif
                <p class="text-xs text-slate-500">建立：<x-feedback.time :at="$report->created_at" />　最後更新：<x-feedback.time :at="$report->latest_activity_at" /></p>
                <div class="flex justify-end border-t border-slate-100 pt-4">
                    <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">查看留言紀錄</a>
                </div>
            </div>
        </dialog>

        <dialog id="edit-report-{{ $report->public_id }}" class="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="edit-report-title-{{ $report->public_id }}" @if ($editErrors?->any()) data-open-on-load @endif>
            <form method="POST" action="{{ route('feedback.reports.update', [$project, $report]) }}" enctype="multipart/form-data" class="grid max-h-[calc(100dvh-2rem)] min-w-0 gap-5 overflow-y-auto p-5 sm:p-7">
                @csrf
                @method('PUT')
                <input type="hidden" name="editing_report" value="{{ $report->public_id }}">
                <div class="flex items-start justify-between gap-3">
                    <h2 id="edit-report-title-{{ $report->public_id }}" class="text-lg font-bold text-slate-950">編輯問題</h2>
                    <button type="button" class="grid size-9 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                </div>

                @if ($editErrors?->any())
                    <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                        <ul class="list-disc space-y-1 pl-5">@foreach ($editErrors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
                    </div>
                @endif

                <div>
                    <label for="edit-title-{{ $report->public_id }}" class="mb-2 block text-sm font-semibold text-slate-800">問題標題 <span class="text-rose-600">*</span></label>
                    <input id="edit-title-{{ $report->public_id }}" name="title" value="{{ $isEditing ? old('title') : $report->title }}" required maxlength="160" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                </div>
                <div>
                    <label for="edit-description-{{ $report->public_id }}" class="mb-2 block text-sm font-semibold text-slate-800">問題說明 <span class="text-rose-600">*</span></label>
                    <textarea id="edit-description-{{ $report->public_id }}" name="description" required maxlength="10000" rows="6" class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ $isEditing ? old('description') : $report->description }}</textarea>
                </div>

                @if ($report->feedbackAttachments->isNotEmpty())
                    <fieldset>
                        <legend class="mb-2 text-sm font-semibold text-slate-800">目前截圖 <span class="font-normal text-slate-500">（勾選要刪除的）</span></legend>
                        <div class="grid grid-cols-3 gap-3 sm:grid-cols-5">
                            @foreach ($report->feedbackAttachments as $attachment)
                                <label class="group relative block cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 has-[:checked]:border-rose-400 has-[:checked]:opacity-50">
                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="aspect-video w-full object-cover" loading="lazy">
                                    <span class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-rose-700">
                                        <input type="checkbox" name="remove_attachments[]" value="{{ $attachment->id }}" @checked($isEditing && in_array((string) $attachment->id, array_map('strval', old('remove_attachments', [])), true)) class="rounded border-slate-300 text-rose-600 focus:ring-rose-600">
                                        刪除
                                    </span>
                                </label>
                            @endforeach
                        </div>
                    </fieldset>
                @endif

                <div>
                    <label for="edit-screenshots-{{ $report->public_id }}" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 新增截圖<input id="edit-screenshots-{{ $report->public_id }}" name="screenshots[]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="edit-preview-{{ $report->public_id }}"></label>
                    <span class="ml-2 text-xs text-slate-500">截圖總數最多 5 張，每張 10 MB</span>
                    <div id="edit-preview-{{ $report->public_id }}" class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                </div>

                <div class="flex justify-end gap-3 border-t border-slate-100 pt-5">
                    <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close>取消</button>
                    <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">儲存變更</button>
                </div>
            </form>
        </dialog>

        @if ($isOwner)
            <dialog id="delete-report-{{ $report->public_id }}" class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="delete-report-title-{{ $report->public_id }}">
                <form method="POST" action="{{ route('feedback.reports.destroy', [$project, $report]) }}" class="grid gap-4 p-5 sm:p-6">
                    @csrf
                    @method('DELETE')
                    <h2 id="delete-report-title-{{ $report->public_id }}" class="text-lg font-bold text-slate-950">確定要刪除這個問題？</h2>
                    <p class="text-sm leading-6 text-slate-600">「{{ $report->title }}」與它的截圖、留言紀錄會被永久刪除，無法復原。</p>
                    <div class="flex justify-end gap-3">
                        <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close autofocus>取消</button>
                        <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2">確認刪除</button>
                    </div>
                </form>
            </dialog>
        @else
            <dialog id="client-delete-report-{{ $report->public_id }}" class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="client-delete-report-title-{{ $report->public_id }}">
                <form method="POST" action="{{ route('feedback.reports.client-destroy', [$project, $report]) }}" class="grid gap-4 p-5 sm:p-6">
                    @csrf
                    @method('DELETE')
                    <h2 id="client-delete-report-title-{{ $report->public_id }}" class="text-lg font-bold text-slate-950">確定刪除？</h2>
                    <p class="text-sm leading-6 text-slate-600">「{{ $report->title }}」刪除後會從清單移除，無法自行復原。</p>
                    <div class="flex justify-end gap-3">
                        <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close autofocus>取消</button>
                        <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2">確認刪除</button>
                    </div>
                </form>
            </dialog>
        @endif
    @endforeach

    <dialog id="new-issues" class="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="new-issues-title" data-issue-entry @if ($errors->getBag('default')->any()) data-open-on-load @endif>
        <div class="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto p-5 sm:p-7">
        <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-5">
            <div>
                <h2 id="new-issues-title" class="text-lg font-bold text-slate-950">新增問題</h2>
                <p class="mt-1 text-sm text-slate-600">可以一次加入多個問題；每一列會建立成獨立項目。</p>
            </div>
            <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
        </div>

        @if ($errors->getBag('default')->any())
            <div role="alert" class="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p class="font-semibold">請修正以下內容：</p>
                <ul class="mt-2 list-disc space-y-1 pl-5">@foreach ($errors->getBag('default')->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
            </div>
        @endif

        <form method="POST" action="{{ route('feedback.reports.store', $project) }}" enctype="multipart/form-data" class="mt-5 grid min-w-0 gap-5" data-issue-form>
            @csrf
            <div class="grid min-w-0 gap-5" data-issue-list>
                @foreach ($issueRows as $index => $issue)
                    <fieldset class="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5" data-issue-row>
                        <div class="flex items-center justify-between gap-3">
                            <legend class="text-sm font-bold text-slate-900">問題 <span data-issue-number>{{ $loop->iteration }}</span></legend>
                            <button type="button" class="text-xs font-semibold text-rose-700 hover:text-rose-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-remove-issue>移除</button>
                        </div>
                        <div class="mt-4 grid gap-4">
                            <div>
                                <label for="issue-title-{{ $index }}" class="mb-2 block text-sm font-semibold text-slate-800">問題標題 <span class="text-rose-600">*</span></label>
                                <input id="issue-title-{{ $index }}" name="issues[{{ $index }}][title]" value="{{ $issue['title'] ?? '' }}" required maxlength="160" placeholder="例如：答案儲存後重新整理會消失" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                            </div>
                            <div>
                                <label for="issue-description-{{ $index }}" class="mb-2 block text-sm font-semibold text-slate-800">問題說明 <span class="text-rose-600">*</span></label>
                                <textarea id="issue-description-{{ $index }}" name="issues[{{ $index }}][description]" required maxlength="10000" rows="4" placeholder="請說明操作步驟、預期結果與實際結果。" class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ $issue['description'] ?? '' }}</textarea>
                            </div>
                            <div>
                                <label for="issue-screenshots-{{ $index }}" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 上傳截圖<input id="issue-screenshots-{{ $index }}" name="issues[{{ $index }}][screenshots][]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="issue-preview-{{ $index }}"></label>
                                <span class="ml-2 text-xs text-slate-500">最多 5 張，每張 10 MB</span>
                                <div id="issue-preview-{{ $index }}" class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                            </div>
                        </div>
                    </fieldset>
                @endforeach
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
            <fieldset class="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5" data-issue-row>
                <div class="flex items-center justify-between gap-3">
                    <legend class="text-sm font-bold text-slate-900">問題 <span data-issue-number></span></legend>
                    <button type="button" class="text-xs font-semibold text-rose-700 hover:text-rose-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-remove-issue>移除</button>
                </div>
                <div class="mt-4 grid gap-4">
                    <div><label for="issue-title-__INDEX__" class="mb-2 block text-sm font-semibold text-slate-800">問題標題 <span class="text-rose-600">*</span></label><input id="issue-title-__INDEX__" name="issues[__INDEX__][title]" required maxlength="160" placeholder="例如：答案儲存後重新整理會消失" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"></div>
                    <div><label for="issue-description-__INDEX__" class="mb-2 block text-sm font-semibold text-slate-800">問題說明 <span class="text-rose-600">*</span></label><textarea id="issue-description-__INDEX__" name="issues[__INDEX__][description]" required maxlength="10000" rows="4" placeholder="請說明操作步驟、預期結果與實際結果。" class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"></textarea></div>
                    <div>
                        <label for="issue-screenshots-__INDEX__" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 上傳截圖<input id="issue-screenshots-__INDEX__" name="issues[__INDEX__][screenshots][]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="issue-preview-__INDEX__"></label>
                        <span class="ml-2 text-xs text-slate-500">最多 5 張，每張 10 MB</span>
                        <div id="issue-preview-__INDEX__" class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                    </div>
                </div>
            </fieldset>
        </template>
        </div>
    </dialog>
</x-feedback.layout>
