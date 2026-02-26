/**
 * Lightweight pooled combat effects/projectiles container.
 * Keeps allocations stable during long PVE battles.
 */

const nowMs = () => Date.now();

export const createCombatEffectsPool = () => ({
  projectileFree: [],
  projectileLive: [],
  hitFree: [],
  hitLive: [],
  nextId: 1
});

const resetProjectile = (item, payload = {}) => {
  const next = item || {};
  next.id = `proj_${payload.id || 0}`;
  next.type = payload.type || 'arrow';
  next.team = payload.team || '';
  next.squadId = payload.squadId || '';
  next.sourceAgentId = payload.sourceAgentId || '';
  next.x = Number(payload.x) || 0;
  next.y = Number(payload.y) || 0;
  next.z = Number(payload.z) || 3;
  next.vx = Number(payload.vx) || 0;
  next.vy = Number(payload.vy) || 0;
  next.vz = Number(payload.vz) || 0;
  next.gravity = Number.isFinite(Number(payload.gravity)) ? Number(payload.gravity) : 0;
  next.damage = Math.max(0, Number(payload.damage) || 0);
  next.radius = Math.max(0.2, Number(payload.radius) || 2.2);
  next.ttl = Math.max(0.02, Number(payload.ttl) || 1.2);
  next.elapsed = 0;
  next.spawnedAt = payload.spawnedAt || nowMs();
  next.targetTeam = payload.targetTeam || '';
  next.hit = false;
  return next;
};

const resetHitEffect = (item, payload = {}) => {
  const next = item || {};
  next.id = `hit_${payload.id || 0}`;
  next.type = payload.type || 'hit';
  next.x = Number(payload.x) || 0;
  next.y = Number(payload.y) || 0;
  next.z = Number(payload.z) || 2;
  next.radius = Math.max(0.4, Number(payload.radius) || 3);
  next.ttl = Math.max(0.04, Number(payload.ttl) || 0.18);
  next.elapsed = 0;
  next.team = payload.team || '';
  next.spawnedAt = payload.spawnedAt || nowMs();
  return next;
};

export const acquireProjectile = (pool, payload = {}) => {
  if (!pool) return null;
  const node = pool.projectileFree.pop() || {};
  const built = resetProjectile(node, {
    ...payload,
    id: pool.nextId += 1
  });
  pool.projectileLive.push(built);
  return built;
};

export const acquireHitEffect = (pool, payload = {}) => {
  if (!pool) return null;
  const node = pool.hitFree.pop() || {};
  const built = resetHitEffect(node, {
    ...payload,
    id: pool.nextId += 1
  });
  pool.hitLive.push(built);
  return built;
};

export const stepEffectPool = (pool, dt = 0) => {
  if (!pool) return;
  const safeDt = Math.max(0, Number(dt) || 0);

  for (let i = pool.projectileLive.length - 1; i >= 0; i -= 1) {
    const p = pool.projectileLive[i];
    p.elapsed += safeDt;
    p.ttl -= safeDt;
    if (p.ttl > 0 && !p.hit) continue;
    pool.projectileLive.splice(i, 1);
    pool.projectileFree.push(p);
  }

  for (let i = pool.hitLive.length - 1; i >= 0; i -= 1) {
    const e = pool.hitLive[i];
    e.elapsed += safeDt;
    e.ttl -= safeDt;
    if (e.ttl > 0) continue;
    pool.hitLive.splice(i, 1);
    pool.hitFree.push(e);
  }
};

