<x-feedback.layout :title="$report->title.'｜'.$project->name" :project="$isPublicReporter ? null : $project">
    <x-slot:headerAction>
        <a href="{{ $isPublicReporter ? route('feedback.home') : route('feedback.portal', $project) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">{{ $isPublicReporter ? '回首頁' : '返回問題清單' }}</a>
    </x-slot:headerAction>

    @if (session('private_report_url'))
        <section class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" data-private-url-notice>
            <h2 class="font-semibold">存下這個網址才能回來看</h2>
            <p class="mt-1 leading-6">這是這張單的私密網址，知道網址的人都能看到並留言。這個畫面只顯示這一次；同一個瀏覽器之後從首頁也找得到這張單。</p>
            <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <input readonly value="{{ session('private_report_url') }}" onfocus="this.select()" aria-label="私密網址" class="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" data-copy-source data-private-url>
                <button type="button" class="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600" data-copy-button>複製網址</button>
            </div>
        </section>
    @endif

    @php $canPostMessage = ! ($isPublicReporter && ! $project->public_reporting_enabled); @endphp

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="grid gap-6">
            <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h1 class="text-2xl font-bold tracking-tight text-slate-950">@if ($sequenceNumber !== null)<span class="mr-1 text-slate-400">編號 <span data-report-number>{{ $sequenceNumber }}</span>｜</span>@endif{{ $report->title }}</h1>
                        @if ($canManage)
                            <x-feedback.category-select :$project :$report :categories="$project->reportCategories()" class="mt-2" data-suffix="-page" />
                        @elseif (filled($report->category))
                            <p class="mt-1 text-xs text-slate-500" data-report-category>分類：<span class="font-semibold text-teal-700">{{ $report->category }}</span></p>
                        @endif
                        @if ($isOwner && $report->isDeletedByClient())
                            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500" data-client-deleted>
                                <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">{{ config('feedback.labels.client') }}已刪除</span>
                                <x-feedback.time :at="$report->client_deleted_at" />
                                <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                                    @csrf
                                    @method('PATCH')
                                    <button type="submit" class="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                                </form>
                            </div>
                        @endif
                    </div>
                    <x-feedback.status-badge :status="$report->status" />
                </div>

                <div class="mt-5" data-report-description>{{ \App\Support\FeedbackRichText::render($report->description) }}</div>
            </section>

            {{-- 附件（相簿）：說明下方、活動時間軸上方；沒有附件時整塊不顯示（album-region 沒有內容就隱藏），有新附件由 album.js 定時換新。 --}}
            <div class="album-region rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" data-album-region data-refresh-url="{{ route('feedback.reports.activity', [$project, $report, 'part' => 'album']) }}">@include('feedback.reports._album', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $isOwner])</div>

            @if ($report->hasAdjustment())
                {{-- 調整重點已停用：舊內容只在這裡唯讀顯示（過去的處理說明），沒有內容就不顯示，網頁上不能編輯。 --}}
                <section id="adjustment" class="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 shadow-sm sm:p-7" data-past-notes>
                    @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report])
                </section>
            @endif

            @unless ($isPublicReporter || $canManage)
                <p class="-mt-3 px-1 text-xs text-slate-500" data-report-creator>建立者：{{ $report->creatorLabel() }}</p>
            @endunless

            <section id="conversation" class="rounded-2xl border border-slate-200 bg-white shadow-sm" data-conversation>
                <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
                    <div class="min-w-0">
                        @if ($isOwner || ! $canPostMessage)
                            <h2 class="text-base font-semibold text-slate-950">{{ config('feedback.labels.thread') }}</h2>
                        @else
                            <h2 class="text-lg font-bold text-slate-950">留言給{{ config('feedback.labels.owner') }}</h2>
                            <p class="mt-1 text-sm leading-6 text-slate-600" data-message-hint>有問題或補充可以直接在這裡留言，我們會看到並回覆</p>
                        @endif
                    </div>
                    <div class="flex items-center gap-2">
                        @if ($canManage)
                            <button type="button" class="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-open="{{ $report->public_id }}">在對話面板開啟</button>
                        @endif
                        <x-feedback.status-badge :status="$report->status" />
                    </div>
                </div>

                <div class="bg-slate-50/60 px-4 py-5 sm:px-7" data-activity data-refresh-url="{{ route('feedback.reports.activity', [$project, $report]) }}">
                    @include('feedback.reports._thread', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $isOwner])
                </div>

                @if ($isOwner && $drafts->isNotEmpty())
                    @include('feedback.reports._drafts', ['project' => $project, 'report' => $report, 'drafts' => $drafts, 'anchor' => true])
                @endif

                @if (! $canPostMessage)
                    <p class="border-t border-slate-100 px-5 py-4 text-sm text-slate-600 sm:px-7" data-reporting-closed>已停止收件，這張單只能查看，不能再留言。</p>
                @else
                    <div id="message-form" class="border-t border-slate-100 px-5 py-4 sm:px-7" data-message-section>
                        <form method="POST" action="{{ route('feedback.messages.store', [$project, $report]) }}" enctype="multipart/form-data" class="grid gap-3">
                            @csrf
                            <div>
                                <label for="body" class="sr-only">訊息內容</label>
                                <textarea id="body" name="body" required maxlength="10000" rows="3" placeholder="補充操作步驟、回答{{ config('feedback.labels.owner') }}問題，或提供新的發現…" class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ old('body') }}</textarea>
                                @error('body')<p class="mt-2 text-xs text-rose-700">{{ $message }}</p>@enderror
                                @error('screenshots')<p class="mt-2 text-xs text-rose-700">{{ $message }}</p>@enderror
                                @error('screenshots.*')<p class="mt-2 text-xs text-rose-700">{{ $message }}</p>@enderror
                            </div>
                            <div id="message-preview" class="flex flex-wrap items-start gap-3 empty:hidden" aria-live="polite"></div>
                            <div class="flex flex-wrap items-center justify-between gap-3">
                                <div class="flex flex-wrap items-center gap-3">
                                    <label for="message-screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                        {{ $isPublicReporter ? '加入截圖' : \App\Support\FeedbackAttachmentRules::MESSAGE_BUTTON }}
                                        <input id="message-screenshots" name="screenshots[]" type="file" accept="{{ $isPublicReporter ? 'image/jpeg,image/png,image/webp' : \App\Support\FeedbackAttachmentRules::MESSAGE_ACCEPT }}" multiple class="sr-only" data-image-input data-attachment-rules="{{ \App\Support\FeedbackAttachmentRules::browserRulesJson($isPublicReporter) }}" data-preview-target="message-preview">
                                    </label>
                                    <span class="text-xs text-slate-500">{{ $isPublicReporter ? '截圖最多 '.\App\Support\PublicReporting::MAX_SCREENSHOTS.' 張，每張 5 MB。' : \App\Support\FeedbackAttachmentRules::messageHint().'。' }}</span>
                                </div>
                                <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出訊息</button>
                            </div>
                        </form>
                    </div>
                @endif
            </section>
        </div>

        <aside class="grid gap-4 lg:sticky lg:top-6">
            @if ($isOwner && $work !== null)
                @include('feedback.reports._work', ['project' => $project, 'report' => $report, 'work' => $work, 'canClaim' => $canClaim])
            @endif
            @if ($canManage)
                {{-- 狀態不用下拉切換：留言時自動切換；客戶確認沒問題按「完成」或留言上的「通過」，開發團隊按「完成」只會請客戶確認。 --}}
                <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-report-status-panel>
                    @include('feedback.reports._detail-side', ['project' => $project, 'report' => $report, 'isOwner' => $isOwner, 'context' => 'page'])
                </section>
            @else
                <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 class="text-sm font-semibold text-slate-950">回報資訊</h2>
                    <dl class="mt-4 grid gap-4 text-xs">
                        <div><dt class="text-slate-500">建立時間</dt><dd class="mt-1 font-medium text-slate-800"><x-feedback.time :at="$report->created_at" /></dd></div>
                        <div><dt class="text-slate-500">最後更新</dt><dd class="mt-1 font-medium text-slate-800"><x-feedback.time :at="$report->latest_activity_at" relative /></dd></div>
                    </dl>
                </section>
            @endif
        </aside>
    </div>

    @if ($isOwner)
        @include('feedback.reports._completion-dialog', ['project' => $project, 'report' => $report])
    @endif
</x-feedback.layout>
