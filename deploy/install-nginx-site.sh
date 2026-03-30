#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CONF="$PROJECT_DIR/deploy/nginx/neurowar.conf"
TARGET_CONF="${TARGET_CONF:-/etc/nginx/conf.d/neurowar.conf}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行此脚本。"
  exit 1
fi

if [ ! -f "$SOURCE_CONF" ]; then
  echo "未找到配置文件: $SOURCE_CONF"
  exit 1
fi

cp "$SOURCE_CONF" "$TARGET_CONF"
nginx -t
systemctl reload nginx

echo "已安装 nginx 站点配置: $TARGET_CONF"
echo "访问地址: http://47.121.137.149:8088"
