<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackReportNumberTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_numbers_follow_creation_order_and_stay_fixed_when_sorting(): void
    {
        [$project, $first, $second, $third] = $this->projectWithReports();

        foreach (['asc', 'desc'] as $direction) {
            $html = $this->get(route('feedback.portal', $project).'?sort=title&direction='.$direction)->assertOk()->getContent();

            $this->assertSame(3, $this->numberOf($html, $first));
            $this->assertSame(2, $this->numberOf($html, $second));
            $this->assertSame(1, $this->numberOf($html, $third));
        }
    }

    public function test_numbers_stay_fixed_when_filtering_and_count_text_shows_filtered_total(): void
    {
        [$project, , $second, $third] = $this->projectWithReports();
        $third->update(['status' => FeedbackReportStatus::Completed]);

        $this->get(route('feedback.portal', $project))->assertSee('共 3 題', false)->assertDontSee('篩選後', false);

        $response = $this->get(route('feedback.portal', $project).'?status=completed')
            ->assertSee('共 3 題（篩選後 1 題）', false);
        $html = $response->getContent();

        $this->assertSame(1, $this->numberOf($html, $third));
        $this->assertStringNotContainsString('data-report-row="'.$second->public_id.'"', $html);
    }

    public function test_numbers_are_consecutive_after_deletion_and_scoped_to_project(): void
    {
        [$project, $first, $second, $third] = $this->projectWithReports();
        $other = FeedbackProject::factory()->create();
        FeedbackReport::factory()->for($other)->create(['created_at' => now()->subDays(10)]);

        $third->delete();

        $html = $this->get(route('feedback.portal', $project))->assertSee('共 2 題', false)->getContent();
        $this->assertSame(1, $this->numberOf($html, $second));
        $this->assertSame(2, $this->numberOf($html, $first));

        $this->get(route('feedback.reports.show', [$project, $second]))->assertSee('data-report-number>1<', false);
    }

    public function test_default_order_lists_numbers_from_one_downwards(): void
    {
        [$project] = $this->projectWithReports();

        $html = $this->get(route('feedback.portal', $project))->assertOk()->getContent();
        preg_match_all('/data-report-number>(\d+)</', $html, $matches);

        $this->assertSame(['1', '2', '3'], $matches[1]);
        $this->assertMatchesRegularExpression('/<option value="created_at" selected/', $html);
    }

    public function test_detail_page_shows_the_same_number(): void
    {
        [$project, , $second] = $this->projectWithReports();

        $this->get(route('feedback.reports.show', [$project, $second]))
            ->assertOk()
            ->assertSee('data-report-number>2<', false);
    }

    public function test_status_summary_counts_whole_project_and_hides_empty_optional_statuses(): void
    {
        [$project, $first, $second, $third] = $this->projectWithReports();
        $second->update(['status' => FeedbackReportStatus::Completed]);
        $third->update(['status' => FeedbackReportStatus::Completed]);
        FeedbackReport::factory()->for(FeedbackProject::factory()->create())->create(['status' => FeedbackReportStatus::Failed]);

        foreach (['', '?status=completed'] as $query) {
            $this->get(route('feedback.portal', $project).$query)
                ->assertSee('待處理 1 題', false)
                ->assertSee('待補充 0 題', false)
                ->assertSee('已完成 2 題', false)
                ->assertDontSee('data-status-summary-item="in_progress"', false)
                ->assertDontSee('data-status-summary-item="failed"', false)
                ->assertSee('?status=completed" class="rounded', false);
        }

        $first->update(['status' => FeedbackReportStatus::Failed]);
        $this->get(route('feedback.portal', $project))->assertSee('data-status-summary-item="failed"', false);
    }

    /**
     * @return array{FeedbackProject, FeedbackReport, FeedbackReport, FeedbackReport}
     */
    private function projectWithReports(): array
    {
        $token = Str::random(48);
        $project = FeedbackProject::factory()->create(['client_token_hash' => hash('sha256', $token)]);
        $first = FeedbackReport::factory()->for($project)->create(['title' => 'C 最早', 'created_at' => now()->subDays(3)]);
        $second = FeedbackReport::factory()->for($project)->create(['title' => 'B 中間', 'created_at' => now()->subDays(2)]);
        $third = FeedbackReport::factory()->for($project)->create(['title' => 'A 最晚', 'created_at' => now()->subDay()]);

        $this->get(route('feedback.client.authenticate', $project).'?token='.$token);

        return [$project, $first, $second, $third];
    }

    private function numberOf(string $html, FeedbackReport $report): int
    {
        preg_match('/data-report-row="'.$report->public_id.'".*?data-report-number>(\d+)</s', $html, $matches);

        return (int) ($matches[1] ?? 0);
    }
}
