import { bool, parse, requirePositional, str } from '../args';
import { encodePath } from '../api';
import { escapeInline, escapeTerminal, table } from '../output';
import { CLI_COMMAND, CliError, type Runtime } from '../runtime';
import { apiFor } from './auth';

interface ProjectSummary {
    slug: string;
    name: string;
    client_name: string | null;
    has_client_link: boolean;
    client_accounts: number;
    public_reporting_enabled: boolean;
    is_home_public_project: boolean;
    portal_url: string;
}

function printJson(rt: Runtime, value: unknown): number {
    rt.out(JSON.stringify(value, null, 2));
    return 0;
}

export async function project(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    const args = parse(rest, {
        slug: { type: 'string' },
        'client-name': { type: 'string' },
        'no-client': { type: 'boolean' },
        prefill: { type: 'boolean' },
    });
    const api = apiFor(rt, str(args, 'url'));
    switch (action) {
        case 'create': {
            const name = requirePositional(args, 0, '<專案名稱>');
            const result = await api.post<{ project: ProjectSummary; client_link: string | null; owner_link: string }>('/projects', {
                name,
                slug: str(args, 'slug'),
                client_name: str(args, 'client-name'),
                no_client: bool(args, 'no-client'),
            });
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已建立回報專案：${escapeInline(result.project.name)}（${result.project.slug}）`);
            if (result.client_link) rt.out(`客戶入口：${result.client_link}`);
            rt.out(`開發團隊入口：${result.owner_link}`);
            rt.out('私密入口只會顯示這一次，請存入密碼管理器。');
            return 0;
        }
        case 'list': {
            const { projects } = await api.get<{ projects: ProjectSummary[] }>('/projects');
            if (bool(args, 'json')) return printJson(rt, projects);
            if (projects.length === 0) {
                rt.out(`還沒有專案：${CLI_COMMAND} project create "專案名稱" --slug my-project`);
                return 0;
            }
            rt.out(
                table(
                    ['slug', '名稱', '客戶入口', '客戶帳號數', '公開回報', '網址'],
                    projects.map((p) => [p.slug, p.name, p.has_client_link ? '有' : '無', String(p.client_accounts ?? 0), p.public_reporting_enabled ? (p.is_home_public_project ? '開（首頁）' : '開') : '關', p.portal_url]),
                    60,
                ),
            );
            return 0;
        }
        case 'client-link': {
            const slug = requirePositional(args, 0, '<slug>');
            const result = await api.post<{ client_link: string }>(`/projects/${encodePath(slug)}/client-link`);
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已建立客戶入口：${slug}`);
            rt.out(result.client_link);
            rt.out('舊的客戶入口與用它登入的長效登入已失效，請安全保存新連結。');
            return 0;
        }
        case 'owner-link': {
            const slug = requirePositional(args, 0, '<slug>');
            const result = await api.post<{ owner_link: string }>(`/projects/${encodePath(slug)}/owner-link`);
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已建立開發團隊入口：${slug}`);
            rt.out(result.owner_link);
            rt.out('舊的開發團隊入口已失效，請安全保存新連結。');
            return 0;
        }
        case 'client-account': {
            const slug = requirePositional(args, 0, '<slug>');
            const username = requirePositional(args, 1, '<帳號>');
            const result = await api.post<{ username: string; password: string; prefill: boolean; prefill_active: boolean; login_url: string }>(`/projects/${encodePath(slug)}/client-account`, {
                username,
                prefill: bool(args, 'prefill'),
            });
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已設定 ${slug} 的客戶帳號（登入頁 ${result.login_url}）`);
            printClientPassword(rt, result);
            rt.out(`（這個指令保留相容用；每位客戶各開一個帳號請改用 ${CLI_COMMAND} client create ${slug} <帳號> --name 名字）`);
            return 0;
        }
        default:
            throw new CliError('用法：feedback-desk project create|list|client-link|owner-link|client-account');
    }
}

interface ClientSummary {
    id: number;
    username: string;
    name: string;
    disabled: boolean;
    password_set_by_self: boolean;
    created_at: string;
}

interface ClientPassword {
    username: string;
    password: string;
    prefill: boolean;
    prefill_active: boolean;
    login_url: string;
}

function printClientPassword(rt: Runtime, result: ClientPassword): void {
    rt.out(`帳號：${escapeInline(result.username)}`);
    rt.out(`密碼：${result.password}`);
    rt.out('密碼只會顯示這一次；這個帳號先前的登入已全部失效。請交給本人，建議他登入後到「我的帳號」改成自己的密碼。');
    if (result.prefill) {
        rt.out(result.prefill_active ? '登入頁會預填這組帳號密碼。' : '已記下預填值，但 FEEDBACK_LOGIN_PREFILL_ENABLED 沒開，登入頁不會預填。');
    }
}

/** Client accounts: one per client person, so each report and message shows who wrote it. */
export async function client(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    const args = parse(rest, { name: { type: 'string' }, prefill: { type: 'boolean' } });
    const usage = '用法：feedback-desk client create|list|reset|disable|enable|delete <slug> [帳號]';
    if (!action) {
        throw new CliError(usage);
    }
    const api = apiFor(rt, str(args, 'url'));
    const slug = requirePositional(args, 0, '<slug>');
    const base = `/projects/${encodePath(slug)}/clients`;
    switch (action) {
        case 'list': {
            const { clients } = await api.get<{ clients: ClientSummary[] }>(base);
            if (bool(args, 'json')) return printJson(rt, clients);
            if (clients.length === 0) {
                rt.out(`這個專案還沒有客戶帳號：${CLI_COMMAND} client create ${slug} <帳號> --name 名字`);
                return 0;
            }
            rt.out(
                table(
                    ['id', '帳號', '顯示名稱', '狀態', '密碼'],
                    clients.map((item) => [String(item.id), escapeTerminal(item.username), escapeTerminal(item.name), item.disabled ? '已停用' : '啟用中', item.password_set_by_self ? '本人設定' : '系統產生']),
                ),
            );
            return 0;
        }
        case 'create': {
            const username = requirePositional(args, 1, '<帳號>');
            const result = await api.post<ClientPassword>(base, { username, name: str(args, 'name'), prefill: bool(args, 'prefill') });
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已在 ${slug} 新增客戶帳號（登入頁 ${result.login_url}）`);
            printClientPassword(rt, result);
            return 0;
        }
        case 'reset': {
            const username = requirePositional(args, 1, '<帳號>');
            const result = await api.post<ClientPassword>(`${base}/${encodePath(username)}/reset`, { prefill: bool(args, 'prefill') });
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(`已重設 ${slug} 的客戶帳號密碼`);
            printClientPassword(rt, result);
            return 0;
        }
        case 'disable':
        case 'enable':
        case 'delete': {
            const username = requirePositional(args, 1, '<帳號>');
            const result =
                action === 'delete' ? await api.delete<unknown>(`${base}/${encodePath(username)}`) : await api.post<unknown>(`${base}/${encodePath(username)}/${action}`);
            if (bool(args, 'json')) return printJson(rt, result);
            rt.out(action === 'delete' ? `已刪除客戶帳號 ${escapeTerminal(username)}；他寫過的單與留言保留。` : action === 'disable' ? `已停用客戶帳號 ${escapeTerminal(username)}，登入立即失效。` : `已重新啟用客戶帳號 ${escapeTerminal(username)}。`);
            return 0;
        }
        default:
            throw new CliError(usage);
    }
}

export async function publicReporting(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { force: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<slug>');
    const mode = requirePositional(args, 1, 'on|off').toLowerCase();
    if (mode !== 'on' && mode !== 'off') {
        throw new CliError('mode 只能是 on 或 off。');
    }
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ public_reporting_enabled: boolean; hint: string | null }>(`/projects/${encodePath(slug)}/public-reporting`, {
        enabled: mode === 'on',
        force: bool(args, 'force'),
    });
    if (bool(args, 'json')) return printJson(rt, result);
    rt.out(mode === 'on' ? `已開啟 ${slug} 的公開回報。` : `已關閉 ${slug} 的公開回報；既有公開單對回報者變成唯讀。`);
    if (result.hint) rt.out(result.hint);
    return 0;
}

export async function developer(rt: Runtime, argv: string[]): Promise<number> {
    const [action, ...rest] = argv;
    const args = parse(rest, { name: { type: 'string' } });
    const api = apiFor(rt, str(args, 'url'));
    if (action === 'list') {
        const { developers } = await api.get<{ developers: Array<{ id: number; username: string; name: string }> }>('/developers');
        if (bool(args, 'json')) return printJson(rt, developers);
        rt.out(
            table(
                ['id', '帳號', '顯示名稱', '狀態', '密碼'],
                developers.map((d) => [
                    String(d.id),
                    d.username,
                    d.name,
                    (d as { disabled?: boolean }).disabled ? '已停用' : '啟用中',
                    (d as { password_set_by_self?: boolean }).password_set_by_self ? '本人設定' : '系統產生',
                ]),
            ),
        );
        return 0;
    }
    if (action === 'disable' || action === 'enable' || action === 'delete') {
        const target = requirePositional(args, 0, '<帳號>');
        const result =
            action === 'delete'
                ? await api.delete<{ deleted: string; tokens_revoked: number }>(`/developers/${encodePath(target)}`)
                : await api.post<{ tokens_revoked: number }>(`/developers/${encodePath(target)}/${action}`);
        if (bool(args, 'json')) return printJson(rt, result);
        const verb = action === 'delete' ? '已刪除' : action === 'disable' ? '已停用' : '已重新啟用';
        rt.out(`${verb}團隊帳號 ${escapeTerminal(target)}。${action === 'enable' ? '' : `撤銷了 ${result.tokens_revoked} 個 API token；網頁登入也立即失效。`}`);
        return 0;
    }
    if (action !== 'create' && action !== 'reset') {
        throw new CliError('用法：feedback-desk developer create|reset|disable|enable|delete|list');
    }
    const username = requirePositional(args, 0, '<帳號>');
    const result =
        action === 'create'
            ? await api.post<{ developer: { username: string; name: string }; password: string }>('/developers', { username, name: str(args, 'name') })
            : await api.post<{ developer: { username: string; name: string }; password: string }>(`/developers/${encodePath(username)}/reset`, { name: str(args, 'name') });
    if (bool(args, 'json')) return printJson(rt, result);
    rt.out(action === 'create' ? '已建立開發團隊帳號' : '已重設開發團隊帳號密碼');
    rt.out(`顯示名稱：${escapeTerminal(result.developer.name)}`);
    rt.out(`帳號：${escapeTerminal(result.developer.username)}`);
    rt.out(`密碼：${result.password}`);
    rt.out(action === 'create' ? '密碼只會顯示這一次，請交給本人存入密碼管理器。' : '密碼只會顯示這一次；此帳號先前的網頁登入與所有 API token（CLI、MCP）都已失效，本人要重新 login。');
    return 0;
}
