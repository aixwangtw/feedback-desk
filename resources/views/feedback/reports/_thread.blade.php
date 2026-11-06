{{-- 對話內容：相簿＋活動時間軸（留言與狀態變更）。單頁、詳情視窗、右下角面板共用，經對話端點、activity 端點取得。 --}}
@php $viewerIsOwner ??= app(\App\Support\FeedbackAccess::class)->isOwner($project); @endphp
<div class="grid grid-cols-[minmax(0,1fr)] gap-4">
    @include('feedback.reports._album', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner])
    @include('feedback.reports._activity', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner, 'compact' => $compact ?? false])
</div>
