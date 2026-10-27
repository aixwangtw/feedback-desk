import type { CreatorType, ReportStatus } from '../../shared/status';

export interface Project {
    id: number;
    name: string;
    slug: string;
    client_display_name: string | null;
    owner_token_hash: string;
    client_token_hash: string | null;
    /** Before migration 0005 the one client login of the project; now only used to find that account. */
    client_username: string | null;
    /** Emptied by migration 0005; client passwords live in client_accounts. */
    client_password_hash: string | null;
    login_prefill_username: string | null;
    login_prefill_password: string | null;
    public_reporting_enabled: number;
    /** Move on every change shown in the chat panel list of each side (database triggers, migration 0004). */
    chat_version_owner: number;
    chat_version_client: number;
    created_at: string;
    updated_at: string;
}

export interface Developer {
    id: number;
    name: string;
    username: string;
    password_hash: string;
    /** Disabled accounts cannot sign in; their logins and API tokens stop working. */
    disabled_at: string | null;
    /** 1 when the account holder chose this password; other members cannot reset it. */
    password_set_by_self: number;
    created_at: string;
    updated_at: string;
}

/** One client person of one project (migration 0005). */
export interface ClientAccount {
    id: number;
    project_id: number;
    username: string;
    name: string;
    password_hash: string;
    /** 1 when the holder chose this password; the team cannot reset it. */
    password_set_by_self: number;
    disabled_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Report {
    id: number;
    project_id: number;
    public_id: string;
    reporter_token_hash: string;
    reporter_name: string | null;
    /** 開單分類；沒設定分類的站為 null。 */
    category: string | null;
    creator_type: CreatorType;
    creator_developer_id: number | null;
    /** The client account that created it; null for the client entry link and public reports. */
    creator_client_account_id: number | null;
    /** AI tool that created it (migration 0006). */
    creator_agent: string | null;
    /** Team account working on it now, with the AI tool and start time (migration 0006). */
    claimed_by_developer_id: number | null;
    claimed_agent: string | null;
    claimed_at: string | null;
    title: string;
    description: string;
    adjustment_note: string | null;
    page_url: string | null;
    status: ReportStatus;
    completed_at: string | null;
    client_deleted_at: string | null;
    latest_activity_at: string;
    /** Last time the team opened the report; client messages after it are unread. */
    owner_last_read_at: string | null;
    /** Last time the client (or public reporter) opened the report. */
    client_last_read_at: string | null;
    /** Last real change of the adjustment note or its images. */
    adjustment_updated_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Message {
    id: number;
    report_id: number;
    author_type: 'reporter' | 'owner' | 'agent';
    /** Name stored when written; pages show the account's current name when one is linked. */
    author_name: string | null;
    author_client_account_id: number | null;
    author_developer_id: number | null;
    /** AI tool that wrote it through MCP or the CLI (migration 0006); null for people on the web. */
    author_agent: string | null;
    body: string;
    created_at: string;
    updated_at: string;
}

export interface Attachment {
    id: number;
    report_id: number;
    message_id: number | null;
    kind: 'feedback' | 'adjustment';
    object_key: string;
    original_name: string;
    mime_type: string;
    size: number;
    uploader_client_account_id: number | null;
    uploader_developer_id: number | null;
    created_at: string;
}

export interface Upload {
    id: string;
    project_id: number;
    report_id: number | null;
    purpose: UploadPurpose;
    object_key: string;
    original_name: string;
    mime_type: string;
    size: number;
    created_at: string;
}

export type UploadPurpose = 'report' | 'message' | 'adjustment' | 'public';

export function isPublicReport(report: Pick<Report, 'creator_type'>): boolean {
    return report.creator_type === 'public';
}

export function isCreatedByClient(report: Pick<Report, 'creator_type'>): boolean {
    return report.creator_type === 'client';
}

export function isDeletedByClient(report: Pick<Report, 'client_deleted_at'>): boolean {
    return report.client_deleted_at !== null;
}
