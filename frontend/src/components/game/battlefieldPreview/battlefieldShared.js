import * as THREE from 'three';

export const CAMERA_ANGLE_PREVIEW = 45;
export const CAMERA_ANGLE_EDIT = 45;
export const CAMERA_YAW_DEFAULT = 0;
export const CAMERA_TWEEN_MS = 260;
export const CAMERA_ROTATE_SENSITIVITY = 0.38;
export const CAMERA_ROTATE_CLICK_THRESHOLD = 4;
export const FIELD_WIDTH = 2700;
export const FIELD_HEIGHT = 1488;
export const MAX_STACK_LEVEL = 31;
export const BASE_DEFENSE = 1.1;
export const BASE_HP = 240;
export const WALL_WIDTH = 69.333;
export const WALL_DEPTH = 16;
export const WALL_HEIGHT = 28;
export const STACK_LAYER_HEIGHT = WALL_HEIGHT;
export const ROTATE_STEP = 7.5;
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;
export const ZOOM_STEP = 0.08;
export const BASELINE_FIELD_COVERAGE = 0.85;
export const DEFAULT_VIEWPORT_WIDTH = 920;
export const DEFAULT_VIEWPORT_HEIGHT = 620;
export const WALL_ACTION_ICON_RADIUS = 12;
export const WALL_ACTION_ICON_GAP = 34;
export const WALL_ACTION_ICON_RISE = 32;
export const SCREEN_HIT_TOLERANCE_PX = 4;
export const DEPLOY_ZONE_RATIO = 0.2;
export const DEFAULT_MAX_ITEMS_PER_TYPE = 10;
export const SNAP_EPSILON = 1.2;
export const CACHE_VERSION = 3;
export const CACHE_PREFIX = 'battlefield_layout_cache_v3';
export const DEFENDER_SOLDIER_VISUAL_SCALE = 3.52;
export const DEFENDER_FORMATION_METRIC_BUDGET = 48;
export const DEFENDER_DEFAULT_FACING_DEG = 90;
export const DEFENDER_OVERLAP_RATIO = 0.82;
export const DEFENDER_OVERLAP_ALLOWANCE = 4;
export const MERGE_HP_SCALE_PER_LINK = 0.1;
export const MERGE_DEFENSE_SCALE_PER_LINK = 0.05;
export const PALETTE_WALL_TEMPLATE = {
  itemId: '',
  width: WALL_WIDTH,
  depth: WALL_DEPTH,
  height: WALL_HEIGHT,
  hp: BASE_HP,
  defense: BASE_DEFENSE,
  maxStack: null
};

let bushBladeTexture = null;

export const getBushBladeTexture = () => {
  if (bushBladeTexture) return bushBladeTexture;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
  gradient.addColorStop(0, 'rgba(31,83,42,0)');
  gradient.addColorStop(0.14, 'rgba(45,128,62,0.88)');
  gradient.addColorStop(0.7, 'rgba(128,208,103,0.95)');
  gradient.addColorStop(1, 'rgba(182,238,156,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.5, canvas.height * 0.03);
  ctx.quadraticCurveTo(canvas.width * 0.13, canvas.height * 0.38, canvas.width * 0.34, canvas.height * 0.98);
  ctx.quadraticCurveTo(canvas.width * 0.5, canvas.height * 0.86, canvas.width * 0.66, canvas.height * 0.98);
  ctx.quadraticCurveTo(canvas.width * 0.87, canvas.height * 0.38, canvas.width * 0.5, canvas.height * 0.03);
  ctx.closePath();
  ctx.fill();

  bushBladeTexture = new THREE.CanvasTexture(canvas);
  bushBladeTexture.colorSpace = THREE.SRGBColorSpace;
  bushBladeTexture.wrapS = THREE.ClampToEdgeWrapping;
  bushBladeTexture.wrapT = THREE.ClampToEdgeWrapping;
  bushBladeTexture.needsUpdate = true;
  return bushBladeTexture;
};

const disposeThreeNode = (node) => {
  if (!node) return;
  if (node.geometry && typeof node.geometry.dispose === 'function') {
    node.geometry.dispose();
  }
  if (Array.isArray(node.material)) {
    node.material.forEach((mat) => {
      if (mat && typeof mat.dispose === 'function') mat.dispose();
    });
  } else if (node.material && typeof node.material.dispose === 'function') {
    node.material.dispose();
  }
};

export const clearThreeGroup = (group) => {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    if (!child) continue;
    group.remove(child);
    clearThreeGroup(child);
    disposeThreeNode(child);
  }
};

export const normalizeDeg = (deg) => {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
};

export const degToRad = (deg) => (normalizeDeg(deg) * Math.PI) / 180;

export const roundTo = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

export const clampStackLimit = (value, fallback = MAX_STACK_LEVEL) => {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(1, Math.min(MAX_STACK_LEVEL, Math.floor(Number(value))));
};

export const resolveFormationBudgetByZoom = (zoomValue) => {
  const minZoom = Math.max(0.01, MIN_ZOOM);
  const maxZoom = Math.max(minZoom + 0.01, MAX_ZOOM);
  const safeZoom = Math.max(minZoom, Math.min(maxZoom, Number(zoomValue) || DEFAULT_ZOOM));
  const t = (safeZoom - minZoom) / (maxZoom - minZoom);
  const eased = Math.sqrt(Math.max(0, Math.min(1, t)));
  return Math.max(32, Math.min(56, Math.round(32 + (eased * 24))));
};

export const resolveDefenderFootprintScaleByCount = (totalUnits) => {
  const safeTotal = Math.max(1, Math.floor(Number(totalUnits) || 0));
  const soldierEquivalent = safeTotal / 10;
  const scale = 0.9 + (Math.log10(soldierEquivalent + 1) * 0.55);
  return Math.max(0.9, Math.min(2.4, scale));
};

export const parseHexColor = (value, fallback = 0xffffff) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

export const lerp = (a, b, t) => (a + ((b - a) * t));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const easeOutCubic = (t) => (1 - ((1 - t) ** 3));

export const getGroundProjectionScale = (tiltDeg) => {
  const tilt = (Math.max(1, Number(tiltDeg) || CAMERA_ANGLE_PREVIEW) * Math.PI) / 180;
  return Math.max(0.15, Math.sin(tilt));
};

const getCameraConfig = (tiltDeg, yawDeg = CAMERA_YAW_DEFAULT) => {
  const yaw = degToRad(yawDeg);
  const tilt = degToRad(tiltDeg);
  return {
    yawCos: Math.cos(yaw),
    yawSin: Math.sin(yaw),
    tiltSin: Math.sin(tilt),
    tiltCos: Math.cos(tilt)
  };
};

export const getWallBaseZ = (wall = {}) => (
  Math.max(0, Number(wall?.z) || 0)
  * Math.max(10, Number(wall?.height) || STACK_LAYER_HEIGHT)
);

export const getWallTopZ = (wall = {}) => (
  getWallBaseZ(wall) + Math.max(10, Number(wall?.height) || WALL_HEIGHT)
);

export const tintHexColor = (hex, hueShift = 0, satScale = 1, lightOffset = 0) => {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.h = ((hsl.h + hueShift) % 1 + 1) % 1;
  hsl.s = clamp01(hsl.s * satScale);
  hsl.l = clamp01(hsl.l + lightOffset);
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color.getHex();
};

export const getBattlefieldCacheKey = (nodeId, gateKey) => (
  `${CACHE_PREFIX}:${nodeId || ''}:${gateKey || 'cheng'}`
);

export const readBattlefieldCache = (nodeId, gateKey) => {
  if (!nodeId) return null;
  try {
    const raw = localStorage.getItem(getBattlefieldCacheKey(nodeId, gateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed?.version) !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const createWallFromLike = (wallLike = {}, overrides = {}) => ({
  id: overrides.id || `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  itemId: typeof (overrides.itemId ?? wallLike.itemId ?? wallLike.itemType) === 'string'
    ? String(overrides.itemId ?? wallLike.itemId ?? wallLike.itemType).trim()
    : '',
  x: Number.isFinite(Number(overrides.x)) ? Number(overrides.x) : (Number(wallLike.x) || 0),
  y: Number.isFinite(Number(overrides.y)) ? Number(overrides.y) : (Number(wallLike.y) || 0),
  z: Number.isFinite(Number(overrides.z)) ? Math.max(0, Number(overrides.z)) : Math.max(0, Number(wallLike.z) || 0),
  rotation: normalizeDeg(overrides.rotation ?? wallLike.rotation ?? 0),
  width: Math.max(20, Number(overrides.width ?? wallLike.width ?? WALL_WIDTH) || WALL_WIDTH),
  depth: Math.max(12, Number(overrides.depth ?? wallLike.depth ?? WALL_DEPTH) || WALL_DEPTH),
  height: Math.max(10, Number(overrides.height ?? wallLike.height ?? WALL_HEIGHT) || WALL_HEIGHT),
  hp: Math.max(1, Math.floor(Number(overrides.hp ?? wallLike.hp ?? BASE_HP) || BASE_HP)),
  defense: Math.max(0.1, Number(overrides.defense ?? wallLike.defense ?? BASE_DEFENSE) || BASE_DEFENSE),
  maxStack: Number.isFinite(Number(overrides.maxStack ?? wallLike.maxStack))
    ? clampStackLimit(overrides.maxStack ?? wallLike.maxStack)
    : null,
  baseHp: Math.max(1, Math.floor(Number(
    overrides.baseHp
    ?? wallLike.baseHp
    ?? overrides.hp
    ?? wallLike.hp
    ?? BASE_HP
  ) || BASE_HP)),
  baseDefense: Math.max(0.1, Number(
    overrides.baseDefense
    ?? wallLike.baseDefense
    ?? overrides.defense
    ?? wallLike.defense
    ?? BASE_DEFENSE
  ) || BASE_DEFENSE),
  baseMaxStack: Number.isFinite(Number(
    overrides.baseMaxStack
    ?? wallLike.baseMaxStack
    ?? overrides.maxStack
    ?? wallLike.maxStack
  ))
    ? clampStackLimit(
      overrides.baseMaxStack
      ?? wallLike.baseMaxStack
      ?? overrides.maxStack
      ?? wallLike.maxStack
    )
    : null,
  mergeCount: Math.max(1, Math.floor(Number(overrides.mergeCount ?? wallLike.mergeCount) || 1)),
  attach: (() => {
    const sourceAttach = overrides.attach ?? wallLike.attach;
    if (!sourceAttach || typeof sourceAttach !== 'object') return null;
    const parentObjectId = typeof sourceAttach.parentObjectId === 'string' ? sourceAttach.parentObjectId.trim() : '';
    const parentSocketId = typeof sourceAttach.parentSocketId === 'string' ? sourceAttach.parentSocketId.trim() : '';
    const childSocketId = typeof sourceAttach.childSocketId === 'string' ? sourceAttach.childSocketId.trim() : '';
    if (!parentObjectId || !parentSocketId || !childSocketId) return null;
    return { parentObjectId, parentSocketId, childSocketId };
  })(),
  groupId: typeof (overrides.groupId ?? wallLike.groupId) === 'string'
    ? String(overrides.groupId ?? wallLike.groupId).trim()
    : ''
});

export const sanitizeWalls = (rawWalls = []) => {
  const source = Array.isArray(rawWalls) ? rawWalls : [];
  const seen = new Set();
  const out = [];
  source.forEach((item, index) => {
    const next = createWallFromLike(item, {
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `wall_${index + 1}`,
      itemId: typeof item?.itemId === 'string'
        ? item.itemId
        : (typeof item?.itemType === 'string' ? item.itemType : (typeof item?.type === 'string' ? item.type : '')),
      z: Math.max(0, Math.min(MAX_STACK_LEVEL - 1, Number(item?.z) || 0)),
      attach: item?.attach && typeof item.attach === 'object' ? item.attach : null,
      groupId: typeof item?.groupId === 'string' ? item.groupId : ''
    });
    if (!next.itemId) return;
    if (seen.has(next.id)) return;
    seen.add(next.id);
    out.push(next);
  });
  return out;
};

const LEGACY_WALL_ID_PATTERN = /^wall_\d+$/;
const LEGACY_DEFAULT_ITEM_IDS = new Set(['wood_wall', 'woodwall', 'wall', 'wood']);

const looksLikeLegacyDefaultWalls = (walls = []) => {
  const source = Array.isArray(walls) ? walls : [];
  if (source.length === 0) return false;
  if (source.length > 24) return false;
  const allLegacyIds = source.every((item) => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    return LEGACY_WALL_ID_PATTERN.test(id);
  });
  if (!allLegacyIds) return false;
  const allLegacyItems = source.every((item) => {
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim().toLowerCase() : '';
    return !itemId || LEGACY_DEFAULT_ITEM_IDS.has(itemId);
  });
  return allLegacyItems;
};

export const sanitizeWallsWithLegacyCleanup = (rawWalls = []) => {
  const sanitized = sanitizeWalls(rawWalls);
  if (!looksLikeLegacyDefaultWalls(sanitized)) {
    return {
      walls: sanitized,
      clearedLegacy: false
    };
  }
  return {
    walls: [],
    clearedLegacy: true
  };
};

export const cloneWalls = (sourceWalls = []) => (
  sanitizeWalls(sourceWalls).map((item) => ({ ...item }))
);

export const normalizeDefenderUnits = (rawUnits = [], fallbackUnitTypeId = '', fallbackCount = 0) => {
  const source = Array.isArray(rawUnits) && rawUnits.length > 0
    ? rawUnits
    : [{ unitTypeId: fallbackUnitTypeId, count: fallbackCount }];
  const map = new Map();
  source.forEach((item) => {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(item?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    map.set(unitTypeId, (map.get(unitTypeId) || 0) + count);
  });
  return Array.from(map.entries())
    .map(([unitTypeId, count]) => ({ unitTypeId, count }))
    .sort((a, b) => b.count - a.count);
};

export const getDeploymentTotalCount = (deployment = {}) => (
  normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count)
    .reduce((sum, entry) => sum + entry.count, 0)
);

export const normalizeDefenderFacingDeg = (value) => {
  const maybe = Number(value);
  if (!Number.isFinite(maybe)) return DEFENDER_DEFAULT_FACING_DEG;
  return normalizeDeg(maybe);
};

export const sanitizeDefenderDeployments = (rawDeployments = []) => {
  const source = Array.isArray(rawDeployments) ? rawDeployments : [];
  const out = [];
  const seen = new Set();
  source.forEach((item, index) => {
    const deployId = typeof item?.deployId === 'string' && item.deployId.trim()
      ? item.deployId.trim()
      : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `deploy_${index + 1}`);
    const units = normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count);
    if (!deployId || units.length <= 0) return;
    if (seen.has(deployId)) return;
    seen.add(deployId);
    const primary = units[0];
    out.push({
      deployId,
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
      placed: item?.placed !== false,
      rotation: normalizeDefenderFacingDeg(item?.rotation),
      units,
      unitTypeId: primary.unitTypeId,
      count: primary.count,
      x: Number.isFinite(Number(item?.x)) ? Number(item.x) : 0,
      y: Number.isFinite(Number(item?.y)) ? Number(item.y) : 0
    });
  });
  return out;
};

export const normalizeDefenderDeploymentsToRightZone = (
  rawDeployments = [],
  fieldWidth = FIELD_WIDTH,
  fieldHeight = FIELD_HEIGHT
) => {
  const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
  const minX = (safeFieldWidth / 2) - (safeFieldWidth * DEPLOY_ZONE_RATIO);
  const maxX = safeFieldWidth / 2;
  const minY = -safeFieldHeight / 2;
  const maxY = safeFieldHeight / 2;
  return sanitizeDefenderDeployments(rawDeployments).map((item) => ({
    ...item,
    x: Math.max(minX, Math.min(maxX, Number(item?.x) || 0)),
    y: Math.max(minY, Math.min(maxY, Number(item?.y) || 0))
  }));
};

export const normalizeItemCatalog = (items = []) => {
  const source = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();
  source.forEach((item) => {
    const itemId = typeof item?.itemId === 'string' && item.itemId.trim()
      ? item.itemId.trim()
      : (typeof item?.itemType === 'string' && item.itemType.trim()
        ? item.itemType.trim()
        : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : ''));
    if (!itemId || seen.has(itemId)) return;
    seen.add(itemId);
    out.push({
      itemId,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : itemId,
      description: typeof item?.description === 'string' ? item.description.trim() : '',
      initialCount: Math.max(0, Math.floor(Number(item?.initialCount) || 0)),
      width: Math.max(12, Number(item?.width) || WALL_WIDTH),
      depth: Math.max(12, Number(item?.depth) || WALL_DEPTH),
      height: Math.max(10, Number(item?.height) || WALL_HEIGHT),
      hp: Math.max(1, Math.floor(Number(item?.hp) || BASE_HP)),
      defense: Math.max(0.1, Number(item?.defense) || BASE_DEFENSE),
      style: item?.style && typeof item.style === 'object' ? item.style : {},
      collider: item?.collider && typeof item.collider === 'object' ? item.collider : null,
      renderProfile: item?.renderProfile && typeof item.renderProfile === 'object' ? item.renderProfile : null,
      interactions: Array.isArray(item?.interactions) ? item.interactions : [],
      sockets: Array.isArray(item?.sockets) ? item.sockets : [],
      maxStack: Number.isFinite(Number(item?.maxStack)) ? Math.max(1, Math.floor(Number(item.maxStack))) : null,
      requiresSupport: item?.requiresSupport === true,
      snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0
    });
  });
  return out;
};

export const writeBattlefieldCache = (nodeId, gateKey, payload = {}) => {
  if (!nodeId) return;
  const cachePayload = {
    version: CACHE_VERSION,
    nodeId,
    gateKey: gateKey || 'cheng',
    needsSync: !!payload.needsSync,
    updatedAt: new Date().toISOString(),
    layoutMeta: payload.layoutMeta && typeof payload.layoutMeta === 'object' ? payload.layoutMeta : null,
    itemCatalog: normalizeItemCatalog(payload.itemCatalog),
    walls: sanitizeWalls(payload.walls),
    defenderDeployments: sanitizeDefenderDeployments(payload.defenderDeployments),
    message: typeof payload.message === 'string' ? payload.message : ''
  };
  localStorage.setItem(getBattlefieldCacheKey(nodeId, gateKey), JSON.stringify(cachePayload));
};

export const mapLayoutBundleToWalls = (layoutBundle = {}) => {
  const sourceObjects = Array.isArray(layoutBundle?.objects) ? layoutBundle.objects : [];
  if (sourceObjects.length === 0) return [];
  const itemCatalog = normalizeItemCatalog(layoutBundle?.itemCatalog);
  const itemDefById = new Map(itemCatalog.map((item) => [item.itemId, item]));
  return sanitizeWalls(sourceObjects.map((item, index) => {
    const itemId = typeof item?.itemId === 'string' && item.itemId.trim()
      ? item.itemId.trim()
      : (typeof item?.itemType === 'string' && item.itemType.trim()
        ? item.itemType.trim()
        : (typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : ''));
    const itemDef = itemDefById.get(itemId) || null;
    return {
      id: typeof item?.id === 'string' && item.id.trim()
        ? item.id.trim()
        : (typeof item?.objectId === 'string' && item.objectId.trim()
          ? item.objectId.trim()
          : `wall_${index + 1}`),
      itemId,
      x: item?.x,
      y: item?.y,
      z: item?.z,
      rotation: item?.rotation,
      attach: item?.attach && typeof item.attach === 'object' ? item.attach : null,
      groupId: typeof item?.groupId === 'string' ? item.groupId : '',
      width: itemDef?.width,
      depth: itemDef?.depth,
      height: itemDef?.height,
      hp: itemDef?.hp,
      defense: itemDef?.defense,
      maxStack: itemDef?.maxStack,
      baseHp: itemDef?.hp,
      baseDefense: itemDef?.defense,
      baseMaxStack: itemDef?.maxStack
    };
  }));
};

export const mapLayoutBundleToDefenderDeployments = (layoutBundle = {}) => (
  sanitizeDefenderDeployments(layoutBundle?.defenderDeployments || [])
);

export const buildLayoutPayload = ({ walls = [], defenderDeployments = [], layoutMeta = {}, itemCatalog = [], gateKey = '' } = {}) => ({
  gateKey,
  layout: {
    layoutId: typeof layoutMeta?.layoutId === 'string' ? layoutMeta.layoutId : '',
    name: typeof layoutMeta?.name === 'string' ? layoutMeta.name : '',
    fieldWidth: Number.isFinite(Number(layoutMeta?.fieldWidth)) ? Number(layoutMeta.fieldWidth) : FIELD_WIDTH,
    fieldHeight: Number.isFinite(Number(layoutMeta?.fieldHeight)) ? Number(layoutMeta.fieldHeight) : FIELD_HEIGHT,
    maxItemsPerType: Number.isFinite(Number(layoutMeta?.maxItemsPerType))
      ? Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Math.floor(Number(layoutMeta.maxItemsPerType)))
      : DEFAULT_MAX_ITEMS_PER_TYPE
  },
  itemCatalog: normalizeItemCatalog(itemCatalog).map((item) => ({
    itemId: item.itemId,
    name: item.name,
    description: item.description || '',
    initialCount: Math.max(0, Math.floor(Number(item.initialCount) || 0)),
    width: roundTo(item.width, 3),
    depth: roundTo(item.depth, 3),
    height: roundTo(item.height, 3),
    hp: Math.max(1, Math.floor(Number(item.hp) || BASE_HP)),
    defense: roundTo(Math.max(0.1, Number(item.defense) || BASE_DEFENSE), 3),
    style: item?.style && typeof item.style === 'object' ? item.style : {},
    collider: item?.collider && typeof item.collider === 'object' ? item.collider : null,
    renderProfile: item?.renderProfile && typeof item.renderProfile === 'object' ? item.renderProfile : null,
    interactions: Array.isArray(item?.interactions) ? item.interactions : [],
    sockets: Array.isArray(item?.sockets) ? item.sockets : [],
    maxStack: Number.isFinite(Number(item?.maxStack)) ? Math.max(1, Math.floor(Number(item.maxStack))) : null,
    requiresSupport: item?.requiresSupport === true,
    snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0
  })),
  objects: sanitizeWalls(walls).map((item) => ({
    objectId: item.id,
    itemId: item.itemId || '',
    x: roundTo(item.x, 3),
    y: roundTo(item.y, 3),
    z: roundTo(Math.max(0, Number(item.z) || 0), 4),
    rotation: roundTo(item.rotation, 3),
    attach: item?.attach && typeof item.attach === 'object'
      ? {
          parentObjectId: typeof item.attach.parentObjectId === 'string' ? item.attach.parentObjectId : '',
          parentSocketId: typeof item.attach.parentSocketId === 'string' ? item.attach.parentSocketId : '',
          childSocketId: typeof item.attach.childSocketId === 'string' ? item.attach.childSocketId : ''
        }
      : null,
    groupId: typeof item?.groupId === 'string' ? item.groupId : ''
  })),
  defenderDeployments: sanitizeDefenderDeployments(defenderDeployments).map((item) => ({
    deployId: item.deployId,
    name: typeof item?.name === 'string' ? item.name : '',
    sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
    units: normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count).map((entry) => ({
      unitTypeId: entry.unitTypeId,
      count: Math.max(1, Math.floor(Number(entry.count) || 1))
    })),
    placed: item?.placed !== false,
    unitTypeId: item.unitTypeId,
    count: Math.max(1, Math.floor(Number(item.count) || 1)),
    x: roundTo(item.x, 3),
    y: roundTo(item.y, 3),
    rotation: roundTo(normalizeDefenderFacingDeg(item?.rotation), 3)
  }))
});

export const rotate2D = (x, y, deg) => {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos)
  };
};

export const dot2 = (a, b) => ((a.x * b.x) + (a.y * b.y));

export const projectWorld = (x, y, z, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const yawX = (x * camera.yawCos) - (y * camera.yawSin);
  const yawY = (x * camera.yawSin) + (y * camera.yawCos);
  const viewY = (yawY * camera.tiltSin) - (z * camera.tiltCos);
  const depth = (yawY * camera.tiltCos) + (z * camera.tiltSin);
  return {
    x: viewport.centerX + viewport.panX + (yawX * worldScale),
    y: viewport.centerY + viewport.panY - (viewY * worldScale),
    depth
  };
};

export const unprojectScreen = (sx, sy, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const safeScale = Math.max(0.0001, worldScale || 1);
  const safeGroundScale = Math.max(0.0001, camera.tiltSin);
  const yawX = (sx - viewport.centerX - viewport.panX) / safeScale;
  const yawY = (viewport.centerY + viewport.panY - sy) / (safeScale * safeGroundScale);
  return {
    x: (yawX * camera.yawCos) + (yawY * camera.yawSin),
    y: (-yawX * camera.yawSin) + (yawY * camera.yawCos)
  };
};
