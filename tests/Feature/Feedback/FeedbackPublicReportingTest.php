<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Services\TurnstileVerifier;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackPublicReportingTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private FeedbackProject $project;

    private string $ownerToken;

    private string $clientToken;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->ownerToken = Str::random(48);
        $this->clientToken = Str::random(48);
        $this->project = FeedbackProject::factory()->create([
            'slug' => 'feedback-desk',
            'owner_token_hash' => hash('sha256', $this->ownerToken),
            'client_token_hash' => hash('sha256', $this->clientToken),
            'public_reporting_enabled' => true,
        ]);
        config()->set('feedback.public_reporting.home_project', 'feedback-desk');
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'title' => '儲存後畫面空白',
            'description' => '按下儲存之後整頁變空白。',
            'reporter_name' => 'Mia',
        ], $overrides);
    }

    /**
     * 送一張公開單，回傳 [report, 私密網址, 瀏覽器 cookie]。
     *
     * @return array{0: FeedbackReport, 1: string, 2: string}
     */
    private function submitAsNewBrowser(array $overrides = []): array
    {
        $this->expireSession();

        $response = $this->post(route('feedback.public.store'), $this->payload($overrides))->assertSessionHasNoErrors();
        $report = FeedbackReport::query()->latest('id')->firstOrFail();
        $privateUrl = session('private_report_url');
        $cookie = $response->getCookie(FeedbackAccess::PUBLIC_COOKIE_NAME)->getValue();

        return [$report, $privateUrl, $cookie];
    }

    private function expireSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        app('cookie')->flushQueuedCookies();
    }

    private function actingAsOwner(): void
    {
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken)->assertRedirect();
    }

    private function actingAsClient(): void
    {
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$this->clientToken)->assertRedirect();
    }

    private function image(string $name = 'shot.png', int $kilobytes = 10): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG))->size($kilobytes);
    }

    public function test_home_keeps_the_old_page_when_no_project_is_configured(): void
    {
        config()->set('feedback.public_reporting.home_project', null);

        $this->get('/')->assertOk()->assertSee(config('feedback.home.body'))->assertDontSee('data-public-report-form', false);
    }

    public function test_home_keeps_the_old_page_when_the_project_switch_is_off(): void
    {
        $this->project->update(['public_reporting_enabled' => false]);

        $this->get('/')->assertOk()->assertSee(config('feedback.home.body'))->assertDontSee('data-public-report-form', false);
    }

    public function test_home_keeps_the_old_page_when_the_configured_slug_does_not_exist(): void
    {
        config()->set('feedback.public_reporting.home_project', 'missing');

        $this->get('/')->assertOk()->assertSee(config('feedback.home.body'))->assertDontSee('data-public-report-form', false);
    }

    public function test_home_shows_the_form_when_both_conditions_hold(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertSee('data-public-report-form', false)
            ->assertDontSee('你送出的單')
            ->assertDontSee('data-public-github', false)
            ->assertDontSee('data-public-blog', false)
            ->assertDontSee('data-public-notice', false)
            ->assertDontSee('data-turnstile', false);
    }

    public function test_links_and_notice_appear_only_when_configured(): void
    {
        config()->set('feedback.public_reporting.github_url', 'https://github.com/example/desk');
        config()->set('feedback.public_reporting.blog_url', 'https://example.com/blog/desk/');
        config()->set('feedback.public_reporting.notice', 'Bug reports are welcome in any language.');
        config()->set('feedback.public_reporting.intro', '這是簡短說明。');

        $this->get('/')
            ->assertSee('href="https://github.com/example/desk"', false)
            ->assertSee('href="https://example.com/blog/desk/"', false)
            ->assertSee('Bug reports are welcome in any language.')
            ->assertSee('這是簡短說明。');
    }

    public function test_submitting_a_report_creates_a_public_report_and_shows_the_private_url_once(): void
    {
        $response = $this->post(route('feedback.public.store'), $this->payload([
            'screenshots' => [$this->image('a.png'), $this->image('b.jpg')],
        ]));

        $report = FeedbackReport::firstOrFail();
        $response->assertRedirect(route('feedback.reports.show', [$this->project, $report]));
        $this->assertSame(FeedbackCreatorType::Public, $report->creator_type);
        $this->assertSame('Mia', $report->reporter_name);
        $this->assertSame($this->project->id, $report->feedback_project_id);
        $this->assertSame(2, $report->feedbackAttachments()->count());
        $this->assertNotNull($response->getCookie(FeedbackAccess::PUBLIC_COOKIE_NAME));

        $privateUrl = session('private_report_url');
        $this->assertStringStartsWith(route('feedback.reports.show', [$this->project, $report]).'?access=', $privateUrl);
        $token = Str::after($privateUrl, '?access=');
        $this->assertSame(hash('sha256', $token), $report->reporter_token_hash);

        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee('存下這個網址才能回來看')
            ->assertSee($privateUrl, false);
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertDontSee('存下這個網址才能回來看');
    }

    public function test_name_is_optional_and_no_email_is_collected(): void
    {
        $this->post(route('feedback.public.store'), ['title' => 'T', 'description' => 'D', 'email' => 'a@b.c'])
            ->assertSessionHasNoErrors();

        $report = FeedbackReport::firstOrFail();
        $this->assertNull($report->reporter_name);
        $this->assertSame('公開回報', $report->creatorLabel());
    }

    public function test_required_fields_and_lengths_are_validated(): void
    {
        $this->post(route('feedback.public.store'), ['title' => '', 'description' => ''])
            ->assertSessionHasErrors(['title', 'description']);
        $this->post(route('feedback.public.store'), $this->payload(['reporter_name' => str_repeat('a', 51)]))
            ->assertSessionHasErrors('reporter_name');
        $this->post(route('feedback.public.store'), $this->payload(['title' => str_repeat('a', 161)]))
            ->assertSessionHasErrors('title');

        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_screenshot_limits_are_enforced(): void
    {
        config()->set('feedback.public_reporting.throttle.per_minute', 100);

        $this->post(route('feedback.public.store'), $this->payload(['screenshots' => [
            $this->image('1.png'), $this->image('2.png'), $this->image('3.png'), $this->image('4.png'),
        ]]))->assertSessionHasErrors('screenshots');

        $this->post(route('feedback.public.store'), $this->payload(['screenshots' => [$this->image('big.png', 5121)]]))
            ->assertSessionHasErrors('screenshots.0');
        $this->post(route('feedback.public.store'), $this->payload(['screenshots' => [UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf')]]))
            ->assertSessionHasErrors('screenshots.0');

        $this->assertSame(0, FeedbackReport::count());

        $this->post(route('feedback.public.store'), $this->payload(['screenshots' => [
            $this->image('1.png'), $this->image('2.png'), $this->image('3.png', 5120),
        ]]))->assertSessionHasNoErrors();
        $this->assertSame(3, FeedbackReport::firstOrFail()->feedbackAttachments()->count());
    }

    public function test_store_is_not_found_when_public_reporting_is_not_active(): void
    {
        $this->project->update(['public_reporting_enabled' => false]);

        $this->post(route('feedback.public.store'), $this->payload())->assertNotFound();
        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_honeypot_blocks_without_creating_a_report(): void
    {
        $this->post(route('feedback.public.store'), $this->payload(['contact_website' => 'http://spam.example']))
            ->assertRedirect(route('feedback.home'));

        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_submissions_are_throttled_per_ip(): void
    {
        config()->set('feedback.public_reporting.throttle.per_minute', 2);

        $this->post(route('feedback.public.store'), $this->payload())->assertRedirect();
        $this->post(route('feedback.public.store'), $this->payload())->assertRedirect();
        $this->post(route('feedback.public.store'), $this->payload())->assertStatus(429);

        $this->assertSame(2, FeedbackReport::count());
    }

    public function test_hourly_limit_applies_too(): void
    {
        config()->set('feedback.public_reporting.throttle.per_minute', 100);
        config()->set('feedback.public_reporting.throttle.per_hour', 1);

        $this->post(route('feedback.public.store'), $this->payload())->assertRedirect();
        $this->post(route('feedback.public.store'), $this->payload())->assertStatus(429);
    }

    public function test_turnstile_is_off_unless_both_keys_are_set(): void
    {
        Http::fake();
        config()->set('feedback.public_reporting.turnstile.site_key', 'site');

        $this->get('/')->assertDontSee('data-turnstile', false);
        $this->post(route('feedback.public.store'), $this->payload())->assertSessionHasNoErrors();
        Http::assertNothingSent();
    }

    public function test_turnstile_widget_is_rendered_when_enabled(): void
    {
        config()->set('feedback.public_reporting.turnstile.site_key', 'site-key-123');
        config()->set('feedback.public_reporting.turnstile.secret_key', 'secret');

        $this->get('/')->assertSee('data-sitekey="site-key-123"', false);
    }

    public function test_turnstile_failure_blocks_the_report(): void
    {
        config()->set('feedback.public_reporting.turnstile.site_key', 'site');
        config()->set('feedback.public_reporting.turnstile.secret_key', 'secret');
        Http::fake([TurnstileVerifier::VERIFY_URL => Http::response(['success' => false])]);

        $this->post(route('feedback.public.store'), $this->payload(['cf-turnstile-response' => 'bad']))
            ->assertSessionHasErrors('turnstile');
        $this->post(route('feedback.public.store'), $this->payload())->assertSessionHasErrors('turnstile');

        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_turnstile_outage_blocks_the_report(): void
    {
        config()->set('feedback.public_reporting.turnstile.site_key', 'site');
        config()->set('feedback.public_reporting.turnstile.secret_key', 'secret');
        Http::fake([TurnstileVerifier::VERIFY_URL => Http::response('boom', 500)]);

        $this->post(route('feedback.public.store'), $this->payload(['cf-turnstile-response' => 'tok']))
            ->assertSessionHasErrors('turnstile');
    }

    public function test_turnstile_success_creates_the_report_and_sends_the_secret(): void
    {
        config()->set('feedback.public_reporting.turnstile.site_key', 'site');
        config()->set('feedback.public_reporting.turnstile.secret_key', 'secret');
        Http::fake([TurnstileVerifier::VERIFY_URL => Http::response(['success' => true])]);

        $this->post(route('feedback.public.store'), $this->payload(['cf-turnstile-response' => 'good']))
            ->assertSessionHasNoErrors();

        $this->assertSame(1, FeedbackReport::count());
        Http::assertSent(fn (Request $request): bool => $request->url() === TurnstileVerifier::VERIFY_URL
            && $request['secret'] === 'secret'
            && $request['response'] === 'good');
    }

    public function test_honeypot_skips_the_turnstile_call(): void
    {
        config()->set('feedback.public_reporting.turnstile.site_key', 'site');
        config()->set('feedback.public_reporting.turnstile.secret_key', 'secret');
        Http::fake();

        $this->post(route('feedback.public.store'), $this->payload(['contact_website' => 'x', 'cf-turnstile-response' => 'good']));

        Http::assertNothingSent();
        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_private_url_in_a_fresh_browser_shows_only_that_report(): void
    {
        [$report, $privateUrl] = $this->submitAsNewBrowser();
        $other = FeedbackReport::factory()->for($this->project)->create(['title' => '別人的單']);
        $this->expireSession();

        $this->get($privateUrl)->assertRedirect(route('feedback.reports.show', [$this->project, $report]));
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee($report->title)
            ->assertDontSee('data-adjustment-editor', false)
            ->assertDontSee('更新狀態')
            ->assertDontSee('編號');

        $this->get(route('feedback.reports.show', [$this->project, $other]))->assertRedirect(route('feedback.login', $this->project));
        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
        $this->get(route('feedback.owner.index', $this->project))->assertRedirect(route('feedback.owner.login', $this->project));
    }

    public function test_reporter_cannot_see_another_public_report_even_with_a_valid_own_grant(): void
    {
        [$mine] = $this->submitAsNewBrowser();
        $theirs = FeedbackReport::factory()->for($this->project)->create(['creator_type' => FeedbackCreatorType::Public]);

        $this->get(route('feedback.reports.show', [$this->project, $theirs]))->assertNotFound();
        $this->get(route('feedback.reports.activity', [$this->project, $theirs]))->assertRedirect(route('feedback.login', $this->project));
        $this->get(route('feedback.reports.show', [$this->project, $mine]))->assertOk();
    }

    public function test_reporter_cannot_change_status_edit_delete_or_write_adjustments(): void
    {
        [$report] = $this->submitAsNewBrowser();
        $url = fn (string $name) => route($name, [$this->project, $report]);

        $this->patch($url('feedback.reports.status.update'), ['status' => 'completed'])->assertRedirect(route('feedback.login', $this->project));
        $this->patch(route('feedback.owner.status.update', [$this->project, $report]), ['status' => 'completed'])->assertRedirect(route('feedback.login', $this->project));
        $this->put($url('feedback.reports.update'), ['title' => '改標題', 'description' => '改'])->assertRedirect(route('feedback.login', $this->project));
        $this->delete($url('feedback.reports.destroy'))->assertRedirect(route('feedback.login', $this->project));
        $this->delete($url('feedback.reports.client-destroy'))->assertRedirect(route('feedback.login', $this->project));
        $this->patch($url('feedback.reports.restore'))->assertRedirect(route('feedback.login', $this->project));
        $this->put($url('feedback.reports.adjustment.update'), ['adjustment_note' => 'x'])->assertRedirect(route('feedback.login', $this->project));

        $report->refresh();
        $this->assertSame(FeedbackReportStatus::New, $report->status);
        $this->assertSame('儲存後畫面空白', $report->title);
        $this->assertNull($report->adjustment_note);
        $this->assertNull($report->client_deleted_at);
        $this->assertSame(1, FeedbackReport::count());
    }

    public function test_reporter_can_leave_messages_with_up_to_three_images(): void
    {
        [$report] = $this->submitAsNewBrowser(['reporter_name' => 'Mia']);

        $this->post(route('feedback.messages.store', [$this->project, $report]), [
            'body' => '補充：Chrome 才會發生。',
            'screenshots' => [$this->image('1.png'), $this->image('2.png')],
        ])->assertSessionHasNoErrors();

        $message = $report->feedbackMessages()->firstOrFail();
        $this->assertSame('Mia', $message->author_name);
        $this->assertSame(2, $message->feedbackAttachments()->count());

        $this->post(route('feedback.messages.store', [$this->project, $report]), [
            'body' => '太多圖',
            'screenshots' => [$this->image('1.png'), $this->image('2.png'), $this->image('3.png'), $this->image('4.png')],
        ])->assertSessionHasErrors('screenshots');
        $this->post(route('feedback.messages.store', [$this->project, $report]), [
            'body' => '太大',
            'screenshots' => [$this->image('big.png', 5121)],
        ])->assertSessionHasErrors('screenshots.0');
        $this->assertSame(1, $report->feedbackMessages()->count());
    }

    public function test_stranger_cannot_message_or_download_attachments_of_a_public_report(): void
    {
        [$report] = $this->submitAsNewBrowser(['screenshots' => [$this->image('a.png')]]);
        $attachment = $report->feedbackAttachments()->firstOrFail();
        $this->expireSession();

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => 'hi'])->assertRedirect(route('feedback.login', $this->project));
        $this->get(route('feedback.attachments.show', [$this->project, $report, $attachment]))->assertRedirect(route('feedback.login', $this->project));
        $this->assertSame(0, $report->feedbackMessages()->count());
    }

    public function test_reporter_sees_the_adjustment_note_and_team_replies(): void
    {
        [$report, $privateUrl] = $this->submitAsNewBrowser();
        $report->update(['adjustment_note' => '已調整儲存流程']);

        $this->actingAsOwner();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '我們修好了'])->assertSessionHasNoErrors();

        $this->expireSession();
        $this->get($privateUrl);
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee('已調整儲存流程')
            ->assertSee('我們修好了')
            ->assertDontSee('data-adjustment-editor', false);
    }

    public function test_my_reports_list_shows_only_reports_of_this_browser(): void
    {
        [$first, , $firstCookie] = $this->submitAsNewBrowser(['title' => '第一張']);
        [$second, , $secondCookie] = $this->submitAsNewBrowser(['title' => '第二張']);
        FeedbackReport::factory()->for($this->project)->create(['title' => '客戶的單']);
        FeedbackReport::factory()->for($this->project)->create(['title' => '別人的公開單', 'creator_type' => FeedbackCreatorType::Public]);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $firstCookie)->get('/')
            ->assertSee('你送出的單')
            ->assertSee('第一張')
            ->assertDontSee('第二張')
            ->assertDontSee('客戶的單')
            ->assertDontSee('別人的公開單');

        $this->expireSession();
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $secondCookie)->get('/')
            ->assertSee('第二張')
            ->assertDontSee('第一張');

        $this->expireSession();
        $this->get('/')->assertDontSee('你送出的單');
    }

    public function test_cookie_alone_lets_the_browser_back_into_its_report_but_not_others(): void
    {
        [$report, , $cookie] = $this->submitAsNewBrowser();
        $other = FeedbackReport::factory()->for($this->project)->create(['creator_type' => FeedbackCreatorType::Public]);

        $this->expireSession();
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $cookie);
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();
        $this->get(route('feedback.reports.show', [$this->project, $other]))->assertNotFound();
    }

    public function test_forged_or_stale_cookie_tokens_are_ignored(): void
    {
        [$report] = $this->submitAsNewBrowser();
        $this->expireSession();

        $forged = json_encode([$report->public_id => 'not-the-token']);
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $forged)->get('/')->assertDontSee('你送出的單');
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $forged)
            ->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertNotFound();
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, 'garbage')->get('/')->assertOk();
    }

    public function test_opening_a_private_url_adds_the_report_to_the_browsers_list(): void
    {
        [, $privateUrl] = $this->submitAsNewBrowser(['title' => '從別台來的']);
        $this->expireSession();

        $response = $this->get($privateUrl);
        $cookie = $response->getCookie(FeedbackAccess::PUBLIC_COOKIE_NAME)->getValue();
        $this->expireSession();
        $this->withCookie(FeedbackAccess::PUBLIC_COOKIE_NAME, $cookie)->get('/')->assertSee('從別台來的');
    }

    public function test_team_sees_public_reports_and_can_filter_and_change_status(): void
    {
        [$report] = $this->submitAsNewBrowser(['title' => '陌生人的單', 'reporter_name' => 'Mia']);
        FeedbackReport::factory()->for($this->project)->create(['title' => '客戶的單']);

        $this->actingAsOwner();
        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('陌生人的單')
            ->assertSee('客戶的單')
            ->assertSee('公開回報（Mia）');
        $this->get(route('feedback.portal', [$this->project, 'creator' => 'public']))
            ->assertSee('陌生人的單')
            ->assertDontSee('客戶的單');
        $this->get(route('feedback.portal', [$this->project, 'creator' => 'client']))
            ->assertDontSee('陌生人的單');

        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertRedirect();
        $this->assertSame(FeedbackReportStatus::Completed, $report->fresh()->status);
    }

    public function test_existing_clients_cannot_see_public_reports(): void
    {
        [$report] = $this->submitAsNewBrowser(['title' => '陌生人的單']);
        FeedbackReport::factory()->for($this->project)->create(['title' => '客戶的單']);

        $this->expireSession();
        $this->actingAsClient();
        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('客戶的單')
            ->assertDontSee('陌生人的單');
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertNotFound();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => 'x'])->assertNotFound();
        $this->patch(route('feedback.reports.status.update', [$this->project, $report]), ['status' => 'completed'])->assertNotFound();
        $this->assertSame(FeedbackReportStatus::New, $report->fresh()->status);
    }

    public function test_public_reporter_never_gains_client_access(): void
    {
        $this->submitAsNewBrowser();

        $access = app(FeedbackAccess::class);
        $this->assertFalse($access->isClient($this->project));
        $this->assertFalse($access->isOwner($this->project));
        $this->assertFalse($access->canManage($this->project));
    }

    public function test_public_reports_never_trigger_automation(): void
    {
        config()->set('feedback.automation.enabled', true);
        $this->project->update(['automation_enabled' => true]);

        $this->post(route('feedback.public.store'), $this->payload())->assertSessionHasNoErrors();

        $this->assertSame(0, FeedbackReport::firstOrFail()->automationRuns()->count());
    }

    public function test_command_switches_public_reporting_on_and_off(): void
    {
        $this->project->update(['public_reporting_enabled' => false]);

        $this->artisan('feedback:public-reporting', ['project' => 'feedback-desk', 'mode' => 'on'])->assertSuccessful();
        $this->assertTrue($this->project->fresh()->public_reporting_enabled);

        $this->artisan('feedback:public-reporting', ['project' => 'feedback-desk', 'mode' => 'off'])->assertSuccessful();
        $this->assertFalse($this->project->fresh()->public_reporting_enabled);

        $this->artisan('feedback:public-reporting', ['project' => 'feedback-desk', 'mode' => 'maybe'])->assertFailed();
        $this->artisan('feedback:public-reporting', ['project' => 'nope', 'mode' => 'on'])->assertFailed();
    }

    public function test_new_projects_default_to_public_reporting_off(): void
    {
        $this->assertFalse(FeedbackProject::create([
            'name' => 'X', 'slug' => 'x', 'owner_token_hash' => 'h',
        ])->fresh()->public_reporting_enabled);
    }
}
