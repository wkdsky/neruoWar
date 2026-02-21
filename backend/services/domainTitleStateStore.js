const mongoose = require('mongoose');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DomainSiegeState = require('../models/DomainSiegeState');

const CITY_GATE_KEYS = ['cheng', 'qi'];
const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const isDomainTitleStateCollectionReadEnabled = () => process.env.DOMAIN_TITLE_STATE_COLLECTION_READ !== 'false';
const isDomainTitleStateCollectionWriteEnabled = () => process.env.DOMAIN_TITLE_STATE_COLLECTION_WRITE !== 'false';

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const toValidDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const round3 = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Number(num.toFixed(3));
};

const createDefaultDefenseLayout = () => ({
  buildings: [{
    buildingId: 'core',
    name: '建筑1',
    x: 0,
    y: 0,
    radius: CITY_BUILDING_DEFAULT_RADIUS,
    level: 1,
    nextUnitTypeId: '',
    upgradeCostKP: null
  }],
  intelBuildingId: 'core',
  gateDefense: {
    cheng: [],
    qi: []
  },
  gateDefenseViewAdminIds: [],
  updatedAt: new Date()
});

const createEmptySiegeGateState = () => ({
  active: false,
  startedAt: null,
  updatedAt: null,
  supportNotifiedAt: null,
  attackerAllianceId: null,
  initiatorUserId: null,
  initiatorUsername: '',
  attackers: []
});

const createDefaultSiegeState = () => ({
  cheng: createEmptySiegeGateState(),
  qi: createEmptySiegeGateState()
});

const normalizeObjectIdList = (list = []) => {
  const seen = new Set();
  const out = [];
  for (const item of (Array.isArray(list) ? list : [])) {
    const id = toObjectIdOrNull(item);
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

const normalizeDefenseLayout = (source = {}) => {
  if (!source || typeof source !== 'object') {
    return createDefaultDefenseLayout();
  }

  const sourceBuildings = Array.isArray(source.buildings) ? source.buildings : [];
  const buildings = [];
  const seenBuildingId = new Set();

  for (let index = 0; index < sourceBuildings.length; index += 1) {
    const item = sourceBuildings[index] || {};
    const rawId = typeof item?.buildingId === 'string' ? item.buildingId.trim() : '';
    const buildingId = rawId || `building_${index + 1}`;
    if (!buildingId || seenBuildingId.has(buildingId)) continue;
    seenBuildingId.add(buildingId);

    const radius = Math.max(0.1, Math.min(0.24, round3(item?.radius, CITY_BUILDING_DEFAULT_RADIUS)));
    buildings.push({
      buildingId,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : `建筑${buildings.length + 1}`,
      x: Math.max(-1, Math.min(1, round3(item?.x, 0))),
      y: Math.max(-1, Math.min(1, round3(item?.y, 0))),
      radius,
      level: Math.max(1, Math.floor(Number(item?.level) || 1)),
      nextUnitTypeId: typeof item?.nextUnitTypeId === 'string' ? item.nextUnitTypeId.trim() : '',
      upgradeCostKP: Number.isFinite(Number(item?.upgradeCostKP)) && Number(item?.upgradeCostKP) >= 0
        ? Number(Number(item.upgradeCostKP).toFixed(2))
        : null
    });
    if (buildings.length >= CITY_BUILDING_LIMIT) break;
  }

  if (buildings.length === 0) {
    return createDefaultDefenseLayout();
  }

  const sourceIntelBuildingId = typeof source.intelBuildingId === 'string' ? source.intelBuildingId.trim() : '';
  const intelBuildingId = buildings.some((item) => item.buildingId === sourceIntelBuildingId)
    ? sourceIntelBuildingId
    : buildings[0].buildingId;

  const sourceGateDefense = source.gateDefense && typeof source.gateDefense === 'object'
    ? source.gateDefense
    : {};
  const normalizeGateDefenseEntries = (entries = []) => {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0 || seen.has(unitTypeId)) continue;
      seen.add(unitTypeId);
      out.push({ unitTypeId, count });
    }
    return out;
  };
  const gateDefense = {
    cheng: normalizeGateDefenseEntries(sourceGateDefense.cheng),
    qi: normalizeGateDefenseEntries(sourceGateDefense.qi)
  };

  return {
    buildings,
    intelBuildingId,
    gateDefense,
    gateDefenseViewAdminIds: normalizeObjectIdList(source.gateDefenseViewAdminIds),
    updatedAt: toValidDateOrNull(source.updatedAt) || new Date()
  };
};

const normalizeSiegeUnits = (units = []) => {
  const out = [];
  const seen = new Set();
  for (const entry of (Array.isArray(units) ? units : [])) {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    if (!unitTypeId || count <= 0 || seen.has(unitTypeId)) continue;
    seen.add(unitTypeId);
    out.push({ unitTypeId, count });
  }
  return out;
};

const normalizeSiegeGateState = (gateState = {}) => {
  const sourceAttackers = Array.isArray(gateState?.attackers) ? gateState.attackers : [];
  const attackers = [];
  const seenUsers = new Set();

  for (const source of sourceAttackers) {
    const userId = toObjectIdOrNull(source?.userId);
    if (!userId) continue;
    const userKey = String(userId);
    if (seenUsers.has(userKey)) continue;
    seenUsers.add(userKey);
    attackers.push({
      userId,
      username: typeof source?.username === 'string' ? source.username : '',
      allianceId: toObjectIdOrNull(source?.allianceId),
      units: normalizeSiegeUnits(source?.units),
      fromNodeId: toObjectIdOrNull(source?.fromNodeId),
      fromNodeName: typeof source?.fromNodeName === 'string' ? source.fromNodeName : '',
      autoRetreatPercent: Math.max(1, Math.min(99, Math.floor(Number(source?.autoRetreatPercent) || 40))),
      status: source?.status === 'moving' || source?.status === 'retreated' ? source.status : 'sieging',
      isInitiator: !!source?.isInitiator,
      isReinforcement: !!source?.isReinforcement,
      requestedAt: toValidDateOrNull(source?.requestedAt),
      arriveAt: toValidDateOrNull(source?.arriveAt),
      joinedAt: toValidDateOrNull(source?.joinedAt),
      updatedAt: toValidDateOrNull(source?.updatedAt) || new Date()
    });
  }

  const hasActiveAttacker = attackers.some((item) => item.status === 'moving' || item.status === 'sieging');
  return {
    active: !!gateState?.active && hasActiveAttacker,
    startedAt: toValidDateOrNull(gateState?.startedAt),
    updatedAt: toValidDateOrNull(gateState?.updatedAt),
    supportNotifiedAt: toValidDateOrNull(gateState?.supportNotifiedAt),
    attackerAllianceId: toObjectIdOrNull(gateState?.attackerAllianceId),
    initiatorUserId: toObjectIdOrNull(gateState?.initiatorUserId),
    initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
    attackers
  };
};

const normalizeSiegeState = (source = {}) => {
  if (!source || typeof source !== 'object') {
    return createDefaultSiegeState();
  }
  return {
    cheng: normalizeSiegeGateState(source.cheng),
    qi: normalizeSiegeGateState(source.qi)
  };
};

const hasLegacyDefenseLayoutData = (nodeLike = {}) => {
  if (!nodeLike || typeof nodeLike !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(nodeLike, 'cityDefenseLayout')) return false;
  const source = nodeLike.cityDefenseLayout;
  return !!source && typeof source === 'object' && Object.keys(source).length > 0;
};

const hasLegacySiegeStateData = (nodeLike = {}) => {
  if (!nodeLike || typeof nodeLike !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(nodeLike, 'citySiegeState')) return false;
  const source = nodeLike.citySiegeState;
  return !!source && typeof source === 'object' && Object.keys(source).length > 0;
};

const toHydratedDefenseLayout = (doc = {}) => normalizeDefenseLayout({
  buildings: doc?.buildings,
  intelBuildingId: doc?.intelBuildingId,
  gateDefense: doc?.gateDefense,
  gateDefenseViewAdminIds: doc?.gateDefenseViewAdminIds,
  updatedAt: doc?.updatedAt
});

const toHydratedSiegeState = (doc = {}) => normalizeSiegeState({
  cheng: doc?.cheng,
  qi: doc?.qi
});

const loadDefenseLayoutMapByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) return new Map();

  const rows = await DomainDefenseLayout.find({ nodeId: { $in: objectIds } })
    .select('nodeId buildings intelBuildingId gateDefense gateDefenseViewAdminIds updatedAt')
    .lean();
  const map = new Map();
  rows.forEach((row) => {
    map.set(String(row.nodeId), toHydratedDefenseLayout(row));
  });
  return map;
};

const loadSiegeStateMapByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) return new Map();

  const rows = await DomainSiegeState.find({ nodeId: { $in: objectIds } })
    .select('nodeId cheng qi')
    .lean();
  const map = new Map();
  rows.forEach((row) => {
    map.set(String(row.nodeId), toHydratedSiegeState(row));
  });
  return map;
};

const hydrateNodeTitleStatesForNodes = async (nodes = [], options = {}) => {
  if (!isDomainTitleStateCollectionReadEnabled()) return nodes;

  const includeDefenseLayout = options?.includeDefenseLayout !== false;
  const includeSiegeState = options?.includeSiegeState !== false;
  if (!includeDefenseLayout && !includeSiegeState) return nodes;

  const rows = Array.isArray(nodes) ? nodes : [];
  if (rows.length === 0) return rows;

  const nodeIds = rows
    .map((item) => item?._id)
    .map((item) => String(item || ''))
    .filter((id) => isValidObjectId(id));
  if (nodeIds.length === 0) return rows;

  const [defenseMap, siegeMap] = await Promise.all([
    includeDefenseLayout ? loadDefenseLayoutMapByNodeIds(nodeIds) : Promise.resolve(new Map()),
    includeSiegeState ? loadSiegeStateMapByNodeIds(nodeIds) : Promise.resolve(new Map())
  ]);

  rows.forEach((node) => {
    if (!node) return;
    const nodeId = String(node?._id || '');
    if (!nodeId) return;
    const hydrated = {};
    if (includeDefenseLayout && defenseMap.has(nodeId)) {
      hydrated.cityDefenseLayout = defenseMap.get(nodeId);
    }
    if (includeSiegeState && siegeMap.has(nodeId)) {
      hydrated.citySiegeState = siegeMap.get(nodeId);
    }
    if (Object.keys(hydrated).length > 0) {
      node.__titleStateCollection = {
        ...(node.__titleStateCollection && typeof node.__titleStateCollection === 'object'
          ? node.__titleStateCollection
          : {}),
        ...hydrated
      };
    }
  });

  return rows;
};

const resolveNodeDefenseLayout = (node, fallback = null) => {
  if (isDomainTitleStateCollectionReadEnabled()) {
    const fromCollection = node?.__titleStateCollection?.cityDefenseLayout;
    if (fromCollection && typeof fromCollection === 'object') {
      return fromCollection;
    }
  }
  if (node?.cityDefenseLayout && typeof node.cityDefenseLayout === 'object') {
    return node.cityDefenseLayout;
  }
  if (fallback && typeof fallback === 'object') return fallback;
  return createDefaultDefenseLayout();
};

const resolveNodeSiegeState = (node, fallback = null) => {
  if (isDomainTitleStateCollectionReadEnabled()) {
    const fromCollection = node?.__titleStateCollection?.citySiegeState;
    if (fromCollection && typeof fromCollection === 'object') {
      return fromCollection;
    }
  }
  if (node?.citySiegeState && typeof node.citySiegeState === 'object') {
    return node.citySiegeState;
  }
  if (fallback && typeof fallback === 'object') return fallback;
  return createDefaultSiegeState();
};

const upsertNodeDefenseLayout = async ({ nodeId, layout = {}, actorUserId = null } = {}) => {
  if (!isDomainTitleStateCollectionWriteEnabled()) {
    return { skipped: true, modified: 0, upserted: 0 };
  }
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) return { skipped: false, modified: 0, upserted: 0 };

  const normalized = normalizeDefenseLayout(layout);
  const actorId = toObjectIdOrNull(actorUserId);
  const result = await DomainDefenseLayout.updateOne(
    { nodeId: safeNodeId },
    {
      $set: {
        buildings: normalized.buildings,
        intelBuildingId: normalized.intelBuildingId,
        gateDefense: normalized.gateDefense,
        gateDefenseViewAdminIds: normalized.gateDefenseViewAdminIds,
        updatedAt: normalized.updatedAt || new Date(),
        updatedBy: actorId
      }
    },
    { upsert: true }
  );

  return {
    skipped: false,
    modified: result?.modifiedCount || 0,
    upserted: result?.upsertedCount || 0,
    layout: normalized
  };
};

const upsertNodeSiegeState = async ({ nodeId, siegeState = {}, actorUserId = null } = {}) => {
  if (!isDomainTitleStateCollectionWriteEnabled()) {
    return { skipped: true, modified: 0, upserted: 0 };
  }
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) return { skipped: false, modified: 0, upserted: 0 };

  const normalized = normalizeSiegeState(siegeState);
  const actorId = toObjectIdOrNull(actorUserId);
  const now = new Date();
  const result = await DomainSiegeState.updateOne(
    { nodeId: safeNodeId },
    {
      $set: {
        cheng: normalized.cheng,
        qi: normalized.qi,
        updatedAt: now,
        updatedBy: actorId
      }
    },
    { upsert: true }
  );

  return {
    skipped: false,
    modified: result?.modifiedCount || 0,
    upserted: result?.upsertedCount || 0,
    siegeState: normalized
  };
};

const deleteNodeTitleStatesByNodeIds = async (nodeIds = []) => {
  const objectIds = Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item));
  if (objectIds.length === 0) {
    return {
      deletedDefenseRows: 0,
      deletedSiegeRows: 0
    };
  }
  const [defenseResult, siegeResult] = await Promise.all([
    DomainDefenseLayout.deleteMany({ nodeId: { $in: objectIds } }),
    DomainSiegeState.deleteMany({ nodeId: { $in: objectIds } })
  ]);
  return {
    deletedDefenseRows: defenseResult?.deletedCount || 0,
    deletedSiegeRows: siegeResult?.deletedCount || 0
  };
};

const listSiegeStatesByAttackerUserId = async (userId, { select = 'nodeId cheng qi updatedAt' } = {}) => {
  if (!isDomainTitleStateCollectionReadEnabled()) return [];
  const safeUserId = toObjectIdOrNull(userId);
  if (!safeUserId) return [];
  return DomainSiegeState.find({
    $or: [
      { 'cheng.attackers.userId': safeUserId },
      { 'qi.attackers.userId': safeUserId }
    ]
  }).select(select).lean();
};

module.exports = {
  CITY_GATE_KEYS,
  createDefaultDefenseLayout,
  createDefaultSiegeState,
  hasLegacyDefenseLayoutData,
  hasLegacySiegeStateData,
  isDomainTitleStateCollectionReadEnabled,
  isDomainTitleStateCollectionWriteEnabled,
  normalizeDefenseLayout,
  normalizeSiegeState,
  hydrateNodeTitleStatesForNodes,
  resolveNodeDefenseLayout,
  resolveNodeSiegeState,
  upsertNodeDefenseLayout,
  upsertNodeSiegeState,
  deleteNodeTitleStatesByNodeIds,
  loadDefenseLayoutMapByNodeIds,
  loadSiegeStateMapByNodeIds,
  listSiegeStatesByAttackerUserId
};
