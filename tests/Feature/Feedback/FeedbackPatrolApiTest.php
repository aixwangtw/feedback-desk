<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackPatrolLog;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * 排程專用 API：token 驗證與撤銷、待處理清單、留言、調整說明、只能改成待審核、寫入紀錄、速率限制。
 */
class FeedbackPatrolApiTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private FeedbackDeveloper $alex;

    private string $plain;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'site']);
        $this->alex = FeedbackDeveloper::factory()->create(['username' => 'alex', 'name' => 'Alex']);
        $this->plain = FeedbackPatrolToken::issue($this->alex, '雲端排程')['plain'];
    }

    public function test_requests_without_a_valid_token_are_refused(): void
    {
        $this->getJson(route('feedback.patrol.projects'))->assertUnauthorized()->assertHeader('WWW-Authenticate');
        $this->withToken('fdp_nope')->getJson(route('feedback.patrol.projects'))->assertUnauthorized();

        $mcpStyle = 'fdk_'.substr($this->plain, 4);
        $this->withToken($mcpStyle)->getJson(route('feedback.patrol.projects'))->assertUnauthorized();
    }

    public function test_token_is_stored_only_as_hash(): void
    {
        $token = FeedbackPatrolToken::query()->sole();

        $this->assertSame(hash('sha256', $this->plain), $token->token_hash);
        $this->assertStringNotContainsString($this->plain, json_encode($token->toArray()));
    }

    public function test_revoked_token_is_refused(): void
    {
        $this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertOk();

        $id = FeedbackPatrolToken::query()->value('id');
        $this->artisan('feedback:patrol-token', ['action' => 'revoke', '--id' => $id])->assertSuccessful();

        $this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertUnauthorized();
    }

    public function test_issue_command_prints_a_working_token(): void
    {
        Artisan::call('feedback:patrol-token', ['action' => 'issue', '--developer' => 'alex', '--name' => '測試']);
        preg_match('/fdp_[A-Za-z0-9]{48}/', Artisan::output(), $match);

        $this->assertNotEmpty($match);
        $this->withToken($match[0])->getJson(route('feedback.patrol.projects'))->assertOk();
        $this->artisan('feedback:patrol-token', ['action' => 'issue', '--developer' => 'nobody'])->assertFailed();
    }

    public function test_projects_lists_every_project_including_new_ones(): void
    {
        FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'later']);

        $this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))
            ->assertOk()
            ->assertJsonPath('projects.0.slug', 'site')
            ->assertJsonPath('projects.1.slug', 'later');
    }

    public function test_attention_lists_new_unread_and_unanswered_reports_with_details(): void
    {
        $new = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::New]);
        FeedbackAttachment::factory()->create(['feedback_report_id' => $new->id]);

        $answered = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::NeedsInput,
            'owner_last_read_at' => now(),
            'adjustment_updated_at' => now(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $answered->id, 'created_at' => now()->subHour()]);

        $unanswered = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::Completed,
            'owner_last_read_at' => now()->addMinute(),
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $unanswered->id, 'body' => '還是不行', 'created_at' => now()->subHour()]);

        $repliedByTeam = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::NeedsInput, 'owner_last_read_at' => now()]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $repliedByTeam->id, 'created_at' => now()->subHours(2)]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $repliedByTeam->id, 'author_type' => FeedbackAuthorType::Owner, 'created_at' => now()->subHour()]);

        $response = $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'site'))->assertOk();

        $ids = collect($response->json('reports'))->pluck('public_id')->all();
        $this->assertEqualsCanonicalizing([$new->public_id, $unanswered->public_id], $ids);
        $this->assertSame(2, $response->json('total'));

        $newReport = collect($response->json('reports'))->firstWhere('public_id', $new->public_id);
        $this->assertSame(['status_new'], $newReport['attention_reasons']);
        $this->assertStringContainsString('/download', $newReport['untrusted_content']['attachments'][0]['url']);

        $other = collect($response->json('reports'))->firstWhere('public_id', $unanswered->public_id);
        $this->assertSame(['reporter_message_after_last_reply'], $other['attention_reasons']);
        $this->assertSame('還是不行', $other['untrusted_content']['messages'][0]['body']);

        $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'missing'))->assertNotFound();
    }

    public function test_completed_report_with_only_a_thank_you_message_is_not_listed(): void
    {
        $thanked = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::Completed,
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $thanked->id, 'body' => '好的，謝謝！', 'created_at' => now()->subHour()]);

        $questioned = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::Completed,
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $questioned->id, 'body' => '謝謝，不過第三題怎麼還是一樣', 'created_at' => now()->subHours(2)]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $questioned->id, 'body' => '麻煩了', 'created_at' => now()->subHour()]);

        $askedWithMark = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::Completed,
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $askedWithMark->id, 'body' => '可以再調大一點?', 'created_at' => now()->subHour()]);

        $reopened = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::New,
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $reopened->id, 'body' => '謝謝', 'created_at' => now()->subHour()]);

        $pendingThanks = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::NeedsInput,
            'adjustment_updated_at' => now()->subDay(),
        ]);
        FeedbackMessage::factory()->create(['feedback_report_id' => $pendingThanks->id, 'body' => '謝謝', 'created_at' => now()->subHour()]);

        $response = $this->withToken($this->plain)->getJson(route('feedback.patrol.attention', 'site'))->assertOk();

        $ids = collect($response->json('reports'))->pluck('public_id')->all();
        $this->assertEqualsCanonicalizing([$questioned->public_id, $askedWithMark->public_id, $reopened->public_id, $pendingThanks->public_id], $ids);
        $this->assertSame(4, $response->json('total'));
    }

    public function test_show_returns_report_detail(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();

        $this->withToken($this->plain)->getJson(route('feedback.patrol.show', ['site', $report->public_id]))
            ->assertOk()
            ->assertJsonPath('public_id', $report->public_id);
        $this->withToken($this->plain)->getJson(route('feedback.patrol.show', ['site', 'nope']))->assertNotFound();
    }

    public function test_message_is_posted_as_team_and_logged(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();

        $this->withToken($this->plain)->postJson(route('feedback.patrol.message', ['site', $report->public_id]), ['body' => '請問是哪一題？'])->assertOk();

        $message = $report->feedbackMessages()->sole();
        $this->assertSame('請問是哪一題？', $message->body);
        $this->assertSame($this->alex->id, $message->author_developer_id);

        $log = FeedbackPatrolLog::query()->sole();
        $this->assertSame('message', $log->action);
        $this->assertTrue($log->succeeded);
        $this->assertSame(7, $log->detail['body_length']);

        $this->withToken($this->plain)->postJson(route('feedback.patrol.message', ['site', $report->public_id]), ['body' => ' '])->assertUnprocessable();
        $this->assertFalse(FeedbackPatrolLog::query()->latest('id')->first()->succeeded);
    }

    public function test_adjustment_writes_and_appends_note(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();

        $this->withToken($this->plain)->putJson(route('feedback.patrol.adjustment', ['site', $report->public_id]), ['note' => '已修正'])->assertOk();
        $this->withToken($this->plain)->putJson(route('feedback.patrol.adjustment', ['site', $report->public_id]), ['note' => '再補充', 'append' => true])->assertOk();

        $this->assertSame("已修正\n\n再補充", $report->fresh()->adjustment_note);
        $this->assertSame(2, FeedbackPatrolLog::query()->where('action', 'adjustment')->where('succeeded', true)->count());

        $this->withToken($this->plain)->putJson(route('feedback.patrol.adjustment', ['site', '1']), ['note' => 'x'])->assertUnprocessable();
    }

    public function test_status_can_only_become_needs_input(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::New]);

        $this->withToken($this->plain)->postJson(route('feedback.patrol.needs-input', ['site', $report->public_id]), ['status' => 'completed'])
            ->assertOk()
            ->assertJsonPath('current.status', 'needs_input');

        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->fresh()->status);
        $this->assertSame('new', FeedbackPatrolLog::query()->sole()->detail['previous']);
    }

    public function test_no_route_completes_or_deletes_reports(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $base = "/api/patrol/projects/site/reports/{$report->public_id}";

        $this->withToken($this->plain)->deleteJson($base)->assertStatus(405);
        $this->withToken($this->plain)->patchJson("{$base}/status", ['status' => 'completed'])->assertNotFound();
        $this->assertNotNull($report->fresh());
        $this->assertSame(FeedbackReportStatus::New, $report->fresh()->status);
    }

    public function test_requests_are_rate_limited_per_token(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertOk();
        }

        $this->withToken($this->plain)->getJson(route('feedback.patrol.projects'))->assertTooManyRequests();
    }
}
