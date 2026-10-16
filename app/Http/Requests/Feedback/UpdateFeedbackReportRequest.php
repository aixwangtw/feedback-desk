<?php

namespace App\Http\Requests\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\File;
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

        return [
            'title' => ['required', 'string', 'max:160'],
            'description' => ['required', 'string', 'max:10000'],
            'screenshots' => ['nullable', 'array', 'max:'.self::MAX_SCREENSHOTS],
            'screenshots.*' => [
                'required',
                File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max('10mb'),
                'mimetypes:image/jpeg,image/png,image/webp',
            ],
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
                    $validator->errors()->add('screenshots', '截圖總數不可超過 '.self::MAX_SCREENSHOTS.' 張。');
                }
            },
        ];
    }

    public function attributes(): array
    {
        return [
            'title' => '問題標題',
            'description' => '問題說明',
            'screenshots' => '截圖',
            'screenshots.*' => '截圖',
            'remove_attachments.*' => '要刪除的截圖',
        ];
    }
}
