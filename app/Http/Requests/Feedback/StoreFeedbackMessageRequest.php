<?php

namespace App\Http\Requests\Feedback;

use App\Http\Requests\Feedback\Concerns\RedirectsUnauthorizedToLogin;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
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
            && app(FeedbackAccess::class)->canView($report);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:10000'],
            'screenshots' => ['nullable', 'array', 'max:5'],
            'screenshots.*' => [
                'required',
                File::image()->types(['jpg', 'jpeg', 'png', 'webp'])->max('10mb'),
                'mimetypes:image/jpeg,image/png,image/webp',
            ],
        ];
    }
}
