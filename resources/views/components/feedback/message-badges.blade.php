{{-- 清單與看板標題旁的留言提示：開發者看「新留言 N／留言 N」，客戶看「有新回覆」。 --}}
@props(['report', 'isOwner'])

@if ($isOwner)
    @if ($report->unread_messages_count > 0 || $report->feedback_messages_count > 0)
        <span {{ $attributes->class('inline-flex flex-wrap items-center gap-1.5 align-middle') }}>
            @if ($report->unread_messages_count > 0)
                <span class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm" title="{{ config('feedback.labels.client') }}在你上次開啟後留的言" data-unread-badge>新留言 {{ $report->unread_messages_count }}</span>
            @endif
            @if ($report->feedback_messages_count > 0)
                <span class="text-[11px] font-medium text-slate-500" data-message-count>留言 {{ $report->feedback_messages_count }}</span>
            @endif
        </span>
    @endif
@elseif ($report->hasNewReplyForClient())
    <span {{ $attributes->class('inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 align-middle text-[11px] font-bold text-white shadow-sm') }} title="{{ config('feedback.labels.owner') }}有新的留言或調整說明" data-new-reply-badge>有新回覆</span>
@endif
