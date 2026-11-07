<?php

namespace App\Console\Commands;

use App\Actions\ManageFeedbackMessageAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Console\Commands\Concerns\ValidatesFeedbackImageFiles;
use App\Models\FeedbackProject;
use App\Support\FeedbackAttachmentRules;
use App\Support\FeedbackServiceException;
use App\Support\StandardInput;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:message-edit
    {project : 回報專案 slug}
    {report : 回饋單 public_id}
    {message : 留言 id（feedback:show 的 messages 裡看得到）}
    {--text= : 新的留言內容；未給時從標準輸入讀取}
    {--attach=* : '.FeedbackAttachmentRules::CLI_ATTACH_HELP.'}
    {--remove=* : 要移除的附件 id}
    {--as= : 以這個團隊個人帳號編輯（或設環境變數 FEEDBACK_DESK_AS）}
    {--agent= : AI 工具名稱}')]
#[Description('編輯團隊身分發的留言（任何開發者都可以；不顯示「已編輯」、不改單的狀態）')]
class EditFeedbackMessageCommand extends Command
{
    use ResolvesFeedbackActor;
    use ValidatesFeedbackImageFiles;

    public function handle(ManageFeedbackMessageAction $manage, StandardInput $standardInput): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        $report = $project?->feedbackReports()->where('public_id', trim((string) $this->argument('report')))->first();
        if ($report === null) {
            $this->components->error('找不到這個專案裡的回饋單（report 請用 public_id）。');

            return self::FAILURE;
        }
        $message = ctype_digit((string) $this->argument('message')) ? $report->feedbackMessages()->whereKey((int) $this->argument('message'))->first() : null;
        if ($message === null) {
            $this->components->error('找不到這則留言。');

            return self::FAILURE;
        }
        $body = trim((string) ($this->option('text') ?? $standardInput->read() ?? ''));
        $images = $this->validatedImageFiles((array) $this->option('attach'), allowVideo: true);
        $actor = $this->resolveActor();
        if ($images === null || $actor === null) {
            return self::FAILURE;
        }

        try {
            $manage->edit($report, $message, $actor, $body, $images, array_map('intval', (array) $this->option('remove')));
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已更新留言 '.$message->id.'。');

        return self::SUCCESS;
    }
}
