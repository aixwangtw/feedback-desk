import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bool, parse, requirePositional, str, type Parsed } from '../args';
import { selfSetPasswordProblems, SELF_SET_PASSWORD_ITERATIONS } from '../../shared/password';
import { checkWranglerConfig, deployDir, readState, readWranglerConfig, refreshArtifacts, wranglerTemplate, writeState } from '../deploy-dir';
import { CLI_COMMAND, CliError, type Runtime } from '../runtime';
import { d1Query, deployedUrls, ensureWranglerLogin, sqlString, wrangler } from '../wrangler';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const GENERATED_PASSWORD_LENGTH = 24;
export const PASSWORD_ITERATIONS = 10_000;

export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
    let password = '';
    for (let i = 0; i < length; i++) {
        password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    return password;
}

/** Same format the Worker verifies: pbkdf2_sha256$<iterations>$<salt>$<hash>. */
export function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): string {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    return `pbkdf2_sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * present: the Worker has APP_SECRET. missing: the Worker exists without it. no-worker: first
 * deploy. Any other failure stops the deploy rather than guessing.
 */
export async function secretState(rt: Runtime, dir: string): Promise<'present' | 'missing' | 'no-worker'> {
    const list = await wrangler(rt, ['secret', 'list', '--format', 'json'], { cwd: dir });
    const output = `${list.stdout}\n${list.stderr}`;
    if (list.code === 0) {
        try {
            const start = list.stdout.indexOf('[');
            const names = (JSON.parse(list.stdout.slice(start)) as Array<{ name: string }>).map((item) => item.name);
            return names.includes('APP_SECRET') ? 'present' : 'missing';
        } catch {
            throw new CliError(`無法解析 wrangler secret list 的輸出：${list.stdout.slice(0, 300)}`);
        }
    }
    if (/Worker "[^"]*" not found|This Worker does not exist|code: 10007/i.test(output)) {
        return 'no-worker';
    }
    throw new CliError(`查詢 Worker 的 secret 失敗，為了不覆蓋既有的 APP_SECRET 先停止部署：${output.trim().slice(-600)}`);
}

const WORKER_NAME = /^[a-z0-9][a-z0-9-]{0,52}[a-z0-9]$/;

export async function init(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { dir: { type: 'string' }, name: { type: 'string' }, domain: { type: 'string' }, 'no-cron': { type: 'boolean' }, force: { type: 'boolean' } });
    const dir = deployDir(rt, str(args, 'dir'));
    const configPath = join(dir, 'wrangler.jsonc');
    if (existsSync(configPath) && !bool(args, 'force')) {
        const problems = checkWranglerConfig(readWranglerConfig(dir));
        refreshArtifacts(dir);
        if (problems.length > 0) {
            rt.err(`wrangler.jsonc 有問題：\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n修正後再 deploy，或加 --force 重新產生。`);
            return 1;
        }
        rt.out(`已檢查 ${configPath}：設定可用，建置檔已更新到 .feedback-desk/。`);
        rt.out(`下一步：${CLI_COMMAND} deploy`);
        return 0;
    }
    const name = str(args, 'name') ?? 'feedback-desk';
    if (!WORKER_NAME.test(name)) {
        throw new CliError('--name 只能用小寫英文、數字與連字號，2 到 54 字，開頭結尾不可是連字號。');
    }
    const domain = str(args, 'domain');
    if (domain !== undefined && !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) {
        throw new CliError('--domain 請填網域本身，例如 feedback.example.com（不含 https://）。');
    }
    writeFileSync(configPath, wranglerTemplate({ name, domain, cron: !bool(args, 'no-cron') }));
    refreshArtifacts(dir);
    rt.out(`已產生 ${configPath}`);
    rt.out(`  Worker：${name}　D1：${name}-db　R2：${name}-files${domain ? `　網域：${domain}` : ''}`);
    rt.out('  介面用語、首頁文案在 wrangler.jsonc 的 vars 裡改。');
    rt.out(`下一步：${CLI_COMMAND} deploy`);
    return 0;
}

export async function deploy(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { dir: { type: 'string' }, 'skip-migrations': { type: 'boolean' }, 'new-secret': { type: 'boolean' } });
    const dir = deployDir(rt, str(args, 'dir'));
    const config = readWranglerConfig(dir);
    const problems = checkWranglerConfig(config);
    if (problems.length > 0) {
        throw new CliError(`wrangler.jsonc 有問題：\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    }
    refreshArtifacts(dir);
    await ensureWranglerLogin(rt, dir);

    const secret = await secretState(rt, dir);
    if (secret === 'missing' && !bool(args, 'new-secret')) {
        throw new CliError(
            'Worker 已存在但沒有 APP_SECRET（網站目前會回 500）。確定要產生新的請加 --new-secret；所有人的登入會失效，已發出的下載網址也會失效。',
        );
    }

    const deployArgs = ['deploy'];
    let secretsDir: string | null = null;
    const cleanup = () => {
        if (secretsDir) {
            rmSync(secretsDir, { recursive: true, force: true });
            secretsDir = null;
        }
    };
    const onInterrupt = () => {
        cleanup();
        process.exit(130);
    };
    if (secret !== 'present') {
        // The secret goes to Cloudflare once and is never kept in the deploy folder.
        secretsDir = mkdtempSync(join(rt.tmp, 'feedback-desk-'));
        const secretsFile = join(secretsDir, 'secrets.json');
        writeFileSync(secretsFile, JSON.stringify({ APP_SECRET: randomBytes(32).toString('base64url') }), { mode: 0o600 });
        deployArgs.push('--secrets-file', secretsFile);
        process.once('SIGINT', onInterrupt);
        process.once('SIGTERM', onInterrupt);
        rt.out(secret === 'no-worker' ? '第一次部署：會一併設定 APP_SECRET（Cloudflare 上的加密變數，用來加密登入 cookie 與簽署下載網址）。' : '依 --new-secret 產生新的 APP_SECRET。');
    }
    const migrate = async () => {
        rt.out('套用資料庫 migrations…');
        const applied = await wrangler(rt, ['d1', 'migrations', 'apply', 'DB', '--remote'], { cwd: dir, stream: true });
        if (applied.code !== 0) {
            throw new CliError('D1 migrations 套用失敗，訊息見上方。修正後可再執行一次 deploy。');
        }
    };
    // An existing site gets the new database structure first: the old Worker keeps working on it
    // (new tables and columns only), while new code on the old structure would fail every request.
    // A first deploy creates the database during `wrangler deploy`, so migrations come after it.
    const migrateFirst = secret !== 'no-worker' && !bool(args, 'skip-migrations');
    if (migrateFirst) {
        try {
            await migrate();
        } catch (error) {
            cleanup();
            throw error;
        }
    }
    let result;
    try {
        result = await wrangler(rt, deployArgs, { cwd: dir, stream: true });
    } finally {
        cleanup();
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onInterrupt);
    }
    if (result.code !== 0) {
        throw new CliError('wrangler deploy 失敗，訊息見上方。');
    }
    const urls = deployedUrls(`${result.stdout}\n${result.stderr}`);
    if (!migrateFirst && !bool(args, 'skip-migrations')) {
        await migrate();
    }
    const preferred = config.routes?.find((route) => route.custom_domain && route.pattern)?.pattern;
    const url = preferred ? `https://${preferred}` : urls[0];
    writeState(dir, { ...readState(dir), url, worker: config.name, deployed_at: new Date(rt.now()).toISOString() });
    rt.out('');
    rt.out(`部署完成：${url ?? '（沒有從 wrangler 輸出找到網址，請看上方訊息）'}`);
    rt.out(`還沒有團隊帳號的話：${CLI_COMMAND} bootstrap <帳號> --name "顯示名稱"`);
    return 0;
}

/** Reads a password the deployer chose: piped (--password-stdin) or typed twice without echo (--set-password). */
async function chosenPassword(rt: Runtime, args: Parsed, username: string): Promise<string | null> {
    const fromStdin = bool(args, 'password-stdin');
    const interactive = bool(args, 'set-password');
    if (fromStdin && interactive) {
        throw new CliError('--password-stdin 與 --set-password 只能選一個。');
    }
    let password: string | null = null;
    if (fromStdin) {
        password = (await rt.readStdin()).replace(/\r?\n$/, '');
    } else if (interactive) {
        rt.out('請輸入密碼（畫面不會顯示）。建議用密碼管理器產生一組再貼上。');
        const first = await rt.promptSecret('密碼：');
        if (first === null) {
            throw new CliError('目前不是互動終端機，無法輸入密碼；請改用 --password-stdin，或不加參數讓系統產生密碼。');
        }
        const second = await rt.promptSecret('再輸入一次：');
        if (first !== second) {
            throw new CliError('兩次輸入的密碼不一樣。');
        }
        password = first;
    }
    if (password === null) {
        return null;
    }
    const problems = selfSetPasswordProblems(password, username);
    if (problems.length > 0) {
        throw new CliError(problems.join(''));
    }
    return password;
}

/** SQL that ends every API credential of a team account (tokens, approved but unclaimed CLI logins). */
function revokeDeveloperSql(id: number): string[] {
    return [`DELETE FROM api_tokens WHERE developer_id = ${id}`, `UPDATE device_codes SET status = 'denied' WHERE developer_id = ${id} AND status = 'approved'`];
}

export async function bootstrap(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {
        dir: { type: 'string' },
        name: { type: 'string' },
        reset: { type: 'boolean' },
        'password-stdin': { type: 'boolean' },
        'set-password': { type: 'boolean' },
    });
    const username = requirePositional(args, 0, '<帳號>').trim();
    if (username === '' || [...username].length > 50) {
        throw new CliError('帳號不可為空白，且不可超過 50 字。');
    }
    const reset = bool(args, 'reset');
    if (reset && (bool(args, 'password-stdin') || bool(args, 'set-password'))) {
        throw new CliError('--reset 是忘記密碼時用的，一律產生新密碼；登入後可在網頁「我的帳號」改成自己的密碼。');
    }
    const dir = deployDir(rt, str(args, 'dir'));
    readWranglerConfig(dir);
    const chosen = reset ? null : await chosenPassword(rt, args, username);
    await ensureWranglerLogin(rt, dir);
    if (reset) {
        return recoverAccount(rt, dir, username, undefined, 'developer');
    }
    const existing = await d1Query<{ id: number; username: string }>(rt, dir, 'SELECT id, username FROM developers ORDER BY id');
    if (existing.length > 0) {
        throw new CliError(
            `已經有團隊帳號（${existing.map((row) => row.username).join('、')}）。新增帳號請登入後用 ${CLI_COMMAND} developer create；忘記密碼請用 ${CLI_COMMAND} account recover ${existing[0].username}。`,
        );
    }
    const password = chosen ?? generatePassword();
    const hash = hashPassword(password, chosen ? SELF_SET_PASSWORD_ITERATIONS : PASSWORD_ITERATIONS);
    const now = new Date(rt.now()).toISOString();
    const name = (str(args, 'name') ?? username).trim() || username;
    await d1Query(
        rt,
        dir,
        `INSERT INTO developers (name, username, password_hash, password_set_by_self, created_at, updated_at) VALUES (${sqlString(name)}, ${sqlString(username)}, ${sqlString(hash)}, ${chosen ? 1 : 0}, ${sqlString(now)}, ${sqlString(now)})`,
    );
    rt.out(`已建立第一個團隊帳號：${name}（${username}）`);
    rt.out(`帳號：${username}`);
    if (chosen) {
        rt.out('密碼：使用你剛才輸入的密碼（其他成員不能重設它；忘記時用 account recover 救回）。');
    } else {
        rt.out(`密碼：${password}`);
        rt.out('密碼只會顯示這一次，請存入密碼管理器。登入後可在網頁「我的帳號」改成自己的密碼。');
    }
    const state = readState(dir);
    rt.out(`下一步：${CLI_COMMAND} login${state.url ? ` --url ${state.url}` : ' --url https://你的站'}`);
    return 0;
}

/**
 * Forgotten password: writes a generated password straight into D1 with the deployer's own
 * Cloudflare login (wrangler), not through the Worker. Works for any team or client account,
 * including passwords the holder chose; the account goes back to a generated password and every
 * login and token of it ends.
 */
async function recoverAccount(rt: Runtime, dir: string, username: string, projectSlug: string | undefined, only?: 'developer'): Promise<number> {
    const developers = projectSlug ? [] : await d1Query<{ id: number; username: string; name: string }>(rt, dir, `SELECT id, username, name FROM developers WHERE username = ${sqlString(username)}`);
    const clients =
        only === 'developer'
            ? []
            : await d1Query<{ id: number; username: string; name: string; project_id: number; slug: string }>(
                  rt,
                  dir,
                  `SELECT ca.id, ca.username, ca.name, ca.project_id, p.slug FROM client_accounts ca JOIN projects p ON p.id = ca.project_id WHERE ca.username = ${sqlString(username)}${
                      projectSlug ? ` AND p.slug = ${sqlString(projectSlug)}` : ''
                  }`,
              );
    const total = developers.length + clients.length;
    if (total === 0) {
        throw new CliError(`找不到帳號 ${username}${projectSlug ? `（專案 ${projectSlug}）` : ''}。`);
    }
    if (total > 1) {
        throw new CliError(`有不只一個帳號叫 ${username}（${clients.map((row) => `專案 ${row.slug} 的客戶帳號`).join('、')}${developers.length > 0 ? '、團隊帳號' : ''}），請加 --project <slug> 指定客戶帳號。`);
    }
    const password = generatePassword();
    const hash = hashPassword(password);
    const now = new Date(rt.now()).toISOString();
    if (developers.length === 1) {
        const id = developers[0].id;
        await d1Query(
            rt,
            dir,
            // Revoke first: if the statements stop halfway, the old credentials are already gone.
            [...revokeDeveloperSql(id), `UPDATE developers SET password_hash = ${sqlString(hash)}, password_set_by_self = 0, updated_at = ${sqlString(now)} WHERE id = ${id}`].join('; '),
        );
        rt.out(`已救回團隊帳號 ${developers[0].name}（${username}）：網頁登入、CLI／MCP 的 API token 全部失效。`);
    } else {
        const target = clients[0];
        await d1Query(
            rt,
            dir,
            [
                ...clientRevokeSql(target.id),
                `UPDATE projects SET login_prefill_username = NULL, login_prefill_password = NULL WHERE id = ${target.project_id} AND login_prefill_username = ${sqlString(username)}`,
                `UPDATE client_accounts SET password_hash = ${sqlString(hash)}, password_set_by_self = 0, updated_at = ${sqlString(now)} WHERE id = ${target.id}`,
            ].join('; '),
        );
        rt.out(`已救回專案 ${target.slug} 的客戶帳號 ${target.name}（${username}）：這個帳號的登入全部失效。`);
    }
    rt.out(`帳號：${username}`);
    rt.out(`密碼：${password}`);
    rt.out('密碼只會顯示這一次。請交給本人，登入後到網頁「我的帳號」改成自己的密碼。');
    return 0;
}

/** SQL that ends every API credential of a client account. */
function clientRevokeSql(id: number): string[] {
    return [`DELETE FROM api_tokens WHERE client_account_id = ${id}`, `UPDATE device_codes SET status = 'denied' WHERE client_account_id = ${id} AND status = 'approved'`];
}

/** `account recover <帳號> [--project slug]`: see recoverAccount. */
export async function accountCommand(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    if (action !== 'recover') {
        throw new CliError('用法：feedback-desk account recover <帳號> [--project slug]');
    }
    const args = parse(rest, { dir: { type: 'string' }, project: { type: 'string' } });
    const username = requirePositional(args, 0, '<帳號>').trim();
    const dir = deployDir(rt, str(args, 'dir'));
    readWranglerConfig(dir);
    await ensureWranglerLogin(rt, dir);
    return recoverAccount(rt, dir, username, str(args, 'project'));
}
