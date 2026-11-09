<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Middleware\StartSession;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 全站設了 <meta name="referrer" content="no-referrer">，表單送出不帶 Referer，back() 只能靠 session 記的「上一頁」。
 * 清單縮圖、相簿圖片、下載都是 GET，若也被記成上一頁，老師在手機上按「完成」等一般表單後會被導到最後載入的那張附件圖片。
 * 附件與草稿檔案這類「檔案」路由一律不算上一頁。
 */
class FeedbackPreviousUrlTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackReport $report;

    private FeedbackAttachment $attachment;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::NeedsInput]);
        Storage::disk('local')->put('feedback/test.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
        $this->attachment = FeedbackAttachment::factory()->create(['feedback_report_id' => $this->report->id]);
    }

    public function test_client_complete_after_list_thumbnails_load_returns_to_the_list_not_the_image(): void
    {
        $this->actingAsClient();
        $portal = route('feedback.portal', [$this->project, 'tab' => 'all']);

        $this->get($portal)->assertOk();
        // 瀏覽器接著載入清單縮圖（不帶 Referer、不是 AJAX）。
        $this->get(route('feedback.attachments.show', [$this->project, $this->report, $this->attachment]))->assertOk();

        $this->patch(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])
            ->assertRedirect($portal);
        $this->assertSame(FeedbackReportStatus::Completed, $this->report->refresh()->status);
    }

    public function test_page_views_are_still_remembered_as_the_previous_page(): void
    {
        $this->actingAsClient();
        $page = route('feedback.reports.show', [$this->project, $this->report]);

        $this->get($page)->assertOk();

        $this->patch(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])
            ->assertRedirect($page);
    }

    public function test_every_file_route_that_skips_the_previous_page_exists(): void
    {
        foreach (StartSession::FILE_ROUTES as $name) {
            $this->assertTrue(Route::has($name), "路由 {$name} 改名了，要同步更新 StartSession::FILE_ROUTES。");
        }
    }

    private function actingAsClient(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
