<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\StandardInput;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery\MockInterface;
use Tests\TestCase;

class FeedbackMessageCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::NeedsInput,
            'owner_last_read_at' => now()->subHour(),
            'client_last_read_at' => now()->subHour(),
        ]);
        $this->stdin(null);
    }

    public function test_posts_a_team_message_from_the_text_option_and_prints_its_id(): void
    {
        $this->travel(1)->minutes();

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $this->report->public_id, '--text' => '  已修正，請再試一次  ', '--agent' => 'Claude Code'])
            ->expectsOutputToContain('留言 id')
            ->assertSuccessful();

        $message = FeedbackMessage::sole();
        $this->assertSame('已修正，請再試一次', $message->body);
        $this->assertSame(FeedbackAuthorType::Owner, $message->author_type);
        $this->assertSame('Claude Code', $message->author_agent);
        $this->assertSame($this->report->id, $message->feedback_report_id);

        // 不改狀態；客戶端多 1 則未讀，開發者端不算未讀。
        $report = $this->report->refresh();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->status);
        $this->assertSame(1, $this->clientUnread());
        $this->assertSame(0, $this->project->feedbackReports()->unreadByOwner()->count());
    }

    public function test_prints_the_new_message_id(): void
    {
        $existing = FeedbackMessage::factory()->for($this->report)->create();

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $this->report->public_id, '--text' => '回覆'])
            ->expectsOutputToContain((string) ($existing->id + 1))
            ->assertSuccessful();

        $this->assertSame($existing->id + 1, FeedbackMessage::query()->latest('id')->value('id'));
    }

    public function test_reads_the_message_from_standard_input_when_text_is_omitted(): void
    {
        $this->stdin("第一行\n第二行\n");

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $this->report->public_id])->assertSuccessful();

        $this->assertSame("第一行\n第二行", FeedbackMessage::sole()->body);
    }

    public function test_can_post_as_a_team_member_with_images(): void
    {
        FeedbackDeveloper::factory()->create(['username' => 'amy', 'name' => '王小明']);
        $image = sys_get_temp_dir().'/fdk-test-after-'.uniqid().'.png';
        file_put_contents($image, base64_decode(self::PNG));

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $this->report->public_id, '--text' => '附圖', '--as' => 'amy', '--file' => [$image]])
            ->assertSuccessful();

        $message = FeedbackMessage::sole();
        $this->assertSame('王小明', $message->author_name);
        $this->assertNotNull($message->author_developer_id);
        $attachment = $message->feedbackAttachments()->sole();
        Storage::disk('local')->assertExists($attachment->path);
        $this->assertFileExists($image);
        @unlink($image);
    }

    public function test_rejects_missing_text_numbers_unknown_reports_and_invalid_input(): void
    {
        $base = ['project' => $this->project->slug, 'report' => $this->report->public_id];
        $textFile = tempnam(sys_get_temp_dir(), 'fdk-test-');
        file_put_contents($textFile, 'not an image');

        $this->artisan('feedback:message', $base)->expectsOutputToContain('請用 --text')->assertFailed();
        $this->artisan('feedback:message', [...$base, '--text' => '   '])->assertFailed();
        $this->artisan('feedback:message', [...$base, 'report' => '1', '--text' => 'x'])->expectsOutputToContain('public_id')->assertFailed();
        $this->artisan('feedback:message', [...$base, 'report' => 'missing-id', '--text' => 'x'])->assertFailed();
        $this->artisan('feedback:message', [...$base, 'project' => 'no-such-project', '--text' => 'x'])->assertFailed();
        $this->artisan('feedback:message', [...$base, '--text' => str_repeat('長', 10001)])->assertFailed();
        $this->artisan('feedback:message', [...$base, '--text' => 'x', '--as' => 'nobody'])->assertFailed();
        $this->artisan('feedback:message', [...$base, '--text' => 'x', '--file' => [$textFile]])->expectsOutputToContain('只接受')->assertFailed();

        $this->assertSame(0, FeedbackMessage::count());
        @unlink($textFile);
    }

    public function test_report_from_another_project_is_not_found(): void
    {
        $other = FeedbackReport::factory()->create();

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $other->public_id, '--text' => 'x'])->assertFailed();

        $this->assertSame(0, FeedbackMessage::count());
    }

    private function stdin(?string $content): void
    {
        $this->mock(StandardInput::class, fn (MockInterface $mock) => $mock->shouldReceive('read')->andReturn($content));
    }

    private function clientUnread(): int
    {
        return FeedbackReport::query()->whereKey($this->report->id)->withClientNewReplyCount(null)->sole()->unreadCountFor(false);
    }
}
