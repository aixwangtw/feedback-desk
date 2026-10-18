<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackProject;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

class FeedbackLabelsTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_home_page_uses_the_configured_labels_and_copy(): void
    {
        config()->set('feedback.home.body', '請使用甲提供的乙專屬連結。');

        $this->get(route('feedback.home'))
            ->assertOk()
            ->assertSee('請使用甲提供的乙專屬連結。')
            ->assertSee(config('feedback.home.heading'));
    }

    public function test_shipped_defaults_are_generic_and_derive_home_copy_from_labels(): void
    {
        $config = $this->defaultConfig();

        $this->assertSame('客戶', $config['labels']['client']);
        $this->assertSame('開發團隊', $config['labels']['owner']);
        $this->assertSame('問題回報追蹤', $config['portal_title']);
        $this->assertStringContainsString('開發團隊提供的客戶專屬連結', $config['home']['body']);
        $this->assertFalse($config['login_prefill']['enabled']);
        $this->assertNull($config['accounts']['owner']['username']);
        $this->assertNull($config['login_prefill']['owner']['password']);
    }

    public function test_portal_and_login_pages_follow_configured_labels(): void
    {
        config()->set('feedback.labels.client', '學員');
        config()->set('feedback.labels.owner', '維運組');
        config()->set('feedback.portal_title', '專屬追蹤站');
        $project = FeedbackProject::factory()->create();

        $this->get(route('feedback.owner.login', $project))
            ->assertOk()
            ->assertSee('維運組登入')
            ->assertDontSee('開發者登入');

        $this->get(route('feedback.login', $project))
            ->assertOk()
            ->assertSee('維運組提供的專屬連結');
    }

    public function test_project_client_label_falls_back_to_the_configured_client_label(): void
    {
        config()->set('feedback.labels.client', '學員');

        $this->assertSame('學員', FeedbackProject::factory()->make(['client_display_name' => null])->clientLabel());
        $this->assertSame('示範客戶', FeedbackProject::factory()->make(['client_display_name' => '示範客戶'])->clientLabel());
    }

    /**
     * @return array<string, mixed>
     */
    private function defaultConfig(): array
    {
        $keys = ['FEEDBACK_LABEL_CLIENT', 'FEEDBACK_LABEL_OWNER', 'FEEDBACK_PORTAL_TITLE', 'FEEDBACK_HOME_BODY',
            'FEEDBACK_LOGIN_PREFILL_ENABLED', 'FEEDBACK_OWNER_USERNAME', 'FEEDBACK_OWNER_LOGIN_PREFILL_PASSWORD'];
        $saved = [];
        foreach ($keys as $key) {
            $saved[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }

        try {
            return require config_path('feedback.php');
        } finally {
            foreach ($saved as $key => [$env, $server, $getenv]) {
                if ($env !== null) {
                    $_ENV[$key] = $env;
                }
                if ($server !== null) {
                    $_SERVER[$key] = $server;
                }
                if ($getenv !== false) {
                    putenv("{$key}={$getenv}");
                }
            }
        }
    }
}
