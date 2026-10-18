import { seal, unseal } from './crypto';

export interface CookieWrite {
    name: string;
    value: string;
    maxAge: number;
}

export function parseCookieHeader(header: string | null): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!header) {
        return cookies;
    }
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) {
            continue;
        }
        const name = part.slice(0, index).trim();
        if (!(name in cookies)) {
            cookies[name] = part.slice(index + 1).trim();
        }
    }
    return cookies;
}

export function serializeCookie(write: CookieWrite, secure: boolean): string {
    const parts = [`${write.name}=${write.value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${write.maxAge}`];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/**
 * Encrypted cookie jar: values are JSON, sealed with AES-GCM under APP_SECRET, so the browser can
 * neither read nor alter them. Writes are collected and emitted as Set-Cookie headers at the end.
 */
export class CookieJar {
    private readonly raw: Record<string, string>;
    private readonly writes = new Map<string, CookieWrite | Promise<CookieWrite>>();
    private readonly decoded = new Map<string, Promise<unknown>>();

    constructor(
        private readonly secret: string,
        cookieHeader: string | null,
    ) {
        this.raw = parseCookieHeader(cookieHeader);
    }

    read<T>(name: string): Promise<T | null> {
        let value = this.decoded.get(name);
        if (!value) {
            value = unseal<T>(this.secret, name, this.raw[name]);
            this.decoded.set(name, value);
        }
        return value as Promise<T | null>;
    }

    has(name: string): boolean {
        return name in this.raw;
    }

    write(name: string, value: unknown, maxAgeSeconds: number): void {
        this.decoded.set(name, Promise.resolve(value));
        this.writes.set(
            name,
            seal(this.secret, name, value).then((sealed) => ({ name, value: sealed, maxAge: maxAgeSeconds })),
        );
    }

    forget(name: string): void {
        this.decoded.set(name, Promise.resolve(null));
        if (this.raw[name] !== undefined || this.writes.has(name)) {
            this.writes.set(name, { name, value: '', maxAge: 0 });
        }
    }

    async setCookieHeaders(secure: boolean): Promise<string[]> {
        const headers: string[] = [];
        for (const write of this.writes.values()) {
            headers.push(serializeCookie(await write, secure));
        }
        return headers;
    }
}
