{{--
    清單與看板的附件縮圖（兩處共用這一份，也是輪詢端點回傳的內容）：這張單所有附件（原始附件＋留言的圖片與影片，收回的不算、不含草稿），最新的排最前，
    最多 3 張縮圖，其餘「+N」；點縮圖或「+N」直接開附件燈箱（只看這張單的全部附件，可左右切換，來源見 data-lightbox-gallery；燈箱與相簿共用 attachment-lightbox.js），不開詳情。清單由 FeedbackAlbum::listItemsForReports 供應，與相簿同一份查詢規則。
--}}
@php
    $card ??= false;
    $thumbLimit = \App\Support\FeedbackAlbum::LIST_THUMB_LIMIT;
    $shown = $items->take($thumbLimit);
    $more = $items->count() - $shown->count();
    $gallery = $items->map(fn (array $item): array => [
        'url' => $item['url'],
        'name' => $item['name'],
        'video' => $item['is_video'],
        'source' => $item['source'],
        'at' => $item['at']->copy()->timezone('Asia/Taipei')->format('Y/m/d H:i'),
    ])->values();
    $tile = 'block size-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';
@endphp
<div class="flex flex-wrap items-center gap-1 {{ $card ? 'mt-3' : 'sm:justify-center' }}" data-attachment-thumbs="{{ $report->public_id }}" data-attachment-count="{{ $items->count() }}" data-lightbox-gallery="{{ $gallery->toJson(JSON_UNESCAPED_UNICODE) }}" @if ($card) data-card-action @endif @if ($card && $items->isEmpty()) hidden @endif>
    @forelse ($shown as $index => $item)
        <button type="button" class="{{ $tile }}" data-lightbox-index="{{ $index }}" title="{{ $item['is_video'] ? '影片：' : '' }}{{ $item['name'] }}" aria-label="檢視附件：{{ $item['name'] }}">
            <x-feedback.attachment-media :src="$item['url']" :name="$item['name']" :video="$item['is_video']" class="size-full object-cover" />
        </button>
    @empty
        @unless ($card)<span class="text-xs text-slate-400">—</span>@endunless
    @endforelse
    @if ($more > 0)
        <button type="button" class="{{ $tile }} grid place-items-center bg-slate-100 text-xs font-bold text-slate-700 hover:bg-slate-200" data-lightbox-index="{{ $shown->count() }}" aria-label="還有 {{ $more }} 個附件，檢視附件" title="檢視附件">+{{ $more }}</button>
    @endif
</div>
