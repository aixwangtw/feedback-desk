<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

/**
 * 排程 API 排除專案：FEEDBACK_PATROL_EXCLUDED_PROJECTS 內的專案不列出，所有路由回 404；其他專案不受影響。
 */
class FeedbackPatrolExcludedProjectsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private string $plain;

    private FeedbackReport $internalReport;

    private FeedbackReport $siteReport;

    protected function setUp(): void
    {
        parent::setUp();

        $internal = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'internal']);
        $site = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'site']);
        $this->internalReport = FeedbackReport::factory()->for($internal)->create(['status' => FeedbackReportStatus::New]);
        $this->siteReport = FeedbackReport::factory()->for($site)->create(['status' => FeedbackReportStatus::New]);
        $this->plain = FeedbackPatrolToken::issue(FeedbackDeveloper::factory()->create(['username' => 'alex']), '雲端排程')['plain'];
    }

    public function test_excluded_project_is_hidden_and_every_route_returns_not_found(): void
    {
        config(['feedback.patrol_excluded_projects' => ['internal']]);
        $id = $this->internalReport->public_id;

        $slugs = collect($this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertOk()->json('projects'))->pluck('slug')->all();
        $this->assertSame(['site'], $slugs);

        $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'internal'))->assertNotFound();
        $this->withToken($this->plain)->getJson(route('feedback.patrol.show', ['internal', $id]))->assertNotFound();
        $this->withToken($this->plain)->postJson(route('feedback.patrol.message', ['internal', $id]), ['body' => 'x'])->assertNotFound();
        $this->withToken($this->plain)->putJson(route('feedback.patrol.message.edit', ['internal', $id, 1]), ['body' => 'x'])->assertNotFound();
        $this->withToken($this->plain)->deleteJson(route('feedback.patrol.message.withdraw', ['internal', $id, 1]))->assertNotFound();
        $this->withToken($this->plain)->postJson(route('feedback.patrol.draft', ['internal', $id]), ['body' => 'x'])->assertNotFound();
        $this->withToken($this->plain)->putJson(route('feedback.patrol.adjustment', ['internal', $id]), ['note' => 'x'])->assertNotFound();
        $this->withToken($this->plain)->postJson(route('feedback.patrol.request-completion', ['internal', $id]), [])->assertNotFound();
        $this->withToken($this->plain)->postJson(route('feedback.patrol.needs-input', ['internal', $id]), ['status' => 'needs_input'])->assertNotFound();

        $this->assertSame(FeedbackReportStatus::New, $this->internalReport->fresh()->status);
    }

    public function test_other_projects_are_unchanged_when_something_is_excluded(): void
    {
        config(['feedback.patrol_excluded_projects' => ['internal']]);

        $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'site'))->assertOk()->assertJsonPath('total', 1);
        $this->withToken($this->plain)->getJson(route('feedback.patrol.show', ['site', $this->siteReport->public_id]))->assertOk();
    }

    public function test_nothing_is_excluded_by_default(): void
    {
        $slugs = collect($this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertOk()->json('projects'))->pluck('slug')->sort()->values()->all();
        $this->assertSame(['internal', 'site'], $slugs);

        $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'internal'))->assertOk();
    }

    public function test_excluded_list_is_parsed_from_comma_separated_env_value(): void
    {
        $parsed = array_values(array_filter(array_map('trim', explode(',', ' internal , other,')), fn (string $slug): bool => $slug !== ''));
        $this->assertSame(['internal', 'other'], $parsed);
        $this->assertSame([], config('feedback.patrol_excluded_projects'));
    }
}
