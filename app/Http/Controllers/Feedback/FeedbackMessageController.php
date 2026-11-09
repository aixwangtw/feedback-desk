<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\ManageFeedbackMessageAction;
use App\Actions\PostFeedbackMessageAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StoreFeedbackMessageRequest;
use App\Http\Requests\Feedback\UpdateFeedbackMessageRequest;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

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

        $actor = $this->actor($access, $feedbackProject, $feedbackReport);

        $previous = $feedbackReport->status;
        $postMessage->handle($feedbackReport, $actor, $validated['body'], $validated['screenshots'] ?? []);
        $notice = '訊息已送出。'.($actor->isTeam && $feedbackReport->status !== $previous ? PostFeedbackMessageAction::statusChangeNotice($feedbackProject) : '');

        if ($request->expectsJson()) {
            return response()->json(['message' => $notice, 'status' => $feedbackReport->status->value], 201);
        }

        return back()->with('success', $notice);
    }

    /**
     * 編輯自己的留言（內文、增減附件）。不顯示「已編輯」、不改單的狀態。
     */
    public function update(
        UpdateFeedbackMessageRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessage $feedbackMessage,
        FeedbackAccess $access,
        ManageFeedbackMessageAction $manage,
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $validated = $request->validated();

        try {
            $manage->edit(
                $feedbackReport,
                $feedbackMessage,
                $this->actor($access, $feedbackProject, $feedbackReport),
                $validated['body'],
                $validated['screenshots'] ?? [],
                array_map('intval', $validated['remove_attachments'] ?? []),
            );
        } catch (FeedbackServiceException $exception) {
            abort($exception->status, $exception->getMessage());
        }

        return $request->expectsJson() ? response()->json(['message' => '留言已更新。']) : back();
    }

    /**
     * 收回自己的留言：直接從畫面消失，沒有任何痕跡。
     */
    public function destroy(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessage $feedbackMessage,
        FeedbackAccess $access,
        ManageFeedbackMessageAction $manage,
    ): RedirectResponse|JsonResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        abort_unless($access->canView($feedbackReport) && $access->ensureReportVisible($feedbackReport), 403);

        try {
            $manage->withdraw($feedbackReport, $feedbackMessage, $this->actor($access, $feedbackProject, $feedbackReport));
        } catch (FeedbackServiceException $exception) {
            abort($exception->status, $exception->getMessage());
        }

        return $request->expectsJson() ? response()->json(['message' => '留言已收回。']) : back();
    }

    /**
     * 私密網址回報者（沒有專案登入）照舊記成客戶端；公開回報者用他自己填的稱呼。
     */
    private function actor(FeedbackAccess $access, FeedbackProject $project, FeedbackReport $report): FeedbackActor
    {
        return match (true) {
            $access->canManage($project) => $access->actor($project),
            $report->isPublicReport() => new FeedbackActor($report->reporter_name ?: '公開回報者', false),
            default => FeedbackActor::sharedClient(),
        };
    }
}
