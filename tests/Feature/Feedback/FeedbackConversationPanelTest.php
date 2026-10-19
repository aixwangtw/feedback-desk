<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackConversationPanelTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
    }

    public function test_owner_list_puts_unread_first_then_latest_message_with_preview(): void
    {
        $quietOld = $this->report('很久沒動的單', now()->subDays(5));
        $this->message($quietOld, FeedbackAuthorType::Owner, now()->subDays(4), '舊的回覆');
        $recent = $this->report('最近有回覆的單', now()->subDays(4));
        $this->message($recent, FeedbackAuthorType::Owner, now()->subMinutes(30), "已修正\n請再看看");
        $unread = $this->report('老師有新留言的單', now()->subDays(3));
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subHours(3), '第一則');
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subHours(2), str_repeat('很長的留言', 30));
        $empty = $this->report('沒有留言的單', now()->subDay());
        $deleted = $this->report('老師刪掉的單', now()->subDays(2), ['client_deleted_at' => now()]);
        $developerReport = FeedbackReport::factory()->for($this->project)->byOwnerShared()->create([
            'title' => '開發者自己的單', 'created_at' => now()->subDays(6), 'owner_last_read_at' => now(),
        ]);

        $this->actingAsOwner();
        $response = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();

        $this->assertSame(
            ['老師有新留言的單', '最近有回覆的單', '沒有留言的單', '老師刪掉的單', '很久沒動的單', '開發者自己的單'],
            array_column($response->json('items'), 'title'),
        );
        $first = $response->json('items.0');
        $this->assertSame($unread->public_id, $first['id']);
        $this->assertSame(2, $first['unread']);
        $this->assertSame(2, $first['messages_count']);
        $this->assertTrue($first['has_update']);
        $this->assertFalse($first['preview_is_mine']);
        $this->assertSame(Str::limit(str_repeat('很長的留言', 30), 60), $first['preview']);
        $this->assertSame(route('feedback.conversations.show', [$this->project, $unread]), $first['thread_url']);
        $this->assertSame(route('feedback.reports.show', [$this->project, $unread]), $first['page_url']);
        $this->assertSame(3, $first['number']);

        $second = $response->json('items.1');
        $this->assertSame('已修正 請再看看', $second['preview']);
        $this->assertTrue($second['preview_is_mine']);
        $this->assertSame(0, $second['unread']);

        $this->assertNull($response->json('items.2.preview'));
        $this->assertTrue($response->json('items.3.deleted'));
        $this->assertSame(2, $response->json('unread_total'));
        $this->assertNotNull($empty);
        $this->assertNotNull($deleted);
        $this->assertNotNull($developerReport);
    }

    public function test_client_list_hides_developer_and_deleted_reports_and_counts_team_replies(): void
    {
        $answered = $this->report('開發者回了', now()->subDays(3));
        $this->message($answered, FeedbackAuthorType::Reporter, now()->subHours(5), '老師的問題');
        $this->message($answered, FeedbackAuthorType::Owner, now()->subHours(2), '開發者回覆');
        $this->message($answered, FeedbackAuthorType::Agent, now()->subHour(), 'AI 回覆');
        $adjusted = $this->report('調整說明有更新', now()->subDays(2), ['adjustment_note' => '改好了', 'adjustment_updated_at' => now()->subMinutes(5)]);
        $this->report('老師刪掉的單', now()->subDays(1), ['client_deleted_at' => now()]);
        FeedbackReport::factory()->for($this->project)->byOwnerShared()->create(['title' => '開發者自己的單']);

        $this->actingAsClient();
        $response = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();

        $titles = array_column($response->json('items'), 'title');
        $this->assertSame(['開發者回了', '調整說明有更新'], $titles);
        $this->assertSame(2, $response->json('items.0.unread'));
        $this->assertSame('AI 回覆', $response->json('items.0.preview'));
        $this->assertFalse($response->json('items.0.preview_is_mine'));
        $this->assertTrue($response->json('items.1.adjustment_updated'));
        // 調整說明更新算 1 則未讀，與清單上留言按鈕的紅色數字一致。
        $this->assertSame(1, $response->json('items.1.unread'));
        $this->assertSame(3, $response->json('unread_total'));
        // 客戶端編號只算老師建立的單（含已刪除），與清單頁一致。
        $this->assertSame([3, 2], array_column($response->json('items'), 'number'));
        $this->assertNotNull($adjusted);
    }

    public function test_list_uses_a_fixed_number_of_queries_regardless_of_report_count(): void
    {
        $this->actingAsOwner();
        $countQueries = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
            $queries = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], 'feedback_reports'));
            DB::disableQueryLog();

            return $queries->count();
        };

        foreach (range(1, 2) as $index) {
            $this->message($this->report("單 {$index}", now()->subDays($index)), FeedbackAuthorType::Reporter, now()->subHour(), '留言');
        }
        $few = $countQueries();

        foreach (range(3, 12) as $index) {
            $report = $this->report("單 {$index}", now()->subDays($index));
            $this->message($report, FeedbackAuthorType::Reporter, now()->subHour(), '留言');
            $this->message($report, FeedbackAuthorType::Owner, now()->subMinutes(5), '回覆');
        }

        $this->assertSame(1, $few);
        $this->assertSame($few, $countQueries());
    }

    public function test_opening_a_conversation_marks_it_read_for_that_side_only(): void
    {
        $report = $this->report('要標已讀的單', now()->subDays(2));
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(10), '新留言');
        $clientReadAt = $report->client_last_read_at->toDateTimeString();
        $activityAt = $report->latest_activity_at->toDateTimeString();

        $this->actingAsOwner();
        $this->travel(1)->minutes();
        $this->getJson(route('feedback.conversations.show', [$this->project, $report]))
            ->assertOk()
            ->assertJsonPath('id', $report->public_id)
            ->assertJsonPath('title', '要標已讀的單')
            ->assertJsonPath('post_url', route('feedback.messages.store', [$this->project, $report]))
            ->assertJsonPath('page_url', route('feedback.reports.show', [$this->project, $report]));

        $report->refresh();
        $this->assertTrue($report->owner_last_read_at->greaterThan(now()->subSeconds(5)));
        $this->assertSame($clientReadAt, $report->client_last_read_at->toDateTimeString());
        $this->assertSame($activityAt, $report->latest_activity_at->toDateTimeString());
        $this->assertSame(0, $this->getJson(route('feedback.conversations.index', $this->project))->json('unread_total'));

        $this->message($report, FeedbackAuthorType::Owner, now(), '開發者回覆');
        $this->actingAsClient();
        $this->assertSame(1, $this->getJson(route('feedback.conversations.index', $this->project))->json('unread_total'));
        $this->travel(1)->minutes();
        $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->assertOk();
        $this->assertSame(0, $this->getJson(route('feedback.conversations.index', $this->project))->json('unread_total'));
    }

    public function test_listing_does_not_mark_anything_read(): void
    {
        $report = $this->report('只看清單', now()->subDay());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(10), '新留言');
        $this->actingAsOwner();

        $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->getJson(route('feedback.conversations.index', $this->project))->assertJsonPath('items.0.unread', 1);
    }

    public function test_conversation_html_places_each_side_and_shows_adjustment_for_client(): void
    {
        $report = $this->report('對話的單', now()->subDay(), ['adjustment_note' => '已調整按鈕位置', 'adjustment_updated_at' => now()->subMinute()]);
        $clientMessage = $this->message($report, FeedbackAuthorType::Reporter, now()->subHours(2), '老師說的話', '老師');
        $this->message($report, FeedbackAuthorType::Owner, now()->subHour(), '開發者說的話', '開發者');
        FeedbackAttachment::factory()->create([
            'feedback_report_id' => $report->id,
            'feedback_message_id' => $clientMessage->id,
            'original_name' => 'shot.png',
        ]);

        $this->actingAsOwner();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->assertOk()->json('html');
        $this->assertMatchesRegularExpression('/data-author="reporter" data-side="theirs"/', $html);
        $this->assertMatchesRegularExpression('/data-author="owner" data-side="mine"/', $html);
        $this->assertStringContainsString('data-lightbox-trigger', $html);
        $attachment = $clientMessage->feedbackAttachments()->sole();
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $report, $attachment]), $html);
        $this->assertStringContainsString('已調整按鈕位置', $html);
        $this->assertStringNotContainsString('有更新', $html);

        $this->actingAsClient();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->assertOk()->json('html');
        $this->assertMatchesRegularExpression('/data-author="reporter" data-side="mine"/', $html);
        $this->assertMatchesRegularExpression('/data-author="owner" data-side="theirs"/', $html);
        $this->assertStringContainsString('有更新', $html);
        $this->assertMatchesRegularExpression('/<details[^>]*open[^>]*data-chat-adjustment/', $html);
    }

    public function test_reply_from_the_panel_returns_json_and_stores_images(): void
    {
        $report = $this->report('要回覆的單', now()->subDay());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(10), '請幫忙看');
        $this->actingAsOwner();
        $this->travel(1)->minutes();

        $this->postJson(route('feedback.messages.store', [$this->project, $report]), [
            'body' => '已處理，附圖給你看',
            'screenshots' => [$this->image('fixed.png')],
        ])->assertCreated()->assertJsonPath('message', '訊息已送出。');

        $message = $report->feedbackMessages()->latest('id')->first();
        $this->assertSame(FeedbackAuthorType::Owner, $message->author_type);
        $this->assertSame('開發者', $message->author_name);
        $attachment = $message->feedbackAttachments()->sole();
        $this->assertSame('fixed.png', $attachment->original_name);
        Storage::disk('local')->assertExists($attachment->path);
        $this->assertSame(0, $this->project->feedbackReports()->unreadByOwner()->count());

        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->json('html');
        $this->assertStringContainsString('已處理，附圖給你看', $html);
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $report, $attachment]), $html);

        $this->actingAsClient();
        $this->postJson(route('feedback.messages.store', [$this->project, $report]), ['body' => '收到，謝謝'])->assertCreated();
        $this->assertSame('老師', $report->feedbackMessages()->latest('id')->first()->author_name);
        $this->assertSame(FeedbackAuthorType::Reporter, $report->feedbackMessages()->latest('id')->first()->author_type);
    }

    public function test_reply_validation_errors_come_back_as_json(): void
    {
        $report = $this->report('驗證的單', now()->subDay());
        $this->actingAsClient();
        $url = route('feedback.messages.store', [$this->project, $report]);

        $this->postJson($url, ['body' => ''])->assertUnprocessable()->assertJsonValidationErrors('body');
        $this->postJson($url, [
            'body' => '附檔不是圖',
            'screenshots' => [UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf')],
        ])->assertUnprocessable()->assertJsonValidationErrors('screenshots.0');
        $this->postJson($url, [
            'body' => '圖太大',
            'screenshots' => [$this->image('big.png', 11 * 1024)],
        ])->assertUnprocessable()->assertJsonValidationErrors('screenshots.0');
        $this->postJson($url, [
            'body' => '太多張',
            'screenshots' => array_map(fn (int $index) => $this->image("shot-{$index}.png"), range(1, 6)),
        ])->assertUnprocessable()->assertJsonValidationErrors('screenshots');

        $this->assertSame(0, $report->feedbackMessages()->count());
    }

    public function test_guests_and_single_report_reporters_cannot_use_the_panel_endpoints(): void
    {
        $report = $this->report('私密的單', now()->subDay());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subHour(), '內容');

        $this->getJson(route('feedback.conversations.index', $this->project))->assertForbidden();
        $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->assertForbidden();
        $this->get(route('feedback.conversations.index', $this->project))->assertRedirect(route('feedback.login', $this->project));

        $token = Str::random(48);
        $report->update(['reporter_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.reports.show', [$this->project, $report]).'?access='.$token)->assertRedirect();
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertDontSee('data-chat-root', false);
        $this->getJson(route('feedback.conversations.index', $this->project))->assertForbidden();
        $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->assertForbidden();
    }

    public function test_access_to_one_project_does_not_open_another_projects_conversations(): void
    {
        $other = FeedbackProject::factory()->create();
        $otherReport = FeedbackReport::factory()->for($other)->create(['title' => '別的專案的單']);
        $this->actingAsClient();

        $this->getJson(route('feedback.conversations.index', $other))->assertForbidden();
        $this->getJson(route('feedback.conversations.show', [$other, $otherReport]))->assertForbidden();
        // 用自己專案的網址去開別專案的單也不行。
        $this->getJson(route('feedback.conversations.show', [$this->project, $otherReport]))->assertNotFound();
        $this->assertStringNotContainsString('別的專案的單', $this->getJson(route('feedback.conversations.index', $this->project))->getContent());
    }

    public function test_client_cannot_open_developer_created_or_deleted_reports(): void
    {
        $developerReport = FeedbackReport::factory()->for($this->project)->byOwnerShared()->create();
        $deleted = $this->report('刪掉的單', now()->subDay(), ['client_deleted_at' => now()]);
        $this->actingAsClient();

        $this->getJson(route('feedback.conversations.show', [$this->project, $developerReport]))->assertNotFound();
        $this->getJson(route('feedback.conversations.show', [$this->project, $deleted]))->assertNotFound();
        $this->postJson(route('feedback.messages.store', [$this->project, $developerReport]), ['body' => '試試看'])->assertNotFound();

        $this->actingAsOwner();
        $this->getJson(route('feedback.conversations.show', [$this->project, $deleted]))->assertOk()->assertJsonPath('deleted', true);
    }

    public function test_titles_and_messages_are_escaped(): void
    {
        $payload = '<img src=x onerror=alert(1)>';
        $report = $this->report($payload.'標題', now()->subDay());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subHour(), '<script>alert("x")</script>', '<b>名字</b>');
        $this->actingAsOwner();

        $list = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertStringStartsWith('application/json', $list->headers->get('Content-Type'));
        // JSON 原樣傳回文字，前端只用 textContent 放進畫面。
        $this->assertSame($payload.'標題', $list->json('items.0.title'));

        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $report]))->json('html');
        $this->assertStringNotContainsString('<script>alert', $html);
        $this->assertStringContainsString('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', $html);
        $this->assertStringNotContainsString('<b>名字</b>', $html);
        $this->assertStringContainsString('&lt;b&gt;名字&lt;/b&gt;', $html);

        $page = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $this->assertStringNotContainsString($payload, $page);
        $this->assertStringNotContainsString('<script>alert', $this->get(route('feedback.reports.show', [$this->project, $report]))->getContent());
    }

    public function test_panel_and_clickable_badges_appear_for_signed_in_roles_only(): void
    {
        $report = $this->report('有留言的單', now()->subDay(), ['adjustment_note' => '說明', 'adjustment_updated_at' => now()]);
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(5), '老師留言');

        $this->get(route('feedback.login', $this->project))->assertOk()->assertDontSee('data-chat-root', false);

        $this->actingAsOwner();
        $page = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $this->assertStringContainsString('data-chat-root', $page);
        $this->assertStringContainsString('data-viewer="owner"', $page);
        $this->assertStringContainsString(route('feedback.conversations.index', $this->project), $page);
        $this->assertMatchesRegularExpression('/name="_token" value="[^"]+"/', Str::between($page, 'data-chat-form', '</form>'));
        $this->assertStringContainsString('data-chat-open="'.$report->public_id.'"', $page);
        $board = $this->get(route('feedback.portal', [$this->project, 'view' => 'board']))->getContent();
        $this->assertStringContainsString('data-chat-open="'.$report->public_id.'"', $board);
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSee('data-chat-root', false)
            ->assertSee('在對話面板開啟');

        $this->actingAsClient();
        $page = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $this->assertStringContainsString('data-viewer="client"', $page);
        // 客戶端：老師自己的留言不算未讀，調整說明更新算 1，紅色數字顯示 1。
        $this->assertMatchesRegularExpression('/data-chat-open="'.$report->public_id.'"[^>]*aria-label="[^"]*共 1 則留言，1 則未讀/', $page);
        $this->assertMatchesRegularExpression('/data-unread-badge\s+data-new-reply-badge\s*>1</', $page);
        $this->assertStringNotContainsString('有新回覆', $page);
        $dialog = Str::between($page, 'id="detail-report-'.$report->public_id.'"', '</dialog>');
        $this->assertStringContainsString('開啟對話', $dialog);
    }

    public function test_report_page_shows_the_full_conversation_as_chat_bubbles(): void
    {
        $report = $this->report('完整頁', now()->subDay());
        $this->message($report, FeedbackAuthorType::Reporter, now()->subHours(2), '第一則老師留言');
        $this->message($report, FeedbackAuthorType::Owner, now()->subHour(), '開發者回覆內容');

        $this->actingAsClient();
        $html = $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertOk()
            ->assertSeeInOrder(['第一則老師留言', '開發者回覆內容', 'id="body"'], false)
            ->getContent();
        $this->assertMatchesRegularExpression('/data-author="reporter" data-side="mine"/', $html);

        $this->get(route('feedback.reports.activity', [$this->project, $report]))
            ->assertOk()
            ->assertSee('data-side="mine"', false);
    }

    private function image(string $name, int $kilobytes = 10): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG))->size($kilobytes);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function report(string $title, Carbon $createdAt, array $attributes = []): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'title' => $title,
            'created_at' => $createdAt,
            'latest_activity_at' => $createdAt,
            'owner_last_read_at' => $createdAt,
            'client_last_read_at' => $createdAt,
            ...$attributes,
        ]);
    }

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at, string $body, ?string $name = null): FeedbackMessage
    {
        return FeedbackMessage::factory()->for($report)->create([
            'author_type' => $author,
            'author_name' => $name,
            'body' => $body,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function actingAsOwner(): void
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
