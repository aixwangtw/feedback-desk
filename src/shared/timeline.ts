/**
 * 留言時間軸（單頁、詳情視窗、右下角面板共用）：只有留言本身，依時間排；不顯示「某某將狀態改為…」這類狀態變更紀錄，
 * 單目前的狀態看右側欄。狀態變更紀錄仍存在 report_events（巡檢、最近動態用），只是畫面上不列。
 */

export interface TimelineMessage {
    id: number;
    created_at: string;
}

export type TimelineEntry<M extends TimelineMessage> = { type: 'message'; at: string; message: M };

/** 整秒時間戳（儲存的時間帶毫秒，與 Laravel 版一樣只比到秒）。 */
function seconds(iso: string): number {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
}

export function buildTimeline<M extends TimelineMessage>(messages: M[]): Array<TimelineEntry<M>> {
    return messages
        .map((message) => ({ key: [seconds(message.created_at), message.id] as const, entry: { type: 'message' as const, at: message.created_at, message } }))
        .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
        .map((item) => item.entry);
}

/** 最新一則「請客戶確認完成」留言的 id（只有它顯示「通過」按鈕）；沒有就 null。 */
export function latestCompletionRequestId(messages: Array<{ id: number; is_completion_request?: number }>): number | null {
    let latest: number | null = null;
    for (const message of messages) {
        if (message.is_completion_request === 1 && (latest === null || message.id > latest)) {
            latest = message.id;
        }
    }
    return latest;
}
