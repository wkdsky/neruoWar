import { raycastObstacles } from '../crowd/crowdPhysics';
import { applyDamageToAgent } from '../crowd/crowdCombat';
import { isRangedAgent, resolveAgentAttackRange } from '../crowd/attackRange';
import { acquireHitEffect, acquireProjectile } from '../effects/CombatEffects';
import { filterVisionBlockingObstacles } from '../items/itemObstacleUtils';
import { isSquadCombatEnabled } from '../crowd/combatPolicy';
import { isHostileTeam } from '../crowd/teamRelations';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const TEAM_NEUTRAL = 'neutral';
const OBJECTIVE_TARGET_PRIORITY_NEAREST = 'nearest';
const OBJECTIVE_TARGET_PRIORITY_HIGHEST_THREAT = 'highestThreat';
const OBJECTIVE_TARGET_PRIORITY_LOWEST_HEALTH = 'lowestHealth';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizeTeam = (team = '') => (
  team === TEAM_ATTACKER || team === TEAM_DEFENDER ? team : TEAM_NEUTRAL
);

const normalizeObjectiveTargetPriority = (priority = '') => {
  const normalized = String(priority || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if (normalized === 'highestthreat' || normalized === 'threat' || normalized === 'aggro') {
    return OBJECTIVE_TARGET_PRIORITY_HIGHEST_THREAT;
  }
  if (normalized === 'lowesthealth' || normalized === 'lowesthp' || normalized === 'weakest') {
    return OBJECTIVE_TARGET_PRIORITY_LOWEST_HEALTH;
  }
  return OBJECTIVE_TARGET_PRIORITY_NEAREST;
};

const normalizeWeaponProfile = (profile = {}, index = 0) => ({
  id: String(profile?.id || `weapon-${index + 1}`),
  label: String(profile?.label || `建筑武器 ${index + 1}`),
  delivery: profile?.delivery === 'projectile' ? 'projectile' : 'instant',
  projectileType: profile?.projectileType === 'shell' ? 'shell' : 'arrow',
  attackRange: Math.max(0, finiteNumber(profile?.attackRange)),
  attackIntervalSec: Math.max(0.1, finiteNumber(profile?.attackIntervalSec, 1)),
  attackDamage: Math.max(0, finiteNumber(profile?.attackDamage)),
  priority: normalizeObjectiveTargetPriority(profile?.priority),
  projectileSpeed: Math.max(0, finiteNumber(profile?.projectileSpeed)),
  splashRadius: Math.max(0, finiteNumber(profile?.splashRadius)),
  splashFalloff: clamp(finiteNumber(profile?.splashFalloff), 0, 1),
  wallDamageMul: Math.max(0.1, finiteNumber(profile?.wallDamageMul, 1)),
  cooldown: Math.max(0, finiteNumber(profile?.cooldown))
});

const normalizeObjectiveWeaponProfiles = (definition = {}) => (
  (Array.isArray(definition?.weaponProfiles) ? definition.weaponProfiles : [])
    .map(normalizeWeaponProfile)
    .filter((profile) => profile.attackRange > 0 && profile.attackDamage > 0)
);

const normalizeObjective = (definition = {}, index = 0) => {
  const weaponProfiles = normalizeObjectiveWeaponProfiles(definition);
  const maxWeaponRange = weaponProfiles.reduce((maxRange, profile) => Math.max(maxRange, profile.attackRange), 0);
  return {
  id: String(definition?.objectiveId || `training_objective_${index + 1}`),
  sourceObjectId: String(definition?.sourceObjectId || ''),
  type: String(definition?.type || 'structure'),
  team: normalizeTeam(definition?.team),
  laneId: String(definition?.laneId || 'jungle'),
  routeOrder: Math.max(0, Math.floor(finiteNumber(definition?.routeOrder))),
  maxHp: Math.max(1, finiteNumber(definition?.maxHp, 1000)),
  hp: Math.max(1, finiteNumber(definition?.maxHp, 1000)),
  attackRange: Math.max(Math.max(0, finiteNumber(definition?.attackRange)), maxWeaponRange),
  attackIntervalSec: Math.max(0.1, finiteNumber(definition?.attackIntervalSec, 1)),
  attackDamage: Math.max(0, finiteNumber(definition?.attackDamage)),
  attackEnabled: definition?.attackEnabled !== false && (
    finiteNumber(definition?.attackDamage) > 0 || weaponProfiles.length > 0
  ),
  targetable: definition?.targetable !== false,
  priority: normalizeObjectiveTargetPriority(definition?.priority),
  threatDecayPerSecond: Math.max(0, finiteNumber(definition?.threatDecayPerSecond, 0.2)),
  respawnSec: Math.max(0, finiteNumber(definition?.respawnSec)),
  rewardLabel: String(definition?.rewardLabel || ''),
  weaponProfiles,
  presetTags: Array.isArray(definition?.presetTags) ? definition.presetTags.slice() : [],
  destroyed: false,
  respawnAt: 0,
  attackCooldown: 0,
  lockedSquadId: '',
  currentTargetId: '',
  lastAttackerSquadId: '',
  threatBySquadId: {},
  destroyedAt: 0,
  damageTaken: 0,
  damageDealt: 0,
  killCount: 0
  };
};

const resolveBuildingByObjectId = (sim = {}, objective = {}) => (
  sim?._trainingObjectiveBuildingById instanceof Map
    ? (sim._trainingObjectiveBuildingById.get(String(objective?.sourceObjectId || '')) || null)
    : ((Array.isArray(sim?.buildings) ? sim.buildings : []).find((building) => (
      String(building?.id || '') === String(objective?.sourceObjectId || '')
    )) || null)
);

const ensureTrainingStats = (sim = {}) => {
  if (!sim.trainingStats || typeof sim.trainingStats !== 'object') {
    sim.trainingStats = {
      towerDamage: 0,
      towerKills: 0,
      buildingDamage: 0,
      neutralKills: 0,
      bushFirstAttack: 0,
      laneEngagementSeconds: {},
      bushFirstAttackSquadIds: [],
      objectiveDamageById: {},
      objectiveKillsById: {}
    };
  }
  const stats = sim.trainingStats;
  if (!Number.isFinite(Number(stats.towerDamage))) stats.towerDamage = 0;
  if (!Number.isFinite(Number(stats.towerKills))) stats.towerKills = 0;
  if (!Number.isFinite(Number(stats.buildingDamage))) stats.buildingDamage = 0;
  if (!Number.isFinite(Number(stats.neutralKills))) stats.neutralKills = 0;
  if (!stats.laneEngagementSeconds || typeof stats.laneEngagementSeconds !== 'object') stats.laneEngagementSeconds = {};
  if (!stats.objectiveDamageById || typeof stats.objectiveDamageById !== 'object') stats.objectiveDamageById = {};
  if (!stats.objectiveKillsById || typeof stats.objectiveKillsById !== 'object') stats.objectiveKillsById = {};
  if (!Array.isArray(stats.bushFirstAttackSquadIds)) stats.bushFirstAttackSquadIds = [];
  return stats;
};

const ensureObjectiveRuntimeState = (objective = {}) => {
  if (!objective || typeof objective !== 'object') return objective;
  if (!objective.threatBySquadId || typeof objective.threatBySquadId !== 'object') {
    objective.threatBySquadId = {};
  }
  objective.priority = normalizeObjectiveTargetPriority(objective.priority);
  objective.targetable = objective.targetable !== false;
  objective.threatDecayPerSecond = Math.max(0, finiteNumber(objective.threatDecayPerSecond, 0.2));
  objective.lockedSquadId = String(objective.lockedSquadId || '');
  objective.currentTargetId = String(objective.currentTargetId || objective.lockedSquadId || '');
  objective.lastAttackerSquadId = String(objective.lastAttackerSquadId || '');
  objective.weaponProfiles = normalizeObjectiveWeaponProfiles(objective);
  objective.destroyedAt = Math.max(0, finiteNumber(objective.destroyedAt));
  objective.killCount = Math.max(0, Math.floor(finiteNumber(objective.killCount)));
  return objective;
};

const resolveObjectivePosition = (sim = {}, objective = {}) => {
  const building = resolveBuildingByObjectId(sim, objective);
  return {
    x: finiteNumber(building?.x),
    y: finiteNumber(building?.y),
    radius: Math.max(10, Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5),
    building
  };
};

const canObjectiveTargetSquad = (objective = {}, squad = {}) => {
  if (objective?.targetable === false) return false;
  if (!squad || finiteNumber(squad?.remain) <= 0) return false;
  if (objective?.team === TEAM_ATTACKER && squad?.hiddenFromAttacker) return false;
  if (objective?.team === TEAM_DEFENDER && squad?.hiddenFromDefender) return false;
  if (objective?.team === TEAM_NEUTRAL) return squad?.team === TEAM_ATTACKER || squad?.team === TEAM_DEFENDER;
  return squad?.team !== objective?.team && (squad?.team === TEAM_ATTACKER || squad?.team === TEAM_DEFENDER);
};

const canSquadAttackObjective = (squad = {}, objective = {}) => {
  if (!squad || finiteNumber(squad?.remain) <= 0 || objective?.destroyed || objective?.targetable === false) return false;
  if (!isSquadCombatEnabled(squad)) return false;
  return isHostileTeam(squad?.team, objective?.team);
};

const hasObjectiveLineOfSight = (from = {}, to = {}, obstacles = []) => (
  !raycastObstacles(from, to, obstacles, 0.8)
);

const resolveVisionObstacles = (sim = {}, objective = {}) => (
  filterVisionBlockingObstacles(sim?.buildings || [])
    .filter((building) => String(building?.id || '') !== String(objective?.sourceObjectId || ''))
);

const resolveSquadHealthRatio = (squad = {}) => {
  const maxHealth = Math.max(1, finiteNumber(squad?.maxHealth, finiteNumber(squad?.startCount, finiteNumber(squad?.remain, 1))));
  const health = Math.max(0, finiteNumber(squad?.health, finiteNumber(squad?.remain)));
  return clamp(health / maxHealth, 0, 1);
};

const compareAscending = (left = 0, right = 0) => (
  left < right ? -1 : (left > right ? 1 : 0)
);

const compareDescending = (left = 0, right = 0) => compareAscending(right, left);

const compareObjectiveTargetCandidates = (objective = {}, left = {}, right = {}) => {
  let result = 0;
  if (objective.priority === OBJECTIVE_TARGET_PRIORITY_HIGHEST_THREAT) {
    result = compareDescending(left.threat, right.threat)
      || compareAscending(left.distance, right.distance)
      || compareAscending(left.healthRatio, right.healthRatio);
  } else if (objective.priority === OBJECTIVE_TARGET_PRIORITY_LOWEST_HEALTH) {
    result = compareAscending(left.healthRatio, right.healthRatio)
      || compareDescending(left.threat, right.threat)
      || compareAscending(left.distance, right.distance);
  } else {
    result = compareAscending(left.distance, right.distance)
      || compareDescending(left.threat, right.threat)
      || compareAscending(left.healthRatio, right.healthRatio);
  }
  if (result !== 0) return result;
  return String(left?.squad?.id || '').localeCompare(String(right?.squad?.id || ''));
};

const selectObjectiveTargetSquad = (objective = {}, sim = {}, {
  attackRange = objective?.attackRange,
  priority = objective?.priority
} = {}) => {
  const position = resolveObjectivePosition(sim, objective);
  if (!position.building || position.building.destroyed) return null;
  const targetingObjective = priority === objective?.priority
    ? objective
    : { ...objective, priority: normalizeObjectiveTargetPriority(priority) };
  const obstacles = resolveVisionObstacles(sim, objective);
  const candidates = [];
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    if (!canObjectiveTargetSquad(objective, squad)) return;
    const squadPosition = { x: finiteNumber(squad?.x), y: finiteNumber(squad?.y) };
    const squadRadius = Math.max(4, finiteNumber(squad?.radius, 10));
    const distance = Math.hypot(squadPosition.x - position.x, squadPosition.y - position.y);
    if (distance > Math.max(0, finiteNumber(attackRange)) + position.radius + squadRadius) return;
    if (!hasObjectiveLineOfSight(position, squadPosition, obstacles)) return;
    candidates.push({
      squad,
      distance,
      healthRatio: resolveSquadHealthRatio(squad),
      threat: Math.max(0, finiteNumber(objective?.threatBySquadId?.[squad.id]))
    });
  });
  candidates.sort((left, right) => compareObjectiveTargetCandidates(targetingObjective, left, right));
  return candidates[0]?.squad || null;
};

const decayObjectiveThreat = (objective = {}, sim = {}, dt = 0) => {
  ensureObjectiveRuntimeState(objective);
  const decayMultiplier = Math.max(0, 1 - (objective.threatDecayPerSecond * Math.max(0, finiteNumber(dt))));
  const squadIds = new Set((Array.isArray(sim?.squads) ? sim.squads : []).map((squad) => String(squad?.id || '')));
  Object.entries(objective.threatBySquadId).forEach(([squadId, threat]) => {
    if (!squadIds.has(squadId)) {
      delete objective.threatBySquadId[squadId];
      return;
    }
    const nextThreat = Math.max(0, finiteNumber(threat) * decayMultiplier);
    if (nextThreat <= 0.001) {
      delete objective.threatBySquadId[squadId];
      return;
    }
    objective.threatBySquadId[squadId] = nextThreat;
  });
};

const recordObjectiveThreat = (objective = {}, squad = {}, damage = 0) => {
  ensureObjectiveRuntimeState(objective);
  const squadId = String(squad?.id || '');
  if (!squadId) return;
  const nextThreat = Math.max(0, finiteNumber(objective.threatBySquadId[squadId])) + Math.max(0, finiteNumber(damage));
  objective.threatBySquadId[squadId] = Math.min(1000000, nextThreat);
  objective.lastAttackerSquadId = squadId;
};

const updateObjectiveTargetState = (objective = {}, squad = null) => {
  const squadId = String(squad?.id || '');
  objective.lockedSquadId = squadId;
  objective.currentTargetId = squadId;
};

const selectNearestAgent = (crowd = {}, squad = {}, position = {}) => {
  const agents = crowd?.agentsBySquad?.get(squad?.id) || [];
  let best = null;
  let bestDistance = Infinity;
  agents.forEach((agent) => {
    if (!agent || agent.dead) return;
    const distance = Math.hypot(finiteNumber(agent?.x) - finiteNumber(position?.x), finiteNumber(agent?.y) - finiteNumber(position?.y));
    if (distance < bestDistance) {
      best = agent;
      bestDistance = distance;
    }
  });
  return best;
};

const resolveObjectiveWeaponProfiles = (objective = {}) => {
  const profiles = normalizeObjectiveWeaponProfiles(objective);
  if (profiles.length > 0) return profiles;
  const attackRange = Math.max(0, finiteNumber(objective?.attackRange));
  const attackDamage = Math.max(0, finiteNumber(objective?.attackDamage));
  if (attackRange <= 0 || attackDamage <= 0) return [];
  return [{
    id: 'primary',
    label: '防御攻击',
    delivery: 'instant',
    projectileType: objective?.type === 'tower' ? 'shell' : 'arrow',
    attackRange,
    attackIntervalSec: Math.max(0.1, finiteNumber(objective?.attackIntervalSec, 1)),
    attackDamage,
    priority: normalizeObjectiveTargetPriority(objective?.priority),
    projectileSpeed: 0,
    splashRadius: 0,
    splashFalloff: 0,
    wallDamageMul: 1,
    cooldown: Math.max(0, finiteNumber(objective?.attackCooldown))
  }];
};

const saveObjectiveWeaponProfiles = (objective = {}, profiles = []) => {
  if (!Array.isArray(objective?.weaponProfiles) || objective.weaponProfiles.length <= 0) {
    objective.attackCooldown = Math.max(0, finiteNumber(profiles?.[0]?.cooldown));
    return;
  }
  objective.weaponProfiles = profiles.map((profile) => ({ ...profile }));
  objective.attackCooldown = Math.max(0, finiteNumber(profiles?.[0]?.cooldown));
};

const launchObjectiveProjectile = ({
  crowd = {},
  objective = {},
  weapon = {},
  position = {},
  targetAgent = null
} = {}) => {
  if (!targetAgent || !crowd?.effectsPool) return false;
  const dx = finiteNumber(targetAgent?.x) - finiteNumber(position?.x);
  const dy = finiteNumber(targetAgent?.y) - finiteNumber(position?.y);
  const distance = Math.max(1, Math.hypot(dx, dy));
  const projectileType = weapon?.projectileType === 'shell' ? 'shell' : 'arrow';
  const projectileSpeed = Math.max(
    projectileType === 'shell' ? 120 : 180,
    finiteNumber(weapon?.projectileSpeed)
  );
  const travelSec = clamp(distance / projectileSpeed, projectileType === 'shell' ? 0.48 : 0.25, projectileType === 'shell' ? 2.4 : 1.4);
  const startZ = Math.max(3.4, finiteNumber(position?.building?.height, 24) * (projectileType === 'shell' ? 0.72 : 0.66));
  const gravity = projectileType === 'shell' ? 62 : 46;
  const verticalSpeed = ((0.5 * gravity * travelSec * travelSec) - startZ) / travelSec;
  acquireProjectile(crowd.effectsPool, {
    type: projectileType,
    team: objective?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
    squadId: '',
    sourceAgentId: `objective_source_${objective?.id || ''}`,
    x: finiteNumber(position?.x),
    y: finiteNumber(position?.y),
    z: startZ,
    vx: dx / travelSec,
    vy: dy / travelSec,
    vz: verticalSpeed,
    gravity,
    damage: Math.max(0.06, finiteNumber(weapon?.attackDamage)),
    radius: projectileType === 'shell' ? 4.2 : 1.7,
    impactRadius: projectileType === 'shell' ? Math.max(3.4, finiteNumber(weapon?.splashRadius, 4.2)) : 1.7,
    blastRadius: projectileType === 'shell' ? Math.max(0, finiteNumber(weapon?.splashRadius)) : 0,
    blastFalloff: projectileType === 'shell' ? clamp(finiteNumber(weapon?.splashFalloff, 0.72), 0, 1) : 0,
    wallDamageMul: Math.max(0.1, finiteNumber(weapon?.wallDamageMul, 1)),
    ttl: travelSec + 0.5,
    targetTeam: targetAgent?.team
  });
  return true;
};

const fireObjectiveWeapon = ({
  sim = {},
  crowd = {},
  objective = {},
  weapon = {},
  targetSquad = null
} = {}) => {
  const position = resolveObjectivePosition(sim, objective);
  const targetAgent = selectNearestAgent(crowd, targetSquad, position);
  if (!targetAgent) return false;
  const source = {
    id: `objective_source_${objective.id}`,
    squadId: '',
    team: objective.team === TEAM_NEUTRAL ? TEAM_NEUTRAL : objective.team,
    x: position.x,
    y: position.y
  };
  const damage = Math.max(0.2, finiteNumber(weapon?.attackDamage));
  const firedProjectile = weapon?.delivery === 'projectile'
    && launchObjectiveProjectile({ crowd, objective, weapon, position, targetAgent });
  if (!firedProjectile) {
    applyDamageToAgent(
      sim,
      crowd,
      source,
      targetAgent,
      damage,
      weapon?.projectileType === 'shell' ? 'shell' : 'hit',
      { poiseDamageMul: 0.36 }
    );
  }
  objective.damageDealt += damage;
  acquireHitEffect(crowd.effectsPool, {
    type: weapon?.projectileType === 'shell' ? 'shell' : 'hit',
    x: position.x,
    y: position.y,
    z: Math.max(2, finiteNumber(position?.building?.height, 24) * 0.68),
    radius: weapon?.projectileType === 'shell' ? 4.4 : 2.6,
    ttl: 0.14,
    team: objective.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER
  });
  return true;
};

const resolveAgentObjectiveAttackInterval = (agent = {}) => {
  if (agent?.typeCategory === 'artillery') return 4.8;
  if (agent?.typeCategory === 'archer' || agent?.unitCategory === 'ranged') return 1.16;
  if (agent?.typeCategory === 'cavalry') return 0.86;
  return 0.74;
};

const resolveAgentObjectiveEdgeDistance = (agent = {}, position = {}) => Math.max(
  0,
  Math.hypot(finiteNumber(agent?.x) - position.x, finiteNumber(agent?.y) - position.y)
    - Math.max(0, finiteNumber(agent?.radius, 2.25))
    - Math.max(0, finiteNumber(position?.radius))
);

const launchAgentObjectiveProjectile = ({
  crowd = {},
  objective = {},
  building = {},
  sourceAgent = null
} = {}) => {
  if (!sourceAgent || !crowd?.effectsPool) return false;
  const dx = finiteNumber(building?.x) - finiteNumber(sourceAgent?.x);
  const dy = finiteNumber(building?.y) - finiteNumber(sourceAgent?.y);
  const distance = Math.max(1, Math.hypot(dx, dy));
  const projectileType = sourceAgent?.typeCategory === 'artillery' ? 'shell' : 'arrow';
  const projectileSpeed = projectileType === 'shell' ? 170 : 220;
  acquireProjectile(crowd.effectsPool, {
    type: projectileType,
    team: sourceAgent.team,
    squadId: sourceAgent.squadId,
    sourceAgentId: sourceAgent.id,
    targetBuildingId: String(building?.id || ''),
    visualOnly: true,
    x: finiteNumber(sourceAgent?.x),
    y: finiteNumber(sourceAgent?.y),
    z: projectileType === 'shell' ? 6 : 4.2,
    vx: (dx / distance) * projectileSpeed,
    vy: (dy / distance) * projectileSpeed,
    vz: 0,
    gravity: 0,
    damage: 0,
    radius: projectileType === 'shell' ? 4.5 : 2.2,
    impactRadius: projectileType === 'shell' ? 5.2 : 2.2,
    ttl: (distance / projectileSpeed) + 0.35,
    targetTeam: objective?.team
  });
  return true;
};

const applyObjectiveDamage = (sim = {}, crowd = {}, objective = {}, squad = {}) => {
  const position = resolveObjectivePosition(sim, objective);
  const building = position.building;
  if (!building || building.destroyed || !canSquadAttackObjective(squad, objective)) return 0;
  if (
    squad?.isMinionWaveUnit === true
    && objective?.type === 'tower'
    && String(objective?.laneId || '') !== String(squad?.minionLaneId || '')
  ) return 0;
  const obstacles = resolveVisionObstacles(sim, objective);
  const damageExponent = clamp(finiteNumber(sim?.repConfig?.damageExponent, 0.75), 0.2, 1.25);
  const agents = (crowd?.agentsBySquad?.get(squad.id) || []).filter((agent) => (
    agent
    && !agent.dead
    && agent.unitCategory !== 'support'
    && String(agent.targetBuildingId || '') === String(building.id || '')
  ));
  let actualDamage = 0;
  agents.forEach((agent) => {
    if ((Number(agent.buildingAttackCd) || 0) > 0) return;
    const attackRange = resolveAgentAttackRange(agent, squad);
    const edgeDistance = resolveAgentObjectiveEdgeDistance(agent, position);
    if (edgeDistance < Math.max(0, attackRange.min) - 0.001 || edgeDistance > attackRange.max + 0.001) return;
    if (!hasObjectiveLineOfSight({ x: finiteNumber(agent?.x), y: finiteNumber(agent?.y) }, position, obstacles)) return;
    const attackPower = Math.pow(Math.max(1, finiteNumber(agent?.weight, 1)), damageExponent)
      * Math.max(0.05, finiteNumber(agent?.combatScale, 1));
    const rawDamage = Math.max(0.18, finiteNumber(squad?.stats?.atk, 1) * 0.035 * attackPower);
    const dealt = rawDamage / Math.max(1, finiteNumber(building?.defense, 1));
    actualDamage += dealt;
    agent.buildingAttackCd = resolveAgentObjectiveAttackInterval(agent) * (0.9 + (((Number(agent.slotOrder) || 0) % 5) * 0.025));
    agent.state = 'attack';
    agent.yaw = Math.atan2(position.y - finiteNumber(agent?.y), position.x - finiteNumber(agent?.x));
    if (isRangedAgent(agent)) {
      launchAgentObjectiveProjectile({ crowd, objective, building, sourceAgent: agent });
    } else {
      acquireHitEffect(crowd.effectsPool, {
        type: 'slash',
        x: position.x,
        y: position.y,
        z: Math.max(1.2, finiteNumber(building?.height, 24) * 0.24),
        radius: 3.6,
        ttl: 0.16,
        team: squad.team
      });
    }
  });
  if (actualDamage <= 0) return 0;
  objective.hp = Math.max(0, finiteNumber(objective?.hp) - actualDamage);
  building.hp = objective.hp;
  squad.targetBuildingId = String(building.id || '');
  objective.damageTaken += actualDamage;
  return actualDamage;
};

const destroyObjective = (sim = {}, objective = {}, nowSec = 0, killerSquad = null) => {
  if (objective.destroyed) return false;
  const stats = ensureTrainingStats(sim);
  ensureObjectiveRuntimeState(objective);
  const position = resolveObjectivePosition(sim, objective);
  const buildingWasActive = !!position.building && !position.building.destroyed;
  objective.destroyed = true;
  objective.hp = 0;
  objective.destroyedAt = Math.max(0, finiteNumber(nowSec));
  objective.killCount += 1;
  objective.threatBySquadId = {};
  updateObjectiveTargetState(objective, null);
  if (position.building) {
    position.building.hp = 0;
    position.building.destroyed = true;
  }
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    if (String(squad?.targetBuildingId || '') === String(position?.building?.id || '')) {
      squad.targetBuildingId = '';
    }
    if (String(squad?.order?.targetBuildingId || '') === String(position?.building?.id || '')) {
      squad.order.targetBuildingId = '';
    }
  });
  if (buildingWasActive) {
    sim.destroyedBuildings = Math.max(0, finiteNumber(sim?.destroyedBuildings)) + 1;
  }
  stats.objectiveKillsById[objective.id] = Math.max(0, finiteNumber(stats.objectiveKillsById[objective.id])) + 1;
  if (objective.type === 'tower') {
    stats.towerKills = Math.max(0, finiteNumber(stats.towerKills)) + 1;
  }
  if (objective.type === 'neutralCamp' && objective.respawnSec > 0) {
    objective.respawnAt = nowSec + objective.respawnSec;
  }
  if (killerSquad && objective.type === 'neutralCamp') {
    killerSquad.neutralKills = Math.max(0, finiteNumber(killerSquad?.neutralKills)) + 1;
  }
  return true;
};

const respawnObjective = (sim = {}, objective = {}) => {
  const position = resolveObjectivePosition(sim, objective);
  if (!position.building) return false;
  ensureObjectiveRuntimeState(objective);
  objective.destroyed = false;
  objective.hp = objective.maxHp;
  objective.respawnAt = 0;
  objective.attackCooldown = Math.max(0, objective.attackCooldown);
  objective.destroyedAt = 0;
  objective.threatBySquadId = {};
  updateObjectiveTargetState(objective, null);
  position.building.destroyed = false;
  position.building.hp = objective.maxHp;
  return true;
};

const updateLaneEngagement = (sim = {}, stats = {}, dt = 0) => {
  const lanes = Array.isArray(sim?.trainingMap?.lanes) ? sim.trainingMap.lanes : [];
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  lanes.forEach((lane) => {
    const laneWidth = Math.max(1, finiteNumber(lane?.width, 150));
    const laneSquads = squads.filter((squad) => (
      squad
      && finiteNumber(squad?.remain) > 0
      && Math.abs(finiteNumber(squad?.y) - finiteNumber(lane?.centerY)) <= laneWidth * 0.72
    ));
    const hasAttacker = laneSquads.some((squad) => squad?.team === TEAM_ATTACKER);
    const hasDefender = laneSquads.some((squad) => squad?.team === TEAM_DEFENDER);
    if (!hasAttacker || !hasDefender) return;
    const laneId = String(lane?.id || 'lane');
    stats.laneEngagementSeconds[laneId] = Math.max(0, finiteNumber(stats.laneEngagementSeconds[laneId])) + Math.max(0, finiteNumber(dt));
  });
};

const updateBushFirstAttack = (sim = {}, stats = {}) => {
  const recorded = new Set(stats.bushFirstAttackSquadIds);
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    if (!squad || finiteNumber(squad?.remain) <= 0 || recorded.has(squad.id)) return;
    const hidden = squad?.team === TEAM_DEFENDER ? squad?.hiddenFromAttacker : squad?.hiddenFromDefender;
    const attacking = finiteNumber(squad?.underAttackTimer) > 0.01 || !!squad?.targetSquadId;
    if (!hidden || !attacking) return;
    recorded.add(squad.id);
  });
  stats.bushFirstAttackSquadIds = Array.from(recorded);
  stats.bushFirstAttack = recorded.size;
};

export const createTrainingObjectives = (definitions = []) => (
  (Array.isArray(definitions) ? definitions : [])
    .map((definition, index) => normalizeObjective(definition, index))
);

export const getTrainingObjectiveSummary = (sim = {}) => (
  (Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : []).map((objective) => ({
    id: objective.id,
    type: objective.type,
    team: objective.team,
    laneId: objective.laneId,
    hp: Math.max(0, finiteNumber(objective.hp)),
    maxHp: Math.max(1, finiteNumber(objective.maxHp)),
    destroyed: !!objective.destroyed,
    targetable: objective.targetable !== false,
    lockedSquadId: String(objective.lockedSquadId || ''),
    currentTargetId: String(objective.currentTargetId || objective.lockedSquadId || ''),
    priority: normalizeObjectiveTargetPriority(objective.priority),
    respawnAt: Math.max(0, finiteNumber(objective.respawnAt)),
    destroyedAt: Math.max(0, finiteNumber(objective.destroyedAt)),
    rewardLabel: objective.rewardLabel
  }))
);

export const updateTrainingObjectives = (sim = {}, crowd = {}, dt = 0) => {
  const objectives = Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [];
  if (objectives.length <= 0) return;
  sim._trainingObjectiveBuildingById = new Map(
    (Array.isArray(sim?.buildings) ? sim.buildings : [])
      .filter((building) => building?.id)
      .map((building) => [String(building.id), building])
  );
  const safeDt = clamp(finiteNumber(dt), 0, 0.2);
  const nowSec = Math.max(0, finiteNumber(sim?.timeElapsed));
  const stats = ensureTrainingStats(sim);
  crowd?.agentsBySquad?.forEach?.((agents) => {
    (Array.isArray(agents) ? agents : []).forEach((agent) => {
      if (!agent || agent.dead) return;
      agent.buildingAttackCd = Math.max(0, finiteNumber(agent.buildingAttackCd) - safeDt);
    });
  });

  objectives.forEach((objective) => {
    if (!objective) return;
    ensureObjectiveRuntimeState(objective);
    if (objective.targetable === false) {
      updateObjectiveTargetState(objective, null);
      return;
    }
    decayObjectiveThreat(objective, sim, safeDt);
    const sourceBuilding = resolveBuildingByObjectId(sim, objective);
    const observedHp = Math.max(0, finiteNumber(sourceBuilding?.hp, objective.hp));
    if (!objective.destroyed && observedHp < finiteNumber(objective.hp)) {
      const externalDamage = finiteNumber(objective.hp) - observedHp;
      objective.hp = observedHp;
      objective.damageTaken += externalDamage;
      stats.buildingDamage = Math.max(0, finiteNumber(stats.buildingDamage)) + externalDamage;
      if (objective.type === 'tower') stats.towerDamage = Math.max(0, finiteNumber(stats.towerDamage)) + externalDamage;
      stats.objectiveDamageById[objective.id] = Math.max(0, finiteNumber(stats.objectiveDamageById[objective.id])) + externalDamage;
    }
    if (!objective.destroyed && sourceBuilding?.destroyed) {
      destroyObjective(sim, objective, nowSec);
    }
    if (objective.destroyed) {
      if (objective.type === 'neutralCamp' && objective.respawnAt > 0 && nowSec >= objective.respawnAt) {
        respawnObjective(sim, objective);
      }
      return;
    }
    let lastDamagingSquad = null;
    (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
      const damage = applyObjectiveDamage(sim, crowd, objective, squad);
      if (damage <= 0) return;
      lastDamagingSquad = squad;
      recordObjectiveThreat(objective, squad, damage);
      stats.buildingDamage = Math.max(0, finiteNumber(stats.buildingDamage)) + damage;
      if (objective.type === 'tower') stats.towerDamage = Math.max(0, finiteNumber(stats.towerDamage)) + damage;
      stats.objectiveDamageById[objective.id] = Math.max(0, finiteNumber(stats.objectiveDamageById[objective.id])) + damage;
    });
    if (objective.hp <= 0) {
      if (destroyObjective(sim, objective, nowSec, lastDamagingSquad) && objective.type === 'neutralCamp') {
        stats.neutralKills = Math.max(0, finiteNumber(stats.neutralKills)) + 1;
      }
      return;
    }
    if (!objective.attackEnabled) return;
    const weaponProfiles = resolveObjectiveWeaponProfiles(objective).map((weapon) => ({
      ...weapon,
      cooldown: Math.max(0, finiteNumber(weapon?.cooldown) - safeDt)
    }));
    const weaponTargets = weaponProfiles.map((weapon) => ({
      weapon,
      squad: selectObjectiveTargetSquad(objective, sim, {
        attackRange: weapon.attackRange,
        priority: weapon.priority
      })
    }));
    updateObjectiveTargetState(objective, weaponTargets.find((entry) => entry.squad)?.squad || null);
    weaponTargets.forEach(({ weapon, squad }) => {
      if (!squad || weapon.cooldown > 0) return;
      if (!fireObjectiveWeapon({ sim, crowd, objective, weapon, targetSquad: squad })) return;
      weapon.cooldown = Math.max(0.1, finiteNumber(weapon.attackIntervalSec, 1));
    });
    saveObjectiveWeaponProfiles(objective, weaponProfiles);
  });

  updateLaneEngagement(sim, stats, safeDt);
  updateBushFirstAttack(sim, stats);
};
