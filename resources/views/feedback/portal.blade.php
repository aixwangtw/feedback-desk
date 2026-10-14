<x-feedback.layout :title="'問題清單｜'.$project->name" :$project max-width="max-w-6xl">
    @php
        $sortUrl = function (string $column) use ($project, $sort, $direction, $selectedStatus): string {
            $nextDirection = $sort === $column && $direction === 'asc' ? 'desc' : 'asc';

            return route('feedback.portal', $project).'?'.http_build_query(array_filter([
                'status' => $selectedStatus?->value,
                'sort' => $column,
                'direction' => $nextDirection,
            ]));
        };
        $sortMark = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? '↑' : '↓')
            : '↕';
        $ariaSort = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? 'ascending' : 'descending')
            : 'none';
        $issueRows = old('issues', [['title' => '', 'description' => '']]);
        $editingReport = old('editing_report');
    @endphp

    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <p class="text-sm font-semibold text-teal-700">範例專案</p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">問題清單</h1>
            <p class="mt-2 text-sm leading-6 text-slate-600">每個問題各自追蹤狀態與討論；狀態可直接在表格中切換，點選欄名即可排序。</p>
        </div>
        <button type="button" data-dialog-open="new-issues" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">＋ 新增問題</button>
    </div>

    <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="issue-list-heading">
        <h2 id="issue-list-heading" class="sr-only">已登記問題</h2>

        <form method="GET" class="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex md:items-center md:justify-end">
            <label class="col-span-2 grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:flex md:items-center md:gap-2">篩選狀態
                <select name="status" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="">全部</option>
                    @foreach (\App\Enums\FeedbackReportStatus::cases() as $statusOption)
                        <option value="{{ $statusOption->value }}" @selected($selectedStatus === $statusOption)>{{ $statusOption->label() }}</option>
                    @endforeach
                </select>
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:hidden">排序欄位
                <select name="sort" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="latest_activity_at" @selected($sort === 'latest_activity_at')>最後更新</option>
                    <option value="created_at" @selected($sort === 'created_at')>建立時間</option>
                    <option value="title" @selected($sort === 'title')>問題</option>
                    <option value="status" @selected($sort === 'status')>狀態</option>
                </select>
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600 md:hidden">順序
                <select name="direction" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="desc" @selected($direction === 'desc')>新到舊／降冪</option>
                    <option value="asc" @selected($direction === 'asc')>舊到新／升冪</option>
                </select>
            </label>
        </form>

        <div class="sm:overflow-x-auto">
            <table class="block w-full border-collapse text-left text-sm sm:table sm:min-w-[56rem]" data-report-table>
                <thead class="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 sm:table-header-group">
                    <tr>
                        <th class="min-w-72 px-5 py-3.5" aria-sort="{{ $ariaSort('title') }}"><a href="{{ $sortUrl('title') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">標題／內容 <span aria-hidden="true">{{ $sortMark('title') }}</span></a></th>
                        <th class="w-36 px-4 py-3.5" aria-sort="{{ $ariaSort('status') }}"><a href="{{ $sortUrl('status') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">狀態 <span aria-hidden="true">{{ $sortMark('status') }}</span></a></th>
                        <th class="w-44 px-4 py-3.5">圖片</th>
                        <th class="w-32 px-4 py-3.5" aria-sort="{{ $ariaSort('created_at') }}"><a href="{{ $sortUrl('created_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">建立日期 <span aria-hidden="true">{{ $sortMark('created_at') }}</span></a></th>
                        <th class="w-28 px-4 py-3.5" aria-sort="{{ $ariaSort('latest_activity_at') }}"><a href="{{ $sortUrl('latest_activity_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">最後更新 <span aria-hidden="true">{{ $sortMark('latest_activity_at') }}</span></a></th>
                        <th class="w-36 px-4 py-3.5">操作</th>
                    </tr>
                </thead>
                <tbody class="block divide-y divide-slate-100 sm:table-row-group">
                    @forelse ($reports as $report)
                        <tr class="block space-y-3 p-4 align-top transition hover:bg-slate-50 sm:table-row sm:space-y-0 sm:p-0" data-report-row="{{ $report->public_id }}">
                            <td class="block sm:table-cell sm:px-5 sm:py-4">
                                <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="font-semibold text-slate-950 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">{{ $report->title }}</a>
                                <p class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{{ $report->description }}</p>
                                <p class="mt-1 font-mono text-[11px] text-slate-400">#{{ substr($report->public_id, 0, 8) }}</p>
                            </td>
                            <td class="block sm:table-cell sm:px-4 sm:py-4">
                                <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="grid gap-1">
                                    @csrf
                                    @method('PATCH')
                                    <label for="status-{{ $report->public_id }}" class="sr-only">「{{ $report->title }}」的狀態</label>
                                    <x-feedback.status-select id="status-{{ $report->public_id }}" :status="$report->status" class="w-full" data-status-select data-status-autosave />
                                    <noscript><button type="submit" class="text-xs font-semibold text-teal-700">儲存</button></noscript>
                                    <span class="min-h-4 text-[11px] text-slate-500" data-status-feedback aria-live="polite"></span>
                                </form>
                            </td>
                            <td class="block empty:hidden sm:table-cell sm:px-4 sm:py-4">
                                @if ($report->feedbackAttachments->isNotEmpty())
                                    <div class="flex flex-wrap gap-1.5">
                                        @foreach ($report->feedbackAttachments as $attachment)
                                            <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block size-12 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽">
                                                <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                            </a>
                                        @endforeach
                                    </div>
                                @else
                                    <span class="text-xs text-slate-400">—</span>
                                @endif
                            </td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:whitespace-nowrap sm:px-4 sm:py-4"><span class="font-semibold text-slate-500 sm:hidden">建立：</span><x-feedback.time :at="$report->created_at" /></td>
                            <td class="block text-xs text-slate-600 sm:table-cell sm:whitespace-nowrap sm:px-4 sm:py-4"><span class="font-semibold text-slate-500 sm:hidden">最後更新：</span><x-feedback.time :at="$report->latest_activity_at" relative /></td>
                            <td class="block sm:table-cell sm:px-4 sm:py-4">
                                <div class="flex flex-wrap gap-2">
                                    <button type="button" class="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="edit-report-{{ $report->public_id }}">編輯</button>
                                    @if ($isOwner)
                                        <button type="button" class="inline-flex min-h-9 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="delete-report-{{ $report->public_id }}" data-delete-report>刪除</button>
                                    @endif
                                </div>
                            </td>
                        </tr>
                    @empty
                        <tr class="block sm:table-row"><td colspan="6" class="block px-6 sm:table-cell py-14 text-center text-sm text-slate-500">目前沒有問題，請按「新增問題」登記第一筆。</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </section>

    <div class="mt-5">{{ $reports->links() }}</div>

    @foreach ($reports as $report)
        @php
            $isEditing = $editingReport === $report->public_id;
            $editErrors = $isEditing ? $errors->getBag('editReport') : null;
        @endphp
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
