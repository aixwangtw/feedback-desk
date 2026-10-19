<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * 客戶每人一個帳號：登入、建立者、留言者、未讀各自計算，以及改版前的登入照樣有效。
 */
class FeedbackClientAccountsTest extends TestCase
{
    use LazilyRefreshDatabase;

    /** 1×1 透明 PNG（測試環境沒有 GD）。 */
    public const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private FeedbackProject $project;

    private FeedbackClientAccount $mei;

    private FeedbackClientAccount $ben;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->withoutClientAccount()->create(['client_display_name' => '陳老師']);
        $this->mei = FeedbackClientAccount::factory()->for($this->project)->withPassword('mei-password')->create(['username' => 'mei', 'name' => '林小美']);
        $this->ben = FeedbackClientAccount::factory()->for($this->project)->withPassword('ben-password')->create(['username' => 'ben', 'name' => '張大文']);
    }

    public function test_each_client_signs_in_with_their_own_account_only_on_their_project(): void
    {
        $this->login('mei', 'mei-password');
        $this->assertSame($this->mei->id, app(FeedbackAccess::class)->currentClientAccount($this->project)?->id);

        $this->post(route('feedback.logout', $this->project));
        $this->login('ben', 'ben-password');
        $this->assertSame($this->ben->id, app(FeedbackAccess::class)->currentClientAccount($this->project)?->id);

        $other = FeedbackProject::factory()->withoutClientAccount()->create();
        $this->post(route('feedback.login.store', $other), ['username' => 'mei', 'password' => 'mei-password'])
            ->assertSessionHasErrors('username');
    }

    public function test_a_disabled_account_cannot_sign_in_and_its_sessions_end(): void
    {
        $this->login('mei', 'mei-password');
        $this->mei->forceFill(['disabled_at' => now()])->save();

        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
        $this->post(route('feedback.login.store', $this->project), ['username' => 'mei', 'password' => 'mei-password'])
            ->assertSessionHasErrors('username');
    }

    public function test_reports_messages_and_attachments_record_the_account_and_show_its_name(): void
    {
        $this->login('mei', 'mei-password');
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [[
            'title' => '按鈕沒反應',
            'description' => '首頁的按鈕',
            'screenshots' => [UploadedFile::fake()->createWithContent('a.png', base64_decode(self::PNG))],
        ]]])->assertRedirect();

        $report = FeedbackReport::query()->where('title', '按鈕沒反應')->sole();
        $this->assertSame($this->mei->id, $report->creator_client_account_id);
        $this->assertSame($this->mei->id, $report->feedbackAttachments()->value('uploader_client_account_id'));
        $this->assertSame(['created'], $report->events()->pluck('kind')->all());

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '補充說明'])->assertRedirect();
        $message = $report->feedbackMessages()->sole();
        $this->assertSame($this->mei->id, $message->author_client_account_id);
        $this->assertSame(FeedbackAuthorType::Reporter, $message->author_type);

        // 同專案的另一位客戶看得到是誰開的單、誰留言；本人改名後顯示新名字。
        $this->post(route('feedback.logout', $this->project));
        $this->mei->forceFill(['name' => '林美美'])->save();
        $this->login('ben', 'ben-password');
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('林美美')->assertSee('data-report-creator', false);
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk()
            ->assertSee('建立者：林美美')
            ->assertSeeInOrder(['data-chat-author', '林美美'], false);
    }

    public function test_unread_replies_are_counted_for_each_client_account(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['creator_client_account_id' => $this->mei->id, 'created_at' => now()->subHour()]);
        $this->travel(1)->minutes();
        $report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發者', 'body' => '已修好']);

        $this->login('mei', 'mei-password');
        $this->getJson(route('feedback.conversations.index', $this->project))->assertJsonPath('unread_total', 1);
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();
        $this->getJson(route('feedback.conversations.index', $this->project))->assertJsonPath('unread_total', 0);

        // 小美讀過，大文還沒讀。
        $this->post(route('feedback.logout', $this->project));
        $this->login('ben', 'ben-password');
        $this->getJson(route('feedback.conversations.index', $this->project))
            ->assertJsonPath('unread_total', 1)
            ->assertJsonPath('items.0.creator', '林小美');
    }

    public function test_a_new_account_does_not_start_with_old_replies_unread(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發者', 'body' => '很久以前的回覆', 'created_at' => now()->subDays(3)]);

        $this->travel(1)->minutes();
        $late = FeedbackClientAccount::factory()->for($this->project)->withPassword('late-password')->create(['username' => 'late']);
        $this->login('late', 'late-password');

        $this->getJson(route('feedback.conversations.index', $this->project))->assertJsonPath('unread_total', 0);
        $this->assertNotNull($late);
    }

    public function test_a_login_from_before_the_upgrade_still_works_with_the_migrated_account(): void
    {
        $project = FeedbackProject::factory()->withoutClientAccount()->create();
        $hash = Hash::make('teacher-password');
        $account = $project->clientAccounts()->create(['username' => 'teacher', 'name' => '陳老師', 'password_hash' => $hash]);

        // 改版前的 cookie：客戶帳密登入綁的是專案那一組密碼雜湊（現在搬到客戶帳號裡）。
        $fingerprint = hash_hmac('sha256', "{$project->id}|client|password|{$hash}", (string) config('app.key'));
        $legacy = json_encode([(string) $project->id => ['client' => ['source' => 'password', 'fingerprint' => $fingerprint, 'expires_at' => now()->addDays(10)->getTimestamp()]]]);

        $this->withCookie(FeedbackAccess::COOKIE_NAME, $legacy);
        $this->get(route('feedback.portal', $project))->assertOk();
        $this->assertSame($account->id, app(FeedbackAccess::class)->currentClientAccount($project)?->id);

        // 本人改了密碼，舊 cookie 就失效。
        $account->forceFill(['password_hash' => Hash::make('something else entirely 9')])->save();
        $this->flushSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $legacy);
        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_a_session_from_before_the_upgrade_is_rechecked_against_the_cookie(): void
    {
        $this->withSession(["feedback.client.{$this->project->id}" => true]);
        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_the_team_can_filter_by_client_account(): void
    {
        $meiReport = FeedbackReport::factory()->for($this->project)->create(['title' => '小美的單', 'creator_client_account_id' => $this->mei->id]);
        FeedbackReport::factory()->for($this->project)->create(['title' => '大文的單', 'creator_client_account_id' => $this->ben->id]);
        $this->withSession(["feedback.owner.{$this->project->id}" => true]);

        $this->get(route('feedback.portal', $this->project).'?creator=client:'.$this->mei->id)->assertOk()
            ->assertSee('陳老師：林小美')
            ->assertSee('小美的單')
            ->assertDontSee('大文的單');
        $this->assertNotNull($meiReport);
    }

    private function login(string $username, string $password): TestResponse
    {
        return $this->post(route('feedback.login.store', $this->project), compact('username', 'password'))
            ->assertRedirect(route('feedback.portal', $this->project));
    }
}
