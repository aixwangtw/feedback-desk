<?php

namespace App\Actions;

use App\Enums\FeedbackCreatorType;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateFeedbackReportAction
{
    /**
     * @param  array{title: string, description: string, screenshots?: list<UploadedFile>}  $data
     * @param  array{creator_type: FeedbackCreatorType, creator_developer_id: int|null}  $creator
     * @return array{report: FeedbackReport, reporter_token: string}
     */
    public function handle(FeedbackProject $project, array $data, array $creator): array
    {
        $reporterToken = Str::random(48);

        $report = DB::transaction(function () use ($project, $data, $reporterToken, $creator): FeedbackReport {
            $report = $project->feedbackReports()->create([
                'public_id' => (string) Str::uuid(),
                'reporter_token_hash' => hash('sha256', $reporterToken),
                'creator_type' => $creator['creator_type'],
                'creator_developer_id' => $creator['creator_developer_id'],
                'title' => $data['title'],
                'description' => $data['description'],
                'latest_activity_at' => now(),
            ]);

            foreach ($data['screenshots'] ?? [] as $screenshot) {
                $path = $screenshot->store("feedback/{$project->id}/{$report->public_id}", config('feedback.disk'));

                $report->feedbackAttachments()->create([
                    'disk' => config('feedback.disk'),
                    'path' => $path,
                    'original_name' => $screenshot->getClientOriginalName(),
                    'mime_type' => $screenshot->getMimeType() ?? 'application/octet-stream',
                    'size' => $screenshot->getSize(),
                ]);
            }

            return $report;
        });

        if ($project->automation_enabled && config('feedback.automation.enabled')) {
            $run = $report->automationRuns()->create();
            ResolveFeedbackReport::dispatch($report, $run)->afterCommit();
        }

        return ['report' => $report, 'reporter_token' => $reporterToken];
    }
}
