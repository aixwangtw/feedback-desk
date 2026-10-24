<?php

namespace App\Services;

use App\Enums\FeedbackAutomationStatus;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use App\Support\FeedbackCodingResult;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
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

        try {
            $result = Process::path($repositoryPath)
                ->timeout(config('feedback.automation.timeout'))
                ->idleTimeout(600)
                ->env($this->environment())
                ->input($this->claudePrompt($report, $imagePaths))
                ->run($this->command($imagePaths));
        } catch (ProcessTimedOutException) {
            // 逾時例外訊息含完整指令列，會被貼到回報留言，所以換成簡短說明。
            throw new RuntimeException('Claude Code 執行逾時，已中止。');
        }

        File::put($tracePath, $this->trace($result));

        $response = $this->resultMessage($result->output());

        if (! $result->successful()) {
            $reason = is_string($response['subtype'] ?? null) ? "，{$response['subtype']}" : '';

            throw new RuntimeException("Claude Code 執行失敗（exit code {$result->exitCode()}{$reason}）。");
        }

        if ($response === null) {
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
     * stream-json 輸出每行一個事件，最後一個 type=result 的事件就是整次執行的結果。
     *
     * @return array<string, mixed>|null
     */
    private function resultMessage(string $output): ?array
    {
        $lines = preg_split('/\R/', trim($output)) ?: [];

        foreach (array_reverse($lines) as $line) {
            $message = json_decode($line, true);
            if (is_array($message) && ($message['type'] ?? null) === 'result') {
                return $message;
            }
        }

        return null;
    }

    /**
     * 回報內容可能夾帶惡意指示，所以除了工具白名單，另外把檔案工具限制在工作目錄與該回報的附圖目錄
     * （--restricted），不載入工作目錄的 hooks、設定與 .mcp.json，也拒絕讀取 .env。
     *
     * @param  list<string>  $imagePaths
     * @return list<string>
     */
    private function command(array $imagePaths): array
    {
        $allowedTools = (string) config('feedback.automation.claude_allowed_tools');
        $imageDirectories = array_values(array_unique(array_map('dirname', $imagePaths)));

        $command = [
            config('feedback.automation.claude_binary'),
            '-p',
            '完整任務在標準輸入，請依其內容處理，最後以指定的 JSON 結構回報。',
            '--output-format',
            'stream-json',
            '--verbose',
            '--json-schema',
            File::get(resource_path('feedback/codex-result.schema.json')),
            '--restricted',
            '--tools',
            implode(',', $this->toolNames($allowedTools)),
            '--strict-mcp-config',
            '--permission-mode',
            'dontAsk',
            '--allowedTools',
            $allowedTools,
            '--disallowedTools',
            'Bash(git commit *)',
            'Bash(git push *)',
            'Read(.env)',
            'Read(.env.*)',
            'Read(!.env.example)',
        ];

        // 附圖目錄只給讀，不讓它改到回報的原始附件。
        foreach ($imageDirectories as $directory) {
            $command[] = 'Edit(/'.$directory.'/**)';
        }

        array_push(
            $command,
            '--no-session-persistence',
            '--max-turns',
            (string) config('feedback.automation.claude_max_turns'),
        );

        $model = config('feedback.automation.claude_model');
        if (is_string($model) && $model !== '') {
            $command[] = '--model';
            $command[] = $model;
        }

        foreach ($imageDirectories as $directory) {
            $command[] = '--add-dir';
            $command[] = $directory;
        }

        return $command;
    }

    /**
     * 從權限規則取出內建工具名稱給 --tools，沒列到的內建工具（Bash、WebFetch、Agent 等）就不會出現。
     *
     * @return list<string>
     */
    private function toolNames(string $allowedTools): array
    {
        preg_match_all('/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)/', preg_replace('/\([^)]*\)/', '', $allowedTools) ?? '', $matches);

        return array_values(array_unique(array_filter(
            $matches[1],
            fn (string $name): bool => ! str_starts_with($name, 'mcp__'),
        )));
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
