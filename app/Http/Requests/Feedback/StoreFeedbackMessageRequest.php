<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\PublicReporting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\File;
use Illuminate\Validation\Validator;

class StoreFeedbackMessageRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        $allowed = $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canView($report)
            && app(FeedbackAccess::class)->ensureReportVisible($report);

        // 公開回報停止收件後，公開單對回報者唯讀。
        abort_if($allowed && $this->isPublicReporter() && ! $report->feedbackProject->public_reporting_enabled, 403, '這個專案已停止收件，這張單只能查看。');

        return $allowed;
    }

    private function isPublicReporter(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && $report->isPublicReport()
            && ! app(FeedbackAccess::class)->isOwner($report->feedbackProject);
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $report = $this->route('feedbackReport');
                if (! $report instanceof FeedbackReport || ! $this->isPublicReporter() || $validator->errors()->isNotEmpty()) {
                    return;
                }

                $limit = (int) config('feedback.public_reporting.max_attachments_per_report');
                if ($report->feedbackAttachments()->count() + count($this->file('screenshots', [])) > $limit) {
                    $validator->errors()->add('screenshots', "這張單的附圖總數不可超過 {$limit} 張。");
                }
            },
        ];
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $report = $this->route('feedbackReport');
        $isPublicReporter = $report instanceof FeedbackReport
            && $report->isPublicReport()
            && ! app(FeedbackAccess::class)->isOwner($report->feedbackProject);

        return [
            'body' => ['required', 'string', 'max:10000'],
            'screenshots' => ['nullable', 'array', 'max:'.($isPublicReporter ? PublicReporting::MAX_SCREENSHOTS : 5)],
            'screenshots.*' => [
                'required',
                File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max($isPublicReporter ? PublicReporting::MAX_SCREENSHOT_KILOBYTES : '10mb'),
                'mimetypes:image/jpeg,image/png,image/webp',
            ],
        ];
    }
}
