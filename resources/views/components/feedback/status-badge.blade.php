@props(['status'])

@php
    $classes = match ($status) {
        \App\Enums\FeedbackReportStatus::New => 'bg-slate-100 text-slate-700 ring-slate-200',
        \App\Enums\FeedbackReportStatus::NeedsInput => 'bg-amber-50 text-amber-800 ring-amber-200',
        \App\Enums\FeedbackReportStatus::Completed => 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    };
@endphp

<span {{ $attributes->merge(['class' => "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset {$classes}"]) }}>
    {{ $status->label() }}
</span>
