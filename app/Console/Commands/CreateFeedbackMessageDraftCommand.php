<?php

namespace App\Console\Commands;

use App\Actions\ManageFeedbackMessageDraftAction;
use App\Actions\PostFeedbackMessageAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Console\Commands\Concerns\ValidatesFeedbackImageFiles;
use App\Models\FeedbackProject;
use App\Support\FeedbackServiceException;
use App\Support\StandardInput;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:draft
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id（網址 /reports/ 後面那段 UUID）}
    {--text= : 待審留言內容；未給時從標準輸入讀取}
    {--replace-message= : 要修改的團隊留言 id；送出時改寫那則留言，不新增一則}
    {--attach=* : 要附上的圖片檔路徑，可重複多次（jpg/png/webp，每張 10 MB 內，最多 5 張）}
    {--as= : 以這個團隊個人帳號寫草稿（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}')]
#[Description('新增待審留言（草稿）：只有開發團隊看得到，團隊在單頁按「送出」才會發給客戶，完成後輸出草稿 id')]
#[Help(<<<'HELP'
新增一則待審留言。客戶端完全看不到、不算未讀；開發團隊打開這張單時，留言區會列出草稿，可以編輯、送出或捨棄。

  一般草稿（送出時新增一則留言）：
    php artisan feedback:draft my-project 0199c3a1-... --text="已修正，請再試一次"

  修改原留言（送出時改寫那則團隊留言，不新增）：
    php artisan feedback:draft my-project 0199c3a1-... --text="更正後的說明" --replace-message=123

  附圖：
    php artisan feedback:draft my-project 0199c3a1-... --text="修正後畫面" --attach=/tmp/after.png

說明：
  - report 只接受 public_id；純數字會被拒絕。
  - --replace-message 只能指定這張單上的團隊留言。
HELP)]
class CreateFeedbackMessageDraftCommand extends Command
{
    use ResolvesFeedbackActor;
    use ValidatesFeedbackImageFiles;

    public function handle(ManageFeedbackMessageDraftAction $drafts, StandardInput $standardInput): int
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
            $this->components->error('請用 --text 或從標準輸入提供待審留言內容。');

            return self::FAILURE;
        }
        if (mb_strlen($body) > PostFeedbackMessageAction::MAX_BODY_LENGTH) {
            $this->components->error('留言內容不能超過 '.PostFeedbackMessageAction::MAX_BODY_LENGTH.' 字。');

            return self::FAILURE;
        }

        $replace = $this->option('replace-message');
        if ($replace !== null && ! ctype_digit((string) $replace)) {
            $this->components->error('--replace-message 要填留言 id（數字）。');

            return self::FAILURE;
        }

        $images = $this->validatedImageFiles((array) $this->option('attach'));
        if ($images === null) {
            return self::FAILURE;
        }

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        try {
            $draft = $drafts->create($report, $actor, $body, $replace !== null ? (int) $replace : null, $images);
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已新增待審留言：'.OutputFormatter::escape($report->title));
        $this->components->twoColumnDetail('草稿 id', (string) $draft->id);
        $this->components->twoColumnDetail('修改原留言', $draft->replaces_message_id !== null ? (string) $draft->replaces_message_id : '否（送出時新增一則）');
        $this->components->twoColumnDetail('附圖', (string) count($images));
        $this->line(route('feedback.reports.show', [$project, $report]));

        return self::SUCCESS;
    }
}
