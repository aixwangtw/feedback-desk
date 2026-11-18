<?php

namespace App\Http\Requests\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackProject;
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

        // 網頁上不能任意改狀態：留言時自動切換（等工程師／等客戶）。客戶只能按「完成」結單，
        // 或在留言區把還不是等工程師的單改回等工程師；開發團隊在網頁上不能改。排程與還原用 artisan feedback:status。
        abort_if(
            $allowed
                && (app(FeedbackAccess::class)->isOwner($report->feedbackProject)
                    || ! $this->isClientAllowedChange($report)),
            403,
            '狀態會依留言自動切換；網頁上只有'.FeedbackProject::clientRoleFor($report instanceof FeedbackReport ? $report->feedbackProject : null).'能按「完成」結單，或把單改回「'.FeedbackReportStatus::New->label($report instanceof FeedbackReport ? $report->feedbackProject : null).'」。',
        );

        return $allowed;
    }

    /**
     * 客戶能做的兩種改變：結單（完成），或把等客戶／已完成的單改回等工程師。
     */
    private function isClientAllowedChange(FeedbackReport $report): bool
    {
        return match ($this->input('status')) {
            FeedbackReportStatus::Completed->value => true,
            FeedbackReportStatus::New->value => $report->status !== FeedbackReportStatus::New,
            default => false,
        };
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
