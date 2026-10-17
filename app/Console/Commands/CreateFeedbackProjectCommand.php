<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

#[Signature('feedback:project {name} {--slug=} {--repository=} {--automation} {--client-name= : 開發者端顯示的老師名稱}')]
#[Description('建立通用問題回報專案、老師入口與開發者入口')]
class CreateFeedbackProjectCommand extends Command
{
    public function handle(): int
    {
        $name = (string) $this->argument('name');
        $slug = Str::slug((string) ($this->option('slug') ?: $name));
        $repositoryPath = $this->option('repository');
        $automationEnabled = (bool) $this->option('automation');

        if ($slug === '' || FeedbackProject::where('slug', $slug)->exists()) {
            $this->components->error('專案代稱為空白或已經存在。');

            return self::FAILURE;
        }

        if ($automationEnabled && ! config('feedback.automation.enabled')) {
            $this->components->error('請先設定 FEEDBACK_AUTOMATION_ENABLED=true。');

            return self::FAILURE;
        }

        $resolvedRepositoryPath = $this->resolveRepositoryPath($repositoryPath, $automationEnabled);
        if ($automationEnabled && $resolvedRepositoryPath === null) {
            return self::FAILURE;
        }

        $ownerToken = Str::random(48);
        $clientToken = Str::random(48);
        $project = FeedbackProject::create([
            'name' => $name,
            'slug' => $slug,
            'owner_token_hash' => hash('sha256', $ownerToken),
            'client_token_hash' => hash('sha256', $clientToken),
            'client_display_name' => $this->option('client-name') ?: null,
            'repository_path' => $resolvedRepositoryPath,
            'automation_enabled' => $automationEnabled,
        ]);

        $this->components->info("已建立回報專案：{$project->name}");
        $this->line('老師入口：'.route('feedback.client.authenticate', $project).'?token='.$clientToken);
        $this->line('開發者入口：'.route('feedback.owner.authenticate', $project).'?token='.$ownerToken);
        $this->newLine();
        $this->components->warn('私密入口只會顯示這一次，請存入密碼管理器。');

        return self::SUCCESS;
    }

    private function resolveRepositoryPath(mixed $repositoryPath, bool $required): ?string
    {
        if (! is_string($repositoryPath) || $repositoryPath === '') {
            if ($required) {
                $this->components->error('啟用自動處理時必須提供 --repository。');
            }

            return null;
        }

        $resolvedPath = realpath($repositoryPath);
        $workspaceRoot = realpath((string) config('feedback.automation.workspace_root'));
        if ($resolvedPath === false || $workspaceRoot === false) {
            $this->components->error('Repository 或 FEEDBACK_WORKSPACE_ROOT 路徑無效。');

            return null;
        }

        $workspacePrefix = rtrim($workspaceRoot, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR;
        if ($resolvedPath !== $workspaceRoot && ! str_starts_with($resolvedPath, $workspacePrefix)) {
            $this->components->error('Repository 必須位於 FEEDBACK_WORKSPACE_ROOT 之內。');

            return null;
        }

        if (! is_dir($resolvedPath.DIRECTORY_SEPARATOR.'.git')) {
            $this->components->error('Repository 路徑不是 Git repository。');

            return null;
        }

        return $resolvedPath;
    }
}
