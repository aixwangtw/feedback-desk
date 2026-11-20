<?php

namespace Tests\Feature\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Actions\MergeFeedbackReportAction;
use App\Enums\FeedbackCreatorType;
use App\Jobs\ResolveFeedbackReport;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Models\FeedbackReportEvent;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
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

    public function test_shared_client_link_without_account_counts_as_the_same_person(): void
    {
        $this->actingAsTeacher();
        $issue = ['title' => '圖片不見', 'description' => '第三題的圖沒有顯示'];

        $this->post(route('feedback.reports.store', $this->project), ['issues' => [$issue]])->assertSessionHas('success', '已新增 1 個問題。');
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [$issue]])
            ->assertSessionHas('success', '這次送出的內容和剛才送出的單一樣，已自動合併成一張。');

        $this->assertSame(2, FeedbackReport::count());
        $this->assertSame(1, FeedbackReport::whereNull('merged_into_report_id')->count());
        Queue::assertPushed(ResolveFeedbackReport::class, 1);
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
        $guide = '同一個人 30 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張）。';
        $this->assertSame($guide, MergeFeedbackReportAction::AUTO_MERGE_GUIDE);

        $this->actingAsTeacher();
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-merge-guide', false)->assertSee($guide);

        $this->flushSession();
        app('cookie')->flushQueuedCookies();
        $this->actingAsEngineer();
        $this->get(route('feedback.portal', $this->project))->assertOk()->assertSee('data-merge-guide', false)->assertSee($guide);
    }

    /**
     * @return array{report: FeedbackReport, reporter_token: string, merged_into: FeedbackReport|null}
     */
    private function createAsClient(FeedbackClientAccount $account, string $title, string $description): array
    {
        return app(CreateFeedbackReportAction::class)->handle(
            $this->project,
            ['title' => $title, 'description' => $description],
            ['creator_type' => FeedbackCreatorType::Client, 'creator_developer_id' => null, 'creator_client_account_id' => $account->id],
            FeedbackActor::client($account),
        );
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
