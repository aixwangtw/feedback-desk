# Feedback Desk

A lightweight issue-reporting desk for talking to clients and teammates about problems in your system. Each project gets a private link (or a username/password) for the people reporting issues, and a separate management view for your team. Reporters file issues with screenshots, both sides discuss them in a thread, and the team records an "adjustment note" when a fix is ready. Built with Laravel 13, Blade, Tailwind 4 and Vite. Default UI language is Traditional Chinese; every role label is configurable. MIT licensed.

---

跟客戶、團隊夥伴溝通系統問題的回報工具。每個專案有自己的私密入口：客戶（或同事）用連結或帳密進來新增問題、附截圖、留言；開發團隊在另一個管理畫面調整狀態、寫調整說明，客戶確認後結案。

以下為虛構的「晴天咖啡 線上訂位系統」示範資料。

客戶開單：可一次新增多個問題並附截圖。

![客戶開單](docs/screenshots/client-new-issue.jpg)

客戶端問題詳情：看調整說明，並在處理紀錄留言。

![客戶端問題詳情](docs/screenshots/client-detail.jpg)

客戶端問題清單。

![客戶端問題清單](docs/screenshots/client-list.jpg)

開發團隊看板：拖曳卡片即可更新狀態。

![開發團隊看板](docs/screenshots/team-kanban.jpg)

開發團隊問題清單：可看到所有人建立的問題。

![開發團隊問題清單](docs/screenshots/team-list.jpg)

開發團隊問題詳情：調整說明只有開發團隊能編輯。

![開發團隊問題詳情](docs/screenshots/team-detail.jpg)

手機版問題清單與詳情。

![手機版清單](docs/screenshots/mobile-list.jpg) ![手機版詳情](docs/screenshots/mobile-detail.jpg)

## 功能

- 多專案：每個專案內容、截圖彼此隔離，各自有獨立入口。
- 問題清單：新增問題（標題、說明、頁面網址、多張截圖）、搜尋、依狀態與建立者篩選、欄位排序、列表／看板兩種檢視。
- 三種狀態：待處理、待審核（開發團隊已改好並寫了調整說明）、已完成（客戶確認）。
- 留言串與附圖；開發團隊可寫「調整說明」並附調整圖片。
- 客戶刪除的問題只是隱藏，開發團隊仍看得到並可還原。
- 登入失敗次數限制、私密連結可隨時重發使整批舊登入失效。
- 稱呼與首頁文案可用 `.env` 改成自己的用語。
- 實驗功能：自動處理（codex CLI），見下方。

## 三種身分與存取方式

| 身分 | 能做什麼 | 怎麼進來 |
| --- | --- | --- |
| client（客戶） | 在專案內新增、編輯、刪除自己的問題，留言，確認完成。看不到開發團隊建立的問題。 | 專屬連結 `/p/{slug}/access?token=...`，或該專案的客戶帳號密碼（`/p/{slug}/login`） |
| owner（開發團隊） | 看到專案全部問題，改狀態、寫調整說明、還原被刪除的問題、也能自己建立問題。 | 專屬連結 `/owner/{slug}/access?token=...`、`.env` 設定的共用帳密、或個人帳號（`feedback:developer` 建立）；登入頁 `/owner/{slug}/login` |
| reporter | 只能檢視、留言該一張問題。 | 該問題網址加上 `?access=` 私密 token（建立問題時產生） |

私密連結只在建立時顯示一次，請存入密碼管理器；用 `feedback:client-link`、`feedback:owner-link` 重發後，舊連結與用它登入的長效登入都會失效。

## 安裝

也可以把這個 repo 的網址交給 Claude Code、Codex 這類 AI agent，請它照本 README 安裝。

需求：PHP 8.3 以上、Composer、Node.js、SQLite（或其他 Laravel 支援的資料庫）。

```bash
git clone https://github.com/aixwangtw/feedback-desk.git
cd feedback-desk
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite      # 使用預設 SQLite 時
php artisan migrate
npm install
npm run build
php artisan serve
```

接著建立第一個專案與共用管理者帳密：

```bash
php artisan feedback:project "我的專案" --client-name="客戶名稱"
php artisan feedback:account-password owner     # 先在 .env 設 FEEDBACK_OWNER_USERNAME
```

`feedback:project` 會印出客戶入口與開發團隊入口連結（只顯示一次）。測試：`php artisan test --compact`。

## 設定（`.env`）

未設定時一律使用通用預設值，沒有任何內建帳號或密碼。

| Key | 預設 | 說明 |
| --- | --- | --- |
| `FEEDBACK_DOMAIN` | 空 | 設了之後，路由只在該網域提供（例如 `feedback.example.com`），首頁 `/` 也是；空白表示任何網域都可進入。 |
| `FEEDBACK_DISK` | `local` | 截圖存放的 filesystem disk，請用私有 disk。 |
| `FEEDBACK_OWNER_USERNAME` | 空 | 共用 owner 帳號的帳號名稱；空白表示不啟用共用帳號。 |
| `FEEDBACK_OWNER_PASSWORD_HASH` | 空 | 共用 owner 帳號的 bcrypt 雜湊；沒設就無法用共用帳密登入。用 `php artisan feedback:account-password owner` 產生並寫入。 |
| `FEEDBACK_CLIENT_USERNAME` / `FEEDBACK_CLIENT_PASSWORD_HASH` | 空 | 僅用來避免個人帳號與全域帳號撞名；客戶帳密請改用 `feedback:client-account`（每專案各一組）。 |
| `FEEDBACK_LOGIN_PREFILL_ENABLED` | `false` | 登入頁是否預填帳密。關閉時任何登入頁都不會輸出帳密（含專案內 `--prefill` 存的值）。 |
| `FEEDBACK_OWNER_LOGIN_PREFILL_USERNAME` / `FEEDBACK_OWNER_LOGIN_PREFILL_PASSWORD` | 空 | 開啟預填時，`/owner/{slug}/login` 預填的帳密。客戶登入頁預填的值來自 `feedback:client-account --prefill`。預填會把密碼寫進頁面，僅適合內部或示範環境。 |
| `FEEDBACK_LABEL_CLIENT` | `客戶` | 介面上對提出問題的一方的稱呼。 |
| `FEEDBACK_LABEL_OWNER` | `開發團隊` | 介面上對處理問題的一方的稱呼。 |
| `FEEDBACK_PORTAL_TITLE` | `問題回報追蹤` | 問題清單頁頂端的小標題。 |
| `FEEDBACK_HOME_TITLE` | `問題回報` | 首頁與無專案頁面的標題。 |
| `FEEDBACK_HOME_EYEBROW` | `Feedback Desk` | 首頁卡片上的小字。 |
| `FEEDBACK_HOME_HEADING` | `問題回報` | 首頁主標題。 |
| `FEEDBACK_HOME_BODY` | 由開發團隊稱呼組成 | 首頁說明文字；預設為「請開啟{開發團隊}給你的專案連結，登入後就能回報問題、查看處理進度。」。 |
| `FEEDBACK_AUTOMATION_ENABLED` | `false` | 實驗功能總開關，見下方。 |
| `FEEDBACK_WORKSPACE_ROOT` | 空 | 自動處理允許的 repository 根目錄。 |
| `FEEDBACK_CODEX_BINARY` | `codex` | codex CLI 執行檔。 |
| `FEEDBACK_AUTOMATION_QUEUE` | `feedback-automation` | 自動處理使用的 queue 名稱。 |
| `FEEDBACK_AUTOMATION_TIMEOUT` | `3000` | 單次自動處理逾時秒數。 |

### 把稱呼改成「老師」「開發者」

```dotenv
FEEDBACK_LABEL_CLIENT=老師
FEEDBACK_LABEL_OWNER=開發者
FEEDBACK_PORTAL_TITLE=專案開發追蹤
```

介面（登入頁、狀態說明、留言作者、建立者篩選、首頁預設文案）會一併改成這組詞。修改後若有執行過 `php artisan config:cache`，請重跑一次。

## artisan 指令

| 指令 | 用途 |
| --- | --- |
| `feedback:project {name} {--slug=} {--client-name=} {--repository=} {--automation}` | 建立專案並印出客戶與開發團隊入口連結。 |
| `feedback:client-link {project}` | 重發客戶私密入口，舊連結失效。 |
| `feedback:owner-link {project}` | 重發開發團隊私密入口，舊連結失效。 |
| `feedback:client-account {project} {username} {--password=} {--prefill}` | 設定單一專案的客戶帳密（省略 `--password` 會產生隨機密碼）；`--prefill` 搭配 `FEEDBACK_LOGIN_PREFILL_ENABLED=true` 才會預填。 |
| `feedback:developer {username} {--name=} {--password=}` | 建立開發團隊個人帳號，或重設既有帳號密碼；個人帳號可建立問題並顯示為建立者。 |
| `feedback:account-password owner {--password=}` | 重設共用 owner 帳號密碼，雜湊寫入 `.env`，明文只顯示一次。 |
| `feedback:adjust {project} {report} {--note=} {--append} {--image=*}` | 用指令寫入問題的調整說明與圖片，不改動狀態。 |

## Queue worker 與自動處理（實驗功能）

專案使用 database queue，部署時請常駐 worker：

```bash
php artisan queue:work --queue=default
```

「自動處理」是實驗功能：開啟後，新問題會排入 `FEEDBACK_AUTOMATION_QUEUE`，由本機的 [codex CLI](https://github.com/openai/codex) 在指定的 repository 內嘗試處理並回寫結果。需要同時滿足：`FEEDBACK_AUTOMATION_ENABLED=true`、`FEEDBACK_WORKSPACE_ROOT` 指向允許的根目錄、專案用 `--automation --repository=...` 建立，並另外啟動專用 worker：

```bash
php artisan queue:work --queue=feedback-automation --timeout=3100
```

它會讓外部輸入的文字驅動程式碼修改，介面與行為都可能變動，請先在隔離環境評估，不建議直接用在正式程式碼庫。

## 部署注意

- 網域靠 `FEEDBACK_DOMAIN` 設定，反向代理 / TLS 自行處理；先設好 `APP_URL`，指令印出的入口連結才會正確。
- 正式環境請設 `APP_ENV=production`、`APP_DEBUG=false`，並保持 `FEEDBACK_LOGIN_PREFILL_ENABLED=false`。
- 截圖放在 `FEEDBACK_DISK` 指定的 disk，不要設成可公開讀取。
- 更新後執行 `php artisan migrate --force`，並用 `php artisan queue:restart` 重啟 worker。

## 授權

[MIT](LICENSE) © 2026 Alex Wang
