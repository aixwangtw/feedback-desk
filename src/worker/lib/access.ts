import { config, type Env } from '../env';
import { CookieJar } from './cookies';
import { hmac, sha256Hex, timingSafeEqualString } from './crypto';
import { findClientAccount, findClientAccountInProject, findDeveloper, placeholders } from './db';
import { isCreatedByClient, isDeletedByClient, isPublicReport, type ClientAccount, type Developer, type Project, type Report } from './models';

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
    /** Client account id for client password logins (missing on logins from before migration 0005). */
    a?: number;
}

interface AuthCookie {
    p: Record<string, { o?: GrantEntry; c?: GrantEntry }>;
    /** Reporter grants: [report id, expiry]. */
    r: Array<[number, number]>;
    /** Sign-in for the CLI authorization page (outside any project): a team account, or a client account when k is 'c'. */
    t?: { i: number; f: string; e: number; k?: 'c' };
    /** Global signed-in developer/team account (owner on every project). */
    g?: { i: number; f: string; e: number };
    /** Page to return to after logging in. */
    i?: string;
}

/** A same-site path: starts with one slash, no backslash (browsers treat it as a slash), no control characters. */
export function isSafeLocalPath(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(path);
}

export interface Flash {
    success?: string;
    private_report_url?: string;
}

export interface Creator {
    creator_type: 'client' | 'developer' | 'owner_shared' | 'public';
    creator_developer_id: number | null;
    creator_client_account_id?: number | null;
}

/** Who is writing, for the account columns on reports, messages, attachments and the activity log. */
export interface Author {
    developerId: number | null;
    clientAccountId: number | null;
    /** Name at the time, for the activity log (pages show the account's current name). */
    name?: string;
    /** AI tool doing it through MCP or the CLI ('Claude Code', 'Codex'); null for people on the web. */
    agent?: string | null;
}

export type DeviceAccount = { kind: 'developer'; developer: Developer } | { kind: 'client'; account: ClientAccount };

interface ValidGrant {
    entry: GrantEntry;
    developer: Developer | null;
    account: ClientAccount | null;
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
    private readonly accountCache = new Map<number, Promise<ClientAccount | null>>();
    private readonly guestCache = new Map<number, Promise<ClientAccount | null>>();
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
                g: stored?.g,
                i: typeof stored?.i === 'string' ? stored.i : undefined,
            };
        }
        return this.authCookie;
    }

    private saveAuth(cookie: AuthCookie): void {
        this.roleCache.clear();
        const empty = Object.keys(cookie.p).length === 0 && cookie.r.length === 0 && !cookie.t && !cookie.g && !cookie.i;
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

    private clientAccount(id: number): Promise<ClientAccount | null> {
        let account = this.accountCache.get(id);
        if (!account) {
            account = findClientAccount(this.env.DB, id);
            this.accountCache.set(id, account);
        }
        return account;
    }

    private async fingerprint(project: Project, role: Role, source: GrantSource, developer: Developer | null = null, account: ClientAccount | null = null): Promise<string | null> {
        let credential: string | null = null;
        if (source === 'link') {
            credential = role === 'owner' ? project.owner_token_hash : project.client_token_hash;
        } else if (source === 'password' && role === 'client' && account) {
            credential = `account|${account.id}|${account.password_hash}`;
        } else if (source === 'developer' && developer && role === 'owner') {
            credential = `${developer.id}|${developer.password_hash}`;
        }
        if (!credential) {
            return null;
        }
        return this.grantFingerprint(project.id, role, source, credential);
    }

    private grantFingerprint(projectId: number | string, role: Role, source: GrantSource, credential: string): Promise<string> {
        return hmac(this.env.APP_SECRET, `${projectId}|${role}|${source}|${credential}`);
    }

    private async grant(project: Project, role: Role, source: GrantSource, developer: Developer | null = null, account: ClientAccount | null = null): Promise<void> {
        const fingerprint = await this.fingerprint(project, role, source, developer, account);
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
        if (account) {
            entry.a = account.id;
            this.accountCache.set(account.id, Promise.resolve(account));
        }
        cookie.p[key] = { ...cookie.p[key], [role === 'owner' ? 'o' : 'c']: entry };
        this.saveAuth(cookie);
    }

    grantOwner(project: Project, source: GrantSource = 'link'): Promise<void> {
        return this.grant(project, 'owner', source);
    }

    async grantDeveloper(project: Project, developer: Developer): Promise<void> {
        await Promise.all([
            this.grant(project, 'owner', 'developer', developer),
            this.grantGlobalDeveloper(developer),
        ]);
    }

    async grantGlobalDeveloper(developer: Developer): Promise<void> {
        const cookie = await this.auth();
        const fingerprint = await hmac(this.env.APP_SECRET, `global-developer|${developer.id}|${developer.password_hash}`);
        cookie.g = { i: developer.id, f: fingerprint, e: this.nowSeconds + REMEMBER_DAYS * DAY };
        this.developerCache.set(developer.id, Promise.resolve(developer));
        this.saveAuth(cookie);
    }

    async globalDeveloper(): Promise<Developer | null> {
        const cookie = await this.auth();
        const g = cookie.g;
        if (!g || typeof g.e !== 'number' || g.e < this.nowSeconds || typeof g.f !== 'string' || typeof g.i !== 'number') {
            return null;
        }
        const developer = await this.developer(g.i);
        if (!developer || developer.disabled_at) {
            return null;
        }
        const expected = await hmac(this.env.APP_SECRET, `global-developer|${developer.id}|${developer.password_hash}`);
        return timingSafeEqualString(expected, g.f) ? developer : null;
    }

    async revokeGlobalDeveloper(): Promise<void> {
        const cookie = await this.auth();
        delete cookie.g;
        this.saveAuth(cookie);
    }

    /** Client entry link login. */
    grantClient(project: Project): Promise<void> {
        return this.grant(project, 'client', 'link');
    }

    /** Client account login; also used to stay signed in after the holder changes the password. */
    async grantClientAccount(project: Project, account: ClientAccount): Promise<void> {
        await this.grant(project, 'client', 'password', null, account);
        const cookie = await this.auth();
        if (cookie.t && cookie.t.k === 'c' && cookie.t.i === account.id) {
            cookie.t.f = await hmac(this.env.APP_SECRET, `team|c|${account.id}|${account.password_hash}`);
            this.saveAuth(cookie);
        }
    }

    async grantReporter(report: Pick<Report, 'id'>): Promise<void> {
        const cookie = await this.auth();
        cookie.r = cookie.r.filter(([id]) => id !== report.id);
        cookie.r.push([report.id, this.nowSeconds + REPORTER_GRANT_SECONDS]);
        cookie.r = cookie.r.slice(-MAX_REPORTER_GRANTS);
        this.saveAuth(cookie);
    }

    /** Remove every owner/client grant for the project, and global developer session. */
    async revoke(project: Project): Promise<void> {
        const cookie = await this.auth();
        delete cookie.p[String(project.id)];
        delete cookie.g;
        this.saveAuth(cookie);
    }

    private async validGrant(project: Project, role: Role): Promise<ValidGrant | null> {
        const cookie = await this.auth();
        const entry = cookie.p[String(project.id)]?.[role === 'owner' ? 'o' : 'c'];
        if (!entry || typeof entry.e !== 'number' || entry.e < this.nowSeconds || typeof entry.f !== 'string') {
            if (role === 'owner') {
                const globalDev = await this.globalDeveloper();
                if (globalDev) {
                    const globalEntry: GrantEntry = {
                        s: 'developer',
                        f: cookie.g!.f,
                        e: cookie.g!.e,
                        d: globalDev.id,
                    };
                    return { entry: globalEntry, developer: globalDev, account: null };
                }
            }
            return null;
        }
        let developer: Developer | null = null;
        let account: ClientAccount | null = null;
        let expected: string | null;
        if (entry.s === 'developer') {
            developer = typeof entry.d === 'number' ? await this.developer(entry.d) : null;
            if (!developer || developer.disabled_at) {
                return null;
            }
            expected = await this.fingerprint(project, role, entry.s, developer);
        } else if (entry.s === 'password') {
            if (role !== 'client') {
                return null;
            }
            if (typeof entry.a === 'number') {
                account = await this.clientAccount(entry.a);
                expected = account && account.project_id === project.id && !account.disabled_at ? await this.fingerprint(project, role, entry.s, null, account) : null;
            } else {
                // A login from before migration 0005: it was bound to the project's single client
                // password, which now belongs to the copied account with the same username.
                account = project.client_username ? await findClientAccountInProject(this.env.DB, project.id, project.client_username) : null;
                expected = account && !account.disabled_at ? await this.grantFingerprint(project.id, role, 'password', account.password_hash) : null;
            }
        } else {
            expected = await this.fingerprint(project, role, entry.s);
        }
        const matches = expected !== null && timingSafeEqualString(expected, entry.f);
        if (matches) {
            return { entry, developer, account };
        }
        if (role === 'owner') {
            const globalDev = await this.globalDeveloper();
            if (globalDev) {
                const globalEntry: GrantEntry = {
                    s: 'developer',
                    f: cookie.g!.f,
                    e: cookie.g!.e,
                    d: globalDev.id,
                };
                return { entry: globalEntry, developer: globalDev, account: null };
            }
        }
        return null;
    }

    private async validEntry(project: Project, role: Role): Promise<GrantEntry | null> {
        return (await this.validGrant(project, role))?.entry ?? null;
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

    async isClient(project: Project): Promise<boolean> {
        return (await this.hasRole(project, 'client')) || (await this.guestClientAccount(project)) !== null;
    }

    /** The client account the guest entry uses on this project; null when guest mode is off, the account is missing or disabled. */
    guestClientAccount(project: Project): Promise<ClientAccount | null> {
        const guest = config(this.env).guestClient;
        if (guest.project === '' || guest.account === '' || guest.project !== project.slug) {
            return Promise.resolve(null);
        }
        let account = this.guestCache.get(project.id);
        if (!account) {
            account = findClientAccountInProject(this.env.DB, project.id, guest.account).then((found) => (found && !found.disabled_at ? found : null));
            this.guestCache.set(project.id, account);
        }
        return account;
    }

    /** Not signed in, using the project through the guest entry as its configured client account. */
    async isGuest(project: Project): Promise<boolean> {
        return (await this.guestClientAccount(project)) !== null && !(await this.isOwner(project)) && !(await this.hasRole(project, 'client'));
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

    /** How the client role was obtained in this browser (link or password); null without a valid client login. */
    async clientSource(project: Project): Promise<GrantSource | null> {
        return (await this.validEntry(project, 'client'))?.s ?? null;
    }

    /** Signed in with an account that has a password (not an entry link), so "change password" applies. */
    async hasPasswordAccount(project: Project): Promise<boolean> {
        if (await this.isGuest(project)) {
            return false;
        }
        const developer = await this.currentDeveloper(project);
        if (developer && !developer.disabled_at) {
            return true;
        }
        return (await this.currentClientAccount(project)) !== null;
    }

    /** The client account signed in on this project; null for the client entry link or no client login. */
    async currentClientAccount(project: Project): Promise<ClientAccount | null> {
        const grant = await this.validGrant(project, 'client');
        if (grant) {
            return grant.entry.s === 'password' ? grant.account : null;
        }
        return (await this.isOwner(project)) ? null : this.guestClientAccount(project);
    }

    /**
     * Whose read state and unread counts apply on the client side: a signed-in client account, or
     * null for the shared client side (entry link, single-report and public reporters). Only
     * meaningful when the viewer is not the team.
     */
    async clientViewer(project: Project): Promise<ClientAccount | null> {
        return (await this.isOwner(project)) ? null : this.currentClientAccount(project);
    }

    /** The accounts recorded on what this browser writes in the project. */
    async author(project: Project): Promise<Author> {
        const labels = config(this.env).labels;
        if (await this.isOwner(project)) {
            const developer = await this.currentDeveloper(project);
            return { developerId: developer?.id ?? null, clientAccountId: null, name: developer?.name ?? labels.owner, agent: null };
        }
        const account = await this.currentClientAccount(project);
        return { developerId: null, clientAccountId: account?.id ?? null, name: account?.name ?? labels.client, agent: null };
    }

    /**
     * After the account holder changes their own password: every login bound to the old hash
     * (other browsers, CLI sign-in pages) stops working, and this browser's logins of that
     * account are re-signed with the new hash so the holder stays signed in.
     */
    async refreshDeveloperLogins(developer: Developer): Promise<void> {
        const cookie = await this.auth();
        for (const [projectId, grants] of Object.entries(cookie.p)) {
            const entry = grants.o;
            if (entry && entry.s === 'developer' && entry.d === developer.id) {
                entry.f = await this.grantFingerprint(projectId, 'owner', 'developer', `${developer.id}|${developer.password_hash}`);
            }
        }
        if (cookie.t && cookie.t.i === developer.id && cookie.t.k !== 'c') {
            cookie.t.f = await hmac(this.env.APP_SECRET, `team|${developer.id}|${developer.password_hash}`);
        }
        if (cookie.g && cookie.g.i === developer.id) {
            cookie.g.f = await hmac(this.env.APP_SECRET, `global-developer|${developer.id}|${developer.password_hash}`);
        }
        this.developerCache.set(developer.id, Promise.resolve(developer));
        this.saveAuth(cookie);
    }

    async creatorFor(project: Project): Promise<Creator> {
        if (!(await this.isOwner(project))) {
            return { creator_type: 'client', creator_developer_id: null, creator_client_account_id: (await this.currentClientAccount(project))?.id ?? null };
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
        return intended && isSafeLocalPath(intended) ? intended : fallback;
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

    /** Who signed in on the CLI authorization page: a team account or a client account. */
    async deviceAccount(): Promise<DeviceAccount | null> {
        const cookie = await this.auth();
        const entry = cookie.t;
        if (!entry || entry.e < this.nowSeconds || typeof entry.i !== 'number' || typeof entry.f !== 'string') {
            return null;
        }
        if (entry.k === 'c') {
            const account = await this.clientAccount(entry.i);
            if (!account || account.disabled_at) {
                return null;
            }
            const expected = await hmac(this.env.APP_SECRET, `team|c|${account.id}|${account.password_hash}`);
            return timingSafeEqualString(expected, entry.f) ? { kind: 'client', account } : null;
        }
        const developer = await this.developer(entry.i);
        if (!developer || developer.disabled_at) {
            return null;
        }
        const expected = await hmac(this.env.APP_SECRET, `team|${developer.id}|${developer.password_hash}`);
        return timingSafeEqualString(expected, entry.f) ? { kind: 'developer', developer } : null;
    }

    async grantDevice(holder: DeviceAccount): Promise<void> {
        const cookie = await this.auth();
        if (holder.kind === 'developer') {
            cookie.t = { i: holder.developer.id, f: await hmac(this.env.APP_SECRET, `team|${holder.developer.id}|${holder.developer.password_hash}`), e: this.nowSeconds + DEVICE_LOGIN_SECONDS };
            this.developerCache.set(holder.developer.id, Promise.resolve(holder.developer));
        } else {
            cookie.t = { k: 'c', i: holder.account.id, f: await hmac(this.env.APP_SECRET, `team|c|${holder.account.id}|${holder.account.password_hash}`), e: this.nowSeconds + DEVICE_LOGIN_SECONDS };
            this.accountCache.set(holder.account.id, Promise.resolve(holder.account));
        }
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
