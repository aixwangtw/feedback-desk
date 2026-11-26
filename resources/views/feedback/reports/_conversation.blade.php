{{-- 對話面板開啟單一張單的內容：開單內容（建立者、時間、說明全文，老師／業主開的單不會只剩標題）＋過去的處理說明（舊調整重點，唯讀、收合，有內容才顯示）＋活動時間軸（相簿不在對話串裡，見 _album）。 --}}
{{-- 開單內容：面板只有標題列，說明放在對話最上面；文字與單頁、詳情視窗同一套 FeedbackRichText。 --}}
<section class="mb-4 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-800 shadow-sm" aria-label="開單內容" data-chat-report-description>
    <p class="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
        <span class="font-semibold text-slate-700">開單內容</span>
        <span class="text-slate-500" data-chat-report-creator>{{ $report->creatorLabel() }}</span>
        <x-feedback.time :at="$report->created_at" relative class="text-slate-500" />
    </p>
    <div class="break-words">{{ \App\Support\FeedbackRichText::render($report->description, compact: true) }}</div>
</section>

@if ($report->hasAdjustment())
    <details class="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm" data-chat-adjustment data-keep-open="past-notes">
        <summary class="cursor-pointer font-semibold text-slate-700">過去的處理說明</summary>
        <div class="mt-2">
            @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report, 'compact' => true, 'showHeading' => false])
        </div>
    </details>
@endif

@include('feedback.reports._thread', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner, 'compact' => true])
