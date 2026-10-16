<?php

namespace App\Console\Commands;

use App\Actions\UpdateFeedbackReportAdjustmentAction;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Http\File;

#[Signature('feedback:adjust
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id（網址 /reports/ 後面那段 UUID）或資料庫 id；不是畫面上的「編號」}
    {--note= : 調整說明文字；未給則保留原文字，--note="" 會清空}
    {--append : 把 --note 接在既有內容後面（中間空一行）；未加則覆寫}
    {--image=* : 要附上的圖片檔路徑，可重複多次（jpg/png/webp，每張 10 MB 內）}')]
#[Description('寫入回饋單的「調整說明」文字與圖片（不改動回饋單狀態）')]
#[Help(<<<'HELP'
寫入回饋單的「調整說明」，老師與開發者都會在回饋單內容下方看到。

  覆寫文字：
    php artisan feedback:adjust my-project 0199c3a1-... --note="已修正登入頁排版"

  追加文字（接在既有內容後、空一行）並附兩張圖：
    php artisan feedback:adjust my-project 0199c3a1-... --append --note="補充：手機版也已調整" --image=/tmp/a.png --image=/tmp/b.png

  只附圖、不動文字：
    php artisan feedback:adjust my-project 0199c3a1-... --image=/tmp/a.png

說明：
  - report 參數用網址裡的 public_id（UUID），或資料庫 id；不要用畫面上的「編號」（編號會隨新回饋單變動）。
  - 圖片會複製到私有儲存，原檔不會被移動或刪除；只有登入的老師／開發者能看。
  - 指令不會改動回饋單狀態；要改狀態請到開發者頁面操作。
  - 刪除調整圖片請到開發者頁面的回饋單詳情操作。
HELP)]
class UpdateFeedbackAdjustmentCommand extends Command
{
    private const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    private const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    public function handle(UpdateFeedbackReportAdjustmentAction $updateAdjustment): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $report = $this->findReport($project, (string) $this->argument('report'));
        if (! $report) {
            $this->components->error('這個專案裡找不到該回饋單（請用網址中的 public_id 或資料庫 id）。');

            return self::FAILURE;
        }

        $note = $this->option('note');
        $append = (bool) $this->option('append');
        $imagePaths = array_values(array_filter((array) $this->option('image'), fn ($path) => $path !== null && $path !== ''));

        if ($note === null && $imagePaths === []) {
            $this->components->error('請至少提供 --note 或 --image。');

            return self::FAILURE;
        }

        if ($append && $note === null) {
            $this->components->error('--append 需要搭配 --note。');

            return self::FAILURE;
        }

        $images = [];
        foreach ($imagePaths as $path) {
            $image = $this->validatedImage($path);
            if ($image === null) {
                return self::FAILURE;
            }
            $images[] = $image;
        }

        $data = ['images' => $images];
        if ($note !== null) {
            $merged = UpdateFeedbackReportAdjustmentAction::mergeNote($report->adjustment_note, $note, $append);
            if (mb_strlen((string) $merged) > UpdateFeedbackReportAdjustmentAction::MAX_NOTE_LENGTH) {
                $this->components->error('調整說明超過 '.UpdateFeedbackReportAdjustmentAction::MAX_NOTE_LENGTH.' 字上限。');

                return self::FAILURE;
            }
            $data['note'] = $note;
            $data['append'] = $append;
        }

        $report = $updateAdjustment->handle($report, $data);

        $this->components->info("已更新調整說明：{$report->title}");
        if ($note !== null) {
            $this->components->twoColumnDetail('文字', $append ? '已追加' : '已覆寫');
        }
        $this->components->twoColumnDetail('新增圖片', (string) count($images));
        $this->components->twoColumnDetail('目前圖片總數', (string) $report->adjustmentAttachments()->count());
        $this->line(route('feedback.reports.show', [$project, $report]).'#adjustment');

        return self::SUCCESS;
    }

    private function findReport(FeedbackProject $project, string $identifier): ?FeedbackReport
    {
        return $project->feedbackReports()
            ->where(fn ($query) => $query
                ->where('public_id', $identifier)
                ->when(ctype_digit($identifier), fn ($query) => $query->orWhere('id', (int) $identifier)))
            ->first();
    }

    private function validatedImage(string $path): ?File
    {
        if (! is_file($path) || ! is_readable($path)) {
            $this->components->error("找不到或無法讀取圖片：{$path}");

            return null;
        }

        $image = new File($path);

        if (! in_array($image->getMimeType(), self::ALLOWED_MIME_TYPES, true)) {
            $this->components->error("只接受 jpg／png／webp 圖片：{$path}");

            return null;
        }

        if ($image->getSize() > self::MAX_IMAGE_BYTES) {
            $this->components->error("圖片超過 10 MB：{$path}");

            return null;
        }

        return $image;
    }
}
