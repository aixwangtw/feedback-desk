export const STATUSES = ['new', 'needs_input', 'completed'] as const;

export type ReportStatus = (typeof STATUSES)[number];

const LABELS: Record<ReportStatus, string> = {
    new: '待處理',
    needs_input: '待審核',
    completed: '已完成',
};

/** Tailwind background class of the colour dot shown beside each status. */
const DOT_CLASSES: Record<ReportStatus, string> = {
    new: 'bg-slate-500',
    needs_input: 'bg-amber-500',
    completed: 'bg-emerald-500',
};

export function statusLabel(status: ReportStatus): string {
    return LABELS[status];
}

export function statusDotClass(status: ReportStatus): string {
    return DOT_CLASSES[status];
}

export function isStatus(value: unknown): value is ReportStatus {
    return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Accepts the stored value (needs_input) or the Chinese label (待審核), case-insensitive. */
export function statusFromInput(input: string): ReportStatus | null {
    const normalized = input.trim().toLowerCase();
    for (const status of STATUSES) {
        if (normalized === status || normalized === LABELS[status].toLowerCase()) {
            return status;
        }
    }

    return null;
}

/** For error messages, e.g. "new（待處理）、needs_input（待審核）、completed（已完成）". */
export function describedStatusOptions(): string {
    return STATUSES.map((status) => `${status}（${LABELS[status]}）`).join('、');
}

export const CREATOR_TYPES = ['client', 'developer', 'owner_shared', 'public'] as const;

export type CreatorType = (typeof CREATOR_TYPES)[number];

export const CREATOR_FILTER_PATTERN = /^(client|public|shared|developer:\d+|client:\d+)$/;
