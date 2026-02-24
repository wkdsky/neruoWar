import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
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
const TOTAL_WOOD_WALL_STOCK = 10;
const SNAP_EPSILON = 1.2;
const CACHE_VERSION = 1;
const CACHE_PREFIX = 'battlefield_layout_cache_v1';
const PALETTE_WALL_TEMPLATE = {
  itemType: 'wood_wall',
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

const buildDefaultWalls = (
  fieldWidth = FIELD_WIDTH,
  fieldHeight = FIELD_HEIGHT,
  template = {}
) => {
  const safeWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
  const safeHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
  const width = Math.max(20, Number(template?.width) || WALL_WIDTH);
  const depth = Math.max(12, Number(template?.depth) || WALL_DEPTH);
  const height = Math.max(14, Number(template?.height) || WALL_HEIGHT);
  const hp = Math.max(1, Math.floor(Number(template?.hp) || BASE_HP));
  const defense = Math.max(0.1, Number(template?.defense) || BASE_DEFENSE);
  const walls = [];
  const columns = 5;
  const rows = 2;
  const marginX = Math.max(40, width * 0.6);
  const marginY = Math.max(40, depth * 1.5);
  const usableWidth = Math.max(width * (columns - 1), safeWidth - (marginX * 2));
  const usableHeight = Math.max(depth * (rows - 1), Math.min(safeHeight * 0.6, safeHeight - (marginY * 2)));
  for (let i = 0; i < TOTAL_WOOD_WALL_STOCK; i += 1) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    walls.push({
      id: `wall_${i + 1}`,
      itemType: 'wood_wall',
      x: roundTo((-usableWidth / 2) + ((usableWidth / (columns - 1)) * col), 3),
      y: roundTo((-usableHeight / 2) + ((usableHeight / (rows - 1)) * row), 3),
      z: 0,
      rotation: row % 2 === 0 ? 0 : 90,
      width,
      depth,
      height,
      hp,
      defense
    });
  }
  return walls;
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
    message: typeof payload.message === 'string' ? payload.message : ''
  };
  localStorage.setItem(getBattlefieldCacheKey(nodeId, gateKey), JSON.stringify(cachePayload));
};

const createWallFromLike = (wallLike = {}, overrides = {}) => ({
  id: overrides.id || `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  itemType: typeof (overrides.itemType ?? wallLike.itemType) === 'string'
    ? String(overrides.itemType ?? wallLike.itemType).trim() || 'wood_wall'
    : 'wood_wall',
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
      itemType: typeof item?.itemType === 'string' ? item.itemType : (typeof item?.type === 'string' ? item.type : 'wood_wall'),
      z: Math.max(0, Math.min(MAX_STACK_LEVEL - 1, Math.floor(Number(item?.z) || 0)))
    });
    if (seen.has(next.id)) return;
    seen.add(next.id);
    out.push(next);
  });
  return out;
};

const cloneWalls = (sourceWalls = []) => (
  sanitizeWalls(sourceWalls).map((item) => ({ ...item }))
);

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
    const itemType = typeof item?.itemType === 'string' && item.itemType.trim()
      ? item.itemType.trim()
      : (typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : '');
    if (!itemType || seen.has(itemType)) return;
    seen.add(itemType);
    out.push({
      itemType,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : itemType,
      width: Math.max(12, Number(item?.width) || WALL_WIDTH),
      depth: Math.max(12, Number(item?.depth) || WALL_DEPTH),
      height: Math.max(10, Number(item?.height) || WALL_HEIGHT),
      hp: Math.max(1, Math.floor(Number(item?.hp) || BASE_HP)),
      defense: Math.max(0.1, Number(item?.defense) || BASE_DEFENSE)
    });
  });
  if (out.length === 0) {
    return [{
      itemType: 'wood_wall',
      name: '木墙',
      width: WALL_WIDTH,
      depth: WALL_DEPTH,
      height: WALL_HEIGHT,
      hp: BASE_HP,
      defense: BASE_DEFENSE
    }];
  }
  return out;
};

const mapLayoutBundleToWalls = (layoutBundle = {}) => {
  const sourceObjects = Array.isArray(layoutBundle?.objects) ? layoutBundle.objects : [];
  if (sourceObjects.length === 0) return [];
  const itemCatalog = normalizeItemCatalog(layoutBundle?.itemCatalog);
  const itemDefByType = new Map(itemCatalog.map((item) => [item.itemType, item]));
  return sanitizeWalls(sourceObjects.map((item, index) => {
    const itemType = typeof item?.itemType === 'string' && item.itemType.trim()
      ? item.itemType.trim()
      : (typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : 'wood_wall');
    const itemDef = itemDefByType.get(itemType) || itemCatalog[0];
    return {
      id: typeof item?.id === 'string' && item.id.trim()
        ? item.id.trim()
        : (typeof item?.objectId === 'string' && item.objectId.trim()
          ? item.objectId.trim()
          : `wall_${index + 1}`),
      itemType,
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

const buildLayoutPayload = ({ walls = [], layoutMeta = {}, itemCatalog = [], gateKey = '' } = {}) => ({
  gateKey,
  layout: {
    layoutId: typeof layoutMeta?.layoutId === 'string' ? layoutMeta.layoutId : '',
    name: typeof layoutMeta?.name === 'string' ? layoutMeta.name : '',
    fieldWidth: Number.isFinite(Number(layoutMeta?.fieldWidth)) ? Number(layoutMeta.fieldWidth) : FIELD_WIDTH,
    fieldHeight: Number.isFinite(Number(layoutMeta?.fieldHeight)) ? Number(layoutMeta.fieldHeight) : FIELD_HEIGHT,
    maxItemsPerType: Number.isFinite(Number(layoutMeta?.maxItemsPerType))
      ? Math.max(TOTAL_WOOD_WALL_STOCK, Math.floor(Number(layoutMeta.maxItemsPerType)))
      : TOTAL_WOOD_WALL_STOCK
  },
  itemCatalog: normalizeItemCatalog(itemCatalog).map((item) => ({
    itemType: item.itemType,
    name: item.name,
    width: roundTo(item.width, 3),
    depth: roundTo(item.depth, 3),
    height: roundTo(item.height, 3),
    hp: Math.max(1, Math.floor(Number(item.hp) || BASE_HP)),
    defense: roundTo(Math.max(0.1, Number(item.defense) || BASE_DEFENSE), 3)
  })),
  objects: sanitizeWalls(walls).map((item) => ({
    objectId: item.id,
    itemType: item.itemType || 'wood_wall',
    x: roundTo(item.x, 3),
    y: roundTo(item.y, 3),
    z: Math.max(0, Math.floor(Number(item.z) || 0)),
    rotation: roundTo(item.rotation, 3)
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
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const panWorldRef = useRef({ x: 0, y: 0 });
  const editSessionWallsRef = useRef(null);
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
  const [selectedWallId, setSelectedWallId] = useState('');
  const [activeLayoutMeta, setActiveLayoutMeta] = useState({
    layoutId: '',
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: TOTAL_WOOD_WALL_STOCK
  });
  const defaultLayoutMeta = useMemo(() => ({
    layoutId: `${gateKey || 'cheng'}_default`,
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: TOTAL_WOOD_WALL_STOCK
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
  const maxItemsPerType = Math.max(
    TOTAL_WOOD_WALL_STOCK,
    Math.floor(Number(activeLayoutMeta?.maxItemsPerType) || TOTAL_WOOD_WALL_STOCK)
  );
  const wallStockRemaining = useMemo(
    () => Math.max(0, maxItemsPerType - walls.length),
    [maxItemsPerType, walls.length]
  );
  const woodWallItem = useMemo(() => {
    const list = normalizeItemCatalog(itemCatalog);
    return list.find((item) => item.itemType === 'wood_wall') || list[0];
  }, [itemCatalog]);
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

  const pickPaletteItem = useCallback((itemType) => {
    if (!effectiveCanEdit || !editMode) return;
    if (!itemType) return;
    if (wallStockRemaining <= 0) {
      setMessage('木墙库存不足，无法继续放置');
      return;
    }
    const itemDef = normalizeItemCatalog(itemCatalog).find((item) => item.itemType === itemType) || woodWallItem;
    if (!itemDef) return;
    const nextGhost = createWallFromLike(PALETTE_WALL_TEMPLATE, {
      itemType,
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
    setSelectedPaletteItem(itemType);
    setGhost({
      ...evaluated.ghost,
      _mode: 'create'
    });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    setMessage('已选中木墙：左键放置，右键或 ESC 取消，滚轮旋转，Space+左键平移');
  }, [effectiveCanEdit, editMode, wallStockRemaining, itemCatalog, woodWallItem, walls, fieldWidth, fieldHeight]);

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
    setSelectedPaletteItem(wallLike.itemType || 'wood_wall');
    setMessage('移动模式：左键确认位置，右键或 ESC 取消');
  }, [fieldHeight, fieldWidth, walls]);

  const recycleWallToPalette = useCallback((wallId) => {
    if (!wallId) return;
    setWalls((prev) => prev.filter((item) => item.id !== wallId));
    setHasDraftChanges(true);
    setSelectedWallId('');
    cancelGhostPlacement('');
    setMessage('木墙已回收到物品栏');
  }, [cancelGhostPlacement]);

  const persistBattlefieldLayout = useCallback(async (nextWalls = [], options = {}) => {
    if (!open || !nodeId) return { ok: false };
    const silent = options?.silent !== false;
    const layoutMetaForSave = options?.layoutMeta || activeLayoutMeta;
    const itemCatalogForSave = options?.itemCatalog || itemCatalog;
    const sanitizedWalls = sanitizeWalls(nextWalls);
    writeBattlefieldCache(nodeId, gateKey, {
      walls: sanitizedWalls,
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
  }, [activeLayoutMeta, effectiveCanEdit, gateKey, itemCatalog, nodeId, open]);

  const startLayoutEditing = useCallback(() => {
    if (!effectiveCanEdit) return;
    editSessionWallsRef.current = cloneWalls(walls);
    setHasDraftChanges(false);
    setEditMode(true);
    setSelectedWallId('');
    animateCameraAngle(CAMERA_ANGLE_EDIT);
    cancelGhostPlacement('');
    setMessage('布置模式已开启：完成后请点击“保存布置”');
  }, [animateCameraAngle, cancelGhostPlacement, effectiveCanEdit, walls]);

  const cancelLayoutEditing = useCallback(() => {
    const snapshotWalls = editSessionWallsRef.current;
    if (Array.isArray(snapshotWalls)) {
      setWalls(cloneWalls(snapshotWalls));
    }
    editSessionWallsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    setSelectedWallId('');
    animateCameraAngle(CAMERA_ANGLE_PREVIEW);
    cancelGhostPlacement('');
    setMessage('已取消布置，已恢复到上一次战场布置状态');
  }, [animateCameraAngle, cancelGhostPlacement]);

  const saveLayoutEditing = useCallback(async () => {
    if (!effectiveCanEdit) return;
    cancelGhostPlacement('');
    if (!hasDraftChanges) {
      editSessionWallsRef.current = null;
      setEditMode(false);
      setSelectedWallId('');
      animateCameraAngle(CAMERA_ANGLE_PREVIEW);
      setMessage('布置内容无变化');
      return;
    }
    const result = await persistBattlefieldLayout(walls, { silent: false });
    if (!result?.ok) return;
    editSessionWallsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    setSelectedWallId('');
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
            ? Math.max(TOTAL_WOOD_WALL_STOCK, Math.floor(Number(localCache.layoutMeta.maxItemsPerType)))
            : TOTAL_WOOD_WALL_STOCK
        }
        : defaultLayoutMeta;
      const cachedWallsRaw = sanitizeWalls(localCache?.walls);
      const defaultTemplate = cachedCatalog.find((item) => item.itemType === 'wood_wall') || PALETTE_WALL_TEMPLATE;
      const cachedWalls = cachedWallsRaw.length > 0
        ? cachedWallsRaw
        : buildDefaultWalls(cachedMeta.fieldWidth, cachedMeta.fieldHeight, defaultTemplate);
      return {
        walls: cachedWalls,
        itemCatalog: cachedCatalog,
        layoutMeta: cachedMeta,
        needsSync: !!localCache?.needsSync
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
          setItemCatalog(cacheSnapshot.itemCatalog);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setServerCanEdit(!!canEdit);
          setCacheNeedsSync(cacheSnapshot.needsSync);
          setLoadingLayout(false);
          setLayoutReady(true);
          if (cacheSnapshot.needsSync) {
            setMessage('本地存在待同步布局，登录后将自动同步');
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
          setItemCatalog(cacheSnapshot.itemCatalog);
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
            ? Math.max(TOTAL_WOOD_WALL_STOCK, Number(layoutBundle.activeLayout.maxItemsPerType))
            : TOTAL_WOOD_WALL_STOCK
        };
        const serverWallsRaw = mapLayoutBundleToWalls(layoutBundle);
        const defaultTemplate = nextCatalog.find((item) => item.itemType === 'wood_wall') || PALETTE_WALL_TEMPLATE;
        const serverWalls = serverWallsRaw.length > 0
          ? serverWallsRaw
          : buildDefaultWalls(serverLayoutMeta.fieldWidth, serverLayoutMeta.fieldHeight, defaultTemplate);
        const canEditByServer = !!data.canEdit;
        setServerCanEdit(canEditByServer);

        if (cacheSnapshot.needsSync && canEditByServer) {
          setWalls(cacheSnapshot.walls);
          setItemCatalog(cacheSnapshot.itemCatalog);
          setActiveLayoutMeta(cacheSnapshot.layoutMeta);
          setCacheNeedsSync(true);
          pendingCacheSyncRef.current = {
            walls: cacheSnapshot.walls,
            layoutMeta: cacheSnapshot.layoutMeta,
            itemCatalog: cacheSnapshot.itemCatalog
          };
          setMessage('检测到离线改动，正在尝试回写服务端');
        } else {
          setWalls(serverWalls);
          setItemCatalog(nextCatalog);
          setActiveLayoutMeta(serverLayoutMeta);
          setCacheNeedsSync(false);
          writeBattlefieldCache(nodeId, gateKey, {
            walls: serverWalls,
            itemCatalog: nextCatalog,
            layoutMeta: serverLayoutMeta,
            needsSync: false
          });
        }
        setErrorText('');
      } catch (error) {
        if (cancelled) return;
        const cacheSnapshot = resolveCacheSnapshot();
        setWalls(cacheSnapshot.walls);
        setItemCatalog(cacheSnapshot.itemCatalog);
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
      itemCatalog: payload.itemCatalog
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
      const baseZ = getWallBaseZ(wallLike);
      const selected = !!options.selected;
      const ghostMode = !!options.ghost;
      const blocked = !!options.blocked;
      const color = ghostMode
        ? (blocked ? 0xb91c1c : 0xf59e0b)
        : (selected ? 0x60a5fa : 0xc2783c);
      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(20, Number(wallLike.width) || WALL_WIDTH),
          Math.max(12, Number(wallLike.depth) || WALL_DEPTH),
          safeHeight
        ),
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
      wallMesh.position.set(
        Number(wallLike.x) || 0,
        Number(wallLike.y) || 0,
        baseZ + (safeHeight / 2)
      );
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

    walls.forEach((wall) => {
      const isSelected = editMode && effectiveCanEdit && !ghost && selectedWallId && wall.id === selectedWallId;
      buildWallMesh(wall, { selected: isSelected });
    });

    if (ghost) {
      buildWallMesh(ghost, { ghost: true, blocked: ghostBlocked });
    }
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
    selectedWallId,
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
  }, [open, walls, ghost, ghostBlocked, snapState, viewport, cameraAngle, cameraYaw, wallGroups, worldScale, fieldHeight, fieldWidth, invalidReason, editMode, effectiveCanEdit, selectedWallId, panWorld.x, panWorld.y]);

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
  }, [cancelGhostPlacement, ghost, open]);

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
      if (ghost?._mode !== 'move' && wallStockRemaining <= 0) {
        setMessage('木墙库存不足，无法放置');
        return;
      }
      const nextWall = createWallFromLike(evaluated.ghost, {
        id: ghost?._sourceId || undefined
      });
      if (ghost?._mode === 'move' && ghost?._sourceId) {
        setWalls((prev) => prev.map((item) => (item.id === ghost._sourceId ? nextWall : item)));
        setHasDraftChanges(true);
        cancelGhostPlacement('');
        setMessage('木墙位置已更新');
      } else {
        setWalls((prev) => [...prev, nextWall]);
        setHasDraftChanges(true);
        cancelGhostPlacement('');
        setMessage('木墙已放置');
      }
      return;
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
        cancelGhostPlacement('');
        setMessage('已选中木墙：点击头顶图标可移动或回收');
        return;
      }
      if (selectedWallId) {
        setSelectedWallId('');
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
  };

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
          <span>{`已放置木墙 ${walls.length}`}</span>
          <span>{`木墙库存 ${wallStockRemaining}/${maxItemsPerType}`}</span>
          <span>{`堆叠上限 ${MAX_STACK_LEVEL} 层`}</span>
          <span>{editMode && hasDraftChanges ? '布置中：有未保存改动' : (cacheNeedsSync ? '离线缓存待同步' : '已与服务端同步')}</span>
          <span>{savingLayout ? '保存中...' : '群组数值显示: 血量 / 防御'}</span>
        </div>

        <div className="battlefield-main">
          <aside className="battlefield-sidebar">
            <div className="battlefield-sidebar-title">战场物品</div>
            <button
              type="button"
              className={`battlefield-item-card ${selectedPaletteItem === 'wood_wall' && ghost ? 'selected' : ''}`}
              disabled={!effectiveCanEdit || !editMode || wallStockRemaining <= 0}
              onClick={() => pickPaletteItem('wood_wall')}
            >
              <strong>木墙</strong>
              <span>{`库存 ${wallStockRemaining}/${maxItemsPerType}`}</span>
              <span>{`属性 ${woodWallItem?.hp || BASE_HP} / ${roundTo(woodWallItem?.defense || BASE_DEFENSE, 2)}`}</span>
            </button>
            <div className="battlefield-sidebar-tip">
              {!effectiveCanEdit
                ? '当前仅预览'
                : (!editMode ? '点击“布置战场”后可选择物品' : '点已放置木墙会出现“移动/回收(X)”图标；点选物品后左键放置')}
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
      </div>
    </div>
  );
};

export default BattlefieldPreviewModal;
