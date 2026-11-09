<?php

namespace App\Console\Commands;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Feedback\FeedbackProjectSettingsController;
use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:status-labels {project : 專案 slug} {--new= : new 狀態的顯示名稱} {--needs-input= : needs_input 狀態的顯示名稱} {--completed= : completed 狀態的顯示名稱} {--clear : 清除自訂名稱，沿用全站名稱}')]
#[Description('查看或設定專案自訂的狀態顯示名稱（沒設定的狀態沿用全站名稱）')]
class SetFeedbackStatusLabelsCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if (! $project) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        $options = [
            FeedbackReportStatus::New->value => $this->option('new'),
            FeedbackReportStatus::NeedsInput->value => $this->option('needs-input'),
            FeedbackReportStatus::Completed->value => $this->option('completed'),
        ];

        if ($this->option('clear') || array_filter($options, fn (mixed $label): bool => $label !== null) !== []) {
            $labels = $this->option('clear') ? [] : $project->statusLabelOverrides();
            foreach ($options as $value => $label) {
                if ($label === null) {
                    continue;
                }
                $label = trim((string) $label);
                if (mb_strlen($label) > FeedbackProjectSettingsController::MAX_STATUS_LABEL_LENGTH) {
                    $this->components->error('名稱太長，每個最多 '.FeedbackProjectSettingsController::MAX_STATUS_LABEL_LENGTH.' 字。');

                    return self::FAILURE;
                }
                if ($label === '') {
                    unset($labels[$value]);
                } else {
                    $labels[$value] = $label;
                }
            }
            $project->update(['status_labels' => $labels === [] ? null : $labels]);
        }

        foreach (FeedbackReportStatus::cases() as $status) {
            $custom = array_key_exists($status->value, $project->statusLabelOverrides()) ? '（自訂）' : '（沿用全站）';
            $this->line("{$project->slug} {$status->value}：{$status->label($project)}{$custom}");
        }

        return self::SUCCESS;
    }
}
