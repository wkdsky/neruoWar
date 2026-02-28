import {
  clamp,
  normalizeVec,
  isInsideRotatedRect,
  pushOutOfRect,
  querySpatialNearby,
  hasLineOfSight,
  raycastObstacles
} from './crowdPhysics';
import {
  acquireProjectile,
  acquireHitEffect
} from '../effects/CombatEffects';
import {
  getMeleeEngagementConfig,
  isMeleeEngagementEnabled
} from './engagement';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const ORDER_MOVE = 'MOVE';
const ORDER_ATTACK_MOVE = 'ATTACK_MOVE';
const ORDER_CHARGE = 'CHARGE';

const toEnemyTeam = (team) => (team === TEAM_ATTACKER ? TEAM_DEFENDER : TEAM_ATTACKER);

const sqr = (v) => v * v;
const distanceSq = (a, b) => sqr((a?.x || 0) - (b?.x || 0)) + sqr((a?.y || 0) - (b?.y || 0));

const attackRangeBySquad = (squad = {}) => {
  const category = typeof squad?.classTag === 'string' ? squad.classTag : 'infantry';
  const avgRange = Math.max(1, Number(squad?.stats?.range) || 1);
  if (category === 'artillery') return 126;
  if (category === 'archer') return 88;
  if (category === 'cavalry') return Math.max(7.4, avgRange * 16);
  if (avgRange >= 2.2) return Math.max(64, avgRange * 28);
  return 6.2;
};

const projectileSpeedByCategory = (category = 'archer') => {
  if (category === 'artillery') return 170;
  if (category === 'archer') return 220;
  return 0;
};

const cooldownByCategory = (category = 'infantry') => {
  if (category === 'artillery') return 4.8;
  if (category === 'archer') return 1.16;
  if (category === 'cavalry') return 0.86;
  return 0.74;
};

const damageScaleFromWeight = (weight = 1, exponent = 0.75) => {
  const safe = Math.max(1, Number(weight) || 1);
  const alpha = Math.max(0.2, Math.min(1.25, Number(exponent) || 0.75));
  return Math.max(1, Math.pow(safe, alpha));
};

const projectileCountFromWeight = (weight = 1) => {
  const safe = Math.max(1, Number(weight) || 1);
  return Math.max(1, Math.min(5, 1 + Math.floor(Math.log2(safe))));
};

export const pickEnemySquadTarget = (squad, enemySquads = [], options = {}) => {
  if (!squad || !Array.isArray(enemySquads) || enemySquads.length <= 0) return null;
  const engagementEnabled = !!options?.engagementEnabled;
  const cfg = options?.config || {};
  const walls = Array.isArray(options?.walls) ? options.walls : [];
  let best = null;
  let bestScore = -Infinity;
  enemySquads.forEach((enemy) => {
    if (!enemy || enemy.remain <= 0) return;
    const dist = Math.hypot((enemy.x || 0) - (squad.x || 0), (enemy.y || 0) - (squad.y || 0));
    const threat = Math.max(0, Number(enemy.stats?.atk) || 0) * 1.25;
    const weak = (1 - clamp((enemy.remain || 0) / Math.max(1, enemy.startCount || 1), 0, 1)) * 50;
    let score = threat + weak - (dist * 0.3);
    if (engagementEnabled) {
      const blocked = !hasLineOfSight(
        { x: Number(squad.x) || 0, y: Number(squad.y) || 0 },
        { x: Number(enemy.x) || 0, y: Number(enemy.y) || 0 },
        walls,
        Math.max(0, Number(cfg?.losInflate) || 1.2)
      );
      if (blocked) {
        score -= Math.max(0, Number(cfg?.losPenalty) || 44);
        if (dist > Math.max(16, Number(cfg?.losRejectDistance) || 84)) {
          score -= 999;
        }
      }
      if ((Number(squad._engageRetargetUntil) || 0) > (Number(options?.nowSec) || 0)
        && squad._engageBlockedTargetId === enemy.id) {
        score -= 120;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  });
  return best;
};

const pickNearestEnemyAgent = (agent, enemyAgents = []) => {
  let best = null;
  let bestDist = Infinity;
  enemyAgents.forEach((target) => {
    if (!target || target.dead) return;
    const d = distanceSq(agent, target);
    if (d < bestDist) {
      bestDist = d;
      best = target;
    }
  });
  return best;
};

const isMeleeAgent = (agent = {}) => {
  const category = typeof agent?.typeCategory === 'string' ? agent.typeCategory : '';
  return category !== 'archer' && category !== 'artillery';
};

const pickEnemyAgentsFromSpatial = (crowd, agent, enemyTeam, radius = 24) => {
  const nearby = querySpatialNearby(crowd?.spatial, agent?.x, agent?.y, radius);
  return nearby.filter((row) => row && !row.dead && row.team === enemyTeam);
};

const pickEnemyFromEngagementCandidates = (agent, candidates = [], cfg = {}) => {
  if (!agent || candidates.length <= 0) return null;
  let best = null;
  let bestScore = Infinity;
  const laneNeighborBonus = Math.max(0, Number(cfg?.laneNeighborBonus) || 0.45);
  candidates.forEach((target) => {
    const dist = Math.hypot((target.x || 0) - (agent.x || 0), (target.y || 0) - (agent.y || 0));
    const samePair = !!agent.engagePairKey && !!target.engagePairKey && agent.engagePairKey === target.engagePairKey;
    const laneDiff = Math.abs((Number(agent.engageLane) || 0) - (Number(target.engageLane) || 0));
    const laneScore = samePair ? (laneDiff * laneNeighborBonus) : (2 + laneDiff);
    const anchorDist = Math.hypot((Number(agent.engageAx) || 0) - (target.x || 0), (Number(agent.engageAy) || 0) - (target.y || 0));
    const score = (dist * 0.62) + laneScore + (anchorDist * 0.08) - (samePair ? 2.2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = target;
    }
  });
  return best;
};

const applyDamageToAgent = (sim, crowd, sourceAgent, targetAgent, amount = 0, hitType = 'hit') => {
  if (!targetAgent || targetAgent.dead) return 0;
  const safeAmount = Math.max(0.06, Number(amount) || 0);
  targetAgent.hpWeight = Math.max(0, (Number(targetAgent.hpWeight) || targetAgent.weight || 1) - safeAmount);
  targetAgent.weight = Math.max(0, (Number(targetAgent.weight) || 0) - safeAmount);
  targetAgent.hitTimer = 0.14;
  const targetSquad = sim?.squads?.find((row) => row.id === targetAgent.squadId) || null;
  if (targetSquad) {
    targetSquad.underAttackTimer = 1.1;
    targetSquad.lastAttackedAt = Date.now();
    targetSquad.morale = clamp((Number(targetSquad.morale) || 0) - (safeAmount * 0.22), 0, 100);
  }
  const sourceSquad = sim?.squads?.find((row) => row.id === sourceAgent?.squadId) || null;
  if (sourceSquad) {
    sourceSquad.morale = clamp((Number(sourceSquad.morale) || 0) + (safeAmount * 0.2), 0, 100);
  }
  acquireHitEffect(crowd.effectsPool, {
    type: hitType,
    x: targetAgent.x,
    y: targetAgent.y,
    z: 2.2,
    radius: Math.max(1.3, Math.min(5.4, safeAmount * 1.4)),
    ttl: 0.16,
    team: targetAgent.team
  });
  if (targetAgent.weight <= 0.001) {
    targetAgent.dead = true;
    targetAgent.state = 'dead';
    const source = sim?.squads?.find((row) => row.id === sourceAgent?.squadId);
    if (source) {
      source.kills = Math.max(0, Number(source.kills) || 0) + Math.max(1, Math.round(Number(targetAgent.initialWeight) || 1));
    }
    return Math.max(1, Math.round(Number(targetAgent.initialWeight) || 1));
  }
  return 0;
};

const spawnRangedProjectiles = (sim, crowd, attackerSquad, sourceAgent, targetAgent, category, baseDamage) => {
  const count = category === 'artillery'
    ? Math.max(3, Math.min(6, 2 + Math.floor(Math.log2(Math.max(1, Number(sourceAgent?.weight) || 1)))))
    : projectileCountFromWeight(sourceAgent.weight);
  const speed = projectileSpeedByCategory(category);
  const gravity = category === 'artillery' ? 95 : 70;
  for (let i = 0; i < count; i += 1) {
    const jitter = category === 'artillery'
      ? (i - ((count - 1) / 2)) * 0.16
      : (i - ((count - 1) / 2)) * 0.08;
    const dir = normalizeVec(
      (targetAgent.x - sourceAgent.x) + (jitter * (category === 'artillery' ? 9 : 6)),
      (targetAgent.y - sourceAgent.y) + (jitter * (category === 'artillery' ? 9 : 6))
    );
    acquireProjectile(crowd.effectsPool, {
      type: category === 'artillery' ? 'shell' : 'arrow',
      team: sourceAgent.team,
      squadId: attackerSquad.id,
      sourceAgentId: sourceAgent.id,
      x: sourceAgent.x,
      y: sourceAgent.y,
      z: category === 'artillery' ? 6 : 4.2,
      vx: dir.x * speed,
      vy: dir.y * speed,
      vz: category === 'artillery' ? 44 : 28,
      gravity,
      damage: baseDamage * (category === 'artillery' ? (1.05 + (i * 0.06)) : (0.9 + (i * 0.08))),
      radius: category === 'artillery' ? 4.5 : 2.2,
      ttl: category === 'artillery' ? 2.2 : 1.5,
      targetTeam: toEnemyTeam(sourceAgent.team)
    });
  }
};

const applyShellKnockback = (sim, targetAgent, projectile) => {
  if (!targetAgent || targetAgent.dead || !projectile) return;
  const dir = normalizeVec(Number(projectile.vx) || 0, Number(projectile.vy) || 0);
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || dir.len <= 0.0001) return;
  const baseImpulse = Math.max(1.4, Math.min(7.6, (Number(projectile.damage) || 1) * 0.24));
  const cavalryMul = targetAgent.typeCategory === 'cavalry' ? 1.18 : 1;
  const impulse = baseImpulse * cavalryMul;
  let nx = (Number(targetAgent.x) || 0) + (dir.x * impulse);
  let ny = (Number(targetAgent.y) || 0) + (dir.y * impulse);
  const walls = Array.isArray(sim?.buildings) ? sim.buildings : [];
  walls.forEach((wall) => {
    if (!wall || wall.destroyed) return;
    const pushed = pushOutOfRect({ x: nx, y: ny }, wall, Math.max(0.8, Number(targetAgent.radius) || 2.2));
    nx = pushed.x;
    ny = pushed.y;
  });
  const halfW = (Number(sim?.field?.width) || 900) / 2;
  const halfH = (Number(sim?.field?.height) || 620) / 2;
  targetAgent.x = clamp(nx, -halfW + 2, halfW - 2);
  targetAgent.y = clamp(ny, -halfH + 2, halfH - 2);
  targetAgent.vx = (Number(targetAgent.vx) || 0) + (dir.x * impulse * 10);
  targetAgent.vy = (Number(targetAgent.vy) || 0) + (dir.y * impulse * 10);
};

const withinGroundTargetArea = (proj, x, y) => {
  if (!proj || proj.targetShape !== 'ground_aoe') return true;
  const radius = Math.max(0, Number(proj.targetRadius) || 0);
  if (radius <= 0) return true;
  const dx = (Number(x) || 0) - (Number(proj.targetCenterX) || 0);
  const dy = (Number(y) || 0) - (Number(proj.targetCenterY) || 0);
  return ((dx * dx) + (dy * dy)) <= ((radius + 0.8) ** 2);
};

const applyDamageToBuilding = (sim, wall, damage = 0) => {
  if (!wall || wall.destroyed) return false;
  const actual = Math.max(0.6, Number(damage) || 0);
  wall.hp = Math.max(0, (Number(wall.hp) || 0) - actual);
  if (wall.hp <= 0 && !wall.destroyed) {
    wall.destroyed = true;
    sim.destroyedBuildings = Math.max(0, Number(sim.destroyedBuildings) || 0) + 1;
    return true;
  }
  return false;
};

const applyBlastDamageToWalls = (sim, projectile, center, walls = []) => {
  const blastRadius = Math.max(0, Number(projectile?.blastRadius) || 0);
  if (blastRadius <= 0.001) return;
  walls.forEach((wall) => {
    if (!wall || wall.destroyed) return;
    const sizeBias = Math.max(2, Math.max(Number(wall.width) || 0, Number(wall.depth) || 0) * 0.38);
    const dist = Math.max(0, Math.hypot((wall.x || 0) - center.x, (wall.y || 0) - center.y) - sizeBias);
    if (dist > blastRadius) return;
    const falloff = 1 - clamp(dist / Math.max(1, blastRadius), 0, 0.95);
    const wallDamage = (Number(projectile?.damage) || 0) * Math.max(0.2, falloff) * Math.max(0.1, Number(projectile?.wallDamageMul) || 1);
    applyDamageToBuilding(sim, wall, wallDamage);
  });
};

const applyAreaDamageToAgents = (sim, crowd, projectile, center, walls = []) => {
  const isShell = projectile?.type === 'shell';
  const radius = isShell
    ? Math.max(0.6, Number(projectile?.blastRadius) || Number(projectile?.impactRadius) || Number(projectile?.radius) || 1)
    : Math.max(0.5, Number(projectile?.impactRadius) || Number(projectile?.radius) || 1);
  const nearby = querySpatialNearby(crowd?.spatial, center.x, center.y, Math.max(6, radius + 4));
  const targets = nearby
    .filter((agent) => agent && !agent.dead && agent.team === projectile?.targetTeam)
    .sort((a, b) => distanceSq(a, center) - distanceSq(b, center));
  const maxHits = isShell ? 999 : Math.max(1, Math.floor(Number(projectile?.maxHits) || 1));
  let hits = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (!withinGroundTargetArea(projectile, target.x, target.y)) continue;
    if (projectile?.blockedByWall && !hasLineOfSight(center, target, walls, 0.8)) continue;
    const dist = Math.hypot((target.x || 0) - center.x, (target.y || 0) - center.y);
    if (dist > (radius + Math.max(0.6, (Number(target.radius) || 2.2) * 0.35))) continue;
    const falloff = isShell
      ? Math.max(0.18, 1 - (dist / Math.max(1, radius)) * Math.max(0.2, Number(projectile?.blastFalloff) || 1))
      : 1;
    const dmg = Math.max(0.06, (Number(projectile?.damage) || 0) * falloff);
    applyDamageToAgent(
      sim,
      crowd,
      { squadId: projectile?.squadId, team: projectile?.team },
      target,
      dmg,
      isShell ? 'explosion' : 'hit'
    );
    if (isShell && !target.dead) {
      applyShellKnockback(sim, target, projectile);
    }
    hits += 1;
    if (hits >= maxHits) break;
  }
  return hits;
};

const detectWallSweepHit = (projectile, prev, walls = []) => {
  const curr = {
    x: Number(projectile?.x) || 0,
    y: Number(projectile?.y) || 0
  };
  const hit = raycastObstacles(
    { x: Number(prev?.x) || 0, y: Number(prev?.y) || 0 },
    curr,
    walls,
    Math.max(0.2, (Number(projectile?.radius) || 2.2) * 0.25)
  );
  if (hit) {
    return {
      wall: hit.obstacle,
      x: hit.x,
      y: hit.y,
      t: hit.t
    };
  }
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    if (!wall || wall.destroyed) continue;
    if (isInsideRotatedRect(curr, wall, Math.max(0.2, (Number(projectile?.radius) || 2.2) * 0.25))) {
      return {
        wall,
        x: curr.x,
        y: curr.y,
        t: 1
      };
    }
  }
  return null;
};

const detonateProjectile = (sim, crowd, projectile, center, walls, hitWall = null) => {
  projectile.hit = true;
  projectile.hitCount = Math.max(0, Number(projectile.hitCount) || 0) + 1;
  if (hitWall) {
    const wallDamage = Math.max(1, (Number(projectile.damage) || 1) * (projectile.type === 'shell' ? 0.68 : 0.22) * Math.max(0.1, Number(projectile.wallDamageMul) || 1));
    applyDamageToBuilding(sim, hitWall, wallDamage);
  }
  if (projectile.type === 'shell') {
    applyBlastDamageToWalls(sim, projectile, center, walls);
  }
  applyAreaDamageToAgents(sim, crowd, projectile, center, walls);
  const effectRadius = projectile.type === 'shell'
    ? Math.max(4, Number(projectile.blastRadius) || Number(projectile.impactRadius) || 9.5)
    : Math.max(1.2, Number(projectile.impactRadius) || 2.8);
  acquireHitEffect(crowd.effectsPool, {
    type: projectile.type === 'shell' ? 'explosion' : 'hit',
    x: center.x,
    y: center.y,
    z: projectile.type === 'shell' ? 1.2 : 0.9,
    radius: effectRadius,
    ttl: projectile.type === 'shell' ? 0.44 : 0.18,
    team: projectile.team
  });
};

const stepProjectiles = (sim, crowd, dt) => {
  const live = crowd.effectsPool?.projectileLive || [];
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((wall) => wall && !wall.destroyed) : [];
  for (let i = 0; i < live.length; i += 1) {
    const p = live[i];
    if (!p || p.hit) continue;
    const prev = {
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      z: Number(p.z) || 0
    };
    p.x += (p.vx * dt);
    p.y += (p.vy * dt);
    p.z += (p.vz * dt);
    p.vz -= (p.gravity * dt);

    const wallSweepHit = detectWallSweepHit(p, prev, walls);
    if (wallSweepHit?.wall) {
      p.x = wallSweepHit.x;
      p.y = wallSweepHit.y;
      p.z = prev.z + ((p.z - prev.z) * clamp(wallSweepHit.t, 0, 1));
      detonateProjectile(sim, crowd, p, { x: p.x, y: p.y }, walls, wallSweepHit.wall);
      continue;
    }

    if (p.z <= 0) {
      detonateProjectile(sim, crowd, p, { x: p.x, y: p.y }, walls, null);
      continue;
    }

    const nearbyAgents = querySpatialNearby(crowd?.spatial, p.x, p.y, Math.max(8, (Number(p.radius) || 2) * 2.8));
    const targetAgents = nearbyAgents.filter((agent) => agent && agent.team === p.targetTeam && !agent.dead);
    for (let k = 0; k < targetAgents.length; k += 1) {
      const target = targetAgents[k];
      if (!withinGroundTargetArea(p, target.x, target.y)) continue;
      const hitRadius = Math.max(1.6, (target.radius || 2.6) + (p.radius * 0.25));
      if (distanceSq(p, target) > (hitRadius * hitRadius)) continue;
      detonateProjectile(sim, crowd, p, { x: target.x || p.x, y: target.y || p.y }, walls, null);
      break;
    }
  }
};

export const updateCrowdCombat = (sim, crowd, dt) => {
  const safeDt = Math.max(0, Number(dt) || 0);
  const damageExponent = Math.max(0.2, Math.min(1.25, Number(sim?.repConfig?.damageExponent) || 0.75));
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const attackers = squads.filter((row) => row.team === TEAM_ATTACKER && row.remain > 0);
  const defenders = squads.filter((row) => row.team === TEAM_DEFENDER && row.remain > 0);
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((wall) => wall && !wall.destroyed) : [];
  const engagementEnabled = crowd?.engagement ? !!crowd.engagement.enabled : isMeleeEngagementEnabled();
  const engagementCfg = crowd?.engagement?.config || getMeleeEngagementConfig();
  const engageScanRadius = Math.max(8, Number(engagementCfg?.engageScanRadius) || 26);

  squads.forEach((squad) => {
    if (!squad || squad.remain <= 0) return;
    if ((Number(squad?.skillRush?.ttl) || 0) > 0) return;
    const behavior = typeof squad.behavior === 'string' ? squad.behavior : 'auto';
    const orderType = typeof squad?.order?.type === 'string' ? squad.order.type : '';
    const chargeCommitted = orderType === ORDER_CHARGE && (Number(squad?.order?.commitUntil) || 0) > (Number(sim?.timeElapsed) || 0);
    if (behavior === 'retreat') return;
    if (squad.activeSkill && (squad.classTag === 'archer' || squad.classTag === 'artillery')) return;
    const enemySquads = squad.team === TEAM_ATTACKER ? defenders : attackers;
    const enemyTeam = toEnemyTeam(squad.team);
    if (enemySquads.length <= 0) return;
    let targetSquad = null;
    if (chargeCommitted) {
      targetSquad = enemySquads.find((row) => row.id === squad.targetSquadId && row.remain > 0)
        || enemySquads
          .slice()
          .sort((a, b) => Math.hypot((a.x || 0) - (squad.x || 0), (a.y || 0) - (squad.y || 0))
            - Math.hypot((b.x || 0) - (squad.x || 0), (b.y || 0) - (squad.y || 0)))[0]
        || null;
    } else {
      targetSquad = pickEnemySquadTarget(squad, enemySquads, {
        engagementEnabled,
        config: engagementCfg,
        walls,
        nowSec: Number(sim?.timeElapsed) || 0
      });
    }
    if (!targetSquad) return;
    squad.targetSquadId = targetSquad.id;

    const agents = crowd.agentsBySquad.get(squad.id) || [];
    const enemyAgents = crowd.agentsBySquad.get(targetSquad.id) || [];
    if (agents.length <= 0 || enemyAgents.length <= 0) return;

    const attackRange = attackRangeBySquad(squad);
    const isRanged = squad.classTag === 'archer'
      || squad.classTag === 'artillery'
      || squad.roleTag === '远程'
      || (Number(squad?.stats?.range) || 0) >= 2.2;
    const squadDistToTarget = Math.hypot((targetSquad.x || 0) - (squad.x || 0), (targetSquad.y || 0) - (squad.y || 0));
    const moveOrder = orderType === ORDER_MOVE;
    const attackMoveOrder = orderType === ORDER_ATTACK_MOVE;
    let idleCanRetaliate = behavior !== 'idle'
      || (Number(squad.underAttackTimer) || 0) > 0.18
      || squadDistToTarget < (attackRange * 0.92);
    if (moveOrder) {
      idleCanRetaliate = ((Number(squad.underAttackTimer) || 0) > 0.42)
        || squadDistToTarget < (attackRange * 0.45);
    } else if (attackMoveOrder || chargeCommitted) {
      idleCanRetaliate = true;
    }
    if (!idleCanRetaliate) return;
    if (squad.classTag === 'artillery' && isRanged) {
      squad._artilleryVolleyCd = Math.max(0, (Number(squad._artilleryVolleyCd) || 0) - safeDt);
      if (squad._artilleryVolleyCd > 0) {
        return;
      }
      const rankedShooters = [...agents]
        .filter((agent) => agent && !agent.dead)
        .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
      const shooterCount = Math.max(2, Math.min(7, Math.floor(Math.sqrt(rankedShooters.length)) + 1));
      const shooters = rankedShooters.slice(0, shooterCount);
      let fired = 0;
      shooters.forEach((agent) => {
        const localEnemies = pickEnemyAgentsFromSpatial(
          crowd,
          agent,
          enemyTeam,
          Math.max(engageScanRadius * 1.4, attackRange * 1.1)
        );
        const pool = localEnemies;
        const target = engagementEnabled
          ? (pickEnemyFromEngagementCandidates(agent, pool, engagementCfg) || pickNearestEnemyAgent(agent, pool))
          : pickNearestEnemyAgent(agent, pool);
        if (!target) return;
        const dist = Math.hypot((target.x || 0) - (agent.x || 0), (target.y || 0) - (agent.y || 0));
        if (dist > attackRange) return;
        const weightScale = damageScaleFromWeight(agent.weight, damageExponent);
        const baseDamage = Math.max(0.42, ((Number(squad.stats?.atk) || 10) * 0.042) * weightScale);
        spawnRangedProjectiles(sim, crowd, squad, agent, target, 'artillery', baseDamage);
        agent.state = 'attack';
        agent.attackCd = 0.55 + (Math.random() * 0.22);
        fired += 1;
      });
      if (fired > 0) {
        squad._artilleryVolleyCd = cooldownByCategory('artillery') * (0.9 + Math.random() * 0.22);
        squad.action = '普通攻击';
      }
      return;
    }
    agents.forEach((agent) => {
      if (!agent || agent.dead) return;
      agent.attackCd = Math.max(0, (Number(agent.attackCd) || 0) - safeDt);
      const searchRadius = isRanged
        ? Math.max(engageScanRadius * 1.25, attackRange * 1.35)
        : Math.max(engageScanRadius, attackRange * 2);
      const localEnemies = pickEnemyAgentsFromSpatial(crowd, agent, enemyTeam, searchRadius);
      const pool = localEnemies;
      const target = (engagementEnabled && isMeleeAgent(agent))
        ? (pickEnemyFromEngagementCandidates(agent, pool, engagementCfg) || pickNearestEnemyAgent(agent, pool))
        : pickNearestEnemyAgent(agent, pool);
      if (!target) return;
      const distSq = distanceSq(agent, target);
      const dist = Math.sqrt(distSq);
      agent.targetAgentId = target.id;
      if (dist > attackRange) return;
      if (agent.attackCd > 0) return;
      if (engagementEnabled && !isRanged && isMeleeAgent(agent)) {
        const anchorDist = Math.hypot(
          (Number(agent.engageAx) || (agent.x || 0)) - (agent.x || 0),
          (Number(agent.engageAy) || (agent.y || 0)) - (agent.y || 0)
        );
        const bandLimit = Math.max(attackRange * 1.3, Number(engagementCfg?.bandHalfDepth) || 8.8);
        const laneDiff = Math.abs((Number(agent.engageLane) || 0) - (Number(target.engageLane) || 0));
        const laneTolerance = Math.max(2, Math.floor((Number(engagementCfg?.laneSearchRadius) || 3) + 1));
        const samePair = !!agent.engagePairKey && !!target.engagePairKey && agent.engagePairKey === target.engagePairKey;
        if (!samePair && dist > attackRange * 0.92) return;
        if (anchorDist > bandLimit * 1.55 && laneDiff > laneTolerance) return;
      }

      const weightScale = damageScaleFromWeight(agent.weight, damageExponent);
      const baseDamage = Math.max(0.18, ((Number(squad.stats?.atk) || 10) * 0.035) * weightScale);
      if (isRanged) {
        spawnRangedProjectiles(sim, crowd, squad, agent, target, squad.classTag, baseDamage);
        agent.state = 'attack';
      } else {
        applyDamageToAgent(sim, crowd, agent, target, baseDamage, 'slash');
        acquireHitEffect(crowd.effectsPool, {
          type: 'slash',
          x: (agent.x + target.x) / 2,
          y: (agent.y + target.y) / 2,
          z: 1.8,
          radius: Math.max(2, Math.min(5.5, weightScale * 1.2)),
          ttl: 0.12,
          team: squad.team
        });
        agent.state = 'attack';
      }
      agent.attackCd = cooldownByCategory(squad.classTag) * (0.86 + Math.random() * 0.22);
    });
  });

  stepProjectiles(sim, crowd, safeDt);
};
