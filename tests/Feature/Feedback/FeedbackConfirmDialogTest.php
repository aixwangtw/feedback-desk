<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackConfirmText;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * 刪除單、收回留言都先跳確認視窗（網站自己的對話視窗元件，不用瀏覽器 confirm()）；完成、通過不跳。
 */
class FeedbackConfirmDialogTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_delete_dialogs_use_the_shared_component_and_name_the_report(): void
    {
        $project = FeedbackProject::factory()->create(['slug' => 'site']);
        $report = FeedbackReport::factory()->for($project)->create(['title' => '答案存不起來']);
        $token = Str::random(48);
        $project->update(['owner_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.owner.authenticate', $project).'?token='.$token)->assertRedirect();

        $html = $this->get(route('feedback.portal', [$project, 'tab' => 'all']))->assertOk()->getContent();

        $this->assertStringContainsString('id="delete-report-'.$report->public_id.'"', $html);
        $this->assertStringContainsString('「答案存不起來」與它的截圖、留言紀錄會被永久刪除', $html);
        $this->assertStringContainsString('data-confirm-dialog', $html);
        $this->assertStringContainsString('data-confirm-ok', $html);
        $this->assertStringNotContainsString('confirm(', $html);
        $this->assertStringNotContainsString('data-completion-approve-form data-confirm', $html);
    }

    public function test_withdraw_form_carries_the_message_excerpt_for_the_confirm_dialog(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $message = FeedbackMessage::factory()->for($report)->create(['author_type' => FeedbackAuthorType::Reporter, 'body' => "第一行\n第二行說明"]);

        $this->blade('<x-feedback.message-menu :project="$project" :report="$report" :message="$message" />', compact('project', 'report', 'message'))
            ->assertSee('data-message-withdraw-form', false)
            ->assertSee('data-confirm-title="確定要收回這則留言？"', false)
            ->assertSee('「第一行 第二行說明」收回後會直接消失，無法復原。', false)
            ->assertSee('data-confirm-label="確認收回"', false);
    }

    public function test_confirm_texts_live_in_one_class_and_complete_is_not_confirmed(): void
    {
        $texts = new FeedbackConfirmText;

        $this->assertFalse(method_exists($texts, 'completeReport'));
        $this->assertFalse(method_exists($texts, 'approveCompletion'));
        $this->assertSame('danger', $texts->discardDraft()['tone']);
    }
}
