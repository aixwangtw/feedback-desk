{{--
    狀態切換鈕（清單操作欄、看板卡片、詳情右側欄、留言區最下面共用）：待處理／待回覆／已完成三顆，
    老師、業主與開發團隊都能隨時按（2026-11-19 使用者：「3個頁籤 雙方都可透過操作欄位 已經留言內隨時切換 程式也會自動切」）。
    目前的狀態那顆反白、不能按；按其他顆直接送出，送出後回到原頁。留言時的自動切換照舊（PostFeedbackMessageAction）。
--}}
@use('App\Enums\FeedbackReportStatus')
@use('App\Support\FeedbackWaitingOn')
@props(['project', 'report', 'compact' => false])

@php
    $options = [
        FeedbackReportStatus::New->value => [FeedbackWaitingOn::tabLabel(FeedbackWaitingOn::DEVELOPER), FeedbackReportStatus::New->label($project)],
        FeedbackReportStatus::NeedsInput->value => [FeedbackWaitingOn::tabLabel(FeedbackWaitingOn::CLIENT), FeedbackReportStatus::NeedsInput->label($project)],
        FeedbackReportStatus::Completed->value => [FeedbackWaitingOn::tabLabel(FeedbackWaitingOn::COMPLETED), FeedbackReportStatus::Completed->label($project)],
    ];
    $activeClass = [
        FeedbackReportStatus::New->value => 'bg-slate-700 text-white',
        FeedbackReportStatus::NeedsInput->value => 'bg-amber-500 text-white',
        FeedbackReportStatus::Completed->value => 'bg-emerald-600 text-white',
    ];
@endphp

<form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" {{ $attributes->merge(['class' => 'inline-flex']) }} data-status-switch="{{ $report->public_id }}">
    @csrf
    @method('PATCH')
    <div class="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white" role="group" aria-label="「{{ $report->title }}」的狀態">
        @foreach ($options as $value => [$label, $hint])
            @php $isCurrent = $report->status->value === $value; @endphp
            <button type="submit" name="status" value="{{ $value }}"
                @class([
                    'border-l border-slate-300 font-semibold transition first:border-l-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600',
                    'h-8 px-2.5 text-xs' => ! $compact,
                    'h-7 px-2 text-[11px]' => $compact,
                    $activeClass[$value] => $isCurrent,
                    'text-slate-600 hover:bg-slate-100' => ! $isCurrent,
                ])
                title="{{ $isCurrent ? '目前：'.$hint : '改成「'.$label.'」（'.$hint.'）' }}"
                data-status-option="{{ $value }}"
                @if ($attributes->has('data-card-action')) data-card-action @endif
                @if ($isCurrent) disabled aria-pressed="true" @else aria-pressed="false" @endif>{{ $label }}</button>
        @endforeach
    </div>
</form>
