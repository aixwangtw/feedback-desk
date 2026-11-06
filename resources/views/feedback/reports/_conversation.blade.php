{{-- 對話面板開啟單一張單的內容：過去的處理說明（舊調整重點，唯讀、收合，有內容才顯示）＋相簿＋活動時間軸。 --}}
@if ($report->hasAdjustment())
    <details class="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm" data-chat-adjustment data-keep-open="past-notes">
        <summary class="cursor-pointer font-semibold text-slate-700">過去的處理說明</summary>
        <div class="mt-2">
            @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report, 'compact' => true, 'showHeading' => false])
        </div>
    </details>
@endif

@include('feedback.reports._thread', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner, 'compact' => true])
