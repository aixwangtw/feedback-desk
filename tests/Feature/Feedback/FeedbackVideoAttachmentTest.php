<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAttachmentRules;
use App\Support\StandardInput;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * 留言與待審留言可以附 mp4 影片（教操作用錄影）：指令 --attach、網頁留言、對話面板都收；
 * 留言裡直接播放（video controls playsinline preload=metadata），客戶端也能看、能拖拉播放進度。
 */
class FeedbackVideoAttachmentTest extends TestCase
{
    use LazilyRefreshDatabase;

    /** 最小的 mp4 檔頭（ftyp box），finfo 會判斷成 video/mp4。 */
    private const MP4 = "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom\x00\x00\x00\x08free";

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create(['owner_last_read_at' => now(), 'client_last_read_at' => now()]);
        $this->mock(StandardInput::class, fn (MockInterface $mock) => $mock->shouldReceive('read')->andReturn(null));
    }

    public function test_message_command_attaches_an_mp4_and_both_sides_see_a_player(): void
    {
        $this->artisan('feedback:message', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '操作錄影', '--attach' => [$this->mp4File()]])
            ->assertSuccessful();

        $attachment = FeedbackAttachment::sole();
        $this->assertSame('video/mp4', $attachment->mime_type);
        $this->assertSame(FeedbackMessage::sole()->id, $attachment->feedback_message_id);

        $url = route('feedback.attachments.show', [$this->project, $this->report, $attachment]);
        $this->actingAsClient();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertSee('<video controls playsinline preload="metadata"', false)
            ->assertSee(e($url), false);
        $this->get(route('feedback.reports.activity', [$this->project, $this->report]))->assertOk()->assertSee('<video', false);

        $response = $this->get($url)->assertOk();
        $this->assertSame('video/mp4', $response->headers->get('Content-Type'));
        $this->assertSame('bytes', $response->headers->get('Accept-Ranges'));
    }

    public function test_draft_command_accepts_mp4_and_sending_carries_it_into_the_message(): void
    {
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '草稿附錄影', '--attach' => [$this->mp4File()]])
            ->assertSuccessful();
        $draft = FeedbackMessageDraft::sole();
        $this->assertSame('video/mp4', $draft->attachmentList()[0]['mime_type']);

        $this->actingAsTeam();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertSee('<video controls playsinline preload="metadata"', false);
        $this->get(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]))->assertOk();
        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]))->assertOk();

        $attachment = FeedbackAttachment::sole();
        $this->assertSame('video/mp4', $attachment->mime_type);
        $this->assertSame(FeedbackMessage::sole()->id, $attachment->feedback_message_id);
    }

    public function test_command_rejects_videos_over_the_limit_and_other_video_formats(): void
    {
        $big = $this->mp4File();
        $handle = fopen($big, 'ab');
        ftruncate($handle, FeedbackAttachmentRules::MAX_VIDEO_BYTES + 1);
        fclose($handle);
        $this->artisan('feedback:message', ['project' => 'site', 'report' => $this->report->public_id, '--text' => 'x', '--attach' => [$big]])
            ->expectsOutputToContain('50 MB')
            ->assertFailed();

        $webm = tempnam(sys_get_temp_dir(), 'fd').'.webm';
        file_put_contents($webm, "\x1A\x45\xDF\xA3\x9F\x42\x86\x81\x01\x42\xF7\x81\x01\x42\xF2\x81\x04\x42\xF3\x81\x08\x42\x82\x84webm");
        $this->artisan('feedback:message', ['project' => 'site', 'report' => $this->report->public_id, '--text' => 'x', '--attach' => [$webm]])->assertFailed();
        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_report_creation_still_only_takes_images(): void
    {
        $this->artisan('feedback:create', ['project' => 'site', '--title' => '新單', '--description' => '說明', '--attach' => [$this->mp4File()]])->assertFailed();
    }

    public function test_web_message_and_panel_reply_accept_mp4_for_both_sides(): void
    {
        $this->actingAsClient();
        $this->post(route('feedback.messages.store', [$this->project, $this->report]), [
            'body' => '老師的錄影',
            'screenshots' => [UploadedFile::fake()->createWithContent('screen.mp4', self::MP4)],
        ])->assertRedirect()->assertSessionHasNoErrors();

        $this->actingAsTeam();
        $this->postJson(route('feedback.messages.store', [$this->project, $this->report]), [
            'body' => '團隊的錄影',
            'screenshots' => [UploadedFile::fake()->createWithContent('reply.mp4', self::MP4)],
        ])->assertCreated();

        $this->assertSame(2, FeedbackAttachment::where('mime_type', 'video/mp4')->count());

        $this->postJson(route('feedback.messages.store', [$this->project, $this->report]), [
            'body' => '太大',
            'screenshots' => [UploadedFile::fake()->createWithContent('big.mp4', self::MP4)->size(FeedbackAttachmentRules::MAX_VIDEO_KILOBYTES + 1)],
        ])->assertUnprocessable();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertSee('accept="'.FeedbackAttachmentRules::MESSAGE_ACCEPT.'"', false);
        $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))
            ->assertSee('accept="'.FeedbackAttachmentRules::MESSAGE_ACCEPT.'"', false);
    }

    public function test_upload_controls_that_take_videos_say_attachment_and_show_both_limits(): void
    {
        $hint = '圖片或影片，最多 5 個；圖片每個 10 MB、影片每個 50 MB';
        $this->assertSame($hint, FeedbackAttachmentRules::messageHint());

        $this->actingAsClient();
        $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->getContent();
        $this->assertStringContainsString($hint, $page);
        $this->assertMatchesRegularExpression('/>\s*附件\s*<input id="message-screenshots"/u', $page);
        $this->assertStringNotContainsString('加入截圖', $page);

        $this->actingAsTeam();
        $portal = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $this->assertMatchesRegularExpression('/>\s*附件\s*<input id="chat-screenshots"/u', $portal);
        $this->assertStringContainsString('data-max-video-bytes="'.FeedbackAttachmentRules::MAX_VIDEO_BYTES.'"', $portal);

        $response = $this->postJson(route('feedback.messages.store', [$this->project, $this->report]), [
            'body' => '格式不對',
            'screenshots' => [UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf')],
        ])->assertUnprocessable();
        $this->assertStringContainsString('圖片／影片', json_encode($response->json('errors'), JSON_UNESCAPED_UNICODE));
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
