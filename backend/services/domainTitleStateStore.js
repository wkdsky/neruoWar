const mongoose = require('mongoose');
const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const DomainSiegeState = require('../models/DomainSiegeState');
const SiegeParticipant = require('../models/SiegeParticipant');
const {
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
  normalizeBattlefieldItemGeometryScale
} = require('./battlefieldScale');

const CITY_GATE_KEYS = ['cheng', 'qi'];
const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const BATTLEFIELD_VERSION = 2;
const BATTLEFIELD_SCALE_V2 = 2;
const BATTLEFIELD_MAX_STACK_LEVEL = 5;
const BATTLEFIELD_LAYOUT_LIMIT = 24;
const BATTLEFIELD_ITEM_LIMIT = 240;
const BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE = 10;
const BATTLEFIELD_OBJECT_LIMIT = 600;
const BATTLEFIELD_DEFENDER_DEPLOYMENT_LIMIT = 400;
const BATTLEFIELD_OBJECT_DEFAULTS = {
  itemId: '',
  width: BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  depth: BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  height: BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
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

const toFiniteNumberOrNull = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeRotation = (value, fallback = 0) => {
  let next = Number(value);
  if (!Number.isFinite(next)) next = fallback;
  while (next < 0) next += 360;
  while (next >= 360) next -= 360;
  return round3(next, 0);
};

const normalizeOptionalObject = (value, fallback = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value;
};

const normalizeOptionalAttach = (value) => {
  const source = normalizeOptionalObject(value, null);
  if (!source) return null;
  const parentObjectId = typeof source?.parentObjectId === 'string' ? source.parentObjectId.trim() : '';
  const parentSocketId = typeof source?.parentSocketId === 'string' ? source.parentSocketId.trim() : '';
  const childSocketId = typeof source?.childSocketId === 'string' ? source.childSocketId.trim() : '';
  if (!parentObjectId || !parentSocketId || !childSocketId) return null;
  return {
    parentObjectId,
    parentSocketId,
    childSocketId
  };
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

const createDefaultBattlefieldItems = () => ([]);

const normalizeBattlefieldMaxItemsPerType = (value, fallback = BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(
    BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE,
    Math.min(9999, Math.floor(num))
  );
};

const seedDefaultBattlefieldObjects = (objects = []) => (
  Array.isArray(objects) ? objects : []
);

const ensureBattlefieldLayoutsByGate = (layouts = []) => {
  const source = Array.isArray(layouts) ? layouts : [];
  const out = [];
  const seenLayoutId = new Set();
  const gateHasLayout = new Set();
  source.forEach((layout) => {
    if (!layout || typeof layout !== 'object') return;
    const layoutId = typeof layout.layoutId === 'string' ? layout.layoutId.trim() : '';
    if (!layoutId || seenLayoutId.has(layoutId)) return;
    seenLayoutId.add(layoutId);
    const normalizedGate = CITY_GATE_KEYS.includes(layout.gateKey) ? layout.gateKey : '';
    if (normalizedGate) gateHasLayout.add(normalizedGate);
    out.push({
      ...layout,
      layoutId,
      gateKey: normalizedGate,
      maxItemsPerType: normalizeBattlefieldMaxItemsPerType(
        layout.maxItemsPerType,
        BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE
      )
    });
  });
  CITY_GATE_KEYS.forEach((gateKey) => {
    if (gateHasLayout.has(gateKey)) return;
    out.push({
      layoutId: `${gateKey}_default`,
      name: gateKey === 'cheng' ? '承门战场' : '启门战场',
      gateKey,
      fieldWidth: BATTLEFIELD_FIELD_WIDTH,
      fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
      maxItemsPerType: BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE,
      updatedAt: new Date()
    });
  });
  return out;
};

const createDefaultBattlefieldState = () => {
  const layouts = ensureBattlefieldLayoutsByGate(createDefaultBattlefieldLayouts());
  return {
    version: BATTLEFIELD_VERSION,
    layouts,
    items: [],
    objects: [],
    defenderDeployments: [],
    updatedAt: new Date()
  };
};

const createDefaultDefenseLayout = () => ({
  buildings: [],
  intelBuildingId: '',
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
      buildingTypeId: typeof item?.buildingTypeId === 'string' ? item.buildingTypeId.trim() : '',
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
    : (buildings[0]?.buildingId || '');

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
    const itemRaw = source[index] || {};
    const item = normalizeBattlefieldItemGeometryScale(itemRaw);
    const rawItemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
    const rawItemType = typeof item?.itemType === 'string' ? item.itemType.trim() : '';
    const fallbackType = typeof item?.type === 'string' ? item.type.trim() : '';
    const itemId = rawItemId || rawItemType || fallbackType;
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    items.push({
      itemId,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : itemId,
      description: typeof item?.description === 'string' ? item.description.trim().slice(0, 2048) : '',
      initialCount: Math.max(0, Math.floor(Number(item?.initialCount) || 0)),
      width: Math.max(12, Math.min(360, round3(item?.width, BATTLEFIELD_OBJECT_DEFAULTS.width))),
      depth: Math.max(12, Math.min(360, round3(item?.depth, BATTLEFIELD_OBJECT_DEFAULTS.depth))),
      height: Math.max(10, Math.min(360, round3(item?.height, BATTLEFIELD_OBJECT_DEFAULTS.height))),
      hp: Math.max(1, Math.floor(Number(item?.hp) || BATTLEFIELD_OBJECT_DEFAULTS.hp)),
      defense: Math.max(0.1, round3(item?.defense, BATTLEFIELD_OBJECT_DEFAULTS.defense)),
      style: item?.style && typeof item.style === 'object' ? item.style : {},
      collider: normalizeOptionalObject(item?.collider, null),
      renderProfile: normalizeOptionalObject(item?.renderProfile, null),
      interactions: Array.isArray(item?.interactions)
        ? item.interactions.filter((row) => row && typeof row === 'object').slice(0, 64)
        : [],
      sockets: Array.isArray(item?.sockets)
        ? item.sockets.filter((row) => row && typeof row === 'object').slice(0, 64)
        : [],
      maxStack: Number.isFinite(Number(item?.maxStack))
        ? Math.max(1, Math.min(31, Math.floor(Number(item.maxStack))))
        : null,
      requiresSupport: item?.requiresSupport === true,
      snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0
    });
    if (items.length >= BATTLEFIELD_ITEM_LIMIT) break;
  }
  return items;
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
      maxItemsPerType: normalizeBattlefieldMaxItemsPerType(item?.maxItemsPerType, BATTLEFIELD_DEFAULT_MAX_ITEMS_PER_TYPE),
      updatedAt: toValidDateOrNull(item?.updatedAt) || new Date()
    });
    if (layouts.length >= BATTLEFIELD_LAYOUT_LIMIT) break;
  }
  if (layouts.length === 0) {
    return ensureBattlefieldLayoutsByGate(createDefaultBattlefieldLayouts());
  }
  return ensureBattlefieldLayoutsByGate(layouts);
};

const normalizeBattlefieldObjects = (sourceObjects = [], options = {}) => {
  const source = Array.isArray(sourceObjects) ? sourceObjects : [];
  const layouts = Array.isArray(options.layouts) ? options.layouts : [];
  const itemById = options.itemById instanceof Map ? options.itemById : new Map();
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

    const rawItemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
    const rawItemType = typeof item?.itemType === 'string' ? item.itemType.trim() : '';
    const rawType = typeof item?.type === 'string' ? item.type.trim() : '';
    const itemId = rawItemId || rawItemType || rawType;
    if (!itemId) continue;
    const itemDef = itemById.get(itemId) || null;
    const itemStackLimit = Number.isFinite(Number(itemDef?.maxStack))
      ? Math.max(1, Math.min(31, Math.floor(Number(itemDef.maxStack))))
      : BATTLEFIELD_MAX_STACK_LEVEL;

    const minX = -(layout.fieldWidth / 2);
    const maxX = layout.fieldWidth / 2;
    const minY = -(layout.fieldHeight / 2);
    const maxY = layout.fieldHeight / 2;
    objects.push({
      layoutId,
      objectId: rawObjectId,
      itemId,
      x: Math.max(minX, Math.min(maxX, round3(item?.x, 0))),
      y: Math.max(minY, Math.min(maxY, round3(item?.y, 0))),
      z: Math.max(0, Math.min(itemStackLimit - 1, round3(item?.z, 0))),
      rotation: normalizeRotation(item?.rotation, 0),
      attach: normalizeOptionalAttach(item?.attach),
      groupId: typeof item?.groupId === 'string' ? item.groupId.trim() : ''
    });
    if (objects.length >= BATTLEFIELD_OBJECT_LIMIT) break;
  }
  return objects;
};

const normalizeBattlefieldDefenderDeployments = (sourceDeployments = [], options = {}) => {
  const source = Array.isArray(sourceDeployments) ? sourceDeployments : [];
  const layouts = Array.isArray(options.layouts) ? options.layouts : [];
  const layoutById = new Map(layouts.map((item) => [item.layoutId, item]));
  const defaultLayoutId = options.defaultLayoutId
    || layouts.find((item) => item.gateKey === 'cheng')?.layoutId
    || layouts[0]?.layoutId
    || 'cheng_default';
  const deployments = [];
  const seen = new Set();
  const normalizeDeploymentUnits = (row = {}) => {
    const sourceUnits = Array.isArray(row?.units)
      ? row.units
      : [{ unitTypeId: row?.unitTypeId, count: row?.count }];
    const unitMap = new Map();
    sourceUnits.forEach((entry) => {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) return;
      unitMap.set(unitTypeId, (unitMap.get(unitTypeId) || 0) + count);
    });
    return Array.from(unitMap.entries())
      .map(([unitTypeId, count]) => ({
        unitTypeId,
        count: Math.max(1, Math.min(999999, count))
      }))
      .sort((a, b) => b.count - a.count);
  };
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const rawLayoutId = typeof item?.layoutId === 'string' ? item.layoutId.trim() : '';
    const layoutId = layoutById.has(rawLayoutId) ? rawLayoutId : defaultLayoutId;
    const layout = layoutById.get(layoutId) || {
      fieldWidth: BATTLEFIELD_FIELD_WIDTH,
      fieldHeight: BATTLEFIELD_FIELD_HEIGHT
    };
    const rawDeployId = typeof item?.deployId === 'string' && item.deployId.trim()
      ? item.deployId.trim()
      : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `deploy_${index + 1}`);
    const dedupeKey = `${layoutId}:${rawDeployId}`;
    if (!rawDeployId || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const units = normalizeDeploymentUnits(item);
    if (units.length <= 0) continue;
    const primaryUnit = units[0];

    const minX = -(layout.fieldWidth / 2);
    const maxX = layout.fieldWidth / 2;
    const minY = -(layout.fieldHeight / 2);
    const maxY = layout.fieldHeight / 2;
    const rotationValue = Number(item?.rotation);
    deployments.push({
      layoutId,
      deployId: rawDeployId,
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
      units,
      unitTypeId: primaryUnit.unitTypeId,
      count: primaryUnit.count,
      x: Math.max(minX, Math.min(maxX, round3(item?.x, 0))),
      y: Math.max(minY, Math.min(maxY, round3(item?.y, 0))),
      rotation: Number.isFinite(rotationValue) ? normalizeRotation(rotationValue, 0) : undefined,
      placed: item?.placed !== false
    });
    if (deployments.length >= BATTLEFIELD_DEFENDER_DEPLOYMENT_LIMIT) break;
  }
  return deployments;
};

const resolveBattlefieldSourceVersion = (source = {}) => {
  const version = toFiniteNumberOrNull(source?.version);
  if (version !== null) {
    return Math.max(1, Math.floor(version));
  }
  return null;
};

const scaleBattlefieldStateForV2 = (state = {}) => {
  const sourceLayouts = Array.isArray(state?.layouts) ? state.layouts : [];
  const sourceObjects = Array.isArray(state?.objects) ? state.objects : [];
  const sourceDeployments = Array.isArray(state?.defenderDeployments) ? state.defenderDeployments : [];

  const layoutScaleById = new Map();
  const scaledLayouts = sourceLayouts.map((layout, index) => {
    const layoutId = typeof layout?.layoutId === 'string' ? layout.layoutId.trim() : '';
    const scaleKey = layoutId || `__idx_${index}`;
    const width = Math.max(200, Math.min(5000, round3(layout?.fieldWidth, BATTLEFIELD_FIELD_WIDTH)));
    const height = Math.max(200, Math.min(5000, round3(layout?.fieldHeight, BATTLEFIELD_FIELD_HEIGHT)));
    const nextWidth = Math.max(200, Math.min(5000, round3(width * BATTLEFIELD_SCALE_V2, width)));
    const nextHeight = Math.max(200, Math.min(5000, round3(height * BATTLEFIELD_SCALE_V2, height)));
    const ratioX = width > 1e-6 ? (nextWidth / width) : 1;
    const ratioY = height > 1e-6 ? (nextHeight / height) : 1;
    layoutScaleById.set(scaleKey, {
      ratioX,
      ratioY,
      minX: -(nextWidth / 2),
      maxX: nextWidth / 2,
      minY: -(nextHeight / 2),
      maxY: nextHeight / 2
    });
    if (layoutId) {
      layoutScaleById.set(layoutId, layoutScaleById.get(scaleKey));
    }
    return {
      ...layout,
      fieldWidth: nextWidth,
      fieldHeight: nextHeight
    };
  });

  const resolveScale = (layoutId = '', index = -1) => {
    const layoutKey = typeof layoutId === 'string' ? layoutId.trim() : '';
    if (layoutKey && layoutScaleById.has(layoutKey)) return layoutScaleById.get(layoutKey);
    const indexKey = index >= 0 ? `__idx_${index}` : '';
    if (indexKey && layoutScaleById.has(indexKey)) return layoutScaleById.get(indexKey);
    const fallbackWidth = Math.max(200, Math.min(5000, round3(BATTLEFIELD_FIELD_WIDTH, BATTLEFIELD_FIELD_WIDTH)));
    const fallbackHeight = Math.max(200, Math.min(5000, round3(BATTLEFIELD_FIELD_HEIGHT, BATTLEFIELD_FIELD_HEIGHT)));
    return {
      ratioX: BATTLEFIELD_SCALE_V2,
      ratioY: BATTLEFIELD_SCALE_V2,
      minX: -(fallbackWidth / 2),
      maxX: fallbackWidth / 2,
      minY: -(fallbackHeight / 2),
      maxY: fallbackHeight / 2
    };
  };

  const scalePoint = (value, ratio, min, max) => (
    Math.max(min, Math.min(max, round3((Number(value) || 0) * ratio, 0)))
  );

  const scaledObjects = sourceObjects.map((item, index) => {
    const scale = resolveScale(item?.layoutId, index);
    return {
      ...item,
      x: scalePoint(item?.x, scale.ratioX, scale.minX, scale.maxX),
      y: scalePoint(item?.y, scale.ratioY, scale.minY, scale.maxY)
    };
  });

  const scaledDefenderDeployments = sourceDeployments.map((item, index) => {
    const scale = resolveScale(item?.layoutId, index);
    return {
      ...item,
      x: scalePoint(item?.x, scale.ratioX, scale.minX, scale.maxX),
      y: scalePoint(item?.y, scale.ratioY, scale.minY, scale.maxY)
    };
  });

  return {
    ...state,
    layouts: scaledLayouts,
    objects: scaledObjects,
    defenderDeployments: scaledDefenderDeployments
  };
};

const finalizeBattlefieldState = (state = {}, sourceVersion = null) => {
  const parsedSourceVersion = toFiniteNumberOrNull(sourceVersion);
  const explicitVersion = parsedSourceVersion !== null
    ? Math.max(1, Math.floor(parsedSourceVersion))
    : null;
  let next = {
    ...state,
    layouts: Array.isArray(state?.layouts) ? state.layouts : ensureBattlefieldLayoutsByGate(createDefaultBattlefieldLayouts()),
    items: Array.isArray(state?.items) ? state.items : [],
    objects: Array.isArray(state?.objects) ? state.objects : [],
    defenderDeployments: Array.isArray(state?.defenderDeployments) ? state.defenderDeployments : [],
    updatedAt: toValidDateOrNull(state?.updatedAt) || new Date()
  };
  let resolvedVersion = explicitVersion ?? BATTLEFIELD_VERSION;
  if (explicitVersion !== null && explicitVersion < 2) {
    next = scaleBattlefieldStateForV2(next);
    resolvedVersion = 2;
  }
  return {
    ...next,
    version: Math.max(BATTLEFIELD_VERSION, resolvedVersion)
  };
};

const normalizeBattlefieldState = (source = {}) => {
  if (!source || typeof source !== 'object') {
    return createDefaultBattlefieldState();
  }
  const sourceVersion = resolveBattlefieldSourceVersion(source);

  const sourceLayouts = Array.isArray(source?.layouts)
    ? source.layouts
    : (Array.isArray(source?.battlefieldLayouts) ? source.battlefieldLayouts : []);
  const sourceItems = Array.isArray(source?.items)
    ? source.items
    : (Array.isArray(source?.battlefieldItems) ? source.battlefieldItems : []);
  const sourceObjects = Array.isArray(source?.objects)
    ? source.objects
    : (Array.isArray(source?.battlefieldObjects) ? source.battlefieldObjects : []);
  const sourceDefenderDeployments = Array.isArray(source?.defenderDeployments)
    ? source.defenderDeployments
    : (Array.isArray(source?.battlefieldDefenderDeployments) ? source.battlefieldDefenderDeployments : []);

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
      return finalizeBattlefieldState({
        layouts: defaults.layouts,
        items: defaults.items,
        objects,
        defenderDeployments: [],
        updatedAt: toValidDateOrNull(source?.updatedAt) || new Date()
      }, sourceVersion);
    }
  }

  const layouts = normalizeBattlefieldLayouts(sourceLayouts);
  const items = normalizeBattlefieldItems(sourceItems);
  const itemById = new Map(items.map((item) => [item.itemId, item]));
  const objects = normalizeBattlefieldObjects(sourceObjects, {
    layouts,
    defaultLayoutId: layouts.find((item) => item.gateKey === 'cheng')?.layoutId || layouts[0]?.layoutId,
    itemById
  });
  const defenderDeployments = normalizeBattlefieldDefenderDeployments(sourceDefenderDeployments, {
    layouts,
    defaultLayoutId: layouts.find((item) => item.gateKey === 'cheng')?.layoutId || layouts[0]?.layoutId
  });

  return finalizeBattlefieldState({
    layouts,
    items,
    objects: seedDefaultBattlefieldObjects(objects, layouts, items),
    defenderDeployments,
    updatedAt: toValidDateOrNull(source?.updatedAt) || new Date()
  }, sourceVersion);
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
  const itemById = new Map(state.items.map((item) => [item.itemId, item]));
  const objects = state.objects
    .filter((item) => item.layoutId === targetLayout.layoutId)
    .map((item) => {
      const itemDef = itemById.get(item.itemId) || {
        width: BATTLEFIELD_OBJECT_DEFAULTS.width,
        depth: BATTLEFIELD_OBJECT_DEFAULTS.depth,
        height: BATTLEFIELD_OBJECT_DEFAULTS.height,
        hp: BATTLEFIELD_OBJECT_DEFAULTS.hp,
        defense: BATTLEFIELD_OBJECT_DEFAULTS.defense
      };
      return {
        objectId: item.objectId,
        type: item.itemId,
        itemId: item.itemId,
        x: item.x,
        y: item.y,
        z: item.z,
        rotation: item.rotation,
        attach: normalizeOptionalAttach(item?.attach),
        groupId: typeof item?.groupId === 'string' ? item.groupId.trim() : '',
        width: itemDef.width,
        depth: itemDef.depth,
        height: itemDef.height,
        hp: itemDef.hp,
        defense: itemDef.defense
      };
    });
  const defenderDeployments = (Array.isArray(state.defenderDeployments) ? state.defenderDeployments : [])
    .filter((item) => item?.placed !== false)
    .filter((item) => item.layoutId === targetLayout.layoutId)
    .flatMap((item) => {
      const sourceUnits = Array.isArray(item?.units) && item.units.length > 0
        ? item.units
        : [{ unitTypeId: item?.unitTypeId, count: item?.count }];
      return sourceUnits
        .map((entry, idx) => {
          const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
          const count = Math.max(1, Math.floor(Number(entry?.count) || 1));
          if (!unitTypeId) return null;
          const rotationValue = Number(item?.rotation);
          return {
            layoutId: item.layoutId,
            deployId: idx === 0 ? item.deployId : `${item.deployId}_${idx + 1}`,
            unitTypeId,
            count,
            x: round3(item.x, 0),
            y: round3(item.y, 0),
            rotation: Number.isFinite(rotationValue) ? normalizeRotation(rotationValue, 0) : undefined
          };
        })
        .filter(Boolean);
    });
  return {
    version: state.version,
    fieldWidth: targetLayout.fieldWidth,
    fieldHeight: targetLayout.fieldHeight,
    objects,
    defenderDeployments,
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
    || Array.isArray(doc?.battlefieldDefenderDeployments)
  );
  const resolvedVersion = toFiniteNumberOrNull(doc?.battlefieldVersion) !== null
    ? Math.max(1, Math.floor(Number(doc.battlefieldVersion)))
    : (toFiniteNumberOrNull(doc?.battlefieldLayout?.version) !== null
      ? Math.max(1, Math.floor(Number(doc.battlefieldLayout.version)))
      : (toFiniteNumberOrNull(doc?.version) !== null ? Math.max(1, Math.floor(Number(doc.version))) : null));
  if (hasNewStructure) {
    return normalizeBattlefieldState({
      version: resolvedVersion,
      layouts: doc?.battlefieldLayouts,
      items: doc?.battlefieldItems,
      objects: doc?.battlefieldObjects,
      defenderDeployments: doc?.battlefieldDefenderDeployments,
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
    selectFields.push('battlefieldVersion', 'battlefieldLayouts', 'battlefieldItems', 'battlefieldObjects', 'battlefieldDefenderDeployments', 'battlefieldLayout');
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
      version: toFiniteNumberOrNull(node?.cityDefenseLayout?.battlefieldVersion) !== null
        ? Number(node.cityDefenseLayout.battlefieldVersion)
        : (toFiniteNumberOrNull(node?.cityDefenseLayout?.battlefieldLayout?.version) !== null
          ? Number(node.cityDefenseLayout.battlefieldLayout.version)
          : null),
      layouts: node?.cityDefenseLayout?.battlefieldLayouts,
      items: node?.cityDefenseLayout?.battlefieldItems,
      objects: node?.cityDefenseLayout?.battlefieldObjects,
      defenderDeployments: node?.cityDefenseLayout?.battlefieldDefenderDeployments,
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
        battlefieldVersion: normalized.version,
        battlefieldLayouts: normalized.layouts,
        battlefieldItems: normalized.items,
        battlefieldObjects: normalized.objects,
        battlefieldDefenderDeployments: normalized.defenderDeployments,
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
