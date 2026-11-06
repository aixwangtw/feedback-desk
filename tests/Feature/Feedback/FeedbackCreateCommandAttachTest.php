<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackCreateCommandAttachTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    /** @var list<string> */
    private array $temporaryFiles = [];

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->withoutVite();
        $this->project = FeedbackProject::factory()->create();
    }

    protected function tearDown(): void
    {
        foreach ($this->temporaryFiles as $path) {
            @unlink($path);
        }

        parent::tearDown();
    }

    public function test_attaches_a_single_image_to_the_new_report(): void
    {
        $image = $this->temporaryFile('png', base64_decode(self::PNG));

        $this->artisan('feedback:create', $this->arguments(['--attach' => [$image]]))
            ->expectsOutputToContain('附圖')
            ->assertSuccessful();

        $attachment = FeedbackReport::sole()->feedbackAttachments()->sole();
        $this->assertNull($attachment->feedback_message_id);
        $this->assertSame('image/png', $attachment->mime_type);
        $this->assertSame(basename($image), $attachment->original_name);
        Storage::disk('local')->assertExists($attachment->path);
        $this->assertFileExists($image);
    }

    public function test_attaches_several_images_in_order(): void
    {
        $first = $this->temporaryFile('png', base64_decode(self::PNG));
        $second = $this->temporaryFile('png', base64_decode(self::PNG));

        $this->artisan('feedback:create', $this->arguments(['--attach' => [$first, $second]]))->assertSuccessful();

        $names = FeedbackReport::sole()->feedbackAttachments()->orderBy('id')->pluck('original_name')->all();
        $this->assertSame([basename($first), basename($second)], $names);
    }

    public function test_rejects_files_that_are_not_jpg_png_or_webp_images(): void
    {
        $pdf = $this->temporaryFile('pdf', "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
        $fakePng = $this->temporaryFile('png', 'not really an image');

        $this->artisan('feedback:create', $this->arguments(['--attach' => [$pdf]]))->assertFailed();
        $this->artisan('feedback:create', $this->arguments(['--attach' => [$fakePng]]))->assertFailed();

        $this->assertSame(0, FeedbackReport::count());
        $this->assertSame(0, FeedbackAttachment::count());
    }

    public function test_rejects_a_missing_file_without_creating_the_report(): void
    {
        $image = $this->temporaryFile('png', base64_decode(self::PNG));

        $this->artisan('feedback:create', $this->arguments(['--attach' => [$image, '/nonexistent/fdk-missing.png']]))
            ->expectsOutputToContain('/nonexistent/fdk-missing.png')
            ->assertFailed();

        $this->assertSame(0, FeedbackReport::count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_rejects_more_than_five_images(): void
    {
        $images = array_map(fn () => $this->temporaryFile('png', base64_decode(self::PNG)), range(1, 6));

        $this->artisan('feedback:create', $this->arguments(['--attach' => $images]))->assertFailed();

        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_attached_image_is_served_by_the_attachment_route_to_the_team(): void
    {
        $image = $this->temporaryFile('png', base64_decode(self::PNG));
        $this->artisan('feedback:create', $this->arguments(['--attach' => [$image]]))->assertSuccessful();
        $report = FeedbackReport::sole();
        $attachment = $report->feedbackAttachments()->sole();

        $this->actingAsTeam();

        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee(route('feedback.attachments.show', [$this->project, $report, $attachment]), false);

        $response = $this->get(route('feedback.attachments.show', [$this->project, $report, $attachment]));
        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $this->assertSame(base64_decode(self::PNG), $response->streamedContent());
    }

    public function test_message_command_accepts_attach_as_well_as_file(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $first = $this->temporaryFile('png', base64_decode(self::PNG));
        $second = $this->temporaryFile('png', base64_decode(self::PNG));

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $report->public_id, '--text' => '對照圖', '--attach' => [$first], '--file' => [$second]])
            ->assertSuccessful();

        $this->assertSame(2, FeedbackMessage::sole()->feedbackAttachments()->count());
    }

    public function test_message_command_rejects_pdf_attachments(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $pdf = $this->temporaryFile('pdf', "%PDF-1.4\n%%EOF");

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $report->public_id, '--text' => 'x', '--attach' => [$pdf]])
            ->assertFailed();

        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_team_report_without_for_client_stays_hidden_from_the_client(): void
    {
        $this->artisan('feedback:create', $this->arguments([]))->assertSuccessful();
        $report = FeedbackReport::sole();

        $this->actingAsClient();

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertDontSee('對照確認');
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertNotFound();
    }

    public function test_for_client_report_shows_in_the_client_list_with_unread_notice_and_images(): void
    {
        $image = $this->temporaryFile('png', base64_decode(self::PNG));
        $this->artisan('feedback:create', $this->arguments(['--attach' => [$image], '--for-client' => true]))
            ->expectsOutputToContain('客戶看得到')
            ->assertSuccessful();
        $report = FeedbackReport::sole();
        $attachment = $report->feedbackAttachments()->whereNull('feedback_message_id')->sole();

        $this->assertTrue($report->shared_with_client);
        $this->assertSame(1, $report->feedbackMessages()->count());

        $this->actingAsClient();

        $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))
            ->assertOk()
            ->assertSee('對照確認')
            ->assertSee('data-unread-dot', false);
        $this->get(route('feedback.portal', [$this->project, 'tab' => 'all', 'view' => 'board']))->assertOk()->assertSee('對照確認');

        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee(route('feedback.attachments.show', [$this->project, $report, $attachment]), false);
        $this->get(route('feedback.attachments.show', [$this->project, $report, $attachment]))->assertOk();
    }

    public function test_notice_requires_for_client(): void
    {
        $this->artisan('feedback:create', $this->arguments(['--notice' => '請看']))->assertFailed();

        $this->assertSame(0, FeedbackReport::count());
    }

    public function test_team_message_with_attachment_on_a_client_report_shows_as_unread_for_the_client(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['title' => '老師的單', 'client_last_read_at' => now()->subHour()]);
        $image = $this->temporaryFile('png', base64_decode(self::PNG));

        $this->artisan('feedback:message', ['project' => $this->project->slug, 'report' => $report->public_id, '--text' => '請確認對照', '--attach' => [$image]])
            ->assertSuccessful();

        $this->actingAsClient();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-unread-dot', false);
    }

    /**
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function arguments(array $extra): array
    {
        return ['project' => $this->project->slug, '--title' => '對照確認', '--description' => '請看附圖', ...$extra];
    }

    private function temporaryFile(string $extension, string $contents): string
    {
        $path = sys_get_temp_dir().'/fdk-attach-'.uniqid().'.'.$extension;
        file_put_contents($path, $contents);
        $this->temporaryFiles[] = $path;

        return $path;
    }

    private function actingAsClient(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsTeam(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }
}
