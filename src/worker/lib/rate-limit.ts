/**
 * Fixed-window counters stored in D1. Workers Rate Limiting bindings only offer 10 or 60 second
 * periods, and the hourly limits need longer windows, so every limit uses this table.
 */
export interface Limit {
    key: string;
    max: number;
    /** Window length in seconds. */
    period: number;
}

function windowKey(limit: Limit, nowSeconds: number): { key: string; resetAt: number } {
    const window = Math.floor(nowSeconds / limit.period);
    return { key: `${limit.key}@${limit.period}:${window}`, resetAt: (window + 1) * limit.period };
}

/** Seconds until the first exceeded limit resets, or null when every limit still has room. */
export async function tooManyAttempts(db: D1Database, limits: Limit[], nowMs = Date.now()): Promise<number | null> {
    if (limits.length === 0) {
        return null;
    }
    const nowSeconds = Math.floor(nowMs / 1000);
    const windows = limits.map((limit) => windowKey(limit, nowSeconds));
    const rows = await db.batch(windows.map((window) => db.prepare('SELECT count FROM rate_limits WHERE key = ?').bind(window.key)));
    for (let i = 0; i < limits.length; i++) {
        const count = (rows[i].results[0] as { count: number } | undefined)?.count ?? 0;
        if (count >= limits[i].max) {
            return Math.max(1, windows[i].resetAt - nowSeconds);
        }
    }
    return null;
}

export async function hit(db: D1Database, limits: Limit[], nowMs = Date.now()): Promise<void> {
    if (limits.length === 0) {
        return;
    }
    const nowSeconds = Math.floor(nowMs / 1000);
    await db.batch(
        limits.map((limit) => {
            const window = windowKey(limit, nowSeconds);
            return db
                .prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1')
                .bind(window.key, window.resetAt);
        }),
    );
}

/**
 * Laravel's throttle middleware: count this request, and refuse it when a limit was already
 * reached. Returns seconds to wait when refused.
 */
export async function attempt(db: D1Database, limits: Limit[], nowMs = Date.now()): Promise<number | null> {
    const retryAfter = await tooManyAttempts(db, limits, nowMs);
    if (retryAfter !== null) {
        return retryAfter;
    }
    await hit(db, limits, nowMs);
    return null;
}

export async function clear(db: D1Database, limit: Limit, nowMs = Date.now()): Promise<void> {
    const window = windowKey(limit, Math.floor(nowMs / 1000));
    await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(window.key).run();
}

export async function pruneExpired(db: D1Database, nowMs = Date.now()): Promise<void> {
    await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(Math.floor(nowMs / 1000)).run();
}

export function clientIp(request: Request): string {
    return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? '0.0.0.0';
}
