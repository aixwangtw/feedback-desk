<?php

namespace App\Actions;

use App\Enums\FeedbackAttachmentKind;
use App\Models\FeedbackAttachment;
use App\Models\FeedbackReport;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\File\File;

/**
 * 寫入回饋單的「調整說明」（文字＋圖片）。不會改動回饋單狀態。
 */
class UpdateFeedbackReportAdjustmentAction
{
    public const MAX_NOTE_LENGTH = 20000;

    /**
     * 未提供 `note` 時保留原文字；`append` 為 true 時把文字接在原內容後並空一行，否則覆寫。
     *
     * @param  array{note?: string|null, append?: bool, images?: list<File>, remove_attachments?: list<int|string>}  $data
     */
    public function handle(FeedbackReport $report, array $data): FeedbackReport
    {
        $disk = config('feedback.disk');
        $storedPaths = [];

        try {
            $removedAttachments = DB::transaction(function () use ($report, $data, $disk, &$storedPaths) {
                $attributes = ['latest_activity_at' => now()];

                if (array_key_exists('note', $data)) {
                    $attributes['adjustment_note'] = self::mergeNote(
                        $report->adjustment_note,
                        $data['note'],
                        (bool) ($data['append'] ?? false),
                    );
                }

                $noteChanged = array_key_exists('adjustment_note', $attributes)
                    && $attributes['adjustment_note'] !== $report->adjustment_note;

                $report->update($attributes);

                $removedAttachments = $report->adjustmentAttachments()
                    ->whereIn('id', $data['remove_attachments'] ?? [])
                    ->get();
                $removedAttachments->each->delete();

                // 客戶端「有新回覆」看這個時間；內容沒變就不算更新。
                if ($noteChanged || $removedAttachments->isNotEmpty() || ($data['images'] ?? []) !== []) {
                    $report->forceFill(['adjustment_updated_at' => now()])->save();
                }

                foreach ($data['images'] ?? [] as $image) {
                    $path = Storage::disk($disk)->putFile(
                        "feedback/{$report->feedback_project_id}/{$report->public_id}/adjustment",
                        $image,
                    );
                    $storedPaths[] = $path;

                    $report->feedbackAttachments()->create([
                        'kind' => FeedbackAttachmentKind::Adjustment,
                        'disk' => $disk,
                        'path' => $path,
                        'original_name' => $image instanceof UploadedFile ? $image->getClientOriginalName() : $image->getFilename(),
                        'mime_type' => $image->getMimeType() ?? 'application/octet-stream',
                        'size' => $image->getSize(),
                    ]);
                }

                return $removedAttachments;
            });
        } catch (\Throwable $exception) {
            Storage::disk($disk)->delete($storedPaths);

            throw $exception;
        }

        $removedAttachments->each(
            fn (FeedbackAttachment $attachment) => Storage::disk($attachment->disk)->delete($attachment->path),
        );

        return $report->refresh();
    }

    /**
     * 覆寫或追加後的文字；空白內容存成 null，讓老師端不顯示空區塊。
     */
    public static function mergeNote(?string $current, ?string $note, bool $append): ?string
    {
        $note = trim((string) $note);
        $current = trim((string) $current);

        $merged = match (true) {
            ! $append => $note,
            $current === '' => $note,
            $note === '' => $current,
            default => $current."\n\n".$note,
        };

        return $merged === '' ? null : $merged;
    }
}
