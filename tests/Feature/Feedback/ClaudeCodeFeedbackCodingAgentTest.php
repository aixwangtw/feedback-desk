<?php

namespace Tests\Feature\Feedback;

use App\Contracts\FeedbackCodingAgent;
use App\Enums\FeedbackAutomationStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Services\ClaudeCodeFeedbackCodingAgent;
use App\Services\CodexFeedbackCodingAgent;
use App\Support\FeedbackWorkRule;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use InvalidArgumentException;
use RuntimeException;
use Symfony\Component\Process\Exception\ProcessTimedOutException as SymfonyProcessTimedOutException;
use Symfony\Component\Process\Process as SymfonyProcess;
use Tests\TestCase;

class ClaudeCodeFeedbackCodingAgentTest extends TestCase
{
    use LazilyRefreshDatabase;

    private string $workspace;

    protected function setUp(): void
    {
        parent::setUp();

        $this->workspace = sys_get_temp_dir().'/feedback-claude-'.bin2hex(random_bytes(4));
        File::ensureDirectoryExists($this->workspace.'/app/.git');
        config([
            'feedback.automation.workspace_root' => $this->workspace,
            'feedback.automation.claude_oauth_token' => null,
            'feedback.automation.claude_model' => null,
        ]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->workspace);

        parent::tearDown();
    }

    /** @return array{0: FeedbackReport, 1: FeedbackAutomationRun} */
    private function reportAndRun(): array
    {
        $project = FeedbackProject::factory()->create([
            'automation_enabled' => true,
            'repository_path' => $this->workspace.'/app',
        ]);
        $report = FeedbackReport::factory()->for($project)->create(['title' => '儲存失敗', 'description' => '按下儲存沒反應']);
        $report->setRelation('feedbackProject', $project);

        return [$report, FeedbackAutomationRun::factory()->for($report)->create()];
    }

    /** @param array<string, mixed> $body */
    private function fakeClaude(array $body, int $exitCode = 0): void
    {
        $output = json_encode(['type' => 'system', 'subtype' => 'init'])."\n"
            .json_encode(['type' => 'assistant', 'message' => ['content' => []]])."\n"
            .json_encode(['type' => 'result'] + $body)."\n";

        Process::fake(['*' => Process::result($output, 'warn', $exitCode)]);
    }

    public function test_it_runs_claude_with_expected_command_stdin_and_parses_structured_output(): void
    {
        config(['feedback.automation.claude_model' => 'sonnet']);
        [$report, $run] = $this->reportAndRun();
        FeedbackAttachment::factory()->for($report, 'feedbackReport')->create(['path' => 'feedback/shot.png']);
        $report->load('feedbackAttachments');
        $this->fakeClaude([
            'is_error' => false,
            'total_cost_usd' => 0.12,
            'structured_output' => ['outcome' => 'completed', 'summary' => '已修正。', 'tests' => ['php artisan test', 5]],
        ]);

        $result = (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);

        $this->assertSame(FeedbackAutomationStatus::Completed, $result->status);
        $this->assertSame('已修正。', $result->summary);
        $this->assertSame(['php artisan test'], $result->tests);
        $this->assertStringContainsString('total_cost_usd', File::get($result->tracePath));
        $this->assertSame('已修正。', json_decode(File::get(dirname($result->tracePath)."/{$run->id}-result.json"), true)['summary']);

        $imageDirectory = dirname(\Storage::disk('local')->path('feedback/shot.png'));
        Process::assertRan(function (PendingProcess $process) use ($imageDirectory, $report): bool {
            $command = $process->command;

            return $command[0] === 'claude'
                && $command[1] === '-p'
                && array_slice($command, 3, 3) === ['--output-format', 'stream-json', '--verbose']
                && $command[6] === '--json-schema'
                && json_decode($command[7], true)['required'] === ['outcome', 'summary', 'tests']
                && array_slice($command, 8, 4) === ['--restricted', '--tools', 'Read,Edit,Write,Glob,Grep', '--strict-mcp-config']
                && array_slice($command, 12, 4) === ['--permission-mode', 'dontAsk', '--allowedTools', 'Read,Edit,Write,Glob,Grep']
                && array_slice($command, 16, 7) === ['--disallowedTools', 'Bash(git commit *)', 'Bash(git push *)', 'Read(.env)', 'Read(.env.*)', 'Read(!.env.example)', 'Edit(/'.$imageDirectory.'/**)']
                && in_array('--no-session-persistence', $command, true)
                && array_slice($command, -6) === ['--max-turns', '60', '--model', 'sonnet', '--add-dir', $imageDirectory]
                && str_contains($process->input, $report->title)
                && str_contains($process->input, 'AGENTS.md')
                && str_contains($process->input, FeedbackWorkRule::TEXT)
                && str_contains($process->input, $imageDirectory.'/shot.png')
                && $process->path === realpath($this->workspace.'/app')
                && $process->environment === ['DISABLE_AUTOUPDATER' => '1'];
        });
    }

    public function test_it_omits_model_flag_and_passes_oauth_token_only_when_configured(): void
    {
        config(['feedback.automation.claude_oauth_token' => 'secret-token']);
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => false, 'structured_output' => ['outcome' => 'needs_input', 'summary' => '需要更多資訊。', 'tests' => []]]);

        $result = (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);

        $this->assertSame(FeedbackAutomationStatus::NeedsInput, $result->status);
        Process::assertRan(fn (PendingProcess $process): bool => ! in_array('--model', $process->command, true)
            && $process->environment === ['DISABLE_AUTOUPDATER' => '1', 'CLAUDE_CODE_OAUTH_TOKEN' => 'secret-token']);
        $this->assertStringNotContainsString('secret-token', File::get($result->tracePath));
    }

    public function test_error_response_throws(): void
    {
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => true, 'result' => 'Max turns reached']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Claude Code 回報執行錯誤：Max turns reached');

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
    }

    public function test_missing_structured_output_throws(): void
    {
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => false, 'result' => 'declined']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Claude Code 未產生結構化處理結果。');

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
    }

    public function test_non_zero_exit_code_throws(): void
    {
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude([], 2);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Claude Code 執行失敗（exit code 2）。');

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
    }

    public function test_non_zero_exit_code_reports_result_subtype(): void
    {
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => true, 'subtype' => 'error_max_turns'], 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Claude Code 執行失敗（exit code 1，error_max_turns）。');

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
    }

    public function test_output_without_result_event_throws(): void
    {
        [$report, $run] = $this->reportAndRun();
        Process::fake(['*' => Process::result('not json', '', 0)]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Claude Code 未回傳可解析的 JSON 結果。');

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
    }

    public function test_bash_rules_in_allowed_tools_enable_the_bash_tool(): void
    {
        config(['feedback.automation.claude_allowed_tools' => 'Read,Edit, Write,Glob,Grep,Bash(php artisan test *),Bash(npm run test:unit *),mcp__x__y']);
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => false, 'structured_output' => ['outcome' => 'completed', 'summary' => 'ok', 'tests' => []]]);

        (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);

        Process::assertRan(function (PendingProcess $process): bool {
            $toolsIndex = array_search('--tools', $process->command, true);

            return $process->command[$toolsIndex + 1] === 'Read,Edit,Write,Glob,Grep,Bash'
                && ! in_array('--add-dir', $process->command, true);
        });
    }

    public function test_timeout_is_reported_without_the_command_line(): void
    {
        [$report, $run] = $this->reportAndRun();
        Process::fake(fn () => throw new ProcessTimedOutException(
            new SymfonyProcessTimedOutException(new SymfonyProcess(['claude', '-p', 'secret prompt']), SymfonyProcessTimedOutException::TYPE_GENERAL),
            Process::result(),
        ));

        try {
            (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
            $this->fail('應該要丟出逾時例外。');
        } catch (RuntimeException $exception) {
            $this->assertSame('Claude Code 執行逾時，已中止。', $exception->getMessage());
        }
    }

    public function test_unknown_outcome_becomes_failed(): void
    {
        [$report, $run] = $this->reportAndRun();
        $this->fakeClaude(['is_error' => false, 'structured_output' => ['outcome' => 'weird', 'summary' => 'x', 'tests' => []]]);

        $this->assertSame(FeedbackAutomationStatus::Failed, (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run)->status);
    }

    public function test_repository_outside_workspace_is_rejected(): void
    {
        [$report, $run] = $this->reportAndRun();
        config(['feedback.automation.workspace_root' => sys_get_temp_dir().'/other-root-'.bin2hex(random_bytes(4))]);
        File::ensureDirectoryExists(config('feedback.automation.workspace_root'));

        try {
            $this->expectException(RuntimeException::class);
            (new ClaudeCodeFeedbackCodingAgent)->resolve($report, $run);
        } finally {
            File::deleteDirectory(config('feedback.automation.workspace_root'));
        }
    }

    public function test_driver_binding_selects_agent(): void
    {
        config(['feedback.automation.driver' => 'codex']);
        $this->assertInstanceOf(CodexFeedbackCodingAgent::class, app(FeedbackCodingAgent::class));
        $this->assertSame('Codex', app(FeedbackCodingAgent::class)->name());

        config(['feedback.automation.driver' => 'claude']);
        $this->assertInstanceOf(ClaudeCodeFeedbackCodingAgent::class, app(FeedbackCodingAgent::class));
        $this->assertSame('Claude Code', app(FeedbackCodingAgent::class)->name());
    }

    public function test_unknown_driver_throws_clear_exception(): void
    {
        config(['feedback.automation.driver' => 'gemini']);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('gemini');

        app(FeedbackCodingAgent::class);
    }
}
