#!/bin/sh
# docker-entrypoint.sh — self-hosted Feedback Desk（企業內網）啟動流程：
#   1. APP_SECRET：沒給就產生一組存進資料卷（重啟沿用；換了會登出所有人）。
#   2. 本地 D1 跑 migrations（非互動環境自動跳過確認）。
#   3. BOOTSTRAP_ADMIN 有設且 developers 還是空的 → 建第一個團隊帳號。
#   4. FEEDBACK_* 環境變數逐一轉成 Worker vars（蓋掉程式預設值）。
#   5. 啟動 wrangler dev，聽 0.0.0.0:$PORT。
set -eu

DATA_DIR="${DATA_DIR:-/app/.wrangler}"
PORT="${PORT:-8787}"
mkdir -p "$DATA_DIR"

# 1. APP_SECRET（cookie 加密與簽署下載網址；至少 32 字元，換了全部重登入）.
if [ -z "${APP_SECRET:-}" ]; then
  if [ -f "$DATA_DIR/app-secret" ]; then
    APP_SECRET="$(cat "$DATA_DIR/app-secret")"
  else
    APP_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    printf '%s' "$APP_SECRET" > "$DATA_DIR/app-secret"
    echo "[entrypoint] APP_SECRET not set; generated one and saved to the data volume."
    echo "[entrypoint] 正式使用請明確設定 APP_SECRET，否則換卷即全員登出。"
  fi
fi

# 2. 資料庫結構更新（資料保留；docker exec 下來備份見 README）.
npx wrangler d1 migrations apply DB --local -c wrangler.dev.jsonc

# 3. 第一個團隊帳號（只在空庫跑一次；之後改密碼走網頁「我的帳號」）.
if [ -n "${BOOTSTRAP_ADMIN:-}" ]; then
  COUNT="$(npx wrangler d1 execute DB --local -c wrangler.dev.jsonc --json --command 'SELECT COUNT(*) AS c FROM developers' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[0].results[0].c))")"
  if [ "$COUNT" = "0" ]; then
    BOOTSTRAP_NAME="${BOOTSTRAP_NAME:-$BOOTSTRAP_ADMIN}"
    if [ -z "${BOOTSTRAP_PASSWORD:-}" ]; then
      BOOTSTRAP_PASSWORD="$(node -e "const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';let s='';while(s.length<24){for(const b of require('crypto').randomBytes(48)){if(b<248)s+=a[b%62];if(s.length>=24)break}}console.log(s)")"
      GENERATED=1
    fi
    export BOOTSTRAP_PASSWORD
    HASH="$(node -e "const c=require('crypto');const salt=c.randomBytes(16);const h=c.pbkdf2Sync(process.env.BOOTSTRAP_PASSWORD,salt,10000,32,'sha256');console.log('pbkdf2_sha256\$10000\$'+salt.toString('base64')+'\$'+h.toString('base64'))")"
    NOW="$(node -e "console.log(new Date().toISOString())")"
    # 帳號只允許英數與底線連字號類字元時不需要跳脫；名稱的單引號以 SQL 規則加倍.
    case "$BOOTSTRAP_ADMIN" in
      *[!A-Za-z0-9_-]*)
        echo "[entrypoint] BOOTSTRAP_ADMIN 只能用英數、底線、連字號：$BOOTSTRAP_ADMIN" >&2
        exit 1
        ;;
    esac
    SAFE_NAME="$(printf '%s' "$BOOTSTRAP_NAME" | sed "s/'/''/g")"
    npx wrangler d1 execute DB --local -c wrangler.dev.jsonc --command "INSERT INTO developers (name, username, password_hash, created_at, updated_at) VALUES ('$SAFE_NAME', '$BOOTSTRAP_ADMIN', '$HASH', '$NOW', '$NOW')"
    echo "[entrypoint] 已建立第一個團隊帳號：$BOOTSTRAP_ADMIN（$SAFE_NAME）"
    if [ "${GENERATED:-}" = "1" ]; then
      echo "[entrypoint] 密碼只顯示這一次，請立刻存入密碼管理器：$BOOTSTRAP_PASSWORD"
    fi
    unset BOOTSTRAP_PASSWORD
  else
    echo "[entrypoint] 已有團隊帳號，跳過 BOOTSTRAP_ADMIN。"
  fi
fi

# 4. 環境變數 → Worker vars（命令列優先於 wrangler.dev.jsonc；見 README 設定表）.
set -- --ip 0.0.0.0 --port "$PORT"
set -- "$@" --var "APP_SECRET:$APP_SECRET"
if [ -n "${FEEDBACK_TURNSTILE_SECRET_KEY:-}" ]; then
  set -- "$@" --var "FEEDBACK_TURNSTILE_SECRET_KEY:$FEEDBACK_TURNSTILE_SECRET_KEY"
fi
for name in $(env | cut -d= -f1 | grep '^FEEDBACK_' | grep -v '^FEEDBACK_TURNSTILE_SECRET_KEY$' || true); do
  eval "val=\${$name}"
  if [ -n "$val" ]; then
    set -- "$@" --var "$name:$val"
  fi
done

# 5. 啟動（前景；log 即容器 log）.
exec npx wrangler dev -c wrangler.dev.jsonc "$@"
