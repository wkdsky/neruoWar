/**
 * Crowd movement/avoidance helpers for agent-level battle simulation.
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

export const isInsideRotatedRect = (point, rect, inflate = 0) => {
  const local = rotate2D(
    (Number(point?.x) || 0) - (Number(rect?.x) || 0),
    (Number(point?.y) || 0) - (Number(rect?.y) || 0),
    -(Number(rect?.rotation) || 0)
  );
  const hw = (Math.max(1, Number(rect?.width) || 1) / 2) + inflate;
  const hh = (Math.max(1, Number(rect?.depth) || 1) / 2) + inflate;
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
};

export const pushOutOfRect = (point, rect, inflate = 0) => {
  const cx = Number(point?.x) || 0;
  const cy = Number(point?.y) || 0;
  const local = rotate2D(
    cx - (Number(rect?.x) || 0),
    cy - (Number(rect?.y) || 0),
    -(Number(rect?.rotation) || 0)
  );
  const hw = (Math.max(1, Number(rect?.width) || 1) / 2) + inflate;
  const hh = (Math.max(1, Number(rect?.depth) || 1) / 2) + inflate;
  if (Math.abs(local.x) > hw || Math.abs(local.y) > hh) return { x: cx, y: cy, pushed: false };

  const dx = hw - Math.abs(local.x);
  const dy = hh - Math.abs(local.y);
  if (dx < dy) {
    local.x += local.x >= 0 ? dx : -dx;
  } else {
    local.y += local.y >= 0 ? dy : -dy;
  }
  const world = rotate2D(local.x, local.y, Number(rect?.rotation) || 0);
  return {
    x: (Number(rect?.x) || 0) + world.x,
    y: (Number(rect?.y) || 0) + world.y,
    pushed: true
  };
};

const segmentIntersectsAabb = (a, b, minX, maxX, minY, maxY) => {
  const dx = (Number(b?.x) || 0) - (Number(a?.x) || 0);
  const dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) <= 1e-9) {
      return q >= 0;
    }
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
  if (!clip(-dx, (Number(a?.x) || 0) - minX)) return false;
  if (!clip(dx, maxX - (Number(a?.x) || 0))) return false;
  if (!clip(-dy, (Number(a?.y) || 0) - minY)) return false;
  if (!clip(dy, maxY - (Number(a?.y) || 0))) return false;
  return t1 >= t0 && t1 >= 0 && t0 <= 1;
};

export const lineIntersectsRotatedRect = (start, end, rect, inflate = 0) => {
  const sx = Number(start?.x) || 0;
  const sy = Number(start?.y) || 0;
  const ex = Number(end?.x) || 0;
  const ey = Number(end?.y) || 0;
  const cx = Number(rect?.x) || 0;
  const cy = Number(rect?.y) || 0;
  const rot = Number(rect?.rotation) || 0;
  const hw = (Math.max(1, Number(rect?.width) || 1) / 2) + Math.max(0, Number(inflate) || 0);
  const hh = (Math.max(1, Number(rect?.depth) || 1) / 2) + Math.max(0, Number(inflate) || 0);
  const localStart = rotate2D(sx - cx, sy - cy, -rot);
  const localEnd = rotate2D(ex - cx, ey - cy, -rot);
  if (
    (Math.abs(localStart.x) <= hw && Math.abs(localStart.y) <= hh)
    || (Math.abs(localEnd.x) <= hw && Math.abs(localEnd.y) <= hh)
  ) {
    return true;
  }
  return segmentIntersectsAabb(localStart, localEnd, -hw, hw, -hh, hh);
};

export const hasLineOfSight = (start, end, obstacles = [], inflate = 0) => {
  for (let i = 0; i < obstacles.length; i += 1) {
    const wall = obstacles[i];
    if (!wall || wall.destroyed) continue;
    if (lineIntersectsRotatedRect(start, end, wall, inflate)) {
      return false;
    }
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
      const blocked = obstacles.some((obs) => !obs?.destroyed && isInsideRotatedRect({ x: px, y: py }, obs, inflate));
      if (blocked) {
        return Math.max(step, d - step);
      }
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
