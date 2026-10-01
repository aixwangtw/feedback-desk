<?php

namespace App\Http\Requests\Feedback;

use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\File;

class StoreFeedbackReportRequest extends FormRequest
{
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
        return [
            'issues' => ['required', 'array', 'min:1', 'max:20'],
            'issues.*.title' => ['required', 'string', 'max:160'],
            'issues.*.description' => ['required', 'string', 'max:10000'],
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
            'issues.*.screenshots' => '截圖',
            'issues.*.screenshots.*' => '截圖',
        ];
    }
}
