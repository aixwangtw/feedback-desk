<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\UpdateFeedbackReportAdjustmentAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\UpdateFeedbackAdjustmentRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Http\RedirectResponse;

class FeedbackAdjustmentController extends Controller
{
    public function update(
        UpdateFeedbackAdjustmentRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        UpdateFeedbackReportAdjustmentAction $updateAdjustment,
        FeedbackAccess $access,
    ): RedirectResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);

        $updateAdjustment->handle($feedbackReport, [
            'note' => $request->validated('adjustment_note'),
            'images' => $request->file('adjustment_images', []),
            'remove_attachments' => $request->validated('remove_adjustment_attachments', []),
        ], $access->actor($feedbackProject));
        $feedbackReport->markReadByOwner();

        return redirect()
            ->to(route('feedback.reports.show', [$feedbackProject, $feedbackReport]).'#adjustment')
            ->with('success', '已更新調整重點。');
    }
}
