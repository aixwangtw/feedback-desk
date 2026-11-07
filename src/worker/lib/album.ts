/**
 * 相簿：這張單所有附件集中成一份清單（客戶原始附件、每則留言的圖片與影片）。
 * 待審留言（草稿）的附件只在 viewerIsOwner 時帶出：客戶端的清單與網址完全不含草稿。
 * 縮圖直接用原檔（頁面 lazy 載入），不另外產生縮圖檔。排序：原始附件在前，再依留言時間，草稿最後。
 */
import { LIST_THUMB_LIMIT, type RowThumb } from '../../shared/album-thumbs';
import { isVideoMime } from '../../shared/attachment-rules';
import { paths } from '../routes/paths';
import type { DraftView } from './drafts';
import type { Attachment, Message, Report } from './models';
import { placeholders } from './db';

export interface AlbumItem {
    kind: 'original' | 'message' | 'draft';
    url: string;
    name: string;
    isVideo: boolean;
    /** 來自哪裡：「原始附件」「王老師 的留言」「待審留言」。 */
    source: string;
    at: string;
    /** 附件實際上傳的時間（列表縮圖「最新的排最前」用）；草稿用最後修改時間。 */
    uploadedAt: string;
    id: number;
}

export function albumItems(input: {
    slug: string;
    publicId: string;
    attachments: Attachment[];
    messages: Message[];
    /** 留言作者顯示名稱（與留言泡泡同一個函式）。 */
    authorLabel: (message: Message) => string;
    reportCreatedAt: string;
    /** 只有團隊拿得到草稿；客戶端傳 null 或不傳。 */
    drafts?: DraftView[] | null;
}): AlbumItem[] {
    const { slug, publicId } = input;
    const items: AlbumItem[] = [];
    for (const attachment of input.attachments) {
        if (attachment.message_id === null && attachment.kind === 'feedback') {
            items.push({ kind: 'original', url: paths.attachment(slug, publicId, attachment.id), name: attachment.original_name, isVideo: isVideoMime(attachment.mime_type), source: '原始附件', at: input.reportCreatedAt, uploadedAt: attachment.created_at || input.reportCreatedAt, id: attachment.id });
        }
    }
    for (const message of input.messages) {
        for (const attachment of input.attachments) {
            if (attachment.message_id === message.id) {
                items.push({ kind: 'message', url: paths.attachment(slug, publicId, attachment.id), name: attachment.original_name, isVideo: isVideoMime(attachment.mime_type), source: `${input.authorLabel(message)} 的留言`, at: message.created_at, uploadedAt: attachment.created_at || message.created_at, id: attachment.id });
            }
        }
    }
    for (const draft of input.drafts ?? []) {
        draft.files.forEach((file, index) => {
            items.push({ kind: 'draft', url: paths.draftFile(slug, publicId, draft.id, index), name: file.original_name, isVideo: isVideoMime(file.mime_type), source: '待審留言', at: draft.updated_at, uploadedAt: draft.updated_at, id: 0 });
        });
    }
    return items;
}

export interface ListThumbs {
    /** 最新的排最前，最多 LIST_THUMB_LIMIT 張。 */
    thumbs: RowThumb[];
    /** 這張單所有附件的數量（不含草稿、不含已收回留言的附件）。 */
    total: number;
}

/**
 * 清單與看板用：一次取多張單的附件。與相簿同一套規則（albumItems）：原始附件加每則未收回留言的附件，
 * 已收回的留言連附件一起不算；列表不含草稿附件。每張單最新上傳的排最前面。
 */
export async function listThumbsForReports(db: D1Database, slug: string, reports: Array<Pick<Report, 'id' | 'public_id' | 'created_at'>>): Promise<Map<number, ListThumbs>> {
    const result = new Map<number, ListThumbs>();
    if (reports.length === 0) {
        return result;
    }
    const ids = reports.map((report) => report.id);
    const [attachments, messages] = await db.batch([
        db.prepare(`SELECT * FROM attachments WHERE report_id IN (${placeholders(ids.length)}) ORDER BY id`).bind(...ids),
        db.prepare(`SELECT id, report_id, created_at FROM messages WHERE deleted_at IS NULL AND report_id IN (${placeholders(ids.length)}) ORDER BY id`).bind(...ids),
    ]);
    const attachmentsByReport = new Map<number, Attachment[]>();
    for (const attachment of attachments.results as Attachment[]) {
        const list = attachmentsByReport.get(attachment.report_id) ?? [];
        list.push(attachment);
        attachmentsByReport.set(attachment.report_id, list);
    }
    const messagesByReport = new Map<number, Message[]>();
    for (const message of messages.results as unknown as Message[]) {
        const list = messagesByReport.get(message.report_id) ?? [];
        list.push(message);
        messagesByReport.set(message.report_id, list);
    }
    for (const report of reports) {
        const items = albumItems({
            slug,
            publicId: report.public_id,
            attachments: attachmentsByReport.get(report.id) ?? [],
            messages: messagesByReport.get(report.id) ?? [],
            authorLabel: () => '',
            reportCreatedAt: report.created_at,
        }).sort((a, b) => (a.uploadedAt === b.uploadedAt ? b.id - a.id : a.uploadedAt < b.uploadedAt ? 1 : -1));
        result.set(report.id, { thumbs: items.slice(0, LIST_THUMB_LIMIT).map((item) => ({ url: item.url, name: item.name, isVideo: item.isVideo })), total: items.length });
    }
    return result;
}
