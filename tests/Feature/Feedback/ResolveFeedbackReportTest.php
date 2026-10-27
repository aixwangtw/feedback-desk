<?php

namespace Tests\Feature\Feedback;

use App\Contracts\FeedbackCodingAgent;
use App\Enums\FeedbackAutomationStatus;
use App\Enums\FeedbackReportStatus;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackCodingResult;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

class ResolveFeedbackReportTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_successful_agent_run_marks_report_needs_input_and_records_result(): void
    {
        $project = FeedbackProject::factory()->create(['automation_enabled' => true]);
        $report = FeedbackReport::factory()->for($project)->create();
        $run = FeedbackAutomationRun::factory()->for($report)->create();

        $this->app->bind(FeedbackCodingAgent::class, fn () => new class implements FeedbackCodingAgent
        {
            public function name(): string
            {
                return 'Codex';
            }

            public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult
            {
                return new FeedbackCodingResult(
                    FeedbackAutomationStatus::Completed,
                    '已修正手機版儲存流程。',
                    ['php artisan test --compact tests/Feature/SaveAnswerTest.php'],
                    0,
                    '/tmp/trace.log',
                );
            }
        });

        app()->call([new ResolveFeedbackReport($report, $run), 'handle']);

        $report->refresh();
        $run->refresh();

        // AI 修好只改成待審核，已完成要等提出的人或負責人確認。
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->status);
        $this->assertNull($report->completed_at);
        $this->assertSame(FeedbackAutomationStatus::Completed, $run->status);
        $this->assertSame('已修正手機版儲存流程。', $run->summary);
        $this->assertSame('Vibe coding', $report->feedbackMessages()->sole()->author_name);
    }

    public function test_agent_can_request_more_information_without_marking_report_completed(): void
    {
        $project = FeedbackProject::factory()->create(['automation_enabled' => true]);
        $report = FeedbackReport::factory()->for($project)->create();
        $run = FeedbackAutomationRun::factory()->for($report)->create();

        $this->app->bind(FeedbackCodingAgent::class, fn () => new class implements FeedbackCodingAgent
        {
            public function name(): string
            {
                return 'Codex';
            }

            public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult
            {
                return new FeedbackCodingResult(
                    FeedbackAutomationStatus::NeedsInput,
                    '需要回報者提供可重現問題的頁面網址。',
                );
            }
        });

        app()->call([new ResolveFeedbackReport($report, $run), 'handle']);

        $report->refresh();
        $run->refresh();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->status);
        $this->assertNull($report->completed_at);
        $this->assertSame(FeedbackAutomationStatus::NeedsInput, $run->status);
        $this->assertStringContainsString(
            '需要回報者提供',
            $report->feedbackMessages()->sole()->body,
        );
    }

    public function test_failed_agent_run_is_recorded_on_the_run_and_keeps_the_report_status(): void
    {
        $project = FeedbackProject::factory()->create(['automation_enabled' => true]);
        $report = FeedbackReport::factory()->for($project)->create();
        $run = FeedbackAutomationRun::factory()->for($report)->create();

        $this->app->bind(FeedbackCodingAgent::class, fn () => new class implements FeedbackCodingAgent
        {
            public function name(): string
            {
                return 'Codex';
            }

            public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult
            {
                return new FeedbackCodingResult(FeedbackAutomationStatus::Failed, '無法修正。');
            }
        });

        app()->call([new ResolveFeedbackReport($report, $run), 'handle']);
        (new ResolveFeedbackReport($report, $run))->failed(new \RuntimeException('boom'));

        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);
        $this->assertSame(FeedbackAutomationStatus::Failed, $run->refresh()->status);
    }

    public function test_failed_still_records_a_message_when_the_driver_setting_is_invalid(): void
    {
        $project = FeedbackProject::factory()->create(['automation_enabled' => true]);
        $report = FeedbackReport::factory()->for($project)->create();
        $run = FeedbackAutomationRun::factory()->for($report)->create();
        config(['feedback.automation.driver' => 'gemini']);

        (new ResolveFeedbackReport($report, $run))->failed(new \InvalidArgumentException('不支援的自動處理驅動：gemini'));

        $this->assertSame(FeedbackAutomationStatus::Failed, $run->refresh()->status);
        $message = $report->feedbackMessages()->sole();
        $this->assertSame('gemini', $message->author_agent);
        $this->assertStringContainsString('不支援的自動處理驅動', $message->body);
    }
}
