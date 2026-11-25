<?php

namespace Tests\Feature\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Actions\MergeFeedbackReportAction;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Models\FeedbackReportEvent;
use App\Support\FeedbackActor;
use App\Support\FeedbackAlbum;
use App\Support\FeedbackServiceException;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackMergeDuplicateReportsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private string $clientToken;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Queue::fake();
        config()->set('feedback.automation.enabled', true);
        $this->clientToken = Str::random(48);
        $this->ownerToken = Str::random(48);
        $this->project = FeedbackProject::factory()->create([
            'automation_enabled' => true,
            'client_token_hash' => hash('sha256', $this->clientToken),
            'owner_token_hash' => hash('sha256', $this->ownerToken),
        ]);
    }

    public function test_merge_moves_drafts_hides_duplicate_and_records_events_on_both(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['created_at' => now()->subMinute()]);
        $duplicate = FeedbackReport::factory()->for($this->project)->create();
        $message = FeedbackMessage::factory()->for($duplicate)->create(['body' => '原單的留言']);
        $draft = FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'author_name' => 'Alex', 'body' => '還沒送出的回覆']);
        $rewrite = FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'replaces_message_id' => $message->id, 'author_name' => 'Alex', 'body' => '改寫原單留言']);

        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $duplicate->refresh();
        $this->assertSame($target->id, $duplicate->merged_into_report_id);
        $this->assertTrue($duplicate->mergedInto->is($target));
        $this->assertNotNull($duplicate->client_deleted_at);
        $this->assertSame($target->id, $draft->refresh()->feedback_report_id);
        $this->assertSame($target->id, $rewrite->refresh()->feedback_report_id);
        $this->assertNull($rewrite->replaces_message_id);
        $this->assertSame($duplicate->id, $message->refresh()->feedback_report_id);

        $duplicateEvent = $duplicate->events()->where('kind', 'merged')->sole();
        $targetEvent = $target->events()->where('kind', 'merged')->sole();
        $this->assertSame("合併到編號 2（{$target->public_id}）", $duplicateEvent->detail);
        $this->assertSame("編號 1（{$duplicate->public_id}）併入這張", $targetEvent->detail);
        $this->assertSame('合併重複的單', FeedbackReportEvent::labelFor('merged'));
    }

    public function test_merged_report_is_hidden_from_client_lists_and_counts(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['title' => '保留的單']);
        $duplicate = FeedbackReport::factory()->for($this->project)->create(['title' => '重複的單']);
        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $this->actingAsTeacher();
        $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))
            ->assertOk()
            ->assertSee('保留的單')
            ->assertDontSee('重複的單')
            ->assertSee('共 1 題');
        $this->get(route('feedback.reports.show', [$this->project, $duplicate]))->assertNotFound();
        $this->getJson(route('feedback.conversations.index', $this->project))
            ->assertOk()
            ->assertDontSee($duplicate->public_id);
    }

    public function test_merge_rejects_invalid_targets(): void
    {
        $merge = app(MergeFeedbackReportAction::class);
        $actor = FeedbackActor::sharedOwner();
        $report = FeedbackReport::factory()->for($this->project)->create();
        $otherProject = FeedbackReport::factory()->create();
        $deleted = FeedbackReport::factory()->for($this->project)->create(['client_deleted_at' => now()]);
        $keeper = FeedbackReport::factory()->for($this->project)->create();
        $merged = FeedbackReport::factory()->for($this->project)->create(['merged_into_report_id' => $keeper->id, 'client_deleted_at' => now()]);

        $cases = [
            'merge_into_self' => [$report, $report],
            'merge_cross_project' => [$report, $otherProject],
            'target_deleted' => [$report, $deleted],
            'target_merged' => [$report, $merged],
            'already_merged' => [$merged, $report],
        ];

        foreach ($cases as $code => [$duplicate, $target]) {
            try {
                $merge->handle($duplicate, $target, $actor);
                $this->fail("應該擋下 {$code}");
            } catch (FeedbackServiceException $exception) {
                $this->assertSame($code, $exception->errorCode);
                $this->assertNotSame('', $exception->getMessage());
            }
        }

        $this->assertNull($report->refresh()->merged_into_report_id);
        $this->assertNull($report->client_deleted_at);
    }

    public function test_same_client_submitting_same_content_within_thirty_minutes_is_merged_without_automation(): void
    {
        $account = FeedbackClientAccount::factory()->for($this->project)->create();
        $first = $this->createAsClient($account, ' 儲存失敗 ', "按了沒反應\n");
        Queue::assertPushed(ResolveFeedbackReport::class, 1);

        $this->travel(29)->minutes();
        $created = $this->createAsClient($account, '儲存失敗', '按了沒反應');

        $this->assertTrue($created['merged_into']->is($first['report']));
        $this->assertSame($first['report']->id, $created['report']->merged_into_report_id);
        $this->assertNotNull($created['report']->client_deleted_at);
        $this->assertNull($first['report']->refresh()->merged_into_report_id);
        Queue::assertPushed(ResolveFeedbackReport::class, 1);
        $this->assertSame(0, $created['report']->automationRuns()->count());
        $this->assertSame(1, $created['report']->events()->where('kind', 'merged')->count());
    }

    public function test_shared_client_link_without_account_is_not_treated_as_the_same_person(): void
    {
        // 共用連結登入沒有帳號，可能是不同人，不自動合併。
        $this->actingAsTeacher();
        $issue = ['title' => '圖片不見', 'description' => '第三題的圖沒有顯示'];

        $this->post(route('feedback.reports.store', $this->project), ['issues' => [$issue]])->assertSessionHas('success', '已新增 1 個問題。');
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [$issue]])->assertSessionHas('success', '已新增 1 個問題。');

        $this->assertSame(2, FeedbackReport::whereNull('merged_into_report_id')->count());
        Queue::assertPushed(ResolveFeedbackReport::class, 2);
    }

    public function test_auto_merge_moves_original_attachments_to_the_kept_report(): void
    {
        $account = FeedbackClientAccount::factory()->for($this->project)->create();
        $first = $this->createAsClient($account, '儲存失敗', '按了沒反應', [$this->png('a.png')]);
        $created = $this->createAsClient($account, '儲存失敗', '按了沒反應', [$this->png('b.png'), $this->png('c.png')]);

        $kept = $first['report'];
        $this->assertTrue($created['merged_into']->is($kept));
        $this->assertSame(0, $created['report']->feedbackAttachments()->count());
        $this->assertSame(3, $kept->feedbackAttachments()->count());
        $this->assertSame(['圖1', '圖2', '圖3'], app(FeedbackAlbum::class)->items($kept->refresh(), false)->pluck('name')->all());
        $this->assertStringEndsWith('，搬來 2 個原始附件', $kept->events()->where('kind', 'merged')->sole()->detail);

        $this->actingAsTeacher();
        foreach ($kept->feedbackAttachments as $attachment) {
            $this->get(route('feedback.attachments.show', [$this->project, $kept, $attachment]))->assertOk();
        }
    }

    public function test_does_not_auto_merge_into_a_completed_report(): void
    {
        $account = FeedbackClientAccount::factory()->for($this->project)->create();
        $first = $this->createAsClient($account, '標題', '說明');
        $first['report']->update(['status' => FeedbackReportStatus::Completed]);

        $created = $this->createAsClient($account, '標題', '說明');

        $this->assertNull($created['merged_into']);
        $this->assertNull($created['report']->refresh()->merged_into_report_id);
        $this->assertNull($created['report']->client_deleted_at);
    }

    public function test_client_report_cannot_be_merged_into_a_report_the_client_cannot_see(): void
    {
        $merge = app(MergeFeedbackReportAction::class);
        $actor = FeedbackActor::sharedOwner();
        $clientReport = FeedbackReport::factory()->for($this->project)->create();
        $hiddenTargets = [
            '團隊內部單' => FeedbackReport::factory()->for($this->project)->create(['creator_type' => FeedbackCreatorType::Developer, 'shared_with_client' => false]),
            '公開回報單' => FeedbackReport::factory()->for($this->project)->create(['creator_type' => FeedbackCreatorType::Public, 'creator_developer_id' => null]),
        ];

        foreach ($hiddenTargets as $label => $target) {
            try {
                $merge->handle($clientReport, $target, $actor);
                $this->fail("不應該併進{$label}");
            } catch (FeedbackServiceException $exception) {
                $this->assertSame('target_hidden_from_client', $exception->errorCode);
            }
        }
        $this->assertNull($clientReport->refresh()->merged_into_report_id);

        $shared = FeedbackReport::factory()->for($this->project)->create(['creator_type' => FeedbackCreatorType::Developer, 'shared_with_client' => true]);
        $merge->handle($clientReport, $shared, $actor);
        $this->assertSame($shared->id, $clientReport->refresh()->merged_into_report_id);

        // 團隊內部單併進客戶的單不受限。
        $internal = $hiddenTargets['團隊內部單'];
        $merge->handle($internal, $shared, $actor);
        $this->assertSame($shared->id, $internal->refresh()->merged_into_report_id);
    }

    public function test_manual_merge_joins_new_drafts_and_keeps_rewrites_separate(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['created_at' => now()->subMinute()]);
        $duplicate = FeedbackReport::factory()->for($this->project)->create();
        $message = FeedbackMessage::factory()->for($duplicate)->create(['author_type' => FeedbackAuthorType::Owner, 'body' => '原單留言']);
        $kept = FeedbackMessageDraft::create(['feedback_report_id' => $target->id, 'author_name' => 'Alex', 'body' => '保留單的草稿']);
        $moved = FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'author_name' => 'Alex', 'body' => '重複單的草稿']);
        $rewrite = FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'replaces_message_id' => $message->id, 'author_name' => 'Alex', 'body' => '改寫原單留言']);

        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $drafts = $target->messageDrafts()->orderBy('id')->get();
        $this->assertCount(2, $drafts);
        $this->assertTrue($drafts[0]->is($kept));
        $this->assertSame("保留單的草稿\n\n重複單的草稿", $drafts[0]->body);
        $this->assertNull($moved->fresh());
        $this->assertTrue($drafts[1]->is($rewrite));
        $this->assertNull($drafts[1]->replaces_message_id);
        $this->assertSame('改寫原單留言', $drafts[1]->body);
        $this->assertSame('原單留言', $message->refresh()->body);
    }

    public function test_manual_merge_keeps_a_moved_draft_separate_when_attachments_would_exceed_the_limit(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['created_at' => now()->subMinute()]);
        $duplicate = FeedbackReport::factory()->for($this->project)->create();
        $file = ['disk' => 'local', 'path' => 'x.png', 'original_name' => 'x.png', 'mime_type' => 'image/png', 'size' => 1];
        FeedbackMessageDraft::create(['feedback_report_id' => $target->id, 'author_name' => 'Alex', 'body' => '保留單', 'attachments' => array_fill(0, 3, $file)]);
        $moved = FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'author_name' => 'Alex', 'body' => '重複單', 'attachments' => array_fill(0, 3, $file)]);

        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $this->assertSame(2, $target->messageDrafts()->count());
        $this->assertSame($target->id, $moved->refresh()->feedback_report_id);
        $this->assertSame('重複單', $moved->body);
    }

    public function test_reports_that_should_not_be_merged(): void
    {
        $alice = FeedbackClientAccount::factory()->for($this->project)->create();
        $bob = FeedbackClientAccount::factory()->for($this->project)->create();
        $create = app(CreateFeedbackReportAction::class);

        $this->createAsClient($alice, '同一個標題', '同一段說明');
        $this->assertNull($this->createAsClient($bob, '同一個標題', '同一段說明')['merged_into'], '不同人不合併');
        $this->assertNull($this->createAsClient($alice, '同一個標題', '不一樣的說明')['merged_into'], '說明不同不合併');
        $this->assertNull($this->createAsClient($alice, '不一樣的標題', '同一段說明')['merged_into'], '標題不同不合併');

        $public = ['creator_type' => FeedbackCreatorType::Public, 'creator_developer_id' => null];
        $create->handle($this->project, ['title' => '公開回報', 'description' => '同內容'], $public);
        $this->assertNull($create->handle($this->project, ['title' => '公開回報', 'description' => '同內容'], $public)['merged_into'], '公開回報不合併');

        $team = ['creator_type' => FeedbackCreatorType::OwnerShared, 'creator_developer_id' => null];
        $create->handle($this->project, ['title' => '團隊開的單', 'description' => '同內容'], $team, FeedbackActor::sharedOwner());
        $this->assertNull($create->handle($this->project, ['title' => '團隊開的單', 'description' => '同內容'], $team, FeedbackActor::sharedOwner())['merged_into'], '團隊的單不合併');

        $this->travel(31)->minutes();
        $this->assertNull($this->createAsClient($alice, '同一個標題', '同一段說明')['merged_into'], '超過 30 分鐘不合併');

        $this->assertSame(0, FeedbackReport::whereNotNull('merged_into_report_id')->count());
    }

    public function test_does_not_merge_into_deleted_report(): void
    {
        $account = FeedbackClientAccount::factory()->for($this->project)->create();
        $first = $this->createAsClient($account, '標題', '說明');
        $first['report']->update(['client_deleted_at' => now()]);

        $this->assertNull($this->createAsClient($account, '標題', '說明')['merged_into']);
    }

    public function test_merge_command_resolves_numbers_and_public_ids(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['title' => '保留的單', 'created_at' => now()->subMinute()]);
        $duplicate = FeedbackReport::factory()->for($this->project)->create(['title' => '重複的單']);
        FeedbackMessageDraft::create(['feedback_report_id' => $duplicate->id, 'author_name' => 'Alex', 'body' => '草稿']);

        $this->artisan('feedback:merge', ['project' => $this->project->slug, 'duplicate' => '1', 'target' => $target->public_id])
            ->expectsOutputToContain('已合併重複的單')
            ->expectsOutputToContain('重複的單')
            ->expectsOutputToContain('保留的單')
            ->assertSuccessful();

        $this->assertSame($target->id, $duplicate->refresh()->merged_into_report_id);
        $this->assertSame(1, $target->messageDrafts()->count());

        $this->artisan('feedback:merge', ['project' => $this->project->slug, 'duplicate' => $target->public_id, 'target' => $duplicate->public_id])
            ->expectsOutputToContain('目標單已經合併到別張單')
            ->assertFailed();
        $this->artisan('feedback:merge', ['project' => $this->project->slug, 'duplicate' => '9', 'target' => '1'])
            ->expectsOutputToContain('找不到要併掉的回饋單')
            ->assertFailed();
        $this->artisan('feedback:merge', ['project' => 'no-such-project', 'duplicate' => '1', 'target' => '2'])
            ->expectsOutputToContain('找不到回報專案')
            ->assertFailed();
    }

    public function test_team_sees_merged_into_link_on_the_merged_report(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create(['created_at' => now()->subMinute()]);
        $duplicate = FeedbackReport::factory()->for($this->project)->create();
        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $this->actingAsEngineer();
        $this->get(route('feedback.reports.show', [$this->project, $duplicate]))
            ->assertOk()
            ->assertSee('已合併到編號 2')
            ->assertSee('href="'.route('feedback.reports.show', [$this->project, $target]).'"', false)
            ->assertSee('data-merged-into="'.$target->public_id.'"', false)
            ->assertDontSee('ring-slate-300">'.$this->project->clientRole().'已刪除</span>', false);

        $this->get(route('feedback.reports.show', [$this->project, $target]))
            ->assertOk()
            ->assertDontSee('已合併到編號');
    }

    public function test_restoring_a_merged_report_clears_the_merge(): void
    {
        $target = FeedbackReport::factory()->for($this->project)->create();
        $duplicate = FeedbackReport::factory()->for($this->project)->create();
        app(MergeFeedbackReportAction::class)->handle($duplicate, $target, FeedbackActor::sharedOwner());

        $this->actingAsEngineer();
        $this->patch(route('feedback.reports.restore', [$this->project, $duplicate]))->assertRedirect();

        $this->assertNull($duplicate->refresh()->merged_into_report_id);
        $this->assertNull($duplicate->client_deleted_at);
    }

    public function test_both_list_pages_explain_auto_merge(): void
    {
        $guide = '同一個帳號 30 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張，附件一起搬過去；先送出的那張已完成就不合併）。';
        $this->assertSame($guide, MergeFeedbackReportAction::AUTO_MERGE_GUIDE);

        $this->actingAsTeacher();
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-merge-guide', false)->assertSee($guide);

        $this->flushSession();
        app('cookie')->flushQueuedCookies();
        $this->actingAsEngineer();
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-merge-guide', false)->assertSee($guide);
    }

    /**
     * @param  list<UploadedFile>  $screenshots
     * @return array{report: FeedbackReport, reporter_token: string, merged_into: FeedbackReport|null}
     */
    private function createAsClient(FeedbackClientAccount $account, string $title, string $description, array $screenshots = []): array
    {
        return app(CreateFeedbackReportAction::class)->handle(
            $this->project,
            ['title' => $title, 'description' => $description, 'screenshots' => $screenshots],
            ['creator_type' => FeedbackCreatorType::Client, 'creator_developer_id' => null, 'creator_client_account_id' => $account->id],
            FeedbackActor::client($account),
        );
    }

    private function png(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='));
    }

    private function actingAsTeacher(): void
    {
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$this->clientToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsEngineer(): void
    {
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }
}
