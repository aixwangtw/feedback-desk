<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * 目前認領這張單的人與 AI 工具。
 */
final readonly class FeedbackClaimHolder
{
    public function __construct(
        public int $developerId,
        public string $name,
        public ?string $agent,
        public Carbon $since,
    ) {}

    public function label(): string
    {
        return FeedbackAgentName::label($this->name, $this->agent, true);
    }

    /**
     * 「王小明（Codex）（2026/10/20 14:05 開始）」，台北時間。
     */
    public function describe(): string
    {
        return $this->label().'（'.$this->since->copy()->timezone('Asia/Taipei')->format('Y/m/d H:i').' 開始）';
    }
}
