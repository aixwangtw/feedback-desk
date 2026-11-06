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

    /** 瀏覽器端（拖曳、按鈕選檔）檢查不合格時的說明，文字與伺服器端允許的格式一致。 */
    public const TYPE_ERROR = '只能附 jpg、png、webp 圖片或 mp4 影片';

    public const TYPE_ERROR_IMAGES_ONLY = '只能附 jpg、png、webp 圖片';

    /**
     * 給瀏覽器端共用 JS（resources/js/attachment-files.js）的規則：數字與文字都來自這裡的常數，JS 不寫死。
     *
     * @return array{allowVideo: bool, maxFiles: int, maxImageBytes: int, maxVideoBytes: int, imageTypes: list<string>, videoTypes: list<string>, fieldName: string, typeMessage: string}
     */
    public static function browserRules(): array
    {
        return [
            'allowVideo' => true,
            'maxFiles' => self::MAX_FILES,
            'maxImageBytes' => self::MAX_IMAGE_BYTES,
            'maxVideoBytes' => self::MAX_VIDEO_BYTES,
            'imageTypes' => self::IMAGE_MIME_TYPES,
            'videoTypes' => ['video/mp4'],
            'fieldName' => self::MESSAGE_FIELD,
            'typeMessage' => self::TYPE_ERROR,
        ];
    }

    /**
     * 公開回報者在單頁留言只能附圖片，張數與大小用公開回報自己的上限。
     *
     * @return array{allowVideo: bool, maxFiles: int, maxImageBytes: int, maxVideoBytes: int, imageTypes: list<string>, videoTypes: list<string>, fieldName: string, typeMessage: string}
     */
    public static function publicBrowserRules(): array
    {
        return [
            ...self::browserRules(),
            'allowVideo' => false,
            'maxFiles' => PublicReporting::MAX_SCREENSHOTS,
            'maxImageBytes' => PublicReporting::MAX_SCREENSHOT_KILOBYTES * 1024,
            'fieldName' => '截圖',
            'typeMessage' => self::TYPE_ERROR_IMAGES_ONLY,
        ];
    }

    /** 放進 data-attachment-rules 屬性的 JSON（Blade 的 {{ }} 會跳脫引號）。 */
    public static function browserRulesJson(bool $imagesOnly = false): string
    {
        return json_encode($imagesOnly ? self::publicBrowserRules() : self::browserRules(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * 附件顯示用的短標題：檔名去掉副檔名（「圖一-缺圖的位置.png」顯示成「圖一-缺圖的位置」）。
     * JS 端對應 attachment-files.js 的 attachmentTitle，兩邊規則一致。
     */
    public static function displayTitle(string $name): string
    {
        $title = preg_replace('/\.[A-Za-z0-9]{1,5}$/u', '', $name);

        return $title === null || $title === '' ? $name : $title;
    }

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
