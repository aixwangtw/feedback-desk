{{--
    編輯留言的表單（藏在留言泡泡裡，按選單的「編輯」才出現）：改內文、勾選要移除的附件、拖曳或選檔新增附件（沿用 attachment-composer）。
    儲存後不顯示「已編輯」。單頁、詳情視窗、右下角面板共用；預覽區的 id 由 message-edit.js 開啟時才產生，避免同一則留言出現在多處時重複。
--}}
@props(['project', 'report', 'message'])

<form method="POST" action="{{ route('feedback.messages.update', [$project, $report, $message]) }}" enctype="multipart/form-data" class="grid min-w-[min(18rem,70vw)] gap-2" data-message-edit-form hidden novalidate>
    @csrf
    @method('PUT')
    <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-message-edit-error data-attachment-error hidden></p>
    <label class="sr-only">留言內容<textarea name="body" rows="3" maxlength="10000" required class="mt-1 block max-h-60 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-message-edit-body>{{ $message->body }}</textarea></label>
    @if ($message->feedbackAttachments->isNotEmpty())
        <div class="flex flex-wrap gap-2" data-message-edit-existing>
            @foreach ($message->feedbackAttachments as $attachment)
                <label class="attachment-tile flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1 has-[:checked]:opacity-50 has-[:checked]:ring-2 has-[:checked]:ring-rose-400">
                    <span class="attachment-tile-thumb block overflow-hidden rounded bg-slate-50">
                        <x-feedback.attachment-media :$attachment :src="route('feedback.attachments.show', [$project, $report, $attachment])" class="size-full object-cover" />
                    </span>
                    <x-feedback.attachment-caption :name="$attachment->original_name" />
                    <span class="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700"><input type="checkbox" name="remove_attachments[]" value="{{ $attachment->id }}" class="rounded border-slate-300 text-rose-600 focus:ring-rose-600">移除</span>
                </label>
            @endforeach
        </div>
    @endif
    <div class="flex flex-wrap items-start gap-2 empty:hidden" aria-live="polite" data-message-edit-preview></div>
    <div class="flex flex-wrap items-center justify-between gap-2">
        <label class="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
            {{ \App\Support\FeedbackAttachmentRules::MESSAGE_BUTTON }}
            <input name="screenshots[]" type="file" accept="{{ \App\Support\FeedbackAttachmentRules::MESSAGE_ACCEPT }}" multiple class="sr-only" data-message-edit-files data-attachment-rules="{{ \App\Support\FeedbackAttachmentRules::browserRulesJson() }}">
        </label>
        <div class="flex gap-2">
            <button type="button" class="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-message-edit-cancel>取消</button>
            <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60" data-message-edit-save>儲存</button>
        </div>
    </div>
</form>
