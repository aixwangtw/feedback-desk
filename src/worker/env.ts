import { parseUtcOffset } from '../shared/time';

export interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS?: Fetcher;
    /** Random secret used for cookie encryption and signed links. Set with `wrangler secret`. */
    APP_SECRET: string;
    [key: string]: unknown;
}

export interface FeedbackConfig {
    labels: { client: string; owner: string };
    portalTitle: string;
    home: { title: string; eyebrow: string; heading: string; body: string };
    loginPrefill: { enabled: boolean; ownerEnabled: boolean; ownerUsername: string; ownerPassword: string };
    publicReporting: {
        homeProject: string;
        intro: string;
        githubUrl: string | null;
        blogUrl: string | null;
        notice: string;
        perMinute: number;
        perHour: number;
        messagePerMinute: number;
        messagePerHour: number;
        uploadPerMinute: number;
        uploadPerHour: number;
        maxAttachmentsPerReport: number;
        /** Site-wide cap on public uploads waiting to be attached (count and bytes). */
        pendingUploadsMax: number;
        pendingUploadBytesMax: number;
        turnstileSiteKey: string;
        turnstileSecretKey: string;
    };
    /** 免登入客戶入口：project 指定的專案不用登入，訪客以 account（username）這個客戶帳號身分使用。 */
    guestClient: { project: string; account: string };
    /** 開單分類選項；空陣列表示不分類。 */
    utcOffsetMinutes: number;
    timezoneName: string;
}

const cache = new WeakMap<object, FeedbackConfig>();

function str(env: Env, key: string, fallback = ''): string {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return fallback;
}

function int(env: Env, key: string, fallback: number): number {
    const parsed = Number.parseInt(str(env, key), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: Env, key: string): boolean {
    return ['1', 'true', 'on', 'yes'].includes(str(env, key).toLowerCase());
}

/** Only https:// links are rendered; anything else counts as unset. */
function httpsOnly(value: string): string | null {
    return value.toLowerCase().startsWith('https://') ? value : null;
}

export function config(env: Env): FeedbackConfig {
    const cached = cache.get(env);
    if (cached) {
        return cached;
    }
    const clientLabel = str(env, 'FEEDBACK_LABEL_CLIENT', '客戶');
    const ownerLabel = str(env, 'FEEDBACK_LABEL_OWNER', '開發團隊');
    const value: FeedbackConfig = {
        labels: { client: clientLabel, owner: ownerLabel },
        portalTitle: str(env, 'FEEDBACK_PORTAL_TITLE', '問題回報追蹤'),
        home: {
            title: str(env, 'FEEDBACK_HOME_TITLE', '問題回報'),
            eyebrow: str(env, 'FEEDBACK_HOME_EYEBROW', 'Feedback Desk'),
            heading: str(env, 'FEEDBACK_HOME_HEADING', '問題回報'),
            body: str(env, 'FEEDBACK_HOME_BODY', `請開啟${ownerLabel}給你的專案連結，登入後就能回報問題、查看處理進度。`),
        },
        loginPrefill: {
            enabled: bool(env, 'FEEDBACK_LOGIN_PREFILL_ENABLED'),
            // Owner prefill also needs this; unset follows the global flag so only developers can be switched off.
            ownerEnabled: str(env, 'FEEDBACK_OWNER_LOGIN_PREFILL_ENABLED') === '' ? bool(env, 'FEEDBACK_LOGIN_PREFILL_ENABLED') : bool(env, 'FEEDBACK_OWNER_LOGIN_PREFILL_ENABLED'),
            ownerUsername: str(env, 'FEEDBACK_OWNER_LOGIN_PREFILL_USERNAME'),
            ownerPassword: str(env, 'FEEDBACK_OWNER_LOGIN_PREFILL_PASSWORD'),
        },
        publicReporting: {
            homeProject: str(env, 'FEEDBACK_HOME_PUBLIC_PROJECT'),
            intro: str(env, 'FEEDBACK_PUBLIC_INTRO'),
            githubUrl: httpsOnly(str(env, 'FEEDBACK_PUBLIC_GITHUB_URL')),
            blogUrl: httpsOnly(str(env, 'FEEDBACK_PUBLIC_BLOG_URL')),
            notice: str(env, 'FEEDBACK_PUBLIC_NOTICE'),
            perMinute: Math.max(1, int(env, 'FEEDBACK_PUBLIC_THROTTLE_PER_MINUTE', 3)),
            perHour: Math.max(1, int(env, 'FEEDBACK_PUBLIC_THROTTLE_PER_HOUR', 20)),
            messagePerMinute: Math.max(1, int(env, 'FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_MINUTE', 5)),
            messagePerHour: Math.max(1, int(env, 'FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_HOUR', 30)),
            uploadPerMinute: Math.max(1, int(env, 'FEEDBACK_PUBLIC_UPLOAD_THROTTLE_PER_MINUTE', 10)),
            uploadPerHour: Math.max(1, int(env, 'FEEDBACK_PUBLIC_UPLOAD_THROTTLE_PER_HOUR', 60)),
            maxAttachmentsPerReport: int(env, 'FEEDBACK_PUBLIC_MAX_ATTACHMENTS', 15),
            pendingUploadsMax: Math.max(1, int(env, 'FEEDBACK_PUBLIC_PENDING_UPLOADS_MAX', 300)),
            pendingUploadBytesMax: Math.max(1, int(env, 'FEEDBACK_PUBLIC_PENDING_UPLOAD_MB_MAX', 500)) * 1024 * 1024,
            turnstileSiteKey: str(env, 'FEEDBACK_TURNSTILE_SITE_KEY'),
            turnstileSecretKey: str(env, 'FEEDBACK_TURNSTILE_SECRET_KEY'),
        },
        guestClient: { project: str(env, 'FEEDBACK_GUEST_CLIENT_PROJECT'), account: str(env, 'FEEDBACK_GUEST_CLIENT_ACCOUNT') },
        utcOffsetMinutes: parseUtcOffset(str(env, 'FEEDBACK_UTC_OFFSET', '+08:00')),
        timezoneName: str(env, 'FEEDBACK_TIMEZONE_NAME', '台北時間'),
    };
    cache.set(env, value);
    return value;
}

/** Turnstile is on only when both keys are set; a half configuration stays off (and is logged once per isolate). */
let warnedHalfTurnstile = false;
export function turnstileEnabled(env: Env): boolean {
    const { turnstileSiteKey, turnstileSecretKey } = config(env).publicReporting;
    const hasSite = turnstileSiteKey !== '';
    const hasSecret = turnstileSecretKey !== '';
    if (hasSite !== hasSecret && !warnedHalfTurnstile) {
        warnedHalfTurnstile = true;
        console.warn('FEEDBACK_TURNSTILE_SITE_KEY 與 FEEDBACK_TURNSTILE_SECRET_KEY 只設了一個，Turnstile 沒有啟用。');
    }
    return hasSite && hasSecret;
}
