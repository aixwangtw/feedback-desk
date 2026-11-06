<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Foundation\Http\FormRequest;

/**
 * 調整重點已停用：網頁上不能再寫入（控制器一律回 410）。這個請求只保留原本的權限檢查，
 * 讓沒權限的人（老師、訪客、回報者）照舊得到 403 或導向登入，不會因為路由還在而多知道什麼。
 */
class UpdateFeedbackAdjustmentRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->isOwner($report->feedbackProject);
    }

    /**
     * @return array<string, never>
     */
    public function rules(): array
    {
        return [];
    }
}
