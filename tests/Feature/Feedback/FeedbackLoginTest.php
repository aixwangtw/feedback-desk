<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class FeedbackLoginTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const OWNER_PASSWORD = 'owner-test-password';

    private const CLIENT_PASSWORD = 'change-me';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('feedback.accounts.owner.password_hash', Hash::make(self::OWNER_PASSWORD));
    }

    public function test_guest_opening_the_portal_is_sent_to_a_login_form(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));

        $this->get(route('feedback.login', $project))
            ->assertOk()
            ->assertSee('登入問題清單')
            ->assertSee('name="username"', false)
            ->assertSee('name="password"', false)
            ->assertSee('name="username" value="test"', false)
            ->assertSee('type="password" value="change-me"', false)
            ->assertDontSee(self::OWNER_PASSWORD);
    }

    public function test_owner_and_client_can_log_in_and_return_to_the_portal(): void
    {
        $project = FeedbackProject::factory()->create();

        foreach (['admin' => self::OWNER_PASSWORD, 'test' => self::CLIENT_PASSWORD] as $username => $password) {
            $this->expireSession();

            $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
            $this->post(route('feedback.login.store', $project), compact('username', 'password'))
                ->assertRedirect(route('feedback.portal', $project))
                ->assertCookie(FeedbackAccess::COOKIE_NAME);

            $this->get(route('feedback.portal', $project))->assertOk()->assertSee('登出');
            $this->assertSame($username === 'admin', app(FeedbackAccess::class)->isOwner($project));
        }
    }

    public function test_login_returns_to_the_originally_requested_page(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $reportUrl = route('feedback.reports.show', [$project, $report]);

        $this->get($reportUrl)->assertRedirect(route('feedback.login', $project));

        $this->post(route('feedback.login.store', $project), [
            'username' => 'test',
            'password' => self::CLIENT_PASSWORD,
        ])->assertRedirect($reportUrl);
    }

    public function test_guest_opening_the_owner_page_gets_a_prefilled_owner_login_form_and_returns_there(): void
    {
        $project = FeedbackProject::factory()->create();
        $ownerUrl = route('feedback.owner.index', $project).'?status=completed';

        $this->get($ownerUrl)->assertRedirect(route('feedback.owner.login', $project));

        $this->get(route('feedback.owner.login', $project))
            ->assertOk()
            ->assertSee('開發者登入')
            ->assertSee('name="username" value="admin"', false)
            ->assertSee('type="password" value="change-me"', false)
            ->assertDontSee('value="test"', false);

        $this->from(route('feedback.owner.login', $project))
            ->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => self::OWNER_PASSWORD])
            ->assertRedirect($ownerUrl);

        $this->get($ownerUrl)->assertRedirect(route('feedback.portal', [$project, 'status' => 'completed']));
        $this->get(route('feedback.owner.login', $project))->assertRedirect(route('feedback.owner.index', $project));
    }

    public function test_failed_owner_login_returns_to_the_owner_login_form(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->from(route('feedback.owner.login', $project))
            ->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => 'wrong'])
            ->assertRedirect(route('feedback.owner.login', $project))
            ->assertSessionHasErrors('username');
    }

    public function test_teacher_opening_the_owner_page_can_switch_to_the_owner_account(): void
    {
        $project = FeedbackProject::factory()->create();
        $this->login($project, 'test', self::CLIENT_PASSWORD);

        $this->get(route('feedback.owner.index', $project))->assertRedirect(route('feedback.owner.login', $project));
        $this->get(route('feedback.owner.login', $project))
            ->assertOk()
            ->assertSee('開發者登入')
            ->assertSee('name="username" value="admin"', false);

        $this->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => self::OWNER_PASSWORD])
            ->assertRedirect(route('feedback.owner.index', $project));
        $this->get(route('feedback.owner.index', $project))->assertRedirect(route('feedback.portal', $project));
        $this->assertTrue(app(FeedbackAccess::class)->isOwner($project));
    }

    public function test_json_requests_to_the_owner_page_still_get_forbidden(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->getJson(route('feedback.owner.index', $project))->assertForbidden();

        $this->login($project, 'test', self::CLIENT_PASSWORD);
        $this->getJson(route('feedback.owner.index', $project))->assertForbidden();
    }

    public function test_client_login_page_keeps_teacher_prefill(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->get(route('feedback.login', $project))
            ->assertOk()
            ->assertSee('登入問題清單')
            ->assertSee('name="username" value="test"', false)
            ->assertSee('type="password" value="change-me"', false);
    }

    public function test_failed_login_keeps_the_typed_username_instead_of_the_prefill(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->from(route('feedback.login', $project))
            ->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => 'wrong'])
            ->assertRedirect(route('feedback.login', $project));

        $this->get(route('feedback.login', $project))->assertSee('name="username" value="admin"', false);
    }

    public function test_wrong_credentials_are_rejected(): void
    {
        $project = FeedbackProject::factory()->create();

        foreach ([['admin', self::CLIENT_PASSWORD], ['test', 'wrong'], ['test', self::OWNER_PASSWORD], ['client', self::CLIENT_PASSWORD], ['owner', self::OWNER_PASSWORD], ['root', self::OWNER_PASSWORD]] as [$username, $password]) {
            $this->post(route('feedback.login.store', $project), compact('username', 'password'))
                ->assertSessionHasErrors(['username' => '帳號或密碼錯誤。'])
                ->assertCookieMissing(FeedbackAccess::COOKIE_NAME);
        }

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_account_without_a_configured_password_cannot_log_in(): void
    {
        $project = FeedbackProject::factory()->withoutClientAccount()->create();

        $this->post(route('feedback.login.store', $project), ['username' => 'test', 'password' => ''])
            ->assertSessionHasErrors('password');
        $this->post(route('feedback.login.store', $project), ['username' => 'test', 'password' => 'anything'])
            ->assertSessionHasErrors('username');
    }

    public function test_client_login_cannot_delete_reports(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->login($project, 'test', self::CLIENT_PASSWORD);

        $this->delete(route('feedback.reports.destroy', [$project, $report]))->assertForbidden();
        $this->assertModelExists($report);
    }

    public function test_login_is_rate_limited(): void
    {
        $project = FeedbackProject::factory()->create();

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => 'wrong'])
                ->assertSessionHasErrors('username');
        }

        $this->post(route('feedback.login.store', $project), ['username' => 'admin', 'password' => self::OWNER_PASSWORD])
            ->assertTooManyRequests();
    }

    public function test_remembered_login_restores_access_after_the_session_expires(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $cookie = $this->login($project, 'admin', self::OWNER_PASSWORD);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);

        $this->get(route('feedback.portal', $project))->assertOk();
        $this->assertTrue(session("feedback.owner.{$project->id}"));

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->withCredentials()->patchJson(route('feedback.reports.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::Completed->value,
        ])->assertOk();
        $this->assertSame(FeedbackReportStatus::Completed, $report->refresh()->status);
    }

    public function test_entry_link_also_remembers_access_until_the_link_is_rotated(): void
    {
        $clientToken = Str::random(48);
        $project = FeedbackProject::factory()->create(['client_token_hash' => hash('sha256', $clientToken)]);

        $cookie = $this->get(route('feedback.client.authenticate', $project).'?token='.$clientToken)
            ->assertRedirect(route('feedback.portal', $project))
            ->getCookie(FeedbackAccess::COOKIE_NAME)
            ->getValue();

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $project))->assertOk();

        $project->update(['client_token_hash' => hash('sha256', Str::random(48))]);
        $this->expireSession();
        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_remembered_login_stops_working_after_password_reset(): void
    {
        $project = FeedbackProject::factory()->create();
        $cookie = $this->login($project, 'admin', self::OWNER_PASSWORD);

        config()->set('feedback.accounts.owner.password_hash', Hash::make('a-new-password'));
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_remembered_login_expires_after_thirty_days(): void
    {
        $project = FeedbackProject::factory()->create();
        $cookie = $this->login($project, 'admin', self::OWNER_PASSWORD);

        $this->travel(FeedbackAccess::COOKIE_DAYS + 1)->days();
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_remembered_login_is_scoped_to_its_project_and_rejects_tampering(): void
    {
        $project = FeedbackProject::factory()->create();
        $otherProject = FeedbackProject::factory()->create();
        $cookie = $this->login($project, 'test', self::CLIENT_PASSWORD);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $otherProject))->assertRedirect(route('feedback.login', $otherProject));

        $forged = json_decode($cookie, true);
        $forged[(string) $project->id]['owner'] = $forged[(string) $project->id]['client'];
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, json_encode($forged));
        $this->get(route('feedback.portal', $project))->assertOk();
        $this->assertFalse(app(FeedbackAccess::class)->isOwner($project));
    }

    public function test_logout_clears_session_and_remembered_login(): void
    {
        $project = FeedbackProject::factory()->create();
        $this->login($project, 'admin', self::OWNER_PASSWORD);

        $response = $this->post(route('feedback.logout', $project))
            ->assertRedirect(route('feedback.login', $project));
        $this->assertTrue($response->getCookie(FeedbackAccess::COOKIE_NAME)->isCleared());

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_json_requests_without_access_still_get_forbidden(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();

        $this->patchJson(route('feedback.reports.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::Completed->value,
        ])->assertForbidden();
    }

    /**
     * Simulate a later request whose session has expired: no session flags and no cookies left over from earlier requests.
     */
    private function expireSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        app('cookie')->flushQueuedCookies();
    }

    /**
     * Log in and return the decrypted long-lived access cookie value.
     */
    public function test_each_project_only_accepts_its_own_teacher_account(): void
    {
        $chen = FeedbackProject::factory()->create();
        $clientB = FeedbackProject::factory()->create([
            'client_username' => 'client-b',
            'client_password_hash' => Hash::make('client-b-pass'),
            'login_prefill_username' => 'client-b',
            'login_prefill_password' => 'client-b-pass',
        ]);

        $this->post(route('feedback.login.store', $clientB), ['username' => 'test', 'password' => self::CLIENT_PASSWORD])
            ->assertSessionHasErrors('username');
        $this->post(route('feedback.login.store', $chen), ['username' => 'client-b', 'password' => 'client-b-pass'])
            ->assertSessionHasErrors('username');

        $this->login($chen, 'test', self::CLIENT_PASSWORD);
        $this->assertTrue(app(FeedbackAccess::class)->isClient($chen));
        $this->assertFalse(app(FeedbackAccess::class)->isClient($clientB));

        $this->expireSession();
        $this->login($clientB, 'client-b', 'client-b-pass');
        $this->assertTrue(app(FeedbackAccess::class)->isClient($clientB));
        $this->assertFalse(app(FeedbackAccess::class)->isClient($chen));
    }

    public function test_owner_and_developer_accounts_work_on_every_project(): void
    {
        $developer = FeedbackDeveloper::factory()->create(['username' => 'alex', 'password_hash' => Hash::make('dev-pass')]);
        $clientB = FeedbackProject::factory()->withoutClientAccount()->create();

        $this->login($clientB, 'admin', self::OWNER_PASSWORD);
        $this->assertTrue(app(FeedbackAccess::class)->isOwner($clientB));

        $this->expireSession();
        $this->login($clientB, $developer->username, 'dev-pass');
        $this->assertTrue(app(FeedbackAccess::class)->isOwner($clientB));
    }

    public function test_login_page_prefill_follows_the_project(): void
    {
        $clientB = FeedbackProject::factory()->create([
            'login_prefill_username' => 'client-b',
            'login_prefill_password' => 'abc123',
        ]);
        $plain = FeedbackProject::factory()->withoutClientAccount()->create();

        $this->get(route('feedback.login', $clientB))
            ->assertSee('name="username" value="client-b"', false)
            ->assertSee('type="password" value="abc123"', false);
        $this->get(route('feedback.login', $plain))
            ->assertSee('name="username" value=""', false)
            ->assertSee('type="password" value=""', false);
    }

    public function test_changing_the_teacher_password_invalidates_remembered_login(): void
    {
        $project = FeedbackProject::factory()->create();
        $cookie = $this->login($project, 'test', self::CLIENT_PASSWORD);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $project))->assertOk();

        $project->update(['client_password_hash' => Hash::make('changed')]);
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);
        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    private function login(FeedbackProject $project, string $username, string $password): string
    {
        /** @var TestResponse $response */
        $response = $this->post(route('feedback.login.store', $project), compact('username', 'password'))
            ->assertRedirect(route('feedback.portal', $project));

        return $response->getCookie(FeedbackAccess::COOKIE_NAME)->getValue();
    }
}
