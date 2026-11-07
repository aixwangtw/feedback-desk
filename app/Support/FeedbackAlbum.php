<?php

namespace App\Support;

use App\Enums\FeedbackAttachmentKind;
use App\Models\FeedbackAttachment;
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
    /** 清單與看板每張單最多顯示的縮圖數，其餘用「+N」。 */
    public const LIST_THUMB_LIMIT = 3;

    /**
     * 相簿清單：原始附件、每則（未收回）留言的附件；$viewerIsOwner 時再加上待審留言（草稿）的附件。
     *
     * @return Collection<int, array{kind: 'original'|'message'|'draft', url: string, name: string, is_video: bool, source: string, at: Carbon, uploaded_at: Carbon, id: int}>
     */
    public function items(FeedbackReport $report, bool $viewerIsOwner): Collection
    {
        $project = $report->feedbackProject;
        $items = $this->itemsForReports(collect([$report]), $viewerIsOwner)->get($report->id, collect());

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
                        'uploaded_at' => $draft->updated_at,
                        'id' => 0,
                    ]);
                }
            }
        }

        return $items;
    }

    /**
     * 清單、看板用：同一份查詢規則一次取多張單的附件（不含草稿，列表不顯示草稿附件），每張單最新的排最前面。
     * 收回的留言連同附件一起不算（留言用 Eloquent 關聯，預設排除已收回）。
     *
     * @param  Collection<int, FeedbackReport>  $reports
     * @return Collection<int, Collection<int, array{kind: string, url: string, name: string, is_video: bool, source: string, at: Carbon, uploaded_at: Carbon, id: int}>>
     */
    public function listItemsForReports(Collection $reports, bool $viewerIsOwner): Collection
    {
        return $this->itemsForReports($reports, $viewerIsOwner)->map(
            fn (Collection $items): Collection => $items
                ->sort(fn (array $a, array $b): int => [$b['uploaded_at']->getTimestamp(), $b['id']] <=> [$a['uploaded_at']->getTimestamp(), $a['id']])
                ->values(),
        );
    }

    /**
     * 原始附件與留言附件，以單的 id 分組（不含草稿）。
     *
     * @param  Collection<int, FeedbackReport>  $reports
     * @return Collection<int, Collection<int, array{kind: string, url: string, name: string, is_video: bool, source: string, at: Carbon, uploaded_at: Carbon, id: int}>>
     */
    private function itemsForReports(Collection $reports, bool $viewerIsOwner): Collection
    {
        $reports = $reports->keyBy('id');
        $grouped = $reports->map(fn (): Collection => collect());
        if ($reports->isEmpty()) {
            return $grouped;
        }

        $originals = FeedbackAttachment::query()
            ->whereIn('feedback_report_id', $reports->keys())
            ->whereNull('feedback_message_id')
            ->ofKind(FeedbackAttachmentKind::Feedback)
            ->orderBy('id')
            ->get();
        foreach ($originals as $attachment) {
            $report = $reports[$attachment->feedback_report_id];
            $grouped[$report->id]->push([
                'kind' => 'original',
                'url' => route('feedback.attachments.show', [$report->feedbackProject, $report, $attachment]),
                'name' => $attachment->original_name,
                'is_video' => $attachment->isVideo(),
                'source' => '原始附件',
                'at' => $report->created_at,
                'uploaded_at' => $attachment->created_at ?? $report->created_at,
                'id' => $attachment->id,
            ]);
        }

        $preloaded = $reports->filter(fn (FeedbackReport $report): bool => $report->relationLoaded('feedbackMessages'));
        $messages = $preloaded->flatMap(fn (FeedbackReport $report) => $report->feedbackMessages);
        $toLoad = $reports->diffKeys($preloaded);
        if ($toLoad->isNotEmpty()) {
            $messages = $messages->concat(
                FeedbackMessage::query()->whereIn('feedback_report_id', $toLoad->keys())->with(['feedbackAttachments', 'authorClientAccount', 'authorDeveloper'])->orderBy('id')->get(),
            );
        }
        /** @var FeedbackMessage $message */
        foreach ($messages->sortBy('id') as $message) {
            $report = $reports[$message->feedback_report_id];
            foreach ($message->feedbackAttachments as $attachment) {
                $grouped[$report->id]->push([
                    'kind' => 'message',
                    'url' => route('feedback.attachments.show', [$report->feedbackProject, $report, $attachment]),
                    'name' => $attachment->original_name,
                    'is_video' => $attachment->isVideo(),
                    'source' => $message->displayAuthor($report, $viewerIsOwner).' 的留言',
                    'at' => $message->created_at,
                    'uploaded_at' => $attachment->created_at ?? $message->created_at,
                    'id' => $attachment->id,
                ]);
            }
        }

        return $grouped;
    }
}
