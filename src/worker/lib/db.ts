import type { Attachment, ClientAccount, Developer, Message, Project, Report } from './models';

export async function findProjectBySlug(db: D1Database, slug: string): Promise<Project | null> {
    return db.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first<Project>();
}

export async function findDeveloper(db: D1Database, id: number): Promise<Developer | null> {
    return db.prepare('SELECT * FROM developers WHERE id = ?').bind(id).first<Developer>();
}

export async function findDeveloperByUsername(db: D1Database, username: string): Promise<Developer | null> {
    return db.prepare('SELECT * FROM developers WHERE username = ?').bind(username).first<Developer>();
}

export async function listDevelopers(db: D1Database): Promise<Developer[]> {
    const { results } = await db.prepare('SELECT * FROM developers ORDER BY name, id').all<Developer>();
    return results;
}

export async function findClientAccount(db: D1Database, id: number): Promise<ClientAccount | null> {
    return db.prepare('SELECT * FROM client_accounts WHERE id = ?').bind(id).first<ClientAccount>();
}

export async function findClientAccountInProject(db: D1Database, projectId: number, username: string): Promise<ClientAccount | null> {
    return db.prepare('SELECT * FROM client_accounts WHERE project_id = ? AND username = ?').bind(projectId, username).first<ClientAccount>();
}

export async function listClientAccounts(db: D1Database, projectId: number): Promise<ClientAccount[]> {
    const { results } = await db.prepare('SELECT * FROM client_accounts WHERE project_id = ? ORDER BY name, id').bind(projectId).all<ClientAccount>();
    return results;
}

/** True when a team account or any client account already uses this login name (ignoring case). */
export async function usernameTaken(db: D1Database, username: string): Promise<boolean> {
    const row = await db
        .prepare('SELECT (SELECT COUNT(*) FROM developers WHERE lower(username) = lower(?1)) + (SELECT COUNT(*) FROM client_accounts WHERE lower(username) = lower(?1)) AS total')
        .bind(username)
        .first<{ total: number }>();
    return (row?.total ?? 0) > 0;
}

export async function findReportInProject(db: D1Database, projectId: number, publicId: string): Promise<Report | null> {
    return db.prepare('SELECT * FROM reports WHERE project_id = ? AND public_id = ?').bind(projectId, publicId).first<Report>();
}

export async function findReportById(db: D1Database, projectId: number, id: number): Promise<Report | null> {
    return db.prepare('SELECT * FROM reports WHERE project_id = ? AND id = ?').bind(projectId, id).first<Report>();
}

export async function attachmentsForReport(db: D1Database, reportId: number): Promise<Attachment[]> {
    const { results } = await db
        .prepare('SELECT * FROM attachments WHERE report_id = ? ORDER BY id')
        .bind(reportId)
        .all<Attachment>();
    return results;
}

/**
 * Messages with the author's current account name. Public reports keep the stored name, so a
 * team member's own name is never shown to the stranger who wrote the report.
 */
export async function messagesForReport(db: D1Database, reportId: number): Promise<Message[]> {
    const { results } = await db
        .prepare(
            `SELECT m.id, m.report_id, m.author_type, m.author_client_account_id, m.author_developer_id, m.author_agent, m.body, m.created_at, m.updated_at,
                CASE WHEN r.creator_type = 'public' THEN m.author_name ELSE COALESCE(ca.name, d.name, m.author_name) END AS author_name
             FROM messages m
             JOIN reports r ON r.id = m.report_id
             LEFT JOIN client_accounts ca ON ca.id = m.author_client_account_id
             LEFT JOIN developers d ON d.id = m.author_developer_id
             WHERE m.report_id = ? ORDER BY m.created_at, m.id`,
        )
        .bind(reportId)
        .all<Message>();
    return results;
}

/** Builds "?, ?, ?" for an IN clause. */
export function placeholders(count: number): string {
    return Array.from({ length: count }, () => '?').join(', ');
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
export function likeContains(keyword: string): string {
    return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
