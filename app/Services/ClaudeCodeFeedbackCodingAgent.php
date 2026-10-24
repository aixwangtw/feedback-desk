<?php

namespace App\Services;

use App\Enums\FeedbackAutomationStatus;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use App\Support\FeedbackCodingResult;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class ClaudeCodeFeedbackCodingAgent extends CliFeedbackCodingAgent
{
    public function name(): string
    {
        return 'Claude Code';
    }

    public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult
    {
        $repositoryPath = $this->validatedRepositoryPath($report);
        [$resultPath, $tracePath] = $this->artifactPaths($report, $run);
        $imagePaths = $this->imagePaths($report);

        $result = Process::path($repositoryPath)
            ->timeout(config('feedback.automation.timeout'))
            ->idleTimeout(600)
            ->env($this->environment())
            ->input($this->claudePrompt($report, $imagePaths))
            ->run($this->command($imagePaths));

        File::put($tracePath, $this->trace($result));

        if (! $result->successful()) {
            throw new RuntimeException("Claude Code 執行失敗（exit code {$result->exitCode()}）。");
        }

        $response = json_decode($result->output(), true);
        if (! is_array($response)) {
            throw new RuntimeException('Claude Code 未回傳可解析的 JSON 結果。');
        }

        if (($response['is_error'] ?? false) === true) {
            throw new RuntimeException('Claude Code 回報執行錯誤：'.mb_substr((string) ($response['result'] ?? '未提供原因'), 0, 300));
        }

        $payload = $response['structured_output'] ?? null;
        if (! is_array($payload)) {
            throw new RuntimeException('Claude Code 未產生結構化處理結果。');
        }

        File::put($resultPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

        $status = FeedbackAutomationStatus::tryFrom((string) ($payload['outcome'] ?? ''))
            ?? FeedbackAutomationStatus::Failed;

        return new FeedbackCodingResult(
            status: $status,
            summary: (string) ($payload['summary'] ?? '未提供處理摘要。'),
            tests: array_values(array_filter($payload['tests'] ?? [], 'is_string')),
            exitCode: $result->exitCode(),
            tracePath: $tracePath,
        );
    }

    /**
     * @param  list<string>  $imagePaths
     * @return list<string>
     */
    private function command(array $imagePaths): array
    {
        $command = [
            config('feedback.automation.claude_binary'),
            '-p',
            '完整任務在標準輸入，請依其內容處理，最後以指定的 JSON 結構回報。',
            '--output-format',
            'json',
            '--json-schema',
            File::get(resource_path('feedback/codex-result.schema.json')),
            '--permission-mode',
            'dontAsk',
            '--allowedTools',
            (string) config('feedback.automation.claude_allowed_tools'),
            '--disallowedTools',
            'Bash(git commit *)',
            'Bash(git push *)',
            '--no-session-persistence',
            '--max-turns',
            (string) config('feedback.automation.claude_max_turns'),
        ];

        $model = config('feedback.automation.claude_model');
        if (is_string($model) && $model !== '') {
            $command[] = '--model';
            $command[] = $model;
        }

        foreach (array_values(array_unique(array_map('dirname', $imagePaths))) as $directory) {
            $command[] = '--add-dir';
            $command[] = $directory;
        }

        return $command;
    }

    /** @return array<string, string> */
    private function environment(): array
    {
        $environment = ['DISABLE_AUTOUPDATER' => '1'];

        $token = config('feedback.automation.claude_oauth_token');
        if (is_string($token) && $token !== '') {
            $environment['CLAUDE_CODE_OAUTH_TOKEN'] = $token;
        }

        return $environment;
    }

    /** @return list<string> */
    private function imagePaths(FeedbackReport $report): array
    {
        $paths = [];
        foreach ($report->feedbackAttachments as $attachment) {
            if ($attachment->disk === 'local') {
                $paths[] = Storage::disk($attachment->disk)->path($attachment->path);
            }
        }

        return $paths;
    }

    /** @param list<string> $imagePaths */
    private function claudePrompt(FeedbackReport $report, array $imagePaths): string
    {
        $extra = '工作目錄若有 AGENTS.md，請先讀它再開始。若沒有可執行測試的工具，請在 tests 欄明確寫「未執行」與原因，不要宣稱測試通過。';

        if ($imagePaths !== []) {
            $extra .= "\n\n回報附有下列圖片，請用 Read 工具逐一查看：\n- ".implode("\n- ", $imagePaths);
        }

        return $this->prompt($report, $extra);
    }
}
