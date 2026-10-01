<x-feedback.layout :title="'問題清單｜'.$project->name" :$project>
    @php
        $sortUrl = function (string $column) use ($project, $sort, $direction): string {
            $nextDirection = $sort === $column && $direction === 'asc' ? 'desc' : 'asc';

            return route('feedback.portal', $project).'?'.http_build_query([
                'sort' => $column,
                'direction' => $nextDirection,
            ]);
        };
        $sortMark = fn (string $column): string => $sort === $column
            ? ($direction === 'asc' ? '↑' : '↓')
            : '↕';
        $issueRows = old('issues', [['title' => '', 'description' => '']]);
    @endphp

    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <p class="text-sm font-semibold text-teal-700">範例專案</p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">問題清單</h1>
            <p class="mt-2 text-sm leading-6 text-slate-600">每個問題各自追蹤狀態與討論；點選欄名即可排序。</p>
        </div>
        <a href="#new-issues" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">＋ 登記問題</a>
    </div>

    <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="issue-list-heading">
        <h2 id="issue-list-heading" class="sr-only">已登記問題</h2>

        <form method="GET" class="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 md:hidden">
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">排序欄位
                <select name="sort" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="latest_activity_at" @selected($sort === 'latest_activity_at')>最後更新</option>
                    <option value="created_at" @selected($sort === 'created_at')>建立時間</option>
                    <option value="title" @selected($sort === 'title')>問題</option>
                    <option value="status" @selected($sort === 'status')>狀態</option>
                </select>
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold text-slate-600">順序
                <select name="direction" data-auto-submit class="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                    <option value="desc" @selected($direction === 'desc')>新到舊／降冪</option>
                    <option value="asc" @selected($direction === 'asc')>舊到新／升冪</option>
                </select>
            </label>
        </form>

        <div class="hidden overflow-x-auto md:block">
            <table class="w-full border-collapse text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                        <th class="w-24 px-5 py-3.5">編號</th>
                        <th class="min-w-72 px-5 py-3.5" aria-sort="{{ $sort === 'title' ? ($direction === 'asc' ? 'ascending' : 'descending') : 'none' }}"><a href="{{ $sortUrl('title') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">問題 <span aria-hidden="true">{{ $sortMark('title') }}</span></a></th>
                        <th class="w-32 px-5 py-3.5" aria-sort="{{ $sort === 'status' ? ($direction === 'asc' ? 'ascending' : 'descending') : 'none' }}"><a href="{{ $sortUrl('status') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">狀態 <span aria-hidden="true">{{ $sortMark('status') }}</span></a></th>
                        <th class="w-40 px-5 py-3.5" aria-sort="{{ $sort === 'created_at' ? ($direction === 'asc' ? 'ascending' : 'descending') : 'none' }}"><a href="{{ $sortUrl('created_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">建立時間 <span aria-hidden="true">{{ $sortMark('created_at') }}</span></a></th>
                        <th class="w-40 px-5 py-3.5" aria-sort="{{ $sort === 'latest_activity_at' ? ($direction === 'asc' ? 'ascending' : 'descending') : 'none' }}"><a href="{{ $sortUrl('latest_activity_at') }}" class="inline-flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">最後更新 <span aria-hidden="true">{{ $sortMark('latest_activity_at') }}</span></a></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    @forelse ($reports as $report)
                        <tr class="transition hover:bg-slate-50">
                            <td class="px-5 py-4 font-mono text-xs text-slate-500">#{{ substr($report->public_id, 0, 8) }}</td>
                            <td class="px-5 py-4">
                                <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="font-semibold text-slate-950 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">{{ $report->title }}</a>
                                <p class="mt-1 line-clamp-1 text-xs text-slate-500">{{ $report->description }}</p>
                            </td>
                            <td class="px-5 py-4"><x-feedback.status-badge :status="$report->status" /></td>
                            <td class="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{{ $report->created_at->format('Y/m/d H:i') }}</td>
                            <td class="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{{ $report->latest_activity_at->diffForHumans() }}</td>
                        </tr>
                    @empty
                        <tr><td colspan="5" class="px-6 py-14 text-center text-sm text-slate-500">目前沒有問題，請在下方登記第一筆。</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>

        <div class="divide-y divide-slate-100 md:hidden">
            @forelse ($reports as $report)
                <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="block p-4 transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                    <div class="flex items-start justify-between gap-3">
                        <p class="font-semibold text-slate-950">{{ $report->title }}</p>
                        <x-feedback.status-badge :status="$report->status" />
                    </div>
                    <p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{{ $report->description }}</p>
                    <p class="mt-3 text-xs text-slate-500">#{{ substr($report->public_id, 0, 8) }}・更新於 {{ $report->latest_activity_at->diffForHumans() }}</p>
                </a>
            @empty
                <p class="px-5 py-12 text-center text-sm text-slate-500">目前沒有問題，請在下方登記第一筆。</p>
            @endforelse
        </div>
    </section>

    <div class="mt-5">{{ $reports->links() }}</div>

    <section id="new-issues" class="mt-10 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" data-issue-entry>
        <div class="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h2 class="text-xl font-bold text-slate-950">登記問題</h2>
                <p class="mt-1 text-sm text-slate-600">可以一次加入多個問題；每一列會建立成獨立項目。</p>
            </div>
            <button type="button" class="inline-flex min-h-10 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-add-issue>＋ 再加一個問題</button>
        </div>

        @if ($errors->any())
            <div role="alert" class="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p class="font-semibold">請修正以下內容：</p>
                <ul class="mt-2 list-disc space-y-1 pl-5">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
            </div>
        @endif

        <form method="POST" action="{{ route('feedback.reports.store', $project) }}" enctype="multipart/form-data" class="mt-6 grid min-w-0 gap-5" data-issue-form>
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

            <div class="flex justify-end border-t border-slate-100 pt-5">
                <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出全部問題</button>
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
    </section>
</x-feedback.layout>
