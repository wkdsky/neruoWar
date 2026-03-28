import {
  DEPLOY_ZONE_RATIO,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  MAX_STACK_LEVEL,
  SCREEN_HIT_TOLERANCE_PX,
  SNAP_EPSILON,
  STACK_LAYER_HEIGHT,
  WALL_DEPTH,
  WALL_HEIGHT,
  WALL_WIDTH,
  clampStackLimit,
  dot2,
  getWallBaseZ,
  getWallTopZ,
  normalizeDeg,
  projectWorld,
  rotate2D
} from './battlefieldShared';
import {
  collidersOverlap2D,
  getItemGeometry,
  getSocketWorldPose,
  pointInsideCollider2D
} from '../../../game/battlefield/items/ItemGeometryRegistry';

export const getRectCorners = (centerX, centerY, width, depth, rotationDeg) => {
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

export const resolveWallItemDef = (wall = {}, itemCatalogById = new Map()) => {
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

export const resolveSnapHighlightFacePoints = (anchor = {}, snapState = null, itemCatalogById = new Map()) => {
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

export const getRectContactMetrics = (rectA, rectB) => {
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

const resolveItemStackLimit = (itemDef = null) => {
  if (Number.isFinite(Number(itemDef?.maxStack))) {
    return clampStackLimit(itemDef.maxStack);
  }
  return MAX_STACK_LEVEL;
};

const resolveWallStackLimit = (wallLike = null, itemDef = null) => {
  if (Number.isFinite(Number(wallLike?.maxStack))) {
    return clampStackLimit(wallLike.maxStack);
  }
  return resolveItemStackLimit(itemDef);
};

const isWoodPillarItem = (itemDef = {}) => {
  const itemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  const shape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  return itemId === 'it_build_wood_pillar' || shape === 'pillar';
};

export const isWoodPlankItem = (itemDef = {}) => {
  const itemId = typeof itemDef?.itemId === 'string' ? itemDef.itemId.trim().toLowerCase() : '';
  const shape = typeof itemDef?.style?.shape === 'string' ? itemDef.style.shape.trim().toLowerCase() : '';
  return itemId === 'it_build_wood_plank' || shape === 'plank';
};

export const isBushItem = (itemDef = {}) => {
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

export const getWallFootprintCorners = (wallLike = {}, itemCatalogById = new Map()) => {
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

export const isOutOfBounds = (ghostLike, fieldWidth = FIELD_WIDTH, fieldHeight = FIELD_HEIGHT, itemCatalogById = new Map()) => {
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

export const hasCollision = (ghostLike, walls = [], itemCatalogById = new Map(), ignoreIds = []) => {
  const ghostItemDef = resolveWallItemDef(ghostLike, itemCatalogById);
  const ignoreSet = new Set((Array.isArray(ignoreIds) ? ignoreIds : []).filter(Boolean));
  for (const wall of walls) {
    if (ignoreSet.has(wall?.id)) continue;
    if (wall.id === ghostLike.id) continue;
    if (Math.abs((Number(wall?.z) || 0) - (Number(ghostLike?.z) || 0)) > 0.0001) continue;
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

export const getPlacementReasonText = (reason) => {
  if (reason === 'stack_limit') return '该设置物已达到堆叠上限';
  if (reason === 'support_required') return '该设置物需要吸附在支撑物上';
  if (reason === 'collision') return '当前位置发生碰撞，无法放置';
  if (reason === 'out_of_bounds') return '当前位置超出战场边界';
  if (reason === 'deploy_zone_blocked') return '当前位置位于红蓝部署区，无法放置设置物';
  return '';
};

export const getInteractionKindLabel = (kind = '') => {
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

export const getHintAnchorId = (mouseHint = null) => {
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
  const ghostStackLimit = resolveWallStackLimit(ghostBase, ghostItemDef);
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
        const rawStackZ = Math.max(0, desiredBaseZ / ghostLayerHeight);
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
        const socketStackZ = Math.max(0, desiredBaseZ / ghostLayerHeight);
        const ghostStackLimit = resolveWallStackLimit(ghostBase, ghostItemDef);
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
            adjustedStackZ = Math.max(adjustedStackZ, (anchorTopZ - ghostMinLocalZ) / ghostLayerHeight);
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
  const ghostStackLimit = resolveWallStackLimit(candidateGhost, ghostItemDef);
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
    z: Math.max(0, Math.min(ghostStackLimit - 1, Number(candidateGhost?.z) || 0)),
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
      const anchorItemDef = resolveWallItemDef(wall, itemCatalogById);
      const anchorStackLimit = resolveWallStackLimit(wall, anchorItemDef);
      const ghostLayerHeight = Math.max(
        1,
        Number(ghostBase?.height) || Number(ghostItemDef?.height) || STACK_LAYER_HEIGHT
      );
      const ghostMinLocalZ = getItemLocalMinZ(ghostItemDef);
      const requiredBaseZ = getWallTopZ(wall);
      const requiredStackZ = Math.max(0, (requiredBaseZ - ghostMinLocalZ) / ghostLayerHeight);
      if (requiredStackZ > (ghostStackLimit - 1) || requiredStackZ > (anchorStackLimit - 1)) {
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

export const evaluateGhostPlacement = (
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

export const findTopWallAtPoint = (worldPoint, walls = [], itemCatalogById = new Map()) => {
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

export const findTopWallByScreenPoint = ({
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
