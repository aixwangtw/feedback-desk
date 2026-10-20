<x-feedback.layout :title="'專案總覽｜'.config('feedback.portal_title')" maxWidth="max-w-6xl">
    <div class="space-y-8">
        <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <span class="inline-flex items-center rounded-md bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">管理中心</span>
                    <h1 class="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">專案總覽</h1>
                    <p class="mt-1 text-sm text-slate-600">
                        目前登入：<span class="font-semibold text-slate-900">{{ $developer?->name ?? config('feedback.labels.owner') }}</span>。已開啟跨專案管理權限，您可在各專案間直接切換而無須重複登入。
                    </p>
                </div>
            </div>

            <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                    <p class="text-xs font-medium text-slate-500">專案總數</p>
                    <p class="mt-1 text-2xl font-bold text-slate-900">{{ $projects->count() }}</p>
                </div>
                <div class="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
                    <p class="text-xs font-medium text-amber-700">未讀回報 / 待追蹤</p>
                    <p class="mt-1 text-2xl font-bold text-amber-900">{{ $projects->sum('unread_reports_count') }}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                    <p class="text-xs font-medium text-slate-500">全部回報單</p>
                    <p class="mt-1 text-2xl font-bold text-slate-900">{{ $projects->sum('total_reports_count') }}</p>
                </div>
            </div>
        </section>

        <section>
            <div class="mb-4 flex items-center justify-between">
                <h2 class="text-lg font-bold text-slate-900">專案列表</h2>
                <span class="text-xs text-slate-500">共 {{ $projects->count() }} 個專案</span>
            </div>

            @if ($projects->isEmpty())
                <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <p class="text-sm text-slate-500">目前尚無建立任何專案。</p>
                </div>
            @else
                <div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                    @foreach ($projects as $project)
                        <div class="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow">
                            <div>
                                <div class="flex items-start justify-between gap-3">
                                    <h3 class="text-base font-bold text-slate-950">
                                        <a href="{{ route('feedback.portal', $project, false) }}" class="transition hover:text-teal-700">
                                            {{ $project->name }}
                                        </a>
                                    </h3>
                                    @if ($project->unread_reports_count > 0)
                                        <span class="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
                                            {{ $project->unread_reports_count }} 未讀
                                        </span>
                                    @endif
                                </div>
                                <p class="mt-1 text-xs text-slate-500">
                                    {{ $project->clientLabel() }}・代碼：<code class="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">{{ $project->slug }}</code>
                                </p>

                                <div class="mt-4 flex items-center gap-4 text-xs text-slate-600">
                                    <div>總計 <span class="font-semibold text-slate-900">{{ $project->total_reports_count }}</span> 筆回報</div>
                                    @if ($project->public_reporting_enabled)
                                        <span class="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">公開回報中</span>
                                    @endif
                                </div>
                            </div>

                            <div class="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                                <a href="{{ route('feedback.portal', $project, false) }}" class="inline-flex w-full items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
                                    進入專案
                                </a>
                            </div>
                        </div>
                    @endforeach
                </div>
            @endif
        </section>
    </div>
</x-feedback.layout>
