<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 附件即時更新：列表、看板、詳情、面板的附件都來自同一份查詢（FeedbackAlbum）。
 * 列表含留言附件（最新在前、最多 3 張＋「+N」）、收回的不算、草稿附件只有團隊的相簿看得到且列表不顯示。
 */
class FeedbackAttachmentLiveUpdateTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::NeedsInput,
            'created_at' => now()->subDay(),
        ]);
    }

    public function test_list_thumbnails_include_message_attachments_newest_first_with_a_plus_counter(): void
    {
        $this->attach(null, 'original.png', now()->subHours(5));
        $message = $this->message(FeedbackAuthorType::Reporter);
        $this->attach($message, 'm-old.png', now()->subHours(4));
        $this->attach($message, 'm-mid.png', now()->subHours(3));
        $this->attach($message, 'm-new.png', now()->subHour());
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $cell = Str::between($html, 'data-attachment-thumbs="'.$this->report->public_id.'"', '</td>');

        $this->assertStringContainsString('data-attachment-count="4"', $html);
        $this->assertSame(3, substr_count($cell, '<img'));
        $this->assertLessThan(strpos($cell, 'm-mid.png'), strpos($cell, 'm-new.png'));
        $this->assertLessThan(strpos($cell, 'm-old.png'), strpos($cell, 'm-mid.png'));
        $this->assertStringNotContainsString('original.png', $cell);
        $this->assertStringContainsString('+1', $cell);
        $this->assertStringContainsString('data-open-album', $cell);
        $this->assertStringContainsString('data-dialog-open="detail-report-'.$this->report->public_id.'"', $cell);
        $this->assertStringContainsString('data-attachment-thumbs-url', $html);
    }

    public function test_board_card_uses_the_same_thumbnail_component(): void
    {
        $this->attach($this->message(FeedbackAuthorType::Reporter), 'card.png', now());
        $this->actingAsOwner();

        $board = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all', 'view' => 'board']))->assertOk()->getContent();
        $card = Str::between($board, 'data-report-id="'.$this->report->public_id.'"', '</article>');

        $this->assertStringContainsString('data-attachment-thumbs="'.$this->report->public_id.'"', $card);
        $this->assertStringContainsString('card.png', $card);
    }

    public function test_withdrawn_message_attachments_are_not_counted_anywhere(): void
    {
        $kept = $this->message(FeedbackAuthorType::Reporter);
        $this->attach($kept, 'kept.png', now()->subHour());
        $withdrawn = $this->message(FeedbackAuthorType::Reporter);
        $this->attach($withdrawn, 'withdrawn.png', now());
        $withdrawn->delete();
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $cell = Str::between($html, 'data-attachment-thumbs="'.$this->report->public_id.'"', '</td>');
        $this->assertStringContainsString('data-attachment-count="1"', $html);
        $this->assertStringNotContainsString('withdrawn.png', $cell);

        $json = $this->getJson(route('feedback.attachment-thumbs.index', [$this->project, 'ids' => [$this->report->public_id]]))->assertOk();
        $this->assertSame(1, $json->json('reports.'.$this->report->public_id.'.count'));

        $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertJsonPath('album_count', 1);
    }

    public function test_client_never_gets_draft_attachments_and_the_list_never_shows_them_to_the_team(): void
    {
        $this->attach($this->message(FeedbackAuthorType::Reporter), 'real.png', now()->subHour());
        FeedbackMessageDraft::create([
            'feedback_report_id' => $this->report->id,
            'author_name' => '開發團隊',
            'body' => '草稿',
            'attachments' => [
                ['disk' => 'local', 'path' => 'drafts/secret.png', 'original_name' => 'secret-draft.png', 'mime_type' => 'image/png', 'size' => 10],
            ],
        ]);

        $this->actingAsOwner();
        $thread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        // 團隊的相簿含草稿附件（徽章數 2），列表與輪詢端點不含。
        $thread->assertJsonPath('album_count', 2);
        $this->assertStringContainsString('secret-draft.png', $thread->json('album_html'));
        $list = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent();
        $this->assertStringNotContainsString('secret-draft.png', $list);
        $this->getJson(route('feedback.attachment-thumbs.index', [$this->project, 'ids' => [$this->report->public_id]]))
            ->assertJsonPath('reports.'.$this->report->public_id.'.count', 1);

        $this->actingAsClient();
        $thread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $thread->assertJsonPath('album_count', 1);
        $this->assertStringNotContainsString('secret-draft.png', $thread->json('album_html'));
        $json = $this->getJson(route('feedback.attachment-thumbs.index', [$this->project, 'ids' => [$this->report->public_id]]))->assertOk();
        $this->assertStringNotContainsString('secret-draft', json_encode($json->json()));
        $this->assertStringNotContainsString('secret-draft', $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent());
    }

    public function test_polling_endpoint_reflects_a_newly_uploaded_attachment(): void
    {
        $this->actingAsOwner();
        $url = route('feedback.attachment-thumbs.index', [$this->project, 'ids' => [$this->report->public_id]]);
        $this->getJson($url)->assertJsonPath('reports.'.$this->report->public_id.'.count', 0);

        $this->attach($this->message(FeedbackAuthorType::Reporter), 'fresh.png', now());

        $entry = $this->getJson($url)->json('reports.'.$this->report->public_id);
        $this->assertSame(1, $entry['count']);
        $this->assertStringContainsString('fresh.png', $entry['row_html']);
        $this->assertStringContainsString('data-card-action', $entry['card_html']);
        $this->assertStringNotContainsString('data-card-action', $entry['row_html']);
    }

    public function test_polling_endpoint_hides_reports_the_client_cannot_see(): void
    {
        $other = FeedbackReport::factory()->for($this->project)->byDeveloper()->create();
        $this->attach($this->message(FeedbackAuthorType::Owner, $other), 'private.png', now());
        $this->actingAsClient();

        $json = $this->getJson(route('feedback.attachment-thumbs.index', [$this->project, 'ids' => [$other->public_id]]))->assertOk();
        $this->assertSame([], $json->json('reports'));
    }

    public function test_panel_has_a_fixed_header_album_button_with_badge_and_the_back_pane(): void
    {
        $this->actingAsOwner();
        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();

        $this->assertMatchesRegularExpression('/<button[^>]*data-chat-album-open>(?:(?!<\/button>).)*data-chat-album-count/s', $html);
        $this->assertStringNotContainsString('data-chat-album-open hidden', $html);
        $this->assertStringContainsString('data-chat-album-back', $html);
    }

    public function test_team_complete_button_is_in_list_and_board_and_hidden_once_completed(): void
    {
        $this->actingAsOwner();
        $id = $this->report->public_id;

        $list = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent();
        $row = Str::between($list, 'data-report-row="'.$id.'"', '</tr>');
        $this->assertStringContainsString('data-request-completion="'.$id.'"', $row);
        $this->assertStringContainsString('data-dialog-open="request-completion-'.$id.'"', $row);
        $this->assertStringContainsString('id="request-completion-'.$id.'"', $list);

        $board = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all', 'view' => 'board']))->getContent();
        $this->assertStringContainsString('data-request-completion="'.$id.'"', Str::between($board, 'data-report-id="'.$id.'"', '</article>'));

        $this->report->update(['status' => FeedbackReportStatus::Completed]);
        $done = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent();
        $this->assertStringNotContainsString('data-request-completion="'.$id.'"', Str::between($done, 'data-report-row="'.$id.'"', '</tr>'));
    }

    public function test_detail_side_is_label_value_rows_with_complete_button_and_overflow_menu(): void
    {
        $this->actingAsOwner();
        $side = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('side_html');

        $this->assertStringContainsString('data-detail-fields', $side);
        foreach (['狀態', '建立者', '建立時間', '最後更新'] as $label) {
            $this->assertStringContainsString('>'.$label.'</dt>', $side);
        }
        $this->assertStringContainsString('data-request-completion', $side);
        $this->assertStringContainsString('data-action-menu', $side);
        $menu = Str::after($side, 'data-action-menu');
        $this->assertStringContainsString('text-rose-700', $menu);
        $this->assertStringContainsString('data-delete-report', $menu);
        $this->assertStringContainsString('data-chat-open', $menu);
        $this->assertStringNotContainsString('不會直接結案。</p>', $side);
    }

    public function test_conversation_heading_is_called_message_everywhere(): void
    {
        $this->actingAsOwner();
        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent();
        $dialog = Str::between($html, 'id="detail-report-'.$this->report->public_id.'"', '<dialog id="edit-report-');
        $this->assertStringContainsString('<h3 class="text-sm font-bold text-slate-900">留言</h3>', $dialog);
        $this->assertStringNotContainsString('>活動<', $dialog);
        $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent();
        $this->assertStringNotContainsString('>活動<', $page);
    }

    private function message(FeedbackAuthorType $author, ?FeedbackReport $report = null): FeedbackMessage
    {
        return FeedbackMessage::factory()->for($report ?? $this->report)->create(['author_type' => $author, 'body' => '附件留言']);
    }

    private function attach(?FeedbackMessage $message, string $name, $at): FeedbackAttachment
    {
        return FeedbackAttachment::factory()->create([
            'feedback_report_id' => $message?->feedback_report_id ?? $this->report->id,
            'feedback_message_id' => $message?->id,
            'original_name' => $name,
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
