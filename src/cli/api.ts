import { CLI_COMMAND, CliError, type Runtime } from './runtime';

/**
 * Which AI tool is running this CLI, sent so the site can show "名字（Codex）". FEEDBACK_DESK_AGENT
 * wins; otherwise Codex marks its shells with CODEX_THREAD_ID / CODEX_SESSION_ID and Claude Code
 * with CLAUDECODE=1. Codex is checked first because a Codex started from Claude Code inherits
 * CLAUDECODE. The server only accepts the known names.
 */
export function detectAgent(env: Record<string, string | undefined>): string | null {
    if (env.FEEDBACK_DESK_AGENT) {
        return env.FEEDBACK_DESK_AGENT;
    }
    if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) {
        return 'Codex';
    }
    if (env.CLAUDECODE === '1') {
        return 'Claude Code';
    }
    return null;
}

export class ApiError extends CliError {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
    }
}

export class ApiClient {
    constructor(
        private readonly rt: Runtime,
        readonly baseUrl: string,
        private readonly token: string | null,
    ) {}

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        const headers: Record<string, string> = { Accept: 'application/json', ...extra };
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        const agent = detectAgent(this.rt.env);
        if (agent) {
            headers['X-Feedback-Desk-Agent'] = agent;
        }
        return headers;
    }

    async request<T>(method: string, path: string, body?: unknown, options: { auth?: boolean; allowError?: boolean } = {}): Promise<{ status: number; data: T }> {
        if (options.auth !== false && !this.token) {
            throw new CliError(`尚未登入 ${this.baseUrl}：請先執行 ${CLI_COMMAND} login --url ${this.baseUrl}`);
        }
        let response: Response;
        try {
            response = await this.rt.fetch(`${this.baseUrl}/api/v1${path}`, {
                method,
                headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch (error) {
            throw new CliError(`連不到 ${this.baseUrl}：${error instanceof Error ? error.message : String(error)}`);
        }
        const text = await response.text();
        let data: unknown = null;
        try {
            data = text === '' ? null : JSON.parse(text);
        } catch {
            data = { message: text.slice(0, 200) };
        }
        if (!response.ok && !options.allowError) {
            const payload = (data ?? {}) as { message?: string; error?: string };
            if (response.status === 401) {
                throw new ApiError(`登入已失效或 token 已撤銷：請重新執行 ${CLI_COMMAND} login --url ${this.baseUrl}`, 401, 'unauthorized');
            }
            throw new ApiError(payload.message || `HTTP ${response.status}`, response.status, payload.error ?? 'error');
        }
        return { status: response.status, data: data as T };
    }

    get<T>(path: string): Promise<T> {
        return this.request<T>('GET', path).then((result) => result.data);
    }

    post<T>(path: string, body: unknown = {}): Promise<T> {
        return this.request<T>('POST', path, body).then((result) => result.data);
    }

    delete<T>(path: string): Promise<T> {
        return this.request<T>('DELETE', path).then((result) => result.data);
    }

    async upload(path: string, bytes: Uint8Array, filename: string, mimeType: string): Promise<{ id: string; name: string; size: number }> {
        const response = await this.rt.fetch(`${this.baseUrl}/api/v1${path}`, {
            method: 'PUT',
            headers: this.headers({ 'Content-Type': mimeType, 'X-Filename': encodeURIComponent(filename) }),
            body: bytes as unknown as BodyInit,
        });
        const data = (await response.json().catch(() => ({}))) as { id?: string; name?: string; size?: number; message?: string };
        if (!response.ok || !data.id) {
            throw new ApiError(`上傳 ${filename} 失敗：${data.message ?? `HTTP ${response.status}`}`, response.status, 'upload_failed');
        }
        return { id: data.id, name: data.name ?? filename, size: data.size ?? bytes.byteLength };
    }

    async download(url: string): Promise<Uint8Array> {
        const response = await this.rt.fetch(url);
        if (!response.ok) {
            throw new CliError(`下載附件失敗（HTTP ${response.status}）`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }
}

export function encodePath(value: string): string {
    return encodeURIComponent(value);
}
