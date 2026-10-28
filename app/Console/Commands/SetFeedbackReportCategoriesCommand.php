<?php

namespace App\Console\Commands;

use App\Http\Controllers\Feedback\FeedbackProjectSettingsController;
use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:categories {project : 專案 slug，all 代表所有專案} {categories? : 逗號分隔的分類；省略時只顯示目前設定} {--clear : 清除分類（不顯示分類欄位）}')]
#[Description('查看或設定專案的開單分類')]
class SetFeedbackReportCategoriesCommand extends Command
{
    public function handle(): int
    {
        $slug = (string) $this->argument('project');
        $projects = $slug === 'all'
            ? FeedbackProject::orderBy('id')->get()
            : FeedbackProject::where('slug', $slug)->get();
        if ($projects->isEmpty()) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        $input = $this->argument('categories');
        if ($input === null && ! $this->option('clear')) {
            foreach ($projects as $project) {
                $categories = $project->reportCategories();
                $this->line("{$project->slug}：".($categories === [] ? '（未設定，不分類）' : implode(',', $categories)));
            }

            return self::SUCCESS;
        }

        $categories = $this->option('clear') ? [] : FeedbackProjectSettingsController::parse((string) $input);
        $problem = FeedbackProjectSettingsController::problem($categories);
        if ($problem !== null) {
            $this->components->error($problem);

            return self::FAILURE;
        }

        foreach ($projects as $project) {
            $project->update(['report_categories' => $categories === [] ? null : $categories]);
            $this->components->info("{$project->slug}：".($categories === [] ? '已清除分類' : '分類設為 '.implode(',', $categories)));
        }

        return self::SUCCESS;
    }
}
