{{-- 客戶端的「完成」：按下先確認再把單改成已完成；開發團隊端不顯示這個鈕（團隊的完成是請客戶確認，見 _detail-side）。 --}}
@props(['project', 'report', 'isOwner', 'compact' => false])

@if (! $isOwner && $report->status !== \App\Enums\FeedbackReportStatus::Completed)
    <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" onsubmit="return confirm('確定「{{ addslashes($report->title) }}」已經沒問題，要改成已完成嗎？')" {{ $attributes->only('data-card-action') }}>
        @csrf
        @method('PATCH')
        <input type="hidden" name="status" value="{{ \App\Enums\FeedbackReportStatus::Completed->value }}">
        <button type="submit" @class([
            'inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
            'min-h-8 px-3 text-xs' => ! $compact,
            'h-8 px-2 text-[11px]' => $compact,
            $attributes->get('class') => $attributes->has('class'),
        ]) data-complete-report="{{ $report->public_id }}" title="確認沒問題，改成已完成">完成</button>
    </form>
@endif
