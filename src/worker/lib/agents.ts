/**
 * AI tools that work on reports. The name comes from the API token (`mcp install` makes one token
 * per tool) or, for the CLI, from the X-Feedback-Desk-Agent header the CLI sets when it runs
 * inside Claude Code or Codex. Only these values are stored, so the label cannot be made up.
 */
export const AGENTS = ['Claude Code', 'Codex'] as const;
export type Agent = (typeof AGENTS)[number];

export const AGENT_HEADER = 'x-feedback-desk-agent';

export function normalizeAgent(value: unknown): Agent | null {
    if (typeof value !== 'string') {
        return null;
    }
    const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (key === 'claudecode' || key === 'claude') {
        return 'Claude Code';
    }
    if (key === 'codex') {
        return 'Codex';
    }
    return null;
}

/** "王小明（Codex）", or just the name for people on the web. */
export function withAgent(name: string, agent: string | null | undefined): string {
    return agent ? `${name}（${agent}）` : name;
}
