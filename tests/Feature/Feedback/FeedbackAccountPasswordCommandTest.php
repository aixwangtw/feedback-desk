<?php

namespace Tests\Feature\Feedback;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class FeedbackAccountPasswordCommandTest extends TestCase
{
    private string $environmentDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->environmentDirectory = sys_get_temp_dir().'/feedback-env-'.bin2hex(random_bytes(6));
        mkdir($this->environmentDirectory);
        file_put_contents($this->environmentDirectory.'/.env', "APP_NAME=Test\nFEEDBACK_OWNER_PASSWORD_HASH='old'\n");
        $this->app->useEnvironmentPath($this->environmentDirectory);
    }

    protected function tearDown(): void
    {
        @unlink($this->environmentDirectory.'/.env');
        @rmdir($this->environmentDirectory);

        parent::tearDown();
    }

    public function test_it_replaces_the_hash_and_prints_the_password_once(): void
    {
        $this->assertSame(0, Artisan::call('feedback:account-password', ['account' => 'owner']));

        preg_match('/密碼：(\S+)/u', Artisan::output(), $matches);
        $password = $matches[1] ?? '';
        $env = file_get_contents($this->environmentDirectory.'/.env');

        $this->assertSame(24, strlen($password));
        $this->assertStringContainsString('APP_NAME=Test', $env);
        $this->assertSame(1, substr_count($env, 'FEEDBACK_OWNER_PASSWORD_HASH='));
        $this->assertStringNotContainsString($password, $env);
        preg_match("/^FEEDBACK_OWNER_PASSWORD_HASH='(.+)'$/m", $env, $hash);
        $this->assertTrue(Hash::check($password, $hash[1]));
    }

    public function test_it_appends_a_missing_account_hash(): void
    {
        $this->assertSame(0, Artisan::call('feedback:account-password', ['account' => 'client']));

        $env = file_get_contents($this->environmentDirectory.'/.env');
        $this->assertMatchesRegularExpression("/^FEEDBACK_CLIENT_PASSWORD_HASH='\\$2y\\$.+'$/m", $env);
        $this->assertStringContainsString("FEEDBACK_OWNER_PASSWORD_HASH='old'", $env);
    }

    public function test_it_sets_a_given_password_and_shows_the_client_username(): void
    {
        $this->artisan('feedback:account-password', ['account' => 'client', '--password' => 'change-me'])
            ->expectsOutputToContain('帳號：test')
            ->expectsOutputToContain('密碼：change-me')
            ->assertSuccessful();

        preg_match("/^FEEDBACK_CLIENT_PASSWORD_HASH='(.+)'$/m", file_get_contents($this->environmentDirectory.'/.env'), $hash);
        $this->assertTrue(Hash::check('change-me', $hash[1]));
    }

    public function test_it_rejects_an_empty_password(): void
    {
        $this->artisan('feedback:account-password', ['account' => 'client', '--password' => ''])
            ->expectsOutputToContain('--password 不可為空白')
            ->assertFailed();
    }

    public function test_it_rejects_unknown_accounts(): void
    {
        $this->artisan('feedback:account-password', ['account' => 'admin'])
            ->expectsOutputToContain('角色只能是 owner 或 client')
            ->assertFailed();
    }
}
