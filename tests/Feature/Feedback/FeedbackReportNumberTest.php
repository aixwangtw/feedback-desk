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

            $this->assertSame(1, $this->numberOf($html, $first));
            $this->assertSame(2, $this->numberOf($html, $second));
            $this->assertSame(3, $this->numberOf($html, $third));
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

        $this->assertSame(3, $this->numberOf($html, $third));
        $this->assertStringNotContainsString('data-report-row="'.$second->public_id.'"', $html);
    }

    public function test_numbers_are_consecutive_after_deletion_and_scoped_to_project(): void
    {
        [$project, $first, $second, $third] = $this->projectWithReports();
        $other = FeedbackProject::factory()->create();
        FeedbackReport::factory()->for($other)->create(['created_at' => now()->subDays(10)]);

        $first->delete();

        $html = $this->get(route('feedback.portal', $project))->assertSee('共 2 題', false)->getContent();
        $this->assertSame(1, $this->numberOf($html, $second));
        $this->assertSame(2, $this->numberOf($html, $third));

        $this->get(route('feedback.reports.show', [$project, $third]))->assertSee('#2', false);
    }

    public function test_detail_page_shows_the_same_number(): void
    {
        [$project, , $second] = $this->projectWithReports();

        $this->get(route('feedback.reports.show', [$project, $second]))
            ->assertOk()
            ->assertSee('data-report-number>#2', false);
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
        preg_match('/data-report-row="'.$report->public_id.'".*?data-report-number>#(\d+)</s', $html, $matches);

        return (int) ($matches[1] ?? 0);
    }
}
