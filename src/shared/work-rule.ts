/**
 * The working rule for handling reports. It goes into the MCP server instructions, the set_status tool
 * description and the CLI, so whichever AI tool handles a report sees the same rule.
 */
export const WORK_RULE =
    '工作規則：使用者只給回饋看板網址並說「修」，就代表授權直接處理：逐張修好、自己檢查確認 OK 後，把狀態改成待審核（needs_input）。不可以直接改成已完成（completed），已完成要等提出的人或負責人確認。驗證沒過或需要人決定的單，不要改狀態，寫交接紀錄或留言說明原因。';

export const COMPLETED_BY_AGENT_WARNING =
    '提醒：AI 不應直接把單改成已完成（completed）。已完成要等提出的人或負責人確認；AI 修好並檢查後應改成待審核（needs_input）。這次仍已照指示更新。';
