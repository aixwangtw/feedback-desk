// Kept out of index.tsx: the Worker entry module may only export handlers.
import type { Env } from '../env';

/** Secrets shorter than this are refused; the deploy command generates 43 characters. */
export const MIN_SECRET_LENGTH = 32;

export function secretUsable(env: Env): boolean {
    return typeof env.APP_SECRET === 'string' && env.APP_SECRET.length >= MIN_SECRET_LENGTH;
}

/** Pages load only this site's own CSS and JS (Turnstile is the one outside script, when enabled). */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "object-src 'none'",
].join('; ');
