/**
 * 相簿：這張單所有附件集中成一份清單（客戶原始附件、每則留言的圖片與影片）。
 * 待審留言（草稿）的附件只在 viewerIsOwner 時帶出：客戶端的清單與網址完全不含草稿。
 * 縮圖直接用原檔（頁面 lazy 載入），不另外產生縮圖檔。排序：原始附件在前，再依留言時間，草稿最後。
 */
import { isVideoMime } from '../../shared/attachment-rules';
import { paths } from '../routes/paths';
import type { DraftView } from './drafts';
import type { Attachment, Message } from './models';

export interface AlbumItem {
    kind: 'original' | 'message' | 'draft';
    url: string;
    name: string;
    isVideo: boolean;
    /** 來自哪裡：「原始附件」「王老師 的留言」「待審留言」。 */
    source: string;
    at: string;
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
            items.push({ kind: 'original', url: paths.attachment(slug, publicId, attachment.id), name: attachment.original_name, isVideo: isVideoMime(attachment.mime_type), source: '原始附件', at: input.reportCreatedAt });
        }
    }
    for (const message of input.messages) {
        for (const attachment of input.attachments) {
            if (attachment.message_id === message.id) {
                items.push({ kind: 'message', url: paths.attachment(slug, publicId, attachment.id), name: attachment.original_name, isVideo: isVideoMime(attachment.mime_type), source: `${input.authorLabel(message)} 的留言`, at: message.created_at });
            }
        }
    }
    for (const draft of input.drafts ?? []) {
        draft.files.forEach((file, index) => {
            items.push({ kind: 'draft', url: paths.draftFile(slug, publicId, draft.id, index), name: file.original_name, isVideo: isVideoMime(file.mime_type), source: '待審留言', at: draft.updated_at });
        });
    }
    return items;
}
