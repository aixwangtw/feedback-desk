<?php

namespace App\Http\Controllers\Feedback;

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
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $status = FeedbackReportStatus::from($request->validated('status'));

        $feedbackReport->update([
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null,
            'latest_activity_at' => now(),
        ]);

        if ($request->expectsJson()) {
            return response()->json([
                'status' => $status->value,
                'label' => $status->label(),
                'counts' => FeedbackReport::statusCountsForProject($feedbackProject, includeClientDeleted: $access->isOwner($feedbackProject)),
                'message' => "狀態已更新為「{$status->label()}」。",
            ]);
        }

        return back()->with('success', "狀態已更新為「{$status->label()}」。");
    }
}
