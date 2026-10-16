<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackReportManagementTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
    }

    public function test_guest_cannot_use_the_management_page_or_actions(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
        $this->get(route('feedback.owner.index', $project))->assertRedirect(route('feedback.owner.login', $project));
        $this->post(route('feedback.reports.store', $project), [
            'issues' => [['title' => '標題', 'description' => '內容']],
        ])->assertRedirect(route('feedback.login', $project));
        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => '新標題',
            'description' => '新內容',
        ])->assertRedirect(route('feedback.login', $project));
        $this->patch(route('feedback.reports.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::Completed->value,
        ])->assertRedirect(route('feedback.login', $project));
        $this->delete(route('feedback.reports.destroy', [$project, $report]))->assertRedirect(route('feedback.login', $project));

        $this->assertModelExists($report);
    }

    public function test_reporter_only_access_cannot_manage_reports(): void
    {
        $project = FeedbackProject::factory()->create();
        $token = Str::random(48);
        $report = FeedbackReport::factory()->for($project)->create([
            'reporter_token_hash' => hash('sha256', $token),
        ]);
        $this->get(route('feedback.reports.show', [$project, $report]).'?access='.$token);

        $this->get(route('feedback.portal', $project))->assertRedirect(route('feedback.login', $project));
        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => '新標題',
            'description' => '新內容',
        ])->assertRedirect(route('feedback.login', $project));
    }

    public function test_list_hides_description_and_opens_it_in_a_detail_dialog(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create([
            'title' => '清單標題',
            'description' => "第一行說明\n第二行說明",
        ]);

        $this->actingAsTeacher($project);
        $html = $this->get(route('feedback.portal', $project))->assertOk()->getContent();

        $row = Str::between($html, 'data-report-row="'.$report->public_id.'"', '</tr>');
        $this->assertStringNotContainsString('第一行說明', $row);
        $this->assertStringContainsString('data-dialog-open="detail-report-'.$report->public_id.'"', $row);
        $this->assertStringNotContainsString('href="'.route('feedback.reports.show', [$project, $report]).'"', $row);

        $dialog = Str::between($html, 'id="detail-report-'.$report->public_id.'"', '</dialog>');
        $this->assertStringContainsString("第一行說明\n第二行說明", $dialog);
        $this->assertStringContainsString('清單標題', $dialog);
        $this->assertStringContainsString('查看留言紀錄', $dialog);
        $this->assertStringContainsString(route('feedback.reports.show', [$project, $report]), $dialog);
    }

    public function test_teacher_and_engineer_share_the_same_table_page(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create(['title' => '共用頁面的問題']);
        $attachment = FeedbackAttachment::factory()->for($report)->create();

        $this->actingAsTeacher($project);
        $this->get(route('feedback.portal', $project))
            ->assertOk()
            ->assertViewIs('feedback.portal')
            ->assertSee('新增問題')
            ->assertSee('共用頁面的問題')
            ->assertSeeInOrder(['標題', '狀態', '圖片', '建立日期', '操作'])
            ->assertSee(route('feedback.attachments.show', [$project, $report, $attachment]), false)
            ->assertSee('data-lightbox-trigger', false)
            ->assertSee('data-dialog-open="edit-report-'.$report->public_id.'"', false)
            ->assertDontSee('data-delete-report', false)
            ->assertDontSee('id="delete-report-'.$report->public_id.'"', false)
            ->assertSee('data-client-delete-report', false)
            ->assertSee('action="'.route('feedback.reports.client-destroy', [$project, $report]).'"', false);

        $this->flushSession();
        $this->actingAsEngineer($project);
        $this->get(route('feedback.owner.index', $project))
            ->assertRedirect(route('feedback.portal', $project));
        $this->get(route('feedback.portal', $project))
            ->assertOk()
            ->assertViewIs('feedback.portal')
            ->assertSee('共用頁面的問題')
            ->assertSee('data-delete-report', false)
            ->assertSee('id="delete-report-'.$report->public_id.'"', false)
            ->assertSee('value="DELETE"', false);
    }

    public function test_portal_can_switch_between_list_and_board_views_without_losing_query_options(): void
    {
        $project = FeedbackProject::factory()->create();
        FeedbackReport::factory()->for($project)->create(['status' => FeedbackReportStatus::Completed]);
        $this->actingAsTeacher($project);

        $this->get(route('feedback.portal', $project))
            ->assertOk()
            ->assertViewHas('viewMode', 'list')
            ->assertSee('data-list-view', false)
            ->assertDontSee('data-kanban-board', false);

        $html = $this->get(route('feedback.portal', $project).'?view=board&status=completed&sort=title&direction=asc')
            ->assertOk()
            ->assertViewHas('viewMode', 'board')
            ->assertSee('data-kanban-board', false)
            ->assertDontSee('data-report-table', false)
            ->getContent();

        $expectedListUrl = htmlspecialchars(
            route('feedback.portal', $project).'?view=list&status=completed&sort=title&direction=asc',
            ENT_QUOTES,
        );
        $this->assertStringContainsString('href="'.$expectedListUrl.'"', $html);
    }

    public function test_board_renders_selectable_status_columns_and_places_cards_in_their_current_status(): void
    {
        $project = FeedbackProject::factory()->create();
        $reports = collect(FeedbackReportStatus::cases())->mapWithKeys(function (FeedbackReportStatus $status) use ($project): array {
            $report = FeedbackReport::factory()->for($project)->create([
                'status' => $status,
                'title' => $status->label().'卡片',
            ]);

            return [$status->value => $report];
        });
        $this->actingAsEngineer($project);

        $html = $this->get(route('feedback.portal', $project).'?view=board')->assertOk()->getContent();
        $document = new \DOMDocument;
        @$document->loadHTML('<?xml encoding="utf-8"?>'.$html);
        $xpath = new \DOMXPath($document);

        $this->assertSame(3, $xpath->query('//form[@method="GET"]//select[@name="status"]/option[@value != ""]')->length);

        foreach (FeedbackReportStatus::selectable() as $status) {
            $column = $xpath->query('//*[@data-kanban-column and @data-status="'.$status->value.'"]');
            $card = $xpath->query('//*[@data-kanban-list and @data-status="'.$status->value.'"]//*[@data-kanban-card and @data-report-id="'.$reports[$status->value]->public_id.'"]');

            $this->assertSame(1, $column->length, "Missing {$status->value} board column.");
            $this->assertSame('1', $column->item(0)->getAttribute('data-selectable'));
            $this->assertSame(1, $card->length, "Report was not placed in {$status->value}.");
        }

        foreach ([FeedbackReportStatus::InProgress, FeedbackReportStatus::Failed] as $status) {
            $this->assertSame(0, $xpath->query('//*[@data-kanban-column and @data-status="'.$status->value.'"]')->length);
            $this->assertSame(0, $xpath->query('//*[@data-kanban-card and @data-report-id="'.$reports[$status->value]->public_id.'"]')->length);
        }

        $this->assertStringNotContainsString('data-drag-handle', $html);
        $this->assertStringContainsString('title="拖拉卡片可改變狀態"', $html);
        $this->assertStringContainsString('aria-label="編輯「', $html);
        $this->assertStringContainsString('aria-label="刪除「', $html);
        $this->assertStringContainsString('data-kanban-status-form', $html);
        $this->assertStringContainsString('data-kanban-total-count="new">1</span>', $html);
        $this->assertStringNotContainsString('此狀態由自動化設定；卡片可拖出但不能拖入。', $html);
    }

    public function test_keyword_search_matches_report_titles_and_descriptions(): void
    {
        $project = FeedbackProject::factory()->create();
        FeedbackReport::factory()->for($project)->create([
            'title' => '答案儲存異常',
            'description' => '按鈕沒有反應。',
        ]);
        FeedbackReport::factory()->for($project)->create([
            'title' => '送出按鈕失效',
            'description' => '使用者無法儲存答案。',
        ]);
        FeedbackReport::factory()->for($project)->create([
            'title' => '圖片顯示異常',
            'description' => '縮圖比例錯誤。',
        ]);
        FeedbackReport::factory()->for(FeedbackProject::factory()->create())->create([
            'title' => '其他專案的答案問題',
        ]);
        $this->actingAsTeacher($project);

        $response = $this->get(route('feedback.portal', $project).'?view=board&q='.urlencode('儲存'))
            ->assertOk()
            ->assertViewHas('keyword', '儲存')
            ->assertSee('答案儲存異常')
            ->assertSee('送出按鈕失效')
            ->assertDontSee('圖片顯示異常')
            ->assertDontSee('其他專案的答案問題')
            ->assertSee('共 3 題（篩選後 2 題）', false);

        $html = $response->getContent();
        $this->assertStringContainsString('name="q" value="儲存"', $html);
        $this->assertStringContainsString('view=list&amp;q='.urlencode('儲存'), $html);
    }

    public function test_board_keeps_the_existing_fifty_report_page_size(): void
    {
        $project = FeedbackProject::factory()->create();
        FeedbackReport::factory()->for($project)->count(51)->create();
        $this->actingAsTeacher($project);

        $html = $this->get(route('feedback.portal', $project).'?view=board')->assertOk()->getContent();
        $document = new \DOMDocument;
        @$document->loadHTML('<?xml encoding="utf-8"?>'.$html);
        $xpath = new \DOMXPath($document);

        $this->assertSame(50, $xpath->query('//*[@data-kanban-card]')->length);
        $this->assertStringContainsString('看板每頁最多顯示 50 題。', $html);
        $this->assertStringContainsString('view=board&amp;page=2', $html);
    }

    public function test_status_dropdown_only_offers_three_statuses(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create(['status' => FeedbackReportStatus::NeedsInput]);
        $this->actingAsTeacher($project);

        $options = $this->statusOptions($this->get(route('feedback.portal', $project))->getContent(), $report);

        $this->assertSame([
            ['value' => 'new', 'selected' => false, 'hidden' => false],
            ['value' => 'needs_input', 'selected' => true, 'hidden' => false],
            ['value' => 'completed', 'selected' => false, 'hidden' => false],
        ], $options);
    }

    public function test_status_dropdown_keeps_automation_status_as_hidden_current_value(): void
    {
        $project = FeedbackProject::factory()->create();
        $inProgress = FeedbackReport::factory()->for($project)->create(['status' => FeedbackReportStatus::InProgress]);
        $failed = FeedbackReport::factory()->for($project)->create(['status' => FeedbackReportStatus::Failed]);
        $this->actingAsEngineer($project);
        $html = $this->get(route('feedback.portal', $project))->getContent();

        foreach ([$inProgress, $failed] as $report) {
            $options = $this->statusOptions($html, $report);
            $visible = array_values(array_filter($options, fn (array $option): bool => ! $option['hidden']));

            $this->assertSame(['new', 'needs_input', 'completed'], array_column($visible, 'value'));
            $this->assertNotContains(true, array_column($visible, 'selected'));
            $this->assertContains(
                ['value' => $report->status->value, 'selected' => true, 'hidden' => true],
                $options,
            );
        }
    }

    public function test_detail_page_lets_teacher_change_status_with_the_same_options(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create(['status' => FeedbackReportStatus::InProgress]);
        $this->actingAsTeacher($project);

        $this->get(route('feedback.reports.show', [$project, $report]))
            ->assertOk()
            ->assertSee(route('feedback.reports.status.update', [$project, $report]), false)
            ->assertSee('<option value="in_progress" selected disabled hidden data-automation-status>', false)
            ->assertDontSee('<option value="failed"', false);
    }

    public function test_teacher_and_engineer_can_create_reports(): void
    {
        $project = FeedbackProject::factory()->create();

        $this->actingAsTeacher($project);
        $this->post(route('feedback.reports.store', $project), [
            'issues' => [['title' => '老師新增', 'description' => '老師的內容']],
        ])->assertRedirect(route('feedback.portal', $project));

        $this->flushSession();
        $this->actingAsEngineer($project);
        $this->post(route('feedback.reports.store', $project), [
            'issues' => [['title' => '工程師新增', 'description' => '工程師的內容']],
        ])->assertRedirect(route('feedback.portal', $project));

        $this->assertSame(['工程師新增', '老師新增'], $project->feedbackReports()->orderBy('title')->pluck('title')->all());
    }

    public function test_teacher_and_engineer_can_change_status_without_leaving_the_page(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();

        $this->actingAsTeacher($project);
        $this->patchJson(route('feedback.reports.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::Completed->value,
        ])->assertOk()->assertJson(['status' => 'completed', 'label' => '已完成']);

        $report->refresh();
        $this->assertSame(FeedbackReportStatus::Completed, $report->status);
        $this->assertNotNull($report->completed_at);

        $this->flushSession();
        $this->actingAsEngineer($project);
        $this->patchJson(route('feedback.reports.status.update', [$project, $report]), [
            'status' => FeedbackReportStatus::NeedsInput->value,
        ])->assertOk()->assertJson(['status' => 'needs_input']);

        $report->refresh();
        $this->assertSame(FeedbackReportStatus::NeedsInput, $report->status);
        $this->assertNull($report->completed_at);
    }

    public function test_automation_only_statuses_cannot_be_chosen_by_hand(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsEngineer($project);

        foreach ([FeedbackReportStatus::InProgress, FeedbackReportStatus::Failed] as $status) {
            $this->patchJson(route('feedback.reports.status.update', [$project, $report]), [
                'status' => $status->value,
            ])->assertUnprocessable()->assertJsonValidationErrors('status');
        }

        $this->assertSame(FeedbackReportStatus::New, $report->refresh()->status);
    }

    public function test_teacher_can_edit_title_description_and_screenshots(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        Storage::disk('local')->put('feedback/old/keep.png', 'keep');
        Storage::disk('local')->put('feedback/old/remove.png', 'remove');
        $kept = FeedbackAttachment::factory()->for($report)->create(['path' => 'feedback/old/keep.png']);
        $removed = FeedbackAttachment::factory()->for($report)->create(['path' => 'feedback/old/remove.png']);
        $this->actingAsTeacher($project);

        $this->from(route('feedback.portal', $project))
            ->put(route('feedback.reports.update', [$project, $report]), [
                'title' => '修改後的標題',
                'description' => '修改後的內容',
                'remove_attachments' => [$removed->id],
                'screenshots' => [$this->fakePng('new.png')],
            ])
            ->assertRedirect(route('feedback.portal', $project))
            ->assertSessionHasNoErrors();

        $report->refresh();
        $this->assertSame('修改後的標題', $report->title);
        $this->assertSame('修改後的內容', $report->description);
        $this->assertModelExists($kept);
        $this->assertModelMissing($removed);
        Storage::disk('local')->assertExists('feedback/old/keep.png');
        Storage::disk('local')->assertMissing('feedback/old/remove.png');

        $added = $report->feedbackAttachments()->where('original_name', 'new.png')->sole();
        Storage::disk('local')->assertExists($added->path);
    }

    public function test_engineer_can_edit_a_report(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsEngineer($project);

        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => '工程師改標題',
            'description' => '工程師改內容',
        ])->assertRedirect()->assertSessionHasNoErrors();

        $this->assertSame('工程師改標題', $report->refresh()->title);
    }

    public function test_edit_uses_the_creation_validation_rules(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create(['title' => '原標題']);
        $this->actingAsTeacher($project);

        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => str_repeat('長', 161),
            'description' => str_repeat('長', 10001),
        ])->assertSessionHasErrors(['title', 'description'], errorBag: 'editReport');

        $this->assertSame('原標題', $report->refresh()->title);
    }

    public function test_edit_rejects_more_than_five_screenshots_in_total(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        FeedbackAttachment::factory()->for($report)->count(4)->create();
        $this->actingAsTeacher($project);

        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => '標題',
            'description' => '內容',
            'screenshots' => [$this->fakePng('a.png'), $this->fakePng('b.png')],
        ])->assertSessionHasErrors('screenshots', errorBag: 'editReport');

        $this->assertSame(4, $report->feedbackAttachments()->count());
    }

    public function test_edit_cannot_remove_attachments_of_another_report(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $otherAttachment = FeedbackAttachment::factory()
            ->for(FeedbackReport::factory()->for($project))
            ->create();
        $this->actingAsTeacher($project);

        $this->put(route('feedback.reports.update', [$project, $report]), [
            'title' => '標題',
            'description' => '內容',
            'remove_attachments' => [$otherAttachment->id],
        ])->assertSessionHasErrors('remove_attachments.0', errorBag: 'editReport');

        $this->assertModelExists($otherAttachment);
    }

    public function test_failed_edit_reopens_its_dialog(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsTeacher($project);

        $this->from(route('feedback.portal', $project))
            ->put(route('feedback.reports.update', [$project, $report]), [
                'editing_report' => $report->public_id,
                'title' => '',
                'description' => '保留的內容',
            ])
            ->assertRedirect(route('feedback.portal', $project));

        $this->get(route('feedback.portal', $project))
            ->assertOk()
            ->assertSee('data-open-on-load', false)
            ->assertSee('保留的內容');
    }

    public function test_new_issue_form_lives_in_a_dialog_not_at_the_page_bottom(): void
    {
        $project = FeedbackProject::factory()->create();
        $this->actingAsTeacher($project);

        $content = $this->get(route('feedback.portal', $project))->assertOk()->getContent();

        $this->assertStringContainsString('data-dialog-open="new-issues"', $content);
        $this->assertMatchesRegularExpression('/<dialog id="new-issues"[^>]*data-issue-entry/', $content);
        $this->assertDoesNotMatchRegularExpression('/<dialog id="new-issues"[^>]*data-open-on-load/', $content);
        $this->assertStringNotContainsString('<section id="new-issues"', $content);
        $this->assertStringNotContainsString('href="#new-issues"', $content);
        $this->assertSame(1, substr_count($content, 'data-issue-form'));
    }

    public function test_failed_creation_reopens_the_new_issue_dialog_only(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsTeacher($project);

        $this->from(route('feedback.portal', $project))
            ->post(route('feedback.reports.store', $project), [
                'issues' => [['title' => '', 'description' => '保留的新增內容']],
            ])
            ->assertRedirect(route('feedback.portal', $project));

        $content = $this->get(route('feedback.portal', $project))->assertOk()
            ->assertSee('保留的新增內容')
            ->getContent();

        $this->assertMatchesRegularExpression('/<dialog id="new-issues"[^>]*data-open-on-load/', $content);
        $this->assertDoesNotMatchRegularExpression('/<dialog id="edit-report-'.$report->public_id.'"[^>]*data-open-on-load/', $content);
    }

    public function test_failed_edit_does_not_open_the_new_issue_dialog(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsTeacher($project);

        $this->from(route('feedback.portal', $project))
            ->put(route('feedback.reports.update', [$project, $report]), [
                'editing_report' => $report->public_id,
                'title' => '',
                'description' => 'x',
            ]);

        $content = $this->get(route('feedback.portal', $project))->getContent();

        $this->assertDoesNotMatchRegularExpression('/<dialog id="new-issues"[^>]*data-open-on-load/', $content);
        $this->assertMatchesRegularExpression('/<dialog id="edit-report-'.$report->public_id.'"[^>]*data-open-on-load/', $content);
    }

    public function test_teacher_cannot_delete_reports(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $this->actingAsTeacher($project);

        $this->delete(route('feedback.reports.destroy', [$project, $report]))->assertForbidden();

        $this->assertModelExists($report);
    }

    public function test_engineer_can_permanently_delete_a_report_with_its_files_and_history(): void
    {
        $project = FeedbackProject::factory()->create();
        $report = FeedbackReport::factory()->for($project)->create();
        $directory = "feedback/{$project->id}/{$report->public_id}";
        Storage::disk('local')->put("{$directory}/report.png", 'report');
        Storage::disk('local')->put("{$directory}/message.png", 'message');
        $reportAttachment = FeedbackAttachment::factory()->for($report)->create(['path' => "{$directory}/report.png"]);
        $message = FeedbackMessage::factory()->for($report)->create(['author_type' => FeedbackAuthorType::Reporter]);
        $messageAttachment = FeedbackAttachment::factory()->for($report)->create([
            'feedback_message_id' => $message->id,
            'path' => "{$directory}/message.png",
        ]);
        $run = FeedbackAutomationRun::factory()->for($report)->create();
        $survivor = FeedbackReport::factory()->for($project)->create();
        $this->actingAsEngineer($project);

        $this->delete(route('feedback.reports.destroy', [$project, $report]))
            ->assertRedirect(route('feedback.portal', $project));

        $this->assertModelMissing($report);
        $this->assertModelMissing($reportAttachment);
        $this->assertModelMissing($messageAttachment);
        $this->assertModelMissing($message);
        $this->assertModelMissing($run);
        $this->assertModelExists($survivor);
        Storage::disk('local')->assertMissing("{$directory}/report.png");
        Storage::disk('local')->assertMissing("{$directory}/message.png");
        Storage::disk('local')->assertMissing($directory);
    }

    public function test_sessions_cannot_manage_reports_of_another_project(): void
    {
        $ownProject = FeedbackProject::factory()->create();
        $otherProject = FeedbackProject::factory()->create();
        $otherReport = FeedbackReport::factory()->for($otherProject)->create(['title' => '別人的問題']);

        foreach (['actingAsTeacher', 'actingAsEngineer'] as $login) {
            $this->flushSession();
            $this->{$login}($ownProject);

            $this->get(route('feedback.portal', $otherProject))->assertRedirect(route('feedback.login', $otherProject));
            $this->post(route('feedback.reports.store', $otherProject), [
                'issues' => [['title' => '跨專案', 'description' => '內容']],
            ])->assertRedirect(route('feedback.login', $otherProject));
            $this->put(route('feedback.reports.update', [$otherProject, $otherReport]), [
                'title' => '竄改',
                'description' => '竄改',
            ])->assertRedirect(route('feedback.login', $otherProject));
            $this->put(route('feedback.reports.update', [$ownProject, $otherReport]), [
                'title' => '竄改',
                'description' => '竄改',
            ])->assertNotFound();
            $this->patch(route('feedback.reports.status.update', [$otherProject, $otherReport]), [
                'status' => FeedbackReportStatus::Completed->value,
            ])->assertRedirect(route('feedback.login', $otherProject));
            $this->delete(route('feedback.reports.destroy', [$otherProject, $otherReport]))->assertRedirect(route('feedback.login', $otherProject));
            $this->get(route('feedback.portal', $ownProject))->assertOk()->assertDontSee('別人的問題');
        }

        $this->actingAsEngineer($ownProject);
        $this->delete(route('feedback.reports.destroy', [$ownProject, $otherReport]))->assertNotFound();

        $otherReport->refresh();
        $this->assertSame('別人的問題', $otherReport->title);
        $this->assertSame(FeedbackReportStatus::New, $otherReport->status);
        $this->assertSame(0, $otherProject->feedbackReports()->where('title', '跨專案')->count());
    }

    private function actingAsTeacher(FeedbackProject $project): void
    {
        $token = Str::random(48);
        $project->update(['client_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.client.authenticate', $project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $project));
    }

    private function actingAsEngineer(FeedbackProject $project): void
    {
        $token = Str::random(48);
        $project->update(['owner_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.owner.authenticate', $project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $project));
    }

    private function fakePng(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG));
    }

    /**
     * @return list<array{value: string, selected: bool, hidden: bool}>
     */
    private function statusOptions(string $html, FeedbackReport $report): array
    {
        $document = new \DOMDocument;
        @$document->loadHTML('<?xml encoding="utf-8"?>'.$html);
        $select = $document->getElementById('status-'.$report->public_id);
        $this->assertNotNull($select, 'Status dropdown not rendered.');

        $options = [];
        foreach ($select->getElementsByTagName('option') as $option) {
            $options[] = [
                'value' => $option->getAttribute('value'),
                'selected' => $option->hasAttribute('selected'),
                'hidden' => $option->hasAttribute('hidden'),
            ];
        }

        return $options;
    }
}
