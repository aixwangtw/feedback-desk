import { config, type Env } from '../env';
import { CookieJar } from './cookies';
import { hmac, sha256Hex, timingSafeEqualString } from './crypto';
import { findDeveloper, placeholders } from './db';
import { isCreatedByClient, isDeletedByClient, isPublicReport, type Developer, type Project, type Report } from './models';

export const AUTH_COOKIE = 'fd_auth';
export const PUBLIC_COOKIE = 'fd_public';
export const FLASH_COOKIE = 'fd_flash';

const DAY = 86_400;
export const REMEMBER_DAYS = 30;
export const PUBLIC_COOKIE_DAYS = 180;
export const PUBLIC_COOKIE_MAX_REPORTS = 15;
const REPORTER_GRANT_SECONDS = DAY;
const MAX_REPORTER_GRANTS = 40;
const DEVICE_LOGIN_SECONDS = DAY;

export type Role = 'owner' | 'client';
export type GrantSource = 'link' | 'password' | 'developer';

interface GrantEntry {
    /** Source of the grant. */
    s: GrantSource;
    /** Fingerprint of the credential that produced it; rotating the credential invalidates the grant. */
    f: string;
    /** Expiry, unix seconds. */
    e: number;
    /** Developer id for developer logins. */
    d?: number;
}

interface AuthCookie {
    p: Record<string, { o?: GrantEntry; c?: GrantEntry }>;
    /** Reporter grants: [report id, expiry]. */
    r: Array<[number, number]>;
    /** Team login for pages outside a project (CLI authorization). */
    t?: { i: number; f: string; e: number };
    /** Page to return to after logging in. */
    i?: string;
}

export interface Flash {
    success?: string;
    private_report_url?: string;
}

export interface Creator {
    creator_type: 'client' | 'developer' | 'owner_shared' | 'public';
    creator_developer_id: number | null;
}

/**
 * Per-request view of who the visitor is. Mirrors the Laravel FeedbackAccess class: owner and
 * client grants are per project and survive 30 days, reporter grants open single reports, and
 * public reporters are remembered in a separate cookie that holds their report tokens.
 */
export class Access {
    readonly jar: CookieJar;
    private authCookie: AuthCookie | null = null;
    private readonly roleCache = new Map<string, Promise<boolean>>();
    private readonly developerCache = new Map<number, Promise<Developer | null>>();
    private readonly nowSeconds: number;

    constructor(
        private readonly env: Env,
        readonly request: Request,
        nowMs: number = Date.now(),
    ) {
        this.jar = new CookieJar(env.APP_SECRET, request.headers.get('cookie'));
        this.nowSeconds = Math.floor(nowMs / 1000);
    }

    private async auth(): Promise<AuthCookie> {
        if (!this.authCookie) {
            const stored = await this.jar.read<AuthCookie>(AUTH_COOKIE);
            this.authCookie = {
                p: stored && typeof stored.p === 'object' && stored.p !== null ? stored.p : {},
                r: Array.isArray(stored?.r) ? stored.r.filter((entry) => Array.isArray(entry) && entry[1] > this.nowSeconds) : [],
                t: stored?.t,
                i: typeof stored?.i === 'string' ? stored.i : undefined,
            };
        }
        return this.authCookie;
    }

    private saveAuth(cookie: AuthCookie): void {
        this.roleCache.clear();
        const empty = Object.keys(cookie.p).length === 0 && cookie.r.length === 0 && !cookie.t && !cookie.i;
        if (empty) {
            this.jar.forget(AUTH_COOKIE);
        } else {
            this.jar.write(AUTH_COOKIE, cookie, REMEMBER_DAYS * DAY);
        }
    }

    private developer(id: number): Promise<Developer | null> {
        let developer = this.developerCache.get(id);
        if (!developer) {
            developer = findDeveloper(this.env.DB, id);
            this.developerCache.set(id, developer);
        }
        return developer;
    }

    private async fingerprint(project: Project, role: Role, source: GrantSource, developer: Developer | null = null): Promise<string | null> {
        let credential: string | null = null;
        if (source === 'link') {
            credential = role === 'owner' ? project.owner_token_hash : project.client_token_hash;
        } else if (source === 'password') {
            credential = role === 'client' ? project.client_password_hash : null;
        } else if (source === 'developer' && developer && role === 'owner') {
            credential = `${developer.id}|${developer.password_hash}`;
        }
        if (!credential) {
            return null;
        }
        return hmac(this.env.APP_SECRET, `${project.id}|${role}|${source}|${credential}`);
    }

    private async grant(project: Project, role: Role, source: GrantSource, developer: Developer | null = null): Promise<void> {
        const fingerprint = await this.fingerprint(project, role, source, developer);
        if (!fingerprint) {
            return;
        }
        const cookie = await this.auth();
        const key = String(project.id);
        const entry: GrantEntry = { s: source, f: fingerprint, e: this.nowSeconds + REMEMBER_DAYS * DAY };
        if (developer) {
            entry.d = developer.id;
            this.developerCache.set(developer.id, Promise.resolve(developer));
        }
        cookie.p[key] = { ...cookie.p[key], [role === 'owner' ? 'o' : 'c']: entry };
        this.saveAuth(cookie);
    }

    grantOwner(project: Project, source: GrantSource = 'link'): Promise<void> {
        return this.grant(project, 'owner', source);
    }

    grantDeveloper(project: Project, developer: Developer): Promise<void> {
        return this.grant(project, 'owner', 'developer', developer);
    }

    grantClient(project: Project, source: GrantSource = 'link'): Promise<void> {
        return this.grant(project, 'client', source);
    }

    async grantReporter(report: Pick<Report, 'id'>): Promise<void> {
        const cookie = await this.auth();
        cookie.r = cookie.r.filter(([id]) => id !== report.id);
        cookie.r.push([report.id, this.nowSeconds + REPORTER_GRANT_SECONDS]);
        cookie.r = cookie.r.slice(-MAX_REPORTER_GRANTS);
        this.saveAuth(cookie);
    }

    /** Remove every owner/client grant for the project. */
    async revoke(project: Project): Promise<void> {
        const cookie = await this.auth();
        delete cookie.p[String(project.id)];
        this.saveAuth(cookie);
    }

    private async validEntry(project: Project, role: Role): Promise<GrantEntry | null> {
        const cookie = await this.auth();
        const entry = cookie.p[String(project.id)]?.[role === 'owner' ? 'o' : 'c'];
        if (!entry || typeof entry.e !== 'number' || entry.e < this.nowSeconds || typeof entry.f !== 'string') {
            return null;
        }
        let developer: Developer | null = null;
        if (entry.s === 'developer') {
            developer = typeof entry.d === 'number' ? await this.developer(entry.d) : null;
            if (!developer) {
                return null;
            }
        }
        const expected = await this.fingerprint(project, role, entry.s, developer);
        return expected !== null && timingSafeEqualString(expected, entry.f) ? entry : null;
    }

    private hasRole(project: Project, role: Role): Promise<boolean> {
        const key = `${project.id}|${role}|${project.updated_at}`;
        let result = this.roleCache.get(key);
        if (!result) {
            result = this.validEntry(project, role).then((entry) => entry !== null);
            this.roleCache.set(key, result);
        }
        return result;
    }

    isOwner(project: Project): Promise<boolean> {
        return this.hasRole(project, 'owner');
    }

    isClient(project: Project): Promise<boolean> {
        return this.hasRole(project, 'client');
    }

    async canManage(project: Project): Promise<boolean> {
        return (await this.isOwner(project)) || (await this.isClient(project));
    }

    /** The personal team account that is signed in; null for owner-link logins. */
    async currentDeveloper(project: Project): Promise<Developer | null> {
        const entry = await this.validEntry(project, 'owner');
        if (!entry || entry.s !== 'developer' || typeof entry.d !== 'number') {
            return null;
        }
        return this.developer(entry.d);
    }

    async creatorFor(project: Project): Promise<Creator> {
        if (!(await this.isOwner(project))) {
            return { creator_type: 'client', creator_developer_id: null };
        }
        const developer = await this.currentDeveloper(project);
        return developer
            ? { creator_type: 'developer', creator_developer_id: developer.id }
            : { creator_type: 'owner_shared', creator_developer_id: null };
    }

    async validateReporterToken(report: Pick<Report, 'reporter_token_hash'>, token: string): Promise<boolean> {
        return token !== '' && timingSafeEqualString(report.reporter_token_hash, await sha256Hex(token));
    }

    /** Reporter access: this browser opened the report's private URL, or a public reporter's cookie still holds its token. */
    async hasReporterGrant(report: Report): Promise<boolean> {
        const cookie = await this.auth();
        if (cookie.r.some(([id]) => id === report.id)) {
            return true;
        }
        if (!isPublicReport(report)) {
            return false;
        }
        const token = (await this.publicTokens())[report.public_id];
        return typeof token === 'string' && (await this.validateReporterToken(report, token));
    }

    async canView(project: Project, report: Report): Promise<boolean> {
        return (await this.canManage(project)) || (await this.hasReporterGrant(report));
    }

    /**
     * A report deleted by the client, or created by the team, exists only for the owner.
     * A public report is visible only to the owner and to the reporter holding its token.
     */
    async reportVisible(project: Project, report: Report): Promise<boolean> {
        const owner = await this.isOwner(project);
        if (isPublicReport(report)) {
            return owner || (await this.hasReporterGrant(report));
        }
        return owner || (!isDeletedByClient(report) && isCreatedByClient(report));
    }

    private async publicTokens(): Promise<Record<string, string>> {
        const stored = await this.jar.read<Record<string, unknown>>(PUBLIC_COOKIE);
        const tokens: Record<string, string> = {};
        if (stored && typeof stored === 'object') {
            for (const [publicId, token] of Object.entries(stored)) {
                if (typeof token === 'string') {
                    tokens[publicId] = token;
                }
            }
        }
        return tokens;
    }

    /** Keeps the public reporter's token in an encrypted HttpOnly cookie so the home page can list their reports. */
    async rememberPublicReport(report: Pick<Report, 'public_id'>, token: string): Promise<void> {
        const tokens = await this.publicTokens();
        delete tokens[report.public_id];
        tokens[report.public_id] = token;
        const entries = Object.entries(tokens).slice(-PUBLIC_COOKIE_MAX_REPORTS);
        this.jar.write(PUBLIC_COOKIE, Object.fromEntries(entries), PUBLIC_COOKIE_DAYS * DAY);
    }

    /** Public reports remembered by this browser whose tokens are still valid, newest first. */
    async rememberedPublicReports(project: Project): Promise<Report[]> {
        const tokens = await this.publicTokens();
        const publicIds = Object.keys(tokens);
        if (publicIds.length === 0) {
            return [];
        }
        const { results } = await this.env.DB.prepare(
            `SELECT * FROM reports WHERE project_id = ? AND creator_type = 'public' AND public_id IN (${placeholders(publicIds.length)}) ORDER BY created_at DESC, id DESC`,
        )
            .bind(project.id, ...publicIds)
            .all<Report>();
        const valid: Report[] = [];
        for (const report of results) {
            if (await this.validateReporterToken(report, tokens[report.public_id])) {
                valid.push(report);
            }
        }
        return valid;
    }

    async setIntendedUrl(url: string): Promise<void> {
        const cookie = await this.auth();
        cookie.i = url;
        this.saveAuth(cookie);
    }

    /** Returns and clears the remembered page, falling back to `fallback`. Only same-site paths are honoured. */
    async pullIntendedUrl(fallback: string): Promise<string> {
        const cookie = await this.auth();
        const intended = cookie.i;
        if (intended !== undefined) {
            delete cookie.i;
            this.saveAuth(cookie);
        }
        return intended && intended.startsWith('/') && !intended.startsWith('//') ? intended : fallback;
    }

    async flash(): Promise<Flash> {
        if (!this.jar.has(FLASH_COOKIE)) {
            return {};
        }
        const value = (await this.jar.read<Flash>(FLASH_COOKIE)) ?? {};
        this.jar.forget(FLASH_COOKIE);
        return value;
    }

    setFlash(flash: Flash): void {
        this.jar.write(FLASH_COOKIE, flash, 300);
    }

    /** Team sign-in that is not tied to a project, used by the CLI authorization page. */
    async teamDeveloper(): Promise<Developer | null> {
        const cookie = await this.auth();
        const entry = cookie.t;
        if (!entry || entry.e < this.nowSeconds) {
            return null;
        }
        const developer = await this.developer(entry.i);
        if (!developer) {
            return null;
        }
        const expected = await hmac(this.env.APP_SECRET, `team|${developer.id}|${developer.password_hash}`);
        return timingSafeEqualString(expected, entry.f) ? developer : null;
    }

    async grantTeam(developer: Developer): Promise<void> {
        const cookie = await this.auth();
        cookie.t = {
            i: developer.id,
            f: await hmac(this.env.APP_SECRET, `team|${developer.id}|${developer.password_hash}`),
            e: this.nowSeconds + DEVICE_LOGIN_SECONDS,
        };
        this.developerCache.set(developer.id, Promise.resolve(developer));
        this.saveAuth(cookie);
    }

    async revokeTeam(): Promise<void> {
        const cookie = await this.auth();
        delete cookie.t;
        this.saveAuth(cookie);
    }

    labels() {
        return config(this.env).labels;
    }
}
