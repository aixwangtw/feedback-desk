import { config, type Env } from '../env';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Server-side Turnstile check; a failed check or an unreachable siteverify both refuse the report. */
export async function verifyTurnstile(env: Env, token: string | null, ip: string): Promise<boolean> {
    if (!token) {
        return false;
    }
    const body = new URLSearchParams({ secret: config(env).publicReporting.turnstileSecretKey, response: token });
    if (ip) {
        body.set('remoteip', ip);
    }
    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            return false;
        }
        const result = (await response.json()) as { success?: unknown };
        return result.success === true;
    } catch {
        return false;
    }
}
