<?php

namespace App\Actions;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackReport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class DeleteFeedbackReportAction
{
    /**
     * Permanently delete a report together with its messages, automation runs,
     * attachment rows and the stored screenshot files.
     */
    public function handle(FeedbackReport $report): void
    {
        $attachments = $report->feedbackAttachments()->get(['id', 'disk', 'path']);

        DB::transaction(function () use ($report): void {
            $report->feedbackAttachments()->delete();
            $report->feedbackMessages()->delete();
            $report->automationRuns()->delete();
            $report->delete();
        });

        $attachments->each(
            fn (FeedbackAttachment $attachment) => Storage::disk($attachment->disk)->delete($attachment->path),
        );

        $directory = "feedback/{$report->feedback_project_id}/{$report->public_id}";
        $disk = Storage::disk(config('feedback.disk'));
        if ($disk->directoryExists($directory) && $disk->allFiles($directory) === []) {
            $disk->deleteDirectory($directory);
        }
    }
}
