/**
 * Which AI tool did something. Any MCP client or agent can work on reports; its name comes from,
 * in order: the label given when the token was made (`mcp install`, `token create --agent`), the
 * clientInfo.name the MCP client reported when it connected, or the X-Feedback-Desk-Agent header
 * the CLI sends when it runs inside an agent. Names are self-reported, so they are labels, not proof.
 */
export const AGENT_HEADER = 'x-feedback-desk-agent';

const MAX_AGENT_LENGTH = 40;

/** Friendlier names for clientInfo.name values of well-known clients. */
const KNOWN_CLIENTS: Record<string, string> = {
    'claude-code': 'Claude Code',
    claudecode: 'Claude Code',
    claude: 'Claude Code',
    codex: 'Codex',
    'codex-mcp-client': 'Codex',
};

/**
 * Cleans a self-reported tool name for storage and display: letters (any script), digits, spaces
 * and . _ - / + only, at most 40 characters. No brackets, so a name cannot pose as part of the
 * "名字（工具）" label. Empty results are null.
 */
export function normalizeAgent(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const known = KNOWN_CLIENTS[value.trim().toLowerCase().replace(/[\s_]+/g, '-')] ?? KNOWN_CLIENTS[value.trim().toLowerCase().replace(/[\s_-]+/g, '')];
    if (known) {
        return known;
    }
    const cleaned = value
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N} ._\-/+]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned === '') {
        return null;
    }
    return [...cleaned].slice(0, MAX_AGENT_LENGTH).join('');
}

/**
 * "王小明（Codex）" for a client account's AI, or just the name for people on the web.
 * Developer-side actors (the shared owner and personal developer accounts) always show only the
 * name; the agent column is still stored.
 */
export function withAgent(name: string, agent: string | null | undefined, developerSide = false): string {
    return agent && !developerSide ? `${name}（${agent}）` : name;
}

/** Message authors: owner and agent messages from the team, unless a client account wrote them. */
export function isDeveloperSideAuthor(message: { author_type: string; author_client_account_id?: number | null }): boolean {
    return (message.author_client_account_id ?? null) === null && (message.author_type === 'owner' || message.author_type === 'agent');
}

/** Reports created by a developer account or the shared owner (not a client or the public). */
export function isDeveloperSideCreator(creatorType: string): boolean {
    return creatorType !== 'client' && creatorType !== 'public';
}

/**
 * 留言作者在畫面上的名字：開發團隊一律顯示人名——有開發者帳號就用帳號的名字（messages 查詢已換成帳號目前的 name），
 * 共用身分（含 AI 工具代發）顯示 FEEDBACK_SHARED_OWNER_NAME（例如 Alex），不顯示「開發者」、不加 AI 工具名稱。
 * 陌生人寫的公開單維持寫入時的團隊稱呼（不讓回報者知道團隊是誰）。
 */
export function teamMessageName(
    cfg: { labels: { client: string; owner: string }; sharedOwnerName: string },
    report: { creator_type: string },
    message: { author_type: string; author_name: string | null; author_client_account_id?: number | null; author_developer_id?: number | null },
): string {
    if (isDeveloperSideAuthor(message) && report.creator_type !== 'public') {
        return (message.author_developer_id ?? null) !== null && message.author_name ? message.author_name : cfg.sharedOwnerName;
    }
    return message.author_name || (message.author_type === 'owner' ? cfg.labels.owner : message.author_type === 'agent' ? 'Vibe coding' : cfg.labels.client);
}
