/**
 * Date formatting by plain arithmetic. Intl and toLocaleString are avoided on purpose: on the
 * Workers free plan every request has 10 ms of CPU, and Intl formatters cost several ms to build.
 */

const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** Parses "+08:00", "-05:30", "+8" or "480" (minutes) into an offset in minutes. Invalid input gives 480. */
export function parseUtcOffset(input: string | undefined): number {
    const value = (input ?? '').trim();
    if (value === '') {
        return 480;
    }
    if (/^[+-]?\d+$/.test(value) && Math.abs(Number(value)) > 14) {
        return clampOffset(Number(value));
    }
    const match = /^([+-])?(\d{1,2})(?::?(\d{2}))?$/.exec(value);
    if (!match) {
        return 480;
    }
    const sign = match[1] === '-' ? -1 : 1;
    return clampOffset(sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)));
}

function clampOffset(minutes: number): number {
    return Math.max(-14 * 60, Math.min(14 * 60, minutes));
}

/** "2026/10/14 10:30" in the configured offset. */
export function formatAbsolute(iso: string, offsetMinutes: number): string {
    const date = new Date(Date.parse(iso) + offsetMinutes * 60_000);
    return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** "2026-10-14 10:30" in the configured offset, used by the CLI. */
export function formatDashed(iso: string, offsetMinutes: number): string {
    return formatAbsolute(iso, offsetMinutes).replaceAll('/', '-');
}

/**
 * Relative time in Traditional Chinese, matching Carbon's zh_TW diffForHumans output
 * ("3小時前", "1個月前"). Future times show "剛剛" so clock skew never says "from now".
 */
export function formatRelative(iso: string, nowMs: number): string {
    const thenMs = Date.parse(iso);
    if (thenMs > nowMs) {
        return '剛剛';
    }
    const seconds = Math.floor((nowMs - thenMs) / 1000);
    if (seconds < 60) {
        return `${seconds}秒前`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}分鐘前`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}小時前`;
    }
    const days = Math.floor(hours / 24);
    const months = calendarMonthsBetween(thenMs, nowMs);
    if (months >= 12) {
        return `${Math.floor(months / 12)}年前`;
    }
    if (months >= 1) {
        return `${months}個月前`;
    }
    if (days >= 7) {
        return `${Math.floor(days / 7)}週前`;
    }
    return `${days}天前`;
}

function calendarMonthsBetween(fromMs: number, toMs: number): number {
    const from = new Date(fromMs);
    const to = new Date(toMs);
    let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    const fromRest = from.getUTCDate() * 86_400_000 + (fromMs % 86_400_000);
    const toRest = to.getUTCDate() * 86_400_000 + (toMs % 86_400_000);
    if (toRest < fromRest) {
        months -= 1;
    }
    return Math.max(0, months);
}

export function nowIso(nowMs: number = Date.now()): string {
    return new Date(nowMs).toISOString();
}
