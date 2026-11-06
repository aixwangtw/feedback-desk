<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 清單與看板上明顯的「N 則未讀」標記，以及頁首通知鈴鐺。
 * 鈴鐺只列對方發的新留言：客戶端看到開發團隊的新留言，開發團隊看到客戶的新留言；待審留言只在團隊端另列。
 */
class FeedbackUnreadIndicatorsTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create(['name' => '甲站', 'slug' => 'site-a']);
    }

    public function test_team_list_and_board_show_unread_count_flag_and_no_extra_status(): void
    {
        $waiting = $this->report('客戶等回覆的單');
        $this->message($waiting, FeedbackAuthorType::Owner, now()->subMinutes(30), '我們先回一次');
        $this->message($waiting, FeedbackAuthorType::Reporter, now()->subMinutes(20), '第一則');
        $this->message($waiting, FeedbackAuthorType::Reporter, now()->subMinutes(10), '第二則');
        $this->message($waiting, FeedbackAuthorType::Reporter, now()->subMinutes(5), '第三則');
        $answered = $this->report('已回覆的單');
        $this->message($answered, FeedbackAuthorType::Reporter, now()->subMinutes(20), '問題');
        $this->message($answered, FeedbackAuthorType::Owner, now()->subMinutes(10), '已處理');
        $answered->update(['owner_last_read_at' => now()]);

        $this->actingAsTeam();

        foreach ([[], ['view' => 'board'], ['sort' => 'created_at']] as $query) {
            $html = $this->get(route('feedback.portal', [$this->project, ...$query]))->assertOk()->getContent();
            // 未讀是標題右邊的小圓點數字，不是標題旁的標籤或按鈕。
            $slot = Str::between($html, 'data-unread-slot="'.$waiting->public_id.'"', '</span></span>');
            $this->assertStringContainsString('data-unread-dot', $slot);
            $this->assertStringContainsString('>3</span', $slot.'</span');
            $this->assertStringNotContainsString('data-unread-flag', $html);
            $this->assertStringNotContainsString('3 則未讀</button>', $html);
            // 不新增「待回覆」標示：狀態只有待處理、待審核、已完成。
            $this->assertStringNotContainsString('待回覆', $html);
            $this->assertStringNotContainsString('data-unread-slot="'.$answered->public_id.'"><span', $html);
        }
    }

    public function test_client_list_shows_unread_team_replies(): void
    {
        $report = $this->report('老師的單');
        $this->message($report, FeedbackAuthorType::Reporter, now()->subMinutes(20), '老師問');
        $this->message($report, FeedbackAuthorType::Owner, now()->subMinutes(10), '團隊回覆一');
        $this->message($report, FeedbackAuthorType::Agent, now()->subMinutes(5), '團隊回覆二');

        $this->actingAsClient();

        $html = $this->get(route('feedback.portal', [$this->project, 'tab' => 'all']))->assertOk()->getContent();
        $slot = Str::between($html, 'data-unread-slot="'.$report->public_id.'"', '</span></span>');
        $this->assertStringContainsString('data-unread-dot', $slot);
        $this->assertStringContainsString('>2</span', $slot.'</span');
        $this->assertStringNotContainsString('待回覆', $html);
    }

    public function test_team_bell_lists_only_client_messages_across_projects_and_drafts_separately(): void
    {
        $other = FeedbackProject::factory()->create(['name' => '乙站', 'slug' => 'site-b']);
        $a = $this->report('甲站的單');
        $this->message($a, FeedbackAuthorType::Reporter, now()->subMinutes(20), '老師較早的留言');
        $this->message($a, FeedbackAuthorType::Reporter, now()->subMinutes(10), '老師最新的留言');
        $this->message($a, FeedbackAuthorType::Owner, now()->subMinutes(5), '團隊自己的回覆不進團隊鈴鐺');
        $b = $this->report('乙站的單', $other);
        $this->message($b, FeedbackAuthorType::Reporter, now()->subMinutes(3), '乙站老師留言');
        $onlyTeam = $this->report('只有團隊留言的單');
        $this->message($onlyTeam, FeedbackAuthorType::Owner, now()->subMinutes(2), '團隊留言');
        FeedbackMessageDraft::create(['feedback_report_id' => $onlyTeam->id, 'author_name' => '開發團隊', 'body' => '草稿內容不外流']);

        $developer = FeedbackDeveloper::factory()->withPassword('dev-password-1')->create(['username' => 'dev']);
        $this->post(route('feedback.login.unified.store'), ['username' => 'dev', 'password' => 'dev-password-1'])->assertRedirect();

        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $bell = $this->bell($html);

        $this->assertStringContainsString('data-bell-count="3"', $bell);
        $this->assertStringContainsString('甲站的單', $bell);
        $this->assertStringContainsString('老師最新的留言', $bell);
        $this->assertStringNotContainsString('老師較早的留言', $bell);
        $this->assertStringNotContainsString('團隊自己的回覆不進團隊鈴鐺', $bell);
        $this->assertStringContainsString('乙站', $bell);
        $this->assertStringContainsString('乙站老師留言', $bell);
        $this->assertStringNotContainsString('data-bell-item="'.$onlyTeam->public_id.'"', $bell);
        $this->assertStringContainsString('待審留言 1', $bell);
        $this->assertStringContainsString('data-bell-draft="'.$onlyTeam->public_id.'"', $bell);
        $this->assertStringNotContainsString('草稿內容不外流', $bell);
        $this->assertStringContainsString(e(route('feedback.reports.show', [$this->project, $a], false)).'#conversation', $bell);
        $this->assertNotNull($developer);
    }

    public function test_client_bell_lists_only_team_replies_on_her_own_reports_and_never_drafts(): void
    {
        $mine = $this->report('老師的單');
        $this->message($mine, FeedbackAuthorType::Owner, now()->subMinutes(20), '團隊較早的回覆');
        $this->message($mine, FeedbackAuthorType::Agent, now()->subMinutes(10), '團隊最新的回覆');
        $this->message($mine, FeedbackAuthorType::Reporter, now()->subMinutes(5), '老師自己的留言不進老師鈴鐺');
        FeedbackMessageDraft::create(['feedback_report_id' => $mine->id, 'author_name' => '開發團隊', 'body' => '草稿內容不外流']);
        $teamOnly = $this->report('團隊內部單', creator: FeedbackCreatorType::Developer);
        $this->message($teamOnly, FeedbackAuthorType::Owner, now()->subMinutes(3), '內部留言');
        $quiet = $this->report('老師自己留言的單');
        $this->message($quiet, FeedbackAuthorType::Reporter, now()->subMinutes(3), '只有老師留言');

        $this->actingAsClient();
        $html = $this->get(route('feedback.portal', $this->project))->assertOk()->getContent();
        $bell = $this->bell($html);

        $this->assertStringContainsString('data-bell-count="2"', $bell);
        $this->assertStringContainsString('團隊最新的回覆', $bell);
        $this->assertStringNotContainsString('團隊較早的回覆', $bell);
        $this->assertStringNotContainsString('老師自己的留言不進老師鈴鐺', $bell);
        $this->assertStringNotContainsString('團隊內部單', $bell);
        $this->assertStringNotContainsString('data-bell-item="'.$quiet->public_id.'"', $bell);
        $this->assertStringNotContainsString('待審留言', $html);
        $this->assertStringNotContainsString('草稿內容不外流', $html);
        $this->assertStringNotContainsString('data-bell-draft', $html);
    }

    public function test_opening_the_report_from_the_bell_marks_it_read(): void
    {
        $mine = $this->report('老師的單');
        $this->message($mine, FeedbackAuthorType::Owner, now()->subMinutes(10), '團隊回覆');

        $this->actingAsClient();
        $this->assertStringContainsString('data-bell-count="1"', $this->bell($this->get(route('feedback.portal', $this->project))->getContent()));

        $this->get(route('feedback.reports.show', [$this->project, $mine]))->assertOk();

        $bell = $this->bell($this->get(route('feedback.portal', $this->project))->getContent());
        $this->assertStringContainsString('data-bell-count="0"', $bell);
        $this->assertStringContainsString('目前沒有新留言', $bell);
    }

    private function bell(string $html): string
    {
        $this->assertSame(1, preg_match('/<details[^>]*data-notification-bell.*?<\/details>/s', $html, $match), '頁首沒有通知鈴鐺');

        return $match[0];
    }

    private function report(string $title, ?FeedbackProject $project = null, FeedbackCreatorType $creator = FeedbackCreatorType::Client): FeedbackReport
    {
        return FeedbackReport::factory()->for($project ?? $this->project)->create([
            'title' => $title,
            'creator_type' => $creator,
            'owner_last_read_at' => now()->subHour(),
            'client_last_read_at' => now()->subHour(),
        ]);
    }

    private function message(FeedbackReport $report, FeedbackAuthorType $author, Carbon $at, string $body): void
    {
        $message = $report->feedbackMessages()->create(['author_type' => $author, 'author_name' => $author->label(), 'body' => $body]);
        $message->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
    }

    private function actingAsTeam(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }

    private function actingAsClient(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)->assertRedirect();
    }
}
