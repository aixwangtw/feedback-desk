/**
 * 清單、看板的附件縮圖共用的常數與型別：每張單最多顯示 3 張縮圖，其餘用「+N」。
 * 點縮圖或「+N」打開該單的詳情並捲到相簿（client/feedback.js、client/report-dialog-thread.js）。
 */
export const LIST_THUMB_LIMIT = 3;

/** 清單一格縮圖要的最少資料（頁面上的列與輪詢端點共用）。 */
export interface RowThumb {
    url: string;
    name: string;
    isVideo: boolean;
}

/** 詳情視窗、單頁、對話面板對話區的標題（原本叫「活動」），所有出現的地方都引用這裡。 */
export const THREAD_HEADING = '留言';
