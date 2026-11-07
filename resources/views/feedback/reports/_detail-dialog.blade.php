{{--
    清單／看板點開的單張詳情（Jira 版面）：電腦版從右側滑出、手機版整頁。
    左側：標題、說明、附件（相簿，Jira 式縮圖格狀）、過去的處理說明（舊調整重點，唯讀，有內容才顯示）、活動時間軸（留言與狀態變更）、待審留言（只有團隊）、輸入框（可拖曳附件）。
    右側窄欄：狀態、建立者、時間、「完成」鈕（_detail-side，隨對話端點的 side_html 更新）。
    留言、草稿、相簿與單頁、右下角面板是同一套元件：載入由 report-dialog-thread.js 向對話端點取回。
--}}
@php
    $reportId = $report->public_id;
@endphp
<dialog id="detail-report-{{ $reportId }}" class="detail-panel m-0 ml-auto h-dvh max-h-none w-full max-w-none bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/50 sm:w-[min(68rem,calc(100vw-1.5rem))] sm:rounded-l-2xl" aria-labelledby="detail-report-title-{{ $reportId }}" data-report-detail>
    <div class="flex h-dvh min-w-0 flex-col">
        <header class="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <p class="min-w-0 flex-1 truncate text-xs font-bold text-slate-500">編號 {{ $sequenceNumbers[$report->id] }}</p>
            <button type="button" class="grid size-9 shrink-0 place-items-center rounded-lg text-xl text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close aria-label="關閉">×</button>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-x-8 gap-y-5 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_16rem]" data-detail-scroll>
            <div class="min-w-0 lg:col-start-1 lg:row-start-1">
                <h2 id="detail-report-title-{{ $reportId }}" class="break-words text-xl font-bold leading-snug text-slate-950">{{ $report->title }}</h2>
                <x-feedback.category-select :$project :$report :categories="$reportCategories" class="mt-2" />
            </div>

            <aside class="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" aria-label="單的資訊" data-detail-side-box>
                @include('feedback.reports._detail-side', ['project' => $project, 'report' => $report, 'isOwner' => $isOwner, 'context' => 'dialog'])
            </aside>

            <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 lg:col-start-1 lg:row-start-2">
                <div data-report-description>{{ \App\Support\FeedbackRichText::render($report->description, compact: true) }}</div>
                {{-- 附件（相簿）：說明下方、活動時間軸上方，隨對話端點的 album_html 載入（report-dialog-thread.js）。 --}}
                <div class="album-region" data-dialog-album></div>
                @if ($report->hasAdjustment())
                    <details class="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm" data-past-notes data-keep-open="past-notes-{{ $reportId }}">
                        <summary class="cursor-pointer font-semibold text-slate-700">過去的處理說明</summary>
                        <div class="mt-2">
                            @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report, 'compact' => true, 'showHeading' => false])
                        </div>
                    </details>
                @endif

                <section class="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-slate-100 pt-4" aria-label="{{ config('feedback.labels.thread') }}" data-dialog-thread data-thread-url="{{ route('feedback.conversations.show', [$project, $report]) }}" data-report-id="{{ $reportId }}">
                    <h3 class="text-sm font-bold text-slate-900">{{ config('feedback.labels.thread') }}</h3>
                    <div aria-live="polite" data-dialog-thread-body><p class="py-4 text-center text-sm text-slate-500">留言載入中…</p></div>
                    @if ($isOwner)
                        <div class="overflow-hidden rounded-xl empty:hidden" data-dialog-thread-drafts></div>
                    @endif
                    <form action="{{ route('feedback.messages.store', [$project, $report]) }}" method="POST" enctype="multipart/form-data" class="grid gap-2" data-dialog-thread-form novalidate>
                        @csrf
                        <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-dialog-thread-error data-attachment-error hidden></p>
                        <div id="dialog-preview-{{ $reportId }}" class="flex flex-wrap items-start gap-2 empty:hidden" aria-live="polite"></div>
                        <label for="dialog-body-{{ $reportId }}" class="sr-only">留言內容</label>
                        <textarea id="dialog-body-{{ $reportId }}" name="body" rows="3" maxlength="10000" placeholder="輸入留言…（Ctrl＋Enter 送出，可直接把圖片或影片拖進來）" class="block max-h-60 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-dialog-thread-input></textarea>
                        <div class="flex items-center justify-between gap-2">
                            <label for="dialog-screenshots-{{ $reportId }}" class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                {{ \App\Support\FeedbackAttachmentRules::MESSAGE_BUTTON }}
                                <input id="dialog-screenshots-{{ $reportId }}" name="screenshots[]" type="file" accept="{{ \App\Support\FeedbackAttachmentRules::MESSAGE_ACCEPT }}" multiple class="sr-only" data-image-input data-attachment-rules="{{ \App\Support\FeedbackAttachmentRules::browserRulesJson() }}" data-preview-target="dialog-preview-{{ $reportId }}">
                            </label>
                            <span class="min-w-0 flex-1 truncate text-[11px] text-slate-500">{{ \App\Support\FeedbackAttachmentRules::messageHint() }}</span>
                            <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60" data-dialog-thread-send>送出留言</button>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    </div>
</dialog>
