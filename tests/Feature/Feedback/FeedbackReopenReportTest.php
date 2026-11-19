<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackApiToken;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Models\FeedbackReportEvent;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 已完成的單重新開啟：客戶從 MCP 留言也會改回等工程師；客戶在留言區按「待處理」把單改回等工程師（new）。
 * 網頁留言改回的情形在 FeedbackMessageStatusRuleTest。
 */
class FeedbackReopenReportTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
    }

    public function test_client_mcp_message_on_a_completed_report_reopens_it(): void
    {
        $account = FeedbackClientAccount::factory()->for($this->project)->create(['username' => 'mei', 'name' => '林小美']);
        $report = $this->report(FeedbackReportStatus::Completed);
        $token = FeedbackApiToken::issue($account, 'MCP', 'Codex')['plain'];

        $this->withToken($token)->postJson(route('feedback.mcp'), [
            'jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/call',
            'params' => ['name' => 'add_message', 'arguments' => ['project' => 'site', 'report' => $report->public_id, 'body' => '又出現了']],
        ])->assertOk()->assertJsonMissingPath('result.isError');

        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);
        $event = FeedbackReportEvent::where('kind', 'reopen_by_message')->sole();
        $this->assertSame('completed>new', $event->detail);
        $this->assertSame($account->id, $event->feedback_client_account_id);
    }

    public function test_both_sides_see_the_status_switch_under_the_thread(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);
        $this->actingAsClient();

        $this->get(route('feedback.reports.show', [$this->project, $completed]))
            ->assertOk()
            ->assertSee('data-thread-status-switch', false)
            ->assertDontSee('data-reopen-form', false);
        // 詳情視窗與右下角面板的留言串來自對話端點，同一組切換鈕。
        $this->getJson(route('feedback.conversations.show', [$this->project, $completed]))
            ->assertOk()
            ->assertJsonPath('html', fn (string $html): bool => str_contains($html, 'data-thread-status-switch'));

        $this->actingAsTeam();
        $this->get(route('feedback.reports.show', [$this->project, $completed]))->assertOk()->assertSee('data-thread-status-switch', false);
    }

    public function test_client_reopens_a_completed_or_needs_input_report_and_it_is_logged(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);
        $needsInput = $this->report(FeedbackReportStatus::NeedsInput);
        $this->actingAsClient();

        $this->patchJson(route('feedback.reports.status.update', [$this->project, $completed]), ['status' => 'new'])
            ->assertOk()
            ->assertJsonPath('status', 'new')
            ->assertJsonPath('label', FeedbackReportStatus::New->label($this->project));
        $this->patch(route('feedback.reports.status.update', [$this->project, $needsInput]), ['status' => 'new'])->assertRedirect();

        $completed->refresh();
        $this->assertSame(FeedbackReportStatus::New, $completed->status);
        $this->assertNull($completed->completed_at);
        $this->assertSame(FeedbackReportStatus::New, $needsInput->refresh()->status);
        $this->assertEqualsCanonicalizing(
            ['completed>new', 'needs_input>new'],
            FeedbackReportEvent::where('kind', 'reopen_by_client')->pluck('detail')->all(),
        );
    }

    public function test_reopen_event_shows_in_the_team_activity_log_with_the_status_name(): void
    {
        $this->project->update(['status_labels' => ['new' => '排隊中']]);
        $completed = $this->report(FeedbackReportStatus::Completed);
        $this->actingAsClient();
        $this->patch(route('feedback.reports.status.update', [$this->project, $completed]), ['status' => 'new'])->assertRedirect();

        $this->actingAsTeam();
        $this->get(route('feedback.reports.show', [$this->project, $completed]))
            ->assertOk()
            ->assertSee('按「待處理」改回排隊中（原本是已完成）');
    }

    public function test_client_cannot_reopen_a_report_that_is_already_new(): void
    {
        $new = $this->report(FeedbackReportStatus::New);
        $this->actingAsClient();

        // 已經是待處理再按一次不改狀態、不記事件。
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $new]), ['status' => 'new'])->assertOk();
        $this->assertSame(0, FeedbackReportEvent::query()->count());
    }

    public function test_team_can_change_the_status_on_the_web_without_a_client_reopen_event(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);
        $this->actingAsTeam();

        $this->patchJson(route('feedback.owner.status.update', [$this->project, $completed]), ['status' => 'new'])->assertOk();
        $this->assertSame(FeedbackReportStatus::New, $completed->refresh()->status);
        $this->assertSame(0, FeedbackReportEvent::where('kind', 'reopen_by_client')->count());
    }

    public function test_client_of_another_project_cannot_reopen(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);
        $otherProject = FeedbackProject::factory()->create(['slug' => 'other']);
        $this->actingAsClient($otherProject);

        $this->patchJson(route('feedback.reports.status.update', [$this->project, $completed]), ['status' => 'new'])->assertForbidden();
        $this->patchJson(route('feedback.reports.status.update', [$otherProject, $completed]), ['status' => 'new'])->assertNotFound();
        $this->assertSame(FeedbackReportStatus::Completed, $completed->refresh()->status);
    }

    public function test_guest_cannot_reopen(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);

        $this->patch(route('feedback.reports.status.update', [$this->project, $completed]), ['status' => 'new'])
            ->assertRedirect(route('feedback.login', $this->project));
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $completed]), ['status' => 'new'])->assertForbidden();
        $this->assertSame(FeedbackReportStatus::Completed, $completed->refresh()->status);
    }

    private function report(FeedbackReportStatus $status): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now()->subDay() : null,
        ]);
    }

    private function actingAsTeam(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsClient(?FeedbackProject $project = null): void
    {
        $project ??= $this->project;
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $project).'?token='.$token)->assertRedirect();
    }
}
