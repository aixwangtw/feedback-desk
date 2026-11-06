<?php

namespace App\Support;

use App\Enums\FeedbackAttachmentKind;
use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * 相簿：這張單所有附件集中成一份清單（老師原始附件、每則留言的圖片與影片）。
 * 待審留言（草稿）的附件只在 $viewerIsOwner 時帶出，客戶端的清單與網址完全不含草稿。
 * 縮圖直接用原檔（頁面 lazy 載入），不另外產生縮圖檔。
 */
class FeedbackAlbum
{
    /**
     * @return Collection<int, array{kind: 'original'|'message'|'draft', url: string, name: string, is_video: bool, source: string, at: Carbon}>
     */
    public function items(FeedbackReport $report, bool $viewerIsOwner): Collection
    {
        $project = $report->feedbackProject;
        $items = collect();

        foreach ($report->feedbackAttachments()->whereNull('feedback_message_id')->ofKind(FeedbackAttachmentKind::Feedback)->orderBy('id')->get() as $attachment) {
            $items->push([
                'kind' => 'original',
                'url' => route('feedback.attachments.show', [$project, $report, $attachment]),
                'name' => $attachment->original_name,
                'is_video' => $attachment->isVideo(),
                'source' => '原始附件',
                'at' => $report->created_at,
            ]);
        }

        $messages = $report->relationLoaded('feedbackMessages') ? $report->feedbackMessages : $report->feedbackMessages()->with(['feedbackAttachments', 'authorClientAccount', 'authorDeveloper'])->get();
        /** @var FeedbackMessage $message */
        foreach ($messages as $message) {
            foreach ($message->feedbackAttachments as $attachment) {
                $items->push([
                    'kind' => 'message',
                    'url' => route('feedback.attachments.show', [$project, $report, $attachment]),
                    'name' => $attachment->original_name,
                    'is_video' => $attachment->isVideo(),
                    'source' => $message->displayAuthor($report, $viewerIsOwner).' 的留言',
                    'at' => $message->created_at,
                ]);
            }
        }

        if ($viewerIsOwner) {
            foreach ($report->messageDrafts()->with('authorDeveloper')->orderBy('id')->get() as $draft) {
                foreach ($draft->attachmentList() as $index => $file) {
                    $items->push([
                        'kind' => 'draft',
                        'url' => route('feedback.drafts.file', [$project, $report, $draft, $index]),
                        'name' => $file['original_name'],
                        'is_video' => FeedbackAttachmentRules::isVideoMime($file['mime_type']),
                        'source' => '待審留言',
                        'at' => $draft->updated_at,
                    ]);
                }
            }
        }

        return $items;
    }
}
