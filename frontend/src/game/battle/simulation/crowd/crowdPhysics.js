/**
 * Crowd movement/avoidance helpers for agent-level battle simulation.
 * Collider-aware upgrade: supports rotated rect + composite OBB + polygon.
 */

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const rotate2D = (x, y, deg) => {
  const r = (Number(deg) || 0) * Math.PI / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos)
  };
};

export const normalizeVec = (x, y) => {
  const len = Math.hypot(x, y);
  if (len <= 1e-9) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
};

const normalizeDeg = (deg) => {
  let value = Number(deg) || 0;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
};

const getDefaultPart = (obs = {}) => ({
  cx: Number(obs?.x) || 0,
  cy: Number(obs?.y) || 0,
  w: Math.max(1, Number(obs?.width) || 1),
  d: Math.max(1, Number(obs?.depth) || 1),
  yawDeg: normalizeDeg(obs?.rotation || 0)
});

const worldColliderCache = new WeakMap();

const resolveColliderTransform = (obs = {}) => ({
  x: Number(obs?.x) || 0,
  y: Number(obs?.y) || 0,
  width: Number(obs?.width) || 0,
  depth: Number(obs?.depth) || 0,
  rotation: Number(obs?.rotation) || 0,
  collider: obs?.collider || null
});

const isSameColliderTransform = (entry = null, transform = null) => (
  !!entry
  && !!transform
  && entry.x === transform.x
  && entry.y === transform.y
  && entry.width === transform.width
  && entry.depth === transform.depth
  && entry.rotation === transform.rotation
  && entry.collider === transform.collider
);

const getWorldColliderCacheEntry = (obs = {}) => {
  if (!obs || typeof obs !== 'object') return { parts: null, polygon: null };
  const transform = resolveColliderTransform(obs);
  const cached = worldColliderCache.get(obs);
  if (isSameColliderTransform(cached, transform)) return cached;
  const entry = {
    ...transform,
    parts: null,
    polygon: null,
    circle: null,
    capsules: null
  };
  worldColliderCache.set(obs, entry);
  return entry;
};

const getWorldCompositeParts = (obs = {}) => {
  const cached = getWorldColliderCacheEntry(obs);
  if (cached.parts) return cached.parts;
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : null;
  const parts = Array.isArray(source?.parts) ? source.parts : [];
  if (parts.length <= 0) {
    cached.parts = [getDefaultPart(obs)];
    return cached.parts;
  }
  const yaw = normalizeDeg(obs?.rotation || 0);
  const out = [];
  parts.forEach((part) => {
    const w = Math.max(1, Number(part?.w) || 1);
    const d = Math.max(1, Number(part?.d) || 1);
    const offset = rotate2D(Number(part?.cx) || 0, Number(part?.cy) || 0, yaw);
    out.push({
      cx: (Number(obs?.x) || 0) + offset.x,
      cy: (Number(obs?.y) || 0) + offset.y,
      w,
      d,
      yawDeg: normalizeDeg(yaw + (Number(part?.yawDeg) || 0))
    });
  });
  cached.parts = out.length > 0 ? out : [getDefaultPart(obs)];
  return cached.parts;
};

const getWorldPolygon = (obs = {}) => {
  const cached = getWorldColliderCacheEntry(obs);
  if (cached.polygon) return cached.polygon;
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : null;
  const rawPoints = Array.isArray(source?.polygon?.points) ? source.polygon.points : [];
  if (rawPoints.length < 3) {
    cached.polygon = [];
    return cached.polygon;
  }
  const yaw = normalizeDeg(obs?.rotation || 0);
  cached.polygon = rawPoints.map((point) => {
    const rotated = rotate2D(Number(point?.x) || 0, Number(point?.y) || 0, yaw);
    return {
      x: (Number(obs?.x) || 0) + rotated.x,
      y: (Number(obs?.y) || 0) + rotated.y
    };
  });
  return cached.polygon;
};

const getWorldCircle = (obs = {}) => {
  const cached = getWorldColliderCacheEntry(obs);
  if (cached.circle) return cached.circle;
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : {};
  const yaw = normalizeDeg(obs?.rotation || 0);
  const offset = rotate2D(Number(source?.cx) || 0, Number(source?.cy) || 0, yaw);
  cached.circle = {
    cx: (Number(obs?.x) || 0) + offset.x,
    cy: (Number(obs?.y) || 0) + offset.y,
    r: Math.max(0.5, Number(source?.r) || (Math.min(
      Math.max(1, Number(obs?.width) || 1),
      Math.max(1, Number(obs?.depth) || 1)
    ) * 0.5))
  };
  return cached.circle;
};

const getWorldCapsuleParts = (obs = {}) => {
  const cached = getWorldColliderCacheEntry(obs);
  if (cached.capsules) return cached.capsules;
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : {};
  const yaw = normalizeDeg(obs?.rotation || 0);
  const parts = (Array.isArray(source?.parts) ? source.parts : []).map((part) => {
    const startOffset = rotate2D(Number(part?.ax) || 0, Number(part?.ay) || 0, yaw);
    const endOffset = rotate2D(Number(part?.bx) || 0, Number(part?.by) || 0, yaw);
    return {
      ax: (Number(obs?.x) || 0) + startOffset.x,
      ay: (Number(obs?.y) || 0) + startOffset.y,
      bx: (Number(obs?.x) || 0) + endOffset.x,
      by: (Number(obs?.y) || 0) + endOffset.y,
      r: Math.max(0.5, Number(part?.r) || 0.5)
    };
  });
  cached.capsules = parts;
  return cached.capsules;
};

const getColliderKind = (obs = {}) => {
  const kind = typeof obs?.collider?.kind === 'string' ? obs.collider.kind : '';
  if (kind === 'polygon') return 'polygon';
  if (kind === 'circle') return 'circle';
  if (kind === 'compositeCapsule') return 'compositeCapsule';
  if (kind === 'compositeObb') return 'compositeObb';
  return 'rect';
};

const closestPointOnSegment = (point = {}, start = {}, end = {}) => {
  const startX = Number(start?.x) || 0;
  const startY = Number(start?.y) || 0;
  const dx = (Number(end?.x) || 0) - startX;
  const dy = (Number(end?.y) || 0) - startY;
  const lengthSquared = (dx * dx) + (dy * dy);
  const progress = lengthSquared <= 1e-9
    ? 0
    : clamp(
      ((((Number(point?.x) || 0) - startX) * dx)
        + (((Number(point?.y) || 0) - startY) * dy)) / lengthSquared,
      0,
      1
    );
  return {
    x: startX + (dx * progress),
    y: startY + (dy * progress),
    progress
  };
};

const distanceToSegment = (point = {}, start = {}, end = {}) => {
  const closest = closestPointOnSegment(point, start, end);
  return Math.hypot(
    (Number(point?.x) || 0) - closest.x,
    (Number(point?.y) || 0) - closest.y
  );
};

const distanceToPolygonBoundary = (point = {}, polygon = []) => {
  let best = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const closest = closestPointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length]);
    const distance = Math.hypot(
      (Number(point?.x) || 0) - closest.x,
      (Number(point?.y) || 0) - closest.y
    );
    if (!best || distance < best.distance) best = { ...closest, distance };
  }
  return best;
};

const pointInsideCircle = (point = {}, circle = {}, inflate = 0) => (
  Math.hypot(
    (Number(point?.x) || 0) - (Number(circle?.cx) || 0),
    (Number(point?.y) || 0) - (Number(circle?.cy) || 0)
  ) <= Math.max(0.5, Number(circle?.r) || 0.5) + Math.max(0, Number(inflate) || 0)
);

const pointInsideCapsule = (point = {}, capsule = {}, inflate = 0) => (
  distanceToSegment(
    point,
    { x: capsule?.ax, y: capsule?.ay },
    { x: capsule?.bx, y: capsule?.by }
  ) <= Math.max(0.5, Number(capsule?.r) || 0.5) + Math.max(0, Number(inflate) || 0)
);

const pushOutOfCircle = (point = {}, circle = {}, inflate = 0) => {
  const pointX = Number(point?.x) || 0;
  const pointY = Number(point?.y) || 0;
  const centerX = Number(circle?.cx) || 0;
  const centerY = Number(circle?.cy) || 0;
  const radius = Math.max(0.5, Number(circle?.r) || 0.5) + Math.max(0, Number(inflate) || 0);
  const dx = pointX - centerX;
  const dy = pointY - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return { x: pointX, y: pointY, pushed: false };
  const direction = distance > 1e-6 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
  return {
    x: centerX + (direction.x * (radius + 0.001)),
    y: centerY + (direction.y * (radius + 0.001)),
    pushed: true
  };
};

const pushOutOfCapsule = (point = {}, capsule = {}, inflate = 0) => {
  const pointX = Number(point?.x) || 0;
  const pointY = Number(point?.y) || 0;
  const start = { x: Number(capsule?.ax) || 0, y: Number(capsule?.ay) || 0 };
  const end = { x: Number(capsule?.bx) || 0, y: Number(capsule?.by) || 0 };
  const closest = closestPointOnSegment(point, start, end);
  const radius = Math.max(0.5, Number(capsule?.r) || 0.5) + Math.max(0, Number(inflate) || 0);
  const dx = pointX - closest.x;
  const dy = pointY - closest.y;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return { x: pointX, y: pointY, pushed: false };
  let direction;
  if (distance > 1e-6) {
    direction = { x: dx / distance, y: dy / distance };
  } else {
    const segment = normalizeVec(end.x - start.x, end.y - start.y);
    direction = segment.len > 1e-6 ? { x: -segment.y, y: segment.x } : { x: 1, y: 0 };
  }
  return {
    x: closest.x + (direction.x * (radius + 0.001)),
    y: closest.y + (direction.y * (radius + 0.001)),
    pushed: true
  };
};

const pushOutOfComposite = (point = {}, parts = [], inflate = 0, isInsidePart, pushOutPart) => {
  const source = { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
  const blockers = parts.filter((part) => isInsidePart(source, part, inflate));
  if (blockers.length <= 0) return { ...source, pushed: false };
  let best = null;
  blockers.forEach((seedPart) => {
    let candidate = pushOutPart(source, seedPart, inflate);
    if (!candidate?.pushed) return;
    for (let iteration = 0; iteration < Math.max(4, parts.length * 2); iteration += 1) {
      const remaining = [];
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        if (isInsidePart(candidate, parts[partIndex], inflate)) remaining.push(parts[partIndex]);
      }
      if (remaining.length <= 0) break;
      let next = null;
      let nextMove = -Infinity;
      for (let partIndex = 0; partIndex < remaining.length; partIndex += 1) {
        const option = pushOutPart(candidate, remaining[partIndex], inflate);
        if (!option?.pushed) continue;
        const optionMove = Math.hypot(option.x - source.x, option.y - source.y);
        if (optionMove > nextMove) {
          next = option;
          nextMove = optionMove;
        }
      }
      if (!next) break;
      if (Math.hypot(next.x - candidate.x, next.y - candidate.y) <= 1e-6) break;
      candidate = next;
    }
    const cleared = parts.every((part) => !isInsidePart(candidate, part, inflate));
    const move = Math.hypot(candidate.x - source.x, candidate.y - source.y);
    if (cleared && (!best || move < best.move)) best = { ...candidate, move };
  });
  if (best) return { x: best.x, y: best.y, pushed: true };
  const fallback = pushOutPart(source, blockers[0], inflate);
  return fallback?.pushed ? fallback : { ...source, pushed: false };
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

const segmentIntersectionT = (a, b, c, d) => {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = (r.x * s.y) - (r.y * s.x);
  if (Math.abs(denom) <= 1e-9) return null;
  const u = (((c.x - a.x) * r.y) - ((c.y - a.y) * r.x)) / denom;
  const t = (((c.x - a.x) * s.y) - ((c.y - a.y) * s.x)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
};

const raycastPolygon = (start, end, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  if (pointInPolygon(start, polygon)) return { t: 0, x: Number(start?.x) || 0, y: Number(start?.y) || 0 };
  let bestT = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const t = segmentIntersectionT(start, end, a, b);
    if (t === null) continue;
    if (t < bestT) bestT = t;
  }
  if (!Number.isFinite(bestT)) return null;
  const sx = Number(start?.x) || 0;
  const sy = Number(start?.y) || 0;
  const ex = Number(end?.x) || 0;
  const ey = Number(end?.y) || 0;
  return {
    t: bestT,
    x: sx + ((ex - sx) * bestT),
    y: sy + ((ey - sy) * bestT)
  };
};

const pointInsideObb = (point, part, inflate = 0) => {
  const local = rotate2D(
    (Number(point?.x) || 0) - (Number(part?.cx) || 0),
    (Number(point?.y) || 0) - (Number(part?.cy) || 0),
    -(Number(part?.yawDeg) || 0)
  );
  const hw = (Math.max(1, Number(part?.w) || 1) * 0.5) + inflate;
  const hh = (Math.max(1, Number(part?.d) || 1) * 0.5) + inflate;
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
};

const pushOutOfObb = (point, part, inflate = 0) => {
  const cx = Number(point?.x) || 0;
  const cy = Number(point?.y) || 0;
  const local = rotate2D(
    cx - (Number(part?.cx) || 0),
    cy - (Number(part?.cy) || 0),
    -(Number(part?.yawDeg) || 0)
  );
  const hw = (Math.max(1, Number(part?.w) || 1) * 0.5) + inflate;
  const hh = (Math.max(1, Number(part?.d) || 1) * 0.5) + inflate;
  if (Math.abs(local.x) > hw || Math.abs(local.y) > hh) return { x: cx, y: cy, pushed: false };

  const dx = hw - Math.abs(local.x);
  const dy = hh - Math.abs(local.y);
  if (dx < dy) local.x += local.x >= 0 ? dx : -dx;
  else local.y += local.y >= 0 ? dy : -dy;

  const world = rotate2D(local.x, local.y, Number(part?.yawDeg) || 0);
  return {
    x: (Number(part?.cx) || 0) + world.x,
    y: (Number(part?.cy) || 0) + world.y,
    pushed: true
  };
};

const raycastObbPart = (start, end, part, inflate = 0) => {
  const sx = Number(start?.x) || 0;
  const sy = Number(start?.y) || 0;
  const ex = Number(end?.x) || 0;
  const ey = Number(end?.y) || 0;
  const cx = Number(part?.cx) || 0;
  const cy = Number(part?.cy) || 0;
  const rot = Number(part?.yawDeg) || 0;
  const hw = (Math.max(1, Number(part?.w) || 1) * 0.5) + Math.max(0, Number(inflate) || 0);
  const hh = (Math.max(1, Number(part?.d) || 1) * 0.5) + Math.max(0, Number(inflate) || 0);
  const localStart = rotate2D(sx - cx, sy - cy, -rot);
  const localEnd = rotate2D(ex - cx, ey - cy, -rot);

  const dx = localEnd.x - localStart.x;
  const dy = localEnd.y - localStart.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) <= 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
      return true;
    }
    if (r < t0) return false;
    if (r < t1) t1 = r;
    return true;
  };
  if (!clip(-dx, localStart.x + hw)) return null;
  if (!clip(dx, hw - localStart.x)) return null;
  if (!clip(-dy, localStart.y + hh)) return null;
  if (!clip(dy, hh - localStart.y)) return null;
  if (!(t1 >= t0 && t1 >= 0 && t0 <= 1)) return null;
  const t = Math.max(0, Math.min(1, t0));
  const hitLocal = {
    x: localStart.x + (dx * t),
    y: localStart.y + (dy * t)
  };
  const hitWorld = rotate2D(hitLocal.x, hitLocal.y, rot);
  return {
    t,
    x: cx + hitWorld.x,
    y: cy + hitWorld.y
  };
};

const raycastCirclePart = (start = {}, end = {}, circle = {}, inflate = 0) => {
  const startX = Number(start?.x) || 0;
  const startY = Number(start?.y) || 0;
  const endX = Number(end?.x) || 0;
  const endY = Number(end?.y) || 0;
  const centerX = Number(circle?.cx) || 0;
  const centerY = Number(circle?.cy) || 0;
  const radius = Math.max(0.5, Number(circle?.r) || 0.5) + Math.max(0, Number(inflate) || 0);
  if (Math.hypot(startX - centerX, startY - centerY) <= radius) {
    return { t: 0, x: startX, y: startY };
  }
  const dx = endX - startX;
  const dy = endY - startY;
  const a = (dx * dx) + (dy * dy);
  if (a <= 1e-12) return null;
  const offsetX = startX - centerX;
  const offsetY = startY - centerY;
  const b = 2 * ((offsetX * dx) + (offsetY * dy));
  const c = (offsetX * offsetX) + (offsetY * offsetY) - (radius * radius);
  const discriminant = (b * b) - (4 * a * c);
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((value) => value >= 0 && value <= 1)
    .sort((left, right) => left - right);
  if (roots.length <= 0) return null;
  const t = roots[0];
  return {
    t,
    x: startX + (dx * t),
    y: startY + (dy * t)
  };
};

const raycastCapsulePart = (start = {}, end = {}, capsule = {}, inflate = 0) => {
  const startPoint = { x: Number(capsule?.ax) || 0, y: Number(capsule?.ay) || 0 };
  const endPoint = { x: Number(capsule?.bx) || 0, y: Number(capsule?.by) || 0 };
  const radius = Math.max(0.5, Number(capsule?.r) || 0.5) + Math.max(0, Number(inflate) || 0);
  if (pointInsideCapsule(start, capsule, inflate)) {
    return { t: 0, x: Number(start?.x) || 0, y: Number(start?.y) || 0 };
  }
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  const hits = [
    raycastCirclePart(start, end, { cx: startPoint.x, cy: startPoint.y, r: radius }, 0),
    raycastCirclePart(start, end, { cx: endPoint.x, cy: endPoint.y, r: radius }, 0)
  ].filter(Boolean);
  if (length > 1e-6) {
    const bodyHit = raycastObbPart(start, end, {
      cx: (startPoint.x + endPoint.x) * 0.5,
      cy: (startPoint.y + endPoint.y) * 0.5,
      w: length,
      d: radius * 2,
      yawDeg: Math.atan2(dy, dx) * 180 / Math.PI
    }, 0);
    if (bodyHit) hits.push(bodyHit);
  }
  return hits.sort((left, right) => left.t - right.t)[0] || null;
};

export const isInsideCollider = (point, obstacle, inflate = 0) => {
  if (!obstacle) return false;
  const kind = getColliderKind(obstacle);
  if (kind === 'polygon') {
    const poly = getWorldPolygon(obstacle);
    if (poly.length >= 3) {
      if (pointInPolygon(point, poly)) return true;
      const boundary = distanceToPolygonBoundary(point, poly);
      return !!boundary && boundary.distance <= Math.max(0, Number(inflate) || 0);
    }
  }
  if (kind === 'circle') {
    return pointInsideCircle(point, getWorldCircle(obstacle), inflate);
  }
  if (kind === 'compositeCapsule') {
    return getWorldCapsuleParts(obstacle).some((part) => pointInsideCapsule(point, part, inflate));
  }
  const parts = getWorldCompositeParts(obstacle);
  for (let i = 0; i < parts.length; i += 1) {
    if (pointInsideObb(point, parts[i], inflate)) return true;
  }
  return false;
};

export const pushOutOfCollider = (point, obstacle, inflate = 0) => {
  if (!obstacle) {
    return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false };
  }
  const kind = getColliderKind(obstacle);
  if (kind === 'polygon') {
    const poly = getWorldPolygon(obstacle);
    const inside = pointInPolygon(point, poly);
    const boundary = distanceToPolygonBoundary(point, poly);
    const padding = Math.max(0, Number(inflate) || 0);
    if (!inside && (!boundary || boundary.distance > padding)) {
      return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false };
    }
    if (!boundary) return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false };
    const boundaryToPoint = normalizeVec(
      (Number(point?.x) || 0) - boundary.x,
      (Number(point?.y) || 0) - boundary.y
    );
    const direction = inside
      ? { x: -boundaryToPoint.x, y: -boundaryToPoint.y }
      : { x: boundaryToPoint.x, y: boundaryToPoint.y };
    return {
      x: boundary.x + (direction.x * (padding + 0.001)),
      y: boundary.y + (direction.y * (padding + 0.001)),
      pushed: true
    };
  }
  if (kind === 'circle') {
    return pushOutOfCircle(point, getWorldCircle(obstacle), inflate);
  }
  if (kind === 'compositeCapsule') {
    return pushOutOfComposite(
      point,
      getWorldCapsuleParts(obstacle),
      inflate,
      pointInsideCapsule,
      pushOutOfCapsule
    );
  }
  const parts = getWorldCompositeParts(obstacle);
  return pushOutOfComposite(point, parts, inflate, pointInsideObb, pushOutOfObb);
};

export const raycastCollider = (start, end, obstacle, inflate = 0) => {
  if (!obstacle) return null;
  const kind = getColliderKind(obstacle);
  if (kind === 'polygon') {
    const poly = getWorldPolygon(obstacle);
    const hits = [];
    const polygonHit = raycastPolygon(
      { x: Number(start?.x) || 0, y: Number(start?.y) || 0 },
      { x: Number(end?.x) || 0, y: Number(end?.y) || 0 },
      poly
    );
    if (polygonHit) hits.push(polygonHit);
    const padding = Math.max(0, Number(inflate) || 0);
    if (padding > 0 && poly.length >= 3) {
      if (isInsideCollider(start, obstacle, padding)) {
        hits.push({ t: 0, x: Number(start?.x) || 0, y: Number(start?.y) || 0 });
      } else {
        for (let index = 0; index < poly.length; index += 1) {
          const edgeHit = raycastCapsulePart(start, end, {
            ax: poly[index].x,
            ay: poly[index].y,
            bx: poly[(index + 1) % poly.length].x,
            by: poly[(index + 1) % poly.length].y,
            r: padding
          });
          if (edgeHit) hits.push(edgeHit);
        }
      }
    }
    const hit = hits.sort((left, right) => left.t - right.t)[0] || null;
    if (!hit) return null;
    return {
      ...hit,
      obstacle
    };
  }
  if (kind === 'circle') {
    const hit = raycastCirclePart(start, end, getWorldCircle(obstacle), inflate);
    return hit ? { ...hit, obstacle } : null;
  }
  if (kind === 'compositeCapsule') {
    const parts = getWorldCapsuleParts(obstacle);
    let best = null;
    for (let index = 0; index < parts.length; index += 1) {
      const hit = raycastCapsulePart(start, end, parts[index], inflate);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best ? { ...best, obstacle } : null;
  }
  const parts = getWorldCompositeParts(obstacle);
  let best = null;
  for (let i = 0; i < parts.length; i += 1) {
    const hit = raycastObbPart(start, end, parts[i], inflate);
    if (!hit) continue;
    if (!best || hit.t < best.t) best = hit;
  }
  if (!best) return null;
  return {
    ...best,
    obstacle
  };
};

export const lineIntersectsCollider = (start, end, obstacle, inflate = 0) => !!raycastCollider(start, end, obstacle, inflate);

export const isInsideRotatedRect = (point, rect, inflate = 0) => (
  isInsideCollider(point, rect, inflate)
);

export const pushOutOfRect = (point, rect, inflate = 0) => (
  pushOutOfCollider(point, rect, inflate)
);

export const lineIntersectsRotatedRect = (start, end, rect, inflate = 0) => (
  lineIntersectsCollider(start, end, rect, inflate)
);

export const raycastRotatedRect = (start, end, rect, inflate = 0) => {
  const hit = raycastCollider(start, end, rect, inflate);
  if (!hit) return null;
  return {
    t: hit.t,
    x: hit.x,
    y: hit.y,
    rect
  };
};

const resolveObstacleBounds = (obstacle = {}) => {
  if (!obstacle) return null;
  const kind = getColliderKind(obstacle);
  const polygon = kind === 'polygon' ? getWorldPolygon(obstacle) : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  if (polygon.length >= 3) {
    polygon.forEach((point) => {
      minX = Math.min(minX, Number(point?.x) || 0);
      minY = Math.min(minY, Number(point?.y) || 0);
      maxX = Math.max(maxX, Number(point?.x) || 0);
      maxY = Math.max(maxY, Number(point?.y) || 0);
    });
  } else if (kind === 'circle') {
    const circle = getWorldCircle(obstacle);
    minX = circle.cx - circle.r;
    minY = circle.cy - circle.r;
    maxX = circle.cx + circle.r;
    maxY = circle.cy + circle.r;
  } else if (kind === 'compositeCapsule') {
    getWorldCapsuleParts(obstacle).forEach((part) => {
      const radius = Math.max(0.5, Number(part?.r) || 0.5);
      minX = Math.min(minX, Number(part?.ax) - radius, Number(part?.bx) - radius);
      minY = Math.min(minY, Number(part?.ay) - radius, Number(part?.by) - radius);
      maxX = Math.max(maxX, Number(part?.ax) + radius, Number(part?.bx) + radius);
      maxY = Math.max(maxY, Number(part?.ay) + radius, Number(part?.by) + radius);
    });
  } else {
    const parts = getWorldCompositeParts(obstacle);
    parts.forEach((part) => {
      const halfWidth = Math.max(1, Number(part?.w) || 1) * 0.5;
      const halfDepth = Math.max(1, Number(part?.d) || 1) * 0.5;
      const radians = (Number(part?.yawDeg) || 0) * Math.PI / 180;
      const extentX = (Math.abs(Math.cos(radians)) * halfWidth) + (Math.abs(Math.sin(radians)) * halfDepth);
      const extentY = (Math.abs(Math.sin(radians)) * halfWidth) + (Math.abs(Math.cos(radians)) * halfDepth);
      const centerX = Number(part?.cx) || 0;
      const centerY = Number(part?.cy) || 0;
      minX = Math.min(minX, centerX - extentX);
      minY = Math.min(minY, centerY - extentY);
      maxX = Math.max(maxX, centerX + extentX);
      maxY = Math.max(maxY, centerY + extentY);
    });
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY };
};

const appendObstacleToCells = (map, obstacle, bounds, cellSize) => {
  const minColumn = Math.floor(bounds.minX / cellSize);
  const maxColumn = Math.floor(bounds.maxX / cellSize);
  const minRow = Math.floor(bounds.minY / cellSize);
  const maxRow = Math.floor(bounds.maxY / cellSize);
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      const key = `${column}:${row}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(obstacle);
    }
  }
};

export const buildObstacleSpatialIndex = (obstacles = [], cellSize = 192) => {
  const size = Math.max(32, Number(cellSize) || 192);
  const map = new Map();
  (Array.isArray(obstacles) ? obstacles : []).forEach((obstacle) => {
    if (!obstacle || obstacle.destroyed) return;
    const bounds = resolveObstacleBounds(obstacle);
    if (bounds) appendObstacleToCells(map, obstacle, bounds, size);
  });
  return {
    size,
    map,
    seen: new Set(),
    rows: []
  };
};

const queryObstacleSpatialIndex = (index, bounds, out = null) => {
  if (!index?.map || !bounds) return Array.isArray(out) ? out : [];
  const rows = Array.isArray(out) ? out : index.rows;
  rows.length = 0;
  index.seen.clear();
  const minColumn = Math.floor(bounds.minX / index.size);
  const maxColumn = Math.floor(bounds.maxX / index.size);
  const minRow = Math.floor(bounds.minY / index.size);
  const maxRow = Math.floor(bounds.maxY / index.size);
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      const bucket = index.map.get(`${column}:${row}`);
      if (!bucket) continue;
      for (let indexInBucket = 0; indexInBucket < bucket.length; indexInBucket += 1) {
        const obstacle = bucket[indexInBucket];
        if (!obstacle || index.seen.has(obstacle)) continue;
        index.seen.add(obstacle);
        rows.push(obstacle);
      }
    }
  }
  return rows;
};

export const queryObstacleCandidates = (obstacles = [], x = 0, y = 0, radius = 0, out = null) => {
  const index = obstacles?._obstacleSpatialIndex;
  if (!index) return Array.isArray(obstacles) ? obstacles : [];
  const padding = Math.max(0, Number(radius) || 0);
  const centerX = Number(x) || 0;
  const centerY = Number(y) || 0;
  return queryObstacleSpatialIndex(index, {
    minX: centerX - padding,
    minY: centerY - padding,
    maxX: centerX + padding,
    maxY: centerY + padding
  }, out);
};

export const queryObstacleSegmentCandidates = (obstacles = [], start = {}, end = {}, inflate = 0, out = null) => {
  const index = obstacles?._obstacleSpatialIndex;
  if (!index) return Array.isArray(obstacles) ? obstacles : [];
  const padding = Math.max(0, Number(inflate) || 0);
  const startX = Number(start?.x) || 0;
  const startY = Number(start?.y) || 0;
  const endX = Number(end?.x) || 0;
  const endY = Number(end?.y) || 0;
  return queryObstacleSpatialIndex(index, {
    minX: Math.min(startX, endX) - padding,
    minY: Math.min(startY, endY) - padding,
    maxX: Math.max(startX, endX) + padding,
    maxY: Math.max(startY, endY) + padding
  }, out);
};

export const raycastObstacles = (start, end, obstacles = [], inflate = 0) => {
  const candidates = queryObstacleSegmentCandidates(obstacles, start, end, inflate);
  let best = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const obs = candidates[i];
    if (!obs || obs.destroyed) continue;
    const hit = raycastCollider(start, end, obs, inflate);
    if (!hit) continue;
    if (!best || hit.t < best.t) {
      best = {
        ...hit,
        obstacle: obs
      };
    }
  }
  return best;
};

export const hasLineOfSight = (start, end, obstacles = [], inflate = 0) => {
  const candidates = queryObstacleSegmentCandidates(obstacles, start, end, inflate);
  for (let i = 0; i < candidates.length; i += 1) {
    const wall = candidates[i];
    if (!wall || wall.destroyed) continue;
    if (lineIntersectsCollider(start, end, wall, inflate)) return false;
  }
  return true;
};

export const estimateLocalFlowWidth = (origin, forward, obstacles = [], options = {}) => {
  const step = Math.max(1, Number(options?.step) || 4);
  const maxProbe = Math.max(step, Number(options?.maxProbe) || 120);
  const inflate = Math.max(0, Number(options?.inflate) || 2.5);
  const dir = normalizeVec(forward?.x || 1, forward?.y || 0);
  const side = { x: -dir.y, y: dir.x };

  const probeSide = (sign = 1) => {
    for (let d = step; d <= maxProbe; d += step) {
      const px = (Number(origin?.x) || 0) + (side.x * d * sign);
      const py = (Number(origin?.y) || 0) + (side.y * d * sign);
      const candidates = queryObstacleCandidates(obstacles, px, py, inflate);
      const blocked = candidates.some((obs) => !obs?.destroyed && isInsideCollider({ x: px, y: py }, obs, inflate));
      if (blocked) return Math.max(step, d - step);
    }
    return maxProbe;
  };

  const left = probeSide(1);
  const right = probeSide(-1);
  return Math.max(step * 2, left + right);
};

export const buildSpatialHash = (agents = [], cellSize = 14) => {
  const size = Math.max(2, Number(cellSize) || 14);
  const map = new Map();
  const keyOf = (x, y) => `${Math.floor(x / size)}:${Math.floor(y / size)}`;
  agents.forEach((agent) => {
    if (!agent || agent.dead) return;
    const key = keyOf(agent.x, agent.y);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(agent);
  });
  return { size, map };
};

export const querySpatialNearby = (hash, x, y, radius = 10, out = []) => {
  const size = Math.max(2, Number(hash?.size) || 14);
  const map = hash?.map instanceof Map ? hash.map : new Map();
  const range = Math.max(1, Math.ceil((Math.max(1, Number(radius) || 1)) / size));
  const cx = Math.floor((Number(x) || 0) / size);
  const cy = Math.floor((Number(y) || 0) / size);
  const rows = Array.isArray(out) ? out : [];
  rows.length = 0;
  for (let ix = -range; ix <= range; ix += 1) {
    for (let iy = -range; iy <= range; iy += 1) {
      const key = `${cx + ix}:${cy + iy}`;
      const bucket = map.get(key);
      if (!bucket) continue;
      for (let index = 0; index < bucket.length; index += 1) {
        rows.push(bucket[index]);
      }
    }
  }
  return rows;
};

export const applyAgentSeparation = (agent, neighbors = [], targetGap = 5.2, strength = 0.68) => {
  let sx = 0;
  let sy = 0;
  neighbors.forEach((other) => {
    if (!other || other.id === agent.id || other.dead) return;
    const dx = (agent.x || 0) - (other.x || 0);
    const dy = (agent.y || 0) - (other.y || 0);
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.0001 || dist >= targetGap) return;
    const push = ((targetGap - dist) / targetGap) * strength;
    sx += (dx / dist) * push;
    sy += (dy / dist) * push;
  });
  return { x: sx, y: sy };
};
