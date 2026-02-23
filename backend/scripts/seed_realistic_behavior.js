#!/usr/bin/env node

require('dotenv').config();

const DEFAULT_BASE_URL = process.env.SEED_BASE_URL || 'http://localhost:5000';
const DEFAULT_ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '123456';
const DEFAULT_COMMON_PASSWORD = process.env.SEED_COMMON_PASSWORD || 'seed123456';
const DEFAULT_USERS = 10;
const DEFAULT_NODES_PER_USER = 1;
const MARKER = 'real_behavior_seed_v1';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getArgValue = (name, fallback = '') => {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1];
  }
  return fallback;
};

const toInt = (value, fallback, min = 1, max = 5000) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const config = {
  baseUrl: (getArgValue('--base-url', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  adminUsername: getArgValue('--admin-username', DEFAULT_ADMIN_USERNAME) || DEFAULT_ADMIN_USERNAME,
  adminPassword: getArgValue('--admin-password', DEFAULT_ADMIN_PASSWORD) || DEFAULT_ADMIN_PASSWORD,
  commonPassword: getArgValue('--common-password', DEFAULT_COMMON_PASSWORD) || DEFAULT_COMMON_PASSWORD,
  users: toInt(getArgValue('--users', String(DEFAULT_USERS)), DEFAULT_USERS, 1, 2000),
  nodesPerUser: toInt(getArgValue('--nodes-per-user', String(DEFAULT_NODES_PER_USER)), DEFAULT_NODES_PER_USER, 1, 20),
  verbose: hasFlag('--verbose')
};

if (typeof fetch !== 'function') {
  console.error('当前 Node 版本不支持 fetch，请升级到 Node 18+');
  process.exit(1);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
用法:
  node scripts/seed_realistic_behavior.js [options]

选项:
  --base-url <url>           后端地址，默认 http://localhost:5000
  --admin-username <name>    管理员用户名，默认 admin
  --admin-password <pwd>     管理员密码，默认 123456
  --common-password <pwd>    普通用户密码，默认 seed123456
  --users <n>                创建普通用户数量，默认 10
  --nodes-per-user <n>       每个普通用户创建节点数量，默认 1
  --verbose                  输出详细过程
  --help, -h                 显示帮助

示例:
  npm run seed-realistic -- --users 30 --nodes-per-user 2 --verbose
`);
  process.exit(0);
}

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const logVerbose = (...items) => {
  if (config.verbose) {
    console.log(...items);
  }
};

const requestJson = async ({
  method = 'GET',
  path = '/',
  token = '',
  body = undefined,
  okStatuses = [200]
}) => {
  const url = `${config.baseUrl}${path}`;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    data = null;
  }

  if (!okStatuses.includes(response.status)) {
    const message = data?.error || data?.message || raw || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} 失败: ${message}`);
  }

  return { status: response.status, data };
};

const login = async (username, password) => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/login',
    body: { username, password },
    okStatuses: [200]
  });
  return res.data?.token || '';
};

const registerCommonUser = async (username, password) => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/register',
    body: { username, password },
    okStatuses: [201]
  });
  return {
    userId: res.data?.userId || '',
    token: res.data?.token || ''
  };
};

const createNode = async ({ token, payload }) => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/nodes/create',
    token,
    body: payload,
    okStatuses: [201]
  });
  return res.data || {};
};

const approveNode = async ({ adminToken, nodeId }) => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/nodes/approve',
    token: adminToken,
    body: { nodeId },
    okStatuses: [200]
  });
  return res.data || {};
};

const updateLocation = async ({ token, location }) => {
  await requestJson({
    method: 'PUT',
    path: '/api/location',
    token,
    body: { location },
    okStatuses: [200]
  });
};

const normalizeNodeForAssociation = (node = {}) => {
  const nodeId = typeof node?._id === 'string'
    ? node._id
    : (node?._id && typeof node._id.toString === 'function' ? node._id.toString() : '');
  const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
  const firstSenseId = typeof senses[0]?.senseId === 'string' && senses[0].senseId.trim()
    ? senses[0].senseId.trim()
    : 'sense_1';
  if (!nodeId) {
    throw new Error('节点返回缺少 _id，无法继续构造真实行为数据');
  }
  return {
    _id: nodeId,
    name: node?.name || '',
    senseId: firstSenseId
  };
};

const buildPosition = (index = 0) => ({
  x: (80 + index * 37) % 760,
  y: (60 + index * 53) % 460
});

const run = async () => {
  const startedAt = new Date();
  console.log(`[real-seed] 开始，baseUrl=${config.baseUrl} users=${config.users} nodesPerUser=${config.nodesPerUser}`);

  const adminToken = await login(config.adminUsername, config.adminPassword);
  if (!adminToken) {
    throw new Error('管理员登录失败，无法执行真实行为脚本');
  }
  console.log(`[real-seed] 管理员登录成功: ${config.adminUsername}`);

  const bootstrapName = `${MARKER}_${runId}_bootstrap`;
  const bootstrapNodeRaw = await createNode({
    token: adminToken,
    payload: {
      name: bootstrapName,
      description: `${MARKER} bootstrap domain`,
      position: buildPosition(0),
      synonymSenses: [{ title: '基础释义', content: '用于真实行为数据脚本的起始知识域。' }],
      associations: []
    }
  });
  const approvedTargets = [normalizeNodeForAssociation(bootstrapNodeRaw)];
  console.log(`[real-seed] 创建起始知识域成功: ${approvedTargets[0].name}`);

  const createdUsers = [];
  const createdNodeIds = [approvedTargets[0]._id];
  let approvedFromCommon = 0;

  for (let userIdx = 0; userIdx < config.users; userIdx += 1) {
    const username = `${MARKER}_${runId}_common_${userIdx + 1}`;
    const registerRes = await registerCommonUser(username, config.commonPassword);
    const userToken = registerRes.token;
    createdUsers.push({ username, userId: registerRes.userId });
    logVerbose(`[real-seed] 注册用户成功: ${username}`);

    await updateLocation({ token: userToken, location: approvedTargets[0].name });

    for (let nodeIdx = 0; nodeIdx < config.nodesPerUser; nodeIdx += 1) {
      const target = approvedTargets[(userIdx + nodeIdx) % approvedTargets.length];
      const domainName = `${MARKER}_${runId}_u${userIdx + 1}_n${nodeIdx + 1}`;
      const createRes = await createNode({
        token: userToken,
        payload: {
          name: domainName,
          description: `由真实行为脚本创建：${domainName}`,
          position: buildPosition((userIdx + 1) * (nodeIdx + 2)),
          synonymSenses: [{
            title: `释义_${userIdx + 1}_${nodeIdx + 1}`,
            content: `用户 ${username} 创建的释义`
          }],
          associations: [{
            targetNode: target._id,
            relationType: 'extends',
            sourceSenseId: 'sense_1',
            targetSenseId: target.senseId
          }]
        }
      });

      let approvedNode = createRes;
      if (createRes?.status === 'pending') {
        approvedNode = await approveNode({
          adminToken,
          nodeId: createRes._id
        });
        approvedFromCommon += 1;
      }

      const normalized = normalizeNodeForAssociation(approvedNode);
      approvedTargets.push(normalized);
      createdNodeIds.push(normalized._id);
      logVerbose(`[real-seed] 用户域创建并通过: ${normalized.name}`);
    }
  }

  const finishedAt = new Date();
  console.log(JSON.stringify({
    ok: true,
    marker: MARKER,
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    baseUrl: config.baseUrl,
    adminUsername: config.adminUsername,
    created: {
      users: createdUsers.length,
      nodes: createdNodeIds.length,
      approvedFromCommon
    },
    sample: {
      firstUser: createdUsers[0] || null,
      firstNodeId: createdNodeIds[0] || null
    }
  }, null, 2));
};

run().catch((error) => {
  console.error('[real-seed] 失败:', error.message);
  process.exit(1);
});
