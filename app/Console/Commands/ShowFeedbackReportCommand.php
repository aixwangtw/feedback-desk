<?php

namespace App\Console\Commands;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAttachmentLocation;
use App\Support\FeedbackReportWork;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:report
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id，或團隊端清單編號（純數字）}
    {--json : 輸出 JSON}')]
#[Description('讀取單張回饋單的完整內容（說明、附件路徑、調整重點、留言）')]
#[Help(<<<'HELP'
讀取單張回饋單的完整內容，附件會印出伺服器上的絕對檔案路徑，可直接開啟看圖。

  php artisan feedback:report my-project 12
  php artisan feedback:report my-project 0199c3a1-... --json

說明：
  - report 純數字時是團隊端清單編號（與 feedback:reports 的「編號」相同，含客戶刪除而隱藏的單）；
    否則視為 public_id。編號會隨新單變動，要穩定指定請用 public_id。
  - FEEDBACK_DISK 不是 local 時，附件沒有本機路徑，會印出「磁碟:儲存路徑」並標註。
HELP)]
class ShowFeedbackReportCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $report = FeedbackReport::findInProject($project, (string) $this->argument('report'));
        if (! $report) {
            $this->components->error('這個專案裡找不到該回饋單（請用 public_id 或團隊端清單編號）。');

            return self::FAILURE;
        }

        $report->load(['creatorDeveloper', 'creatorClientAccount', 'feedbackAttachments', 'feedbackMessages' => fn ($query) => $query->orderBy('created_at')->orderBy('id'), 'feedbackMessages.authorClientAccount', 'feedbackMessages.authorDeveloper']);

        $data = $this->payload($project, $report);

        if ($this->option('json')) {
            $this->line(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }

        $this->render($data);

        return self::SUCCESS;
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(FeedbackProject $project, FeedbackReport $report): array
    {
        $attachments = $report->feedbackAttachments;

        return [
            'number' => $report->sequenceNumber(),
            'client_number' => $report->isCreatedByClient() ? $report->sequenceNumber(clientCreatedOnly: true) : null,
            'public_id' => $report->public_id,
            'project' => $project->slug,
            'title' => $report->title,
            'status' => $report->status->value,
            'status_label' => $report->status->label(),
            'creator_type' => $report->creator_type->value,
            'creator' => $report->creatorLabel(),
            'deleted_by_client' => $report->isDeletedByClient(),
            ...app(FeedbackReportWork::class)->stateForOutput($report, null),
            'created_at' => $report->created_at?->toIso8601String(),
            'updated_at' => $report->updated_at?->toIso8601String(),
            'latest_activity_at' => $report->latest_activity_at?->toIso8601String(),
            'page_url' => $report->page_url,
            'description' => $report->description,
            'attachments' => $this->attachmentData($attachments->filter(fn (FeedbackAttachment $a) => $a->feedback_message_id === null && $a->kind->value === 'feedback')),
            'adjustment_note' => $report->adjustment_note,
            'adjustment_attachments' => $this->attachmentData($attachments->filter(fn (FeedbackAttachment $a) => $a->kind->value === 'adjustment')),
            'messages' => $report->feedbackMessages->map(fn ($message): array => [
                'author_type' => $message->author_type->value,
                'author' => $message->displayAuthor($report, true),
                'created_at' => $message->created_at?->toIso8601String(),
                'body' => $message->body,
                'attachments' => $this->attachmentData($attachments->where('feedback_message_id', $message->id)),
            ])->values()->all(),
        ];
    }

    /**
     * @param  Collection<int, FeedbackAttachment>  $attachments
     * @return list<array{original_name: string, mime_type: string, size: int, path: string, is_local: bool}>
     */
    private function attachmentData(Collection $attachments): array
    {
        return $attachments->sortBy('id')->map(function (FeedbackAttachment $attachment): array {
            $location = FeedbackAttachmentLocation::resolve($attachment);

            return [
                'original_name' => $attachment->original_name,
                'mime_type' => $attachment->mime_type,
                'size' => (int) $attachment->size,
                'path' => $location['path'],
                'is_local' => $location['is_local'],
            ];
        })->values()->all();
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function render(array $data): void
    {
        $this->line('# '.$this->e($data['title']));
        $this->components->twoColumnDetail('編號', $data['number'].($data['client_number'] !== null && $data['client_number'] !== $data['number'] ? "（客戶頁面 {$data['client_number']}）" : ''));
        $this->components->twoColumnDetail('public_id', $this->e($data['public_id']));
        $this->components->twoColumnDetail('狀態', "{$data['status']}（{$data['status_label']}）".($data['deleted_by_client'] ? '，客戶已刪除' : ''));
        $this->components->twoColumnDetail('建立者', $this->e($data['creator']));
        $this->components->twoColumnDetail('建立時間', $this->time($data['created_at']));
        $this->components->twoColumnDetail('更新時間', $this->time($data['updated_at']));
        if (filled($data['page_url'])) {
            $this->components->twoColumnDetail('頁面網址', $this->e($data['page_url']));
        }

        $this->components->twoColumnDetail('認領', $data['claim'] !== null
            ? $this->e($data['claim']['by']).'（'.$this->time($data['claim']['since']).' 開始）'
            : '沒有人認領');
        if ($data['handoff_notes'] !== []) {
            $this->newLine();
            $this->line('## 交接紀錄（最新在前，只有團隊看得到）');
            foreach ($data['handoff_notes'] as $note) {
                $this->line("- {$this->e($note['author'])}　{$this->time($note['created_at'])}");
                $this->line('  '.str_replace("\n", "\n  ", $this->e($note['note'])));
            }
        }

        $this->newLine();
        $this->line('## 說明');
        $this->line($this->e($data['description']));
        $this->renderAttachments('附件', $data['attachments']);

        $this->newLine();
        $this->line('## 調整重點');
        $this->line(filled($data['adjustment_note']) ? $this->e($data['adjustment_note']) : '（尚未填寫）');
        $this->renderAttachments('調整附圖', $data['adjustment_attachments']);

        $this->newLine();
        $this->line('## 留言（'.count($data['messages']).'）');
        foreach ($data['messages'] as $message) {
            $this->line("- {$this->e($message['author'])}　{$this->time($message['created_at'])}");
            $this->line('  '.str_replace("\n", "\n  ", $this->e($message['body'])));
            $this->renderAttachments('附件', $message['attachments'], '  ');
        }
    }

    /**
     * @param  list<array{original_name: string, path: string, is_local: bool}>  $attachments
     */
    private function renderAttachments(string $label, array $attachments, string $indent = ''): void
    {
        if ($attachments === []) {
            return;
        }

        $this->line("{$indent}{$label}：");
        foreach ($attachments as $attachment) {
            $note = $attachment['is_local'] ? '' : '（非本機磁碟，格式為 磁碟:儲存路徑，無法直接讀檔）';
            $this->line("{$indent}  - {$this->e($attachment['original_name'])}　{$this->e($attachment['path'])}{$note}");
        }
    }

    private function time(?string $iso): string
    {
        return $iso ? date('Y-m-d H:i', strtotime($iso)) : '';
    }

    private function e(?string $text): string
    {
        return OutputFormatter::escape((string) $text);
    }
}
