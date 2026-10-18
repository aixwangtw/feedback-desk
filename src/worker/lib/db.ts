import type { Attachment, Developer, Message, Project, Report } from './models';

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

export async function messagesForReport(db: D1Database, reportId: number): Promise<Message[]> {
    const { results } = await db
        .prepare('SELECT * FROM messages WHERE report_id = ? ORDER BY created_at, id')
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
