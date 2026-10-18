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

/** Seconds until the first exceeded limit resets, or null when every limit still has room. Read only. */
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

/**
 * Counts one attempt against every limit in a single atomic statement per limit. A counter that is
 * already at its maximum is left untouched (the conditional upsert returns no row), so a flood of
 * refused requests does not keep writing to D1. Returns seconds to wait when refused.
 */
export async function attempt(db: D1Database, limits: Limit[], nowMs = Date.now()): Promise<number | null> {
    if (limits.length === 0) {
        return null;
    }
    const nowSeconds = Math.floor(nowMs / 1000);
    const windows = limits.map((limit) => windowKey(limit, nowSeconds));
    const results = await db.batch(
        limits.map((limit, i) =>
            db
                .prepare(
                    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
                     ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE rate_limits.count < ?
                     RETURNING count`,
                )
                .bind(windows[i].key, windows[i].resetAt, limit.max),
        ),
    );
    for (let i = 0; i < limits.length; i++) {
        if (results[i].results.length === 0) {
            return Math.max(1, windows[i].resetAt - nowSeconds);
        }
    }
    return null;
}

/** Records a failure (login): same atomic statement; the result is not needed. */
export async function hit(db: D1Database, limits: Limit[], nowMs = Date.now()): Promise<void> {
    await attempt(db, limits, nowMs);
}

export async function clear(db: D1Database, limit: Limit, nowMs = Date.now()): Promise<void> {
    const window = windowKey(limit, Math.floor(nowMs / 1000));
    await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(window.key).run();
}

export async function pruneExpired(db: D1Database, nowMs = Date.now()): Promise<void> {
    await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(Math.floor(nowMs / 1000)).run();
}

/** Expands an IPv6 address and keeps its /64 network, so one host cannot rotate through its range. */
export function ipv6Prefix64(ip: string): string | null {
    const address = ip.split('%')[0].toLowerCase();
    if (!address.includes(':')) {
        return null;
    }
    let head = address;
    let tail = '';
    if (address.includes('::')) {
        [head, tail] = address.split('::');
    }
    const headParts = head === '' ? [] : head.split(':');
    const tailParts = tail === '' ? [] : tail.split(':');
    // An embedded IPv4 tail counts as two groups.
    const groups = (parts: string[]) => parts.reduce((sum, part) => sum + (part.includes('.') ? 2 : 1), 0);
    const missing = 8 - groups(headParts) - groups(tailParts);
    const all = [...headParts, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...tailParts];
    if (all.length < 4 || all.slice(0, 4).some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
        return null;
    }
    return `${all.slice(0, 4).map((part) => part.padStart(4, '0')).join(':')}::/64`;
}

/** Visitor key for rate limits: the IPv4 address, or the /64 network of an IPv6 address. */
export function clientIp(request: Request): string {
    const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? '0.0.0.0';
    return ipv6Prefix64(ip) ?? ip;
}
