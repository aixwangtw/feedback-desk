{{--
    留言旁的「⋯」選單（照 LINE、Slack）：編輯、收回自己發的留言。單頁、詳情視窗、右下角面板共用（由 _activity 放進每則自己的留言）。
    編輯與收回都不留痕跡：沒有「已編輯」、收回後整則消失；動作由 message-edit.js 處理（沒有 JS 時收回照表單送出）。
--}}
@props(['project', 'report', 'message'])

<details class="relative" data-message-menu>
    <summary class="grid size-6 cursor-pointer list-none place-items-center rounded-md text-base font-bold leading-none text-slate-500 transition hover:bg-black/5 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden" aria-label="這則留言的選項" title="編輯、收回">⋯</summary>
    <div class="absolute right-0 top-full z-20 mt-1 min-w-24 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-sm shadow-lg ring-1 ring-black/5">
        <button type="button" class="block w-full px-3 py-1.5 text-left font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100" data-message-edit-open>編輯</button>
        <form method="POST" action="{{ route('feedback.messages.destroy', [$project, $report, $message]) }}" data-message-withdraw-form>
            @csrf
            @method('DELETE')
            <button type="submit" class="block w-full px-3 py-1.5 text-left font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus-visible:bg-rose-50">收回</button>
        </form>
    </div>
</details>
