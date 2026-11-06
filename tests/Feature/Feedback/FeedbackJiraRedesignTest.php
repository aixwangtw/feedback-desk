<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackApiToken;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackCompletionRequest;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Jira 式改版：精簡清單、詳情（相簿、活動時間軸、過去的處理說明）、調整重點停用、
 * 「完成」不直接結案（開發團隊只能請老師確認，老師按「通過」才完成）。
 */
class FeedbackJiraRedesignTest extends TestCase
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

    // ------------------------------------------------------------------ 列表與詳情

    public function test_list_has_only_the_five_columns_and_no_tags_buttons_or_adjustment(): void
    {
        $this->report->update(['adjustment_note' => '舊調整重點不該出現在清單']);
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $header = Str::between($html, '<thead', '</thead>');

        $this->assertSame(5, substr_count($header, '<th '));
        foreach (['編號', '標題', '狀態', '建立者', '最後更新'] as $column) {
            $this->assertStringContainsString($column, $header);
        }
        foreach (['附件', '調整重點', '建立日期', '操作', '分類'] as $removed) {
            $this->assertStringNotContainsString($removed, $header);
        }

        $row = Str::between($html, 'data-report-row="'.$this->report->public_id.'"', '</tr>');
        $this->assertStringNotContainsString('data-report-flags', $row);
        $this->assertStringNotContainsString('data-chat-open', $row);
        $this->assertStringNotContainsString('<button', $row);
        $this->assertStringNotContainsString('舊調整重點不該出現在清單', $row);
        $this->assertStringContainsString('data-unread-slot="'.$this->report->public_id.'"', $row);
    }

    public function test_title_and_number_are_blue_links_and_the_whole_row_and_card_are_clickable(): void
    {
        $this->actingAsOwner();
        $dialogId = 'detail-report-'.$this->report->public_id;

        $list = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $row = Str::between($list, 'data-report-row="'.$this->report->public_id.'"', '</tr>');
        $this->assertSame(2, substr_count($row, 'text-blue-700'), '編號與標題都是藍色連結。');
        $this->assertSame(2, substr_count($row, 'hover:underline'));
        $this->assertSame(2, substr_count($row, 'cursor-pointer text-blue-700'));
        $this->assertStringContainsString('data-row-link="'.$dialogId.'"', $list);
        $this->assertStringContainsString('hover:bg-slate-100/70', $row.Str::before($list, 'data-report-row="'.$this->report->public_id.'"'));

        $board = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all', 'view' => 'board']))->assertOk()->getContent();
        $card = Str::between($board, 'data-report-id="'.$this->report->public_id.'"', '</article>');
        $this->assertStringContainsString('data-row-link="'.$dialogId.'"', $card);
        $this->assertStringContainsString('text-blue-700', $card);
        $this->assertStringContainsString('hover:shadow-lg', $board);
    }

    public function test_detail_is_a_right_side_panel_with_main_column_side_column_and_shared_thread_components(): void
    {
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $dialog = Str::between($html, 'id="detail-report-'.$this->report->public_id.'"', '<dialog id="edit-report-');

        $this->assertStringContainsString('detail-panel', $dialog);
        $this->assertStringContainsString('ml-auto h-dvh', $dialog);
        $this->assertStringContainsString('data-detail-side', $dialog);
        $this->assertStringContainsString('data-dialog-thread-form', $dialog);
        $this->assertStringContainsString('data-attachment-rules', $dialog);
        $this->assertStringContainsString('data-dialog-thread-drafts', $dialog);
        $this->assertStringContainsString('data-request-completion="'.$this->report->public_id.'"', $dialog);
    }

    public function test_conversation_json_carries_side_column_and_status_badge_for_live_updates(): void
    {
        $this->actingAsOwner();

        $json = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();

        $this->assertSame('needs_input', $json->json('status_value'));
        $this->assertStringContainsString('data-detail-side', $json->json('side_html'));
        $this->assertStringContainsString('data-report-status-badge="'.$this->report->public_id.'"', $json->json('status_badge_html'));
    }

    // ------------------------------------------------------------------ 活動時間軸

    public function test_timeline_mixes_messages_and_status_changes_and_hides_who_changed_it_from_the_client(): void
    {
        $this->report->update(['status' => FeedbackReportStatus::New]);
        $this->actingAsClient();
        $this->post(route('feedback.messages.store', [$this->project, $this->report]), ['body' => '老師先留言'])->assertRedirect();
        $this->actingAsOwner();
        $this->travel(1)->minutes();
        $this->post(route('feedback.messages.store', [$this->project, $this->report]), ['body' => '開發者回覆'])->assertRedirect();

        $owner = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertStringContainsString('data-chat-event="status"', $owner);
        $this->assertStringContainsString('將狀態改為「'.'<span class="font-semibold text-slate-800">'.FeedbackReportStatus::NeedsInput->label().'</span>」', $owner);
        $this->assertLessThan(strpos($owner, '開發者回覆'), strpos($owner, '老師先留言'));

        $this->actingAsClient();
        $client = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertStringContainsString('data-chat-event="status"', $client);
        $this->assertStringContainsString('將狀態改為', $client);
        // 老師端的狀態變更不寫是誰改的。
        $this->assertDoesNotMatchRegularExpression('/<p[^>]*>[^<]+將狀態改為/', $client);
    }

    // ------------------------------------------------------------------ 相簿

    public function test_album_collects_original_and_message_attachments_with_source_and_never_leaks_drafts_to_the_client(): void
    {
        $original = FeedbackAttachment::factory()->for($this->report)->create(['original_name' => 'original-shot.png', 'path' => 'feedback/original-shot.png']);
        $message = FeedbackMessage::factory()->create(['feedback_report_id' => $this->report->id, 'author_type' => FeedbackAuthorType::Owner, 'author_name' => '王工程師', 'body' => '附圖', 'created_at' => now()->subHour()]);
        $reply = FeedbackAttachment::factory()->for($this->report)->create(['feedback_message_id' => $message->id, 'original_name' => 'reply-shot.png', 'path' => 'feedback/reply-shot.png']);
        $video = FeedbackAttachment::factory()->for($this->report)->create(['feedback_message_id' => $message->id, 'original_name' => 'reply-video.mp4', 'path' => 'feedback/reply-video.mp4', 'mime_type' => 'video/mp4']);
        $draft = $this->report->messageDrafts()->create([
            'author_name' => 'AI', 'body' => '草稿',
            'attachments' => [['disk' => 'local', 'path' => 'feedback/drafts/secret.png', 'original_name' => 'draft-secret.png', 'mime_type' => 'image/png', 'size' => 5]],
        ]);
        Storage::disk('local')->put('feedback/drafts/secret.png', 'x');

        $this->actingAsOwner();
        $owner = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk()->json('html');
        $this->assertStringContainsString('data-chat-album', $owner);
        $this->assertSame(4, substr_count($owner, 'data-album-item'));
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $original]), $owner);
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $reply]), $owner);
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $video]), $owner);
        $this->assertStringContainsString('原始附件', $owner);
        $this->assertStringContainsString('王工程師 的留言', $owner);
        $this->assertStringContainsString('data-lightbox-play', $owner);
        $this->assertStringContainsString('loading="lazy"', $owner);
        $this->assertStringContainsString(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]), $owner);
        $this->assertStringContainsString('只有'.config('feedback.labels.owner').'看得到', $owner);

        $this->actingAsClient();
        $client = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk();
        $this->assertSame(3, substr_count($client->json('html'), 'data-album-item'));
        $this->assertStringNotContainsString('draft-secret.png', $client->json('html'));
        $this->assertStringNotContainsString('/drafts/', $client->json('html'));
        $this->assertStringNotContainsString('data-album-kind="draft"', $client->json('html'));
        $this->assertNull($client->json('drafts_html'));
        $this->assertStringNotContainsString('draft-secret.png', $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent());
        $this->assertStringNotContainsString('draft-secret.png', $this->get(route('feedback.reports.activity', [$this->project, $this->report]))->getContent());
        $this->get(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]))->assertForbidden();
    }

    public function test_album_is_hidden_when_the_report_has_no_attachments(): void
    {
        $this->actingAsClient();

        $this->assertStringNotContainsString('data-chat-album', $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html'));
    }

    // ------------------------------------------------------------------ 完成：開發團隊只能請老師確認

    public function test_team_complete_posts_an_editable_confirmation_message_and_never_closes_the_report(): void
    {
        $this->actingAsOwner();

        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), ['body' => '  已改好，請看看  '])
            ->assertCreated()
            ->assertJsonPath('status', 'needs_input');

        $this->report->refresh();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->status);
        $this->assertNull($this->report->completed_at);
        $message = $this->report->feedbackMessages()->sole();
        $this->assertTrue($message->is_completion_request);
        $this->assertSame('已改好，請看看', $message->body);
        $this->assertSame(FeedbackAuthorType::Owner, $message->author_type);
    }

    public function test_default_confirmation_text_is_used_when_the_body_is_blank_and_waiting_on_engineer_flips_to_waiting_on_teacher(): void
    {
        $this->report->update(['status' => FeedbackReportStatus::New]);
        $this->actingAsOwner();

        $this->post(route('feedback.reports.completion-request', [$this->project, $this->report]), ['body' => ''])->assertRedirect();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
        $this->assertSame(FeedbackCompletionRequest::defaultBody(), $this->report->feedbackMessages()->sole()->body);
        $this->assertStringContainsString('『通過』', FeedbackCompletionRequest::defaultBody());
        $this->assertStringContainsString('還有問題直接在這裡留言', FeedbackCompletionRequest::defaultBody());
    }

    public function test_completion_dialog_prefills_the_default_text_for_the_team(): void
    {
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent();
        $dialog = Str::between($html, 'id="request-completion-'.$this->report->public_id.'"', '</dialog>');

        $this->assertStringContainsString(e(FeedbackCompletionRequest::defaultBody()), $dialog);
        $this->assertStringContainsString('<textarea', $dialog);
        $this->assertStringContainsString('action="'.route('feedback.reports.completion-request', [$this->project, $this->report]).'"', $dialog);

        $this->actingAsClient();
        $this->assertStringNotContainsString('request-completion-', $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent());
    }

    public function test_team_still_cannot_set_the_report_to_completed_from_the_web(): void
    {
        $this->actingAsOwner();

        $this->patch(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])->assertForbidden();
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])->assertForbidden();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), [])->assertCreated();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
    }

    public function test_the_teacher_cannot_request_completion_and_guests_are_sent_to_login(): void
    {
        $this->actingAsClient();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), [])->assertForbidden();
        $this->assertSame(0, FeedbackMessage::count());

        $this->flushSession();
        $this->app['cookie']->flushQueuedCookies();
        $this->post(route('feedback.reports.completion-request', [$this->project, $this->report]), [])->assertRedirect(route('feedback.login', $this->project));
        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_requesting_completion_on_a_completed_report_is_refused(): void
    {
        $this->report->update(['status' => FeedbackReportStatus::Completed]);
        $this->actingAsOwner();

        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), [])
            ->assertUnprocessable()
            ->assertJsonPath('error', 'already_completed');
        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_approve_button_is_only_visible_and_usable_for_the_teacher_and_completes_the_report(): void
    {
        $this->actingAsOwner();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), [])->assertCreated();

        $ownerThread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertStringContainsString('data-completion-request-badge', $ownerThread);
        $this->assertStringNotContainsString('data-completion-approve', $ownerThread);
        $this->assertStringNotContainsString('data-completion-approve', $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent());
        $this->assertStringNotContainsString('data-completion-approve', $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent());
        $this->patch(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])->assertForbidden();

        $this->actingAsClient();
        $clientThread = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertStringContainsString('data-completion-approve="'.$this->report->public_id.'"', $clientThread);
        $this->assertStringContainsString('>通過</button>', $clientThread);
        $this->assertStringContainsString('data-completion-approve', $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent());

        $this->patchJson(route('feedback.reports.status.update', [$this->project, $this->report]), ['status' => 'completed'])
            ->assertOk()
            ->assertJsonPath('status', 'completed');
        $this->report->refresh();
        $this->assertSame(FeedbackReportStatus::Completed, $this->report->status);
        $this->assertNotNull($this->report->completed_at);

        // 已完成後沒有「通過」鈕，也沒有團隊的「完成」鈕。
        $after = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]));
        $this->assertStringNotContainsString('data-completion-approve', $after->json('html'));
        $this->assertStringNotContainsString('data-request-completion', $after->json('side_html'));
    }

    public function test_teacher_message_after_the_request_flips_the_report_back_to_waiting_on_the_engineer(): void
    {
        $this->actingAsOwner();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), [])->assertCreated();

        $this->actingAsClient();
        $this->postJson(route('feedback.messages.store', [$this->project, $this->report]), ['body' => '還是有問題'])->assertCreated();

        $this->assertSame(FeedbackReportStatus::New, $this->report->refresh()->status);
        $this->assertNull($this->report->completed_at);
    }

    public function test_only_the_latest_completion_request_shows_the_approve_button(): void
    {
        $this->actingAsOwner();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), ['body' => '第一次請確認'])->assertCreated();
        $this->postJson(route('feedback.reports.completion-request', [$this->project, $this->report]), ['body' => '第二次請確認'])->assertCreated();

        $this->actingAsClient();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertSame(1, substr_count($html, 'data-completion-approve="'));
        $this->assertSame(2, substr_count($html, 'data-completion-request-badge'));
    }

    // ------------------------------------------------------------------ 調整重點停用

    public function test_adjustment_cannot_be_written_from_the_web_but_old_notes_stay_visible_read_only(): void
    {
        $this->report->update(['adjustment_note' => '舊的處理說明']);
        $this->actingAsOwner();

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), ['adjustment_note' => '想改'])->assertStatus(410);

        $this->assertSame('舊的處理說明', $this->report->refresh()->adjustment_note);
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertSee('過去的處理說明')
            ->assertSee('舊的處理說明')
            ->assertDontSee('<textarea id="adjustment_note"', false)
            ->assertDontSee('編輯調整重點');
        $this->assertStringContainsString('過去的處理說明', $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html'));
    }

    public function test_past_notes_are_not_shown_when_there_is_nothing_to_show(): void
    {
        $this->actingAsClient();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertDontSee('過去的處理說明');
        $this->assertStringNotContainsString('過去的處理說明', $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html'));
        $this->assertStringNotContainsString('data-past-notes', $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->getContent());
    }

    // ------------------------------------------------------------------ CLI、MCP、巡檢 API

    public function test_command_requests_completion_without_closing_the_report(): void
    {
        $this->artisan('feedback:request-completion', ['project' => 'site', 'report' => $this->report->public_id])
            ->expectsOutputToContain('才會變成已完成')
            ->assertSuccessful();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
        $message = $this->report->feedbackMessages()->sole();
        $this->assertTrue($message->is_completion_request);
        $this->assertSame(FeedbackCompletionRequest::defaultBody(), $message->body);

        $this->artisan('feedback:request-completion', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '自己寫的確認'])->assertSuccessful();
        $this->assertSame('自己寫的確認', $this->report->feedbackMessages()->latest('id')->first()->body);

        $this->report->update(['status' => FeedbackReportStatus::Completed]);
        $this->artisan('feedback:request-completion', ['project' => 'site', 'report' => $this->report->public_id])->assertFailed();
        $this->artisan('feedback:request-completion', ['project' => 'site', 'report' => '12'])->assertFailed();
        $this->assertSame(2, FeedbackMessage::count());
    }

    public function test_command_status_still_refuses_completed(): void
    {
        $this->artisan('feedback:status', ['project' => 'site', 'report' => $this->report->public_id, 'status' => 'completed'])->assertFailed();

        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
    }

    public function test_mcp_team_tool_requests_completion_but_set_status_completed_is_still_refused_and_clients_do_not_get_the_tool(): void
    {
        $amy = FeedbackDeveloper::factory()->create(['username' => 'amy', 'name' => '王小明']);
        $team = FeedbackApiToken::issue($amy, 'MCP', 'Claude Code')['plain'];
        $mei = FeedbackClientAccount::factory()->for($this->project)->create(['username' => 'mei']);
        $client = FeedbackApiToken::issue($mei, 'MCP', null)['plain'];

        $teamTools = collect($this->mcp($team, 'tools/list')->json('result.tools'))->pluck('name');
        $clientTools = collect($this->mcp($client, 'tools/list')->json('result.tools'))->pluck('name');
        $this->assertTrue($teamTools->contains('request_completion'));
        $this->assertFalse($clientTools->contains('request_completion'));

        $this->mcp($team, 'tools/call', ['name' => 'set_status', 'arguments' => ['project' => 'site', 'report' => $this->report->public_id, 'status' => 'completed']])
            ->assertJsonPath('result.isError', true);

        $result = $this->mcp($team, 'tools/call', ['name' => 'request_completion', 'arguments' => ['project' => 'site', 'report' => $this->report->public_id, 'body' => '修好了請確認']])->assertOk();
        $this->assertNull($result->json('result.isError'));
        $this->assertSame('needs_input', json_decode($result->json('result.content.0.text'), true)['status']);
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
        $this->assertTrue($this->report->feedbackMessages()->sole()->is_completion_request);

        $refused = $this->mcp($client, 'tools/call', ['name' => 'request_completion', 'arguments' => ['project' => 'site', 'report' => $this->report->public_id]]);
        $this->assertSame(1, FeedbackMessage::count());
        $this->assertNotNull($refused->json('error'));

        $adjust = $this->mcp($team, 'tools/call', ['name' => 'write_adjustment', 'arguments' => ['project' => 'site', 'report' => $this->report->public_id, 'note' => '舊入口']])->assertOk();
        $this->assertStringContainsString('調整重點已停用', json_decode($adjust->json('result.content.0.text'), true)['warning']);
        $this->assertSame('舊入口', $this->report->refresh()->adjustment_note);
    }

    public function test_patrol_api_can_request_completion_but_never_close_and_adjustment_still_writes_with_a_warning(): void
    {
        $alex = FeedbackDeveloper::factory()->create(['username' => 'alex', 'name' => 'Alex']);
        $plain = FeedbackPatrolToken::issue($alex, '雲端排程')['plain'];

        $this->withToken($plain)->postJson(route('feedback.patrol.request-completion', ['site', $this->report->public_id]), [])
            ->assertOk()
            ->assertJsonPath('status', 'needs_input');
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->refresh()->status);
        $this->assertTrue($this->report->feedbackMessages()->sole()->is_completion_request);

        $this->withToken($plain)->postJson(route('feedback.patrol.request-completion', ['site', $this->report->public_id]), ['body' => 'x'])->assertOk();
        $this->report->update(['status' => FeedbackReportStatus::Completed]);
        $this->withToken($plain)->postJson(route('feedback.patrol.request-completion', ['site', $this->report->public_id]), [])->assertUnprocessable();
        $this->withToken('fdp_nope')->postJson(route('feedback.patrol.request-completion', ['site', $this->report->public_id]), [])->assertUnauthorized();

        $this->report->update(['status' => FeedbackReportStatus::NeedsInput]);
        $this->withToken($plain)->putJson(route('feedback.patrol.adjustment', ['site', $this->report->public_id]), ['note' => '巡檢照舊寫'])
            ->assertOk()
            ->assertJsonPath('note', 'replaced')
            ->assertJsonPath('warning', FeedbackCompletionRequest::ADJUSTMENT_DEPRECATED);
        $this->assertSame('巡檢照舊寫', $this->report->refresh()->adjustment_note);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @param  array<string, mixed>  $params
     */
    private function mcp(string $token, string $method, array $params = []): TestResponse
    {
        return $this->withToken($token)->postJson(route('feedback.mcp'), ['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params]);
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
