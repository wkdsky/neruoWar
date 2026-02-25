#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "启动 NeuroWar 游戏系统"
echo "========================================="

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

export PATH="$HOME/.local/bin:$PATH"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

MONGO_PORT="${MONGO_PORT:-27017}"
MONGO_BIN="${MONGO_BIN:-$HOME/.local/bin/mongod}"
MONGO_DB_PATH="${MONGO_DB_PATH:-$HOME/.local/share/mongodb/data}"
MONGO_LOG_DIR="${MONGO_LOG_DIR:-$HOME/.local/share/mongodb/log}"
MONGO_LOG_PATH="${MONGO_LOG_PATH:-$MONGO_LOG_DIR/mongod.log}"
MONGO_PM2_NAME="${MONGO_PM2_NAME:-neurowar-mongodb}"

migrate_legacy_pm2_home() {
    local legacy_pm2_home="$PROJECT_DIR/.pm2"
    local legacy_backup="$HOME/.pm2_legacy_from_neruoWar_$(date +%Y%m%d%H%M%S)"

    if [ ! -d "$legacy_pm2_home" ] || [ "$legacy_pm2_home" = "$PM2_HOME" ]; then
        return 0
    fi

    mkdir -p "$PM2_HOME"
    cp -a "$legacy_pm2_home/." "$PM2_HOME/" 2>/dev/null || true
    mv "$legacy_pm2_home" "$legacy_backup"
    echo "已迁移项目内 PM2_HOME -> $PM2_HOME"
    echo "旧目录备份: $legacy_backup"
}

ensure_pm2() {
    if command -v pm2 >/dev/null 2>&1; then
        return 0
    fi

    if ! command -v npm >/dev/null 2>&1; then
        echo "错误: 未找到 npm，无法安装 PM2。"
        exit 1
    fi

    echo "安装 PM2 到用户目录..."
    npm install -g pm2
}

mongo_is_up() {
    if command -v mongosh >/dev/null 2>&1; then
        mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1 && return 0
    fi

    (echo >/dev/tcp/127.0.0.1/"$MONGO_PORT") >/dev/null 2>&1
}

start_mongo() {
    echo "检查 MongoDB 状态..."
    if mongo_is_up; then
        echo "MongoDB 已运行。"
        return 0
    fi

    # 优先尝试系统服务，失败时自动回退到用户态 mongod。
    if command -v sudo >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
        if sudo -n systemctl start mongod >/dev/null 2>&1; then
            sleep 3
            if mongo_is_up; then
                echo "MongoDB(systemd) 启动成功。"
                return 0
            fi
        fi
    fi

    if [ ! -x "$MONGO_BIN" ]; then
        echo "错误: 未找到可执行 mongod: $MONGO_BIN"
        echo "请先安装 MongoDB，或设置 MONGO_BIN 环境变量。"
        return 1
    fi

    mkdir -p "$MONGO_DB_PATH" "$MONGO_LOG_DIR"
    pm2 delete "$MONGO_PM2_NAME" >/dev/null 2>&1 || true
    pm2 start "$MONGO_BIN" --name "$MONGO_PM2_NAME" -- \
        --dbpath "$MONGO_DB_PATH" \
        --logpath "$MONGO_LOG_PATH" \
        --bind_ip 127.0.0.1 \
        --port "$MONGO_PORT" \
        --quiet >/dev/null

    sleep 3
    if mongo_is_up; then
        echo "MongoDB(PM2) 启动成功。"
        return 0
    fi

    echo "错误: MongoDB 启动失败。"
    local mongo_pm2_log="$PM2_HOME/logs/${MONGO_PM2_NAME}-out.log"
    if [ -f "$mongo_pm2_log" ]; then
        echo "最近 Mongo 日志:"
        tail -n 20 "$mongo_pm2_log" || true
    fi
    return 1
}

inject_db() {
    echo "注入基础数据库数据..."
    cd "$BACKEND_DIR"
    node scripts/initCatalogAndUnitData.js
    node scripts/createAdmin.js
    node scripts/initUserLevels.js
    node scripts/initUserDomainPreferences.js
}

migrate_legacy_pm2_home
ensure_pm2
start_mongo
inject_db

echo "启动后端服务..."
cd "$BACKEND_DIR"
pm2 delete neurowar-backend >/dev/null 2>&1 || true
pm2 start server.js --name neurowar-backend >/dev/null

sleep 3

echo "启动前端服务..."
cd "$FRONTEND_DIR"
pm2 delete neurowar-frontend >/dev/null 2>&1 || true
pm2 start npm --name neurowar-frontend -- start >/dev/null

echo "========================================="
pm2 list
echo "========================================="
echo "后端服务: http://localhost:5000"
echo "前端服务: http://localhost:3000"
echo "MongoDB:   mongodb://localhost:${MONGO_PORT}/strategy-game"
echo "========================================="
echo "查看日志:"
echo "  后端: pm2 logs neurowar-backend"
echo "  前端: pm2 logs neurowar-frontend"
echo "  Mongo: pm2 logs ${MONGO_PM2_NAME}"
echo "========================================="
