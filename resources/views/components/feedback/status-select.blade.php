@props(['status'])

{{-- Only hand-pickable statuses are listed; an automation-only status stays visible as the current value but cannot be chosen. --}}
<select name="status" {{ $attributes->merge(['class' => 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10']) }}>
    @unless ($status->isSelectable())
        <option value="{{ $status->value }}" data-dot="{{ $status->dotClass() }}" selected disabled hidden data-automation-status>{{ $status->label() }}</option>
    @endunless
    @foreach (\App\Enums\FeedbackReportStatus::selectable() as $option)
        <option value="{{ $option->value }}" data-dot="{{ $option->dotClass() }}" @selected($status === $option)>{{ $option->label() }}</option>
    @endforeach
</select>
