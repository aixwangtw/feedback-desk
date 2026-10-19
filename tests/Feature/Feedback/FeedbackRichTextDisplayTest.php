<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackRichTextDisplayTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        $this->project = FeedbackProject::factory()->create();
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::New,
            'description' => "1、辨識錯誤太多\n2、<script>alert('d')</script>",
            'adjustment_note' => "1. 辨識錯誤：已修正\n※ 照片請改用上傳\n2. 浮水印：<img src=x onerror=alert(1)>",
        ]);
    }

    public function test_owner_report_page_formats_description_and_adjustment_note(): void
    {
        $this->actingAsOwner();

        $html = $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->getContent();

        $this->assertFormattedAndEscaped($html);
    }

    public function test_client_portal_detail_dialog_formats_description_and_adjustment_note(): void
    {
        $this->actingAsClient();

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $dialog = Str::between($html, 'id="detail-report-'.$this->report->public_id.'"', '</dialog>');

        $this->assertFormattedAndEscaped($dialog);
    }

    public function test_stored_text_is_not_changed_by_display(): void
    {
        $original = $this->report->only(['description', 'adjustment_note']);
        $this->actingAsClient();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk();

        $this->assertSame($original, $this->report->fresh()->only(['description', 'adjustment_note']));
    }

    private function assertFormattedAndEscaped(string $html): void
    {
        $this->assertGreaterThanOrEqual(2, substr_count($html, 'data-rich-text>'));
        $this->assertStringContainsString('<li value="2"', $html);
        $this->assertStringContainsString('data-rich-text-label>辨識錯誤：</strong>已修正', $html);
        $this->assertStringContainsString('data-rich-text-note', $html);
        $this->assertStringNotContainsString("<script>alert('d')</script>", $html);
        $this->assertStringNotContainsString('<img src=x', $html);
        $this->assertStringContainsString('&lt;img src=x onerror=alert(1)&gt;', $html);
    }

    private function actingAsClient(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsOwner(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }
}
