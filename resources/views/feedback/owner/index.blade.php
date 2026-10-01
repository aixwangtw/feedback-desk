<x-feedback.layout :title="'回報管理｜'.$project->name" :$project>
    <x-slot:headerAction>
        <a href="{{ route('feedback.portal', $project) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">查看問題清單</a>
    </x-slot:headerAction>

    <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
            <p class="text-sm font-semibold text-teal-700">開發工作台</p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-950">所有開發回報</h1>
            <p class="mt-2 text-sm text-slate-600">最新互動排在最前面；點進回報即可回覆或標註完成。</p>
        </div>
        <form method="GET" class="flex items-center gap-2">
            <label for="status" class="text-sm font-medium text-slate-700">狀態</label>
            <select id="status" name="status" data-auto-submit class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10">
                <option value="">全部</option>
                @foreach ($statuses as $status)
                    <option value="{{ $status->value }}" @selected($selectedStatus === $status)>{{ $status->label() }}</option>
                @endforeach
            </select>
        </form>
    </div>

    <section class="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="divide-y divide-slate-100">
            @forelse ($reports as $report)
                <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="group grid gap-3 p-5 transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="truncate text-sm font-semibold text-slate-950 group-hover:text-teal-800">{{ $report->title }}</h2>
                            <x-feedback.status-badge :status="$report->status" />
                        </div>
                        <p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{{ $report->description }}</p>
                        <p class="mt-2 text-xs text-slate-500">更新於 {{ $report->latest_activity_at->diffForHumans() }}</p>
                    </div>
                    <span class="text-sm font-semibold text-teal-700">查看 →</span>
                </a>
            @empty
                <div class="px-6 py-16 text-center">
                    <p class="text-sm font-semibold text-slate-800">目前沒有符合條件的回報</p>
                    <p class="mt-1 text-xs text-slate-500">新的問題送出後會出現在這裡。</p>
                </div>
            @endforelse
        </div>
    </section>

    <div class="mt-6">{{ $reports->links() }}</div>
</x-feedback.layout>
