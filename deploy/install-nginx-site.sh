#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CONF="$PROJECT_DIR/deploy/nginx/neurowar.conf"
TARGET_CONF="${TARGET_CONF:-/etc/nginx/conf.d/neurowar.conf}"
DEFAULT_UNIFIED_ENV_FILE="$PROJECT_DIR/.env"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-${NEUROWAR_ENV_FILE:-$DEFAULT_UNIFIED_ENV_FILE}}"
FRONTEND_BUILD_DIR="${FRONTEND_BUILD_DIR:-$PROJECT_DIR/frontend/build}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行此脚本。"
  exit 1
fi

if [ ! -f "$SOURCE_CONF" ]; then
  echo "未找到配置文件: $SOURCE_CONF"
  exit 1
fi

if [ ! -f "$BACKEND_ENV_FILE" ]; then
  echo "未找到后端环境文件: $BACKEND_ENV_FILE"
  echo "可参考模板: $PROJECT_DIR/deploy/env/neurowar.env.example"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "未检测到 nginx，可先运行根目录 start-nginx.sh 进行自动安装。"
  exit 1
fi

set -a
. "$BACKEND_ENV_FILE"
set +a

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
PUBLIC_PORT="${PUBLIC_PORT:-}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-${NGINX_SCHEME:-http}}"
BACKEND_PORT="${PORT:-}"
BACKEND_BIND_HOST="${BIND_HOST:-127.0.0.1}"
NGINX_SCHEME="${NGINX_SCHEME:-}"
NGINX_SSL_CERT_PATH="${NGINX_SSL_CERT_PATH:-}"
NGINX_SSL_KEY_PATH="${NGINX_SSL_KEY_PATH:-}"

if [ -z "$PUBLIC_HOST" ] && [ -n "$PUBLIC_ORIGIN" ]; then
  PUBLIC_HOST="$(PUBLIC_ORIGIN="$PUBLIC_ORIGIN" node - <<'NODE'
const raw = process.env.PUBLIC_ORIGIN || '';
try {
  const parsed = new URL(raw);
  process.stdout.write(parsed.hostname || '');
} catch (_error) {
  process.stdout.write('');
}
NODE
)"
fi

if [ -z "$PUBLIC_PORT" ] && [ -n "$PUBLIC_ORIGIN" ]; then
  PUBLIC_PORT="$(PUBLIC_ORIGIN="$PUBLIC_ORIGIN" node - <<'NODE'
const raw = process.env.PUBLIC_ORIGIN || '';
try {
  const parsed = new URL(raw);
  process.stdout.write(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'));
} catch (_error) {
  process.stdout.write('');
}
NODE
)"
fi

if [ -z "$PUBLIC_PORT" ]; then
  PUBLIC_PORT="8088"
fi

if [ -z "$BACKEND_PORT" ]; then
  echo "错误: PORT 为空，无法生成 nginx 配置。"
  exit 1
fi

if [ "$BACKEND_BIND_HOST" = "0.0.0.0" ] || [ "$BACKEND_BIND_HOST" = "::" ] || [ -z "$BACKEND_BIND_HOST" ]; then
  BACKEND_BIND_HOST="127.0.0.1"
fi

SERVER_NAME="${NGINX_SERVER_NAME:-}"
PUBLIC_PORT="${NGINX_PUBLIC_PORT:-$PUBLIC_PORT}"
SSL_LISTEN_FLAGS=""
SSL_DIRECTIVES=""

SERVER_NAME="${SERVER_NAME:-$PUBLIC_HOST}"
if [ -z "$SERVER_NAME" ]; then
  SERVER_NAME="_"
fi
NGINX_SCHEME="${NGINX_SCHEME:-$PUBLIC_SCHEME}"
NGINX_SCHEME="${NGINX_SCHEME:-http}"

if [ "$NGINX_SCHEME" = "https" ]; then
  if [ -z "$NGINX_SSL_CERT_PATH" ] || [ -z "$NGINX_SSL_KEY_PATH" ]; then
    echo "错误: HTTPS 模式需要同时提供 NGINX_SSL_CERT_PATH 和 NGINX_SSL_KEY_PATH。"
    exit 1
  fi
  SSL_LISTEN_FLAGS=" ssl http2"
  SSL_DIRECTIVES="$(cat <<EOF
  ssl_certificate ${NGINX_SSL_CERT_PATH};
  ssl_certificate_key ${NGINX_SSL_KEY_PATH};
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
EOF
)"
fi

BACKEND_ORIGIN="http://${BACKEND_BIND_HOST}:${BACKEND_PORT}"
ESCAPED_FRONTEND_BUILD_DIR="$(printf '%s' "$FRONTEND_BUILD_DIR" | sed 's/[&|]/\\&/g')"
ESCAPED_BACKEND_ORIGIN="$(printf '%s' "$BACKEND_ORIGIN" | sed 's/[&|]/\\&/g')"
ESCAPED_SERVER_NAME="$(printf '%s' "$SERVER_NAME" | sed 's/[&|]/\\&/g')"
ESCAPED_PUBLIC_PORT="$(printf '%s' "$PUBLIC_PORT" | sed 's/[&|]/\\&/g')"
ESCAPED_SSL_LISTEN_FLAGS="$(printf '%s' "$SSL_LISTEN_FLAGS" | sed 's/[&|]/\\&/g')"
ESCAPED_SSL_DIRECTIVES="$(printf '%s' "$SSL_DIRECTIVES" | sed ':a;N;$!ba;s/\n/\\\
/g' | sed 's/[&|]/\\&/g')"

sed \
  -e "s|__FRONTEND_BUILD_DIR__|$ESCAPED_FRONTEND_BUILD_DIR|g" \
  -e "s|__BACKEND_ORIGIN__|$ESCAPED_BACKEND_ORIGIN|g" \
  -e "s|__SERVER_NAME__|$ESCAPED_SERVER_NAME|g" \
  -e "s|__PUBLIC_PORT__|$ESCAPED_PUBLIC_PORT|g" \
  -e "s|__SSL_LISTEN_FLAGS__|$ESCAPED_SSL_LISTEN_FLAGS|g" \
  -e "s|__SSL_DIRECTIVES__|$ESCAPED_SSL_DIRECTIVES|g" \
  "$SOURCE_CONF" > "$TARGET_CONF"

nginx -t
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
  NGINX_ACTION="reloaded"
else
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl start nginx
  NGINX_ACTION="started"
fi

echo "已安装 nginx 站点配置: $TARGET_CONF"
if [ -n "$PUBLIC_HOST" ]; then
  echo "公网入口: ${NGINX_SCHEME}://${PUBLIC_HOST}:${PUBLIC_PORT}"
else
  echo "公网入口: ${NGINX_SCHEME}://<当前公网 IP 或域名>:${PUBLIC_PORT}"
  echo "提示: 当前未固化 PUBLIC_HOST，nginx 将继续监听该端口，但建议补充根目录 .env 的 PUBLIC_HOST。"
fi
echo "后端回源: $BACKEND_ORIGIN"
echo "nginx 协议: $NGINX_SCHEME"
echo "nginx 动作: $NGINX_ACTION"
