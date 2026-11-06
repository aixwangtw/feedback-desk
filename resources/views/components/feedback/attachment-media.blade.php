{{--
    附件縮圖：圖片照舊用 <img>；mp4 影片用 <video muted preload="metadata"> 抓第一格畫面，疊播放三角形，尺寸與圖片縮圖相同。
    外層連結點了開原檔：影片不進圖片燈箱（data-attachment-video 讓燈箱略過），直接在新分頁播放；相簿的連結加 data-lightbox-play 才在燈箱裡播放。
    給附件模型（attachment）或直接給 name／video（待審留言的附件沒有模型）。
--}}
@props(['attachment' => null, 'src', 'name' => null, 'video' => null])

@php
    $isVideo = $video ?? $attachment->isVideo();
    $label = $name ?? $attachment->original_name;
@endphp

@if ($isVideo)
    <span {{ $attributes->class(['relative block overflow-hidden bg-slate-900']) }} data-attachment-video>
        <video muted playsinline preload="metadata" src="{{ $src }}#t=0.1" class="pointer-events-none size-full object-cover" aria-hidden="true" tabindex="-1"></video>
        <span class="pointer-events-none absolute inset-0 grid place-items-center">
            <span class="grid size-8 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80">
                <svg class="ml-0.5 size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
        </span>
        <span class="sr-only">影片：{{ $label }}</span>
    </span>
@else
    <img src="{{ $src }}" alt="{{ $label }}" {{ $attributes }} loading="lazy">
@endif
