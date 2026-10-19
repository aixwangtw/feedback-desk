<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FeedbackAttachmentController extends Controller
{
    public function show(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAttachment $feedbackAttachment,
        FeedbackAccess $access,
    ): StreamedResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        abort_unless($feedbackAttachment->feedback_report_id === $feedbackReport->id, 404);
        if (! $access->canView($feedbackReport)) {
            $access->deny($feedbackProject);
        }
        $access->ensureReportVisible($feedbackReport);

        return $this->stream($feedbackAttachment);
    }

    /**
     * 簽章網址下載（MCP 給 AI 工具用）；網址本身就是授權，一小時後失效。
     */
    public function download(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAttachment $feedbackAttachment,
    ): StreamedResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        abort_unless($feedbackAttachment->feedback_report_id === $feedbackReport->id, 404);

        return $this->stream($feedbackAttachment);
    }

    private function stream(FeedbackAttachment $feedbackAttachment): StreamedResponse
    {
        return Storage::disk($feedbackAttachment->disk)->response(
            $feedbackAttachment->path,
            $feedbackAttachment->original_name,
            [
                'Content-Type' => $feedbackAttachment->mime_type,
                'Content-Disposition' => 'inline',
                'X-Content-Type-Options' => 'nosniff',
            ],
        );
    }
}
