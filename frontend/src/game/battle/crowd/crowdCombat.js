import {
  clamp,
  normalizeVec,
  isInsideRotatedRect,
  pushOutOfRect,
  querySpatialNearby,
  hasLineOfSight
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

const damageScaleFromWeight = (weight = 1) => {
  const safe = Math.max(1, Number(weight) || 1);
  return Math.max(1, Math.sqrt(safe));
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

const canProjectileHitWall = (proj, walls = []) => {
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    if (!wall || wall.destroyed) continue;
    if (isInsideRotatedRect({ x: proj.x, y: proj.y }, wall, proj.radius * 0.25)) {
      return wall;
    }
  }
  return null;
};

const stepProjectiles = (sim, crowd, dt) => {
  const live = crowd.effectsPool?.projectileLive || [];
  for (let i = 0; i < live.length; i += 1) {
    const p = live[i];
    if (!p || p.hit) continue;
    p.x += (p.vx * dt);
    p.y += (p.vy * dt);
    p.z += (p.vz * dt);
    p.vz -= (p.gravity * dt);
    if (p.z <= 0) {
      p.hit = true;
      acquireHitEffect(crowd.effectsPool, {
        type: p.type === 'shell' ? 'explosion' : 'hit',
        x: p.x,
        y: p.y,
        z: 0.8,
        radius: p.type === 'shell' ? 8 : 2.8,
        ttl: p.type === 'shell' ? 0.34 : 0.14,
        team: p.team
      });
      continue;
    }
    const hitWall = canProjectileHitWall(p, sim?.buildings || []);
    if (hitWall) {
      p.hit = true;
      if (p.type === 'shell') {
        const wallDamage = Math.max(1, p.damage * 0.68);
        hitWall.hp = Math.max(0, (Number(hitWall.hp) || 0) - wallDamage);
        if (hitWall.hp <= 0 && !hitWall.destroyed) {
          hitWall.destroyed = true;
          sim.destroyedBuildings = Math.max(0, Number(sim.destroyedBuildings) || 0) + 1;
        }
      }
      acquireHitEffect(crowd.effectsPool, {
        type: p.type === 'shell' ? 'explosion' : 'hit',
        x: p.x,
        y: p.y,
        z: 1.2,
        radius: p.type === 'shell' ? 9.5 : 3.2,
        ttl: p.type === 'shell' ? 0.36 : 0.16,
        team: p.team
      });
      continue;
    }
    const nearbyAgents = querySpatialNearby(crowd?.spatial, p.x, p.y, Math.max(8, (Number(p.radius) || 2) * 2.8));
    const targetAgents = nearbyAgents.filter((agent) => agent && agent.team === p.targetTeam && !agent.dead);
    for (let k = 0; k < targetAgents.length; k += 1) {
      const target = targetAgents[k];
      const hitRadius = Math.max(1.6, (target.radius || 2.6) + (p.radius * 0.25));
      if (distanceSq(p, target) > (hitRadius * hitRadius)) continue;
      p.hit = true;
      applyDamageToAgent(sim, crowd, { squadId: p.squadId, team: p.team }, target, p.damage, p.type === 'shell' ? 'explosion' : 'hit');
      if (p.type === 'shell' && !target.dead) {
        applyShellKnockback(sim, target, p);
      }
      break;
    }
  }
};

export const updateCrowdCombat = (sim, crowd, dt) => {
  const safeDt = Math.max(0, Number(dt) || 0);
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
    if (behavior === 'retreat') return;
    const enemySquads = squad.team === TEAM_ATTACKER ? defenders : attackers;
    const enemyTeam = toEnemyTeam(squad.team);
    if (enemySquads.length <= 0) return;
    const targetSquad = pickEnemySquadTarget(squad, enemySquads, {
      engagementEnabled,
      config: engagementCfg,
      walls,
      nowSec: Number(sim?.timeElapsed) || 0
    });
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
    const idleCanRetaliate = behavior !== 'idle'
      || (Number(squad.underAttackTimer) || 0) > 0.18
      || Math.hypot((targetSquad.x || 0) - (squad.x || 0), (targetSquad.y || 0) - (squad.y || 0)) < (attackRange * 0.92);
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
        const weightScale = damageScaleFromWeight(agent.weight);
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

      const weightScale = damageScaleFromWeight(agent.weight);
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
