{{--
    清單與看板上每張單的明顯標記：「等開發者／等老師」（雙方看到的字一樣）、紅底「N 則未讀」（各自依自己這一方的已讀狀態）；
    開發團隊端另有「待審留言 N」（草稿，只有團隊看得到）。
--}}
@props(['report', 'isOwner', 'waitingOn' => null])

@php
    $unread = $report->unreadCountFor($isOwner);
    $drafts = $isOwner ? (int) ($report->message_drafts_count ?? 0) : 0;
    $waitingLabel = $waitingOn !== null ? \App\Support\FeedbackWaitingOn::badgeLabel($waitingOn) : null;
@endphp

@if ($waitingLabel !== null || $unread > 0 || $drafts > 0)
    <div {{ $attributes->class(['flex flex-wrap items-center gap-1.5']) }} data-report-flags>
        @if ($waitingLabel !== null)
            <span @class([
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ring-1 ring-inset',
                'bg-sky-50 text-sky-800 ring-sky-300' => $waitingOn === \App\Support\FeedbackWaitingOn::DEVELOPER,
                'bg-violet-50 text-violet-800 ring-violet-300' => $waitingOn === \App\Support\FeedbackWaitingOn::CLIENT,
            ]) data-waiting-on="{{ $waitingOn }}">{{ $waitingLabel }}</span>
        @endif
        @if ($unread > 0)
            <button type="button" class="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold leading-4 text-white shadow-sm hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600" data-chat-open="{{ $report->public_id }}" data-unread-flag="{{ $report->public_id }}">{{ $unread > 99 ? '99+' : $unread }} 則未讀</button>
        @endif
        @if ($drafts > 0)
            <a href="{{ route('feedback.reports.show', [$report->feedbackProject ?? $report->feedback_project_id, $report]) }}#message-drafts" class="inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-amber-900 hover:bg-amber-100" data-draft-badge="{{ $report->public_id }}" title="有待審留言，只有團隊看得到">待審留言 {{ $drafts }}</a>
        @endif
    </div>
@endif
