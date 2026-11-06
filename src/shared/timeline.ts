/**
 * 活動時間軸：留言與狀態變更依時間排在一起（單頁、詳情視窗、右下角面板共用）。
 * 狀態變更取自 report_events 的 status 紀錄（detail 是「new>needs_input」）；沒有「>」後半的紀錄不列。
 * 同一秒內留言排在狀態變更前面（留言造成的狀態變更緊跟在那則留言後面）。
 */

export interface TimelineMessage {
    id: number;
    created_at: string;
}

export interface TimelineStatusEvent {
    id: number;
    detail: string | null;
    actor_name: string;
    agent: string | null;
    /** 團隊帳號改的（顯示時不附 AI 工具名稱，與留言作者一致）。 */
    developer_id?: number | null;
    created_at: string;
}

export type TimelineEntry<M extends TimelineMessage> =
    | { type: 'message'; at: string; message: M }
    | { type: 'status'; at: string; from: string; to: string; actor: string; agent: string | null; developerSide: boolean; id: number };

/** 整秒時間戳（儲存的時間帶毫秒，與 Laravel 版一樣只比到秒）。 */
function seconds(iso: string): number {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
}

export function buildTimeline<M extends TimelineMessage>(messages: M[], events: TimelineStatusEvent[]): Array<TimelineEntry<M>> {
    const keyed: Array<{ key: [number, number, number]; entry: TimelineEntry<M> }> = messages.map((message) => ({
        key: [seconds(message.created_at), 0, message.id],
        entry: { type: 'message', at: message.created_at, message },
    }));
    for (const event of events) {
        const [from, to] = (event.detail ?? '').split('>');
        if (!to) {
            continue;
        }
        keyed.push({
            key: [seconds(event.created_at), 1, event.id],
            entry: { type: 'status', at: event.created_at, from: from ?? '', to, actor: event.actor_name, agent: event.agent, developerSide: (event.developer_id ?? null) !== null, id: event.id },
        });
    }
    return keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]).map((item) => item.entry);
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
