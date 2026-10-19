import type { Env } from '../env';
import { hmac, randomId, timingSafeEqualString } from './crypto';

export const SIGNED_URL_SECONDS = 3600;

/** Download link for one attachment that works without cookies, for the CLI and AI agents. */
export async function signedAttachmentUrl(env: Env, origin: string, attachmentId: number, nowMs: number, ttlSeconds = SIGNED_URL_SECONDS): Promise<string> {
    const expires = Math.floor(nowMs / 1000) + ttlSeconds;
    const signature = await hmac(env.APP_SECRET, `attachment|${attachmentId}|${expires}`);
    return `${origin}/files/${attachmentId}?e=${expires}&s=${signature}`;
}

export async function verifyAttachmentSignature(env: Env, attachmentId: number, expires: number, signature: string, nowMs: number): Promise<boolean> {
    if (!Number.isInteger(expires) || expires < Math.floor(nowMs / 1000) || signature === '') {
        return false;
    }
    return timingSafeEqualString(await hmac(env.APP_SECRET, `attachment|${attachmentId}|${expires}`), signature);
}

export interface UploadGrant {
    projectSlug: string;
    reportPublicId: string;
    purpose: 'adjustment' | 'message';
    /** Account the URL was issued to: d<team account id> or c<client account id>. */
    actor: string;
    expires: number;
    /** Random value; each URL can be used once (recorded in used_upload_nonces). */
    nonce: string;
}

function grantMessage(grant: UploadGrant): string {
    return `upload|${grant.projectSlug}|${grant.reportPublicId}|${grant.purpose}|${grant.actor}|${grant.expires}|${grant.nonce}`;
}

/** Pre-authorised PUT URL so an agent can upload an image with curl without holding the API token in its shell. */
export async function signedUploadUrl(env: Env, origin: string, grant: Omit<UploadGrant, 'expires' | 'nonce'>, nowMs: number, ttlSeconds = 900): Promise<{ url: string; expires: number }> {
    const full: UploadGrant = { ...grant, expires: Math.floor(nowMs / 1000) + ttlSeconds, nonce: randomId(12) };
    const signature = await hmac(env.APP_SECRET, grantMessage(full));
    const params = new URLSearchParams({
        p: full.projectSlug,
        r: full.reportPublicId,
        k: full.purpose,
        a: full.actor,
        e: String(full.expires),
        n: full.nonce,
        s: signature,
    });
    return { url: `${origin}/files/upload?${params.toString()}`, expires: full.expires };
}

export async function readUploadGrant(env: Env, params: URLSearchParams, nowMs: number): Promise<UploadGrant | null> {
    const purpose = params.get('k');
    if (purpose !== 'adjustment' && purpose !== 'message') {
        return null;
    }
    const grant: UploadGrant = {
        projectSlug: params.get('p') ?? '',
        reportPublicId: params.get('r') ?? '',
        purpose,
        actor: params.get('a') ?? '',
        expires: Number(params.get('e')),
        nonce: params.get('n') ?? '',
    };
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(grant.nonce)) {
        return null;
    }
    if (!/^[dc][1-9]\d{0,15}$/.test(grant.actor) || !Number.isInteger(grant.expires) || grant.expires < Math.floor(nowMs / 1000)) {
        return null;
    }
    const expected = await hmac(env.APP_SECRET, grantMessage(grant));
    return timingSafeEqualString(expected, params.get('s') ?? '') ? grant : null;
}

/** Marks the URL as used; false when it was used before. */
export async function consumeUploadNonce(env: Env, grant: UploadGrant): Promise<boolean> {
    const result = await env.DB.prepare('INSERT INTO used_upload_nonces (nonce, expires_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING')
        .bind(grant.nonce, grant.expires)
        .run();
    return (result.meta.changes ?? 0) === 1;
}
