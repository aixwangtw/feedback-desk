<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class FeedbackUnifiedLoginTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const OWNER_PASSWORD = 'owner-test-password';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('feedback.accounts.owner.password_hash', Hash::make(self::OWNER_PASSWORD));
    }

    public function test_guest_can_view_unified_login_page(): void
    {
        $this->get(route('feedback.login.unified'))
            ->assertOk()
            ->assertSee('管理者統一登入')
            ->assertSee('name="username"', false)
            ->assertSee('name="password"', false);
    }

    public function test_developer_can_login_via_unified_login_and_access_all_projects_without_relogin(): void
    {
        $developer = FeedbackDeveloper::factory()->create([
            'username' => 'dev-alice',
            'name' => 'Alice',
            'password_hash' => Hash::make('secret123'),
        ]);

        $projectA = FeedbackProject::factory()->create(['name' => '專案 A']);
        $projectB = FeedbackProject::factory()->create(['name' => '專案 B']);

        $response = $this->post(route('feedback.login.unified.store'), [
            'username' => 'dev-alice',
            'password' => 'secret123',
        ]);

        $response->assertRedirect(route('feedback.portal', $projectA));
        $this->assertTrue(app(FeedbackAccess::class)->hasGlobalOwner());

        // Access project A
        $this->get(route('feedback.portal', $projectA))
            ->assertOk()
            ->assertSee('專案 A')
            ->assertSee('切換專案')
            ->assertSee('專案 B');

        // Access project B directly without re-login!
        $this->get(route('feedback.portal', $projectB))
            ->assertOk()
            ->assertSee('專案 B')
            ->assertSee('切換專案')
            ->assertSee('專案 A');

        $this->assertTrue(app(FeedbackAccess::class)->isOwner($projectB));
        $this->assertSame($developer->id, app(FeedbackAccess::class)->currentDeveloper($projectB)?->id);
    }

    public function test_shared_owner_can_login_via_unified_login_and_switch_projects(): void
    {
        $projectA = FeedbackProject::factory()->create(['name' => 'Alpha']);
        $projectB = FeedbackProject::factory()->create(['name' => 'Beta']);

        $this->post(route('feedback.login.unified.store'), [
            'username' => 'admin',
            'password' => self::OWNER_PASSWORD,
        ])->assertRedirect(route('feedback.portal', $projectA));

        $this->get(route('feedback.portal', $projectB))
            ->assertOk()
            ->assertSee('Beta')
            ->assertSee('切換專案');

        $this->assertTrue(app(FeedbackAccess::class)->isOwner($projectB));
    }

    public function test_unified_login_redirects_to_intended_project_page(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $intendedUrl = route('feedback.reports.show', [$project, $report]);

        // Attempting to view report without login redirects to project login, but records intended
        $this->get($intendedUrl)->assertRedirect(route('feedback.login', $project));

        // Now logging in via unified login should redirect to the intended URL
        $this->post(route('feedback.login.unified.store'), [
            'username' => 'admin',
            'password' => self::OWNER_PASSWORD,
        ])->assertRedirect($intendedUrl);
    }

    public function test_logged_in_manager_visiting_home_sees_projects_dashboard(): void
    {
        $developer = FeedbackDeveloper::factory()->create([
            'username' => 'dev-bob',
            'name' => 'Bob',
            'password_hash' => Hash::make('secret123'),
        ]);

        $project1 = FeedbackProject::factory()->create(['name' => '第一個專案']);
        $project2 = FeedbackProject::factory()->create(['name' => '第二個專案']);

        $this->post(route('feedback.login.unified.store'), [
            'username' => 'dev-bob',
            'password' => 'secret123',
        ]);

        $this->get(route('feedback.home'))
            ->assertOk()
            ->assertSee('專案總覽')
            ->assertSee('第一個專案')
            ->assertSee('第二個專案')
            ->assertSee('Bob')
            ->assertSee('進入專案');
    }

    public function test_unified_logout_clears_global_session(): void
    {
        $developer = FeedbackDeveloper::factory()->create([
            'username' => 'dev-carol',
            'password_hash' => Hash::make('secret123'),
        ]);
        $project = FeedbackProject::factory()->create();

        $this->post(route('feedback.login.unified.store'), [
            'username' => 'dev-carol',
            'password' => 'secret123',
        ]);

        $this->assertTrue(app(FeedbackAccess::class)->hasGlobalOwner());

        $this->post(route('feedback.logout.unified'))
            ->assertRedirect(route('feedback.login.unified'));

        $this->assertFalse(app(FeedbackAccess::class)->hasGlobalOwner());
        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
    }

    public function test_project_logout_also_clears_global_manager_access(): void
    {
        $developer = FeedbackDeveloper::factory()->create([
            'username' => 'dev-dan',
            'password_hash' => Hash::make('secret123'),
        ]);
        $projectA = FeedbackProject::factory()->create();
        $projectB = FeedbackProject::factory()->create();

        $this->post(route('feedback.login.unified.store'), [
            'username' => 'dev-dan',
            'password' => 'secret123',
        ]);

        $this->post(route('feedback.logout', $projectA))
            ->assertRedirect(route('feedback.login', $projectA));

        $this->assertFalse(app(FeedbackAccess::class)->hasGlobalOwner());
        $this->assertFalse(app(FeedbackAccess::class)->isOwner($projectB));
    }

    public function test_client_account_login_at_unified_login_redirects_to_their_project(): void
    {
        $project = FeedbackProject::factory()->create(['name' => '客戶專案']);
        $clientAccount = FeedbackClientAccount::factory()->for($project)->create([
            'username' => 'teacher-mary',
            'password_hash' => Hash::make('teacher-pass'),
        ]);

        $this->post(route('feedback.login.unified.store'), [
            'username' => 'teacher-mary',
            'password' => 'teacher-pass',
        ])->assertRedirect(route('feedback.portal', $project));

        $this->assertTrue(app(FeedbackAccess::class)->isClient($project));
        $this->assertFalse(app(FeedbackAccess::class)->hasGlobalOwner());
    }

    public function test_invalid_credentials_are_rejected_on_unified_login(): void
    {
        $this->post(route('feedback.login.unified.store'), [
            'username' => 'admin',
            'password' => 'wrong-pass',
        ])->assertSessionHasErrors('username');
    }

    public function test_developer_logged_in_to_one_project_can_seamlessly_switch_to_another_project(): void
    {
        FeedbackDeveloper::factory()->create([
            'username' => 'nick',
            'password_hash' => Hash::make('123456'),
        ]);

        $projectA = FeedbackProject::factory()->create(['name' => '專案 A', 'slug' => 'project-a']);
        $projectB = FeedbackProject::factory()->create(['name' => '專案 B', 'slug' => 'project-b']);

        $this->post(route('feedback.login.store', $projectA), [
            'username' => 'nick',
            'password' => '123456',
        ])->assertRedirect(route('feedback.portal', $projectA, false));

        $this->get(route('feedback.portal', $projectA))
            ->assertOk()
            ->assertSee('專案 A')
            ->assertSee('切換專案')
            ->assertSee('data-project-switcher', false)
            ->assertSee('data-project-link', false)
            ->assertSee(route('feedback.portal', $projectB, false), false);

        $this->get(route('feedback.portal', $projectB))
            ->assertOk()
            ->assertSee('專案 B')
            ->assertSee('切換專案');

        $this->assertTrue(app(FeedbackAccess::class)->isOwner($projectB));
    }
}
