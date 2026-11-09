<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * 切換專案不用重新輸入帳密：團隊帳號在任一專案登入就能進每個專案；客戶帳號只能進自己的專案，
 * 同名同密碼的另一個專案帳號也不會被自動授權。
 */
class FeedbackCrossProjectLoginTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const OWNER_PASSWORD = 'owner-test-password';

    private const SHARED_CLIENT_PASSWORD = 'same-pass-everywhere';

    private FeedbackProject $questionBank;

    private FeedbackProject $ending;

    private FeedbackProject $internal;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('feedback.accounts.owner.password_hash', Hash::make(self::OWNER_PASSWORD));

        $this->questionBank = FeedbackProject::factory()->withoutClientAccount()->create(['name' => '題庫', 'slug' => 'question-bank']);
        $this->ending = FeedbackProject::factory()->withoutClientAccount()->create(['name' => 'Ending', 'slug' => 'ending']);
        $this->internal = FeedbackProject::factory()->withoutClientAccount()->create(['name' => '內部', 'slug' => 'internal']);

        FeedbackClientAccount::factory()->for($this->questionBank)->withPassword('chen-pass')->create(['username' => 'chen']);
        FeedbackClientAccount::factory()->for($this->ending)->withPassword('ending-pass')->create(['username' => 'ending']);
        FeedbackClientAccount::factory()->for($this->internal)->withPassword(self::SHARED_CLIENT_PASSWORD)->create(['username' => 'nick-internal']);
        // 同一個人在題庫也有同名同密碼的客戶帳號：不能因此進 internal。
        FeedbackClientAccount::factory()->for($this->questionBank)->withPassword(self::SHARED_CLIENT_PASSWORD)->create(['username' => 'nick-internal']);
    }

    public function test_developer_logging_in_on_one_project_opens_every_project_without_another_login(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);

        $cookie = $this->loginOn($this->questionBank, 'dev-alex', 'dev-pass');

        foreach ([$this->ending, $this->internal, $this->questionBank] as $project) {
            $this->get(route('feedback.portal', $project))->assertOk()->assertSee('切換專案');
        }

        // 工作階段過期後（只剩長效 cookie）一樣能切換。
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->internal))->assertOk();
        $this->assertSame('dev-alex', app(FeedbackAccess::class)->currentDeveloper($this->internal)?->username);
    }

    public function test_shared_owner_logging_in_on_one_project_opens_every_project_without_another_login(): void
    {
        $cookie = $this->loginOn($this->ending, 'admin', self::OWNER_PASSWORD);

        foreach ([$this->questionBank, $this->internal] as $project) {
            $this->get(route('feedback.portal', $project))->assertOk()->assertSee('切換專案');
        }

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->questionBank))->assertOk();
        $this->assertTrue(app(FeedbackAccess::class)->isOwner($this->questionBank));
    }

    public function test_client_login_only_opens_its_own_project_and_switching_back_needs_no_login(): void
    {
        $cookie = $this->loginOn($this->questionBank, 'chen', 'chen-pass');

        $this->get(route('feedback.portal', $this->questionBank))->assertOk()->assertDontSee('切換專案');
        $this->get(route('feedback.portal', $this->ending))->assertRedirect(route('feedback.login', $this->ending));
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
        $this->get(route('feedback.portal', $this->questionBank))->assertOk();

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
        $this->get(route('feedback.portal', $this->questionBank))->assertOk();

        $access = app(FeedbackAccess::class);
        $this->assertFalse($access->hasGlobalOwner());
        $this->assertFalse($access->canManage($this->internal));
        $this->assertFalse($access->canManage($this->ending));
    }

    public function test_same_username_and_password_on_another_project_does_not_open_internal(): void
    {
        $cookie = $this->loginOn($this->questionBank, 'nick-internal', self::SHARED_CLIENT_PASSWORD);

        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
        $this->assertFalse(app(FeedbackAccess::class)->canManage($this->internal));
    }

    public function test_unified_login_with_a_client_account_opens_only_one_project(): void
    {
        $this->post(route('feedback.login.unified.store'), ['username' => 'nick-internal', 'password' => self::SHARED_CLIENT_PASSWORD])
            ->assertRedirect();

        $access = app(FeedbackAccess::class);
        $opened = collect([$this->questionBank, $this->internal])->filter(fn (FeedbackProject $project): bool => $access->canManage($project));

        $this->assertCount(1, $opened);
        $this->assertFalse($access->hasGlobalOwner());
        $this->assertFalse($access->canManage($this->ending));
    }

    public function test_internal_client_cannot_open_other_projects(): void
    {
        $this->loginOn($this->internal, 'nick-internal', self::SHARED_CLIENT_PASSWORD);

        $this->get(route('feedback.portal', $this->internal))->assertOk();
        $this->get(route('feedback.portal', $this->questionBank))->assertRedirect(route('feedback.login', $this->questionBank));
        $this->get(route('feedback.portal', $this->ending))->assertRedirect(route('feedback.login', $this->ending));
    }

    public function test_client_signed_in_to_another_project_is_still_sent_to_login_for_internal_even_when_a_team_member_used_the_browser_before(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);
        $this->loginOn($this->questionBank, 'dev-alex', 'dev-pass');
        $this->post(route('feedback.logout', $this->questionBank))->assertRedirect(route('feedback.login', $this->questionBank));

        $this->loginOn($this->ending, 'ending', 'ending-pass');

        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
        $this->assertFalse(app(FeedbackAccess::class)->isOwner($this->ending));
    }

    public function test_logging_out_of_one_project_signs_the_team_account_out_of_every_project(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);
        $this->loginOn($this->questionBank, 'dev-alex', 'dev-pass');
        $this->get(route('feedback.portal', $this->ending))->assertOk();

        $response = $this->post(route('feedback.logout', $this->questionBank))->assertRedirect(route('feedback.login', $this->questionBank));
        $this->assertTrue($response->getCookie(FeedbackAccess::COOKIE_NAME)->isCleared());

        app('cookie')->flushQueuedCookies();
        $this->defaultCookies = [];
        foreach ([$this->questionBank, $this->ending, $this->internal] as $project) {
            $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
        }
    }

    public function test_unified_logout_also_signs_out_project_logins(): void
    {
        $this->loginOn($this->ending, 'admin', self::OWNER_PASSWORD);

        $this->post(route('feedback.logout.unified'))->assertRedirect(route('feedback.login.unified'));

        app('cookie')->flushQueuedCookies();
        $this->defaultCookies = [];
        $this->get(route('feedback.portal', $this->ending))->assertRedirect(route('feedback.login', $this->ending));
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
    }

    public function test_failed_team_login_grants_no_project(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);

        $this->post(route('feedback.login.store', $this->questionBank), ['username' => 'dev-alex', 'password' => 'wrong'])
            ->assertSessionHasErrors('username')
            ->assertCookieMissing(FeedbackAccess::COOKIE_NAME);

        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
        $this->assertFalse(app(FeedbackAccess::class)->hasGlobalOwner());
    }

    public function test_login_rate_limit_still_blocks_team_accounts_before_any_cross_project_grant(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post(route('feedback.login.store', $this->questionBank), ['username' => 'dev-alex', 'password' => 'wrong']);
        }

        $this->post(route('feedback.login.store', $this->questionBank), ['username' => 'dev-alex', 'password' => 'dev-pass'])
            ->assertTooManyRequests();
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
    }

    public function test_changing_the_developer_password_ends_the_cross_project_login_elsewhere(): void
    {
        $developer = FeedbackDeveloper::factory()->create(['username' => 'dev-alex', 'password_hash' => Hash::make('dev-pass')]);
        $cookie = $this->loginOn($this->questionBank, 'dev-alex', 'dev-pass');

        $developer->update(['password_hash' => Hash::make('new-dev-pass')]);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $this->internal))->assertRedirect(route('feedback.login', $this->internal));
    }

    private function loginOn(FeedbackProject $project, string $username, string $password): string
    {
        $response = $this->post(route('feedback.login.store', $project), compact('username', 'password'))
            ->assertRedirect(route('feedback.portal', $project));

        return $response->getCookie(FeedbackAccess::COOKIE_NAME)->getValue();
    }

    /**
     * 模擬工作階段過期的下一個請求：沒有工作階段資料，也沒有先前請求留下的 cookie。
     */
    private function expireSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        app('cookie')->flushQueuedCookies();
    }
}
