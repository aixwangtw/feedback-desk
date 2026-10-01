<?php

namespace App\Support;

use App\Enums\FeedbackAutomationStatus;

readonly class FeedbackCodingResult
{
    /** @param list<string> $tests */
    public function __construct(
        public FeedbackAutomationStatus $status,
        public string $summary,
        public array $tests = [],
        public ?int $exitCode = null,
        public ?string $tracePath = null,
    ) {}

    /** @return array{outcome: string, summary: string, tests: list<string>} */
    public function toArray(): array
    {
        return [
            'outcome' => $this->status->value,
            'summary' => $this->summary,
            'tests' => $this->tests,
        ];
    }
}
