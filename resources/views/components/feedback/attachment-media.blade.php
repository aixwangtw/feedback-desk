{{--
    附件縮圖：圖片照舊用 <img>；mp4 影片用 <video muted preload="metadata"> 抓第一格畫面，疊播放三角形，尺寸與圖片縮圖相同。
    外層連結點了開原檔：影片不進圖片燈箱（data-attachment-video 讓燈箱略過），直接在新分頁播放。
--}}
@props(['attachment', 'src'])

@if ($attachment->isVideo())
    <span {{ $attributes->class(['relative block overflow-hidden bg-slate-900']) }} data-attachment-video>
        <video muted playsinline preload="metadata" src="{{ $src }}#t=0.1" class="pointer-events-none size-full object-cover" aria-hidden="true" tabindex="-1"></video>
        <span class="pointer-events-none absolute inset-0 grid place-items-center">
            <span class="grid size-8 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80">
                <svg class="ml-0.5 size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
        </span>
        <span class="sr-only">影片：{{ $attachment->original_name }}</span>
    </span>
@else
    <img src="{{ $src }}" alt="{{ $attachment->original_name }}" {{ $attributes }} loading="lazy">
@endif
