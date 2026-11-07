{{--
    「完成」鈕（清單、看板卡片、詳情右側窄欄共用這一個元件）：
    客戶端按了直接把單改成已完成（不跳確認，使用者原話「通過、完成不跳」）；開發團隊端按了跳出可改字的確認留言視窗（_completion-dialog），
    送出後單維持等客戶、留言附「通過」按鈕，不會直接結案。已完成的單不顯示。
--}}
@props(['project', 'report', 'isOwner', 'compact' => false])

@php
    $completeClass = \Illuminate\Support\Arr::toCssClasses([
        'inline-flex items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
        'min-h-8 px-3 text-xs' => ! $compact,
        'h-8 px-2 text-[11px]' => $compact,
        $attributes->get('class') => $attributes->has('class'),
    ]);
@endphp
@if ($report->status !== \App\Enums\FeedbackReportStatus::Completed)
    @if ($isOwner)
        <button type="button" class="{{ $completeClass }}" data-dialog-open="request-completion-{{ $report->public_id }}" data-request-completion="{{ $report->public_id }}" {{ $attributes->only('data-card-action') }} title="發一則確認留言，請{{ config('feedback.labels.client') }}確認；不會直接結案">完成</button>
    @else
        <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" {{ $attributes->only('data-card-action') }}>
            @csrf
            @method('PATCH')
            <input type="hidden" name="status" value="{{ \App\Enums\FeedbackReportStatus::Completed->value }}">
            <button type="submit" class="{{ $completeClass }}" data-complete-report="{{ $report->public_id }}" title="確認沒問題，改成已完成">完成</button>
        </form>
    @endif
@endif
