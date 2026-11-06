<?php

namespace App\Support;

/**
 * 附件規則（網頁上傳、artisan --attach、對話面板共用）。
 * 圖片：jpg／png／webp，每張 10 MB；留言與待審留言另收 mp4 影片（教操作的錄影），每支 50 MB。
 * 開單、調整重點、公開回報仍只收圖片。
 */
final class FeedbackAttachmentRules
{
    /** artisan --attach 說明（只能用常數組字串，因為寫在 #[Signature] 裡）。 */
    public const CLI_ATTACH_HELP = '要附上的圖片或影片路徑，可重複多次（jpg/png/webp 每個 '.self::MAX_IMAGE_MEGABYTES.' MB、mp4 每個 '.self::MAX_VIDEO_MEGABYTES.' MB，最多 '.self::MAX_FILES.' 個）';

    /** @var list<string> */
    public const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * mp4 依判斷方式可能是 video/mp4 或 application/mp4（同一種檔案），兩者都收；存檔與播放一律當 video/mp4。
     *
     * @var list<string>
     */
    public const VIDEO_MIME_TYPES = ['video/mp4', 'application/mp4'];

    public const MAX_IMAGE_MEGABYTES = 10;

    public const MAX_VIDEO_MEGABYTES = 50;

    public const MAX_IMAGE_BYTES = self::MAX_IMAGE_MEGABYTES * 1024 * 1024;

    public const MAX_VIDEO_BYTES = self::MAX_VIDEO_MEGABYTES * 1024 * 1024;

    public const MAX_VIDEO_KILOBYTES = self::MAX_VIDEO_MEGABYTES * 1024;

    public const MAX_FILES = 5;

    /** 留言檔案欄位的 accept 屬性。 */
    public const MESSAGE_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4';

    /** 可附影片的地方，上傳按鈕的字。 */
    public const MESSAGE_BUTTON = '附件';

    /** 可附影片的地方，欄位與錯誤訊息裡的名稱。 */
    public const MESSAGE_FIELD = '圖片／影片';

    public static function maxImageMegabytes(): int
    {
        return self::MAX_IMAGE_MEGABYTES;
    }

    public static function maxVideoMegabytes(): int
    {
        return self::MAX_VIDEO_MEGABYTES;
    }

    /**
     * 留言上傳欄旁的提示文字（數字來自上面的上限常數）。
     */
    public static function messageHint(): string
    {
        return '圖片或影片，最多 '.self::MAX_FILES.' 個；圖片每個 '.self::maxImageMegabytes().' MB、影片每個 '.self::maxVideoMegabytes().' MB';
    }

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
