const mongoose = require('mongoose');
const SiegeParticipant = require('../models/SiegeParticipant');

const DEFAULT_PREVIEW_LIMIT = Math.max(1, parseInt(process.env.SIEGE_EMBEDDED_PREVIEW_LIMIT, 10) || 50);

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const toObjectId = (value) => {
  const id = getIdString(value);
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

const normalizeUnits = (units = []) => {
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(units) ? units : [])) {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(item?.count) || 0));
    if (!unitTypeId || count <= 0 || seen.has(unitTypeId)) continue;
    seen.add(unitTypeId);
    out.push({ unitTypeId, count });
  }
  return out;
};

const toPreviewAttacker = (row = {}) => ({
  userId: row?.userId || null,
  username: typeof row?.username === 'string' ? row.username : '',
  allianceId: row?.allianceId || null,
  units: normalizeUnits(row?.units),
  fromNodeId: row?.fromNodeId || null,
  fromNodeName: typeof row?.fromNodeName === 'string' ? row.fromNodeName : '',
  autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(row?.autoRetreatPercent) || 40))),
  status: row?.status === 'moving' || row?.status === 'retreated' ? row.status : 'sieging',
  isInitiator: !!row?.isInitiator,
  isReinforcement: !!row?.isReinforcement,
  requestedAt: row?.requestedAt || null,
  arriveAt: row?.arriveAt || null,
  joinedAt: row?.joinedAt || null,
  updatedAt: row?.updatedAt || null
});

const upsertParticipant = async ({
  nodeId,
  gateKey,
  userId,
  username = '',
  allianceId = null,
  units = [],
  fromNodeId = null,
  fromNodeName = '',
  autoRetreatPercent = 40,
  status = 'sieging',
  isInitiator = false,
  isReinforcement = false,
  requestedAt = null,
  arriveAt = null,
  joinedAt = null,
  updatedAt = new Date()
} = {}) => {
  const safeNodeId = toObjectId(nodeId);
  const safeUserId = toObjectId(userId);
  if (!safeNodeId || !safeUserId || (gateKey !== 'cheng' && gateKey !== 'qi')) {
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }

  return SiegeParticipant.updateOne(
    { nodeId: safeNodeId, gateKey, userId: safeUserId },
    {
      $set: {
        username: typeof username === 'string' ? username : '',
        allianceId: toObjectId(allianceId),
        units: normalizeUnits(units),
        fromNodeId: toObjectId(fromNodeId),
        fromNodeName: typeof fromNodeName === 'string' ? fromNodeName : '',
        autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(autoRetreatPercent) || 40))),
        status: status === 'moving' || status === 'retreated' ? status : 'sieging',
        isInitiator: !!isInitiator,
        isReinforcement: !!isReinforcement,
        requestedAt: requestedAt ? new Date(requestedAt) : new Date(),
        arriveAt: arriveAt ? new Date(arriveAt) : null,
        joinedAt: joinedAt ? new Date(joinedAt) : null,
        updatedAt: updatedAt ? new Date(updatedAt) : new Date()
      },
      $setOnInsert: {
        nodeId: safeNodeId,
        gateKey,
        userId: safeUserId
      }
    },
    { upsert: true }
  );
};

const migrateEmbeddedAttackers = async ({ nodeId, gateKey, attackers = [] } = {}) => {
  const safeNodeId = toObjectId(nodeId);
  if (!safeNodeId || (gateKey !== 'cheng' && gateKey !== 'qi')) return 0;

  const ops = [];
  for (const attacker of (Array.isArray(attackers) ? attackers : [])) {
    const safeUserId = toObjectId(attacker?.userId);
    if (!safeUserId) continue;
    ops.push({
      updateOne: {
        filter: { nodeId: safeNodeId, gateKey, userId: safeUserId },
        update: {
          $set: {
            username: typeof attacker?.username === 'string' ? attacker.username : '',
            allianceId: toObjectId(attacker?.allianceId),
            units: normalizeUnits(attacker?.units),
            fromNodeId: toObjectId(attacker?.fromNodeId),
            fromNodeName: typeof attacker?.fromNodeName === 'string' ? attacker.fromNodeName : '',
            autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(attacker?.autoRetreatPercent) || 40))),
            status: attacker?.status === 'moving' || attacker?.status === 'retreated' ? attacker.status : 'sieging',
            isInitiator: !!attacker?.isInitiator,
            isReinforcement: !!attacker?.isReinforcement,
            requestedAt: attacker?.requestedAt ? new Date(attacker.requestedAt) : new Date(),
            arriveAt: attacker?.arriveAt ? new Date(attacker.arriveAt) : null,
            joinedAt: attacker?.joinedAt ? new Date(attacker.joinedAt) : null,
            updatedAt: attacker?.updatedAt ? new Date(attacker.updatedAt) : new Date()
          },
          $setOnInsert: {
            nodeId: safeNodeId,
            gateKey,
            userId: safeUserId
          }
        },
        upsert: true
      }
    });
  }

  if (ops.length === 0) return 0;
  await SiegeParticipant.bulkWrite(ops, { ordered: false });
  return ops.length;
};

const settleArrivedParticipants = async ({ nodeId, gateKey, now = new Date() } = {}) => {
  const safeNodeId = toObjectId(nodeId);
  if (!safeNodeId || (gateKey !== 'cheng' && gateKey !== 'qi')) return 0;

  const nowDate = now instanceof Date ? now : new Date(now);
  const result = await SiegeParticipant.updateMany(
    {
      nodeId: safeNodeId,
      gateKey,
      status: 'moving',
      arriveAt: { $lte: nowDate }
    },
    {
      $set: {
        status: 'sieging',
        joinedAt: nowDate,
        updatedAt: nowDate
      }
    }
  );

  return result?.modifiedCount || 0;
};

const markParticipantsRetreated = async ({ nodeId, gateKey, userId = null, now = new Date() } = {}) => {
  const safeNodeId = toObjectId(nodeId);
  if (!safeNodeId || (gateKey !== 'cheng' && gateKey !== 'qi')) return 0;

  const query = {
    nodeId: safeNodeId,
    gateKey,
    status: { $in: ['moving', 'sieging'] }
  };
  const safeUserId = toObjectId(userId);
  if (safeUserId) {
    query.userId = safeUserId;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const result = await SiegeParticipant.updateMany(query, {
    $set: {
      status: 'retreated',
      updatedAt: nowDate
    }
  });
  return result?.modifiedCount || 0;
};

const getGatePreview = async ({ nodeId, gateKey, limit = DEFAULT_PREVIEW_LIMIT } = {}) => {
  const safeNodeId = toObjectId(nodeId);
  if (!safeNodeId || (gateKey !== 'cheng' && gateKey !== 'qi')) {
    return {
      participantCount: 0,
      attackers: [],
      active: false,
      firstActiveAllianceId: null,
      firstInitiator: null
    };
  }

  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || DEFAULT_PREVIEW_LIMIT));
  const statuses = ['moving', 'sieging'];
  const [count, rows] = await Promise.all([
    SiegeParticipant.countDocuments({
      nodeId: safeNodeId,
      gateKey,
      status: { $in: statuses }
    }),
    SiegeParticipant.find({
      nodeId: safeNodeId,
      gateKey,
      status: { $in: statuses }
    })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(safeLimit)
      .lean()
  ]);

  const firstActive = rows[0] || null;
  const firstInitiator = rows.find((item) => !!item?.isInitiator) || null;
  return {
    participantCount: count,
    attackers: rows.map((row) => toPreviewAttacker(row)),
    active: count > 0,
    firstActiveAllianceId: firstActive?.allianceId || null,
    firstInitiator: firstInitiator ? toPreviewAttacker(firstInitiator) : null
  };
};

const listParticipants = async ({
  nodeId,
  gateKey,
  statuses = ['moving', 'sieging', 'retreated'],
  limit = 50,
  cursor = ''
} = {}) => {
  const safeNodeId = toObjectId(nodeId);
  if (!safeNodeId || (gateKey !== 'cheng' && gateKey !== 'qi')) {
    return { rows: [], nextCursor: null };
  }

  const normalizedStatuses = Array.from(new Set(
    (Array.isArray(statuses) ? statuses : [])
      .map((status) => (status === 'moving' || status === 'retreated' ? status : 'sieging'))
  ));
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));

  const query = {
    nodeId: safeNodeId,
    gateKey,
    status: { $in: normalizedStatuses }
  };

  if (typeof cursor === 'string' && cursor.trim()) {
    const rawCursor = cursor.trim();
    if (mongoose.Types.ObjectId.isValid(rawCursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(rawCursor) };
    }
  }

  const rows = await SiegeParticipant.find(query)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(safeLimit)
    .lean();

  const nextCursor = rows.length >= safeLimit
    ? getIdString(rows[rows.length - 1]?._id)
    : null;

  return {
    rows,
    nextCursor
  };
};

const findActiveParticipant = async ({ nodeId, gateKey, userId }) => {
  const safeNodeId = toObjectId(nodeId);
  const safeUserId = toObjectId(userId);
  if (!safeNodeId || !safeUserId || (gateKey !== 'cheng' && gateKey !== 'qi')) return null;

  return SiegeParticipant.findOne({
    nodeId: safeNodeId,
    gateKey,
    userId: safeUserId,
    status: { $in: ['moving', 'sieging'] }
  }).lean();
};

const findUserActiveParticipants = async ({ userId }) => {
  const safeUserId = toObjectId(userId);
  if (!safeUserId) return [];
  return SiegeParticipant.find({
    userId: safeUserId,
    status: { $in: ['moving', 'sieging'] }
  }).sort({ requestedAt: -1, _id: -1 }).lean();
};

module.exports = {
  getIdString,
  toObjectId,
  normalizeUnits,
  toPreviewAttacker,
  upsertParticipant,
  migrateEmbeddedAttackers,
  settleArrivedParticipants,
  markParticipantsRetreated,
  getGatePreview,
  listParticipants,
  findActiveParticipant,
  findUserActiveParticipants
};
