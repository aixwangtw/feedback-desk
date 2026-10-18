<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

#[Signature('feedback:owner-link {project : 回報專案 slug}')]
#[Description('重新產生開發團隊的私密管理入口')]
class CreateFeedbackOwnerLinkCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();

        if (! $project) {
            $this->components->error('找不到回報專案。');

            return self::FAILURE;
        }

        $ownerToken = Str::random(48);
        $project->update(['owner_token_hash' => hash('sha256', $ownerToken)]);

        $this->components->info("已建立開發團隊入口：{$project->name}");
        $this->line(route('feedback.owner.authenticate', $project).'?token='.$ownerToken);
        $this->components->warn('舊的開發團隊入口已失效，請安全保存新連結。');

        return self::SUCCESS;
    }
}
