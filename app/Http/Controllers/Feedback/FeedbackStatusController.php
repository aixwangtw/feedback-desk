<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\UpdateFeedbackStatusRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Http\RedirectResponse;

class FeedbackStatusController extends Controller
{
    public function update(
        UpdateFeedbackStatusRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
    ): RedirectResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $status = FeedbackReportStatus::from($request->validated('status'));

        $feedbackReport->update([
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null,
            'latest_activity_at' => now(),
        ]);

        return back()->with('success', "狀態已更新為「{$status->label()}」。");
    }
}
