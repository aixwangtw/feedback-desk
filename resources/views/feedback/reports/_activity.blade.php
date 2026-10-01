<div class="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
    <h2 class="text-base font-semibold text-slate-950">處理紀錄</h2>
    <x-feedback.status-badge :status="$report->status" />
</div>

<div class="mt-5 grid gap-5">
    @forelse ($report->feedbackMessages as $message)
        <article class="flex gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-full {{ $message->author_type === \App\Enums\FeedbackAuthorType::Agent ? 'bg-violet-100 text-violet-700' : ($message->author_type === \App\Enums\FeedbackAuthorType::Owner ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600') }} text-xs font-bold">
                {{ mb_substr($message->author_type->label(), 0, 1) }}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p class="text-sm font-semibold text-slate-900">{{ $message->author_name ?: $message->author_type->label() }}</p>
                    <time datetime="{{ $message->created_at->toIso8601String() }}" class="text-xs text-slate-500">{{ $message->created_at->diffForHumans() }}</time>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{{ $message->body }}</p>
                @if ($message->feedbackAttachments->isNotEmpty())
                    <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        @foreach ($message->feedbackAttachments as $attachment)
                            <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}">
                                <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="aspect-video w-full object-cover" loading="lazy">
                                <span class="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大預覽</span>
                            </a>
                        @endforeach
                    </div>
                @endif
            </div>
        </article>
    @empty
        <div class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">已收到回報，新的處理進度會顯示在這裡。</div>
    @endforelse
</div>
