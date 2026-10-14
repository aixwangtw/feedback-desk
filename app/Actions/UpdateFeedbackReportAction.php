<?php

namespace App\Actions;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackReport;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class UpdateFeedbackReportAction
{
    /**
     * @param  array{title: string, description: string, screenshots?: list<UploadedFile>, remove_attachments?: list<int|string>}  $data
     */
    public function handle(FeedbackReport $report, array $data): FeedbackReport
    {
        $storedPaths = [];

        try {
            $removedAttachments = DB::transaction(function () use ($report, $data, &$storedPaths) {
                $report->update([
                    'title' => $data['title'],
                    'description' => $data['description'],
                    'latest_activity_at' => now(),
                ]);

                $removedAttachments = $report->feedbackAttachments()
                    ->whereNull('feedback_message_id')
                    ->whereIn('id', $data['remove_attachments'] ?? [])
                    ->get();
                $removedAttachments->each->delete();

                foreach ($data['screenshots'] ?? [] as $screenshot) {
                    $path = $screenshot->store(
                        "feedback/{$report->feedback_project_id}/{$report->public_id}",
                        config('feedback.disk'),
                    );
                    $storedPaths[] = $path;

                    $report->feedbackAttachments()->create([
                        'disk' => config('feedback.disk'),
                        'path' => $path,
                        'original_name' => $screenshot->getClientOriginalName(),
                        'mime_type' => $screenshot->getMimeType() ?? 'application/octet-stream',
                        'size' => $screenshot->getSize(),
                    ]);
                }

                return $removedAttachments;
            });
        } catch (\Throwable $exception) {
            Storage::disk(config('feedback.disk'))->delete($storedPaths);

            throw $exception;
        }

        $removedAttachments->each(
            fn (FeedbackAttachment $attachment) => Storage::disk($attachment->disk)->delete($attachment->path),
        );

        return $report->refresh();
    }
}
