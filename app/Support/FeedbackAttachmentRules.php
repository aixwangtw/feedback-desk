<?php

namespace App\Support;

/**
 * 附件規則（網頁上傳、artisan --attach、對話面板共用）。
 * 圖片：jpg／png／webp，每張 10 MB；留言與待審留言另收 mp4 影片（教操作的錄影），每支 50 MB。
 * 開單、調整重點、公開回報仍只收圖片。
 */
final class FeedbackAttachmentRules
{
    /** @var list<string> */
    public const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * mp4 依判斷方式可能是 video/mp4 或 application/mp4（同一種檔案），兩者都收；存檔與播放一律當 video/mp4。
     *
     * @var list<string>
     */
    public const VIDEO_MIME_TYPES = ['video/mp4', 'application/mp4'];

    public const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    public const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

    public const MAX_VIDEO_KILOBYTES = 50 * 1024;

    public const MAX_FILES = 5;

    /** 留言檔案欄位的 accept 屬性。 */
    public const MESSAGE_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4';

    /** 留言區旁的提示文字。 */
    public const MESSAGE_HINT = '圖片最多 5 個檔，每張 10 MB；mp4 影片每支 50 MB';

    public static function isVideoMime(?string $mime): bool
    {
        return in_array($mime, self::VIDEO_MIME_TYPES, true);
    }

    /**
     * 存進附件紀錄的 MIME：mp4 一律記成 video/mp4，瀏覽器才會用影片播放。
     */
    public static function storedMime(?string $mime): string
    {
        return self::isVideoMime($mime) ? 'video/mp4' : ($mime ?? 'application/octet-stream');
    }
}
