<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackApiToken;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use App\Support\FeedbackPasswordRules;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 「我的帳號」：本人改顯示名稱、改密碼（改完其他登入與 token 失效）、建立給 AI 工具用的 token。
 */
class FeedbackAccountPageTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const NEW_PASSWORD = 'correct horse battery staple 7';

    private FeedbackProject $project;

    private FeedbackClientAccount $client;

    protected function setUp(): void
    {
        parent::setUp();

        $this->project = FeedbackProject::factory()->withoutClientAccount()->create();
        $this->client = FeedbackClientAccount::factory()->for($this->project)->withPassword('client-old-password')->create(['username' => 'mei', 'name' => '林小美']);
    }

    public function test_password_rules_match_the_cloudflare_version(): void
    {
        $this->assertSame(['密碼至少要 16 個字。'], FeedbackPasswordRules::problems('short', 'mei'));
        $this->assertSame(['密碼不能是同一個字或同一小段重複。'], FeedbackPasswordRules::problems(str_repeat('ab', 10), 'mei'));
        $this->assertSame(['密碼不能是連續的字元（例如 abcdefgh…、12345678…）。'], FeedbackPasswordRules::problems('abcdefghijklmnopq', 'zzz'));
        $this->assertSame(['密碼不能包含帳號。'], FeedbackPasswordRules::problems('my name is alex and more', 'Alex'));
        $this->assertSame(['密碼開頭或結尾不能是空白。'], FeedbackPasswordRules::problems(' leading space password', 'mei'));
        $this->assertSame([], FeedbackPasswordRules::problems(self::NEW_PASSWORD, 'mei'));
        $this->assertSame([], FeedbackPasswordRules::problems('一二三四五六七八九十甲乙丙丁戊己', 'mei'));
    }

    public function test_the_holder_changes_the_display_name_but_not_the_username(): void
    {
        $this->loginClient();

        $this->get(route('feedback.portal', $this->project))->assertSee('data-account-link', false);
        $this->get(route('feedback.account', $this->project))->assertOk()->assertSee('登入帳號不能改')->assertSee('mei');
        $this->post(route('feedback.account.name', $this->project), ['name' => '林美美', 'username' => 'hacker'])
            ->assertRedirect(route('feedback.account', $this->project));

        $this->client->refresh();
        $this->assertSame('林美美', $this->client->name);
        $this->assertSame('mei', $this->client->username);
    }

    public function test_changing_the_password_signs_out_other_devices_and_revokes_tokens(): void
    {
        $issued = FeedbackApiToken::issue($this->client, 'MCP', 'Codex');
        $otherDeviceCookie = $this->loginClient();
        $this->flushSession();
        $this->loginClient();

        $this->post(route('feedback.account.password', $this->project), [
            'current_password' => 'client-old-password',
            'new_password' => self::NEW_PASSWORD,
            'new_password_confirmation' => self::NEW_PASSWORD,
        ])->assertRedirect(route('feedback.account', $this->project))->assertSessionHas('success');

        $this->client->refresh();
        $this->assertTrue(Hash::check(self::NEW_PASSWORD, $this->client->password_hash));
        $this->assertTrue($this->client->password_set_by_self);
        $this->assertModelMissing($issued['token']);

        // 這個瀏覽器不用重新登入。
        $this->get(route('feedback.portal', $this->project))->assertOk();

        // 另一台裝置的長效登入失效。
        $this->flushSession();
        app('cookie')->unqueue(FeedbackAccess::COOKIE_NAME);
        $this->withCookie(FeedbackAccess::COOKIE_NAME, $otherDeviceCookie);
        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_another_session_of_the_same_account_ends_after_the_password_changes(): void
    {
        $this->loginClient();
        $session = session()->all();

        $this->client->forceFill(['password_hash' => Hash::make('changed somewhere else 1')])->save();
        $this->flushSession();
        $this->withSession($session);

        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_wrong_current_password_weak_passwords_and_mismatches_are_refused(): void
    {
        $this->loginClient();
        $back = route('feedback.account', $this->project).'#password';

        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'nope', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD])
            ->assertRedirect($back)->assertSessionHasErrorsIn('password', 'current_password');
        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'client-old-password', 'new_password' => 'tooshort', 'new_password_confirmation' => 'tooshort'])
            ->assertSessionHasErrorsIn('password', 'new_password');
        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'client-old-password', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD.'x'])
            ->assertSessionHasErrorsIn('password', 'new_password');

        $this->assertFalse($this->client->refresh()->password_set_by_self);
        $this->assertTrue(Hash::check('client-old-password', $this->client->password_hash));
    }

    public function test_wrong_current_passwords_are_rate_limited_like_the_login_form(): void
    {
        $this->loginClient();
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post(route('feedback.account.password', $this->project), ['current_password' => 'wrong', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD]);
        }

        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'client-old-password', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD])
            ->assertTooManyRequests();
    }

    public function test_a_prefilled_demo_account_cannot_change_its_password_and_a_chosen_password_clears_the_prefill(): void
    {
        $this->project->update(['login_prefill_username' => 'mei', 'login_prefill_password' => 'client-old-password']);
        $this->loginClient();

        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'client-old-password', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD])
            ->assertSessionHasErrorsIn('password', 'current_password');
        $this->assertFalse($this->client->refresh()->password_set_by_self);

        config()->set('feedback.login_prefill.enabled', false);
        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'client-old-password', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD])
            ->assertSessionHasNoErrors();
        $this->assertNull($this->project->refresh()->login_prefill_password);
    }

    public function test_a_developer_password_change_keeps_this_browser_signed_in_on_every_project(): void
    {
        $developer = FeedbackDeveloper::factory()->withPassword('dev-old-password-x')->create(['username' => 'amy']);
        $second = FeedbackProject::factory()->create();
        $this->post(route('feedback.login.store', $this->project), ['username' => 'amy', 'password' => 'dev-old-password-x'])->assertRedirect();
        $this->post(route('feedback.login.store', $second), ['username' => 'amy', 'password' => 'dev-old-password-x'])->assertRedirect();

        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'dev-old-password-x', 'new_password' => self::NEW_PASSWORD, 'new_password_confirmation' => self::NEW_PASSWORD])
            ->assertSessionHasNoErrors();

        $this->assertTrue($developer->refresh()->password_set_by_self);
        $this->get(route('feedback.portal', $second))->assertOk();
        $this->assertTrue(app(FeedbackAccess::class)->isOwner($second));
    }

    public function test_entry_link_and_shared_logins_have_no_account_to_change(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token);

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertDontSee('data-account-link', false);
        $this->get(route('feedback.account', $this->project))->assertOk()->assertSee('data-account-no-account', false);
        $this->post(route('feedback.account.name', $this->project), ['name' => 'x'])->assertForbidden();

        $this->flushSession();
        app('cookie')->unqueue(FeedbackAccess::COOKIE_NAME);
        $this->get(route('feedback.account', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_tokens_are_shown_once_listed_and_revoked_by_their_holder_only(): void
    {
        $this->loginClient();

        $response = $this->post(route('feedback.account.tokens.store', $this->project), ['agent' => 'Hermes Agent（假裝）'])->assertOk();
        $token = FeedbackApiToken::query()->sole();
        $this->assertSame('Hermes Agent假裝', $token->agent);
        $this->assertSame($this->client->id, $token->feedback_client_account_id);
        preg_match('/value="(fdk_[A-Za-z0-9]+)"/', $response->getContent(), $matches);
        $this->assertSame(hash('sha256', $matches[1]), $token->token_hash);

        $this->get(route('feedback.account', $this->project))->assertSee('Hermes Agent假裝')->assertDontSee($matches[1]);

        $otherToken = FeedbackApiToken::issue(FeedbackDeveloper::factory()->create(), 'MCP', null)['token'];
        $this->delete(route('feedback.account.tokens.destroy', [$this->project, $otherToken]))->assertNotFound();
        $this->delete(route('feedback.account.tokens.destroy', [$this->project, $token]))->assertRedirect();
        $this->assertModelMissing($token);
        $this->assertModelExists($otherToken);
    }

    private function loginClient(): string
    {
        return $this->post(route('feedback.login.store', $this->project), ['username' => 'mei', 'password' => 'client-old-password'])
            ->assertRedirect(route('feedback.portal', $this->project))
            ->getCookie(FeedbackAccess::COOKIE_NAME)
            ->getValue();
    }
}
