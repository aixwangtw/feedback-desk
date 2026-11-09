<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\RequestFeedbackCompletionAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\RequestFeedbackCompletionRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackCompletionRequest;
use App\Support\FeedbackServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

/**
 * 開發團隊的「完成」：只發確認留言請老師確認，單不會被結案（老師按留言上的「通過」才完成）。
 */
class FeedbackCompletionRequestController extends Controller
{
    public function store(
        RequestFeedbackCompletionRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
        RequestFeedbackCompletionAction $requestCompletion,
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);

        try {
            $message = $requestCompletion->handle($feedbackReport, $access->actor($feedbackProject), $request->validated('body'));
        } catch (FeedbackServiceException $exception) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $exception->getMessage(), 'error' => $exception->errorCode], $exception->status);
            }

            return back()->withErrors(['completion' => $exception->getMessage()]);
        }

        if ($request->expectsJson()) {
            return response()->json([
                'message' => FeedbackCompletionRequest::sentNotice($feedbackProject),
                'status' => $feedbackReport->status->value,
                'message_id' => $message->id,
            ], 201);
        }

        return back()->with('success', FeedbackCompletionRequest::sentNotice($feedbackProject));
    }
}
