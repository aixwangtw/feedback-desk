<?php

namespace App\Actions;

use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackAttachmentRules;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateFeedbackReportAction
{
    public function __construct(private MergeFeedbackReportAction $mergeReport) {}

    /**
     * @param  array{title: string, description: string, reporter_name?: string|null, category?: string|null, shared_with_client?: bool, screenshots?: list<UploadedFile>}  $data
     * @param  array{creator_type: FeedbackCreatorType, creator_developer_id: int|null, creator_client_account_id?: int|null}  $creator
     * @param  FeedbackActor|null  $actor  寫進最近動態與附件上傳者的帳號、AI 工具；公開回報不記
     * @return array{report: FeedbackReport, reporter_token: string, merged_into: FeedbackReport|null}
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
                'shared_with_client' => (bool) ($data['shared_with_client'] ?? false),
                'reporter_name' => $data['reporter_name'] ?? null,
                'category' => $data['category'] ?? null,
                'title' => $data['title'],
                'description' => $data['description'],
                'latest_activity_at' => now(),
                // 建立者自己那一端視為已讀；客戶建立的單要等開發者開啟才算讀過，團隊開給客戶看的單要等客戶開啟才算讀過。
                'client_last_read_at' => ($data['shared_with_client'] ?? false) ? null : now(),
                'owner_last_read_at' => in_array($creator['creator_type'], [FeedbackCreatorType::Client, FeedbackCreatorType::Public], true) ? null : now(),
            ]);

            foreach ($data['screenshots'] ?? [] as $screenshot) {
                $path = $screenshot->store("feedback/{$project->id}/{$report->public_id}", config('feedback.disk'));

                $report->feedbackAttachments()->create([
                    'disk' => config('feedback.disk'),
                    'path' => $path,
                    'original_name' => $screenshot->getClientOriginalName(),
                    'mime_type' => FeedbackAttachmentRules::storedMime($screenshot->getMimeType()),
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

        // 同一個人短時間內重複送出一樣的單（例如按了兩次送出）：併進先送出的那張，不另派自動處理。
        $original = $this->findDuplicateOf($report);
        if ($original !== null) {
            $this->mergeReport->handle($report, $original, $actor);

            return ['report' => $report->refresh(), 'reporter_token' => $reporterToken, 'merged_into' => $original];
        }

        // 陌生人寫的文字不能直接驅動自動處理。
        if ($creator['creator_type'] !== FeedbackCreatorType::Public && $project->automation_enabled && config('feedback.automation.enabled')) {
            $run = $report->automationRuns()->create();
            ResolveFeedbackReport::dispatch($report, $run)->afterCommit();
        }

        return ['report' => $report, 'reporter_token' => $reporterToken, 'merged_into' => null];
    }

    /**
     * 客戶建立的單才自動合併（公開回報與開發團隊的單不合併）：同專案、同一個客戶帳號（沒有帳號的不合併，共用連結可能是不同人）、
     * 標題與說明去頭尾空白後完全相同、在合併時限內建立、還沒刪除、合併或完成的較早一張（已完成的單不併進去，新單照常保留）。
     */
    private function findDuplicateOf(FeedbackReport $report): ?FeedbackReport
    {
        if ($report->creator_type !== FeedbackCreatorType::Client || $report->creator_client_account_id === null) {
            return null;
        }

        $title = trim($report->title);
        $description = trim($report->description);

        return FeedbackReport::query()
            ->where('feedback_project_id', $report->feedback_project_id)
            ->where('creator_type', FeedbackCreatorType::Client->value)
            ->where('creator_client_account_id', $report->creator_client_account_id)
            ->where('status', '!=', FeedbackReportStatus::Completed->value)
            ->whereKeyNot($report->id)
            ->where('id', '<', $report->id)
            ->whereNull('client_deleted_at')
            ->whereNull('merged_into_report_id')
            ->where('created_at', '>=', now()->subMinutes(MergeFeedbackReportAction::AUTO_MERGE_MINUTES))
            ->orderBy('id')
            ->get(['id', 'title', 'description'])
            ->first(fn (FeedbackReport $candidate): bool => trim($candidate->title) === $title && trim($candidate->description) === $description);
    }
}
