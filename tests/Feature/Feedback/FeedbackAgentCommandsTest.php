<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FeedbackAgentCommandsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function listJson(array $options = []): array
    {
        Artisan::call('feedback:reports', ['project' => $this->project->slug, '--json' => true, ...$options]);

        return json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    }

    private function makeReport(array $attributes = [], string $createdAt = '2026-01-01 10:00:00'): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'created_at' => $createdAt,
            ...$attributes,
        ]);
    }

    public function test_reports_lists_newest_first_with_counts_and_numbers(): void
    {
        $old = $this->makeReport(['title' => '舊的單'], '2026-01-01 10:00:00');
        $new = $this->makeReport(['title' => '新的單'], '2026-01-02 10:00:00');
        FeedbackMessage::factory()->count(2)->create(['feedback_report_id' => $new->id]);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $new->id]);

        $rows = $this->listJson();

        $this->assertSame(['新的單', '舊的單'], array_column($rows, 'title'));
        $this->assertSame([1, 2], array_column($rows, 'number'));
        $this->assertSame(2, $rows[0]['messages_count']);
        $this->assertSame(1, $rows[0]['attachments_count']);
        $this->assertSame($new->public_id, $rows[0]['public_id']);
        $this->assertSame($old->public_id, $rows[1]['public_id']);
    }

    public function test_reports_table_output_shows_title_and_status_label(): void
    {
        $this->makeReport(['title' => '按鈕點不下去', 'status' => FeedbackReportStatus::NeedsInput]);

        $this->assertSame(0, Artisan::call('feedback:reports', ['project' => $this->project->slug]));
        $output = Artisan::output();

        $this->assertStringContainsString('按鈕點不下去', $output);
        $this->assertStringContainsString('待審核', $output);
    }

    public function test_reports_filters_by_multiple_statuses_using_value_or_label(): void
    {
        $this->makeReport(['title' => 'A', 'status' => FeedbackReportStatus::New]);
        $this->makeReport(['title' => 'B', 'status' => FeedbackReportStatus::NeedsInput]);
        $this->makeReport(['title' => 'C', 'status' => FeedbackReportStatus::Completed]);

        $rows = $this->listJson(['--status' => ['new', '待審核']]);

        $this->assertEqualsCanonicalizing(['A', 'B'], array_column($rows, 'title'));
    }

    public function test_reports_rejects_unknown_status_and_lists_options(): void
    {
        $this->artisan('feedback:reports', ['project' => $this->project->slug, '--status' => ['bogus']])
            ->expectsOutputToContain('needs_input（待審核）')
            ->assertFailed();
    }

    public function test_reports_filters_by_creator(): void
    {
        $this->makeReport(['title' => '老師的']);
        $this->makeReport(['title' => '公開的', 'creator_type' => 'public']);

        $rows = $this->listJson(['--creator' => 'public']);

        $this->assertSame(['公開的'], array_column($rows, 'title'));
        $this->artisan('feedback:reports', ['project' => $this->project->slug, '--creator' => 'nope'])->assertFailed();
    }

    public function test_reports_numbers_differ_between_team_and_client_views(): void
    {
        $this->makeReport(['title' => '老師的'], '2026-01-01 10:00:00');
        $this->makeReport(['title' => '開發者的', 'creator_type' => 'owner_shared'], '2026-01-02 10:00:00');

        $rows = collect($this->listJson())->keyBy('title');

        $this->assertSame(1, $rows['開發者的']['number']);
        $this->assertNull($rows['開發者的']['client_number']);
        $this->assertSame(2, $rows['老師的']['number']);
        $this->assertSame(1, $rows['老師的']['client_number']);
    }

    public function test_reports_hides_client_deleted_unless_requested(): void
    {
        $this->makeReport(['title' => '留著']);
        $this->makeReport(['title' => '被刪', 'client_deleted_at' => now()]);

        $this->assertSame(['留著'], array_column($this->listJson(), 'title'));
        $this->assertCount(2, $this->listJson(['--include-deleted' => true]));
    }

    public function test_reports_does_not_expose_secrets(): void
    {
        $report = $this->makeReport();

        Artisan::call('feedback:reports', ['project' => $this->project->slug, '--json' => true]);
        $output = Artisan::output();

        $this->assertStringNotContainsString($report->reporter_token_hash, $output);
        $this->assertStringNotContainsString('hash', $output);
    }

    public function test_report_reads_full_content_with_attachment_paths_by_public_id_and_number(): void
    {
        $report = $this->makeReport(['title' => '登入頁破版', 'description' => "第一行\n第二行", 'page_url' => 'https://example.test/login', 'adjustment_note' => '已修正']);
        $first = FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'path' => 'feedback/a.png', 'original_name' => 'a.png']);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'kind' => FeedbackAttachmentKind::Adjustment, 'path' => 'feedback/adj.png', 'original_name' => 'adj.png']);
        $message = FeedbackMessage::factory()->create(['feedback_report_id' => $report->id, 'author_type' => FeedbackAuthorType::Owner, 'author_name' => '小編', 'body' => '請補充截圖']);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'feedback_message_id' => $message->id, 'path' => 'feedback/m.png', 'original_name' => 'm.png']);

        foreach ([$report->public_id, '1'] as $identifier) {
            Artisan::call('feedback:report', ['project' => $this->project->slug, 'report' => $identifier, '--json' => true]);
            $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame('登入頁破版', $data['title']);
            $this->assertSame("第一行\n第二行", $data['description']);
            $this->assertSame('https://example.test/login', $data['page_url']);
            $this->assertSame('已修正', $data['adjustment_note']);
            $this->assertCount(1, $data['attachments']);
            $this->assertSame(Storage::disk('local')->path('feedback/a.png'), $data['attachments'][0]['path']);
            $this->assertTrue($data['attachments'][0]['is_local']);
            $this->assertSame(Storage::disk('local')->path('feedback/adj.png'), $data['adjustment_attachments'][0]['path']);
            $this->assertSame('請補充截圖', $data['messages'][0]['body']);
            $this->assertSame('小編', $data['messages'][0]['author']);
            $this->assertSame(Storage::disk('local')->path('feedback/m.png'), $data['messages'][0]['attachments'][0]['path']);
            $this->assertStringNotContainsString('hash', json_encode($data));
        }

        $this->assertNotSame($first->path, Storage::disk('local')->path($first->path));
    }

    public function test_report_text_output_contains_sections(): void
    {
        $report = $this->makeReport(['title' => '登入頁破版']);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'path' => 'feedback/a.png']);

        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => $report->public_id])
            ->expectsOutputToContain('登入頁破版')
            ->expectsOutputToContain(Storage::disk('local')->path('feedback/a.png'))
            ->assertSuccessful();
    }

    public function test_report_marks_non_local_disk_paths(): void
    {
        config(['filesystems.disks.remote' => ['driver' => 's3', 'bucket' => 'b', 'key' => 'k', 'secret' => 's', 'region' => 'r']]);
        $report = $this->makeReport();
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'disk' => 'remote', 'path' => 'feedback/x.png']);

        Artisan::call('feedback:report', ['project' => $this->project->slug, 'report' => $report->public_id, '--json' => true]);
        $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('remote:feedback/x.png', $data['attachments'][0]['path']);
        $this->assertFalse($data['attachments'][0]['is_local']);
    }

    public function test_missing_project_or_report_fails(): void
    {
        $this->artisan('feedback:reports', ['project' => 'nope'])->expectsOutputToContain('找不到回報專案')->assertFailed();
        $this->artisan('feedback:report', ['project' => 'nope', 'report' => '1'])->assertFailed();
        $this->artisan('feedback:status', ['project' => 'nope', 'report' => '1', 'status' => 'new'])->assertFailed();

        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => '99'])->expectsOutputToContain('找不到該回饋單')->assertFailed();
        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => 'no-such-uuid'])->assertFailed();
        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => '99', 'status' => 'new'])->assertFailed();
    }

    public function test_report_in_another_project_is_not_found(): void
    {
        $other = FeedbackReport::factory()->create();

        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => $other->public_id])->assertFailed();
    }

    public function test_status_changes_by_value_label_and_number(): void
    {
        $report = $this->makeReport(['status' => FeedbackReportStatus::New, 'latest_activity_at' => now()->subDay()]);

        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => $report->public_id, 'status' => '待審核'])
            ->expectsOutputToContain('new（待處理）')
            ->expectsOutputToContain('needs_input（待審核）')
            ->assertSuccessful();
        $report->refresh();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->status);
        $this->assertTrue($report->latest_activity_at->isToday());
        $this->assertNull($report->completed_at);

        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => '1', 'status' => 'completed'])->assertSuccessful();
        $report->refresh();
        $this->assertSame(FeedbackReportStatus::Completed, $report->status);
        $this->assertNotNull($report->completed_at);

        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => '1', 'status' => 'new'])->assertSuccessful();
        $this->assertNull($report->refresh()->completed_at);
    }

    public function test_status_completed_by_an_agent_prints_a_reminder_but_still_updates(): void
    {
        $report = $this->makeReport(['status' => FeedbackReportStatus::NeedsInput]);

        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => $report->public_id, 'status' => 'completed', '--agent' => 'Codex'])
            ->expectsOutputToContain('AI 不應直接把單改成已完成')
            ->assertSuccessful();
        $this->assertSame(FeedbackReportStatus::Completed, $report->refresh()->status);
    }

    public function test_status_rejects_unknown_status_and_keeps_report_unchanged(): void
    {
        $report = $this->makeReport(['status' => FeedbackReportStatus::New]);

        $this->assertSame(1, Artisan::call('feedback:status', ['project' => $this->project->slug, 'report' => $report->public_id, 'status' => 'done']));
        $output = Artisan::output();
        foreach (['new（待處理）', 'needs_input（待審核）', 'completed（已完成）'] as $option) {
            $this->assertStringContainsString($option, $output);
        }
        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);
    }

    public function test_number_does_not_resolve_reports_of_another_project(): void
    {
        FeedbackReport::factory()->for(FeedbackProject::factory()->create())->create();

        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => '1'])->assertFailed();
        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => '1', 'status' => 'new'])->assertFailed();
    }

    public function test_number_finds_client_deleted_report(): void
    {
        $report = $this->makeReport(['title' => '被刪的', 'client_deleted_at' => now()]);

        $this->artisan('feedback:report', ['project' => $this->project->slug, 'report' => '1'])->assertSuccessful();
        $this->artisan('feedback:status', ['project' => $this->project->slug, 'report' => '1', 'status' => 'completed'])->assertSuccessful();
        $this->assertSame(FeedbackReportStatus::Completed, $report->refresh()->status);
    }

    public function test_adjust_rejects_bare_number_unless_by_id(): void
    {
        $report = $this->makeReport();

        $this->artisan('feedback:adjust', ['project' => $this->project->slug, 'report' => (string) $report->id, '--note' => 'x'])
            ->expectsOutputToContain('--by-id')
            ->assertFailed();
        $this->assertNull($report->refresh()->adjustment_note);

        $this->artisan('feedback:adjust', ['project' => $this->project->slug, 'report' => (string) $report->id, '--by-id' => true, '--note' => 'x'])->assertSuccessful();
        $this->assertSame('x', $report->refresh()->adjustment_note);

        $this->artisan('feedback:adjust', ['project' => $this->project->slug, 'report' => $report->public_id, '--note' => 'y'])->assertSuccessful();
        $this->assertSame('y', $report->refresh()->adjustment_note);
    }

    public function test_unsafe_attachment_paths_are_not_resolved_to_local_files(): void
    {
        $report = $this->makeReport();
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'path' => '../../.env', 'original_name' => 'a']);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'path' => '/etc/passwd', 'original_name' => 'b']);

        Artisan::call('feedback:report', ['project' => $this->project->slug, 'report' => $report->public_id, '--json' => true]);
        $data = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        foreach ($data['attachments'] as $attachment) {
            $this->assertFalse($attachment['is_local']);
            $this->assertStringStartsWith('local:', $attachment['path']);
        }
    }

    public function test_user_content_with_formatter_tags_is_printed_literally(): void
    {
        $report = $this->makeReport(['title' => '<comment>標題</comment>', 'description' => '<error>說明</error>', 'adjustment_note' => '<info>調整</info>']);
        FeedbackMessage::factory()->create(['feedback_report_id' => $report->id, 'author_name' => '<fg=red>某人</>', 'body' => '<comment>留言</comment>']);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $report->id, 'original_name' => '<comment>x</comment>.png']);

        Artisan::call('feedback:report', ['project' => $this->project->slug, 'report' => $report->public_id], null);
        $output = Artisan::output();
        foreach (['<comment>標題</comment>', '<error>說明</error>', '<info>調整</info>', '<fg=red>某人</>', '<comment>留言</comment>', '<comment>x</comment>.png'] as $literal) {
            $this->assertStringContainsString($literal, $output);
        }

        Artisan::call('feedback:reports', ['project' => $this->project->slug]);
        $this->assertStringContainsString('<comment>標題</comment>', Artisan::output());
    }
}
