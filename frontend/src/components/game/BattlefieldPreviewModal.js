import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import NumberPadDialog from '../common/NumberPadDialog';
import './BattlefieldPreviewModal.css';
import {
  createFormationVisualState,
  reconcileCounts,
  renderFormation,
  getFormationFootprint
} from '../../game/formation/ArmyFormationRenderer';
import { BACKEND_ORIGIN } from '../../runtimeConfig';
import {
  getItemGeometry,
  buildWorldColliderParts,
  collidersOverlap2D,
  pointInsideCollider2D,
  getSocketWorldPose,
  resolveBattleLayerColors
} from '../../game/battlefield/items/itemGeometryRegistry';

const CAMERA_ANGLE_PREVIEW = 45;
const CAMERA_ANGLE_EDIT = 45;
const CAMERA_YAW_DEFAULT = 0;
const CAMERA_TWEEN_MS = 260;
const CAMERA_ROTATE_SENSITIVITY = 0.38;
const CAMERA_ROTATE_CLICK_THRESHOLD = 4;
const FIELD_WIDTH = 900;
const FIELD_HEIGHT = 620;
const MAX_STACK_LEVEL = 31;
const BASE_DEFENSE = 1.1;
const BASE_HP = 240;
const WALL_WIDTH = 104;
const WALL_DEPTH = 24;
const WALL_HEIGHT = 42;
const STACK_LAYER_HEIGHT = WALL_HEIGHT;
const ROTATE_STEP = 7.5;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;
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
const API_BASE = BACKEND_ORIGIN;
const DEFAULT_MAX_ITEMS_PER_TYPE = 10;
const SNAP_EPSILON = 1.2;
const CACHE_VERSION = 2;
const CACHE_PREFIX = 'battlefield_layout_cache_v2';
const DEFENDER_SOLDIER_VISUAL_SCALE = 3.52;
const DEFENDER_FORMATION_METRIC_BUDGET = 48;
const DEFENDER_DEFAULT_FACING_DEG = 90;
const DEFENDER_OVERLAP_RATIO = 0.82;
const DEFENDER_OVERLAP_ALLOWANCE = 4;
const PALETTE_WALL_TEMPLATE = {
  itemId: '',
  width: WALL_WIDTH,
  depth: WALL_DEPTH,
  height: WALL_HEIGHT,
  hp: BASE_HP,
  defense: BASE_DEFENSE
};

let bushBladeTexture = null;
const getBushBladeTexture = () => {
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

const resolveFormationBudgetByZoom = (zoomValue) => {
  const minZoom = Math.max(0.01, MIN_ZOOM);
  const maxZoom = Math.max(minZoom + 0.01, MAX_ZOOM);
  const safeZoom = Math.max(minZoom, Math.min(maxZoom, Number(zoomValue) || DEFAULT_ZOOM));
  const t = (safeZoom - minZoom) / (maxZoom - minZoom);
  // Keep zoom binding but avoid extreme soldier-count swings.
  const eased = Math.sqrt(Math.max(0, Math.min(1, t)));
  return Math.max(32, Math.min(56, Math.round(32 + (eased * 24))));
};

const resolveDefenderFootprintScaleByCount = (totalUnits) => {
  const safeTotal = Math.max(1, Math.floor(Number(totalUnits) || 0));
  const soldierEquivalent = safeTotal / 10;
  const scale = 0.9 + (Math.log10(soldierEquivalent + 1) * 0.55);
  return Math.max(0.9, Math.min(2.4, scale));
};

const parseHexColor = (value, fallback = 0xffffff) => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return Number.parseInt(text, 16);
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
  Math.max(0, Math.floor(Number(wall?.z) || 0))
  * Math.max(10, Number(wall?.height) || STACK_LAYER_HEIGHT)
);

const getWallTopZ = (wall = {}) => (
  getWallBaseZ(wall) + Math.max(10, Number(wall?.height) || WALL_HEIGHT)
);

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
  defense: Math.max(0.1, Number(overrides.defense ?? wallLike.defense ?? BASE_DEFENSE) || BASE_DEFENSE),
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
      z: Math.max(0, Math.min(MAX_STACK_LEVEL - 1, Math.floor(Number(item?.z) || 0))),
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

const normalizeDefenderFacingDeg = (value) => {
  const maybe = Number(value);
  if (!Number.isFinite(maybe)) return DEFENDER_DEFAULT_FACING_DEG;
  return normalizeDeg(maybe);
};

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
      attach: item?.attach && typeof item.attach === 'object' ? item.attach : null,
      groupId: typeof item?.groupId === 'string' ? item.groupId : '',
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
    z: Math.max(0, Math.floor(Number(item.z) || 0)),
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
    y: viewport.centerY + viewport.panY - (viewY * worldScale),
    depth
  };
};

const unprojectScreen = (sx, sy, viewport, tiltDeg, yawDeg, worldScale) => {
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

const normalizeSnapFaceSide = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'right' || raw === 'left' || raw === 'front' || raw === 'back') return raw;
  return '';
};

const inferSnapFaceFromSocketId = (socketId) => {
  const raw = typeof socketId === 'string' ? socketId.trim().toLowerCase() : '';
  if (!raw) return '';
  if (raw.includes('right')) return 'right';
  if (raw.includes('left')) return 'left';
  if (raw.includes('front')) return 'front';
  if (raw.includes('back')) return 'back';
  if (raw.includes('top')) return 'top';
  return '';
};

const resolveSocketSnapFace = (anchor = {}, snapState = {}, itemCatalogById = new Map()) => {
  const byId = inferSnapFaceFromSocketId(snapState?.parentSocketId);
  if (byId) return byId;
  const itemDef = resolveWallItemDef(anchor, itemCatalogById);
  const sockets = Array.isArray(getItemGeometry(itemDef)?.sockets) ? getItemGeometry(itemDef).sockets : [];
  const socketId = typeof snapState?.parentSocketId === 'string' ? snapState.parentSocketId : '';
  const parentSocket = sockets.find((entry) => (entry?.socketId || '') === socketId);
  const local = parentSocket?.localPose && typeof parentSocket.localPose === 'object' ? parentSocket.localPose : null;
  if (!local) return '';
  const lx = Number(local?.x) || 0;
  const ly = Number(local?.y) || 0;
  const lz = Number(local?.z) || 0;
  const anchorHeight = Math.max(10, Number(anchor?.height) || WALL_HEIGHT);
  if (Math.abs(lz) >= (anchorHeight * 0.42) && Math.abs(lx) < 1 && Math.abs(ly) < 1) return 'top';
  if (Math.abs(lx) >= Math.abs(ly)) return lx >= 0 ? 'right' : 'left';
  return ly >= 0 ? 'front' : 'back';
};

const buildSnapFaceQuadPoints = ({
  centerX = 0,
  centerY = 0,
  width = WALL_WIDTH,
  depth = WALL_DEPTH,
  rotationDeg = 0,
  baseZ = 0,
  topZ = WALL_HEIGHT,
  side = ''
}) => {
  const faceSide = normalizeSnapFaceSide(side);
  if (!faceSide) return [];
  const halfW = Math.max(1, Number(width) || WALL_WIDTH) * 0.5;
  const halfD = Math.max(1, Number(depth) || WALL_DEPTH) * 0.5;
  const widthAxis = rotate2D(1, 0, rotationDeg);
  const depthAxis = rotate2D(0, 1, rotationDeg);
  const useWidthNormal = faceSide === 'right' || faceSide === 'left';
  const normalSign = (faceSide === 'right' || faceSide === 'front') ? 1 : -1;
  const normalAxis = useWidthNormal ? widthAxis : depthAxis;
  const tangentAxis = useWidthNormal ? depthAxis : widthAxis;
  const halfAlongNormal = useWidthNormal ? halfW : halfD;
  const halfAlongTangent = useWidthNormal ? halfD : halfW;
  const faceCenter = {
    x: centerX + (normalAxis.x * halfAlongNormal * normalSign),
    y: centerY + (normalAxis.y * halfAlongNormal * normalSign)
  };
  const minZ = Math.min(baseZ, topZ);
  const maxZ = Math.max(baseZ, topZ);
  return [
    {
      x: faceCenter.x - (tangentAxis.x * halfAlongTangent),
      y: faceCenter.y - (tangentAxis.y * halfAlongTangent),
      z: minZ
    },
    {
      x: faceCenter.x + (tangentAxis.x * halfAlongTangent),
      y: faceCenter.y + (tangentAxis.y * halfAlongTangent),
      z: minZ
    },
    {
      x: faceCenter.x + (tangentAxis.x * halfAlongTangent),
      y: faceCenter.y + (tangentAxis.y * halfAlongTangent),
      z: maxZ
    },
    {
      x: faceCenter.x - (tangentAxis.x * halfAlongTangent),
      y: faceCenter.y - (tangentAxis.y * halfAlongTangent),
      z: maxZ
    }
  ];
};

const resolveSnapHighlightFacePoints = (anchor = {}, snapState = null, itemCatalogById = new Map()) => {
  if (!anchor || !snapState || typeof snapState !== 'object') return null;
  const type = typeof snapState?.type === 'string' ? snapState.type : '';
  const baseZ = getWallBaseZ(anchor);
  const topZ = getWallTopZ(anchor) + 0.8;
  if (type === 'top') {
    const topPoints = getRectCorners(anchor.x, anchor.y, anchor.width, anchor.depth, anchor.rotation)
      .map((point) => ({ x: point.x, y: point.y, z: topZ }));
    return topPoints.length === 4 ? { points: topPoints, kind: 'top' } : null;
  }

  let side = '';
  if (type.startsWith('side-')) {
    side = normalizeSnapFaceSide(type.slice(5));
  } else if (type === 'pillar-face') {
    side = normalizeSnapFaceSide(snapState?.face);
    if (side) {
      const itemDef = resolveWallItemDef(anchor, itemCatalogById);
      const parts = Array.isArray(getItemGeometry(itemDef)?.collider?.parts) ? getItemGeometry(itemDef).collider.parts : [];
      const protrusionIndex = Number.isFinite(Number(snapState?.protrusion))
        ? Math.floor(Number(snapState.protrusion))
        : -1;
      if (protrusionIndex >= 0 && protrusionIndex < parts.length) {
        const part = parts[protrusionIndex] || {};
        const rotatedOffset = rotate2D(Number(part?.cx) || 0, Number(part?.cy) || 0, Number(anchor?.rotation) || 0);
        const partCenterX = (Number(anchor?.x) || 0) + rotatedOffset.x;
        const partCenterY = (Number(anchor?.y) || 0) + rotatedOffset.y;
        const partYaw = normalizeDeg((Number(anchor?.rotation) || 0) + (Number(part?.yawDeg) || 0));
        const partHeight = Math.max(1, Number(part?.h) || Number(anchor?.height) || WALL_HEIGHT);
        const partCenterZ = baseZ + (Number(part?.cz) || (partHeight * 0.5));
        const partBaseZ = partCenterZ - (partHeight * 0.5);
        const partTopZ = partCenterZ + (partHeight * 0.5);
        const partPoints = buildSnapFaceQuadPoints({
          centerX: partCenterX,
          centerY: partCenterY,
          width: Math.max(1, Number(part?.w) || Number(anchor?.width) || WALL_WIDTH),
          depth: Math.max(1, Number(part?.d) || Number(anchor?.depth) || WALL_DEPTH),
          rotationDeg: partYaw,
          baseZ: partBaseZ,
          topZ: partTopZ,
          side
        });
        if (partPoints.length === 4) return { points: partPoints, kind: 'side' };
      }
    }
  } else if (type === 'socket') {
    const socketFace = resolveSocketSnapFace(anchor, snapState, itemCatalogById);
    if (socketFace === 'top') {
      const topPoints = getRectCorners(anchor.x, anchor.y, anchor.width, anchor.depth, anchor.rotation)
        .map((point) => ({ x: point.x, y: point.y, z: topZ }));
      return topPoints.length === 4 ? { points: topPoints, kind: 'top' } : null;
    }
    side = normalizeSnapFaceSide(socketFace);
  }

  if (!side) return null;
  const sidePoints = buildSnapFaceQuadPoints({
    centerX: Number(anchor?.x) || 0,
    centerY: Number(anchor?.y) || 0,
    width: Math.max(1, Number(anchor?.width) || WALL_WIDTH),
    depth: Math.max(1, Number(anchor?.depth) || WALL_DEPTH),
    rotationDeg: Number(anchor?.rotation) || 0,
    baseZ,
    topZ: getWallTopZ(anchor),
    side
  });
  return sidePoints.length === 4 ? { points: sidePoints, kind: 'side' } : null;
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

const resolveWallItemDef = (wall = {}, itemCatalogById = new Map()) => {
  const itemId = typeof wall?.itemId === 'string' ? wall.itemId.trim() : '';
  const fromCatalog = itemId && itemCatalogById instanceof Map ? itemCatalogById.get(itemId) : null;
  if (fromCatalog) return fromCatalog;
  return {
    itemId,
    width: Math.max(12, Number(wall?.width) || WALL_WIDTH),
    depth: Math.max(12, Number(wall?.depth) || WALL_DEPTH),
    height: Math.max(10, Number(wall?.height) || WALL_HEIGHT),
    collider: null,
    sockets: [],
    maxStack: null
  };
};

const resolveItemStackLimit = (itemDef = null) => {
  if (Number.isFinite(Number(itemDef?.maxStack))) {
    return Math.max(1, Math.min(31, Math.floor(Number(itemDef.maxStack))));
  }
  return MAX_STACK_LEVEL;
};

const isWoodPillarItem = (itemDef = {}) => {
  const itemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  const shape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  return itemId === 'it_build_wood_pillar' || shape === 'pillar';
};

const isWoodPlankItem = (itemDef = {}) => {
  const itemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  const shape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  return itemId === 'it_build_wood_plank' || shape === 'plank';
};

const isBushItem = (itemDef = {}) => {
  const itemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  const shape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  const meshId = typeof itemDef?.renderProfile?.battle?.meshId === 'string'
    ? itemDef.renderProfile.battle.meshId.trim().toLowerCase()
    : '';
  return itemId === 'it_terrain_bush' || shape === 'bush' || meshId.includes('bush');
};

const deriveItemIdentityTags = (itemDef = {}) => {
  const tags = new Set();
  const rawItemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  if (rawItemId) {
    tags.add(rawItemId);
    rawItemId
      .split('_')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => tags.add(part));
    const core = rawItemId
      .replace(/^it_/, '')
      .replace(/^(build|cover|terrain|trap|hazard|support)_/, '');
    if (core) tags.add(core);
  }
  const styleShape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  if (styleShape) tags.add(styleShape);
  return tags;
};

const getItemLocalMinZ = (itemDef = null) => {
  const parts = getItemGeometry(itemDef || {}).collider?.parts || [];
  if (!Array.isArray(parts) || parts.length <= 0) return 0;
  let minZ = Infinity;
  parts.forEach((part) => {
    const cz = Number(part?.cz) || 0;
    const h = Math.max(1, Number(part?.h) || 1);
    minZ = Math.min(minZ, cz - (h * 0.5));
  });
  return Number.isFinite(minZ) ? minZ : 0;
};

const getItemLocalZBounds = (itemDef = null) => {
  const parts = getItemGeometry(itemDef || {}).collider?.parts || [];
  if (!Array.isArray(parts) || parts.length <= 0) {
    const h = Math.max(1, Number(itemDef?.height) || WALL_HEIGHT);
    return {
      minZ: 0,
      maxZ: h,
      centerZ: h * 0.5
    };
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  parts.forEach((part) => {
    const cz = Number(part?.cz) || 0;
    const h = Math.max(1, Number(part?.h) || 1);
    minZ = Math.min(minZ, cz - (h * 0.5));
    maxZ = Math.max(maxZ, cz + (h * 0.5));
  });
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    const h = Math.max(1, Number(itemDef?.height) || WALL_HEIGHT);
    return {
      minZ: 0,
      maxZ: h,
      centerZ: h * 0.5
    };
  }
  return {
    minZ,
    maxZ,
    centerZ: (minZ + maxZ) * 0.5
  };
};

const pointInWallFootprint = (point, wall, itemCatalogById = new Map(), padding = 0) => {
  const itemDef = resolveWallItemDef(wall, itemCatalogById);
  return pointInsideCollider2D(
    { x: Number(point?.x) || 0, y: Number(point?.y) || 0 },
    wall,
    itemDef,
    padding
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

const getWallFootprintCorners = (wallLike = {}, itemCatalogById = new Map()) => {
  const itemDef = resolveWallItemDef(wallLike, itemCatalogById);
  const geometry = getItemGeometry(itemDef);
  if (geometry?.collider?.kind === 'polygon') {
    const points = Array.isArray(geometry?.collider?.polygon?.points) ? geometry.collider.polygon.points : [];
    return points.map((point) => {
      const rotated = rotate2D(Number(point?.x) || 0, Number(point?.y) || 0, Number(wallLike?.rotation) || 0);
      return {
        x: (Number(wallLike?.x) || 0) + rotated.x,
        y: (Number(wallLike?.y) || 0) + rotated.y
      };
    });
  }
  const parts = Array.isArray(geometry?.collider?.parts) ? geometry.collider.parts : [{
    cx: 0,
    cy: 0,
    w: Number(wallLike?.width) || WALL_WIDTH,
    d: Number(wallLike?.depth) || WALL_DEPTH,
    yawDeg: 0
  }];
  const out = [];
  parts.forEach((part) => {
    const hw = Math.max(1, Number(part?.w) || 1) * 0.5;
    const hd = Math.max(1, Number(part?.d) || 1) * 0.5;
    const localCorners = [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd }
    ];
    localCorners.forEach((corner) => {
      const rotatedPart = rotate2D(corner.x, corner.y, Number(part?.yawDeg) || 0);
      const local = {
        x: (Number(part?.cx) || 0) + rotatedPart.x,
        y: (Number(part?.cy) || 0) + rotatedPart.y
      };
      const rotatedWall = rotate2D(local.x, local.y, Number(wallLike?.rotation) || 0);
      out.push({
        x: (Number(wallLike?.x) || 0) + rotatedWall.x,
        y: (Number(wallLike?.y) || 0) + rotatedWall.y
      });
    });
  });
  return out;
};

const angleDistanceDeg = (a, b) => {
  const da = normalizeDeg(a);
  const db = normalizeDeg(b);
  const diff = Math.abs(da - db);
  return Math.min(diff, 360 - diff);
};

const clampGhostInsideField = (ghostLike, fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT, itemCatalogById = new Map()) => {
  const next = { ...ghostLike };
  const corners = getWallFootprintCorners(next, itemCatalogById);
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

const isOutOfBounds = (ghostLike, fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT, itemCatalogById = new Map()) => {
  const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
  const corners = getWallFootprintCorners(ghostLike, itemCatalogById);
  return corners.some((point) => (
    point.x < (-safeFieldWidth / 2) - SNAP_EPSILON
    || point.x > (safeFieldWidth / 2) + SNAP_EPSILON
    || point.y < (-safeFieldHeight / 2) - SNAP_EPSILON
    || point.y > (safeFieldHeight / 2) + SNAP_EPSILON
  ));
};

const overlapsDeployZone = (ghostLike, fieldWidth = FIELD_WIDTH, itemCatalogById = new Map()) => {
  const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const zoneWidth = Math.max(0, safeFieldWidth * DEPLOY_ZONE_RATIO);
  if (zoneWidth <= 0.001) return false;
  const corners = getWallFootprintCorners(ghostLike, itemCatalogById);
  if (!Array.isArray(corners) || corners.length <= 0) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  corners.forEach((point) => {
    minX = Math.min(minX, Number(point?.x) || 0);
    maxX = Math.max(maxX, Number(point?.x) || 0);
  });
  const fieldMinX = -safeFieldWidth * 0.5;
  const fieldMaxX = safeFieldWidth * 0.5;
  const leftZoneMinX = fieldMinX;
  const leftZoneMaxX = fieldMinX + zoneWidth;
  const rightZoneMinX = fieldMaxX - zoneWidth;
  const rightZoneMaxX = fieldMaxX;
  const overlapLen = (aMin, aMax, bMin, bMax) => Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return (
    overlapLen(minX, maxX, leftZoneMinX, leftZoneMaxX) > 0.01
    || overlapLen(minX, maxX, rightZoneMinX, rightZoneMaxX) > 0.01
  );
};

const hasCollision = (ghostLike, walls = [], itemCatalogById = new Map(), ignoreIds = []) => {
  const ghostItemDef = resolveWallItemDef(ghostLike, itemCatalogById);
  const ignoreSet = new Set((Array.isArray(ignoreIds) ? ignoreIds : []).filter(Boolean));
  for (const wall of walls) {
    if (ignoreSet.has(wall?.id)) continue;
    if (wall.id === ghostLike.id) continue;
    if (wall.z !== ghostLike.z) continue;
    const wallItemDef = resolveWallItemDef(wall, itemCatalogById);
    if (collidersOverlap2D(ghostLike, ghostItemDef, wall, wallItemDef, 0.12)) return true;
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
  if (reason === 'stack_limit') return '该设置物已达到堆叠上限';
  if (reason === 'support_required') return '该设置物需要吸附在支撑物上';
  if (reason === 'collision') return '当前位置发生碰撞，无法放置';
  if (reason === 'out_of_bounds') return '当前位置超出战场边界';
  if (reason === 'deploy_zone_blocked') return '当前位置位于红蓝部署区，无法放置设置物';
  return '';
};

const getInteractionKindLabel = (kind = '') => {
  const key = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (key === 'concealment') return '隐匿';
  if (key === 'cover') return '掩体';
  if (key === 'trap') return '陷阱';
  if (key === 'buff') return '增益';
  if (key === 'debuff') return '减益';
  if (key === 'healing') return '治疗';
  return key || '未知';
};

const areSocketCompatible = (parentSocket = {}, childSocket = {}, parentItemDef = null, childItemDef = null) => {
  const parentTags = (Array.isArray(parentSocket?.compatibleTags) ? parentSocket.compatibleTags : [])
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .map((tag) => tag.toLowerCase())
    .filter(Boolean);
  const childTags = (Array.isArray(childSocket?.compatibleTags) ? childSocket.compatibleTags : [])
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .map((tag) => tag.toLowerCase())
    .filter(Boolean);
  if (parentTags.length <= 0 && childTags.length <= 0) return true;
  const parentTagSet = new Set(parentTags);
  const childTagSet = new Set(childTags);
  const parentIdentity = deriveItemIdentityTags(parentItemDef || {});
  const childIdentity = deriveItemIdentityTags(childItemDef || {});
  if (parentTags.length > 0 && childIdentity.size > 0) {
    for (const tag of childIdentity) {
      if (parentTagSet.has(tag)) return true;
    }
  }
  if (childTags.length > 0 && parentIdentity.size > 0) {
    for (const tag of parentIdentity) {
      if (childTagSet.has(tag)) return true;
    }
  }
  if (parentTags.length <= 0 || childTags.length <= 0) return true;
  return parentTags.some((tag) => childTags.includes(tag));
};

const dotAxis = (a = {}, b = {}) => (
  ((Number(a?.x) || 0) * (Number(b?.x) || 0))
  + ((Number(a?.y) || 0) * (Number(b?.y) || 0))
);

const getHintAnchorId = (mouseHint = null) => {
  if (!mouseHint || typeof mouseHint !== 'object') return '';
  const anchorId = typeof mouseHint?.anchorId === 'string' ? mouseHint.anchorId.trim() : '';
  return anchorId;
};

const solvePillarPlankFaceSnap = ({
  ghostBase,
  ghostItemDef,
  walls = [],
  itemCatalogById = new Map(),
  mouseWorld = null,
  mouseHint = null,
  ignoreAnchorIds = [],
  fieldWidth,
  fieldHeight
}) => {
  if (!isWoodPlankItem(ghostItemDef) || !mouseWorld) return null;
  if (!mouseHint || typeof mouseHint !== 'object' || typeof mouseHint?.anchorId !== 'string' || !mouseHint.anchorId) {
    return null;
  }
  const mode = ghostBase?._pillarSnapMode === 'short' ? 'short' : 'long';
  const ghostLayerHeight = Math.max(
    1,
    Number(ghostBase?.height) || Number(ghostItemDef?.height) || STACK_LAYER_HEIGHT
  );
  const ghostStackLimit = resolveItemStackLimit(ghostItemDef);
  const ghostZBounds = getItemLocalZBounds(ghostItemDef);
  const protrusionFaceDefs = [
    { side: 'right', localNormal: { x: 1, y: 0 }, localTangent: { x: 0, y: 1 }, halfKey: 'w' },
    { side: 'left', localNormal: { x: -1, y: 0 }, localTangent: { x: 0, y: 1 }, halfKey: 'w' },
    { side: 'front', localNormal: { x: 0, y: 1 }, localTangent: { x: -1, y: 0 }, halfKey: 'd' },
    { side: 'back', localNormal: { x: 0, y: -1 }, localTangent: { x: 1, y: 0 }, halfKey: 'd' }
  ];
  const ignoreSet = new Set((Array.isArray(ignoreAnchorIds) ? ignoreAnchorIds : []).filter(Boolean));
  let best = null;

  walls.forEach((anchor) => {
    if (!anchor || anchor.id === ghostBase.id) return;
    if (ignoreSet.has(anchor.id)) return;
    if (anchor.id !== mouseHint.anchorId) return;
    const anchorItemDef = resolveWallItemDef(anchor, itemCatalogById);
    if (!isWoodPillarItem(anchorItemDef)) return;
    const anchorGeomParts = Array.isArray(getItemGeometry(anchorItemDef)?.collider?.parts)
      ? getItemGeometry(anchorItemDef).collider.parts
      : [];
    if (anchorGeomParts.length <= 0) return;

    const minFootprintArea = anchorGeomParts.reduce(
      (min, part) => Math.min(min, Math.max(1, Number(part?.w) || 1) * Math.max(1, Number(part?.d) || 1)),
      Infinity
    );
    const protrusions = anchorGeomParts
      .map((part, index) => ({ part, index }))
      .filter((row) => {
        const area = Math.max(1, Number(row?.part?.w) || 1) * Math.max(1, Number(row?.part?.d) || 1);
        return area >= (minFootprintArea * 1.2);
      });
    const targetPartsRaw = protrusions.length > 0
      ? protrusions
      : anchorGeomParts.map((part, index) => ({ part, index }));
    const anchorBaseZ = getWallBaseZ(anchor);
    const targetParts = targetPartsRaw.map((row) => {
      const part = row.part || {};
      const area = Math.max(1, Number(part?.w) || 1) * Math.max(1, Number(part?.d) || 1);
      const centerZ = anchorBaseZ + (Number(part?.cz) || 0);
      return {
        index: row.index,
        part,
        area,
        centerZ
      };
    });
    let targetRows = targetParts;
    const hintMatchesAnchor = (
      mouseHint
      && typeof mouseHint === 'object'
      && mouseHint.anchorId === anchor.id
    );
    if (hintMatchesAnchor) {
      const hintedPartIndex = Number.isFinite(Number(mouseHint?.partIndex))
        ? Math.floor(Number(mouseHint.partIndex))
        : null;
      if (hintedPartIndex !== null) {
        const byPart = targetParts.filter((row) => row.index === hintedPartIndex);
        if (byPart.length > 0) {
          targetRows = byPart;
        } else {
          return;
        }
      } else if (Number.isFinite(Number(mouseHint?.hitZ))) {
        const hitZ = Number(mouseHint.hitZ);
        let bestRow = null;
        let bestDist = Infinity;
        targetParts.forEach((row) => {
          const dist = Math.abs((Number(row?.centerZ) || 0) - hitZ);
          if (dist < bestDist) {
            bestDist = dist;
            bestRow = row;
          }
        });
        if (bestRow) targetRows = [bestRow];
      }
    }

    targetRows.forEach((row) => {
      const part = row.part || {};
      const partIndex = row.index;
      const partYaw = normalizeDeg((Number(anchor?.rotation) || 0) + (Number(part?.yawDeg) || 0));
      const rotatedOffset = rotate2D(Number(part?.cx) || 0, Number(part?.cy) || 0, Number(anchor?.rotation) || 0);
      const partCenter = {
        x: (Number(anchor?.x) || 0) + rotatedOffset.x,
        y: (Number(anchor?.y) || 0) + rotatedOffset.y
      };
      const partHalfW = Math.max(1, Number(part?.w) || 1) * 0.5;
      const partHalfD = Math.max(1, Number(part?.d) || 1) * 0.5;
      const partCenterZ = anchorBaseZ + (Number(part?.cz) || 0);
      const partBottomZ = partCenterZ - (Math.max(1, Number(part?.h) || 1) * 0.5);
      const partTopZ = partCenterZ + (Math.max(1, Number(part?.h) || 1) * 0.5);

      protrusionFaceDefs.forEach((faceDef) => {
        const normal = rotate2D(faceDef.localNormal.x, faceDef.localNormal.y, partYaw);
        const tangent = rotate2D(faceDef.localTangent.x, faceDef.localTangent.y, partYaw);
        const partHalf = faceDef.halfKey === 'w' ? partHalfW : partHalfD;
        const faceCenter = {
          x: partCenter.x + (normal.x * partHalf),
          y: partCenter.y + (normal.y * partHalf)
        };
        const pointerX = (
          hintMatchesAnchor
          && Number.isFinite(Number(mouseHint?.hitX))
          && (Number.isFinite(Number(mouseHint?.partIndex)) ? Math.floor(Number(mouseHint.partIndex)) === partIndex : true)
        )
          ? Number(mouseHint.hitX)
          : (Number(mouseWorld?.x) || 0);
        const pointerY = (
          hintMatchesAnchor
          && Number.isFinite(Number(mouseHint?.hitY))
          && (Number.isFinite(Number(mouseHint?.partIndex)) ? Math.floor(Number(mouseHint.partIndex)) === partIndex : true)
        )
          ? Number(mouseHint.hitY)
          : (Number(mouseWorld?.y) || 0);
        const fromFace = {
          x: pointerX - faceCenter.x,
          y: pointerY - faceCenter.y
        };
        const faceDist = Math.abs(dotAxis(fromFace, normal));
        const faceThickness = Math.max(4, partHalf * 0.35);
        const faceActivationDist = mode === 'long'
          ? Math.max(8, Math.min(16, faceThickness + 4))
          : Math.max(6, Math.min(12, faceThickness + 2));
        if (faceDist > faceActivationDist) return;

        const slideRaw = dotAxis(fromFace, tangent);
        const shortSnapTolerance = Math.max(6, Math.min(16, (faceDef.halfKey === 'w' ? partHalfD : partHalfW) * 0.5));
        if (mode === 'short' && Math.abs(slideRaw) > shortSnapTolerance) return;
        const slideLimit = mode === 'long'
          ? Math.max(24, Math.min(84, (faceDef.halfKey === 'w' ? partHalfD : partHalfW) + 48))
          : Math.max(10, (faceDef.halfKey === 'w' ? partHalfD : partHalfW));
        const slide = mode === 'long'
          ? Math.max(-slideLimit, Math.min(slideLimit, slideRaw))
          : 0;
        const normalYaw = normalizeDeg((Math.atan2(normal.y, normal.x) * 180) / Math.PI);
        const rotation = mode === 'long' ? normalizeDeg(normalYaw + 90) : normalYaw;
        const ghostLike = {
          ...ghostBase,
          rotation
        };
        const ghostHalfNormal = getProjectedHalfExtent(ghostLike, normal);
        const candidateCenter = {
          x: faceCenter.x + (normal.x * ghostHalfNormal) + (tangent.x * slide),
          y: faceCenter.y + (normal.y * ghostHalfNormal) + (tangent.y * slide)
        };
        const desiredBaseZ = partCenterZ - ghostZBounds.centerZ;
        const rawStackZ = Math.max(0, Math.round(desiredBaseZ / ghostLayerHeight));
        const stackZ = Math.max(0, Math.min(ghostStackLimit - 1, rawStackZ));
        const candidate = {
          ...ghostBase,
          x: candidateCenter.x,
          y: candidateCenter.y,
          z: stackZ,
          rotation,
          _pillarSnapMode: mode,
          attach: {
            parentObjectId: anchor.id,
            parentSocketId: `pillar_protrusion_${partIndex}_${faceDef.side}`,
            childSocketId: mode === 'long' ? 'long_edge' : 'short_edge'
          },
          groupId: ghostBase.groupId || anchor.groupId || anchor.id
        };
        const candidateMinZ = (stackZ * ghostLayerHeight) + ghostZBounds.minZ;
        const candidateMaxZ = (stackZ * ghostLayerHeight) + ghostZBounds.maxZ;
        const verticalOverlap = Math.min(candidateMaxZ, partTopZ) - Math.max(candidateMinZ, partBottomZ);
        if (verticalOverlap < Math.max(2, Math.min(8, (Number(part?.h) || 1) * 0.3))) return;
        if (isOutOfBounds(candidate, fieldWidth, fieldHeight, itemCatalogById)) return;
        if (overlapsDeployZone(candidate, fieldWidth, itemCatalogById)) return;
        if (hasCollision(candidate, walls, itemCatalogById, [...ignoreSet, anchor.id])) return;
        const score = (faceDist * 0.55) + (Math.abs(slideRaw - slide) * 0.1);
        if (!best || score < best.score) {
          best = {
            score,
            ghost: candidate,
            snap: {
              type: 'pillar-face',
              anchorId: anchor.id,
              face: faceDef.side,
              protrusion: partIndex,
              orientationMode: mode
            }
          };
        }
      });
    });
  });

  return best ? { ghost: best.ghost, snap: best.snap, blocked: false, reason: '' } : null;
};

const solveSocketSnap = ({
  ghostBase,
  walls = [],
  itemCatalogById = new Map(),
  mouseWorld = null,
  mouseHint = null,
  ignoreAnchorIds = [],
  fieldWidth,
  fieldHeight
}) => {
  const ghostItemDef = resolveWallItemDef(ghostBase, itemCatalogById);
  const ghostSockets = getItemGeometry(ghostItemDef).sockets || [];
  if (ghostSockets.length <= 0) return null;
  const hintedAnchorId = getHintAnchorId(mouseHint);
  if (!hintedAnchorId) return null;
  const ignoreSet = new Set((Array.isArray(ignoreAnchorIds) ? ignoreAnchorIds : []).filter(Boolean));
  let best = null;

  walls.forEach((anchor) => {
    if (!anchor || anchor.id === ghostBase.id) return;
    if (ignoreSet.has(anchor.id)) return;
    if (anchor.id !== hintedAnchorId) return;
    const anchorItemDef = resolveWallItemDef(anchor, itemCatalogById);
    if (isWoodPlankItem(ghostItemDef) && isWoodPillarItem(anchorItemDef)) return;
    const anchorSockets = getItemGeometry(anchorItemDef).sockets || [];
    if (anchorSockets.length <= 0) return;

    anchorSockets.forEach((parentSocket) => {
      const parentPose = getSocketWorldPose(anchor, parentSocket);
      ghostSockets.forEach((childSocket) => {
        if (!areSocketCompatible(parentSocket, childSocket, anchorItemDef, ghostItemDef)) return;
        const parentSnapDist = Number(parentSocket?.snap?.dist);
        const childSnapDist = Number(childSocket?.snap?.dist);
        const snapDist = Math.max(
          2,
          Number.isFinite(parentSnapDist)
            ? parentSnapDist
            : (Number.isFinite(childSnapDist) ? childSnapDist : 12)
        );
        const yawStep = Number.isFinite(Number(childSocket?.snap?.yawStepDeg))
          ? Number(childSocket.snap.yawStepDeg)
          : (Number.isFinite(Number(parentSocket?.snap?.yawStepDeg)) ? Number(parentSocket.snap.yawStepDeg) : null);

        let rotation = normalizeDeg(parentPose.yawDeg - (Number(childSocket?.localPose?.yawDeg) || 0));
        if (yawStep && yawStep > 0.0001) {
          rotation = normalizeDeg(Math.round(rotation / yawStep) * yawStep);
        }
        const childOffset = rotate2D(
          Number(childSocket?.localPose?.x) || 0,
          Number(childSocket?.localPose?.y) || 0,
          rotation
        );
        const ghostLayerHeight = Math.max(
          1,
          Number(ghostBase?.height) || Number(ghostItemDef?.height) || STACK_LAYER_HEIGHT
        );
        const desiredBaseZ = (Number(parentPose?.z) || 0) - (Number(childSocket?.localPose?.z) || 0);
        const socketStackZ = Math.max(
          0,
          Math.round(desiredBaseZ / ghostLayerHeight)
        );
        const ghostStackLimit = resolveItemStackLimit(ghostItemDef);
        const anchorHeight = Math.max(
          1,
          Number(anchor?.height) || Number(anchorItemDef?.height) || STACK_LAYER_HEIGHT
        );
        const anchorTopZ = getWallBaseZ(anchor) + anchorHeight;
        const parentSocketLocalZ = Number(parentSocket?.localPose?.z) || 0;
        const topSocketThreshold = anchorHeight - Math.max(4, anchorHeight * 0.12);
        const ghostMinLocalZ = getItemLocalMinZ(ghostItemDef);
        let adjustedStackZ = socketStackZ;
        if (parentSocketLocalZ >= topSocketThreshold) {
          const candidateMinWorldZ = (adjustedStackZ * ghostLayerHeight) + ghostMinLocalZ;
          if (candidateMinWorldZ < anchorTopZ - 0.01) {
            adjustedStackZ = Math.max(
              adjustedStackZ,
              Math.ceil((anchorTopZ - ghostMinLocalZ) / ghostLayerHeight)
            );
          }
        }
        const candidate = {
          ...ghostBase,
          x: parentPose.x - childOffset.x,
          y: parentPose.y - childOffset.y,
          z: Math.max(0, Math.min(ghostStackLimit - 1, adjustedStackZ)),
          rotation,
          attach: {
            parentObjectId: anchor.id,
            parentSocketId: parentSocket.socketId,
            childSocketId: childSocket.socketId
          },
          groupId: ghostBase.groupId || anchor.groupId || anchor.id
        };
        const pointerX = Number.isFinite(Number(mouseHint?.hitX))
          ? Number(mouseHint.hitX)
          : (Number(mouseWorld?.x) || 0);
        const pointerY = Number.isFinite(Number(mouseHint?.hitY))
          ? Number(mouseHint.hitY)
          : (Number(mouseWorld?.y) || 0);
        const pointerDist = Math.hypot(pointerX - parentPose.x, pointerY - parentPose.y);
        const socketOffsetDist = Math.hypot(candidate.x - ghostBase.x, candidate.y - ghostBase.y);
        const activationDist = Math.max(6, snapDist);
        if (pointerDist > activationDist) return;
        if (isOutOfBounds(candidate, fieldWidth, fieldHeight, itemCatalogById)) return;
        if (overlapsDeployZone(candidate, fieldWidth, itemCatalogById)) return;
        if (hasCollision(candidate, walls, itemCatalogById, [...ignoreSet, anchor.id])) return;
        const score = pointerDist + (socketOffsetDist * 0.15) + (angleDistanceDeg(rotation, ghostBase.rotation) * 0.05);
        if (!best || score < best.score) {
          best = {
            score,
            ghost: candidate,
            snap: {
              type: 'socket',
              anchorId: anchor.id,
              parentSocketId: parentSocket.socketId,
              childSocketId: childSocket.socketId
            }
          };
        }
      });
    });
  });

  return best ? { ghost: best.ghost, snap: best.snap, blocked: false, reason: '' } : null;
};

const solveMagneticSnap = ({
  candidateGhost,
  walls,
  mouseWorld,
  mouseHint = null,
  fieldWidth,
  fieldHeight,
  itemCatalogById
}) => {
  const ghostItemDef = resolveWallItemDef(candidateGhost, itemCatalogById);
  const ghostStackLimit = resolveItemStackLimit(ghostItemDef);
  const sourceId = (
    candidateGhost?._mode === 'move'
    && typeof candidateGhost?._sourceId === 'string'
    && candidateGhost._sourceId.trim()
  )
    ? candidateGhost._sourceId.trim()
    : '';
  const ignoreAnchorIds = sourceId ? [sourceId] : [];
  const wallsForSnap = Array.isArray(walls)
    ? walls.filter((wall) => !(sourceId && wall?.id === sourceId))
    : [];
  const ghostBase = {
    ...candidateGhost,
    z: Math.max(0, Math.min(ghostStackLimit - 1, Math.floor(Number(candidateGhost?.z) || 0))),
    rotation: normalizeDeg(candidateGhost?.rotation || 0),
    _pillarSnapMode: candidateGhost?._pillarSnapMode === 'short' ? 'short' : 'long',
    attach: candidateGhost?.attach && typeof candidateGhost.attach === 'object' ? candidateGhost.attach : null,
    groupId: typeof candidateGhost?.groupId === 'string' ? candidateGhost.groupId : ''
  };

  const pillarFaceSnap = solvePillarPlankFaceSnap({
    ghostBase,
    ghostItemDef,
    walls: wallsForSnap,
    itemCatalogById,
    mouseWorld,
    mouseHint,
    ignoreAnchorIds,
    fieldWidth,
    fieldHeight
  });
  if (pillarFaceSnap) return pillarFaceSnap;

  if (isWoodPlankItem(ghostItemDef)) {
    const freeGhost = { ...ghostBase, z: 0, attach: null, groupId: '' };
    if (overlapsDeployZone(freeGhost, fieldWidth, itemCatalogById)) {
      return {
        ghost: freeGhost,
        snap: null,
        blocked: true,
        reason: 'deploy_zone_blocked'
      };
    }
    if (isOutOfBounds(freeGhost, fieldWidth, fieldHeight, itemCatalogById)) {
      return {
        ghost: freeGhost,
        snap: null,
        blocked: true,
        reason: 'out_of_bounds'
      };
    }
    if (hasCollision(freeGhost, walls, itemCatalogById, ignoreAnchorIds)) {
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
  }

  const socketSnap = solveSocketSnap({
    ghostBase,
    walls: wallsForSnap,
    itemCatalogById,
    mouseWorld,
    mouseHint,
    ignoreAnchorIds,
    fieldWidth,
    fieldHeight
  });
  if (socketSnap) return socketSnap;

  const hintedAnchorId = getHintAnchorId(mouseHint);
  const hintedFaceType = typeof mouseHint?.faceType === 'string' ? mouseHint.faceType : '';
  const sortedWalls = [...wallsForSnap].sort((a, b) => (b.z - a.z));
  let stackLimitHit = false;

  if (hintedAnchorId && hintedFaceType === 'top') {
    for (const wall of sortedWalls) {
      if (!wall || wall.id !== hintedAnchorId) continue;
      if (!pointInWallFootprint(mouseWorld, wall, itemCatalogById, 0.2)) continue;
      const ghostLayerHeight = Math.max(
        1,
        Number(ghostBase?.height) || Number(ghostItemDef?.height) || STACK_LAYER_HEIGHT
      );
      const ghostMinLocalZ = getItemLocalMinZ(ghostItemDef);
      const requiredBaseZ = getWallTopZ(wall);
      const requiredStackZ = Math.max(
        0,
        Math.ceil((requiredBaseZ - ghostMinLocalZ) / ghostLayerHeight)
      );
      if (requiredStackZ >= ghostStackLimit) {
        stackLimitHit = true;
        continue;
      }
      const topGhost = {
        ...ghostBase,
        x: wall.x,
        y: wall.y,
        z: requiredStackZ,
        rotation: normalizeDeg(wall.rotation),
        attach: null,
        groupId: ''
      };
      if (isOutOfBounds(topGhost, fieldWidth, fieldHeight, itemCatalogById)) {
        return {
          ghost: topGhost,
          snap: { type: 'top', anchorId: wall.id },
          blocked: true,
          reason: 'out_of_bounds'
        };
      }
      if (overlapsDeployZone(topGhost, fieldWidth, itemCatalogById)) {
        return {
          ghost: topGhost,
          snap: { type: 'top', anchorId: wall.id },
          blocked: true,
          reason: 'deploy_zone_blocked'
        };
      }
      if (hasCollision(topGhost, walls, itemCatalogById, ignoreAnchorIds)) {
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
  }

  let best = null;
  const pointerX = Number.isFinite(Number(mouseHint?.hitX))
    ? Number(mouseHint.hitX)
    : (Number(mouseWorld?.x) || 0);
  const pointerY = Number.isFinite(Number(mouseHint?.hitY))
    ? Number(mouseHint.hitY)
    : (Number(mouseWorld?.y) || 0);
  const minSize = Math.max(20, Math.min(ghostBase.width, ghostBase.depth));
  const snapRadius = minSize * 1.4;
  const sideDefs = [
    { side: 'right', localNormal: { x: 1, y: 0 }, halfKey: 'width' },
    { side: 'left', localNormal: { x: -1, y: 0 }, halfKey: 'width' },
    { side: 'front', localNormal: { x: 0, y: 1 }, halfKey: 'depth' },
    { side: 'back', localNormal: { x: 0, y: -1 }, halfKey: 'depth' }
  ];

  wallsForSnap.forEach((anchor) => {
    if (!hintedAnchorId || anchor?.id !== hintedAnchorId) return;
    sideDefs.forEach((face) => {
      const normal = rotate2D(face.localNormal.x, face.localNormal.y, anchor.rotation);
      const anchorHalf = face.halfKey === 'width' ? (anchor.width / 2) : (anchor.depth / 2);
      const contactPoint = {
        x: anchor.x + (normal.x * anchorHalf),
        y: anchor.y + (normal.y * anchorHalf)
      };
      const mouseDist = Math.hypot(pointerX - contactPoint.x, pointerY - contactPoint.y);
      if (mouseDist > snapRadius) return;

      const yawCandidates = Array.from(new Set(
        [...buildYawCandidatesFromGhost(ghostBase.rotation), ...buildYawCandidatesFromTarget(anchor.rotation)]
          .map((yaw) => normalizeDeg(yaw))
      ));

      yawCandidates.forEach((yaw) => {
        const ghostLike = {
          ...ghostBase,
          rotation: normalizeDeg(yaw),
          z: anchor.z,
          attach: null,
          groupId: ''
        };
        const ghostHalf = getProjectedHalfExtent(ghostLike, normal);
        const candidate = {
          ...ghostLike,
          x: anchor.x + (normal.x * (anchorHalf + ghostHalf)),
          y: anchor.y + (normal.y * (anchorHalf + ghostHalf))
        };

        if (isOutOfBounds(candidate, fieldWidth, fieldHeight, itemCatalogById)) return;
        if (overlapsDeployZone(candidate, fieldWidth, itemCatalogById)) return;
        if (hasCollision(candidate, walls, itemCatalogById, ignoreAnchorIds)) return;

        const requiredNormal = { x: -normal.x, y: -normal.y };
        const faceNormals = getGhostNormalsByYaw(candidate.rotation);
        let bestAlign = -1;
        faceNormals.forEach((testNormal) => {
          bestAlign = Math.max(bestAlign, dot2(testNormal, requiredNormal));
        });
        const alignErr = 1 - Math.max(-1, Math.min(1, bestAlign));
        if (alignErr > 0.005) return;

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

  const clamped = clampGhostInsideField({ ...ghostBase, z: 0, attach: null, groupId: '' }, fieldWidth, fieldHeight, itemCatalogById);
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
    if (hasCollision(clamped, walls, itemCatalogById, ignoreAnchorIds)) {
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

  const freeGhost = { ...ghostBase, z: 0, attach: null, groupId: '' };
  if (ghostItemDef?.requiresSupport) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'support_required'
    };
  }
  if (stackLimitHit) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'stack_limit'
    };
  }
  if (overlapsDeployZone(freeGhost, fieldWidth, itemCatalogById)) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'deploy_zone_blocked'
    };
  }
  if (isOutOfBounds(freeGhost, fieldWidth, fieldHeight, itemCatalogById)) {
    return {
      ghost: freeGhost,
      snap: null,
      blocked: true,
      reason: 'out_of_bounds'
    };
  }
  if (hasCollision(freeGhost, walls, itemCatalogById, ignoreAnchorIds)) {
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
  fieldHeight = FIELD_HEIGHT,
  itemCatalogById = new Map(),
  mouseHint = null
) => solveMagneticSnap({
  candidateGhost,
  walls,
  mouseWorld,
  mouseHint,
  fieldWidth,
  fieldHeight,
  itemCatalogById
});

const findTopWallAtPoint = (worldPoint, walls = [], itemCatalogById = new Map()) => {
  const matches = walls.filter((wall) => pointInWallFootprint(worldPoint, wall, itemCatalogById, 0.2));
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
  overlayTopOffsetPx = null,
  layoutBundleOverride = null,
  onSaved = null,
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
  const mouseScreenRef = useRef({ x: 0, y: 0, valid: false });
  const mouseSnapHintRef = useRef(null);
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
  const defenderFormationStateRef = useRef(new Map());
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
  const [itemDetailModalItemId, setItemDetailModalItemId] = useState('');
  const [defenderEditorOpen, setDefenderEditorOpen] = useState(false);
  const [defenderEditingDeployId, setDefenderEditingDeployId] = useState('');
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
  const hasLayoutBundleOverride = !!(
    layoutBundleOverride
    && typeof layoutBundleOverride === 'object'
    && !Array.isArray(layoutBundleOverride)
  );
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
  const itemDetailModalItem = useMemo(() => (
    itemDetailModalItemId ? (itemCatalogById.get(itemDetailModalItemId) || null) : null
  ), [itemCatalogById, itemDetailModalItemId]);
  const itemDetailModalStock = useMemo(() => (
    itemDetailModalItem ? (itemStockMetaMap.get(itemDetailModalItem.itemId) || { used: 0, limit: 0, remaining: 0 }) : null
  ), [itemDetailModalItem, itemStockMetaMap]);
  const itemDetailInteractionLabels = useMemo(() => {
    if (!itemDetailModalItem) return [];
    const rows = Array.isArray(itemDetailModalItem?.interactions) ? itemDetailModalItem.interactions : [];
    return Array.from(new Set(rows.map((row) => getInteractionKindLabel(row?.kind)).filter(Boolean)));
  }, [itemDetailModalItem]);
  const itemDetailSocketCount = useMemo(() => (
    itemDetailModalItem && Array.isArray(itemDetailModalItem?.sockets) ? itemDetailModalItem.sockets.length : 0
  ), [itemDetailModalItem]);
  const itemDetailColliderPartCount = useMemo(() => {
    if (!itemDetailModalItem) return 0;
    if (Array.isArray(itemDetailModalItem?.collider?.parts)) return itemDetailModalItem.collider.parts.length;
    if (Array.isArray(itemDetailModalItem?.collider?.polygon?.points)) {
      return Math.max(0, itemDetailModalItem.collider.polygon.points.length);
    }
    return 0;
  }, [itemDetailModalItem]);
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
  const defenderUnitTypesForFormation = useMemo(() => (
    Array.from(defenderRosterMap.values()).map((item) => ({
      unitTypeId: item.unitTypeId,
      name: item.unitName || item.unitTypeId,
      roleTag: item.roleTag === '远程' ? '远程' : '近战',
      speed: item.roleTag === '远程' ? 1.1 : 1.4,
      range: item.roleTag === '远程' ? 3 : 1
    }))
  ), [defenderRosterMap]);
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

  const pickWallMeshHitFromScreenPoint = useCallback((sx, sy) => {
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
    const hit = hits[0];
    const wallId = hit?.object?.userData?.wallId;
    if (!wallId) return null;
    const wall = walls.find((item) => item.id === wallId) || null;
    if (!wall) return null;
    const data = hit?.object?.userData && typeof hit.object.userData === 'object' ? hit.object.userData : {};
    const localNormal = hit?.face?.normal || null;
    const normalZ = Number(localNormal?.z) || 0;
    const faceType = normalZ > 0.8 ? 'top' : (normalZ < -0.8 ? 'bottom' : 'side');
    return {
      wall,
      wallId,
      point: {
        x: Number(hit?.point?.x) || 0,
        y: Number(hit?.point?.y) || 0,
        z: Number(hit?.point?.z) || 0
      },
      faceType,
      partIndex: Number.isFinite(Number(data?.partIndex)) ? Math.floor(Number(data.partIndex)) : null,
      partMinZ: Number.isFinite(Number(data?.partMinZ)) ? Number(data.partMinZ) : null,
      partMaxZ: Number.isFinite(Number(data?.partMaxZ)) ? Number(data.partMaxZ) : null,
      partCenterZ: Number.isFinite(Number(data?.partCenterZ)) ? Number(data.partCenterZ) : null
    };
  }, [viewport.height, viewport.width, walls]);

  const pickWallFromScreenPoint = useCallback((sx, sy) => {
    const hit = pickWallMeshHitFromScreenPoint(sx, sy);
    return hit?.wall || null;
  }, [pickWallMeshHitFromScreenPoint]);

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

  const resolveMouseSnapHint = useCallback((sx, sy) => {
    const meshHit = pickWallMeshHitFromScreenPoint(sx, sy);
    if (!meshHit?.wall) {
      mouseSnapHintRef.current = null;
      return null;
    }
    const hint = {
      anchorId: meshHit.wall.id,
      partIndex: Number.isFinite(Number(meshHit.partIndex)) ? Number(meshHit.partIndex) : null,
      hitX: Number(meshHit?.point?.x) || 0,
      hitY: Number(meshHit?.point?.y) || 0,
      hitZ: Number(meshHit?.point?.z) || 0,
      partCenterZ: Number.isFinite(Number(meshHit?.partCenterZ)) ? Number(meshHit.partCenterZ) : null,
      faceType: typeof meshHit?.faceType === 'string' ? meshHit.faceType : ''
    };
    mouseSnapHintRef.current = hint;
    return hint;
  }, [pickWallMeshHitFromScreenPoint]);

  const syncGhostByMouse = useCallback((sourceGhost = ghost) => {
    if (!sourceGhost) return null;
    const candidate = {
      ...sourceGhost,
      x: mouseWorldRef.current.x,
      y: mouseWorldRef.current.y,
      z: 0
    };
    const evaluated = evaluateGhostPlacement(
      candidate,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
    setGhost(evaluated.ghost);
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    return evaluated;
  }, [fieldHeight, fieldWidth, ghost, walls, itemCatalogById]);

  const cancelGhostPlacement = useCallback((tip = '已取消放置') => {
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setInvalidReason('');
    mouseSnapHintRef.current = null;
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
    if (isWoodPlankItem(itemDef)) {
      nextGhost._pillarSnapMode = 'long';
    }
    const evaluated = evaluateGhostPlacement(
      nextGhost,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
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
    if (isWoodPlankItem(itemDef)) {
      setMessage(`已选中${itemDef.name || '物品'}：左键放置，右键或 ESC 取消，靠近立柱可吸附，滚轮切换长端/短端贴面，Space+左键平移`);
    } else if (isBushItem(itemDef)) {
      setMessage(`已选中${itemDef.name || '草丛'}：左键放置，右键或 ESC 取消；绿色半球罩及地面圆环为隐身范围`);
    } else {
      setMessage(`已选中${itemDef.name || '物品'}：左键放置，右键或 ESC 取消，滚轮旋转，Space+左键平移`);
    }
  }, [effectiveCanEdit, editMode, normalizedItemCatalog, itemStockMetaMap, walls, fieldWidth, fieldHeight, itemCatalogById]);

  const startMoveWall = useCallback((wallLike) => {
    if (!wallLike) return;
    const moveItemDef = itemCatalogById.get(typeof wallLike?.itemId === 'string' ? wallLike.itemId : '') || null;
    const sourceId = typeof wallLike?.id === 'string' ? wallLike.id : '';
    const moveGhostId = sourceId
      ? `moving_${sourceId}_${Date.now().toString(36)}`
      : `moving_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const movingGhostSeed = {
      ...createWallFromLike(wallLike, { id: moveGhostId }),
      _pillarSnapMode: isWoodPlankItem(moveItemDef) ? 'long' : undefined,
      _mode: 'move',
      _sourceId: sourceId
    };
    const evaluated = evaluateGhostPlacement(
      movingGhostSeed,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
    setGhost({ ...evaluated.ghost, _mode: 'move', _sourceId: wallLike.id });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setSelectedPaletteItem(wallLike.itemId || '');
    setMessage('移动模式：左键确认位置，右键或 ESC 取消');
  }, [fieldHeight, fieldWidth, walls, itemCatalogById]);

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

  const resolveDefenderDeploymentFootprint = useCallback((deploymentLike) => {
    const units = normalizeDefenderUnits(deploymentLike?.units, deploymentLike?.unitTypeId, deploymentLike?.count);
    if (units.length <= 0) return { radius: 16, width: 24, depth: 24 };
    const totalUnits = units.reduce((sum, entry) => sum + entry.count, 0);
    const countsByType = {};
    units.forEach((entry) => {
      countsByType[entry.unitTypeId] = (countsByType[entry.unitTypeId] || 0) + entry.count;
    });
    const deployId = typeof deploymentLike?.deployId === 'string' ? deploymentLike.deployId.trim() : '';
    const signature = Object.entries(countsByType)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-Hans-CN'))
      .map(([unitTypeId, count]) => `${unitTypeId}:${count}`)
      .join('|');
    const cacheKey = `def_metric_${deployId || signature}`;
    const cameraState = {
      distance: 980,
      worldScale: 1,
      renderBudget: DEFENDER_FORMATION_METRIC_BUDGET,
      shape: 'grid',
      unitTypes: defenderUnitTypesForFormation
    };
    const cache = defenderFormationStateRef.current;
    let formationState = cache.get(cacheKey);
    if (!formationState) {
      formationState = createFormationVisualState({
        teamId: 'defender',
        formationId: cacheKey,
        countsByType,
        unitTypes: defenderUnitTypesForFormation,
        cameraState
      });
      cache.set(cacheKey, formationState);
    } else {
      reconcileCounts(formationState, countsByType, cameraState, Date.now());
    }
    const rawFootprint = getFormationFootprint(formationState);
    const scaleByCount = resolveDefenderFootprintScaleByCount(totalUnits);
    return {
      radius: Math.max(10, Number(rawFootprint?.radius || 16) * scaleByCount),
      width: Math.max(12, Number(rawFootprint?.width || 24) * scaleByCount),
      depth: Math.max(12, Number(rawFootprint?.depth || 24) * scaleByCount)
    };
  }, [defenderUnitTypesForFormation]);

  const resolveDefenderDeploymentRadius = useCallback((deploymentLike, fallback = 16) => {
    const footprint = resolveDefenderDeploymentFootprint(deploymentLike);
    return Math.max(9, (Number(footprint?.radius) || fallback) * 0.86);
  }, [resolveDefenderDeploymentFootprint]);

  const findDeploymentAtWorld = useCallback((worldPoint) => {
    const source = (Array.isArray(defenderDeployments) ? defenderDeployments : []).filter((item) => item?.placed !== false);
    let best = null;
    let bestDist = Infinity;
    source.forEach((item) => {
      const dx = (Number(item?.x) || 0) - worldPoint.x;
      const dy = (Number(item?.y) || 0) - worldPoint.y;
      const dist = Math.hypot(dx, dy);
      const pickRadius = Math.max(14, resolveDefenderDeploymentRadius(item, 16) * 0.95);
      if (dist < bestDist && dist <= pickRadius) {
        best = item;
        bestDist = dist;
      }
    });
    return best;
  }, [defenderDeployments, resolveDefenderDeploymentRadius]);

  const buildDefaultDefenderPoint = useCallback((excludeDeployId = '') => {
    const minX = defenderZoneMinX;
    const maxX = fieldWidth / 2;
    const source = Array.isArray(defenderDeployments) ? defenderDeployments : [];
    const movingTarget = excludeDeployId ? source.find((item) => item.deployId === excludeDeployId) : null;
    const movingRadius = resolveDefenderDeploymentRadius(movingTarget, 16);
    for (let i = 0; i < 40; i += 1) {
      const point = {
        x: minX + 16 + (Math.random() * Math.max(16, (maxX - minX - 32))),
        y: (-fieldHeight * 0.42) + (Math.random() * fieldHeight * 0.84)
      };
      const overlap = source.some((item) => {
        if (excludeDeployId && item.deployId === excludeDeployId) return false;
        const otherRadius = resolveDefenderDeploymentRadius(item, 16);
        const minDistance = Math.max(
          8,
          ((movingRadius + otherRadius) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        );
        return Math.hypot((Number(item?.x) || 0) - point.x, (Number(item?.y) || 0) - point.y) < minDistance;
      });
      if (!overlap) return point;
    }
    return {
      x: minX + ((maxX - minX) * 0.55),
      y: 0
    };
  }, [defenderDeployments, defenderZoneMinX, fieldHeight, fieldWidth, resolveDefenderDeploymentRadius]);

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
    const nextRotation = normalizeDefenderFacingDeg(
      Number.isFinite(Number(worldPoint?.rotation)) ? Number(worldPoint.rotation) : target?.rotation
    );
    const targetRadius = resolveDefenderDeploymentRadius(target, 16);
    const overlap = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y)
        < Math.max(
          8,
          ((targetRadius + resolveDefenderDeploymentRadius(item, 16)) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        )
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
        ? { ...item, placed: true, x: nextPoint.x, y: nextPoint.y, rotation: nextRotation }
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
  }, [defenderDeployments, defenderRosterMap, defenderZoneMinX, editMode, effectiveCanEdit, fieldHeight, fieldWidth, persistDefenderDeploymentsNow, resolveDefenderDeploymentRadius]);

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
    const nextRotation = normalizeDefenderFacingDeg(
      Number.isFinite(Number(worldPoint?.rotation)) ? Number(worldPoint.rotation) : target?.rotation
    );
    const targetRadius = resolveDefenderDeploymentRadius(target, 16);
    const overlap = source.some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y)
        < Math.max(
          8,
          ((targetRadius + resolveDefenderDeploymentRadius(item, 16)) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        )
    ));
    const outsideZone = rawX < defenderZoneMinX;
    return {
      deployId,
      x: nextPoint.x,
      y: nextPoint.y,
      rotation: nextRotation,
      blocked: outsideZone || overlap,
      reason: outsideZone ? 'zone' : (overlap ? 'overlap' : '')
    };
  }, [defenderDeployments, defenderZoneMinX, fieldHeight, fieldWidth, resolveDefenderDeploymentRadius]);

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
    setDefenderEditingDeployId('');
    setSidebarTab('defender');
    setDefenderEditorOpen(true);
  }, [defenderDeploymentRows, defenderEditorAvailableRows, effectiveCanEdit]);

  const startEditDefenderDeployment = useCallback((deployId) => {
    const safeDeployId = typeof deployId === 'string' ? deployId.trim() : '';
    if (!effectiveCanEdit || !safeDeployId) return;
    const source = sanitizeDefenderDeployments(defenderDeployments);
    const target = source.find((item) => item.deployId === safeDeployId);
    if (!target) return;
    const wasPlaced = target.placed !== false;
    const nextDeployments = source.map((item) => (
      item.deployId === safeDeployId
        ? { ...item, placed: false }
        : item
    ));
    const draftUnits = normalizeDefenderUnits(target?.units, target?.unitTypeId, target?.count);
    setDefenderDeployments(nextDeployments);
    setSelectedDeploymentId(safeDeployId);
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    setSelectedWallId('');
    cancelGhostPlacement('');
    setDefenderEditingDeployId(safeDeployId);
    setDefenderEditorDraft({
      name: typeof target?.name === 'string' ? target.name : '',
      sortOrder: Math.max(1, Math.floor(Number(target?.sortOrder) || 1)),
      units: draftUnits
    });
    setSidebarTab('defender');
    setDefenderEditorOpen(true);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage(wasPlaced
        ? '已从战场撤回该守军部队，可重新编辑编制'
        : '已打开守军部队编辑');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage(wasPlaced
        ? '已从战场撤回该守军部队并保存，可重新编辑编制'
        : '已打开守军部队编辑');
    }
  }, [cancelGhostPlacement, defenderDeployments, editMode, effectiveCanEdit, persistDefenderDeploymentsNow]);

  const closeDefenderEditor = useCallback(() => {
    setDefenderEditorOpen(false);
    setDefenderEditingDeployId('');
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
    const editingDeployId = typeof defenderEditingDeployId === 'string' ? defenderEditingDeployId.trim() : '';
    if (editingDeployId) {
      const source = sanitizeDefenderDeployments(defenderDeployments);
      const target = source.find((item) => item.deployId === editingDeployId);
      if (target) {
        const nextDeployments = source.map((item) => (
          item.deployId === editingDeployId
            ? {
              ...item,
              name: teamName,
              sortOrder,
              placed: false,
              units: draftUnits,
              unitTypeId: draftUnits[0].unitTypeId,
              count: draftUnits[0].count
            }
            : item
        ));
        setDefenderDeployments(nextDeployments);
        if (editMode) setHasDraftChanges(true);
        else persistDefenderDeploymentsNow(nextDeployments);
        setSelectedDeploymentId(editingDeployId);
        setDefenderEditorOpen(false);
        setDefenderEditingDeployId('');
        setDefenderEditorDraft({
          name: '',
          sortOrder: sortOrder + 1,
          units: []
        });
        setMessage(editMode
          ? `已更新守军部队：${teamName}（${totalCount}）`
          : `已更新守军部队并保存：${teamName}（${totalCount}）`);
        return;
      }
      setDefenderEditingDeployId('');
    }
    const nextDeployment = {
      deployId: `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: teamName,
      sortOrder,
      placed: false,
      rotation: DEFENDER_DEFAULT_FACING_DEG,
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
    setDefenderEditingDeployId('');
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
    defenderEditingDeployId,
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
      const serverLayoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object')
        ? data.layoutBundle
        : null;
      let persistedCatalog = normalizeItemCatalog(itemCatalogForSave);
      let persistedLayoutMeta = layoutMetaForSave;
      let persistedWalls = sanitizedWalls;
      let persistedDefenderDeployments = sanitizedDefenderDeployments;
      if (serverLayoutBundle) {
        const serverCatalog = normalizeItemCatalog(serverLayoutBundle.itemCatalog);
        if (serverCatalog.length > 0) persistedCatalog = serverCatalog;
        const serverLayoutMeta = {
          layoutId: typeof serverLayoutBundle?.activeLayout?.layoutId === 'string'
            ? serverLayoutBundle.activeLayout.layoutId
            : (typeof layoutMetaForSave?.layoutId === 'string' ? layoutMetaForSave.layoutId : `${gateKey || 'cheng'}_default`),
          name: typeof serverLayoutBundle?.activeLayout?.name === 'string'
            ? serverLayoutBundle.activeLayout.name
            : (typeof layoutMetaForSave?.name === 'string' ? layoutMetaForSave.name : ''),
          fieldWidth: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.fieldWidth))
            ? Number(serverLayoutBundle.activeLayout.fieldWidth)
            : Number(layoutMetaForSave?.fieldWidth) || FIELD_WIDTH,
          fieldHeight: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.fieldHeight))
            ? Number(serverLayoutBundle.activeLayout.fieldHeight)
            : Number(layoutMetaForSave?.fieldHeight) || FIELD_HEIGHT,
          maxItemsPerType: Number.isFinite(Number(serverLayoutBundle?.activeLayout?.maxItemsPerType))
            ? Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Math.floor(Number(serverLayoutBundle.activeLayout.maxItemsPerType)))
            : Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Math.floor(Number(layoutMetaForSave?.maxItemsPerType) || DEFAULT_MAX_ITEMS_PER_TYPE))
        };
        const serverWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls({
          ...serverLayoutBundle,
          itemCatalog: persistedCatalog
        }));
        const serverDeployments = normalizeDefenderDeploymentsToRightZone(
          mapLayoutBundleToDefenderDeployments(serverLayoutBundle),
          serverLayoutMeta.fieldWidth,
          serverLayoutMeta.fieldHeight
        );
        persistedLayoutMeta = serverLayoutMeta;
        persistedWalls = serverWallSnapshot.walls;
        persistedDefenderDeployments = serverDeployments;
        setWalls(persistedWalls);
        setDefenderDeployments(persistedDefenderDeployments);
        setItemCatalog(persistedCatalog);
        setActiveLayoutMeta(persistedLayoutMeta);
      }
      writeBattlefieldCache(nodeId, gateKey, {
        walls: persistedWalls,
        defenderDeployments: persistedDefenderDeployments,
        layoutMeta: persistedLayoutMeta,
        itemCatalog: persistedCatalog,
        needsSync: false,
        message: ''
      });
      setCacheNeedsSync(false);
      setErrorText('');
      if (typeof onSaved === 'function') {
        try {
          onSaved({
            nodeId,
            gateKey,
            layoutBundle: data?.layoutBundle && typeof data.layoutBundle === 'object'
              ? data.layoutBundle
              : null
          });
        } catch {
          // Ignore callback failures to avoid breaking save success flow.
        }
      }
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
  }, [activeLayoutMeta, defenderDeployments, effectiveCanEdit, gateKey, itemCatalog, nodeId, onSaved, open]);

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
    const overrideBundle = hasLayoutBundleOverride ? layoutBundleOverride : null;

    const resolveOverrideSnapshot = () => {
      const sourceBundle = overrideBundle && typeof overrideBundle === 'object' ? overrideBundle : {};
      const overrideCatalog = normalizeItemCatalog(sourceBundle.itemCatalog);
      const overrideMeta = {
        layoutId: typeof sourceBundle?.activeLayout?.layoutId === 'string'
          ? sourceBundle.activeLayout.layoutId
          : defaultLayoutMeta.layoutId,
        name: typeof sourceBundle?.activeLayout?.name === 'string'
          ? sourceBundle.activeLayout.name
          : '',
        fieldWidth: Number.isFinite(Number(sourceBundle?.activeLayout?.fieldWidth))
          ? Number(sourceBundle.activeLayout.fieldWidth)
          : defaultLayoutMeta.fieldWidth,
        fieldHeight: Number.isFinite(Number(sourceBundle?.activeLayout?.fieldHeight))
          ? Number(sourceBundle.activeLayout.fieldHeight)
          : defaultLayoutMeta.fieldHeight,
        maxItemsPerType: Number.isFinite(Number(sourceBundle?.activeLayout?.maxItemsPerType))
          ? Math.max(DEFAULT_MAX_ITEMS_PER_TYPE, Math.floor(Number(sourceBundle.activeLayout.maxItemsPerType)))
          : DEFAULT_MAX_ITEMS_PER_TYPE
      };
      const overrideWallSnapshot = sanitizeWallsWithLegacyCleanup(mapLayoutBundleToWalls(sourceBundle));
      return {
        walls: overrideWallSnapshot.walls,
        defenderDeployments: [],
        itemCatalog: overrideCatalog,
        layoutMeta: overrideMeta
      };
    };

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
      if (overrideBundle) {
        const overrideSnapshot = resolveOverrideSnapshot();
        if (!cancelled) {
          setWalls(overrideSnapshot.walls);
          setDefenderDeployments(overrideSnapshot.defenderDeployments);
          setItemCatalog(overrideSnapshot.itemCatalog);
          setDefenderRoster([]);
          setActiveLayoutMeta(overrideSnapshot.layoutMeta);
          setServerCanEdit(false);
          setCacheNeedsSync(false);
          setMessage('');
          setLoadingLayout(false);
          setLayoutReady(true);
        }
        return;
      }
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
        const serverItemIdSet = new Set(nextCatalog.map((item) => item.itemId).filter(Boolean));
        const filteredCacheWalls = cacheSnapshot.walls.filter((wall) => serverItemIdSet.has(wall?.itemId));
        const removedLegacyCacheWalls = cacheSnapshot.walls.length - filteredCacheWalls.length;

        if (cacheSnapshot.needsSync && canEditByServer) {
          setWalls(filteredCacheWalls);
          setDefenderDeployments(cacheSnapshot.defenderDeployments);
          setItemCatalog(nextCatalog);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setCacheNeedsSync(true);
          pendingCacheSyncRef.current = {
            walls: filteredCacheWalls,
            defenderDeployments: cacheSnapshot.defenderDeployments,
            layoutMeta: cacheSnapshot.layoutMeta,
            itemCatalog: nextCatalog
          };
          setMessage((cacheSnapshot.clearedLegacy || removedLegacyCacheWalls > 0)
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
    defenderFormationStateRef.current = new Map();
    setSidebarTab('items');
    setDefenderEditorOpen(false);
    setDefenderEditingDeployId('');
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
    setItemDetailModalItemId('');
    setSelectedPaletteItem('');
    setSelectedWallId('');
    setMessage('');
    loadLayout();

    return () => {
      cancelled = true;
    };
  }, [canEdit, defaultLayoutMeta, gateKey, hasLayoutBundleOverride, layoutBundleOverride, open, nodeId]);

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
    if (!itemDetailModalItemId) return;
    if (!itemCatalogById.has(itemDetailModalItemId)) {
      setItemDetailModalItemId('');
    }
  }, [itemCatalogById, itemDetailModalItemId]);

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
      const itemDef = resolveWallItemDef(wallLike, itemCatalogById);
      const isBush = isBushItem(itemDef);
      const safeHeight = Math.max(14, Number(wallLike.height) || WALL_HEIGHT);
      const safeWidth = Math.max(20, Number(wallLike.width) || WALL_WIDTH);
      const safeDepth = Math.max(12, Number(wallLike.depth) || WALL_DEPTH);
      const selected = !!options.selected;
      const ghostMode = !!options.ghost;
      const sourceShadow = !!options.sourceShadow;
      const blocked = !!options.blocked;
      const palette = resolveBattleLayerColors(itemDef, { battleTone: true });
      const defaultTop = new THREE.Color(
        Number(palette?.top?.[0]) || 0.52,
        Number(palette?.top?.[1]) || 0.58,
        Number(palette?.top?.[2]) || 0.66
      ).getHex();
      const defaultSide = new THREE.Color(
        Number(palette?.side?.[0]) || 0.38,
        Number(palette?.side?.[1]) || 0.44,
        Number(palette?.side?.[2]) || 0.52
      ).getHex();

      let topHex = defaultTop;
      let sideHex = defaultSide;
      if (selected && !isBush) {
        topHex = 0x60a5fa;
        sideHex = 0x3b82f6;
      } else if (ghostMode && !sourceShadow) {
        topHex = blocked ? 0xb91c1c : 0xf59e0b;
        sideHex = blocked ? 0x7f1d1d : 0xb45309;
      }

      const partRowsRaw = buildWorldColliderParts(
        wallLike,
        itemDef,
        { stackLayerHeight: Math.max(1, Number(wallLike?.height) || Number(itemDef?.height) || STACK_LAYER_HEIGHT) }
      );
      const partRows = partRowsRaw.length > 0
        ? partRowsRaw
        : [{
          cx: Number(wallLike?.x) || 0,
          cy: Number(wallLike?.y) || 0,
          cz: getWallBaseZ(wallLike) + (safeHeight * 0.5),
          w: safeWidth,
          d: safeDepth,
          h: safeHeight,
          yawDeg: normalizeDeg(wallLike?.rotation || 0)
        }];

      partRows.forEach((part, partIndex) => {
        const materials = [
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: topHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.38 : (ghostMode ? 0.54 : 1),
            roughness: sourceShadow ? 0.68 : (ghostMode ? 0.52 : 0.76),
            metalness: sourceShadow ? 0.05 : (ghostMode ? 0.14 : 0.08),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          })
        ];
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.max(1, Number(part?.w) || 1),
            Math.max(1, Number(part?.d) || 1),
            Math.max(1, Number(part?.h) || 1)
          ),
          materials
        );
        if (isBush) {
          const applyOpacity = (mat, opacity) => {
            if (!mat) return;
            mat.transparent = true;
            mat.opacity = opacity;
            mat.depthWrite = false;
            mat.depthTest = false;
          };
          materials.forEach((mat) => applyOpacity(mat, 0));
        }
        wallMesh.position.set(
          Number(part?.cx) || 0,
          Number(part?.cy) || 0,
          Math.max(0.5, Number(part?.cz) || 0.5)
        );
        wallMesh.rotation.set(0, 0, degToRad(part?.yawDeg || 0));
        worldGroup.add(wallMesh);

        if (!ghostMode && !sourceShadow && typeof wallLike.id === 'string') {
          const partHeight = Math.max(1, Number(part?.h) || 1);
          const partCenterZ = Number(part?.cz) || 0;
          wallMesh.userData.wallId = wallLike.id;
          wallMesh.userData.partIndex = partIndex;
          wallMesh.userData.partCenterZ = partCenterZ;
          wallMesh.userData.partMinZ = partCenterZ - (partHeight * 0.5);
          wallMesh.userData.partMaxZ = partCenterZ + (partHeight * 0.5);
          pickableWallMeshes.push(wallMesh);
        }

        if (!isBush) {
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
        }
      });

      if (isBush) {
        const bushGroup = new THREE.Group();
        const avgCenterZ = partRows.reduce((sum, row) => sum + (Number(row?.cz) || 0), 0) / Math.max(1, partRows.length);
        bushGroup.position.set(
          Number(wallLike?.x) || 0,
          Number(wallLike?.y) || 0,
          Number.isFinite(avgCenterZ) ? avgCenterZ : (getWallBaseZ(wallLike) + (safeHeight * 0.45))
        );
        bushGroup.rotation.set(0, 0, degToRad(wallLike?.rotation || 0));
        worldGroup.add(bushGroup);

        const partW = safeWidth;
        const partD = safeDepth;
        const partH = safeHeight;
        const crownRadius = Math.max(5.5, Math.min(partW, partD) * 0.2);
        const crownHeight = Math.max(8, partH * 0.5);
        const bushTopColor = blocked ? 0xef4444 : (selected ? 0x8ed17f : topHex);
        const bushSideColor = blocked ? 0x991b1b : (selected ? 0x5ea76a : sideHex);

        const buildFoliageMaterial = (hex, opacity = 0.92, roughness = 0.9, metalness = 0.03) => (
          new THREE.MeshStandardMaterial({
            color: hex,
            transparent: ghostMode || sourceShadow || opacity < 1,
            opacity: sourceShadow ? Math.min(opacity, 0.35) : (ghostMode ? Math.min(opacity, 0.56) : opacity),
            roughness,
            metalness,
            side: THREE.DoubleSide,
            depthWrite: !ghostMode && !sourceShadow
          })
        );

        const clumpOffsets = [
          { x: 0, y: 0, s: 1.3, z: 0.56 },
          { x: -partW * 0.18, y: partD * 0.06, s: 1.02, z: 0.46 },
          { x: partW * 0.19, y: partD * 0.04, s: 0.98, z: 0.47 },
          { x: -partW * 0.13, y: -partD * 0.17, s: 0.92, z: 0.37 },
          { x: partW * 0.14, y: -partD * 0.16, s: 0.95, z: 0.37 },
          { x: 0, y: partD * 0.2, s: 0.94, z: 0.42 },
          { x: -partW * 0.24, y: -partD * 0.01, s: 0.86, z: 0.34 },
          { x: partW * 0.24, y: 0, s: 0.87, z: 0.34 },
          { x: -partW * 0.04, y: partD * 0.25, s: 0.83, z: 0.33 },
          { x: partW * 0.05, y: partD * 0.24, s: 0.82, z: 0.33 },
          { x: -partW * 0.08, y: -partD * 0.24, s: 0.78, z: 0.3 },
          { x: partW * 0.08, y: -partD * 0.24, s: 0.79, z: 0.3 }
        ];
        clumpOffsets.forEach((row, idx) => {
          const crown = new THREE.Mesh(
            new THREE.SphereGeometry(crownRadius, 16, 14),
            buildFoliageMaterial(idx % 2 === 0 ? bushTopColor : bushSideColor, 0.94, 0.88, 0.02)
          );
          crown.scale.set(row.s * 1.1, row.s, Math.max(0.72, (crownHeight / crownRadius) * (0.86 + (idx * 0.018))));
          crown.position.set(row.x, row.y, Math.max(2.8, partH * row.z));
          bushGroup.add(crown);
        });

        const bladeCount = 18;
        for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
          const t = bladeIndex / bladeCount;
          const angle = (Math.PI * 2 * t) + ((bladeIndex % 2) * 0.18);
          const radius = Math.max(1.8, crownRadius * (0.26 + ((bladeIndex % 5) * 0.1)));
          const blade = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(0.38, crownRadius * 0.16), Math.max(3.8, partH * 0.44), 5),
            buildFoliageMaterial(bushTopColor, 0.9, 0.84, 0.01)
          );
          blade.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            Math.max(2.6, partH * (0.25 + ((bladeIndex % 4) * 0.03)))
          );
          blade.rotation.x = Math.PI / 2;
          blade.rotation.y = Math.PI * (0.06 + ((bladeIndex % 4) * 0.03));
          blade.rotation.z = angle;
          bushGroup.add(blade);
        }

        const bladeTexture = getBushBladeTexture();
        if (bladeTexture) {
          const spriteOpacity = sourceShadow ? 0.22 : (ghostMode ? 0.46 : 0.74);
          const spriteMatA = new THREE.SpriteMaterial({
            map: bladeTexture,
            color: bushTopColor,
            transparent: true,
            opacity: spriteOpacity,
            alphaTest: 0.12,
            depthWrite: false
          });
          const spriteMatB = new THREE.SpriteMaterial({
            map: bladeTexture,
            color: bushSideColor,
            transparent: true,
            opacity: spriteOpacity * 0.92,
            alphaTest: 0.12,
            depthWrite: false
          });
          const spriteCount = 26;
          for (let spriteIndex = 0; spriteIndex < spriteCount; spriteIndex += 1) {
            const t = spriteIndex / spriteCount;
            const angle = (Math.PI * 2 * t) + ((spriteIndex % 3) * 0.14);
            const radius = crownRadius * (0.2 + ((spriteIndex % 7) * 0.1));
            const sprite = new THREE.Sprite((spriteIndex % 2 === 0) ? spriteMatA : spriteMatB);
            sprite.center.set(0.5, 0.03);
            const spriteHeight = Math.max(5.8, partH * (0.27 + ((spriteIndex % 5) * 0.03)));
            sprite.scale.set(spriteHeight * 0.42, spriteHeight, 1);
            sprite.position.set(
              Math.cos(angle) * radius,
              Math.sin(angle) * radius,
              Math.max(2.1, partH * (0.19 + ((spriteIndex % 4) * 0.02)))
            );
            bushGroup.add(sprite);
          }
        }
      }

      if (isBush && ghostMode && !sourceShadow) {
        const safeCenterX = Number(wallLike?.x) || 0;
        const safeCenterY = Number(wallLike?.y) || 0;
        const footprintCorners = getWallFootprintCorners(wallLike, itemCatalogById);
        const fallbackRadius = Math.max(6, Math.hypot(safeWidth * 0.5, safeDepth * 0.5));
        const stealthRadius = Math.max(
          fallbackRadius,
          footprintCorners.reduce(
            (max, row) => Math.max(max, Math.hypot((Number(row?.x) || 0) - safeCenterX, (Number(row?.y) || 0) - safeCenterY)),
            0
          )
        );
        const rangeColor = blocked ? 0xef4444 : 0x22c55e;
        const hemiDome = new THREE.Mesh(
          new THREE.SphereGeometry(stealthRadius, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.5),
          new THREE.MeshBasicMaterial({
            color: rangeColor,
            transparent: true,
            opacity: blocked ? 0.14 : 0.17,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        hemiDome.position.set(safeCenterX, safeCenterY, 0);
        hemiDome.rotation.x = Math.PI * 0.5;
        worldGroup.add(hemiDome);

        const groundDisk = new THREE.Mesh(
          new THREE.CircleGeometry(stealthRadius, 64),
          new THREE.MeshBasicMaterial({
            color: rangeColor,
            transparent: true,
            opacity: blocked ? 0.12 : 0.14,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        groundDisk.position.set(safeCenterX, safeCenterY, 0.08);
        worldGroup.add(groundDisk);

        const ring = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(
            Array.from({ length: 64 }, (_, idx) => {
              const angle = (idx / 64) * Math.PI * 2;
              return new THREE.Vector3(
                safeCenterX + (Math.cos(angle) * stealthRadius),
                safeCenterY + (Math.sin(angle) * stealthRadius),
                0.54
              );
            })
          ),
          new THREE.LineBasicMaterial({
            color: blocked ? 0xfca5a5 : 0x86efac,
            transparent: true,
            opacity: 0.95
          })
        );
        worldGroup.add(ring);
      }
    };

    const buildDefenderSquadMesh = (deploymentLike, options = {}) => {
      const deployment = deploymentLike || {};
      const units = normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count);
      const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
      if (totalCount <= 0) return;
      const isSelected = !!options.selected;
      const isPreview = !!options.preview;
      const isBlocked = !!options.blocked;
      const squadGroup = new THREE.Group();
      squadGroup.position.set(0, 0, 0.24);
      worldGroup.add(squadGroup);
      const centerX = Number(deployment?.x) || 0;
      const centerY = Number(deployment?.y) || 0;

      const countsByType = {};
      units.forEach((entry) => {
        countsByType[entry.unitTypeId] = (countsByType[entry.unitTypeId] || 0) + entry.count;
      });
      const formationKey = `def_layout_${deployment?.deployId || `${centerX}_${centerY}`}`;
      const deployRotation = normalizeDefenderFacingDeg(deployment?.rotation);
      const cameraState = {
        distance: Math.max(fieldWidth, fieldHeight, 500) * 2.4,
        worldScale,
        renderBudget: resolveFormationBudgetByZoom(zoom),
        shape: 'grid'
      };
      const formationCache = defenderFormationStateRef.current;
      let formationState = formationCache.get(formationKey);
      if (!formationState) {
        formationState = createFormationVisualState({
          teamId: 'defender',
          formationId: formationKey,
          countsByType,
          unitTypes: defenderUnitTypesForFormation,
          cameraState
        });
        formationCache.set(formationKey, formationState);
      } else {
        reconcileCounts(formationState, countsByType, {
          ...cameraState,
          unitTypes: defenderUnitTypesForFormation
        }, Date.now());
      }
      formationState.isHighlighted = isSelected;
      formationState.isGhost = isPreview;

      const infantryBodyGeometry = new THREE.ConeGeometry(1.35 * DEFENDER_SOLDIER_VISUAL_SCALE, 4.7 * DEFENDER_SOLDIER_VISUAL_SCALE, 6);
      const archerBodyGeometry = new THREE.CylinderGeometry(0.7 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.84 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.8 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const cavalryBodyGeometry = new THREE.BoxGeometry(2.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.1 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.05 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const cavalryLanceGeometry = new THREE.CylinderGeometry(0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 3.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 7);
      const artilleryBodyGeometry = new THREE.BoxGeometry(2.18 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.35 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.4 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const artilleryTubeGeometry = new THREE.CylinderGeometry(0.34 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.42 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.28 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const headGeometry = new THREE.SphereGeometry(0.92 * DEFENDER_SOLDIER_VISUAL_SCALE, 8, 8);
      const shadowGeometry = new THREE.CircleGeometry(Math.max(1.1, 2.16 * DEFENDER_SOLDIER_VISUAL_SCALE), 10);
      const opacity = isPreview ? (isBlocked ? 0.36 : 0.58) : 0.98;
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x020617,
        transparent: true,
        opacity: isPreview ? 0.16 : 0.24,
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
      const rendered = renderFormation(
        formationState,
        {
          kind: 'descriptors',
          center: { x: centerX, y: centerY }
        },
        cameraState,
        0
      );
      const fallbackFootprint = rendered?.footprint || getFormationFootprint(formationState);
      const stableRadius = resolveDefenderDeploymentRadius(deployment, Number(fallbackFootprint?.radius) || 18);
      const clusterRadius = Math.max(8, stableRadius);
      const rawRadius = Math.max(1, Number(fallbackFootprint?.radius) || clusterRadius);
      const clusterScale = Math.max(0.45, Math.min(1.25, clusterRadius / rawRadius));

      (rendered?.instances || []).forEach((instance) => {
        const bodyColor = isBlocked
          ? 0xf87171
          : parseHexColor(instance.bodyColor, 0x60a5fa);
        const accentColor = isBlocked
          ? 0xfee2e2
          : parseHexColor(instance.accentColor, 0xdbeafe);
        const rawX = Number(instance.x) || centerX;
        const rawY = Number(instance.y) || centerY;
        const rotatedOffset = rotate2D(
          (rawX - centerX) * clusterScale,
          (rawY - centerY) * clusterScale,
          deployRotation
        );
        const sx = centerX + rotatedOffset.x;
        const sy = centerY + rotatedOffset.y;
        const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadow.position.set(sx, sy, 0.05);
        shadow.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(shadow);

        if (instance.category === 'cavalry') {
          const mount = new THREE.Mesh(cavalryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          mount.position.set(sx, sy, 0.98 * DEFENDER_SOLDIER_VISUAL_SCALE);
          squadGroup.add(mount);
          const lance = new THREE.Mesh(cavalryLanceGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.96, 0.1));
          lance.position.set(sx + (1.3 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.3 * DEFENDER_SOLDIER_VISUAL_SCALE);
          lance.rotation.set(0, Math.PI / 2, (Math.PI / 12) + degToRad(deployRotation));
          squadGroup.add(lance);
        } else if (instance.category === 'archer') {
          const body = new THREE.Mesh(archerBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          body.position.set(sx, sy, 1.68 * DEFENDER_SOLDIER_VISUAL_SCALE);
          body.rotation.set(Math.PI / 2, 0, 0);
          squadGroup.add(body);
        } else if (instance.category === 'artillery') {
          const body = new THREE.Mesh(artilleryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          body.position.set(sx, sy, 1.08 * DEFENDER_SOLDIER_VISUAL_SCALE);
          squadGroup.add(body);
          const tube = new THREE.Mesh(artilleryTubeGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.96, 0.12));
          tube.position.set(sx + (0.9 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.0 * DEFENDER_SOLDIER_VISUAL_SCALE);
          tube.rotation.set(0, Math.PI / 2, (Math.PI / 5) + degToRad(deployRotation));
          squadGroup.add(tube);
        } else {
          const body = new THREE.Mesh(infantryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.18));
          body.position.set(sx, sy, 1.22 * DEFENDER_SOLDIER_VISUAL_SCALE);
          body.rotation.set(Math.PI / 2, 0, 0);
          squadGroup.add(body);
        }

        const head = new THREE.Mesh(headGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.98, 0.13));
        head.position.set(sx, sy, 3.0 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(head);
      });

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
        new THREE.CircleGeometry(Math.max(5.2, clusterRadius * 0.78), 44),
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
          new THREE.TorusGeometry(Math.max(4.8, clusterRadius * 0.84), 0.54, 10, 44),
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
          new THREE.CylinderGeometry(clusterRadius * 0.84, clusterRadius * 0.84, Math.max(2.8, 5.4 * DEFENDER_SOLDIER_VISUAL_SCALE), 30, 1, true),
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

    const movingSourceId = ghost?._mode === 'move' && typeof ghost?._sourceId === 'string' ? ghost._sourceId : '';
    walls.forEach((wall) => {
      const isMovingSource = !!movingSourceId && wall.id === movingSourceId;
      const isSelected = editMode && effectiveCanEdit && !ghost && selectedWallId && wall.id === selectedWallId;
      buildWallMesh(wall, isMovingSource ? { sourceShadow: true } : { selected: isSelected });
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
        const highlight = resolveSnapHighlightFacePoints(anchor, snapState, itemCatalogById);
        if (highlight?.points?.length === 4) {
          const pointRows = highlight.points;
          const vertices = new Float32Array(pointRows.flatMap((p) => [p.x, p.y, p.z]));
          const faceGeometry = new THREE.BufferGeometry();
          faceGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          faceGeometry.setIndex([0, 1, 2, 0, 2, 3]);
          faceGeometry.computeVertexNormals();
          const faceMesh = new THREE.Mesh(
            faceGeometry,
            new THREE.MeshBasicMaterial({
              color: 0x38bdf8,
              transparent: true,
              opacity: highlight.kind === 'top' ? 0.12 : 0.16,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          );
          worldGroup.add(faceMesh);
          const edgeLoop = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pointRows.map((p) => new THREE.Vector3(p.x, p.y, p.z + 0.06))),
            new THREE.LineBasicMaterial({
              color: 0x7dd3fc,
              transparent: true,
              opacity: 0.92
            })
          );
          worldGroup.add(edgeLoop);
        }
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
    snapState,
    viewport,
    cameraAngle,
    cameraYaw,
    zoom,
    worldScale,
    fieldHeight,
    fieldWidth,
    editMode,
    effectiveCanEdit,
    itemCatalogById,
    defenderRosterMap,
    defenderUnitTypesForFormation,
    selectedWallId,
    defenderDeployments,
    selectedDeploymentId,
    defenderDragPreview?.deployId,
    defenderDragPreview?.x,
    defenderDragPreview?.y,
    defenderDragPreview?.blocked,
    panWorld.x,
    panWorld.y,
    resolveDefenderDeploymentRadius
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
        const highlight = resolveSnapHighlightFacePoints(anchor, snapState, itemCatalogById);
        if (highlight?.points?.length === 4) {
          const projected = highlight.points.map((point) => projectOverlayPoint(point.x, point.y, point.z));
          drawPolygon(
            projected,
            highlight.kind === 'top' ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.11)',
            'rgba(56, 189, 248, 0.82)'
          );
        }
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
  }, [open, walls, defenderDeployments, defenderRosterMap, selectedDeploymentId, ghost, ghostBlocked, snapState, viewport, cameraAngle, cameraYaw, wallGroups, worldScale, fieldHeight, fieldWidth, invalidReason, editMode, effectiveCanEdit, selectedWallId, panWorld.x, panWorld.y, itemCatalogById]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && itemDetailModalItemId) {
        event.preventDefault();
        setItemDetailModalItemId('');
        return;
      }
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
  }, [activeDefenderMoveId, cancelGhostPlacement, ghost, itemDetailModalItemId, open]);

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
    mouseScreenRef.current = { x: point.x, y: point.y, valid: true };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;
    resolveMouseSnapHint(point.x, point.y);

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
      const sourceId = (
        ghost?._mode === 'move'
        && typeof ghost?._sourceId === 'string'
        && ghost._sourceId.trim()
      ) ? ghost._sourceId.trim() : '';
      const ignoreIds = sourceId ? [sourceId] : [];
      const blockedByBounds = isOutOfBounds(ghost, fieldWidth, fieldHeight, itemCatalogById);
      const blockedByCollision = !blockedByBounds && hasCollision(ghost, walls, itemCatalogById, ignoreIds);
      const blockedReason = blockedByBounds ? 'out_of_bounds' : (blockedByCollision ? 'collision' : '');
      if (ghostBlocked || blockedByBounds || blockedByCollision) {
        const reasonText = getPlacementReasonText(blockedReason || invalidReason) || '当前位置无法放置';
        setMessage(reasonText);
        setGhost(ghost);
        setGhostBlocked(true);
        setSnapState(snapState);
        setInvalidReason(blockedReason || invalidReason || '');
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
      const nextWall = createWallFromLike(ghost, {
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
            ? {
              x: Number(selectedDeployment?.x) || 0,
              y: Number(selectedDeployment?.y) || 0,
              rotation: normalizeDefenderFacingDeg(selectedDeployment?.rotation)
            }
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
        || findTopWallAtPoint(world, walls, itemCatalogById);
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
    mouseScreenRef.current = { x: point.x, y: point.y, valid: true };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;
    resolveMouseSnapHint(point.x, point.y);

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

  const handleCanvasDoubleClick = useCallback((event) => {
    if (editMode || !effectiveCanEdit) return;
    event.preventDefault();
    event.stopPropagation();
    startLayoutEditing();
    setMessage('已通过双击战场进入布置模式');
  }, [editMode, effectiveCanEdit, startLayoutEditing]);

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
      rotation: normalizeDefenderFacingDeg(
        (Array.isArray(defenderDeployments) ? defenderDeployments : []).find((item) => item?.deployId === deployId)?.rotation
      ),
      blocked
    });
  }, [defenderDeployments, defenderZoneMinX, editMode, effectiveCanEdit, fieldHeight, fieldWidth, getWorldFromScreenPoint, sidebarTab]);

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
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (rect) {
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        mouseScreenRef.current = { x: sx, y: sy, valid: true };
        if (ghost) {
          resolveMouseSnapHint(sx, sy);
        }
      }
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
      const panRect = canvasRef.current?.getBoundingClientRect();
      if (!panRect) return;
      const sx = event.clientX - panRect.left;
      const sy = event.clientY - panRect.top;
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
  }, [cancelGhostPlacement, clearPanDragging, clearRotateDragging, getPanDeltaFromScreenPoints, getWorldFromScreenPoint, ghost, open, resolveMouseSnapHint]);

  const handleWheel = (event) => {
    event.preventDefault();
    const pointer = mouseScreenRef.current;
    if (pointer?.valid) {
      resolveMouseSnapHint(pointer.x, pointer.y);
    }
    if (!ghost && editMode && effectiveCanEdit) {
      const rotatingDeployId = activeDefenderMoveId || selectedDeploymentId;
      if (rotatingDeployId) {
        const delta = event.deltaY < 0 ? ROTATE_STEP : -ROTATE_STEP;
        let nextDeg = DEFENDER_DEFAULT_FACING_DEG;
        setDefenderDeployments((prev) => sanitizeDefenderDeployments(prev).map((item) => {
          if (item.deployId !== rotatingDeployId) return item;
          nextDeg = normalizeDefenderFacingDeg(item.rotation + delta);
          return { ...item, rotation: nextDeg };
        }));
        setDefenderDragPreview((prev) => (
          prev && prev.deployId === rotatingDeployId
            ? { ...prev, rotation: nextDeg }
            : prev
        ));
        setHasDraftChanges(true);
        setMessage(`守军朝向 ${Math.round(nextDeg)}°`);
        return;
      }
    }
    if (!ghost) {
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      animateZoomTo((zoomTargetRef.current || zoom) + delta);
      setMessage(`缩放 ${Math.round(zoomTargetRef.current * 100)}%`);
      return;
    }
    if (!effectiveCanEdit) return;

    const wheelDelta = event.deltaY < 0 ? ROTATE_STEP : -ROTATE_STEP;
    const hoveredAnchorId = getHintAnchorId(mouseSnapHintRef.current);
    const isSnappedToHoveredAnchor = (
      typeof snapState?.anchorId === 'string'
      && !!snapState.anchorId
      && snapState.anchorId === hoveredAnchorId
    );

    if (snapState?.type === 'pillar-face' && isSnappedToHoveredAnchor) {
      const nextMode = ghost?._pillarSnapMode === 'short' ? 'long' : 'short';
      const nextGhost = {
        ...ghost,
        _pillarSnapMode: nextMode
      };
      const evaluated = evaluateGhostPlacement(
        nextGhost,
        walls,
        mouseWorldRef.current,
        fieldWidth,
        fieldHeight,
        itemCatalogById,
        mouseSnapHintRef.current
      );
      setGhost(evaluated.ghost);
      setGhostBlocked(evaluated.blocked);
      setSnapState(evaluated.snap);
      setInvalidReason(evaluated.reason || '');
      setMessage(nextMode === 'long' ? '木制梁吸附模式：长端贴面（可沿面左右移动）' : '木制梁吸附模式：短端贴面');
      return;
    }

    const lockRotation = snapState?.type === 'top';
    if (lockRotation) {
      const anchor = walls.find((item) => item.id === snapState?.anchorId);
      if (anchor) {
        setGhost((prevGhost) => (
          prevGhost
            ? { ...prevGhost, rotation: anchor.rotation }
            : prevGhost
        ));
      }
      return;
    }

    if (isSnappedToHoveredAnchor && snapState?.type && snapState.type !== 'top') {
      const maxProbeCount = Math.max(1, Math.round(360 / Math.max(0.1, Math.abs(wheelDelta))));
      let probeGhost = { ...ghost };
      let matched = null;
      for (let i = 0; i < maxProbeCount; i += 1) {
        probeGhost = {
          ...probeGhost,
          rotation: normalizeDeg((Number(probeGhost?.rotation) || 0) + wheelDelta)
        };
        const evaluated = evaluateGhostPlacement(
          probeGhost,
          walls,
          mouseWorldRef.current,
          fieldWidth,
          fieldHeight,
          itemCatalogById,
          mouseSnapHintRef.current
        );
        const nextAnchorId = getHintAnchorId(mouseSnapHintRef.current);
        if (!nextAnchorId || nextAnchorId !== snapState.anchorId) break;
        if (
          evaluated?.snap
          && evaluated.snap.anchorId === snapState.anchorId
          && evaluated.snap.type !== 'top'
        ) {
          matched = evaluated;
          break;
        }
      }
      if (matched) {
        setGhost(matched.ghost);
        setGhostBlocked(matched.blocked);
        setSnapState(matched.snap);
        setInvalidReason(matched.reason || '');
        setMessage(`吸附转向 ${Math.round(Number(matched?.ghost?.rotation) || 0)}°`);
        return;
      }
      setMessage('当前吸附面没有可用转向');
      return;
    }

    setGhost((prevGhost) => (
      prevGhost
        ? { ...prevGhost, rotation: normalizeDeg((Number(prevGhost?.rotation) || 0) + wheelDelta) }
        : prevGhost
    ));
  };

  useEffect(() => {
    if (!ghost) return;
    const pointer = mouseScreenRef.current;
    if (pointer?.valid) {
      resolveMouseSnapHint(pointer.x, pointer.y);
    }
    syncGhostByMouse(ghost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldHeight, fieldWidth, ghost?.rotation, walls, cameraAngle, cameraYaw, resolveMouseSnapHint]);

  const selectedDefenderDeployment = defenderDeploymentRows.find((item) => item.deployId === selectedDeploymentId) || null;

  if (!open) return null;

  const overlayStyle = Number.isFinite(Number(overlayTopOffsetPx))
    ? {
        '--battlefield-modal-top': `${Math.max(16, Math.floor(Number(overlayTopOffsetPx)))}px`,
        '--battlefield-modal-top-mobile': `${Math.max(12, Math.floor(Number(overlayTopOffsetPx) - 6))}px`
      }
    : null;

  return (
    <div
      className="battlefield-modal-overlay"
      style={overlayStyle}
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
                <strong>{defenderEditingDeployId ? '编辑守城部队' : '新建守城部队'}</strong>
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
                {`总兵力 ${defenderEditorTotalCount}。确定后会生成或更新守军部队卡片；可通过卡片右上角“编辑/删除”管理部队，若该部队已部署会自动从战场撤回。`}
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
                    const canPickItem = !!(effectiveCanEdit && editMode && stockMeta.remaining > 0);
                    return (
                      <article
                        key={item.itemId}
                        className={`battlefield-item-card ${selectedPaletteItem === item.itemId && ghost ? 'selected' : ''} ${canPickItem ? '' : 'is-disabled'}`}
                        onClick={() => {
                          if (canPickItem) pickPaletteItem(item.itemId);
                        }}
                      >
                        <div className="battlefield-item-card-head">
                          <strong>{item.name || item.itemId}</strong>
                          <button
                            type="button"
                            className="battlefield-item-detail-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setItemDetailModalItemId(item.itemId);
                            }}
                          >
                            详情
                          </button>
                        </div>
                        <button
                          type="button"
                          className="battlefield-item-card-main"
                          disabled={!canPickItem}
                        >
                          <span>{`库存 ${stockMeta.remaining}/${stockMeta.limit}`}</span>
                          <span>{`属性 ${item.hp} / ${roundTo(item.defense, 2)}`}</span>
                        </button>
                      </article>
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
                    <article
                      key={`def-deploy-${item.deployId}`}
                      className={`battlefield-item-card battlefield-defender-card ${selectedDeploymentId === item.deployId ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedDeploymentId(item.deployId);
                        setSelectedWallId('');
                        cancelGhostPlacement('');
                        if (editMode && effectiveCanEdit) {
                          const pickupPoint = {
                            x: Number(mouseWorldRef.current?.x) || Number(item?.x) || 0,
                            y: Number(mouseWorldRef.current?.y) || Number(item?.y) || 0,
                            rotation: normalizeDefenderFacingDeg(item?.rotation)
                          };
                          const nextPreview = resolveDefenderMovePreview(item.deployId, pickupPoint) || {
                            deployId: item.deployId,
                            x: pickupPoint.x,
                            y: pickupPoint.y,
                            rotation: pickupPoint.rotation,
                            blocked: pickupPoint.x < defenderZoneMinX,
                            reason: pickupPoint.x < defenderZoneMinX ? 'zone' : ''
                          };
                          setActiveDefenderMoveId(item.deployId);
                          setDefenderDragPreview(nextPreview);
                          setMessage(
                            item.placed !== false
                              ? `已选中并拾取守军部队：${item.teamName}，鼠标左键在右侧蓝色区域放置`
                              : `已拾取守军部队：${item.teamName}，鼠标左键在右侧蓝色区域放置`
                          );
                        } else {
                          setActiveDefenderMoveId('');
                          setDefenderDragPreview(null);
                          setMessage(`已选中守军部队：${item.teamName}。请先点击“布置战场”再进行部署`);
                        }
                      }}
                      onDoubleClick={() => {
                        startEditDefenderDeployment(item.deployId);
                      }}
                    >
                      <div className="battlefield-defender-card-head">
                        <strong>{`${item.teamName} · #${item.sortOrder}`}</strong>
                        <div className="battlefield-defender-card-actions">
                          <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            disabled={!effectiveCanEdit}
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditDefenderDeployment(item.deployId);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn-small btn-warning"
                            disabled={!effectiveCanEdit}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeDefenderDeployment(item.deployId);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <span>{`总兵力 ${item.totalCount}`}</span>
                      <span>{item.unitSummary || '未配置兵种'}</span>
                      <span>{item.placed !== false ? '状态 已部署' : '状态 未部署'}</span>
                      <span>{item.placed !== false ? `坐标 (${Math.round(item.x)}, ${Math.round(item.y)})` : '坐标 -'}</span>
                    </article>
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
                              ? `已选中：${selectedDefenderDeployment.teamName}（#${selectedDefenderDeployment.sortOrder}）。点击卡片即可拾取，鼠标左键在右侧蓝色区域放置。`
                              : `已选中：${selectedDefenderDeployment.teamName}（未部署）。点击卡片拾取后，鼠标左键在右侧蓝色区域放置。`
                          )
                          : `已选中：${selectedDefenderDeployment.teamName}。请先点击“布置战场”后再部署到地图。`
                      )
                      : (editMode ? '先新建守军部队，再点击部队卡片拾取并放置到右侧蓝色守方区域' : '先新建守军部队；进入“布置战场”后可点击部队卡片进行部署')}
                  </div>
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
              onDoubleClick={handleCanvasDoubleClick}
              onMouseUp={clearPanDragging}
              onMouseLeave={clearPanDragging}
              onWheel={handleWheel}
            />
          </div>
        </div>

        <div className="battlefield-footer">
          <span>{errorText || message || getPlacementReasonText(invalidReason) || '提示: 右键按住并拖动可旋转战场；右键点击可取消放置；Space+左键或中键平移；滚轮缩放/旋转'}</span>
        </div>
        {itemDetailModalItem && (
          <div
            className="battlefield-item-detail-overlay"
            onClick={() => setItemDetailModalItemId('')}
          >
            <div
              className="battlefield-item-detail-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="battlefield-item-detail-head">
                <div>
                  <strong>{itemDetailModalItem.name || itemDetailModalItem.itemId}</strong>
                  <span>{itemDetailModalItem.itemId}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={() => setItemDetailModalItemId('')}
                >
                  关闭
                </button>
              </div>
              {itemDetailModalItem.description && (
                <div className="battlefield-item-detail-desc">{itemDetailModalItem.description}</div>
              )}
              <div className="battlefield-item-detail-grid">
                <div className="battlefield-item-detail-row">
                  <span>尺寸</span>
                  <em>{`${Math.round(itemDetailModalItem.width)} × ${Math.round(itemDetailModalItem.depth)} × ${Math.round(itemDetailModalItem.height)}`}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>基础属性</span>
                  <em>{`HP ${itemDetailModalItem.hp} / 防御 ${roundTo(itemDetailModalItem.defense, 2)}`}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>库存</span>
                  <em>{itemDetailModalStock ? `${itemDetailModalStock.remaining}/${itemDetailModalStock.limit}` : '-'}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>样式</span>
                  <em>{`${itemDetailModalItem?.style?.shape || '-'} / ${itemDetailModalItem?.style?.material || '-'}`}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>碰撞体</span>
                  <em>{`${itemDetailModalItem?.collider?.kind || '-'} (${itemDetailColliderPartCount})`}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>插槽数</span>
                  <em>{itemDetailSocketCount}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>堆叠上限</span>
                  <em>{itemDetailModalItem?.maxStack ?? '无限制'}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>需要支撑</span>
                  <em>{itemDetailModalItem?.requiresSupport ? '是' : '否'}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>吸附优先级</span>
                  <em>{Number.isFinite(Number(itemDetailModalItem?.snapPriority)) ? Number(itemDetailModalItem.snapPriority) : 0}</em>
                </div>
                <div className="battlefield-item-detail-row">
                  <span>交互效果</span>
                  <em>{itemDetailInteractionLabels.length > 0 ? itemDetailInteractionLabels.join(' / ') : '无'}</em>
                </div>
              </div>
            </div>
          </div>
        )}
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
