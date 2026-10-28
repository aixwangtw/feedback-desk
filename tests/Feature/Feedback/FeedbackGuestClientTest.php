<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FeedbackGuestClientTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackClientAccount $account;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        RateLimiter::clear('guest-minute|127.0.0.1');
        $this->project = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'liff']);
        $this->account = FeedbackClientAccount::factory()->for($this->project)->withPassword('liff-password')->create(['username' => 'liff', 'name' => '張子元']);
        config()->set('feedback.guest_client.project', 'liff');
        config()->set('feedback.guest_client.account', 'liff');
        $this->project->update(['report_categories' => ['程式使用問題', '經典排版', '其他']]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(string $category = '經典排版'): array
    {
        return ['issues' => [['title' => '段落沒有換行', 'description' => '第二段黏在一起。', 'category' => $category]]];
    }

    public function test_guest_sees_portal_with_category_options_without_login(): void
    {
        FeedbackReport::factory()->for($this->project)->create(['title' => '舊的單', 'creator_client_account_id' => $this->account->id]);

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('舊的單')
            ->assertSee('data-issue-category', false)
            ->assertSee('程式使用問題')
            ->assertSee('經典排版')
            ->assertDontSee('data-account-link', false)
            ->assertDontSee('data-logout', false);
    }

    public function test_guest_report_is_created_as_configured_client_account_with_category(): void
    {
        $this->post(route('feedback.reports.store', $this->project), $this->payload())
            ->assertRedirect(route('feedback.portal', $this->project));

        $report = FeedbackReport::query()->sole();
        $this->assertSame(FeedbackCreatorType::Client, $report->creator_type);
        $this->assertSame($this->account->id, $report->creator_client_account_id);
        $this->assertSame('經典排版', $report->category);
        $this->assertSame('張子元', $report->creatorLabel());

        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee('data-report-category', false)
            ->assertSee('經典排版');
    }

    public function test_category_must_be_one_of_the_options(): void
    {
        $this->post(route('feedback.reports.store', $this->project), $this->payload('亂填'))
            ->assertSessionHasErrors('issues.0.category');

        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => 'a', 'description' => 'b']]])
            ->assertSessionHasErrors('issues.0.category');

        $this->assertSame(0, FeedbackReport::query()->count());
    }

    public function test_guest_honeypot_blocks_submission(): void
    {
        $this->post(route('feedback.reports.store', $this->project), $this->payload() + ['contact_website' => 'spam'])
            ->assertSessionHasErrors('issues');

        $this->assertSame(0, FeedbackReport::query()->count());
    }

    public function test_guest_submissions_are_rate_limited(): void
    {
        config()->set('feedback.public_reporting.throttle.per_minute', 2);

        $this->post(route('feedback.reports.store', $this->project), $this->payload())->assertRedirect();
        $this->post(route('feedback.reports.store', $this->project), $this->payload())->assertRedirect();
        $this->post(route('feedback.reports.store', $this->project), $this->payload())->assertTooManyRequests();

        $this->assertSame(2, FeedbackReport::query()->count());
    }

    public function test_guest_messages_are_rate_limited(): void
    {
        config()->set('feedback.public_reporting.message_throttle.per_minute', 1);
        $report = FeedbackReport::factory()->for($this->project)->create(['creator_client_account_id' => $this->account->id]);

        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '補充一下'])->assertRedirect();
        $this->post(route('feedback.messages.store', [$this->project, $report]), ['body' => '再補充'])->assertTooManyRequests();

        $this->assertSame(1, $report->feedbackMessages()->count());
    }

    public function test_guest_cannot_open_account_settings(): void
    {
        $this->post(route('feedback.account.name', $this->project), ['name' => '別人'])->assertForbidden();
        $this->post(route('feedback.account.password', $this->project), ['current_password' => 'x', 'password' => 'new-password-123', 'password_confirmation' => 'new-password-123'])
            ->assertForbidden();

        $this->assertSame('張子元', $this->account->fresh()->name);
    }

    public function test_other_projects_still_require_login(): void
    {
        $other = FeedbackProject::factory()->create(['slug' => 'question-bank']);

        $this->get(route('feedback.portal', $other))->assertRedirect(route('feedback.login', $other));
        $this->post(route('feedback.reports.store', $other), $this->payload())->assertRedirect(route('feedback.login', $other));
    }

    public function test_login_is_required_when_guest_mode_is_not_configured(): void
    {
        config()->set('feedback.guest_client.project', null);

        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_disabled_guest_account_requires_login(): void
    {
        $this->account->update(['disabled_at' => now()]);

        $this->get(route('feedback.portal', $this->project))->assertRedirect(route('feedback.login', $this->project));
    }

    public function test_sites_without_categories_keep_the_form_unchanged(): void
    {
        $this->project->update(['report_categories' => null]);

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertDontSee('data-issue-category', false);
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => 'a', 'description' => 'b']]])->assertRedirect();
        $this->assertNull(FeedbackReport::query()->sole()->category);
    }

    public function test_list_shows_category_column_and_filters_by_category(): void
    {
        FeedbackReport::factory()->for($this->project)->create(['title' => '排版單', 'category' => '經典排版', 'creator_client_account_id' => $this->account->id]);
        FeedbackReport::factory()->for($this->project)->create(['title' => '程式單', 'category' => '程式使用問題', 'creator_client_account_id' => $this->account->id]);
        FeedbackReport::factory()->for($this->project)->create(['title' => '舊單', 'category' => null, 'creator_client_account_id' => $this->account->id]);

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-category-filter', false)
            ->assertSee('未分類')
            ->assertSee('排版單')->assertSee('程式單')->assertSee('舊單');

        $this->get(route('feedback.portal', [$this->project, 'category' => '經典排版']))
            ->assertSee('排版單')->assertDontSee('程式單')->assertDontSee('舊單');

        $this->get(route('feedback.portal', [$this->project, 'category' => '_none']))
            ->assertSee('舊單')->assertDontSee('排版單')->assertDontSee('程式單');

        $this->get(route('feedback.portal', [$this->project, 'category' => '亂填']))
            ->assertSee('排版單')->assertSee('舊單');
    }

    public function test_owner_list_also_has_category_filter(): void
    {
        FeedbackReport::factory()->for($this->project)->create(['title' => '排版單', 'category' => '經典排版', 'creator_client_account_id' => $this->account->id]);
        FeedbackReport::factory()->for($this->project)->create(['title' => '舊單', 'category' => null, 'creator_client_account_id' => $this->account->id]);
        app(FeedbackAccess::class)->grantOwner($this->project);

        $this->get(route('feedback.portal', [$this->project, 'category' => '_none']))
            ->assertOk()
            ->assertSee('data-category-filter', false)
            ->assertSee('舊單')->assertDontSee('排版單');
    }

    public function test_sites_without_categories_have_no_category_column_or_filter(): void
    {
        $this->project->update(['report_categories' => null]);
        FeedbackReport::factory()->for($this->project)->create(['title' => '一般單', 'creator_client_account_id' => $this->account->id]);

        $this->get(route('feedback.portal', [$this->project, 'category' => '_none']))
            ->assertOk()
            ->assertSee('一般單')
            ->assertDontSee('data-category-filter', false)
            ->assertDontSee('data-report-category', false);
    }

    public function test_edit_dialog_offers_category_dropdown_preselected_with_current_category(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['title' => '排版單', 'category' => '經典排版', 'creator_client_account_id' => $this->account->id]);

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();

        $this->assertStringContainsString('id="edit-category-'.$report->public_id.'"', $html);
        $this->assertMatchesRegularExpression('/id="edit-category-'.$report->public_id.'"[\s\S]*?<option value="經典排版" selected/', $html);
    }

    public function test_edit_changes_category_and_rejects_unknown_category(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => '經典排版', 'creator_client_account_id' => $this->account->id]);

        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 't', 'description' => 'd', 'category' => '亂填'])
            ->assertSessionHasErrorsIn('editReport', 'category');
        $this->assertSame('經典排版', $report->fresh()->category);

        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 't', 'description' => 'd', 'category' => '程式使用問題'])
            ->assertSessionHasNoErrors();
        $this->assertSame('程式使用問題', $report->fresh()->category);
    }

    public function test_edit_allows_empty_category_and_preselects_uncategorized(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => null, 'creator_client_account_id' => $this->account->id]);

        $this->get(route('feedback.portal', $this->project))->assertSee('<option value="" selected>未分類</option>', false);
        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 't', 'description' => 'd', 'category' => ''])
            ->assertSessionHasNoErrors();
        $this->assertNull($report->fresh()->category);

        $report->update(['category' => '經典排版']);
        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 't', 'description' => 'd', 'category' => ''])
            ->assertSessionHasNoErrors();
        $this->assertNull($report->fresh()->category);
    }

    public function test_edit_keeps_a_legacy_category_that_is_no_longer_configured(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => '舊分類', 'creator_client_account_id' => $this->account->id]);

        $this->get(route('feedback.portal', $this->project))->assertSee('<option value="舊分類" selected>', false);
        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => 't', 'description' => 'd', 'category' => '舊分類'])
            ->assertSessionHasNoErrors();
        $this->assertSame('舊分類', $report->fresh()->category);
    }

    public function test_creator_is_shown_after_the_adjustment_note_in_list_dialog_and_page(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create([
            'description' => '說明內文XYZ', 'adjustment_note' => '調整內文QRS', 'creator_client_account_id' => $this->account->id,
        ]);

        $html = $this->get(route('feedback.portal', $this->project))->getContent();
        $header = substr($html, strpos($html, '<thead'));
        $this->assertLessThan(strpos($header, '>建立者</th>'), strpos($header, '>調整說明</th>'));
        $this->assertLessThan(strpos($header, '建立日期'), strpos($header, '>建立者</th>'));
        $row = substr($html, strpos($html, '<tbody'));
        $this->assertLessThan(strpos($row, 'data-report-creator'), strpos($row, '調整內文QRS'));

        $dialog = substr($html, strpos($html, 'id="detail-report-'.$report->public_id.'"'));
        $this->assertLessThan(strpos($dialog, '建立者：'), strpos($dialog, '說明內文XYZ'));
        $this->assertLessThan(strpos($dialog, '建立者：'), strpos($dialog, '調整內文QRS'));

        $page = $this->get(route('feedback.reports.show', [$this->project, $report]))->getContent();
        $this->assertLessThan(strpos($page, '建立者：'), strpos($page, '調整內文QRS'));
    }
}
