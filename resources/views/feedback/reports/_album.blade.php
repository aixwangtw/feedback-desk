{{--
    相簿：這張單所有附件集中顯示（老師原始附件＋每則留言的圖片與影片；草稿附件只有團隊看得到，見 FeedbackAlbum）。
    單頁、詳情視窗、右下角面板共用；縮圖直接用原檔、lazy 載入，點圖放大、點影片播放，標示來自哪則留言與時間。
--}}
@php
    $viewerIsOwner ??= app(\App\Support\FeedbackAccess::class)->isOwner($project);
    $albumItems = app(\App\Support\FeedbackAlbum::class)->items($report, $viewerIsOwner);
@endphp
@if ($albumItems->isNotEmpty())
    <details class="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm" data-chat-album data-keep-open="album">
        <summary class="cursor-pointer font-semibold text-slate-800">相簿 <span class="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" data-album-count>{{ $albumItems->count() }}</span></summary>
        <ul class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5" data-album-grid>
            @foreach ($albumItems as $item)
                <li class="min-w-0" data-album-item data-album-kind="{{ $item['kind'] }}">
                    <a href="{{ $item['url'] }}" target="_blank" rel="noreferrer" class="block aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-play data-lightbox-alt="{{ $item['name'] }}" title="{{ $item['is_video'] ? '播放影片' : '放大預覽' }}">
                        <x-feedback.attachment-media :src="$item['url']" :name="$item['name']" :video="$item['is_video']" class="size-full object-cover" />
                    </a>
                    <p class="mt-1 truncate text-[11px] leading-4 text-slate-600" title="{{ $item['source'] }}" data-album-source>
                        @if ($item['kind'] === 'draft')<span class="font-semibold text-amber-800">{{ $item['source'] }}（只有{{ config('feedback.labels.owner') }}看得到）</span>@else{{ $item['source'] }}@endif
                    </p>
                    <x-feedback.time :at="$item['at']" relative class="block text-[11px] leading-4 text-slate-400" />
                </li>
            @endforeach
        </ul>
    </details>
@endif
