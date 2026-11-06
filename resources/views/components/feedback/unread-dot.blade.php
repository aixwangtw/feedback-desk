{{--
    標題右邊的未讀小圓點數字（取代以前的留言按鈕與「N 則未讀」標籤）；沒有未讀時只留空的容器，
    對話面板讀過或刷新時由 chat-panel.js 填入或清掉。純指示，不能點。
--}}
@props(['report', 'isOwner'])

@php $unread = $report->unreadCountFor($isOwner); @endphp
<span {{ $attributes->class(['inline-flex shrink-0 items-center']) }} data-unread-slot="{{ $report->public_id }}">@if ($unread > 0)<span class="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white" data-unread-dot title="{{ $unread }} 則未讀留言" aria-label="{{ $unread }} 則未讀留言">{{ $unread > 99 ? '99+' : $unread }}</span>@endif</span>
