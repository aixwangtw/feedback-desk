<?php

namespace Tests\Feature\Feedback;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

/**
 * 開單分類是每個專案各自的設定：開發者在專案設定或 artisan 調整，沒設定就不顯示分類。
 */
class FeedbackProjectCategoriesTest extends TestCase
{
    use LazilyRefreshDatabase;

    private FeedbackProject $project;

    protected function setUp(): void
    {
        parent::setUp();

        $this->project = FeedbackProject::factory()->withoutClientAccount()->create(['slug' => 'alpha']);
        FeedbackClientAccount::factory()->for($this->project)->withPassword('client-old-password')->create(['username' => 'mei']);
        FeedbackDeveloper::factory()->withPassword('dev-old-password-x')->create(['username' => 'amy']);
    }

    private function loginDeveloper(): void
    {
        $this->post(route('feedback.login.store', $this->project), ['username' => 'amy', 'password' => 'dev-old-password-x'])->assertRedirect();
    }

    public function test_developer_sets_categories_from_project_settings(): void
    {
        $this->loginDeveloper();
        $this->get(route('feedback.account', $this->project))->assertOk()->assertSee('data-categories-form', false);

        $this->put(route('feedback.project.categories', $this->project), ['categories' => ' 程式使用問題，版面排版, ,其他,其他 '])
            ->assertRedirect(route('feedback.account', $this->project).'#project-settings')
            ->assertSessionHas('success');

        $this->assertSame(['程式使用問題', '版面排版', '其他'], $this->project->refresh()->reportCategories());
        $this->get(route('feedback.portal', $this->project))->assertSee('data-issue-category', false)->assertSee('版面排版');
    }

    public function test_clearing_categories_hides_the_field(): void
    {
        $this->project->update(['report_categories' => ['其他']]);
        $this->loginDeveloper();

        $this->put(route('feedback.project.categories', $this->project), ['categories' => ''])->assertSessionHasNoErrors();

        $this->assertNull($this->project->refresh()->report_categories);
        $this->get(route('feedback.portal', $this->project))->assertDontSee('data-issue-category', false);
    }

    public function test_too_many_or_too_long_categories_are_refused(): void
    {
        $this->loginDeveloper();

        $this->put(route('feedback.project.categories', $this->project), ['categories' => implode(',', range(1, 21))])
            ->assertSessionHasErrorsIn('categories', 'categories');
        $this->put(route('feedback.project.categories', $this->project), ['categories' => str_repeat('長', 51)])
            ->assertSessionHasErrorsIn('categories', 'categories');
        $this->assertNull($this->project->refresh()->report_categories);
    }

    public function test_clients_cannot_change_categories_or_see_settings(): void
    {
        $this->post(route('feedback.login.store', $this->project), ['username' => 'mei', 'password' => 'client-old-password'])->assertRedirect();

        $this->get(route('feedback.account', $this->project))->assertOk()->assertDontSee('data-categories-form', false);
        $this->put(route('feedback.project.categories', $this->project), ['categories' => '其他'])->assertForbidden();
        $this->assertNull($this->project->refresh()->report_categories);
    }

    public function test_each_project_uses_its_own_categories(): void
    {
        $other = FeedbackProject::factory()->create(['report_categories' => ['經典排版']]);
        $this->project->update(['report_categories' => ['版面排版']]);
        $this->loginDeveloper();

        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => 'a', 'description' => 'b', 'category' => '經典排版']]])
            ->assertSessionHasErrors('issues.0.category');
        $this->post(route('feedback.reports.store', $this->project), ['issues' => [['title' => 'a', 'description' => 'b', 'category' => '版面排版']]])
            ->assertSessionHasNoErrors();
        $this->assertSame(['經典排版'], $other->reportCategories());
    }

    public function test_editing_keeps_an_old_category_and_allows_uncategorized(): void
    {
        $this->project->update(['report_categories' => ['版面排版', '其他']]);
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => '經典排版']);
        $this->loginDeveloper();

        $this->get(route('feedback.portal', $this->project))->assertSee('未分類')->assertSee('經典排版');
        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => $report->title, 'description' => $report->description, 'category' => '經典排版'])
            ->assertSessionHasNoErrors();
        $this->put(route('feedback.reports.update', [$this->project, $report]), ['title' => $report->title, 'description' => $report->description, 'category' => ''])
            ->assertSessionHasNoErrors();
        $this->assertNull($report->refresh()->category);
    }

    public function test_artisan_command_shows_and_sets_categories(): void
    {
        $other = FeedbackProject::factory()->create(['slug' => 'beta']);

        $this->artisan('feedback:categories', ['project' => 'all', 'categories' => '程式使用問題,版面排版,其他'])->assertSuccessful();
        $this->assertSame(['程式使用問題', '版面排版', '其他'], $other->refresh()->reportCategories());
        $this->assertSame(['程式使用問題', '版面排版', '其他'], $this->project->refresh()->reportCategories());

        $this->artisan('feedback:categories', ['project' => 'beta'])->expectsOutputToContain('beta：程式使用問題,版面排版,其他')->assertSuccessful();
        $this->artisan('feedback:categories', ['project' => 'beta', '--clear' => true])->assertSuccessful();
        $this->assertSame([], $other->refresh()->reportCategories());
        $this->artisan('feedback:categories', ['project' => 'nope'])->assertFailed();
    }

    public function test_category_can_be_switched_from_detail_dialog_and_page(): void
    {
        $this->project->update(['report_categories' => ['版面排版', '其他']]);
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => '經典排版']);
        $this->loginDeveloper();

        $portal = $this->get(route('feedback.portal', $this->project))->getContent();
        $dialog = substr($portal, strpos($portal, 'id="detail-report-'.$report->public_id.'"'));
        $this->assertStringContainsString('data-category-quick', substr($dialog, 0, strpos($dialog, '</dialog>')));
        $this->get(route('feedback.reports.show', [$this->project, $report]))
            ->assertSee('data-category-quick', false)
            ->assertSee('<option value="經典排版" selected>', false)
            ->assertSee('未分類');

        $url = route('feedback.reports.category.update', [$this->project, $report]);
        $this->patchJson($url, ['category' => '版面排版'])->assertOk()->assertJson(['category' => '版面排版']);
        $this->assertSame('版面排版', $report->refresh()->category);
        $this->patchJson($url, ['category' => ''])->assertOk()->assertJson(['category' => null]);
        $this->assertNull($report->refresh()->category);
        $this->patchJson($url, ['category' => '經典排版'])->assertUnprocessable()
            ->assertJsonValidationErrors(['category' => '這個分類不在專案的分類清單裡，請重新整理後再選。']);
    }

    public function test_category_switch_is_hidden_and_refused_without_categories_or_permission(): void
    {
        $report = FeedbackReport::factory()->for($this->project)->create();
        $url = route('feedback.reports.category.update', [$this->project, $report]);

        $this->patchJson($url, ['category' => '其他'])->assertForbidden();

        $this->loginDeveloper();
        $this->get(route('feedback.reports.show', [$this->project, $report]))->assertDontSee('data-category-quick', false);
        $this->patchJson($url, ['category' => '其他'])->assertUnprocessable()->assertJsonValidationErrors(['category' => '這個專案沒有設定分類。']);

        $other = FeedbackProject::factory()->create(['report_categories' => ['其他']]);
        $this->patchJson(route('feedback.reports.category.update', [$other, $report]), ['category' => '其他'])->assertNotFound();
    }

    public function test_list_rows_and_board_cards_show_a_category_dropdown(): void
    {
        $this->project->update(['report_categories' => ['版面排版', '其他']]);
        $report = FeedbackReport::factory()->for($this->project)->create(['category' => '經典排版']);
        $this->loginDeveloper();

        $list = $this->get(route('feedback.portal', $this->project))->getContent();
        $row = substr($list, strpos($list, 'data-report-category-cell'));
        $row = substr($row, 0, strpos($row, '</td>'));
        $this->assertStringContainsString('id="quick-category-'.$report->public_id.'-row"', $row);
        $this->assertStringContainsString('<option value="經典排版" selected>', $row);
        $this->assertStringContainsString('未分類', $row);

        $board = $this->get(route('feedback.portal', [$this->project, 'view' => 'board']))->getContent();
        $this->assertStringContainsString('id="quick-category-'.$report->public_id.'-card"', $board);
        $card = substr($board, strpos($board, 'data-report-id="'.$report->public_id.'"'));
        $card = substr($card, 0, strpos($card, '</article>'));
        $this->assertLessThan(strpos($card, 'data-report-creator'), strpos($card, 'data-report-number'));
        $this->assertStringContainsString('建立者：', $card);

        $this->project->update(['report_categories' => null]);
        $this->get(route('feedback.portal', $this->project))->assertDontSee('data-category-quick', false);
    }
}
