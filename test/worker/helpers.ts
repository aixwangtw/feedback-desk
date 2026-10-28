import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { app } from '../../src/worker/index';
import { hashPassword, randomString, sha256Hex } from '../../src/worker/lib/crypto';
import type { ClientAccount, Developer, Project, Report } from '../../src/worker/lib/models';
import { createReport } from '../../src/worker/lib/reports';
import { createToken } from '../../src/worker/lib/team';
import type { Env } from '../../src/worker/env';

export const BASE = 'https://feedback.test';

export const workerEnv = env as unknown as Env;

/** Smallest valid images for upload tests. */
export const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
    0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
export const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00, 0x00, 0x00]);

let counter = 0;
export function unique(prefix = 'p'): string {
    counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface SeededProject {
    project: Project;
    ownerToken: string;
    clientToken: string | null;
    clientAccount: ClientAccount | null;
}

export async function seedProject(options: {
    slug?: string;
    name?: string;
    client?: boolean;
    clientName?: string | null;
    clientUsername?: string;
    clientPassword?: string;
    prefill?: boolean;
    publicReporting?: boolean;
} = {}): Promise<SeededProject> {
    const slug = options.slug ?? unique('proj');
    const ownerToken = randomString(48);
    const clientToken = options.client === false ? null : randomString(48);
    const at = new Date().toISOString();
    const project = await env.DB.prepare(
        `INSERT INTO projects (name, slug, client_display_name, owner_token_hash, client_token_hash, client_username, client_password_hash, login_prefill_username, login_prefill_password, public_reporting_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
        .bind(
            options.name ?? `專案 ${slug}`,
            slug,
            options.clientName ?? null,
            await sha256Hex(ownerToken),
            clientToken ? await sha256Hex(clientToken) : null,
            options.clientUsername ?? null,
            null,
            options.prefill ? options.clientUsername ?? null : null,
            options.prefill ? options.clientPassword ?? null : null,
            options.publicReporting ? 1 : 0,
            at,
            at,
        )
        .first<Project>();
    let clientAccount: ClientAccount | null = null;
    if (options.clientUsername && options.clientPassword) {
        clientAccount = (await seedClientAccount(project as Project, options.clientUsername, options.clientPassword, options.clientName ?? undefined)).account;
    }
    return { project: project as Project, ownerToken, clientToken, clientAccount };
}

export async function seedClientAccount(
    project: Project,
    username = unique('client'),
    password = 'client-password-1234567',
    name?: string,
    options: { setBySelf?: boolean; createdAt?: string } = {},
): Promise<{ account: ClientAccount; password: string }> {
    const at = options.createdAt ?? new Date().toISOString();
    const account = await env.DB.prepare(
        'INSERT INTO client_accounts (project_id, username, name, password_hash, password_set_by_self, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
        .bind(project.id, username, name ?? `客戶 ${username}`, await hashPassword(password), options.setBySelf ? 1 : 0, at, at)
        .first<ClientAccount>();
    return { account: account as ClientAccount, password };
}

export async function seedDeveloper(username = unique('dev'), password = 'correct-horse-battery-staple', name?: string): Promise<{ developer: Developer; password: string }> {
    const at = new Date().toISOString();
    const developer = await env.DB.prepare('INSERT INTO developers (name, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
        .bind(name ?? `開發者 ${username}`, username, await hashPassword(password), at, at)
        .first<Developer>();
    return { developer: developer as Developer, password };
}

export async function seedToken(developer: Developer): Promise<string> {
    return (await createToken(workerEnv, developer.id, 'test', Date.now())).token;
}

export async function seedReport(
    project: Project,
    options: { title?: string; description?: string; creator?: 'client' | 'developer' | 'owner_shared' | 'public'; developerId?: number | null; reporterName?: string | null; at?: number } = {},
): Promise<{ report: Report; token: string }> {
    const { report, reporterToken } = await createReport(
        workerEnv,
        project,
        { title: options.title ?? unique('標題'), description: options.description ?? '說明', reporter_name: options.reporterName ?? null, uploads: [] },
        { creator_type: options.creator ?? 'client', creator_developer_id: options.developerId ?? null },
        options.at ?? Date.now(),
    );
    return { report, token: reporterToken };
}

export async function seedAttachment(report: Report, options: { kind?: 'feedback' | 'adjustment'; messageId?: number | null; name?: string } = {}): Promise<number> {
    const key = `p/${report.project_id}/${crypto.randomUUID()}`;
    await env.FILES.put(key, PNG_BYTES, { httpMetadata: { contentType: 'image/png' } });
    const row = await env.DB.prepare(
        'INSERT INTO attachments (report_id, message_id, kind, object_key, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
        .bind(report.id, options.messageId ?? null, options.kind ?? 'feedback', key, options.name ?? 'shot.png', 'image/png', PNG_BYTES.byteLength, new Date().toISOString())
        .first<{ id: number }>();
    return row?.id ?? 0;
}

export async function reload<T extends { id: number }>(table: 'reports' | 'projects', row: T): Promise<T> {
    return (await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(row.id).first<T>()) as T;
}

/** A browser: keeps cookies between requests and does not follow redirects. */
export class Browser {
    cookies = new Map<string, string>();
    ip: string;
    /** Extra Worker vars for this browser's requests (configuration such as FEEDBACK_HOME_PUBLIC_PROJECT). */
    vars: Record<string, string> = {};

    constructor(ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, vars: Record<string, string> = {}) {
        this.ip = ip;
        this.vars = vars;
    }

    async request(method: string, path: string, init: { body?: BodyInit | null; headers?: Record<string, string> } = {}): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set('cf-connecting-ip', this.ip);
        if (this.cookies.size > 0) {
            headers.set('cookie', [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '));
        }
        const request = new Request(`${BASE}${path}`, { method, headers, body: init.body ?? null, redirect: 'manual' });
        let response: Response;
        if (Object.keys(this.vars).length > 0) {
            const ctx = createExecutionContext();
            response = await app.fetch(request, { ...env, ...this.vars }, ctx);
            await waitOnExecutionContext(ctx);
        } else {
            response = await exports.default.fetch(request);
        }
        for (const cookie of response.headers.getSetCookie()) {
            const [pair, ...attributes] = cookie.split(';');
            const index = pair.indexOf('=');
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            const maxAge = attributes.map((attribute) => attribute.trim()).find((attribute) => attribute.toLowerCase().startsWith('max-age='));
            if (value === '' || maxAge === 'Max-Age=0') {
                this.cookies.delete(name);
            } else {
                this.cookies.set(name, value);
            }
        }
        return response;
    }

    get(path: string, headers: Record<string, string> = {}): Promise<Response> {
        return this.request('GET', path, { headers });
    }

    post(path: string, form: Record<string, string | string[]> = {}, headers: Record<string, string> = {}): Promise<Response> {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(form)) {
            for (const item of Array.isArray(value) ? value : [value]) {
                body.append(key, item);
            }
        }
        return this.request('POST', path, { body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });
    }

    async upload(slug: string, query: string, bytes: Uint8Array = PNG_BYTES, name = 'shot.png'): Promise<Response> {
        return this.request('PUT', `/p/${slug}/uploads?${query}`, {
            body: bytes,
            headers: { 'content-length': String(bytes.byteLength), 'x-filename': encodeURIComponent(name), accept: 'application/json' },
        });
    }

    async uploadId(slug: string, query: string, bytes: Uint8Array = PNG_BYTES, name = 'shot.png'): Promise<string> {
        const response = await this.upload(slug, query, bytes, name);
        if (response.status !== 201) {
            throw new Error(`upload failed ${response.status}: ${await response.text()}`);
        }
        return ((await response.json()) as { id: string }).id;
    }

    /** Opens the owner entry link. */
    async asOwner(seeded: SeededProject): Promise<this> {
        const response = await this.get(`/owner/${seeded.project.slug}/access?token=${seeded.ownerToken}`);
        if (response.status !== 302) throw new Error(`owner access failed: ${response.status}`);
        return this;
    }

    async asClient(seeded: SeededProject): Promise<this> {
        const response = await this.get(`/p/${seeded.project.slug}/access?token=${seeded.clientToken}`);
        if (response.status !== 302) throw new Error(`client access failed: ${response.status}`);
        return this;
    }

    async loginAs(slug: string, username: string, password: string): Promise<Response> {
        return this.post(`/p/${slug}/login`, { username, password });
    }
}

export async function api(method: string, path: string, token: string | null, body?: unknown, ip = '10.9.9.9', vars: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { 'cf-connecting-ip': ip, accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const request = new Request(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) });
    if (Object.keys(vars).length === 0) {
        return exports.default.fetch(request);
    }
    const ctx = createExecutionContext();
    const response = await app.fetch(request, { ...env, ...vars }, ctx);
    await waitOnExecutionContext(ctx);
    return response;
}

export async function mcpCall(token: string | null, method: string, params: unknown = {}, id = 1): Promise<Response> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    headers['content-length'] = String(new TextEncoder().encode(body).byteLength);
    return exports.default.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers, body }));
}

/** Parses a JSON-RPC response that may come back as JSON or as a single SSE event. */
export async function rpcResult<T = unknown>(response: Response): Promise<T> {
    const text = await response.text();
    const json = text.trimStart().startsWith('{') ? text : (text.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5);
    const parsed = JSON.parse(json) as { result?: T; error?: unknown };
    if (parsed.error) throw new Error(JSON.stringify(parsed.error));
    return parsed.result as T;
}
