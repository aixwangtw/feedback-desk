<?php

namespace App\Console\Commands;

use App\Actions\UpdateFeedbackReportAdjustmentAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackReportWork;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Http\File;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:adjust
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id（網址 /reports/ 後面那段 UUID）；搭配 --by-id 時為資料庫 id}
    {--by-id : 把 report 當資料庫 id（純數字）；未加時純數字會被拒絕}
    {--note= : 調整重點文字；未給則保留原文字，--note="" 會清空}
    {--append : 把 --note 接在既有內容後面（中間空一行）；未加則覆寫}
    {--image=* : 要附上的圖片檔路徑，可重複多次（jpg/png/webp，每張 10 MB 內）}
    {--as= : 以這個團隊個人帳號記錄（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}
    {--force : 別人認領中仍要做（記錄為接手）}')]
#[Description('寫入回饋單的「調整重點」文字與圖片（不改動回饋單狀態）')]
#[Help(<<<'HELP'
寫入回饋單的「調整重點」，客戶與開發團隊都會在回饋單內容下方看到。

  覆寫文字：
    php artisan feedback:adjust my-project 0199c3a1-... --note="已修正登入頁排版"

  追加文字（接在既有內容後、空一行）並附兩張圖：
    php artisan feedback:adjust my-project 0199c3a1-... --append --note="補充：手機版也已調整" --image=/tmp/a.png --image=/tmp/b.png

  只附圖、不動文字：
    php artisan feedback:adjust my-project 0199c3a1-... --image=/tmp/a.png

說明：
  - report 參數用網址裡的 public_id（UUID）。純數字會被拒絕，避免和畫面上的「編號」搞混；要用資料庫 id 請加 --by-id。
  - 圖片會複製到私有儲存，原檔不會被移動或刪除；只有登入的客戶／開發團隊能看。
  - 指令不會改動回饋單狀態；要改狀態用 php artisan feedback:status。
  - 刪除調整圖片請到開發團隊頁面的回饋單詳情操作。
  - 別人認領中的單會停下並說明是誰在處理；確定要接手才加 --force（會記錄）。
HELP)]
class UpdateFeedbackAdjustmentCommand extends Command
{
    use ResolvesFeedbackActor;

    private const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    private const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    public function handle(UpdateFeedbackReportAdjustmentAction $updateAdjustment, FeedbackReportWork $work): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $identifier = (string) $this->argument('report');
        if (ctype_digit($identifier) && ! $this->option('by-id')) {
            $this->components->error('純數字不能直接指定回饋單：請改用 public_id（或加 --by-id 指定資料庫 id）。');

            return self::FAILURE;
        }

        $report = $this->findReport($project, $identifier);
        if (! $report) {
            $this->components->error('這個專案裡找不到該回饋單（請用網址中的 public_id；資料庫 id 請加 --by-id）。');

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
                $this->components->error('調整重點超過 '.UpdateFeedbackReportAdjustmentAction::MAX_NOTE_LENGTH.' 字上限。');

                return self::FAILURE;
            }
            $data['note'] = $note;
            $data['append'] = $append;
        }

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        try {
            $takenOver = $work->guard($report, $actor, (bool) $this->option('force'));
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $report = $updateAdjustment->handle($report, $data, $actor);
        if ($takenOver !== null) {
            $this->components->twoColumnDetail('接手自', OutputFormatter::escape($takenOver));
        }

        $this->components->info('已更新調整重點：'.OutputFormatter::escape($report->title));
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
            ->when(
                $this->option('by-id'),
                fn ($query) => $query->where('id', ctype_digit($identifier) ? (int) $identifier : 0),
                fn ($query) => $query->where('public_id', $identifier),
            )
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
