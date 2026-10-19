import type { Context } from 'hono';
import { isSafeLocalPath, type Access } from '../lib/access';
import type { ClientAccount, Developer, Project } from '../lib/models';
import type { Env } from '../env';
import { config } from '../env';
import type { ViewContext } from '../views/components';

export type AppEnv = {
    Bindings: Env;
    Variables: {
        access: Access;
        now: number;
        /** Team account behind the API token; unset for client tokens. */
        apiDeveloper: Developer;
        /** Client account and its project behind the API token; unset for team tokens. */
        apiClient: { account: ClientAccount; project: Project };
        apiTokenId: number;
        /** AI tool from the token or the CLI header ('Claude Code', 'Codex'). */
        apiAgent: string | null;
    };
};

export type AppContext = Context<AppEnv>;

export function viewContext(c: AppContext): ViewContext {
    return { cfg: config(c.env), now: c.get('now') };
}

/** Laravel's expectsJson(): fetch() calls from the page ask for JSON. */
export function wantsJson(c: AppContext): boolean {
    const accept = c.req.header('accept') ?? '';
    return accept.includes('application/json') || accept.includes('+json');
}

export class HttpError extends Error {
    constructor(
        readonly status: 400 | 403 | 404 | 405 | 409 | 413 | 422 | 429,
        message = '',
        readonly headers: Record<string, string> = {},
    ) {
        super(message);
    }
}

export function abort(status: HttpError['status'], message = '', headers: Record<string, string> = {}): never {
    throw new HttpError(status, message, headers);
}

/** Reads an application/x-www-form-urlencoded (or multipart, text fields only) body. */
export async function readForm(c: AppContext): Promise<URLSearchParams> {
    const type = c.req.header('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
        const data = await c.req.raw.formData();
        const params = new URLSearchParams();
        for (const [key, value] of data.entries()) {
            if (typeof value === 'string') {
                params.append(key, value);
            }
        }
        return params;
    }
    // Decode the bytes ourselves: Request.text() on a form body logs a warning in workerd.
    return new URLSearchParams(new TextDecoder().decode(await c.req.arrayBuffer()));
}

/** Laravel TrimStrings: form values are trimmed. */
export function field(form: URLSearchParams, name: string): string {
    return (form.get(name) ?? '').trim();
}

/**
 * Same-site path to go back to (Laravel back()). Pages send no Referer (referrer policy
 * no-referrer), so forms carry the page they came from in a hidden `_back` field.
 */
export function backUrl(c: AppContext, form: URLSearchParams | null, fallback: string): string {
    const back = form?.get('_back') ?? '';
    if (isSafeLocalPath(back)) {
        return back;
    }
    const referer = c.req.header('referer');
    if (!referer) {
        return fallback;
    }
    try {
        const url = new URL(referer);
        const current = new URL(c.req.url);
        if (url.host !== current.host) {
            return fallback;
        }
        return url.pathname + url.search + url.hash;
    } catch {
        return fallback;
    }
}

export function currentPathWithQuery(c: AppContext): string {
    const url = new URL(c.req.url);
    return url.pathname + url.search;
}

export function origin(c: AppContext): string {
    return new URL(c.req.url).origin;
}
