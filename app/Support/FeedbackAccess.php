<?php

namespace App\Support;

use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Contracts\Session\Session;

class FeedbackAccess
{
    public function __construct(private Session $session) {}

    public function grantOwner(FeedbackProject $project): void
    {
        $this->session->put($this->ownerKey($project), true);
    }

    public function grantReporter(FeedbackReport $report): void
    {
        $this->session->put($this->reportKey($report), true);
    }

    public function grantClient(FeedbackProject $project): void
    {
        $this->session->put($this->clientKey($project), true);
    }

    public function isOwner(FeedbackProject $project): bool
    {
        return (bool) $this->session->get($this->ownerKey($project), false);
    }

    public function isClient(FeedbackProject $project): bool
    {
        return (bool) $this->session->get($this->clientKey($project), false);
    }

    public function canManage(FeedbackProject $project): bool
    {
        return $this->isOwner($project) || $this->isClient($project);
    }

    public function canView(FeedbackReport $report): bool
    {
        return $this->isOwner($report->feedbackProject)
            || $this->isClient($report->feedbackProject)
            || (bool) $this->session->get($this->reportKey($report), false);
    }

    public function validateOwnerToken(FeedbackProject $project, string $token): bool
    {
        return hash_equals($project->owner_token_hash, hash('sha256', $token));
    }

    public function validateReporterToken(FeedbackReport $report, string $token): bool
    {
        return hash_equals($report->reporter_token_hash, hash('sha256', $token));
    }

    public function validateClientToken(FeedbackProject $project, string $token): bool
    {
        return is_string($project->client_token_hash)
            && hash_equals($project->client_token_hash, hash('sha256', $token));
    }

    private function ownerKey(FeedbackProject $project): string
    {
        return "feedback.owner.{$project->id}";
    }

    private function clientKey(FeedbackProject $project): string
    {
        return "feedback.client.{$project->id}";
    }

    private function reportKey(FeedbackReport $report): string
    {
        return "feedback.reporter.{$report->id}";
    }
}
