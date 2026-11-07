<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackFileStreamer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class FeedbackAttachmentController extends Controller
{
    public function show(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAttachment $feedbackAttachment,
        FeedbackAccess $access,
        FeedbackFileStreamer $streamer,
    ): Response {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        abort_unless($feedbackAttachment->feedback_report_id === $feedbackReport->id, 404);
        // 收回的留言：附件網址一併失效。
        abort_if($feedbackAttachment->feedback_message_id !== null && ! FeedbackMessage::whereKey($feedbackAttachment->feedback_message_id)->exists(), 404);
        if (! $access->canView($feedbackReport)) {
            $access->deny($feedbackProject);
        }
        $access->ensureReportVisible($feedbackReport);

        return $this->stream($request, $feedbackAttachment, $streamer);
    }

    /**
     * 簽章網址下載（MCP 給 AI 工具用）；網址本身就是授權，一小時後失效。
     */
    public function download(
        Request $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAttachment $feedbackAttachment,
        FeedbackFileStreamer $streamer,
    ): Response {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        abort_unless($feedbackAttachment->feedback_report_id === $feedbackReport->id, 404);
        // 收回的留言：附件網址一併失效。
        abort_if($feedbackAttachment->feedback_message_id !== null && ! FeedbackMessage::whereKey($feedbackAttachment->feedback_message_id)->exists(), 404);

        return $this->stream($request, $feedbackAttachment, $streamer);
    }

    private function stream(Request $request, FeedbackAttachment $feedbackAttachment, FeedbackFileStreamer $streamer): Response
    {
        return $streamer->respond(
            $request,
            $feedbackAttachment->disk,
            $feedbackAttachment->path,
            $feedbackAttachment->mime_type,
            $feedbackAttachment->original_name,
            $feedbackAttachment->isVideo(),
        );
    }
}
