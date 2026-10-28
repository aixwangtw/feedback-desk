<?php

namespace App\Console\Commands;

use App\Actions\CreateFeedbackReportAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:create
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {--title= : 回饋單標題（必填，160 字內）}
    {--description= : 回饋單說明（必填，10000 字內）}
    {--category= : 分類（專案有設定分類時必填，且須是其中之一）}
    {--as= : 以這個團隊個人帳號建單（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}')]
#[Description('以開發團隊身分建立回饋單，完成後輸出清單編號與 public_id')]
#[Help(<<<'HELP'
以開發團隊身分建立一張回饋單（建立者記成共用團隊身分，或 --as 指定的團隊個人帳號）。

  php artisan feedback:create my-project --title="匯出可顯示出處" --description="老師希望匯出時帶出學校"

  指定分類與個人帳號：
    php artisan feedback:create my-project --title="..." --description="..." --category=功能建議 --as=alex

說明：
  - 專案沒有設定分類時不能給 --category；有設定時必填。
  - 輸出的「編號」是開發團隊頁面的清單編號（會隨新單變動），穩定指定請用 public_id。
HELP)]
class CreateFeedbackReportCommand extends Command
{
    use ResolvesFeedbackActor;

    public function handle(CreateFeedbackReportAction $createFeedbackReport): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $title = trim((string) $this->option('title'));
        $description = trim((string) $this->option('description'));
        if ($title === '' || $description === '') {
            $this->components->error('請用 --title 與 --description 提供標題和說明。');

            return self::FAILURE;
        }

        if (mb_strlen($title) > 160) {
            $this->components->error('標題不能超過 160 字。');

            return self::FAILURE;
        }

        if (mb_strlen($description) > 10000) {
            $this->components->error('說明不能超過 10000 字。');

            return self::FAILURE;
        }

        $category = trim((string) $this->option('category'));
        $categories = $project->reportCategories();
        if ($categories === [] && $category !== '') {
            $this->components->error('這個專案沒有設定分類，不能給 --category。');

            return self::FAILURE;
        }

        if ($categories !== [] && ! in_array($category, $categories, true)) {
            $this->components->error('請用 --category 指定分類，可用值：'.implode('、', $categories));

            return self::FAILURE;
        }

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        $creator = $actor->developer !== null
            ? ['creator_type' => FeedbackCreatorType::Developer, 'creator_developer_id' => $actor->developer->id, 'creator_client_account_id' => null]
            : ['creator_type' => FeedbackCreatorType::OwnerShared, 'creator_developer_id' => null, 'creator_client_account_id' => null];

        $report = $createFeedbackReport->handle($project, [
            'title' => $title,
            'description' => $description,
            'category' => $category !== '' ? $category : null,
        ], $creator, $actor)['report'];

        $this->components->info('已建立：'.OutputFormatter::escape($report->title));
        $this->components->twoColumnDetail('編號', (string) ($report->sequenceNumber()));
        $this->components->twoColumnDetail('public_id', $report->public_id);
        $this->line(route('feedback.reports.show', [$project, $report]));

        return self::SUCCESS;
    }
}
