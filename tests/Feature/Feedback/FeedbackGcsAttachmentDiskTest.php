<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackFileStreamer;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use League\Flysystem\Filesystem;
use Tests\Support\RemoteLikeAdapter;
use Tests\TestCase;

/**
 * FEEDBACK_DISK 設成 gcs 時，新附件（留言、待審留言）寫進 gcs 磁碟，畫面仍經 Laravel 路由串流並檢查權限；
 * 影片的 Range 請求照常回 206。gcs 磁碟在測試裡用「不是本機轉接器」的假磁碟代替，走的是遠端磁碟的串流路徑。
 */
class FeedbackGcsAttachmentDiskTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const MP4 = "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom\x00\x00\x00\x08free0123456789abcdefghij";

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        $root = storage_path('framework/testing/disks/gcs-remote-like');
        $this->app['files']->deleteDirectory($root);
        config(['filesystems.disks.gcs' => ['driver' => 'remote-like', 'root' => $root], 'feedback.disk' => 'gcs']);
        Storage::extend('remote-like', function ($app, array $config) {
            $adapter = new RemoteLikeAdapter($config['root']);

            return new FilesystemAdapter(new Filesystem($adapter, $config), $adapter, $config);
        });
        Storage::forgetDisk('gcs');
        Storage::fake('local');

        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create(['owner_last_read_at' => now(), 'client_last_read_at' => now()]);
    }

    protected function tearDown(): void
    {
        $this->app['files']->deleteDirectory(storage_path('framework/testing/disks/gcs-remote-like'));
        parent::tearDown();
    }

    public function test_default_disk_is_still_local(): void
    {
        $this->assertSame('local', (include base_path('config/feedback.php'))['disk']);
    }

    public function test_new_message_attachments_are_written_to_the_gcs_disk(): void
    {
        $this->actingAsClient();
        $this->post(route('feedback.messages.store', [$this->project, $this->report]), [
            'body' => '附圖與錄影',
            'screenshots' => [UploadedFile::fake()->createWithContent('a.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')), UploadedFile::fake()->createWithContent('v.mp4', self::MP4)],
        ])->assertRedirect()->assertSessionHasNoErrors();

        $this->assertSame(2, FeedbackMessage::sole()->feedbackAttachments()->count());
        foreach (FeedbackAttachment::all() as $attachment) {
            $this->assertSame('gcs', $attachment->disk);
            Storage::disk('gcs')->assertExists($attachment->path);
            Storage::disk('local')->assertMissing($attachment->path);
        }
    }

    public function test_image_is_streamed_through_the_route_with_permission_check(): void
    {
        $attachment = $this->videoAttachment('image');
        $url = route('feedback.attachments.show', [$this->project, $this->report, $attachment]);

        $this->flushSession();
        $this->get($url)->assertRedirect();

        $this->actingAsClient();
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
    }

    public function test_video_range_requests_return_206_from_a_remote_disk(): void
    {
        $attachment = $this->videoAttachment('video');
        $url = route('feedback.attachments.show', [$this->project, $this->report, $attachment]);
        $size = strlen(self::MP4);

        $this->actingAsTeam();
        $full = $this->get($url)->assertOk();
        $this->assertSame('bytes', $full->headers->get('Accept-Ranges'));
        $this->assertSame(self::MP4, $full->streamedContent());

        $part = $this->get($url, ['Range' => 'bytes=4-11'])->assertStatus(206);
        $this->assertSame("bytes 4-11/{$size}", $part->headers->get('Content-Range'));
        $this->assertSame('8', $part->headers->get('Content-Length'));
        $this->assertSame(substr(self::MP4, 4, 8), $part->streamedContent());

        $open = $this->get($url, ['Range' => 'bytes=0-'])->assertStatus(206);
        $this->assertSame('bytes 0-'.($size - 1)."/{$size}", $open->headers->get('Content-Range'));
        $this->assertSame(self::MP4, $open->streamedContent());

        $suffix = $this->get($url, ['Range' => 'bytes=-5'])->assertStatus(206);
        $this->assertSame(substr(self::MP4, -5), $suffix->streamedContent());

        $clamped = $this->get($url, ['Range' => 'bytes='.($size - 3).'-9999'])->assertStatus(206);
        $this->assertSame(substr(self::MP4, -3), $clamped->streamedContent());

        $this->get($url, ['Range' => 'bytes=9999-'])->assertStatus(416)->assertHeader('Content-Range', "bytes */{$size}");
    }

    public function test_signed_download_url_also_supports_range(): void
    {
        $attachment = $this->videoAttachment('video');
        $url = URL::temporarySignedRoute('feedback.attachments.download', now()->addHour(), [$this->project, $this->report, $attachment], absolute: false);

        $this->flushSession();
        $this->get($url, ['Range' => 'bytes=2-5'])->assertStatus(206);
    }

    public function test_draft_attachment_is_written_to_gcs_and_streamed_with_range(): void
    {
        $this->actingAsTeam();
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '草稿', '--attach' => [$this->mp4File()]])->assertSuccessful();

        $draft = FeedbackMessageDraft::sole();
        $file = $draft->attachmentList()[0];
        $this->assertSame('gcs', $file['disk']);
        Storage::disk('gcs')->assertExists($file['path']);

        $url = route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]);
        $this->get($url)->assertOk();
        $this->get($url, ['Range' => 'bytes=0-3'])->assertStatus(206);
    }

    public function test_attachments_already_marked_local_still_read_from_local_after_switching(): void
    {
        $path = "feedback/{$this->project->id}/{$this->report->public_id}/old.png";
        Storage::disk('local')->put($path, 'old-bytes');
        $attachment = FeedbackAttachment::factory()->for($this->report, 'feedbackReport')->create(['disk' => 'local', 'path' => $path, 'mime_type' => 'image/png', 'original_name' => 'old.png', 'size' => 9]);

        $this->actingAsClient();
        $this->get(route('feedback.attachments.show', [$this->project, $this->report, $attachment]))->assertOk();
    }

    public function test_streamer_rejects_multi_range_by_falling_back_to_full_response(): void
    {
        $path = 'feedback/x/y/v.mp4';
        Storage::disk('gcs')->put($path, self::MP4);
        $request = Request::create('/x', 'GET', server: ['HTTP_RANGE' => 'bytes=0-1,4-5']);

        $response = app(FeedbackFileStreamer::class)->respond($request, 'gcs', $path, 'video/mp4', 'v.mp4', true);
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_migrate_command_dry_run_then_copy_verify_and_switch_disk(): void
    {
        $imagePath = "feedback/{$this->project->id}/{$this->report->public_id}/a.png";
        $videoPath = "feedback/{$this->project->id}/{$this->report->public_id}/drafts/v.mp4";
        Storage::disk('local')->put($imagePath, 'png-bytes');
        Storage::disk('local')->put($videoPath, self::MP4);
        $attachment = FeedbackAttachment::factory()->for($this->report, 'feedbackReport')->create(['disk' => 'local', 'path' => $imagePath, 'size' => 9]);
        $draft = FeedbackMessageDraft::create([
            'feedback_report_id' => $this->report->id, 'author_name' => 'x', 'body' => 'b',
            'attachments' => [['disk' => 'local', 'path' => $videoPath, 'original_name' => 'v.mp4', 'mime_type' => 'video/mp4', 'size' => strlen(self::MP4)]],
        ]);

        $this->artisan('feedback:migrate-attachments-to-gcs', ['--dry-run' => true])->expectsOutputToContain('要搬的檔案 2 個')->assertSuccessful();
        Storage::disk('gcs')->assertMissing($imagePath);
        $this->assertSame('local', $attachment->fresh()->disk);

        $this->artisan('feedback:migrate-attachments-to-gcs')->expectsOutputToContain('通過 2')->assertSuccessful();
        Storage::disk('gcs')->assertExists($imagePath);
        Storage::disk('gcs')->assertExists($videoPath);
        Storage::disk('local')->assertExists($imagePath);
        $this->assertSame('gcs', $attachment->fresh()->disk);
        $this->assertSame('gcs', $draft->fresh()->attachmentList()[0]['disk']);

        $this->artisan('feedback:migrate-attachments-to-gcs')->expectsOutputToContain('要搬的檔案 0 個')->assertSuccessful();
    }

    public function test_migrate_command_changes_nothing_when_a_source_file_is_missing(): void
    {
        $present = "feedback/{$this->project->id}/{$this->report->public_id}/ok.png";
        Storage::disk('local')->put($present, 'ok');
        $a = FeedbackAttachment::factory()->for($this->report, 'feedbackReport')->create(['disk' => 'local', 'path' => $present, 'size' => 2]);
        $b = FeedbackAttachment::factory()->for($this->report, 'feedbackReport')->create(['disk' => 'local', 'path' => 'feedback/missing.png', 'size' => 2]);

        $this->artisan('feedback:migrate-attachments-to-gcs')->expectsOutputToContain('來源檔不存在')->assertFailed();
        $this->assertSame('local', $a->fresh()->disk);
        $this->assertSame('local', $b->fresh()->disk);
    }

    private function videoAttachment(string $kind): FeedbackAttachment
    {
        $path = "feedback/{$this->project->id}/{$this->report->public_id}/".Str::random(8).($kind === 'video' ? '.mp4' : '.png');
        Storage::disk('gcs')->put($path, $kind === 'video' ? self::MP4 : 'png-bytes');

        return FeedbackAttachment::factory()->for($this->report, 'feedbackReport')->create([
            'disk' => 'gcs', 'path' => $path, 'original_name' => basename($path),
            'mime_type' => $kind === 'video' ? 'video/mp4' : 'image/png',
            'size' => $kind === 'video' ? strlen(self::MP4) : 9,
        ]);
    }

    private function mp4File(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'fd').'.mp4';
        file_put_contents($path, self::MP4);

        return $path;
    }

    private function actingAsTeam(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsClient(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
