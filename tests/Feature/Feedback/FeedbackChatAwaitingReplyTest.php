<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 右下角對話面板的「未回覆／已回覆」：未回覆＝對方最後發言、自己還沒回（已完成的單不算）。
 * 沒有留言的單以開單的人當最後發言者。待審留言草稿不算回覆，也不出現在客戶端。
 */
class FeedbackChatAwaitingReplyTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
    }

    public function test_each_side_sees_awaiting_reply_from_its_own_point_of_view(): void
    {
        $clientSpokeLast = $this->report('老師最後發言');
        $this->message($clientSpokeLast, FeedbackAuthorType::Owner, now()->subMinutes(20));
        $this->message($clientSpokeLast, FeedbackAuthorType::Reporter, now()->subMinutes(10));
        $teamSpokeLast = $this->report('團隊最後發言');
        $this->message($teamSpokeLast, FeedbackAuthorType::Reporter, now()->subMinutes(20));
        $this->message($teamSpokeLast, FeedbackAuthorType::Agent, now()->subMinutes(10));
        $fresh = $this->report('老師剛開單沒留言');
        $completed = $this->report('已完成但老師最後說謝謝', ['status' => FeedbackReportStatus::Completed]);
        $this->message($completed, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        $draftOnly = $this->report('老師問了、團隊只有草稿');
        $this->message($draftOnly, FeedbackAuthorType::Reporter, now()->subMinutes(5));
        FeedbackMessageDraft::create(['feedback_report_id' => $draftOnly->id, 'author_name' => '開發團隊', 'body' => '草稿不外流']);

        $this->actingAsOwner();
        $owner = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $ownerAwaiting = $this->awaitingTitles($owner->json('items'));
        $this->assertEqualsCanonicalizing(['老師最後發言', '老師剛開單沒留言', '老師問了、團隊只有草稿'], $ownerAwaiting);
        $this->assertSame(3, $owner->json('awaiting_total'));

        $this->actingAsClient();
        $client = $this->getJson(route('feedback.conversations.index', $this->project))->assertOk();
        $this->assertSame(['團隊最後發言'], $this->awaitingTitles($client->json('items')));
        $this->assertSame(1, $client->json('awaiting_total'));
        $this->assertStringNotContainsString('草稿不外流', $client->getContent());
    }

    public function test_team_created_report_without_messages_is_not_awaiting_the_team(): void
    {
        $this->report('團隊開給老師的單', ['creator_type' => FeedbackCreatorType::OwnerShared, 'shared_with_client' => true]);

        $this->actingAsOwner();
        $this->assertSame(0, $this->getJson(route('feedback.conversations.index', $this->project))->json('awaiting_total'));

        $this->actingAsClient();
        $this->assertSame(1, $this->getJson(route('feedback.conversations.index', $this->project))->json('awaiting_total'));
    }

    public function test_panel_markup_has_awaiting_and_replied_tabs(): void
    {
        $this->actingAsOwner();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-chat-tab="awaiting"', false)
            ->assertSee('data-chat-tab="replied"', false)
            ->assertSee('未回覆')
            ->assertSee('已回覆');
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return list<string>
     */
    private function awaitingTitles(array $items): array
    {
        return array_values(array_map(fn (array $item): string => $item['title'], array_filter($items, fn (array $item): bool => $item['awaiting_reply'] === true)));
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function report(string $title, array $attributes = []): FeedbackReport
    {
        return FeedbackReport::factory()->for($this->project)->create([
            'title' => $title,
            'creator_type' => FeedbackCreatorType::Client,
            ...$attributes,
        ]);
    }

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at): void
    {
        $message = $report->feedbackMessages()->create(['author_type' => $author, 'author_name' => $author->label(), 'body' => '留言']);
        $message->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
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
