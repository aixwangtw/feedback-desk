{{--
    待審留言（草稿）的顯示與操作，單頁、清單／看板的詳情視窗、右下角對話面板三處共用這一份（伺服器端渲染）；
    後兩者經對話端點的 drafts_html 取得，按鈕行為由 resources/js/message-drafts.js 處理，送出一律走 feedback.drafts.send。
    只有開發團隊拿得到；客戶端不會載入這個區塊。按「送出」才變成正式留言。
    $anchor：只有單頁放 id="message-drafts"（通知與清單的連結要跳到這裡），視窗與面板重複出現，不放 id。
--}}
@php $anchor = $anchor ?? false; @endphp
<div @if ($anchor) id="message-drafts" @endif class="border-t border-amber-200 bg-amber-50/70 px-5 py-4 sm:px-7" data-message-drafts>
    <h3 class="text-sm font-bold text-amber-900">待審留言 {{ $drafts->count() }}<span class="ml-2 text-xs font-normal text-amber-800">只有{{ $project->ownerRole() }}看得到，按「送出」才會發給{{ $project->clientRole() }}</span></h3>
    <ol class="mt-3 grid gap-3">
        @foreach ($drafts as $draft)
            @php $draftErrors = $errors->getBag('draft'.$draft->id); @endphp
            <li class="rounded-xl border border-dashed border-amber-400 bg-white p-3.5 shadow-sm" data-message-draft="{{ $draft->id }}" data-draft-send-url="{{ route('feedback.drafts.send', [$project, $report, $draft]) }}">
                <div class="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                    <span class="font-semibold text-amber-900">{{ $draft->displayAuthor() }}</span>
                    <x-feedback.time :at="$draft->updated_at" relative />
                    @if ($draft->replaces_message_id !== null)
                        <span class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900" data-draft-replaces="{{ $draft->replaces_message_id }}">修改原留言</span>
                    @endif
                </div>
                @if ($draft->replacesMessage !== null)
                    <details class="mt-2 text-xs text-slate-600">
                        <summary class="cursor-pointer">原留言內容</summary>
                        <p class="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 leading-5">{{ $draft->replacesMessage->body }}</p>
                    </details>
                @endif
                <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-draft-body>{{ $draft->body }}</p>
                @if ($draft->attachmentList() !== [])
                    <div class="mt-2 flex flex-wrap gap-2">
                        @foreach ($draft->attachmentList() as $index => $file)
                            @if (\App\Support\FeedbackAttachmentRules::isVideoMime($file['mime_type']))
                                <div class="min-w-0 w-full max-w-md">
                                    <video controls playsinline preload="metadata" src="{{ route('feedback.drafts.file', [$project, $report, $draft, $index]) }}" class="max-h-60 w-full rounded-lg border border-slate-200 bg-black" title="{{ $file['original_name'] }}"></video>
                                    <x-feedback.attachment-caption :name="$file['original_name']" class="mt-0.5" />
                                </div>
                                @continue
                            @endif
                            <div class="attachment-tile min-w-0">
                            <a href="{{ route('feedback.drafts.file', [$project, $report, $draft, $index]) }}" target="_blank" rel="noreferrer" class="attachment-tile-thumb block overflow-hidden rounded-lg border border-slate-200 bg-white" data-lightbox-trigger data-lightbox-alt="{{ $file['original_name'] }}">
                                <img src="{{ route('feedback.drafts.file', [$project, $report, $draft, $index]) }}" alt="{{ $file['original_name'] }}" class="size-full object-cover" loading="lazy">
                            </a>
                            <x-feedback.attachment-caption :name="$file['original_name']" class="mt-0.5" />
                            </div>
                        @endforeach
                    </div>
                @endif
                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <form method="POST" action="{{ route('feedback.drafts.send', [$project, $report, $draft]) }}" data-draft-form="send">
                        @csrf
                        <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-draft-send>送出</button>
                    </form>
                    <form method="POST" action="{{ route('feedback.drafts.destroy', [$project, $report, $draft]) }}" {{ app(\App\Support\FeedbackConfirmText::class)->attributes(app(\App\Support\FeedbackConfirmText::class)->discardDraft()) }} data-draft-form="discard">
                        @csrf
                        @method('DELETE')
                        <button type="submit" class="inline-flex min-h-9 items-center rounded-lg border border-rose-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-draft-discard>捨棄</button>
                    </form>
                    <p class="w-full rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-draft-error hidden></p>
                    <details class="w-full" @if ($draftErrors->any()) open @endif data-draft-editor>
                        <summary class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">編輯</summary>
                        <form method="POST" action="{{ route('feedback.drafts.update', [$project, $report, $draft]) }}" class="mt-2 grid gap-2" data-draft-form="update">
                            @csrf
                            @method('PUT')
                            <textarea name="body" aria-label="待審留言內容" data-draft-edit-body required maxlength="{{ \App\Actions\PostFeedbackMessageAction::MAX_BODY_LENGTH }}" rows="5" class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ $draftErrors->any() ? old('body') : $draft->body }}</textarea>
                            @if ($draftErrors->any())<p class="text-xs text-rose-700">{{ $draftErrors->first('body') }}</p>@endif
                            <div class="flex flex-wrap gap-2">
                                <button type="submit" class="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">儲存草稿（不送出）</button>
                                <button type="button" class="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-teal-800" data-draft-save-send>照這樣直接送出</button>
                            </div>
                        </form>
                    </details>
                </div>
            </li>
        @endforeach
    </ol>
</div>
