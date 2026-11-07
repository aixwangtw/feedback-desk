{{--
    附件（相簿，照 Jira 的「附件」區）：這張單所有附件集中成縮圖格狀（老師原始附件＋每則留言的圖片與影片；草稿附件只有團隊看得到，見 FeedbackAlbum）。
    位置：詳情視窗與單頁放在說明下方、活動時間軸上方，預設展開，超過一排顯示「顯示全部」（album.js）；
    右下角面板不放在對話串裡，改由標題列的相簿鈕切到面板內的附件頁（樣式 data-album-force-all：永遠全部顯示）。
    縮圖直接用原檔、lazy 載入，點圖放大、點影片播放；名稱完整換行，來源與時間在名稱下面。
    可以傳入 $albumItems（呼叫端已經查好）避免重複查詢。
--}}
@php
    $viewerIsOwner ??= app(\App\Support\FeedbackAccess::class)->isOwner($project);
    $albumItems ??= app(\App\Support\FeedbackAlbum::class)->items($report, $viewerIsOwner);
@endphp
@if ($albumItems->isNotEmpty())
    <section class="grid gap-3 text-sm" data-chat-album data-album-key="{{ $report->public_id }}" aria-label="附件">
        <h3 class="text-sm font-bold text-slate-900">附件（<span data-album-count>{{ $albumItems->count() }}</span>）</h3>
        <ul class="album-grid grid grid-cols-[repeat(auto-fill,var(--attachment-tile-width))] justify-start gap-x-3" data-album-grid data-collapsed>
            @foreach ($albumItems as $item)
                <li class="attachment-tile min-w-0 pb-3" data-album-item data-album-kind="{{ $item['kind'] }}">
                    <a href="{{ $item['url'] }}" target="_blank" rel="noreferrer" class="attachment-tile-thumb block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-play data-lightbox-alt="{{ $item['name'] }}" title="{{ $item['is_video'] ? '播放影片' : '放大預覽' }}">
                        <x-feedback.attachment-media :src="$item['url']" :name="$item['name']" :video="$item['is_video']" class="size-full object-cover" />
                    </a>
                    <x-feedback.attachment-caption :name="$item['name']" class="mt-1" />
                    <p class="mt-0.5 truncate text-[11px] leading-4 text-slate-600" title="{{ $item['source'] }}" data-album-source>
                        @if ($item['kind'] === 'draft')<span class="font-semibold text-amber-800">{{ $item['source'] }}（只有{{ config('feedback.labels.owner') }}看得到）</span>@else{{ $item['source'] }}@endif
                    </p>
                    <x-feedback.time :at="$item['at']" relative class="block text-[11px] leading-4 text-slate-400" />
                </li>
            @endforeach
        </ul>
        <button type="button" class="justify-self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-album-toggle hidden>顯示全部</button>
    </section>
@endif
