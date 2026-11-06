<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 清單與看板的兩個頁籤直接對應狀態：developer＝new（等工程師）、client＝needs_input（等客戶稱呼），
 * 已完成放在最右邊的連結；頁籤與每張單的標示都是狀態名稱，雙方看到的字一樣，不再看最後發言者。
 * 「完成」按鈕在操作欄，只有客戶能按；網頁上沒有改狀態的選單，團隊改任何狀態都 403。
 */
class FeedbackWaitingTabsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    /** @var array<string, FeedbackReport> */
    private array $reports = [];

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('feedback.labels.owner', '開發者');
        config()->set('feedback.labels.client', '老師');
        $this->project = FeedbackProject::factory()->create();

        $this->reports['fresh'] = $this->report('新單還沒回', FeedbackReportStatus::New);
        $this->reports['followUp'] = $this->report('老師又問', FeedbackReportStatus::New);
        $this->message($this->reports['followUp'], FeedbackAuthorType::Owner, now()->subMinutes(30));
        $this->message($this->reports['followUp'], FeedbackAuthorType::Reporter, now()->subMinutes(10));
        $this->reports['waitingClient'] = $this->report('等老師測試', FeedbackReportStatus::NeedsInput);
        $this->message($this->reports['waitingClient'], FeedbackAuthorType::Owner, now()->subMinutes(20));
        $this->reports['legacy'] = $this->report('舊資料待審核但老師後來又問', FeedbackReportStatus::NeedsInput);
        $this->message($this->reports['legacy'], FeedbackAuthorType::Owner, now()->subMinutes(40));
        $this->message($this->reports['legacy'], FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->reports['done'] = $this->report('已經完成的單', FeedbackReportStatus::Completed);
    }

    public function test_team_defaults_to_the_awaiting_developer_tab_with_counts(): void
    {
        $this->actingAsTeam();

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();

        $this->assertMatchesRegularExpression('/data-waiting-tab="developer"[^>]*aria-current="page"/', $html);
        $newLabel = FeedbackReportStatus::New->label();
        $needsInputLabel = FeedbackReportStatus::NeedsInput->label();
        $this->assertSame('等老師', $needsInputLabel);
        $this->assertStringContainsString($newLabel.' <span data-waiting-tab-count>2</span>', $html);
        $this->assertStringContainsString($needsInputLabel.' <span data-waiting-tab-count>2</span>', $html);
        $this->assertStringContainsString('data-completed-link', $html);
        foreach (['fresh', 'followUp'] as $key) {
            $this->assertStringContainsString('data-report-row="'.$this->reports[$key]->public_id.'"', $html);
        }
        foreach (['waitingClient', 'legacy', 'done'] as $key) {
            $this->assertStringNotContainsString('data-report-row="'.$this->reports[$key]->public_id.'"', $html);
        }
        $this->assertSame(2, substr_count($html, 'data-waiting-on="developer">'.$newLabel.'<'));
        // 不再有狀態下拉篩選。
        $this->assertStringNotContainsString('篩選狀態', $html);
    }

    public function test_client_defaults_to_the_awaiting_client_tab_and_sees_the_same_wording(): void
    {
        $this->actingAsClient();

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();

        $this->assertMatchesRegularExpression('/data-waiting-tab="client"[^>]*aria-current="page"/', $html);
        // 舊資料那張單狀態是 needs_input，依狀態歸在 client 頁籤，不看最後是誰留言。
        foreach (['waitingClient', 'legacy'] as $key) {
            $this->assertStringContainsString('data-report-row="'.$this->reports[$key]->public_id.'"', $html);
        }
        $this->assertStringNotContainsString('data-report-row="'.$this->reports['fresh']->public_id.'"', $html);
        $this->assertSame(2, substr_count($html, 'data-waiting-on="client">'.FeedbackReportStatus::NeedsInput->label().'<'));

        $developerTab = $this->get(route('feedback.portal', [$this->project, 'tab' => 'developer']))->assertOk()->getContent();
        $this->assertStringContainsString('data-report-row="'.$this->reports['fresh']->public_id.'"', $developerTab);
        $this->assertSame(2, substr_count($developerTab, 'data-waiting-on="developer">'.FeedbackReportStatus::New->label().'<'));
    }

    public function test_tab_is_kept_in_the_url_and_completed_reports_live_behind_the_completed_link(): void
    {
        $this->actingAsTeam();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'client']))->assertOk()->getContent();
        $this->assertMatchesRegularExpression('/href="[^"]*tab=client[^"]*"[^>]*data-view-mode="board"/', $html);

        $board = $this->get(route('feedback.portal', [$this->project, 'tab' => 'client', 'view' => 'board']))->assertOk()->getContent();
        $this->assertStringContainsString('data-report-id="'.$this->reports['waitingClient']->public_id.'"', $board);
        $this->assertStringNotContainsString('data-report-id="'.$this->reports['fresh']->public_id.'"', $board);

        $done = $this->get(route('feedback.portal', [$this->project, 'tab' => 'completed']))->assertOk()->getContent();
        $this->assertStringContainsString('data-report-row="'.$this->reports['done']->public_id.'"', $done);
        $this->assertStringNotContainsString('data-report-row="'.$this->reports['fresh']->public_id.'"', $done);
    }

    public function test_client_can_complete_from_the_actions_column_and_the_report_leaves_the_tabs(): void
    {
        $this->actingAsClient();
        $report = $this->reports['waitingClient'];

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $this->assertStringContainsString('data-complete-report="'.$report->public_id.'"', $html);
        $this->assertStringContainsString('confirm(', $html);

        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertRedirect();

        $this->assertSame(FeedbackReportStatus::Completed, $report->refresh()->status);
        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'client']))->getContent();
        $this->assertStringNotContainsString('data-report-row="'.$report->public_id.'"', $html);
    }

    public function test_team_cannot_mark_reports_completed(): void
    {
        $this->actingAsTeam();
        $report = $this->reports['waitingClient'];

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'client']))->assertOk()->getContent();
        $this->assertStringNotContainsString('data-complete-report=', $html);
        $this->assertStringNotContainsString('<option value="completed"', $html);
        $this->assertStringNotContainsString('name="status"', $html);
        $this->assertStringNotContainsString('data-status-autosave', $html);

        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertForbidden();
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertForbidden();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->refresh()->status);

        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'new'])->assertForbidden();
        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'needs_input'])->assertForbidden();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->refresh()->status);
    }

    private function report(string $title, FeedbackReportStatus $status): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'title' => $title,
            'status' => $status,
            'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null,
            'owner_last_read_at' => now(),
            'client_last_read_at' => now(),
        ]);
    }

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at): void
    {
        $message = $report->feedbackMessages()->create(['author_type' => $author, 'author_name' => $author->label(), 'body' => '留言']);
        $message->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
    }

    private function actingAsTeam(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsClient(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
