#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

export PATH="$HOME/.local/bin:$PATH"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$BACKEND_DIR/.env.production}"
FRONTEND_BUILD_DIR="${FRONTEND_BUILD_DIR:-$FRONTEND_DIR/build}"
PM2_APP_NAME="${PM2_APP_NAME:-neurowar-backend-prod}"

if [ ! -f "$BACKEND_ENV_FILE" ]; then
  echo "缺少后端生产环境文件: $BACKEND_ENV_FILE"
  echo "可参考模板: $PROJECT_DIR/deploy/env/backend.production.env.example"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "未找到 pm2，请先安装: npm install -g pm2"
  exit 1
fi

set -a
. "$BACKEND_ENV_FILE"
set +a

echo "========================================="
echo "构建前端生产包"
echo "========================================="
cd "$FRONTEND_DIR"
rm -rf "$FRONTEND_BUILD_DIR"
npm run build

echo "========================================="
echo "启动后端生产服务"
echo "========================================="
cd "$BACKEND_DIR"
pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
pm2 start server.js --name "$PM2_APP_NAME"
pm2 save >/dev/null 2>&1 || true

echo "========================================="
echo "生产启动完成"
echo "========================================="
echo "前端静态目录: $FRONTEND_BUILD_DIR"
echo "后端进程名:   $PM2_APP_NAME"
echo "后端环境文件: $BACKEND_ENV_FILE"
echo "nginx 配置:   $PROJECT_DIR/deploy/nginx/neurowar.conf"
echo "下一步:"
echo "  1. sudo cp $PROJECT_DIR/deploy/nginx/neurowar.conf /etc/nginx/conf.d/neurowar.conf"
echo "  2. sudo nginx -t && sudo systemctl reload nginx"
echo "  3. 安全组 / 防火墙放行 8088/tcp"
