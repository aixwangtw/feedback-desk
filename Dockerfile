# Feedback Desk 自行託管（企業內網）Dockerfile
#
# 建置：docker build -t feedback-desk .
#
# 最小啟動（本機驗證，資料放具名卷）：
#   docker run -d --name feedback-desk -p 8787:8787 \
#     -v feedback-desk-data:/app/.wrangler \
#     -e BOOTSTRAP_ADMIN=alex \
#     feedback-desk
#   # 首次 log 會印出只顯示一次的密碼，存好後到 /owner/demo/login 登入。
#
# 企業內網建議（務必明確設定，見 README「Docker 自行託管」）：
#   -e APP_SECRET=<至少 32 字元的亂數，換了全員重登入> \
#   -e PORT=8787 \
#   -e FEEDBACK_LABEL_CLIENT=客戶 -e FEEDBACK_LABEL_OWNER=開發團隊 \
#   -e FEEDBACK_SHARED_OWNER_NAME=Alex -e FEEDBACK_UTC_OFFSET=+08:00 \
#   -e FEEDBACK_LOGIN_PREFILL_ENABLED=false \
#   任何 FEEDBACK_* 都會轉成 Worker vars（蓋掉程式預設值）；
#   FEEDBACK_TURNSTILE_SECRET_KEY 與 SITE_KEY 兩個都有才啟用 Turnstile。
FROM node:22-slim

WORKDIR /app

# 先裝依賴（善用 layer cache；--ignore-scripts 跳過 prepare，
# 否則 npm ci 會在原始碼還沒複製進來前就跑 build.mjs 而失敗）
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# 再複製原始碼並建置（dist/public、dist/worker、dist/cli.js）
COPY . .
RUN npm run build \
  && chmod +x /app/docker-entrypoint.sh

# 本地 D1／R2 模擬檔與自動產生的 APP_SECRET 都放在這裡，請掛卷持久化
VOLUME ["/app/.wrangler"]

# 僅文件用途；實際 port 由 $PORT 決定（entrypoint 帶 --port）
EXPOSE 8787

ENV PORT=8787

ENTRYPOINT ["/app/docker-entrypoint.sh"]
