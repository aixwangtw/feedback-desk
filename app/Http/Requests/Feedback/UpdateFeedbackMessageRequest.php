<?php

namespace App\Http\Requests\Feedback;

/**
 * 編輯自己的留言：規則同新留言（內文必填、可新增附件），另可勾選要移除的附件。
 * 「是不是自己的留言」由 ManageFeedbackMessageAction 判斷。
 */
class UpdateFeedbackMessageRequest extends StoreFeedbackMessageRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'remove_attachments' => ['nullable', 'array'],
            'remove_attachments.*' => ['integer'],
        ];
    }
}
