import { CliError, type RunOptions, type RunResult, type Runtime } from './runtime';

export const WRANGLER_PACKAGE = 'wrangler@4';

/**
 * Runs wrangler through npx so the CLI itself stays small. FEEDBACK_DESK_WRANGLER can point to a
 * specific wrangler executable (for example a project-local node_modules/.bin/wrangler).
 */
export function wrangler(rt: Runtime, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const custom = rt.env.FEEDBACK_DESK_WRANGLER;
    if (custom) {
        return rt.run(custom, args, options);
    }
    return rt.run('npx', ['--yes', WRANGLER_PACKAGE, ...args], options);
}

export async function ensureWranglerLogin(rt: Runtime, dir: string): Promise<string> {
    const whoami = await wrangler(rt, ['whoami'], { cwd: dir });
    const text = `${whoami.stdout}\n${whoami.stderr}`;
    if (whoami.code === 0 && !/not authenticated|You are not logged in/i.test(text)) {
        return text;
    }
    rt.out('尚未登入 Cloudflare，接下來會開啟瀏覽器請你核准 wrangler（只需要做一次）。');
    const login = await wrangler(rt, ['login'], { cwd: dir, interactive: true });
    if (login.code !== 0) {
        throw new CliError('wrangler login 沒有完成，請重新執行 npx feedback-desk deploy。');
    }
    return (await wrangler(rt, ['whoami'], { cwd: dir })).stdout;
}

/** Runs a SQL statement on the remote D1 database bound as DB and returns the result rows. */
export async function d1Query<T>(rt: Runtime, dir: string, sql: string): Promise<T[]> {
    const result = await wrangler(rt, ['d1', 'execute', 'DB', '--remote', '--json', '--command', sql], { cwd: dir });
    if (result.code !== 0) {
        throw new CliError(`D1 查詢失敗：${(result.stderr || result.stdout).trim().slice(-800)}`);
    }
    const start = result.stdout.indexOf('[');
    try {
        const parsed = JSON.parse(result.stdout.slice(start)) as Array<{ results?: T[]; success?: boolean }>;
        return parsed.flatMap((entry) => entry.results ?? []);
    } catch {
        throw new CliError(`無法解析 wrangler 輸出：${result.stdout.slice(0, 400)}`);
    }
}

/** SQL string literal. */
export function sqlString(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

/** Extracts the workers.dev / custom domain URL printed by `wrangler deploy`. */
export function deployedUrls(output: string): string[] {
    const urls = new Set<string>();
    for (const match of output.matchAll(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\b/g)) {
        urls.add(match[0]);
    }
    for (const match of output.matchAll(/^\s+([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s+\(custom domain\)/gm)) {
        urls.add(`https://${match[1]}`);
    }
    return [...urls];
}
