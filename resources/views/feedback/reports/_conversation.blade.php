{{-- 對話面板開啟單一張單時的內容：調整重點（收合）＋留言串。 --}}
@if ($report->hasAdjustment())
    <details class="mb-4 rounded-xl border border-teal-100 bg-teal-50/50 px-3.5 py-2.5 text-sm" @if ($adjustmentWasNew) open @endif data-chat-adjustment>
        <summary class="cursor-pointer font-semibold text-teal-900">
            調整重點
            @if ($adjustmentWasNew)
                <span class="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">有更新</span>
            @endif
        </summary>
        <div class="mt-2">
            @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report, 'compact' => true, 'showHeading' => false])
        </div>
    </details>
@endif

@include('feedback.reports._activity', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner, 'compact' => true])
