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
 * 右下角對話面板裡的待審留言：團隊打開那張單時草稿帶進輸入框、按送出走與單頁相同的送出流程
 * （可送出改過的文字、取代型改寫原留言）、清單標「有草稿」。客戶的面板完全拿不到草稿。
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
        $thread->assertJsonPath('drafts.0.id', $draft->id)
            ->assertJsonPath('drafts.0.body', self::DRAFT_TEXT)
            ->assertJsonPath('drafts.0.replaces_message_id', $original->id)
            ->assertJsonPath('drafts.0.replaces_body', '原本的說明')
            ->assertJsonPath('drafts.0.send_url', route('feedback.drafts.send', [$this->project, $this->report, $draft]));

        $list = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertSame(1, collect($list->json('items'))->firstWhere('id', $this->report->public_id)['drafts_count']);

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-chat-draft', false);
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
        $this->assertArrayNotHasKey('drafts', $thread->json());
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $thread->getContent());

        $list = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $list->getContent());
        foreach ($list->json('items') as $item) {
            $this->assertArrayNotHasKey('drafts_count', $item);
        }

        $portal = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $this->assertStringNotContainsString(self::DRAFT_TEXT, $portal);
        $this->assertStringNotContainsString('data-chat-draft', $portal);
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
