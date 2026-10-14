<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackProject;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class FeedbackOwnerLinkCommandTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_owner_link_replaces_the_previous_owner_token(): void
    {
        $project = FeedbackProject::factory()->create();
        $previousHash = $project->owner_token_hash;

        $this->assertSame(0, Artisan::call('feedback:owner-link', ['project' => $project->slug]));

        preg_match('/\?token=(\S+)/', Artisan::output(), $matches);
        $ownerToken = $matches[1] ?? '';

        $project->refresh();
        $this->assertNotSame($previousHash, $project->owner_token_hash);
        $this->assertSame(hash('sha256', $ownerToken), $project->owner_token_hash);

        $this->get(route('feedback.owner.authenticate', $project).'?token='.$ownerToken)
            ->assertRedirect(route('feedback.owner.index', $project));
        $this->get(route('feedback.owner.index', $project))->assertOk();
    }

    public function test_owner_link_fails_for_unknown_project(): void
    {
        $this->artisan('feedback:owner-link', ['project' => 'missing'])
            ->expectsOutputToContain('找不到回報專案')
            ->assertFailed();
    }
}
