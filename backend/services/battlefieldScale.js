const ITEM_SCALE = 2 / 3;
const FIELD_WIDTH_SCALE = 3;
const FIELD_HEIGHT_SCALE = 2.4;

const BASE_FIELD_WIDTH = 900;
const BASE_FIELD_HEIGHT = 620;
const BASE_OBJECT_WIDTH = 104;
const BASE_OBJECT_DEPTH = 24;
const BASE_OBJECT_HEIGHT = 42;

const round3 = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Number(num.toFixed(3));
};

const BATTLEFIELD_FIELD_WIDTH = round3(BASE_FIELD_WIDTH * FIELD_WIDTH_SCALE, BASE_FIELD_WIDTH);
const BATTLEFIELD_FIELD_HEIGHT = round3(BASE_FIELD_HEIGHT * FIELD_HEIGHT_SCALE, BASE_FIELD_HEIGHT);
const BATTLEFIELD_OBJECT_DEFAULT_WIDTH = round3(BASE_OBJECT_WIDTH * ITEM_SCALE, BASE_OBJECT_WIDTH);
const BATTLEFIELD_OBJECT_DEFAULT_DEPTH = round3(BASE_OBJECT_DEPTH * ITEM_SCALE, BASE_OBJECT_DEPTH);
const BATTLEFIELD_OBJECT_DEFAULT_HEIGHT = round3(BASE_OBJECT_HEIGHT * ITEM_SCALE, BASE_OBJECT_HEIGHT);

const LEGACY_ITEM_DIMENSIONS = Object.freeze({
  it_build_wood_pillar: { width: 36, depth: 36, height: 148 },
  it_build_wood_plank: { width: 124, depth: 20, height: 14 },
  it_cover_sandbag: { width: 132, depth: 52, height: 34 },
  it_cover_stone_wall: { width: 152, depth: 42, height: 72 },
  it_terrain_bush: { width: 96, depth: 88, height: 48 },
  it_trap_spikes: { width: 64, depth: 64, height: 18 },
  it_trap_snare_net: { width: 86, depth: 54, height: 12 },
  it_hazard_cheval_de_frise: { width: 118, depth: 48, height: 40 },
  it_hazard_poison_thorns: { width: 104, depth: 76, height: 10 },
  it_support_watch_flag: { width: 46, depth: 30, height: 132 }
});

const maybeScaleNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return round3(num * ITEM_SCALE, num);
};

const maybeScaleDimension = (value, min = 0) => {
  const scaled = maybeScaleNumber(value);
  const num = Number(scaled);
  if (!Number.isFinite(num)) return scaled;
  return round3(Math.max(min, num), num);
};

const scaleWithAxisAdjust = (value, axisRatio = 1) => {
  const base = maybeScaleNumber(value);
  const num = Number(base);
  if (!Number.isFinite(num)) return base;
  const ratio = Number.isFinite(Number(axisRatio)) ? Number(axisRatio) : 1;
  return round3(num * ratio, num);
};

const multiplyByRatio = (value, ratio = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return round3(num * ratio, num);
};

const scaleCollider = (collider = null, ratio = {}) => {
  if (!collider || typeof collider !== 'object') return null;
  const xRatio = Number.isFinite(Number(ratio?.x)) ? Number(ratio.x) : 1;
  const yRatio = Number.isFinite(Number(ratio?.y)) ? Number(ratio.y) : 1;
  const zRatio = Number.isFinite(Number(ratio?.z)) ? Number(ratio.z) : 1;
  const out = { ...collider };
  if (Array.isArray(collider.parts)) {
    out.parts = collider.parts.map((part) => {
      if (!part || typeof part !== 'object') return part;
      return {
        ...part,
        cx: scaleWithAxisAdjust(part.cx, xRatio),
        cy: scaleWithAxisAdjust(part.cy, yRatio),
        cz: scaleWithAxisAdjust(part.cz, zRatio),
        w: scaleWithAxisAdjust(part.w, xRatio),
        d: scaleWithAxisAdjust(part.d, yRatio),
        h: scaleWithAxisAdjust(part.h, zRatio)
      };
    });
  }
  if (collider.polygon && typeof collider.polygon === 'object') {
    out.polygon = { ...collider.polygon };
    if (Array.isArray(collider.polygon.points)) {
      out.polygon.points = collider.polygon.points.map((point) => {
        if (!point || typeof point !== 'object') return point;
        return {
          ...point,
          x: scaleWithAxisAdjust(point.x, xRatio),
          y: scaleWithAxisAdjust(point.y, yRatio)
        };
      });
    }
  }
  return out;
};

const scaleSocket = (socket = null, ratio = {}) => {
  if (!socket || typeof socket !== 'object') return socket;
  const xRatio = Number.isFinite(Number(ratio?.x)) ? Number(ratio.x) : 1;
  const yRatio = Number.isFinite(Number(ratio?.y)) ? Number(ratio.y) : 1;
  const zRatio = Number.isFinite(Number(ratio?.z)) ? Number(ratio.z) : 1;
  const planarRatio = Math.max(xRatio, yRatio);
  const out = { ...socket };
  if (socket.localPose && typeof socket.localPose === 'object') {
    out.localPose = {
      ...socket.localPose,
      x: scaleWithAxisAdjust(socket.localPose.x, xRatio),
      y: scaleWithAxisAdjust(socket.localPose.y, yRatio),
      z: scaleWithAxisAdjust(socket.localPose.z, zRatio)
    };
  }
  if (socket.snap && typeof socket.snap === 'object') {
    out.snap = {
      ...socket.snap,
      dist: scaleWithAxisAdjust(socket.snap.dist, planarRatio)
    };
  }
  return out;
};

const applyBattlefieldItemScale = (item = {}) => {
  if (!item || typeof item !== 'object') return item;
  const scaledWidthRaw = maybeScaleNumber(item.width);
  const scaledDepthRaw = maybeScaleNumber(item.depth);
  const scaledHeightRaw = maybeScaleNumber(item.height);
  const width = maybeScaleDimension(item.width, 12);
  const depth = maybeScaleDimension(item.depth, 12);
  const height = maybeScaleDimension(item.height, 10);
  const widthRawNum = Number(scaledWidthRaw);
  const depthRawNum = Number(scaledDepthRaw);
  const heightRawNum = Number(scaledHeightRaw);
  const ratio = {
    x: Number.isFinite(widthRawNum) && Math.abs(widthRawNum) > 1e-6 ? (Number(width) / widthRawNum) : 1,
    y: Number.isFinite(depthRawNum) && Math.abs(depthRawNum) > 1e-6 ? (Number(depth) / depthRawNum) : 1,
    z: Number.isFinite(heightRawNum) && Math.abs(heightRawNum) > 1e-6 ? (Number(height) / heightRawNum) : 1
  };
  return {
    ...item,
    width,
    depth,
    height,
    collider: scaleCollider(item.collider, ratio),
    sockets: Array.isArray(item.sockets) ? item.sockets.map((socket) => scaleSocket(socket, ratio)) : []
  };
};

const alignItemGeometryZToHeight = (item = {}) => {
  if (!item || typeof item !== 'object') return item;
  const targetHeight = Number(item?.height);
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) return { ...item };
  const collider = item?.collider && typeof item.collider === 'object' ? item.collider : null;
  const parts = Array.isArray(collider?.parts) ? collider.parts : [];
  if (parts.length <= 0) return { ...item };
  let minZ = Infinity;
  let maxZ = -Infinity;
  parts.forEach((part) => {
    const cz = Number(part?.cz);
    const h = Number(part?.h);
    if (!Number.isFinite(cz) || !Number.isFinite(h)) return;
    const halfH = Math.max(0, h * 0.5);
    minZ = Math.min(minZ, cz - halfH);
    maxZ = Math.max(maxZ, cz + halfH);
  });
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return { ...item };
  const span = maxZ - minZ;
  if (!Number.isFinite(span) || span <= 1e-6) return { ...item };
  if (Math.abs(span - targetHeight) <= 0.05) return { ...item };
  const zRatio = targetHeight / span;
  if (!Number.isFinite(zRatio) || zRatio <= 0 || zRatio < 0.25 || zRatio > 4) return { ...item };
  const nextCollider = {
    ...collider,
    parts: parts.map((part) => {
      if (!part || typeof part !== 'object') return part;
      return {
        ...part,
        cz: multiplyByRatio(part.cz, zRatio),
        h: multiplyByRatio(part.h, zRatio)
      };
    })
  };
  const nextSockets = Array.isArray(item?.sockets)
    ? item.sockets.map((socket) => {
      if (!socket || typeof socket !== 'object') return socket;
      if (!socket.localPose || typeof socket.localPose !== 'object') return socket;
      return {
        ...socket,
        localPose: {
          ...socket.localPose,
          z: multiplyByRatio(socket.localPose.z, zRatio)
        }
      };
    })
    : [];
  return {
    ...item,
    collider: nextCollider,
    sockets: nextSockets
  };
};

const isLegacyBaseSizedItem = (item = {}) => {
  const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
  const legacy = LEGACY_ITEM_DIMENSIONS[itemId];
  if (!legacy) return false;
  const width = Number(item?.width);
  const depth = Number(item?.depth);
  const height = Number(item?.height);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(height)) return false;
  return (
    Math.abs(width - legacy.width) <= 0.001
    && Math.abs(depth - legacy.depth) <= 0.001
    && Math.abs(height - legacy.height) <= 0.001
  );
};

const normalizeBattlefieldItemGeometryScale = (item = {}) => {
  if (!item || typeof item !== 'object') return item;
  if (isLegacyBaseSizedItem(item)) {
    return alignItemGeometryZToHeight(applyBattlefieldItemScale(item));
  }
  return alignItemGeometryZToHeight(item);
};

module.exports = {
  ITEM_SCALE,
  FIELD_WIDTH_SCALE,
  FIELD_HEIGHT_SCALE,
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT,
  BATTLEFIELD_OBJECT_DEFAULT_WIDTH,
  BATTLEFIELD_OBJECT_DEFAULT_DEPTH,
  BATTLEFIELD_OBJECT_DEFAULT_HEIGHT,
  applyBattlefieldItemScale,
  normalizeBattlefieldItemGeometryScale,
  round3
};
