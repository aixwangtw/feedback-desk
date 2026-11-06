<?php

namespace Tests\Feature\Feedback;

use App\Actions\PostFeedbackMessageAction;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 待審留言在單頁、詳情視窗、右下角對話面板三處共用同一份畫面（feedback.reports._drafts，經對話端點的 drafts_html 取得），
 * 送出一律走 feedback.drafts.send（可送出改過的文字、取代型改寫原留言），清單標「有草稿」。客戶的三個地方都拿不到草稿。
 */
class FeedbackChatPanelDraftTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const DRAFT_TEXT = '面板草稿：已修正第 3 題排版';

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'title' => '有草稿的單',
            'status' => FeedbackReportStatus::New,
            'owner_last_read_at' => now(),
            'client_last_read_at' => now(),
        ]);
    }

    public function test_team_thread_carries_drafts_with_their_send_url_and_the_list_marks_them(): void
    {
        $original = $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '原本的說明']);
        $draft = $this->draft(replaces: $original->id);
        $this->actingAsTeam();

        $thread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $html = $thread->json('drafts_html');
        $this->assertStringContainsString('data-message-draft="'.$draft->id.'"', $html);
        $this->assertStringContainsString(self::DRAFT_TEXT, $html);
        $this->assertStringContainsString('data-draft-replaces="'.$original->id.'"', $html);
        $this->assertStringContainsString('原本的說明', $html);
        $this->assertStringContainsString('data-draft-send-url="'.route('feedback.drafts.send', [$this->project, $this->report, $draft]).'"', $html);
        // 視窗與面板重複出現，不放單頁才有的錨點 id。
        $this->assertStringNotContainsString('id="message-drafts"', $html);

        $list = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertSame(1, collect($list->json('items'))->firstWhere('id', $this->report->public_id)['drafts_count']);

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-chat-drafts', false)->assertSee('data-dialog-thread-drafts', false);
    }

    public function test_team_thread_lists_draft_attachments_with_the_draft_file_route_and_the_client_never_gets_them(): void
    {
        $draft = $this->draft();
        $draft->update(['attachments' => [
            ['disk' => 'local', 'path' => 'drafts/a.mp4', 'original_name' => '教學.mp4', 'mime_type' => 'video/mp4', 'size' => 10],
            ['disk' => 'local', 'path' => 'drafts/b.png', 'original_name' => '截圖.png', 'mime_type' => 'image/png', 'size' => 10],
        ]]);
        $this->actingAsTeam();

        $thread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $html = $thread->json('drafts_html');
        $video = e(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]));
        $this->assertStringContainsString('<video controls playsinline preload="metadata" src="'.$video.'"', $html);
        $this->assertStringContainsString('src="'.e(route('feedback.drafts.file', [$this->project, $this->report, $draft, 1])).'"', $html);
        // 每個附件下方的短標題：檔名去掉副檔名，完整檔名放 title。
        $this->assertStringContainsString('title="教學.mp4" data-attachment-title>教學</span>', $html);
        $this->assertStringContainsString('title="截圖.png" data-attachment-title>截圖</span>', $html);

        $this->actingAsClient();
        $client = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $this->assertArrayNotHasKey('drafts_html', $client->json());
        $this->assertStringNotContainsString('drafts/a.mp4', $client->getContent());
        $this->assertStringNotContainsString('/files/0', $client->getContent());
        $this->getJson(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]))->assertForbidden();
    }

    public function test_unsent_drafts_count_as_awaiting_for_the_team_only(): void
    {
        // 團隊最後發言、照理是「已回覆」；但還有沒送出的草稿，團隊端要放進未回覆並讓面板彈出。
        $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Reporter, 'author_name' => '老師', 'body' => '問題']);
        $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '已回覆']);
        $plain = FeedbackReport::factory()->for($this->project)->create(['title' => '沒草稿已回覆']);
        $plain->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '回覆']);
        $this->draft();

        $this->actingAsTeam();
        $team = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $item = collect($team->json('items'))->firstWhere('id', $this->report->public_id);
        $this->assertTrue($item['awaiting_reply']);
        $this->assertSame(1, $team->json('awaiting_total'));
        $this->assertSame(1, $team->json('drafts_total'));

        $this->actingAsClient();
        $client = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertArrayNotHasKey('drafts_total', $client->json());
        // 客戶端照原規則：團隊最後發言＝等客戶回覆，兩張都是未回覆；草稿完全不影響。
        $this->assertSame(2, $client->json('awaiting_total'));
    }

    public function test_client_panel_never_receives_drafts(): void
    {
        $this->draft();
        $this->actingAsClient();

        $thread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $this->assertArrayNotHasKey('drafts_html', $thread->json());
        $this->assertArrayNotHasKey('drafts', $thread->json());
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $thread->getContent());

        $list = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $list->getContent());
        foreach ($list->json('items') as $item) {
            $this->assertArrayNotHasKey('drafts_count', $item);
        }

        $portal = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $portal);
        // 三個地方（面板、詳情視窗、單頁）對客戶都不輸出草稿容器與按鈕。
        $this->assertStringNotContainsString('data-chat-drafts', $portal);
        $this->assertStringNotContainsString('data-dialog-thread-drafts', $portal);
        $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->getContent();
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $page);
        $this->assertStringNotContainsString('data-message-drafts', $page);
        $this->assertStringNotContainsString('data-chat-drafts', $page);
    }

    public function test_draft_actions_answer_json_for_the_shared_panel_and_window_scripts(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();
        $update = route('feedback.drafts.update', [$this->project, $this->report, $draft]);

        $this->putJson($update, ['body' => '新的字'])->assertOk()->assertJsonPath('message', '待審留言已更新，尚未送出。');
        $this->assertSame('新的字', $draft->fresh()->body);
        $this->putJson($update, ['body' => ''])->assertUnprocessable();
        $this->deleteJson($update)->assertOk()->assertJsonPath('message', '已捨棄待審留言。');
        $this->assertNull(FeedbackMessageDraft::find($draft->id));

        $this->actingAsClient();
        $other = $this->draft();
        $this->putJson(route('feedback.drafts.update', [$this->project, $this->report, $other]), ['body' => 'x'])->assertForbidden();
        $this->deleteJson(route('feedback.drafts.destroy', [$this->project, $this->report, $other]))->assertForbidden();
        $this->assertNotNull(FeedbackMessageDraft::find($other->id));
    }

    public function test_sending_from_the_panel_uses_the_edited_text_and_returns_json(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();

        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]), ['body' => '  面板裡改過的文字  '])
            ->assertOk()
            ->assertJsonPath('status', 'needs_input')
            ->assertJsonPath('message', '留言已送出。'.PostFeedbackMessageAction::adjustmentReminder());

        $this->assertModelMissing($draft);
        $message = FeedbackMessage::sole();
        $this->assertSame('面板裡改過的文字', $message->body);
        $this->assertSame(FeedbackAuthorType::Owner, $message->author_type);
    }

    public function test_sending_without_edits_keeps_the_draft_text(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();

        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]))->assertOk();

        $this->assertSame(self::DRAFT_TEXT, FeedbackMessage::sole()->body);
    }

    public function test_replacement_draft_sent_from_the_panel_rewrites_the_original_with_the_edited_text(): void
    {
        $original = $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '原本的說明']);
        $draft = $this->draft(replaces: $original->id);
        $this->actingAsTeam();

        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]), ['body' => '面板改過的更正'])
            ->assertOk()
            ->assertJsonPath('message', fn (string $text): bool => str_starts_with($text, '已修改原留言。'));

        $this->assertSame(1, FeedbackMessage::count());
        $this->assertSame('面板改過的更正', $original->refresh()->body);
        $this->assertModelMissing($draft);
    }

    public function test_blank_edited_text_is_rejected_and_the_draft_is_kept(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();

        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]), ['body' => '   '])->assertUnprocessable();

        $this->assertModelExists($draft);
        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_client_cannot_send_drafts_from_the_panel(): void
    {
        $draft = $this->draft();
        $this->actingAsClient();

        $this->postJson(route('feedback.drafts.send', [$this->project, $this->report, $draft]), ['body' => '偷送'])->assertForbidden();

        $this->assertModelExists($draft);
        $this->assertSame(0, FeedbackMessage::count());
    }

    private function draft(?int $replaces = null): FeedbackMessageDraft
    {
        return FeedbackMessageDraft::create([
            'feedback_report_id' => $this->report->id,
            'replaces_message_id' => $replaces,
            'author_name' => '開發團隊',
            'author_agent' => 'Claude Code',
            'body' => self::DRAFT_TEXT,
        ]);
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
