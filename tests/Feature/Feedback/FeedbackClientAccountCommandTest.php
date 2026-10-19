<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackApiToken;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class FeedbackClientAccountCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_it_adds_a_client_account_with_prefill(): void
    {
        $project = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'client-b', '--name' => '林小美', '--password' => 'client-pass', '--prefill' => true])
            ->expectsOutputToContain('帳號：client-b')
            ->assertSuccessful();

        $account = $project->clientAccounts()->sole();
        $this->assertSame('client-b', $account->username);
        $this->assertSame('林小美', $account->name);
        $this->assertTrue(Hash::check('client-pass', $account->password_hash));
        $this->assertFalse($account->password_set_by_self);
        $project->refresh();
        $this->assertSame('client-b', $project->login_prefill_username);
        $this->assertSame('client-pass', $project->login_prefill_password);
    }

    public function test_several_clients_get_their_own_accounts_in_one_project(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'mei'])
            ->expectsOutputToContain('密碼：')
            ->assertSuccessful();
        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'ben', '--name' => '張大文'])->assertSuccessful();

        $this->assertSame(['ben', 'mei', 'test'], $project->clientAccounts()->orderBy('username')->pluck('username')->all());
        // 原本那一個帳號不受影響。
        $this->assertTrue(Hash::check('client-pass', $project->clientAccounts()->where('username', 'test')->value('password_hash')));
    }

    public function test_usernames_are_unique_across_the_site_ignoring_case(): void
    {
        FeedbackProject::factory()->create(['slug' => 'a']);
        FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'b']);
        FeedbackDeveloper::factory()->create(['username' => 'Alex']);

        $this->artisan('feedback:client-account', ['project' => 'b', 'username' => 'TEST'])->assertFailed();
        $this->artisan('feedback:client-account', ['project' => 'b', 'username' => 'alex'])->assertFailed();
        $this->artisan('feedback:client-account', ['project' => 'b', 'username' => 'admin'])->assertFailed();
        $this->artisan('feedback:client-account', ['project' => 'b', 'username' => 'has space'])->assertFailed();
        $this->artisan('feedback:developer', ['username' => 'Test'])->assertFailed();

        $this->assertSame(0, FeedbackClientAccount::query()->whereHas('feedbackProject', fn ($query) => $query->where('slug', 'b'))->count());
    }

    public function test_running_it_again_resets_a_generated_password_and_revokes_tokens(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);
        $account = $project->clientAccounts()->sole();
        FeedbackApiToken::issue($account, 'MCP', 'Codex');

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'test'])
            ->expectsOutputToContain('已重設')
            ->assertSuccessful();

        $account->refresh();
        $this->assertFalse(Hash::check('client-pass', $account->password_hash));
        $this->assertSame(0, $account->apiTokens()->count());
        // 預填的是舊密碼，重設後清掉。
        $this->assertNull($project->refresh()->login_prefill_username);
    }

    public function test_a_password_the_holder_chose_cannot_be_reset_or_deleted_by_others(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);
        $account = $project->clientAccounts()->sole();
        $account->forceFill(['password_hash' => Hash::make('my own long password 42'), 'password_set_by_self' => true])->save();

        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'test'])
            ->expectsOutputToContain('本人自己設定')
            ->assertFailed();
        $this->artisan('feedback:client-delete', ['project' => 'client-b', 'username' => 'test', '--force' => true])->assertFailed();

        $this->assertTrue(Hash::check('my own long password 42', $account->refresh()->password_hash));

        $developer = FeedbackDeveloper::factory()->create(['username' => 'amy', 'password_set_by_self' => true]);
        $hash = $developer->password_hash;
        $this->artisan('feedback:developer', ['username' => 'amy'])->assertFailed();
        $this->assertSame($hash, $developer->refresh()->password_hash);
    }

    public function test_the_host_admin_can_recover_any_account(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);
        FeedbackProject::factory()->create(['slug' => 'client-c']);
        $account = $project->clientAccounts()->sole();
        $account->forceFill(['password_set_by_self' => true])->save();
        FeedbackApiToken::issue($account, 'MCP', null);

        // 改版前搬過來的帳號可能跨專案同名，要指定專案。
        $this->artisan('feedback:account-recover', ['username' => 'test'])->assertFailed();
        $this->artisan('feedback:account-recover', ['username' => 'test', '--project' => 'client-b'])
            ->expectsOutputToContain('密碼：')
            ->assertSuccessful();

        $account->refresh();
        $this->assertFalse($account->password_set_by_self);
        $this->assertFalse(Hash::check('client-pass', $account->password_hash));
        $this->assertSame(0, $account->apiTokens()->count());

        $developer = FeedbackDeveloper::factory()->create(['username' => 'amy', 'password_set_by_self' => true]);
        $this->artisan('feedback:account-recover', ['username' => 'amy'])->assertSuccessful();
        $this->assertFalse($developer->refresh()->password_set_by_self);
    }

    public function test_disable_enable_list_and_delete(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'client-b']);
        $account = $project->clientAccounts()->sole();
        $report = FeedbackReport::factory()->for($project)->create(['creator_client_account_id' => $account->id]);
        FeedbackApiToken::issue($account, 'MCP', null);

        $this->artisan('feedback:client-disable', ['project' => 'client-b', 'username' => 'test'])->assertSuccessful();
        $this->assertTrue($account->refresh()->isDisabled());
        $this->assertSame(0, $account->apiTokens()->count());
        $this->artisan('feedback:clients', ['project' => 'client-b'])->expectsOutputToContain('已停用')->assertSuccessful();

        $this->artisan('feedback:client-disable', ['project' => 'client-b', 'username' => 'test', '--enable' => true])->assertSuccessful();
        $this->assertFalse($account->refresh()->isDisabled());

        $this->artisan('feedback:client-delete', ['project' => 'client-b', 'username' => 'test', '--force' => true])->assertSuccessful();
        $this->assertModelMissing($account);
        $this->assertNull($report->refresh()->creator_client_account_id);
        $this->assertSame($project->clientLabel(), $report->creatorLabel());
    }

    public function test_it_rejects_unknown_projects_and_empty_passwords(): void
    {
        FeedbackProject::factory()->create(['slug' => 'client-b']);

        $this->artisan('feedback:client-account', ['project' => 'nope', 'username' => 'x'])->assertFailed();
        $this->artisan('feedback:client-account', ['project' => 'client-b', 'username' => 'x', '--password' => ''])->assertFailed();
    }
}
