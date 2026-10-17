<?php

namespace Tests\Feature\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FeedbackAdjustmentTest extends TestCase
{
    use LazilyRefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private FeedbackProject $project;

    private FeedbackReport $report;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->project = FeedbackProject::factory()->create();
        $this->report = FeedbackReport::factory()->for($this->project)->create([
            'status' => FeedbackReportStatus::InProgress,
        ]);
    }

    public function test_teacher_sees_the_adjustment_note_and_images_below_the_report(): void
    {
        $this->report->update(['adjustment_note' => "已修正排版\n第二行"]);
        $image = $this->adjustmentImage();

        $this->actingAsTeacher();

        $html = $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertSee('調整說明')
            ->assertSee("已修正排版\n第二行")
            ->assertSee(route('feedback.attachments.show', [$this->project, $this->report, $image]))
            ->assertDontSee('編輯調整說明')
            ->assertDontSee(route('feedback.reports.adjustment.update', [$this->project, $this->report]))
            ->getContent();

        $this->assertLessThan(
            strpos($html, 'data-adjustment'),
            strpos($html, e($this->report->description)),
            '調整說明應在回饋單內容下方。',
        );

        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('data-adjustment-note', false)
            ->assertSee("已修正排版\n第二行");
    }

    public function test_teacher_does_not_see_an_empty_adjustment_section(): void
    {
        $this->actingAsTeacher();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertDontSee('data-adjustment', false)
            ->assertDontSee('調整說明');
        $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertDontSee('data-adjustment', false);
    }

    public function test_owner_sees_the_editor_even_when_empty(): void
    {
        $this->actingAsEngineer();

        $this->get(route('feedback.reports.show', [$this->project, $this->report]))
            ->assertOk()
            ->assertSee('調整說明')
            ->assertSee('尚未填寫')
            ->assertSee('編輯調整說明')
            ->assertSee(route('feedback.reports.adjustment.update', [$this->project, $this->report]));
    }

    public function test_teacher_cannot_edit_the_adjustment(): void
    {
        $existing = $this->adjustmentImage();
        $this->report->update(['adjustment_note' => '原說明']);
        $this->actingAsTeacher();

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_note' => '老師改的',
            'adjustment_images' => [$this->fakePng('teacher.png')],
            'remove_adjustment_attachments' => [$existing->id],
        ])->assertForbidden();

        $this->putJson(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_note' => '老師改的',
        ])->assertForbidden();

        $this->assertSame('原說明', $this->report->refresh()->adjustment_note);
        $this->assertModelExists($existing);
        $this->assertSame(1, $this->report->adjustmentAttachments()->count());
    }

    public function test_guest_and_reporter_cannot_edit_the_adjustment(): void
    {
        $route = route('feedback.reports.adjustment.update', [$this->project, $this->report]);

        $this->put($route, ['adjustment_note' => '訪客'])
            ->assertRedirect(route('feedback.login', $this->project));

        $token = Str::random(48);
        $this->report->update(['reporter_token_hash' => hash('sha256', $token)]);
        $this->get(route('feedback.reports.show', [$this->project, $this->report]).'?access='.$token);

        $this->put($route, ['adjustment_note' => '回報者'])
            ->assertRedirect(route('feedback.login', $this->project));

        $this->assertNull($this->report->refresh()->adjustment_note);
    }

    public function test_teacher_cannot_remove_adjustment_images_through_the_report_edit_form(): void
    {
        $adjustment = $this->adjustmentImage();
        $this->actingAsTeacher();

        $this->put(route('feedback.reports.update', [$this->project, $this->report]), [
            'title' => '新標題',
            'description' => '新內容',
            'remove_attachments' => [$adjustment->id],
        ])->assertSessionHasErrorsIn('editReport', 'remove_attachments.0');

        $this->assertModelExists($adjustment);
    }

    public function test_owner_can_write_add_and_remove_adjustment_images(): void
    {
        $old = $this->adjustmentImage();
        Storage::disk('local')->put($old->path, 'old');
        $this->actingAsEngineer();

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_note' => '已調整按鈕顏色',
            'adjustment_images' => [$this->fakePng('after-1.png'), $this->fakePng('after-2.png')],
            'remove_adjustment_attachments' => [$old->id],
        ])->assertRedirect(route('feedback.reports.show', [$this->project, $this->report]).'#adjustment');

        $this->report->refresh();
        $this->assertSame('已調整按鈕顏色', $this->report->adjustment_note);
        $this->assertSame(FeedbackReportStatus::InProgress, $this->report->status);
        $this->assertModelMissing($old);
        Storage::disk('local')->assertMissing($old->path);

        $images = $this->report->adjustmentAttachments()->get();
        $this->assertSame(['after-1.png', 'after-2.png'], $images->pluck('original_name')->sort()->values()->all());
        $images->each(fn (FeedbackAttachment $image) => Storage::disk('local')->assertExists($image->path));

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_note' => "已調整按鈕顏色\n\n第二次：補上手機版",
        ])->assertRedirect();
        $this->assertSame("已調整按鈕顏色\n\n第二次：補上手機版", $this->report->refresh()->adjustment_note);
        $this->assertSame(2, $this->report->adjustmentAttachments()->count());
    }

    public function test_owner_cannot_remove_ordinary_screenshots_through_the_adjustment_form(): void
    {
        $screenshot = FeedbackAttachment::factory()->for($this->report)->create();
        $this->actingAsEngineer();

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_note' => '說明',
            'remove_adjustment_attachments' => [$screenshot->id],
        ])->assertSessionHasErrorsIn('adjustment', 'remove_adjustment_attachments.0');

        $this->assertModelExists($screenshot);
    }

    public function test_owner_adjustment_rejects_non_images(): void
    {
        $this->actingAsEngineer();

        $this->put(route('feedback.reports.adjustment.update', [$this->project, $this->report]), [
            'adjustment_images' => [UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf')],
        ])->assertSessionHasErrorsIn('adjustment', 'adjustment_images.0');

        $this->assertSame(0, $this->report->adjustmentAttachments()->count());
    }

    public function test_adjustment_images_are_private_and_do_not_mix_with_report_screenshots(): void
    {
        $screenshot = FeedbackAttachment::factory()->for($this->report)->create(['path' => 'feedback/shot.png']);
        $adjustment = $this->adjustmentImage();
        Storage::disk('local')->put($adjustment->path, base64_decode(self::PNG));
        $url = route('feedback.attachments.show', [$this->project, $this->report, $adjustment]);

        $this->get($url)->assertRedirect(route('feedback.login', $this->project));

        $otherProject = FeedbackProject::factory()->create();
        $otherToken = Str::random(48);
        $otherProject->update(['client_token_hash' => hash('sha256', $otherToken)]);
        $this->get(route('feedback.client.authenticate', $otherProject).'?token='.$otherToken);
        $this->get($url)->assertRedirect(route('feedback.login', $this->project));

        $this->actingAsTeacher();
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');

        $showHtml = $this->get(route('feedback.reports.show', [$this->project, $this->report]))->getContent();
        $adjustmentHtml = Str::after($showHtml, 'data-adjustment>');
        $reportHtml = Str::before($showHtml, 'data-adjustment>');
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $screenshot]), $reportHtml);
        $this->assertStringNotContainsString($url, $reportHtml);
        $this->assertStringContainsString($url, $adjustmentHtml);

        $portalHtml = $this->get(route('feedback.portal', $this->project))->getContent();
        $editForm = Str::between($portalHtml, 'id="edit-report-'.$this->report->public_id.'"', '</dialog>');
        $this->assertStringNotContainsString('value="'.$adjustment->id.'"', $editForm);
    }

    public function test_command_overwrites_the_note_without_touching_status(): void
    {
        $this->report->update(['adjustment_note' => '舊內容']);

        $this->artisan('feedback:adjust', [
            'project' => $this->project->slug,
            'report' => $this->report->public_id,
            '--note' => '新內容',
        ])->assertSuccessful();

        $this->report->refresh();
        $this->assertSame('新內容', $this->report->adjustment_note);
        $this->assertSame(FeedbackReportStatus::InProgress, $this->report->status);
        $this->assertNull($this->report->completed_at);

        $this->artisan('feedback:adjust', [
            'project' => $this->project->slug,
            'report' => $this->report->public_id,
            '--note' => '',
        ])->assertSuccessful();
        $this->assertNull($this->report->refresh()->adjustment_note);
    }

    public function test_command_appends_after_a_blank_line(): void
    {
        $this->report->update(['adjustment_note' => '第一次調整']);

        $this->artisan('feedback:adjust', [
            'project' => $this->project->slug,
            'report' => (string) $this->report->id,
            '--note' => '第二次調整',
            '--append' => true,
        ])->assertSuccessful();

        $this->assertSame("第一次調整\n\n第二次調整", $this->report->refresh()->adjustment_note);

        $empty = FeedbackReport::factory()->for($this->project)->create();
        $this->artisan('feedback:adjust', [
            'project' => $this->project->slug,
            'report' => $empty->public_id,
            '--note' => '第一筆',
            '--append' => true,
        ])->assertSuccessful();
        $this->assertSame('第一筆', $empty->refresh()->adjustment_note);
    }

    public function test_command_copies_images_into_private_storage(): void
    {
        $directory = sys_get_temp_dir().'/feedback-adjust-'.Str::random(8);
        mkdir($directory);
        file_put_contents($first = $directory.'/before.png', base64_decode(self::PNG));
        file_put_contents($second = $directory.'/after.png', base64_decode(self::PNG));
        $this->report->update(['adjustment_note' => '保留的文字']);

        try {
            $this->artisan('feedback:adjust', [
                'project' => $this->project->slug,
                'report' => $this->report->public_id,
                '--image' => [$first, $second],
            ])->assertSuccessful();

            $this->assertFileExists($first);
            $this->assertFileExists($second);
        } finally {
            array_map('unlink', [$first, $second]);
            rmdir($directory);
        }

        $this->report->refresh();
        $this->assertSame('保留的文字', $this->report->adjustment_note);
        $images = $this->report->adjustmentAttachments()->orderBy('id')->get();
        $this->assertSame(['before.png', 'after.png'], $images->pluck('original_name')->all());
        $images->each(function (FeedbackAttachment $image): void {
            $this->assertSame(FeedbackAttachmentKind::Adjustment, $image->kind);
            $this->assertSame('image/png', $image->mime_type);
            $this->assertNull($image->feedback_message_id);
            Storage::disk('local')->assertExists($image->path);
        });
        $this->assertSame(FeedbackReportStatus::InProgress, $this->report->status);
    }

    public function test_command_rejects_bad_input_without_writing(): void
    {
        $text = tempnam(sys_get_temp_dir(), 'adjust');
        file_put_contents($text, 'not an image');

        try {
            $this->artisan('feedback:adjust', ['project' => 'missing', 'report' => $this->report->public_id, '--note' => 'x'])
                ->expectsOutputToContain('找不到回報專案')
                ->assertFailed();

            $otherReport = FeedbackReport::factory()->create();
            $this->artisan('feedback:adjust', ['project' => $this->project->slug, 'report' => $otherReport->public_id, '--note' => 'x'])
                ->expectsOutputToContain('找不到該回饋單')
                ->assertFailed();

            $this->artisan('feedback:adjust', ['project' => $this->project->slug, 'report' => $this->report->public_id])
                ->expectsOutputToContain('請至少提供 --note 或 --image')
                ->assertFailed();

            $this->artisan('feedback:adjust', [
                'project' => $this->project->slug,
                'report' => $this->report->public_id,
                '--note' => 'x',
                '--image' => ['/nonexistent/a.png'],
            ])->expectsOutputToContain('找不到或無法讀取圖片')->assertFailed();

            $this->artisan('feedback:adjust', [
                'project' => $this->project->slug,
                'report' => $this->report->public_id,
                '--note' => 'x',
                '--image' => [$text],
            ])->expectsOutputToContain('只接受 jpg／png／webp 圖片')->assertFailed();
        } finally {
            unlink($text);
        }

        $this->assertNull($this->report->refresh()->adjustment_note);
        $this->assertSame(0, FeedbackAttachment::count());
    }

    public function test_command_help_explains_usage(): void
    {
        $command = Artisan::all()['feedback:adjust'];

        $this->assertStringContainsString('--append', $command->getHelp());
        $this->assertStringContainsString('--image=/tmp/a.png --image=/tmp/b.png', $command->getHelp());
        $this->assertStringContainsString('不會改動回饋單狀態', $command->getHelp());
        $this->assertTrue($command->getDefinition()->getOption('image')->isArray());
    }

    public function test_deleting_a_report_removes_adjustment_files(): void
    {
        $adjustment = $this->adjustmentImage();
        Storage::disk('local')->put($adjustment->path, 'x');
        $this->actingAsEngineer();

        $this->delete(route('feedback.reports.destroy', [$this->project, $this->report]))->assertRedirect();

        $this->assertModelMissing($adjustment);
        Storage::disk('local')->assertMissing($adjustment->path);
    }

    public function test_list_view_shows_the_adjustment_column_with_note_and_image(): void
    {
        $this->report->update(['adjustment_note' => '清單可見的調整說明']);
        $image = $this->adjustmentImage();
        FeedbackReport::factory()->for($this->project)->create(['title' => '沒有調整的單']);

        $this->actingAsTeacher();

        $html = $this->get(route('feedback.portal', $this->project))
            ->assertOk()
            ->assertSee('<th class="whitespace-nowrap min-w-48 w-56 px-4 text-left py-3.5">調整說明</th>', false)
            ->assertSee('清單可見的調整說明')
            ->assertSee(route('feedback.attachments.show', [$this->project, $this->report, $image]))
            ->getContent();

        $table = Str::between($html, 'data-report-table', '</table>');
        $this->assertStringContainsString('清單可見的調整說明', $table);
        $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $image]), $table);
        $this->assertStringNotContainsString('data-adjustment-image', Str::before(Str::after($table, '沒有調整的單'), '</tr>'));
    }

    public function test_board_view_shows_the_adjustment_note_and_image_count(): void
    {
        $this->report->update(['adjustment_note' => '看板可見的調整說明', 'status' => FeedbackReportStatus::New]);
        $image = $this->adjustmentImage();
        $this->adjustmentImage();

        $this->actingAsTeacher();

        $this->get(route('feedback.portal', $this->project).'?view=board')
            ->assertOk()
            ->assertSee('data-adjustment-card', false)
            ->assertSee('看板可見的調整說明')
            ->assertSee(route('feedback.attachments.show', [$this->project, $this->report, $image]))
            ->assertSee('2 張調整圖');
    }

    public function test_board_view_hides_the_adjustment_block_when_empty(): void
    {
        $this->report->update(['status' => FeedbackReportStatus::New]);
        $this->actingAsTeacher();

        $this->get(route('feedback.portal', $this->project).'?view=board')
            ->assertOk()
            ->assertDontSee('data-adjustment', false);
    }

    public function test_adjustment_note_opens_the_detail_preview_with_full_text_and_all_images(): void
    {
        $this->report->update(['adjustment_note' => "完整第一行\n完整第二行", 'status' => FeedbackReportStatus::New]);
        $first = $this->adjustmentImage();
        $second = $this->adjustmentImage();
        $dialogId = 'detail-report-'.$this->report->public_id;

        $this->actingAsTeacher();

        foreach ([route('feedback.portal', $this->project), route('feedback.portal', $this->project).'?view=board'] as $url) {
            $html = $this->get($url)->assertOk()->getContent();

            $this->assertStringContainsString('data-dialog-open="'.$dialogId.'" data-adjustment-preview', $html);

            $dialog = Str::between($html, 'id="'.$dialogId.'"', '</dialog>');
            $this->assertStringContainsString("完整第一行\n完整第二行", $dialog);
            $this->assertStringContainsString('whitespace-pre-wrap', $dialog);
            $this->assertSame(2, substr_count($dialog, 'data-adjustment-image'));
            $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $first]), $dialog);
            $this->assertStringContainsString(route('feedback.attachments.show', [$this->project, $this->report, $second]), $dialog);
        }
    }

    private function adjustmentImage(): FeedbackAttachment
    {
        return FeedbackAttachment::factory()->for($this->report)->create([
            'kind' => FeedbackAttachmentKind::Adjustment,
            'path' => 'feedback/adjustment-'.Str::random(6).'.png',
            'original_name' => 'adjustment.png',
        ]);
    }

    private function actingAsTeacher(): void
    {
        $token = Str::random(48);
        $this->project->update(['client_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.client.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function actingAsEngineer(): void
    {
        $token = Str::random(48);
        $this->project->update(['owner_token_hash' => hash('sha256', $token)]);

        $this->get(route('feedback.owner.authenticate', $this->project).'?token='.$token)
            ->assertRedirect(route('feedback.portal', $this->project));
    }

    private function fakePng(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG));
    }
}
