<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 編輯、收回自己發的留言：只能動自己的、不留痕跡（沒有「已編輯」、收回後整則消失）、不改單的狀態；
 * 收回後老師端的 HTML、JSON、相簿、附件網址都拿不到該則內容。
 */
class FeedbackMessageManagementTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackReport $report;

    private FeedbackMessage $teamMessage;

    private FeedbackMessage $teacherMessage;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::NeedsInput]);
        $this->teamMessage = FeedbackMessage::factory()->create(['feedback_report_id' => $this->report->id, 'author_type' => FeedbackAuthorType::Owner, 'author_name' => '王工程師', 'body' => '團隊原文ALPHA', 'created_at' => now()->subHour()]);
        $this->teacherMessage = FeedbackMessage::factory()->create(['feedback_report_id' => $this->report->id, 'author_type' => FeedbackAuthorType::Reporter, 'author_name' => '老師', 'body' => '老師原文BETA', 'created_at' => now()->subMinutes(30)]);
    }

    private function url(string $route, FeedbackMessage $message): string
    {
        return route($route, [$this->project, $this->report, $message]);
    }

    public function test_team_edits_its_own_message_without_any_edited_mark_or_status_change(): void
    {
        $this->actingAsOwner();

        $this->putJson($this->url('feedback.messages.update', $this->teamMessage), ['body' => '  團隊新文字GAMMA  '])->assertOk();

        $this->assertSame('團隊新文字GAMMA', $this->teamMessage->fresh()->body);
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->fresh()->status);
        foreach ([$this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html'), $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent()] as $html) {
            $this->assertStringContainsString('團隊新文字GAMMA', $html);
            $this->assertStringNotContainsString('已編輯', $html);
            $this->assertStringNotContainsString('編輯過', $html);
        }
    }

    public function test_the_menu_and_edit_form_only_appear_on_messages_the_viewer_may_manage(): void
    {
        $this->actingAsOwner();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertSame(1, substr_count($html, 'data-message-menu'));
        $this->assertStringContainsString($this->url('feedback.messages.destroy', $this->teamMessage), $html);
        $this->assertStringNotContainsString($this->url('feedback.messages.destroy', $this->teacherMessage), $html);

        $this->actingAsClient();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertSame(1, substr_count($html, 'data-message-menu'));
        $this->assertStringContainsString($this->url('feedback.messages.destroy', $this->teacherMessage), $html);
        $this->assertStringNotContainsString($this->url('feedback.messages.destroy', $this->teamMessage), $html);
    }

    public function test_neither_side_can_edit_or_withdraw_the_other_sides_messages(): void
    {
        $this->actingAsClient();
        $this->putJson($this->url('feedback.messages.update', $this->teamMessage), ['body' => '偷改'])->assertNotFound();
        $this->deleteJson($this->url('feedback.messages.destroy', $this->teamMessage))->assertNotFound();

        $this->actingAsOwner();
        $this->putJson($this->url('feedback.messages.update', $this->teacherMessage), ['body' => '偷改'])->assertNotFound();
        $this->deleteJson($this->url('feedback.messages.destroy', $this->teacherMessage))->assertNotFound();

        $this->assertSame('團隊原文ALPHA', $this->teamMessage->fresh()->body);
        $this->assertSame('老師原文BETA', $this->teacherMessage->fresh()->body);
        $this->assertNull($this->teamMessage->fresh()->deleted_at);
        $this->assertNull($this->teacherMessage->fresh()->deleted_at);
    }

    public function test_one_teacher_account_cannot_touch_another_teachers_message(): void
    {
        $other = FeedbackMessage::factory()->create(['feedback_report_id' => $this->report->id, 'author_type' => FeedbackAuthorType::Reporter, 'author_client_account_id' => FeedbackClientAccount::factory()->create(['feedback_project_id' => $this->project->id])->id, 'body' => '另一位老師']);

        $this->assertFalse($other->isManageableBy(false, null));
        $this->assertTrue($other->isManageableBy(false, $other->authorClientAccount));
        $this->assertFalse($other->isManageableBy(true, $other->authorClientAccount));
        $this->assertFalse($this->teacherMessage->isManageableBy(false, $other->authorClientAccount));
        $this->assertTrue($this->teamMessage->isManageableBy(true, null));
        $this->assertFalse($this->teamMessage->isManageableBy(false, null));
    }

    public function test_withdrawn_message_leaves_no_trace_for_the_teacher_in_html_json_album_unread_and_bell(): void
    {
        $photo = FeedbackAttachment::factory()->for($this->report)->create(['feedback_message_id' => $this->teamMessage->id, 'original_name' => 'secret-photo.png', 'path' => 'feedback/secret-photo.png']);
        Storage::disk('local')->put('feedback/secret-photo.png', 'x');
        $this->report->markReadByClient();
        $this->teamMessage->forceFill(['created_at' => now()->addMinute()])->save();
        $this->actingAsClient();
        $this->assertSame(1, $this->getJson(route('feedback.conversations.index', $this->project))->json('unread_total'));
        $this->get(route('feedback.attachments.show', [$this->project, $this->report, $photo]))->assertOk();

        $this->actingAsOwner();
        $this->deleteJson($this->url('feedback.messages.destroy', $this->teamMessage))->assertOk();
        $this->assertSoftDeleted($this->teamMessage);
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->fresh()->status);

        $this->actingAsClient();
        $json = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]));
        $page = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent();
        $activity = $this->get(route('feedback.reports.activity', [$this->project, $this->report]))->getContent();
        $album = $this->get(route('feedback.reports.activity', [$this->project, $this->report, 'part' => 'album']))->getContent();
        foreach ([$json->getContent(), $page, $activity, $album, $this->getJson(route('feedback.conversations.index', $this->project))->getContent()] as $payload) {
            $this->assertStringNotContainsString('團隊原文ALPHA', $payload);
            $this->assertStringNotContainsString('secret-photo', $payload);
            $this->assertStringNotContainsString('已收回', $payload);
        }
        $this->assertSame(0, $json->json('album_count'));
        $this->assertSame('', $json->json('album_html'));
        $this->assertStringContainsString('老師原文BETA', $json->json('html'));
        $this->assertSame(0, $this->getJson(route('feedback.conversations.index', $this->project))->json('unread_total'));
        $this->get(route('feedback.attachments.show', [$this->project, $this->report, $photo]))->assertNotFound();
    }

    public function test_withdrawing_the_completion_request_removes_the_approve_button(): void
    {
        $request = FeedbackMessage::factory()->create(['feedback_report_id' => $this->report->id, 'author_type' => FeedbackAuthorType::Owner, 'body' => '請確認完成XYZ', 'is_completion_request' => true]);

        $this->actingAsClient();
        $this->assertStringContainsString('data-completion-approve', $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html'));

        $this->actingAsOwner();
        $this->deleteJson($this->url('feedback.messages.destroy', $request))->assertOk();

        $this->actingAsClient();
        $html = $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->json('html');
        $this->assertStringNotContainsString('data-completion-approve', $html);
        $this->assertStringNotContainsString('請確認完成XYZ', $html);
        $this->assertSame(FeedbackReportStatus::NeedsInput, $this->report->fresh()->status);
    }

    public function test_edit_can_add_and_remove_attachments(): void
    {
        $old = FeedbackAttachment::factory()->for($this->report)->create(['feedback_message_id' => $this->teacherMessage->id, 'original_name' => 'old.png', 'path' => 'feedback/old.png']);
        $this->actingAsClient();

        $this->post($this->url('feedback.messages.update', $this->teacherMessage), [
            '_method' => 'PUT',
            'body' => '老師改過',
            'remove_attachments' => [$old->id],
            'screenshots' => [UploadedFile::fake()->createWithContent('new-shot.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))],
        ], ['Accept' => 'application/json'])->assertOk();

        $names = $this->teacherMessage->fresh()->feedbackAttachments->pluck('original_name')->all();
        $this->assertSame(['new-shot.png'], $names);
        $this->assertSame('老師改過', $this->teacherMessage->fresh()->body);
    }

    public function test_cli_edit_and_withdraw_only_work_on_team_messages(): void
    {
        $this->artisan('feedback:message-edit', ['project' => 'site', 'report' => $this->report->public_id, 'message' => $this->teamMessage->id, '--text' => 'CLI改的'])->assertSuccessful();
        $this->assertSame('CLI改的', $this->teamMessage->fresh()->body);

        $this->artisan('feedback:message-edit', ['project' => 'site', 'report' => $this->report->public_id, 'message' => $this->teacherMessage->id, '--text' => '偷改'])->assertFailed();
        $this->artisan('feedback:message-withdraw', ['project' => 'site', 'report' => $this->report->public_id, 'message' => $this->teacherMessage->id])->assertFailed();
        $this->assertNull($this->teacherMessage->fresh()->deleted_at);

        $this->artisan('feedback:message-withdraw', ['project' => 'site', 'report' => $this->report->public_id, 'message' => $this->teamMessage->id])->assertSuccessful();
        $this->assertSoftDeleted($this->teamMessage);
    }

    public function test_patrol_api_edits_and_withdraws_team_messages_but_not_the_teachers(): void
    {
        $alex = FeedbackDeveloper::factory()->create(['username' => 'alex', 'name' => 'Alex']);
        $plain = FeedbackPatrolToken::issue($alex, '雲端排程')['plain'];
        $base = '/api/patrol/projects/site/reports/'.$this->report->public_id.'/messages/';

        $this->withToken($plain)->putJson($base.$this->teamMessage->id, ['body' => '巡檢改的'])->assertOk();
        $this->assertSame('巡檢改的', $this->teamMessage->fresh()->body);
        $this->withToken($plain)->putJson($base.$this->teacherMessage->id, ['body' => '偷改'])->assertNotFound();
        $this->withToken($plain)->deleteJson($base.$this->teacherMessage->id)->assertNotFound();
        $this->withToken($plain)->deleteJson($base.$this->teamMessage->id)->assertOk();
        $this->assertSoftDeleted($this->teamMessage);
        $this->assertNull($this->teacherMessage->fresh()->deleted_at);
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
