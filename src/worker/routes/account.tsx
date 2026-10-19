import { Hono } from 'hono';
import { MAX_PASSWORD_LENGTH, selfSetPasswordProblems } from '../../shared/password';
import { charLength } from '../../shared/text';
import { nowIso } from '../../shared/time';
import { hashPassword, hmac, SELF_SET_PASSWORD_ITERATIONS, timingSafeEqualString, verifyPassword } from '../lib/crypto';
import { findClientAccount, findDeveloper, findProjectBySlug } from '../lib/db';
import type { ClientAccount, Developer, Project } from '../lib/models';
import { clear, clientIp, hit } from '../lib/rate-limit';
import { MAX_ACCOUNT_NAME } from '../lib/team';
import { AccountPage, type AccountView } from '../views/pages';
import { config } from '../env';
import { abort, field, readForm, viewContext, type AppContext, type AppEnv } from './context';
import { paths } from './paths';
import { checkLoginRateLimit, loginLimits } from './web';

/**
 * "My account" for whoever is signed in with an account: a personal team account, or one of the
 * project's client accounts. The holder can change the display name, and the password in two
 * steps so each request runs at most one PBKDF2 and stays well inside the free plan's CPU limit:
 * first the current password is checked, then the new one is hashed on a second request.
 * The login name never changes.
 */
export const account = new Hono<AppEnv>();

const REAUTH_COOKIE = 'fd_reauth';
/** How long the confirmed current password lets the holder choose a new one. */
const REAUTH_SECONDS = 300;

type Account = { kind: 'developer'; developer: Developer } | { kind: 'client'; client: ClientAccount };

interface Reauth {
    /** Account kind and id: d|<developer id> or c|<client account id>. */
    a: string;
    /** HMAC of the password hash that was confirmed; any password change since voids it. */
    f: string;
    e: number;
}

async function projectOr404(c: AppContext): Promise<Project> {
    const project = await findProjectBySlug(c.env.DB, c.req.param('slug') ?? '');
    if (!project) {
        abort(404);
    }
    return project;
}

/** The account this browser is signed in with on this project; null for entry-link logins. */
async function accountFor(c: AppContext, project: Project): Promise<Account | null> {
    const access = c.get('access');
    const developer = await access.currentDeveloper(project);
    if (developer && !developer.disabled_at) {
        return { kind: 'developer', developer };
    }
    if (await access.isOwner(project)) {
        return null;
    }
    const client = await access.currentClientAccount(project);
    return client ? { kind: 'client', client } : null;
}

/**
 * Accounts whose password the login page shows to everyone (FEEDBACK_LOGIN_PREFILL_ENABLED): letting
 * one visitor make it their own would lock everyone else out of a shared demo account.
 */
function isPrefilled(c: AppContext, project: Project, holder: Account): boolean {
    const prefill = config(c.env).loginPrefill;
    if (!prefill.enabled) {
        return false;
    }
    return holder.kind === 'developer'
        ? prefill.ownerUsername !== '' && prefill.ownerUsername === holder.developer.username
        : project.login_prefill_username !== null && project.login_prefill_username === holder.client.username;
}

const PREFILLED = '這是登入頁公開預填的示範帳號，不能改密碼。';

function accountKey(holder: Account): string {
    return holder.kind === 'developer' ? `d|${holder.developer.id}` : `c|${holder.client.id}`;
}

function accountHash(holder: Account): string {
    return holder.kind === 'developer' ? holder.developer.password_hash : holder.client.password_hash;
}

function accountUsername(holder: Account): string {
    return holder.kind === 'developer' ? holder.developer.username : holder.client.username;
}

function view(holder: Account | null): AccountView | null {
    if (!holder) {
        return null;
    }
    const row = holder.kind === 'developer' ? holder.developer : holder.client;
    return { kind: holder.kind, username: row.username, name: row.name, passwordSetBySelf: row.password_set_by_self === 1 };
}

function reauthFingerprint(c: AppContext, key: string, hash: string): Promise<string> {
    return hmac(c.env.APP_SECRET, `reauth|${key}|${hash}`);
}

async function reauthValid(c: AppContext, holder: Account): Promise<boolean> {
    const stored = await c.get('access').jar.read<Reauth>(REAUTH_COOKIE);
    if (!stored || typeof stored.a !== 'string' || typeof stored.f !== 'string' || typeof stored.e !== 'number') {
        return false;
    }
    const key = accountKey(holder);
    if (stored.a !== key || stored.e < Math.floor(c.get('now') / 1000)) {
        return false;
    }
    return timingSafeEqualString(stored.f, await reauthFingerprint(c, key, accountHash(holder)));
}

interface RenderOptions {
    step?: 'current' | 'new';
    passwordErrors?: string[];
    nameErrors?: string[];
    nameOld?: string;
    status?: 200 | 403 | 422;
    success?: string;
}

async function render(c: AppContext, project: Project, holder: Account | null, options: RenderOptions = {}) {
    const step = options.step ?? (holder && (await reauthValid(c, holder)) ? 'new' : 'current');
    return c.html(
        <AccountPage
            v={viewContext(c)}
            project={project}
            account={view(holder)}
            step={step}
            passwordErrors={options.passwordErrors ?? []}
            nameErrors={options.nameErrors ?? []}
            nameOld={options.nameOld}
            success={options.success}
        />,
        options.status ?? 200,
    );
}

account.get('/p/:slug/account', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        await access.setIntendedUrl(paths.account(project.slug));
        return c.redirect(paths.login(project.slug), 302);
    }
    const flash = await access.flash();
    return render(c, project, await accountFor(c, project), { success: flash.success });
});

/** The holder's display name. The login name stays as it is. */
account.post('/p/:slug/account/name', async (c) => {
    const project = await projectOr404(c);
    const holder = await accountFor(c, project);
    if (!holder) {
        return render(c, project, null, { status: 403 });
    }
    const form = await readForm(c);
    const name = field(form, 'name');
    if (name === '' || charLength(name) > MAX_ACCOUNT_NAME) {
        return render(c, project, holder, { nameErrors: [`顯示名稱不可為空白，且不可超過 ${MAX_ACCOUNT_NAME} 字。`], nameOld: name, status: 422 });
    }
    const at = nowIso(c.get('now'));
    if (holder.kind === 'developer') {
        await c.env.DB.prepare('UPDATE developers SET name = ?, updated_at = ? WHERE id = ?').bind(name, at, holder.developer.id).run();
    } else {
        await c.env.DB.prepare('UPDATE client_accounts SET name = ?, updated_at = ? WHERE id = ?').bind(name, at, holder.client.id).run();
    }
    c.get('access').setFlash({ success: `顯示名稱已改為「${name}」。` });
    return c.redirect(paths.account(project.slug), 303);
});

/** Password step 1: the current password, with the same failed-attempt limits as the login form. */
account.post('/p/:slug/account/verify', async (c) => {
    const project = await projectOr404(c);
    const holder = await accountFor(c, project);
    if (!holder) {
        return render(c, project, null, { status: 403 });
    }
    if (isPrefilled(c, project, holder)) {
        return render(c, project, holder, { step: 'current', passwordErrors: [PREFILLED], status: 403 });
    }
    const form = await readForm(c);
    const current = form.get('current_password') ?? '';
    if (current === '' || charLength(current) > MAX_PASSWORD_LENGTH) {
        return render(c, project, holder, { step: 'current', passwordErrors: ['請輸入目前的密碼。'], status: 422 });
    }
    const limits = loginLimits(accountUsername(holder), clientIp(c.req.raw));
    await checkLoginRateLimit(c, limits);
    if (!(await verifyPassword(current, accountHash(holder)))) {
        await hit(c.env.DB, limits, c.get('now'));
        return render(c, project, holder, { step: 'current', passwordErrors: ['目前的密碼不正確。'], status: 422 });
    }
    await clear(c.env.DB, limits[0], c.get('now'));
    const key = accountKey(holder);
    const reauth: Reauth = { a: key, f: await reauthFingerprint(c, key, accountHash(holder)), e: Math.floor(c.get('now') / 1000) + REAUTH_SECONDS };
    c.get('access').jar.write(REAUTH_COOKIE, reauth, REAUTH_SECONDS);
    return c.redirect(`${paths.account(project.slug)}#password`, 303);
});

/** Password step 2: the new password. Only after step 1 succeeded for this account within five minutes. */
account.post('/p/:slug/account/password', async (c) => {
    const project = await projectOr404(c);
    const holder = await accountFor(c, project);
    if (!holder) {
        return render(c, project, null, { status: 403 });
    }
    const access = c.get('access');
    if (isPrefilled(c, project, holder)) {
        return render(c, project, holder, { step: 'current', passwordErrors: [PREFILLED], status: 403 });
    }
    if (!(await reauthValid(c, holder))) {
        access.jar.forget(REAUTH_COOKIE);
        return render(c, project, holder, { step: 'current', passwordErrors: ['確認目前密碼已逾時，請重新輸入目前的密碼。'], status: 422 });
    }
    const form = await readForm(c);
    const next = form.get('new_password') ?? '';
    const confirmation = form.get('new_password_confirmation') ?? '';
    const errors = selfSetPasswordProblems(next, accountUsername(holder));
    if (errors.length === 0 && next !== confirmation) {
        errors.push('兩次輸入的新密碼不一樣。');
    }
    if (errors.length > 0) {
        return render(c, project, holder, { step: 'new', passwordErrors: errors, status: 422 });
    }
    const oldHash = accountHash(holder);
    const newHash = await hashPassword(next, SELF_SET_PASSWORD_ITERATIONS);
    const at = nowIso(c.get('now'));
    const db = c.env.DB;
    let message: string;
    const stale = () => {
        access.jar.forget(REAUTH_COOKIE);
        return render(c, project, holder, { step: 'current', passwordErrors: ['密碼剛剛已被改過，請重新操作。'], status: 422 });
    };
    if (holder.kind === 'developer') {
        const id = holder.developer.id;
        // Compare-and-swap on the old hash; credentials are revoked only when the swap happened.
        const applied = 'EXISTS (SELECT 1 FROM developers WHERE id = ? AND password_hash = ?)';
        const [updated, tokens] = await db.batch([
            db.prepare('UPDATE developers SET password_hash = ?, password_set_by_self = 1, updated_at = ? WHERE id = ? AND password_hash = ?').bind(newHash, at, id, oldHash),
            db.prepare(`DELETE FROM api_tokens WHERE developer_id = ? AND ${applied}`).bind(id, id, newHash),
            db.prepare(`UPDATE device_codes SET status = 'denied' WHERE developer_id = ? AND status = 'approved' AND ${applied}`).bind(id, id, newHash),
        ]);
        if ((updated.meta.changes ?? 0) === 0) {
            return stale();
        }
        await access.refreshDeveloperLogins((await findDeveloper(db, id)) as Developer);
        const revoked = tokens.meta.changes ?? 0;
        message = `已更新密碼。其他裝置上的網頁登入都已登出${revoked > 0 ? `，${revoked} 個 CLI／MCP 用的 API token 也已撤銷，請重新執行 login` : ''}。`;
    } else {
        const id = holder.client.id;
        const applied = 'EXISTS (SELECT 1 FROM client_accounts WHERE id = ? AND password_hash = ?)';
        const [updated, tokens] = await db.batch([
            db.prepare('UPDATE client_accounts SET password_hash = ?, password_set_by_self = 1, updated_at = ? WHERE id = ? AND password_hash = ?').bind(newHash, at, id, oldHash),
            db.prepare(`DELETE FROM api_tokens WHERE client_account_id = ? AND ${applied}`).bind(id, id, newHash),
            db.prepare(`UPDATE device_codes SET status = 'denied' WHERE client_account_id = ? AND status = 'approved' AND ${applied}`).bind(id, id, newHash),
            // A chosen password is never stored for the login page prefill.
            db
                .prepare(`UPDATE projects SET login_prefill_username = NULL, login_prefill_password = NULL WHERE id = ? AND login_prefill_username = ? AND ${applied}`)
                .bind(project.id, holder.client.username, id, newHash),
        ]);
        if ((updated.meta.changes ?? 0) === 0) {
            return stale();
        }
        await access.grantClientAccount(project, (await findClientAccount(db, id)) as ClientAccount);
        const revoked = tokens.meta.changes ?? 0;
        message = `已更新密碼。其他裝置上用這個帳號的登入都已登出${revoked > 0 ? `，${revoked} 個 CLI／MCP 用的 API token 也已撤銷，請重新執行 login` : ''}。`;
    }
    access.jar.forget(REAUTH_COOKIE);
    access.setFlash({ success: message });
    return c.redirect(paths.account(project.slug), 303);
});
