import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_COMMAND, CliError, type Runtime } from './runtime';

export const ARTIFACT_DIR = '.feedback-desk';
export const COMPATIBILITY_DATE = '2026-10-01';

/** Folder of the installed package (dist/ sits next to migrations/). */
export function packageRoot(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js -> package root; src/cli/*.ts (tests) -> package root
    for (const candidate of [join(here, '..'), join(here, '..', '..')]) {
        if (existsSync(join(candidate, 'migrations')) && existsSync(join(candidate, 'package.json'))) {
            return candidate;
        }
    }
    throw new CliError('找不到套件檔案（migrations）。請重新安裝 feedback-desk。');
}

export function deployDir(rt: Runtime, dirOption: string | undefined): string {
    return resolve(rt.cwd, dirOption ?? '.');
}

/** Copies the Worker bundle, static assets and migrations of this package version into the deploy folder. */
export function refreshArtifacts(dir: string): void {
    const root = packageRoot();
    const worker = join(root, 'dist', 'worker');
    const publicDir = join(root, 'dist', 'public');
    if (!existsSync(join(worker, 'index.js')) || !existsSync(publicDir)) {
        throw new CliError('套件缺少建置檔案（dist/worker、dist/public）。從原始碼執行時請先 npm run build。');
    }
    const target = join(dir, ARTIFACT_DIR);
    for (const sub of ['worker', 'public', 'migrations']) {
        rmSync(join(target, sub), { recursive: true, force: true });
    }
    mkdirSync(target, { recursive: true });
    cpSync(worker, join(target, 'worker'), { recursive: true });
    cpSync(publicDir, join(target, 'public'), { recursive: true });
    cpSync(join(root, 'migrations'), join(target, 'migrations'), { recursive: true });
    writeFileSync(join(target, '.gitignore'), '*\n');
}

/** Removes // and /* *\/ comments and trailing commas outside strings. */
export function stripJsonc(text: string): string {
    let result = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];
        if (inString) {
            result += char;
            if (char === '\\') {
                result += next ?? '';
                i++;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            result += char;
        } else if (char === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            result += '\n';
        } else if (char === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
        } else {
            result += char;
        }
    }
    return result.replace(/,(\s*[}\]])/g, '$1');
}

export interface WranglerConfig {
    name?: string;
    main?: string;
    compatibility_flags?: string[];
    assets?: { directory?: string };
    d1_databases?: Array<{ binding?: string; database_name?: string; database_id?: string; migrations_dir?: string }>;
    r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
    routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
    workers_dev?: boolean;
    vars?: Record<string, string>;
    triggers?: { crons?: string[] };
}

export function readWranglerConfig(dir: string): WranglerConfig {
    const path = join(dir, 'wrangler.jsonc');
    if (!existsSync(path)) {
        throw new CliError(`${dir} 沒有 wrangler.jsonc，請先執行 ${CLI_COMMAND} init。`);
    }
    try {
        return JSON.parse(stripJsonc(readFileSync(path, 'utf8'))) as WranglerConfig;
    } catch (error) {
        throw new CliError(`wrangler.jsonc 格式錯誤：${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Problems that would stop the Worker from running; empty when the config is usable. */
export function checkWranglerConfig(config: WranglerConfig): string[] {
    const problems: string[] = [];
    if (!config.name) problems.push('缺少 name（Worker 名稱）。');
    if (config.main !== `${ARTIFACT_DIR}/worker/index.js`) problems.push(`main 必須是 ${ARTIFACT_DIR}/worker/index.js。`);
    if (!config.compatibility_flags?.includes('nodejs_compat')) problems.push('compatibility_flags 需要 nodejs_compat。');
    if (config.assets?.directory !== `${ARTIFACT_DIR}/public`) problems.push(`assets.directory 必須是 ${ARTIFACT_DIR}/public。`);
    const db = config.d1_databases?.find((item) => item.binding === 'DB');
    if (!db?.database_name) problems.push('缺少 binding 為 DB 的 d1_databases（需要 database_name）。');
    else if (db.migrations_dir !== `${ARTIFACT_DIR}/migrations`) problems.push(`DB 的 migrations_dir 必須是 ${ARTIFACT_DIR}/migrations。`);
    const r2 = config.r2_buckets?.find((item) => item.binding === 'FILES');
    if (!r2?.bucket_name) problems.push('缺少 binding 為 FILES 的 r2_buckets（需要 bucket_name）。');
    return problems;
}

export interface TemplateOptions {
    name: string;
    domain?: string;
    cron: boolean;
}

export function wranglerTemplate(options: TemplateOptions): string {
    const routes = options.domain ? `\n    "routes": [{ "pattern": ${JSON.stringify(options.domain)}, "custom_domain": true }],` : `\n    // 自訂網域：\n    // "routes": [{ "pattern": "feedback.example.com", "custom_domain": true }],`;
    const cron = options.cron
        ? `\n    // 每天清一次沒用到的暫存上傳檔與過期的限流紀錄（免費方案每個帳號可有 5 個 Cron Trigger）。\n    "triggers": { "crons": ["17 3 * * *"] },`
        : `\n    // 沒有 Cron Trigger 時，暫存上傳檔會在之後的上傳請求中順便清除。\n    // "triggers": { "crons": ["17 3 * * *"] },`;
    return `// Feedback Desk 的 Cloudflare Workers 設定（由 ${CLI_COMMAND} init 產生）。
// D1 與 R2 不寫 ID：第一次 deploy 時 wrangler 會依名稱自動建立。
{
    "name": ${JSON.stringify(options.name)},
    "main": "${ARTIFACT_DIR}/worker/index.js",
    "compatibility_date": "${COMPATIBILITY_DATE}",
    "compatibility_flags": ["nodejs_compat"],
    "workers_dev": true,${routes}
    // 套件已預先打包好 Worker；wrangler 直接上傳 .feedback-desk/worker 裡的模組。
    "no_bundle": true,
    "find_additional_modules": true,
    "base_dir": "${ARTIFACT_DIR}/worker",
    "rules": [{ "type": "ESModule", "globs": ["**/*.js"], "fallthrough": false }],
    "assets": { "directory": "${ARTIFACT_DIR}/public", "binding": "ASSETS" },
    "d1_databases": [
        { "binding": "DB", "database_name": ${JSON.stringify(`${options.name}-db`)}, "migrations_dir": "${ARTIFACT_DIR}/migrations" }
    ],
    "r2_buckets": [{ "binding": "FILES", "bucket_name": ${JSON.stringify(`${options.name}-files`)} }],${cron}
    // 介面用語與首頁文案；改完重新執行 ${CLI_COMMAND} deploy。
    "vars": {
        "FEEDBACK_LABEL_CLIENT": "客戶",
        "FEEDBACK_LABEL_OWNER": "開發團隊",
        "FEEDBACK_PORTAL_TITLE": "問題回報追蹤",
        "FEEDBACK_HOME_TITLE": "問題回報",
        "FEEDBACK_HOME_EYEBROW": "Feedback Desk",
        "FEEDBACK_HOME_HEADING": "問題回報",
        "FEEDBACK_UTC_OFFSET": "+08:00",
        "FEEDBACK_TIMEZONE_NAME": "台北時間",
        "FEEDBACK_LOGIN_PREFILL_ENABLED": "false",
        // 首頁公開回報：填專案 slug，並用 ${CLI_COMMAND} public-reporting <slug> on 開啟。
        "FEEDBACK_HOME_PUBLIC_PROJECT": "",
        "FEEDBACK_PUBLIC_INTRO": "",
        "FEEDBACK_PUBLIC_GITHUB_URL": "",
        "FEEDBACK_PUBLIC_BLOG_URL": "",
        "FEEDBACK_PUBLIC_NOTICE": "",
        // Turnstile：兩個都設才啟用；secret 請用 npx wrangler secret put FEEDBACK_TURNSTILE_SECRET_KEY。
        "FEEDBACK_TURNSTILE_SITE_KEY": ""
    }
}
`;
}

export interface DeployState {
    url?: string;
    worker?: string;
    deployed_at?: string;
}

export function readState(dir: string): DeployState {
    const path = join(dir, ARTIFACT_DIR, 'state.json');
    if (!existsSync(path)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as DeployState;
    } catch {
        return {};
    }
}

export function writeState(dir: string, state: DeployState): void {
    mkdirSync(join(dir, ARTIFACT_DIR), { recursive: true });
    writeFileSync(join(dir, ARTIFACT_DIR, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}
