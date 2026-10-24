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

class CodexFeedbackCodingAgent extends CliFeedbackCodingAgent
{
    public function name(): string
    {
        return 'Codex';
    }

    public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult
    {
        $repositoryPath = $this->validatedRepositoryPath($report);
        [$resultPath, $tracePath] = $this->artifactPaths($report, $run);
        $command = $this->command($report, $resultPath);

        $result = Process::path($repositoryPath)
            ->timeout(config('feedback.automation.timeout'))
            ->idleTimeout(600)
            ->input($this->prompt($report))
            ->run($command);

        File::put($tracePath, $this->trace($result));

        if (! $result->successful()) {
            throw new RuntimeException("Codex 執行失敗（exit code {$result->exitCode()}）。");
        }

        if (! File::exists($resultPath)) {
            throw new RuntimeException('Codex 未產生結構化處理結果。');
        }

        $payload = json_decode(File::get($resultPath), true, flags: JSON_THROW_ON_ERROR);
        $status = FeedbackAutomationStatus::tryFrom($payload['outcome'] ?? '')
            ?? FeedbackAutomationStatus::Failed;

        return new FeedbackCodingResult(
            status: $status,
            summary: (string) ($payload['summary'] ?? '未提供處理摘要。'),
            tests: array_values(array_filter($payload['tests'] ?? [], 'is_string')),
            exitCode: $result->exitCode(),
            tracePath: $tracePath,
        );
    }

    /** @return list<string> */
    private function command(FeedbackReport $report, string $resultPath): array
    {
        $command = [
            config('feedback.automation.codex_binary'),
            'exec',
            '--json',
            '--ephemeral',
            '--sandbox',
            'workspace-write',
            '--approve-for-me',
            '--output-schema',
            resource_path('feedback/codex-result.schema.json'),
            '--output-last-message',
            $resultPath,
        ];

        foreach ($report->feedbackAttachments as $attachment) {
            if ($attachment->disk === 'local') {
                $command[] = '--image';
                $command[] = Storage::disk($attachment->disk)->path($attachment->path);
            }
        }

        $command[] = '-';

        return $command;
    }
}
