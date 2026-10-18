<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\PublicReporting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\File;

class StoreFeedbackMessageRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canView($report)
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
