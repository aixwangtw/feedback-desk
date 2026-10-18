<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackDeveloper;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class FeedbackDeveloperCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_it_creates_a_developer_with_a_random_password_shown_once(): void
    {
        $this->artisan('feedback:developer', ['username' => 'dev-a', '--name' => 'Dev A'])
            ->expectsOutputToContain('顯示名稱：Dev A')
            ->assertSuccessful();

        $developer = FeedbackDeveloper::firstWhere('username', 'dev-a');
        $this->assertSame('Dev A', $developer->name);
        $this->assertNotSame('', $developer->password_hash);
    }

    public function test_it_uses_a_given_password_without_echoing_it(): void
    {
        $this->artisan('feedback:developer', ['username' => 'dev-b', '--name' => 'Dev B', '--password' => 'secret-pass-1'])
            ->doesntExpectOutputToContain('secret-pass-1')
            ->assertSuccessful();

        $this->assertTrue(Hash::check('secret-pass-1', FeedbackDeveloper::firstWhere('username', 'dev-b')->password_hash));
    }

    public function test_running_it_again_resets_the_password_and_keeps_the_name(): void
    {
        $this->artisan('feedback:developer', ['username' => 'dev-a', '--name' => 'Dev A', '--password' => 'first-pass'])->assertSuccessful();
        $this->artisan('feedback:developer', ['username' => 'dev-a', '--password' => 'second-pass'])->assertSuccessful();

        $this->assertSame(1, FeedbackDeveloper::count());
        $developer = FeedbackDeveloper::firstWhere('username', 'dev-a');
        $this->assertSame('Dev A', $developer->name);
        $this->assertTrue(Hash::check('second-pass', $developer->password_hash));
        $this->assertFalse(Hash::check('first-pass', $developer->password_hash));
    }

    public function test_it_rejects_shared_account_usernames_and_blank_options(): void
    {
        $this->artisan('feedback:developer', ['username' => 'admin'])->assertFailed();
        $this->artisan('feedback:developer', ['username' => 'test'])->assertFailed();
        $this->artisan('feedback:developer', ['username' => 'bob', '--password' => ''])->assertFailed();
        $this->artisan('feedback:developer', ['username' => 'bob', '--name' => ''])->assertFailed();

        $this->assertSame(0, FeedbackDeveloper::count());
    }
}
