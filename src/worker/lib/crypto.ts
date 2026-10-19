const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PASSWORD_ITERATIONS = 10_000;

export { SELF_SET_PASSWORD_ITERATIONS } from '../../shared/password';

export function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array | null {
    try {
        const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
}

function base64Encode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function toHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

export async function sha256Hex(value: string): Promise<string> {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random string from [A-Za-z0-9] without modulo bias (Laravel Str::random equivalent). */
export function randomString(length: number, alphabet: string = TOKEN_ALPHABET): string {
    const limit = 256 - (256 % alphabet.length);
    let result = '';
    while (result.length < length) {
        const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
        for (let i = 0; i < bytes.length && result.length < length; i++) {
            if (bytes[i] < limit) {
                result += alphabet[bytes[i] % alphabet.length];
            }
        }
    }
    return result;
}

export function randomId(bytes = 16): string {
    return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time comparison of two strings of possibly different length. */
export function timingSafeEqualString(a: string, b: string): boolean {
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    let diff = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
        key,
        256,
    );
    return new Uint8Array(bits);
}

/**
 * Format: pbkdf2_sha256$<iterations>$<salt base64>$<hash base64>.
 * Generated passwords have 24 random characters, so 10,000 iterations are enough for them;
 * passwords people choose use SELF_SET_PASSWORD_ITERATIONS and the length rules in shared/password.
 */
export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, iterations);
    return `pbkdf2_sha256$${iterations}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

/** A well-formed hash that matches no password; checked for unknown users so timing does not reveal them. */
export const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$10000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
        return false;
    }
    const iterations = Number(parts[1]);
    // Refuse absurd counts: workerd refuses PBKDF2 above 100,000 iterations by default
    // (DEFAULT_MAX_PBKDF2_ITERATIONS in workerd's limit-enforcer.h), and the CPU budget is 10 ms.
    if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100_000) {
        return false;
    }
    try {
        const derived = await pbkdf2(password, base64Decode(parts[2]), iterations);
        return timingSafeEqualString(base64Encode(derived), parts[3]);
    } catch {
        return false;
    }
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

/** Keys are never derived from a missing or short secret, even if a caller forgets the request check. */
function assertSecret(secret: unknown): asserts secret is string {
    if (typeof secret !== 'string' || secret.length < 32) {
        throw new Error('APP_SECRET is missing or shorter than 32 characters.');
    }
}

function hmacKey(secret: string): Promise<CryptoKey> {
    assertSecret(secret);
    let key = hmacKeys.get(secret);
    if (!key) {
        key = crypto.subtle.importKey('raw', encoder.encode(`hmac|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        hmacKeys.set(secret, key);
    }
    return key;
}

export async function hmac(secret: string, message: string): Promise<string> {
    const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
    return base64UrlEncode(new Uint8Array(signature));
}

const aesKeys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string): Promise<CryptoKey> {
    assertSecret(secret);
    let key = aesKeys.get(secret);
    if (!key) {
        key = crypto.subtle
            .digest('SHA-256', encoder.encode(`aes|${secret}`))
            .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
        aesKeys.set(secret, key);
    }
    return key;
}

/** AES-GCM encrypt; the cookie name is bound as additional data so values cannot be swapped between cookies. */
export async function seal(secret: string, purpose: string, value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) },
        await aesKey(secret),
        encoder.encode(JSON.stringify(value)),
    );
    const bytes = new Uint8Array(12 + cipher.byteLength);
    bytes.set(iv, 0);
    bytes.set(new Uint8Array(cipher), 12);
    return base64UrlEncode(bytes);
}

export async function unseal<T>(secret: string, purpose: string, sealed: string | undefined): Promise<T | null> {
    if (!sealed) {
        return null;
    }
    const bytes = base64UrlDecode(sealed);
    if (!bytes || bytes.length < 13) {
        return null;
    }
    try {
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(purpose) },
            await aesKey(secret),
            bytes.slice(12),
        );
        return JSON.parse(decoder.decode(plain)) as T;
    } catch {
        return null;
    }
}
