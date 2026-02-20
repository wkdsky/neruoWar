const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/node-game';
const INTEL_LIMIT = 5;

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const toSnapshotTimestamp = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

const normalizeSnapshot = (snapshot = {}, rawNodeId = '') => {
  const source = typeof snapshot?.toObject === 'function' ? snapshot.toObject() : (snapshot || {});
  const nodeId = getIdString(source?.nodeId || rawNodeId);
  if (!nodeId) return null;
  const gateDefenseSource = source?.gateDefense && typeof source.gateDefense === 'object'
    ? source.gateDefense
    : {};
  const normalizeGate = (entries = []) => (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      unitName: typeof entry?.unitName === 'string' ? entry.unitName : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0);
  return {
    nodeId,
    nodeName: typeof source?.nodeName === 'string' ? source.nodeName : '',
    sourceBuildingId: typeof source?.sourceBuildingId === 'string' ? source.sourceBuildingId : '',
    deploymentUpdatedAt: source?.deploymentUpdatedAt || null,
    capturedAt: source?.capturedAt || null,
    gateDefense: {
      cheng: normalizeGate(gateDefenseSource?.cheng),
      qi: normalizeGate(gateDefenseSource?.qi)
    }
  };
};

const listSnapshotEntries = (rawSnapshots = null) => {
  if (!rawSnapshots) return [];
  if (rawSnapshots instanceof Map) return Array.from(rawSnapshots.entries());
  if (Array.isArray(rawSnapshots)) {
    return rawSnapshots
      .map((entry) => [getIdString(entry?.nodeId), entry])
      .filter(([nodeId]) => !!nodeId);
  }
  const asObject = typeof rawSnapshots?.toObject === 'function'
    ? rawSnapshots.toObject()
    : rawSnapshots;
  if (asObject && typeof asObject === 'object') {
    return Object.entries(asObject);
  }
  return [];
};

const normalizeSnapshotStore = (rawSnapshots = null, limit = INTEL_LIMIT) => {
  const byNodeId = new Map();
  for (const [rawNodeId, rawSnapshot] of listSnapshotEntries(rawSnapshots)) {
    const normalized = normalizeSnapshot(rawSnapshot, rawNodeId);
    if (!normalized) continue;
    const existed = byNodeId.get(normalized.nodeId);
    if (!existed) {
      byNodeId.set(normalized.nodeId, normalized);
      continue;
    }
    const existedTs = toSnapshotTimestamp(existed.capturedAt);
    const nextTs = toSnapshotTimestamp(normalized.capturedAt);
    if (nextTs >= existedTs) {
      byNodeId.set(normalized.nodeId, normalized);
    }
  }
  const sorted = Array.from(byNodeId.entries())
    .sort((a, b) => toSnapshotTimestamp(b[1]?.capturedAt) - toSnapshotTimestamp(a[1]?.capturedAt));
  const limited = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
  return limited.reduce((acc, [nodeId, snapshot]) => {
    acc[nodeId] = snapshot;
    return acc;
  }, {});
};

async function syncUserIntelSnapshots() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('已连接到 MongoDB');

    const users = await User.find({}).select('_id username intelDomainSnapshots lastArrivedFromNodeId lastArrivedFromNodeName lastArrivedAt');
    let updatedCount = 0;
    let convertedLegacyCount = 0;

    for (const user of users) {
      const raw = user.intelDomainSnapshots;
      const hadLegacyArray = Array.isArray(raw);
      const normalizedNoLimit = normalizeSnapshotStore(raw, Number.POSITIVE_INFINITY);
      const normalizedStore = normalizeSnapshotStore(raw, INTEL_LIMIT);
      let changed = hadLegacyArray || (JSON.stringify(normalizedNoLimit) !== JSON.stringify(normalizedStore));
      if (hadLegacyArray) {
        convertedLegacyCount += 1;
      }

      user.intelDomainSnapshots = normalizedStore;

      if (user.lastArrivedFromNodeId === undefined) {
        user.lastArrivedFromNodeId = null;
        changed = true;
      }
      if (typeof user.lastArrivedFromNodeName !== 'string') {
        user.lastArrivedFromNodeName = '';
        changed = true;
      }
      if (user.lastArrivedAt === undefined) {
        user.lastArrivedAt = null;
        changed = true;
      }

      if (changed || user.isModified()) {
        await user.save();
        updatedCount += 1;
      }
    }

    console.log(`用户总数: ${users.length}`);
    console.log(`完成字段同步: ${updatedCount}`);
    console.log(`旧数组结构检测数: ${convertedLegacyCount}`);
    console.log(`情报字段已统一为对象结构（最多 ${INTEL_LIMIT} 条）`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('同步用户情报字段失败:', error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // ignore
    }
    process.exit(1);
  }
}

syncUserIntelSnapshots();
