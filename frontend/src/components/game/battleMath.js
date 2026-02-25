export const clamp = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

export const normalizeDeg = (deg) => {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
};

export const degToRad = (deg) => (normalizeDeg(deg) * Math.PI) / 180;

export const rotate2D = (x, y, deg) => {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos)
  };
};

export const getCameraConfig = (tiltDeg, yawDeg) => {
  const yaw = degToRad(yawDeg);
  const tilt = degToRad(tiltDeg);
  return {
    yawCos: Math.cos(yaw),
    yawSin: Math.sin(yaw),
    tiltSin: Math.sin(tilt),
    tiltCos: Math.cos(tilt)
  };
};

export const projectWorld = (x, y, z, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const yawX = (x * camera.yawCos) - (y * camera.yawSin);
  const yawY = (x * camera.yawSin) + (y * camera.yawCos);
  const viewY = (yawY * camera.tiltSin) - (z * camera.tiltCos);
  const depth = (yawY * camera.tiltCos) + (z * camera.tiltSin);
  return {
    x: viewport.centerX + (yawX * worldScale),
    y: viewport.centerY + (viewY * worldScale),
    depth
  };
};

export const unprojectScreen = (sx, sy, viewport, tiltDeg, yawDeg, worldScale) => {
  const camera = getCameraConfig(tiltDeg, yawDeg);
  const safeScale = Math.max(0.0001, worldScale || 1);
  const safeGroundScale = Math.max(0.0001, camera.tiltSin);
  const yawX = (sx - viewport.centerX) / safeScale;
  const yawY = (sy - viewport.centerY) / (safeScale * safeGroundScale);
  return {
    x: (yawX * camera.yawCos) + (yawY * camera.yawSin),
    y: (-yawX * camera.yawSin) + (yawY * camera.yawCos)
  };
};

export const getRectCorners = (centerX, centerY, width, depth, rotationDeg) => {
  const hw = width / 2;
  const hd = depth / 2;
  const local = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd }
  ];
  return local.map((p) => {
    const r = rotate2D(p.x, p.y, rotationDeg);
    return { x: centerX + r.x, y: centerY + r.y };
  });
};

export const pointInPolygon = (point, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
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

export const distance2D = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y));

export const pointSegmentDistance = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = (dx * dx) + (dy * dy);
  if (lenSq <= 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lenSq));
  const px = a.x + (dx * t);
  const py = a.y + (dy * t);
  return Math.hypot(point.x - px, point.y - py);
};

const cross2 = (ax, ay, bx, by) => ((ax * by) - (ay * bx));

export const segmentIntersection = (a1, a2, b1, b2) => {
  const rX = a2.x - a1.x;
  const rY = a2.y - a1.y;
  const sX = b2.x - b1.x;
  const sY = b2.y - b1.y;
  const denom = cross2(rX, rY, sX, sY);
  if (Math.abs(denom) < 1e-9) return null;
  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = cross2(qpx, qpy, sX, sY) / denom;
  const u = cross2(qpx, qpy, rX, rY) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return {
    x: a1.x + (rX * t),
    y: a1.y + (rY * t),
    t,
    u
  };
};

export const lineIntersectsRotatedRect = (start, end, rect) => {
  const corners = getRectCorners(rect.x, rect.y, rect.width, rect.depth, rect.rotation || 0);
  let best = null;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const hit = segmentIntersection(start, end, a, b);
    if (!hit) continue;
    if (!best || hit.t < best.t) {
      best = hit;
    }
  }
  return best;
};

export const pointToRectLocal = (point, rect) => rotate2D(
  point.x - rect.x,
  point.y - rect.y,
  -(rect.rotation || 0)
);

export const circleIntersectsRotatedRect = (point, radius, rect) => {
  const local = pointToRectLocal(point, rect);
  const hw = rect.width / 2;
  const hd = rect.depth / 2;
  const cx = clamp(local.x, -hw, hw);
  const cy = clamp(local.y, -hd, hd);
  const dx = local.x - cx;
  const dy = local.y - cy;
  return ((dx * dx) + (dy * dy)) <= ((radius || 0) ** 2);
};

export const clampPointToField = (point, fieldWidth, fieldHeight, padding = 0) => ({
  x: clamp(point.x, -(fieldWidth / 2) + padding, (fieldWidth / 2) - padding),
  y: clamp(point.y, -(fieldHeight / 2) + padding, (fieldHeight / 2) - padding)
});
