import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { charLength } from '../../shared/text';
import { nowIso } from '../../shared/time';
import { sha256Hex } from '../lib/crypto';
import { findActivePatrolToken, type PatrolToken } from '../lib/patrol';
import { attempt, clientIp } from '../lib/rate-limit';
import * as team from '../lib/team';
import { origin, type AppContext, type AppEnv } from './context';
import { paths } from './paths';

/**
 * REST API for the scheduled patrol (a cloud routine): `Authorization: Bearer fdp_...` from
 * `feedback-desk patrol-token issue`. It acts as the token's team account and can only list
 * projects, list reports that need attention, read a report, leave a message, write the adjustment
 * note and set needs_input. It cannot complete or delete reports. Writes are logged in patrol_logs.
 */
type PatrolEnv = AppEnv & { Variables: AppEnv['Variables'] & { patrolToken: PatrolToken } };
type PatrolContext = Context<PatrolEnv>;

export const patrol = new Hono<PatrolEnv>();

const AGENT = 'Claude Code';
/**
 * A completed report is only listed again when a later client message looks like a new question
 * (a question mark or words such as 「還是」「沒有」「錯」「不行」「怎麼」), not for a plain thank-you.
 */
const QUESTION_MARKERS = ['?', '？', '嗎', '還是', '沒有', '錯', '不行', '不對', '不能', '無法', '怎麼', '為什麼', '問題'];

/** Each report in the attention list is a full read (several D1 queries), so the list is capped. */
export const MAX_ATTENTION_REPORTS = 20;
export const PATROL_TOKEN_PER_MINUTE = 60;
export const PATROL_IP_PER_MINUTE = 120;

function unauthorized(c: PatrolContext) {
    return c.json({ error: 'unauthorized', message: 'token 無效或已撤銷。' }, 401, { 'WWW-Authenticate': 'Bearer realm="feedback-patrol"' });
}

const authenticate: MiddlewareHandler<PatrolEnv> = async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const plain = match?.[1] ?? '';
    const now = c.get('now');
    // Counted before the lookup, so wrong tokens from one address are limited too.
    const retryAfter = await attempt(
        c.env.DB,
        [
            { key: `patrol-token|${await sha256Hex(plain)}`, max: PATROL_TOKEN_PER_MINUTE, period: 60 },
            { key: `patrol-ip|${clientIp(c.req.raw)}`, max: PATROL_IP_PER_MINUTE, period: 60 },
        ],
        now,
    );
    if (retryAfter !== null) {
        return c.json({ error: 'too_many_requests', message: '請求太頻繁，請稍後再試。' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const found = await findActivePatrolToken(c.env, plain);
    if (!found) {
        return unauthorized(c);
    }
    // Record usage at most once a minute to keep D1 writes low.
    if (!found.token.last_used_at || Date.parse(found.token.last_used_at) < now - 60_000) {
        c.executionCtx.waitUntil(
            c.env.DB.prepare('UPDATE patrol_tokens SET last_used_at = ? WHERE id = ?').bind(nowIso(now), found.token.id).run().then(() => undefined, () => undefined),
        );
    }
    c.set('patrolToken', found.token);
    c.set('apiDeveloper', found.developer);
    await next();
};

patrol.use('*', authenticate);

patrol.onError((error, c) => {
    if (error instanceof team.ServiceError) {
        return c.json({ error: error.code, message: error.message }, error.status);
    }
    throw error;
});

function ctx(c: PatrolContext): team.TeamContext {
    return { env: c.env, origin: origin(c as unknown as AppContext), developer: c.get('apiDeveloper'), now: c.get('now'), agent: AGENT };
}

async function body(c: PatrolContext): Promise<Record<string, unknown>> {
    try {
        const parsed = (await c.req.json()) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

patrol.get('/projects', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT slug, name FROM projects ORDER BY id').all<{ slug: string; name: string }>();
    return c.json({ projects: results.map((project) => ({ slug: project.slug, name: project.name, url: `${origin(c as unknown as AppContext)}${paths.portal(project.slug)}` })) });
});

/**
 * Reports that need attention: status new, client messages the team has not read on the web, or a
 * client message newer than both the last adjustment note and the last team message. Each comes
 * with the full report (messages, signed attachment links). Completed reports are skipped unless the
 * client's newer message contains a question marker; a reopened report is no longer completed.
 */
patrol.get('/projects/:slug/attention', async (c) => {
    const team_ = ctx(c);
    const project = await team.projectOrFail(c.env, c.req.param('slug'));
    const { results } = await c.env.DB.prepare(
        `SELECT r.id, r.public_id, r.status, r.adjustment_updated_at, r.owner_last_read_at,
            (SELECT COUNT(*) FROM messages m WHERE m.report_id = r.id AND m.author_type = 'reporter'
                AND (r.owner_last_read_at IS NULL OR m.created_at > r.owner_last_read_at)) AS unread_messages_count,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.report_id = r.id AND m.author_type = 'reporter') AS latest_reporter_message_at,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.report_id = r.id AND m.author_type IN ('owner', 'agent')) AS latest_team_message_at
        FROM reports r WHERE r.project_id = ? AND r.client_deleted_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC`,
    )
        .bind(project.id)
        .all<{ id: number; public_id: string; status: string; adjustment_updated_at: string | null; unread_messages_count: number; latest_reporter_message_at: string | null; latest_team_message_at: string | null }>();

    const flagged: Array<{ publicId: string; reasons: string[] }> = [];
    for (const row of results) {
        const reasons: string[] = [];
        if (row.status === 'new') reasons.push('status_new');
        if (row.unread_messages_count > 0) reasons.push('unread_messages');
        const handledAt = Math.max(row.adjustment_updated_at ? Date.parse(row.adjustment_updated_at) : 0, row.latest_team_message_at ? Date.parse(row.latest_team_message_at) : 0);
        if (row.latest_reporter_message_at && Date.parse(row.latest_reporter_message_at) > handledAt) reasons.push('reporter_message_after_last_reply');
        if (reasons.length > 0 && row.status === 'completed' && !(await hasNewQuestion(c.env.DB, row.id, handledAt))) continue;
        if (reasons.length > 0) flagged.push({ publicId: row.public_id, reasons });
    }

    const reports = [];
    for (const item of flagged.slice(0, MAX_ATTENTION_REPORTS)) {
        reports.push({ attention_reasons: item.reasons, ...(await team.getReport(team_, project.slug, item.publicId, 'public_id')) });
    }
    return c.json({ project: project.slug, total: flagged.length, returned: reports.length, reports });
});

/** Client messages after the last team reply (or the latest one if none) contain a question marker. */
async function hasNewQuestion(db: D1Database, reportId: number, handledAt: number): Promise<boolean> {
    const { results } = await db
        .prepare("SELECT body, created_at FROM messages WHERE report_id = ? AND author_type = 'reporter' ORDER BY created_at DESC, id DESC")
        .bind(reportId)
        .all<{ body: string; created_at: string }>();
    const newer = results.filter((message) => Date.parse(message.created_at) > handledAt);
    const bodies = (newer.length > 0 ? newer : results.slice(0, 1)).map((message) => message.body ?? '');
    return bodies.some((body) => QUESTION_MARKERS.some((marker) => body.includes(marker)));
}

patrol.get('/projects/:slug/reports/:ref', async (c) => c.json(await team.getReport(ctx(c), c.req.param('slug'), c.req.param('ref'))));

/** Runs one write and records it (summary only, never the text) in patrol_logs. */
async function logged(c: PatrolContext, action: string, summary: Record<string, unknown>, run: () => Promise<Record<string, unknown>>) {
    const slug = c.req.param('slug') ?? '';
    const ref = c.req.param('ref') ?? '';
    let result: Record<string, unknown> | null = null;
    let failure: team.ServiceError | null = null;
    try {
        result = await run();
    } catch (error) {
        if (!(error instanceof team.ServiceError)) {
            throw error;
        }
        failure = error;
    }
    const previous = (result?.previous as { status?: string } | undefined)?.status;
    const detail = failure ? { ...summary, error: failure.code } : previous ? { ...summary, previous } : summary;
    await c.env.DB.prepare('INSERT INTO patrol_logs (patrol_token_id, action, project_slug, report_public_id, succeeded, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(c.get('patrolToken').id, action, slug.slice(0, 100), ref.slice(0, 64), failure ? 0 : 1, JSON.stringify(detail), clientIp(c.req.raw), nowIso(c.get('now')))
        .run();
    if (failure) {
        throw failure;
    }
    return c.json(result ?? {});
}

patrol.post('/projects/:slug/reports/:ref/messages', async (c) => {
    const input = await body(c);
    const text = typeof input.body === 'string' ? input.body : '';
    return logged(c, 'message', { body_length: charLength(text) }, () => team.postMessage(ctx(c), c.req.param('slug'), c.req.param('ref'), { body: text }));
});

patrol.put('/projects/:slug/reports/:ref/adjustment', async (c) => {
    const input = await body(c);
    const note = typeof input.note === 'string' ? input.note : '';
    const append = input.append === true;
    return logged(c, 'adjustment', { note_length: charLength(note), append }, async () => {
        if (note.trim() === '') {
            throw new team.ServiceError('note_required', '請提供調整重點（note）。', 422);
        }
        return team.writeAdjustment(ctx(c), c.req.param('slug'), c.req.param('ref'), { note, append });
    });
});

/** Only needs_input: completing a report is left to a person on the web. */
patrol.post('/projects/:slug/reports/:ref/needs-input', async (c) =>
    logged(c, 'needs_input', {}, () => team.setReportStatus(ctx(c), c.req.param('slug'), c.req.param('ref'), 'needs_input')),
);
