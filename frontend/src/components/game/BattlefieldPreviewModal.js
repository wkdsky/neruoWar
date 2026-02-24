import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './BattlefieldPreviewModal.css';

const CAMERA_ANGLE_PREVIEW = 45;
const CAMERA_ANGLE_EDIT = 75;
const FIELD_WIDTH = 900;
const FIELD_HEIGHT = 620;
const MAX_STACK_LEVEL = 5;
const BASE_DEFENSE = 1.1;
const BASE_HP = 240;
const WALL_WIDTH = 104;
const WALL_DEPTH = 24;
const WALL_HEIGHT = 42;
const STACK_PROJECTION_HEIGHT = 40;
const ROTATE_STEP = 15;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const DEFAULT_ZOOM = 1;
const ZOOM_STEP = 0.08;
const BASELINE_FIELD_COVERAGE = 0.85;
const API_BASE = 'http://localhost:5000';
const TOTAL_WOOD_WALL_STOCK = 10;
const PALETTE_WALL_TEMPLATE = {
  itemType: 'wood_wall',
  width: WALL_WIDTH,
  depth: WALL_DEPTH,
  height: WALL_HEIGHT,
  hp: BASE_HP,
  defense: BASE_DEFENSE
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

const getCameraBlend = (angleDeg) => Math.max(
  0,
  Math.min(1, (Number(angleDeg) - CAMERA_ANGLE_PREVIEW) / (CAMERA_ANGLE_EDIT - CAMERA_ANGLE_PREVIEW))
);

const getGroundYScale = (angleDeg) => {
  const blend = getCameraBlend(angleDeg);
  return 0.68 - (blend * 0.36);
};

const buildDefaultWalls = () => {
  const walls = [];
  for (let i = 0; i < 10; i += 1) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    walls.push({
      id: `wall_${i + 1}`,
      itemType: 'wood_wall',
      x: -240 + (col * 120),
      y: -78 + (row * 170),
      z: 0,
      rotation: row % 2 === 0 ? 0 : 90,
      width: WALL_WIDTH,
      depth: WALL_DEPTH,
      height: WALL_HEIGHT,
      hp: BASE_HP,
      defense: BASE_DEFENSE
    });
  }
  return walls;
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

const isLegacyDefaultDeployment = (walls = []) => {
  const current = sanitizeWalls(walls);
  const defaults = buildDefaultWalls();
  if (current.length !== defaults.length) return false;

  const byIdCurrent = new Map(current.map((item) => [item.id, item]));
  for (const item of defaults) {
    const target = byIdCurrent.get(item.id);
    if (!target) return false;
    if (roundTo(target.x, 1) !== roundTo(item.x, 1)) return false;
    if (roundTo(target.y, 1) !== roundTo(item.y, 1)) return false;
    if (target.z !== item.z) return false;
    if (roundTo(target.rotation, 1) !== roundTo(item.rotation, 1)) return false;
    if (roundTo(target.width, 1) !== roundTo(item.width, 1)) return false;
    if (roundTo(target.depth, 1) !== roundTo(item.depth, 1)) return false;
    if (roundTo(target.height, 1) !== roundTo(item.height, 1)) return false;
  }
  return true;
};

const buildLayoutPayload = ({ walls = [], layoutMeta = {}, itemCatalog = [], gateKey = '' } = {}) => ({
  gateKey,
  layout: {
    layoutId: typeof layoutMeta?.layoutId === 'string' ? layoutMeta.layoutId : '',
    name: typeof layoutMeta?.name === 'string' ? layoutMeta.name : '',
    fieldWidth: Number.isFinite(Number(layoutMeta?.fieldWidth)) ? Number(layoutMeta.fieldWidth) : FIELD_WIDTH,
    fieldHeight: Number.isFinite(Number(layoutMeta?.fieldHeight)) ? Number(layoutMeta.fieldHeight) : FIELD_HEIGHT,
    maxItemsPerType: Number.isFinite(Number(layoutMeta?.maxItemsPerType))
      ? Math.max(0, Math.floor(Number(layoutMeta.maxItemsPerType)))
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

const projectWorld = (x, y, z, viewport, angleDeg, worldScale) => {
  const xr = x;
  const yr = y;
  const blend = getCameraBlend(angleDeg);
  const groundYScale = getGroundYScale(angleDeg);
  const stackHeight = STACK_PROJECTION_HEIGHT + (blend * 18);
  return {
    x: viewport.centerX + viewport.panX + (xr * worldScale),
    y: viewport.centerY + viewport.panY + (yr * worldScale * groundYScale) - (z * stackHeight)
  };
};

const unprojectScreen = (sx, sy, viewport, angleDeg, worldScale) => {
  const groundYScale = getGroundYScale(angleDeg);
  const x = (sx - viewport.centerX - viewport.panX) / (worldScale || 1);
  const y = (sy - viewport.centerY - viewport.panY) / ((worldScale * groundYScale) || 1);
  return { x, y };
};

const getRectCorners = (centerX, centerY, width, depth, rotationDeg) => {
  const hw = width / 2;
  const hd = depth / 2;
  const rad = degToRad(rotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd }
  ];
  return pts.map((p) => ({
    x: centerX + (p.x * cos) - (p.y * sin),
    y: centerY + (p.x * sin) + (p.y * cos)
  }));
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

const projectOnAxis = (point, axis) => ((point.x * axis.x) + (point.y * axis.y));

const getProjectionRange = (corners, axis) => {
  let min = Infinity;
  let max = -Infinity;
  corners.forEach((p) => {
    const v = projectOnAxis(p, axis);
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  return { min, max };
};

const isRectOverlap = (rectA, rectB, epsilon = 0.4) => {
  const cornersA = getRectCorners(rectA.x, rectA.y, rectA.width, rectA.depth, rectA.rotation);
  const cornersB = getRectCorners(rectB.x, rectB.y, rectB.width, rectB.depth, rectB.rotation);
  const axes = [...buildAxesFromCorners(cornersA), ...buildAxesFromCorners(cornersB)];
  for (const axis of axes) {
    const a = getProjectionRange(cornersA, axis);
    const b = getProjectionRange(cornersB, axis);
    if (a.max <= b.min + epsilon || b.max <= a.min + epsilon) {
      return false;
    }
  }
  return true;
};

const toLocalByWall = (point, wall) => {
  const rad = degToRad(wall.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - wall.x;
  const dy = point.y - wall.y;
  return {
    x: (dx * cos) + (dy * sin),
    y: (-dx * sin) + (dy * cos)
  };
};

const getNearestRotation = (current, candidates) => {
  const normalizedCurrent = normalizeDeg(current);
  let best = normalizeDeg(candidates[0] || 0);
  let bestDiff = Infinity;
  candidates.forEach((item) => {
    const normalized = normalizeDeg(item);
    const diffRaw = Math.abs(normalizedCurrent - normalized);
    const diff = Math.min(diffRaw, 360 - diffRaw);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = normalized;
    }
  });
  return best;
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

const evaluateGhostPlacement = (
  candidateGhost,
  walls,
  mouseWorld,
  fieldWidth = FIELD_WIDTH,
  fieldHeight = FIELD_HEIGHT
) => {
  const minSize = Math.min(candidateGhost.width, candidateGhost.depth);
  const threshold = minSize;
  let nextGhost = { ...candidateGhost };
  let snap = null;

  const sortedWalls = [...walls].sort((a, b) => b.z - a.z);
  for (const wall of sortedWalls) {
    const local = toLocalByWall(mouseWorld, wall);
    const insideTop = Math.abs(local.x) <= wall.width / 2 && Math.abs(local.y) <= wall.depth / 2;
    if (insideTop && wall.z < MAX_STACK_LEVEL - 1) {
      nextGhost = {
        ...nextGhost,
        x: wall.x,
        y: wall.y,
        z: wall.z + 1,
        rotation: wall.rotation
      };
      snap = { type: 'top', anchorId: wall.id };
      break;
    }
  }

  if (!snap) {
    let bestSide = null;
    walls.forEach((wall) => {
      const local = toLocalByWall(mouseWorld, wall);
      const dx = Math.max(0, Math.abs(local.x) - (wall.width / 2));
      const dy = Math.max(0, Math.abs(local.y) - (wall.depth / 2));
      const dist = Math.hypot(dx, dy);
      if (dist > threshold) return;
      const nearX = Math.abs(local.x) - (wall.width / 2);
      const nearY = Math.abs(local.y) - (wall.depth / 2);
      const chooseX = Math.abs(nearX) >= Math.abs(nearY);
      const side = chooseX
        ? (local.x >= 0 ? 'right' : 'left')
        : (local.y >= 0 ? 'front' : 'back');
      if (!bestSide || dist < bestSide.dist) {
        bestSide = { wall, side, dist };
      }
    });

    if (bestSide) {
      const anchor = bestSide.wall;
      const baseRotation = normalizeDeg(anchor.rotation);
      const rotationAligned = getNearestRotation(nextGhost.rotation, [baseRotation, baseRotation + 90]);
      let offsetLocalX = 0;
      let offsetLocalY = 0;
      if (bestSide.side === 'right') {
        offsetLocalX = (anchor.width / 2) + (nextGhost.width / 2);
      } else if (bestSide.side === 'left') {
        offsetLocalX = -((anchor.width / 2) + (nextGhost.width / 2));
      } else if (bestSide.side === 'front') {
        offsetLocalY = (anchor.depth / 2) + (nextGhost.depth / 2);
      } else {
        offsetLocalY = -((anchor.depth / 2) + (nextGhost.depth / 2));
      }
      const rad = degToRad(anchor.rotation);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const worldX = anchor.x + (offsetLocalX * cos) - (offsetLocalY * sin);
      const worldY = anchor.y + (offsetLocalX * sin) + (offsetLocalY * cos);
      nextGhost = {
        ...nextGhost,
        x: worldX,
        y: worldY,
        z: anchor.z,
        rotation: rotationAligned
      };
      snap = { type: bestSide.side, anchorId: anchor.id };
    }
  }

  if (!snap) {
    const safeFieldWidth = Math.max(200, Number(fieldWidth) || FIELD_WIDTH);
    const safeFieldHeight = Math.max(200, Number(fieldHeight) || FIELD_HEIGHT);
    const nearLeft = (nextGhost.x + safeFieldWidth / 2) < threshold;
    const nearRight = (safeFieldWidth / 2 - nextGhost.x) < threshold;
    const nearTop = (nextGhost.y + safeFieldHeight / 2) < threshold;
    const nearBottom = (safeFieldHeight / 2 - nextGhost.y) < threshold;
    if (nearLeft || nearRight || nearTop || nearBottom) {
      const distances = [
        { side: 'edge-left', dist: nextGhost.x + safeFieldWidth / 2 },
        { side: 'edge-right', dist: safeFieldWidth / 2 - nextGhost.x },
        { side: 'edge-top', dist: nextGhost.y + safeFieldHeight / 2 },
        { side: 'edge-bottom', dist: safeFieldHeight / 2 - nextGhost.y }
      ];
      const best = distances.reduce((acc, item) => (item.dist < acc.dist ? item : acc), distances[0]);
      const clamped = clampGhostInsideField(nextGhost, safeFieldWidth, safeFieldHeight);
      nextGhost = {
        ...nextGhost,
        x: clamped.x,
        y: clamped.y,
        z: 0
      };
      snap = { type: best.side, anchorId: '' };
    }
  }

  if (!snap) {
    nextGhost = clampGhostInsideField(nextGhost, fieldWidth, fieldHeight);
  }

  let blocked = false;
  for (const wall of walls) {
    if (wall.id === nextGhost.id) continue;
    if (wall.z !== nextGhost.z) continue;
    if (isRectOverlap(nextGhost, wall)) {
      blocked = true;
      break;
    }
  }

  return {
    ghost: nextGhost,
    snap,
    blocked
  };
};

const getWallGroupMetrics = (walls) => {
  const source = Array.isArray(walls) ? walls : [];
  if (source.length === 0) return [];
  const adjacency = new Map();
  source.forEach((wall) => adjacency.set(wall.id, new Set()));

  const isConnected = (a, b) => {
    const zDelta = Math.abs((a.z || 0) - (b.z || 0));
    if (zDelta > 1) return false;
    if (zDelta === 1) {
      const overlap2D = isRectOverlap(a, b, 0.2);
      return overlap2D;
    }

    if (isRectOverlap(a, b, -2)) return true;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    return dist <= ((Math.max(a.width, a.depth) + Math.max(b.width, b.depth)) * 0.55);
  };

  for (let i = 0; i < source.length; i += 1) {
    for (let j = i + 1; j < source.length; j += 1) {
      const a = source[i];
      const b = source[j];
      if (isConnected(a, b)) {
        adjacency.get(a.id)?.add(b.id);
        adjacency.get(b.id)?.add(a.id);
      }
    }
  }

  const visited = new Set();
  const groups = [];
  source.forEach((wall) => {
    if (visited.has(wall.id)) return;
    const queue = [wall.id];
    const ids = [];
    visited.add(wall.id);
    while (queue.length > 0) {
      const id = queue.shift();
      ids.push(id);
      (adjacency.get(id) || []).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    const members = ids
      .map((id) => source.find((item) => item.id === id))
      .filter(Boolean);
    const hp = members.reduce((sum, item) => sum + Math.max(0, Number(item.hp) || 0), 0);
    const defenseBase = Number(members[0]?.defense) || BASE_DEFENSE;
    const defense = members.length > 1 ? (defenseBase * 1.1) : defenseBase;
    const center = members.reduce((acc, item) => ({
      x: acc.x + item.x,
      y: acc.y + item.y,
      z: Math.max(acc.z, item.z)
    }), { x: 0, y: 0, z: 0 });

    groups.push({
      ids,
      hp: Math.round(hp),
      defense: roundTo(defense, 2),
      center: {
        x: center.x / (members.length || 1),
        y: center.y / (members.length || 1),
        z: center.z + 1
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
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const panDragRef = useRef(null);
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const pendingPersistRef = useRef(false);
  const [walls, setWalls] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(CAMERA_ANGLE_PREVIEW);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ghost, setGhost] = useState(null);
  const [ghostBlocked, setGhostBlocked] = useState(false);
  const [snapState, setSnapState] = useState(null);
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [serverCanEdit, setServerCanEdit] = useState(!!canEdit);
  const [layoutReady, setLayoutReady] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPaletteItem, setSelectedPaletteItem] = useState('');
  const [itemCatalog, setItemCatalog] = useState(normalizeItemCatalog([]));
  const [activeLayoutMeta, setActiveLayoutMeta] = useState({
    layoutId: '',
    name: '',
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    maxItemsPerType: TOTAL_WOOD_WALL_STOCK
  });
  const effectiveCanEdit = !!canEdit && !!serverCanEdit;
  const fieldWidth = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldWidth) || FIELD_WIDTH),
    [activeLayoutMeta?.fieldWidth]
  );
  const fieldHeight = useMemo(
    () => Math.max(200, Number(activeLayoutMeta?.fieldHeight) || FIELD_HEIGHT),
    [activeLayoutMeta?.fieldHeight]
  );

  const viewport = useMemo(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const width = rect?.width || 920;
    const height = rect?.height || 620;
    return {
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
      panX: pan.x,
      panY: pan.y
    };
  }, [pan.x, pan.y]);

  const wallGroups = useMemo(() => getWallGroupMetrics(walls), [walls]);
  const maxItemsPerType = Math.max(
    0,
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
    const heightBase = (viewport.height * BASELINE_FIELD_COVERAGE) / (fieldHeight * getGroundYScale(cameraAngle));
    const baseScale = Math.max(0.01, Math.min(widthBase, heightBase));
    return baseScale * zoom;
  }, [cameraAngle, fieldHeight, fieldWidth, viewport.height, viewport.width, zoom]);

  const clearPanDragging = useCallback(() => {
    panDragRef.current = null;
  }, []);

  const syncGhostByMouse = (sourceGhost = ghost) => {
    if (!sourceGhost) return;
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
  };

  const pickPaletteItem = (itemType) => {
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
    setSelectedPaletteItem(itemType);
    setGhost(evaluated.ghost);
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setMessage('已选中木墙：移动鼠标后左键放置，右键取消');
  };

  const persistBattlefieldLayout = useCallback(async (nextWalls = [], options = {}) => {
    if (!open || !nodeId || !effectiveCanEdit) return { ok: false };
    const silent = options?.silent !== false;
    const token = localStorage.getItem('token');
    if (!token) return { ok: false };

    if (!silent) setSavingLayout(true);
    try {
      const response = await fetch(`${API_BASE}/api/nodes/${nodeId}/battlefield-layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(buildLayoutPayload({
          walls: nextWalls,
          layoutMeta: activeLayoutMeta,
          itemCatalog,
          gateKey
        }))
      });
      const data = await parseApiResponse(response);
      if (!response.ok || !data) {
        const error = getApiError(data, '保存战场布局失败');
        setErrorText(error);
        return { ok: false, error };
      }
      setErrorText('');
      if (!silent) setMessage(data.message || '战场布局已保存');
      return { ok: true };
    } catch (error) {
      setErrorText(`保存战场布局失败: ${error.message}`);
      return { ok: false, error: error.message };
    } finally {
      if (!silent) setSavingLayout(false);
    }
  }, [activeLayoutMeta, effectiveCanEdit, gateKey, itemCatalog, nodeId, open]);

  useEffect(() => {
    if (!open || !nodeId) return;
    let cancelled = false;
    const token = localStorage.getItem('token');
    const loadLayout = async () => {
      setLoadingLayout(true);
      setLayoutReady(false);
      setErrorText('');
      const fallbackWalls = [];
      if (!token) {
        if (!cancelled) {
          setWalls(fallbackWalls);
          setItemCatalog(normalizeItemCatalog([]));
          setActiveLayoutMeta({
            layoutId: `${gateKey || 'cheng'}_default`,
            name: '',
            fieldWidth: FIELD_WIDTH,
            fieldHeight: FIELD_HEIGHT,
            maxItemsPerType: TOTAL_WOOD_WALL_STOCK
          });
          setServerCanEdit(false);
          setLoadingLayout(false);
          setLayoutReady(true);
          setErrorText('未登录，无法加载战场布局');
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
          setWalls(fallbackWalls);
          setItemCatalog(normalizeItemCatalog([]));
          setActiveLayoutMeta({
            layoutId: `${gateKey || 'cheng'}_default`,
            name: '',
            fieldWidth: FIELD_WIDTH,
            fieldHeight: FIELD_HEIGHT,
            maxItemsPerType: TOTAL_WOOD_WALL_STOCK
          });
          setServerCanEdit(false);
          setErrorText(getApiError(data, '加载战场布局失败'));
          setLoadingLayout(false);
          setLayoutReady(true);
          return;
        }
        if (cancelled) return;
        const layoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object') ? data.layoutBundle : {};
        const nextCatalog = normalizeItemCatalog(layoutBundle.itemCatalog);
        const loadedWalls = mapLayoutBundleToWalls(layoutBundle);
        const shouldConvertLegacyDefault = isLegacyDefaultDeployment(loadedWalls);
        setWalls(shouldConvertLegacyDefault ? [] : loadedWalls);
        setItemCatalog(nextCatalog);
        setActiveLayoutMeta({
          layoutId: typeof layoutBundle?.activeLayout?.layoutId === 'string' ? layoutBundle.activeLayout.layoutId : `${gateKey || 'cheng'}_default`,
          name: typeof layoutBundle?.activeLayout?.name === 'string' ? layoutBundle.activeLayout.name : '',
          fieldWidth: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldWidth)) ? Number(layoutBundle.activeLayout.fieldWidth) : FIELD_WIDTH,
          fieldHeight: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldHeight)) ? Number(layoutBundle.activeLayout.fieldHeight) : FIELD_HEIGHT,
          maxItemsPerType: Number.isFinite(Number(layoutBundle?.activeLayout?.maxItemsPerType))
            ? Number(layoutBundle.activeLayout.maxItemsPerType)
            : TOTAL_WOOD_WALL_STOCK
        });
        setServerCanEdit(!!data.canEdit);
        setErrorText('');
        if (shouldConvertLegacyDefault && !!data.canEdit) {
          pendingPersistRef.current = true;
        }
      } catch (error) {
        if (cancelled) return;
        setWalls(fallbackWalls);
        setItemCatalog(normalizeItemCatalog([]));
        setActiveLayoutMeta({
          layoutId: `${gateKey || 'cheng'}_default`,
          name: '',
          fieldWidth: FIELD_WIDTH,
          fieldHeight: FIELD_HEIGHT,
          maxItemsPerType: TOTAL_WOOD_WALL_STOCK
        });
        setServerCanEdit(false);
        setErrorText(`加载战场布局失败: ${error.message}`);
      } finally {
        if (cancelled) return;
        setLoadingLayout(false);
        setLayoutReady(true);
      }
    };

    pendingPersistRef.current = false;
    setEditMode(false);
    setCameraAngle(CAMERA_ANGLE_PREVIEW);
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
    setGhost(null);
    setGhostBlocked(false);
    setSnapState(null);
    setSelectedPaletteItem('');
    setMessage('');
    loadLayout();

    return () => {
      cancelled = true;
    };
  }, [gateKey, open, nodeId]);

  useEffect(() => {
    if (!open || !layoutReady || !pendingPersistRef.current) return;
    pendingPersistRef.current = false;
    persistBattlefieldLayout(walls, { silent: false });
  }, [layoutReady, open, persistBattlefieldLayout, walls]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.76)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const fieldCorners = [
      { x: -fieldWidth / 2, y: -fieldHeight / 2 },
      { x: fieldWidth / 2, y: -fieldHeight / 2 },
      { x: fieldWidth / 2, y: fieldHeight / 2 },
      { x: -fieldWidth / 2, y: fieldHeight / 2 }
    ].map((item) => projectWorld(item.x, item.y, 0, viewport, cameraAngle, worldScale));

    drawPolygon(
      fieldCorners,
      'rgba(15, 23, 42, 0.9)',
      'rgba(56, 189, 248, 0.35)'
    );

    const gridStep = 70;
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.22)';
    ctx.lineWidth = 1;
    for (let x = -fieldWidth / 2; x <= fieldWidth / 2; x += gridStep) {
      const p1 = projectWorld(x, -fieldHeight / 2, 0, viewport, cameraAngle, worldScale);
      const p2 = projectWorld(x, fieldHeight / 2, 0, viewport, cameraAngle, worldScale);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = -fieldHeight / 2; y <= fieldHeight / 2; y += gridStep) {
      const p1 = projectWorld(-fieldWidth / 2, y, 0, viewport, cameraAngle, worldScale);
      const p2 = projectWorld(fieldWidth / 2, y, 0, viewport, cameraAngle, worldScale);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    const drawWall = (wall, options = {}) => {
      const corners = getRectCorners(wall.x, wall.y, wall.width, wall.depth, wall.rotation);
      const base = corners.map((item) => projectWorld(item.x, item.y, wall.z, viewport, cameraAngle, worldScale));
      const top = corners.map((item) => projectWorld(item.x, item.y, wall.z + 1, viewport, cameraAngle, worldScale));
      const colorTop = options.ghost
        ? (options.blocked ? 'rgba(248, 113, 113, 0.45)' : 'rgba(251, 191, 36, 0.42)')
        : 'rgba(194, 120, 60, 0.92)';
      const colorSideA = options.ghost
        ? (options.blocked ? 'rgba(239, 68, 68, 0.35)' : 'rgba(251, 146, 60, 0.3)')
        : 'rgba(120, 74, 35, 0.95)';
      const colorSideB = options.ghost
        ? (options.blocked ? 'rgba(220, 38, 38, 0.35)' : 'rgba(180, 105, 48, 0.3)')
        : 'rgba(96, 58, 28, 0.95)';

      const side1 = [base[1], base[2], top[2], top[1]];
      const side2 = [base[2], base[3], top[3], top[2]];

      drawPolygon(side2, colorSideB, 'rgba(30, 41, 59, 0.45)');
      drawPolygon(side1, colorSideA, 'rgba(30, 41, 59, 0.45)');
      drawPolygon(top, colorTop, options.ghost ? 'rgba(251, 191, 36, 0.7)' : 'rgba(15, 23, 42, 0.7)');

      if (!options.ghost) {
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        ctx.lineTo(top[2].x, top[2].y);
        ctx.moveTo(top[1].x, top[1].y);
        ctx.lineTo(top[3].x, top[3].y);
        ctx.stroke();
      }
    };

    const renderOrder = [...walls].sort((a, b) => {
      const da = a.x + a.y + (a.z * 300);
      const db = b.x + b.y + (b.z * 300);
      return da - db;
    });

    renderOrder.forEach((wall) => drawWall(wall));

    if (ghost) {
      drawWall(ghost, { ghost: true, blocked: ghostBlocked });
    }

    wallGroups.forEach((group) => {
      const pos = projectWorld(group.center.x, group.center.y, group.center.z + 0.18, viewport, cameraAngle, worldScale);
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
  }, [open, walls, ghost, ghostBlocked, snapState, viewport, cameraAngle, wallGroups, worldScale, fieldHeight, fieldWidth]);

  useEffect(() => {
    if (!open) return undefined;
    const handleResize = () => {
      const wrapper = wrapperRef.current;
      const canvas = canvasRef.current;
      if (!wrapper || !canvas) return;
      const rect = wrapper.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width));
      canvas.height = Math.max(1, Math.floor(rect.height));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  const handleMouseDown = (event) => {
    if (!open) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;

    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const world = unprojectScreen(point.x, point.y, viewport, cameraAngle, worldScale);
    mouseWorldRef.current = world;

    if (event.button === 2) {
      if (ghost) {
        event.preventDefault();
        setGhost(null);
        setGhostBlocked(false);
        setSnapState(null);
        setSelectedPaletteItem('');
        setMessage('已取消放置');
      }
      return;
    }

    if (event.button !== 0) return;

    if (ghost) {
      const evaluated = evaluateGhostPlacement({ ...ghost, x: world.x, y: world.y }, walls, world, fieldWidth, fieldHeight);
      if (evaluated.blocked) {
        setMessage('当前位置已被占用，无法放置');
        setGhost(evaluated.ghost);
        setGhostBlocked(true);
        setSnapState(evaluated.snap);
        return;
      }
      if (!effectiveCanEdit) {
        setMessage('当前仅可预览，不可编辑战场');
        return;
      }
      if (wallStockRemaining <= 0) {
        setMessage('木墙库存不足，无法放置');
        return;
      }
      const nextWall = createWallFromLike(evaluated.ghost);
      pendingPersistRef.current = true;
      setWalls((prev) => [...prev, nextWall]);
      setGhost(null);
      setGhostBlocked(false);
      setSnapState(null);
      setSelectedPaletteItem('');
      setMessage('木墙已放置');
      return;
    }

    panDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y
    };
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
    const world = unprojectScreen(point.x, point.y, viewport, cameraAngle, worldScale);
    mouseWorldRef.current = world;

    if (ghost) {
      syncGhostByMouse(ghost);
      return;
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleWindowMouseMove = (event) => {
      const drag = panDragRef.current;
      if (!drag) return;
      if ((event.buttons & 1) !== 1) {
        clearPanDragging();
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setPan({
        x: drag.originX + dx,
        y: drag.originY + dy
      });
    };
    const handleWindowMouseUp = () => {
      clearPanDragging();
    };
    const handleWindowBlur = () => {
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
  }, [clearPanDragging, open]);

  const handleWheel = (event) => {
    event.preventDefault();
    if (!ghost) {
      setZoom((prev) => {
        const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, roundTo(prev + delta, 3)));
        setMessage(`缩放 ${Math.round(next * 100)}%`);
        return next;
      });
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
  }, [fieldHeight, fieldWidth, ghost?.rotation, walls]);

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
            <span>{loadingLayout ? '正在加载战场配置...' : '俯视矩形战场，可拖拽平移'}</span>
          </div>
          <div className="battlefield-modal-actions">
            <button
              type="button"
              className={`btn btn-small ${editMode ? 'btn-warning' : 'btn-primary'}`}
              disabled={!effectiveCanEdit || loadingLayout || savingLayout}
              onClick={() => {
                if (!effectiveCanEdit) return;
                const nextEdit = !editMode;
                setEditMode(nextEdit);
                setCameraAngle(nextEdit ? CAMERA_ANGLE_EDIT : CAMERA_ANGLE_PREVIEW);
                setGhost(null);
                setGhostBlocked(false);
                setSnapState(null);
                setSelectedPaletteItem('');
                setMessage(nextEdit ? '编辑模式已开启（从左侧物品栏选中后放置）' : '已切回预览模式');
              }}
            >
              {!effectiveCanEdit ? '仅预览' : (editMode ? '退出编辑' : '编辑战场')}
            </button>
            <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="battlefield-toolbar">
          <span>{`视角 ${cameraAngle}°`}</span>
          <span>{`缩放 ${Math.round(zoom * 100)}%`}</span>
          <span>{`已放置木墙 ${walls.length}`}</span>
          <span>{`木墙库存 ${wallStockRemaining}/${maxItemsPerType}`}</span>
          <span>{`堆叠上限 ${MAX_STACK_LEVEL} 层`}</span>
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
                : (!editMode ? '开启编辑后可选择物品' : '点选物品后跟随鼠标，左键放置')}
            </div>
          </aside>

          <div className="battlefield-canvas-wrap" ref={wrapperRef}>
            <canvas
              ref={canvasRef}
              className="battlefield-canvas"
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
          <span>{errorText || message || '提示: 左键按住拖拽平移；滚轮缩放；物品需先从左侧栏选中'}</span>
        </div>
      </div>
    </div>
  );
};

export default BattlefieldPreviewModal;
