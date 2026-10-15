<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
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
        config()->set('feedback.accounts.client.password_hash', Hash::make(self::CLIENT_PASSWORD));
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

        foreach (['owner' => self::OWNER_PASSWORD, 'test' => self::CLIENT_PASSWORD] as $username => $password) {
            $this->expireSession();

            $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
            $this->post(route('feedback.login.store', $project), compact('username', 'password'))
                ->assertRedirect(route('feedback.portal', $project))
                ->assertCookie(FeedbackAccess::COOKIE_NAME);

            $this->get(route('feedback.portal', $project))->assertOk()->assertSee('登出');
            $this->assertSame($username === 'owner', app(FeedbackAccess::class)->isOwner($project));
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

    public function test_failed_login_keeps_the_typed_username_instead_of_the_prefill(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->from(route('feedback.login', $project))
            ->post(route('feedback.login.store', $project), ['username' => 'owner', 'password' => 'wrong'])
            ->assertRedirect(route('feedback.login', $project));

        $this->get(route('feedback.login', $project))->assertSee('name="username" value="owner"', false);
    }

    public function test_wrong_credentials_are_rejected(): void
    {
        $project = FeedbackProject::factory()->create();

        foreach ([['owner', self::CLIENT_PASSWORD], ['test', 'wrong'], ['client', self::CLIENT_PASSWORD], ['admin', self::OWNER_PASSWORD]] as [$username, $password]) {
            $this->post(route('feedback.login.store', $project), compact('username', 'password'))
                ->assertSessionHasErrors(['username' => '帳號或密碼錯誤。'])
                ->assertCookieMissing(FeedbackAccess::COOKIE_NAME);
        }

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_account_without_a_configured_password_cannot_log_in(): void
    {
        config()->set('feedback.accounts.client.password_hash', null);
        $project = FeedbackProject::factory()->create();

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
            $this->post(route('feedback.login.store', $project), ['username' => 'owner', 'password' => 'wrong'])
                ->assertSessionHasErrors('username');
        }

        $this->post(route('feedback.login.store', $project), ['username' => 'owner', 'password' => self::OWNER_PASSWORD])
            ->assertTooManyRequests();
    }

    public function test_remembered_login_restores_access_after_the_session_expires(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $cookie = $this->login($project, 'owner', self::OWNER_PASSWORD);

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
        $cookie = $this->login($project, 'owner', self::OWNER_PASSWORD);

        config()->set('feedback.accounts.owner.password_hash', Hash::make('a-new-password'));
        $this->expireSession();
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $cookie);

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_remembered_login_expires_after_thirty_days(): void
    {
        $project = FeedbackProject::factory()->create();
        $cookie = $this->login($project, 'owner', self::OWNER_PASSWORD);

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
        $this->login($project, 'owner', self::OWNER_PASSWORD);

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
    private function login(FeedbackProject $project, string $username, string $password): string
    {
        /** @var TestResponse $response */
        $response = $this->post(route('feedback.login.store', $project), compact('username', 'password'))
            ->assertRedirect(route('feedback.portal', $project));

        return $response->getCookie(FeedbackAccess::COOKIE_NAME)->getValue();
    }
}
