<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackUnreadMessagesTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
    }

    public function test_owner_list_counts_only_client_messages_after_the_last_owner_visit(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subHours(2));
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(10));
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->message($report, FeedbackAuthorType::Owner, now()->subMinutes(3));
        $this->message($report, FeedbackAuthorType::Agent, now()->subMinutes(2));
        $quiet = $this->reportReadAt(now(), now(), title: '沒有新留言');
        $this->message($quiet, FeedbackAuthorType::Reporter, now()->subDay());

        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee($this->messageButtonLabel($report, 5, 2), false)
            ->assertSee($this->messageButtonLabel($quiet, 1), false)
            ->assertDontSee('新留言 2')
            ->assertSee('有 <span data-unread-report-count>1</span> 張單有未讀留言', false)
            ->assertSee('只看未讀留言')
            ->getContent();

        // 清單列與該單詳情視窗的「開啟對話」按鈕各一個紅色未讀數字。
        $this->assertSame(2, substr_count($html, 'data-unread-badge'));

        $this->get(route('feedback.portal', [$this->project, 'unread' => 1]))
            ->assertOk()
            ->assertSee($report->title)
            ->assertDontSee('沒有新留言')
            ->assertSee('顯示全部');

        $this->get(route('feedback.portal', [$this->project, 'unread' => 1, 'view' => 'board']))
            ->assertOk()
            ->assertSee($this->messageButtonLabel($report, 5, 2), false)
            ->assertDontSee('沒有新留言');
    }

    public function test_unread_summary_carries_what_the_chat_panel_needs_to_keep_it_in_sync(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-unread-only="0"', false)
            ->assertSee('data-unread-summary-text', false)
            ->assertSee('data-message-count="1"', false)
            ->getContent();

        // 面板看完最後一張後提示會拿掉篩選；之後又有未讀時，前端用這個網址補回「只看未讀留言」。
        $this->assertMatchesRegularExpression('/data-unread-only-url="[^"]*unread=1[^"]*"/', $html);
        $this->assertDoesNotMatchRegularExpression('/data-unread-only-url="[^"]*page=/', $html);

        $this->get(route('feedback.portal', [$this->project, 'unread' => 1]))
            ->assertOk()
            ->assertSee('data-unread-only="1"', false);
    }

    public function test_reports_without_any_owner_visit_count_every_client_message_as_unread(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['owner_last_read_at' => null]);
        $this->message($report, FeedbackAuthorType::Reporter, now()->subDay());
        $this->message($report, FeedbackAuthorType::Owner, now()->subHour());

        $this->actingAsOwner();

        $this->get(route('feedback.portal', $this->project))->assertSee($this->messageButtonLabel($report, 2, 1), false);
    }

    public function test_opening_a_report_as_owner_marks_it_read_without_touching_activity_time(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $activityAt = $report->latest_activity_at->toDateTimeString();
        $updatedAt = $report->updated_at->toDateTimeString();
        $clientReadAt = $report->client_last_read_at->toDateTimeString();
        $this->actingAsOwner();

        $this->travel(1)->minutes();
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();

        $report->refresh();
        $this->assertTrue($report->owner_last_read_at->greaterThan(now()->subSeconds(5)));
        $this->assertSame($activityAt, $report->latest_activity_at->toDateTimeString());
        $this->assertSame($updatedAt, $report->updated_at->toDateTimeString());
        $this->assertSame($clientReadAt, $report->client_last_read_at->toDateTimeString());
        $this->get(route('feedback.portal', $this->project))
            ->assertDontSee('data-unread-badge', false)
            ->assertSee($this->messageButtonLabel($report, 1), false)
            ->assertSee('目前沒有未讀留言');
    }

    public function test_activity_refresh_marks_the_report_read_for_the_viewer(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->actingAsOwner();

        $this->travel(1)->minutes();
        $this->get(route('feedback.reports.activity', [$this->project, $report]))->assertOk();

        $this->assertSame(0, $this->project->feedbackReports()->unreadByOwner()->count());
    }

    public function test_owner_messages_never_create_unread_messages_for_the_owner(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->actingAsOwner();

        $this->travel(1)->minutes();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '開發者回覆'])->assertRedirect();

        $this->assertSame(0, $this->project->feedbackReports()->unreadByOwner()->count());
        $this->get(route('feedback.portal', $this->project))->assertDontSee('data-unread-badge', false);
    }

    public function test_client_message_becomes_unread_for_the_owner_but_not_a_new_reply_for_the_client(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->actingAsClient();

        $this->travel(1)->minutes();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '老師補充'])->assertRedirect();

        $this->get(route('feedback.portal', $this->project))->assertDontSee('data-new-reply-badge', false);
        $this->assertSame(1, $this->project->feedbackReports()->unreadByOwner()->count());
    }

    public function test_client_sees_new_reply_badge_until_opening_the_report(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->message($report, FeedbackAuthorType::Owner, now()->subMinutes(5));
        $this->actingAsClient();

        $this->get(route('feedback.portal', $this->project))->assertSee($this->messageButtonLabel($report, 1, 1), false)->assertSee('data-new-reply-badge', false);
        $this->get(route('feedback.portal', [$this->project, 'view' => 'board']))->assertSee($this->messageButtonLabel($report, 1, 1), false);

        $this->travel(1)->minutes();
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();

        $this->get(route('feedback.portal', $this->project))->assertDontSee('data-new-reply-badge', false);
        // 客戶開啟不會動到開發者的已讀時間。
        $this->assertTrue($report->refresh()->owner_last_read_at->lessThan(now()->subMinutes(30)));
    }

    public function test_adjustment_changes_show_a_new_reply_to_the_client_but_unchanged_saves_do_not(): void
    {
        $report = $this->reportReadAt(now()->subHour(), now()->subHour());
        $this->actingAsOwner();

        $this->travel(1)->minutes();
        $this->put(route('feedback.reports.adjustment.update', [$this->project, $report]), ['adjustment_note' => '已調整'])->assertRedirect();
        $changedAt = $report->refresh()->adjustment_updated_at;
        $this->assertNotNull($changedAt);
        $this->assertTrue($report->hasNewReplyForClient());

        $this->travel(1)->minutes();
        $this->put(route('feedback.reports.adjustment.update', [$this->project, $report]), ['adjustment_note' => '已調整'])->assertRedirect();
        $this->assertSame($changedAt->toDateTimeString(), $report->refresh()->adjustment_updated_at->toDateTimeString());

        $this->actingAsClient();
        // 沒有留言、只有調整說明更新時，也會出現留言按鈕並以紅色 1 提示。
        $this->get(route('feedback.portal', $this->project))->assertSee($this->messageButtonLabel($report, 0, 1), false);
    }

    public function test_client_pages_never_show_owner_unread_data_or_honor_the_unread_filter(): void
    {
        $unread = $this->reportReadAt(now()->subHour(), now(), title: '有未讀的單');
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->reportReadAt(now(), now(), title: '另一張單');
        $this->actingAsClient();

        $this->get(route('feedback.portal', [$this->project, 'unread' => 1, 'sort' => 'latest_message_at']))
            ->assertOk()
            ->assertSee('另一張單')
            ->assertDontSee('data-unread-badge', false)
            ->assertDontSee('未讀留言')
            ->assertDontSee('依最新留言時間排序')
            ->assertDontSee('data-unread-summary', false)
            ->assertSee($this->messageButtonLabel($unread, 1), false);
    }

    public function test_owner_can_sort_by_latest_message_time(): void
    {
        $older = $this->reportReadAt(now(), now(), title: 'Older message report');
        $this->message($older, FeedbackAuthorType::Reporter, now()->subDays(2));
        $newer = $this->reportReadAt(now(), now(), title: 'Newer message report');
        $this->message($newer, FeedbackAuthorType::Reporter, now()->subHour());
        $this->reportReadAt(now(), now(), title: 'Silent report');
        $this->actingAsOwner();

        $this->get(route('feedback.portal', [$this->project, 'sort' => 'latest_message_at', 'direction' => 'desc']))
            ->assertOk()
            ->assertSeeInOrder(['Newer message report', 'Older message report', 'Silent report']);
    }

    public function test_message_area_invites_the_client_to_leave_a_message(): void
    {
        $report = $this->reportReadAt(now(), now());
        $report->update(['adjustment_note' => '已調整版面']);
        $ownerLabel = config('feedback.labels.owner');

        $this->actingAsClient();
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee("留言給{$ownerLabel}")
            ->assertSee('有問題或補充可以直接在這裡留言，我們會看到並回覆')
            ->assertSee('看完有問題，可直接在下方留言')
            ->assertSee('id="body"', false);

        $this->actingAsOwner();
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertDontSee('有問題或補充可以直接在這裡留言')
            ->assertDontSee('看完有問題，可直接在下方留言');
    }

    public function test_new_reports_start_read_on_the_creator_side(): void
    {
        $this->actingAsClient();
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => '老師的單', 'description' => '說明']]]);
        $clientReport = $this->project->feedbackReports()->where('title', '老師的單')->sole();
        $this->assertNotNull($clientReport->client_last_read_at);
        $this->assertNull($clientReport->owner_last_read_at);

        $this->actingAsOwner();
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => '開發者的單', 'description' => '說明']]]);
        $ownerReport = $this->project->feedbackReports()->where('title', '開發者的單')->sole();
        $this->assertNotNull($ownerReport->owner_last_read_at);
        $this->assertNotNull($ownerReport->client_last_read_at);
    }

    public function test_reports_command_lists_unread_counts_and_filters_unread_reports(): void
    {
        $unread = $this->reportReadAt(now()->subHour(), now(), title: '有未讀的單');
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $this->message($unread, FeedbackAuthorType::Owner, now()->subMinutes(4));
        $this->reportReadAt(now(), now(), title: '已讀的單');

        Artisan::call('feedback:reports', ['project' => $this->project->slug, '--json' => true]);
        $rows = collect(json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR))->keyBy('title');
        $this->assertSame(1, $rows['有未讀的單']['unread_messages_count']);
        $this->assertSame(2, $rows['有未讀的單']['messages_count']);
        $this->assertNotNull($rows['有未讀的單']['latest_message_at']);
        $this->assertSame(0, $rows['已讀的單']['unread_messages_count']);

        Artisan::call('feedback:reports', ['project' => $this->project->slug, '--json' => true, '--unread' => true]);
        $this->assertSame(['有未讀的單'], array_column(json_decode(Artisan::output(), true), 'title'));

        // 指令只讀資料，不會把單標為已讀。
        $this->assertSame(1, $this->project->feedbackReports()->unreadByOwner()->count());

        $this->artisan('feedback:reports', ['project' => $this->project->slug])
            ->expectsOutputToContain('未讀')
            ->assertSuccessful();
    }

    public function test_migration_marks_only_unanswered_trailing_client_messages_as_unread(): void
    {
        $base = Carbon::parse('2026-10-16 10:00:00');
        $unanswered = $this->legacyReport('老師最後留言、之後沒動作', $base->copy()->addHour());
        FeedbackAttachment::factory()->for($unanswered)->create(['kind' => FeedbackAttachmentKind::Adjustment, 'created_at' => $base]);
        $this->message($unanswered, FeedbackAuthorType::Reporter, $base->copy()->addHour());

        $laterActivity = $this->legacyReport('老師留言後開發者又更新', $base->copy()->addHours(5));
        $this->message($laterActivity, FeedbackAuthorType::Reporter, $base->copy()->addHour());

        $answeredByImage = $this->legacyReport('調整圖晚於老師留言', $base->copy()->addHours(2));
        $this->message($answeredByImage, FeedbackAuthorType::Reporter, $base->copy()->addHour());
        FeedbackAttachment::factory()->for($answeredByImage)->create(['kind' => FeedbackAttachmentKind::Adjustment, 'created_at' => $base->copy()->addHours(2)]);

        $ownerLast = $this->legacyReport('開發者最後留言', $base->copy()->addHours(2));
        $this->message($ownerLast, FeedbackAuthorType::Reporter, $base->copy()->addHour());
        $this->message($ownerLast, FeedbackAuthorType::Owner, $base->copy()->addHours(2));

        $noMessages = $this->legacyReport('沒有留言', $base);

        $migration = require database_path('migrations/2026_10_19_050808_add_read_state_to_feedback_reports_table.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('feedback_reports', 'owner_last_read_at'));
        $migration->up();

        $this->assertSame(['老師最後留言、之後沒動作'], $this->project->feedbackReports()->unreadByOwner()->pluck('title')->all());
        $this->assertSame($base->toDateTimeString(), $unanswered->refresh()->owner_last_read_at->toDateTimeString());
        foreach ([$laterActivity, $answeredByImage, $ownerLast, $noMessages] as $report) {
            $this->assertNotNull($report->refresh()->owner_last_read_at);
        }
        foreach ([$unanswered, $laterActivity, $answeredByImage, $ownerLast, $noMessages] as $report) {
            $this->assertNotNull($report->refresh()->client_last_read_at);
            $this->assertFalse($report->hasNewReplyForClient());
        }
        $this->assertSame(5, DB::table('feedback_reports')->whereNull('adjustment_updated_at')->count());
    }

    /**
     * 清單／看板上「留言」按鈕的 aria-label，含總留言數與未讀數。
     */
    private function messageButtonLabel(FeedbackReport $report, int $total, int $unread = 0): string
    {
        return 'aria-label="'.e("開啟「{$report->title}」的留言對話（".($total > 0 ? "共 {$total} 則留言" : '還沒有留言').($unread > 0 ? "，{$unread} 則未讀" : '').'）').'"';
    }

    private function reportReadAt(Carbon $ownerReadAt, Carbon $clientReadAt, ?string $title = null): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'title' => $title ?? '回饋單 '.Str::random(6),
            'owner_last_read_at' => $ownerReadAt,
            'client_last_read_at' => $clientReadAt,
            'latest_activity_at' => now()->subDays(3),
            'created_at' => now()->subDays(3),
        ]);
    }

    private function legacyReport(string $title, Carbon $latestActivityAt): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'title' => $title,
            'latest_activity_at' => $latestActivityAt,
        ]);
    }

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at): FeedbackMessage
    {
        return FeedbackMessage::factory()->for($report)->create([
            'author_type' => $author,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function actingAsOwner(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsClient(): void
    {
        // 換成客戶身分：清掉前一個身分留在工作階段與 cookie 佇列裡的授權。
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
