export const STATUSES = ['new', 'needs_input', 'completed'] as const;

export type ReportStatus = (typeof STATUSES)[number];

/** 顯示名稱：直接寫出在等誰（資料庫的值 new／needs_input／completed 不變）。 */
export type StatusLabels = Record<ReportStatus, string>;

/** 等工程師的單：客戶開單或又留言，等團隊處理、回覆。 */
export const STATUS_LABEL_NEW = '等工程師';
export const STATUS_LABEL_COMPLETED = '已完成';

/**
 * 狀態顯示名稱的唯一來源。needs_input 跟著站台的客戶稱呼（FEEDBACK_LABEL_CLIENT）：客戶→等客戶、業主→等業主。
 * 網頁、對話面板、鈴鐺、CLI 輸出、MCP／API 的中文標籤都從這裡來（Worker 端用 config(env).statusLabels）。
 */
export function statusLabelsFor(clientLabel: string): StatusLabels {
    return { new: STATUS_LABEL_NEW, needs_input: `等${clientLabel}`, completed: STATUS_LABEL_COMPLETED };
}

/** 改名前的中文名稱，CLI／MCP／API 輸入照樣接受（排程與舊筆記還在用）。 */
export const LEGACY_STATUS_LABELS: Readonly<Record<string, ReportStatus>> = { 待處理: 'new', 待審核: 'needs_input' };

/** 每張單在等誰（清單頁籤、每張單上的標示）：直接對應狀態，不是新的狀態值。 */
export type WaitingSide = 'developer' | 'client' | 'completed';

/** 頁籤／等誰對應的狀態：developer＝new（等工程師）、client＝needs_input（等客戶）、completed＝completed。 */
export const WAITING_STATUS: Record<WaitingSide, ReportStatus> = { developer: 'new', client: 'needs_input', completed: 'completed' };

/** 客戶按「完成」前的確認文字（清單列、看板卡、單頁側欄共用）。 */
export const COMPLETE_CONFIRM = '確定這張單已經完成了嗎？';

/** Tailwind background class of the colour dot shown beside each status. */
const DOT_CLASSES: Record<ReportStatus, string> = {
    new: 'bg-slate-500',
    needs_input: 'bg-amber-500',
    completed: 'bg-emerald-500',
};

export function statusLabel(status: ReportStatus, labels: StatusLabels): string {
    return labels[status];
}

export function statusDotClass(status: ReportStatus): string {
    return DOT_CLASSES[status];
}

export function isStatus(value: unknown): value is ReportStatus {
    return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/**
 * Accepts the stored value (needs_input), the current Chinese name (等客戶) or an old name (待審核), case-insensitive.
 * `labels` null is the CLI, which does not know the site's client label: any「等…」name passes as needs_input
 * (等工程師 as new) and the server checks it exactly.
 */
export function statusFromInput(input: string, labels: StatusLabels | null): ReportStatus | null {
    const normalized = input.trim().toLowerCase();
    for (const status of STATUSES) {
        if (normalized === status || (labels !== null && normalized === labels[status].toLowerCase())) {
            return status;
        }
    }
    if (Object.hasOwn(LEGACY_STATUS_LABELS, normalized)) {
        return LEGACY_STATUS_LABELS[normalized];
    }
    if (labels === null) {
        if (normalized === STATUS_LABEL_NEW) {
            return 'new';
        }
        if (normalized === STATUS_LABEL_COMPLETED) {
            return 'completed';
        }
        if (normalized.length > 1 && normalized.startsWith('等')) {
            return 'needs_input';
        }
    }

    return null;
}

/** For error messages, e.g. "new（等工程師）、needs_input（等客戶）、completed（已完成）". */
export function describedStatusOptions(labels: StatusLabels | null): string {
    const shown = labels ?? { ...statusLabelsFor('客戶稱呼'), needs_input: '等客戶稱呼，例如等客戶' };
    return STATUSES.map((status) => `${status}（${shown[status]}）`).join('、');
}

export const CREATOR_TYPES = ['client', 'developer', 'owner_shared', 'public'] as const;

export type CreatorType = (typeof CREATOR_TYPES)[number];

export const CREATOR_FILTER_PATTERN = /^(client|public|shared|developer:\d+|client:\d+)$/;
