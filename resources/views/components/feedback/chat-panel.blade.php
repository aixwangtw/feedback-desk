{{-- 右下角留言對話面板：清單與對話內容都由 JS 向登入後才能用的端點取回；文字一律用 textContent 或伺服器已跳脫的 HTML 放入。 --}}
@props(['project'])

<div data-chat-root
     data-list-url="{{ route('feedback.conversations.index', $project) }}"
     data-thread-url-template="{{ route('feedback.conversations.show', [$project, '__REPORT__']) }}"
     data-viewer="{{ app(\App\Support\FeedbackAccess::class)->isOwner($project) ? 'owner' : 'client' }}">
    <button type="button" class="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-teal-700 text-white shadow-lg shadow-teal-900/20 transition hover:bg-teal-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/40 sm:bottom-6 sm:right-6" aria-controls="chat-panel" aria-expanded="false" data-chat-launcher>
        <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
            <path d="M8.5 10.5h7M8.5 13.5h4.5" />
        </svg>
        <span class="sr-only">開啟留言對話</span>
        <span class="absolute -right-1 -top-1 min-w-6 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-xs font-bold leading-4 text-white ring-2 ring-white" data-chat-launcher-badge hidden></span>
    </button>

    <section id="chat-panel" class="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(42rem,calc(100dvh-8rem))] sm:w-[min(56rem,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl" role="dialog" aria-modal="false" aria-labelledby="chat-panel-title" data-chat-panel data-view="list" hidden>
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-teal-700 px-4 py-3 text-white">
            <h2 id="chat-panel-title" class="text-sm font-bold">留言對話</h2>
            <button type="button" class="grid size-9 place-items-center rounded-lg text-xl transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="關閉留言對話" data-chat-close>×</button>
        </header>

        <div class="flex min-h-0 flex-1">
            {{-- 對話清單 --}}
            <div class="flex min-h-0 w-full flex-col border-slate-200 sm:w-72 sm:shrink-0 sm:border-r" data-chat-list-pane>
                <div class="flex shrink-0 border-b border-slate-200" role="tablist" aria-label="依回覆狀態分頁" data-chat-tabs>
                    <button type="button" role="tab" aria-selected="true" class="flex-1 border-b-2 border-teal-700 px-3 py-2.5 text-sm font-bold text-teal-800" data-chat-tab="awaiting" title="對方最後發言、你還沒回">未回覆 <span data-chat-tab-count>0</span></button>
                    <button type="button" role="tab" aria-selected="false" class="flex-1 border-b-2 border-transparent px-3 py-2.5 text-sm font-bold text-slate-500" data-chat-tab="replied" title="你最後發言，等對方回覆">已回覆 <span data-chat-tab-count>0</span></button>
                </div>
                <div class="shrink-0 border-b border-slate-100 p-3">
                    <label for="chat-search" class="sr-only">搜尋標題</label>
                    <input id="chat-search" type="search" placeholder="搜尋標題或編號" autocomplete="off" class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-chat-search>
                </div>
                <ul class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="回饋單對話清單" data-chat-list></ul>
                <p class="p-6 text-center text-sm text-slate-500" data-chat-list-status>載入中…</p>
            </div>

            {{-- 單一張單的對話 --}}
            <div class="flex min-h-0 min-w-0 flex-1 flex-col max-sm:hidden" data-chat-thread-pane>
                <div class="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500" data-chat-placeholder>載入中…</div>

                <div class="flex min-h-0 flex-1 flex-col" data-chat-thread-view hidden>
                    <div class="flex shrink-0 items-start gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4">
                        <button type="button" class="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:hidden" data-chat-back>‹ 返回清單</button>
                        <div class="min-w-0 flex-1">
                            <p class="text-xs font-semibold text-slate-500"><span data-chat-thread-number></span> · <span data-chat-thread-status></span><span class="ml-1 rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-600" data-chat-thread-deleted hidden>{{ $project->clientRole() }}已刪除</span></p>
                            <h3 class="truncate text-sm font-bold text-slate-950" data-chat-thread-title></h3>
                        </div>
                        {{-- 相簿鈕（照 LINE、Messenger 的「相片與影片」）：固定在標題列（捲動對話不會消失），徽章顯示附件數，有新附件時變色提示；點了切到面板內的附件頁，可返回對話並回到原本的捲動位置；附件不放在對話串裡。 --}}
                        <button type="button" class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label="相簿" data-chat-album-open>
                            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-8 8" /></svg>
                            相簿 <span class="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600" data-chat-album-count>0</span><span class="album-new-hint hidden text-[11px] font-bold text-teal-800" data-chat-album-new-hint>有新附件</span>
                        </button>
                        <a href="#" class="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-page-link>開啟完整頁</a>
                    </div>

                    {{-- 附件頁：相簿鈕切過來，與對話二選一顯示，可返回對話；永遠全部顯示（data-album-force-all）。 --}}
                    <div class="flex min-h-0 flex-1 flex-col bg-white" data-chat-album-pane data-album-force-all hidden>
                        <div class="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 sm:px-4">
                            <button type="button" class="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-album-back>‹ 返回對話</button>
                            <p class="text-sm font-bold text-slate-900">相片與影片</p>
                        </div>
                        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" data-chat-album-body></div>
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-4 sm:px-4" data-chat-scroll>
                        <div aria-live="polite" data-chat-thread></div>
                        @if (app(\App\Support\FeedbackAccess::class)->isOwner($project))
                            {{-- 待審留言（只有開發團隊）：與單頁、詳情視窗同一份畫面（feedback.reports._drafts），顯示在留言串最下面。 --}}
                            <div class="mt-4 overflow-hidden rounded-xl empty:hidden" data-chat-drafts></div>
                        @endif
                    </div>

                    <form class="shrink-0 border-t border-slate-200 bg-white p-3" enctype="multipart/form-data" data-chat-form novalidate>
                        @csrf
                        <p class="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-chat-error data-attachment-error hidden></p>
                        <div id="chat-preview" class="mb-2 flex flex-wrap items-start gap-2 empty:hidden" aria-live="polite"></div>
                        <label for="chat-body" class="sr-only">回覆內容</label>
                        <textarea id="chat-body" name="body" rows="2" maxlength="10000" placeholder="輸入回覆…（Ctrl＋Enter 送出）" class="block max-h-40 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-chat-body-input></textarea>
                        <div class="mt-2 flex items-center justify-between gap-2">
                            <label for="chat-screenshots" class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                {{ \App\Support\FeedbackAttachmentRules::MESSAGE_BUTTON }}
                                <input id="chat-screenshots" name="screenshots[]" type="file" accept="{{ \App\Support\FeedbackAttachmentRules::MESSAGE_ACCEPT }}" multiple class="sr-only" data-image-input data-attachment-rules="{{ \App\Support\FeedbackAttachmentRules::browserRulesJson() }}" data-preview-target="chat-preview" data-chat-files>
                            </label>
                            <span class="min-w-0 flex-1 truncate text-[11px] text-slate-500">{{ \App\Support\FeedbackAttachmentRules::messageHint() }}</span>
                            <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-60" data-chat-send>送出</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </section>
</div>
