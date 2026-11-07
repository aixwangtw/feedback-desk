<dialog data-image-lightbox class="m-auto h-[100dvh] w-screen max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/90 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-2xl" aria-labelledby="image-lightbox-title">
    <div class="flex h-full min-h-0 flex-col bg-slate-950 text-white">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 sm:px-5">
            <h2 id="image-lightbox-title" class="min-w-0 flex-1 truncate text-sm font-semibold" data-lightbox-title>附件</h2>
            <output class="text-xs tabular-nums text-slate-300" data-lightbox-counter></output>
            <div class="flex flex-wrap items-center justify-end gap-2">
                <div class="flex items-center overflow-hidden rounded-lg border border-white/20" role="group" aria-label="縮放控制" data-lightbox-zoom-group>
                    <button type="button" class="grid size-10 place-items-center text-lg transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-zoom-out aria-label="縮小">−</button>
                    <output class="min-w-14 border-x border-white/20 px-2 text-center text-xs tabular-nums text-slate-200" data-lightbox-scale>100%</output>
                    <button type="button" class="grid size-10 place-items-center text-lg transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-zoom-in aria-label="放大">＋</button>
                </div>
                <button type="button" class="min-h-10 rounded-lg border border-white/20 px-3 text-xs font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-reset>重設</button>
                <a href="#" target="_blank" rel="noreferrer" class="inline-flex min-h-10 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-original>開啟原圖</a>
                <button type="button" class="grid size-10 place-items-center rounded-lg bg-white text-xl text-slate-950 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-close aria-label="關閉截圖預覽">×</button>
            </div>
        </div>
        <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6" data-lightbox-stage>
            <button type="button" class="absolute left-2 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-2xl text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-prev aria-label="上一張" hidden>‹</button>
            <img src="" alt="" class="max-h-full max-w-full origin-center object-contain transition-transform duration-150" data-lightbox-image>
            <video controls playsinline class="max-h-full max-w-full bg-black" data-lightbox-video hidden></video>
            <button type="button" class="absolute right-2 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-2xl text-white transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400" data-lightbox-next aria-label="下一張" hidden>›</button>
        </div>
        <div class="border-t border-white/10 bg-slate-950/95 px-4 py-2.5 text-center">
            <p class="break-words text-sm font-semibold" data-lightbox-caption-name></p>
            <p class="mt-0.5 text-xs text-slate-300" data-lightbox-caption-meta></p>
        </div>
    </div>
</dialog>
