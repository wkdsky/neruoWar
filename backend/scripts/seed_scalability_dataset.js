#!/usr/bin/env node

require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const connectDB = require('../config/database');
const User = require('../models/User');
const Node = require('../models/Node');
const NodeSense = require('../models/NodeSense');
const EntropyAlliance = require('../models/EntropyAlliance');
const AllianceBroadcastEvent = require('../models/AllianceBroadcastEvent');
const DomainSiegeState = require('../models/DomainSiegeState');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DistributionParticipant = require('../models/DistributionParticipant');
const DistributionResult = require('../models/DistributionResult');
const SiegeParticipant = require('../models/SiegeParticipant');
const Notification = require('../models/Notification');
const ScheduledTask = require('../models/ScheduledTask');

const MARKER = 'seed_scalability_refactor_v1';
const USERNAME_PREFIX = `${MARKER}_user_`;
const ALLIANCE_NAME_PREFIX = `${MARKER}_alliance_`;
const NODE_ID_PREFIX = `${MARKER}_node_`;
const TASK_DEDUPE_PREFIX = `${MARKER}_task_`;

const PROFILES = {
  smoke: {
    users: { admin: 20, common: 180 },
    alliances: [
      { key: 'small', members: 50 },
      { key: 'mid', members: 100 }
    ],
    nodes: 100,
    sensesPerNode: 5,
    lockedNodes: 10,
    siegeParticipants: 5,
    hotDistributionParticipants: 120,
    createSleepTestTask: false,
    createCleanupFixtures: false
  },
  acceptance: {
    users: { admin: 50, common: 19950 },
    alliances: [
      { key: 'big', members: 15000 },
      { key: 'mid', members: 3000 },
      { key: 'small', members: 200 }
    ],
    nodes: 5000,
    sensesPerNode: 20,
    lockedNodes: 200,
    siegeParticipants: 5000,
    hotDistributionParticipants: 5000,
    createSleepTestTask: false,
    createCleanupFixtures: false
  },
  stress: {
    users: { admin: 200, common: 99800 },
    alliances: [
      { key: 'big', members: 80000 },
      { key: 'mid', members: 10000 },
      { key: 'small', members: 1000 }
    ],
    nodes: 20000,
    sensesPerNode: 25,
    lockedNodes: 500,
    siegeParticipants: 20000,
    hotDistributionParticipants: 12000,
    createSleepTestTask: false,
    createCleanupFixtures: false
  },
  lease_test: {
    users: { admin: 2, common: 40 },
    alliances: [
      { key: 'main', members: 20 },
      { key: 'side', members: 10 }
    ],
    nodes: 80,
    sensesPerNode: 3,
    lockedNodes: 8,
    siegeParticipants: 8,
    hotDistributionParticipants: 20,
    createSleepTestTask: true,
    sleepTaskMs: 15000,
    createCleanupFixtures: false
  },
  cleanup_test: {
    users: { admin: 2, common: 60 },
    alliances: [
      { key: 'main', members: 30 },
      { key: 'side', members: 20 }
    ],
    nodes: 120,
    sensesPerNode: 3,
    lockedNodes: 12,
    siegeParticipants: 15,
    hotDistributionParticipants: 30,
    createSleepTestTask: false,
    createCleanupFixtures: true
  }
};

const args = process.argv.slice(2);
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

const profileName = (getArgValue('--profile', 'smoke') || 'smoke').trim();
const shouldReset = args.includes('--reset');
const withOldRecords = args.includes('--withOldRecords');
const config = PROFILES[profileName];

if (!config) {
  console.error(`未知 profile: ${profileName}. 可选: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

const chunkArray = (list = [], size = 1000) => {
  const out = [];
  const safeSize = Math.max(1, parseInt(size, 10) || 1000);
  for (let i = 0; i < list.length; i += safeSize) {
    out.push(list.slice(i, i + safeSize));
  }
  return out;
};

const asObjectId = (value) => new mongoose.Types.ObjectId(String(value));
const now = () => new Date();

const distributionRuleSnapshot = {
  enabled: true,
  distributionScope: 'all',
  distributionPercent: 100,
  masterPercent: 10,
  adminPercents: [],
  customUserPercents: [],
  nonHostileAlliancePercent: 0,
  specificAlliancePercents: [],
  noAlliancePercent: 0,
  blacklistUserIds: [],
  blacklistAllianceIds: [],
  scheduleSlots: []
};

const cleanupSeedData = async () => {
  const userRows = await User.find({ username: { $regex: `^${USERNAME_PREFIX}` } }).select('_id').lean();
  const nodeRows = await Node.find({ nodeId: { $regex: `^${NODE_ID_PREFIX}` } }).select('_id').lean();
  const allianceRows = await EntropyAlliance.find({ name: { $regex: `^${ALLIANCE_NAME_PREFIX}` } }).select('_id').lean();

  const userIds = userRows.map((item) => item._id);
  const nodeIds = nodeRows.map((item) => item._id);
  const allianceIds = allianceRows.map((item) => item._id);

  await Promise.all([
    nodeIds.length > 0 ? NodeSense.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    nodeIds.length > 0 ? DomainSiegeState.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    nodeIds.length > 0 ? DomainDefenseLayout.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    nodeIds.length > 0 ? DistributionParticipant.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    nodeIds.length > 0 ? DistributionResult.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    nodeIds.length > 0 ? SiegeParticipant.deleteMany({ nodeId: { $in: nodeIds } }) : Promise.resolve(),
    allianceIds.length > 0 ? AllianceBroadcastEvent.deleteMany({ allianceId: { $in: allianceIds } }) : Promise.resolve(),
    userIds.length > 0 ? DistributionParticipant.deleteMany({ userId: { $in: userIds } }) : Promise.resolve(),
    userIds.length > 0 ? DistributionResult.deleteMany({ userId: { $in: userIds } }) : Promise.resolve(),
    userIds.length > 0 ? SiegeParticipant.deleteMany({ userId: { $in: userIds } }) : Promise.resolve(),
    userIds.length > 0 ? Notification.deleteMany({ userId: { $in: userIds } }) : Promise.resolve(),
    ScheduledTask.deleteMany({ dedupeKey: { $regex: `^${TASK_DEDUPE_PREFIX}` } })
  ]);

  if (nodeIds.length > 0) {
    await Node.deleteMany({ _id: { $in: nodeIds } });
  }
  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
  }
  if (allianceIds.length > 0) {
    await EntropyAlliance.deleteMany({ _id: { $in: allianceIds } });
  }
};

const insertManyInBatches = async (Model, docs = [], batchSize = 1000) => {
  const inserted = [];
  for (const batch of chunkArray(docs, batchSize)) {
    if (batch.length === 0) continue;
    const rows = await Model.insertMany(batch, { ordered: false });
    inserted.push(...rows);
  }
  return inserted;
};

const bulkWriteInBatches = async (Model, ops = [], batchSize = 1000) => {
  for (const batch of chunkArray(ops, batchSize)) {
    if (batch.length === 0) continue;
    await Model.bulkWrite(batch, { ordered: false });
  }
};

const buildUsers = async () => {
  const passwordHash = bcrypt.hashSync('seed123456', 8);
  const adminDocs = Array.from({ length: config.users.admin }, (_, idx) => ({
    username: `${USERNAME_PREFIX}${profileName}_admin_${idx + 1}`,
    password: passwordHash,
    plainPassword: 'seed123456',
    role: 'admin',
    profession: '管理',
    location: '任意'
  }));
  const commonDocs = Array.from({ length: config.users.common }, (_, idx) => ({
    username: `${USERNAME_PREFIX}${profileName}_common_${idx + 1}`,
    password: passwordHash,
    plainPassword: 'seed123456',
    role: 'common',
    profession: '求知',
    location: ''
  }));

  const admins = await insertManyInBatches(User, adminDocs, 1000);
  const commons = await insertManyInBatches(User, commonDocs, 1000);
  return { admins, commons };
};

const buildAlliances = async (commonUsers = []) => {
  const allianceMembership = [];
  let cursor = 0;

  const allianceDocs = config.alliances.map((item, idx) => {
    const size = Math.max(0, Math.min(item.members, commonUsers.length - cursor));
    const members = commonUsers.slice(cursor, cursor + size);
    cursor += size;
    allianceMembership.push({ key: item.key, members });
    return {
      name: `${ALLIANCE_NAME_PREFIX}${profileName}_${item.key}`,
      flag: ['#ef4444', '#14b8a6', '#0ea5e9', '#f59e0b'][idx % 4],
      declaration: `${item.key} alliance for scalability seed`,
      founder: members[0]?._id || commonUsers[0]?._id,
      memberCount: members.length
    };
  });

  const alliances = await insertManyInBatches(EntropyAlliance, allianceDocs, 100);
  const allianceByKey = new Map(allianceMembership.map((item, idx) => [item.key, alliances[idx]]));

  const userAllianceOps = [];
  for (const membership of allianceMembership) {
    const alliance = allianceByKey.get(membership.key);
    for (const user of membership.members) {
      userAllianceOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { allianceId: alliance?._id || null } }
        }
      });
    }
  }
  await bulkWriteInBatches(User, userAllianceOps, 1000);

  return {
    alliances,
    allianceByKey,
    allianceMembership
  };
};

const buildNodes = async ({ commonUsers = [], allianceByUserId = new Map() } = {}) => {
  const rows = [];
  const nowDate = now();
  const lockedNodeCount = Math.min(config.lockedNodes, config.nodes);

  for (let idx = 0; idx < config.nodes; idx += 1) {
    const owner = commonUsers[idx % commonUsers.length];
    const ownerId = owner?._id || commonUsers[0]?._id;
    const ownerAllianceId = allianceByUserId.get(String(ownerId)) || null;

    const x = (idx * 17) % 800;
    const y = (idx * 29) % 500;
    const isLocked = idx < lockedNodeCount;
    const lockExecuteAtFuture = new Date(nowDate.getTime() + ((idx + 1) * 60 * 60 * 1000));

    let lock = null;
    if (isLocked) {
      if (idx === 0) {
        const executeAt = new Date(nowDate.getTime() - 10 * 60 * 1000);
        lock = {
          executeAt,
          entryCloseAt: new Date(executeAt.getTime() - 60 * 1000),
          endAt: new Date(executeAt.getTime() + 60 * 60 * 1000),
          executedAt: new Date(executeAt.getTime() + 10 * 1000),
          announcedAt: new Date(executeAt.getTime() - 30 * 60 * 1000),
          projectedTotal: 1000,
          projectedDistributableTotal: 1000,
          masterAllianceId: ownerAllianceId,
          masterAllianceName: '',
          allianceContributionPercent: 0,
          distributionScope: 'all',
          distributionPercent: 100,
          ruleProfileId: 'default',
          ruleProfileName: '默认规则',
          enemyAllianceIds: [],
          participants: [],
          distributedTotal: 0,
          rewardParticipantCount: 0,
          resultUserRewards: [],
          ruleSnapshot: distributionRuleSnapshot
        };
      } else {
        lock = {
          executeAt: lockExecuteAtFuture,
          entryCloseAt: new Date(lockExecuteAtFuture.getTime() - 60 * 1000),
          endAt: new Date(lockExecuteAtFuture.getTime() + 60 * 1000),
          executedAt: null,
          announcedAt: nowDate,
          projectedTotal: 500,
          projectedDistributableTotal: 500,
          masterAllianceId: ownerAllianceId,
          masterAllianceName: '',
          allianceContributionPercent: 0,
          distributionScope: 'all',
          distributionPercent: 100,
          ruleProfileId: 'default',
          ruleProfileName: '默认规则',
          enemyAllianceIds: [],
          participants: [],
          distributedTotal: 0,
          rewardParticipantCount: 0,
          resultUserRewards: [],
          ruleSnapshot: distributionRuleSnapshot
        };
      }
    }

    rows.push({
      nodeId: `${NODE_ID_PREFIX}${profileName}_${idx + 1}`,
      owner: ownerId,
      domainMaster: ownerId,
      allianceId: ownerAllianceId,
      name: `${MARKER}_${profileName}_domain_${idx + 1}`,
      description: `seeded domain ${idx + 1}`,
      position: { x, y },
      contentScore: 2 + (idx % 4),
      knowledgePoint: {
        value: 100 + (idx % 20),
        lastUpdated: nowDate
      },
      status: 'approved',
      knowledgeDistributionLocked: lock
    });
  }

  return insertManyInBatches(Node, rows, 500);
};

const buildNodeSenses = async ({ nodes = [], users = [] } = {}) => {
  const createdBy = users[0]?._id || null;
  const docs = [];
  nodes.forEach((node) => {
    for (let i = 0; i < config.sensesPerNode; i += 1) {
      docs.push({
        nodeId: node._id,
        senseId: `sense_${i + 1}`,
        title: `${node.name}_sense_${i + 1}`,
        content: `seed sense ${i + 1} for ${node.name}`,
        order: i,
        status: 'active',
        createdBy,
        updatedBy: createdBy
      });
    }
  });
  await insertManyInBatches(NodeSense, docs, 2000);
};

const updateUserLocations = async ({ commonUsers = [], nodes = [] } = {}) => {
  if (!commonUsers.length || !nodes.length) return;
  const ops = commonUsers.map((user, idx) => ({
    updateOne: {
      filter: { _id: user._id },
      update: {
        $set: {
          location: nodes[idx % nodes.length].name,
          lastArrivedFromNodeId: null,
          lastArrivedFromNodeName: ''
        }
      }
    }
  }));
  await bulkWriteInBatches(User, ops, 1000);
};

const createSiegeDataset = async ({ nodes = [], allianceMembership = [] } = {}) => {
  if (!nodes.length) return null;
  const hotNode = nodes[0];
  const bigGroup = allianceMembership[0]?.members || [];
  const siegeUsers = bigGroup.slice(0, Math.min(config.siegeParticipants, bigGroup.length));
  if (!siegeUsers.length) return { hotNodeId: hotNode._id, participantCount: 0 };

  const requestedAtBase = new Date(now().getTime() - 5 * 60 * 1000);
  const participantDocs = siegeUsers.map((user, idx) => {
    const isInitiator = idx === 0;
    const status = isInitiator ? 'sieging' : (idx % 3 === 0 ? 'moving' : 'sieging');
    const requestedAt = new Date(requestedAtBase.getTime() - idx * 1000);
    const arriveAt = status === 'moving'
      ? new Date(now().getTime() + ((idx % 30) + 1) * 1000)
      : new Date(requestedAt.getTime() + 1000);
    const joinedAt = status === 'sieging' ? new Date(requestedAt.getTime() + 1000) : null;
    return {
      nodeId: hotNode._id,
      gateKey: 'cheng',
      userId: user._id,
      username: user.username,
      allianceId: user.allianceId || null,
      units: [{ unitTypeId: 'seed_infantry', count: 10 + (idx % 40) }],
      fromNodeId: hotNode._id,
      fromNodeName: hotNode.name,
      autoRetreatPercent: 40,
      status,
      isInitiator,
      isReinforcement: !isInitiator,
      requestedAt,
      arriveAt,
      joinedAt,
      updatedAt: now()
    };
  });
  await insertManyInBatches(SiegeParticipant, participantDocs, 1000);

  const preview = participantDocs.slice(0, 50).map((item) => ({
    userId: item.userId,
    username: item.username,
    allianceId: item.allianceId,
    units: item.units,
    fromNodeId: item.fromNodeId,
    fromNodeName: item.fromNodeName,
    autoRetreatPercent: item.autoRetreatPercent,
    status: item.status,
    isInitiator: item.isInitiator,
    isReinforcement: item.isReinforcement,
    requestedAt: item.requestedAt,
    arriveAt: item.arriveAt,
    joinedAt: item.joinedAt,
    updatedAt: item.updatedAt
  }));

  const initiator = participantDocs[0];
  await Node.updateOne(
    { _id: hotNode._id },
    {
      $set: {
        'citySiegeState.cheng.active': true,
        'citySiegeState.cheng.startedAt': requestedAtBase,
        'citySiegeState.cheng.updatedAt': now(),
        'citySiegeState.cheng.supportNotifiedAt': now(),
        'citySiegeState.cheng.attackerAllianceId': initiator.allianceId,
        'citySiegeState.cheng.initiatorUserId': initiator.userId,
        'citySiegeState.cheng.initiatorUsername': initiator.username,
        'citySiegeState.cheng.participantCount': participantDocs.length,
        'citySiegeState.cheng.attackers': preview,
        'citySiegeState.qi': {
          active: false,
          startedAt: null,
          updatedAt: now(),
          supportNotifiedAt: null,
          attackerAllianceId: null,
          initiatorUserId: null,
          initiatorUsername: '',
          participantCount: 0,
          attackers: []
        }
      }
    }
  );

  await DomainSiegeState.updateOne(
    { nodeId: hotNode._id },
    {
      $set: {
        cheng: {
          active: true,
          startedAt: requestedAtBase,
          updatedAt: now(),
          supportNotifiedAt: now(),
          attackerAllianceId: initiator.allianceId,
          initiatorUserId: initiator.userId,
          initiatorUsername: initiator.username,
          participantCount: participantDocs.length,
          attackers: preview
        },
        qi: {
          active: false,
          startedAt: null,
          updatedAt: now(),
          supportNotifiedAt: null,
          attackerAllianceId: null,
          initiatorUserId: null,
          initiatorUsername: '',
          participantCount: 0,
          attackers: []
        },
        updatedAt: now(),
        updatedBy: initiator.userId
      }
    },
    { upsert: true }
  );

  return {
    hotNodeId: hotNode._id,
    participantCount: participantDocs.length
  };
};

const createDistributionDataset = async ({ nodes = [], allianceMembership = [] } = {}) => {
  const hotNode = nodes[1] || nodes[0];
  if (!hotNode || !hotNode.knowledgeDistributionLocked) {
    return { hotNodeId: hotNode?._id || null, participantCount: 0, resultCount: 0 };
  }
  const lockExecuteAt = new Date(hotNode.knowledgeDistributionLocked.executeAt || now());
  const users = (allianceMembership[0]?.members || []).slice(0, Math.min(config.hotDistributionParticipants, allianceMembership[0]?.members?.length || 0));
  if (!users.length) {
    return { hotNodeId: hotNode._id, participantCount: 0, resultCount: 0 };
  }

  const participantDocs = users.map((user, idx) => ({
    nodeId: hotNode._id,
    executeAt: lockExecuteAt,
    userId: user._id,
    joinedAt: new Date(lockExecuteAt.getTime() - (30 * 60 * 1000) + idx * 1000),
    exitedAt: null
  }));
  await insertManyInBatches(DistributionParticipant, participantDocs, 1000);

  const resultDocs = users.map((user, idx) => {
    const amount = Number((1 + (idx % 9) * 0.35).toFixed(2));
    return {
      nodeId: hotNode._id,
      executeAt: lockExecuteAt,
      lockId: `${hotNode._id.toString()}:${lockExecuteAt.toISOString()}`,
      userId: user._id,
      amount,
      createdAt: new Date(lockExecuteAt.getTime() + 20 * 1000)
    };
  });
  await insertManyInBatches(DistributionResult, resultDocs, 1000);

  const userBalanceOps = resultDocs.map((item) => ({
    updateOne: {
      filter: { _id: item.userId },
      update: { $inc: { knowledgeBalance: item.amount } }
    }
  }));
  await bulkWriteInBatches(User, userBalanceOps, 1000);

  const distributedTotal = Number(resultDocs.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const preview = resultDocs.slice(0, 200).map((item) => ({
    userId: item.userId,
    amount: item.amount
  }));

  await Node.updateOne(
    { _id: hotNode._id },
    {
      $set: {
        'knowledgeDistributionLocked.executedAt': new Date(lockExecuteAt.getTime() + 20 * 1000),
        'knowledgeDistributionLocked.distributedTotal': distributedTotal,
        'knowledgeDistributionLocked.rewardParticipantCount': resultDocs.length,
        'knowledgeDistributionLocked.resultUserRewards': preview
      }
    }
  );

  return {
    hotNodeId: hotNode._id,
    participantCount: participantDocs.length,
    resultCount: resultDocs.length
  };
};

const createScheduledTasks = async () => {
  const runAt = new Date(now().getTime() - 60 * 1000);
  await Promise.all([
    ScheduledTask.updateOne(
      { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_admin_tick` },
      {
        $set: {
          type: 'domain_admin_resign_timeout_tick',
          runAt,
          status: 'ready',
          payload: {},
          lockOwner: '',
          lockedUntil: null,
          attempts: 0,
          lastError: ''
        }
      },
      { upsert: true }
    ),
    ScheduledTask.updateOne(
      { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_distribution_tick` },
      {
        $set: {
          type: 'knowledge_distribution_tick',
          runAt,
          status: 'ready',
          payload: {},
          lockOwner: '',
          lockedUntil: null,
          attempts: 0,
          lastError: ''
        }
      },
      { upsert: true }
    )
  ]);
};

const createSleepLeaseTask = async () => {
  if (!config.createSleepTestTask) return null;
  const ms = Math.max(1000, parseInt(config.sleepTaskMs, 10) || 15000);
  await ScheduledTask.updateOne(
    { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_sleep_test` },
    {
      $set: {
        type: 'sleep_test_job',
        runAt: new Date(),
        status: 'ready',
        payload: { ms },
        lockOwner: '',
        lockedUntil: null,
        attempts: 0,
        lastError: ''
      }
    },
    { upsert: true }
  );
  return ms;
};

const createCleanupFixtures = async ({ nodes = [], commons = [], alliances = [] } = {}) => {
  if (!config.createCleanupFixtures && !withOldRecords) {
    return {
      enabled: false
    };
  }
  const oldDays = 120;
  const oldDate = new Date(Date.now() - oldDays * 24 * 60 * 60 * 1000);
  const oldExecuteAt = new Date(oldDate.getTime() - 2 * 60 * 60 * 1000);
  const targetNode = nodes[0];
  const targetUser = commons[0];
  const targetAlliance = alliances[0];

  if (!targetNode || !targetUser || !targetAlliance) {
    return {
      enabled: true,
      skipped: true
    };
  }

  await Promise.all([
    ScheduledTask.updateOne(
      { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_old_done` },
      {
        $set: {
          type: 'maintenance_cleanup_tick',
          runAt: oldDate,
          status: 'done',
          payload: { marker: MARKER },
          lockOwner: '',
          lockedUntil: null,
          attempts: 1,
          lastError: '',
          createdAt: oldDate,
          updatedAt: oldDate
        }
      },
      { upsert: true, timestamps: false }
    ),
    ScheduledTask.updateOne(
      { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_old_failed` },
      {
        $set: {
          type: 'knowledge_distribution_tick',
          runAt: oldDate,
          status: 'failed',
          payload: { marker: MARKER },
          lockOwner: '',
          lockedUntil: null,
          attempts: 3,
          lastError: 'seed old failed row',
          createdAt: oldDate,
          updatedAt: oldDate
        }
      },
      { upsert: true, timestamps: false }
    ),
    AllianceBroadcastEvent.updateOne(
      { dedupeKey: `${MARKER}_${profileName}_old_broadcast` },
      {
        $set: {
          allianceId: targetAlliance._id,
          type: 'announcement',
          actorUserId: targetUser._id,
          actorUsername: targetUser.username || '',
          nodeId: targetNode._id,
          nodeName: targetNode.name || '',
          gateKey: '',
          title: 'old seed broadcast',
          message: 'old seed broadcast message',
          dedupeKey: `${MARKER}_${profileName}_old_broadcast`,
          createdAt: oldDate
        }
      },
      { upsert: true }
    ),
    DistributionResult.updateOne(
      {
        nodeId: targetNode._id,
        executeAt: oldExecuteAt,
        userId: targetUser._id
      },
      {
        $set: {
          nodeId: targetNode._id,
          executeAt: oldExecuteAt,
          lockId: `${MARKER}:${profileName}:old-lock`,
          userId: targetUser._id,
          amount: 1.23,
          createdAt: oldDate,
          updatedAt: oldDate
        }
      },
      { upsert: true, timestamps: false }
    ),
    SiegeParticipant.updateOne(
      {
        nodeId: targetNode._id,
        gateKey: 'qi',
        userId: targetUser._id
      },
      {
        $set: {
          nodeId: targetNode._id,
          gateKey: 'qi',
          userId: targetUser._id,
          username: targetUser.username || '',
          allianceId: targetAlliance._id,
          units: [{ unitTypeId: 'seed_cleanup_unit', count: 1 }],
          fromNodeId: targetNode._id,
          fromNodeName: targetNode.name || '',
          autoRetreatPercent: 40,
          status: 'retreated',
          isInitiator: false,
          isReinforcement: true,
          requestedAt: oldDate,
          arriveAt: oldDate,
          joinedAt: oldDate,
          createdAt: oldDate,
          updatedAt: oldDate
        }
      },
      { upsert: true, timestamps: false }
    ),
    ScheduledTask.updateOne(
      { dedupeKey: `${TASK_DEDUPE_PREFIX}${profileName}_cleanup_now` },
      {
        $set: {
          type: 'maintenance_cleanup_tick',
          runAt: new Date(),
          status: 'ready',
          payload: { marker: MARKER, profile: profileName },
          lockOwner: '',
          lockedUntil: null,
          attempts: 0,
          lastError: ''
        }
      },
      { upsert: true }
    )
  ]);

  return {
    enabled: true,
    oldDays
  };
};

const run = async () => {
  await connectDB();

  if (shouldReset) {
    console.log(`[seed] reset marker=${MARKER} ...`);
    await cleanupSeedData();
  }

  console.log(`[seed] profile=${profileName} start`);
  const { admins, commons } = await buildUsers();
  console.log(`[seed] users created admins=${admins.length} commons=${commons.length}`);

  const { alliances, allianceByKey, allianceMembership } = await buildAlliances(commons);
  console.log(`[seed] alliances created count=${alliances.length}`);

  const allianceByUserId = new Map();
  allianceMembership.forEach((membership) => {
    const alliance = allianceByKey.get(membership.key);
    membership.members.forEach((user) => {
      allianceByUserId.set(String(user._id), alliance?._id || null);
    });
  });

  const nodes = await buildNodes({ commonUsers: commons, allianceByUserId });
  console.log(`[seed] nodes created count=${nodes.length}`);

  await updateUserLocations({ commonUsers: commons, nodes });
  await buildNodeSenses({ nodes, users: commons });
  console.log(`[seed] node senses created count=${nodes.length * config.sensesPerNode}`);

  const siegeInfo = await createSiegeDataset({ nodes, allianceMembership });
  const distributionInfo = await createDistributionDataset({ nodes, allianceMembership });
  await createScheduledTasks();
  const sleepTaskMs = await createSleepLeaseTask();
  const cleanupFixtureInfo = await createCleanupFixtures({ nodes, commons, alliances });

  const notificationCount = await Notification.countDocuments({
    userId: { $in: commons.slice(0, 10).map((item) => item._id) },
    type: 'alliance_announcement'
  });

  console.log('[seed] done');
  console.log(JSON.stringify({
    marker: MARKER,
    profile: profileName,
    users: {
      admins: admins.length,
      commons: commons.length,
      total: admins.length + commons.length
    },
    alliances: alliances.length,
    nodes: nodes.length,
    nodeSenses: nodes.length * config.sensesPerNode,
    siege: siegeInfo,
    distribution: distributionInfo,
    leaseTask: sleepTaskMs ? { sleepTaskMs } : null,
    cleanupFixtures: cleanupFixtureInfo,
    sanity: {
      allianceAnnouncementNotificationsInSampleUsers: notificationCount
    }
  }, null, 2));
};

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[seed] failed:', error);
    try {
      await mongoose.connection.close();
    } catch (closeError) {
      // ignore close error
    }
    process.exit(1);
  });
