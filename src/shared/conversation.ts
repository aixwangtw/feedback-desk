/**
 * Rules shared by the bottom-right chat panel (in the browser) and the server: conversation order,
 * unread badges and the short texts shown in the panel list. The portal list and the board use the
 * same order (built in SQL by conversationOrderSql in lib/reports.ts).
 *
 * Plain arithmetic only: no Intl or toLocaleString (see time.ts).
 */

export interface ConversationSortable {
    id: string;
    number: number;
    unread: number;
    messages_count: number;
    latest_at: string | null;
    created_at: string;
}

/** 2 = has unread, 1 = has messages (all read), 0 = no messages. */
export function conversationTier(item: Pick<ConversationSortable, 'unread' | 'messages_count'>): number {
    if (item.unread > 0) {
        return 2;
    }
    return item.messages_count > 0 ? 1 : 0;
}

/** Whole seconds, like the Laravel version (stored times carry milliseconds). */
function secondsOf(iso: string | null | undefined): number {
    const time = Date.parse(iso ?? '');
    return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
}

function sortTime(item: ConversationSortable, tier: number): number {
    return secondsOf(tier > 0 && item.latest_at ? item.latest_at : item.created_at);
}

/**
 * Unread first, then threads with messages, both by the newest message (newest first); reports
 * without messages last, by creation time (newest first). Ties: the newer number (1 is newest) first.
 */
export function compareConversations(a: ConversationSortable, b: ConversationSortable): number {
    const tierA = conversationTier(a);
    const tierB = conversationTier(b);
    if (tierA !== tierB) {
        return tierB - tierA;
    }
    const timeDiff = sortTime(b, tierB) - sortTime(a, tierA);
    if (timeDiff !== 0) {
        return timeDiff;
    }
    return (a.number ?? 0) - (b.number ?? 0);
}

/**
 * Sorts by the rules; the conversation being read (keepId) stays at its place in previousIds, so it
 * does not jump away the moment it turns read. It moves when the viewer leaves it or reopens the panel.
 */
export function orderConversations<T extends ConversationSortable>(items: T[], options: { keepId?: string | null; previousIds?: string[] } = {}): T[] {
    const sorted = [...items].sort(compareConversations);
    const keepId = options.keepId ?? null;
    if (keepId === null) {
        return sorted;
    }
    const previousIndex = (options.previousIds ?? []).indexOf(keepId);
    const currentIndex = sorted.findIndex((item) => item.id === keepId);
    if (previousIndex < 0 || currentIndex < 0) {
        return sorted;
    }
    const [kept] = sorted.splice(currentIndex, 1);
    sorted.splice(Math.min(previousIndex, sorted.length), 0, kept);
    return sorted;
}

/** Text of the red round badge; above 99 shows 99+. */
export function badgeText(count: number): string {
    return count > 99 ? '99+' : String(count);
}

/** How many reports have unread messages (the N in the team-side summary above the list). */
export function countUnreadReports(items: Array<{ unread: number }>): number {
    return items.filter((item) => item.unread > 0).length;
}

/**
 * Unread count per report public_id. The conversation being read (openId) always counts 0: every
 * refresh of an open conversation marks it read, and the list data may have been fetched just before.
 */
export function unreadById(items: Array<{ id: string; unread: number }>, openId: string | null = null): Map<string, number> {
    return new Map(items.map((item) => [item.id, item.id === openId ? 0 : item.unread]));
}

/**
 * The summary above the team-side list, same as the server: N > 0 shows "有 N 張單有未讀留言" in red
 * with "只看未讀留言"; N = 0 shows "目前沒有未讀留言" without a filter; on the unread-only page the
 * only link is "顯示全部".
 */
export function unreadSummary(count: number, options: { unreadOnly?: boolean } = {}): { count: number; tone: 'alert' | 'calm'; filter: 'unread-only' | 'show-all' | null } {
    let filter: 'unread-only' | 'show-all' | null = null;
    if (options.unreadOnly) {
        filter = 'show-all';
    } else if (count > 0) {
        filter = 'unread-only';
    }
    return { count, tone: count > 0 ? 'alert' : 'calm', filter };
}

/** aria-label of a chat button with the unread part replaced by the new count. */
export function withUnreadInLabel(label: string, count: number): string {
    const base = label.replace(/，\d+ 則未讀(?=）$)/, '');
    if (count <= 0) {
        return base;
    }
    return base.endsWith('）') ? `${base.slice(0, -1)}，${count} 則未讀）` : `${base}，${count} 則未讀`;
}

/** title of a chat button with the unread part replaced by the new count. */
export function withUnreadInTitle(title: string, count: number): string {
    const base = title.replace(/，未讀 \d+$/, '');
    return count > 0 ? `${base}，未讀 ${count}` : base;
}

/** aria-label and title of a chat button, as the server renders them. */
export function chatButtonLabels(title: string, total: number, unread: number): { ariaLabel: string; title: string } {
    return {
        ariaLabel: `開啟「${title}」的留言對話（${total > 0 ? `共 ${total} 則留言` : '還沒有留言'}${unread > 0 ? `，${unread} 則未讀` : ''}）`,
        title: `${total > 0 ? `留言 ${total} 則` : '開啟對話'}${unread > 0 ? `，未讀 ${unread}` : ''}`,
    };
}

/** Display width of one code point, following PHP mb_strwidth: East Asian wide and full-width count 2. */
function charWidth(code: number): number {
    if (
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xa000 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1f64f) ||
        (code >= 0x1f900 && code <= 0x1f9ff) ||
        (code >= 0x20000 && code <= 0x2fffd) ||
        (code >= 0x30000 && code <= 0x3fffd)
    ) {
        return 2;
    }
    return 1;
}

export const PREVIEW_WIDTH = 60;

/**
 * Preview of the newest message in the panel list: whitespace squeezed to single spaces, cut to
 * PREVIEW_WIDTH display columns with "..." (Laravel Str::limit(Str::squish($body), 60)).
 */
export function messagePreview(body: string, width = PREVIEW_WIDTH): string {
    const squished = body.trim().replace(/[\sㅤᅠ]+/gu, ' ');
    let total = 0;
    for (const char of squished) {
        total += charWidth(char.codePointAt(0) ?? 0);
        if (total > width) {
            break;
        }
    }
    if (total <= width) {
        return squished;
    }
    let result = '';
    let used = 0;
    for (const char of squished) {
        const next = charWidth(char.codePointAt(0) ?? 0);
        if (used + next > width) {
            break;
        }
        result += char;
        used += next;
    }
    return `${result.replace(/\s+$/u, '')}...`;
}

/**
 * Time on the right of a panel list item, in the configured offset: "14:05" today, "10/9" this
 * year, "2025/10/9" before that.
 */
export function shortTime(iso: string, nowMs: number, offsetMinutes: number): string {
    const local = new Date(Date.parse(iso) + offsetMinutes * 60_000);
    const today = new Date(nowMs + offsetMinutes * 60_000);
    const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
    const sameYear = local.getUTCFullYear() === today.getUTCFullYear();
    if (sameYear && local.getUTCMonth() === today.getUTCMonth() && local.getUTCDate() === today.getUTCDate()) {
        return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    }
    const monthDay = `${local.getUTCMonth() + 1}/${local.getUTCDate()}`;
    return sameYear ? monthDay : `${local.getUTCFullYear()}/${monthDay}`;
}
