{{-- 「過去的處理說明」（舊的調整重點）唯讀區塊；老師與開發者共用，只有有內容時才會被放進頁面。調整重點已停用，之後改用留言。 --}}
@php
    $compact = $compact ?? false;
    $showHeading = $showHeading ?? true;
@endphp

<div data-adjustment>
    @if ($showHeading)
        <h2 class="{{ $compact ? 'text-sm' : 'text-base' }} font-semibold text-slate-950">過去的處理說明</h2>
        <p class="mt-0.5 text-xs text-slate-400">舊的調整重點，已停用、只能查看；之後的處理說明請看留言</p>
    @endif
    @if (filled($report->adjustment_note))
        <div class="mt-2" data-adjustment-note>{{ \App\Support\FeedbackRichText::render($report->adjustment_note, $compact) }}</div>
    @endif

    @if ($report->adjustmentAttachments->isNotEmpty())
        <div class="mt-3 {{ $compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3' }}">
            @foreach ($report->adjustmentAttachments as $attachment)
                <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="{{ $compact ? 'block size-20' : 'group relative' }} overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" data-adjustment-image title="放大預覽">
                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="{{ $compact ? 'size-full' : 'aspect-video w-full' }} object-cover" loading="lazy">
                </a>
            @endforeach
        </div>
    @endif
</div>
