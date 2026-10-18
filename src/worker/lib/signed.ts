import type { Env } from '../env';
import { hmac, timingSafeEqualString } from './crypto';

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
    developerId: number;
    expires: number;
}

function grantMessage(grant: UploadGrant): string {
    return `upload|${grant.projectSlug}|${grant.reportPublicId}|${grant.purpose}|${grant.developerId}|${grant.expires}`;
}

/** Pre-authorised PUT URL so an agent can upload an image with curl without holding the API token in its shell. */
export async function signedUploadUrl(env: Env, origin: string, grant: Omit<UploadGrant, 'expires'>, nowMs: number, ttlSeconds = 900): Promise<{ url: string; expires: number }> {
    const full: UploadGrant = { ...grant, expires: Math.floor(nowMs / 1000) + ttlSeconds };
    const signature = await hmac(env.APP_SECRET, grantMessage(full));
    const params = new URLSearchParams({
        p: full.projectSlug,
        r: full.reportPublicId,
        k: full.purpose,
        d: String(full.developerId),
        e: String(full.expires),
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
        developerId: Number(params.get('d')),
        expires: Number(params.get('e')),
    };
    if (!Number.isInteger(grant.developerId) || !Number.isInteger(grant.expires) || grant.expires < Math.floor(nowMs / 1000)) {
        return null;
    }
    const expected = await hmac(env.APP_SECRET, grantMessage(grant));
    return timingSafeEqualString(expected, params.get('s') ?? '') ? grant : null;
}
