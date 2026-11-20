{{--
    開發團隊端標題右邊的「待審留言」標示：這張單有還沒送出的回覆草稿（feedback_message_drafts）。
    草稿送出前老師還沒收到回覆，單會停在「待處理」；送出後依留言規則自動改成「待回覆」。
    2026-11-19 使用者問「有些等工程師的都有需要審核的留言?」，清單上要看得出是在等審草稿。需先用 withOwnerMessageStats 載入 message_drafts_count。
--}}
@props(['report', 'isOwner'])

@php $drafts = $isOwner ? (int) ($report->message_drafts_count ?? 0) : 0; @endphp
@if ($drafts > 0)
    <span {{ $attributes->class(['inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-300']) }} data-draft-badge="{{ $report->public_id }}" title="有 {{ $drafts }} 則待審留言；點開這張單在留言區下方審核，按「送出」後會自動改成待回覆">待審留言{{ $drafts > 1 ? ' '.$drafts : '' }}</span>
@endif
