import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bool, parse, requirePositional, str } from '../args';
import { checkWranglerConfig, deployDir, readState, readWranglerConfig, refreshArtifacts, wranglerTemplate, writeState } from '../deploy-dir';
import { CliError, type Runtime } from '../runtime';
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
        rt.out('下一步：npx feedback-desk deploy');
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
    rt.out('下一步：npx feedback-desk deploy');
    return 0;
}

export async function deploy(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { dir: { type: 'string' }, 'skip-migrations': { type: 'boolean' } });
    const dir = deployDir(rt, str(args, 'dir'));
    const config = readWranglerConfig(dir);
    const problems = checkWranglerConfig(config);
    if (problems.length > 0) {
        throw new CliError(`wrangler.jsonc 有問題：\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    }
    refreshArtifacts(dir);
    await ensureWranglerLogin(rt, dir);

    const secretList = await wrangler(rt, ['secret', 'list', '--format', 'json'], { cwd: dir });
    let hasSecret = false;
    if (secretList.code === 0) {
        try {
            const start = secretList.stdout.indexOf('[');
            hasSecret = (JSON.parse(secretList.stdout.slice(start)) as Array<{ name: string }>).some((secret) => secret.name === 'APP_SECRET');
        } catch {
            hasSecret = false;
        }
    }

    const deployArgs = ['deploy'];
    let secretsDir: string | null = null;
    if (!hasSecret) {
        // The secret goes to Cloudflare once and is never written into the deploy folder.
        secretsDir = mkdtempSync(join(rt.tmp, 'feedback-desk-'));
        const secretsFile = join(secretsDir, 'secrets.json');
        writeFileSync(secretsFile, JSON.stringify({ APP_SECRET: randomBytes(32).toString('base64url') }), { mode: 0o600 });
        deployArgs.push('--secrets-file', secretsFile);
        rt.out('第一次部署：會一併設定 APP_SECRET（Cloudflare 上的加密變數，用來加密登入 cookie 與簽署下載網址）。');
    }
    let result;
    try {
        result = await wrangler(rt, deployArgs, { cwd: dir, stream: true });
    } finally {
        if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
    }
    if (result.code !== 0) {
        throw new CliError('wrangler deploy 失敗，訊息見上方。');
    }
    const urls = deployedUrls(`${result.stdout}\n${result.stderr}`);
    if (!bool(args, 'skip-migrations')) {
        rt.out('套用資料庫 migrations…');
        const migrate = await wrangler(rt, ['d1', 'migrations', 'apply', 'DB', '--remote'], { cwd: dir, stream: true });
        if (migrate.code !== 0) {
            throw new CliError('D1 migrations 套用失敗，訊息見上方。修正後可再執行一次 deploy。');
        }
    }
    const preferred = config.routes?.find((route) => route.custom_domain && route.pattern)?.pattern;
    const url = preferred ? `https://${preferred}` : urls[0];
    writeState(dir, { ...readState(dir), url, worker: config.name, deployed_at: new Date(rt.now()).toISOString() });
    rt.out('');
    rt.out(`部署完成：${url ?? '（沒有從 wrangler 輸出找到網址，請看上方訊息）'}`);
    rt.out('還沒有團隊帳號的話：npx feedback-desk bootstrap <帳號> --name "顯示名稱"');
    return 0;
}

export async function bootstrap(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { dir: { type: 'string' }, name: { type: 'string' }, reset: { type: 'boolean' } });
    const username = requirePositional(args, 0, '<帳號>').trim();
    if (username === '' || [...username].length > 50) {
        throw new CliError('帳號不可為空白，且不可超過 50 字。');
    }
    const dir = deployDir(rt, str(args, 'dir'));
    readWranglerConfig(dir);
    await ensureWranglerLogin(rt, dir);
    const existing = await d1Query<{ id: number; username: string }>(rt, dir, 'SELECT id, username FROM developers ORDER BY id');
    const reset = bool(args, 'reset');
    const password = generatePassword();
    const hash = hashPassword(password);
    const now = new Date(rt.now()).toISOString();
    if (reset) {
        if (!existing.some((row) => row.username === username)) {
            throw new CliError(`找不到團隊帳號 ${username}，--reset 只能重設既有帳號。`);
        }
        await d1Query(rt, dir, `UPDATE developers SET password_hash = ${sqlString(hash)}, updated_at = ${sqlString(now)} WHERE username = ${sqlString(username)}`);
        rt.out(`已重設團隊帳號 ${username} 的密碼（此帳號原本的網頁登入已失效）。`);
    } else {
        if (existing.length > 0) {
            throw new CliError(
                `已經有團隊帳號（${existing.map((row) => row.username).join('、')}）。新增帳號請登入後用 npx feedback-desk developer create；忘記密碼可用 bootstrap ${existing[0].username} --reset。`,
            );
        }
        const name = (str(args, 'name') ?? username).trim() || username;
        await d1Query(
            rt,
            dir,
            `INSERT INTO developers (name, username, password_hash, created_at, updated_at) VALUES (${sqlString(name)}, ${sqlString(username)}, ${sqlString(hash)}, ${sqlString(now)}, ${sqlString(now)})`,
        );
        rt.out(`已建立第一個團隊帳號：${name}（${username}）`);
    }
    rt.out(`帳號：${username}`);
    rt.out(`密碼：${password}`);
    rt.out('密碼只會顯示這一次，請存入密碼管理器。');
    const state = readState(dir);
    rt.out(`下一步：npx feedback-desk login${state.url ? ` --url ${state.url}` : ' --url https://你的站'}`);
    return 0;
}
