import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError, type Runtime } from './runtime';

export interface SiteCredentials {
    token: string;
    token_id: number;
    developer: { id: number; username: string; name: string };
    saved_at: string;
}

export interface UserConfig {
    default_site?: string;
    sites: Record<string, SiteCredentials>;
    /** Token ids issued by `mcp install`, per site and tool, so a re-install can revoke the old one. */
    mcp?: Record<string, { claude?: number; codex?: number }>;
}

/** ~/.config/feedback-desk (XDG_CONFIG_HOME respected; %APPDATA% on Windows). */
export function configDir(rt: Runtime): string {
    if (rt.env.FEEDBACK_DESK_CONFIG_DIR) {
        return rt.env.FEEDBACK_DESK_CONFIG_DIR;
    }
    if (rt.platform === 'win32' && rt.env.APPDATA) {
        return join(rt.env.APPDATA, 'feedback-desk');
    }
    return join(rt.env.XDG_CONFIG_HOME || join(rt.home, '.config'), 'feedback-desk');
}

export function configPath(rt: Runtime): string {
    return join(configDir(rt), 'config.json');
}

export function readConfig(rt: Runtime): UserConfig {
    const path = configPath(rt);
    if (!existsSync(path)) {
        return { sites: {} };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as UserConfig;
        return { default_site: parsed.default_site, sites: parsed.sites ?? {}, mcp: parsed.mcp };
    } catch {
        throw new CliError(`設定檔 ${path} 無法讀取，請刪除後重新執行 login。`);
    }
}

/** Writes a file readable only by the current user (mode 600 in a 700 directory). */
export function writePrivateFile(rt: Runtime, path: string, contents: string): void {
    const dir = configDir(rt);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(dir, 0o700);
    } catch {
        // Windows: permissions are managed by ACLs.
    }
    writeFileSync(path, contents, { mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    } catch {
        // see above
    }
}

export function writeConfig(rt: Runtime, config: UserConfig): void {
    writePrivateFile(rt, configPath(rt), `${JSON.stringify(config, null, 2)}\n`);
}

export function normalizeSiteUrl(input: string): string {
    let value = input.trim();
    if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new CliError(`網址格式不正確：${input}`);
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new CliError('網址必須是 https://（本機測試可用 http://localhost）。');
    }
    return url.origin;
}

export interface Site {
    url: string;
    token: string | null;
    credentials: SiteCredentials | null;
}

/**
 * Which site to talk to, and which token may be sent there.
 *
 * Site: --url, then FEEDBACK_DESK_URL, then the deploy state in this folder, then the saved default.
 * Token: FEEDBACK_DESK_TOKEN only when FEEDBACK_DESK_URL is set and is this exact site; otherwise the
 * token saved for this exact site. A folder's .feedback-desk/state.json could point anywhere, so when
 * it names a site other than the saved default, no token is sent unless --url confirms it.
 */
export function resolveSite(rt: Runtime, explicitUrl: string | undefined, stateUrl: string | null): Site {
    const config = readConfig(rt);
    const envUrl = rt.env.FEEDBACK_DESK_URL ? normalizeSiteUrl(rt.env.FEEDBACK_DESK_URL) : null;
    let source: 'flag' | 'env' | 'state' | 'default';
    let raw: string | undefined;
    if (explicitUrl) {
        [source, raw] = ['flag', explicitUrl];
    } else if (envUrl) {
        [source, raw] = ['env', envUrl];
    } else if (stateUrl) {
        [source, raw] = ['state', stateUrl];
    } else {
        [source, raw] = ['default', config.default_site];
    }
    if (!raw) {
        throw new CliError('不知道要連哪個站：請加 --url https://你的站，或先執行 login。');
    }
    const url = normalizeSiteUrl(raw);
    const credentials = config.sites[url] ?? null;
    if (source === 'state' && config.default_site && url !== config.default_site) {
        rt.err(`警告：這個資料夾的 .feedback-desk/state.json 指向 ${url}，和目前預設登入的 ${config.default_site} 不同。這次不帶 token；確定要操作這個站請加 --url ${url}。`);
        return { url, token: null, credentials: null };
    }
    const envToken = rt.env.FEEDBACK_DESK_TOKEN && envUrl === url ? rt.env.FEEDBACK_DESK_TOKEN : null;
    if (rt.env.FEEDBACK_DESK_TOKEN && !envToken) {
        rt.err('提醒：FEEDBACK_DESK_TOKEN 只會送到 FEEDBACK_DESK_URL 指定的站；這次沒有使用它。');
    }
    return { url, token: envToken ?? credentials?.token ?? null, credentials };
}
