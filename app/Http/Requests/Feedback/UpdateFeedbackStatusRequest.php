<?php

namespace App\Http\Requests\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateFeedbackStatusRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        $allowed = $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canManage($report->feedbackProject)
            && app(FeedbackAccess::class)->ensureReportVisible($report);

        // 網頁上不能手動改狀態：留言時自動切換（等工程師／等客戶），只有客戶能按「完成」結單。
        // 排程與還原用 artisan feedback:status。
        abort_if(
            $allowed
                && (app(FeedbackAccess::class)->isOwner($report->feedbackProject)
                    || $this->input('status') !== FeedbackReportStatus::Completed->value),
            403,
            '狀態會依留言自動切換；網頁上只有'.config('feedback.labels.client').'能按「完成」結單。',
        );

        return $allowed;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(FeedbackReportStatus::class)],
        ];
    }
}
