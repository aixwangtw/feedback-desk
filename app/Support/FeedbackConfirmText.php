<?php

namespace App\Support;

use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use Illuminate\Support\HtmlString;
use Illuminate\Support\Str;

/**
 * 確認視窗的文字（刪除單、收回留言、捨棄待審留言（完成、通過不跳確認））全部只寫在這裡，
 * 畫面由 x-feedback.confirm-dialog 與 confirm-dialog.js 共用，不再各處寫死、也不用瀏覽器內建的 confirm()。
 */
class FeedbackConfirmText
{
    public const CANCEL = '取消';

    public const DELETE = '確認刪除';

    /** @return array{title: string, message: string, confirm: string, tone: 'danger'} */
    public function deleteReport(FeedbackReport $report, bool $viewerIsOwner): array
    {
        return [
            'title' => $viewerIsOwner ? '確定要刪除這個問題？' : '確定刪除？',
            'message' => $viewerIsOwner
                ? "「{$report->title}」與它的截圖、留言紀錄會被永久刪除，無法復原。"
                : "「{$report->title}」刪除後會從清單移除，無法自行復原。",
            'confirm' => self::DELETE,
            'tone' => 'danger',
        ];
    }

    /** @return array{title: string, message: string, confirm: string, tone: 'danger'} */
    public function withdrawMessage(FeedbackMessage $message): array
    {
        $excerpt = Str::limit(trim(preg_replace('/\s+/u', ' ', (string) $message->body) ?? ''), 40);

        return [
            'title' => '確定要收回這則留言？',
            'message' => ($excerpt !== '' ? "「{$excerpt}」" : '這則留言').'收回後會直接消失，無法復原。',
            'confirm' => '確認收回',
            'tone' => 'danger',
        ];
    }

    /** @return array{title: string, message: string, confirm: string, tone: 'danger'} */
    public function discardDraft(): array
    {
        return ['title' => '確定捨棄這則待審留言？', 'message' => '捨棄後內容與附件都會刪除，無法復原。', 'confirm' => '確認捨棄', 'tone' => 'danger'];
    }

    /**
     * 放在 <form> 上的 data 屬性，confirm-dialog.js 會在送出前先跳出確認視窗。
     *
     * @param  array{title: string, message: string, confirm: string, tone: string}  $text
     */
    public function attributes(array $text): HtmlString
    {
        return new HtmlString(
            'data-confirm-title="'.e($text['title']).'" data-confirm-message="'.e($text['message']).'" data-confirm-label="'.e($text['confirm']).'" data-confirm-tone="'.e($text['tone']).'"',
        );
    }
}
