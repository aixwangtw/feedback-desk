@props(['status', 'project' => null, 'deleted' => false])

{{-- 客戶已刪除的單只留紀錄：不顯示待處理等狀態，避免被當成還要處理（2026-11-19 使用者：「老師已刪除 系統紀錄就好 不用等工程師」）。 --}}

@php
    $classes = $deleted ? 'bg-slate-200 text-slate-600 ring-slate-300' : match ($status) {
        \App\Enums\FeedbackReportStatus::New => 'bg-slate-100 text-slate-700 ring-slate-200',
        \App\Enums\FeedbackReportStatus::NeedsInput => 'bg-amber-50 text-amber-800 ring-amber-200',
        \App\Enums\FeedbackReportStatus::Completed => 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    };
@endphp

<span {{ $attributes->merge(['class' => "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset {$classes}"]) }} data-status-value="{{ $deleted ? 'deleted' : $status->value }}">
    {{ $deleted ? \App\Models\FeedbackReport::DELETED_RECORD_LABEL : $status->label($project) }}
</span>
