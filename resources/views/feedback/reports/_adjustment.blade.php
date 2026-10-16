{{-- 回饋單「調整說明」唯讀區塊；老師與開發者共用。 --}}
@php $compact = $compact ?? false; @endphp

<div data-adjustment>
    <h2 class="{{ $compact ? 'text-sm' : 'text-base' }} font-semibold text-slate-950">調整說明</h2>
    @if (filled($report->adjustment_note))
        <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700" data-adjustment-note>{{ $report->adjustment_note }}</p>
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
