{{--
    狀態切換鈕（清單操作欄、看板卡片、詳情右側欄、留言區最下面共用）：只有一顆，按一下就切換
    （2026-11-19 使用者：「操作欄位 完成 待處理 … 不用並列3個」「按一下切換 不是2顆」）。
    還沒完成的單顯示「完成」，按了改成已完成；已完成的單顯示「待處理」，按了改回待處理。
    老師、業主與開發團隊都能按；「待回覆」不放按鈕，由回覆時自動切換（PostFeedbackMessageAction）。
--}}
@use('App\Enums\FeedbackReportStatus')
@use('App\Support\FeedbackWaitingOn')
@props(['project', 'report', 'compact' => false])

@php
    $isCompleted = $report->status === FeedbackReportStatus::Completed;
    $target = $isCompleted ? FeedbackReportStatus::New : FeedbackReportStatus::Completed;
    $label = $isCompleted ? FeedbackWaitingOn::tabLabel(FeedbackWaitingOn::DEVELOPER) : '完成';
    $hint = $isCompleted
        ? '改回「'.$label.'」（'.FeedbackReportStatus::New->label($project).'）'
        : '改成「'.FeedbackReportStatus::Completed->label($project).'」';
@endphp

<form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" {{ $attributes->merge(['class' => 'inline-flex']) }} data-status-switch="{{ $report->public_id }}">
    @csrf
    @method('PATCH')
    <button type="submit" name="status" value="{{ $target->value }}"
        @class([
            'inline-flex items-center justify-center rounded-lg border font-semibold transition focus:outline-none focus-visible:ring-2',
            'min-h-8 px-3 text-xs' => ! $compact,
            'h-7 px-2 text-[11px]' => $compact,
            'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:ring-emerald-600' => ! $isCompleted,
            'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-visible:ring-teal-600' => $isCompleted,
        ])
        title="{{ $hint }}"
        data-status-option="{{ $target->value }}"
        @if ($attributes->has('data-card-action')) data-card-action @endif>{{ $label }}</button>
</form>
