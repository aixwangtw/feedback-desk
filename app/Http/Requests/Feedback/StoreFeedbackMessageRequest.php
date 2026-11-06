<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackAttachmentRules;
use App\Support\PublicReporting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;
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
            // 公開回報者只能附圖；有登入的雙方另可附 mp4 影片（每支 50 MB，圖片仍是每張 10 MB）。
            'screenshots.*' => $isPublicReporter
                ? [
                    'required',
                    File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max(PublicReporting::MAX_SCREENSHOT_KILOBYTES),
                    'mimetypes:image/jpeg,image/png,image/webp',
                ]
                : [
                    'required',
                    'file',
                    'mimetypes:'.implode(',', [...FeedbackAttachmentRules::IMAGE_MIME_TYPES, ...FeedbackAttachmentRules::VIDEO_MIME_TYPES]),
                    'max:'.FeedbackAttachmentRules::MAX_VIDEO_KILOBYTES,
                    function (string $attribute, mixed $value, \Closure $fail): void {
                        if ($value instanceof UploadedFile
                            && ! FeedbackAttachmentRules::isVideoMime($value->getMimeType())
                            && $value->getSize() > FeedbackAttachmentRules::MAX_IMAGE_BYTES) {
                            $fail('每張圖片不可超過 '.FeedbackAttachmentRules::maxImageMegabytes().' MB。');
                        }
                    },
                ],
        ];
    }

    /**
     * 有登入的雙方可附影片，欄位名稱寫「圖片／影片」；公開回報者只能附圖。
     *
     * @return array<string, string>
     */
    public function attributes(): array
    {
        $report = $this->route('feedbackReport');
        $isPublicReporter = $report instanceof FeedbackReport
            && $report->isPublicReport()
            && ! app(FeedbackAccess::class)->isOwner($report->feedbackProject);
        $field = $isPublicReporter ? '截圖' : FeedbackAttachmentRules::MESSAGE_FIELD;

        return ['screenshots' => $field, 'screenshots.*' => $field];
    }
}
