<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\UpdateFeedbackAdjustmentRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackCompletionRequest;
use Illuminate\Http\JsonResponse;

/**
 * 調整重點已停用：網頁不能再編輯，一律回 410。舊內容照舊在詳情裡唯讀顯示（過去的處理說明）。
 * 巡檢 API、artisan、MCP 的寫入入口暫時保留（照常寫入並附警告），見 FeedbackCompletionRequest::ADJUSTMENT_DEPRECATED。
 */
class FeedbackAdjustmentController extends Controller
{
    public function update(UpdateFeedbackAdjustmentRequest $request, FeedbackProject $feedbackProject, FeedbackReport $feedbackReport): JsonResponse
    {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);

        return response()->json(['message' => FeedbackCompletionRequest::ADJUSTMENT_WEB_DISABLED, 'error' => 'adjustment_disabled'], 410);
    }
}
