<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * 詳細視窗、詳細頁直接切換分類。權限與編輯整張單相同。
 */
class UpdateFeedbackReportCategoryRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canManage($report->feedbackProject)
            && app(FeedbackAccess::class)->ensureReportVisible($report);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $report = $this->route('feedbackReport');
        $categories = $report instanceof FeedbackReport ? $report->feedbackProject->reportCategories() : [];

        return [
            'category' => $categories === []
                ? ['prohibited']
                : ['nullable', 'string', Rule::in(array_values(array_unique(array_filter([...$categories, $report?->category]))))],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'category.prohibited' => '這個專案沒有設定分類。',
            'category.in' => '這個分類不在專案的分類清單裡，請重新整理後再選。',
        ];
    }
}
