<?php

namespace App\Console\Commands;

use App\Actions\MergeFeedbackReportAction;
use App\Console\Commands\Concerns\ResolvesFeedbackActor;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:merge
    {project : 回報專案 slug（網址 /p/ 後面那段）}
    {duplicate : 要併掉的重複單：public_id，或團隊端清單編號（純數字）}
    {target : 保留的單：public_id，或團隊端清單編號（純數字）}
    {--as= : 以這個團隊個人帳號記錄（或設環境變數 FEEDBACK_DESK_AS）；省略時記成共用團隊身分}
    {--agent= : AI 工具名稱（預設讀 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）}')]
#[Description('把重複的回饋單合併進另一張，輸出合併結果')]
#[Help(<<<'HELP'
把重複的單合併進保留的單，規則與建立單時的自動合併相同。

  把編號 3 併進編號 4：
    php artisan feedback:merge my-project 3 4

合併後：
  - 重複的單記下合併到哪一張，兩端清單、看板、對話面板、計數與巡檢都不再列出（團隊端單頁網址仍可開，顯示「已合併到編號 N」）。
  - 重複單上還沒送出的待審留言搬到保留的單：新留言接進保留單原本那則待審留言（附件超過 5 個或字數超過上限就另存一則），改寫原單留言的草稿改成新留言、各自一則。
  - 重複單開單時附的原始附件搬到保留的單（接在保留單原始附件後面編號）；原本的留言與留言附件留在原單當紀錄。
  - 兩張單的最近動態各記一筆「合併重複的單」（保留單那筆寫出搬來幾個附件）。
  - 不能合併到自己、不同專案、已合併或已刪除的單；客戶看得到的單不能併進客戶看不到的單（團隊內部單、沒分享給客戶的單、公開回報單）。
  - 編號數字是團隊端清單編號（最新為 1，含客戶刪除而隱藏的單）。
  - 團隊端單頁按「還原」可取消合併（搬過去的待審留言與附件不會搬回）。
HELP)]
class MergeFeedbackReportCommand extends Command
{
    use ResolvesFeedbackActor;

    public function handle(MergeFeedbackReportAction $mergeReport): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $duplicate = FeedbackReport::findInProject($project, (string) $this->argument('duplicate'));
        $target = FeedbackReport::findInProject($project, (string) $this->argument('target'));
        if (! $duplicate || ! $target) {
            $this->components->error('這個專案裡找不到'.(! $duplicate ? '要併掉的' : '保留的').'回饋單（請用 public_id 或團隊端清單編號）。');

            return self::FAILURE;
        }

        $actor = $this->resolveActor();
        if ($actor === null) {
            return self::FAILURE;
        }

        $draftCount = $duplicate->messageDrafts()->count();

        try {
            $mergeReport->handle($duplicate, $target, $actor);
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info('已合併重複的單。');
        $this->components->twoColumnDetail('併掉', '編號 '.$duplicate->sequenceNumber().'｜'.OutputFormatter::escape($duplicate->title)." ({$duplicate->public_id})");
        $this->components->twoColumnDetail('保留', '編號 '.$target->sequenceNumber().'｜'.OutputFormatter::escape($target->title)." ({$target->public_id})");
        $this->components->twoColumnDetail('搬過去的待審留言', (string) $draftCount);

        return self::SUCCESS;
    }
}
