<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

#[Signature('feedback:client-link {project : 回報專案 slug}')]
#[Description('建立或更新老師的私密問題清單入口')]
class CreateFeedbackClientLinkCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();

        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $clientToken = Str::random(48);
        $project->update(['client_token_hash' => hash('sha256', $clientToken)]);

        $this->components->info("已建立老師入口：{$project->name}");
        $this->line(route('feedback.client.authenticate', $project).'?token='.$clientToken);
        $this->components->warn('舊的老師入口已失效，請安全保存新連結。');

        return self::SUCCESS;
    }
}
