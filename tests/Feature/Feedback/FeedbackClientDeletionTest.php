<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackClientDeletionTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    private string $clientToken;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->clientToken = Str::random(48);
        $this->ownerToken = Str::random(48);
        $this->project = FeedbackProject::factory()->create([
            'client_token_hash' => hash('sha256', $this->clientToken),
            'owner_token_hash' => hash('sha256', $this->ownerToken),
        ]);
    }

    public function test_teacher_can_delete_a_report_of_any_status_and_it_disappears_for_them(): void
    {
        foreach (FeedbackReportStatus::cases() as $status) {
            $report = FeedbackReport::factory()->for($this->project)->create([
                'title' => "要刪除的問題 {$status->value}",
                'status' => $status,
            ]);
            $this->actingAsTeacher();

            $this->delete(route('feedback.reports.client-destroy', [$this->project, $report]))
                ->assertRedirect(route('feedback.portal', $this->project))
                ->assertSessionHas('success');

            $this->assertNotNull($report->refresh()->client_deleted_at);
            $this->assertModelExists($report);
            $this->get(route('feedback.portal', $this->project))
                ->assertOk()
                ->assertDontSee('data-report-row="'.$report->public_id.'"', false);
        }
    }

    public function test_teacher_sees_a_confirmation_dialog_before_deleting(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $this->actingAsTeacher();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-dialog-open="client-delete-report-'.$report->public_id.'"', false)
            ->assertSee('確定刪除？')
            ->assertSee('action="'.route('feedback.reports.client-destroy', [$this->project, $report]).'"', false);
    }

    public function test_deleted_report_is_hidden_everywhere_for_the_teacher(): void
    {
        $visible = FeedbackReport::factory()->for($this->project)->create(['status' => FeedbackReportStatus::New]);
        $deleted = FeedbackReport::factory()->for($this->project)->create([
            'title' => '老師刪掉的',
            'status' => FeedbackReportStatus::Completed,
            'client_deleted_at' => now(),
        ]);
        Storage::disk('local')->put('feedback/deleted.png', 'image');
        $attachment = FeedbackAttachment::factory()->for($deleted)->create(['path' => 'feedback/deleted.png']);
        $this->actingAsTeacher();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertDontSee('老師刪掉的')
            ->assertSee('共 1 題')
            ->assertDontSee('data-deleted-filter', false)
            ->assertDontSee('已完成 1 題');
        $this->get(route('feedback.portal', $this->project).'?deleted=only')->assertDontSee('老師刪掉的');

        $this->get(route('feedback.reports.show', [$this->project, $deleted]))->assertNotFound();
        $this->get(route('feedback.reports.activity', [$this->project, $deleted]))->assertNotFound();
        $this->get(route('feedback.attachments.show', [$this->project, $deleted, $attachment]))->assertNotFound();
        $this->post(route('feedback.messages.store', [$this->project, $deleted]), ['body' => '留言'])->assertNotFound();
        $this->put(route('feedback.reports.update', [$this->project, $deleted]), [
            'title' => '改標題',
            'description' => '改內容',
        ])->assertNotFound();
        $this->patchJson(route('feedback.reports.status.update', [$this->project, $deleted]), [
            'status' => FeedbackReportStatus::New->value,
        ])->assertNotFound();
        $this->delete(route('feedback.reports.client-destroy', [$this->project, $deleted]))->assertNotFound();
        $this->patch(route('feedback.reports.restore', [$this->project, $deleted]))->assertForbidden();

        $this->patchJson(route('feedback.reports.status.update', [$this->project, $visible]), [
            'status' => FeedbackReportStatus::NeedsInput->value,
        ])->assertOk()->assertJsonPath('counts', [FeedbackReportStatus::NeedsInput->value => 1]);

        $this->assertSame('老師刪掉的', $deleted->refresh()->title);
        $this->assertNotNull($deleted->client_deleted_at);
    }

    public function test_reporter_tracking_link_cannot_reach_a_deleted_report(): void
    {
        $token = Str::random(48);
        $report = FeedbackReport::factory()->for($this->project)->create([
            'reporter_token_hash' => hash('sha256', $token),
            'client_deleted_at' => now(),
        ]);

        $this->get(route('feedback.reports.show', [$this->project, $report]).'?access='.$token)->assertNotFound();
    }

    public function test_owner_sees_deleted_reports_with_a_label_and_can_filter(): void
    {
        FeedbackReport::factory()->for($this->project)->create(['title' => '還在的問題']);
        $deleted = FeedbackReport::factory()->for($this->project)->create([
            'title' => '老師刪掉的',
            'client_deleted_at' => now()->subHour(),
        ]);
        $this->actingAsEngineer();

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('還在的問題')
            ->assertSee('老師刪掉的')
            ->assertSee('老師已刪除')
            ->assertSee('共 2 題')
            ->assertSee('data-deleted-filter', false)
            ->assertSee('action="'.route('feedback.reports.restore', [$this->project, $deleted]).'"', false);

        $this->get(route('feedback.portal', $this->project).'?deleted=only')
            ->assertSee('老師刪掉的')
            ->assertDontSee('還在的問題');
        $this->get(route('feedback.portal', $this->project).'?deleted=hide')
            ->assertSee('還在的問題')
            ->assertDontSee('老師刪掉的');

        $this->get(route('feedback.reports.show', [$this->project, $deleted]))
            ->assertOk()
            ->assertSee('老師已刪除');
    }

    public function test_owner_can_restore_and_teacher_sees_the_report_again(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create([
            'title' => '要還原的問題',
            'client_deleted_at' => now(),
        ]);
        $this->actingAsEngineer();

        $this->patch(route('feedback.reports.restore', [$this->project, $report]))
            ->assertRedirect()
            ->assertSessionHas('success');
        $this->assertNull($report->refresh()->client_deleted_at);

        $this->flushTestAccess();
        $this->actingAsTeacher();
        $this->get(route('feedback.portal', $this->project))->assertSee('要還原的問題');
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertOk();
    }

    public function test_only_teacher_can_soft_delete_and_only_owner_can_restore(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $deleted = FeedbackReport::factory()->for($this->project)->create(['client_deleted_at' => now()]);

        $this->delete(route('feedback.reports.client-destroy', [$this->project, $report]))
            ->assertRedirect(route('feedback.login', $this->project));
        $this->patch(route('feedback.reports.restore', [$this->project, $deleted]))
            ->assertRedirect(route('feedback.login', $this->project));

        $token = Str::random(48);
        $reporterReport = FeedbackReport::factory()->for($this->project)->create(['reporter_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.reports.show', [$this->project, $reporterReport]).'?access='.$token);
        $this->delete(route('feedback.reports.client-destroy', [$this->project, $reporterReport]))
            ->assertRedirect(route('feedback.login', $this->project));

        $this->flushTestAccess();
        $this->actingAsEngineer();
        $this->delete(route('feedback.reports.client-destroy', [$this->project, $report]))->assertForbidden();

        $this->assertNull($report->refresh()->client_deleted_at);
        $this->assertNull($reporterReport->refresh()->client_deleted_at);
        $this->assertNotNull($deleted->refresh()->client_deleted_at);
    }

    public function test_deletion_and_restore_are_scoped_to_the_project(): void
    {
        $otherProject = FeedbackProject::factory()->create();
        $otherReport = FeedbackReport::factory()->for($otherProject)->create();
        $otherDeleted = FeedbackReport::factory()->for($otherProject)->create(['client_deleted_at' => now()]);

        $this->actingAsTeacher();
        $this->delete(route('feedback.reports.client-destroy', [$this->project, $otherReport]))->assertNotFound();
        $this->delete(route('feedback.reports.client-destroy', [$otherProject, $otherReport]))
            ->assertRedirect(route('feedback.login', $otherProject));

        $this->flushTestAccess();
        $this->actingAsEngineer();
        $this->patch(route('feedback.reports.restore', [$this->project, $otherDeleted]))->assertNotFound();

        $this->assertNull($otherReport->refresh()->client_deleted_at);
        $this->assertNotNull($otherDeleted->refresh()->client_deleted_at);
    }

    public function test_restoring_a_report_that_is_not_deleted_is_harmless(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $this->actingAsEngineer();

        $this->patch(route('feedback.reports.restore', [$this->project, $report]))->assertRedirect();
        $this->assertNull($report->refresh()->client_deleted_at);
    }

    public function test_owner_can_still_permanently_delete_a_teacher_deleted_report(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create(['client_deleted_at' => now()]);
        $this->actingAsEngineer();

        $this->delete(route('feedback.reports.destroy', [$this->project, $report]))
            ->assertRedirect(route('feedback.portal', $this->project));
        $this->assertModelMissing($report);
    }

    private function actingAsTeacher(): void
    {
        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$this->clientToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsEngineer(): void
    {
        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$this->ownerToken)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    /**
     * Drop session grants and any long-lived access cookie queued by earlier requests.
     */
    private function flushTestAccess(): void
    {
        $this->flushSession();
        app('cookie')->flushQueuedCookies();
    }
}
