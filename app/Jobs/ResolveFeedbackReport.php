<?php

namespace App\Jobs;

use App\Contracts\FeedbackCodingAgent;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackAutomationStatus;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Throwable;

class ResolveFeedbackReport implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 3300;

    /** @var list<int> */
    public array $backoff = [60, 300, 900];

    public function __construct(
        public FeedbackReport $report,
        public FeedbackAutomationRun $run,
    ) {
        $this->onQueue(config('feedback.automation.queue'));
    }

    public function handle(FeedbackCodingAgent $codingAgent): void
    {
        $this->report->loadMissing('feedbackProject', 'feedbackAttachments');
        $this->run->update([
            'status' => FeedbackAutomationStatus::Running,
            'started_at' => now(),
        ]);
        $this->report->update(['latest_activity_at' => now()]);

        try {
            $result = $codingAgent->resolve($this->report, $this->run);
        } catch (Throwable $exception) {
            $this->run->update([
                'status' => FeedbackAutomationStatus::Failed,
                'finished_at' => now(),
                'summary' => $exception->getMessage(),
            ]);

            throw $exception;
        }

        $reportStatus = match ($result->status) {
            FeedbackAutomationStatus::Completed => FeedbackReportStatus::Completed,
            FeedbackAutomationStatus::NeedsInput => FeedbackReportStatus::NeedsInput,
            default => null,
        };
        $message = $result->summary;
        if ($result->tests !== []) {
            $message .= "\n\n驗證：\n- ".implode("\n- ", $result->tests);
        }

        DB::transaction(function () use ($result, $reportStatus, $message): void {
            $this->run->update([
                'status' => $result->status,
                'finished_at' => now(),
                'exit_code' => $result->exitCode,
                'summary' => $result->summary,
                'result' => $result->toArray(),
                'trace_path' => $result->tracePath,
            ]);

            $this->report->feedbackMessages()->create([
                'author_type' => FeedbackAuthorType::Agent,
                'author_name' => 'Vibe coding',
                'body' => $message,
            ]);

            $this->report->update([
                'status' => $reportStatus ?? $this->report->status,
                'completed_at' => $reportStatus === null ? $this->report->completed_at : ($reportStatus === FeedbackReportStatus::Completed ? now() : null),
                'latest_activity_at' => now(),
            ]);
        });
    }

    /** @return list<WithoutOverlapping> */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping("feedback-project-{$this->report->feedback_project_id}"))
                ->releaseAfter(30)
                ->expireAfter(3600),
        ];
    }

    public function failed(?Throwable $exception): void
    {
        $summary = $exception?->getMessage() ?? '自動處理失敗，請由'.config('feedback.labels.owner').'檢查執行紀錄。';

        DB::transaction(function () use ($summary): void {
            $this->run->update([
                'status' => FeedbackAutomationStatus::Failed,
                'finished_at' => now(),
                'summary' => $summary,
            ]);
            $this->report->feedbackMessages()->create([
                'author_type' => FeedbackAuthorType::Agent,
                'author_name' => 'Vibe coding',
                'body' => '自動處理未完成：'.$summary,
            ]);
            $this->report->update(['latest_activity_at' => now()]);
        });
    }
}
