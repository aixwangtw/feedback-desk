<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\ManageFeedbackMessageDraftAction;
use App\Actions\PostFeedbackMessageAction;
use App\Http\Controllers\Controller;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * 單頁上的待審留言：編輯、送出、捨棄、看附圖。只有開發團隊能操作，客戶端一律 403。
 */
class FeedbackMessageDraftController extends Controller
{
    public function update(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessageDraft $feedbackMessageDraft,
        FeedbackAccess $access,
        ManageFeedbackMessageDraftAction $drafts,
    ): RedirectResponse|JsonResponse {
        $this->authorizeDraft($feedbackProject, $feedbackReport, $feedbackMessageDraft, $access);
        $validated = $request->validateWithBag('draft'.$feedbackMessageDraft->id, [
            'body' => ['required', 'string', 'max:'.PostFeedbackMessageAction::MAX_BODY_LENGTH],
        ], [], ['body' => '待審留言內容']);

        try {
            $drafts->update($feedbackMessageDraft, $validated['body']);
        } catch (FeedbackServiceException $exception) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $exception->getMessage(), 'errors' => ['body' => [$exception->getMessage()]]], 422);
            }

            return back()->withErrors(['body' => $exception->getMessage()], 'draft'.$feedbackMessageDraft->id);
        }

        if ($request->expectsJson()) {
            return response()->json(['message' => '待審留言已更新，尚未送出。']);
        }

        return $this->backToDrafts($feedbackProject, $feedbackReport, '待審留言已更新，尚未送出。');
    }

    public function send(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessageDraft $feedbackMessageDraft,
        FeedbackAccess $access,
        ManageFeedbackMessageDraftAction $drafts,
    ): RedirectResponse|JsonResponse {
        $this->authorizeDraft($feedbackProject, $feedbackReport, $feedbackMessageDraft, $access);
        $replaces = $feedbackMessageDraft->replaces_message_id !== null;
        // 對話面板會帶上輸入框裡（可能改過）的文字；單頁的「送出」不帶，照草稿原文。
        $request->validate(['body' => ['sometimes', 'string', 'max:'.PostFeedbackMessageAction::MAX_BODY_LENGTH]], [], ['body' => '留言內容']);
        $editedBody = $request->has('body') ? (string) $request->input('body') : null;
        $previous = $feedbackReport->status;

        try {
            $drafts->send($feedbackMessageDraft, $access->actor($feedbackProject), $editedBody);
        } catch (FeedbackServiceException $exception) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $exception->getMessage(), 'errors' => ['body' => [$exception->getMessage()]]], 422);
            }

            return back()->with('error', $exception->getMessage());
        }

        $feedbackReport->refresh();
        $notice = ($replaces ? '已修改原留言。' : '留言已送出。').($feedbackReport->status !== $previous ? PostFeedbackMessageAction::statusChangeNotice() : '');

        if ($request->expectsJson()) {
            return response()->json(['message' => $notice, 'status' => $feedbackReport->status->value]);
        }

        return redirect()
            ->to(route('feedback.reports.show', [$feedbackProject, $feedbackReport]).'#conversation')
            ->with('success', $notice);
    }

    public function destroy(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessageDraft $feedbackMessageDraft,
        FeedbackAccess $access,
        ManageFeedbackMessageDraftAction $drafts,
    ): RedirectResponse|JsonResponse {
        $this->authorizeDraft($feedbackProject, $feedbackReport, $feedbackMessageDraft, $access);
        $drafts->discard($feedbackMessageDraft);

        if ($request->expectsJson()) {
            return response()->json(['message' => '已捨棄待審留言。']);
        }

        return $this->backToDrafts($feedbackProject, $feedbackReport, '已捨棄待審留言。');
    }

    public function file(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackMessageDraft $feedbackMessageDraft,
        int $index,
        FeedbackAccess $access,
    ): StreamedResponse {
        $this->authorizeDraft($feedbackProject, $feedbackReport, $feedbackMessageDraft, $access);
        $file = $feedbackMessageDraft->attachmentList()[$index] ?? null;
        abort_if($file === null, 404);

        return Storage::disk($file['disk'])->response($file['path'], $file['original_name'], [
            'Content-Type' => $file['mime_type'],
            'Content-Disposition' => 'inline',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function authorizeDraft(FeedbackProject $project, FeedbackReport $report, FeedbackMessageDraft $draft, FeedbackAccess $access): void
    {
        abort_unless($access->isOwner($project), 403);
        abort_unless($report->feedback_project_id === $project->id, 404);
        abort_unless($draft->feedback_report_id === $report->id, 404);
    }

    private function backToDrafts(FeedbackProject $project, FeedbackReport $report, string $status): RedirectResponse
    {
        return redirect()
            ->to(route('feedback.reports.show', [$project, $report]).'#message-drafts')
            ->with('success', $status);
    }
}
