/**
 * The working rule for handling reports. It goes into the MCP server instructions, the set_status tool
 * description and the CLI, so whichever AI tool handles a report sees the same rule.
 */
export const WORK_RULE =
    '工作規則：使用者只給回饋看板網址並說「修」，就代表授權直接處理：逐張修好、自己檢查確認 OK 後，把狀態改成等客戶（needs_input）。不能改成已完成（completed）：已完成只由客戶在網頁上按「完成」，改了會被拒絕。驗證沒過或需要人決定的單，不要改狀態，寫交接紀錄或留言說明原因。';

/** 開發團隊（含 AI、CLI、MCP、團隊 API）改成已完成時的拒絕說明；錯誤碼 completed_by_client_only。 */
export const COMPLETED_BY_CLIENT_ONLY = '已完成只由客戶按完成：請改成 needs_input（等客戶），由客戶在網頁上按「完成」結單。';
