{{--
    清單、看板與詳情視窗上的「留言」按鈕：有留言（或有未讀）才出現；右上角紅色圓形數字＝未讀數，沒有未讀就不顯示數字。
    開發者端的未讀＝客戶新留言；客戶端的未讀＝開發者新留言，調整說明有更新再加 1。點按鈕直接開啟右下角面板中這張單的對話。
--}}
@props(['report', 'isOwner', 'label' => null])

@php
    $total = (int) ($report->feedback_messages_count ?? 0);
    $unread = $report->unreadCountFor($isOwner);
    $ariaLabel = "開啟「{$report->title}」的留言對話（".($total > 0 ? "共 {$total} 則留言" : '還沒有留言').($unread > 0 ? "，{$unread} 則未讀" : '').'）';
@endphp

@if ($total > 0 || $unread > 0 || $label)
    <button type="button" {{ $attributes->class([
        'relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg align-middle transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
        'size-8 text-slate-500 hover:bg-teal-50 hover:text-teal-700' => ! $label,
        'min-h-10 border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-800 hover:bg-teal-100' => $label,
    ]) }} data-chat-open="{{ $report->public_id }}" data-message-count="{{ $total }}" aria-label="{{ $ariaLabel }}" title="{{ $total > 0 ? "留言 {$total} 則" : '開啟對話' }}{{ $unread > 0 ? "，未讀 {$unread}" : '' }}">
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
            <path d="M8.5 10.5h7M8.5 13.5h4.5" />
        </svg>
        @if ($label)
            <span>{{ $label }}</span>
        @endif
        @if ($unread > 0)
            <span class="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white" data-unread-badge @unless ($isOwner) data-new-reply-badge @endunless>{{ $unread > 99 ? '99+' : $unread }}</span>
        @endif
    </button>
@endif
