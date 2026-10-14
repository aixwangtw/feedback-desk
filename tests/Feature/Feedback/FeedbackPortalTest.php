<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackPortalTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_project_portal_is_available_outside_the_admin_panel(): void
    {
        $clientToken = Str::random(48);
        $project = FeedbackProject::factory()->create([
            'name' => '範例專案',
            'client_token_hash' => hash('sha256', $clientToken),
        ]);

        $this->get(route('feedback.portal', $project))->assertForbidden();

        $this->get(route('feedback.client.authenticate', $project).'?token='.$clientToken)
            ->assertRedirect(route('feedback.portal', $project));

        $this->get(route('feedback.portal', $project))
            ->assertOk()
            ->assertSee('問題清單')
            ->assertSee('範例專案')
            ->assertDontSee('你的稱呼')
            ->assertDontSee('發生頁面');
    }

    public function test_validation_errors_are_displayed_in_traditional_chinese(): void
    {
        $clientToken = Str::random(48);
        $project = FeedbackProject::factory()->create([
            'client_token_hash' => hash('sha256', $clientToken),
        ]);
        $this->get(route('feedback.client.authenticate', $project).'?token='.$clientToken);

        $response = $this->post(route('feedback.reports.store', $project), [
            'issues' => [['title' => '', 'description' => '說明']],
        ]);

        $response->assertSessionHasErrors(['issues.0.title' => '問題標題 為必填。']);
    }

    public function test_reporter_can_submit_screenshots_and_receives_private_tracking_access(): void
    {
        Storage::fake('local');
        Queue::fake();
        config()->set('feedback.automation.enabled', true);
        $clientToken = Str::random(48);
        $project = FeedbackProject::factory()->create([
            'automation_enabled' => true,
            'client_token_hash' => hash('sha256', $clientToken),
        ]);
        $this->get(route('feedback.client.authenticate', $project).'?token='.$clientToken);

        $response = $this->post(route('feedback.reports.store', $project), [
            'issues' => [
                [
                    'title' => 'A 手機版無法儲存答案',
                    'description' => '按下儲存後畫面沒有反應。',
                    'screenshots' => [UploadedFile::fake()->createWithContent(
                        'screen.png',
                        base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
                    )],
                ],
                [
                    'title' => 'Z 題目排序不正確',
                    'description' => '第二章顯示在第一章前面。',
                ],
            ],
        ]);

        $report = FeedbackReport::where('title', 'A 手機版無法儲存答案')->sole();
        $response->assertRedirect(route('feedback.portal', $project));
        $response->assertSessionHas('success', '已新增 2 個問題。');
        $this->assertSame(2, FeedbackReport::count());
        $this->assertCount(1, $report->feedbackAttachments);
        Storage::disk('local')->assertExists($report->feedbackAttachments->first()->path);
        Queue::assertPushed(
            ResolveFeedbackReport::class,
            fn ($job) => $job->report->is($report) && $job->queue === 'feedback-automation',
        );

        $this->get(route('feedback.portal', $project).'?sort=title&direction=asc')
            ->assertOk()
            ->assertSeeInOrder(['A 手機版無法儲存答案', 'Z 題目排序不正確']);
    }

    public function test_report_requires_private_access_and_token_grants_it(): void
    {
        $project = FeedbackProject::factory()->create();
        $token = Str::random(48);
        $report = FeedbackReport::factory()->for($project)->create([
            'reporter_token_hash' => hash('sha256', $token),
        ]);

        $this->get(route('feedback.reports.show', [$project, $report]))->assertForbidden();

        $this->get(route('feedback.reports.show', [$project, $report]).'?access='.$token)
            ->assertRedirect(route('feedback.reports.show', [$project, $report]));

        $this->get(route('feedback.reports.show', [$project, $report]))->assertOk();
    }

    public function test_owner_can_mark_a_report_completed(): void
    {
        $ownerToken = Str::random(48);
        $project = FeedbackProject::factory()->create([
            'owner_token_hash' => hash('sha256', $ownerToken),
        ]);
        $report = FeedbackReport::factory()->for($project)->create();

        $this->get(route('feedback.owner.authenticate', $project).'?token='.$ownerToken)
            ->assertRedirect(route('feedback.portal', $project));

        $this->patch(route('feedback.owner.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::Completed->value,
        ])->assertRedirect();

        $report->refresh();
        $this->assertSame(FeedbackReportStatus::Completed, $report->status);
        $this->assertNotNull($report->completed_at);
    }

    public function test_owner_authentication_preserves_https_behind_the_local_tunnel(): void
    {
        $ownerToken = Str::random(48);
        $project = FeedbackProject::factory()->create([
            'owner_token_hash' => hash('sha256', $ownerToken),
        ]);

        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])
            ->withHeaders(['X-Forwarded-Proto' => 'https'])
            ->get(route('feedback.owner.authenticate', $project, false).'?token='.$ownerToken)
            ->assertRedirect(route('feedback.portal', $project));
    }

    public function test_access_is_isolated_between_projects(): void
    {
        $firstOwnerToken = Str::random(48);
        $firstProject = FeedbackProject::factory()->create([
            'owner_token_hash' => hash('sha256', $firstOwnerToken),
        ]);
        $secondProject = FeedbackProject::factory()->create();
        $secondReport = FeedbackReport::factory()->for($secondProject)->create();

        $this->get(route('feedback.owner.authenticate', $firstProject).'?token='.$firstOwnerToken)
            ->assertRedirect(route('feedback.portal', $firstProject));

        $this->get(route('feedback.reports.show', [$secondProject, $secondReport]))
            ->assertForbidden();
        $this->get(route('feedback.reports.show', [$firstProject, $secondReport]))
            ->assertNotFound();
    }

    public function test_screenshot_is_private_and_only_available_with_report_access(): void
    {
        Storage::fake('local');
        $project = FeedbackProject::factory()->create();
        $token = Str::random(48);
        $report = FeedbackReport::factory()->for($project)->create([
            'reporter_token_hash' => hash('sha256', $token),
        ]);
        Storage::disk('local')->put('feedback/private/screen.png', 'private-image');
        $attachment = FeedbackAttachment::factory()->for($report)->create([
            'path' => 'feedback/private/screen.png',
            'size' => 13,
        ]);
        $attachmentUrl = route('feedback.attachments.show', [$project, $report, $attachment]);

        $this->get($attachmentUrl)->assertForbidden();
        $this->get(route('feedback.reports.show', [$project, $report]).'?access='.$token)
            ->assertRedirect();

        $this->get(route('feedback.reports.show', [$project, $report]))
            ->assertOk()
            ->assertSee('data-lightbox-trigger', false)
            ->assertSee('data-image-lightbox', false);

        $this->get($attachmentUrl)
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }
}
