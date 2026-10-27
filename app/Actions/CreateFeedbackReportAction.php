<?php

namespace App\Actions;

use App\Enums\FeedbackCreatorType;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateFeedbackReportAction
{
    /**
     * @param  array{title: string, description: string, reporter_name?: string|null, category?: string|null, screenshots?: list<UploadedFile>}  $data
     * @param  array{creator_type: FeedbackCreatorType, creator_developer_id: int|null, creator_client_account_id?: int|null}  $creator
     * @param  FeedbackActor|null  $actor  寫進最近動態與附件上傳者的帳號、AI 工具；公開回報不記
     * @return array{report: FeedbackReport, reporter_token: string}
     */
    public function handle(FeedbackProject $project, array $data, array $creator, ?FeedbackActor $actor = null): array
    {
        $reporterToken = Str::random(48);

        $report = DB::transaction(function () use ($project, $data, $reporterToken, $creator, $actor): FeedbackReport {
            $report = $project->feedbackReports()->create([
                'public_id' => (string) Str::uuid(),
                'reporter_token_hash' => hash('sha256', $reporterToken),
                'creator_type' => $creator['creator_type'],
                'creator_developer_id' => $creator['creator_developer_id'],
                'creator_client_account_id' => $creator['creator_client_account_id'] ?? null,
                'creator_agent' => $actor?->agent,
                'reporter_name' => $data['reporter_name'] ?? null,
                'category' => $data['category'] ?? null,
                'title' => $data['title'],
                'description' => $data['description'],
                'latest_activity_at' => now(),
                // 建立者自己那一端視為已讀；客戶建立的單要等開發者開啟才算讀過。
                'client_last_read_at' => now(),
                'owner_last_read_at' => in_array($creator['creator_type'], [FeedbackCreatorType::Client, FeedbackCreatorType::Public], true) ? null : now(),
            ]);

            foreach ($data['screenshots'] ?? [] as $screenshot) {
                $path = $screenshot->store("feedback/{$project->id}/{$report->public_id}", config('feedback.disk'));

                $report->feedbackAttachments()->create([
                    'disk' => config('feedback.disk'),
                    'path' => $path,
                    'original_name' => $screenshot->getClientOriginalName(),
                    'mime_type' => $screenshot->getMimeType() ?? 'application/octet-stream',
                    'size' => $screenshot->getSize(),
                    'uploader_client_account_id' => $actor?->clientAccount?->id,
                    'uploader_developer_id' => $actor?->developer?->id,
                ]);
            }

            if ($actor !== null) {
                $report->recordEvent('created', $actor);
            }

            // 客戶帳號自己開的單，對這個帳號一開始就是讀過的。
            if ($actor?->clientAccount !== null) {
                $report->markReadByClient($actor->clientAccount);
            }

            return $report;
        });

        // 陌生人寫的文字不能直接驅動自動處理。
        if ($creator['creator_type'] !== FeedbackCreatorType::Public && $project->automation_enabled && config('feedback.automation.enabled')) {
            $run = $report->automationRuns()->create();
            ResolveFeedbackReport::dispatch($report, $run)->afterCommit();
        }

        return ['report' => $report, 'reporter_token' => $reporterToken];
    }
}
