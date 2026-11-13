<?php

namespace App\Http\Requests\Feedback;

use App\Services\TurnstileVerifier;
use App\Support\FeedbackAttachmentRules;
use App\Support\PublicReporting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StorePublicFeedbackReportRequest extends FormRequest
{
    public const HONEYPOT_FIELD = 'contact_website';

    public const TURNSTILE_FIELD = 'cf-turnstile-response';

    private bool $honeypotTripped = false;

    /**
     * 首頁沒有開啟公開回報時，這個網址等於不存在。
     */
    public function authorize(): bool
    {
        abort_if(app(PublicReporting::class)->project() === null, 404);

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:160'],
            'description' => ['required', 'string', 'max:10000'],
            'reporter_name' => ['nullable', 'string', 'max:50'],
            'screenshots' => ['nullable', 'array', 'max:'.PublicReporting::MAX_SCREENSHOTS],
            'screenshots.*' => FeedbackAttachmentRules::uploadRules(PublicReporting::MAX_SCREENSHOT_KILOBYTES),
            self::HONEYPOT_FIELD => ['nullable'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $this->honeypotTripped = filled($this->input(self::HONEYPOT_FIELD));
            },
            function (Validator $validator): void {
                if ($this->honeypotTripped || $validator->errors()->isNotEmpty() || ! app(PublicReporting::class)->turnstileEnabled()) {
                    return;
                }

                if (! app(TurnstileVerifier::class)->passes($this->input(self::TURNSTILE_FIELD), $this->ip())) {
                    $validator->errors()->add('turnstile', '人機驗證沒有通過，請重新驗證後再送出。');
                }
            },
        ];
    }

    public function honeypotTripped(): bool
    {
        return $this->honeypotTripped;
    }

    public function attributes(): array
    {
        return [
            'title' => '標題',
            'description' => '說明',
            'reporter_name' => '稱呼',
            'screenshots' => FeedbackAttachmentRules::MESSAGE_FIELD,
            'screenshots.*' => FeedbackAttachmentRules::MESSAGE_FIELD,
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'screenshots.max' => '圖片或影片最多 '.PublicReporting::MAX_SCREENSHOTS.' 個。',
            'screenshots.*.max' => '每個檔案不可超過 '.FeedbackAttachmentRules::MAX_VIDEO_MEGABYTES.' MB。',
        ];
    }
}
