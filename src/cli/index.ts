import { adjust, message, report, reports, status } from './commands/reports';
import { developer, project, publicReporting } from './commands/admin';
import { login, logout, mcp, token } from './commands/auth';
import { bootstrap, deploy, init } from './commands/deploy';
import { CLI_COMMAND, CliError, defaultRuntime, type Runtime } from './runtime';

declare const __APP_VERSION__: string | undefined;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const HELP = `feedback-desk ${VERSION}：在 Cloudflare Workers 免費方案架設問題回報系統，並讓 AI agent 處理回報單。

部署（在要放設定檔的資料夾執行）
  init [--name feedback-desk] [--domain feedback.example.com] [--no-cron] [--force]
                                   產生或檢查 wrangler.jsonc
  deploy                           部署 Worker、建立 D1/R2、套用資料庫 migrations
  bootstrap <帳號> [--name 顯示名稱] [--reset]
                                   直接寫入 D1 建立第一個團隊帳號（或 --reset 重設密碼）

登入與 AI 工具
  login [--url https://站台] [--expires 天數]
                                   開瀏覽器用團隊帳號授權，輸入終端機上的授權碼；token 存在使用者設定目錄
  logout                           撤銷並刪除本機 token
  mcp install [--claude] [--codex] [--scope user|local]
                                   把 MCP server 設定寫入 Claude Code、Codex（token 放在只有你能讀的檔案）
  token create [--expires 天數]|list|revoke <id>
                                   管理 API token

專案與帳號
  project create <名稱> [--slug] [--client-name] [--no-client]
  project list
  project client-link <slug>       重發客戶私密入口（舊的失效）
  project owner-link <slug>        重發開發團隊私密入口（舊的失效）
  project client-account <slug> <帳號> [--prefill]
                                   設定客戶帳號，密碼由系統產生
  public-reporting <slug> on|off [--force]
  developer create <帳號> [--name] 建立團隊個人帳號（密碼由系統產生）
  developer reset <帳號>           重設團隊帳號密碼，並撤銷該帳號所有 API token
  developer disable|enable|delete <帳號>
                                   停用（立即登出並撤銷 token）、重新啟用或刪除團隊帳號
  developer list

處理回報單
  reports <project> [--status new] [--creator client] [--include-deleted] [--include-public] [--json]
  report <project> <public_id|編號> [--json] [--no-download] [--download-dir 路徑]
                                   附件預設下載到 ~/.cache/feedback-desk（權限 700）
  adjust <project> <public_id> [--note 文字] [--append] [--image 檔案]... [--by-id]
  status <project> <public_id|編號> <new|needs_input|completed|待處理|待審核|已完成>
  message <project> <public_id|編號> --body 文字 [--image 檔案]...

共用選項：--url https://站台（也可用 FEEDBACK_DESK_URL）、--json、--help
環境變數：FEEDBACK_DESK_TOKEN 直接指定 token（CI、agent 用），只會送到 FEEDBACK_DESK_URL 指定的站。`;

type Command = (rt: Runtime, argv: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
    init,
    deploy,
    bootstrap,
    login,
    logout,
    mcp,
    token,
    project,
    'public-reporting': publicReporting,
    developer,
    reports,
    report,
    adjust,
    status,
    message,
};

export async function main(argv: string[], rt: Runtime = defaultRuntime()): Promise<number> {
    const [name, ...rest] = argv;
    if (!name || name === 'help' || name === '--help' || name === '-h') {
        rt.out(HELP);
        return 0;
    }
    if (name === '--version' || name === '-v' || name === 'version') {
        rt.out(VERSION);
        return 0;
    }
    const command = COMMANDS[name];
    if (!command) {
        rt.err(`不認得的指令「${name}」。執行 ${CLI_COMMAND} help 看全部指令。`);
        return 1;
    }
    if (rest.includes('--help') || rest.includes('-h')) {
        rt.out(HELP);
        return 0;
    }
    try {
        return await command(rt, rest);
    } catch (error) {
        if (error instanceof CliError) {
            rt.err(`錯誤：${error.message}`);
            return error.exitCode;
        }
        throw error;
    }
}
