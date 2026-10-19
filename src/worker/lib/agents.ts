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

/** "王小明（Codex）", or just the name for people on the web. */
export function withAgent(name: string, agent: string | null | undefined): string {
    return agent ? `${name}（${agent}）` : name;
}
