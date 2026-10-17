<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackProject;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class FeedbackClientAccountCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_it_sets_the_account_with_prefill(): void
    {
        $project = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'client-b', '--password' => 'change-me', '--prefill' => true])
            ->expectsOutputToContain('帳號：client-b')
            ->assertSuccessful();

        $project->refresh();
        $this->assertSame('client-b', $project->client_username);
        $this->assertTrue(Hash::check('change-me', $project->client_password_hash));
        $this->assertSame('client-b', $project->login_prefill_username);
        $this->assertSame('change-me', $project->login_prefill_password);
    }

    public function test_it_generates_a_random_password_without_prefill_and_clears_old_prefill(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'teacher'])
            ->expectsOutputToContain('密碼：')
            ->assertSuccessful();

        $project->refresh();
        $this->assertSame('teacher', $project->client_username);
        $this->assertNull($project->login_prefill_username);
        $this->assertNull($project->login_prefill_password);
        $this->assertNotNull($project->client_password_hash);
    }

    public function test_it_rejects_unknown_projects_and_empty_passwords(): void
    {
        FeedbackProject::factory()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'nope', 'username' => 'x'])->assertFailed();
        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'x', '--password' => ''])->assertFailed();
    }
}
