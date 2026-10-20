<?php

namespace App\Console\Commands;

use App\Actions\PostFeedbackMessageAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Support\StandardInput;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Http\UploadedFile;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:message
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id（網址 /reports/ 後面那段 UUID）}
    {--text= : 留言內容；未給時從標準輸入讀取}
    {--file=* : 要附上的圖片檔路徑，可重複多次（jpg/png/webp，每張 10 MB 內，最多 5 張）}
    {--as= : 以這個團隊個人帳號留言（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}')]
#[Description('以開發團隊身分在回饋單留言（可附圖，不改動回饋單狀態），完成後輸出留言 id')]
#[Help(<<<'HELP'
以開發團隊身分在回饋單留言，客戶端會看到這則留言並出現紅色未讀數字。

  直接給文字：
    php artisan feedback:message my-project 0199c3a1-... --text="已修正，請再試一次"

  從標準輸入讀文字（適合多行或經 ssh 傳入）：
    printf '已修正\n請再試一次' | php artisan feedback:message my-project 0199c3a1-...

  附圖：
    php artisan feedback:message my-project 0199c3a1-... --text="修正後畫面" --file=/tmp/after.png

說明：
  - report 只接受 public_id；純數字會被拒絕，避免和畫面上的「編號」搞混。
  - 留言前後的空白會去掉；空白留言會被拒絕。
  - 指令不會改動回饋單狀態；要改狀態用 php artisan feedback:status。
HELP)]
class PostFeedbackMessageCommand extends Command
{
    use ResolvesFeedbackActor;

    private const MAX_IMAGES = 5;

    private const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    private const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    public function handle(PostFeedbackMessageAction $postMessage, StandardInput $standardInput): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $identifier = trim((string) $this->argument('report'));
        if (ctype_digit($identifier)) {
            $this->components->error('純數字不能指定回饋單：請改用網址中的 public_id。');

            return self::FAILURE;
        }

        $report = $project->feedbackReports()->where('public_id', $identifier)->first();
        if (! $report) {
            $this->components->error('這個專案裡找不到該回饋單（請用網址中的 public_id）。');

            return self::FAILURE;
        }

        $text = $this->option('text');
        $body = trim((string) ($text ?? $standardInput->read() ?? ''));
        if ($body === '') {
            $this->components->error('請用 --text 或從標準輸入提供留言內容。');

            return self::FAILURE;
        }

        if (mb_strlen($body) > PostFeedbackMessageAction::MAX_BODY_LENGTH) {
            $this->components->error('留言內容不能超過 '.PostFeedbackMessageAction::MAX_BODY_LENGTH.' 字。');

            return self::FAILURE;
        }

        $imagePaths = array_values(array_filter((array) $this->option('file'), fn ($path) => $path !== null && $path !== ''));
        if (count($imagePaths) > self::MAX_IMAGES) {
            $this->components->error('一次最多附 '.self::MAX_IMAGES.' 張圖。');

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

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        $message = $postMessage->handle($report, $actor, $body, $images);

        $this->components->info('已留言：'.OutputFormatter::escape($report->title));
        $this->components->twoColumnDetail('留言 id', (string) $message->id);
        $this->components->twoColumnDetail('附圖', (string) count($images));
        $this->line(route('feedback.reports.show', [$project, $report]));

        return self::SUCCESS;
    }

    /**
     * 檢查圖片後包成上傳檔交給留言動作；原檔只會被複製，不會移動或刪除。
     */
    private function validatedImage(string $path): ?UploadedFile
    {
        if (! is_file($path) || ! is_readable($path)) {
            $this->components->error("找不到或無法讀取圖片：{$path}");

            return null;
        }

        $mime = mime_content_type($path) ?: '';
        if (! in_array($mime, self::ALLOWED_MIME_TYPES, true) || @getimagesize($path) === false) {
            $this->components->error("只接受 jpg／png／webp 圖片：{$path}");

            return null;
        }

        if (filesize($path) > self::MAX_IMAGE_BYTES) {
            $this->components->error("圖片超過 10 MB：{$path}");

            return null;
        }

        return new UploadedFile($path, basename($path), $mime, null, true);
    }
}
