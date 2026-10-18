<?php

namespace App\Console\Commands;

use App\Actions\ChangeFeedbackReportStatusAction;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:status
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id，或團隊端清單編號（純數字）}
    {status : 新狀態：new／needs_input／completed，或中文 待處理／待審核／已完成}')]
#[Description('改變回饋單的狀態，輸出前後狀態')]
#[Help(<<<'HELP'
改變回饋單狀態，規則與網頁上的狀態切換相同（完成時間、最後活動時間一併更新）。

  改成待審核：
    php artisan feedback:status my-project 12 needs_input
    php artisan feedback:status my-project 0199c3a1-... 待審核

說明：
  - report 純數字時是團隊端清單編號（含客戶刪除而隱藏的單）；否則視為 public_id。
  - 狀態寫錯時會列出可用值並失敗。
  - 做完修改建議改成「待審核」，由客戶確認後再改成「已完成」。
HELP)]
class SetFeedbackReportStatusCommand extends Command
{
    public function handle(ChangeFeedbackReportStatusAction $changeStatus): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $status = FeedbackReportStatus::fromInput((string) $this->argument('status'));
        if (! $status) {
            $this->components->error('不認得的狀態。可用值：'.implode('、', FeedbackReportStatus::describedOptions()));

            return self::FAILURE;
        }

        $report = FeedbackReport::findInProject($project, (string) $this->argument('report'));
        if (! $report) {
            $this->components->error('這個專案裡找不到該回饋單（請用 public_id 或團隊端清單編號）。');

            return self::FAILURE;
        }

        $previous = $report->status;
        $changeStatus->handle($report, $status);

        $this->components->info("已更新狀態：{$report->title}");
        $this->components->twoColumnDetail('原狀態', "{$previous->value}（{$previous->label()}）");
        $this->components->twoColumnDetail('新狀態', "{$status->value}（{$status->label()}）");

        return self::SUCCESS;
    }
}
