<?php

namespace App\Console\Commands;

use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackReportWork;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:claim
    {project : 回報專案 slug}
    {report : 回饋單 public_id，或團隊端清單編號（純數字）}
    {--as= : 團隊個人帳號（必填，或設環境變數 FEEDBACK_DESK_AS）}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}
    {--force : 別人認領中仍要接手（會記錄）}')]
#[Description('認領回饋單，讓其他人與 AI 知道誰在處理')]
#[Help(<<<'HELP'
認領一張單。別人認領中會停下並說明是誰、何時開始；先看交接紀錄（feedback:report），確定要接手才加 --force。

  php artisan feedback:claim my-project 0199c3a1-... --as=alex
HELP)]
class ClaimFeedbackReportCommand extends Command
{
    use ResolvesFeedbackActor;

    public function handle(FeedbackReportWork $work): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        $report = $project ? FeedbackReport::findInProject($project, (string) $this->argument('report')) : null;
        if ($report === null) {
            $this->components->error('找不到回報專案或回饋單（請用 public_id 或團隊端清單編號）。');

            return self::FAILURE;
        }

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        try {
            $result = $work->claim($report, $actor, (bool) $this->option('force'));
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已認領：'.OutputFormatter::escape($report->title));
        $this->components->twoColumnDetail('認領者', OutputFormatter::escape($result['claimed_by']));
        if ($result['took_over_from'] !== null) {
            $this->components->twoColumnDetail('接手自', OutputFormatter::escape($result['took_over_from']));
        }

        return self::SUCCESS;
    }
}
