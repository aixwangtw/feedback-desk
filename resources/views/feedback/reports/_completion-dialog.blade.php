{{--
    開發團隊按「完成」後的確認視窗：可改字的確認留言（預設文字見 FeedbackCompletionRequest::defaultBody）。
    送出只會發一則附「通過」按鈕的留言，單維持等客戶，不會結案。清單詳情與單頁共用。
--}}
<dialog id="request-completion-{{ $report->public_id }}" class="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="request-completion-title-{{ $report->public_id }}" data-request-completion-dialog>
    <form method="POST" action="{{ route('feedback.reports.completion-request', [$project, $report]) }}" class="grid gap-4 p-5 sm:p-6" data-request-completion-form>
        @csrf
        <h2 id="request-completion-title-{{ $report->public_id }}" class="text-lg font-bold text-slate-950">請{{ config('feedback.labels.client') }}確認完成</h2>
        <p class="text-sm leading-6 text-slate-600">會發出下面這則留言，留言上有「{{ \App\Support\FeedbackCompletionRequest::APPROVE_LABEL }}」按鈕。這張單維持「{{ \App\Enums\FeedbackReportStatus::NeedsInput->label() }}」，要{{ config('feedback.labels.client') }}按「{{ \App\Support\FeedbackCompletionRequest::APPROVE_LABEL }}」才會變成已完成。可以先改字。</p>
        <label for="request-completion-body-{{ $report->public_id }}" class="sr-only">確認留言內容</label>
        <textarea id="request-completion-body-{{ $report->public_id }}" name="body" rows="4" required maxlength="{{ \App\Actions\PostFeedbackMessageAction::MAX_BODY_LENGTH }}" class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" data-request-completion-body>{{ \App\Support\FeedbackCompletionRequest::defaultBody() }}</textarea>
        <p class="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800" role="alert" data-request-completion-error hidden></p>
        <div class="flex justify-end gap-3">
            <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close>取消</button>
            <button type="submit" class="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60" data-request-completion-send>送出確認留言</button>
        </div>
    </form>
</dialog>
