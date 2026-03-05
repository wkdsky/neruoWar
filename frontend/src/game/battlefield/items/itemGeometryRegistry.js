import * as THREE from 'three';

const DEFAULT_WIDTH = 84;
const DEFAULT_DEPTH = 24;
const DEFAULT_HEIGHT = 32;
const PREVIEW_SCALE = 0.08;

let previewBushBladeTexture = null;
const getPreviewBushBladeTexture = () => {
  if (previewBushBladeTexture) return previewBushBladeTexture;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
  gradient.addColorStop(0, 'rgba(35,92,46,0)');
  gradient.addColorStop(0.14, 'rgba(54,141,69,0.88)');
  gradient.addColorStop(0.7, 'rgba(150,220,120,0.95)');
  gradient.addColorStop(1, 'rgba(198,242,178,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.5, canvas.height * 0.03);
  ctx.quadraticCurveTo(canvas.width * 0.13, canvas.height * 0.38, canvas.width * 0.34, canvas.height * 0.98);
  ctx.quadraticCurveTo(canvas.width * 0.5, canvas.height * 0.86, canvas.width * 0.66, canvas.height * 0.98);
  ctx.quadraticCurveTo(canvas.width * 0.87, canvas.height * 0.38, canvas.width * 0.5, canvas.height * 0.03);
  ctx.closePath();
  ctx.fill();
  previewBushBladeTexture = new THREE.CanvasTexture(canvas);
  previewBushBladeTexture.colorSpace = THREE.SRGBColorSpace;
  previewBushBladeTexture.wrapS = THREE.ClampToEdgeWrapping;
  previewBushBladeTexture.wrapT = THREE.ClampToEdgeWrapping;
  previewBushBladeTexture.needsUpdate = true;
  return previewBushBladeTexture;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeDeg = (deg) => {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
};

const degToRad = (deg) => (normalizeDeg(deg) * Math.PI) / 180;

const rotate2D = (x, y, deg) => {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos)
  };
};

const parseHexColor = (value, fallback = '#7b8794') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
};

const hexToRgb01 = (hex, fallback = [0.52, 0.58, 0.66]) => {
  const safe = parseHexColor(hex, '');
  if (!safe) return fallback;
  const raw = safe.slice(1);
  return [
    Number.parseInt(raw.slice(0, 2), 16) / 255,
    Number.parseInt(raw.slice(2, 4), 16) / 255,
    Number.parseInt(raw.slice(4, 6), 16) / 255
  ];
};

const blendRgb = (a, b, t = 0.5) => ([
  (a[0] * (1 - t)) + (b[0] * t),
  (a[1] * (1 - t)) + (b[1] * t),
  (a[2] * (1 - t)) + (b[2] * t)
]);

const hash01 = (text = '') => {
  const input = String(text || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const hashColor = (key = '', fallback = '#6e7b87') => {
  const t = hash01(key || 'fallback');
  const hue = t * 360;
  const sat = 48 + (hash01(`${key}:s`) * 24);
  const lit = 42 + (hash01(`${key}:l`) * 18);
  const color = new THREE.Color(`hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(lit)}%)`);
  return [color.r, color.g, color.b];
};

const normalizeColliderPart = (part = {}, fallback = {}) => ({
  cx: Number.isFinite(Number(part?.cx)) ? Number(part.cx) : (Number(fallback?.cx) || 0),
  cy: Number.isFinite(Number(part?.cy)) ? Number(part.cy) : (Number(fallback?.cy) || 0),
  cz: Number.isFinite(Number(part?.cz)) ? Number(part.cz) : (Number(fallback?.cz) || 0),
  w: Math.max(1, Number(part?.w ?? fallback?.w) || 1),
  d: Math.max(1, Number(part?.d ?? fallback?.d) || 1),
  h: Math.max(1, Number(part?.h ?? fallback?.h) || 1),
  yawDeg: normalizeDeg(part?.yawDeg ?? fallback?.yawDeg ?? 0)
});

const normalizeCollider = (itemType = {}) => {
  const width = Math.max(12, Number(itemType?.width) || DEFAULT_WIDTH);
  const depth = Math.max(12, Number(itemType?.depth) || DEFAULT_DEPTH);
  const height = Math.max(10, Number(itemType?.height) || DEFAULT_HEIGHT);
  const fallbackPart = {
    cx: 0,
    cy: 0,
    cz: height * 0.5,
    w: width,
    d: depth,
    h: height,
    yawDeg: 0
  };
  const source = itemType?.collider && typeof itemType.collider === 'object' ? itemType.collider : null;
  const kind = source?.kind === 'polygon' ? 'polygon' : 'compositeObb';
  if (kind === 'polygon') {
    const points = (Array.isArray(source?.polygon?.points) ? source.polygon.points : [])
      .map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length >= 3) {
      return {
        kind: 'polygon',
        polygon: { points },
        parts: [fallbackPart]
      };
    }
  }
  const parts = (Array.isArray(source?.parts) ? source.parts : [])
    .map((part) => normalizeColliderPart(part, fallbackPart))
    .filter((part) => part.w > 0.01 && part.d > 0.01 && part.h > 0.01);
  return {
    kind: 'compositeObb',
    parts: parts.length > 0 ? parts : [fallbackPart]
  };
};

const normalizeSockets = (itemType = {}) => (
  (Array.isArray(itemType?.sockets) ? itemType.sockets : [])
    .map((socket, index) => {
      const socketId = typeof socket?.socketId === 'string' && socket.socketId.trim()
        ? socket.socketId.trim()
        : `socket_${index + 1}`;
      const localPose = socket?.localPose && typeof socket.localPose === 'object' ? socket.localPose : {};
      return {
        socketId,
        type: socket?.type === 'edge' || socket?.type === 'surface' ? socket.type : 'point',
        localPose: {
          x: Number(localPose?.x) || 0,
          y: Number(localPose?.y) || 0,
          z: Number(localPose?.z) || 0,
          yawDeg: normalizeDeg(localPose?.yawDeg || 0)
        },
        compatibleTags: (Array.isArray(socket?.compatibleTags) ? socket.compatibleTags : [])
          .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
          .filter(Boolean),
        snap: {
          dist: clamp(Number(socket?.snap?.dist) || 12, 2, 120),
          yawStepDeg: Number.isFinite(Number(socket?.snap?.yawStepDeg))
            ? clamp(Number(socket.snap.yawStepDeg), 1, 180)
            : null
        }
      };
    })
);

const normalizeRenderProfile = (itemType = {}) => {
  const source = itemType?.renderProfile && typeof itemType.renderProfile === 'object'
    ? itemType.renderProfile
    : {};
  const battle = source?.battle && typeof source.battle === 'object' ? source.battle : {};
  const preview = source?.preview && typeof source.preview === 'object' ? source.preview : {};
  const style = itemType?.style && typeof itemType.style === 'object' ? itemType.style : {};
  const meshId = typeof battle?.meshId === 'string' && battle.meshId.trim()
    ? battle.meshId.trim()
    : (typeof style?.shape === 'string' && style.shape.trim() ? style.shape.trim() : 'box');
  return {
    battle: {
      meshId,
      materialKey: typeof battle?.materialKey === 'string' && battle.materialKey.trim() ? battle.materialKey.trim() : 'default',
      topLayerKey: typeof battle?.topLayerKey === 'string' && battle.topLayerKey.trim()
        ? battle.topLayerKey.trim()
        : `${meshId}_top`,
      sideLayerKey: typeof battle?.sideLayerKey === 'string' && battle.sideLayerKey.trim()
        ? battle.sideLayerKey.trim()
        : `${meshId}_side`
    },
    preview: {
      palette: preview?.palette && typeof preview.palette === 'object' ? preview.palette : {},
      modelHints: preview?.modelHints && typeof preview.modelHints === 'object' ? preview.modelHints : {}
    }
  };
};

const normalizeInteractions = (itemType = {}) => (
  (Array.isArray(itemType?.interactions) ? itemType.interactions : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      kind: typeof row?.kind === 'string' ? row.kind.trim() : '',
      selector: row?.selector && typeof row.selector === 'object' ? row.selector : {},
      params: row?.params && typeof row.params === 'object' ? row.params : {}
    }))
    .filter((row) => !!row.kind)
);

export const getItemGeometry = (itemType = {}) => {
  const collider = normalizeCollider(itemType);
  const renderProfile = normalizeRenderProfile(itemType);
  const sockets = normalizeSockets(itemType);
  const interactions = normalizeInteractions(itemType);
  return {
    collider,
    battleMesh: {
      meshId: renderProfile.battle.meshId,
      instanceParams: {
        topLayerKey: renderProfile.battle.topLayerKey,
        sideLayerKey: renderProfile.battle.sideLayerKey,
        materialKey: renderProfile.battle.materialKey
      }
    },
    previewMesh: {
      buildThreeMesh: (_scene, paletteOverride = null, hintsOverride = null) => createPreviewMesh(itemType, {
        paletteOverride,
        hintsOverride
      })
    },
    sockets,
    interactions,
    renderProfile
  };
};

export const buildWorldColliderParts = (instance = {}, itemType = {}, options = {}) => {
  const geometry = getItemGeometry(itemType);
  const collider = geometry.collider;
  if (collider.kind !== 'compositeObb') return [];
  const yawDeg = normalizeDeg(instance?.rotation || 0);
  const stackLayerHeight = Number.isFinite(Number(options?.stackLayerHeight))
    ? Number(options.stackLayerHeight)
    : Math.max(0, Number(instance?.height) || DEFAULT_HEIGHT);
  const stackZ = Math.max(0, Math.floor(Number(instance?.z) || 0)) * stackLayerHeight;
  return collider.parts.map((part) => {
    const offset = rotate2D(part.cx, part.cy, yawDeg);
    return {
      cx: (Number(instance?.x) || 0) + offset.x,
      cy: (Number(instance?.y) || 0) + offset.y,
      cz: stackZ + part.cz,
      w: part.w,
      d: part.d,
      h: part.h,
      yawDeg: normalizeDeg(yawDeg + part.yawDeg)
    };
  });
};

export const getSocketWorldPose = (instance = {}, socket = {}) => {
  const local = socket?.localPose && typeof socket.localPose === 'object' ? socket.localPose : {};
  const yaw = normalizeDeg(instance?.rotation || 0);
  const rotated = rotate2D(Number(local?.x) || 0, Number(local?.y) || 0, yaw);
  return {
    x: (Number(instance?.x) || 0) + rotated.x,
    y: (Number(instance?.y) || 0) + rotated.y,
    z: (Number(local?.z) || 0) + (Math.max(0, Math.floor(Number(instance?.z) || 0)) * (Number(instance?.height) || DEFAULT_HEIGHT)),
    yawDeg: normalizeDeg(yaw + (Number(local?.yawDeg) || 0))
  };
};

const obbCorners = (obb = {}) => {
  const hw = Math.max(0.5, Number(obb?.w) || 1) * 0.5;
  const hd = Math.max(0.5, Number(obb?.d) || 1) * 0.5;
  const base = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd }
  ];
  return base.map((point) => {
    const r = rotate2D(point.x, point.y, Number(obb?.yawDeg) || 0);
    return {
      x: (Number(obb?.cx) || 0) + r.x,
      y: (Number(obb?.cy) || 0) + r.y
    };
  });
};

const projectPolygon = (points = [], axis = { x: 1, y: 0 }) => {
  let min = Infinity;
  let max = -Infinity;
  points.forEach((point) => {
    const dot = (point.x * axis.x) + (point.y * axis.y);
    min = Math.min(min, dot);
    max = Math.max(max, dot);
  });
  return { min, max };
};

const polygonAxes = (points = []) => {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    out.push({ x: -ey / len, y: ex / len });
  }
  return out;
};

const polygonsOverlap = (polyA = [], polyB = [], epsilon = 0.01) => {
  if (polyA.length < 3 || polyB.length < 3) return false;
  const axes = [...polygonAxes(polyA), ...polygonAxes(polyB)];
  for (let i = 0; i < axes.length; i += 1) {
    const axis = axes[i];
    const a = projectPolygon(polyA, axis);
    const b = projectPolygon(polyB, axis);
    const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
    if (overlap <= epsilon) return false;
  }
  return true;
};

const pointInPolygon = (point, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const hit = ((yi > point.y) !== (yj > point.y))
      && (point.x < (((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9)) + xi);
    if (hit) inside = !inside;
  }
  return inside;
};

export const buildWorldPolygon = (instance = {}, itemType = {}) => {
  const geometry = getItemGeometry(itemType);
  if (geometry.collider.kind !== 'polygon') return [];
  const points = geometry.collider?.polygon?.points || [];
  const yaw = normalizeDeg(instance?.rotation || 0);
  return points.map((point) => {
    const r = rotate2D(point.x, point.y, yaw);
    return {
      x: (Number(instance?.x) || 0) + r.x,
      y: (Number(instance?.y) || 0) + r.y
    };
  });
};

export const collidersOverlap2D = (instanceA = {}, itemA = {}, instanceB = {}, itemB = {}, epsilon = 0.01) => {
  const geomA = getItemGeometry(itemA);
  const geomB = getItemGeometry(itemB);

  if (geomA.collider.kind === 'polygon' || geomB.collider.kind === 'polygon') {
    const polySetA = geomA.collider.kind === 'polygon'
      ? [buildWorldPolygon(instanceA, itemA)]
      : buildWorldColliderParts(instanceA, itemA).map((part) => obbCorners(part));
    const polySetB = geomB.collider.kind === 'polygon'
      ? [buildWorldPolygon(instanceB, itemB)]
      : buildWorldColliderParts(instanceB, itemB).map((part) => obbCorners(part));
    for (let i = 0; i < polySetA.length; i += 1) {
      for (let j = 0; j < polySetB.length; j += 1) {
        if (polygonsOverlap(polySetA[i], polySetB[j], epsilon)) return true;
      }
    }
    return false;
  }

  const partsA = buildWorldColliderParts(instanceA, itemA);
  const partsB = buildWorldColliderParts(instanceB, itemB);
  for (let i = 0; i < partsA.length; i += 1) {
    const polyA = obbCorners(partsA[i]);
    for (let j = 0; j < partsB.length; j += 1) {
      const polyB = obbCorners(partsB[j]);
      if (polygonsOverlap(polyA, polyB, epsilon)) return true;
    }
  }
  return false;
};

export const pointInsideCollider2D = (point = {}, instance = {}, itemType = {}, padding = 0) => {
  const geometry = getItemGeometry(itemType);
  if (geometry.collider.kind === 'polygon') {
    const poly = buildWorldPolygon(instance, itemType);
    return pointInPolygon({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }, poly);
  }
  const parts = buildWorldColliderParts(instance, itemType);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const local = rotate2D(
      (Number(point?.x) || 0) - part.cx,
      (Number(point?.y) || 0) - part.cy,
      -part.yawDeg
    );
    const hw = (part.w * 0.5) + Math.max(0, Number(padding) || 0);
    const hd = (part.d * 0.5) + Math.max(0, Number(padding) || 0);
    if (Math.abs(local.x) <= hw && Math.abs(local.y) <= hd) return true;
  }
  return false;
};

export const resolveBattleLayerColors = (itemType = {}, options = {}) => {
  const geometry = getItemGeometry(itemType);
  const style = itemType?.style && typeof itemType.style === 'object' ? itemType.style : {};
  const previewPalette = geometry.renderProfile?.preview?.palette && typeof geometry.renderProfile.preview.palette === 'object'
    ? geometry.renderProfile.preview.palette
    : {};
  const topFromKey = hashColor(geometry.renderProfile.battle.topLayerKey, '#6f8ca5');
  const sideFromKey = hashColor(geometry.renderProfile.battle.sideLayerKey, '#546b7f');
  const stylePrimary = hexToRgb01(
    previewPalette.primary || style.color || '#7b8794',
    topFromKey
  );
  const styleSecondary = hexToRgb01(
    previewPalette.secondary || style.spikeColor || style.color || '#5b6571',
    sideFromKey
  );
  const battleTone = options?.battleTone !== false;
  if (!battleTone) {
    return {
      top: blendRgb(stylePrimary, topFromKey, 0.25),
      side: blendRgb(styleSecondary, sideFromKey, 0.25)
    };
  }
  return {
    top: blendRgb(stylePrimary, topFromKey, 0.46),
    side: blendRgb(styleSecondary, sideFromKey, 0.56)
  };
};

export const createPreviewMesh = (itemType = {}, options = {}) => {
  const geometry = getItemGeometry(itemType);
  const meshId = geometry.battleMesh.meshId || 'box';
  const layerColors = resolveBattleLayerColors(itemType, { battleTone: options?.battleTone !== false });
  const topColor = new THREE.Color(layerColors.top[0], layerColors.top[1], layerColors.top[2]);
  const sideColor = new THREE.Color(layerColors.side[0], layerColors.side[1], layerColors.side[2]);
  const topMaterial = new THREE.MeshStandardMaterial({
    color: topColor,
    roughness: 0.58,
    metalness: 0.12
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: 0.68,
    metalness: 0.08
  });
  const group = new THREE.Group();

  const parts = geometry.collider.kind === 'compositeObb'
    ? geometry.collider.parts
    : [{
      cx: 0,
      cy: 0,
      cz: Math.max(10, Number(itemType?.height) || DEFAULT_HEIGHT) * 0.5,
      w: Math.max(12, Number(itemType?.width) || DEFAULT_WIDTH),
      d: Math.max(12, Number(itemType?.depth) || DEFAULT_DEPTH),
      h: Math.max(10, Number(itemType?.height) || DEFAULT_HEIGHT),
      yawDeg: 0
    }];

  parts.forEach((part) => {
    const materials = [sideMaterial, sideMaterial, topMaterial, sideMaterial, sideMaterial, sideMaterial];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(0.2, part.w * PREVIEW_SCALE),
        Math.max(0.2, part.d * PREVIEW_SCALE),
        Math.max(0.2, part.h * PREVIEW_SCALE)
      ),
      materials
    );
    mesh.position.set(
      part.cx * PREVIEW_SCALE,
      part.cy * PREVIEW_SCALE,
      part.cz * PREVIEW_SCALE
    );
    mesh.rotation.z = degToRad(part.yawDeg);
    group.add(mesh);
  });

  if (meshId.includes('spike') || meshId.includes('cheval') || meshId.includes('trap')) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.52, metalness: 0.22 })
    );
    cone.position.set(0, 0, Math.max(0.6, (Number(itemType?.height) || DEFAULT_HEIGHT) * PREVIEW_SCALE * 0.7));
    group.add(cone);
  }
  if (meshId.includes('flag')) {
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({ color: topColor, side: THREE.DoubleSide, roughness: 0.72, metalness: 0.05 })
    );
    flag.position.set(0.55, 0, Math.max(1, (Number(itemType?.height) || DEFAULT_HEIGHT) * PREVIEW_SCALE * 0.72));
    group.add(flag);
  }
  if (meshId.includes('bush')) {
    const safeWidth = Math.max(1, Number(itemType?.width) || DEFAULT_WIDTH) * PREVIEW_SCALE;
    const safeDepth = Math.max(1, Number(itemType?.depth) || DEFAULT_DEPTH) * PREVIEW_SCALE;
    const safeHeight = Math.max(1, Number(itemType?.height) || DEFAULT_HEIGHT) * PREVIEW_SCALE;
    const crownRadius = Math.max(0.5, Math.min(safeWidth, safeDepth) * 0.2);
    const darkLeaf = topColor.clone().lerp(new THREE.Color('#1f3d24'), 0.28);
    const brightLeaf = topColor.clone().lerp(new THREE.Color('#9fe783'), 0.14);
    const buildLeafMaterial = (color, opacity = 0.96) => (
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        metalness: 0.01,
        transparent: opacity < 1,
        opacity
      })
    );

    const clumps = [
      { x: 0, y: 0, s: 1.32, z: 0.56 },
      { x: -safeWidth * 0.19, y: safeDepth * 0.06, s: 1.03, z: 0.46 },
      { x: safeWidth * 0.2, y: safeDepth * 0.04, s: 0.99, z: 0.47 },
      { x: -safeWidth * 0.14, y: -safeDepth * 0.17, s: 0.93, z: 0.37 },
      { x: safeWidth * 0.14, y: -safeDepth * 0.17, s: 0.94, z: 0.37 },
      { x: 0, y: safeDepth * 0.21, s: 0.95, z: 0.42 },
      { x: -safeWidth * 0.25, y: -safeDepth * 0.01, s: 0.86, z: 0.34 },
      { x: safeWidth * 0.25, y: 0, s: 0.87, z: 0.34 },
      { x: -safeWidth * 0.05, y: safeDepth * 0.26, s: 0.83, z: 0.33 },
      { x: safeWidth * 0.05, y: safeDepth * 0.25, s: 0.83, z: 0.33 },
      { x: -safeWidth * 0.09, y: -safeDepth * 0.25, s: 0.79, z: 0.3 },
      { x: safeWidth * 0.09, y: -safeDepth * 0.25, s: 0.79, z: 0.3 }
    ];
    clumps.forEach((clump, index) => {
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(crownRadius, 16, 14),
        buildLeafMaterial(index % 2 === 0 ? brightLeaf : darkLeaf)
      );
      crown.scale.set(clump.s * 1.1, clump.s, Math.max(0.78, (safeHeight / Math.max(0.1, crownRadius)) * (0.44 + (index * 0.02))));
      crown.position.set(clump.x, clump.y, Math.max(0.18, safeHeight * clump.z));
      group.add(crown);
    });

    const bladeCount = 18;
    for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
      const t = bladeIndex / bladeCount;
      const angle = (Math.PI * 2 * t) + ((bladeIndex % 2) * 0.18);
      const radius = Math.max(0.14, crownRadius * (0.26 + ((bladeIndex % 5) * 0.1)));
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(0.08, crownRadius * 0.18), Math.max(0.26, safeHeight * 0.44), 5),
        buildLeafMaterial(brightLeaf, 0.94)
      );
      blade.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        Math.max(0.2, safeHeight * (0.24 + ((bladeIndex % 4) * 0.03)))
      );
      blade.rotation.x = Math.PI / 2;
      blade.rotation.y = Math.PI * (0.06 + ((bladeIndex % 4) * 0.04));
      blade.rotation.z = angle;
      group.add(blade);
    }

    const bladeTexture = getPreviewBushBladeTexture();
    if (bladeTexture) {
      const spriteMatA = new THREE.SpriteMaterial({
        map: bladeTexture,
        color: brightLeaf,
        transparent: true,
        opacity: 0.72,
        alphaTest: 0.12,
        depthWrite: false
      });
      const spriteMatB = new THREE.SpriteMaterial({
        map: bladeTexture,
        color: darkLeaf,
        transparent: true,
        opacity: 0.67,
        alphaTest: 0.12,
        depthWrite: false
      });
      const spriteCount = 22;
      for (let spriteIndex = 0; spriteIndex < spriteCount; spriteIndex += 1) {
        const t = spriteIndex / spriteCount;
        const angle = (Math.PI * 2 * t) + ((spriteIndex % 3) * 0.14);
        const radius = crownRadius * (0.2 + ((spriteIndex % 7) * 0.1));
        const sprite = new THREE.Sprite((spriteIndex % 2 === 0) ? spriteMatA : spriteMatB);
        sprite.center.set(0.5, 0.04);
        const spriteHeight = Math.max(0.28, safeHeight * (0.26 + ((spriteIndex % 5) * 0.03)));
        sprite.scale.set(spriteHeight * 0.42, spriteHeight, 1);
        sprite.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          Math.max(0.16, safeHeight * (0.2 + ((spriteIndex % 4) * 0.02)))
        );
        group.add(sprite);
      }
    }
  }

  const sizeX = Math.max(1, Number(itemType?.width) || DEFAULT_WIDTH) * PREVIEW_SCALE;
  const sizeY = Math.max(1, Number(itemType?.depth) || DEFAULT_DEPTH) * PREVIEW_SCALE;
  const sizeZ = Math.max(1, Number(itemType?.height) || DEFAULT_HEIGHT) * PREVIEW_SCALE;
  group.userData = {
    radius: Math.max(4.6, Math.max(sizeX, sizeY, sizeZ) * 1.45),
    focusZ: Math.max(1.2, sizeZ * 0.6)
  };
  return group;
};

const itemGeometryRegistry = {
  getItemGeometry,
  buildWorldColliderParts,
  pointInsideCollider2D,
  collidersOverlap2D,
  buildWorldPolygon,
  getSocketWorldPose,
  resolveBattleLayerColors,
  createPreviewMesh
};

export default itemGeometryRegistry;
