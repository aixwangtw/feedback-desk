{{--
    Jira 式右側窄欄：狀態、建立者、時間、「完成」鈕（詳情視窗與單頁共用，詳情視窗也靠對話端點的 side_html 隨狀態更新）。
    完成鈕：客戶端按了直接把單改成已完成；開發團隊端按了只會跳出確認留言（見 _completion-dialog），單維持等客戶，不會直接結案。
    $context：dialog（詳情視窗，另有編輯、刪除、完整頁、對話面板）或 page（單頁，只有狀態與完成）。
--}}
@php
    $context ??= 'dialog';
    $isCompleted = $report->status === \App\Enums\FeedbackReportStatus::Completed;
    $canManage = $canManage ?? true;
@endphp
<div class="grid gap-4" data-detail-side>
    <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">狀態</p>
        <div class="mt-1.5"><x-feedback.status-badge :status="$report->status" data-report-status-badge="{{ $report->public_id }}" /></div>
    </div>
    @if ($canManage && ! $isCompleted)
        <div data-detail-complete>
            @if ($isOwner)
                <button type="button" class="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" data-dialog-open="request-completion-{{ $report->public_id }}" data-request-completion="{{ $report->public_id }}" title="發一則確認留言，請{{ config('feedback.labels.client') }}確認；不會直接結案">完成</button>
                <p class="mt-1 text-[11px] leading-4 text-slate-500">會發確認留言請{{ config('feedback.labels.client') }}按「{{ \App\Support\FeedbackCompletionRequest::APPROVE_LABEL }}」，不會直接結案。</p>
            @else
                <x-feedback.complete-button :$project :$report :is-owner="$isOwner" class="w-full" />
            @endif
        </div>
    @endif
    <dl class="grid gap-3 text-xs">
        @unless ($report->isPublicReport() && ! $isOwner)
            <div><dt class="text-slate-500">建立者</dt><dd class="mt-0.5 font-medium text-slate-800" data-report-creator>{{ $report->creatorLabel() }}</dd></div>
        @endunless
        <div><dt class="text-slate-500">建立時間</dt><dd class="mt-0.5 font-medium text-slate-800"><x-feedback.time :at="$report->created_at" /></dd></div>
        <div><dt class="text-slate-500">最後更新</dt><dd class="mt-0.5 font-medium text-slate-800"><x-feedback.time :at="$report->latest_activity_at" relative /></dd></div>
        @if ($isOwner && $report->isDeletedByClient())
            <div data-client-deleted><dt class="text-slate-500">{{ config('feedback.labels.client') }}已刪除</dt><dd class="mt-0.5 font-medium text-slate-800"><x-feedback.time :at="$report->client_deleted_at" /></dd></div>
        @endif
    </dl>
    @if ($context === 'dialog')
        <div class="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-open="edit-report-{{ $report->public_id }}">編輯</button>
            @if ($isOwner && $report->isDeletedByClient())
                <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                    @csrf
                    @method('PATCH')
                    <button type="submit" class="inline-flex min-h-8 items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                </form>
            @endif
            @if ($isOwner)
                <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="delete-report-{{ $report->public_id }}" data-delete-report>刪除</button>
            @else
                <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-dialog-open="client-delete-report-{{ $report->public_id }}" data-client-delete-report>刪除</button>
            @endif
            <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">完整頁</a>
            <button type="button" class="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-chat-open="{{ $report->public_id }}">在對話面板開啟</button>
        </div>
    @endif
</div>
