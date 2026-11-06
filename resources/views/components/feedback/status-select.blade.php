{{-- 狀態選單。allowComplete=false（開發團隊端）時不能選「已完成」：已完成只由客戶確認；單已完成時保留目前值但停用。 --}}
@props(['status', 'allowComplete' => true])

<select name="status" {{ $attributes->merge(['class' => 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10']) }}>
    @foreach (\App\Enums\FeedbackReportStatus::cases() as $option)
        @if ($allowComplete || $option !== \App\Enums\FeedbackReportStatus::Completed)
            <option value="{{ $option->value }}" data-dot="{{ $option->dotClass() }}" @selected($status === $option)>{{ $option->label() }}</option>
        @elseif ($status === $option)
            <option value="" data-dot="{{ $option->dotClass() }}" selected disabled>{{ $option->label() }}（由{{ config('feedback.labels.client') }}確認）</option>
        @endif
    @endforeach
</select>
