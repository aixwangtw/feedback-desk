<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 問題清單與看板的預設排序：與右下角留言對話面板相同的三段規則。
 */
class FeedbackPortalDefaultSortTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
    }

    public function test_owner_list_defaults_to_unread_then_read_threads_then_reports_without_messages(): void
    {
        $this->seedOwnerScenario();
        $this->actingAsOwner();

        $expected = ['剛收到的未讀', '上個月的未讀', '昨天聊過', '很久以前聊過', '剛建立還沒留言', '上週建立還沒留言'];
        $this->assertSame($expected, $this->listTitles($this->get(route('feedback.portal', $this->project))->assertOk()->getContent()));

        // 與右下角對話面板的順序一致。
        $this->assertSame($expected, array_column($this->getJson(route('feedback.conversations.index', $this->project))->json('items'), 'title'));
    }

    public function test_owner_list_reorders_after_a_conversation_is_read_on_the_next_load(): void
    {
        $reports = $this->seedOwnerScenario();
        $this->actingAsOwner();

        $this->getJson(route('feedback.conversations.show', [$this->project, $reports['上個月的未讀']]))->assertOk();

        $this->assertSame(
            ['剛收到的未讀', '昨天聊過', '上個月的未讀', '很久以前聊過', '剛建立還沒留言', '上週建立還沒留言'],
            $this->listTitles($this->get(route('feedback.portal', $this->project))->getContent()),
        );
    }

    public function test_client_list_unread_tier_counts_only_messages_not_adjustment_updates(): void
    {
        $this->report('剛建立還沒留言', now()->subMinutes(5));
        $readThread = $this->report('老師自己問過', now()->subMonth());
        $this->message($readThread, FeedbackAuthorType::Reporter, now()->subDays(10));
        $replied = $this->report('開發者剛回覆', now()->subMonths(2));
        $this->message($replied, FeedbackAuthorType::Owner, now()->subDays(15));
        $this->report('調整重點更新但沒留言', now()->subMonths(3), ['adjustment_note' => '改好了', 'adjustment_updated_at' => now()->subMinutes(10)]);
        $this->report('更早建立還沒留言', now()->subWeek());
        // 開發者自己建的單不會出現在客戶端。
        $this->report('開發者自己的單', now(), ['creator_type' => FeedbackCreatorType::OwnerShared]);
        $this->actingAsClient();

        // 調整重點更新不算未讀，沒留言的單照建立時間排在最後段。
        $expected = ['開發者剛回覆', '老師自己問過', '剛建立還沒留言', '更早建立還沒留言', '調整重點更新但沒留言'];
        $this->assertSame($expected, $this->listTitles($this->get(route('feedback.portal', $this->project))->assertOk()->getContent()));
        $this->assertSame($expected, array_column($this->getJson(route('feedback.conversations.index', $this->project))->json('items'), 'title'));
    }

    public function test_board_columns_use_the_same_order_within_each_status(): void
    {
        $this->report('待處理沒留言', now()->subMinutes(5));
        $unread = $this->report('待處理有未讀', now()->subMonths(2), ['owner_last_read_at' => now()->subMonths(2)]);
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subDays(3));
        $read = $this->report('待處理已讀', now()->subMonth());
        $this->message($read, FeedbackAuthorType::Reporter, now()->subDays(20));
        $this->report('待審核沒留言', now()->subDay(), ['status' => FeedbackReportStatus::NeedsInput]);
        $needsInput = $this->report('待審核已讀', now()->subMonths(4), ['status' => FeedbackReportStatus::NeedsInput]);
        $this->message($needsInput, FeedbackAuthorType::Owner, now()->subDays(2));
        $this->actingAsOwner();

        $html = $this->get(route('feedback.portal', [$this->project, 'view' => 'board']))->assertOk()->getContent();

        $this->assertSame(['待處理有未讀', '待處理已讀', '待處理沒留言'], $this->boardTitles($html, FeedbackReportStatus::New));
        $this->assertSame(['待審核已讀', '待審核沒留言'], $this->boardTitles($html, FeedbackReportStatus::NeedsInput));
    }

    public function test_manual_column_sort_still_overrides_the_default(): void
    {
        $this->seedOwnerScenario();
        $this->actingAsOwner();

        $byTitle = $this->listTitles($this->get(route('feedback.portal', [$this->project, 'sort' => 'title', 'direction' => 'asc']))->getContent());
        $sortedTitles = $byTitle;
        sort($sortedTitles);
        $this->assertSame($sortedTitles, $byTitle);

        $this->assertSame(
            ['剛建立還沒留言', '上週建立還沒留言', '很久以前聊過', '昨天聊過', '上個月的未讀', '剛收到的未讀'],
            $this->listTitles($this->get(route('feedback.portal', [$this->project, 'sort' => 'created_at', 'direction' => 'desc']))->getContent()),
        );

        $this->get(route('feedback.portal', [$this->project, 'sort' => 'title', 'direction' => 'asc']))
            ->assertSee('data-sort-reset', false)
            ->assertSee('恢復預設排序');
    }

    public function test_default_sort_has_no_separate_latest_message_option(): void
    {
        $this->seedOwnerScenario();
        $this->actingAsOwner();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertDontSee('依最新留言時間排序')
            ->assertDontSee('value="latest_message_at"', false)
            ->assertDontSee('data-sort-reset', false)
            ->assertSee('<option value="conversation" selected>預設（新留言優先）</option>', false);

        // 舊網址的 latest_message_at 併入預設排序。
        $this->assertSame(
            ['剛收到的未讀', '上個月的未讀', '昨天聊過', '很久以前聊過', '剛建立還沒留言', '上週建立還沒留言'],
            $this->listTitles($this->get(route('feedback.portal', [$this->project, 'sort' => 'latest_message_at', 'direction' => 'asc']))->getContent()),
        );
    }

    public function test_same_time_falls_back_to_newer_number_first(): void
    {
        $createdAt = now()->subDay();
        $this->report('同時建立的第一張', $createdAt);
        $this->report('同時建立的第二張', $createdAt);
        $this->actingAsOwner();

        $this->assertSame(['同時建立的第二張', '同時建立的第一張'], $this->listTitles($this->get(route('feedback.portal', $this->project))->getContent()));
        $this->assertSame(
            ['同時建立的第二張', '同時建立的第一張'],
            array_column($this->getJson(route('feedback.conversations.index', $this->project))->json('items'), 'title'),
        );
    }

    public function test_default_order_spans_pages(): void
    {
        foreach (range(1, 50) as $index) {
            $this->report("沒留言 {$index}", now()->subMinutes($index));
        }
        $unread = $this->report('一年前的未讀', now()->subYear(), ['owner_last_read_at' => now()->subYear()]);
        $this->message($unread, FeedbackAuthorType::Reporter, now()->subMonths(6));
        $this->actingAsOwner();

        $firstPage = $this->listTitles($this->get(route('feedback.portal', $this->project))->getContent());
        $this->assertCount(50, $firstPage);
        $this->assertSame('一年前的未讀', $firstPage[0]);
        $this->assertSame('沒留言 49', $firstPage[49]);

        $this->assertSame(['沒留言 50'], $this->listTitles($this->get(route('feedback.portal', [$this->project, 'page' => 2]))->getContent()));
    }

    public function test_owner_default_puts_pending_first_then_needs_input_then_completed(): void
    {
        $this->seedStatusScenario();
        $this->actingAsOwner();

        $this->assertSame(
            ['待處理新', '待處理舊', '待審核新', '待審核舊', '已完成新'],
            $this->listTitles($this->get(route('feedback.portal', $this->project))->assertOk()->getContent()),
        );
    }

    public function test_client_default_puts_needs_input_first_then_pending_then_completed(): void
    {
        $this->seedStatusScenario();
        $this->actingAsClient();

        $this->assertSame(
            ['待審核新', '待審核舊', '待處理新', '待處理舊', '已完成新'],
            $this->listTitles($this->get(route('feedback.portal', $this->project))->assertOk()->getContent()),
        );
    }

    public function test_manual_sort_ignores_status_groups(): void
    {
        $this->seedStatusScenario();
        $this->actingAsOwner();

        $this->assertSame(
            ['已完成新', '待審核新', '待處理新', '待審核舊', '待處理舊'],
            $this->listTitles($this->get(route('feedback.portal', [$this->project, 'sort' => 'created_at', 'direction' => 'desc']))->getContent()),
        );
    }

    private function seedStatusScenario(): void
    {
        $this->report('待處理舊', now()->subDays(5));
        $this->report('待審核舊', now()->subDays(4), ['status' => FeedbackReportStatus::NeedsInput]);
        $this->report('待處理新', now()->subDays(3));
        $this->report('待審核新', now()->subDays(2), ['status' => FeedbackReportStatus::NeedsInput]);
        $this->report('已完成新', now()->subDay(), ['status' => FeedbackReportStatus::Completed]);
    }

    /**
     * @return array<string, FeedbackReport>
     */
    private function seedOwnerScenario(): array
    {
        $reports = [
            '剛建立還沒留言' => $this->report('剛建立還沒留言', now()->subMinutes(5)),
            '上週建立還沒留言' => $this->report('上週建立還沒留言', now()->subWeek()),
            '很久以前聊過' => $this->report('很久以前聊過', now()->subMonths(2)),
            '昨天聊過' => $this->report('昨天聊過', now()->subMonths(3)),
            '上個月的未讀' => $this->report('上個月的未讀', now()->subMonths(4)),
            '剛收到的未讀' => $this->report('剛收到的未讀', now()->subMonths(5)),
        ];
        $this->message($reports['很久以前聊過'], FeedbackAuthorType::Reporter, now()->subMonth());
        $reports['很久以前聊過']->update(['owner_last_read_at' => now()->subWeeks(3)]);
        $this->message($reports['昨天聊過'], FeedbackAuthorType::Reporter, now()->subDay());
        $reports['昨天聊過']->update(['owner_last_read_at' => now()->subHours(20)]);
        $this->message($reports['上個月的未讀'], FeedbackAuthorType::Reporter, now()->subDays(20));
        $this->message($reports['剛收到的未讀'], FeedbackAuthorType::Reporter, now()->subHour());

        return $reports;
    }

    /**
     * @return list<string>
     */
    private function listTitles(string $html): array
    {
        preg_match_all('/data-report-row="([^"]+)"/', $html, $matches);

        return $this->titlesFor($matches[1]);
    }

    /**
     * @return list<string>
     */
    private function boardTitles(string $html, FeedbackReportStatus $status): array
    {
        $start = strpos($html, 'data-kanban-list data-status="'.$status->value.'"');
        $this->assertNotFalse($start);
        $end = strpos($html, 'data-kanban-column', $start);
        $column = substr($html, $start, $end === false ? null : $end - $start);
        preg_match_all('/data-kanban-card data-report-id="([^"]+)"/', $column, $matches);

        return $this->titlesFor($matches[1]);
    }

    /**
     * @param  list<string>  $publicIds
     * @return list<string>
     */
    private function titlesFor(array $publicIds): array
    {
        $titles = FeedbackReport::query()->whereIn('public_id', $publicIds)->pluck('title', 'public_id');

        return array_map(fn (string $publicId): string => $titles[$publicId], $publicIds);
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

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at): FeedbackMessage
    {
        return FeedbackMessage::factory()->for($report)->create([
            'author_type' => $author,
            'body' => '留言內容',
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
