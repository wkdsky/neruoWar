#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_UNIFIED_ENV_FILE="$PROJECT_DIR/.env"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-${NEUROWAR_ENV_FILE:-$DEFAULT_UNIFIED_ENV_FILE}}"
BACKEND_ENV_TEMPLATE="$PROJECT_DIR/deploy/env/neurowar.env.example"
START_PRODUCTION_SCRIPT="$PROJECT_DIR/deploy/start-production.sh"
INSTALL_NGINX_SCRIPT="$PROJECT_DIR/deploy/install-nginx-site.sh"

PUBLIC_IP="${PUBLIC_IP:-${PUBLIC_HOST:-}}"
PUBLIC_PORT="${PUBLIC_PORT:-}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-http}"
BACKEND_PORT_OVERRIDE="${BACKEND_PORT_OVERRIDE:-}"
SSL_CERT_PATH="${SSL_CERT_PATH:-}"
SSL_KEY_PATH="${SSL_KEY_PATH:-}"

print_usage() {
  cat <<'EOF'
用法:
  ./start-nginx.sh [options]

选项:
  --ip <ip-or-domain>         公网访问 IP 或域名
  --domain <domain>          公网域名（等价于 --ip）
  --port <port>               公网访问端口
  --scheme <http|https>       公网协议，默认 http
  --backend-port <port>       可选，覆盖后端生产端口
  --https-cert <path>         HTTPS 证书路径（scheme=https 时可用）
  --https-key <path>          HTTPS 私钥路径（scheme=https 时可用）
  --env-file <path>           指定后端生产环境文件
  -h, --help                  显示帮助

说明:
  1. 推荐先在根目录 `.env` 里填写 `PUBLIC_HOST / PUBLIC_PORT`；若未填写，脚本会自动探测并提示确认。
  2. 如果系统未安装 nginx，会自动尝试安装。
  3. 如果 nginx 未启动，会自动启动；已启动则仅刷新配置。
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ip)
      PUBLIC_IP="${2:-}"
      shift 2
      ;;
    --port)
      PUBLIC_PORT="${2:-}"
      shift 2
      ;;
    --domain)
      PUBLIC_IP="${2:-}"
      shift 2
      ;;
    --scheme)
      PUBLIC_SCHEME="${2:-}"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --https-cert)
      SSL_CERT_PATH="${2:-}"
      shift 2
      ;;
    --https-key)
      SSL_KEY_PATH="${2:-}"
      shift 2
      ;;
    --env-file)
      BACKEND_ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "错误: 未知参数 $1"
      print_usage
      exit 1
      ;;
  esac
done

require_file() {
  local file_path="$1"
  local label="$2"
  if [ ! -f "$file_path" ]; then
    echo "缺少${label}: $file_path"
    exit 1
  fi
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  sudo "$@"
}

prompt_if_missing() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local current_value="${!var_name:-}"

  if [ -n "$current_value" ]; then
    return
  fi

  if [ -n "$default_value" ]; then
    read -r -p "$prompt_text [$default_value]: " current_value
    current_value="${current_value:-$default_value}"
  else
    while [ -z "$current_value" ]; do
      read -r -p "$prompt_text: " current_value
    done
  fi

  printf -v "$var_name" '%s' "$current_value"
}

ensure_backend_env_file() {
  if [ -f "$BACKEND_ENV_FILE" ]; then
    return
  fi

  require_file "$BACKEND_ENV_TEMPLATE" "后端生产环境模板"
  mkdir -p "$(dirname "$BACKEND_ENV_FILE")"
  cp "$BACKEND_ENV_TEMPLATE" "$BACKEND_ENV_FILE"
  echo "已创建统一环境文件: $BACKEND_ENV_FILE"
}

replace_or_append_env() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local escaped_value
  escaped_value="${value//\\/\\\\}"
  escaped_value="${escaped_value//&/\\&}"
  escaped_value="${escaped_value//\//\\/}"

  if grep -Eq "^${key}=" "$env_file"; then
    sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

load_env_defaults() {
  if [ ! -f "$BACKEND_ENV_FILE" ]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  . "$BACKEND_ENV_FILE"
  set +a

  if [ -z "$PUBLIC_IP" ] && [ -n "${PUBLIC_HOST:-}" ]; then
    PUBLIC_IP="$PUBLIC_HOST"
  fi

  if [ -z "$PUBLIC_IP" ] && [ -n "${PUBLIC_ORIGIN:-}" ]; then
    PUBLIC_IP="$(PUBLIC_ORIGIN="$PUBLIC_ORIGIN" node - <<'NODE'
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

  if [ -z "$PUBLIC_PORT" ] && [ -n "${PUBLIC_ORIGIN:-}" ]; then
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

  if [ -z "$BACKEND_PORT_OVERRIDE" ] && [ -n "${PORT:-}" ]; then
    BACKEND_PORT_OVERRIDE="$PORT"
  fi

  if [ -z "$PUBLIC_SCHEME" ] && [ -n "${NGINX_SCHEME:-}" ]; then
    PUBLIC_SCHEME="$NGINX_SCHEME"
  fi

  if [ -z "$PUBLIC_SCHEME" ] && [ -n "${PUBLIC_ORIGIN:-}" ]; then
    PUBLIC_SCHEME="$(PUBLIC_ORIGIN="$PUBLIC_ORIGIN" node - <<'NODE'
const raw = process.env.PUBLIC_ORIGIN || '';
try {
  const parsed = new URL(raw);
  process.stdout.write(parsed.protocol === 'https:' ? 'https' : 'http');
} catch (_error) {
  process.stdout.write('');
}
NODE
)"
  fi

  if [ -z "$SSL_CERT_PATH" ] && [ -n "${NGINX_SSL_CERT_PATH:-}" ]; then
    SSL_CERT_PATH="$NGINX_SSL_CERT_PATH"
  fi

  if [ -z "$SSL_KEY_PATH" ] && [ -n "${NGINX_SSL_KEY_PATH:-}" ]; then
    SSL_KEY_PATH="$NGINX_SSL_KEY_PATH"
  fi
}

detect_public_ip() {
  local detected=""

  if command -v curl >/dev/null 2>&1; then
    detected="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
    if [ -z "$detected" ]; then
      detected="$(curl -fsS --max-time 3 https://ifconfig.me/ip 2>/dev/null || true)"
    fi
    if [ -z "$detected" ]; then
      detected="$(curl -fsS --max-time 3 https://api.ip.sb/ip 2>/dev/null || true)"
    fi
  fi

  if [ -z "$detected" ] && command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi

  printf '%s' "$detected"
}

ensure_nginx_installed() {
  if command -v nginx >/dev/null 2>&1; then
    echo "检测到 nginx 已安装。"
    return
  fi

  echo "未检测到 nginx，开始安装..."
  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update
    run_privileged apt-get install -y nginx
    return
  fi

  echo "错误: 当前系统未安装 nginx，且未检测到 apt-get，无法自动安装。"
  exit 1
}

ensure_backend_env_file
load_env_defaults

if [ -z "$PUBLIC_IP" ]; then
  echo "未在 ${BACKEND_ENV_FILE} 中检测到 `PUBLIC_HOST`，开始自动探测公网地址。"
  PUBLIC_IP="$(detect_public_ip)"
fi

prompt_if_missing PUBLIC_IP "请输入公网 IP 或域名（建议写入 .env 的 PUBLIC_HOST）" "${PUBLIC_IP:-}"
prompt_if_missing PUBLIC_PORT "请输入公网端口" "8088"
prompt_if_missing PUBLIC_SCHEME "请输入公网协议" "${PUBLIC_SCHEME:-http}"

case "$PUBLIC_SCHEME" in
  http|https)
    ;;
  *)
    echo "错误: --scheme 仅支持 http 或 https"
    exit 1
    ;;
esac

if [ "$PUBLIC_SCHEME" = "https" ]; then
  prompt_if_missing SSL_CERT_PATH "请输入 HTTPS 证书路径" "${SSL_CERT_PATH:-}"
  prompt_if_missing SSL_KEY_PATH "请输入 HTTPS 私钥路径" "${SSL_KEY_PATH:-}"
fi

if ! printf '%s' "$PUBLIC_PORT" | grep -Eq '^[0-9]+$'; then
  echo "错误: 端口必须是数字"
  exit 1
fi

PUBLIC_ORIGIN="${PUBLIC_SCHEME}://${PUBLIC_IP}:${PUBLIC_PORT}"

if [ -n "$BACKEND_PORT_OVERRIDE" ]; then
  replace_or_append_env "$BACKEND_ENV_FILE" "PORT" "$BACKEND_PORT_OVERRIDE"
fi
replace_or_append_env "$BACKEND_ENV_FILE" "PUBLIC_HOST" "$PUBLIC_IP"
replace_or_append_env "$BACKEND_ENV_FILE" "PUBLIC_PORT" "$PUBLIC_PORT"
replace_or_append_env "$BACKEND_ENV_FILE" "PUBLIC_SCHEME" "$PUBLIC_SCHEME"
replace_or_append_env "$BACKEND_ENV_FILE" "PUBLIC_ORIGIN" "$PUBLIC_ORIGIN"
replace_or_append_env "$BACKEND_ENV_FILE" "FRONTEND_ORIGIN" "$PUBLIC_ORIGIN"
replace_or_append_env "$BACKEND_ENV_FILE" "CORS_ORIGINS" "$PUBLIC_ORIGIN"
  replace_or_append_env "$BACKEND_ENV_FILE" "SOCKET_CORS_ORIGINS" "$PUBLIC_ORIGIN"
  replace_or_append_env "$BACKEND_ENV_FILE" "NGINX_SCHEME" "$PUBLIC_SCHEME"
  replace_or_append_env "$BACKEND_ENV_FILE" "CLIENT_URL" "$PUBLIC_ORIGIN"
if [ -n "$SSL_CERT_PATH" ]; then
  replace_or_append_env "$BACKEND_ENV_FILE" "NGINX_SSL_CERT_PATH" "$SSL_CERT_PATH"
fi
if [ -n "$SSL_KEY_PATH" ]; then
  replace_or_append_env "$BACKEND_ENV_FILE" "NGINX_SSL_KEY_PATH" "$SSL_KEY_PATH"
fi

require_file "$START_PRODUCTION_SCRIPT" "生产启动脚本"
require_file "$INSTALL_NGINX_SCRIPT" "nginx 安装脚本"

ensure_nginx_installed

pm2 delete neurowar-backend >/dev/null 2>&1 || true
pm2 delete neurowar-frontend >/dev/null 2>&1 || true

echo "========================================="
echo "生产配置"
echo "========================================="
echo "ENV_FILE:         $BACKEND_ENV_FILE"
echo "PUBLIC_ORIGIN:    $PUBLIC_ORIGIN"
if [ -n "$BACKEND_PORT_OVERRIDE" ]; then
  echo "BACKEND_PORT:     $BACKEND_PORT_OVERRIDE"
fi
echo "PUBLIC_SCHEME:    $PUBLIC_SCHEME"
if [ "$PUBLIC_SCHEME" = "https" ]; then
  echo "SSL_CERT_PATH:    $SSL_CERT_PATH"
  echo "SSL_KEY_PATH:     $SSL_KEY_PATH"
fi
echo "========================================="

BACKEND_ENV_FILE="$BACKEND_ENV_FILE" "$START_PRODUCTION_SCRIPT"

if systemctl is-active --quiet nginx; then
  echo "检测到 nginx 已运行，将刷新项目配置。"
else
  echo "检测到 nginx 未运行，将安装项目配置并启动服务。"
fi

run_privileged env \
  BACKEND_ENV_FILE="$BACKEND_ENV_FILE" \
  NGINX_SCHEME="$PUBLIC_SCHEME" \
  NGINX_SSL_CERT_PATH="$SSL_CERT_PATH" \
  NGINX_SSL_KEY_PATH="$SSL_KEY_PATH" \
  "$INSTALL_NGINX_SCRIPT"

echo "========================================="
echo "一键部署完成"
echo "========================================="
echo "公网入口: $PUBLIC_ORIGIN"
