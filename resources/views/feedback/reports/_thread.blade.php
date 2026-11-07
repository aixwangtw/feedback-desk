{{-- 對話內容：活動時間軸（留言與狀態變更）。單頁、詳情視窗、右下角面板共用，經對話端點、activity 端點取得；附件相簿另放（_album）。 --}}
@php $viewerIsOwner ??= app(\App\Support\FeedbackAccess::class)->isOwner($project); @endphp
@include('feedback.reports._activity', ['project' => $project, 'report' => $report, 'viewerIsOwner' => $viewerIsOwner, 'compact' => $compact ?? false])
