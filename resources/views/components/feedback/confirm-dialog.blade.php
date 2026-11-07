{{--
    確認視窗（網站自己的對話視窗，不用瀏覽器 confirm()）：刪除、收回、捨棄、完成、通過全部共用這一個元件，文字來自 FeedbackConfirmText。
    兩種用法：
      1. 有 $action：每張單各一個（刪除單），按鈕送出這個表單；由 data-dialog-open 開啟。
      2. 沒有 $action：全站一個共用視窗（layout 放一次），confirm-dialog.js 在表單帶 data-confirm-* 屬性送出前填字並開啟。
--}}
@props(['id', 'action' => null, 'method' => 'POST', 'text' => ['title' => '', 'message' => '', 'confirm' => '確認', 'tone' => 'danger']])

@php
    $danger = ($text['tone'] ?? 'danger') === 'danger';
    $confirmClass = $danger
        ? 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-600'
        : 'bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-600';
    $cancel = \App\Support\FeedbackConfirmText::CANCEL;
@endphp
<dialog id="{{ $id }}" class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-950/60" aria-labelledby="{{ $id }}-title" @unless ($action) data-confirm-dialog @endunless>
    <form @if ($action) method="POST" action="{{ $action }}" @else method="dialog" @endif class="grid gap-4 p-5 sm:p-6">
        @if ($action)
            @csrf
            @if (strtoupper($method) !== 'POST')
                @method($method)
            @endif
        @endif
        <h2 id="{{ $id }}-title" class="text-lg font-bold text-slate-950" data-confirm-title-text>{{ $text['title'] }}</h2>
        <p class="whitespace-pre-line break-words text-sm leading-6 text-slate-600" data-confirm-message-text>{{ $text['message'] }}</p>
        <div class="flex justify-end gap-3">
            <button type="button" class="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-dialog-close data-confirm-cancel autofocus>{{ $cancel }}</button>
            <button type="submit" class="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 {{ $confirmClass }}" data-confirm-ok>{{ $text['confirm'] }}</button>
        </div>
    </form>
</dialog>
