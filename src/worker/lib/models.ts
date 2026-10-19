import type { CreatorType, ReportStatus } from '../../shared/status';

export interface Project {
    id: number;
    name: string;
    slug: string;
    client_display_name: string | null;
    owner_token_hash: string;
    client_token_hash: string | null;
    client_username: string | null;
    client_password_hash: string | null;
    login_prefill_username: string | null;
    login_prefill_password: string | null;
    public_reporting_enabled: number;
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
    created_at: string;
    updated_at: string;
}

export interface Report {
    id: number;
    project_id: number;
    public_id: string;
    reporter_token_hash: string;
    reporter_name: string | null;
    creator_type: CreatorType;
    creator_developer_id: number | null;
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
    author_name: string | null;
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
