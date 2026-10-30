<?php

namespace App\Http\Requests\Feedback;

use App\Actions\UpdateFeedbackReportAdjustmentAction;
use App\Enums\FeedbackAttachmentKind;
use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\File;

class UpdateFeedbackAdjustmentRequest extends FormRequest
{
    use RedirectsUnauthorizedToLogin;

    public const MAX_IMAGES_PER_UPLOAD = 5;

    /**
     * Keep adjustment errors apart from the message form on the same page.
     *
     * @var string
     */
    protected $errorBag = 'adjustment';

    /**
     * 只有開發者能編輯調整重點，老師端唯讀。
     */
    public function authorize(): bool
    {
        $report = $this->route('feedbackReport');

        return $report instanceof FeedbackReport
            && app(FeedbackAccess::class)->isOwner($report->feedbackProject);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $report = $this->route('feedbackReport');

        return [
            'adjustment_note' => ['nullable', 'string', 'max:'.UpdateFeedbackReportAdjustmentAction::MAX_NOTE_LENGTH],
            'adjustment_images' => ['nullable', 'array', 'max:'.self::MAX_IMAGES_PER_UPLOAD],
            'adjustment_images.*' => [
                'required',
                File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max('10mb'),
                'mimetypes:image/jpeg,image/png,image/webp',
            ],
            'remove_adjustment_attachments' => ['nullable', 'array'],
            'remove_adjustment_attachments.*' => [
                'integer',
                Rule::exists('feedback_attachments', 'id')
                    ->where('feedback_report_id', $report?->id)
                    ->where('kind', FeedbackAttachmentKind::Adjustment->value),
            ],
        ];
    }

    public function attributes(): array
    {
        return [
            'adjustment_note' => '調整重點',
            'adjustment_images' => '調整圖片',
            'adjustment_images.*' => '調整圖片',
            'remove_adjustment_attachments.*' => '要刪除的調整圖片',
        ];
    }
}
