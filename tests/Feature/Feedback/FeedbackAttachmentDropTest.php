<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAttachmentRules;
use App\Support\PublicReporting;
use App\Support\StandardInput;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * 留言輸入區可以拖放圖片、影片：瀏覽器端的規則全由 FeedbackAttachmentRules 的常數帶出，
 * 伺服器端的驗證維持原樣（拖進來與按鈕選的檔案送到同一個端點）。
 */
class FeedbackAttachmentDropTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

    public function test_browser_rules_come_from_the_shared_constants(): void
    {
        $rules = FeedbackAttachmentRules::browserRules();

        $this->assertTrue($rules['allowVideo']);
        $this->assertSame(FeedbackAttachmentRules::MAX_FILES, $rules['maxFiles']);
        $this->assertSame(FeedbackAttachmentRules::MAX_IMAGE_BYTES, $rules['maxImageBytes']);
        $this->assertSame(FeedbackAttachmentRules::MAX_VIDEO_BYTES, $rules['maxVideoBytes']);
        $this->assertSame(FeedbackAttachmentRules::IMAGE_MIME_TYPES, $rules['imageTypes']);
        $this->assertSame(FeedbackAttachmentRules::BROWSER_VIDEO_MIME_TYPES, $rules['videoTypes']);
        $this->assertSame('只能附 jpg、png、webp 圖片或 mp4、mov、webm 影片', $rules['typeMessage']);

        $public = FeedbackAttachmentRules::publicBrowserRules();
        $this->assertFalse($public['allowVideo']);
        $this->assertSame(PublicReporting::MAX_SCREENSHOTS, $public['maxFiles']);
        $this->assertSame(PublicReporting::MAX_SCREENSHOT_KILOBYTES * 1024, $public['maxImageBytes']);
    }

    public function test_panel_single_page_and_dialog_inputs_carry_the_rules_and_a_preview_area(): void
    {
        $rules = e(FeedbackAttachmentRules::browserRulesJson());

        $this->actingAsClient();
        $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->getContent();
        $this->assertStringContainsString('data-attachment-rules="'.$rules.'"', $page);
        $this->assertStringContainsString('id="message-preview"', $page);

        foreach (['client' => fn () => $this->actingAsClient(), 'team' => fn () => $this->actingAsTeam()] as $side) {
            $side();
            $portal = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
            $this->assertStringContainsString('id="chat-screenshots" name="screenshots[]" type="file" accept="'.FeedbackAttachmentRules::MESSAGE_ACCEPT.'" multiple class="sr-only" data-image-input data-attachment-rules="'.$rules.'"', $portal);
            $this->assertStringContainsString('id="chat-preview"', $portal);
            $this->assertStringContainsString('data-attachment-error', $portal);
        }
    }

    public function test_the_server_still_takes_dropped_files_through_the_same_endpoint_and_rules(): void
    {
        $this->actingAsClient();
        $url = route('feedback.messages.store', [$this->project, $this->report]);

        $this->postJson($url, [
            'body' => '拖進來的',
            'screenshots' => [$this->png('a.png'), UploadedFile::fake()->createWithContent('b.mp4', self::MP4)],
        ])->assertCreated();
        $this->assertEqualsCanonicalizing(['image/png', 'video/mp4'], FeedbackAttachment::pluck('mime_type')->all());

        $this->postJson($url, ['body' => 'gif', 'screenshots' => [UploadedFile::fake()->createWithContent('a.gif', 'GIF89a'.str_repeat("\0", 20))]])->assertUnprocessable();
        $this->postJson($url, ['body' => 'pdf', 'screenshots' => [UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')]])->assertUnprocessable();
        $this->postJson($url, [
            'body' => '太多',
            'screenshots' => array_map(fn (int $i) => $this->png("p{$i}.png"), range(1, FeedbackAttachmentRules::MAX_FILES + 1)),
        ])->assertUnprocessable();
        $this->postJson($url, [
            'body' => '圖太大',
            'screenshots' => [$this->png('big.png')->size(FeedbackAttachmentRules::MAX_IMAGE_MEGABYTES * 1024 + 1)],
        ])->assertUnprocessable();
        $this->postJson($url, [
            'body' => '影片太大',
            'screenshots' => [UploadedFile::fake()->createWithContent('big.mp4', self::MP4)->size(FeedbackAttachmentRules::MAX_VIDEO_KILOBYTES + 1)],
        ])->assertUnprocessable();

        $this->assertSame(2, FeedbackAttachment::count());
    }

    public function test_messages_and_drafts_show_a_short_title_under_every_attachment(): void
    {
        $this->assertSame('圖一-缺圖十七十九的位置', FeedbackAttachmentRules::displayTitle('圖一-缺圖十七十九的位置.png'));
        $this->assertSame('影片-操作', FeedbackAttachmentRules::displayTitle('影片-操作.mp4'));
        $this->assertSame('無副檔名', FeedbackAttachmentRules::displayTitle('無副檔名'));

        $message = $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '看圖']);
        foreach (['圖一-紅框位置.png' => 'image/png', '影片-操作.mp4' => 'video/mp4'] as $name => $mime) {
            FeedbackAttachment::create([
                'feedback_report_id' => $this->report->id,
                'feedback_message_id' => $message->id,
                'disk' => 'local',
                'path' => 'feedback/'.md5($name),
                'original_name' => $name,
                'mime_type' => $mime,
                'size' => 10,
            ]);
        }

        foreach (['client' => fn () => $this->actingAsClient(), 'team' => fn () => $this->actingAsTeam()] as $side) {
            $side();
            $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->getContent();
            $this->assertStringContainsString('title="圖一-紅框位置.png" data-attachment-title>圖一-紅框位置</span>', $page);
            $this->assertStringContainsString('title="影片-操作.mp4" data-attachment-title>影片-操作</span>', $page);
        }
    }

    public function test_command_attachments_keep_the_file_name_as_the_display_name(): void
    {
        $dir = sys_get_temp_dir().'/fdname'.Str::random(6);
        mkdir($dir);
        file_put_contents($dir.'/圖一-紅框位置.png', base64_decode(self::PNG));
        file_put_contents($dir.'/影片-操作.mp4', self::MP4);

        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '草稿', '--attach' => [$dir.'/圖一-紅框位置.png', $dir.'/影片-操作.mp4']])->assertSuccessful();
        $this->artisan('feedback:message', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '留言', '--attach' => [$dir.'/圖一-紅框位置.png']])->assertSuccessful();

        $this->assertSame(['圖一-紅框位置.png', '影片-操作.mp4'], array_column(FeedbackMessageDraft::sole()->attachmentList(), 'original_name'));
        $this->assertSame('圖一-紅框位置.png', FeedbackAttachment::sole()->original_name);
    }

    private function png(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG));
    }

    private function actingAsClient(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsTeam(): void
    {
        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
