<?php

namespace App\Console\Commands;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:reports
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {--status=* : 只列出這些狀態（new／needs_input／completed 或 待處理／待審核／已完成），可重複}
    {--creator= : 建立者篩選：client、public、shared 或 developer:{id}}
    {--include-deleted : 一併列出客戶已刪除（隱藏）的單}
    {--json : 輸出 JSON}')]
#[Description('列出專案的回饋單（最新在前）')]
#[Help(<<<'HELP'
列出專案的回饋單，排序與網頁預設相同（建立時間，最新在前）。

  待處理與待審核的單：
    php artisan feedback:reports my-project --status=new --status=needs_input

  客戶建立的單，JSON 輸出：
    php artisan feedback:reports my-project --creator=client --json

說明：
  - 「編號」是開發團隊頁面看到的清單編號（含所有建立者）；客戶頁面只算客戶建立的單，
    所以兩邊編號可能不同。JSON 的 client_number 是客戶頁面看到的編號（非客戶建立的單為 null）。
  - 編號會隨新單增加而變動，要穩定指定請用 public_id。
  - 預設不含客戶已刪除的單，加 --include-deleted 才會列出。
HELP)]
class ListFeedbackReportsCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $statuses = [];
        foreach ((array) $this->option('status') as $input) {
            $status = FeedbackReportStatus::fromInput((string) $input);
            if (! $status) {
                $this->components->error("不認得的狀態「{$input}」。可用值：".implode('、', FeedbackReportStatus::describedOptions()));

                return self::FAILURE;
            }
            $statuses[] = $status->value;
        }

        $creator = (string) $this->option('creator');
        if ($creator !== '' && ! preg_match('/^(client|public|shared|developer:\d+)$/', $creator)) {
            $this->components->error('不認得的建立者。可用值：client、public、shared、developer:{id}');

            return self::FAILURE;
        }

        $teamNumbers = FeedbackReport::sequenceNumbersForProject($project);
        $clientNumbers = FeedbackReport::sequenceNumbersForProject($project, clientCreatedOnly: true);

        $reports = $project->feedbackReports()
            ->with('creatorDeveloper')
            ->withCount(['feedbackMessages', 'feedbackAttachments'])
            ->when($statuses !== [], fn ($query) => $query->whereIn('status', $statuses))
            ->when($creator !== '', fn ($query) => $query->createdBy($creator))
            ->unless($this->option('include-deleted'), fn ($query) => $query->whereNull('client_deleted_at'))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $rows = $reports->map(fn (FeedbackReport $report): array => [
            'number' => $teamNumbers[$report->id] + 1,
            'client_number' => isset($clientNumbers[$report->id]) ? $clientNumbers[$report->id] + 1 : null,
            'public_id' => $report->public_id,
            'status' => $report->status->value,
            'status_label' => $report->status->label(),
            'creator_type' => $report->creator_type->value,
            'creator' => $report->creatorLabel(),
            'title' => $report->title,
            'messages_count' => $report->feedback_messages_count,
            'attachments_count' => $report->feedback_attachments_count,
            'deleted_by_client' => $report->isDeletedByClient(),
            'latest_activity_at' => $report->latest_activity_at?->toIso8601String(),
        ])->all();

        if ($this->option('json')) {
            $this->line(json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }

        if ($rows === []) {
            $this->components->info('沒有符合條件的回饋單。');

            return self::SUCCESS;
        }

        $this->table(
            ['編號', 'public_id', '狀態', '建立者', '標題', '留言', '附件', '最後更新'],
            array_map(fn (array $row): array => [
                $row['number'],
                $row['public_id'],
                $row['status_label'].($row['deleted_by_client'] ? '（已刪除）' : ''),
                $row['creator'],
                $row['title'],
                $row['messages_count'],
                $row['attachments_count'],
                $row['latest_activity_at'] ? date('Y-m-d H:i', strtotime($row['latest_activity_at'])) : '',
            ], $rows),
        );
        $this->line('編號為開發團隊頁面的清單編號；客戶頁面只算客戶建立的單，編號可能不同（--json 有 client_number）。');

        return self::SUCCESS;
    }
}
