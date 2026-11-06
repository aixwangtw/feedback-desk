<?php

namespace App\Console\Commands;

use App\Actions\RequestFeedbackCompletionAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Support\FeedbackCompletionRequest;
use App\Support\FeedbackReportWork;
use App\Support\FeedbackServiceException;
use App\Support\StandardInput;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:request-completion
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {report : 回饋單 public_id（網址 /reports/ 後面那段 UUID）}
    {--text= : 確認留言內容；未給時從標準輸入讀取，都沒有就用預設文字}
    {--as= : 以這個團隊個人帳號留言（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}
    {--force : 別人認領中仍要做（記錄為接手）}')]
#[Description('請客戶確認完成：只發一則附「通過」按鈕的確認留言，單維持等客戶，不會直接結案')]
#[Help(<<<'HELP'
請客戶確認這張單已完成。只會發出一則確認留言（客戶端留言上有「通過」按鈕），單的狀態維持等客戶；
要客戶按「通過」才會變成已完成。這個指令不能直接結案，已完成的單會被拒絕。

  用預設文字：
    php artisan feedback:request-completion my-project 0199c3a1-...

  自己寫文字：
    php artisan feedback:request-completion my-project 0199c3a1-... --text="已修好，請看一下登入頁"

說明：
  - 只在確實修好且驗過畫面後使用。
  - report 只接受 public_id；純數字會被拒絕。
  - 別人認領中的單會停下並說明是誰在處理；確定要接手才加 --force（會記錄）。
HELP)]
class RequestFeedbackCompletionCommand extends Command
{
    use ResolvesFeedbackActor;

    public function handle(RequestFeedbackCompletionAction $requestCompletion, FeedbackReportWork $work, StandardInput $standardInput): int
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

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        $text = $this->option('text');
        $body = trim((string) ($text ?? $standardInput->read() ?? ''));

        try {
            $takenOver = $work->guard($report, $actor, (bool) $this->option('force'));
            $message = $requestCompletion->handle($report, $actor, $body === '' ? null : $body);
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已請確認完成：'.OutputFormatter::escape($report->title));
        if ($takenOver !== null) {
            $this->components->twoColumnDetail('接手自', OutputFormatter::escape($takenOver));
        }
        $this->components->twoColumnDetail('留言 id', (string) $message->id);
        $this->components->twoColumnDetail('目前狀態', $report->status->label());
        $this->components->warn(FeedbackCompletionRequest::sentNotice());
        $this->line(route('feedback.reports.show', [$project, $report]));

        return self::SUCCESS;
    }
}
