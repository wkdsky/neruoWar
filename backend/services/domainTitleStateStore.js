const mongoose = require('mongoose');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DomainSiegeState = require('../models/DomainSiegeState');
const SiegeParticipant = require('../models/SiegeParticipant');

const CITY_GATE_KEYS = ['cheng', 'qi'];
const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const BATTLEFIELD_VERSION = 1;
const BATTLEFIELD_FIELD_WIDTH = 900;
const BATTLEFIELD_FIELD_HEIGHT = 620;
const BATTLEFIELD_MAX_STACK_LEVEL = 5;
const BATTLEFIELD_LAYOUT_LIMIT = 24;
const BATTLEFIELD_ITEM_LIMIT = 12;
const BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE = 10;
const BATTLEFIELD_OBJECT_LIMIT = 600;
const BATTLEFIELD_OBJECT_DEFAULTS = {
  itemType: 'wood_wall',
  width: 104,
  depth: 24,
  height: 42,
  hp: 240,
  defense: 1.1
};
const SIEGE_EMBEDDED_PREVIEW_LIMIT = Math.max(1, parseInt(process.env.SIEGE_EMBEDDED_PREVIEW_LIMIT, 10) || 50);

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

const normalizeRotation = (value, fallback = 0) => {
  let next = Number(value);
  if (!Number.isFinite(next)) next = fallback;
  while (next < 0) next += 360;
  while (next >= 360) next -= 360;
  return round3(next, 0);
};

const createDefaultBattlefieldLayouts = () => ([
  {
    layoutId: 'cheng_default',
    name: '承门战场',
    gateKey: 'cheng',
    fieldWidth: BATTLEFIELD_FIELD_WIDTH,
    fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
    maxItemsPerType: BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE,
    updatedAt: new Date()
  },
  {
    layoutId: 'qi_default',
    name: '启门战场',
    gateKey: 'qi',
    fieldWidth: BATTLEFIELD_FIELD_WIDTH,
    fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
    maxItemsPerType: BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE,
    updatedAt: new Date()
  }
]);

const createDefaultBattlefieldItems = () => ([
  {
    itemType: BATTLEFIELD_OBJECT_DEFAULTS.itemType,
    name: '木墙',
    width: BATTLEFIELD_OBJECT_DEFAULTS.width,
    depth: BATTLEFIELD_OBJECT_DEFAULTS.depth,
    height: BATTLEFIELD_OBJECT_DEFAULTS.height,
    hp: BATTLEFIELD_OBJECT_DEFAULTS.hp,
    defense: BATTLEFIELD_OBJECT_DEFAULTS.defense
  }
]);

const createDefaultBattlefieldState = () => ({
  version: BATTLEFIELD_VERSION,
  layouts: createDefaultBattlefieldLayouts(),
  items: createDefaultBattlefieldItems(),
  objects: [],
  updatedAt: new Date()
});

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
  participantCount: 0,
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

const normalizeBattlefieldItems = (sourceItems = []) => {
  const source = Array.isArray(sourceItems) ? sourceItems : [];
  const seen = new Set();
  const items = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const rawType = typeof item?.itemType === 'string' ? item.itemType.trim() : '';
    const fallbackType = typeof item?.type === 'string' ? item.type.trim() : '';
    const itemType = rawType || fallbackType || BATTLEFIELD_OBJECT_DEFAULTS.itemType;
    if (itemType !== BATTLEFIELD_OBJECT_DEFAULTS.itemType || seen.has(itemType)) continue;
    seen.add(itemType);
    items.push({
      itemType,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : '木墙',
      width: Math.max(12, Math.min(360, round3(item?.width, BATTLEFIELD_OBJECT_DEFAULTS.width))),
      depth: Math.max(12, Math.min(360, round3(item?.depth, BATTLEFIELD_OBJECT_DEFAULTS.depth))),
      height: Math.max(10, Math.min(360, round3(item?.height, BATTLEFIELD_OBJECT_DEFAULTS.height))),
      hp: Math.max(1, Math.floor(Number(item?.hp) || BATTLEFIELD_OBJECT_DEFAULTS.hp)),
      defense: Math.max(0.1, round3(item?.defense, BATTLEFIELD_OBJECT_DEFAULTS.defense))
    });
    if (items.length >= BATTLEFIELD_ITEM_LIMIT) break;
  }
  return items.length > 0 ? items : createDefaultBattlefieldItems();
};

const normalizeBattlefieldLayouts = (sourceLayouts = []) => {
  const source = Array.isArray(sourceLayouts) ? sourceLayouts : [];
  const layouts = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const rawLayoutId = typeof item?.layoutId === 'string' ? item.layoutId.trim() : '';
    const gateKey = CITY_GATE_KEYS.includes(item?.gateKey) ? item.gateKey : '';
    const fallbackLayoutId = gateKey ? `${gateKey}_default` : `layout_${index + 1}`;
    const layoutId = rawLayoutId || fallbackLayoutId;
    if (!layoutId || seen.has(layoutId)) continue;
    seen.add(layoutId);

    const fallbackName = gateKey === 'cheng' ? '承门战场' : (gateKey === 'qi' ? '启门战场' : `战场${layouts.length + 1}`);
    layouts.push({
      layoutId,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : fallbackName,
      gateKey,
      fieldWidth: Math.max(200, Math.min(5000, round3(item?.fieldWidth, BATTLEFIELD_FIELD_WIDTH))),
      fieldHeight: Math.max(200, Math.min(5000, round3(item?.fieldHeight, BATTLEFIELD_FIELD_HEIGHT))),
      maxItemsPerType: Math.max(0, Math.min(9999, Math.floor(Number(item?.maxItemsPerType) || BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE))),
      updatedAt: toValidDateOrNull(item?.updatedAt) || new Date()
    });
    if (layouts.length >= BATTLEFIELD_LAYOUT_LIMIT) break;
  }
  if (layouts.length === 0) {
    return createDefaultBattlefieldLayouts();
  }
  return layouts;
};

const normalizeBattlefieldObjects = (sourceObjects = [], options = {}) => {
  const source = Array.isArray(sourceObjects) ? sourceObjects : [];
  const layouts = Array.isArray(options.layouts) ? options.layouts : [];
  const layoutById = new Map(layouts.map((item) => [item.layoutId, item]));
  const defaultLayoutId = options.defaultLayoutId
    || layouts.find((item) => item.gateKey === 'cheng')?.layoutId
    || layouts[0]?.layoutId
    || 'cheng_default';
  const objects = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const rawLayoutId = typeof item?.layoutId === 'string' ? item.layoutId.trim() : '';
    const layoutId = layoutById.has(rawLayoutId) ? rawLayoutId : defaultLayoutId;
    const layout = layoutById.get(layoutId) || {
      fieldWidth: BATTLEFIELD_FIELD_WIDTH,
      fieldHeight: BATTLEFIELD_FIELD_HEIGHT
    };

    const rawObjectId = typeof item?.objectId === 'string' && item.objectId.trim()
      ? item.objectId.trim()
      : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `obj_${index + 1}`);
    if (!rawObjectId) continue;
    const dedupeKey = `${layoutId}:${rawObjectId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rawItemType = typeof item?.itemType === 'string' ? item.itemType.trim() : '';
    const rawType = typeof item?.type === 'string' ? item.type.trim() : '';
    const itemType = rawItemType || rawType || BATTLEFIELD_OBJECT_DEFAULTS.itemType;
    if (itemType !== BATTLEFIELD_OBJECT_DEFAULTS.itemType) continue;

    const minX = -(layout.fieldWidth / 2);
    const maxX = layout.fieldWidth / 2;
    const minY = -(layout.fieldHeight / 2);
    const maxY = layout.fieldHeight / 2;
    objects.push({
      layoutId,
      objectId: rawObjectId,
      itemType,
      x: Math.max(minX, Math.min(maxX, round3(item?.x, 0))),
      y: Math.max(minY, Math.min(maxY, round3(item?.y, 0))),
      z: Math.max(0, Math.min(BATTLEFIELD_MAX_STACK_LEVEL - 1, Math.floor(Number(item?.z) || 0))),
      rotation: normalizeRotation(item?.rotation, 0)
    });
    if (objects.length >= BATTLEFIELD_OBJECT_LIMIT) break;
  }
  return objects;
};

const normalizeBattlefieldState = (source = {}) => {
  if (!source || typeof source !== 'object') {
    return createDefaultBattlefieldState();
  }

  const sourceLayouts = Array.isArray(source?.layouts)
    ? source.layouts
    : (Array.isArray(source?.battlefieldLayouts) ? source.battlefieldLayouts : []);
  const sourceItems = Array.isArray(source?.items)
    ? source.items
    : (Array.isArray(source?.battlefieldItems) ? source.battlefieldItems : []);
  const sourceObjects = Array.isArray(source?.objects)
    ? source.objects
    : (Array.isArray(source?.battlefieldObjects) ? source.battlefieldObjects : []);

  // 兼容旧结构 battlefieldLayout（单布局且对象内携带属性）
  if (sourceLayouts.length === 0 && sourceItems.length === 0 && sourceObjects.length === 0) {
    const legacyObjects = Array.isArray(source?.objects)
      ? source.objects
      : (Array.isArray(source?.walls) ? source.walls : []);
    if (legacyObjects.length > 0 || source?.fieldWidth || source?.fieldHeight) {
      const defaults = createDefaultBattlefieldState();
      const chengLayout = defaults.layouts.find((item) => item.gateKey === 'cheng') || defaults.layouts[0];
      if (chengLayout) {
        chengLayout.fieldWidth = Math.max(200, Math.min(5000, round3(source?.fieldWidth, BATTLEFIELD_FIELD_WIDTH)));
        chengLayout.fieldHeight = Math.max(200, Math.min(5000, round3(source?.fieldHeight, BATTLEFIELD_FIELD_HEIGHT)));
        chengLayout.updatedAt = toValidDateOrNull(source?.updatedAt) || new Date();
      }
      const objects = normalizeBattlefieldObjects(
        legacyObjects.map((item) => ({ ...item, layoutId: chengLayout?.layoutId || 'cheng_default' })),
        { layouts: defaults.layouts, defaultLayoutId: chengLayout?.layoutId || 'cheng_default' }
      );
      return {
        version: Math.max(1, Math.floor(Number(source?.version) || BATTLEFIELD_VERSION)),
        layouts: defaults.layouts,
        items: defaults.items,
        objects,
        updatedAt: toValidDateOrNull(source?.updatedAt) || new Date()
      };
    }
  }

  const layouts = normalizeBattlefieldLayouts(sourceLayouts);
  const items = normalizeBattlefieldItems(sourceItems);
  const objects = normalizeBattlefieldObjects(sourceObjects, {
    layouts,
    defaultLayoutId: layouts.find((item) => item.gateKey === 'cheng')?.layoutId || layouts[0]?.layoutId
  });

  return {
    version: Math.max(1, Math.floor(Number(source?.version) || BATTLEFIELD_VERSION)),
    layouts,
    items,
    objects,
    updatedAt: toValidDateOrNull(source?.updatedAt) || new Date()
  };
};

const toLegacyBattlefieldLayoutFromState = (battlefieldState = {}, preferredGateKey = 'cheng') => {
  const state = normalizeBattlefieldState(battlefieldState);
  const targetLayout = state.layouts.find((item) => item.gateKey === preferredGateKey)
    || state.layouts[0]
    || null;
  if (!targetLayout) {
    return {
      version: state.version,
      fieldWidth: BATTLEFIELD_FIELD_WIDTH,
      fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
      objects: [],
      updatedAt: state.updatedAt || new Date()
    };
  }
  const itemByType = new Map(state.items.map((item) => [item.itemType, item]));
  const objects = state.objects
    .filter((item) => item.layoutId === targetLayout.layoutId)
    .map((item) => {
      const itemDef = itemByType.get(item.itemType) || {
        width: BATTLEFIELD_OBJECT_DEFAULTS.width,
        depth: BATTLEFIELD_OBJECT_DEFAULTS.depth,
        height: BATTLEFIELD_OBJECT_DEFAULTS.height,
        hp: BATTLEFIELD_OBJECT_DEFAULTS.hp,
        defense: BATTLEFIELD_OBJECT_DEFAULTS.defense
      };
      return {
        objectId: item.objectId,
        type: item.itemType,
        x: item.x,
        y: item.y,
        z: item.z,
        rotation: item.rotation,
        width: itemDef.width,
        depth: itemDef.depth,
        height: itemDef.height,
        hp: itemDef.hp,
        defense: itemDef.defense
      };
    });
  return {
    version: state.version,
    fieldWidth: targetLayout.fieldWidth,
    fieldHeight: targetLayout.fieldHeight,
    objects,
    updatedAt: targetLayout.updatedAt || state.updatedAt || new Date()
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

  const participantCount = Math.max(
    attackers.length,
    Math.max(0, Math.floor(Number(gateState?.participantCount) || 0))
  );
  const previewAttackers = attackers.slice(0, SIEGE_EMBEDDED_PREVIEW_LIMIT);
  const hasActiveAttacker = attackers.some((item) => item.status === 'moving' || item.status === 'sieging');
  return {
    active: !!gateState?.active && hasActiveAttacker,
    startedAt: toValidDateOrNull(gateState?.startedAt),
    updatedAt: toValidDateOrNull(gateState?.updatedAt),
    supportNotifiedAt: toValidDateOrNull(gateState?.supportNotifiedAt),
    attackerAllianceId: toObjectIdOrNull(gateState?.attackerAllianceId),
    initiatorUserId: toObjectIdOrNull(gateState?.initiatorUserId),
    initiatorUsername: typeof gateState?.initiatorUsername === 'string' ? gateState.initiatorUsername : '',
    participantCount,
    attackers: previewAttackers
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

const hasLegacyBattlefieldLayoutData = (nodeLike = {}) => {
  if (!nodeLike || typeof nodeLike !== 'object') return false;
  const source = nodeLike?.cityDefenseLayout?.battlefieldLayout;
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

const toHydratedBattlefieldState = (doc = {}) => {
  const hasNewStructure = (
    Array.isArray(doc?.battlefieldLayouts)
    || Array.isArray(doc?.battlefieldItems)
    || Array.isArray(doc?.battlefieldObjects)
  );
  if (hasNewStructure) {
    return normalizeBattlefieldState({
      version: doc?.battlefieldVersion || doc?.version || BATTLEFIELD_VERSION,
      layouts: doc?.battlefieldLayouts,
      items: doc?.battlefieldItems,
      objects: doc?.battlefieldObjects,
      updatedAt: doc?.updatedAt || new Date()
    });
  }
  return normalizeBattlefieldState(
    doc?.battlefieldLayout && typeof doc.battlefieldLayout === 'object'
      ? doc.battlefieldLayout
      : {}
  );
};

const toHydratedSiegeState = (doc = {}) => normalizeSiegeState({
  cheng: doc?.cheng,
  qi: doc?.qi
});

const toDistinctNodeObjectIds = (nodeIds = []) => (
  Array.from(new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => toObjectIdOrNull(item))
      .filter(Boolean)
      .map((item) => String(item))
  )).map((item) => new mongoose.Types.ObjectId(item))
);

const loadDefenseAndBattlefieldMapsByNodeIds = async (nodeIds = [], options = {}) => {
  const includeDefenseLayout = options?.includeDefenseLayout !== false;
  const includeBattlefieldLayout = options?.includeBattlefieldLayout !== false;
  const objectIds = toDistinctNodeObjectIds(nodeIds);
  if (objectIds.length === 0) {
    return {
      defenseMap: new Map(),
      battlefieldMap: new Map()
    };
  }
  if (!includeDefenseLayout && !includeBattlefieldLayout) {
    return {
      defenseMap: new Map(),
      battlefieldMap: new Map()
    };
  }

  const selectFields = ['nodeId'];
  if (includeDefenseLayout) {
    selectFields.push('buildings', 'intelBuildingId', 'gateDefense', 'gateDefenseViewAdminIds', 'updatedAt');
  }
  if (includeBattlefieldLayout) {
    selectFields.push('battlefieldLayouts', 'battlefieldItems', 'battlefieldObjects', 'battlefieldLayout');
  }

  const rows = await DomainDefenseLayout.find({ nodeId: { $in: objectIds } })
    .select(selectFields.join(' '))
    .lean();

  const defenseMap = new Map();
  const battlefieldMap = new Map();
  rows.forEach((row) => {
    const key = String(row.nodeId);
    if (includeDefenseLayout) {
      defenseMap.set(key, toHydratedDefenseLayout(row));
    }
    if (includeBattlefieldLayout) {
      battlefieldMap.set(key, toHydratedBattlefieldState(row));
    }
  });

  return {
    defenseMap,
    battlefieldMap
  };
};

const loadDefenseLayoutMapByNodeIds = async (nodeIds = []) => {
  const { defenseMap } = await loadDefenseAndBattlefieldMapsByNodeIds(nodeIds, {
    includeDefenseLayout: true,
    includeBattlefieldLayout: false
  });
  return defenseMap;
};

const loadBattlefieldLayoutMapByNodeIds = async (nodeIds = []) => {
  const { battlefieldMap } = await loadDefenseAndBattlefieldMapsByNodeIds(nodeIds, {
    includeDefenseLayout: false,
    includeBattlefieldLayout: true
  });
  return battlefieldMap;
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
  const includeBattlefieldLayout = options?.includeBattlefieldLayout === true;
  const includeSiegeState = options?.includeSiegeState !== false;
  if (!includeDefenseLayout && !includeBattlefieldLayout && !includeSiegeState) return nodes;

  const rows = Array.isArray(nodes) ? nodes : [];
  if (rows.length === 0) return rows;

  const nodeIds = rows
    .map((item) => item?._id)
    .map((item) => String(item || ''))
    .filter((id) => isValidObjectId(id));
  if (nodeIds.length === 0) return rows;

  const [defenseAndBattlefieldMaps, siegeMap] = await Promise.all([
    (includeDefenseLayout || includeBattlefieldLayout)
      ? loadDefenseAndBattlefieldMapsByNodeIds(nodeIds, { includeDefenseLayout, includeBattlefieldLayout })
      : Promise.resolve({ defenseMap: new Map(), battlefieldMap: new Map() }),
    includeSiegeState ? loadSiegeStateMapByNodeIds(nodeIds) : Promise.resolve(new Map())
  ]);

  const defenseMap = defenseAndBattlefieldMaps?.defenseMap instanceof Map
    ? defenseAndBattlefieldMaps.defenseMap
    : new Map();
  const battlefieldMap = defenseAndBattlefieldMaps?.battlefieldMap instanceof Map
    ? defenseAndBattlefieldMaps.battlefieldMap
    : new Map();

  rows.forEach((node) => {
    if (!node) return;
    const nodeId = String(node?._id || '');
    if (!nodeId) return;
    const hydrated = {};
    if (includeDefenseLayout && defenseMap.has(nodeId)) {
      hydrated.cityDefenseLayout = defenseMap.get(nodeId);
    }
    if (includeBattlefieldLayout && battlefieldMap.has(nodeId)) {
      hydrated.cityBattlefieldLayout = battlefieldMap.get(nodeId);
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

const resolveNodeBattlefieldState = (node, fallback = null) => {
  if (isDomainTitleStateCollectionReadEnabled()) {
    const fromCollection = node?.__titleStateCollection?.cityBattlefieldLayout;
    if (fromCollection && typeof fromCollection === 'object') {
      return fromCollection;
    }
  }
  if (node?.cityDefenseLayout?.battlefieldLayouts || node?.cityDefenseLayout?.battlefieldObjects || node?.cityDefenseLayout?.battlefieldItems) {
    return normalizeBattlefieldState({
      layouts: node?.cityDefenseLayout?.battlefieldLayouts,
      items: node?.cityDefenseLayout?.battlefieldItems,
      objects: node?.cityDefenseLayout?.battlefieldObjects,
      updatedAt: node?.cityDefenseLayout?.updatedAt
    });
  }
  if (node?.cityDefenseLayout?.battlefieldLayout && typeof node.cityDefenseLayout.battlefieldLayout === 'object') {
    return normalizeBattlefieldState(node.cityDefenseLayout.battlefieldLayout);
  }
  if (fallback && typeof fallback === 'object') return normalizeBattlefieldState(fallback);
  return createDefaultBattlefieldState();
};

const resolveNodeBattlefieldLayout = resolveNodeBattlefieldState;

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

const upsertNodeBattlefieldState = async ({ nodeId, battlefieldState = {}, actorUserId = null } = {}) => {
  if (!isDomainTitleStateCollectionWriteEnabled()) {
    return { skipped: true, modified: 0, upserted: 0 };
  }
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) return { skipped: false, modified: 0, upserted: 0 };

  const normalized = normalizeBattlefieldState(battlefieldState);
  const actorId = toObjectIdOrNull(actorUserId);
  const legacyMirror = toLegacyBattlefieldLayoutFromState(normalized, 'cheng');
  const result = await DomainDefenseLayout.updateOne(
    { nodeId: safeNodeId },
    {
      $set: {
        battlefieldLayouts: normalized.layouts,
        battlefieldItems: normalized.items,
        battlefieldObjects: normalized.objects,
        battlefieldLayout: legacyMirror,
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
    battlefieldState: normalized
  };
};

const upsertNodeBattlefieldLayout = async ({ nodeId, battlefieldLayout = {}, actorUserId = null } = {}) => (
  upsertNodeBattlefieldState({
    nodeId,
    battlefieldState: normalizeBattlefieldState(battlefieldLayout),
    actorUserId
  })
);

const upsertNodeSiegeState = async ({
  nodeId,
  siegeState = {},
  actorUserId = null,
  expectedUpdatedAt = null
} = {}) => {
  if (!isDomainTitleStateCollectionWriteEnabled()) {
    return { skipped: true, modified: 0, upserted: 0 };
  }
  const safeNodeId = toObjectIdOrNull(nodeId);
  if (!safeNodeId) return { skipped: false, modified: 0, upserted: 0 };

  const normalized = normalizeSiegeState(siegeState);
  const actorId = toObjectIdOrNull(actorUserId);
  const now = new Date();
  const filter = { nodeId: safeNodeId };
  if (expectedUpdatedAt) {
    filter.updatedAt = new Date(expectedUpdatedAt);
  }

  const result = await DomainSiegeState.updateOne(
    filter,
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
    conflict: Boolean(expectedUpdatedAt) && (result?.matchedCount || 0) === 0 && (result?.upsertedCount || 0) === 0,
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

  const participantRows = await SiegeParticipant.find({
    userId: safeUserId,
    status: { $in: ['moving', 'sieging'] }
  }).select('nodeId').lean();
  const nodeIds = Array.from(new Set(
    participantRows
      .map((row) => toObjectIdOrNull(row?.nodeId))
      .filter(Boolean)
      .map((id) => String(id))
  )).map((id) => new mongoose.Types.ObjectId(id));

  if (nodeIds.length > 0) {
    return DomainSiegeState.find({
      nodeId: { $in: nodeIds }
    }).select(select).lean();
  }

  return DomainSiegeState.find({
    $or: [
      { 'cheng.attackers.userId': safeUserId },
      { 'qi.attackers.userId': safeUserId }
    ]
  }).select(select).lean();
};

module.exports = {
  CITY_GATE_KEYS,
  BATTLEFIELD_VERSION,
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  BATTLEFIELD_MAX_STACK_LEVEL,
  BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE,
  createDefaultDefenseLayout,
  createDefaultBattlefieldState,
  createDefaultBattlefieldLayout: createDefaultBattlefieldState,
  createDefaultSiegeState,
  hasLegacyDefenseLayoutData,
  hasLegacyBattlefieldLayoutData,
  hasLegacySiegeStateData,
  isDomainTitleStateCollectionReadEnabled,
  isDomainTitleStateCollectionWriteEnabled,
  normalizeDefenseLayout,
  normalizeBattlefieldState,
  normalizeBattlefieldLayout: normalizeBattlefieldState,
  normalizeBattlefieldLayouts,
  normalizeBattlefieldItems,
  normalizeBattlefieldObjects,
  toLegacyBattlefieldLayoutFromState,
  normalizeSiegeState,
  hydrateNodeTitleStatesForNodes,
  resolveNodeDefenseLayout,
  resolveNodeBattlefieldState,
  resolveNodeBattlefieldLayout,
  resolveNodeSiegeState,
  upsertNodeDefenseLayout,
  upsertNodeBattlefieldState,
  upsertNodeBattlefieldLayout,
  upsertNodeSiegeState,
  deleteNodeTitleStatesByNodeIds,
  loadDefenseLayoutMapByNodeIds,
  loadBattlefieldLayoutMapByNodeIds,
  loadSiegeStateMapByNodeIds,
  listSiegeStatesByAttackerUserId
};
