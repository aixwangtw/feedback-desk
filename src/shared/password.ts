/** Rules for passwords people choose themselves; generated passwords never go through these. */
export const MIN_SELF_SET_PASSWORD_LENGTH = 16;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * PBKDF2-SHA256 iterations for passwords people type themselves (generated ones use 10,000 too).
 * Measured with wrangler dev (workerd) on an Intel i3-8100: about 0.43 ms per 1,000 iterations,
 * so 10,000 is about 4.4 ms and 20,000 about 8.7 ms, which leaves no room under the free plan's
 * 10 ms CPU per request. Raise it only after measuring on the real plan. Each stored hash carries
 * its own count, so changing this does not break existing logins.
 */
export const SELF_SET_PASSWORD_ITERATIONS = 10_000;

function codePoints(value: string): number[] {
    const points: number[] = [];
    for (const char of value) {
        points.push(char.codePointAt(0) as number);
    }
    return points;
}

/** The whole password is one short chunk repeated, e.g. "abcabcabc…" or "12121212…". */
function isShortRepeat(points: number[]): boolean {
    for (let size = 1; size <= 4; size++) {
        let repeats = true;
        for (let i = size; i < points.length; i++) {
            if (points[i] !== points[i % size]) {
                repeats = false;
                break;
            }
        }
        if (repeats) {
            return true;
        }
    }
    return false;
}

/** Every character is one step up (or down) from the previous one, e.g. "abcdefghijklmnop". */
function isSequence(points: number[]): boolean {
    const step = points[1] - points[0];
    if (step !== 1 && step !== -1) {
        return false;
    }
    for (let i = 2; i < points.length; i++) {
        if (points[i] - points[i - 1] !== step) {
            return false;
        }
    }
    return true;
}

/**
 * Problems with a password the account holder typed, in Traditional Chinese; empty when it is
 * acceptable. Only clearly weak choices are refused; the page recommends a password manager.
 */
export function selfSetPasswordProblems(password: string, username: string): string[] {
    const points = codePoints(password);
    if (points.length < MIN_SELF_SET_PASSWORD_LENGTH) {
        return [`密碼至少要 ${MIN_SELF_SET_PASSWORD_LENGTH} 個字。`];
    }
    if (points.length > MAX_PASSWORD_LENGTH) {
        return [`密碼不能超過 ${MAX_PASSWORD_LENGTH} 個字。`];
    }
    if (password.trim() !== password) {
        return ['密碼開頭或結尾不能是空白。'];
    }
    const problems: string[] = [];
    if (isShortRepeat(points)) {
        problems.push('密碼不能是同一個字或同一小段重複。');
    } else if (isSequence(points)) {
        problems.push('密碼不能是連續的字元（例如 abcdefgh…、12345678…）。');
    }
    const lowered = password.toLowerCase();
    const account = username.trim().toLowerCase();
    if (account !== '' && (lowered === account || (codePoints(account).length >= 3 && lowered.includes(account)))) {
        problems.push('密碼不能包含帳號。');
    }
    return problems;
}
