{{-- 清單與看板標題旁的留言提示：開發者看「新留言 N／留言 N」，客戶看「有新回覆」；點了直接開啟右下角對話面板的這張單。 --}}
@props(['report', 'isOwner'])

@if ($isOwner)
    @if ($report->unread_messages_count > 0 || $report->feedback_messages_count > 0)
        <button type="button" {{ $attributes->class('inline-flex flex-wrap items-center gap-1.5 rounded-full align-middle hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600') }} data-chat-open="{{ $report->public_id }}" aria-label="開啟「{{ $report->title }}」的留言對話" title="開啟留言對話">
            @if ($report->unread_messages_count > 0)
                <span class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm" data-unread-badge>新留言 {{ $report->unread_messages_count }}</span>
            @endif
            @if ($report->feedback_messages_count > 0)
                <span class="text-[11px] font-medium text-slate-500 underline decoration-dotted underline-offset-2" data-message-count>留言 {{ $report->feedback_messages_count }}</span>
            @endif
        </button>
    @endif
@elseif ($report->hasNewReplyForClient())
    <button type="button" {{ $attributes->class('inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 align-middle text-[11px] font-bold text-white shadow-sm hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600') }} data-chat-open="{{ $report->public_id }}" aria-label="開啟「{{ $report->title }}」的留言對話" title="{{ config('feedback.labels.owner') }}有新的留言或調整說明，點開查看" data-new-reply-badge>有新回覆</button>
@endif
