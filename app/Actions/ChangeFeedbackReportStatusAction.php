<?php

namespace App\Actions;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;

/**
 * 改變回饋單狀態；網頁與 artisan 指令共用，完成時間與最後活動時間的規則只在這裡。
 */
class ChangeFeedbackReportStatusAction
{
    public function handle(FeedbackReport $report, FeedbackReportStatus $status, ?FeedbackActor $actor = null): FeedbackReport
    {
        $previous = $report->status;

        $report->update([
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null,
            'latest_activity_at' => now(),
        ]);

        if ($actor !== null && $previous !== $status) {
            $report->recordEvent('status', $actor, "{$previous->value}>{$status->value}");
        }

        return $report;
    }
}
