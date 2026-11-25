<?php

namespace Tests\Feature\Feedback;

use App\Actions\ManageFeedbackMessageDraftAction;
use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackPatrolLog;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use App\Support\StandardInput;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Support\ViewErrorBag;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * 待審留言（草稿）：團隊或排程先寫好，團隊在單頁審過按「送出」才變成正式留言；客戶端在送出前完全看不到、也不算未讀。
 */
class FeedbackMessageDraftTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private const DRAFT_TEXT = '待審內容：已修正排版，請再看一次';

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['slug' => 'site']);
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'title' => '題目排版跑掉',
            'owner_last_read_at' => now()->subHour(),
            'client_last_read_at' => now()->subHour(),
        ]);
        $this->mock(StandardInput::class, fn (MockInterface $mock) => $mock->shouldReceive('read')->andReturn(null));
    }

    public function test_command_creates_a_draft_that_the_client_cannot_see_and_that_is_not_unread(): void
    {
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '  '.self::DRAFT_TEXT.'  ', '--agent' => 'Claude Code'])
            ->expectsOutputToContain('草稿 id')
            ->assertSuccessful();

        $draft = FeedbackMessageDraft::sole();
        $this->assertSame(self::DRAFT_TEXT, $draft->body);
        $this->assertSame('Claude Code', $draft->author_agent);
        $this->assertNull($draft->replaces_message_id);
        $this->assertSame(0, FeedbackMessage::count());
        $this->assertSame(0, $this->clientUnread());

        $this->actingAsClient();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertDontSee(self::DRAFT_TEXT)
            ->assertDontSee('data-message-draft', false)
            ->assertDontSee('待審留言');
        $this->get(route('feedback.reports.activity', [$this->project, $this->report]))->assertOk()->assertDontSee(self::DRAFT_TEXT);
        $this->getJson(route('feedback.conversations.show', [$this->project, $this->report]))->assertOk()->assertDontSee(self::DRAFT_TEXT);
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertDontSee('待審留言')->assertDontSee('data-unread-badge', false);
        $this->assertSame(0, $this->clientUnread());
    }

    public function test_team_sees_the_draft_with_edit_send_and_discard_buttons_and_a_board_marker(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertSee('data-message-draft="'.$draft->id.'"', false)
            ->assertSee(self::DRAFT_TEXT)
            ->assertSee('送出')
            ->assertSee('捨棄')
            ->assertSee('編輯');

        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('待審留言 1');
        $this->get(route('feedback.portal', [$this->project, 'view' => 'board']))->assertOk()->assertSee('待審留言 1');
        $this->get(route('feedback.portal', [$this->project, 'sort' => 'created_at']))->assertOk()->assertSee('待審留言 1');
    }

    public function test_sending_turns_the_draft_into_a_message_the_client_sees_as_unread(): void
    {
        $draft = $this->draft();
        $alex = FeedbackDeveloper::factory()->withPassword('alex-password-1')->create(['username' => 'alex', 'name' => 'Alex']);
        $this->actingAsDeveloper('alex', 'alex-password-1');
        $this->travel(1)->minutes();

        $this->post(route('feedback.drafts.send', [$this->project, $this->report, $draft]))
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertModelMissing($draft);
        $message = FeedbackMessage::sole();
        $this->assertSame(self::DRAFT_TEXT, $message->body);
        $this->assertSame(FeedbackAuthorType::Owner, $message->author_type);
        $this->assertSame($alex->id, $message->author_developer_id);
        $this->assertSame('Claude Code', $message->author_agent);
        $this->assertTrue($message->created_at->greaterThan(now()->subSeconds(5)));
        $this->assertSame(1, $this->clientUnread());

        $this->actingAsClient();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertSee(self::DRAFT_TEXT);
    }

    public function test_team_can_edit_a_draft_before_sending(): void
    {
        $draft = $this->draft();
        $this->actingAsTeam();

        $this->put(route('feedback.drafts.update', [$this->project, $this->report, $draft]), ['body' => '  改過的內容  '])
            ->assertRedirect();

        $this->assertSame('改過的內容', $draft->refresh()->body);
        $this->assertSame(0, FeedbackMessage::count());
        $this->put(route('feedback.drafts.update', [$this->project, $this->report, $draft]), ['body' => ' '])->assertSessionHasErrors('body', null, 'draft'.$draft->id);
    }

    public function test_replacement_draft_edits_the_original_team_message_instead_of_adding_one(): void
    {
        $original = $this->report->feedbackMessages()->create([
            'author_type' => FeedbackAuthorType::Owner,
            'author_name' => '開發團隊',
            'body' => '原本的說明（有錯字）',
        ]);
        $originalCreatedAt = $original->created_at;

        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => '修正後的說明', '--replace-message' => $original->id])
            ->assertSuccessful();
        $draft = FeedbackMessageDraft::sole();
        $this->assertSame($original->id, $draft->replaces_message_id);

        $this->actingAsClient();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertSee('原本的說明（有錯字）')->assertDontSee('修正後的說明');

        $this->actingAsTeam();
        $this->get(route('feedback.reports.show', [$this->project, $this->report]))->assertOk()->assertSee('修改原留言');
        $this->post(route('feedback.drafts.send', [$this->project, $this->report, $draft]))->assertRedirect();

        $this->assertSame(1, FeedbackMessage::count());
        $original->refresh();
        $this->assertSame('修正後的說明', $original->body);
        $this->assertTrue($original->created_at->equalTo($originalCreatedAt));
        $this->assertModelMissing($draft);
    }

    public function test_replacement_must_point_to_a_team_message_on_the_same_report(): void
    {
        $clientMessage = $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Reporter, 'author_name' => '客戶', 'body' => '客戶的話']);
        $otherReport = FeedbackReport::factory()->for($this->project)->create();
        $otherTeamMessage = $otherReport->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => '開發團隊', 'body' => '別張單']);

        foreach ([$clientMessage->id, $otherTeamMessage->id, 999999] as $id) {
            $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => 'x', '--replace-message' => $id])->assertFailed();
        }
        $this->assertSame(0, FeedbackMessageDraft::count());
    }

    public function test_discarding_deletes_the_draft_and_its_files(): void
    {
        $image = $this->pngFile();
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => self::DRAFT_TEXT, '--attach' => [$image]])
            ->assertSuccessful();
        $draft = FeedbackMessageDraft::sole();
        $path = $draft->attachments[0]['path'];
        Storage::disk('local')->assertExists($path);

        $this->actingAsTeam();
        $this->delete(route('feedback.drafts.destroy', [$this->project, $this->report, $draft]))->assertRedirect();

        $this->assertModelMissing($draft);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame(0, FeedbackMessage::count());
        $this->assertFileExists($image);
    }

    public function test_draft_images_are_only_shown_to_the_team_and_become_message_attachments_when_sent(): void
    {
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => self::DRAFT_TEXT, '--attach' => [$this->pngFile()]])
            ->assertSuccessful();
        $draft = FeedbackMessageDraft::sole();
        $this->assertSame(0, FeedbackAttachment::count());

        $this->actingAsClient();
        $this->get(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]))->assertForbidden();

        $this->actingAsTeam();
        $this->get(route('feedback.drafts.file', [$this->project, $this->report, $draft, 0]))->assertOk();
        $this->get(route('feedback.drafts.file', [$this->project, $this->report, $draft, 5]))->assertNotFound();
        $this->post(route('feedback.drafts.send', [$this->project, $this->report, $draft]))->assertRedirect();

        $attachment = FeedbackAttachment::sole();
        $this->assertSame(FeedbackMessage::sole()->id, $attachment->feedback_message_id);
        Storage::disk('local')->assertExists($attachment->path);
    }

    public function test_command_rejects_bad_images_with_the_shared_rules(): void
    {
        $text = tempnam(sys_get_temp_dir(), 'fd').'.txt';
        file_put_contents($text, 'not an image');

        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => 'x', '--attach' => [$text]])
            ->expectsOutputToContain('只接受 jpg／png／webp')
            ->assertFailed();
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => ' '])->assertFailed();
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => '12'])->assertFailed();
        $this->assertSame(0, FeedbackMessageDraft::count());
    }

    public function test_client_cannot_send_edit_or_discard_drafts(): void
    {
        $draft = $this->draft();
        $this->actingAsClient();

        $this->post(route('feedback.drafts.send', [$this->project, $this->report, $draft]))->assertForbidden();
        $this->put(route('feedback.drafts.update', [$this->project, $this->report, $draft]), ['body' => '偷改'])->assertForbidden();
        $this->delete(route('feedback.drafts.destroy', [$this->project, $this->report, $draft]))->assertForbidden();

        $this->assertSame(self::DRAFT_TEXT, $draft->refresh()->body);
        $this->assertSame(0, FeedbackMessage::count());
    }

    public function test_draft_from_another_report_is_not_found(): void
    {
        $draft = $this->draft();
        $otherReport = FeedbackReport::factory()->for($this->project)->create();
        $this->actingAsTeam();

        $this->post(route('feedback.drafts.send', [$this->project, $otherReport, $draft]))->assertNotFound();
        $this->assertModelExists($draft);
    }

    public function test_patrol_api_creates_drafts_and_logs_the_write(): void
    {
        $alex = FeedbackDeveloper::factory()->create(['username' => 'alex', 'name' => 'Alex']);
        $plain = FeedbackPatrolToken::issue($alex, '雲端排程')['plain'];
        $original = $this->report->feedbackMessages()->create(['author_type' => FeedbackAuthorType::Owner, 'author_name' => 'Alex', 'body' => '原留言']);
        $url = route('feedback.patrol.draft', ['site', $this->report->public_id]);

        $this->postJson($url, ['body' => self::DRAFT_TEXT])->assertUnauthorized();

        $this->withToken($plain)->postJson($url, ['body' => self::DRAFT_TEXT])
            ->assertCreated()
            ->assertJsonPath('draft.body', self::DRAFT_TEXT)
            ->assertJsonPath('draft.replaces_message_id', null);
        // 改寫某則留言的草稿不接進新留言草稿，另成一則（否則送出時會覆蓋舊留言）。
        $this->withToken($plain)->postJson($url, ['body' => '改原留言', 'replace_message_id' => $original->id])
            ->assertCreated()
            ->assertJsonPath('draft.body', '改原留言')
            ->assertJsonPath('draft.replaces_message_id', $original->id);
        $this->withToken($plain)->postJson($url, ['body' => ' '])->assertUnprocessable();
        $this->withToken($plain)->postJson($url, ['body' => 'x', 'replace_message_id' => 999999])->assertUnprocessable();
        $this->withToken($plain)->postJson(route('feedback.patrol.draft', ['site', Str::uuid()->toString()]), ['body' => 'x'])->assertNotFound();

        $drafts = FeedbackMessageDraft::orderBy('id')->get();
        $this->assertCount(2, $drafts);
        $this->assertSame($alex->id, $drafts[0]->author_developer_id);
        $this->assertSame('Claude Code', $drafts[0]->author_agent);
        // 只有原本那則團隊留言算未讀；草稿不算。
        $this->assertSame(1, FeedbackMessage::count());
        $this->assertSame(1, $this->clientUnread());
        $this->assertSame(2, FeedbackPatrolLog::where('action', 'draft')->where('succeeded', true)->count());
        $this->assertSame(3, FeedbackPatrolLog::where('action', 'draft')->where('succeeded', false)->count());
    }

    public function test_one_report_keeps_a_single_draft_and_identical_text_is_not_repeated(): void
    {
        $actor = FeedbackActor::sharedOwner('Claude Code');
        $action = app(ManageFeedbackMessageDraftAction::class);

        $first = $action->create($this->report, $actor, '第一段');
        $second = $action->create($this->report, $actor, '第二段');
        $again = $action->create($this->report, $actor, '第二段');

        $this->assertSame($first->id, $second->id);
        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, FeedbackMessageDraft::where('feedback_report_id', $this->report->id)->count());
        $this->assertSame("第一段\n\n第二段", $again->body);
        // 待審留言區的說明寫出同一張單只留一則。
        $this->assertStringContainsString('同一張單的新留言只留一則，之後新增的內容會接在這一則後面；改寫舊留言的草稿另成一則', view('feedback.reports._drafts', ['project' => $this->project, 'report' => $this->report, 'drafts' => FeedbackMessageDraft::where('feedback_report_id', $this->report->id)->get(), 'errors' => new ViewErrorBag])->render());
    }

    public function test_new_draft_does_not_join_a_rewrite_draft_so_sending_keeps_the_old_message(): void
    {
        // 情境 A：先有改寫舊留言的草稿，再建新留言草稿；送出新留言草稿不能覆蓋舊留言。
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner('Claude Code');
        $old = $this->teamMessage('舊留言原文');

        $rewrite = $action->create($this->report, $actor, '舊留言改寫後', $old->id);
        $fresh = $action->create($this->report, $actor, '新的回覆');

        $this->assertNotSame($rewrite->id, $fresh->id);
        $this->assertNull($fresh->replaces_message_id);
        $this->assertSame('新的回覆', $fresh->body);
        $this->assertSame('舊留言改寫後', $rewrite->refresh()->body);

        $sent = $action->send($fresh, $actor);
        $this->assertNotSame($old->id, $sent->id);
        $this->assertSame('舊留言原文', $old->refresh()->body);
        $this->assertSame(2, FeedbackMessage::count());

        $action->send($rewrite->refresh(), $actor);
        $this->assertSame('舊留言改寫後', $old->refresh()->body);
        $this->assertSame('新的回覆', $sent->refresh()->body);
    }

    public function test_rewrite_draft_does_not_join_a_new_draft_so_new_text_is_not_lost(): void
    {
        // 情境 B：先有新留言草稿，再建改寫舊留言的草稿；新留言草稿送出後仍是新的一則，舊留言只照改寫草稿改。
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner('Claude Code');
        $old = $this->teamMessage('舊留言原文');

        $fresh = $action->create($this->report, $actor, '新的回覆');
        $rewrite = $action->create($this->report, $actor, '舊留言改寫後', $old->id);

        $this->assertNotSame($fresh->id, $rewrite->id);
        $this->assertSame($old->id, $rewrite->replaces_message_id);
        $this->assertSame('新的回覆', $fresh->refresh()->body);
        $this->assertNull($fresh->replaces_message_id);

        $action->send($fresh->refresh(), $actor);
        $this->assertSame('舊留言原文', $old->refresh()->body);
        $this->assertSame(1, FeedbackMessage::where('body', '新的回覆')->count());
    }

    public function test_rewrites_of_the_same_message_share_one_draft_and_the_latest_wins(): void
    {
        // 情境 C：同一則留言改寫兩次只留一則改寫草稿（後來的取代），改寫另一則留言各自一則。
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner('Claude Code');
        $first = $this->teamMessage('第一則');
        $second = $this->teamMessage('第二則');

        $draft = $action->create($this->report, $actor, '第一則改寫 v1', $first->id);
        $again = $action->create($this->report, $actor, '第一則改寫 v2', $first->id);
        $other = $action->create($this->report, $actor, '第二則改寫', $second->id);

        $this->assertSame($draft->id, $again->id);
        $this->assertSame('第一則改寫 v2', $again->body);
        $this->assertNotSame($draft->id, $other->id);
        $this->assertSame(2, FeedbackMessageDraft::count());

        $action->send($again, $actor);
        $action->send($other, $actor);
        $this->assertSame('第一則改寫 v2', $first->refresh()->body);
        $this->assertSame('第二則改寫', $second->refresh()->body);
        $this->assertSame(2, FeedbackMessage::count());
    }

    public function test_text_that_only_appears_inside_the_draft_is_still_appended(): void
    {
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner();

        $action->create($this->report, $actor, '好的，第三題已修正');
        $draft = $action->create($this->report, $actor, '好的');

        $this->assertSame("好的，第三題已修正\n\n好的", $draft->body);
    }

    public function test_attachments_over_the_per_message_limit_go_to_another_new_draft(): void
    {
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner();

        $first = $action->create($this->report, $actor, '第一段', images: $this->images(3));
        $second = $action->create($this->report, $actor, '第二段', images: $this->images(3));
        $third = $action->create($this->report, $actor, '第三段', images: $this->images(2));

        $this->assertNotSame($first->id, $second->id);
        $this->assertSame($first->id, $third->id);
        $this->assertCount(5, $third->attachmentList());
        $this->assertSame("第一段\n\n第三段", $third->body);
        $this->assertCount(3, $second->refresh()->attachmentList());
        $this->assertSame('第二段', $second->body);
    }

    public function test_rewrite_draft_rejects_attachments_over_the_limit_and_keeps_no_files(): void
    {
        $action = app(ManageFeedbackMessageDraftAction::class);
        $actor = FeedbackActor::sharedOwner();
        $old = $this->teamMessage('舊留言');
        $draft = $action->create($this->report, $actor, '改寫 v1', $old->id, $this->images(3));

        try {
            $action->create($this->report, $actor, '改寫 v2', $old->id, $this->images(3));
            $this->fail('附件超過上限應該擋下');
        } catch (FeedbackServiceException $exception) {
            $this->assertSame('too_many_attachments', $exception->errorCode);
        }

        $this->assertSame('改寫 v1', $draft->refresh()->body);
        $this->assertCount(3, $draft->attachmentList());
        $this->assertSame(1, FeedbackMessageDraft::count());
        $this->assertCount(3, Storage::disk('local')->allFiles());
    }

    public function test_deleting_the_report_removes_its_drafts(): void
    {
        $draft = $this->draft();

        $this->report->delete();

        $this->assertModelMissing($draft);
    }

    private function teamMessage(string $body): FeedbackMessage
    {
        return FeedbackMessage::factory()->for($this->report)->create(['author_type' => FeedbackAuthorType::Owner, 'body' => $body]);
    }

    /**
     * @return list<UploadedFile>
     */
    private function images(int $count): array
    {
        return array_map(fn (int $index): UploadedFile => UploadedFile::fake()->createWithContent("shot{$index}.png", base64_decode(self::PNG)), range(1, $count));
    }

    private function draft(): FeedbackMessageDraft
    {
        $this->artisan('feedback:draft', ['project' => 'site', 'report' => $this->report->public_id, '--text' => self::DRAFT_TEXT, '--agent' => 'Claude Code'])
            ->assertSuccessful();

        return FeedbackMessageDraft::sole();
    }

    private function pngFile(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'fd').'.png';
        file_put_contents($path, base64_decode(self::PNG));

        return $path;
    }

    private function clientUnread(): int
    {
        return FeedbackReport::query()->whereKey($this->report->id)->withClientNewReplyCount(null)->sole()->unreadCountFor(false);
    }

    private function actingAsTeam(): void
    {
        $this->resetSession();
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsDeveloper(string $username, string $password): void
    {
        $this->resetSession();
        $this->post(route('feedback.login.store', $this->project), compact('username', 'password'))->assertRedirect();
    }

    private function actingAsClient(): void
    {
        $this->resetSession();
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function resetSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        $this->app['cookie']->flushQueuedCookies();
    }
}
