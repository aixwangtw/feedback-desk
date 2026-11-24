/**
 * 附件規則（Worker 上傳、命令列 --attach、網頁與對話面板的前端檢查共用）。
 * 圖片：jpg／png／webp，每張 10 MB；影片：mp4、mov（iPhone）、webm，每支 100 MB，一次最多 5 個檔。
 * 開單、補上傳、留言、待審留言、公開回報都收圖片與影片；調整重點與公開回報者在單頁留言仍只收圖片。
 */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/**
 * mp4 依判斷方式可能是 video/mp4 或 application/mp4（同一種檔案），兩者都收，存檔與播放一律當 video/mp4；
 * video/quicktime 是 iPhone 錄的 .mov，video/webm 是 webm，這兩種存檔時保留原本的類型，不轉檔。
 */
export const VIDEO_MIME_TYPES = ['video/mp4', 'application/mp4', 'video/quicktime', 'video/webm'] as const;
export const STORED_VIDEO_MIME = 'video/mp4';
export type VideoMime = 'video/mp4' | 'video/quicktime' | 'video/webm';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 5;

/** 留言檔案欄位的 accept 屬性。 */
export const MESSAGE_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm';
/** 只收圖片的欄位（開單、調整重點、公開回報）。 */
export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(',');

const MB = 1024 * 1024;

/** 可附影片的上傳按鈕文字（只收圖片的地方維持「附圖」「上傳截圖」）。 */
export const MESSAGE_UPLOAD_LABEL = '附件';

/** 可附影片的欄位旁的提示文字（數字來自上面的常數）。 */
export const MESSAGE_HINT = `圖片或影片，最多 ${MAX_FILES} 個；圖片每個 ${MAX_IMAGE_BYTES / MB} MB、影片每個 ${MAX_VIDEO_BYTES / MB} MB`;

/** 可附影片的地方的錯誤訊息（網頁前端、Worker、命令列共用）。 */
export const ATTACHMENT_TYPE_ERROR = '附件只接受 JPG、PNG、WebP 圖片或 MP4、MOV、WebM 影片。';
export const TOO_MANY_ATTACHMENTS = `一次最多附 ${MAX_FILES} 個檔案。`;
export const VIDEO_TOO_LARGE = `每支影片不可超過 ${MAX_VIDEO_BYTES / MB} MB。`;
export function imageTooLarge(maxImageBytes: number): string {
    return `每張圖片不可超過 ${Math.round(maxImageBytes / MB)} MB。`;
}

export function isVideoMime(mime: string | null | undefined): boolean {
    return (VIDEO_MIME_TYPES as readonly string[]).includes(mime ?? '');
}

/** 存進附件紀錄的 MIME：application/mp4 記成 video/mp4，瀏覽器才會用影片播放；mov、webm 與圖片保留原本的類型。 */
export function storedMime(mime: string | null | undefined): string {
    return mime === 'application/mp4' ? STORED_VIDEO_MIME : mime ?? 'application/octet-stream';
}

/** 單檔上限：影片 100 MB、圖片 10 MB。 */
export function maxBytesFor(mime: string | null | undefined): number {
    return isVideoMime(mime) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/**
 * mp4 的 ftyp 主品牌。HEIC（heic、mif1）、QuickTime（qt）、m4a 也有 ftyp，不在這裡就不收。
 */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'mp4v', 'dash', 'f4v ', 'MSNV', 'NDAS']);

/** Detects jpg/png/webp (and mp4 when `allowVideo`) from the first 12 bytes; the declared type is ignored. */
export function detectAttachmentType(head: Uint8Array, allowVideo: boolean): ImageMime | VideoMime | null {
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
        return 'image/jpeg';
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) {
        return 'image/png';
    }
    if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
        return 'image/webp';
    }
    if (allowVideo && isMp4(head)) {
        return STORED_VIDEO_MIME;
    }
    if (allowVideo && isQuickTime(head)) {
        return 'video/quicktime';
    }
    if (allowVideo && isWebm(head)) {
        return 'video/webm';
    }
    return null;
}

/** 檔頭要看的位元組數：webm 的 DocType 在檔頭 EBML 區塊裡，要多讀一些。 */
export const DETECT_HEAD_BYTES = 64;

/** Bytes 4–7 are "ftyp" and bytes 8–11 a known mp4 brand. */
export function isMp4(head: Uint8Array): boolean {
    if (head.length < 12 || String.fromCharCode(head[4], head[5], head[6], head[7]) !== 'ftyp') {
        return false;
    }
    return MP4_BRANDS.has(String.fromCharCode(head[8], head[9], head[10], head[11]));
}

/** iPhone 的 .mov：bytes 4–7 是 "ftyp"，主品牌是 "qt  "。 */
export function isQuickTime(head: Uint8Array): boolean {
    return head.length >= 12 && String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp' && String.fromCharCode(head[8], head[9], head[10], head[11]) === 'qt  ';
}

/** webm：檔頭是 EBML 標記（1A 45 DF A3），且檔頭內 DocType 寫著 "webm"（同為 EBML 的 mkv 不收）。 */
export function isWebm(head: Uint8Array): boolean {
    if (head.length < 12 || head[0] !== 0x1a || head[1] !== 0x45 || head[2] !== 0xdf || head[3] !== 0xa3) {
        return false;
    }
    return String.fromCharCode(...head.subarray(4, DETECT_HEAD_BYTES)).includes('webm');
}

/**
 * 前端送出前的檔案檢查（對話面板、詳情視窗、單頁留言區共用），回傳中文說明或 null。
 * 依瀏覽器給的 type 判斷；伺服器仍會看檔頭再確認一次。
 */
export function fileProblem(files: Array<{ name: string; type: string; size: number }>, options: { maxFiles: number; maxImageBytes: number; allowVideo: boolean }): string | null {
    if (files.length > options.maxFiles) {
        return options.allowVideo ? `一次最多附 ${options.maxFiles} 個檔案。` : `附圖最多 ${options.maxFiles} 張。`;
    }
    const allowed: readonly string[] = options.allowVideo ? [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES] : IMAGE_MIME_TYPES;
    if (files.some((file) => !allowed.includes(file.type))) {
        return options.allowVideo ? ATTACHMENT_TYPE_ERROR : '附圖只接受 JPG、PNG、WebP。';
    }
    const bigVideo = files.find((file) => isVideoMime(file.type) && file.size > MAX_VIDEO_BYTES);
    if (bigVideo) {
        return `「${bigVideo.name}」太大：${VIDEO_TOO_LARGE}`;
    }
    const bigImage = files.find((file) => !isVideoMime(file.type) && file.size > options.maxImageBytes);
    if (bigImage) {
        return `「${bigImage.name}」太大：${imageTooLarge(options.maxImageBytes)}`;
    }
    return null;
}
