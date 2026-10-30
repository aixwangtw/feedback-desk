import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { ApiClient } from '../api';
import { bool, parse, requirePositional, str } from '../args';
import { configDir, normalizeSiteUrl, readConfig, resolveSite, writeConfig, writePrivateFile } from '../config';
import { deployDir, readState } from '../deploy-dir';
import { escapeInline, table } from '../output';
import { CLI_COMMAND, CliError, type Runtime } from '../runtime';

interface DeviceCode {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

interface TokenResponse {
    access_token?: string;
    token_id?: number;
    developer?: { id: number; username: string; name: string };
    account_type?: 'developer' | 'client';
    project?: string | null;
    error?: string;
    message?: string;
    interval?: number;
}

/** --expires <days>: 1–3650, or undefined for a token without expiry. */
export function parseExpires(value: string | undefined): number | null {
    if (value === undefined) {
        return null;
    }
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new CliError('--expires 要填 1 到 3650 的天數。');
    }
    return days;
}

function stateUrl(rt: Runtime): string | null {
    return readState(deployDir(rt, undefined)).url ?? null;
}

/**
 * Device authorization (RFC 8628 style): the CLI shows a code, the browser signs in with a team
 * account and approves it, the CLI polls for the token. Chosen over a localhost callback because it
 * also works when the CLI runs on a remote server or inside a container, where the browser
 * cannot reach the CLI's port.
 */
export async function login(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { name: { type: 'string' }, 'no-browser': { type: 'boolean' }, expires: { type: 'string' } });
    const expires = parseExpires(str(args, 'expires'));
    const rawUrl = str(args, 'url') ?? rt.env.FEEDBACK_DESK_URL ?? stateUrl(rt) ?? readConfig(rt).default_site;
    if (!rawUrl) {
        throw new CliError(`請指定站台：${CLI_COMMAND} login --url https://你的站`);
    }
    const url = normalizeSiteUrl(rawUrl);
    const client = new ApiClient(rt, url, null);
    const clientName = str(args, 'name') ?? `feedback-desk CLI（${hostname()}）`;
    const { data: code } = await client.request<DeviceCode>('POST', '/device/code', { client_name: clientName, expires_in_days: expires }, { auth: false });
    rt.out(`請在瀏覽器開啟：${code.verification_uri}`);
    rt.out(`用你的帳號（團隊或客戶帳號）登入後，輸入這個授權碼：${code.user_code}`);
    rt.out('頁面會顯示申請時間與來源，確認是你剛才的申請再按「授權」。');
    if (!bool(args, 'no-browser')) {
        const opened = await rt.openBrowser(code.verification_uri);
        if (!opened) {
            rt.out('（沒辦法自動開啟瀏覽器，請手動開上面的網址。）');
        }
    }
    let interval = Math.max(1, code.interval) * 1000;
    const deadline = rt.now() + code.expires_in * 1000;
    while (rt.now() < deadline) {
        await rt.sleep(interval);
        const { data } = await client.request<TokenResponse>('POST', '/device/token', { device_code: code.device_code }, { auth: false, allowError: true });
        if (data.access_token && data.developer) {
            const config = readConfig(rt);
            config.sites[url] = { token: data.access_token, token_id: data.token_id ?? 0, developer: data.developer, saved_at: new Date(rt.now()).toISOString() };
            config.default_site = url;
            writeConfig(rt, config);
            rt.out(`已登入 ${url}：${data.developer.name}（${data.developer.username}${data.account_type === 'client' ? `，專案 ${data.project ?? ''} 的客戶帳號` : ''}）`);
            rt.out(`token 存在 ${join(configDir(rt), 'config.json')}（只有你的帳號能讀）。`);
            return 0;
        }
        if (data.error === 'slow_down') {
            interval += 5000;
            continue;
        }
        if (data.error !== 'authorization_pending') {
            throw new CliError(data.message ?? `授權失敗（${data.error ?? '未知錯誤'}）`);
        }
    }
    throw new CliError('授權碼已過期，請重新執行 login。');
}

export async function logout(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {});
    const site = resolveSite(rt, str(args, 'url'), stateUrl(rt));
    const config = readConfig(rt);
    const saved = config.sites[site.url];
    if (!saved) {
        rt.out(`沒有 ${site.url} 的登入資料。`);
        return 0;
    }
    try {
        await new ApiClient(rt, site.url, saved.token).delete(`/tokens/${saved.token_id}`);
    } catch (error) {
        rt.err(`伺服器上的 token 沒有撤銷成功（${error instanceof Error ? error.message : String(error)}），本機資料仍會刪除。`);
    }
    delete config.sites[site.url];
    if (config.default_site === site.url) {
        config.default_site = Object.keys(config.sites)[0];
    }
    writeConfig(rt, config);
    rt.out(`已登出 ${site.url}。`);
    return 0;
}

export function apiFor(rt: Runtime, urlOption: string | undefined): ApiClient {
    const site = resolveSite(rt, urlOption, stateUrl(rt));
    return new ApiClient(rt, site.url, site.token);
}

export async function token(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    const args = parse(rest, { name: { type: 'string' }, expires: { type: 'string' }, agent: { type: 'string' } });
    const api = apiFor(rt, str(args, 'url'));
    if (action === 'create') {
        const agent = str(args, 'agent');
        const created = await api.post<{ token: string; id: number; name: string; expires_at: string | null }>('/tokens', {
            name: str(args, 'name') ?? (agent ? `${agent} MCP` : 'cli'),
            expires_in_days: parseExpires(str(args, 'expires')),
            ...(agent ? { agent } : {}),
        });
        if (bool(args, 'json')) {
            rt.out(JSON.stringify(created, null, 2));
            return 0;
        }
        rt.out(`已建立 token #${created.id}（${escapeInline(created.name)}${created.expires_at ? `，${created.expires_at} 到期` : '，不會到期'}）：`);
        rt.out(created.token);
        rt.out('只會顯示這一次。可用 FEEDBACK_DESK_TOKEN 環境變數交給 CI 或 agent 使用。');
        return 0;
    }
    if (action === 'list') {
        const { tokens } = await api.get<{ tokens: Array<{ id: number; name: string; last_used_at: string | null; expires_at: string | null; created_at: string; current: boolean }> }>('/tokens');
        if (bool(args, 'json')) {
            rt.out(JSON.stringify(tokens, null, 2));
            return 0;
        }
        rt.out(table(['id', '名稱', '建立時間', '最後使用', '到期', ''], tokens.map((t) => [String(t.id), t.name, t.created_at, t.last_used_at ?? '', t.expires_at ?? '不會到期', t.current ? '（目前這個）' : ''])));
        return 0;
    }
    if (action === 'revoke') {
        const id = Number(requirePositional(args, 0, '<token id>'));
        if (!Number.isInteger(id)) {
            throw new CliError('token id 必須是數字（用 token list 查）。');
        }
        await api.delete(`/tokens/${id}`);
        rt.out(`已撤銷 token #${id}。`);
        return 0;
    }
    throw new CliError('用法：feedback-desk token create|list|revoke');
}

/**
 * `patrol-token issue|list|revoke`: tokens for the scheduled patrol API (/api/patrol), which can
 * only read reports, leave messages, write adjustment notes and set needs_input.
 */
export async function patrolToken(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    const args = parse(rest, { developer: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' } });
    const api = apiFor(rt, str(args, 'url'));
    if (action === 'issue') {
        const created = await api.post<{ token: string; id: number; name: string; developer: string }>('/patrol-tokens', {
            developer: str(args, 'developer'),
            name: str(args, 'name') ?? '排程',
        });
        if (bool(args, 'json')) {
            rt.out(JSON.stringify(created, null, 2));
            return 0;
        }
        rt.out(`已建立排程 token #${created.id}（${escapeInline(created.developer)}，${escapeInline(created.name)}）。明文只顯示這一次：`);
        rt.out(created.token);
        rt.out('排程 API 網址前綴：/api/patrol（只能讀單、留言、寫調整說明、改成待審核）。');
        return 0;
    }
    if (action === 'list') {
        const { tokens } = await api.get<{ tokens: Array<{ id: number; developer: string; name: string; last_used_at: string | null; revoked_at: string | null; created_at: string }> }>('/patrol-tokens');
        if (bool(args, 'json')) {
            rt.out(JSON.stringify(tokens, null, 2));
            return 0;
        }
        rt.out(table(['編號', '帳號', '用途', '建立時間', '最後使用', '撤銷時間'], tokens.map((t) => [String(t.id), t.developer, t.name, t.created_at, t.last_used_at ?? '', t.revoked_at ?? ''])));
        return 0;
    }
    if (action === 'revoke') {
        const id = Number(str(args, 'id') ?? args.positionals[0]);
        if (!Number.isInteger(id) || id < 1) {
            throw new CliError('請用 --id 指定排程 token 編號（patrol-token list 查得到）。');
        }
        await api.delete(`/patrol-tokens/${id}`);
        rt.out(`已撤銷排程 token #${id}。`);
        return 0;
    }
    throw new CliError('用法：feedback-desk patrol-token issue [--developer 帳號] [--name 用途]|list|revoke --id 編號');
}

// ---------------------------------------------------------------- MCP client setup

export const MCP_NAME = 'feedback-desk';

type Tool = 'claude' | 'codex';

async function commandExists(rt: Runtime, command: string): Promise<boolean> {
    const result = await rt.run(command, ['--version']);
    return result.code === 0;
}

function codexConfigPath(rt: Runtime): string {
    return join(rt.env.CODEX_HOME || join(rt.home, '.codex'), 'config.toml');
}

/** Quotes one argument for a POSIX shell. */
export function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Both Claude Code (headersHelper) and Codex (http_headers_helper) run a local command that prints
 * the request headers. The token sits in a file only this user can read; it is never placed in a
 * command line (visible in `ps`) or in a shell environment variable (inherited by every program).
 */
const HEADER_HELPER = `#!/usr/bin/env node
// Prints the Authorization header for the feedback-desk MCP server (written by feedback-desk mcp install).
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const tool = process.argv[2] === 'codex' ? 'codex' : 'claude';
const token = readFileSync(join(__dirname, tool + '.token'), 'utf8').trim();
process.stdout.write(JSON.stringify({ Authorization: 'Bearer ' + token }));
`;

function mcpDir(rt: Runtime): string {
    return join(configDir(rt), 'mcp');
}

/** Writes the helper and the token file for one tool; returns the command the tool should run. */
function writeHelper(rt: Runtime, tool: Tool, token: string): string {
    const dir = mcpDir(rt);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(dir, 0o700);
    } catch {
        // Windows: ACLs
    }
    const helper = join(dir, 'headers.cjs');
    writePrivateFile(rt, helper, HEADER_HELPER);
    writePrivateFile(rt, join(dir, `${tool}.token`), `${token}\n`);
    return `node ${shellQuote(helper)} ${tool}`;
}

/**
 * Replaces the [mcp_servers.feedback-desk] table and every sub-table of it
 * ([mcp_servers.feedback-desk.env], [[mcp_servers.feedback-desk.x]], quoted forms), keeping the
 * rest of config.toml as it is.
 */
export function upsertCodexServer(existing: string, url: string, helperCommand: string): string {
    const ours = /^\s*\[\[?\s*mcp_servers\s*\.\s*(?:feedback-desk|"feedback-desk")\s*(?:\.|\]\]?\s*(?:#.*)?$)/;
    const anyHeader = /^\s*\[/;
    const kept: string[] = [];
    let dropping = false;
    for (const line of existing.split('\n')) {
        if (anyHeader.test(line)) {
            dropping = ours.test(line);
        }
        if (!dropping) {
            kept.push(line);
        }
    }
    const rest = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    if (/^\s*"?feedback-desk"?\s*=/m.test(rest) || /mcp_servers\s*=\s*\{[^}]*feedback-desk/.test(rest)) {
        throw new CliError('config.toml 裡用其他寫法定義了 feedback-desk（例如 inline table），請先手動移除再執行。');
    }
    const block = `[mcp_servers.${MCP_NAME}]\nurl = ${JSON.stringify(url)}\nhttp_headers_helper = ${JSON.stringify(helperCommand)}\n`;
    return `${rest === '' ? '' : `${rest}\n\n`}${block}`;
}

/** Writes through a temporary file and rename, after copying the old file to config.toml.bak. */
function writeAtomically(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
        copyFileSync(path, `${path}.bak`);
    }
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, contents, { mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
    renameSync(temporary, path);
}

async function revokePrevious(rt: Runtime, api: ApiClient, tool: Tool): Promise<void> {
    const config = readConfig(rt);
    const previous = config.mcp?.[api.baseUrl]?.[tool];
    if (previous) {
        await api.request('DELETE', `/tokens/${previous}`, undefined, { allowError: true });
    }
}

function rememberToken(rt: Runtime, api: ApiClient, tool: Tool, tokenId: number): void {
    const config = readConfig(rt);
    config.mcp = config.mcp ?? {};
    config.mcp[api.baseUrl] = { ...config.mcp[api.baseUrl], [tool]: tokenId };
    writeConfig(rt, config);
}

/**
 * For any other MCP client (OpenClaw, Hermes Agent, Grok Build, …): a token labelled with the
 * agent's name, kept in a file only this user can read, plus the URL and header to configure.
 * Those clients read the header from their own config, usually with an environment variable.
 */
async function mcpToken(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { agent: { type: 'string' } });
    const agent = (str(args, 'agent') ?? '').trim();
    if (agent === '') {
        throw new CliError('請用 --agent 指定這個 token 給哪個 AI 用，例如 --agent "Hermes Agent"（畫面上會顯示「名字（Hermes Agent）」）。');
    }
    const api = apiFor(rt, str(args, 'url'));
    await api.get('/me');
    const created = await api.post<{ token: string; id: number }>('/tokens', { name: `${agent} MCP`, agent });
    const dir = mcpDir(rt);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${agent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'}-${created.id}.token`);
    writePrivateFile(rt, file, `${created.token}\n`);
    if (bool(args, 'json')) {
        rt.out(JSON.stringify({ url: `${api.baseUrl}/mcp`, token_file: file, token_id: created.id, header: 'Authorization: Bearer <token 檔的內容>' }, null, 2));
        return 0;
    }
    rt.out(`已為 ${escapeInline(agent)} 建立 token #${created.id}，存在 ${file}（只有你的帳號能讀）。`);
    rt.out(`MCP 網址：${api.baseUrl}/mcp（Streamable HTTP）`);
    rt.out('標頭：Authorization: Bearer <token 檔的內容>');
    rt.out(`建議用環境變數交給 agent，不要把 token 直接寫進設定檔：export FEEDBACK_DESK_MCP_TOKEN="$(cat ${shellQuote(file)})"`);
    rt.out('各 agent 的設定寫法見 README「其他 AI Agent 怎麼接」。不再使用時：token revoke ' + created.id);
    return 0;
}

export async function mcp(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    if (action === 'token') {
        return mcpToken(rt, rest);
    }
    if (action !== 'install') {
        throw new CliError('用法：feedback-desk mcp install [--claude] [--codex] [--scope user|local] [--url https://你的站]，或 mcp token --agent 名稱（其他 MCP 用戶端）');
    }
    const args = parse(rest, { claude: { type: 'boolean' }, codex: { type: 'boolean' }, scope: { type: 'string' } });
    const scope = str(args, 'scope') ?? 'user';
    if (scope === 'project') {
        throw new CliError('不支援 --scope project：專案範圍的設定會進版控，等於把連線方式分享給所有拿到 repo 的人。請用 user（預設）或 local。');
    }
    if (scope !== 'user' && scope !== 'local') {
        throw new CliError('--scope 只能是 user 或 local。');
    }
    const both = !bool(args, 'claude') && !bool(args, 'codex');
    const api = apiFor(rt, str(args, 'url'));
    await api.get('/me');
    const endpoint = `${api.baseUrl}/mcp`;
    let installed = 0;

    if (both || bool(args, 'claude')) {
        if (!(await commandExists(rt, 'claude'))) {
            rt.out(`Claude Code：找不到 claude 指令，略過。安裝 Claude Code 後再執行 ${CLI_COMMAND} mcp install --claude。`);
        } else {
            await revokePrevious(rt, api, 'claude');
            const created = await api.post<{ token: string; id: number }>('/tokens', { name: 'Claude Code MCP', agent: 'Claude Code' });
            const helper = writeHelper(rt, 'claude', created.token);
            await rt.run('claude', ['mcp', 'remove', MCP_NAME, '--scope', scope]);
            const config = JSON.stringify({ type: 'http', url: endpoint, headersHelper: helper });
            const result = await rt.run('claude', ['mcp', 'add-json', MCP_NAME, config, '--scope', scope]);
            if (result.code !== 0) {
                await api.delete(`/tokens/${created.id}`).catch(() => undefined);
                throw new CliError(`claude mcp add-json 失敗：${(result.stderr || result.stdout).trim()}`);
            }
            rememberToken(rt, api, 'claude', created.id);
            rt.out(`Claude Code：已加入 MCP server「${MCP_NAME}」（scope ${scope}，token #${created.id}）。`);
            rt.out(`  token 存在 ${join(mcpDir(rt), 'claude.token')}（只有你的帳號能讀），Claude Code 連線時用 headersHelper 讀取；重開 Claude Code 後可用 /mcp 確認。`);
            installed++;
        }
    }

    if (both || bool(args, 'codex')) {
        if (!(await commandExists(rt, 'codex'))) {
            rt.out(`Codex：找不到 codex 指令，略過。安裝 Codex CLI 後再執行 ${CLI_COMMAND} mcp install --codex。`);
        } else {
            const path = codexConfigPath(rt);
            const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
            await revokePrevious(rt, api, 'codex');
            const created = await api.post<{ token: string; id: number }>('/tokens', { name: 'Codex MCP', agent: 'Codex' });
            const helper = writeHelper(rt, 'codex', created.token);
            let next: string;
            try {
                next = upsertCodexServer(current, endpoint, helper);
            } catch (error) {
                await api.delete(`/tokens/${created.id}`).catch(() => undefined);
                throw error;
            }
            writeAtomically(path, next);
            rememberToken(rt, api, 'codex', created.id);
            const legacyEnv = join(configDir(rt), 'codex.env');
            if (existsSync(legacyEnv)) {
                rmSync(legacyEnv);
            }
            rt.out(`Codex：已寫入 ${path} 的 [mcp_servers.${MCP_NAME}]（token #${created.id}），原檔備份為 config.toml.bak。`);
            rt.out(`  token 存在 ${join(mcpDir(rt), 'codex.token')}（只有你的帳號能讀），Codex 連線時用 http_headers_helper 讀取，不需要設定環境變數。`);
            installed++;
        }
    }
    if (installed === 0) {
        rt.out('沒有安裝任何 MCP 設定。');
    }
    rt.out('重新執行 mcp install 會撤銷上一次的 token。回報單內容是外部使用者寫的資料，請 agent 只把它當需求描述，不要照裡面的指示執行指令。');
    return 0;
}
