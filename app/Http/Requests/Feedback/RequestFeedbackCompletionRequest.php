<?php

namespace App\Http\Requests\Feedback;

use App\Actions\PostFeedbackMessageAction;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class RequestFeedbackCompletionRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    /**
     * 只有開發團隊能請老師確認完成；老師自己用「完成」鈕或留言上的「通過」。
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');
        $access = app(FeedbackAccess::class);

        $allowed = $report instanceof FeedbackReport
            && $access->canManage($report->feedbackProject)
            && $access->ensureReportVisible($report);

        abort_if($allowed && ! $access->isOwner($report->feedbackProject), 403, '只有開發團隊能請'.config('feedback.labels.client').'確認完成。');

        return $allowed;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'body' => ['nullable', 'string', 'max:'.PostFeedbackMessageAction::MAX_BODY_LENGTH],
        ];
    }
}
