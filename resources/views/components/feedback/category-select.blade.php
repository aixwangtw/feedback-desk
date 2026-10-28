@props(['project', 'report', 'categories', 'compact' => false])

@if ($categories !== [])
    <form method="POST" action="{{ route('feedback.reports.category.update', [$project, $report]) }}" {{ $attributes->except('data-suffix')->merge(['class' => 'flex flex-wrap items-center gap-2 text-xs text-slate-600']) }} data-category-quick-form data-report-category>
        @csrf
        @method('PATCH')
        <label for="quick-category-{{ $report->public_id }}{{ $attributes->get('data-suffix', '') }}" class="{{ $compact ? 'sr-only' : 'font-semibold text-slate-500' }}">分類</label>
        <select id="quick-category-{{ $report->public_id }}{{ $attributes->get('data-suffix', '') }}" name="category" class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-4 focus:ring-teal-600/10" data-category-quick>
            <option value="" @selected(blank($report->category))>未分類</option>
            @foreach ($categories as $category)
                <option value="{{ $category }}" @selected($report->category === $category)>{{ $category }}</option>
            @endforeach
            @if (filled($report->category) && ! in_array($report->category, $categories, true))
                <option value="{{ $report->category }}" selected>{{ $report->category }}</option>
            @endif
        </select>
        <span class="text-xs text-slate-500" role="status" aria-live="polite" data-category-quick-feedback></span>
    </form>
@endif
