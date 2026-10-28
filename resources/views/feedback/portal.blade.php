<x-feedback.layout :title="'問題清單｜'.$project->name" :$project max-width="max-w-[96rem]">
    @php
        $baseQuery = array_filter([
            'view' => $viewMode,
            'q' => $keyword,
            'status' => $selectedStatus?->value,
            'category' => $selectedCategory !== '' ? $selectedCategory : null,
            'deleted' => $isOwner ? $deletedFilter : null,
            'creator' => $isOwner ? $creator : null,
            'unread' => $unreadOnly ? 1 : null,
            'sort' => $sort === 'conversation' ? null : $sort,
            'direction' => $sort === 'conversation' ? null : $direction,
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
            'category' => $selectedCategory !== '' ? $selectedCategory : null,
            'creator' => $isOwner ? $creator : null,
            'unread' => $unreadOnly ? 1 : null,
            'view' => $viewMode === 'board' ? 'board' : null,
            'q' => $keyword,
        ]));
        $sortMark = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? '↑' : '↓')
            : '';
        $ariaSort = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? 'ascending' : 'descending')
            : 'none';
        $issueRows = old('issues', [['title' => '', 'description' => '']]);
        $reportCategories = $project->reportCategories();
        $isGuest = app(\App\Support\FeedbackAccess::class)->isGuest($project);
        $editingReport = old('editing_report');
        $boardStatuses = \App\Enums\FeedbackReportStatus::cases();
        $pageStatusCounts = $reports->getCollection()->countBy(fn ($report) => $report->status->value);
    @endphp

    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <p class="text-sm font-semibold text-teal-700">{{ config('feedback.portal_title') }}</p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">問題清單</h1>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ $viewMode === 'board' ? '拖拉卡片到其他欄，即可更新狀態；各欄預設與右下角留言對話相同：有新留言的最前，再來是有留言的單（依最新留言時間），沒有留言的依建立時間，新的在前。' : '狀態可直接在表格中切換，點欄名即可排序；預設與右下角留言對話相同：有新留言的最前，再來是有留言的單（依最新留言時間），沒有留言的依建立時間，新的在前。' }}</p>
            <ul class="mt-2 grid gap-x-6 sm:grid-cols-[auto_1fr] text-sm leading-6 text-slate-600" data-status-guide>
                <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class="size-2.5 rounded-full {{ \App\Enums\FeedbackReportStatus::New->dotClass() }}" aria-hidden="true"></span>待處理</span><span>已收到{{ config('feedback.labels.client') }}的回報，等{{ config('feedback.labels.owner') }}處理。</span></li>
                <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class="size-2.5 rounded-full {{ \App\Enums\FeedbackReportStatus::NeedsInput->dotClass() }}" aria-hidden="true"></span>待審核</span><span>{{ config('feedback.labels.owner') }}已改好並寫了調整說明，請{{ config('feedback.labels.client') }}確認。</span></li>
                <li class="flex items-baseline gap-3 sm:contents"><span class="flex shrink-0 items-center gap-2 font-semibold text-slate-800"><span class="size-2.5 rounded-full {{ \App\Enums\FeedbackReportStatus::Completed->dotClass() }}" aria-hidden="true"></span>已完成</span><span>{{ config('feedback.labels.client') }}確認沒問題，該問題修復成功。</span></li>
            </ul>
            <p class="mt-2 text-sm leading-6 text-slate-600" data-preview-guide>可點開預覽：{{ $viewMode === 'board' ? '卡片標題、附件縮圖、調整說明、調整圖（「N 張調整圖」）。' : '標題、圖片縮圖、調整說明、調整附圖。' }}</p>
        </div>
        <button type="button" data-dialog-open="new-issues" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">＋ 新增問題</button>
    </div>

    <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="issue-list-heading">
        <h2 id="issue-list-heading" class="sr-only">已登記問題</h2>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
            <p class="font-semibold" data-report-count>共 {{ $totalCount }} 題@if ($viewMode === 'board' || $keyword !== '' || $selectedStatus || $selectedCategory !== '' || ($isOwner && ($deletedFilter || $creator !== '' || $unreadOnly)))（篩選後 {{ $reports->total() }} 題）@endif</p>
            <ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-status-summary>
                @foreach (\App\Enums\FeedbackReportStatus::cases() as $summaryStatus)
                    @php
                        $summaryCount = $statusCounts[$summaryStatus->value] ?? 0;
                    @endphp
                    <li data-summary-status="{{ $summaryStatus->value }}"><a href="{{ $statusUrl($summaryStatus) }}" class="rounded font-semibold text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-status-summary-item="{{ $summaryStatus->value }}" data-label="{{ $summaryStatus->label() }}">{{ $summaryStatus->label() }} {{ $summaryCount }} 題</a></li>
                @endforeach
            </ul>
            <nav class="ml-auto inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1" aria-label="顯示模式">
                <a href="{{ $portalUrl(['view' => 'list']) }}" @class(['inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', 'bg-white text-slate-950 shadow-sm' => $viewMode === 'list', 'text-slate-600 hover:text-slate-950' => $viewMode !== 'list']) @if ($viewMode === 'list') aria-current="page" @endif data-view-mode="list">☷ 列表</a>
                <a href="{{ $portalUrl(['view' => 'board']) }}" @class(['inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', 'bg-white text-slate-950 shadow-sm' => $viewMode === 'board', 'text-slate-600 hover:text-slate-950' => $viewMode !== 'board']) @if ($viewMode === 'board') aria-current="page" @endif data-view-mode="board">▦ 看板</a>
            </nav>
        </div>

        @if ($isOwner)
            <div @class(['flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm', 'border-rose-200 bg-rose-50 text-rose-900' => $unreadReportCount > 0, 'border-slate-200 bg-white text-slate-600' => $unreadReportCount === 0]) data-unread-summary data-unread-only="{{ $unreadOnly ? '1' : '0' }}" data-unread-only-url="{{ $portalUrl(['unread' => 1], ['page']) }}">
                <p class="font-semibold" data-unread-summary-text>@if ($unreadReportCount > 0)有 <span data-unread-report-count>{{ $unreadReportCount }}</span> 張單有未讀留言@else目前沒有未讀留言@endif</p>
                @if ($unreadOnly)
                    <a href="{{ $portalUrl([], ['unread', 'page']) }}" class="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-unread-filter>顯示全部</a>
                @elseif ($unreadReportCount > 0)
                    <a href="{{ $portalUrl(['unread' => 1], ['page']) }}" class="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2" data-unread-filter>只看未讀留言</a>
                @endif
            </div>
        @endif

        <form method="GET" class="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex md:items-center md:justify-end">
            <input type="hidden" name="view" value="{{ $viewMode }}">
            @if ($unreadOnly)
                <input type="hidden" name="unread" value="1">
            @endif
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
                    @foreach (\App\Enums\FeedbackReportStatus::cases() as $statusOption)
                        <option value="{{ $statusOption->value }}" @selected($selectedStatus === $statusOption)>{{ $statusOption->label() }}</option>
                    @endforeach
                </select>
            </label>
            @if ($reportCategories !== [])
                <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">分類
                    <select name="category" data-auto-submit data-category-filter class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                        <option value="">全部</option>
                        @foreach ($reportCategories as $categoryOption)
                            <option value="{{ $categoryOption }}" @selected($selectedCategory === $categoryOption)>{{ $categoryOption }}</option>
                        @endforeach
                        <option value="{{ \App\Http\Controllers\Feedback\FeedbackPortalController::UNCATEGORIZED }}" @selected($selectedCategory === \App\Http\Controllers\Feedback\FeedbackPortalController::UNCATEGORIZED)>未分類</option>
                    </select>
                </label>
            @endif
            @if ($isOwner)
                <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">建立者
                    <select name="creator" data-auto-submit data-creator-filter class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                        <option value="">全部</option>
                        @foreach ($creatorOptions as $creatorValue => $creatorName)
                            <option value="{{ $creatorValue }}" @selected($creator === $creatorValue)>{{ $creatorName }}</option>
                        @endforeach
                    </select>
                </label>
                <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">{{ config('feedback.labels.client') }}已刪除
                    <select name="deleted" data-auto-submit data-deleted-filter class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                        <option value="">一併顯示</option>
                        <option value="hide" @selected($deletedFilter === 'hide')>隱藏</option>
                        <option value="only" @selected($deletedFilter === 'only')>只看已刪除</option>
                    </select>
                </label>
            @endif
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 @if ($viewMode === 'list') md:hidden @else md:flex md:items-center md:gap-2 @endif">排序欄位
                <select name="sort" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="conversation" @selected($sort === 'conversation')>預設（新留言優先）</option>
                    <option value="latest_activity_at" @selected($sort === 'latest_activity_at')>最後更新</option>
                    <option value="created_at" @selected($sort === 'created_at')>建立時間</option>
                    <option value="title" @selected($sort === 'title')>問題</option>
                    <option value="status" @selected($sort === 'status')>狀態</option>
                </select>
            </label>
            @if ($sort !== 'conversation')
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 @if ($viewMode === 'list') md:hidden @else md:flex md:items-center md:gap-2 @endif">順序
                <select name="direction" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="desc" @selected($direction === 'desc')>新到舊／降冪</option>
                    <option value="asc" @selected($direction === 'asc')>舊到新／升冪</option>
                </select>
            </label>
            @endif
            @if ($viewMode === 'list' && $sort !== 'conversation')
                <a href="{{ $portalUrl([], ['sort', 'direction', 'page']) }}" class="col-span-2 hidden rounded text-xs font-semibold text-teal-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline" data-sort-reset>恢復預設排序（新留言優先）</a>
            @endif
        </form>

        @if ($viewMode === 'list')
        <div class="sm:overflow-x-auto" data-list-view>
            <table class="block w-full border-collapse text-left text-sm sm:table sm:min-w-[64rem]" data-report-table>
                <thead class="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 sm:table-header-group">
                    <tr>
                        <th class="whitespace-nowrap min-w-16 w-16 px-4 text-center py-3.5">編號</th>
                        <th class="whitespace-nowrap min-min-w-48 w-64 max-w-64 px-4 text-left py-3.5" aria-sort="{{ $ariaSort('title') }}"><a href="{{ $sortUrl('title') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">標題 @if ($sort === 'title')<span aria-hidden="true">{{ $sortMark('title') }}</span>@endif</a></th>
                        <th class="whitespace-nowrap min-w-36 px-4 py-3.5 text-center" aria-sort="{{ $ariaSort('status') }}"><a href="{{ $sortUrl('status') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">狀態 @if ($sort === 'status')<span aria-hidden="true">{{ $sortMark('status') }}</span>@endif</a></th>
                        @if ($reportCategories !== [])
                            <th class="whitespace-nowrap w-28 px-4 py-3.5 text-center">分類</th>
                        @endif
                        <th class="whitespace-nowrap w-44 px-4 text-center py-3.5">圖片</th>
                        <th class="whitespace-nowrap min-w-48 w-64 max-w-64 px-4 text-left py-3.5">調整說明</th>
                        <th class="whitespace-nowrap w-28 px-4 py-3.5 text-center">建立者</th>
                        <th class="whitespace-nowrap w-32 px-4 text-center py-3.5" aria-sort="{{ $ariaSort('created_at') }}"><a href="{{ $sortUrl('created_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">建立日期 @if ($sort === 'created_at')<span aria-hidden="true">{{ $sortMark('created_at') }}</span>@endif</a></th>
                        <th class="whitespace-nowrap w-28 px-4 py-3.5 text-center" aria-sort="{{ $ariaSort('latest_activity_at') }}"><a href="{{ $sortUrl('latest_activity_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">最後更新 @if ($sort === 'latest_activity_at')<span aria-hidden="true">{{ $sortMark('latest_activity_at') }}</span>@endif</a></th>
                        <th class="whitespace-nowrap w-36 px-4 py-3.5 text-center">操作</th>
                    </tr>
                </thead>
                <tbody class="block divide-y divide-slate-100 sm:table-row-group">
                    @forelse ($reports as $report)
                        <tr class="block space-y-2 p-3 transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0 sm:align-middle @if ($report->isDeletedByClient()) bg-slate-50 text-slate-500 @endif" data-report-row="{{ $report->public_id }}">
                            <td class="block text-xs font-bold text-slate-500 sm:table-cell sm:whitespace-nowrap sm:text-center sm:px-3 sm:py-2 sm:align-middle"><span class="sm:hidden">編號 </span><span data-report-number>{{ $sequenceNumbers[$report->id] }}</span></td>
                            <td class="block sm:table-cell sm:px-4 sm:py-2 sm:align-middle">
                                <div class="flex items-start gap-2">
                                    <button type="button" class="min-w-0 flex-1 text-left font-semibold text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-{{ $report->public_id }}" data-report-detail-open>{{ $report->title }}</button>
                                    <x-feedback.message-badges :$report :is-owner="$isOwner" class="-my-1" />
                                </div>
                                @if ($isOwner && $report->isDeletedByClient())
                                    <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500" data-client-deleted>
                                        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">{{ config('feedback.labels.client') }}已刪除</span>
                                        <x-feedback.time :at="$report->client_deleted_at" />
                                    </span>
                                @endif
                            </td>
                            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center">
                                <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="grid">
                                    @csrf
                                    @method('PATCH')
                                    <label for="status-{{ $report->public_id }}" class="sr-only">「{{ $report->title }}」的狀態</label>
                                    <div class="flex items-center gap-2 sm:mx-auto sm:max-w-40 sm:justify-center">
                                        <span class="size-2.5 shrink-0 rounded-full {{ $report->status->dotClass() }}" aria-hidden="true" data-status-dot></span>
                                        <x-feedback.status-select id="status-{{ $report->public_id }}" :status="$report->status" class="min-w-0 flex-1 sm:min-w-28 sm:max-w-36 !px-2 !py-1 !text-xs" data-status-select data-status-autosave />
                                    </div>
                                    <noscript><button type="submit" class="text-xs font-semibold text-teal-700">儲存</button></noscript>
                                    <span class="text-[11px] empty:hidden text-slate-500" data-status-feedback aria-live="polite"></span>
                                </form>
                            </td>
                            @if ($reportCategories !== [])
                                <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-category-cell><x-feedback.category-select :$project :$report :categories="$reportCategories" compact class="justify-start sm:justify-center" data-suffix="-row" /></td>
                            @endif
                            <td class="block empty:hidden sm:table-cell sm:text-center sm:px-3 sm:py-2 sm:align-middle">
                                @if ($report->feedbackAttachments->isNotEmpty())
                                    <div class="flex flex-wrap gap-1 sm:justify-center">
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
                            <td class="block sm:max-w-64 sm:table-cell sm:px-3 sm:py-2 sm:align-middle">
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
                            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle" data-report-creator><span class="font-semibold text-slate-500 sm:hidden">建立者：</span>{{ $report->creatorLabel() }}</td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">建立：</span><x-feedback.time :at="$report->created_at" /></td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:text-center sm:whitespace-nowrap sm:px-3 sm:py-2 sm:align-middle"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><x-feedback.time :at="$report->latest_activity_at" relative /></td>
                            <td class="block sm:table-cell sm:px-3 sm:py-2 sm:align-middle sm:text-center">
                                <div class="flex flex-wrap gap-2 sm:justify-center">
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
                        <tr class="block sm:table-row"><td colspan="{{ $reportCategories !== [] ? 10 : 9 }}" class="block px-6 sm:table-cell py-14 text-center text-sm text-slate-500">{{ $unreadOnly ? '沒有未讀留言的單。' : '目前沒有問題，請按「新增問題」登記第一筆。' }}</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        @else
            <div class="overflow-x-auto overscroll-x-contain bg-slate-100/70 p-4" data-kanban-board data-status-filter="{{ $selectedStatus?->value }}">
                <div class="grid min-w-full grid-flow-col auto-cols-[minmax(17rem,85vw)] items-start gap-4 sm:auto-cols-[19rem] xl:auto-cols-[minmax(18rem,1fr)]" role="region" aria-label="問題狀態看板">
                    @foreach ($boardStatuses as $boardStatus)
                        @php
                            $dotClass = $boardStatus->dotClass();
                            $columnClass = match ($boardStatus) {
                                \App\Enums\FeedbackReportStatus::New => 'border-slate-200 bg-slate-50',
                                \App\Enums\FeedbackReportStatus::NeedsInput => 'border-amber-200 bg-amber-50/70',
                                \App\Enums\FeedbackReportStatus::Completed => 'border-emerald-200 bg-emerald-50/70',
                            };
                            $columnReports = $reports->getCollection()->filter(fn ($report) => $report->status === $boardStatus);
                        @endphp
                        <section class="overflow-hidden rounded-xl border {{ $columnClass }}" aria-labelledby="kanban-heading-{{ $boardStatus->value }}" data-kanban-column data-status="{{ $boardStatus->value }}">
                            <header class="flex items-center justify-between gap-3 border-b border-black/5 px-3.5 py-3">
                                <h3 id="kanban-heading-{{ $boardStatus->value }}" class="flex items-center gap-2 text-sm font-bold text-slate-900"><span class="size-2.5 rounded-full {{ $dotClass }}" aria-hidden="true"></span>{{ $boardStatus->label() }}</h3>
                                <span class="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-inset ring-black/10" title="本頁／專案總數"><span data-kanban-page-count>{{ $pageStatusCounts[$boardStatus->value] ?? 0 }}</span> / <span data-kanban-total-count="{{ $boardStatus->value }}">{{ $statusCounts[$boardStatus->value] ?? 0 }}</span></span>
                            </header>
                            <div class="grid min-h-36 content-start gap-3 p-3" data-kanban-list data-status="{{ $boardStatus->value }}">
                                @foreach ($columnReports as $report)
                                    <article class="cursor-grab rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing @if ($report->isDeletedByClient()) opacity-70 @endif" data-kanban-card data-report-id="{{ $report->public_id }}" data-status="{{ $report->status->value }}" data-board-order="{{ $reports->getCollection()->search(fn ($item) => $item->is($report)) }}" title="拖拉卡片可改變狀態">
                                        <div class="flex items-start gap-2">
                                            <div class="min-w-0 flex-1">
                                                <p class="text-[11px] font-bold text-slate-500">編號 <span data-report-number>{{ $sequenceNumbers[$report->id] }}</span></p>
                                                <x-feedback.category-select :$project :$report :categories="$reportCategories" compact class="mt-1" data-suffix="-card" data-card-action />
                                                <button type="button" class="mt-1 block w-full break-words text-left text-sm font-semibold leading-5 text-slate-950 hover:text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="detail-report-{{ $report->public_id }}" data-report-detail-open>{{ $report->title }}</button>
                                            </div>
                                            <div class="flex shrink-0 items-center gap-1" data-card-actions>
                                                <x-feedback.message-badges :$report :is-owner="$isOwner" />
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
                                            <span class="mt-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300" data-client-deleted>{{ config('feedback.labels.client') }}已刪除</span>
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

                                        <p class="mt-3 text-xs text-slate-500" data-report-creator>建立者：{{ $report->creatorLabel() }}</p>
                                        <p class="mt-1 text-xs text-slate-500">更新於 <x-feedback.time :at="$report->latest_activity_at" relative /></p>
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
                        <p class="text-xs font-bold text-slate-500">編號 {{ $sequenceNumbers[$report->id] }} · {{ $report->status->label() }}</p>
                        <h2 id="detail-report-title-{{ $report->public_id }}" class="mt-1 break-words text-lg font-bold text-slate-950">{{ $report->title }}</h2>
                    </div>
                    <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
                </div>
                <x-feedback.category-select :$project :$report :categories="$reportCategories" />
                <div data-report-description>{{ \App\Support\FeedbackRichText::render($report->description, compact: true) }}</div>
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
                <p class="text-xs text-slate-500" data-report-creator>建立者：{{ $report->creatorLabel() }}</p>
                <p class="text-xs text-slate-500">建立：<x-feedback.time :at="$report->created_at" />　最後更新：<x-feedback.time :at="$report->latest_activity_at" /></p>
                @unless ($isOwner)
                    <p class="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-900" data-message-hint>有問題或補充，可以點「開啟對話」直接留言給{{ config('feedback.labels.owner') }}。</p>
                @endunless
                <div class="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                    <x-feedback.message-badges :$report :is-owner="$isOwner" label="開啟對話" />
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
                @if ($reportCategories !== [])
                    @php $editCategory = $isEditing ? old('category') : $report->category; @endphp
                    <div>
                        <label for="edit-category-{{ $report->public_id }}" class="mb-2 block text-sm font-semibold text-slate-800">分類</label>
                        <select id="edit-category-{{ $report->public_id }}" name="category" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-edit-category>
                            <option value="" @selected(blank($editCategory))>未分類</option>
                            @foreach ($reportCategories as $reportCategory)
                                <option value="{{ $reportCategory }}" @selected($editCategory === $reportCategory)>{{ $reportCategory }}</option>
                            @endforeach
                            @if (filled($report->category) && ! in_array($report->category, $reportCategories, true))
                                <option value="{{ $report->category }}" @selected($editCategory === $report->category)>{{ $report->category }}</option>
                            @endif
                        </select>
                    </div>
                @endif
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
            @if ($isGuest)
                <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
                    <label for="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}">Website</label>
                    <input id="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}" name="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}" type="text" tabindex="-1" autocomplete="off">
                </div>
                @if (app(\App\Support\PublicReporting::class)->turnstileEnabled())
                    <div class="cf-turnstile" data-sitekey="{{ config('feedback.public_reporting.turnstile.site_key') }}" data-turnstile></div>
                    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                @endif
            @endif
            <div class="grid min-w-0 gap-5" data-issue-list>
                @foreach ($issueRows as $index => $issue)
                    <fieldset class="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5" data-issue-row>
                        <div class="flex items-center justify-between gap-3">
                            <legend class="text-sm font-bold text-slate-900">問題 <span data-issue-number>{{ $loop->iteration }}</span></legend>
                            <button type="button" class="text-xs font-semibold text-rose-700 hover:text-rose-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-remove-issue>移除</button>
                        </div>
                        <div class="mt-4 grid gap-4">
                            @if ($reportCategories !== [])
                                <div>
                                    <label for="issue-category-{{ $index }}" class="mb-2 block text-sm font-semibold text-slate-800">分類 <span class="text-rose-600">*</span></label>
                                    <select id="issue-category-{{ $index }}" name="issues[{{ $index }}][category]" required class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-issue-category>
                                        <option value="">請選擇分類</option>
                                        @foreach ($reportCategories as $reportCategory)
                                            <option value="{{ $reportCategory }}" @selected(($issue['category'] ?? '') === $reportCategory)>{{ $reportCategory }}</option>
                                        @endforeach
                                    </select>
                                </div>
                            @endif
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
                    @if ($reportCategories !== [])
                        <div><label for="issue-category-__INDEX__" class="mb-2 block text-sm font-semibold text-slate-800">分類 <span class="text-rose-600">*</span></label><select id="issue-category-__INDEX__" name="issues[__INDEX__][category]" required class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-issue-category><option value="">請選擇分類</option>@foreach ($reportCategories as $reportCategory)<option value="{{ $reportCategory }}">{{ $reportCategory }}</option>@endforeach</select></div>
                    @endif
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
