<?php

namespace App\Actions;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;

/**
 * 改變回饋單狀態；網頁與 artisan 指令共用，完成時間與最後活動時間的規則只在這裡。
 *
 * 事件種類預設 status；客戶把單改回等工程師時另記 reopen_by_message（已完成的單客戶又留言）
 * 或 reopen_by_client（客戶在留言區按「待處理」），團隊與巡檢看得出是誰、為什麼重新開啟。
 */
class ChangeFeedbackReportStatusAction
{
    public const EVENT_STATUS = 'status';

    public const EVENT_REOPEN_BY_MESSAGE = 'reopen_by_message';

    public const EVENT_REOPEN_BY_CLIENT = 'reopen_by_client';

    public function handle(FeedbackReport $report, FeedbackReportStatus $status, ?FeedbackActor $actor = null, string $eventKind = self::EVENT_STATUS): FeedbackReport
    {
        $previous = $report->status;

        $report->update([
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null,
            'latest_activity_at' => now(),
        ]);

        if ($actor !== null && $previous !== $status) {
            $report->recordEvent($eventKind, $actor, "{$previous->value}>{$status->value}");
        }

        return $report;
    }
}
