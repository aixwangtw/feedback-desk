<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackAgentName;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeedbackDeveloperAgentLabelTest extends TestCase
{
    use RefreshDatabase;

    public function test_label_hides_agent_only_for_developer_side(): void
    {
        $this->assertSame('開發者', FeedbackAgentName::label('開發者', 'Claude Code', true));
        $this->assertSame('王小明（Codex）', FeedbackAgentName::label('王小明', 'Codex'));
        $this->assertSame('王小明', FeedbackAgentName::label('王小明', null));
    }

    public function test_developer_side_actors_show_name_only_and_clients_keep_agent(): void
    {
        $developer = FeedbackDeveloper::factory()->create(['name' => '王小明']);
        $client = FeedbackClientAccount::factory()->create(['name' => '陳老師']);

        $this->assertSame((string) config('feedback.labels.owner'), FeedbackActor::sharedOwner('Claude Code')->label());
        $this->assertSame('王小明', FeedbackActor::developer($developer, 'Claude Code')->label());
        $this->assertSame('陳老師（Codex）', FeedbackActor::client($client, 'Codex')->label());
    }

    public function test_report_creator_and_messages_follow_the_same_rule(): void
    {
        $project = FeedbackProject::factory()->create();
        $client = FeedbackClientAccount::factory()->create(['feedback_project_id' => $project->id, 'name' => '陳老師']);
        $developer = FeedbackDeveloper::factory()->create(['name' => '王小明']);

        $ownerReport = FeedbackReport::factory()->for($project, 'feedbackProject')->create([
            'creator_type' => FeedbackCreatorType::OwnerShared,
            'creator_agent' => 'Claude Code',
        ]);
        $this->assertStringNotContainsString('Claude Code', $ownerReport->creatorLabel());

        $clientReport = FeedbackReport::factory()->for($project, 'feedbackProject')->create([
            'creator_type' => FeedbackCreatorType::Client,
            'creator_client_account_id' => $client->id,
            'creator_agent' => 'Codex',
        ]);
        $this->assertSame('陳老師（Codex）', $clientReport->creatorLabel());

        $ownerMessage = FeedbackMessage::factory()->for($ownerReport, 'feedbackReport')->create([
            'author_type' => FeedbackAuthorType::Owner,
            'author_name' => '開發者',
            'author_agent' => 'Claude Code',
        ]);
        $this->assertSame('開發者', $ownerMessage->displayAuthor($ownerReport, true));

        $developerMessage = FeedbackMessage::factory()->for($ownerReport, 'feedbackReport')->create([
            'author_type' => FeedbackAuthorType::Owner,
            'author_developer_id' => $developer->id,
            'author_agent' => 'Claude Code',
        ]);
        $this->assertSame('王小明', $developerMessage->displayAuthor($ownerReport, true));

        $clientMessage = FeedbackMessage::factory()->for($clientReport, 'feedbackReport')->create([
            'author_type' => FeedbackAuthorType::Reporter,
            'author_client_account_id' => $client->id,
            'author_agent' => 'Codex',
        ]);
        $this->assertSame('陳老師（Codex）', $clientMessage->displayAuthor($clientReport, true));
    }
}
