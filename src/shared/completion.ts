/**
 * 「請客戶確認完成」與「調整重點停用」的共用文字：網頁、CLI、MCP、巡檢 API 都引用這裡，不各寫一份。
 * 開發團隊不能直接把單結案，只能發一則確認留言（附「通過」按鈕），客戶按了才變已完成。
 */
import type { StatusLabels } from './status';

/** 留言上給客戶按的按鈕文字。 */
export const COMPLETION_APPROVE_LABEL = '通過';

/** 確認留言預設文字：網頁上可以改字；CLI、MCP、API 沒給文字時用這個。客戶稱呼用站台設定（labels.client）。 */
export function defaultCompletionBody(clientLabel: string): string {
    return `這張已經處理好了，${clientLabel}確認沒問題請按『${COMPLETION_APPROVE_LABEL}』；還有問題直接在這裡留言`;
}

/** 給開發端的提醒：發出後單仍在等客戶。 */
export function completionSentNotice(statusLabels: StatusLabels, clientLabel: string): string {
    return `已請${clientLabel}確認完成：單維持「${statusLabels.needs_input}」，要等${clientLabel}按「${COMPLETION_APPROVE_LABEL}」才會變成已完成。`;
}

/** 給 CLI、MCP、API 說明文字用。 */
export const COMPLETION_RULE_TEXT = '做完且驗過畫面後用「請客戶確認完成」（request_completion）：只會發一則附「通過」按鈕的確認留言，單維持等客戶，由客戶按「通過」才變成已完成；不可以直接改成已完成。';

/** 網頁上寫調整重點的回應（410）。 */
export const ADJUSTMENT_WEB_DISABLED = '調整重點已停用，網頁不能再編輯；請改用留言說明改了什麼。';

/** 已停用的調整重點：巡檢 API、CLI、MCP 的舊入口照常寫入，但回應附這則警告。 */
export const ADJUSTMENT_DEPRECATED = '調整重點已停用，請改用留言說明改了什麼；這次仍照常寫入，但網頁上只會當成「過去的處理說明」唯讀顯示。';

/** 留言造成單改成等客戶時，給人看的提醒（網頁、指令、MCP、巡檢 API 共用；名稱照站台設定）。 */
export function statusChangeNotice(statusLabels: StatusLabels): string {
    return `狀態已改為「${statusLabels.needs_input}」。`;
}
