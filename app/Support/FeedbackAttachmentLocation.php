<?php

namespace App\Support;

use App\Models\FeedbackAttachment;
use Illuminate\Support\Facades\Storage;

/**
 * 附件在伺服器上的位置，給 artisan 指令輸出，讓 AI agent 能直接讀檔。
 */
class FeedbackAttachmentLocation
{
    /**
     * local 磁碟回傳絕對路徑（路徑含 `..` 或以 `/` 開頭時不組，視同非本機）；其他磁碟（例如 S3）沒有本機路徑，回傳 `disk:path` 並標記 is_local 為 false。
     *
     * @return array{path: string, is_local: bool}
     */
    public static function resolve(FeedbackAttachment $attachment): array
    {
        $driver = config("filesystems.disks.{$attachment->disk}.driver");

        $isSafePath = ! str_starts_with($attachment->path, '/') && ! in_array('..', explode('/', str_replace('\\', '/', $attachment->path)), true);

        if ($driver === 'local' && $isSafePath) {
            return ['path' => Storage::disk($attachment->disk)->path($attachment->path), 'is_local' => true];
        }

        return ['path' => "{$attachment->disk}:{$attachment->path}", 'is_local' => false];
    }
}
