<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\ChangeFeedbackReportStatusAction;
use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\UpdateFeedbackStatusRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

class FeedbackStatusController extends Controller
{
    public function update(
        UpdateFeedbackStatusRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
        ChangeFeedbackReportStatusAction $changeStatus,
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $status = FeedbackReportStatus::from($request->validated('status'));

        // 網頁上只有客戶能改（見 UpdateFeedbackStatusRequest）；改回等工程師另記事件，團隊看得出是客戶手動重新開啟。
        $eventKind = $status === FeedbackReportStatus::New
            ? ChangeFeedbackReportStatusAction::EVENT_REOPEN_BY_CLIENT
            : ChangeFeedbackReportStatusAction::EVENT_STATUS;
        $changeStatus->handle($feedbackReport, $status, $access->actor($feedbackProject), $eventKind);

        if ($request->expectsJson()) {
            return response()->json([
                'status' => $status->value,
                'label' => $status->label($feedbackProject),
                'counts' => FeedbackReport::statusCountsForProject($feedbackProject, includeClientDeleted: $access->isOwner($feedbackProject), clientCreatedOnly: ! $access->isOwner($feedbackProject)),
                'message' => "狀態已更新為「{$status->label($feedbackProject)}」。",
            ]);
        }

        return back()->with('success', "狀態已更新為「{$status->label($feedbackProject)}」。");
    }
}
