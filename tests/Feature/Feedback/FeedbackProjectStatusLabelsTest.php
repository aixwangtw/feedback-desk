<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackCompletionRequest;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 狀態名稱可以每個看板各自設定：看板有設定就用看板的，沒設定沿用全站（config feedback.status_labels）。
 * 網頁、對話面板、CLI 都走 FeedbackReportStatus::label($project)，所以沒設定的看板（陳老師、Ending 等）完全不變。
 */
class FeedbackProjectStatusLabelsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $internal;

    private FeedbackProject $teacher;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('feedback.labels.client', '老師');
        config()->set('feedback.labels.owner', '工程師');
        $this->internal = FeedbackProject::factory()->create([
            'slug' => 'internal',
            'status_labels' => ['new' => '待 Alex 決定', 'needs_input' => '待 Nick 確認', 'completed' => '已完成'],
            'client_display_name' => 'Nick',
            'client_role_label' => 'Nick',
            'owner_role_label' => 'Alex',
        ]);
        $this->teacher = FeedbackProject::factory()->create(['slug' => 'teacher']);
    }

    private function loginAsOwner(FeedbackProject $project): void
    {
        $token = Str::random(48);
        $project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $project).'?token='.$token)->assertRedirect();
    }

    private function report(FeedbackProject $project, FeedbackReportStatus $status): FeedbackReport
    {
        return FeedbackReport::factory()->for($project)->create(['status' => $status, 'completed_at' => $status === FeedbackReportStatus::Completed ? now() : null]);
    }

    public function test_project_labels_override_and_unset_projects_keep_the_site_wide_names(): void
    {
        $this->assertSame('待 Alex 決定', FeedbackReportStatus::New->label($this->internal));
        $this->assertSame('待 Nick 確認', $this->internal->statusLabel(FeedbackReportStatus::NeedsInput));
        $this->assertSame((string) config('feedback.status_labels.new'), FeedbackReportStatus::New->label($this->teacher));
        $this->assertSame((string) config('feedback.status_labels.needs_input'), FeedbackReportStatus::NeedsInput->label($this->teacher));
        $this->assertSame(FeedbackReportStatus::New->label(), FeedbackReportStatus::New->label($this->teacher));
        $this->assertNotSame('待 Alex 決定', FeedbackReportStatus::New->label());
    }

    public function test_partial_override_falls_back_per_status(): void
    {
        $project = FeedbackProject::factory()->create(['status_labels' => ['new' => '待辦', 'needs_input' => '  ', 'bogus' => '不存在的狀態']]);

        $this->assertSame('待辦', FeedbackReportStatus::New->label($project));
        $this->assertSame((string) config('feedback.status_labels.needs_input'), FeedbackReportStatus::NeedsInput->label($project));
        $this->assertSame(['new' => '待辦'], $project->statusLabelOverrides());
    }

    public function test_from_input_accepts_project_label_value_site_label_and_legacy_name(): void
    {
        $this->assertSame(FeedbackReportStatus::New, FeedbackReportStatus::fromInput('待 Alex 決定', $this->internal));
        $this->assertSame(FeedbackReportStatus::NeedsInput, FeedbackReportStatus::fromInput('needs_input', $this->internal));
        $this->assertSame(FeedbackReportStatus::NeedsInput, FeedbackReportStatus::fromInput('待審核', $this->internal));
        $this->assertNull(FeedbackReportStatus::fromInput('待 Alex 決定', $this->teacher));
        $this->assertStringContainsString('待 Nick 確認', implode('、', FeedbackReportStatus::describedOptions($this->internal)));
    }

    public function test_internal_portal_shows_project_names_in_tabs_summary_and_badges(): void
    {
        $this->report($this->internal, FeedbackReportStatus::New);
        $this->report($this->internal, FeedbackReportStatus::NeedsInput);
        $this->loginAsOwner($this->internal);

        $this->get(route('feedback.portal', $this->internal))
            ->assertOk()
            ->assertSee('待 Alex 決定')
            ->assertSee('待 Nick 確認')
            ->assertDontSee((string) config('feedback.status_labels.new'));

        $this->get(route('feedback.portal', ['feedbackProject' => $this->internal, 'view' => 'board']))
            ->assertOk()
            ->assertSee('待 Nick 確認');
    }

    public function test_other_boards_still_show_the_original_names(): void
    {
        $this->report($this->teacher, FeedbackReportStatus::New);
        $this->report($this->teacher, FeedbackReportStatus::NeedsInput);
        $this->loginAsOwner($this->teacher);

        $this->get(route('feedback.portal', $this->teacher))
            ->assertOk()
            ->assertSee((string) config('feedback.status_labels.new'))
            ->assertSee((string) config('feedback.status_labels.needs_input'))
            ->assertDontSee('待 Alex 決定')
            ->assertDontSee('待 Nick 確認');
    }

    public function test_conversation_panel_uses_the_project_label(): void
    {
        $report = $this->report($this->internal, FeedbackReportStatus::New);
        $this->loginAsOwner($this->internal);

        $this->getJson(route('feedback.conversations.index', $this->internal))->assertOk()->assertJsonFragment(['status' => '待 Alex 決定']);
        $this->getJson(route('feedback.conversations.show', [$this->internal, $report]))->assertOk()->assertJsonFragment(['status' => '待 Alex 決定']);

        $other = $this->report($this->teacher, FeedbackReportStatus::New);
        $this->flushSession();
        $this->loginAsOwner($this->teacher);
        $this->getJson(route('feedback.conversations.show', [$this->teacher, $other]))->assertOk()->assertJsonFragment(['status' => (string) config('feedback.status_labels.new')]);
    }

    public function test_owner_sets_and_clears_labels_from_project_settings(): void
    {
        $this->loginAsOwner($this->teacher);
        $this->get(route('feedback.account', $this->teacher))->assertOk()->assertSee('data-status-labels-form', false);

        $this->put(route('feedback.project.status-labels', $this->teacher), ['status_labels' => ['new' => ' 待決定 ', 'needs_input' => '', 'completed' => '結案']])
            ->assertRedirect(route('feedback.account', $this->teacher).'#project-settings')
            ->assertSessionHas('success');
        $this->assertSame(['new' => '待決定', 'completed' => '結案'], $this->teacher->refresh()->status_labels);

        $this->put(route('feedback.project.status-labels', $this->teacher), ['status_labels' => ['new' => '', 'needs_input' => '', 'completed' => '']])->assertSessionHasNoErrors();
        $this->assertNull($this->teacher->refresh()->status_labels);
    }

    public function test_too_long_label_is_refused(): void
    {
        $this->loginAsOwner($this->teacher);

        $this->put(route('feedback.project.status-labels', $this->teacher), ['status_labels' => ['new' => str_repeat('長', 21)]])
            ->assertSessionHasErrorsIn('statusLabels', 'status_labels.new');
        $this->assertNull($this->teacher->refresh()->status_labels);
    }

    public function test_client_cannot_change_status_labels(): void
    {
        $token = Str::random(48);
        $this->teacher->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->teacher).'?token='.$token)->assertRedirect();

        $this->put(route('feedback.project.status-labels', $this->teacher), ['status_labels' => ['new' => '亂改']])->assertForbidden();
        $this->assertNull($this->teacher->refresh()->status_labels);
    }

    public function test_cli_sets_shows_and_clears_labels_and_accepts_them_as_status_input(): void
    {
        $this->artisan('feedback:status-labels', ['project' => 'teacher', '--new' => '待 Alex 決定'])
            ->expectsOutputToContain('new：待 Alex 決定（自訂）')
            ->assertSuccessful();
        $this->assertSame(['new' => '待 Alex 決定'], $this->teacher->refresh()->status_labels);

        $report = $this->report($this->teacher, FeedbackReportStatus::NeedsInput);
        $this->artisan('feedback:status', ['project' => 'teacher', 'report' => $report->public_id, 'status' => '待 Alex 決定'])->assertSuccessful();
        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);

        $this->artisan('feedback:status-labels', ['project' => 'teacher', '--clear' => true])->assertSuccessful();
        $this->assertNull($this->teacher->refresh()->status_labels);
        $this->artisan('feedback:status-labels', ['project' => 'nope'])->assertFailed();
    }

    public function test_cli_reports_list_shows_project_label(): void
    {
        $this->report($this->internal, FeedbackReportStatus::NeedsInput);

        $this->artisan('feedback:reports', ['project' => 'internal', '--json' => true])
            ->expectsOutputToContain('待 Nick 確認')
            ->assertSuccessful();
    }

    public function test_role_words_follow_the_board_on_portal_and_dialogs(): void
    {
        $this->assertSame('Nick', $this->internal->clientRole());
        $this->assertSame('Alex', $this->internal->ownerRole());
        $this->assertSame('老師', $this->teacher->clientRole());
        $this->assertSame('工程師', $this->teacher->ownerRole());

        $internalReport = $this->report($this->internal, FeedbackReportStatus::New);
        $this->loginAsOwner($this->internal);
        $html = $this->get(route('feedback.portal', $this->internal))->assertOk()->getContent();
        $this->assertStringContainsString('Nick留言就變', $html);
        $this->assertStringContainsString('Alex回覆就變', $html);
        $this->assertStringContainsString('Nick已刪除', $html);
        $this->assertStringNotContainsString('老師', $html);
        $this->assertStringNotContainsString('工程師', $html);
        $show = $this->get(route('feedback.reports.show', [$this->internal, $internalReport]))->assertOk()->getContent();
        $this->assertStringContainsString('請Nick確認完成', $show);
        $this->assertStringNotContainsString('請老師確認完成', $show);
        $this->assertStringContainsString('Nick確認沒問題請按', FeedbackCompletionRequest::defaultBody($this->internal));

        $this->flushSession();
        $otherReport = $this->report($this->teacher, FeedbackReportStatus::New);
        $this->loginAsOwner($this->teacher);
        $html = $this->get(route('feedback.portal', $this->teacher))->assertOk()->getContent();
        $this->assertStringContainsString('老師留言就變', $html);
        $this->assertStringContainsString('工程師回覆就變', $html);
        $this->assertStringContainsString('老師已刪除', $html);
        $this->assertStringNotContainsString('Nick', $html);
        $this->assertStringNotContainsString('Alex', $html);
        $show = $this->get(route('feedback.reports.show', [$this->teacher, $otherReport]))->assertOk()->getContent();
        $this->assertStringContainsString('請老師確認完成', $show);
        $this->assertStringContainsString('老師確認沒問題請按', FeedbackCompletionRequest::defaultBody($this->teacher));
        $this->assertStringContainsString('老師確認沒問題請按', FeedbackCompletionRequest::defaultBody());
    }

    public function test_owner_sets_and_clears_role_labels(): void
    {
        $this->loginAsOwner($this->teacher);
        $this->get(route('feedback.account', $this->teacher))->assertOk()->assertSee('data-role-labels-form', false);

        $this->put(route('feedback.project.role-labels', $this->teacher), ['client_role_label' => ' 小明 ', 'owner_role_label' => ''])->assertSessionHasNoErrors();
        $this->teacher->refresh();
        $this->assertSame('小明', $this->teacher->clientRole());
        $this->assertSame('工程師', $this->teacher->ownerRole());

        $this->put(route('feedback.project.role-labels', $this->teacher), ['client_role_label' => str_repeat('長', 21)])->assertSessionHasErrorsIn('roleLabels', 'client_role_label');

        $this->put(route('feedback.project.role-labels', $this->teacher), [])->assertSessionHasNoErrors();
        $this->assertNull($this->teacher->refresh()->client_role_label);

        $this->artisan('feedback:status-labels', ['project' => 'teacher', '--client-role' => 'X', '--owner-role' => 'Y'])->expectsOutputToContain('客戶端稱呼：X／開發者端稱呼：Y')->assertSuccessful();
        $this->artisan('feedback:status-labels', ['project' => 'teacher', '--clear' => true])->assertSuccessful();
        $this->assertNull($this->teacher->refresh()->owner_role_label);
    }
}
