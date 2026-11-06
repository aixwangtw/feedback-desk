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

        // 已完成只由客戶確認；開發團隊端不能改成已完成。
        abort_if(
            $allowed
                && $this->input('status') === FeedbackReportStatus::Completed->value
                && app(FeedbackAccess::class)->isOwner($report->feedbackProject),
            403,
            '已完成要由'.config('feedback.labels.client').'確認，開發團隊不能直接改成已完成。',
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
