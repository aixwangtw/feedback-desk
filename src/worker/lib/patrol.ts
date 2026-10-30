import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import { randomString, sha256Hex } from './crypto';
import { findDeveloper } from './db';
import type { Developer } from './models';
import { ServiceError } from './team';

/**
 * Scheduled patrol tokens: a cloud routine acting as one team account that may only read reports,
 * leave messages, write the adjustment note and set needs_input. Only the SHA-256 hash is stored;
 * revoking keeps the row (and its log) with revoked_at set.
 */
export const PATROL_PREFIX = 'fdp_';
const PATROL_RANDOM_LENGTH = 48;
const MAX_PLAIN_LENGTH = 200;

export interface PatrolToken {
    id: number;
    developer_id: number;
    name: string;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: string;
}

export async function issuePatrolToken(env: Env, developer: Developer, name: string, now: number): Promise<{ token: string; id: number; name: string; developer: string; created_at: string }> {
    const plain = `${PATROL_PREFIX}${randomString(PATROL_RANDOM_LENGTH)}`;
    const label = name.trim() === '' ? '排程' : name.trim().slice(0, 100);
    const row = await env.DB.prepare('INSERT INTO patrol_tokens (developer_id, name, token_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id, created_at')
        .bind(developer.id, label, await sha256Hex(plain), nowIso(now))
        .first<{ id: number; created_at: string }>();
    return { token: plain, id: row?.id ?? 0, name: label, developer: developer.username, created_at: row?.created_at ?? nowIso(now) };
}

export async function listPatrolTokens(env: Env) {
    const { results } = await env.DB.prepare(
        'SELECT t.id, t.name, t.last_used_at, t.revoked_at, t.created_at, d.username AS developer FROM patrol_tokens t JOIN developers d ON d.id = t.developer_id ORDER BY t.id',
    ).all<{ id: number; name: string; last_used_at: string | null; revoked_at: string | null; created_at: string; developer: string }>();
    return { tokens: results };
}

export async function revokePatrolToken(env: Env, id: number, now: number) {
    const row = await env.DB.prepare('SELECT id, revoked_at FROM patrol_tokens WHERE id = ?').bind(id).first<{ id: number; revoked_at: string | null }>();
    if (!row) {
        throw new ServiceError('token_not_found', '找不到這個排程 token（用 patrol-token list 查編號）。', 404);
    }
    if (row.revoked_at === null) {
        await env.DB.prepare('UPDATE patrol_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(now), id).run();
    }
    return { revoked: id };
}

/** Active token: hash matches, not revoked, and its team account exists and is not disabled. */
export async function findActivePatrolToken(env: Env, plain: string): Promise<{ token: PatrolToken; developer: Developer } | null> {
    if (!plain.startsWith(PATROL_PREFIX) || plain.length > MAX_PLAIN_LENGTH) {
        return null;
    }
    const token = await env.DB.prepare('SELECT id, developer_id, name, last_used_at, revoked_at, created_at FROM patrol_tokens WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(await sha256Hex(plain))
        .first<PatrolToken>();
    if (!token) {
        return null;
    }
    const developer = await findDeveloper(env.DB, token.developer_id);
    return developer && !developer.disabled_at ? { token, developer } : null;
}
