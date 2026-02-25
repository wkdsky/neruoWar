import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import NumberPadDialog from '../common/NumberPadDialog';
import './BattlefieldPreviewModal.css';

const CAMERA_ANGLE_PREVIEW = 45;
const CAMERA_ANGLE_EDIT = 45;
const CAMERA_YAW_DEFAULT = 0;
const CAMERA_TWEEN_MS = 260;
const CAMERA_ROTATE_SENSITIVITY = 0.38;
const CAMERA_ROTATE_CLICK_THRESHOLD = 4;
const FIELD_WIDTH = 900;
const FIELD_HEIGHT = 620;
const MAX_STACK_LEVEL = 5;
const BASE_DEFENSE = 1.1;
const BASE_HP = 240;
const WALL_WIDTH = 104;
const WALL_DEPTH = 24;
const WALL_HEIGHT = 42;
const STACK_LAYER_HEIGHT = WALL_HEIGHT;
const ROTATE_STEP = 7.5;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const DEFAULT_ZOOM = 1;
const ZOOM_STEP = 0.08;
const BASELINE_FIELD_COVERAGE = 0.85;
const DEFAULT_VIEWPORT_WIDTH = 920;
const DEFAULT_VIEWPORT_HEIGHT = 620;
const WALL_ACTION_ICON_RADIUS = 12;
const WALL_ACTION_ICON_GAP = 34;
const WALL_ACTION_ICON_RISE = 32;
const SCREEN_HIT_TOLERANCE_PX = 4;
const DEPLOY_ZONE_RATIO = 0.2;
const API_BASE = 'http://localhost:5000';
const DEFAULT_MAX_ITEMS_PER_TYPE = 10;
const SNAP_EPSILON = 1.2;
const CACHE_VERSION = 2;
const CACHE_PREFIX = 'battlefield_layout_cache_v2';
const DEFENDER_SOLDIER_VISUAL_SCALE = 0.52;
const DEFENDER_SOLDIER_MIN = 3;
const DEFENDER_SOLDIER_MAX = 28;
const PALETTE_WALL_TEMPLATE = {
  itemId: '',
  width: WALL_WIDTH,
  depth: WALL_DEPTH,
  height: WALL_HEIGHT,
  hp: BASE_HP,
  defense: BASE_DEFENSE
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

const clearThreeGroup = (group) => {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    if (!child) continue;
    group.remove(child);
    clearThreeGroup(child);
    disposeThreeNode(child);
  }
};

const normalizeDeg = (deg) => {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
};

const degToRad = (deg) => (normalizeDeg(deg) * Math.PI) / 180;

const roundTo = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

const parseHexColor = (value, fallback = 0xffffff) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
};

const clampStyleNumber = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

const lerp = (a, b, t) => (a + ((b - a) * t));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t) => (1 - ((1 - t) ** 3));

const getGroundProjectionScale = (tiltDeg) => {
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

const getWallBaseZ = (wall = {}) => (
  Math.max(0, Math.floor(Number(wall?.z) || 0)) * STACK_LAYER_HEIGHT
);

const getWallTopZ = (wall = {}) => (
  getWallBaseZ(wall) + Math.max(10, Number(wall?.height) || WALL_HEIGHT)
);

const computeMiniFormationOffset = (index, total, radius = 18) => {
  const rowCount = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total))));
  const col = index % rowCount;
  const row = Math.floor(index / rowCount);
  const gap = Math.max(4, Math.min(12, radius * 0.46));
  return {
    x: (col - ((rowCount - 1) / 2)) * gap,
    y: (row - ((Math.ceil(total / rowCount) - 1) / 2)) * gap
  };
};

const hashStringToInt = (value = '') => {
  const text = typeof value === 'string' ? value : '';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const tintHexColor = (hex, hueShift = 0, satScale = 1, lightOffset = 0) => {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.h = ((hsl.h + hueShift) % 1 + 1) % 1;
  hsl.s = clamp01(hsl.s * satScale);
  hsl.l = clamp01(hsl.l + lightOffset);
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color.getHex();
};

const inferDefenderUnitClass = (unitName = '', roleTag = '') => {
  const name = typeof unitName === 'string' ? unitName : '';
  const role = roleTag === '远程' || roleTag === '近战' ? roleTag : '';
  if (/(骑|骑兵|铁骑)/.test(name)) return 'cavalry';
  if (/(弓|弓兵|弩)/.test(name)) return 'archer';
  if (/(炮|投石|火炮)/.test(name)) return 'artillery';
  if (role === '远程') return 'archer';
  if (role === '近战') return 'infantry';
  return 'infantry';
};

const buildDefenderUnitVisual = (unitTypeId = '', unitName = '', roleTag = '', blocked = false) => {
  const classTag = inferDefenderUnitClass(unitName || unitTypeId, roleTag);
  const classBaseColor = classTag === 'cavalry'
    ? 0xf59e0b
    : (classTag === 'archer'
      ? 0x34d399
      : (classTag === 'artillery' ? 0xfb7185 : 0x60a5fa));
  const classAccentColor = classTag === 'cavalry'
    ? 0xfef3c7
    : (classTag === 'archer'
      ? 0xd1fae5
      : (classTag === 'artillery' ? 0xffe4e6 : 0xdbeafe));
  if (blocked) {
    return {
      classTag,
      bodyColor: 0xf87171,
      accentColor: 0xfee2e2
    };
  }
  const seed = hashStringToInt(`${unitTypeId}|${unitName}`);
  const hueShift = ((seed % 17) - 8) / 240;
  const lightShift = ((Math.floor(seed / 17) % 9) - 4) / 100;
  return {
    classTag,
    bodyColor: tintHexColor(classBaseColor, hueShift, 1.08, lightShift),
    accentColor: tintHexColor(classAccentColor, hueShift * 0.6, 1, lightShift * 0.7)
  };
};

const buildDefenderSoldierTokens = (units = [], soldierCount = 0, resolveMeta = () => null, blocked = false) => {
  const safeCount = Math.max(0, Math.floor(Number(soldierCount) || 0));
  if (safeCount <= 0) return [];
  const source = normalizeDefenderUnits(units).filter((entry) => entry.count > 0);
  if (source.length <= 0) return [];

  const enriched = source.map((entry) => {
    const unitTypeId = entry.unitTypeId;
    const meta = (typeof resolveMeta === 'function' ? resolveMeta(unitTypeId) : null) || {};
    const unitName = typeof meta?.unitName === 'string' && meta.unitName.trim()
      ? meta.unitName.trim()
      : unitTypeId;
    const roleTag = meta?.roleTag === '远程' || meta?.roleTag === '近战' ? meta.roleTag : '';
    const visual = buildDefenderUnitVisual(unitTypeId, unitName, roleTag, blocked);
    return {
      unitTypeId,
      count: entry.count,
      unitName,
      roleTag,
      ...visual,
      slots: 0
    };
  });

  if (safeCount <= enriched.length) {
    return enriched
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.unitTypeId.localeCompare(b.unitTypeId, 'zh-Hans-CN');
      })
      .slice(0, safeCount);
  }

  enriched.forEach((item) => {
    item.slots = 1;
  });
  let remaining = safeCount - enriched.length;
  const totalUnits = enriched.reduce((sum, item) => sum + item.count, 0);
  let baseAssigned = 0;
  const weighted = enriched.map((item, index) => {
    const exact = remaining * (item.count / Math.max(1, totalUnits));
    const base = Math.floor(exact);
    enriched[index].slots += base;
    baseAssigned += base;
    return {
      index,
      frac: exact - base,
      count: item.count,
      unitTypeId: item.unitTypeId
    };
  });
  remaining -= baseAssigned;
  const ranking = [...weighted].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    if (b.count !== a.count) return b.count - a.count;
    return a.unitTypeId.localeCompare(b.unitTypeId, 'zh-Hans-CN');
  });
  for (let i = 0; i < remaining; i += 1) {
    const picked = ranking[i % ranking.length];
    if (picked) {
      enriched[picked.index].slots += 1;
    }
  }

  const buckets = enriched
    .map((item) => ({ ...item, remaining: item.slots }))
    .sort((a, b) => b.remaining - a.remaining);
  const tokens = [];
  while (tokens.length < safeCount) {
    let progressed = false;
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i];
      if (!bucket || bucket.remaining <= 0) continue;
      tokens.push({
        unitTypeId: bucket.unitTypeId,
        unitName: bucket.unitName,
        roleTag: bucket.roleTag,
        classTag: bucket.classTag,
        bodyColor: bucket.bodyColor,
        accentColor: bucket.accentColor
      });
      bucket.remaining -= 1;
      progressed = true;
      if (tokens.length >= safeCount) break;
    }
    if (!progressed) break;
    buckets.sort((a, b) => b.remaining - a.remaining);
  }
  return tokens;
};

const getBattlefieldCacheKey = (nodeId, gateKey) => (
  `${CACHE_PREFIX}:${nodeId || ''}:${gateKey || 'cheng'}`
);

const readBattlefieldCache = (nodeId, gateKey) => {
  if (!nodeId) return null;
  try {
    const raw = localStorage.getItem(getBattlefieldCacheKey(nodeId, gateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

const writeBattlefieldCache = (nodeId, gateKey, payload = {}) => {
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

const createWallFromLike = (wallLike = {}, overrides = {}) => ({
  id: overrides.id || `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  itemId: typeof (overrides.itemId ?? wallLike.itemId ?? wallLike.itemType) === 'string'
    ? String(overrides.itemId ?? wallLike.itemId ?? wallLike.itemType).trim()
    : '',
  x: Number.isFinite(Number(overrides.x)) ? Number(overrides.x) : (Number(wallLike.x) || 0),
  y: Number.isFinite(Number(overrides.y)) ? Number(overrides.y) : (Number(wallLike.y) || 0),
  z: Number.isFinite(Number(overrides.z)) ? Math.max(0, Math.floor(Number(overrides.z))) : Math.max(0, Math.floor(Number(wallLike.z) || 0)),
  rotation: normalizeDeg(overrides.rotation ?? wallLike.rotation ?? 0),
  width: Math.max(20, Number(overrides.width ?? wallLike.width ?? WALL_WIDTH) || WALL_WIDTH),
  depth: Math.max(12, Number(overrides.depth ?? wallLike.depth ?? WALL_DEPTH) || WALL_DEPTH),
  height: Math.max(14, Number(overrides.height ?? wallLike.height ?? WALL_HEIGHT) || WALL_HEIGHT),
  hp: Math.max(1, Math.floor(Number(overrides.hp ?? wallLike.hp ?? BASE_HP) || BASE_HP)),
  defense: Math.max(0.1, Number(overrides.defense ?? wallLike.defense ?? BASE_DEFENSE) || BASE_DEFENSE)
});

const sanitizeWalls = (rawWalls = []) => {
  const source = Array.isArray(rawWalls) ? rawWalls : [];
  const seen = new Set();
  const out = [];
  source.forEach((item, index) => {
    const next = createWallFromLike(item, {
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : `wall_${index + 1}`,
      itemId: typeof item?.itemId === 'string'
        ? item.itemId
        : (typeof item?.itemType === 'string' ? item.itemType : (typeof item?.type === 'string' ? item.type : '')),
      z: Math.max(0, Math.min(MAX_STACK_LEVEL - 1, Math.floor(Number(item?.z) || 0)))
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

const sanitizeWallsWithLegacyCleanup = (rawWalls = []) => {
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

const cloneWalls = (sourceWalls = []) => (
  sanitizeWalls(sourceWalls).map((item) => ({ ...item }))
);

const normalizeDefenderUnits = (rawUnits = [], fallbackUnitTypeId = '', fallbackCount = 0) => {
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

const getDeploymentTotalCount = (deployment = {}) => (
  normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count)
    .reduce((sum, entry) => sum + entry.count, 0)
);

const sanitizeDefenderDeployments = (rawDeployments = []) => {
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
      units,
      unitTypeId: primary.unitTypeId,
      count: primary.count,
      x: Number.isFinite(Number(item?.x)) ? Number(item.x) : 0,
      y: Number.isFinite(Number(item?.y)) ? Number(item.y) : 0
    });
  });
  return out;
};

const normalizeDefenderDeploymentsToRightZone = (rawDeployments = [], fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT) => {
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

const parseApiResponse = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const getApiError = (data, fallback = '请求失败') => (
  data?.error || data?.message || fallback
);

const normalizeItemCatalog = (items = []) => {
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
      initialCount: Math.max(0, Math.floor(Number(item?.initialCount) || 0)),
      width: Math.max(12, Number(item?.width) || WALL_WIDTH),
      depth: Math.max(12, Number(item?.depth) || WALL_DEPTH),
      height: Math.max(10, Number(item?.height) || WALL_HEIGHT),
      hp: Math.max(1, Math.floor(Number(item?.hp) || BASE_HP)),
      defense: Math.max(0.1, Number(item?.defense) || BASE_DEFENSE),
      style: item?.style && typeof item.style === 'object' ? item.style : {}
    });
  });
  return out;
};

const mapLayoutBundleToWalls = (layoutBundle = {}) => {
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
      width: itemDef?.width,
      depth: itemDef?.depth,
      height: itemDef?.height,
      hp: itemDef?.hp,
      defense: itemDef?.defense
    };
  }));
};

const mapLayoutBundleToDefenderDeployments = (layoutBundle = {}) => (
  sanitizeDefenderDeployments(layoutBundle?.defenderDeployments || [])
);

const buildLayoutPayload = ({ walls = [], defenderDeployments = [], layoutMeta = {}, itemCatalog = [], gateKey = '' } = {}) => ({
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
    initialCount: Math.max(0, Math.floor(Number(item.initialCount) || 0)),
    width: roundTo(item.width, 3),
    depth: roundTo(item.depth, 3),
    height: roundTo(item.height, 3),
    hp: Math.max(1, Math.floor(Number(item.hp) || BASE_HP)),
    defense: roundTo(Math.max(0.1, Number(item.defense) || BASE_DEFENSE), 3),
    style: item?.style && typeof item.style === 'object' ? item.style : {}
  })),
  objects: sanitizeWalls(walls).map((item) => ({
    objectId: item.id,
    itemId: item.itemId || '',
    x: roundTo(item.x, 3),
    y: roundTo(item.y, 3),
    z: Math.max(0, Math.floor(Number(item.z) || 0)),
    rotation: roundTo(item.rotation, 3)
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
    y: roundTo(item.y, 3)
  }))
});

const rotate2D = (x, y, deg) => {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos)
  };
};

const dot2 = (a, b) => ((a.x * b.x) + (a.y * b.y));

const projectWorld = (x, y, z, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const yawX = (x * camera.yawCos) - (y * camera.yawSin);
  const yawY = (x * camera.yawSin) + (y * camera.yawCos);
  const viewY = (yawY * camera.tiltSin) - (z * camera.tiltCos);
  const depth = (yawY * camera.tiltCos) + (z * camera.tiltSin);
  return {
    x: viewport.centerX + viewport.panX + (yawX * worldScale),
    y: viewport.centerY + viewport.panY + (viewY * worldScale),
    depth
  };
};

const unprojectScreen = (sx, sy, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const safeScale = Math.max(0.0001, worldScale || 1);
  const safeGroundScale = Math.max(0.0001, camera.tiltSin);
  const yawX = (sx - viewport.centerX - viewport.panX) / safeScale;
  const yawY = (sy - viewport.centerY - viewport.panY) / (safeScale * safeGroundScale);
  return {
    x: (yawX * camera.yawCos) + (yawY * camera.yawSin),
    y: (-yawX * camera.yawSin) + (yawY * camera.yawCos)
  };
};

const getRectCorners = (centerX, centerY, width, depth, rotationDeg) => {
  const hw = width / 2;
  const hd = depth / 2;
  const pts = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd }
  ];
  return pts.map((p) => {
    const rotated = rotate2D(p.x, p.y, rotationDeg);
    return {
      x: centerX + rotated.x,
      y: centerY + rotated.y
    };
  });
};

const buildAxesFromCorners = (corners) => {
  const axes = [];
  for (let i = 0; i < 2; i += 1) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % corners.length];
    const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
    const len = Math.hypot(edge.x, edge.y) || 1;
    axes.push({ x: edge.x / len, y: edge.y / len });
  }
  return axes;
};

const getProjectionRange = (corners, axis) => {
  let min = Infinity;
  let max = -Infinity;
  corners.forEach((point) => {
    const value = dot2(point, axis);
    min = Math.min(min, value);
    max = Math.max(max, value);
  });
  return { min, max };
};

const getRectContactMetrics = (rectA, rectB) => {
  const cornersA = getRectCorners(rectA.x, rectA.y, rectA.width, rectA.depth, rectA.rotation);
  const cornersB = getRectCorners(rectB.x, rectB.y, rectB.width, rectB.depth, rectB.rotation);
  const axes = [...buildAxesFromCorners(cornersA), ...buildAxesFromCorners(cornersB)];
  const overlaps = [];
  let minOverlap = Infinity;
  axes.forEach((axis) => {
    const rangeA = getProjectionRange(cornersA, axis);
    const rangeB = getProjectionRange(cornersB, axis);
    const overlap = Math.min(rangeA.max, rangeB.max) - Math.max(rangeA.min, rangeB.min);
    overlaps.push(overlap);
    minOverlap = Math.min(minOverlap, overlap);
  });
  return {
    cornersA,
    cornersB,
    overlaps,
    minOverlap
  };
};

const isRectOverlap = (rectA, rectB, epsilon = 0.4) => {
  const metrics = getRectContactMetrics(rectA, rectB);
  return metrics.minOverlap > epsilon;
};

const toLocalByWall = (point, wall) => {
  const rotated = rotate2D(point.x - wall.x, point.y - wall.y, -wall.rotation);
  return {
    x: rotated.x,
    y: rotated.y
  };
};

const pointInWallFootprint = (point, wall, padding = 0) => {
  const local = toLocalByWall(point, wall);
  return (
    Math.abs(local.x) <= ((wall.width / 2) + padding)
    && Math.abs(local.y) <= ((wall.depth / 2) + padding)
  );
};

const getGhostNormalsByYaw = (rotation) => {
  const widthAxis = rotate2D(1, 0, rotation);
  const depthAxis = rotate2D(0, 1, rotation);
  return [
    widthAxis,
    { x: -widthAxis.x, y: -widthAxis.y },
    depthAxis,
    { x: -depthAxis.x, y: -depthAxis.y }
  ];
};

const getProjectedHalfExtent = (wallLike, normal) => {
  const widthAxis = rotate2D(1, 0, wallLike.rotation || 0);
  const depthAxis = rotate2D(0, 1, wallLike.rotation || 0);
  const hw = (wallLike.width || WALL_WIDTH) / 2;
  const hd = (wallLike.depth || WALL_DEPTH) / 2;
  return (Math.abs(dot2(widthAxis, normal)) * hw) + (Math.abs(dot2(depthAxis, normal)) * hd);
};

const angleDistanceDeg = (a, b) => {
  const da = normalizeDeg(a);
  const db = normalizeDeg(b);
  const diff = Math.abs(da - db);
  return Math.min(diff, 360 - diff);
};

const clampGhostInsideField = (ghostLike, fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT) => {
  const next = { ...ghostLike };
  const corners = getRectCorners(next.x, next.y, next.width, next.depth, next.rotation);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  corners.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
  const fieldMinX = -safeFieldWidth / 2;
  const fieldMaxX = safeFieldWidth / 2;
  const fieldMinY = -safeFieldHeight / 2;
  const fieldMaxY = safeFieldHeight / 2;
  let shiftX = 0;
  let shiftY = 0;
  if (minX < fieldMinX) shiftX = fieldMinX - minX;
  if (maxX > fieldMaxX) shiftX = fieldMaxX - maxX;
  if (minY < fieldMinY) shiftY = fieldMinY - minY;
  if (maxY > fieldMaxY) shiftY = fieldMaxY - maxY;
  next.x += shiftX;
  next.y += shiftY;
  return next;
};

const isOutOfBounds = (ghostLike, fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT) => {
  const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
  const corners = getRectCorners(ghostLike.x, ghostLike.y, ghostLike.width, ghostLike.depth, ghostLike.rotation);
  return corners.some((point) => (
    point.x < (-safeFieldWidth / 2) - SNAP_EPSILON
    || point.x > (safeFieldWidth / 2) + SNAP_EPSILON
    || point.y < (-safeFieldHeight / 2) - SNAP_EPSILON
    || point.y > (safeFieldHeight / 2) + SNAP_EPSILON
  ));
};

const hasCollision = (ghostLike, walls = []) => {
  for (const wall of walls) {
    if (wall.id === ghostLike.id) continue;
    if (wall.z !== ghostLike.z) continue;
    if (isRectOverlap(ghostLike, wall, 0.2)) return true;
  }
  return false;
};

const buildYawCandidatesFromGhost = (ghostYaw) => {
  const yaw = normalizeDeg(ghostYaw);
  return [yaw, yaw + 90, yaw - 90, yaw + 180, yaw - 180];
};

const buildYawCandidatesFromTarget = (targetYaw) => {
  const yaw = normalizeDeg(targetYaw);
  return [yaw, yaw + 90, yaw + 180, yaw + 270];
};

const getPlacementReasonText = (reason) => {
  if (reason === 'stack_limit') return `堆叠上限为 ${MAX_STACK_LEVEL} 层`;
  if (reason === 'collision') return '当前位置发生碰撞，无法放置';
  if (reason === 'out_of_bounds') return '当前位置超出战场边界';
  return '';
};

const solveMagneticSnap = ({
  candidateGhost,
  walls,
  mouseWorld,
  fieldWidth,
  fieldHeight
}) => {
  const ghostBase = {
    ...candidateGhost,
    z: Math.max(0, Math.min(MAX_STACK_LEVEL - 1, Math.floor(Number(candidateGhost?.z) || 0))),
    rotation: normalizeDeg(candidateGhost?.rotation || 0)
  };
  const sortedWalls = [...walls].sort((a, b) => (b.z - a.z));
  let stackLimitHit = false;

  for (const wall of sortedWalls) {
    if (!pointInWallFootprint(mouseWorld, wall, 0.2)) continue;
    if (wall.z >= MAX_STACK_LEVEL - 1) {
      stackLimitHit = true;
      continue;
    }
    const topGhost = {
      ...ghostBase,
      x: wall.x,
      y: wall.y,
      z: wall.z + 1,
      rotation: normalizeDeg(wall.rotation)
    };
    if (isOutOfBounds(topGhost, fieldWidth, fieldHeight)) {
      return {
        ghost: topGhost,
        snap: { type: 'top', anchorId: wall.id },
        blocked: true,
        reason: 'out_of_bounds'
      };
    }
    if (hasCollision(topGhost, walls)) {
      return {
        ghost: topGhost,
        snap: { type: 'top', anchorId: wall.id },
        blocked: true,
        reason: 'collision'
      };
    }
    return {
      ghost: topGhost,
      snap: { type: 'top', anchorId: wall.id },
      blocked: false,
      reason: ''
    };
  }

  let best = null;
  const minSize = Math.max(20, Math.min(ghostBase.width, ghostBase.depth));
  const snapRadius = minSize * 1.4;
  const sideDefs = [
    { side: 'right', localNormal: { x: 1, y: 0 }, halfKey: 'width' },
    { side: 'left', localNormal: { x: -1, y: 0 }, halfKey: 'width' },
    { side: 'front', localNormal: { x: 0, y: 1 }, halfKey: 'depth' },
    { side: 'back', localNormal: { x: 0, y: -1 }, halfKey: 'depth' }
  ];

  walls.forEach((anchor) => {
    sideDefs.forEach((face) => {
      const normal = rotate2D(face.localNormal.x, face.localNormal.y, anchor.rotation);
      const anchorHalf = face.halfKey === 'width' ? (anchor.width / 2) : (anchor.depth / 2);
      const contactPoint = {
        x: anchor.x + (normal.x * anchorHalf),
        y: anchor.y + (normal.y * anchorHalf)
      };
      const mouseDist = Math.hypot(mouseWorld.x - contactPoint.x, mouseWorld.y - contactPoint.y);
      if (mouseDist > snapRadius) return;

      const yawCandidates = Array.from(new Set(
        [...buildYawCandidatesFromGhost(ghostBase.rotation), ...buildYawCandidatesFromTarget(anchor.rotation)]
          .map((yaw) => normalizeDeg(yaw))
      ));

      yawCandidates.forEach((yaw) => {
        const ghostLike = {
          ...ghostBase,
          rotation: normalizeDeg(yaw),
          z: anchor.z
        };
        const ghostHalf = getProjectedHalfExtent(ghostLike, normal);
        const candidate = {
          ...ghostLike,
          x: anchor.x + (normal.x * (anchorHalf + ghostHalf)),
          y: anchor.y + (normal.y * (anchorHalf + ghostHalf))
        };

        if (isOutOfBounds(candidate, fieldWidth, fieldHeight)) return;
        if (hasCollision(candidate, walls)) return;

        const requiredNormal = { x: -normal.x, y: -normal.y };
        const faceNormals = getGhostNormalsByYaw(candidate.rotation);
        let bestAlign = -1;
        faceNormals.forEach((testNormal) => {
          bestAlign = Math.max(bestAlign, dot2(testNormal, requiredNormal));
        });
        const alignErr = 1 - Math.max(-1, Math.min(1, bestAlign));
        if (alignErr > 0.2) return;

        const rotateCost = angleDistanceDeg(candidate.rotation, ghostBase.rotation) / 180;
        const mouseCost = Math.min(1, mouseDist / snapRadius);
        const score = (0.45 * alignErr) + (0.40 * rotateCost) + (0.15 * mouseCost);
        const row = {
          ghost: candidate,
          snap: { type: `side-${face.side}`, anchorId: anchor.id },
          rotateCost,
          score
        };
        if (!best) {
          best = row;
          return;
        }
        if (row.rotateCost < (best.rotateCost - 1e-6)) {
          best = row;
          return;
        }
        if (Math.abs(row.rotateCost - best.rotateCost) <= 1e-6 && row.score < best.score) {
          best = row;
        }
      });
    });
  });

  if (best) {
    return {
      ghost: best.ghost,
      snap: best.snap,
      blocked: false,
      reason: ''
    };
  }

  const clamped = clampGhostInsideField({ ...ghostBase, z: 0 }, fieldWidth, fieldHeight);
  const moved = Math.hypot(clamped.x - ghostBase.x, clamped.y - ghostBase.y);
  if (moved > 0.01) {
    const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
    const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
    const edgeDistances = [
      { side: 'edge-left', dist: clamped.x + (safeFieldWidth / 2) },
      { side: 'edge-right', dist: (safeFieldWidth / 2) - clamped.x },
      { side: 'edge-top', dist: clamped.y + (safeFieldHeight / 2) },
      { side: 'edge-bottom', dist: (safeFieldHeight / 2) - clamped.y }
    ];
    const edge = edgeDistances.reduce((acc, item) => (item.dist < acc.dist ? item : acc), edgeDistances[0]);
    if (hasCollision(clamped, walls)) {
      return {
        ghost: clamped,
        snap: { type: edge.side, anchorId: '' },
        blocked: true,
        reason: 'collision'
      };
    }
    return {
      ghost: clamped,
      snap: { type: edge.side, anchorId: '' },
      blocked: false,
      reason: ''
    };
  }

  const freeGhost = { ...ghostBase, z: 0 };
  if (stackLimitHit) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'stack_limit'
    };
  }
  if (isOutOfBounds(freeGhost, fieldWidth, fieldHeight)) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'out_of_bounds'
    };
  }
  if (hasCollision(freeGhost, walls)) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'collision'
    };
  }
  return {
    ghost: freeGhost,
    snap: null,
    blocked: false,
    reason: ''
  };
};

const evaluateGhostPlacement = (
  candidateGhost,
  walls,
  mouseWorld,
  fieldWidth = FIELD_WIDTH,
  fieldHeight = FIELD_HEIGHT
) => solveMagneticSnap({
  candidateGhost,
  walls,
  mouseWorld,
  fieldWidth,
  fieldHeight
});

const findTopWallAtPoint = (worldPoint, walls = []) => {
  const matches = walls.filter((wall) => pointInWallFootprint(worldPoint, wall, 0.2));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (b.z !== a.z) return b.z - a.z;
    const da = Math.hypot(worldPoint.x - a.x, worldPoint.y - a.y);
    const db = Math.hypot(worldPoint.x - b.x, worldPoint.y - b.y);
    return da - db;
  });
  return matches[0] || null;
};

const pointToSegmentDistance2D = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = (dx * dx) + (dy * dy);
  if (lenSq <= 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lenSq));
  const px = a.x + (dx * t);
  const py = a.y + (dy * t);
  return Math.hypot(point.x - px, point.y - py);
};

const pointInScreenPolygon = (point, polygon = [], edgeTolerancePx = SCREEN_HIT_TOLERANCE_PX) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (pointToSegmentDistance2D(point, a, b) <= edgeTolerancePx) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < (((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
};

const buildWallFacePoints = (wall) => {
  const baseZ = getWallBaseZ(wall);
  const topZ = getWallTopZ(wall);
  const hw = wall.width / 2;
  const hd = wall.depth / 2;
  const widthAxis = rotate2D(1, 0, wall.rotation);
  const depthAxis = rotate2D(0, 1, wall.rotation);
  const cornerSigns = [
    { u: -1, v: -1 },
    { u: 1, v: -1 },
    { u: 1, v: 1 },
    { u: -1, v: 1 }
  ];
  const base = cornerSigns.map((sign) => ({
    x: wall.x + (widthAxis.x * hw * sign.u) + (depthAxis.x * hd * sign.v),
    y: wall.y + (widthAxis.y * hw * sign.u) + (depthAxis.y * hd * sign.v),
    z: baseZ
  }));
  const top = base.map((point) => ({ ...point, z: topZ }));
  return [
    [top[0], top[1], top[2], top[3]],
    [base[0], base[1], top[1], top[0]],
    [base[1], base[2], top[2], top[1]],
    [base[2], base[3], top[3], top[2]],
    [base[3], base[0], top[0], top[3]]
  ];
};

const findTopWallByScreenPoint = ({
  screenPoint,
  walls = [],
  viewport,
  cameraAngle,
  cameraYaw,
  worldScale
}) => {
  if (!screenPoint || !Array.isArray(walls) || walls.length === 0) return null;
  let best = null;
  walls.forEach((wall) => {
    const faces = buildWallFacePoints(wall);
    faces.forEach((face) => {
      const projected = face.map((p) => projectWorld(
        p.x,
        p.y,
        p.z,
        viewport,
        cameraAngle,
        cameraYaw,
        worldScale
      ));
      if (!pointInScreenPolygon(screenPoint, projected)) return;
      const depth = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      if (!best || depth > best.depth || (Math.abs(depth - best.depth) <= 1e-6 && wall.z > best.wall.z)) {
        best = { wall, depth };
      }
    });
  });
  return best?.wall || null;
};

const isPhysicallyConnected = (a, b) => {
  const za = Math.max(0, Math.floor(Number(a?.z) || 0));
  const zb = Math.max(0, Math.floor(Number(b?.z) || 0));
  const zDelta = Math.abs(za - zb);
  if (zDelta > 1) return false;
  const metrics = getRectContactMetrics(a, b);
  if (metrics.minOverlap < -SNAP_EPSILON) return false;
  const minDim = Math.min(a.width, a.depth, b.width, b.depth);
  if (zDelta === 1) {
    const required = Math.max(4, minDim * 0.16);
    return metrics.overlaps.every((item) => item > required);
  }
  if (metrics.overlaps.every((item) => item > 0.6)) return true;
  const touchingAxis = metrics.overlaps.some((item) => Math.abs(item) <= SNAP_EPSILON);
  const strongOverlap = metrics.overlaps.some((item) => item > Math.max(5, minDim * 0.22));
  return touchingAxis && strongOverlap;
};

const getWallGroupMetrics = (walls) => {
  const source = Array.isArray(walls) ? walls : [];
  if (source.length === 0) return [];
  const adjacency = new Map();
  const byId = new Map();
  source.forEach((wall) => {
    adjacency.set(wall.id, new Set());
    byId.set(wall.id, wall);
  });

  for (let i = 0; i < source.length; i += 1) {
    for (let j = i + 1; j < source.length; j += 1) {
      const a = source[i];
      const b = source[j];
      if (!isPhysicallyConnected(a, b)) continue;
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    }
  }

  const visited = new Set();
  const groups = [];
  source.forEach((wall) => {
    if (visited.has(wall.id)) return;
    const queue = [wall.id];
    const members = [];
    visited.add(wall.id);
    while (queue.length > 0) {
      const id = queue.shift();
      const current = byId.get(id);
      if (!current) continue;
      members.push(current);
      (adjacency.get(id) || []).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    if (members.length === 0) return;
    const hp = members.reduce((sum, item) => sum + Math.max(0, Number(item.hp) || 0), 0);
    const defenseBase = Number(members[0]?.defense) || BASE_DEFENSE;
    const defense = members.length > 1 ? (defenseBase * 1.1) : defenseBase;
    const center = members.reduce((acc, item) => ({
      x: acc.x + item.x,
      y: acc.y + item.y
    }), { x: 0, y: 0 });
    const topZ = members.reduce((max, item) => Math.max(max, getWallTopZ(item)), 0);
    groups.push({
      ids: members.map((item) => item.id),
      hp: Math.round(hp),
      defense: roundTo(defense, 2),
      center: {
        x: center.x / members.length,
        y: center.y / members.length,
        z: topZ + 14
      }
    });
  });

  return groups;
};

const BattlefieldPreviewModal = ({
  open = false,
  nodeId = '',
  gateKey = 'cheng',
  gateLabel = '',
  canEdit = false,
  onClose
}) => {
  const sceneCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const threeRef = useRef(null);
  const raycasterRef = useRef(null);
  const raycastPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const panDragRef = useRef(null);
  const rotateDragRef = useRef(null);
  const wallActionButtonsRef = useRef([]);
  const defenderActionButtonsRef = useRef([]);
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const panWorldRef = useRef({ x: 0, y: 0 });
  const editSessionWallsRef = useRef(null);
  const editSessionDefenderDeploymentsRef = useRef(null);
  const persistBattlefieldLayoutRef = useRef(null);
  const pendingCacheSyncRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const cameraAngleRef = useRef(CAMERA_ANGLE_PREVIEW);
  const cameraYawRef = useRef(CAMERA_YAW_DEFAULT);
  const zoomAnimRef = useRef(null);
  const zoomTargetRef = useRef(DEFAULT_ZOOM);
  const spacePressedRef = useRef(false);
  const [walls, setWalls] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(CAMERA_ANGLE_PREVIEW);
  const [cameraYaw, setCameraYaw] = useState(CAMERA_YAW_DEFAULT);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [panWorld, setPanWorld] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT
  });
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [ghost, setGhost] = useState(null);
  const [ghostBlocked, setGhostBlocked] = useState(false);
  const [snapState, setSnapState] = useState(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [cacheNeedsSync, setCacheNeedsSync] = useState(false);
  const [serverCanEdit, setServerCanEdit] = useState(!!canEdit);
  const [layoutReady, setLayoutReady] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPaletteItem, setSelectedPaletteItem] = useState('');
  const [itemCatalog, setItemCatalog] = useState(normalizeItemCatalog([]));
  const [defenderRoster, setDefenderRoster] = useState([]);
  const [defenderDeployments, setDefenderDeployments] = useState([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [activeDefenderMoveId, setActiveDefenderMoveId] = useState('');
  const [defenderDragPreview, setDefenderDragPreview] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('items');
  const [defenderEditorOpen, setDefenderEditorOpen] = useState(false);
  const [defenderEditorDraft, setDefenderEditorDraft] = useState({
    name: '',
    sortOrder: 1,
    units: []
  });
  const [defenderQuantityDialog, setDefenderQuantityDialog] = useState({
    open: false,
    unitTypeId: '',
    unitName: '',
    max: 0,
    current: 0
  });
  const [selectedWallId, setSelectedWallId] = useState('');
  const [activeLayoutMeta, setActiveLayoutMeta] = useState({
    layoutId: '',
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: DEFAULT_MAX_ITEMS_PER_TYPE
  });
  const defaultLayoutMeta = useMemo(() => ({
    layoutId: `${gateKey || 'cheng'}_default`,
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: DEFAULT_MAX_ITEMS_PER_TYPE
  }), [gateKey]);
  const effectiveCanEdit = !!canEdit && !!serverCanEdit;
  const fieldWidth = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldWidth) || FIELD_WIDTH),
    [activeLayoutMeta?.fieldWidth]
  );
  const fieldHeight = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldHeight) || FIELD_HEIGHT),
    [activeLayoutMeta?.fieldHeight]
  );

  const syncViewportSize = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect?.width || DEFAULT_VIEWPORT_WIDTH));
    const height = Math.max(1, Math.floor(rect?.height || DEFAULT_VIEWPORT_HEIGHT));
    setViewportSize((prev) => (
      prev.width === width && prev.height === height
        ? prev
        : { width, height }
    ));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncViewportSize();
  }, [open, syncViewportSize]);

  useEffect(() => {
    if (!open) return undefined;
    let resizeObserver = null;
    const rafId = requestAnimationFrame(syncViewportSize);
    const wrapper = wrapperRef.current;
    if (typeof ResizeObserver !== 'undefined' && wrapper) {
      resizeObserver = new ResizeObserver(() => {
        syncViewportSize();
      });
      resizeObserver.observe(wrapper);
    }
    window.addEventListener('resize', syncViewportSize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncViewportSize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [open, syncViewportSize]);

  const viewport = useMemo(() => {
    const width = viewportSize.width;
    const height = viewportSize.height;
    return {
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
      panX: 0,
      panY: 0
    };
  }, [viewportSize.height, viewportSize.width]);

  const wallGroups = useMemo(() => getWallGroupMetrics(walls), [walls]);
  const normalizedItemCatalog = useMemo(() => normalizeItemCatalog(itemCatalog), [itemCatalog]);
  const itemPlacedCountMap = useMemo(() => {
    const map = new Map();
    walls.forEach((item) => {
      const itemId = typeof item?.itemId === 'string' ? item.itemId : '';
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + 1);
    });
    return map;
  }, [walls]);
  const itemStockMetaMap = useMemo(() => {
    const map = new Map();
    normalizedItemCatalog.forEach((item) => {
      const limit = Math.max(0, Math.floor(Number(item?.initialCount) || 0));
      const used = itemPlacedCountMap.get(item.itemId) || 0;
      map.set(item.itemId, {
        used,
        limit,
        remaining: Math.max(0, limit - used)
      });
    });
    return map;
  }, [itemPlacedCountMap, normalizedItemCatalog]);
  const itemCatalogById = useMemo(
    () => new Map(normalizedItemCatalog.map((item) => [item.itemId, item])),
    [normalizedItemCatalog]
  );
  const totalItemLimit = useMemo(
    () => normalizedItemCatalog.reduce((sum, item) => sum + (itemStockMetaMap.get(item.itemId)?.limit || 0), 0),
    [itemStockMetaMap, normalizedItemCatalog]
  );
  const totalItemRemaining = useMemo(
    () => normalizedItemCatalog.reduce((sum, item) => sum + (itemStockMetaMap.get(item.itemId)?.remaining || 0), 0),
    [itemStockMetaMap, normalizedItemCatalog]
  );
  const defenderRosterMap = useMemo(() => (
    new Map(
      (Array.isArray(defenderRoster) ? defenderRoster : [])
        .map((item) => ([
          typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '',
          {
            unitTypeId: typeof item?.unitTypeId === 'string' ? item.unitTypeId.trim() : '',
            unitName: typeof item?.unitName === 'string' ? item.unitName : '',
            roleTag: item?.roleTag === '远程' ? '远程' : '近战',
            count: Math.max(0, Math.floor(Number(item?.count) || 0))
          }
        ]))
        .filter(([unitTypeId, item]) => !!unitTypeId && item.count > 0)
    )
  ), [defenderRoster]);
  const deployedDefenderCountMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(defenderDeployments) ? defenderDeployments : []).forEach((item) => {
      if (item?.placed === false) return;
      normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count).forEach((entry) => {
        map.set(entry.unitTypeId, (map.get(entry.unitTypeId) || 0) + entry.count);
      });
    });
    return map;
  }, [defenderDeployments]);
  const defenderStockRows = useMemo(() => (
    Array.from(defenderRosterMap.values()).map((item) => {
      const used = deployedDefenderCountMap.get(item.unitTypeId) || 0;
      const remaining = Math.max(0, item.count - used);
      return {
        ...item,
        used,
        remaining
      };
    })
  ), [defenderRosterMap, deployedDefenderCountMap]);
  const totalDefenderPlaced = useMemo(
    () => defenderStockRows.reduce((sum, item) => sum + item.used, 0),
    [defenderStockRows]
  );
  const defenderZoneMinX = useMemo(
    () => (fieldWidth / 2) - (fieldWidth * DEPLOY_ZONE_RATIO),
    [fieldWidth]
  );
  const defenderDeploymentRows = useMemo(
    () => sanitizeDefenderDeployments(defenderDeployments)
      .map((item, index) => {
        const units = normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count);
        const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
        const unitSummary = units
          .map((entry) => `${defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`)
          .join(' / ');
        const fallbackName = `守军部队${index + 1}`;
        return {
          ...item,
          units,
          totalCount,
          unitSummary,
          teamName: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : fallbackName,
          sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || (index + 1)))
        };
      })
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.teamName.localeCompare(b.teamName, 'zh-Hans-CN');
      }),
    [defenderDeployments, defenderRosterMap]
  );
  const defenderEditorUsedMap = useMemo(() => {
    const map = new Map();
    normalizeDefenderUnits(defenderEditorDraft?.units || []).forEach((entry) => {
      map.set(entry.unitTypeId, entry.count);
    });
    return map;
  }, [defenderEditorDraft?.units]);
  const defenderEditorAvailableRows = useMemo(() => (
    defenderStockRows.map((row) => {
      const draftUsed = defenderEditorUsedMap.get(row.unitTypeId) || 0;
      const available = Math.max(0, row.remaining + draftUsed);
      return {
        ...row,
        draftUsed,
        available
      };
    })
  ), [defenderEditorUsedMap, defenderStockRows]);
  const defenderEditorTotalCount = useMemo(
    () => normalizeDefenderUnits(defenderEditorDraft?.units || []).reduce((sum, entry) => sum + entry.count, 0),
    [defenderEditorDraft?.units]
  );
  const worldScale = useMemo(() => {
    const widthBase = (viewport.width * BASELINE_FIELD_COVERAGE) / fieldWidth;
    const heightBase = (viewport.height * BASELINE_FIELD_COVERAGE) / (fieldHeight * getGroundProjectionScale(cameraAngle));
    const baseScale = Math.max(0.01, Math.min(widthBase, heightBase));
    return baseScale * zoom;
  }, [cameraAngle, fieldHeight, fieldWidth, viewport.height, viewport.width, zoom]);

  const getWorldFromScreenPoint = useCallback((sx, sy) => {
    const three = threeRef.current;
    const camera = three?.camera;
    if (camera && viewport.width > 0 && viewport.height > 0) {
      if (!raycasterRef.current) {
        raycasterRef.current = new THREE.Raycaster();
      }
      const ndc = new THREE.Vector2(
        ((sx / viewport.width) * 2) - 1,
        1 - ((sy / viewport.height) * 2)
      );
      raycasterRef.current.setFromCamera(ndc, camera);
      const target = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(raycastPlaneRef.current, target)) {
        return { x: target.x, y: target.y };
      }
    }
    return unprojectScreen(sx, sy, viewport, cameraAngle, cameraYaw, worldScale);
  }, [cameraAngle, cameraYaw, viewport, worldScale]);

  const pickWallFromScreenPoint = useCallback((sx, sy) => {
    const three = threeRef.current;
    const camera = three?.camera;
    const pickableWallMeshes = Array.isArray(three?.pickableWallMeshes) ? three.pickableWallMeshes : [];
    if (!camera || pickableWallMeshes.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    if (!raycasterRef.current) {
      raycasterRef.current = new THREE.Raycaster();
    }
    const ndc = new THREE.Vector2(
      ((sx / viewport.width) * 2) - 1,
      1 - ((sy / viewport.height) * 2)
    );
    raycasterRef.current.setFromCamera(ndc, camera);
    const hits = raycasterRef.current.intersectObjects(pickableWallMeshes, false);
    if (!hits || hits.length === 0) return null;
    const wallId = hits[0]?.object?.userData?.wallId;
    if (!wallId) return null;
    return walls.find((item) => item.id === wallId) || null;
  }, [viewport.height, viewport.width, walls]);

  useEffect(() => {
    cameraAngleRef.current = cameraAngle;
  }, [cameraAngle]);

  useEffect(() => {
    cameraYawRef.current = cameraYaw;
  }, [cameraYaw]);

  useEffect(() => {
    panWorldRef.current = {
      x: Number(panWorld.x) || 0,
      y: Number(panWorld.y) || 0
    };
  }, [panWorld.x, panWorld.y]);

  useEffect(() => {
    if (!open || !sceneCanvasRef.current) return undefined;
    const canvas = sceneCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));
    renderer.setSize(
      Math.max(1, Math.floor(canvas.clientWidth || 1)),
      Math.max(1, Math.floor(canvas.clientHeight || 1)),
      false
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
    camera.up.set(0, 0, 1);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xe2e8f0, 0.74);
    directionalLight.position.set(-420, -520, 860);
    scene.add(directionalLight);

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    threeRef.current = {
      renderer,
      scene,
      camera,
      worldGroup
    };

    return () => {
      clearThreeGroup(worldGroup);
      renderer.dispose();
      threeRef.current = null;
    };
  }, [open]);

  useEffect(() => () => {
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    if (threeRef.current) {
      clearThreeGroup(threeRef.current.worldGroup);
      threeRef.current.renderer?.dispose?.();
      threeRef.current = null;
    }
    panDragRef.current = null;
    rotateDragRef.current = null;
  }, []);

  const clearPanDragging = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  const clearRotateDragging = useCallback(() => {
    rotateDragRef.current = null;
    setIsRotating(false);
  }, []);

  const animateCameraAngle = useCallback((targetAngle, durationMs = CAMERA_TWEEN_MS) => {
    const start = cameraAngleRef.current;
    const target = Number(targetAngle) || CAMERA_ANGLE_PREVIEW;
    if (Math.abs(start - target) < 0.001) {
      setCameraAngle(target);
      cameraAngleRef.current = target;
      return;
    }
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    const startedAt = performance.now();
    const tick = (now) => {
      const t = clamp01((now - startedAt) / Math.max(1, durationMs));
      const eased = easeOutCubic(t);
      const next = lerp(start, target, eased);
      cameraAngleRef.current = next;
      setCameraAngle(next);
      if (t < 1) {
        cameraAnimRef.current = requestAnimationFrame(tick);
      } else {
        cameraAnimRef.current = null;
      }
    };
    cameraAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const animateZoomTo = useCallback((targetZoom) => {
    zoomTargetRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, roundTo(targetZoom, 3)));
    if (zoomAnimRef.current) return;
    const tick = () => {
      setZoom((prev) => {
        const target = zoomTargetRef.current;
        const next = prev + ((target - prev) * 0.24);
        if (Math.abs(target - next) < 0.001) {
          zoomAnimRef.current = null;
          return target;
        }
        zoomAnimRef.current = requestAnimationFrame(tick);
        return roundTo(next, 4);
      });
    };
    zoomAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const syncGhostByMouse = useCallback((sourceGhost = ghost) => {
    if (!sourceGhost) return null;
    const candidate = {
      ...sourceGhost,
      x: mouseWorldRef.current.x,
      y: mouseWorldRef.current.y,
      z: 0
    };
    const evaluated = evaluateGhostPlacement(candidate, walls, mouseWorldRef.current, fieldWidth, fieldHeight);
    setGhost(evaluated.ghost);
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    return evaluated;
  }, [fieldHeight, fieldWidth, ghost, walls]);

  const cancelGhostPlacement = useCallback((tip = '已取消放置') => {
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setInvalidReason('');
    setSelectedPaletteItem('');
    if (tip) setMessage(tip);
  }, []);

  const pickPaletteItem = useCallback((itemId) => {
    if (!effectiveCanEdit || !editMode) return;
    if (!itemId) return;
    const itemDef = normalizedItemCatalog.find((item) => item.itemId === itemId) || null;
    if (!itemDef) return;
    const remaining = itemStockMetaMap.get(itemId)?.remaining ?? 0;
    if (remaining <= 0) {
      setMessage(`物品「${itemDef.name || itemId}」库存不足，无法继续放置`);
      return;
    }
    const nextGhost = createWallFromLike(PALETTE_WALL_TEMPLATE, {
      itemId,
      width: itemDef.width,
      depth: itemDef.depth,
      height: itemDef.height,
      hp: itemDef.hp,
      defense: itemDef.defense,
      id: '',
      x: mouseWorldRef.current.x,
      y: mouseWorldRef.current.y,
      z: 0,
      rotation: 0
    });
    const evaluated = evaluateGhostPlacement(nextGhost, walls, mouseWorldRef.current, fieldWidth, fieldHeight);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setSidebarTab('items');
    setSelectedPaletteItem(itemId);
    setGhost({
      ...evaluated.ghost,
      _mode: 'create'
    });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    setMessage(`已选中${itemDef.name || '物品'}：左键放置，右键或 ESC 取消，滚轮旋转，Space+左键平移`);
  }, [effectiveCanEdit, editMode, normalizedItemCatalog, itemStockMetaMap, walls, fieldWidth, fieldHeight]);

  const startMoveWall = useCallback((wallLike) => {
    if (!wallLike) return;
    const movingGhostSeed = {
      ...createWallFromLike(wallLike, { id: wallLike.id }),
      _mode: 'move',
      _sourceId: wallLike.id
    };
    const evaluated = evaluateGhostPlacement(movingGhostSeed, walls, mouseWorldRef.current, fieldWidth, fieldHeight);
    setGhost({ ...evaluated.ghost, _mode: 'move', _sourceId: wallLike.id });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setSelectedPaletteItem(wallLike.itemId || '');
    setMessage('移动模式：左键确认位置，右键或 ESC 取消');
  }, [fieldHeight, fieldWidth, walls]);

  const recycleWallToPalette = useCallback((wallId) => {
    if (!wallId) return;
    setWalls((prev) => prev.filter((item) => item.id !== wallId));
    setHasDraftChanges(true);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    cancelGhostPlacement('');
    setMessage('物品已回收到物品栏');
  }, [cancelGhostPlacement]);

  const resolveDefenderAvailableCount = useCallback((unitTypeId, draftUnits = []) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return 0;
    const roster = defenderRosterMap.get(safeUnitTypeId);
    if (!roster) return 0;
    const deployed = deployedDefenderCountMap.get(safeUnitTypeId) || 0;
    const draftCurrent = normalizeDefenderUnits(draftUnits).find((entry) => entry.unitTypeId === safeUnitTypeId)?.count || 0;
    return Math.max(0, roster.count - deployed + draftCurrent);
  }, [defenderRosterMap, deployedDefenderCountMap]);

  const findDeploymentAtWorld = useCallback((worldPoint) => {
    const source = (Array.isArray(defenderDeployments) ? defenderDeployments : []).filter((item) => item?.placed !== false);
    let best = null;
    let bestDist = Infinity;
    source.forEach((item) => {
      const dx = (Number(item?.x) || 0) - worldPoint.x;
      const dy = (Number(item?.y) || 0) - worldPoint.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist && dist <= 28) {
        best = item;
        bestDist = dist;
      }
    });
    return best;
  }, [defenderDeployments]);

  const buildDefaultDefenderPoint = useCallback((excludeDeployId = '') => {
    const minX = defenderZoneMinX;
    const maxX = fieldWidth / 2;
    for (let i = 0; i < 40; i += 1) {
      const point = {
        x: minX + 16 + (Math.random() * Math.max(16, (maxX - minX - 32))),
        y: (-fieldHeight * 0.42) + (Math.random() * fieldHeight * 0.84)
      };
      const overlap = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => {
        if (excludeDeployId && item.deployId === excludeDeployId) return false;
        return Math.hypot((Number(item?.x) || 0) - point.x, (Number(item?.y) || 0) - point.y) < 20;
      });
      if (!overlap) return point;
    }
    return {
      x: minX + ((maxX - minX) * 0.55),
      y: 0
    };
  }, [defenderDeployments, defenderZoneMinX, fieldHeight, fieldWidth]);

  const persistDefenderDeploymentsNow = useCallback((nextDeployments) => {
    const runner = persistBattlefieldLayoutRef.current;
    if (typeof runner !== 'function') return;
    runner(walls, {
      silent: false,
      defenderDeployments: sanitizeDefenderDeployments(nextDeployments)
    });
  }, [walls]);

  const moveDefenderDeployment = useCallback((deployId, worldPoint) => {
    if (!effectiveCanEdit || !deployId) return false;
    const target = (Array.isArray(defenderDeployments) ? defenderDeployments : []).find((item) => item.deployId === deployId);
    if (!target) return false;
    if (worldPoint.x < defenderZoneMinX) {
      setMessage('守军仅可放置在右侧蓝色守方区域');
      return false;
    }
    const nextPoint = {
      x: Math.max(defenderZoneMinX, Math.min(fieldWidth / 2, worldPoint.x)),
      y: Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, worldPoint.y))
    };
    const overlap = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y) < 20
    ));
    if (overlap) {
      setMessage('守军部队点位过近，请稍微错开');
      return false;
    }
    const unitLimitMap = new Map(
      Array.from(defenderRosterMap.values()).map((row) => [row.unitTypeId, row.count])
    );
    const currentPlacedCounter = new Map();
    (Array.isArray(defenderDeployments) ? defenderDeployments : []).forEach((item) => {
      if (!item || item.deployId === deployId || item?.placed === false) return;
      normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count).forEach((entry) => {
        currentPlacedCounter.set(entry.unitTypeId, (currentPlacedCounter.get(entry.unitTypeId) || 0) + entry.count);
      });
    });
    const nextTargetUnits = normalizeDefenderUnits(target?.units, target?.unitTypeId, target?.count);
    for (const entry of nextTargetUnits) {
      const maxCount = unitLimitMap.get(entry.unitTypeId) || 0;
      const nextCount = (currentPlacedCounter.get(entry.unitTypeId) || 0) + entry.count;
      if (nextCount > maxCount) {
        const unitName = defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId;
        setMessage(`兵力不足：${unitName} 可部署 ${maxCount}，当前尝试部署 ${nextCount}`);
        return false;
      }
    }
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).map((item) => (
      item.deployId === deployId
        ? { ...item, placed: true, x: nextPoint.x, y: nextPoint.y }
        : item
    ));
    setDefenderDeployments(nextDeployments);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队位置已更新');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队位置已更新并保存');
    }
    return true;
  }, [defenderDeployments, defenderRosterMap, defenderZoneMinX, editMode, effectiveCanEdit, fieldHeight, fieldWidth, persistDefenderDeploymentsNow]);

  const resolveDefenderMovePreview = useCallback((deployId, worldPoint) => {
    if (!deployId || !worldPoint) return null;
    const source = sanitizeDefenderDeployments(defenderDeployments);
    const target = source.find((item) => item.deployId === deployId);
    if (!target) return null;
    const rawX = Number(worldPoint?.x) || 0;
    const rawY = Number(worldPoint?.y) || 0;
    const nextPoint = {
      x: Math.max(-fieldWidth / 2, Math.min(fieldWidth / 2, rawX)),
      y: Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, rawY))
    };
    const overlap = source.some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y) < 20
    ));
    const outsideZone = rawX < defenderZoneMinX;
    return {
      deployId,
      x: nextPoint.x,
      y: nextPoint.y,
      blocked: outsideZone || overlap,
      reason: outsideZone ? 'zone' : (overlap ? 'overlap' : '')
    };
  }, [defenderDeployments, defenderZoneMinX, fieldHeight, fieldWidth]);

  const openDefenderEditor = useCallback(() => {
    if (!effectiveCanEdit) return;
    if (defenderEditorAvailableRows.length <= 0 || defenderEditorAvailableRows.every((row) => row.available <= 0)) {
      setMessage('当前门向尚未配置守军兵力，无法编辑守军部队');
      return;
    }
    const highestSortOrder = defenderDeploymentRows.reduce(
      (max, item) => Math.max(max, Math.max(1, Math.floor(Number(item?.sortOrder) || 1))),
      0
    );
    const nextSortOrder = highestSortOrder + 1;
    setDefenderEditorDraft({
      name: '',
      sortOrder: nextSortOrder,
      units: []
    });
    setSidebarTab('defender');
    setDefenderEditorOpen(true);
  }, [defenderDeploymentRows, defenderEditorAvailableRows, effectiveCanEdit]);

  const closeDefenderEditor = useCallback(() => {
    setDefenderEditorOpen(false);
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
  }, []);

  const openDefenderQuantityDialog = useCallback((unitTypeId) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return;
    const available = resolveDefenderAvailableCount(safeUnitTypeId, defenderEditorDraft?.units || []);
    if (available <= 0) {
      setMessage('该兵种可分配数量不足');
      return;
    }
    const current = normalizeDefenderUnits(defenderEditorDraft?.units || [])
      .find((entry) => entry.unitTypeId === safeUnitTypeId)?.count || 0;
    const unitName = defenderRosterMap.get(safeUnitTypeId)?.unitName || safeUnitTypeId;
    setDefenderQuantityDialog({
      open: true,
      unitTypeId: safeUnitTypeId,
      unitName,
      max: Math.max(1, available),
      current: Math.max(1, Math.min(available, current || 1))
    });
  }, [defenderEditorDraft?.units, defenderRosterMap, resolveDefenderAvailableCount]);

  const removeDraftUnit = useCallback((unitTypeId) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return;
    setDefenderEditorDraft((prev) => ({
      ...prev,
      units: normalizeDefenderUnits(prev?.units || []).filter((entry) => entry.unitTypeId !== safeUnitTypeId)
    }));
  }, []);

  const confirmDefenderQuantityDialog = useCallback((qty) => {
    const unitTypeId = typeof defenderQuantityDialog?.unitTypeId === 'string' ? defenderQuantityDialog.unitTypeId.trim() : '';
    if (!unitTypeId) {
      setDefenderQuantityDialog((prev) => ({ ...prev, open: false }));
      return;
    }
    const max = Math.max(1, Math.floor(Number(defenderQuantityDialog?.max) || 1));
    const safeQty = Math.max(1, Math.min(max, Math.floor(Number(qty) || 1)));
    setDefenderEditorDraft((prev) => {
      const nextUnits = normalizeDefenderUnits(prev?.units || []);
      const idx = nextUnits.findIndex((entry) => entry.unitTypeId === unitTypeId);
      if (idx >= 0) {
        nextUnits[idx] = { ...nextUnits[idx], count: safeQty };
      } else {
        nextUnits.push({ unitTypeId, count: safeQty });
      }
      return { ...prev, units: normalizeDefenderUnits(nextUnits) };
    });
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
  }, [defenderQuantityDialog]);

  const saveDefenderEditor = useCallback(() => {
    if (!effectiveCanEdit) return;
    const draftUnits = normalizeDefenderUnits(defenderEditorDraft?.units || []);
    if (draftUnits.length <= 0) {
      setMessage('请至少添加一个兵种后再创建守军部队');
      return;
    }
    const totalCount = draftUnits.reduce((sum, entry) => sum + entry.count, 0);
    if (totalCount <= 0) {
      setMessage('守军部队总兵力必须大于 0');
      return;
    }
    const point = buildDefaultDefenderPoint('');
    const fallbackName = `守军部队${defenderDeploymentRows.length + 1}`;
    const teamName = (typeof defenderEditorDraft?.name === 'string' && defenderEditorDraft.name.trim())
      ? defenderEditorDraft.name.trim()
      : fallbackName;
    const sortOrder = Math.max(1, Math.floor(Number(defenderEditorDraft?.sortOrder) || (defenderDeploymentRows.length + 1)));
    const nextDeployment = {
      deployId: `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: teamName,
      sortOrder,
      placed: false,
      units: draftUnits,
      unitTypeId: draftUnits[0].unitTypeId,
      count: draftUnits[0].count,
      x: point.x,
      y: point.y
    };
    const nextDeployments = [...sanitizeDefenderDeployments(defenderDeployments), nextDeployment];
    setDefenderDeployments(nextDeployments);
    if (editMode) setHasDraftChanges(true);
    else persistDefenderDeploymentsNow(nextDeployments);
    setSelectedDeploymentId(nextDeployment.deployId);
    setDefenderEditorOpen(false);
    setDefenderEditorDraft({
      name: '',
      sortOrder: sortOrder + 1,
      units: []
    });
    setMessage(editMode
      ? `已创建守军部队：${teamName}（${totalCount}），可拖到地图部署`
      : `已创建守军部队并保存：${teamName}（${totalCount}），可拖到地图部署`);
  }, [
    defenderDeployments,
    buildDefaultDefenderPoint,
    defenderEditorDraft,
    defenderDeploymentRows.length,
    editMode,
    effectiveCanEdit,
    persistDefenderDeploymentsNow
  ]);

  const removeDefenderDeployment = useCallback((deployId) => {
    if (!deployId) return;
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).filter((item) => item.deployId !== deployId);
    setDefenderDeployments(nextDeployments);
    setSelectedDeploymentId('');
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队已移除');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队已移除并保存');
    }
  }, [defenderDeployments, editMode, persistDefenderDeploymentsNow]);

  const unplaceDefenderDeployment = useCallback((deployId) => {
    if (!deployId) return;
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).map((item) => (
      item.deployId === deployId
        ? { ...item, placed: false }
        : item
    ));
    setDefenderDeployments(nextDeployments);
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队已从地图撤下');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队已从地图撤下并保存');
    }
  }, [defenderDeployments, editMode, persistDefenderDeploymentsNow]);

  const persistBattlefieldLayout = useCallback(async (nextWalls = [], options = {}) => {
    if (!open || !nodeId) return { ok: false };
    const silent = options?.silent !== false;
    const layoutMetaForSave = options?.layoutMeta || activeLayoutMeta;
    const itemCatalogForSave = options?.itemCatalog || itemCatalog;
    const defenderDeploymentsForSave = options?.defenderDeployments || defenderDeployments;
    const sanitizedWalls = sanitizeWalls(nextWalls);
    const sanitizedDefenderDeployments = sanitizeDefenderDeployments(defenderDeploymentsForSave);
    writeBattlefieldCache(nodeId, gateKey, {
      walls: sanitizedWalls,
      defenderDeployments: sanitizedDefenderDeployments,
      layoutMeta: layoutMetaForSave,
      itemCatalog: itemCatalogForSave,
      needsSync: true
    });
    setCacheNeedsSync(true);

    if (!effectiveCanEdit) {
      if (!silent) setMessage('离线缓存已保存，待网络恢复后同步');
      return { ok: true, cached: true };
    }

    const token = localStorage.getItem('token');
    if (!token) {
      if (!silent) setMessage('离线缓存已保存，待登录后同步');
      return { ok: true, cached: true };
    }

    if (!silent) setSavingLayout(true);
    try {
      const response = await fetch(`${API_BASE}/api/nodes/${nodeId}/battlefield-layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(buildLayoutPayload({
          walls: sanitizedWalls,
          defenderDeployments: sanitizedDefenderDeployments,
          layoutMeta: layoutMetaForSave,
          itemCatalog: itemCatalogForSave,
          gateKey
        }))
      });
      const data = await parseApiResponse(response);
      if (!response.ok || !data) {
        const error = getApiError(data, '保存战场布局失败');
        setErrorText(error);
        writeBattlefieldCache(nodeId, gateKey, {
          walls: sanitizedWalls,
          defenderDeployments: sanitizedDefenderDeployments,
          layoutMeta: layoutMetaForSave,
          itemCatalog: itemCatalogForSave,
          needsSync: true,
          message: error
        });
        setCacheNeedsSync(true);
        return { ok: false, error };
      }
      writeBattlefieldCache(nodeId, gateKey, {
        walls: sanitizedWalls,
        defenderDeployments: sanitizedDefenderDeployments,
        layoutMeta: layoutMetaForSave,
        itemCatalog: itemCatalogForSave,
        needsSync: false,
        message: ''
      });
      setCacheNeedsSync(false);
      setErrorText('');
      if (!silent) setMessage(data.message || '战场布局已保存');
      return { ok: true };
    } catch (error) {
      setErrorText(`保存战场布局失败: ${error.message}`);
      writeBattlefieldCache(nodeId, gateKey, {
        walls: sanitizedWalls,
        defenderDeployments: sanitizedDefenderDeployments,
        layoutMeta: layoutMetaForSave,
        itemCatalog: itemCatalogForSave,
        needsSync: true,
        message: error.message
      });
      setCacheNeedsSync(true);
      if (!silent) setMessage('网络异常，已写入本地缓存，待自动同步');
      return { ok: false, error: error.message };
    } finally {
      if (!silent) setSavingLayout(false);
    }
  }, [activeLayoutMeta, defenderDeployments, effectiveCanEdit, gateKey, itemCatalog, nodeId, open]);

  useEffect(() => {
    persistBattlefieldLayoutRef.current = persistBattlefieldLayout;
  }, [persistBattlefieldLayout]);

  const startLayoutEditing = useCallback(() => {
    if (!effectiveCanEdit) return;
    editSessionWallsRef.current = cloneWalls(walls);
    editSessionDefenderDeploymentsRef.current = sanitizeDefenderDeployments(defenderDeployments);
    setHasDraftChanges(false);
    setEditMode(true);
    setSidebarTab('items');
    setDefenderEditorOpen(false);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    animateCameraAngle(CAMERA_ANGLE_EDIT);
    cancelGhostPlacement('');
    setMessage('布置模式已开启：完成后请点击“保存布置”');
  }, [animateCameraAngle, cancelGhostPlacement, defenderDeployments, effectiveCanEdit, walls]);

  const cancelLayoutEditing = useCallback(() => {
    const snapshotWalls = editSessionWallsRef.current;
    const snapshotDeployments = editSessionDefenderDeploymentsRef.current;
    if (Array.isArray(snapshotWalls)) {
      setWalls(cloneWalls(snapshotWalls));
    }
    if (Array.isArray(snapshotDeployments)) {
      setDefenderDeployments(sanitizeDefenderDeployments(snapshotDeployments));
    }
    editSessionWallsRef.current = null;
    editSessionDefenderDeploymentsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    setDefenderEditorOpen(false);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    animateCameraAngle(CAMERA_ANGLE_PREVIEW);
    cancelGhostPlacement('');
    setMessage('已取消布置，已恢复到上一次战场布置状态');
  }, [animateCameraAngle, cancelGhostPlacement]);

  const saveLayoutEditing = useCallback(async () => {
    if (!effectiveCanEdit) return;
    cancelGhostPlacement('');
    if (!hasDraftChanges) {
      editSessionWallsRef.current = null;
      editSessionDefenderDeploymentsRef.current = null;
      setEditMode(false);
      setDefenderEditorOpen(false);
      setSelectedWallId('');
      setSelectedDeploymentId('');
      setActiveDefenderMoveId('');
      setDefenderDragPreview(null);
      animateCameraAngle(CAMERA_ANGLE_PREVIEW);
      setMessage('布置内容无变化');
      return;
    }
    const result = await persistBattlefieldLayout(walls, { silent: false });
    if (!result?.ok) return;
    editSessionWallsRef.current = null;
    editSessionDefenderDeploymentsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    setDefenderEditorOpen(false);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    animateCameraAngle(CAMERA_ANGLE_PREVIEW);
  }, [animateCameraAngle, cancelGhostPlacement, effectiveCanEdit, hasDraftChanges, persistBattlefieldLayout, walls]);

  useEffect(() => {
    if (!open || !nodeId) return;
    let cancelled = false;
    const token = localStorage.getItem('token');
    const localCache = readBattlefieldCache(nodeId, gateKey);

    const resolveCacheSnapshot = () => {
      const cachedCatalog = normalizeItemCatalog(localCache?.itemCatalog);
      const cachedMeta = localCache?.layoutMeta && typeof localCache.layoutMeta === 'object'
        ? {
          layoutId: typeof localCache.layoutMeta.layoutId === 'string' ? localCache.layoutMeta.layoutId : defaultLayoutMeta.layoutId,
          name: typeof localCache.layoutMeta.name === 'string' ? localCache.layoutMeta.name : '',
          fieldWidth: Number.isFinite(Number(localCache.layoutMeta.fieldWidth))
            ? Number(localCache.layoutMeta.fieldWidth)
            : defaultLayoutMeta.fieldWidth,
          fieldHeight: Number.isFinite(Number(localCache.layoutMeta.fieldHeight))
            ? Number(localCache.layoutMeta.fieldHeight)
            : defaultLayoutMeta.fieldHeight,
          maxItemsPerType: Number.isFinite(Number(localCache.layoutMeta.maxItemsPerType))
            ? Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Math.floor(Number(localCache.layoutMeta.maxItemsPerType)))
            : DEFAULT_MAX_ITEMS_PER_TYPE
        }
        : defaultLayoutMeta;
      const cachedWallSnapshot = sanitizeWallsWithLegacyCleanup(localCache?.walls);
      const cachedDefenderDeployments = normalizeDefenderDeploymentsToRightZone(
        localCache?.defenderDeployments,
        cachedMeta.fieldWidth,
        cachedMeta.fieldHeight
      );
      return {
        walls: cachedWallSnapshot.walls,
        defenderDeployments: cachedDefenderDeployments,
        itemCatalog: cachedCatalog,
        layoutMeta: cachedMeta,
        needsSync: !!localCache?.needsSync || cachedWallSnapshot.clearedLegacy,
        clearedLegacy: cachedWallSnapshot.clearedLegacy
      };
    };

    const loadLayout = async () => {
      setLoadingLayout(true);
      setLayoutReady(false);
      setErrorText('');
      const cacheSnapshot = resolveCacheSnapshot();
      if (!token) {
        if (!cancelled) {
          setWalls(cacheSnapshot.walls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(cacheSnapshot.itemCatalog);
          setDefenderRoster([]);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setServerCanEdit(!!canEdit);
          setCacheNeedsSync(cacheSnapshot.needsSync);
          setLoadingLayout(false);
          setLayoutReady(true);
          if (cacheSnapshot.needsSync) {
            setMessage(cacheSnapshot.clearedLegacy
              ? '已清空旧版默认战场物体，登录后将自动同步到服务端'
              : '本地存在待同步布局，登录后将自动同步');
          } else {
            setErrorText('未登录，已加载本地战场布局');
          }
        }
        return;
      }
      try {
        const response = await fetch(`${API_BASE}/api/nodes/${nodeId}/battlefield-layout?gateKey=${encodeURIComponent(gateKey || 'cheng')}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await parseApiResponse(response);
        if (!response.ok || !data) {
          if (cancelled) return;
          setWalls(cacheSnapshot.walls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(cacheSnapshot.itemCatalog);
          setDefenderRoster([]);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setServerCanEdit(!!canEdit);
          setCacheNeedsSync(cacheSnapshot.needsSync);
          setErrorText(getApiError(data, '加载战场布局失败，已使用本地缓存'));
          setLoadingLayout(false);
          setLayoutReady(true);
          return;
        }
        if (cancelled) return;
        const layoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object') ? data.layoutBundle : {};
        const nextCatalog = normalizeItemCatalog(layoutBundle.itemCatalog);
        const serverLayoutMeta = {
          layoutId: typeof layoutBundle?.activeLayout?.layoutId === 'string' ? layoutBundle.activeLayout.layoutId : `${gateKey || 'cheng'}_default`,
          name: typeof layoutBundle?.activeLayout?.name === 'string' ? layoutBundle.activeLayout.name : '',
          fieldWidth: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldWidth)) ? Number(layoutBundle.activeLayout.fieldWidth) : FIELD_WIDTH,
          fieldHeight: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldHeight)) ? Number(layoutBundle.activeLayout.fieldHeight) : FIELD_HEIGHT,
          maxItemsPerType: Number.isFinite(Number(layoutBundle?.activeLayout?.maxItemsPerType))
            ? Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Number(layoutBundle.activeLayout.maxItemsPerType))
            : DEFAULT_MAX_ITEMS_PER_TYPE
        };
        const serverWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls(layoutBundle));
        const serverDefenderDeployments = normalizeDefenderDeploymentsToRightZone(
          mapLayoutBundleToDefenderDeployments(layoutBundle),
          serverLayoutMeta.fieldWidth,
          serverLayoutMeta.fieldHeight
        );
        const serverWalls = serverWallSnapshot.walls;
        const rosterRows = Array.isArray(data?.defenderRoster) ? data.defenderRoster : [];
        setDefenderRoster(rosterRows);
        const canEditByServer = !!data.canEdit;
        setServerCanEdit(canEditByServer);

        if (cacheSnapshot.needsSync && canEditByServer) {
          setWalls(cacheSnapshot.walls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(cacheSnapshot.itemCatalog);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setCacheNeedsSync(true);
          pendingCacheSyncRef.current = {
            walls: cacheSnapshot.walls,
            defenderDeployments: cacheSnapshot.defenderDeployments,
            layoutMeta: cacheSnapshot.layoutMeta,
            itemCatalog: cacheSnapshot.itemCatalog
          };
          setMessage(cacheSnapshot.clearedLegacy
            ? '已清空旧版默认战场物体，正在回写服务端'
            : '检测到离线改动，正在尝试回写服务端');
        } else {
          const shouldSyncLegacyCleanup = serverWallSnapshot.clearedLegacy && canEditByServer;
          setWalls(serverWalls);
          setDefenderDeployments(serverDefenderDeployments);
          setItemCatalog(nextCatalog);
          setActiveLayoutMeta(serverLayoutMeta);
          setCacheNeedsSync(shouldSyncLegacyCleanup);
          if (shouldSyncLegacyCleanup) {
            pendingCacheSyncRef.current = {
              walls: serverWalls,
              defenderDeployments: serverDefenderDeployments,
              layoutMeta: serverLayoutMeta,
              itemCatalog: nextCatalog
            };
            setMessage('检测到旧版默认战场物体，已自动清空并准备同步');
          } else if (serverWallSnapshot.clearedLegacy) {
            setMessage('检测到旧版默认战场物体，已自动清空');
          }
          writeBattlefieldCache(nodeId, gateKey, {
            walls: serverWalls,
            defenderDeployments: serverDefenderDeployments,
            itemCatalog: nextCatalog,
            layoutMeta: serverLayoutMeta,
            needsSync: shouldSyncLegacyCleanup
          });
        }
        setErrorText('');
      } catch (error) {
        if (cancelled) return;
        const cacheSnapshot = resolveCacheSnapshot();
        setWalls(cacheSnapshot.walls);
        setDefenderDeployments(cacheSnapshot.defenderDeployments);
        setItemCatalog(cacheSnapshot.itemCatalog);
        setDefenderRoster([]);
        setActiveLayoutMeta(cacheSnapshot.layoutMeta);
        setServerCanEdit(!!canEdit);
        setCacheNeedsSync(cacheSnapshot.needsSync);
        setErrorText(`加载战场布局失败: ${error.message}，已使用本地缓存`);
      } finally {
        if (cancelled) return;
        setLoadingLayout(false);
        setLayoutReady(true);
      }
    };

    editSessionWallsRef.current = null;
    pendingCacheSyncRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
    cameraAnimRef.current = null;
    zoomAnimRef.current = null;
    cameraAngleRef.current = CAMERA_ANGLE_PREVIEW;
    setCameraAngle(CAMERA_ANGLE_PREVIEW);
    cameraYawRef.current = CAMERA_YAW_DEFAULT;
    setCameraYaw(CAMERA_YAW_DEFAULT);
    zoomTargetRef.current = DEFAULT_ZOOM;
    setZoom(DEFAULT_ZOOM);
    panWorldRef.current = { x: 0, y: 0 };
    setPanWorld({ x: 0, y: 0 });
    setIsPanning(false);
    setIsRotating(false);
    rotateDragRef.current = null;
    panDragRef.current = null;
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setInvalidReason('');
    setSelectedDeploymentId('');
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    setSidebarTab('items');
    setDefenderEditorOpen(false);
    setDefenderEditorDraft({
      name: '',
      sortOrder: 1,
      units: []
    });
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
    setSelectedPaletteItem('');
    setSelectedWallId('');
    setMessage('');
    loadLayout();

    return () => {
      cancelled = true;
    };
  }, [canEdit, defaultLayoutMeta, gateKey, open, nodeId]);

  useEffect(() => {
    if (!open || !layoutReady || !pendingCacheSyncRef.current) return;
    if (!effectiveCanEdit) return;
    const payload = pendingCacheSyncRef.current;
    pendingCacheSyncRef.current = null;
    persistBattlefieldLayout(payload.walls, {
      silent: true,
      layoutMeta: payload.layoutMeta,
      itemCatalog: payload.itemCatalog,
      defenderDeployments: payload.defenderDeployments
    }).then((result) => {
      if (result?.ok && !result?.cached) {
        setMessage('离线缓存已同步到服务端');
      }
    });
  }, [effectiveCanEdit, layoutReady, open, persistBattlefieldLayout]);

  useEffect(() => {
    if (!selectedWallId) return;
    const exists = walls.some((item) => item.id === selectedWallId);
    if (!exists) setSelectedWallId('');
  }, [selectedWallId, walls]);

  useEffect(() => {
    if (!selectedDeploymentId) return;
    const exists = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => item.deployId === selectedDeploymentId);
    if (!exists) setSelectedDeploymentId('');
  }, [defenderDeployments, selectedDeploymentId]);

  useEffect(() => {
    if (!defenderEditorOpen) return;
    setDefenderEditorDraft((prev) => {
      const nextUnits = normalizeDefenderUnits(prev?.units || [])
        .map((entry) => {
          const max = resolveDefenderAvailableCount(entry.unitTypeId, prev?.units || []);
          if (max <= 0) return null;
          return {
            unitTypeId: entry.unitTypeId,
            count: Math.max(1, Math.min(max, entry.count))
          };
        })
        .filter(Boolean);
      return {
        ...prev,
        units: normalizeDefenderUnits(nextUnits)
      };
    });
  }, [defenderEditorOpen, resolveDefenderAvailableCount, defenderStockRows]);

  useEffect(() => {
    if (!open || !layoutReady || !cacheNeedsSync || !effectiveCanEdit) return undefined;
    if (editMode) return undefined;
    let syncing = false;
    const trySync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const result = await persistBattlefieldLayout(walls, { silent: true });
        if (result?.ok && !result?.cached) {
          setMessage('离线缓存已同步到服务端');
        }
      } finally {
        syncing = false;
      }
    };
    const handleOnline = () => {
      trySync();
    };
    window.addEventListener('online', handleOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      trySync();
    }
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [cacheNeedsSync, editMode, effectiveCanEdit, layoutReady, open, persistBattlefieldLayout, walls]);

  useEffect(() => {
    if (!open || !threeRef.current) return;
    const { renderer, scene, camera, worldGroup } = threeRef.current;
    if (!renderer || !scene || !camera || !worldGroup) return;

    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));
    renderer.setSize(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)), false);

    clearThreeGroup(worldGroup);

    const fieldMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(fieldWidth, fieldHeight),
      new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.9,
        metalness: 0.04,
        side: THREE.DoubleSide
      })
    );
    fieldMesh.position.set(0, 0, 0);
    worldGroup.add(fieldMesh);

    const fieldTint = new THREE.Mesh(
      new THREE.PlaneGeometry(fieldWidth * 0.98, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    fieldTint.position.set(0, 0, 0.12);
    worldGroup.add(fieldTint);

    const deployZoneWidth = Math.max(10, fieldWidth * DEPLOY_ZONE_RATIO);
    const deployZoneCenterOffset = (fieldWidth - deployZoneWidth) / 2;
    const deployZoneZ = 0.16;
    const friendlyZone = new THREE.Mesh(
      new THREE.PlaneGeometry(deployZoneWidth, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    friendlyZone.position.set(deployZoneCenterOffset, 0, deployZoneZ);
    worldGroup.add(friendlyZone);

    const enemyZone = new THREE.Mesh(
      new THREE.PlaneGeometry(deployZoneWidth, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0xf87171,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    enemyZone.position.set(-deployZoneCenterOffset, 0, deployZoneZ);
    worldGroup.add(enemyZone);

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-fieldWidth / 2, -fieldHeight / 2, 0.4),
      new THREE.Vector3(fieldWidth / 2, -fieldHeight / 2, 0.4),
      new THREE.Vector3(fieldWidth / 2, fieldHeight / 2, 0.4),
      new THREE.Vector3(-fieldWidth / 2, fieldHeight / 2, 0.4)
    ]);
    const borderLine = new THREE.LineLoop(
      borderGeometry,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.72
      })
    );
    worldGroup.add(borderLine);

    const gridPoints = [];
    const gridStep = 70;
    for (let x = -fieldWidth / 2; x <= fieldWidth / 2; x += gridStep) {
      gridPoints.push(new THREE.Vector3(x, -fieldHeight / 2, 0.2));
      gridPoints.push(new THREE.Vector3(x, fieldHeight / 2, 0.2));
    }
    for (let y = -fieldHeight / 2; y <= fieldHeight / 2; y += gridStep) {
      gridPoints.push(new THREE.Vector3(-fieldWidth / 2, y, 0.2));
      gridPoints.push(new THREE.Vector3(fieldWidth / 2, y, 0.2));
    }
    const gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPoints),
      new THREE.LineBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.28
      })
    );
    worldGroup.add(gridLines);

    const pickableWallMeshes = [];
    const buildWallMesh = (wallLike, options = {}) => {
      const safeHeight = Math.max(14, Number(wallLike.height) || WALL_HEIGHT);
      const safeWidth = Math.max(20, Number(wallLike.width) || WALL_WIDTH);
      const safeDepth = Math.max(12, Number(wallLike.depth) || WALL_DEPTH);
      const baseZ = getWallBaseZ(wallLike);
      const selected = !!options.selected;
      const ghostMode = !!options.ghost;
      const blocked = !!options.blocked;
      const itemId = typeof wallLike?.itemId === 'string' ? wallLike.itemId : '';
      const itemStyle = itemCatalogById.get(itemId)?.style;
      const style = itemStyle && typeof itemStyle === 'object' ? itemStyle : {};
      const renderShape = typeof style.shape === 'string' ? style.shape.trim().toLowerCase() : '';
      const color = ghostMode
        ? (blocked ? 0xb91c1c : 0xf59e0b)
        : (selected ? 0x60a5fa : parseHexColor(style.color, 0xc2783c));

      if (renderShape === 'cheval_de_frise') {
        const woodColor = ghostMode || selected ? color : parseHexColor(style.color, 0x8c6a44);
        const spikeColor = ghostMode || selected ? color : parseHexColor(style.spikeColor, 0x9ca3af);
        const beamCount = Math.round(clampStyleNumber(style.beamCount, 2, 2, 3));
        const spikeCount = Math.round(clampStyleNumber(style.spikeCount, 8, 4, 14));
        const beamSpreadDeg = clampStyleNumber(style.beamSpreadDeg, 34, 10, 60);
        const beamThicknessRatio = clampStyleNumber(style.beamThicknessRatio, 0.13, 0.08, 0.24);
        const spikeLengthRatio = clampStyleNumber(style.spikeLengthRatio, 0.48, 0.25, 0.8);

        const group = new THREE.Group();
        group.position.set(Number(wallLike.x) || 0, Number(wallLike.y) || 0, baseZ);
        group.rotation.set(0, 0, degToRad(wallLike.rotation || 0));
        worldGroup.add(group);

        const beamLength = Math.max(safeWidth, safeDepth) * 1.08;
        const beamRadius = Math.max(2.6, Math.min(10, Math.min(safeWidth, safeDepth) * beamThicknessRatio));
        const beamZ = Math.max(beamRadius + 2, safeHeight * 0.3);
        const beamGeometry = new THREE.CylinderGeometry(beamRadius, beamRadius, beamLength, 12);
        const beamMaterial = new THREE.MeshStandardMaterial({
          color: woodColor,
          transparent: ghostMode,
          opacity: ghostMode ? 0.52 : 1,
          roughness: 0.86,
          metalness: 0.04,
          side: THREE.DoubleSide,
          depthWrite: true
        });

        const beamAngles = [];
        if (beamCount === 2) {
          beamAngles.push(-beamSpreadDeg, beamSpreadDeg);
        } else {
          beamAngles.push(-beamSpreadDeg, 0, beamSpreadDeg);
        }
        beamAngles.forEach((angleDeg) => {
          const beam = new THREE.Mesh(beamGeometry, beamMaterial);
          beam.position.set(0, 0, beamZ);
          beam.rotation.set(0, 0, degToRad(90 + angleDeg));
          group.add(beam);
          const beamEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(beam.geometry),
            new THREE.LineBasicMaterial({
              color: selected ? 0xbfdbfe : 0x1f2937,
              transparent: true,
              opacity: selected ? 0.95 : 0.5
            })
          );
          beamEdges.position.copy(beam.position);
          beamEdges.rotation.copy(beam.rotation);
          group.add(beamEdges);
          if (!ghostMode && typeof wallLike.id === 'string') {
            beam.userData.wallId = wallLike.id;
            pickableWallMeshes.push(beam);
          }
        });

        const spikeLength = Math.max(10, safeHeight * spikeLengthRatio);
        const spikeRadius = Math.max(1.2, beamRadius * 0.45);
        const spikeRingRadius = Math.max(beamLength * 0.32, Math.min(safeWidth, safeDepth) * 0.42);
        const spikeGeometry = new THREE.ConeGeometry(spikeRadius, spikeLength, 10);
        const spikeMaterial = new THREE.MeshStandardMaterial({
          color: spikeColor,
          transparent: ghostMode,
          opacity: ghostMode ? 0.55 : 0.96,
          roughness: 0.36,
          metalness: 0.68,
          side: THREE.DoubleSide,
          depthWrite: true
        });
        for (let i = 0; i < spikeCount; i += 1) {
          const angle = (Math.PI * 2 * i) / spikeCount;
          const sx = Math.cos(angle) * spikeRingRadius;
          const sy = Math.sin(angle) * spikeRingRadius;
          const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
          spike.position.set(sx, sy, beamZ + (spikeLength * 0.25));
          spike.rotation.set(Math.PI / 2, 0, angle - (Math.PI / 2));
          group.add(spike);
          if (!ghostMode && typeof wallLike.id === 'string') {
            spike.userData.wallId = wallLike.id;
            pickableWallMeshes.push(spike);
          }
        }

        // Invisible hitbox keeps click/selection reliable while preserving the visual shape.
        const hitbox = new THREE.Mesh(
          new THREE.BoxGeometry(safeWidth, safeDepth, safeHeight),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hitbox.position.set(0, 0, safeHeight / 2);
        group.add(hitbox);
        if (!ghostMode && typeof wallLike.id === 'string') {
          hitbox.userData.wallId = wallLike.id;
          pickableWallMeshes.push(hitbox);
        }
        return;
      }

      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(safeWidth, safeDepth, safeHeight),
        new THREE.MeshStandardMaterial({
          color,
          transparent: ghostMode,
          opacity: ghostMode ? 0.46 : 1,
          roughness: ghostMode ? 0.5 : 0.82,
          metalness: ghostMode ? 0.12 : 0.05,
          side: THREE.DoubleSide,
          depthWrite: true
        })
      );
      wallMesh.position.set(Number(wallLike.x) || 0, Number(wallLike.y) || 0, baseZ + (safeHeight / 2));
      wallMesh.rotation.set(0, 0, degToRad(wallLike.rotation || 0));
      worldGroup.add(wallMesh);
      if (!ghostMode && typeof wallLike.id === 'string') {
        wallMesh.userData.wallId = wallLike.id;
        pickableWallMeshes.push(wallMesh);
      }

      const edgeMesh = new THREE.LineSegments(
        new THREE.EdgesGeometry(wallMesh.geometry),
        new THREE.LineBasicMaterial({
          color: selected ? 0xbfdbfe : 0x0f172a,
          transparent: true,
          opacity: selected ? 0.96 : 0.68
        })
      );
      edgeMesh.position.copy(wallMesh.position);
      edgeMesh.rotation.copy(wallMesh.rotation);
      worldGroup.add(edgeMesh);
    };

    const buildDefenderSquadMesh = (deploymentLike, options = {}) => {
      const deployment = deploymentLike || {};
      const units = normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count);
      const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
      if (totalCount <= 0) return;
      const isSelected = !!options.selected;
      const isPreview = !!options.preview;
      const isBlocked = !!options.blocked;
      const opacity = isPreview ? (isBlocked ? 0.42 : 0.62) : 0.98;
      const resolveUnitMeta = (unitTypeId) => {
        const row = defenderRosterMap.get(unitTypeId) || null;
        return {
          unitName: row?.unitName || unitTypeId,
          roleTag: row?.roleTag === '远程' ? '远程' : '近战'
        };
      };

      const squadGroup = new THREE.Group();
      squadGroup.position.set(0, 0, 0.24);
      worldGroup.add(squadGroup);

      const soldierCount = Math.max(
        DEFENDER_SOLDIER_MIN,
        Math.min(DEFENDER_SOLDIER_MAX, Math.ceil(totalCount / 10))
      );
      const clusterRadius = Math.max(8, Math.min(24, 8 + (Math.sqrt(totalCount) * 0.75)));
      const centerX = Number(deployment?.x) || 0;
      const centerY = Number(deployment?.y) || 0;
      const soldierTokens = buildDefenderSoldierTokens(units, soldierCount, resolveUnitMeta, isBlocked);
      if (soldierTokens.length <= 0) return;
      const infantryBodyGeometry = new THREE.ConeGeometry(1.35 * DEFENDER_SOLDIER_VISUAL_SCALE, 4.8 * DEFENDER_SOLDIER_VISUAL_SCALE, 6);
      const infantryShieldGeometry = new THREE.BoxGeometry(1.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.6 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.8 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const cavalryMountGeometry = new THREE.BoxGeometry(2.5 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.1 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.1 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const cavalryRiderGeometry = new THREE.CylinderGeometry(0.58 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.74 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.4 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const cavalryLanceGeometry = new THREE.CylinderGeometry(0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 3.4 * DEFENDER_SOLDIER_VISUAL_SCALE, 7);
      const archerBodyGeometry = new THREE.CylinderGeometry(0.64 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.82 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.9 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const archerBowGeometry = new THREE.TorusGeometry(0.95 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 8, 20, Math.PI);
      const artilleryBodyGeometry = new THREE.BoxGeometry(2.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.4 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.45 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const artilleryTubeGeometry = new THREE.CylinderGeometry(0.34 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.42 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.4 * DEFENDER_SOLDIER_VISUAL_SCALE, 9);
      const headGeometry = new THREE.SphereGeometry(0.94 * DEFENDER_SOLDIER_VISUAL_SCALE, 9, 9);
      const shadowGeometry = new THREE.CircleGeometry(Math.max(1.1, 2.2 * DEFENDER_SOLDIER_VISUAL_SCALE), 10);
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x020617,
        transparent: true,
        opacity: isPreview ? 0.18 : 0.24,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const createLitMaterial = (hexColor, materialOpacity = opacity, emissiveScale = 0.14) => new THREE.MeshStandardMaterial({
        color: hexColor,
        emissive: tintHexColor(hexColor, 0, 1, 0.02),
        emissiveIntensity: isPreview ? (emissiveScale * 0.75) : emissiveScale,
        transparent: isPreview,
        opacity: materialOpacity,
        roughness: 0.46,
        metalness: 0.12
      });
      const addInfantrySoldier = (sx, sy, bodyColor, accentColor) => {
        const body = new THREE.Mesh(infantryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.18));
        body.position.set(sx, sy, 1.26 * DEFENDER_SOLDIER_VISUAL_SCALE);
        body.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(body);
        const shield = new THREE.Mesh(infantryShieldGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.98, 0.1));
        shield.position.set(sx + (0.92 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 1.2 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(shield);
      };
      const addCavalrySoldier = (sx, sy, bodyColor, accentColor) => {
        const mount = new THREE.Mesh(cavalryMountGeometry, createLitMaterial(bodyColor, opacity, 0.16));
        mount.position.set(sx, sy, 0.96 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(mount);
        const rider = new THREE.Mesh(cavalryRiderGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.96 : 0.98, 0.12));
        rider.position.set(sx, sy, 2.25 * DEFENDER_SOLDIER_VISUAL_SCALE);
        rider.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(rider);
        const lance = new THREE.Mesh(cavalryLanceGeometry, createLitMaterial(0xf8fafc, isPreview ? opacity * 0.9 : 0.95, 0.06));
        lance.position.set(sx + (1.4 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.45 * DEFENDER_SOLDIER_VISUAL_SCALE);
        lance.rotation.set(0, Math.PI / 2, Math.PI / 10);
        squadGroup.add(lance);
      };
      const addArcherSoldier = (sx, sy, bodyColor, accentColor) => {
        const body = new THREE.Mesh(archerBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
        body.position.set(sx, sy, 1.72 * DEFENDER_SOLDIER_VISUAL_SCALE);
        body.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(body);
        const bow = new THREE.Mesh(archerBowGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.95, 0.12));
        bow.position.set(sx + (0.94 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 1.94 * DEFENDER_SOLDIER_VISUAL_SCALE);
        bow.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        squadGroup.add(bow);
      };
      const addArtillerySoldier = (sx, sy, bodyColor, accentColor) => {
        const body = new THREE.Mesh(artilleryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
        body.position.set(sx, sy, 1.08 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(body);
        const tube = new THREE.Mesh(artilleryTubeGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.96, 0.12));
        tube.position.set(sx + (0.92 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.06 * DEFENDER_SOLDIER_VISUAL_SCALE);
        tube.rotation.set(0, Math.PI / 2, Math.PI / 5);
        squadGroup.add(tube);
      };

      for (let index = 0; index < soldierTokens.length; index += 1) {
        const token = soldierTokens[index];
        const offset = computeMiniFormationOffset(index, soldierCount, clusterRadius);
        const sx = centerX + offset.x;
        const sy = centerY + offset.y;
        const bodyColor = isSelected
          ? tintHexColor(token.bodyColor, 0, 1.12, 0.08)
          : token.bodyColor;
        const accentColor = isSelected
          ? tintHexColor(token.accentColor, 0, 1.08, 0.06)
          : token.accentColor;
        const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadow.position.set(sx, sy, 0.05);
        shadow.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(shadow);

        if (token.classTag === 'cavalry') {
          addCavalrySoldier(sx, sy, bodyColor, accentColor);
        } else if (token.classTag === 'archer') {
          addArcherSoldier(sx, sy, bodyColor, accentColor);
        } else if (token.classTag === 'artillery') {
          addArtillerySoldier(sx, sy, bodyColor, accentColor);
        } else {
          addInfantrySoldier(sx, sy, bodyColor, accentColor);
        }

        const head = new THREE.Mesh(headGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.98, 0.13));
        head.position.set(sx, sy, 3.06 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(head);
      }

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 8.5, 8),
        new THREE.MeshStandardMaterial({
          color: 0xcbd5e1,
          transparent: isPreview,
          opacity: isPreview ? 0.7 : 0.92,
          roughness: 0.35,
          metalness: 0.28
        })
      );
      pole.position.set(centerX, centerY, 5.1);
      squadGroup.add(pole);

      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(4.8, 2.8),
        new THREE.MeshStandardMaterial({
          color: isBlocked ? 0xfca5a5 : 0xbfdbfe,
          transparent: true,
          opacity: isPreview ? 0.38 : 0.5,
          roughness: 0.95,
          metalness: 0,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      banner.position.set(centerX + 2.8, centerY, 8);
      banner.rotation.set(0, Math.PI / 2, 0);
      squadGroup.add(banner);

      const plate = new THREE.Mesh(
        new THREE.CircleGeometry(clusterRadius * 0.92, 44),
        new THREE.MeshBasicMaterial({
          color: isBlocked ? 0xfca5a5 : 0x7dd3fc,
          transparent: true,
          opacity: isBlocked ? 0.18 : 0.22,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      plate.position.set(centerX, centerY, 0.08);
      squadGroup.add(plate);

      if (isSelected) {
        const contourRing = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(5.4, clusterRadius * 0.98), 0.52, 10, 44),
          new THREE.MeshBasicMaterial({
            color: 0xe0f2fe,
            transparent: true,
            opacity: 0.88,
            depthWrite: false
          })
        );
        contourRing.position.set(centerX, centerY, 3.65 * DEFENDER_SOLDIER_VISUAL_SCALE);
        contourRing.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(contourRing);

        const contourAura = new THREE.Mesh(
          new THREE.CylinderGeometry(clusterRadius * 0.98, clusterRadius * 0.98, Math.max(2.8, 5.4 * DEFENDER_SOLDIER_VISUAL_SCALE), 30, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        contourAura.position.set(centerX, centerY, 2.5 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(contourAura);
      }
    };

    walls.forEach((wall) => {
      const isSelected = editMode && effectiveCanEdit && !ghost && selectedWallId && wall.id === selectedWallId;
      buildWallMesh(wall, { selected: isSelected });
    });

    if (ghost) {
      buildWallMesh(ghost, { ghost: true, blocked: ghostBlocked });
    }
    const sceneDeployments = sanitizeDefenderDeployments(defenderDeployments);
    const previewDeployId = typeof defenderDragPreview?.deployId === 'string' ? defenderDragPreview.deployId : '';
    const previewDeployment = previewDeployId
      ? sceneDeployments.find((item) => item.deployId === previewDeployId)
      : null;
    const placedDeployments = sceneDeployments.filter((item) => item?.placed !== false);
    const deploymentsForRender = previewDeployment
      ? [
        ...placedDeployments.filter((item) => item.deployId !== previewDeployId),
        {
          ...previewDeployment,
          x: Number(defenderDragPreview?.x),
          y: Number(defenderDragPreview?.y)
        }
      ]
      : placedDeployments;
    deploymentsForRender.forEach((deployment) => {
      buildDefenderSquadMesh(deployment, {
        selected: selectedDeploymentId && deployment.deployId === selectedDeploymentId,
        preview: previewDeployId && deployment.deployId === previewDeployId,
        blocked: !!defenderDragPreview?.blocked
      });
    });
    if (threeRef.current) {
      threeRef.current.pickableWallMeshes = pickableWallMeshes;
    }

    if (snapState?.anchorId) {
      const anchor = walls.find((item) => item.id === snapState.anchorId);
      if (anchor) {
        const topHighlight = new THREE.Mesh(
          new THREE.PlaneGeometry(anchor.width, anchor.depth),
          new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        topHighlight.position.set(anchor.x, anchor.y, getWallTopZ(anchor) + 0.8);
        topHighlight.rotation.set(0, 0, degToRad(anchor.rotation || 0));
        worldGroup.add(topHighlight);
      }
    }

    const safeScale = Math.max(0.0001, worldScale || 1);
    const halfW = Math.max(1, viewport.width / (2 * safeScale));
    const halfH = Math.max(1, viewport.height / (2 * safeScale));
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;

    const target = new THREE.Vector3(
      Number(panWorld.x) || 0,
      Number(panWorld.y) || 0,
      0
    );
    const yawRad = degToRad(cameraYaw);
    const tiltRad = degToRad(cameraAngle);
    const distance = Math.max(fieldWidth, fieldHeight, 500) * 2.4;
    const planarDistance = distance * Math.cos(tiltRad);
    const heightDistance = distance * Math.sin(tiltRad);
    camera.position.set(
      target.x - (Math.sin(yawRad) * planarDistance),
      target.y - (Math.cos(yawRad) * planarDistance),
      target.z + heightDistance
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(target);
    camera.near = 1;
    camera.far = Math.max(12000, distance * 5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    renderer.render(scene, camera);
  }, [
    open,
    walls,
    ghost,
    ghostBlocked,
    snapState?.anchorId,
    viewport,
    cameraAngle,
    cameraYaw,
    worldScale,
    fieldHeight,
    fieldWidth,
    editMode,
    effectiveCanEdit,
    itemCatalogById,
    defenderRosterMap,
    selectedWallId,
    defenderDeployments,
    selectedDeploymentId,
    defenderDragPreview?.deployId,
    defenderDragPreview?.x,
    defenderDragPreview?.y,
    defenderDragPreview?.blocked,
    panWorld.x,
    panWorld.y
  ]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    wallActionButtonsRef.current = [];
    defenderActionButtonsRef.current = [];

    const drawPolygon = (points, fill, stroke) => {
      if (!points || points.length === 0) return;
      ctx.beginPath();
      points.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const projectOverlayPoint = (x, y, z = 0) => {
      const camera = threeRef.current?.camera;
      if (camera) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        return {
          x: ((p.x + 1) * 0.5) * canvas.width,
          y: ((1 - p.y) * 0.5) * canvas.height,
          depth: p.z
        };
      }
      return projectWorld(x, y, z, viewport, cameraAngle, cameraYaw, worldScale);
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (snapState?.anchorId) {
      const anchor = walls.find((item) => item.id === snapState.anchorId);
      if (anchor) {
        const topCorners = getRectCorners(anchor.x, anchor.y, anchor.width, anchor.depth, anchor.rotation)
          .map((point) => projectOverlayPoint(point.x, point.y, getWallTopZ(anchor)));
        drawPolygon(topCorners, 'rgba(56, 189, 248, 0.08)', 'rgba(56, 189, 248, 0.82)');
      }
    }

    wallGroups.forEach((group) => {
      const pos = projectOverlayPoint(group.center.x, group.center.y, group.center.z);
      const label = `${group.hp} / ${group.defense}`;
      ctx.font = '12px sans-serif';
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1;
      const boxX = pos.x - (textWidth / 2) - 8;
      const boxY = pos.y - 15;
      const boxW = textWidth + 16;
      const boxH = 18;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(label, pos.x - textWidth / 2, pos.y - 2);
    });

    (Array.isArray(defenderDeployments) ? defenderDeployments : [])
      .filter((deployment) => deployment?.placed !== false)
      .forEach((deployment) => {
      const units = normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count);
      if (units.length <= 0) return;
      const pos = projectOverlayPoint(Number(deployment?.x) || 0, Number(deployment?.y) || 0, 12);
      const totalCount = getDeploymentTotalCount(deployment);
      const labelName = (typeof deployment?.name === 'string' && deployment.name.trim()) ? deployment.name.trim() : '守军部队';
      const label = `${labelName} x${Math.max(1, totalCount)}`;

      ctx.font = '11px sans-serif';
      const textWidth = ctx.measureText(label).width;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(pos.x - (textWidth / 2) - 6, pos.y - 24, textWidth + 12, 16, 7);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
        ctx.fillRect(pos.x - (textWidth / 2) - 6, pos.y - 24, textWidth + 12, 16);
      }
      ctx.fillStyle = '#dbeafe';
      ctx.fillText(label, pos.x - (textWidth / 2), pos.y - 12);
    });

    const drawActionButton = (button) => {
      ctx.beginPath();
      ctx.arc(button.cx, button.cy, button.radius, 0, Math.PI * 2);
      ctx.fillStyle = button.type === 'move' ? 'rgba(30, 64, 175, 0.92)' : 'rgba(153, 27, 27, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(button.type === 'move' ? '✥' : '✕', button.cx, button.cy + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    };

    if (editMode && effectiveCanEdit && !ghost && selectedWallId) {
      const selectedWall = walls.find((item) => item.id === selectedWallId);
      if (selectedWall) {
        const anchor = projectOverlayPoint(
          selectedWall.x,
          selectedWall.y,
          getWallTopZ(selectedWall) + (WALL_HEIGHT * 0.45)
        );
        const centerY = anchor.y - WALL_ACTION_ICON_RISE;
        const buttons = [
          {
            type: 'move',
            wallId: selectedWall.id,
            cx: anchor.x - (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS
          },
          {
            type: 'remove',
            wallId: selectedWall.id,
            cx: anchor.x + (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS
          }
        ];
        wallActionButtonsRef.current = buttons;

        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y - 4);
        ctx.lineTo(anchor.x, centerY + WALL_ACTION_ICON_RADIUS + 4);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        buttons.forEach(drawActionButton);
      }
    }

    if (editMode && effectiveCanEdit && !ghost && selectedDeploymentId) {
      const selectedDeployment = (Array.isArray(defenderDeployments) ? defenderDeployments : [])
        .find((item) => item.deployId === selectedDeploymentId && item?.placed !== false);
      if (selectedDeployment) {
        const anchor = projectOverlayPoint(
          Number(selectedDeployment?.x) || 0,
          Number(selectedDeployment?.y) || 0,
          16
        );
        const centerY = anchor.y - WALL_ACTION_ICON_RISE;
        const buttons = [
          {
            type: 'move',
            deployId: selectedDeployment.deployId,
            cx: anchor.x - (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS + 2
          },
          {
            type: 'remove',
            deployId: selectedDeployment.deployId,
            cx: anchor.x + (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS + 2
          }
        ];
        defenderActionButtonsRef.current = buttons;

        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y - 3);
        ctx.lineTo(anchor.x, centerY + WALL_ACTION_ICON_RADIUS + 4);
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        buttons.forEach(drawActionButton);
      }
    }

    if (snapState?.type) {
      const tip = snapState.type === 'top'
        ? '吸附: 上方堆叠'
        : `吸附: ${snapState.type}`;
      ctx.font = '12px sans-serif';
      const w = ctx.measureText(tip).width;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
      ctx.fillRect(14, 14, w + 14, 20);
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(tip, 21, 28);
    }
    if (invalidReason) {
      const text = `不可放置: ${getPlacementReasonText(invalidReason) || invalidReason}`;
      ctx.font = '12px sans-serif';
      const w = ctx.measureText(text).width;
      const y = 40;
      ctx.fillStyle = 'rgba(127, 29, 29, 0.8)';
      ctx.fillRect(14, y, w + 14, 20);
      ctx.fillStyle = '#fecaca';
      ctx.fillText(text, 21, y + 14);
    }
  }, [open, walls, defenderDeployments, defenderRosterMap, selectedDeploymentId, ghost, ghostBlocked, snapState, viewport, cameraAngle, cameraYaw, wallGroups, worldScale, fieldHeight, fieldWidth, invalidReason, editMode, effectiveCanEdit, selectedWallId, panWorld.x, panWorld.y]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === ' ') {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if (event.key === 'Escape' && ghost) {
        event.preventDefault();
        cancelGhostPlacement('已取消放置');
      } else if (event.key === 'Escape' && activeDefenderMoveId) {
        event.preventDefault();
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        setMessage('已取消守军部队移动');
      }
    };
    const handleKeyUp = (event) => {
      if (event.key === ' ') {
        spacePressedRef.current = false;
      }
    };
    const handleBlur = () => {
      spacePressedRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeDefenderMoveId, cancelGhostPlacement, ghost, open]);

  const getPanDeltaFromScreenPoints = useCallback((from, to) => {
    const start = getWorldFromScreenPoint(from.x, from.y);
    const current = getWorldFromScreenPoint(to.x, to.y);
    return {
      x: (Number(start.x) || 0) - (Number(current.x) || 0),
      y: (Number(start.y) || 0) - (Number(current.y) || 0)
    };
  }, [getWorldFromScreenPoint]);

  const startPanDrag = (event, startScreen, buttonMask = 1) => {
    if (!startScreen) return;
    event.preventDefault();
    const pan = panWorldRef.current;
    panDragRef.current = {
      startScreenX: Number(startScreen.x) || 0,
      startScreenY: Number(startScreen.y) || 0,
      startPanX: Number(pan.x) || 0,
      startPanY: Number(pan.y) || 0,
      buttonMask
    };
    setIsPanning(true);
  };

  const findWallActionButton = useCallback((sx, sy) => {
    const buttons = Array.isArray(wallActionButtonsRef.current) ? wallActionButtonsRef.current : [];
    for (const button of buttons) {
      const dx = sx - button.cx;
      const dy = sy - button.cy;
      if (Math.hypot(dx, dy) <= (button.radius + 2)) {
        return button;
      }
    }
    return null;
  }, []);

  const findDefenderActionButton = useCallback((sx, sy) => {
    const buttons = Array.isArray(defenderActionButtonsRef.current) ? defenderActionButtonsRef.current : [];
    for (const button of buttons) {
      const dx = sx - button.cx;
      const dy = sy - button.cy;
      if (Math.hypot(dx, dy) <= (button.radius + 8)) {
        return button;
      }
    }
    return null;
  }, []);

  const handleMouseDown = (event) => {
    if (!open) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;

    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;

    if (event.button === 2) {
      event.preventDefault();
      rotateDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startYaw: cameraYawRef.current,
        moved: false
      };
      setIsRotating(true);
      return;
    }

    if (event.button === 1) {
      startPanDrag(event, point, 4);
      return;
    }

    if (event.button !== 0) return;

    if (spacePressedRef.current) {
      startPanDrag(event, point, 1);
      return;
    }

    if (ghost) {
      const evaluated = evaluateGhostPlacement({ ...ghost, x: world.x, y: world.y }, walls, world, fieldWidth, fieldHeight);
      if (evaluated.blocked) {
        const reasonText = getPlacementReasonText(evaluated.reason) || '当前位置无法放置';
        setMessage(reasonText);
        setGhost(evaluated.ghost);
        setGhostBlocked(true);
        setSnapState(evaluated.snap);
        setInvalidReason(evaluated.reason || '');
        return;
      }
      if (!effectiveCanEdit) {
        setMessage('当前仅可预览，不可编辑战场');
        return;
      }
      const ghostItemId = typeof ghost?.itemId === 'string' ? ghost.itemId : '';
      const ghostItemDef = itemCatalogById.get(ghostItemId) || null;
      const ghostRemaining = itemStockMetaMap.get(ghostItemId)?.remaining ?? 0;
      if (ghost?._mode !== 'move' && ghostRemaining <= 0) {
        setMessage(`物品「${ghostItemDef?.name || ghostItemId || '未知'}」库存不足，无法放置`);
        return;
      }
      const nextWall = createWallFromLike(evaluated.ghost, {
        id: ghost?._sourceId || undefined
      });
      if (ghost?._mode === 'move' && ghost?._sourceId) {
        setWalls((prev) => prev.map((item) => (item.id === ghost._sourceId ? nextWall : item)));
        setHasDraftChanges(true);
        cancelGhostPlacement('');
        setMessage('物品位置已更新');
      } else {
        setWalls((prev) => [...prev, nextWall]);
        setHasDraftChanges(true);
        cancelGhostPlacement('');
        setMessage('物品已放置');
      }
      return;
    }

    if (editMode && effectiveCanEdit) {
      const defenderActionButton = findDefenderActionButton(point.x, point.y);
      if (defenderActionButton) {
        if (defenderActionButton.type === 'move') {
          setActiveDefenderMoveId(defenderActionButton.deployId);
          setSelectedDeploymentId(defenderActionButton.deployId);
          setSelectedWallId('');
          cancelGhostPlacement('');
          setSidebarTab('defender');
          const selectedDeployment = (Array.isArray(defenderDeployments) ? defenderDeployments : [])
            .find((item) => item?.deployId === defenderActionButton.deployId);
          const previewSeed = selectedDeployment
            ? { x: Number(selectedDeployment?.x) || 0, y: Number(selectedDeployment?.y) || 0 }
            : world;
          const nextPreview = resolveDefenderMovePreview(defenderActionButton.deployId, previewSeed);
          setDefenderDragPreview(nextPreview);
          setMessage('移动守军部队：鼠标移动预览，左键确认位置（仅右侧蓝色区域可放置）');
        } else if (defenderActionButton.type === 'remove') {
          unplaceDefenderDeployment(defenderActionButton.deployId);
        }
        return;
      }
    }

    if (editMode && effectiveCanEdit && activeDefenderMoveId) {
      const preview = resolveDefenderMovePreview(activeDefenderMoveId, world);
      if (!preview) {
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        return;
      }
      setDefenderDragPreview(preview);
      if (preview.blocked) {
        setMessage(preview.reason === 'zone' ? '守军仅可放置在右侧蓝色守方区域' : '守军部队点位过近，请稍微错开');
        return;
      }
      const moved = moveDefenderDeployment(activeDefenderMoveId, preview);
      if (moved) {
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
      }
      return;
    }

    if (editMode && effectiveCanEdit) {
      const pickedDeployment = findDeploymentAtWorld(world);
      if (pickedDeployment) {
        setSelectedDeploymentId(pickedDeployment.deployId);
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        setSelectedWallId('');
        cancelGhostPlacement('');
        setSidebarTab('defender');
        const teamName = (typeof pickedDeployment?.name === 'string' && pickedDeployment.name.trim())
          ? pickedDeployment.name.trim()
          : '守军部队';
        setMessage(`已选中守军部队：${teamName}`);
        return;
      }
    }

    if (editMode && effectiveCanEdit) {
      const actionButton = findWallActionButton(point.x, point.y);
      if (actionButton) {
        if (actionButton.type === 'move') {
          const targetWall = walls.find((item) => item.id === actionButton.wallId);
          if (targetWall) startMoveWall(targetWall);
        } else if (actionButton.type === 'remove') {
          recycleWallToPalette(actionButton.wallId);
        }
        return;
      }
      const hasThreeCamera = !!threeRef.current?.camera;
      const pickedWall = pickWallFromScreenPoint(point.x, point.y)
        || (!hasThreeCamera
          ? findTopWallByScreenPoint({
            screenPoint: point,
            walls,
            viewport,
            cameraAngle,
            cameraYaw,
            worldScale
          })
          : null)
        || findTopWallAtPoint(world, walls);
      if (pickedWall) {
        setSelectedWallId(pickedWall.id);
        setSelectedDeploymentId('');
        setSidebarTab('items');
        cancelGhostPlacement('');
        const pickedItemName = itemCatalogById.get(pickedWall.itemId)?.name || '物品';
        setMessage(`已选中${pickedItemName}：点击头顶图标可移动或回收`);
        return;
      }
      if (selectedWallId) {
        setSelectedWallId('');
      }
      if (selectedDeploymentId) {
        setSelectedDeploymentId('');
      }
    }

    startPanDrag(event, point, 1);
  };

  const handleMouseMove = (event) => {
    if (!open) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;

    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;

    if (ghost) {
      if (!panDragRef.current && !rotateDragRef.current) {
        syncGhostByMouse(ghost);
      }
      return;
    }
    if (editMode && effectiveCanEdit && activeDefenderMoveId && !panDragRef.current && !rotateDragRef.current) {
      const preview = resolveDefenderMovePreview(activeDefenderMoveId, world);
      if (preview) {
        setDefenderDragPreview(preview);
      }
      return;
    }
  };

  const handleCanvasDragOver = useCallback((event) => {
    if (!effectiveCanEdit || !editMode || sidebarTab !== 'defender') return;
    event.preventDefault();
    const deployId = event.dataTransfer?.getData('application/x-defender-deploy-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    if (!deployId) {
      setDefenderDragPreview(null);
      return;
    }
    setActiveDefenderMoveId(deployId);
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const world = getWorldFromScreenPoint(sx, sy);
    const nextX = Math.max(-fieldWidth / 2, Math.min(fieldWidth / 2, Number(world?.x) || 0));
    const nextY = Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, Number(world?.y) || 0));
    const blocked = (Number(world?.x) || 0) < defenderZoneMinX;
    setDefenderDragPreview({
      deployId,
      x: nextX,
      y: nextY,
      blocked
    });
  }, [defenderZoneMinX, editMode, effectiveCanEdit, fieldHeight, fieldWidth, getWorldFromScreenPoint, sidebarTab]);

  const handleCanvasDragLeave = useCallback((event) => {
    if (event?.currentTarget !== event?.target) return;
    setDefenderDragPreview(null);
  }, []);

  const handleCanvasDrop = useCallback((event) => {
    if (!effectiveCanEdit || !editMode || sidebarTab !== 'defender') return;
    event.preventDefault();
    const deployId = event.dataTransfer?.getData('application/x-defender-deploy-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    if (!deployId) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const world = getWorldFromScreenPoint(sx, sy);
    setSelectedDeploymentId(deployId);
    moveDefenderDeployment(deployId, world);
    setDefenderDragPreview(null);
  }, [editMode, effectiveCanEdit, getWorldFromScreenPoint, moveDefenderDeployment, sidebarTab]);

  useEffect(() => {
    if (!open) return undefined;
    const handleWindowMouseMove = (event) => {
      const rotateDrag = rotateDragRef.current;
      if (rotateDrag) {
        if ((event.buttons & 2) !== 2) {
          if (!rotateDrag.moved && ghost) {
            cancelGhostPlacement('已取消放置');
          }
          clearRotateDragging();
        } else {
          const dx = event.clientX - rotateDrag.startX;
          const nextYaw = normalizeDeg(rotateDrag.startYaw + (dx * CAMERA_ROTATE_SENSITIVITY));
          if (Math.abs(dx) >= CAMERA_ROTATE_CLICK_THRESHOLD) {
            rotateDrag.moved = true;
          }
          cameraYawRef.current = nextYaw;
          setCameraYaw(nextYaw);
        }
      }

      const drag = panDragRef.current;
      if (!drag) return;
      if ((event.buttons & drag.buttonMask) !== drag.buttonMask) {
        clearPanDragging();
        return;
      }
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return;
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const world = getWorldFromScreenPoint(sx, sy);
      mouseWorldRef.current = world;
      const delta = getPanDeltaFromScreenPoints(
        { x: drag.startScreenX, y: drag.startScreenY },
        { x: sx, y: sy }
      );
      const nextPan = {
        x: drag.startPanX + delta.x,
        y: drag.startPanY + delta.y
      };
      panWorldRef.current = nextPan;
      setPanWorld(nextPan);
    };
    const handleWindowMouseUp = () => {
      const rotateDrag = rotateDragRef.current;
      if (rotateDrag && !rotateDrag.moved && ghost) {
        cancelGhostPlacement('已取消放置');
      }
      clearRotateDragging();
      clearPanDragging();
    };
    const handleWindowBlur = () => {
      clearRotateDragging();
      clearPanDragging();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [cancelGhostPlacement, clearPanDragging, clearRotateDragging, getPanDeltaFromScreenPoints, getWorldFromScreenPoint, ghost, open]);

  const handleWheel = (event) => {
    event.preventDefault();
    if (!ghost) {
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      animateZoomTo((zoomTargetRef.current || zoom) + delta);
      setMessage(`缩放 ${Math.round(zoomTargetRef.current * 100)}%`);
      return;
    }
    if (!effectiveCanEdit) return;

    const lockRotation = snapState?.type === 'top';
    setGhost((prevGhost) => {
      if (!prevGhost) return prevGhost;
      if (lockRotation) {
        const anchor = walls.find((item) => item.id === snapState?.anchorId);
        if (!anchor) return prevGhost;
        return {
          ...prevGhost,
          rotation: anchor.rotation
        };
      }
      const delta = event.deltaY < 0 ? ROTATE_STEP : -ROTATE_STEP;
      return {
        ...prevGhost,
        rotation: normalizeDeg(prevGhost.rotation + delta)
      };
    });
  };

  useEffect(() => {
    if (!ghost) return;
    syncGhostByMouse(ghost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldHeight, fieldWidth, ghost?.rotation, walls, cameraAngle, cameraYaw]);

  const selectedDefenderDeployment = defenderDeploymentRows.find((item) => item.deployId === selectedDeploymentId) || null;

  if (!open) return null;

  return (
    <div
      className="battlefield-modal-overlay"
      onClick={onClose}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onPointerMoveCapture={(event) => event.stopPropagation()}
      onPointerUpCapture={(event) => event.stopPropagation()}
    >
      <div
        className="battlefield-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <div className="battlefield-modal-header">
          <div className="battlefield-modal-title">
            <strong>{gateLabel ? `${gateLabel} 战场预览` : '战场预览'}</strong>
            <span>{loadingLayout ? '正在加载战场配置...' : 'RTS 俯视战场：右键按住旋转视角，Space+左键或中键平移，滚轮缩放/旋转'}</span>
          </div>
          <div className="battlefield-modal-actions">
            {!effectiveCanEdit && (
              <button type="button" className="btn btn-small btn-secondary" disabled>
                仅预览
              </button>
            )}
            {effectiveCanEdit && !editMode && (
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={loadingLayout || savingLayout}
                onClick={startLayoutEditing}
              >
                布置战场
              </button>
            )}
            {effectiveCanEdit && editMode && (
              <>
                <button
                  type="button"
                  className="btn btn-small btn-warning"
                  disabled={savingLayout}
                  onClick={cancelLayoutEditing}
                >
                  取消布置
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={savingLayout || loadingLayout}
                  onClick={saveLayoutEditing}
                >
                  保存布置
                </button>
              </>
            )}
            <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="battlefield-toolbar">
          <span>{`已放置物品 ${walls.length}`}</span>
          <span>{`库存总计 ${totalItemRemaining}/${totalItemLimit}`}</span>
          <span>{`守军布置 ${totalDefenderPlaced}`}</span>
          <span>{`堆叠上限 ${MAX_STACK_LEVEL} 层`}</span>
          <span>{editMode && hasDraftChanges ? '布置中：有未保存改动' : (cacheNeedsSync ? '离线缓存待同步' : '已与服务端同步')}</span>
          <span>{savingLayout ? '保存中...' : '群组数值显示: 血量 / 防御'}</span>
        </div>

        <div className="battlefield-main">
          {defenderEditorOpen && (
            <div className="battlefield-defender-editor" onClick={(event) => event.stopPropagation()}>
              <div className="battlefield-defender-editor-head">
                <strong>新建守城部队</strong>
                <div className="battlefield-sidebar-row">
                  <button type="button" className="btn btn-small btn-secondary" onClick={closeDefenderEditor}>关闭</button>
                  <button
                    type="button"
                    className="btn btn-small btn-warning"
                    onClick={saveDefenderEditor}
                    disabled={!effectiveCanEdit || defenderEditorTotalCount <= 0}
                  >
                    确定编组
                  </button>
                </div>
              </div>
              <div className="battlefield-defender-editor-grid">
                <label>
                  部队名称
                  <input
                    type="text"
                    maxLength={32}
                    value={defenderEditorDraft.name || ''}
                    placeholder="不填则自动命名"
                    onChange={(event) => {
                      const value = typeof event.target.value === 'string' ? event.target.value : '';
                      setDefenderEditorDraft((prev) => ({ ...prev, name: value }));
                    }}
                  />
                </label>
                <label>
                  排序
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={Math.max(1, Math.floor(Number(defenderEditorDraft.sortOrder) || 1))}
                    onChange={(event) => {
                      const raw = Math.max(1, Math.floor(Number(event.target.value) || 1));
                      setDefenderEditorDraft((prev) => ({ ...prev, sortOrder: raw }));
                    }}
                  />
                </label>
              </div>
              <div className="battlefield-defender-editor-transfer">
                <div className="battlefield-defender-editor-col">
                  <div className="battlefield-defender-editor-col-title">可用兵种（左侧）</div>
                  {defenderEditorAvailableRows.map((item) => (
                    <button
                      key={`def-editor-left-${item.unitTypeId}`}
                      type="button"
                      className="battlefield-item-card"
                      draggable={effectiveCanEdit && item.available > 0}
                      disabled={item.available <= 0}
                      onDragStart={(event) => {
                        event.dataTransfer?.setData('application/x-defender-unit-id', item.unitTypeId);
                        event.dataTransfer?.setData('text/plain', item.unitTypeId);
                      }}
                      onClick={() => openDefenderQuantityDialog(item.unitTypeId)}
                    >
                      <strong>{item.unitName || item.unitTypeId}</strong>
                      <span>{`可用 ${item.available}`}</span>
                    </button>
                  ))}
                </div>
                <div
                  className="battlefield-defender-editor-col is-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-defender-unit-id')
                      || event.dataTransfer?.getData('text/plain')
                      || '';
                    openDefenderQuantityDialog(droppedUnitTypeId);
                  }}
                >
                  <div className="battlefield-defender-editor-col-title">部队编组（右侧）</div>
                  {normalizeDefenderUnits(defenderEditorDraft?.units || []).length <= 0 && (
                    <div className="battlefield-sidebar-tip">拖拽左侧兵种到这里后，会弹出数量输入框。</div>
                  )}
                  {normalizeDefenderUnits(defenderEditorDraft?.units || []).map((entry) => (
                    <div key={`def-editor-right-${entry.unitTypeId}`} className="battlefield-sidebar-meta-row">
                      <span>{`${defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`}</span>
                      <div className="battlefield-sidebar-row">
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => openDefenderQuantityDialog(entry.unitTypeId)}
                        >
                          数量
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-warning"
                          onClick={() => removeDraftUnit(entry.unitTypeId)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="battlefield-defender-editor-tip">
                {`总兵力 ${defenderEditorTotalCount}。确定后会生成一个守军部队卡片，拖到战场右侧蓝区可部署；若要改编制请先删除已部署部队再重建。`}
              </div>
            </div>
          )}

          <aside className="battlefield-sidebar">
            <div className="battlefield-sidebar-tabs">
              <button
                type="button"
                className={`battlefield-sidebar-tab ${sidebarTab === 'items' ? 'active' : ''}`}
                onClick={() => setSidebarTab('items')}
              >
                物品
              </button>
              <button
                type="button"
                className={`battlefield-sidebar-tab ${sidebarTab === 'defender' ? 'active' : ''}`}
                onClick={() => setSidebarTab('defender')}
              >
                守军部队
              </button>
            </div>

            <div className="battlefield-sidebar-content">
              {sidebarTab === 'items' && (
                <>
                  <div className="battlefield-sidebar-title">战场物品</div>
                  {normalizedItemCatalog.length === 0 && (
                    <div className="battlefield-sidebar-tip">暂无可用战场物品，请先在管理员面板配置物品目录。</div>
                  )}
                  {normalizedItemCatalog.map((item) => {
                    const stockMeta = itemStockMetaMap.get(item.itemId) || { used: 0, limit: 0, remaining: 0 };
                    return (
                      <button
                        key={item.itemId}
                        type="button"
                        className={`battlefield-item-card ${selectedPaletteItem === item.itemId && ghost ? 'selected' : ''}`}
                        disabled={!effectiveCanEdit || !editMode || stockMeta.remaining <= 0}
                        onClick={() => pickPaletteItem(item.itemId)}
                      >
                        <strong>{item.name || item.itemId}</strong>
                        <span>{`库存 ${stockMeta.remaining}/${stockMeta.limit}`}</span>
                        <span>{`属性 ${item.hp} / ${roundTo(item.defense, 2)}`}</span>
                      </button>
                    );
                  })}
                  <div className="battlefield-sidebar-tip">
                    {!effectiveCanEdit
                      ? '当前仅预览'
                      : (!editMode ? '点击“布置战场”后可选择物品' : '点已放置物品会出现“移动/回收(X)”图标；点选物品后左键放置')}
                  </div>
                </>
              )}

              {sidebarTab === 'defender' && (
                <>
                  <div className="battlefield-sidebar-row">
                    <div className="battlefield-sidebar-title">守军部队</div>
                    <button
                      type="button"
                      className="btn btn-small btn-secondary"
                      disabled={!effectiveCanEdit || defenderStockRows.length <= 0}
                      onClick={openDefenderEditor}
                    >
                      新建部队
                    </button>
                  </div>
                  {defenderDeploymentRows.length === 0 && (
                    <div className="battlefield-sidebar-tip">当前未创建守军部队，请先点击“新建部队”。</div>
                  )}
                  {defenderDeploymentRows.map((item) => (
                    <button
                      key={`def-deploy-${item.deployId}`}
                      type="button"
                      className={`battlefield-item-card ${selectedDeploymentId === item.deployId ? 'selected' : ''}`}
                      draggable={effectiveCanEdit && editMode}
                      onDragStart={(event) => {
                        event.dataTransfer?.setData('application/x-defender-deploy-id', item.deployId);
                        event.dataTransfer?.setData('text/plain', item.deployId);
                        setDefenderDragPreview({
                          deployId: item.deployId,
                          x: Number(item?.x) || 0,
                          y: Number(item?.y) || 0,
                          blocked: false
                        });
                      }}
                      onDragEnd={() => {
                        setDefenderDragPreview(null);
                        setActiveDefenderMoveId('');
                      }}
                      onClick={() => {
                        setSelectedDeploymentId(item.deployId);
                        setActiveDefenderMoveId('');
                        setSelectedWallId('');
                        cancelGhostPlacement('');
                        setMessage(
                          editMode
                            ? (
                              item.placed !== false
                                ? `已选中守军部队：${item.teamName}，可拖拽到右侧蓝色区域部署/重定位`
                                : `已选中守军部队：${item.teamName}（未部署），可拖拽到右侧蓝色区域部署`
                            )
                            : `已选中守军部队：${item.teamName}。请先点击“布置战场”再进行部署`
                        );
                      }}
                    >
                      <strong>{`${item.teamName} · #${item.sortOrder}`}</strong>
                      <span>{`总兵力 ${item.totalCount}`}</span>
                      <span>{item.unitSummary || '未配置兵种'}</span>
                      <span>{item.placed !== false ? '状态 已部署' : '状态 未部署'}</span>
                      <span>{item.placed !== false ? `坐标 (${Math.round(item.x)}, ${Math.round(item.y)})` : '坐标 -'}</span>
                    </button>
                  ))}

                  <div className="battlefield-sidebar-meta">
                    {defenderStockRows.map((item) => (
                      <div key={`def-stock-${item.unitTypeId}`} className="battlefield-sidebar-meta-row">
                        <span>{item.unitName || item.unitTypeId}</span>
                        <em>{`${item.used}/${item.count}`}</em>
                      </div>
                    ))}
                  </div>

                  <div className="battlefield-sidebar-tip">
                    {selectedDefenderDeployment
                      ? (
                        editMode
                          ? (
                            selectedDefenderDeployment.placed !== false
                              ? `已选中：${selectedDefenderDeployment.teamName}（#${selectedDefenderDeployment.sortOrder}）。可拖卡片到地图或在右侧蓝色区域点击重定位。`
                              : `已选中：${selectedDefenderDeployment.teamName}（未部署）。拖到地图或在右侧蓝色区域点击即可部署。`
                          )
                          : `已选中：${selectedDefenderDeployment.teamName}。请先点击“布置战场”后再部署到地图。`
                      )
                      : (editMode ? '先新建守军部队，再把部队卡片拖到右侧蓝色守方区域部署' : '先新建守军部队；进入“布置战场”后可拖拽部署')}
                  </div>
                  {selectedDefenderDeployment && (
                    <div className="battlefield-sidebar-row">
                      <button
                        type="button"
                        className="btn btn-small btn-warning"
                        disabled={!effectiveCanEdit}
                        onClick={() => removeDefenderDeployment(selectedDefenderDeployment.deployId)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>

          <div className="battlefield-canvas-wrap" ref={wrapperRef}>
            <canvas
              ref={sceneCanvasRef}
              className="battlefield-scene-canvas"
            />
            <canvas
              ref={canvasRef}
              className={`battlefield-canvas battlefield-overlay-canvas ${isPanning ? 'is-panning' : ''} ${isRotating ? 'is-rotating' : ''}`}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onDragOver={handleCanvasDragOver}
              onDragLeave={handleCanvasDragLeave}
              onDrop={handleCanvasDrop}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={clearPanDragging}
              onMouseLeave={clearPanDragging}
              onWheel={handleWheel}
            />
          </div>
        </div>

        <div className="battlefield-footer">
          <span>{errorText || message || getPlacementReasonText(invalidReason) || '提示: 右键按住并拖动可旋转战场；右键点击可取消放置；Space+左键或中键平移；滚轮缩放/旋转'}</span>
        </div>
        <NumberPadDialog
          open={defenderQuantityDialog.open}
          title={`设置兵力：${defenderQuantityDialog.unitName || defenderQuantityDialog.unitTypeId}`}
          description="可滑动或直接输入数量"
          min={1}
          max={Math.max(1, Math.floor(Number(defenderQuantityDialog.max) || 1))}
          initialValue={Math.max(1, Math.floor(Number(defenderQuantityDialog.current) || 1))}
          confirmLabel="确定"
          cancelLabel="取消"
          onCancel={() => setDefenderQuantityDialog((prev) => ({ ...prev, open: false }))}
          onConfirm={confirmDefenderQuantityDialog}
        />
      </div>
    </div>
  );
};

export default BattlefieldPreviewModal;
