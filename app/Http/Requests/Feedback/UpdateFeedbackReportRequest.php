<?php

namespace App\Http\Requests\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackAttachmentRules;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateFeedbackReportRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    public const MAX_SCREENSHOTS = 5;

    /**
     * Keep edit errors apart from the "new issues" form on the same page.
     *
     * @var string
     */
    protected $errorBag = 'editReport';

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canManage($report->feedbackProject)
            && app(FeedbackAccess::class)->ensureReportVisible($report);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $report = $this->route('feedbackReport');
        $project = $report instanceof FeedbackReport ? $report->feedbackProject : $this->route('feedbackProject');
        $categories = $project instanceof FeedbackProject ? $project->reportCategories() : [];

        return [
            'title' => ['required', 'string', 'max:160'],
            'description' => ['required', 'string', 'max:10000'],
            'category' => $categories === []
                ? ['prohibited']
                : ['nullable', 'string', Rule::in(array_values(array_unique(array_filter([...$categories, $report?->category]))))],
            'screenshots' => ['nullable', 'array', 'max:'.self::MAX_SCREENSHOTS],
            'screenshots.*' => FeedbackAttachmentRules::uploadRules(),
            'remove_attachments' => ['nullable', 'array'],
            'remove_attachments.*' => [
                'integer',
                Rule::exists('feedback_attachments', 'id')
                    ->where('feedback_report_id', $report?->id)
                    ->whereNull('feedback_message_id')
                    ->where('kind', FeedbackAttachmentKind::Feedback->value),
            ],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $report = $this->route('feedbackReport');
                if (! $report instanceof FeedbackReport || $validator->errors()->isNotEmpty()) {
                    return;
                }

                $remaining = $report->feedbackAttachments()
                    ->whereNull('feedback_message_id')
                    ->ofKind(FeedbackAttachmentKind::Feedback)
                    ->whereNotIn('id', $this->input('remove_attachments', []))
                    ->count();

                if ($remaining + count($this->file('screenshots', [])) > self::MAX_SCREENSHOTS) {
                    $validator->errors()->add('screenshots', '圖片與影片總數不可超過 '.self::MAX_SCREENSHOTS.' 個。');
                }
            },
        ];
    }

    public function attributes(): array
    {
        return [
            'title' => '問題標題',
            'description' => '問題說明',
            'category' => '分類',
            'screenshots' => FeedbackAttachmentRules::MESSAGE_FIELD,
            'screenshots.*' => FeedbackAttachmentRules::MESSAGE_FIELD,
            'remove_attachments.*' => '要刪除的附件',
        ];
    }
}
