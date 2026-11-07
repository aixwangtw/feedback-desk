<?php

namespace App\Console\Commands;

use App\Actions\ManageFeedbackMessageAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:message-withdraw
    {project : 回報專案 slug}
    {report : 回饋單 public_id}
    {message : 留言 id}
    {--as= : 以這個團隊個人帳號收回（或設環境變數 FEEDBACK_DESK_AS）}
    {--agent= : AI 工具名稱}')]
#[Description('收回團隊身分發的留言（客戶端的畫面、API、未讀數、通知都看不到任何痕跡；資料庫軟刪除，救得回來）')]
class WithdrawFeedbackMessageCommand extends Command
{
    use ResolvesFeedbackActor;

    public function handle(ManageFeedbackMessageAction $manage): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        $report = $project?->feedbackReports()->where('public_id', trim((string) $this->argument('report')))->first();
        if ($report === null) {
            $this->components->error('找不到這個專案裡的回饋單（report 請用 public_id）。');

            return self::FAILURE;
        }
        $message = ctype_digit((string) $this->argument('message')) ? $report->feedbackMessages()->whereKey((int) $this->argument('message'))->first() : null;
        $actor = $this->resolveActor();
        if ($message === null || $actor === null) {
            $message === null && $this->components->error('找不到這則留言。');

            return self::FAILURE;
        }

        try {
            $manage->withdraw($report, $message, $actor);
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已收回留言 '.$message->id.'。');

        return self::SUCCESS;
    }
}
