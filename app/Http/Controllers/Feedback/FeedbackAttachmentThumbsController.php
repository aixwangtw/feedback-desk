<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackAlbum;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * 清單、看板附件縮圖的輪詢端點：有人上傳新附件（原始或留言）時，清單那一格跟著更新。
 * 清單與相簿同一份查詢規則（FeedbackAlbum），這裡只負責挑出頁面上的單並套用同一個縮圖畫面。
 */
class FeedbackAttachmentThumbsController extends Controller
{
    private const MAX_IDS = 100;

    public function index(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): JsonResponse
    {
        if (! $access->canManage($feedbackProject)) {
            $access->deny($feedbackProject);
        }
        $isOwner = $access->isOwner($feedbackProject);

        $ids = collect((array) $request->query('ids', []))
            ->filter(fn (mixed $id): bool => is_string($id) && $id !== '')
            ->unique()
            ->take(self::MAX_IDS)
            ->values();

        $reports = $ids->isEmpty() ? collect() : $feedbackProject->feedbackReports()
            ->whereIn('public_id', $ids)
            ->when(! $isOwner, fn ($query) => $query->createdByClient()->whereNull('client_deleted_at'))
            ->with('feedbackProject')
            ->get();

        $items = app(FeedbackAlbum::class)->listItemsForReports($reports, $isOwner);

        return response()->json([
            'reports' => $reports->mapWithKeys(fn (FeedbackReport $report): array => [
                $report->public_id => [
                    'count' => $items[$report->id]->count(),
                    'row_html' => $this->html($report, $items[$report->id], false),
                    'card_html' => $this->html($report, $items[$report->id], true),
                ],
            ])->all(),
        ]);
    }

    private function html(FeedbackReport $report, $items, bool $card): string
    {
        return trim(view('feedback.reports._attachment-thumbs', ['report' => $report, 'items' => $items, 'card' => $card])->render());
    }
}
