/**
 * 清單、看板的附件縮圖共用的常數與型別：每張單最多顯示 3 張縮圖，其餘用「+N」。
 * 點縮圖或「+N」直接開附件燈箱（client/attachment-lightbox.js，只看這張單的附件），不開詳情。
 */
export const LIST_THUMB_LIMIT = 3;

/** 清單一格縮圖要的最少資料（頁面上的列與輪詢端點共用）。 */
export interface RowThumb {
    url: string;
    name: string;
    isVideo: boolean;
    /** 來自哪裡：「原始附件」「王老師 的留言」，燈箱下方顯示。 */
    source: string;
    /** 已格式化好的時間（站台時區）。 */
    at: string;
}

/**
 * 燈箱用的附件清單（只含這張單的全部附件，最新在前），放在縮圖格的 data-lightbox-gallery。
 * JSX 版（components.tsx）與字串版（rows.ts）共用這一個函式，client/attachment-lightbox.js 讀它。
 */
export function lightboxGalleryJson(thumbs: RowThumb[]): string {
    return JSON.stringify(thumbs.map((thumb) => ({ url: thumb.url, name: thumb.name, video: thumb.isVideo, source: thumb.source, at: thumb.at })));
}

/** 詳情視窗、單頁、對話面板對話區的標題（原本叫「活動」），所有出現的地方都引用這裡。 */
export const THREAD_HEADING = '留言';
