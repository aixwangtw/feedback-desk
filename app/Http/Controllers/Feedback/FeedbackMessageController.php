<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\PostFeedbackMessageAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StoreFeedbackMessageRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

class FeedbackMessageController extends Controller
{
    public function store(
        StoreFeedbackMessageRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
        PostFeedbackMessageAction $postMessage,
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $validated = $request->validated();

        // 私密網址回報者（沒有專案登入）照舊記成客戶端；公開回報者用他自己填的稱呼。
        $actor = match (true) {
            $access->canManage($feedbackProject) => $access->actor($feedbackProject),
            $feedbackReport->isPublicReport() => new FeedbackActor($feedbackReport->reporter_name ?: '公開回報者', false),
            default => FeedbackActor::sharedClient(),
        };

        $postMessage->handle($feedbackReport, $actor, $validated['body'], $validated['screenshots'] ?? []);

        if ($request->expectsJson()) {
            return response()->json(['message' => '訊息已送出。'], 201);
        }

        return back()->with('success', '訊息已送出。');
    }
}
