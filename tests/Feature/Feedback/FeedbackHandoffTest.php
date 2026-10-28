<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAgentName;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * 多人、多個 AI 接手：認領、釋放、接手、交接紀錄與最近動態（網頁與 artisan 指令）。
 */
class FeedbackHandoffTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackReport $report;

    private FeedbackDeveloper $amy;

    private FeedbackDeveloper $ben;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        putenv('FEEDBACK_DESK_AGENT');
        putenv('FEEDBACK_DESK_AS');
        putenv('CLAUDECODE');
        putenv('CODEX_THREAD_ID');
        putenv('CODEX_SESSION_ID');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create(['title' => '要修的單']);
        $this->amy = FeedbackDeveloper::factory()->withPassword('amy-password-1')->create(['username' => 'amy', 'name' => '王小明']);
        $this->ben = FeedbackDeveloper::factory()->withPassword('ben-password-1')->create(['username' => 'ben', 'name' => '李大同']);
    }

    protected function tearDown(): void
    {
        putenv('CLAUDECODE');
        putenv('CODEX_THREAD_ID');
        parent::tearDown();
    }

    public function test_agent_names_are_cleaned_so_they_cannot_fake_the_label(): void
    {
        $this->assertSame('Claude Code', FeedbackAgentName::normalize('claude-code'));
        $this->assertSame('Codex', FeedbackAgentName::normalize('codex-mcp-client'));
        $this->assertSame('Evil王小明', FeedbackAgentName::normalize('Evil）（王小明'));
        $this->assertNull(FeedbackAgentName::normalize('（）'));
        $this->assertSame(40, mb_strlen((string) FeedbackAgentName::normalize(str_repeat('a', 80))));
        $this->assertSame('王小明（Codex）', FeedbackAgentName::label('王小明', 'Codex'));

        putenv('CLAUDECODE=1');
        $this->assertSame('Claude Code', FeedbackAgentName::fromEnvironment());
        putenv('CODEX_THREAD_ID=x');
        $this->assertSame('Codex', FeedbackAgentName::fromEnvironment());
        $this->assertSame('Hermes', FeedbackAgentName::fromEnvironment('Hermes'));
    }

    public function test_artisan_claim_records_the_account_and_agent_and_blocks_others_without_force(): void
    {
        $this->artisan('feedback:claim', ['project' => 'site', 'report' => $this->report->public_id, '--as' => 'amy', '--agent' => 'Codex'])
            ->expectsOutputToContain('王小明')
            ->assertSuccessful();
        $this->report->refresh();
        $this->assertSame($this->amy->id, $this->report->claimed_by_developer_id);
        $this->assertSame('Codex', $this->report->claimed_agent);

        // 別人（或同一人換另一個 AI）要改狀態、寫調整說明，沒加 --force 就停下。
        $this->artisan('feedback:status', ['project' => 'site', 'report' => $this->report->public_id, 'status' => 'needs_input', '--as' => 'ben'])
            ->expectsOutputToContain('王小明')
            ->assertFailed();
        $this->artisan('feedback:adjust', ['project' => 'site', 'report' => $this->report->public_id, '--note' => '改好了', '--as' => 'amy', '--agent' => 'Claude Code'])
            ->assertFailed();
        $this->assertSame(FeedbackReportStatus::New, $this->report->refresh()->status);

        // 同一人同一個 AI 不受影響。
        $this->artisan('feedback:adjust', ['project' => 'site', 'report' => $this->report->public_id, '--note' => '改好了', '--as' => 'amy', '--agent' => 'Codex'])->assertSuccessful();

        $this->artisan('feedback:status', ['project' => 'site', 'report' => $this->report->public_id, 'status' => 'needs_input', '--as' => 'ben', '--force' => true])
            ->expectsOutputToContain('接手自')
            ->assertSuccessful();
        $this->report->refresh();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->status);
        $this->assertSame($this->ben->id, $this->report->claimed_by_developer_id);
        $this->assertSame(['claim', 'adjustment', 'takeover', 'status'], $this->report->events()->orderBy('id')->pluck('kind')->all());
        $this->assertSame('王小明', $this->report->events()->where('kind', 'takeover')->value('detail'));
    }

    public function test_handoff_and_release_through_artisan_and_report_output(): void
    {
        putenv('FEEDBACK_DESK_AGENT=Hermes Agent');
        $this->artisan('feedback:claim', ['project' => 'site', 'report' => $this->report->public_id, '--as' => 'amy'])->assertSuccessful();
        $this->artisan('feedback:handoff', ['project' => 'site', 'report' => $this->report->public_id, '--as' => 'amy', '--note' => '列表頁改好，下一步改手機版', '--release' => true])
            ->assertSuccessful();
        putenv('FEEDBACK_DESK_AGENT');

        $this->report->refresh();
        $this->assertNull($this->report->claimed_by_developer_id);
        $note = $this->report->handoffNotes()->sole();
        $this->assertSame('Hermes Agent', $note->agent);

        Artisan::call('feedback:report', ['project' => 'site', 'report' => $this->report->public_id, '--json' => true]);
        $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertNull($data['claim']);
        $this->assertSame('王小明', $data['handoff_notes'][0]['author']);
        $this->assertSame('列表頁改好，下一步改手機版', $data['handoff_notes'][0]['note']);
        $this->assertSame(['release', 'handoff', 'claim'], array_column($data['recent_activity'], 'kind'));

        // 沒有 --as 就不能認領或寫交接紀錄。
        $this->artisan('feedback:claim', ['project' => 'site', 'report' => $this->report->public_id])->assertFailed();
        $this->artisan('feedback:handoff', ['project' => 'site', 'report' => $this->report->public_id, '--as' => 'amy', '--note' => ' '])->assertFailed();
        $this->artisan('feedback:release', ['project' => 'site', 'report' => $this->report->public_id, '--as' => 'nobody'])->assertFailed();
    }

    public function test_reports_list_shows_who_claimed(): void
    {
        $this->assertSame(0, Artisan::call('feedback:claim', ['project' => 'site', 'report' => '1', '--as' => 'amy', '--agent' => 'Codex']));

        Artisan::call('feedback:reports', ['project' => 'site', '--json' => true]);
        $rows = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('王小明', $rows[0]['claimed_by']);
    }

    public function test_the_web_page_offers_claim_release_takeover_and_handoff_to_personal_team_accounts(): void
    {
        $this->loginAs('amy', 'amy-password-1');
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()
            ->assertSee('data-work-panel', false)
            ->assertSee('data-claim-none', false)
            ->assertSee('data-claim-button', false);

        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'claim'])->assertRedirect();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertSee('data-release-button', false)->assertSee('王小明');

        $this->post(route('feedback.reports.handoff', [$this->project, $this->report]), ['note' => '做到一半', 'release' => '1'])->assertRedirect();
        $this->assertNull($this->report->refresh()->claimed_by_developer_id);
        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'claim']);

        // 另一位團隊成員看到「接手」。
        $this->post(route('feedback.logout', $this->project));
        $this->loginAs('ben', 'ben-password-1');
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertSee('data-claim-warning', false)
            ->assertSee('data-takeover-button', false)
            ->assertSee('做到一半');
        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'release'])->assertSessionHasErrorsIn('work', 'claim');
        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'takeover'])->assertSessionHas('success');
        $this->assertSame($this->ben->id, $this->report->refresh()->claimed_by_developer_id);

        // 網頁改狀態不擋（只提示），並記在最近動態。
        $this->patch(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])->assertRedirect();
        $this->assertSame('李大同', $this->report->events()->where('kind', 'status')->value('actor_name'));
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertSee('data-activity-log', false)->assertSee('待處理 → 已完成');
    }

    public function test_clients_and_the_shared_owner_cannot_claim_and_never_see_the_work_panel(): void
    {
        $this->post(route('feedback.login.store', $this->project), ['username' => 'test', 'password' => 'client-pass']);
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertDontSee('data-work-panel', false);
        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'claim'])->assertForbidden();
        $this->post(route('feedback.reports.handoff', [$this->project, $this->report]), ['note' => 'x'])->assertForbidden();

        $this->post(route('feedback.logout', $this->project));
        $this->withSession(["feedback.owner.{$this->project->id}" => true]);
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertSee('data-work-panel', false)->assertSee('用個人帳號登入才能認領');
        $this->post(route('feedback.reports.claim', [$this->project, $this->report]), ['action' => 'claim'])->assertForbidden();
        $this->assertNull($this->report->refresh()->claimed_by_developer_id);
    }

    private function loginAs(string $username, string $password): void
    {
        $this->post(route('feedback.login.store', $this->project), compact('username', 'password'))->assertRedirect();
    }
}
