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
DEFAULT_MONGO_BIN="$HOME/.local/bin/mongod"
if [ ! -x "$DEFAULT_MONGO_BIN" ] && command -v mongod >/dev/null 2>&1; then
    DEFAULT_MONGO_BIN="$(command -v mongod)"
fi
MONGO_BIN="${MONGO_BIN:-$DEFAULT_MONGO_BIN}"
MONGO_DB_PATH="${MONGO_DB_PATH:-$HOME/.local/share/mongodb/data}"
MONGO_LOG_DIR="${MONGO_LOG_DIR:-$HOME/.local/share/mongodb/log}"
MONGO_LOG_PATH="${MONGO_LOG_PATH:-$MONGO_LOG_DIR/mongod.log}"
MONGO_PM2_NAME="${MONGO_PM2_NAME:-neurowar-mongodb}"
BACKEND_DEFAULT_PORT="${BACKEND_DEFAULT_PORT:-5001}"
FRONTEND_DEFAULT_PORT="${FRONTEND_DEFAULT_PORT:-3001}"
MAX_PORT_SCAN_STEPS="${MAX_PORT_SCAN_STEPS:-2000}"
MONGODB_URI_ENV="${MONGODB_URI:-mongodb://localhost:${MONGO_PORT}/strategy-game}"

FORCE_RESET_ADMIN=false
CLEAR_DOMAINS=false
INIT_DB=false

print_usage() {
    cat <<'EOF'
用法: ./start.sh [选项]

选项:
  --init-db             仅在数据库为空时注入基础数据
  --force-reset-admin   强制重置 admin 用户（密码恢复为 123456）
  --clear-domains       清空所有知识域数据（保留用户/熵盟/目录配置）
  -h, --help            显示帮助

说明:
  - 默认无参数启动时，只重启 MongoDB / 前端 / 后端服务，不修改数据库内容。
  - 仅当传入 --init-db 时，才会在数据库为空时执行基础注入（目录配置 + 管理员 + 用户字段初始化）。
EOF
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --init-db|init-db)
                INIT_DB=true
                ;;
            --force-reset-admin|force-reset-admin|reset-admin|admin-reset)
                FORCE_RESET_ADMIN=true
                ;;
            --clear-domains|clear-domains|clear-domain-data)
                CLEAR_DOMAINS=true
                ;;
            -h|--help|help)
                print_usage
                exit 0
                ;;
            *)
                echo "错误: 未知参数 $1"
                print_usage
                exit 1
                ;;
        esac
        shift
    done
}

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
        --logappend \
        --bind_ip 127.0.0.1 \
        --port "$MONGO_PORT" \
        --nounixsocket \
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

has_existing_gameplay_data() {
    local marker
    marker="$(
        cd "$BACKEND_DIR"
        MONGODB_URI="$MONGODB_URI_ENV" node - <<'NODE'
const mongoose = require('mongoose');
const User = require('./models/User');
const Node = require('./models/Node');
const EntropyAlliance = require('./models/EntropyAlliance');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const [userCount, nodeCount, allianceCount] = await Promise.all([
    User.countDocuments({}),
    Node.countDocuments({}),
    EntropyAlliance.countDocuments({})
  ]);
  await mongoose.disconnect();
  if ((userCount + nodeCount + allianceCount) > 0) {
    process.stdout.write('HAS_DATA');
    return;
  }
  process.stdout.write('EMPTY');
}

run()
  .catch(async (error) => {
    console.error(error.message);
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  });
NODE
    )"

    [ "$marker" = "HAS_DATA" ]
}

force_reset_admin_user() {
    echo "执行管理员强制重置..."
    cd "$BACKEND_DIR"
    MONGODB_URI="$MONGODB_URI_ENV" node - <<'NODE'
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '123456';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await User.findOneAndUpdate(
    { username: ADMIN_USERNAME },
    {
      $set: {
        password: hashedPassword,
        plainPassword: ADMIN_PASSWORD,
        role: 'admin',
        level: 0,
        experience: 0,
        knowledgeBalance: 0,
        location: '任意',
        profession: '求知',
        avatar: 'default_male_1',
        gender: 'male',
        allianceId: null,
        ownedNodes: [],
        favoriteDomains: [],
        recentVisitedDomains: [],
        notifications: []
      },
      $setOnInsert: {
        username: ADMIN_USERNAME
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  ).select('username role level experience location');

  await mongoose.disconnect();
  console.log(`管理员已重置: ${admin.username} / 密码: ${ADMIN_PASSWORD}`);
}

run()
  .catch(async (error) => {
    console.error('重置管理员失败:', error.message);
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  });
NODE
}

clear_knowledge_domain_data() {
    echo "清空知识域相关数据..."
    cd "$BACKEND_DIR"
    MONGODB_URI="$MONGODB_URI_ENV" node - <<'NODE'
const mongoose = require('mongoose');
const Node = require('./models/Node');
const NodeSense = require('./models/NodeSense');
const NodeSenseComment = require('./models/NodeSenseComment');
const NodeSenseEditSuggestion = require('./models/NodeSenseEditSuggestion');
const NodeSenseFavorite = require('./models/NodeSenseFavorite');
const DomainTitleProjection = require('./models/DomainTitleProjection');
const DomainTitleRelation = require('./models/DomainTitleRelation');
const DomainDefenseLayout = require('./models/DomainDefenseLayout');
const DomainSiegeState = require('./models/DomainSiegeState');
const SiegeParticipant = require('./models/SiegeParticipant');
const SiegeBattleRecord = require('./models/SiegeBattleRecord');
const DistributionParticipant = require('./models/DistributionParticipant');
const DistributionResult = require('./models/DistributionResult');
const AllianceBroadcastEvent = require('./models/AllianceBroadcastEvent');
const Notification = require('./models/Notification');
const UserInboxState = require('./models/UserInboxState');
const ScheduledTask = require('./models/ScheduledTask');
const Army = require('./models/Army');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function run() {
  await mongoose.connect(MONGODB_URI);

  const [
    nodeResult,
    nodeSenseResult,
    nodeSenseCommentResult,
    nodeSenseSuggestionResult,
    nodeSenseFavoriteResult,
    projectionResult,
    relationResult,
    defenseLayoutResult,
    siegeStateResult,
    siegeParticipantResult,
    siegeBattleRecordResult,
    distributionParticipantResult,
    distributionResultResult,
    allianceBroadcastResult,
    notificationResult,
    inboxStateResult,
    scheduledTaskResult,
    armyResult
  ] = await Promise.all([
    Node.deleteMany({}),
    NodeSense.deleteMany({}),
    NodeSenseComment.deleteMany({}),
    NodeSenseEditSuggestion.deleteMany({}),
    NodeSenseFavorite.deleteMany({}),
    DomainTitleProjection.deleteMany({}),
    DomainTitleRelation.deleteMany({}),
    DomainDefenseLayout.deleteMany({}),
    DomainSiegeState.deleteMany({}),
    SiegeParticipant.deleteMany({}),
    SiegeBattleRecord.deleteMany({}),
    DistributionParticipant.deleteMany({}),
    DistributionResult.deleteMany({}),
    AllianceBroadcastEvent.deleteMany({}),
    Notification.deleteMany({}),
    UserInboxState.deleteMany({}),
    ScheduledTask.deleteMany({}),
    Army.deleteMany({})
  ]);

  const userUpdateResult = await User.updateMany(
    {},
    {
      $set: {
        ownedNodes: [],
        location: '',
        lastArrivedFromNodeId: null,
        lastArrivedFromNodeName: '',
        lastArrivedAt: null,
        favoriteDomains: [],
        recentVisitedDomains: [],
        notifications: [],
        intelDomainSnapshots: {},
        travelState: {
          status: 'idle',
          isTraveling: false,
          path: [],
          startedAt: null,
          unitDurationSeconds: 60,
          targetNodeId: null,
          stoppingNearestNodeId: null,
          stoppingNearestNodeName: '',
          stopStartedAt: null,
          stopDurationSeconds: 0,
          stopFromNode: null,
          queuedTargetNodeId: null,
          queuedTargetNodeName: ''
        }
      }
    }
  );

  await mongoose.disconnect();

  console.log(JSON.stringify({
    node: nodeResult.deletedCount || 0,
    nodeSense: nodeSenseResult.deletedCount || 0,
    nodeSenseComment: nodeSenseCommentResult.deletedCount || 0,
    nodeSenseEditSuggestion: nodeSenseSuggestionResult.deletedCount || 0,
    nodeSenseFavorite: nodeSenseFavoriteResult.deletedCount || 0,
    domainTitleProjection: projectionResult.deletedCount || 0,
    domainTitleRelation: relationResult.deletedCount || 0,
    domainDefenseLayout: defenseLayoutResult.deletedCount || 0,
    domainSiegeState: siegeStateResult.deletedCount || 0,
    siegeParticipant: siegeParticipantResult.deletedCount || 0,
    siegeBattleRecord: siegeBattleRecordResult.deletedCount || 0,
    distributionParticipant: distributionParticipantResult.deletedCount || 0,
    distributionResult: distributionResultResult.deletedCount || 0,
    allianceBroadcastEvent: allianceBroadcastResult.deletedCount || 0,
    notification: notificationResult.deletedCount || 0,
    userInboxState: inboxStateResult.deletedCount || 0,
    scheduledTask: scheduledTaskResult.deletedCount || 0,
    army: armyResult.deletedCount || 0,
    userUpdated: userUpdateResult.modifiedCount || 0
  }, null, 2));
}

run()
  .catch(async (error) => {
    console.error('清空知识域数据失败:', error.message);
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  });
NODE
}

is_port_occupied() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -ltnH "( sport = :$port )" | grep -q .
        return $?
    fi

    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi

    echo "错误: 未找到 ss/lsof，无法检测端口占用。"
    exit 1
}

is_reserved_port() {
    local target_port="$1"
    shift
    local reserved_port
    for reserved_port in "$@"; do
        if [ -n "$reserved_port" ] && [ "$target_port" = "$reserved_port" ]; then
            return 0
        fi
    done
    return 1
}

find_available_port() {
    local start_port="$1"
    shift
    local port="$start_port"
    local steps=0

    while is_port_occupied "$port" || is_reserved_port "$port" "$@"; do
        port=$((port + 1))
        steps=$((steps + 1))
        if [ "$steps" -ge "$MAX_PORT_SCAN_STEPS" ] || [ "$port" -gt 65535 ]; then
            echo "错误: 无法从端口 $start_port 开始找到可用端口。"
            exit 1
        fi
    done

    echo "$port"
}

parse_args "$@"

migrate_legacy_pm2_home
ensure_pm2
start_mongo

if [ "$CLEAR_DOMAINS" = true ]; then
    clear_knowledge_domain_data
fi

if [ "$INIT_DB" = true ]; then
    if has_existing_gameplay_data; then
        echo "检测到数据库已有业务数据，跳过基础注入。"
    else
        inject_db
    fi
elif [ "$CLEAR_DOMAINS" != true ] && [ "$FORCE_RESET_ADMIN" != true ]; then
    echo "默认启动：跳过数据库维护，仅重启服务。"
fi

if [ "$FORCE_RESET_ADMIN" = true ]; then
    force_reset_admin_user
fi

pm2 delete neurowar-backend >/dev/null 2>&1 || true
pm2 delete neurowar-frontend >/dev/null 2>&1 || true

BACKEND_PORT="$(find_available_port "$BACKEND_DEFAULT_PORT")"
FRONTEND_PORT="$(find_available_port "$FRONTEND_DEFAULT_PORT" "$BACKEND_PORT")"
BACKEND_PUBLIC_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_LOCALHOST_ORIGIN="http://localhost:${FRONTEND_PORT}"
FRONTEND_LOOPBACK_ORIGIN="http://127.0.0.1:${FRONTEND_PORT}"
FRONTEND_ALLOWED_ORIGINS="${FRONTEND_LOCALHOST_ORIGIN},${FRONTEND_LOOPBACK_ORIGIN}"
EXTRA_FRONTEND_ORIGINS="${EXTRA_FRONTEND_ORIGINS:-}"
if [ -n "$EXTRA_FRONTEND_ORIGINS" ]; then
    FRONTEND_ALLOWED_ORIGINS="${FRONTEND_ALLOWED_ORIGINS},${EXTRA_FRONTEND_ORIGINS}"
fi

if [ "$BACKEND_PORT" != "$BACKEND_DEFAULT_PORT" ]; then
    echo "后端默认端口 ${BACKEND_DEFAULT_PORT} 已占用，切换为 ${BACKEND_PORT}"
fi
if [ "$FRONTEND_PORT" != "$FRONTEND_DEFAULT_PORT" ]; then
    echo "前端默认端口 ${FRONTEND_DEFAULT_PORT} 已占用，切换为 ${FRONTEND_PORT}"
fi

echo "启动后端服务..."
cd "$BACKEND_DIR"
PORT="$BACKEND_PORT" \
PUBLIC_ORIGIN="$BACKEND_PUBLIC_ORIGIN" \
FRONTEND_ORIGIN="$FRONTEND_ALLOWED_ORIGINS" \
CORS_ORIGINS="$FRONTEND_ALLOWED_ORIGINS" \
SOCKET_CORS_ORIGINS="$FRONTEND_ALLOWED_ORIGINS" \
pm2 start server.js --name neurowar-backend >/dev/null

sleep 3

echo "启动前端服务..."
cd "$FRONTEND_DIR"
PORT="$FRONTEND_PORT" \
REACT_APP_BACKEND_ORIGIN="$BACKEND_PUBLIC_ORIGIN" \
pm2 start npm --name neurowar-frontend -- start >/dev/null

echo "========================================="
pm2 list
echo "========================================="
echo "Frontend actual origin: ${FRONTEND_LOCALHOST_ORIGIN}"
echo "Frontend actual origin: ${FRONTEND_LOOPBACK_ORIGIN}"
echo "Backend actual origin:  ${BACKEND_PUBLIC_ORIGIN}"
echo "API_BASE:               ${BACKEND_PUBLIC_ORIGIN}/api"
echo "WebSocket endpoint:     ${BACKEND_PUBLIC_ORIGIN}"
echo "MongoDB:   mongodb://localhost:${MONGO_PORT}/strategy-game"
echo "========================================="
echo "查看日志:"
echo "  后端: pm2 logs neurowar-backend"
echo "  前端: pm2 logs neurowar-frontend"
echo "  Mongo: pm2 logs ${MONGO_PM2_NAME}"
echo "========================================="
