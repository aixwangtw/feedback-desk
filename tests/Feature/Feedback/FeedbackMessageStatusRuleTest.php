<?php

namespace Tests\Feature\Feedback;

use App\Actions\PostFeedbackMessageAction;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Models\FeedbackReportEvent;
use App\Support\StandardInput;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * 留言自動切狀態：等客戶的單客戶留言 → 等工程師；團隊正式送出留言（含待審留言送出、指令、排程 API）→ 等客戶。
 * 已完成的單客戶又留言 → 等工程師（記 reopen_by_message）；團隊留言不改已完成；待審留言（草稿）本身不改狀態。
 */
class FeedbackMessageStatusRuleTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->mock(StandardInput::class, fn (MockInterface $mock) => $mock->shouldReceive('read')->andReturn(null));
    }

    public function test_client_message_on_a_needs_input_report_moves_it_back_to_new_and_is_logged(): void
    {
        $report = $this->report(FeedbackReportStatus::NeedsInput);
        $this->actingAsClient();

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '還是不對'])->assertRedirect();

        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);
        $this->assertSame('needs_input>new', FeedbackReportEvent::where('kind', 'status')->sole()->detail);
    }

    public function test_client_message_on_a_new_report_keeps_the_status(): void
    {
        $new = $this->report(FeedbackReportStatus::New);
        $this->actingAsClient();

        $this->post(route('feedback.messages.store', [$this->project, $new]), ['body' => '補充'])->assertRedirect();

        $this->assertSame(FeedbackReportStatus::New, $new->refresh()->status);
        $this->assertSame(0, FeedbackReportEvent::whereIn('kind', ['status', 'reopen_by_message'])->count());
    }

    public function test_client_message_on_a_completed_report_reopens_it_as_new_and_is_logged(): void
    {
        $completed = $this->report(FeedbackReportStatus::Completed);
        $this->actingAsClient();

        $this->post(route('feedback.messages.store', [$this->project, $completed]), ['body' => '又壞了'])
            ->assertRedirect()
            ->assertSessionHas('success', '訊息已送出。狀態已改回「'.FeedbackReportStatus::New->label($this->project).'」。');

        $completed->refresh();
        $this->assertSame(FeedbackReportStatus::New, $completed->status);
        $this->assertNull($completed->completed_at);
        $event = FeedbackReportEvent::where('kind', 'reopen_by_message')->sole();
        $this->assertSame('completed>new', $event->detail);
        $this->assertSame(0, FeedbackReportEvent::where('kind', 'status')->count());
    }

    public function test_team_web_message_on_a_new_report_switches_to_needs_input_and_reminds_about_the_adjustment(): void
    {
        $report = $this->report(FeedbackReportStatus::New);
        $this->actingAsTeam();

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '已修正'])
            ->assertRedirect()
            ->assertSessionHas('success', fn (string $text): bool => str_contains($text, PostFeedbackMessageAction::statusChangeNotice()));

        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->refresh()->status);
        $this->assertSame('new>needs_input', FeedbackReportEvent::where('kind', 'status')->sole()->detail);
    }

    public function test_team_message_on_a_completed_report_keeps_it_completed(): void
    {
        $report = $this->report(FeedbackReportStatus::Completed);
        $this->actingAsTeam();

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '補充說明'])->assertRedirect();

        $this->assertSame(FeedbackReportStatus::Completed, $report->refresh()->status);
    }

    public function test_drafts_do_not_change_status_until_sent(): void
    {
        $report = $this->report(FeedbackReportStatus::New);

        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $report->public_id, '--text' => '草稿'])->assertSuccessful();
        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);

        $this->actingAsTeam();
        $this->post(route('feedback.drafts.send', [$this->project, $report, FeedbackMessageDraft::sole()]))
            ->assertRedirect()
            ->assertSessionHas('success', fn (string $text): bool => str_contains($text, '狀態已改為'));

        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->refresh()->status);
    }

    public function test_command_and_patrol_messages_switch_to_needs_input_and_patrol_needs_input_still_works(): void
    {
        $viaCommand = $this->report(FeedbackReportStatus::New);
        $this->artisan('feedback:message', ['project' => 'site', 'report' => $viaCommand->public_id, '--text' => '已修正'])
            ->expectsOutputToContain('狀態已改為')
            ->assertSuccessful();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $viaCommand->refresh()->status);

        $viaPatrol = $this->report(FeedbackReportStatus::New);
        $plain = FeedbackPatrolToken::issue(FeedbackDeveloper::factory()->create(), '雲端排程')['plain'];
        $this->withToken($plain)->postJson(route('feedback.patrol.message', ['site', $viaPatrol->public_id]), ['body' => '已修正'])
            ->assertOk()
            ->assertJsonPath('status', 'needs_input');
        $this->assertSame(FeedbackReportStatus::NeedsInput, $viaPatrol->refresh()->status);

        $this->withToken($plain)->postJson(route('feedback.patrol.needs-input', ['site', $viaPatrol->public_id]))->assertOk();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $viaPatrol->refresh()->status);
    }

    public function test_replacement_draft_send_also_switches_new_to_needs_input(): void
    {
        $report = $this->report(FeedbackReportStatus::New);
        $original = $report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '原留言']);
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $report->public_id, '--text' => '改', '--replace-message' => $original->id])->assertSuccessful();

        $this->actingAsTeam();
        $this->post(route('feedback.drafts.send', [$this->project, $report, FeedbackMessageDraft::sole()]))->assertRedirect();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->refresh()->status);
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

    private function actingAsClient(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
