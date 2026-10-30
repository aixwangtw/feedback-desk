{{-- 回饋單「調整重點」唯讀區塊；老師與開發者共用。 --}}
@php
    $compact = $compact ?? false;
    $showHeading = $showHeading ?? true;
@endphp

<div data-adjustment>
    @if ($showHeading)
        <h2 class="{{ $compact ? 'text-sm' : 'text-base' }} font-semibold text-slate-950">調整重點</h2>
        <p class="mt-0.5 text-xs text-slate-400">留言重點整理，會隨時更新</p>
    @endif
    @if (filled($report->adjustment_note))
        <div class="mt-2" data-adjustment-note>{{ \App\Support\FeedbackRichText::render($report->adjustment_note, $compact) }}</div>
    @elseif ($report->adjustmentAttachments->isEmpty())
        <p class="mt-2 text-sm text-slate-400">尚未填寫。</p>
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
