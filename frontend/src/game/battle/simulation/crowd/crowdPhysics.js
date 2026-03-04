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
  const len = Math.hypot(x, y) || 1;
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

const getWorldCompositeParts = (obs = {}) => {
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : null;
  const parts = Array.isArray(source?.parts) ? source.parts : [];
  if (parts.length <= 0) {
    return [getDefaultPart(obs)];
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
  return out.length > 0 ? out : [getDefaultPart(obs)];
};

const getWorldPolygon = (obs = {}) => {
  const source = obs?.collider && typeof obs.collider === 'object' ? obs.collider : null;
  const rawPoints = Array.isArray(source?.polygon?.points) ? source.polygon.points : [];
  if (rawPoints.length < 3) return [];
  const yaw = normalizeDeg(obs?.rotation || 0);
  return rawPoints.map((point) => {
    const rotated = rotate2D(Number(point?.x) || 0, Number(point?.y) || 0, yaw);
    return {
      x: (Number(obs?.x) || 0) + rotated.x,
      y: (Number(obs?.y) || 0) + rotated.y
    };
  });
};

const getColliderKind = (obs = {}) => {
  const kind = typeof obs?.collider?.kind === 'string' ? obs.collider.kind : '';
  if (kind === 'polygon') return 'polygon';
  if (kind === 'compositeObb') return 'compositeObb';
  return 'rect';
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

export const isInsideCollider = (point, obstacle, inflate = 0) => {
  if (!obstacle) return false;
  const kind = getColliderKind(obstacle);
  if (kind === 'polygon') {
    const poly = getWorldPolygon(obstacle);
    if (poly.length >= 3) return pointInPolygon(point, poly);
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
    if (!pointInPolygon(point, poly)) {
      return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false };
    }
    const center = {
      x: poly.reduce((sum, p) => sum + p.x, 0) / Math.max(1, poly.length),
      y: poly.reduce((sum, p) => sum + p.y, 0) / Math.max(1, poly.length)
    };
    const dir = normalizeVec((Number(point?.x) || 0) - center.x, (Number(point?.y) || 0) - center.y);
    return {
      x: (Number(point?.x) || 0) + (dir.x * Math.max(0.4, inflate + 0.4)),
      y: (Number(point?.y) || 0) + (dir.y * Math.max(0.4, inflate + 0.4)),
      pushed: true
    };
  }
  const parts = getWorldCompositeParts(obstacle);
  let best = { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false, move: Infinity };
  for (let i = 0; i < parts.length; i += 1) {
    const pushed = pushOutOfObb(point, parts[i], inflate);
    if (!pushed.pushed) continue;
    const move = Math.hypot(pushed.x - (Number(point?.x) || 0), pushed.y - (Number(point?.y) || 0));
    if (move < best.move) best = { ...pushed, move };
  }
  if (!best.pushed) return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pushed: false };
  return { x: best.x, y: best.y, pushed: true };
};

export const raycastCollider = (start, end, obstacle, inflate = 0) => {
  if (!obstacle) return null;
  const kind = getColliderKind(obstacle);
  if (kind === 'polygon') {
    const poly = getWorldPolygon(obstacle);
    const hit = raycastPolygon(
      { x: Number(start?.x) || 0, y: Number(start?.y) || 0 },
      { x: Number(end?.x) || 0, y: Number(end?.y) || 0 },
      poly
    );
    if (!hit) return null;
    return {
      ...hit,
      obstacle
    };
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

export const raycastObstacles = (start, end, obstacles = [], inflate = 0) => {
  let best = null;
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
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
  for (let i = 0; i < obstacles.length; i += 1) {
    const wall = obstacles[i];
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
      const blocked = obstacles.some((obs) => !obs?.destroyed && isInsideCollider({ x: px, y: py }, obs, inflate));
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

export const querySpatialNearby = (hash, x, y, radius = 10) => {
  const size = Math.max(2, Number(hash?.size) || 14);
  const map = hash?.map instanceof Map ? hash.map : new Map();
  const range = Math.max(1, Math.ceil((Math.max(1, Number(radius) || 1)) / size));
  const cx = Math.floor((Number(x) || 0) / size);
  const cy = Math.floor((Number(y) || 0) / size);
  const rows = [];
  for (let ix = -range; ix <= range; ix += 1) {
    for (let iy = -range; iy <= range; iy += 1) {
      const key = `${cx + ix}:${cy + iy}`;
      if (!map.has(key)) continue;
      rows.push(...map.get(key));
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
