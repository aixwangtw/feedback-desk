<?php

namespace App\Actions;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackCompletionRequest;
use App\Support\FeedbackServiceException;
use Illuminate\Http\UploadedFile;

/**
 * 開發團隊請老師確認完成：發一則確認留言（附「通過」按鈕），單不會被結案。
 * 網頁、artisan、MCP、巡檢 API 共用；已完成只由老師按「通過」（ChangeFeedbackReportStatusAction 經狀態端點）決定。
 */
class RequestFeedbackCompletionAction
{
    public function __construct(private PostFeedbackMessageAction $postMessage) {}

    /**
     * @param  list<UploadedFile>  $screenshots
     *
     * @throws FeedbackServiceException
     */
    public function handle(FeedbackReport $report, FeedbackActor $actor, ?string $body = null, array $screenshots = []): FeedbackMessage
    {
        if (! $actor->isTeam) {
            throw new FeedbackServiceException('team_only', '只有開發團隊能請'.$report->feedbackProject->clientRole().'確認完成。', 403);
        }
        if ($report->status === FeedbackReportStatus::Completed) {
            throw new FeedbackServiceException('already_completed', '這張單已經完成，不用再請'.$report->feedbackProject->clientRole().'確認。');
        }

        $body = trim((string) $body);
        if ($body === '') {
            $body = FeedbackCompletionRequest::defaultBody($report->feedbackProject);
        }
        if (mb_strlen($body) > PostFeedbackMessageAction::MAX_BODY_LENGTH) {
            throw new FeedbackServiceException('body_too_long', '留言內容不能超過 '.PostFeedbackMessageAction::MAX_BODY_LENGTH.' 字。');
        }

        return $this->postMessage->handle($report, $actor, $body, $screenshots, isCompletionRequest: true);
    }
}
