<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

class FeedbackCreateCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_creates_a_report_as_the_shared_owner_and_prints_number_and_public_id(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => ' 新功能 ', '--description' => '說明文字'])
            ->expectsOutputToContain('public_id')
            ->assertSuccessful();

        $report = FeedbackReport::sole();
        $this->assertSame('新功能', $report->title);
        $this->assertSame('說明文字', $report->description);
        $this->assertSame(FeedbackCreatorType::OwnerShared, $report->creator_type);
        $this->assertSame($project->id, $report->feedback_project_id);
    }

    public function test_creates_a_report_as_a_developer_with_as_option(): void
    {
        $project = FeedbackProject::factory()->create();
        $developer = FeedbackDeveloper::factory()->create();

        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T', '--description' => 'D', '--as' => $developer->username])
            ->assertSuccessful();

        $report = FeedbackReport::sole();
        $this->assertSame(FeedbackCreatorType::Developer, $report->creator_type);
        $this->assertSame($developer->id, $report->creator_developer_id);
    }

    public function test_requires_a_valid_category_only_when_the_project_has_categories(): void
    {
        $project = FeedbackProject::factory()->create(['report_categories' => ['A', 'B']]);

        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T', '--description' => 'D'])->assertFailed();
        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T', '--description' => 'D', '--category' => 'C'])->assertFailed();
        $this->assertSame(0, FeedbackReport::count());

        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T', '--description' => 'D', '--category' => 'B'])->assertSuccessful();
        $this->assertSame('B', FeedbackReport::sole()->category);

        $plain = FeedbackProject::factory()->create();
        $this->artisan('feedback:create', ['project' => $plain->slug, '--title' => 'T', '--description' => 'D', '--category' => 'B'])->assertFailed();
    }

    public function test_rejects_missing_project_empty_fields_and_unknown_developer(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->artisan('feedback:create', ['project' => 'nope', '--title' => 'T', '--description' => 'D'])->assertFailed();
        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => ' ', '--description' => 'D'])->assertFailed();
        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T'])->assertFailed();
        $this->artisan('feedback:create', ['project' => $project->slug, '--title' => 'T', '--description' => 'D', '--as' => 'ghost'])->assertFailed();
        $this->assertSame(0, FeedbackReport::count());
    }
}
