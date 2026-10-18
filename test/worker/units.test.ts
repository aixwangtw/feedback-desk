import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import { formatAbsolute, formatRelative, parseUtcOffset } from '../../src/shared/time';
import { statusFromInput } from '../../src/shared/status';
import { mergeNote } from '../../src/worker/lib/reports';
import { detectImageType, sanitizeFilename } from '../../src/worker/lib/uploads';
import { workerEnv } from './helpers';

describe('time formatting', () => {
    it('shows absolute times in the configured offset', () => {
        expect(formatAbsolute('2026-10-14T02:30:00.000Z', 480)).toBe('2026/10/14 10:30');
        expect(formatAbsolute('2026-10-14T20:30:00.000Z', 480)).toBe('2026/10/15 04:30');
        expect(formatAbsolute('2026-10-14T02:30:00.000Z', parseUtcOffset('-05:30'))).toBe('2026/10/13 21:00');
        expect(parseUtcOffset('+8')).toBe(480);
        expect(parseUtcOffset('garbage')).toBe(480);
    });

    it('matches Carbon zh_TW relative strings and never says "from now"', () => {
        const now = Date.parse('2026-10-14T06:00:00Z');
        const ago = (seconds: number) => formatRelative(new Date(now - seconds * 1000).toISOString(), now);
        expect(ago(0)).toBe('0秒前');
        expect(ago(59)).toBe('59秒前');
        expect(ago(60)).toBe('1分鐘前');
        expect(ago(3 * 3600)).toBe('3小時前');
        expect(ago(86400)).toBe('1天前');
        expect(ago(604800)).toBe('1週前');
        expect(ago(1209600)).toBe('2週前');
        expect(ago(2592000)).toBe('1個月前');
        expect(ago(5184000)).toBe('1個月前');
        expect(ago(31536000)).toBe('1年前');
        expect(formatRelative('2026-10-14T07:00:00Z', now)).toBe('剛剛');
    });
});

describe('small rules', () => {
    it('reads statuses by value or Chinese label', () => {
        expect(statusFromInput(' NEEDS_INPUT ')).toBe('needs_input');
        expect(statusFromInput('已完成')).toBe('completed');
        expect(statusFromInput('in_progress')).toBeNull();
    });

    it('merges adjustment notes like the Laravel action', () => {
        expect(mergeNote('舊', '新', false)).toBe('新');
        expect(mergeNote('舊', '新', true)).toBe('舊\n\n新');
        expect(mergeNote(null, '  ', true)).toBeNull();
        expect(mergeNote('舊', '', true)).toBe('舊');
    });

    it('detects images by magic bytes and cleans file names', () => {
        expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
        expect(detectImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
        expect(sanitizeFilename('..%2F..%2Fetc%2Fpasswd')).toBe('passwd');
        expect(sanitizeFilename('a\u0000b\u001b.png')).toBe('ab.png');
        expect(sanitizeFilename('')).toBe('image');
    });
});

describe('scheduled cleanup', () => {
    it('removes stale uploads, expired rate limits and old device codes', async () => {
        await env.DB.prepare("INSERT INTO projects (name, slug, owner_token_hash, created_at, updated_at) VALUES ('c', 'cron-project', 'x', 'now', 'now')").run();
        const projectId = await env.DB.prepare("SELECT id FROM projects WHERE slug = 'cron-project'").first('id');
        await env.FILES.put('p/cron/old', 'x');
        await env.DB.prepare("INSERT INTO uploads (id, project_id, purpose, object_key, original_name, mime_type, size, created_at) VALUES ('stale-upload-0000000001', ?, 'report', 'p/cron/old', 'a.png', 'image/png', 1, '2000-01-01T00:00:00.000Z')").bind(projectId).run();
        await env.DB.prepare("INSERT INTO rate_limits (key, count, reset_at) VALUES ('old', 1, 1)").run();
        await env.DB.prepare("INSERT INTO device_codes (device_code_hash, user_code, client_name, expires_at, created_at) VALUES ('h', 'ABCD-EFGH', 'x', 1, 'now')").run();
        const ctx = createExecutionContext();
        await worker.scheduled(createScheduledController(), workerEnv);
        await waitOnExecutionContext(ctx);
        expect(await env.DB.prepare("SELECT id FROM uploads WHERE id = 'stale-upload-0000000001'").first()).toBeNull();
        expect(await env.FILES.get('p/cron/old')).toBeNull();
        expect(await env.DB.prepare("SELECT key FROM rate_limits WHERE key = 'old'").first()).toBeNull();
        expect(await env.DB.prepare("SELECT id FROM device_codes WHERE user_code = 'ABCD-EFGH'").first()).toBeNull();
    });
});

describe('worker entry module', () => {
    it('exports only handlers (workerd refuses other named exports)', async () => {
        const entry = await import('../../src/worker/index');
        expect(Object.keys(entry).sort()).toEqual(['app', 'default']);
    });
});
