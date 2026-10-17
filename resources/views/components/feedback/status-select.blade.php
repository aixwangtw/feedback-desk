@props(['status'])

<select name="status" {{ $attributes->merge(['class' => 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10']) }}>
    @foreach (\App\Enums\FeedbackReportStatus::cases() as $option)
        <option value="{{ $option->value }}" data-dot="{{ $option->dotClass() }}" @selected($status === $option)>{{ $option->label() }}</option>
    @endforeach
</select>
