const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Node = require('../models/Node');
const Notification = require('../models/Notification');
const UserInboxState = require('../models/UserInboxState');
const DistributionParticipant = require('../models/DistributionParticipant');
const NodeSense = require('../models/NodeSense');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DomainSiegeState = require('../models/DomainSiegeState');
const DomainTitleProjection = require('../models/DomainTitleProjection');
const DomainTitleRelation = require('../models/DomainTitleRelation');
const { normalizeSenseList } = require('../services/nodeSenseStore');
const {
  createDefaultDefenseLayout,
  createDefaultSiegeState,
  hasLegacyDefenseLayoutData,
  hasLegacySiegeStateData,
  normalizeDefenseLayout,
  normalizeSiegeState
} = require('../services/domainTitleStateStore');
const {
  syncDomainTitleProjectionFromNode,
  normalizeTitleProjectionFromNode,
  normalizeAssociationsForProjection
} = require('../services/domainTitleProjectionStore');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

const DEFAULTS = {
  mode: 'migrate-verify',
  strict: true,
  verifyBaseline: 'auto',
  resetTarget: false,
  clearLegacyNotifications: false,
  clearLegacyParticipants: false,
  clearLegacyNodeSenses: false,
  clearLegacyTitleStates: false,
  userBatchSize: 200,
  nodeBatchSize: 200,
  bulkOpLimit: 1000,
  verifySampleUsers: 120,
  verifySampleSessions: 120,
  verifySampleNodes: 120,
  verifySampleTitleStates: 120,
  verifySampleTitleProjections: 120,
  verifySampleAllianceCanonical: 120
};

const parseCliArgs = (argv = []) => {
  const parsed = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) {
      parsed[raw.slice(2)] = 'true';
      continue;
    }
    const key = raw.slice(2, eqIdx);
    const value = raw.slice(eqIdx + 1);
    parsed[key] = value;
  }
  return parsed;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
};

const parseInteger = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeVerifyBaseline = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'legacy') return 'legacy';
  if (text === 'new') return 'new';
  return 'auto';
};

const getRuntimeOptions = () => {
  const args = parseCliArgs(process.argv.slice(2));
  return {
    mode: String(args.mode || process.env.MIGRATE_MODE || DEFAULTS.mode),
    strict: parseBoolean(args.strict ?? process.env.MIGRATE_STRICT, DEFAULTS.strict),
    verifyBaseline: normalizeVerifyBaseline(
      args['verify-baseline'] ?? process.env.VERIFY_BASELINE ?? DEFAULTS.verifyBaseline
    ),
    resetTarget: parseBoolean(args['reset-target'] ?? process.env.RESET_TARGET_COLLECTIONS, DEFAULTS.resetTarget),
    clearLegacyNotifications: parseBoolean(
      args['clear-legacy-notifications'] ?? process.env.CLEAR_LEGACY_NOTIFICATIONS,
      DEFAULTS.clearLegacyNotifications
    ),
    clearLegacyParticipants: parseBoolean(
      args['clear-legacy-participants'] ?? process.env.CLEAR_LEGACY_DISTRIBUTION_PARTICIPANTS,
      DEFAULTS.clearLegacyParticipants
    ),
    clearLegacyNodeSenses: parseBoolean(
      args['clear-legacy-node-senses'] ?? process.env.CLEAR_LEGACY_NODE_SENSES,
      DEFAULTS.clearLegacyNodeSenses
    ),
    clearLegacyTitleStates: parseBoolean(
      args['clear-legacy-title-states'] ?? process.env.CLEAR_LEGACY_TITLE_STATES,
      DEFAULTS.clearLegacyTitleStates
    ),
    userBatchSize: parseInteger(args['user-batch-size'] ?? process.env.MIGRATE_USER_BATCH_SIZE, DEFAULTS.userBatchSize),
    nodeBatchSize: parseInteger(args['node-batch-size'] ?? process.env.MIGRATE_NODE_BATCH_SIZE, DEFAULTS.nodeBatchSize),
    bulkOpLimit: parseInteger(args['bulk-op-limit'] ?? process.env.MIGRATE_BULK_OP_LIMIT, DEFAULTS.bulkOpLimit),
    verifySampleUsers: parseInteger(args['verify-sample-users'] ?? process.env.VERIFY_SAMPLE_USERS, DEFAULTS.verifySampleUsers),
    verifySampleSessions: parseInteger(
      args['verify-sample-sessions'] ?? process.env.VERIFY_SAMPLE_SESSIONS,
      DEFAULTS.verifySampleSessions
    ),
    verifySampleNodes: parseInteger(
      args['verify-sample-nodes'] ?? process.env.VERIFY_SAMPLE_NODES,
      DEFAULTS.verifySampleNodes
    ),
    verifySampleTitleStates: parseInteger(
      args['verify-sample-title-states'] ?? process.env.VERIFY_SAMPLE_TITLE_STATES,
      DEFAULTS.verifySampleTitleStates
    ),
    verifySampleTitleProjections: parseInteger(
      args['verify-sample-title-projections'] ?? process.env.VERIFY_SAMPLE_TITLE_PROJECTIONS,
      DEFAULTS.verifySampleTitleProjections
    ),
    verifySampleAllianceCanonical: parseInteger(
      args['verify-sample-alliance-canonical'] ?? process.env.VERIFY_SAMPLE_ALLIANCE_CANONICAL,
      DEFAULTS.verifySampleAllianceCanonical
    )
  };
};

const nowIso = () => new Date().toISOString();

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const getIdString = (value) => {
  const id = toObjectIdOrNull(value);
  return id ? String(id) : '';
};

const toValidDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const toDateMs = (value) => {
  const date = toValidDateOrNull(value);
  return date ? date.getTime() : 0;
};

const dateEqual = (a, b) => {
  const ams = toDateMs(a);
  const bms = toDateMs(b);
  return ams === bms;
};

const normalizeLegacyNotification = (userId, notification = {}) => {
  const source = typeof notification.toObject === 'function' ? notification.toObject() : notification;
  const notificationId = toObjectIdOrNull(source?._id) || new mongoose.Types.ObjectId();
  const createdAt = toValidDateOrNull(source?.createdAt) || new Date();
  const respondedAt = toValidDateOrNull(source?.respondedAt);
  return {
    _id: notificationId,
    userId,
    type: typeof source?.type === 'string' ? source.type : 'info',
    title: typeof source?.title === 'string' ? source.title : '',
    message: typeof source?.message === 'string' ? source.message : '',
    read: !!source?.read,
    status: typeof source?.status === 'string' ? source.status : 'info',
    nodeId: toObjectIdOrNull(source?.nodeId),
    nodeName: typeof source?.nodeName === 'string' ? source.nodeName : '',
    allianceId: toObjectIdOrNull(source?.allianceId),
    allianceName: typeof source?.allianceName === 'string' ? source.allianceName : '',
    inviterId: toObjectIdOrNull(source?.inviterId),
    inviterUsername: typeof source?.inviterUsername === 'string' ? source.inviterUsername : '',
    inviteeId: toObjectIdOrNull(source?.inviteeId),
    inviteeUsername: typeof source?.inviteeUsername === 'string' ? source.inviteeUsername : '',
    applicationReason: typeof source?.applicationReason === 'string' ? source.applicationReason : '',
    requiresArrival: !!source?.requiresArrival,
    respondedAt,
    createdAt
  };
};

const buildInboxStateFromNotifications = (notifications = []) => {
  let unreadCount = 0;
  let lastNotificationAt = null;
  for (const item of notifications) {
    if (!item?.read) unreadCount += 1;
    const createdAt = toValidDateOrNull(item?.createdAt);
    if (createdAt && (!lastNotificationAt || createdAt > lastNotificationAt)) {
      lastNotificationAt = createdAt;
    }
  }
  return {
    unreadCount,
    lastNotificationAt
  };
};

const normalizeLegacyParticipant = ({ executeAt, row }) => {
  const userId = toObjectIdOrNull(row?.userId);
  if (!userId) return null;
  const joinedAt = toValidDateOrNull(row?.joinedAt) || executeAt;
  const exitedAt = toValidDateOrNull(row?.exitedAt);
  return {
    userId,
    joinedAt,
    exitedAt: exitedAt || null
  };
};

const normalizeEmbeddedSensesWithoutFallback = (source = []) => {
  const rows = Array.isArray(source) ? source : [];
  const deduped = [];
  const seenIds = new Set();
  const seenTitles = new Set();

  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i] || {};
    const rawSenseId = typeof item?.senseId === 'string' ? item.senseId.trim() : '';
    const senseId = rawSenseId || `sense_${i + 1}`;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!title || !content) continue;
    const titleKey = title.toLowerCase();
    if (seenIds.has(senseId) || seenTitles.has(titleKey)) continue;
    seenIds.add(senseId);
    seenTitles.add(titleKey);
    deduped.push({
      senseId,
      title,
      content
    });
  }
  return deduped;
};

const logStep = (message, extra = null) => {
  if (extra === null || extra === undefined) {
    console.log(`[${nowIso()}] ${message}`);
    return;
  }
  console.log(`[${nowIso()}] ${message}`, extra);
};

const resetTargetCollections = async () => {
  logStep('开始清空目标集合（reset-target=true）');
  const [nResult, iResult, pResult, sResult, dResult, gResult, tResult, rResult] = await Promise.all([
    Notification.deleteMany({}),
    UserInboxState.deleteMany({}),
    DistributionParticipant.deleteMany({}),
    NodeSense.deleteMany({}),
    DomainDefenseLayout.deleteMany({}),
    DomainSiegeState.deleteMany({}),
    DomainTitleProjection.deleteMany({}),
    DomainTitleRelation.deleteMany({})
  ]);
  return {
    notificationsDeleted: nResult?.deletedCount || 0,
    inboxStatesDeleted: iResult?.deletedCount || 0,
    distributionParticipantsDeleted: pResult?.deletedCount || 0,
    nodeSensesDeleted: sResult?.deletedCount || 0,
    domainDefenseLayoutsDeleted: dResult?.deletedCount || 0,
    domainSiegeStatesDeleted: gResult?.deletedCount || 0,
    domainTitleProjectionsDeleted: tResult?.deletedCount || 0,
    domainTitleRelationsDeleted: rResult?.deletedCount || 0
  };
};

const migrateNotifications = async ({ userBatchSize, bulkOpLimit }) => {
  logStep('开始迁移通知与收件箱状态');
  const metrics = {
    usersScanned: 0,
    usersWithLegacyNotifications: 0,
    legacyNotificationRows: 0,
    notificationUpserts: 0,
    notificationUpdates: 0,
    inboxUpserts: 0,
    inboxUpdates: 0
  };

  const cursor = User.find({})
    .select('_id notifications')
    .lean()
    .cursor({ batchSize: userBatchSize });

  let notificationOps = [];
  let inboxOps = [];

  const flushNotifications = async () => {
    if (notificationOps.length === 0) return;
    const result = await Notification.bulkWrite(notificationOps, { ordered: false });
    metrics.notificationUpserts += result?.upsertedCount || 0;
    metrics.notificationUpdates += result?.modifiedCount || 0;
    notificationOps = [];
  };

  const flushInbox = async () => {
    if (inboxOps.length === 0) return;
    const result = await UserInboxState.bulkWrite(inboxOps, { ordered: false });
    metrics.inboxUpserts += result?.upsertedCount || 0;
    metrics.inboxUpdates += result?.modifiedCount || 0;
    inboxOps = [];
  };

  const reconcileInboxStateFromNotificationCollection = async () => {
    const aggregateCursor = Notification.aggregate([
      {
        $group: {
          _id: '$userId',
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ['$read', false] }, 1, 0]
            }
          },
          lastNotificationAt: { $max: '$createdAt' }
        }
      }
    ])
      .allowDiskUse(true)
      .cursor({ batchSize: userBatchSize });

    let ops = [];
    let usersWithNotifications = 0;
    let upserts = 0;
    let updates = 0;

    const flush = async () => {
      if (ops.length === 0) return;
      const result = await UserInboxState.bulkWrite(ops, { ordered: false });
      upserts += result?.upsertedCount || 0;
      updates += result?.modifiedCount || 0;
      ops = [];
    };

    for await (const row of aggregateCursor) {
      const userId = toObjectIdOrNull(row?._id);
      if (!userId) continue;
      usersWithNotifications += 1;
      ops.push({
        updateOne: {
          filter: { userId },
          update: {
            $set: {
              unreadCount: Math.max(0, parseInt(row?.unreadCount, 10) || 0),
              lastNotificationAt: toValidDateOrNull(row?.lastNotificationAt)
            }
          },
          upsert: true
        }
      });

      if (ops.length >= bulkOpLimit) {
        await flush();
      }
    }

    await flush();
    return {
      usersWithNotifications,
      inboxUpsertsFromCollection: upserts,
      inboxUpdatesFromCollection: updates
    };
  };

  for await (const user of cursor) {
    const userId = toObjectIdOrNull(user?._id);
    if (!userId) continue;
    metrics.usersScanned += 1;

    const legacyNotifications = Array.isArray(user?.notifications) ? user.notifications : [];
    if (legacyNotifications.length > 0) metrics.usersWithLegacyNotifications += 1;
    metrics.legacyNotificationRows += legacyNotifications.length;

    const normalizedRows = legacyNotifications.map((item) => normalizeLegacyNotification(userId, item));
    for (const row of normalizedRows) {
      notificationOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: row },
          upsert: true
        }
      });
    }

    const inboxState = buildInboxStateFromNotifications(normalizedRows);
    inboxOps.push({
      updateOne: {
        filter: { userId },
        update: {
          $set: {
            unreadCount: inboxState.unreadCount,
            lastNotificationAt: inboxState.lastNotificationAt
          }
        },
        upsert: true
      }
    });

    if (notificationOps.length >= bulkOpLimit) {
      await flushNotifications();
    }
    if (inboxOps.length >= bulkOpLimit) {
      await flushInbox();
    }
  }

  await flushNotifications();
  await flushInbox();
  const reconciliation = await reconcileInboxStateFromNotificationCollection();
  metrics.inboxUpserts += reconciliation.inboxUpsertsFromCollection;
  metrics.inboxUpdates += reconciliation.inboxUpdatesFromCollection;
  metrics.usersWithNotificationCollectionRows = reconciliation.usersWithNotifications;

  return metrics;
};

const migrateDistributionParticipants = async ({ nodeBatchSize, bulkOpLimit }) => {
  logStep('开始迁移分发参与者');
  const metrics = {
    nodesScanned: 0,
    nodesWithLegacyParticipants: 0,
    legacyParticipantRows: 0,
    dedupedParticipantRows: 0,
    participantUpserts: 0,
    participantUpdates: 0
  };

  const cursor = Node.find({
    status: 'approved',
    knowledgeDistributionLocked: { $ne: null }
  })
    .select('_id knowledgeDistributionLocked')
    .lean()
    .cursor({ batchSize: nodeBatchSize });

  let participantOps = [];

  const flushParticipants = async () => {
    if (participantOps.length === 0) return;
    const result = await DistributionParticipant.bulkWrite(participantOps, { ordered: false });
    metrics.participantUpserts += result?.upsertedCount || 0;
    metrics.participantUpdates += result?.modifiedCount || 0;
    participantOps = [];
  };

  for await (const node of cursor) {
    metrics.nodesScanned += 1;
    const lock = node?.knowledgeDistributionLocked;
    const executeAt = toValidDateOrNull(lock?.executeAt);
    if (!executeAt) continue;

    const participants = Array.isArray(lock?.participants) ? lock.participants : [];
    if (participants.length > 0) metrics.nodesWithLegacyParticipants += 1;

    const dedupMap = new Map();
    for (const row of participants) {
      metrics.legacyParticipantRows += 1;
      const normalized = normalizeLegacyParticipant({ executeAt, row });
      if (!normalized) continue;
      dedupMap.set(String(normalized.userId), normalized);
    }
    metrics.dedupedParticipantRows += dedupMap.size;

    for (const normalized of dedupMap.values()) {
      participantOps.push({
        updateOne: {
          filter: {
            nodeId: node._id,
            executeAt,
            userId: normalized.userId
          },
          update: {
            $set: {
              joinedAt: normalized.joinedAt,
              exitedAt: normalized.exitedAt
            }
          },
          upsert: true
        }
      });
    }

    if (participantOps.length >= bulkOpLimit) {
      await flushParticipants();
    }
  }

  await flushParticipants();
  return metrics;
};

const migrateNodeSenses = async ({ nodeBatchSize, bulkOpLimit }) => {
  logStep('开始迁移节点释义到独立集合');
  const metrics = {
    nodesScanned: 0,
    normalizedSenseRows: 0,
    senseUpserts: 0,
    senseUpdates: 0,
    deletedRows: 0
  };

  const cursor = Node.find({})
    .select('_id synonymSenses description domainMaster owner')
    .lean()
    .cursor({ batchSize: nodeBatchSize });

  for await (const node of cursor) {
    metrics.nodesScanned += 1;
    const embedded = normalizeEmbeddedSensesWithoutFallback(node?.synonymSenses || []);
    let normalized = embedded;
    if (normalized.length === 0) {
      const existingRows = await NodeSense.find({
        nodeId: node._id,
        status: 'active'
      })
        .select('senseId title content order')
        .sort({ order: 1, senseId: 1, _id: 1 })
        .lean();
      if (existingRows.length > 0) {
        normalized = existingRows.map((row) => ({
          senseId: String(row.senseId || '').trim(),
          title: String(row.title || '').trim(),
          content: String(row.content || '').trim()
        })).filter((row) => row.senseId && row.title && row.content);
      } else {
        normalized = normalizeSenseList([], node?.description || '');
      }
    }
    metrics.normalizedSenseRows += normalized.length;

    const actorId = toObjectIdOrNull(node?.domainMaster) || toObjectIdOrNull(node?.owner) || null;
    const ops = normalized.map((sense, index) => ({
      updateOne: {
        filter: {
          nodeId: node._id,
          senseId: sense.senseId
        },
        update: {
          $set: {
            title: sense.title,
            content: sense.content,
            order: index,
            status: 'active',
            updatedBy: actorId
          },
          $setOnInsert: {
            createdBy: actorId
          }
        },
        upsert: true
      }
    }));

    if (ops.length > 0) {
      const result = await NodeSense.bulkWrite(ops, { ordered: false });
      metrics.senseUpserts += result?.upsertedCount || 0;
      metrics.senseUpdates += result?.modifiedCount || 0;
    }

    const keepIds = normalized.map((item) => item.senseId);
    const deleteResult = await NodeSense.deleteMany({
      nodeId: node._id,
      senseId: { $nin: keepIds }
    });
    metrics.deletedRows += deleteResult?.deletedCount || 0;
  }

  return metrics;
};

const migrateDomainTitleStates = async ({ nodeBatchSize, bulkOpLimit }) => {
  logStep('开始迁移标题层状态（城防布局/围城状态）');
  const metrics = {
    nodesScanned: 0,
    nodesWithLegacyDefenseLayout: 0,
    nodesWithLegacySiegeState: 0,
    defenseUpserts: 0,
    defenseUpdates: 0,
    siegeUpserts: 0,
    siegeUpdates: 0
  };

  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        owner: 1,
        domainMaster: 1,
        cityDefenseLayout: 1,
        citySiegeState: 1
      }
    }
  ).batchSize(nodeBatchSize);

  let nodeBatch = [];

  const flushBatch = async () => {
    if (nodeBatch.length === 0) return;
    const nodeIds = nodeBatch.map((item) => item?._id).filter(Boolean);
    const [existingDefenseRows, existingSiegeRows] = await Promise.all([
      DomainDefenseLayout.find({ nodeId: { $in: nodeIds } })
        .select('nodeId buildings intelBuildingId gateDefense gateDefenseViewAdminIds updatedAt')
        .lean(),
      DomainSiegeState.find({ nodeId: { $in: nodeIds } })
        .select('nodeId cheng qi')
        .lean()
    ]);
    const existingDefenseMap = new Map(existingDefenseRows.map((item) => [String(item.nodeId), item]));
    const existingSiegeMap = new Map(existingSiegeRows.map((item) => [String(item.nodeId), item]));

    const defenseOps = [];
    const siegeOps = [];

    for (const node of nodeBatch) {
      metrics.nodesScanned += 1;
      const nodeId = node?._id;
      if (!nodeId) continue;
      const key = String(nodeId);
      const actorId = toObjectIdOrNull(node?.domainMaster) || toObjectIdOrNull(node?.owner) || null;

      let nextDefenseLayout;
      if (hasLegacyDefenseLayoutData(node)) {
        metrics.nodesWithLegacyDefenseLayout += 1;
        nextDefenseLayout = normalizeDefenseLayout(node?.cityDefenseLayout);
      } else if (existingDefenseMap.has(key)) {
        nextDefenseLayout = normalizeDefenseLayout(existingDefenseMap.get(key));
      } else {
        nextDefenseLayout = createDefaultDefenseLayout();
      }
      defenseOps.push({
        updateOne: {
          filter: { nodeId },
          update: {
            $set: {
              buildings: nextDefenseLayout.buildings,
              intelBuildingId: nextDefenseLayout.intelBuildingId,
              gateDefense: nextDefenseLayout.gateDefense,
              gateDefenseViewAdminIds: nextDefenseLayout.gateDefenseViewAdminIds,
              updatedAt: nextDefenseLayout.updatedAt || new Date(),
              updatedBy: actorId
            }
          },
          upsert: true
        }
      });

      let nextSiegeState;
      if (hasLegacySiegeStateData(node)) {
        metrics.nodesWithLegacySiegeState += 1;
        nextSiegeState = normalizeSiegeState(node?.citySiegeState);
      } else if (existingSiegeMap.has(key)) {
        nextSiegeState = normalizeSiegeState(existingSiegeMap.get(key));
      } else {
        nextSiegeState = createDefaultSiegeState();
      }
      siegeOps.push({
        updateOne: {
          filter: { nodeId },
          update: {
            $set: {
              cheng: nextSiegeState.cheng,
              qi: nextSiegeState.qi,
              updatedAt: new Date(),
              updatedBy: actorId
            }
          },
          upsert: true
        }
      });
    }

    if (defenseOps.length > 0) {
      const chunks = [];
      for (let i = 0; i < defenseOps.length; i += bulkOpLimit) {
        chunks.push(defenseOps.slice(i, i + bulkOpLimit));
      }
      for (const chunk of chunks) {
        const result = await DomainDefenseLayout.bulkWrite(chunk, { ordered: false });
        metrics.defenseUpserts += result?.upsertedCount || 0;
        metrics.defenseUpdates += result?.modifiedCount || 0;
      }
    }
    if (siegeOps.length > 0) {
      const chunks = [];
      for (let i = 0; i < siegeOps.length; i += bulkOpLimit) {
        chunks.push(siegeOps.slice(i, i + bulkOpLimit));
      }
      for (const chunk of chunks) {
        const result = await DomainSiegeState.bulkWrite(chunk, { ordered: false });
        metrics.siegeUpserts += result?.upsertedCount || 0;
        metrics.siegeUpdates += result?.modifiedCount || 0;
      }
    }

    nodeBatch = [];
  };

  for await (const node of cursor) {
    nodeBatch.push(node);
    if (nodeBatch.length >= nodeBatchSize) {
      await flushBatch();
    }
  }
  await flushBatch();
  return metrics;
};

const migrateDomainTitleProjection = async ({ nodeBatchSize }) => {
  logStep('开始迁移标题投影与标题关系');
  const metrics = {
    nodesScanned: 0,
    normalizedRelationRows: 0,
    projectionUpserts: 0,
    projectionUpdates: 0,
    relationUpserts: 0,
    relationUpdates: 0,
    relationDeletes: 0
  };

  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        owner: 1,
        domainMaster: 1,
        domainAdmins: 1,
        allianceId: 1,
        name: 1,
        description: 1,
        relatedParentDomains: 1,
        relatedChildDomains: 1,
        contentScore: 1,
        knowledgePoint: 1,
        status: 1,
        isFeatured: 1,
        featuredOrder: 1,
        createdAt: 1,
        lastUpdate: 1,
        associations: 1
      }
    }
  ).batchSize(nodeBatchSize);

  for await (const node of cursor) {
    metrics.nodesScanned += 1;
    metrics.normalizedRelationRows += normalizeAssociationsForProjection(node?.associations).length;
    const result = await syncDomainTitleProjectionFromNode(node);
    metrics.projectionUpserts += result?.projectionResult?.upserted || 0;
    metrics.projectionUpdates += result?.projectionResult?.modified || 0;
    metrics.relationUpserts += result?.relationResult?.upserted || 0;
    metrics.relationUpdates += result?.relationResult?.modified || 0;
    metrics.relationDeletes += result?.relationResult?.deleted || 0;
  }

  return metrics;
};

const migrateDomainAllianceCanonical = async ({ nodeBatchSize, bulkOpLimit }) => {
  logStep('开始迁移标题-熵盟归属到 Node.allianceId（按 domainMaster 用户归属）');
  const metrics = {
    nodesScanned: 0,
    nodesUpdated: 0,
    nodesAlreadyConsistent: 0,
    nodesMissingMasterUser: 0,
    userRowsLoaded: 0
  };

  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        domainMaster: 1,
        allianceId: 1
      }
    }
  ).batchSize(nodeBatchSize);

  let nodeBatch = [];

  const flushBatch = async () => {
    if (nodeBatch.length === 0) return;
    const masterIds = Array.from(new Set(
      nodeBatch
        .map((item) => getIdString(item?.domainMaster))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )).map((id) => new mongoose.Types.ObjectId(id));

    const masterRows = masterIds.length > 0
      ? await User.find({ _id: { $in: masterIds } }).select('_id allianceId').lean()
      : [];
    metrics.userRowsLoaded += masterRows.length;
    const masterAllianceMap = new Map(masterRows.map((row) => [getIdString(row?._id), row?.allianceId || null]));

    const ops = [];
    for (const node of nodeBatch) {
      metrics.nodesScanned += 1;
      const masterId = getIdString(node?.domainMaster);
      const expectedAllianceId = masterId ? (masterAllianceMap.get(masterId) || null) : null;
      if (masterId && !masterAllianceMap.has(masterId)) {
        metrics.nodesMissingMasterUser += 1;
      }
      if (getIdString(node?.allianceId) === getIdString(expectedAllianceId)) {
        metrics.nodesAlreadyConsistent += 1;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: node._id },
          update: {
            $set: {
              allianceId: expectedAllianceId
            }
          }
        }
      });
    }

    if (ops.length > 0) {
      for (let i = 0; i < ops.length; i += bulkOpLimit) {
        const chunk = ops.slice(i, i + bulkOpLimit);
        const result = await Node.bulkWrite(chunk, { ordered: false });
        metrics.nodesUpdated += (result?.modifiedCount || 0) + (result?.upsertedCount || 0);
      }
    }

    nodeBatch = [];
  };

  for await (const node of cursor) {
    nodeBatch.push(node);
    if (nodeBatch.length >= nodeBatchSize) {
      await flushBatch();
    }
  }
  await flushBatch();
  return metrics;
};

const buildLegacyNotificationGlobalSummary = async () => {
  const rows = await User.aggregate([
    {
      $project: {
        total: { $size: { $ifNull: ['$notifications', []] } },
        unread: {
          $size: {
            $filter: {
              input: { $ifNull: ['$notifications', []] },
              as: 'n',
              cond: { $eq: ['$$n.read', false] }
            }
          }
        },
        latestCreatedAt: { $max: '$notifications.createdAt' }
      }
    },
    {
      $group: {
        _id: null,
        users: { $sum: 1 },
        total: { $sum: '$total' },
        unread: { $sum: '$unread' },
        latestCreatedAt: { $max: '$latestCreatedAt' }
      }
    }
  ]).allowDiskUse(true);

  return rows[0] || {
    users: 0,
    total: 0,
    unread: 0,
    latestCreatedAt: null
  };
};

const buildNewNotificationGlobalSummary = async () => {
  const [total, unread, latestRow, inboxAggregate] = await Promise.all([
    Notification.countDocuments({}),
    Notification.countDocuments({ read: false }),
    Notification.findOne({}).sort({ createdAt: -1 }).select('createdAt').lean(),
    UserInboxState.aggregate([
      {
        $group: {
          _id: null,
          users: { $sum: 1 },
          unread: { $sum: '$unreadCount' },
          latestCreatedAt: { $max: '$lastNotificationAt' }
        }
      }
    ])
  ]);

  const inbox = inboxAggregate[0] || {
    users: 0,
    unread: 0,
    latestCreatedAt: null
  };

  return {
    total,
    unread,
    latestCreatedAt: latestRow?.createdAt || null,
    inboxUsers: inbox.users || 0,
    inboxUnread: inbox.unread || 0,
    inboxLatestCreatedAt: inbox.latestCreatedAt || null
  };
};

const buildLegacyParticipantGlobalSummary = async () => {
  const rows = await Node.aggregate([
    {
      $match: {
        status: 'approved',
        'knowledgeDistributionLocked.executeAt': { $type: 'date' }
      }
    },
    {
      $project: {
        nodeId: '$_id',
        executeAt: '$knowledgeDistributionLocked.executeAt',
        participants: { $ifNull: ['$knowledgeDistributionLocked.participants', []] }
      }
    },
    { $unwind: { path: '$participants', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        nodeId: 1,
        executeAt: 1,
        userIdObj: {
          $convert: {
            input: '$participants.userId',
            to: 'objectId',
            onError: null,
            onNull: null
          }
        }
      }
    },
    { $match: { userIdObj: { $ne: null } } },
    {
      $group: {
        _id: {
          nodeId: '$nodeId',
          executeAt: '$executeAt',
          userId: '$userIdObj'
        },
        duplicateRows: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        dedupedRows: { $sum: 1 },
        rawRows: { $sum: '$duplicateRows' }
      }
    }
  ]).allowDiskUse(true);

  return rows[0] || {
    dedupedRows: 0,
    rawRows: 0
  };
};

const buildNewParticipantGlobalSummary = async () => {
  const [rows, sessions] = await Promise.all([
    DistributionParticipant.countDocuments({}),
    DistributionParticipant.aggregate([
      { $group: { _id: { nodeId: '$nodeId', executeAt: '$executeAt' } } },
      { $count: 'count' }
    ])
  ]);

  return {
    rows,
    sessions: sessions[0]?.count || 0
  };
};

const buildLegacyNodeSenseGlobalSummary = async () => {
  const cursor = Node.find({})
    .select('_id synonymSenses description')
    .lean()
    .cursor({ batchSize: 200 });

  let nodes = 0;
  let rows = 0;
  for await (const node of cursor) {
    nodes += 1;
    const senses = normalizeEmbeddedSensesWithoutFallback(node?.synonymSenses || []);
    rows += senses.length;
  }
  return { nodes, rows };
};

const buildNewNodeSenseGlobalSummary = async () => {
  const [rows, nodes] = await Promise.all([
    NodeSense.countDocuments({ status: 'active' }),
    NodeSense.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$nodeId' } },
      { $count: 'count' }
    ])
  ]);
  return {
    rows,
    nodes: nodes[0]?.count || 0
  };
};

const pickNodeSenseSampleNodes = async (limit) => {
  const withEmbedded = await Node.find({ 'synonymSenses.0': { $exists: true } })
    .select('_id synonymSenses description')
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  if (withEmbedded.length >= limit) return withEmbedded;
  return withEmbedded;
};

const verifyNodeSenseSamples = async ({ sampleSize }) => {
  const nodes = await pickNodeSenseSampleNodes(sampleSize);
  const mismatches = [];

  for (const node of nodes) {
    const legacy = normalizeEmbeddedSensesWithoutFallback(node?.synonymSenses || []);
    const rows = await NodeSense.find({
      nodeId: node._id,
      status: 'active'
    })
      .select('senseId title content order')
      .sort({ order: 1, senseId: 1, _id: 1 })
      .lean();
    const migrated = normalizeSenseList(rows, node?.description || '');

    const localMismatch = [];
    if (legacy.length !== migrated.length) {
      localMismatch.push(`释义数量不一致 legacy=${legacy.length} new=${migrated.length}`);
    }
    const maxLen = Math.max(legacy.length, migrated.length);
    for (let i = 0; i < maxLen; i += 1) {
      const a = legacy[i];
      const b = migrated[i];
      if (!a || !b) continue;
      if (a.senseId !== b.senseId) {
        localMismatch.push(`senseId 不一致 idx=${i} legacy=${a.senseId} new=${b.senseId}`);
      }
      if (a.title !== b.title) {
        localMismatch.push(`title 不一致 senseId=${a.senseId}`);
      }
      if (a.content !== b.content) {
        localMismatch.push(`content 不一致 senseId=${a.senseId}`);
      }
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(node._id),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledNodes: nodes.length,
    mismatchedNodes: mismatches.length,
    mismatchDetails: mismatches
  };
};

const verifyNodeSenseSamplesNewOnly = async ({ sampleSize }) => {
  const grouped = await NodeSense.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$nodeId' } },
    { $sort: { _id: 1 } },
    { $limit: sampleSize }
  ]);
  const nodeIds = grouped.map((item) => toObjectIdOrNull(item?._id)).filter(Boolean);
  const mismatches = [];

  for (const nodeId of nodeIds) {
    const rows = await NodeSense.find({
      nodeId,
      status: 'active'
    })
      .select('senseId title content order')
      .sort({ order: 1, senseId: 1, _id: 1 })
      .lean();

    const idSet = new Set();
    const titleSet = new Set();
    const localMismatch = [];
    rows.forEach((row) => {
      const senseId = String(row?.senseId || '').trim();
      const title = String(row?.title || '').trim();
      const content = String(row?.content || '').trim();
      if (!senseId) {
        localMismatch.push('存在空 senseId');
      } else if (idSet.has(senseId)) {
        localMismatch.push(`senseId 重复 ${senseId}`);
      } else {
        idSet.add(senseId);
      }
      if (!title) {
        localMismatch.push(`title 为空 senseId=${senseId || 'unknown'}`);
      } else {
        const titleKey = title.toLowerCase();
        if (titleSet.has(titleKey)) {
          localMismatch.push(`title 重复 ${title}`);
        } else {
          titleSet.add(titleKey);
        }
      }
      if (!content) {
        localMismatch.push(`content 为空 senseId=${senseId || 'unknown'}`);
      }
    });

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(nodeId),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledNodes: nodeIds.length,
    mismatchedNodes: mismatches.length,
    mismatchDetails: mismatches
  };
};

const normalizeDefenseLayoutForCompare = (source = {}) => {
  const normalized = normalizeDefenseLayout(source || {});
  const buildingRows = (Array.isArray(normalized?.buildings) ? normalized.buildings : [])
    .map((item) => ({
      buildingId: String(item?.buildingId || ''),
      name: String(item?.name || ''),
      x: Number(Number(item?.x || 0).toFixed(3)),
      y: Number(Number(item?.y || 0).toFixed(3)),
      radius: Number(Number(item?.radius || 0).toFixed(3)),
      level: Math.max(1, Math.floor(Number(item?.level) || 1)),
      nextUnitTypeId: String(item?.nextUnitTypeId || ''),
      upgradeCostKP: Number.isFinite(Number(item?.upgradeCostKP))
        ? Number(Number(item?.upgradeCostKP).toFixed(2))
        : null
    }))
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  const gateDefense = ['cheng', 'qi'].reduce((acc, gateKey) => {
    const rows = Array.isArray(normalized?.gateDefense?.[gateKey])
      ? normalized.gateDefense[gateKey]
      : [];
    acc[gateKey] = rows
      .map((row) => ({
        unitTypeId: String(row?.unitTypeId || ''),
        count: Math.max(0, Math.floor(Number(row?.count) || 0))
      }))
      .filter((row) => row.unitTypeId && row.count > 0)
      .sort((a, b) => a.unitTypeId.localeCompare(b.unitTypeId));
    return acc;
  }, { cheng: [], qi: [] });
  return {
    buildings: buildingRows,
    intelBuildingId: String(normalized?.intelBuildingId || ''),
    gateDefense,
    gateDefenseViewAdminIds: (Array.isArray(normalized?.gateDefenseViewAdminIds)
      ? normalized.gateDefenseViewAdminIds
      : [])
      .map((item) => getIdString(item))
      .filter(Boolean)
      .sort()
  };
};

const normalizeSiegeStateForCompare = (source = {}) => {
  const normalized = normalizeSiegeState(source || {});
  const normalizeGate = (gate = {}) => ({
    active: !!gate?.active,
    startedAtMs: toDateMs(gate?.startedAt),
    updatedAtMs: toDateMs(gate?.updatedAt),
    supportNotifiedAtMs: toDateMs(gate?.supportNotifiedAt),
    attackerAllianceId: getIdString(gate?.attackerAllianceId),
    initiatorUserId: getIdString(gate?.initiatorUserId),
    initiatorUsername: String(gate?.initiatorUsername || ''),
    attackers: (Array.isArray(gate?.attackers) ? gate.attackers : [])
      .map((attacker) => ({
        userId: getIdString(attacker?.userId),
        username: String(attacker?.username || ''),
        allianceId: getIdString(attacker?.allianceId),
        units: (Array.isArray(attacker?.units) ? attacker.units : [])
          .map((unit) => ({
            unitTypeId: String(unit?.unitTypeId || ''),
            count: Math.max(0, Math.floor(Number(unit?.count) || 0))
          }))
          .filter((unit) => unit.unitTypeId && unit.count > 0)
          .sort((a, b) => a.unitTypeId.localeCompare(b.unitTypeId)),
        fromNodeId: getIdString(attacker?.fromNodeId),
        fromNodeName: String(attacker?.fromNodeName || ''),
        autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(attacker?.autoRetreatPercent) || 40))),
        status: attacker?.status === 'moving' || attacker?.status === 'retreated' ? attacker.status : 'sieging',
        isInitiator: !!attacker?.isInitiator,
        isReinforcement: !!attacker?.isReinforcement,
        requestedAtMs: toDateMs(attacker?.requestedAt),
        arriveAtMs: toDateMs(attacker?.arriveAt),
        joinedAtMs: toDateMs(attacker?.joinedAt),
        updatedAtMs: toDateMs(attacker?.updatedAt)
      }))
      .filter((attacker) => !!attacker.userId)
      .sort((a, b) => a.userId.localeCompare(b.userId))
  });

  return {
    cheng: normalizeGate(normalized?.cheng || {}),
    qi: normalizeGate(normalized?.qi || {})
  };
};

const buildLegacyTitleStateGlobalSummary = async () => {
  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        cityDefenseLayout: 1,
        citySiegeState: 1
      }
    }
  ).batchSize(200);

  let nodes = 0;
  let defenseRows = 0;
  let siegeRows = 0;

  for await (const node of cursor) {
    nodes += 1;
    if (hasLegacyDefenseLayoutData(node)) defenseRows += 1;
    if (hasLegacySiegeStateData(node)) siegeRows += 1;
  }

  return {
    nodes,
    defenseRows,
    siegeRows
  };
};

const buildNewTitleStateGlobalSummary = async () => {
  const [defenseRows, siegeRows] = await Promise.all([
    DomainDefenseLayout.countDocuments({}),
    DomainSiegeState.countDocuments({})
  ]);
  return {
    defenseRows,
    siegeRows
  };
};

const pickTitleStateSampleNodes = async (limit) => {
  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        cityDefenseLayout: 1,
        citySiegeState: 1
      }
    }
  ).batchSize(200);
  const rows = [];
  for await (const node of cursor) {
    if (!hasLegacyDefenseLayoutData(node) && !hasLegacySiegeStateData(node)) continue;
    rows.push(node);
    if (rows.length >= limit) break;
  }
  return rows;
};

const verifyTitleStateSamples = async ({ sampleSize }) => {
  const nodes = await pickTitleStateSampleNodes(sampleSize);
  const mismatches = [];

  for (const node of nodes) {
    const nodeId = toObjectIdOrNull(node?._id);
    if (!nodeId) continue;
    const [defenseRow, siegeRow] = await Promise.all([
      DomainDefenseLayout.findOne({ nodeId }).select('buildings intelBuildingId gateDefense gateDefenseViewAdminIds updatedAt').lean(),
      DomainSiegeState.findOne({ nodeId }).select('cheng qi').lean()
    ]);

    const localMismatch = [];

    if (hasLegacyDefenseLayoutData(node)) {
      if (!defenseRow) {
        localMismatch.push('缺失城防布局集合行');
      } else {
        const legacyDefense = normalizeDefenseLayoutForCompare(node.cityDefenseLayout || {});
        const migratedDefense = normalizeDefenseLayoutForCompare(defenseRow || {});
        if (JSON.stringify(legacyDefense) !== JSON.stringify(migratedDefense)) {
          localMismatch.push('城防布局不一致');
        }
      }
    }

    if (hasLegacySiegeStateData(node)) {
      if (!siegeRow) {
        localMismatch.push('缺失围城状态集合行');
      } else {
        const legacySiege = normalizeSiegeStateForCompare(node.citySiegeState || {});
        const migratedSiege = normalizeSiegeStateForCompare(siegeRow || {});
        if (JSON.stringify(legacySiege) !== JSON.stringify(migratedSiege)) {
          localMismatch.push('围城状态不一致');
        }
      }
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(nodeId),
        errors: localMismatch
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledNodes: nodes.length,
    mismatchedNodes: mismatches.length,
    mismatchDetails: mismatches
  };
};

const verifyTitleStateSamplesNewOnly = async ({ sampleSize }) => {
  const [defenseNodeRows, siegeNodeRows] = await Promise.all([
    DomainDefenseLayout.find({}).sort({ nodeId: 1 }).limit(sampleSize).select('nodeId buildings intelBuildingId gateDefense gateDefenseViewAdminIds').lean(),
    DomainSiegeState.find({}).sort({ nodeId: 1 }).limit(sampleSize).select('nodeId cheng qi').lean()
  ]);

  const nodeIdSet = new Set();
  defenseNodeRows.forEach((item) => {
    const key = getIdString(item?.nodeId);
    if (key) nodeIdSet.add(key);
  });
  siegeNodeRows.forEach((item) => {
    const key = getIdString(item?.nodeId);
    if (key) nodeIdSet.add(key);
  });

  const sampledNodeIds = Array.from(nodeIdSet).slice(0, sampleSize);
  const mismatches = [];

  for (const nodeIdText of sampledNodeIds) {
    const nodeId = toObjectIdOrNull(nodeIdText);
    if (!nodeId) continue;
    const [defenseRow, siegeRow] = await Promise.all([
      DomainDefenseLayout.findOne({ nodeId }).select('buildings intelBuildingId gateDefense gateDefenseViewAdminIds').lean(),
      DomainSiegeState.findOne({ nodeId }).select('cheng qi').lean()
    ]);
    const localMismatch = [];

    if (!defenseRow) {
      localMismatch.push('缺失城防布局集合行');
    } else {
      const compared = normalizeDefenseLayoutForCompare(defenseRow);
      if (!Array.isArray(compared.buildings) || compared.buildings.length === 0) {
        localMismatch.push('城防布局建筑为空');
      }
      if (!compared.buildings.some((item) => item.buildingId === compared.intelBuildingId)) {
        localMismatch.push('情报建筑未命中任一建筑');
      }
    }

    if (!siegeRow) {
      localMismatch.push('缺失围城状态集合行');
    } else {
      const compared = normalizeSiegeStateForCompare(siegeRow);
      for (const gateKey of ['cheng', 'qi']) {
        const gate = compared[gateKey] || {};
        const seen = new Set();
        for (const attacker of (Array.isArray(gate.attackers) ? gate.attackers : [])) {
          if (!attacker.userId) {
            localMismatch.push(`${gateKey} 存在空 attacker.userId`);
            continue;
          }
          if (seen.has(attacker.userId)) {
            localMismatch.push(`${gateKey} attacker 重复 userId=${attacker.userId}`);
            continue;
          }
          seen.add(attacker.userId);
        }
      }
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(nodeId),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledNodes: sampledNodeIds.length,
    mismatchedNodes: mismatches.length,
    mismatchDetails: mismatches
  };
};

const normalizeStringArray = (source = []) => (
  Array.from(new Set(
    (Array.isArray(source) ? source : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'en'))
);

const relationRowToCanonicalKey = (row = {}) => (
  [
    getIdString(row?.targetNodeId || row?.targetNode),
    String(row?.relationType || ''),
    String(row?.sourceSenseId || '').trim(),
    String(row?.targetSenseId || '').trim(),
    String(row?.insertSide || '').trim(),
    String(row?.insertGroupId || '').trim()
  ].join('|')
);

const relationRowsToCanonicalSorted = (rows = []) => (
  (Array.isArray(rows) ? rows : [])
    .map((item) => relationRowToCanonicalKey(item))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en'))
);

const buildLegacyTitleProjectionGlobalSummary = async () => {
  const cursor = Node.collection.find(
    {},
    {
      projection: {
        _id: 1,
        associations: 1
      }
    }
  ).batchSize(200);

  let projectionRows = 0;
  let relationRows = 0;

  for await (const node of cursor) {
    projectionRows += 1;
    relationRows += normalizeAssociationsForProjection(node?.associations).length;
  }

  return {
    projectionRows,
    relationRows
  };
};

const buildNewTitleProjectionGlobalSummary = async () => {
  const [projectionRows, relationRows] = await Promise.all([
    DomainTitleProjection.countDocuments({}),
    DomainTitleRelation.countDocuments({ status: 'active' })
  ]);
  return {
    projectionRows,
    relationRows
  };
};

const pickTitleProjectionSampleNodes = async (limit) => (
  Node.find({})
    .select('_id owner domainMaster domainAdmins allianceId name description relatedParentDomains relatedChildDomains contentScore knowledgePoint status isFeatured featuredOrder createdAt lastUpdate associations')
    .sort({ _id: 1 })
    .limit(limit)
    .lean()
);

const verifyTitleProjectionSamples = async ({ sampleSize }) => {
  const nodes = await pickTitleProjectionSampleNodes(sampleSize);
  const mismatches = [];

  for (const node of nodes) {
    const nodeId = toObjectIdOrNull(node?._id);
    if (!nodeId) continue;
    const expectedProjection = normalizeTitleProjectionFromNode(node);
    if (!expectedProjection) continue;

    const [projectionRow, relationRows] = await Promise.all([
      DomainTitleProjection.findOne({ nodeId })
        .select('nodeId owner domainMaster domainAdmins allianceId name description relatedParentDomains relatedChildDomains contentScore knowledgePoint status isFeatured featuredOrder')
        .lean(),
      DomainTitleRelation.find({ sourceNodeId: nodeId, status: 'active' })
        .select('targetNodeId relationType sourceSenseId targetSenseId insertSide insertGroupId')
        .lean()
    ]);

    const localMismatch = [];
    if (!projectionRow) {
      localMismatch.push('缺失标题投影行');
    } else {
      if (String(projectionRow?.name || '') !== String(expectedProjection?.name || '')) {
        localMismatch.push('name 不一致');
      }
      if (String(projectionRow?.description || '') !== String(expectedProjection?.description || '')) {
        localMismatch.push('description 不一致');
      }
      if (String(projectionRow?.status || '') !== String(expectedProjection?.status || '')) {
        localMismatch.push('status 不一致');
      }
      if (getIdString(projectionRow?.owner) !== getIdString(expectedProjection?.owner)) {
        localMismatch.push('owner 不一致');
      }
      if (getIdString(projectionRow?.domainMaster) !== getIdString(expectedProjection?.domainMaster)) {
        localMismatch.push('domainMaster 不一致');
      }
      if (getIdString(projectionRow?.allianceId) !== getIdString(expectedProjection?.allianceId)) {
        localMismatch.push('allianceId 不一致');
      }
      const projAdmins = normalizeStringArray((projectionRow?.domainAdmins || []).map((item) => getIdString(item)));
      const expectedAdmins = normalizeStringArray((expectedProjection?.domainAdmins || []).map((item) => getIdString(item)));
      if (JSON.stringify(projAdmins) !== JSON.stringify(expectedAdmins)) {
        localMismatch.push('domainAdmins 不一致');
      }
      const projParents = normalizeStringArray(projectionRow?.relatedParentDomains || []);
      const expectedParents = normalizeStringArray(expectedProjection?.relatedParentDomains || []);
      if (JSON.stringify(projParents) !== JSON.stringify(expectedParents)) {
        localMismatch.push('relatedParentDomains 不一致');
      }
      const projChildren = normalizeStringArray(projectionRow?.relatedChildDomains || []);
      const expectedChildren = normalizeStringArray(expectedProjection?.relatedChildDomains || []);
      if (JSON.stringify(projChildren) !== JSON.stringify(expectedChildren)) {
        localMismatch.push('relatedChildDomains 不一致');
      }
      if (Number(projectionRow?.contentScore || 0) !== Number(expectedProjection?.contentScore || 0)) {
        localMismatch.push('contentScore 不一致');
      }
      if (Number(projectionRow?.featuredOrder || 0) !== Number(expectedProjection?.featuredOrder || 0)) {
        localMismatch.push('featuredOrder 不一致');
      }
      if (!!projectionRow?.isFeatured !== !!expectedProjection?.isFeatured) {
        localMismatch.push('isFeatured 不一致');
      }
      const projKp = Number(projectionRow?.knowledgePoint?.value || 0);
      const expectedKp = Number(expectedProjection?.knowledgePoint?.value || 0);
      if (projKp !== expectedKp) {
        localMismatch.push('knowledgePoint.value 不一致');
      }
    }

    const expectedRelations = relationRowsToCanonicalSorted(normalizeAssociationsForProjection(node?.associations));
    const currentRelations = relationRowsToCanonicalSorted(relationRows);
    if (JSON.stringify(expectedRelations) !== JSON.stringify(currentRelations)) {
      localMismatch.push(`标题关系不一致 expected=${expectedRelations.length} current=${currentRelations.length}`);
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(nodeId),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledNodes: nodes.length,
    mismatchedNodes: mismatches.length,
    mismatchDetails: mismatches
  };
};

const pickNotificationSampleUsers = async (limit) => {
  const usersWithLegacy = await User.find({ 'notifications.0': { $exists: true } })
    .select('_id notifications')
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  if (usersWithLegacy.length >= limit) return usersWithLegacy;

  const missing = limit - usersWithLegacy.length;
  const picked = new Set(usersWithLegacy.map((item) => String(item._id)));
  const fallbackUsers = await User.find({ _id: { $nin: Array.from(picked).map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('_id notifications')
    .sort({ _id: 1 })
    .limit(missing)
    .lean();
  return usersWithLegacy.concat(fallbackUsers);
};

const verifyNotificationSamples = async ({ sampleSize }) => {
  const users = await pickNotificationSampleUsers(sampleSize);
  const mismatches = [];

  for (const user of users) {
    const userId = toObjectIdOrNull(user?._id);
    if (!userId) continue;
    const legacyRows = (Array.isArray(user?.notifications) ? user.notifications : [])
      .map((item) => normalizeLegacyNotification(userId, item));
    const legacyState = buildInboxStateFromNotifications(legacyRows);
    const legacyCount = legacyRows.length;

    const [newRows, inboxState] = await Promise.all([
      Notification.find({ userId }).select('_id read createdAt').lean(),
      UserInboxState.findOne({ userId }).select('unreadCount lastNotificationAt').lean()
    ]);

    const newState = buildInboxStateFromNotifications(newRows);
    const localMismatch = [];

    if (newRows.length !== legacyCount) {
      localMismatch.push(`通知数量不一致 legacy=${legacyCount} new=${newRows.length}`);
    }
    if (newState.unreadCount !== legacyState.unreadCount) {
      localMismatch.push(`未读数量不一致 legacy=${legacyState.unreadCount} new=${newState.unreadCount}`);
    }
    if (!dateEqual(newState.lastNotificationAt, legacyState.lastNotificationAt)) {
      localMismatch.push('最新通知时间不一致');
    }

    const inboxUnread = Math.max(0, parseInt(inboxState?.unreadCount, 10) || 0);
    if (inboxUnread !== legacyState.unreadCount) {
      localMismatch.push(`Inbox 未读数量不一致 legacy=${legacyState.unreadCount} inbox=${inboxUnread}`);
    }
    if (!dateEqual(inboxState?.lastNotificationAt || null, legacyState.lastNotificationAt)) {
      localMismatch.push('Inbox 最新通知时间不一致');
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        userId: String(userId),
        errors: localMismatch
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledUsers: users.length,
    mismatchedUsers: mismatches.length,
    mismatchDetails: mismatches
  };
};

const pickParticipantSampleNodes = async (limit) => {
  return Node.find({
    status: 'approved',
    'knowledgeDistributionLocked.executeAt': { $type: 'date' },
    'knowledgeDistributionLocked.participants.0': { $exists: true }
  })
    .select('_id knowledgeDistributionLocked')
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
};

const verifyParticipantSamples = async ({ sampleSize }) => {
  const nodes = await pickParticipantSampleNodes(sampleSize);
  const mismatches = [];

  for (const node of nodes) {
    const lock = node?.knowledgeDistributionLocked || {};
    const executeAt = toValidDateOrNull(lock?.executeAt);
    if (!executeAt) continue;
    const participants = Array.isArray(lock?.participants) ? lock.participants : [];

    const legacyMap = new Map();
    for (const row of participants) {
      const normalized = normalizeLegacyParticipant({ executeAt, row });
      if (!normalized) continue;
      legacyMap.set(String(normalized.userId), normalized);
    }

    const newRows = await DistributionParticipant.find({
      nodeId: node._id,
      executeAt
    }).select('userId joinedAt exitedAt').lean();

    const newMap = new Map();
    for (const row of newRows) {
      const userId = getIdString(row?.userId);
      if (!userId) continue;
      newMap.set(userId, {
        userId,
        joinedAt: toValidDateOrNull(row?.joinedAt),
        exitedAt: toValidDateOrNull(row?.exitedAt)
      });
    }

    const localMismatch = [];
    if (legacyMap.size !== newMap.size) {
      localMismatch.push(`参与者数量不一致 legacy=${legacyMap.size} new=${newMap.size}`);
    }

    for (const [userId, legacyItem] of legacyMap.entries()) {
      const newItem = newMap.get(userId);
      if (!newItem) {
        localMismatch.push(`新集合缺失 userId=${userId}`);
        continue;
      }
      if (!dateEqual(newItem.joinedAt, legacyItem.joinedAt)) {
        localMismatch.push(`joinedAt 不一致 userId=${userId}`);
      }
      if (!dateEqual(newItem.exitedAt, legacyItem.exitedAt)) {
        localMismatch.push(`exitedAt 不一致 userId=${userId}`);
      }
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(node._id),
        executeAt: executeAt.toISOString(),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledSessions: nodes.length,
    mismatchedSessions: mismatches.length,
    mismatchDetails: mismatches
  };
};

const pickNotificationSampleUserIdsFromCollection = async (limit) => {
  const grouped = await Notification.aggregate([
    { $group: { _id: '$userId' } },
    { $sort: { _id: 1 } },
    { $limit: limit }
  ]);

  if (grouped.length >= limit) {
    return grouped.map((item) => item._id).filter(Boolean);
  }

  const missing = limit - grouped.length;
  const existing = new Set(grouped.map((item) => String(item._id)));
  const fallbackRows = await UserInboxState.find({})
    .select('userId')
    .sort({ userId: 1 })
    .lean();

  for (const row of fallbackRows) {
    const userId = toObjectIdOrNull(row?.userId);
    if (!userId) continue;
    const key = String(userId);
    if (existing.has(key)) continue;
    grouped.push({ _id: userId });
    existing.add(key);
    if (grouped.length >= limit) break;
  }

  return grouped.map((item) => item._id).filter(Boolean);
};

const verifyNotificationSamplesNewOnly = async ({ sampleSize }) => {
  const userIds = await pickNotificationSampleUserIdsFromCollection(sampleSize);
  const mismatches = [];

  for (const userIdRaw of userIds) {
    const userId = toObjectIdOrNull(userIdRaw);
    if (!userId) continue;

    const [rows, inboxState] = await Promise.all([
      Notification.find({ userId }).select('read createdAt').lean(),
      UserInboxState.findOne({ userId }).select('unreadCount lastNotificationAt').lean()
    ]);

    const computed = buildInboxStateFromNotifications(rows);
    const inboxUnread = Math.max(0, parseInt(inboxState?.unreadCount, 10) || 0);
    const localMismatch = [];

    if (computed.unreadCount !== inboxUnread) {
      localMismatch.push(`Inbox 未读数量不一致 computed=${computed.unreadCount} inbox=${inboxUnread}`);
    }
    if (!dateEqual(computed.lastNotificationAt, inboxState?.lastNotificationAt || null)) {
      localMismatch.push('Inbox 最新通知时间不一致');
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        userId: String(userId),
        errors: localMismatch
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledUsers: userIds.length,
    mismatchedUsers: mismatches.length,
    mismatchDetails: mismatches
  };
};

const pickParticipantSampleSessionsFromCollection = async (limit) => {
  const rows = await DistributionParticipant.aggregate([
    { $group: { _id: { nodeId: '$nodeId', executeAt: '$executeAt' } } },
    { $sort: { '_id.nodeId': 1, '_id.executeAt': 1 } },
    { $limit: limit }
  ]);
  return rows.map((item) => item._id).filter(Boolean);
};

const verifyParticipantSamplesNewOnly = async ({ sampleSize }) => {
  const sessions = await pickParticipantSampleSessionsFromCollection(sampleSize);
  const mismatches = [];

  for (const session of sessions) {
    const nodeId = toObjectIdOrNull(session?.nodeId);
    const executeAt = toValidDateOrNull(session?.executeAt);
    if (!nodeId || !executeAt) continue;

    const rows = await DistributionParticipant.find({
      nodeId,
      executeAt
    }).select('userId joinedAt exitedAt').lean();

    const userSet = new Set();
    const localMismatch = [];

    for (const row of rows) {
      const userId = getIdString(row?.userId);
      if (!userId) {
        localMismatch.push('存在无效 userId');
        continue;
      }
      if (userSet.has(userId)) {
        localMismatch.push(`存在重复 userId=${userId}`);
      } else {
        userSet.add(userId);
      }
      if (!toValidDateOrNull(row?.joinedAt)) {
        localMismatch.push(`joinedAt 非法 userId=${userId}`);
      }
      if (row?.exitedAt && !toValidDateOrNull(row.exitedAt)) {
        localMismatch.push(`exitedAt 非法 userId=${userId}`);
      }
    }

    if (localMismatch.length > 0) {
      mismatches.push({
        nodeId: String(nodeId),
        executeAt: executeAt.toISOString(),
        errors: localMismatch.slice(0, 20)
      });
      if (mismatches.length >= 30) break;
    }
  }

  return {
    sampledSessions: sessions.length,
    mismatchedSessions: mismatches.length,
    mismatchDetails: mismatches
  };
};

const buildDomainAllianceCanonicalSummary = async () => {
  const rows = await Node.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'domainMaster',
        foreignField: '_id',
        as: 'masterRows'
      }
    },
    {
      $project: {
        hasValidMasterId: { $eq: [{ $type: '$domainMaster' }, 'objectId'] },
        allianceId: { $ifNull: ['$allianceId', null] },
        expectedAllianceId: {
          $ifNull: [{ $arrayElemAt: ['$masterRows.allianceId', 0] }, null]
        },
        hasMasterRow: {
          $gt: [{ $size: '$masterRows' }, 0]
        }
      }
    },
    {
      $group: {
        _id: null,
        totalNodes: { $sum: 1 },
        mismatchedNodes: {
          $sum: {
            $cond: [{ $ne: ['$allianceId', '$expectedAllianceId'] }, 1, 0]
          }
        },
        nodesMissingMasterUser: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$hasValidMasterId', true] },
                  { $eq: ['$hasMasterRow', false] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ]).allowDiskUse(true);

  return rows[0] || {
    totalNodes: 0,
    mismatchedNodes: 0,
    nodesMissingMasterUser: 0
  };
};

const verifyDomainAllianceCanonicalSamples = async ({ sampleSize }) => {
  const rows = await Node.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'domainMaster',
        foreignField: '_id',
        as: 'masterRows'
      }
    },
    {
      $project: {
        name: 1,
        status: 1,
        domainMaster: 1,
        allianceId: { $ifNull: ['$allianceId', null] },
        expectedAllianceId: {
          $ifNull: [{ $arrayElemAt: ['$masterRows.allianceId', 0] }, null]
        }
      }
    },
    {
      $match: {
        $expr: { $ne: ['$allianceId', '$expectedAllianceId'] }
      }
    },
    { $sort: { _id: 1 } },
    { $limit: sampleSize }
  ]).allowDiskUse(true);

  return {
    sampledNodes: rows.length,
    mismatchedNodes: rows.length,
    mismatchDetails: rows.map((item) => ({
      nodeId: String(item?._id || ''),
      name: item?.name || '',
      status: item?.status || '',
      domainMaster: getIdString(item?.domainMaster),
      allianceId: getIdString(item?.allianceId),
      expectedAllianceId: getIdString(item?.expectedAllianceId)
    }))
  };
};

const verifyMigrationConsistency = async ({
  verifySampleUsers,
  verifySampleSessions,
  verifySampleNodes,
  verifySampleTitleStates,
  verifySampleTitleProjections,
  verifySampleAllianceCanonical,
  verifyBaseline
}) => {
  logStep('开始全局一致性校验');
  const [
    legacyNotificationSummary,
    newNotificationSummary,
    legacyParticipantSummary,
    newParticipantSummary,
    legacyNodeSenseSummary,
    newNodeSenseSummary,
    legacyTitleStateSummary,
    newTitleStateSummary,
    legacyTitleProjectionSummary,
    newTitleProjectionSummary,
    allianceCanonicalSummary
  ] = await Promise.all([
    buildLegacyNotificationGlobalSummary(),
    buildNewNotificationGlobalSummary(),
    buildLegacyParticipantGlobalSummary(),
    buildNewParticipantGlobalSummary(),
    buildLegacyNodeSenseGlobalSummary(),
    buildNewNodeSenseGlobalSummary(),
    buildLegacyTitleStateGlobalSummary(),
    buildNewTitleStateGlobalSummary(),
    buildLegacyTitleProjectionGlobalSummary(),
    buildNewTitleProjectionGlobalSummary(),
    buildDomainAllianceCanonicalSummary()
  ]);

  const hasLegacyData = (
    (legacyNotificationSummary.total > 0)
    || (legacyParticipantSummary.rawRows > 0)
  );
  const hasLegacyNodeSenseData = legacyNodeSenseSummary.rows > 0;
  const hasLegacyTitleStateData = (
    legacyTitleStateSummary.defenseRows > 0
    || legacyTitleStateSummary.siegeRows > 0
  );
  const resolvedBaseline = verifyBaseline === 'auto'
    ? (hasLegacyData ? 'legacy' : 'new')
    : verifyBaseline;
  const resolvedNodeSenseBaseline = verifyBaseline === 'auto'
    ? (hasLegacyNodeSenseData ? 'legacy' : 'new')
    : verifyBaseline;
  const resolvedTitleStateBaseline = verifyBaseline === 'auto'
    ? (hasLegacyTitleStateData ? 'legacy' : 'new')
    : verifyBaseline;

  const [
    notificationSampleCheck,
    participantSampleCheck,
    nodeSenseSampleCheck,
    titleStateSampleCheck,
    titleProjectionSampleCheck,
    allianceCanonicalSampleCheck
  ] = await Promise.all([
    resolvedBaseline === 'legacy'
      ? verifyNotificationSamples({ sampleSize: verifySampleUsers })
      : verifyNotificationSamplesNewOnly({ sampleSize: verifySampleUsers }),
    resolvedBaseline === 'legacy'
      ? verifyParticipantSamples({ sampleSize: verifySampleSessions })
      : verifyParticipantSamplesNewOnly({ sampleSize: verifySampleSessions }),
    resolvedNodeSenseBaseline === 'legacy'
      ? verifyNodeSenseSamples({ sampleSize: verifySampleNodes })
      : verifyNodeSenseSamplesNewOnly({ sampleSize: verifySampleNodes }),
    resolvedTitleStateBaseline === 'legacy'
      ? verifyTitleStateSamples({ sampleSize: verifySampleTitleStates })
      : verifyTitleStateSamplesNewOnly({ sampleSize: verifySampleTitleStates }),
    verifyTitleProjectionSamples({ sampleSize: verifySampleTitleProjections }),
    verifyDomainAllianceCanonicalSamples({ sampleSize: verifySampleAllianceCanonical })
  ]);

  const errors = [];
  const warnings = [];

  if (resolvedBaseline === 'legacy') {
    if (legacyNotificationSummary.total !== newNotificationSummary.total) {
      errors.push(
        `通知总量不一致 legacy=${legacyNotificationSummary.total} new=${newNotificationSummary.total}`
      );
    }
    if (legacyNotificationSummary.unread !== newNotificationSummary.unread) {
      errors.push(
        `通知未读总量不一致 legacy=${legacyNotificationSummary.unread} new=${newNotificationSummary.unread}`
      );
    }
    if (legacyNotificationSummary.unread !== newNotificationSummary.inboxUnread) {
      errors.push(
        `Inbox 未读汇总不一致 legacyUnread=${legacyNotificationSummary.unread} inboxUnread=${newNotificationSummary.inboxUnread}`
      );
    }
    if (!dateEqual(legacyNotificationSummary.latestCreatedAt, newNotificationSummary.latestCreatedAt)) {
      warnings.push('通知最新时间与新集合最新时间存在差异');
    }
    if (!dateEqual(legacyNotificationSummary.latestCreatedAt, newNotificationSummary.inboxLatestCreatedAt)) {
      warnings.push('通知最新时间与 Inbox 最新时间存在差异');
    }
    if (notificationSampleCheck.mismatchedUsers > 0) {
      errors.push(`通知抽样用户存在不一致 mismatchedUsers=${notificationSampleCheck.mismatchedUsers}`);
    }

    if (legacyParticipantSummary.dedupedRows !== newParticipantSummary.rows) {
      errors.push(
        `分发参与者总量不一致 legacyDeduped=${legacyParticipantSummary.dedupedRows} new=${newParticipantSummary.rows}`
      );
    }
    if (participantSampleCheck.mismatchedSessions > 0) {
      errors.push(`分发参与者抽样会话存在不一致 mismatchedSessions=${participantSampleCheck.mismatchedSessions}`);
    }
  } else {
    if (hasLegacyData) {
      warnings.push('当前按 new baseline 校验，但仍检测到旧字段残留数据');
    }
    if (newNotificationSummary.unread !== newNotificationSummary.inboxUnread) {
      errors.push(
        `新通知与 Inbox 未读汇总不一致 newUnread=${newNotificationSummary.unread} inboxUnread=${newNotificationSummary.inboxUnread}`
      );
    }
    if (notificationSampleCheck.mismatchedUsers > 0) {
      errors.push(`新通知抽样用户存在不一致 mismatchedUsers=${notificationSampleCheck.mismatchedUsers}`);
    }
    if (participantSampleCheck.mismatchedSessions > 0) {
      errors.push(`新分发参与者抽样会话存在不一致 mismatchedSessions=${participantSampleCheck.mismatchedSessions}`);
    }
  }

  if (resolvedNodeSenseBaseline === 'legacy') {
    if (legacyNodeSenseSummary.rows !== newNodeSenseSummary.rows) {
      errors.push(`节点释义总量不一致 legacy=${legacyNodeSenseSummary.rows} new=${newNodeSenseSummary.rows}`);
    }
    if (nodeSenseSampleCheck.mismatchedNodes > 0) {
      errors.push(`节点释义抽样存在不一致 mismatchedNodes=${nodeSenseSampleCheck.mismatchedNodes}`);
    }
  } else if (nodeSenseSampleCheck.mismatchedNodes > 0) {
    errors.push(`新节点释义抽样存在不一致 mismatchedNodes=${nodeSenseSampleCheck.mismatchedNodes}`);
  }

  if (resolvedTitleStateBaseline === 'legacy') {
    if (legacyTitleStateSummary.defenseRows !== newTitleStateSummary.defenseRows) {
      errors.push(
        `标题城防布局总量不一致 legacy=${legacyTitleStateSummary.defenseRows} new=${newTitleStateSummary.defenseRows}`
      );
    }
    if (legacyTitleStateSummary.siegeRows !== newTitleStateSummary.siegeRows) {
      errors.push(
        `标题围城状态总量不一致 legacy=${legacyTitleStateSummary.siegeRows} new=${newTitleStateSummary.siegeRows}`
      );
    }
    if (titleStateSampleCheck.mismatchedNodes > 0) {
      errors.push(`标题状态抽样存在不一致 mismatchedNodes=${titleStateSampleCheck.mismatchedNodes}`);
    }
  } else if (titleStateSampleCheck.mismatchedNodes > 0) {
    errors.push(`新标题状态抽样存在不一致 mismatchedNodes=${titleStateSampleCheck.mismatchedNodes}`);
  }

  if (legacyTitleProjectionSummary.projectionRows !== newTitleProjectionSummary.projectionRows) {
    errors.push(
      `标题投影总量不一致 legacy=${legacyTitleProjectionSummary.projectionRows} new=${newTitleProjectionSummary.projectionRows}`
    );
  }
  if (legacyTitleProjectionSummary.relationRows !== newTitleProjectionSummary.relationRows) {
    errors.push(
      `标题关系总量不一致 legacy=${legacyTitleProjectionSummary.relationRows} new=${newTitleProjectionSummary.relationRows}`
    );
  }
  if (titleProjectionSampleCheck.mismatchedNodes > 0) {
    errors.push(`标题投影抽样存在不一致 mismatchedNodes=${titleProjectionSampleCheck.mismatchedNodes}`);
  }
  if (allianceCanonicalSummary.mismatchedNodes > 0) {
    errors.push(
      `标题熵盟归属不一致 mismatchedNodes=${allianceCanonicalSummary.mismatchedNodes}`
    );
  }
  if (allianceCanonicalSummary.nodesMissingMasterUser > 0) {
    warnings.push(
      `存在 domainMaster 指向缺失用户的标题 nodes=${allianceCanonicalSummary.nodesMissingMasterUser}`
    );
  }

  return {
    ok: errors.length === 0,
    resolvedBaseline,
    resolvedNodeSenseBaseline,
    resolvedTitleStateBaseline,
    hasLegacyData,
    hasLegacyNodeSenseData,
    hasLegacyTitleStateData,
    errors,
    warnings,
    legacyNotificationSummary,
    newNotificationSummary,
    legacyParticipantSummary,
    newParticipantSummary,
    legacyNodeSenseSummary,
    newNodeSenseSummary,
    legacyTitleStateSummary,
    newTitleStateSummary,
    legacyTitleProjectionSummary,
    newTitleProjectionSummary,
    allianceCanonicalSummary,
    notificationSampleCheck,
    participantSampleCheck,
    nodeSenseSampleCheck,
    titleStateSampleCheck,
    titleProjectionSampleCheck,
    allianceCanonicalSampleCheck
  };
};

const clearLegacyData = async ({
  clearLegacyNotifications,
  clearLegacyParticipants,
  clearLegacyNodeSenses,
  clearLegacyTitleStates
}) => {
  const result = {
    notificationsClearedUsers: 0,
    participantsClearedNodes: 0,
    nodeSensesClearedNodes: 0,
    titleStatesClearedNodes: 0
  };

  if (clearLegacyNotifications) {
    logStep('开始清理 User.notifications（clear-legacy-notifications=true）');
    const updateResult = await User.updateMany(
      { 'notifications.0': { $exists: true } },
      { $set: { notifications: [] } }
    );
    result.notificationsClearedUsers = updateResult?.modifiedCount || 0;
  }

  if (clearLegacyParticipants) {
    logStep('开始清理 Node.knowledgeDistributionLocked.participants（clear-legacy-participants=true）');
    const updateResult = await Node.updateMany(
      {
        'knowledgeDistributionLocked.executeAt': { $type: 'date' },
        'knowledgeDistributionLocked.participants.0': { $exists: true }
      },
      { $set: { 'knowledgeDistributionLocked.participants': [] } }
    );
    result.participantsClearedNodes = updateResult?.modifiedCount || 0;
  }

  if (clearLegacyNodeSenses) {
    logStep('开始清理 Node.synonymSenses（clear-legacy-node-senses=true）');
    const updateResult = await Node.updateMany(
      { 'synonymSenses.0': { $exists: true } },
      { $set: { synonymSenses: [] } }
    );
    result.nodeSensesClearedNodes = updateResult?.modifiedCount || 0;
  }

  if (clearLegacyTitleStates) {
    logStep('开始清理 Node.cityDefenseLayout / Node.citySiegeState（clear-legacy-title-states=true）');
    const updateResult = await Node.collection.updateMany(
      {
        $or: [
          { cityDefenseLayout: { $exists: true } },
          { citySiegeState: { $exists: true } }
        ]
      },
      {
        $unset: {
          cityDefenseLayout: '',
          citySiegeState: ''
        }
      }
    );
    result.titleStatesClearedNodes = updateResult?.modifiedCount || 0;
  }

  return result;
};

const run = async () => {
  const options = getRuntimeOptions();
  const startedAt = Date.now();
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    mode: options.mode,
    options,
    resetResult: null,
    migrationResult: null,
    verificationResult: null,
    cleanupResult: null,
    finishedAt: null,
    durationMs: 0
  };

  const shouldMigrate = ['migrate', 'migrate-verify'].includes(options.mode);
  const shouldVerify = ['verify', 'migrate-verify'].includes(options.mode);
  if (!shouldMigrate && !shouldVerify) {
    throw new Error(`未知 mode: ${options.mode}，可选值: migrate / verify / migrate-verify`);
  }

  await mongoose.connect(MONGODB_URI);
  logStep('已连接 MongoDB');

  try {
    if (shouldMigrate && options.resetTarget) {
      summary.resetResult = await resetTargetCollections();
      logStep('目标集合清空完成', summary.resetResult);
    }

    if (shouldMigrate) {
      const notificationMetrics = await migrateNotifications(options);
      const participantMetrics = await migrateDistributionParticipants(options);
      const nodeSenseMetrics = await migrateNodeSenses(options);
      const titleStateMetrics = await migrateDomainTitleStates(options);
      const titleProjectionMetrics = await migrateDomainTitleProjection(options);
      const domainAllianceMetrics = await migrateDomainAllianceCanonical(options);
      summary.migrationResult = {
        notificationMetrics,
        participantMetrics,
        nodeSenseMetrics,
        titleStateMetrics,
        titleProjectionMetrics,
        domainAllianceMetrics
      };
      logStep('迁移阶段完成', summary.migrationResult);
    }

    if (shouldVerify) {
      summary.verificationResult = await verifyMigrationConsistency(options);
      logStep('核验阶段完成', {
        ok: summary.verificationResult.ok,
        errorCount: summary.verificationResult.errors.length,
        warningCount: summary.verificationResult.warnings.length
      });
    }

    const canCleanupLegacy = shouldMigrate && (
      options.clearLegacyNotifications
      || options.clearLegacyParticipants
      || options.clearLegacyNodeSenses
      || options.clearLegacyTitleStates
    );
    if (canCleanupLegacy) {
      if (shouldVerify && summary.verificationResult && !summary.verificationResult.ok) {
        throw new Error('核验未通过，拒绝清理旧字段。请先修复不一致再重试。');
      }
      summary.cleanupResult = await clearLegacyData(options);
      logStep('旧字段清理完成', summary.cleanupResult);
    }

    if (options.strict && shouldVerify && summary.verificationResult && !summary.verificationResult.ok) {
      throw new Error(`严格模式校验失败: ${summary.verificationResult.errors.join(' | ')}`);
    }

    summary.finishedAt = new Date().toISOString();
    summary.durationMs = Date.now() - startedAt;
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    summary.durationMs = Date.now() - startedAt;
    summary.error = error?.message || String(error);
    console.error(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }
};

run();
