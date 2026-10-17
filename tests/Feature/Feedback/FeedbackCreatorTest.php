<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackCreatorTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const SHARED_PASSWORD = 'shared-owner-password';

    private FeedbackProject $project;

    private FeedbackDeveloper $alex;

    private FeedbackDeveloper $nick;

    private string $clientToken;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('feedback.accounts.owner.password_hash', Hash::make(self::SHARED_PASSWORD));
        $this->clientToken = Str::random(48);
        $this->ownerToken = Str::random(48);
        $this->project = FeedbackProject::factory()->create([
            'client_display_name' => '示範客戶',
            'client_token_hash' => hash('sha256', $this->clientToken),
            'owner_token_hash' => hash('sha256', $this->ownerToken),
        ]);
        $this->alex = FeedbackDeveloper::factory()->withPassword('dev-a-pass')->create(['name' => 'Alex', 'username' => 'alex']);
        $this->nick = FeedbackDeveloper::factory()->withPassword('dev-b-pass')->create(['name' => 'Nick', 'username' => 'nick']);
    }

    public function test_developer_account_logs_in_with_owner_access_and_remembers_who_it_is(): void
    {
        $this->post(route('feedback.login.store', $this->project), ['username' => 'alex', 'password' => 'dev-a-pass'])
            ->assertRedirect(route('feedback.portal', $this->project))
            ->assertCookie(FeedbackAccess::COOKIE_NAME);

        $access = app(FeedbackAccess::class);
        $this->assertTrue($access->isOwner($this->project));
        $this->assertSame($this->alex->id, $access->currentDeveloper($this->project)?->id);
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-creator-filter', false);
    }

    public function test_wrong_developer_password_is_rejected(): void
    {
        $this->post(route('feedback.login.store', $this->project), ['username' => 'alex', 'password' => 'dev-b-pass'])
            ->assertSessionHasErrors('username');
        $this->post(route('feedback.login.store', $this->project), ['username' => 'nobody', 'password' => 'dev-a-pass'])
            ->assertSessionHasErrors('username');

        $this->assertFalse(app(FeedbackAccess::class)->isOwner($this->project));
    }

    public function test_long_lived_cookie_restores_the_developer_identity_until_the_password_changes(): void
    {
        $cookie = $this->loginAs('alex', 'dev-a-pass');

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => '靠 cookie', 'description' => '內容']]]);
        $this->assertSame($this->alex->id, FeedbackReport::firstWhere('title', '靠 cookie')->creator_developer_id);

        $this->alex->update(['password_hash' => Hash::make('new-pass')]);
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_a_cookie_cannot_be_forged_to_claim_another_developer(): void
    {
        $cookie = json_decode($this->loginAs('alex', 'dev-a-pass'), true);
        $cookie[(string) $this->project->id]['owner']['developer_id'] = $this->nick->id;

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, json_encode($cookie));
        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_new_reports_record_who_created_them(): void
    {
        $this->actingAsTeacher();
        $this->createReport('老師的單');

        $this->expireSession();
        $this->loginAs('alex', 'dev-a-pass');
        $this->createReport('Alex 的單');

        $this->expireSession();
        $this->loginAs('admin', self::SHARED_PASSWORD);
        $this->createReport('共用 admin 的單');

        $this->expireSession();
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken);
        $this->createReport('連結的單');

        $teacher = FeedbackReport::firstWhere('title', '老師的單');
        $this->assertSame(FeedbackCreatorType::Client, $teacher->creator_type);
        $this->assertNull($teacher->creator_developer_id);

        $alex = FeedbackReport::firstWhere('title', 'Alex 的單');
        $this->assertSame(FeedbackCreatorType::Developer, $alex->creator_type);
        $this->assertSame($this->alex->id, $alex->creator_developer_id);

        foreach (['共用 admin 的單', '連結的單'] as $title) {
            $shared = FeedbackReport::firstWhere('title', $title);
            $this->assertSame(FeedbackCreatorType::OwnerShared, $shared->creator_type);
            $this->assertNull($shared->creator_developer_id);
        }
    }

    public function test_link_login_after_developer_login_drops_the_developer_identity(): void
    {
        $this->loginAs('alex', 'dev-a-pass');
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken);

        $this->assertNull(app(FeedbackAccess::class)->currentDeveloper($this->project));
    }

    public function test_owner_sees_creator_column_labels_and_filter_options(): void
    {
        $this->seedMixedReports();
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()
            ->assertSee('<th class="w-28 px-4 py-3.5 text-center">建立者</th>', false)
            ->assertSee('<option value="client"', false)
            ->assertSee('<option value="developer:'.$this->alex->id.'"', false)
            ->assertSee('<option value="developer:'.$this->nick->id.'"', false)
            ->assertSee('<option value="shared"', false)
            ->assertSee('開發者（共用）')
            ->getContent();

        $this->assertSame('示範客戶', $this->creatorOf($html, 'client-1'));
        $this->assertSame('Alex', $this->creatorOf($html, 'alex-1'));
        $this->assertSame('Nick', $this->creatorOf($html, 'nick-1'));
        $this->assertSame('開發者', $this->creatorOf($html, 'shared-1'));
    }

    public function test_board_cards_show_the_creator_to_the_owner(): void
    {
        $this->seedMixedReports();
        $this->actingAsOwner();

        $this->get(route('feedback.portal', $this->project).'?view=board')->assertOk()
            ->assertSee('data-report-creator>· Alex<', false)
            ->assertSee('data-report-creator>· 示範客戶<', false);
    }

    public function test_creator_filter_narrows_the_list_and_survives_paging_sorting_and_view_switch(): void
    {
        $this->seedMixedReports();
        FeedbackReport::factory()->for($this->project)->byDeveloper($this->alex)->count(55)->create();
        $this->actingAsOwner();

        $filter = 'developer:'.$this->alex->id;
        $html = $this->get(route('feedback.portal', $this->project).'?creator='.urlencode($filter).'&sort=title&direction=asc')
            ->assertOk()
            ->assertSee('共 59 題（篩選後 56 題）', false)
            ->assertSee('<option value="'.$filter.'" selected', false)
            ->assertDontSee('data-report-row="'.FeedbackReport::firstWhere('title', 'client-1')->public_id.'"', false)
            ->getContent();

        $this->assertStringContainsString('creator=developer%3A'.$this->alex->id, $html);
        preg_match_all('/<a href="([^"]*creator=[^"]*page=2[^"]*|[^"]*page=2[^"]*creator=[^"]*)"/', $html, $pager);
        $this->assertNotEmpty($pager[1], 'pagination links should keep the creator filter');
        $this->assertMatchesRegularExpression('/data-view-mode="board"[^>]*>/', $html);
        preg_match('/<a href="([^"]*)"[^>]*data-view-mode="board"/', $html, $board);
        $this->assertStringContainsString('creator=developer%3A'.$this->alex->id, html_entity_decode($board[1]));

        $this->get(route('feedback.portal', $this->project).'?creator=shared')->assertSee('共 59 題（篩選後 1 題）', false);
        $this->get(route('feedback.portal', $this->project).'?creator=client')->assertSee('共 59 題（篩選後 1 題）', false);
        $this->get(route('feedback.portal', $this->project).'?creator=developer:'.$this->nick->id)->assertSee('共 59 題（篩選後 1 題）', false);
        $this->get(route('feedback.portal', $this->project).'?creator=bogus')->assertSee('共 59 題', false)->assertDontSee('篩選後', false);
    }

    public function test_teacher_never_sees_developer_reports_creator_info_or_the_filter(): void
    {
        $this->seedMixedReports();
        $this->actingAsTeacher();

        $html = $this->get(route('feedback.portal', $this->project).'?creator=shared')->assertOk()
            ->assertSee('共 1 題', false)
            ->assertDontSee('篩選後', false)
            ->assertDontSee('data-creator-filter', false)
            ->assertDontSee('data-report-creator', false)
            ->assertDontSee('建立者')
            ->assertDontSee('Alex')
            ->assertDontSee('Nick')
            ->getContent();

        $this->assertStringContainsString('data-report-row="'.$this->reportTitled('client-1')->public_id.'"', $html);
        foreach (['alex-1', 'nick-1', 'shared-1'] as $title) {
            $this->assertStringNotContainsString('data-report-row="'.$this->reportTitled($title)->public_id.'"', $html);
            $this->assertStringNotContainsString($title, $html);
        }

        $this->get(route('feedback.portal', $this->project).'?view=board')->assertOk()
            ->assertDontSee('alex-1')->assertDontSee('data-report-creator', false);
    }

    public function test_teacher_numbers_are_renumbered_over_visible_reports_only(): void
    {
        $this->project->feedbackReports()->delete();
        $oldest = $this->makeReport('老師最舊', now()->subDays(5));
        $this->makeReport('開發者夾中間', now()->subDays(4), 'alex');
        $middle = $this->makeReport('老師中間', now()->subDays(3));
        $this->makeReport('共用夾中間', now()->subDays(2), 'shared');
        $newest = $this->makeReport('老師最新', now()->subDay());

        $this->actingAsTeacher();
        $html = $this->get(route('feedback.portal', $this->project))->assertSee('共 3 題', false)->getContent();
        preg_match_all('/data-report-number>(\d+)</', $html, $matches);
        $this->assertSame(['1', '2', '3'], $matches[1]);
        $this->assertSame(1, $this->numberOf($html, $newest));
        $this->assertSame(2, $this->numberOf($html, $middle));
        $this->assertSame(3, $this->numberOf($html, $oldest));
        $this->get(route('feedback.reports.show', [$this->project, $middle]))->assertSee('data-report-number>2<', false);

        $this->expireSession();
        $this->actingAsOwner();
        $html = $this->get(route('feedback.portal', $this->project))->assertSee('共 5 題', false)->getContent();
        $this->assertSame(1, $this->numberOf($html, $newest));
        $this->assertSame(3, $this->numberOf($html, $middle));
        $this->assertSame(5, $this->numberOf($html, $oldest));
        $this->get(route('feedback.reports.show', [$this->project, $middle]))->assertSee('data-report-number>3<', false);
    }

    public function test_teacher_counts_exclude_developer_reports_in_the_page_and_in_status_json(): void
    {
        $this->seedMixedReports();
        $client = $this->reportTitled('client-1');

        $this->actingAsTeacher();
        $this->get(route('feedback.portal', $this->project))->assertSee('待處理 1 題', false);
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $client]), ['status' => 'completed'])
            ->assertOk()
            ->assertExactJson([
                'status' => 'completed',
                'label' => '已完成',
                'counts' => ['completed' => 1],
                'message' => '狀態已更新為「已完成」。',
            ]);

        $this->expireSession();
        $this->actingAsOwner();
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $client]), ['status' => 'completed'])
            ->assertOk()
            ->assertJsonPath('counts.new', 3)
            ->assertJsonPath('counts.completed', 1);
    }

    public function test_teacher_gets_404_on_every_route_for_developer_reports(): void
    {
        $attachment = null;

        foreach (['alex-1', 'shared-1'] as $title) {
            $this->seedMixedReports();
            $report = $this->reportTitled($title);
            $attachment = FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id]);
            Storage::disk('local')->put($attachment->path, 'x');

            $this->expireSession();
            $this->actingAsTeacher();

            $this->get(route('feedback.reports.show', [$this->project, $report]))->assertNotFound();
            $this->get(route('feedback.reports.activity', [$this->project, $report]))->assertNotFound();
            $this->get(route('feedback.attachments.show', [$this->project, $report, $attachment]))->assertNotFound();
            $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 'x', 'description' => 'y'])->assertNotFound();
            $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertNotFound();
            $this->patchJson(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertNotFound();
            $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '偷留言'])->assertNotFound();
            $this->delete(route('feedback.reports.client-destroy', [$this->project, $report]))->assertNotFound();
            $this->put(route('feedback.reports.adjustment.update', [$this->project, $report]), ['adjustment_note' => 'x'])->assertForbidden();
            $this->delete(route('feedback.reports.destroy', [$this->project, $report]))->assertForbidden();
            $this->patch(route('feedback.reports.restore', [$this->project, $report]))->assertForbidden();

            $report->refresh();
            $this->assertSame('new', $report->status->value);
            $this->assertNull($report->client_deleted_at);
            $this->assertSame(0, $report->feedbackMessages()->count());
            $this->assertNotSame('x', $report->title);
        }
    }

    public function test_owner_can_still_use_developer_reports(): void
    {
        $this->seedMixedReports();
        $report = $this->reportTitled('alex-1');
        $this->actingAsOwner();

        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertOk();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '開發者留言'])->assertRedirect();
    }

    public function test_message_author_uses_the_developer_name_or_falls_back_to_developer(): void
    {
        $report = $this->reportTitled('client-1', create: true);

        $this->loginAs('alex', 'dev-a-pass');
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => 'Alex 說'])->assertRedirect();

        $this->expireSession();
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken);
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '共用說'])->assertRedirect();

        $this->expireSession();
        $this->actingAsTeacher();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '老師說'])->assertRedirect();

        $names = $report->feedbackMessages()->orderBy('id')->pluck('author_name', 'body')->all();
        $this->assertSame(['Alex 說' => 'Alex', '共用說' => '開發者', '老師說' => '老師'], $names);
        $this->assertSame(FeedbackAuthorType::Owner, $report->feedbackMessages()->orderBy('id')->first()->author_type);
    }

    public function test_migration_backfills_existing_reports_as_client_and_names_the_question_bank_teacher(): void
    {
        $bank = FeedbackProject::factory()->create(['slug' => 'demo-project']);
        $legacy = FeedbackReport::factory()->for($bank)->create();

        $migration = require database_path('migrations/2026_10_16_233520_add_creator_to_feedback_reports_table.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('feedback_reports', 'creator_type'));
        $migration->up();

        $this->assertSame(FeedbackCreatorType::Client, $legacy->refresh()->creator_type);
        $this->assertNull($legacy->creator_developer_id);
        $this->assertSame('示範客戶', $bank->refresh()->client_display_name);
        $this->assertNull($this->project->refresh()->client_display_name);
    }

    public function test_new_reports_default_to_client_and_unnamed_projects_use_a_generic_teacher_label(): void
    {
        $report = FeedbackReport::factory()->for(FeedbackProject::factory()->create())->create();
        DB::table('feedback_reports')->where('id', $report->id)->update(['creator_type' => 'client']);

        $this->assertSame(FeedbackCreatorType::Client, $report->refresh()->creator_type);
        $this->assertSame('老師', $report->creatorLabel());
        $this->assertSame('示範客戶', $this->reportTitled('client-1', create: true)->creatorLabel());
    }

    private function seedMixedReports(): void
    {
        $this->project->feedbackReports()->delete();
        $this->makeReport('client-1', now()->subDays(4));
        $this->makeReport('alex-1', now()->subDays(3), 'alex');
        $this->makeReport('nick-1', now()->subDays(2), 'nick');
        $this->makeReport('shared-1', now()->subDay(), 'shared');
    }

    private function makeReport(string $title, $createdAt, string $by = 'client'): FeedbackReport
    {
        $factory = FeedbackReport::factory()->for($this->project);
        $factory = match ($by) {
            'alex' => $factory->byDeveloper($this->alex),
            'nick' => $factory->byDeveloper($this->nick),
            'shared' => $factory->byOwnerShared(),
            default => $factory,
        };

        return $factory->create(['title' => $title, 'created_at' => $createdAt]);
    }

    private function reportTitled(string $title, bool $create = false): FeedbackReport
    {
        if ($create) {
            return $this->makeReport($title, now());
        }

        return FeedbackReport::where('title', $title)->firstOrFail();
    }

    private function createReport(string $title): void
    {
        $this->post(route('feedback.reports.store', $this->project), [
            'issues' => [['title' => $title, 'description' => '內容']],
        ])->assertRedirect(route('feedback.portal', $this->project));
    }

    private function creatorOf(string $html, string $title): ?string
    {
        $report = $this->reportTitled($title);
        preg_match('/data-report-row="'.$report->public_id.'".*?data-report-creator>(?:<span[^>]*>[^<]*<\/span>)?\s*([^<]*)</s', $html, $matches);

        return isset($matches[1]) ? trim($matches[1]) : null;
    }

    private function numberOf(string $html, FeedbackReport $report): int
    {
        preg_match('/data-report-row="'.$report->public_id.'".*?data-report-number>(\d+)</s', $html, $matches);

        return (int) ($matches[1] ?? 0);
    }

    private function loginAs(string $username, string $password): string
    {
        return $this->post(route('feedback.login.store', $this->project), compact('username', 'password'))
            ->assertRedirect(route('feedback.portal', $this->project))
            ->getCookie(FeedbackAccess::COOKIE_NAME)
            ->getValue();
    }

    private function actingAsTeacher(): void
    {
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$this->clientToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsOwner(): void
    {
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function expireSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        app('cookie')->flushQueuedCookies();
    }
}
