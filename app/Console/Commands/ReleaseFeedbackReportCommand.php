<?php

namespace App\Console\Commands;

use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackReportWork;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:release
    {project : 回報專案 slug}
    {report : 回饋單 public_id，或團隊端清單編號（純數字）}
    {--as= : 團隊個人帳號（必填，或設環境變數 FEEDBACK_DESK_AS）}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}
    {--force : 替別人釋放（會記錄）}')]
#[Description('釋放自己對回饋單的認領')]
class ReleaseFeedbackReportCommand extends Command
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
            $released = $work->release($report, $actor, (bool) $this->option('force'));
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info(($released ? '已釋放認領：' : '這張單沒有人認領：').OutputFormatter::escape($report->title));

        return self::SUCCESS;
    }
}
