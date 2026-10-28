<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackProject;
use App\Services\TurnstileVerifier;
use App\Support\FeedbackAccess;
use App\Support\PublicReporting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\File;
use Illuminate\Validation\Validator;

class StoreFeedbackReportRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $project = $this->route('feedbackProject');

        return $project instanceof FeedbackProject
            && (app(FeedbackAccess::class)->isClient($project)
                || app(FeedbackAccess::class)->isOwner($project));
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $project = $this->route('feedbackProject');
        $categories = $project instanceof FeedbackProject ? $project->reportCategories() : [];

        return [
            'issues' => ['required', 'array', 'min:1', 'max:20'],
            'issues.*.title' => ['required', 'string', 'max:160'],
            'issues.*.description' => ['required', 'string', 'max:10000'],
            'issues.*.category' => $categories === []
                ? ['prohibited']
                : ['required', 'string', Rule::in($categories)],
            'issues.*.screenshots' => ['nullable', 'array', 'max:5'],
            'issues.*.screenshots.*' => [
                'required',
                File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max('10mb'),
                'mimetypes:image/jpeg,image/png,image/webp',
            ],
        ];
    }

    public function attributes(): array
    {
        return [
            'issues' => '問題',
            'issues.*.title' => '問題標題',
            'issues.*.description' => '問題說明',
            'issues.*.category' => '分類',
            'issues.*.screenshots' => '截圖',
            'issues.*.screenshots.*' => '截圖',
        ];
    }

    /**
     * 免登入入口沿用公開回報的防機器人：隱藏欄位有值就擋下，有設定 Turnstile 時要通過驗證。
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $project = $this->route('feedbackProject');
                if (! $project instanceof FeedbackProject || ! app(FeedbackAccess::class)->isGuest($project)) {
                    return;
                }

                if (filled($this->input(StorePublicFeedbackReportRequest::HONEYPOT_FIELD))) {
                    $validator->errors()->add('issues', '送出失敗，請重新整理頁面後再試。');

                    return;
                }

                if ($validator->errors()->isEmpty() && app(PublicReporting::class)->turnstileEnabled()
                    && ! app(TurnstileVerifier::class)->passes($this->input(StorePublicFeedbackReportRequest::TURNSTILE_FIELD), $this->ip())) {
                    $validator->errors()->add('turnstile', '人機驗證沒有通過，請重新驗證後再送出。');
                }
            },
        ];
    }
}
