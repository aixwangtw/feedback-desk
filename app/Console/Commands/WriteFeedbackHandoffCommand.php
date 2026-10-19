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

#[Signature('feedback:handoff
    {project : 回報專案 slug}
    {report : 回饋單 public_id，或團隊端清單編號（純數字）}
    {--note= : 交接內容：做到哪、改了哪些檔案或分支、下一步、注意事項}
    {--release : 一併釋放自己的認領}
    {--as= : 團隊個人帳號（必填，或設環境變數 FEEDBACK_DESK_AS）}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}')]
#[Description('寫交接紀錄（只有團隊看得到），下一個人或 AI 讀單時會先看到')]
#[Help(<<<'HELP'
工作中斷時（額度用完、要換人或換 AI）留下進度筆記。不要寫入密碼、token 等祕密。

  php artisan feedback:handoff my-project 0199c3a1-... --as=alex --note="已改好列表頁，下一步改手機版" --release
HELP)]
class WriteFeedbackHandoffCommand extends Command
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
            $result = $work->handoff($report, $actor, (string) $this->option('note'), (bool) $this->option('release'));
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已儲存交接紀錄：'.OutputFormatter::escape($report->title));
        if ($result['released']) {
            $this->components->twoColumnDetail('認領', '已釋放');
        }

        return self::SUCCESS;
    }
}
