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

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->canManage($report->feedbackProject);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(FeedbackReportStatus::class)->only(FeedbackReportStatus::selectable())],
        ];
    }
}
