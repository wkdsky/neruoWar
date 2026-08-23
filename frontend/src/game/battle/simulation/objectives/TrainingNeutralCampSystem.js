import { TEAM_NEUTRAL, isHostileTeam } from '../crowd/teamRelations';
import { TRAINING_MAP_WORLD_HEIGHT, TRAINING_MAP_WORLD_WIDTH } from '../../shared/trainingMap';

const CAMP_STATE_WAITING = 'waiting';
const CAMP_STATE_SPAWNING = 'spawning';
const CAMP_STATE_ALIVE = 'alive';
const CAMP_STATE_ALERTED = 'alerted';
const CAMP_STATE_CHASING = 'chasing';
const CAMP_STATE_FIGHTING = 'fighting';
const CAMP_STATE_LEASHING = 'leashing';
const CAMP_STATE_CLEARED = 'cleared';
const CAMP_STATE_RESPAWNING = 'respawning';
const CAMP_STATE_DISABLED = 'disabled';
const CAMP_PATROL_ARRIVAL_RADIUS = 6;
const NEUTRAL_FORMATION_SPACING = 5.55;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const distance = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const normalizePoint = (point = {}, fallback = {}) => ({
  x: finiteNumber(point?.x, finiteNumber(fallback?.x)),
  y: finiteNumber(point?.y, finiteNumber(fallback?.y))
});

const normalizeComposition = (composition = []) => {
  const source = Array.isArray(composition) ? composition : [];
  const entries = source.map((entry, index) => ({
    unitTypeId: String(entry?.unitTypeId || `training_neutral_guard_${index + 1}`),
    name: String(entry?.name || entry?.unitTypeId || `中立守卫 ${index + 1}`),
    count: Math.max(1, Math.floor(finiteNumber(entry?.count, 8))),
    hp: Math.max(1, finiteNumber(entry?.hp, 80)),
    attack: Math.max(0.1, finiteNumber(entry?.attack, 14)),
    defense: Math.max(0.1, finiteNumber(entry?.defense, 7)),
    speed: Math.max(0.2, finiteNumber(entry?.speed, 1)),
    attackRange: Math.max(1, finiteNumber(entry?.attackRange, 1)),
    classTag: String(entry?.classTag || 'infantry'),
    unitCategory: String(entry?.unitCategory || 'melee'),
    unitSubtype: String(entry?.unitSubtype || 'balance')
  }));
  return entries.length > 0 ? entries : [{
    unitTypeId: 'training_neutral_guard',
    name: '中立守卫',
    count: 8,
    hp: 80,
    attack: 14,
    defense: 7,
    speed: 1,
    attackRange: 1,
    classTag: 'infantry',
    unitCategory: 'melee',
    unitSubtype: 'balance'
  }];
};

const resolveCompositionMetrics = (composition = []) => {
  const rows = normalizeComposition(composition);
  let totalCount = 0;
  let totalHealth = 0;
  let totalAttack = 0;
  let totalDefense = 0;
  let totalSpeed = 0;
  let totalRange = 0;
  const units = {};
  rows.forEach((entry) => {
    totalCount += entry.count;
    totalHealth += entry.hp * entry.count;
    totalAttack += entry.attack * entry.count;
    totalDefense += entry.defense * entry.count;
    totalSpeed += entry.speed * entry.count;
    totalRange += entry.attackRange * entry.count;
    units[entry.unitTypeId] = Math.max(0, finiteNumber(units[entry.unitTypeId])) + entry.count;
  });
  const primary = rows[0];
  return {
    units,
    totalCount: Math.max(1, totalCount),
    maxHealth: Math.max(1, totalHealth),
    hpAvg: Math.max(1, totalHealth / Math.max(1, totalCount)),
    stats: {
      atk: Math.max(0.1, totalAttack / Math.max(1, totalCount)),
      def: Math.max(0.1, totalDefense / Math.max(1, totalCount)),
      speed: Math.max(0.2, totalSpeed / Math.max(1, totalCount)),
      range: Math.max(1, totalRange / Math.max(1, totalCount)),
      attackRange: {
        min: 1,
        max: Math.max(1, totalRange / Math.max(1, totalCount))
      }
    },
    classTag: primary.classTag,
    unitCategory: primary.unitCategory,
    unitSubtype: primary.unitSubtype
  };
};

const resolveBuilding = (buildings = [], sourceObjectId = '') => (
  (Array.isArray(buildings) ? buildings : []).find((building) => (
    String(building?.id || '') === String(sourceObjectId || '')
  )) || null
);

const normalizePoints = (points = [], fallback = {}) => {
  const source = Array.isArray(points) ? points : [];
  const normalized = source
    .filter((point) => point && typeof point === 'object')
    .map((point) => normalizePoint(point, fallback));
  return normalized.length > 0 ? normalized : [normalizePoint(fallback)];
};

const sanitizeCampId = (value = '') => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '_');

const resolveCampPatrolEnabled = (config = {}) => {
  if (typeof config?.patrolEnabled === 'boolean') return config.patrolEnabled;
  return Array.isArray(config?.patrolPoints) && config.patrolPoints.length > 0;
};

const buildNeutralFormationSlots = (totalCount = 1, spacing = NEUTRAL_FORMATION_SPACING) => {
  const count = Math.max(1, Math.floor(finiteNumber(totalCount, 1)));
  const safeSpacing = Math.max(0.1, finiteNumber(spacing, NEUTRAL_FORMATION_SPACING));
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = (row * columns) + col;
      if (index >= count) break;
      slots.push({
        side: (col - ((columns - 1) * 0.5)) * safeSpacing,
        front: ((((rows - 1) * 0.5) - row) * safeSpacing * 0.92),
        row,
        col
      });
    }
  }
  const centerSide = (columns - 1) * 0.5;
  const centerRow = (rows - 1) * 0.5;
  return slots.sort((left, right) => {
    const leftDistance = Math.hypot(left.col - centerSide, left.row - centerRow);
    const rightDistance = Math.hypot(right.col - centerSide, right.row - centerRow);
    return leftDistance - rightDistance || left.row - right.row || left.col - right.col;
  });
};

const buildTrainingNeutralCampPresentation = ({
  composition = [],
  formationFacingRad = null,
  spacing = NEUTRAL_FORMATION_SPACING
} = {}) => {
  const normalizedComposition = normalizeComposition(composition);
  const metrics = resolveCompositionMetrics(normalizedComposition);
  const requestedFacing = Number(formationFacingRad);
  const facingRad = Number.isFinite(requestedFacing) ? requestedFacing : 0;
  const safeSpacing = Math.max(0.1, finiteNumber(spacing, NEUTRAL_FORMATION_SPACING));
  const columns = Math.max(1, Math.ceil(Math.sqrt(metrics.totalCount)));
  const rows = Math.max(1, Math.ceil(metrics.totalCount / columns));
  const deploySlots = buildNeutralFormationSlots(metrics.totalCount, safeSpacing);
  const width = Math.max(10, columns * safeSpacing);
  const depth = Math.max(10, rows * safeSpacing * 0.92);
  return {
    composition: normalizedComposition,
    metrics,
    facingRad,
    deploySlots,
    formationRect: {
      area: width * depth,
      width,
      depth,
      spacing: safeSpacing,
      facingRad,
      directionOffsetRad: 0,
      directionRad: facingRad,
      slotCount: metrics.totalCount,
      formationId: 'neutral-camp-square',
      formationName: '方阵守卫'
    }
  };
};

const resolveCampAnchor = (definition = {}, building = null) => normalizePoint(
  definition?.neutralCamp?.anchor || definition?.neutralCamp?.position || building,
  building
);

const normalizeCampDefinition = (definition = {}, index = 0, buildings = []) => {
  if (String(definition?.type || '') !== 'neutralCamp') return null;
  const sourceObjectId = String(definition?.sourceObjectId || '');
  const building = resolveBuilding(buildings, sourceObjectId);
  const config = definition?.neutralCamp && typeof definition.neutralCamp === 'object'
    ? definition.neutralCamp
    : {};
  const campId = String(config?.campId || definition?.objectiveId || `neutral-camp-${index + 1}`);
  const anchor = resolveCampAnchor(definition, building);
  const requestedFormationFacingRad = Number(config?.formationFacingRad);
  const initialSpawnAtSec = Math.max(0, finiteNumber(config?.initialSpawnAtSec));
  const respawnSec = Math.max(0, finiteNumber(config?.respawnSec, 30));
  const patrolIntervalSec = Math.max(0.5, finiteNumber(config?.patrolIntervalSec, 4));
  const patrolEnabled = resolveCampPatrolEnabled(config);
  const patrolStartImmediately = patrolEnabled && config?.patrolStartImmediately === true;
  return {
    id: campId,
    objectiveId: String(definition?.objectiveId || campId),
    sourceObjectId,
    profileId: String(config?.profileId || ''),
    squadId: `neutral_camp_${sanitizeCampId(campId) || index + 1}`,
    label: String(config?.label || definition?.rewardLabel || '中立营地'),
    anchor,
    formationFacingRad: Number.isFinite(requestedFormationFacingRad) ? requestedFormationFacingRad : null,
    spawnPoints: normalizePoints(config?.spawnPoints, anchor),
    patrolEnabled,
    patrolPoints: patrolEnabled ? normalizePoints(config?.patrolPoints, anchor) : [],
    patrolMode: config?.patrolMode === 'shuttle' ? 'shuttle' : 'loop',
    patrolDirectionRad: finiteNumber(config?.patrolDirectionRad),
    patrolSpan: Math.max(0, finiteNumber(config?.patrolSpan)),
    composition: normalizeComposition(config?.composition),
    senseRadius: Math.max(12, finiteNumber(config?.senseRadius, 120)),
    leashRadius: Math.max(24, finiteNumber(config?.leashRadius, 220)),
    returnRadius: Math.max(6, finiteNumber(config?.returnRadius, 24)),
    patrolIntervalSec,
    patrolStartImmediately,
    initialSpawnAtSec,
    respawnSec,
    enabled: config?.enabled !== false,
    state: config?.enabled === false ? CAMP_STATE_DISABLED : CAMP_STATE_WAITING,
    spawnedAt: 0,
    clearedAt: 0,
    respawnAt: 0,
    spawnCount: 0,
    patrolIndex: 0,
    nextPatrolAt: initialSpawnAtSec + (patrolStartImmediately ? 0 : patrolIntervalSec),
    activeSquadId: '',
    lastClearerSquadId: ''
  };
};

const clampToField = (point = {}, field = {}, radius = 0) => {
  const width = Math.max(1, finiteNumber(field?.width, TRAINING_MAP_WORLD_WIDTH));
  const height = Math.max(1, finiteNumber(field?.height, TRAINING_MAP_WORLD_HEIGHT));
  const inset = Math.max(0, finiteNumber(radius));
  return {
    x: clamp(finiteNumber(point?.x), (-width * 0.5) + inset, (width * 0.5) - inset),
    y: clamp(finiteNumber(point?.y), (-height * 0.5) + inset, (height * 0.5) - inset)
  };
};

const resolveLegalPoint = (point = {}, context = {}, radius = 0) => {
  const candidate = clampToField(point, context?.field, radius);
  const navigator = context?.navigator;
  const options = {
    obstacles: context?.obstacles,
    radius
  };
  if (!navigator?.isWalkable || navigator.isWalkable(candidate, options)) return candidate;
  if (navigator?.findNearestWalkablePoint) {
    return navigator.findNearestWalkablePoint(candidate, options);
  }
  return candidate;
};

const buildCampWaypoints = (squad = {}, target = {}, context = {}) => {
  const navigator = context?.navigator;
  const radius = Math.max(4, finiteNumber(squad?.radius, 10));
  const legalTarget = resolveLegalPoint(target, context, radius);
  if (!navigator?.planRoute) return [legalTarget];
  const route = navigator.planRoute(
    { x: finiteNumber(squad?.x), y: finiteNumber(squad?.y) },
    legalTarget,
    { obstacles: context?.obstacles, radius }
  );
  const points = Array.isArray(route) ? route.filter(Boolean) : [];
  const lastPoint = points[points.length - 1];
  return lastPoint && distance(lastPoint, legalTarget) <= Math.max(4, radius)
    ? points
    : [];
};

export const createTrainingNeutralCampState = ({
  definitions = [],
  buildings = []
} = {}) => (
  (Array.isArray(definitions) ? definitions : [])
    .map((definition, index) => normalizeCampDefinition(definition, index, buildings))
    .filter(Boolean)
);

export const createTrainingNeutralCampSquad = (camp = {}, context = {}) => {
  const presentation = buildTrainingNeutralCampPresentation({
    composition: camp?.composition,
    formationFacingRad: camp?.formationFacingRad
  });
  const metrics = presentation.metrics;
  const radius = clamp(7 + (Math.sqrt(metrics.totalCount) * 0.58), 9, 42);
  const spawnIndex = Math.max(0, Math.floor(finiteNumber(camp?.spawnCount)))
    % Math.max(1, camp?.spawnPoints?.length || 1);
  const spawnCandidate = camp?.patrolEnabled === true
    ? (camp?.spawnPoints?.[spawnIndex] || camp?.anchor)
    : camp?.anchor;
  const spawnPoint = resolveLegalPoint(spawnCandidate, context, radius);
  const facingRad = Number.isFinite(Number(camp?.formationFacingRad))
    ? Number(camp.formationFacingRad)
    : presentation.facingRad;
  return {
    id: String(camp?.squadId || `neutral_camp_${sanitizeCampId(camp?.id)}`),
    sourceDeployGroupId: '',
    neutralCampId: String(camp?.id || ''),
    isNeutralCampUnit: true,
    name: String(camp?.label || '中立守卫'),
    team: TEAM_NEUTRAL,
    controlMode: 'AI',
    sortOrder: 10000 + Math.max(0, Math.floor(finiteNumber(camp?.spawnCount))),
    units: { ...metrics.units },
    startCount: metrics.totalCount,
    remain: metrics.totalCount,
    remainUnits: { ...metrics.units },
    kills: 0,
    losses: 0,
    maxHealth: metrics.maxHealth,
    health: metrics.maxHealth,
    hpAvg: metrics.hpAvg,
    stamina: 100,
    stats: metrics.stats,
    classTag: metrics.classTag,
    roleTag: metrics.stats.attackRange.max > 1.8 ? '远程' : '近战',
    unitCategory: metrics.unitCategory,
    unitSubtype: metrics.unitSubtype,
    rpsType: metrics.unitCategory,
    professionId: '',
    tags: ['neutral', 'camp'],
    tier: 1,
    mainUnitTypeId: Object.keys(metrics.units)[0] || '',
    formationRect: {
      ...presentation.formationRect,
      facingRad,
      directionRad: facingRad
    },
    deploySlots: presentation.deploySlots,
    x: spawnPoint.x,
    y: spawnPoint.y,
    vx: 0,
    vy: 0,
    dirX: Math.cos(facingRad),
    dirY: Math.sin(facingRad),
    speed: 0,
    radius,
    waypoints: [],
    autoNavigation: null,
    action: '生成中',
    actionState: { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 },
    behavior: 'guard',
    order: { type: 'IDLE', issuedAt: 0, commitUntil: 0, targetPoint: null, targetSquadId: '' },
    speedMode: 'B_HARMONIC',
    speedModeAuthority: 'AI',
    speedPolicy: 'MARCH',
    formationSpacing: 'standard',
    reformUntil: 0,
    reformRadiusThreshold: Math.max(18, radius * 1.4),
    underAttackTimer: 0,
    attackCooldown: 0,
    effectBuff: null,
    statusEffects: [],
    skillCooldowns: { infantry: 0, cavalry: 0, archer: 0, artillery: 0, support: 0 },
    skillCenters: {
      melee: { x: spawnPoint.x, y: spawnPoint.y, count: 0 },
      ranged: { x: spawnPoint.x, y: spawnPoint.y, count: 0 },
      support: { x: spawnPoint.x, y: spawnPoint.y, count: 0 }
    },
    classCenters: {
      infantry: { x: spawnPoint.x, y: spawnPoint.y, count: 0 },
      cavalry: { x: spawnPoint.x, y: spawnPoint.y, count: 0 },
      archer: { x: spawnPoint.x, y: spawnPoint.y, count: 0 },
      artillery: { x: spawnPoint.x, y: spawnPoint.y, count: 0 }
    },
    skillCategoryCounts: { melee: 0, ranged: 0, support: 0 },
    stability: {
      poise: 100,
      poiseMax: 100,
      chargePoise: 140,
      chargePoiseCurrent: 140,
      transition: 90,
      transitionMax: 90,
      poiseRegenPerSec: 6.2,
      transitionDecayPerSec: 4.1,
      transitionRegenPerSec: 2.5
    },
    guard: {
      enabled: true,
      cx: finiteNumber(camp?.anchor?.x),
      cy: finiteNumber(camp?.anchor?.y),
      radius: Math.max(12, finiteNumber(camp?.senseRadius, 120)),
      returnRadius: Math.max(6, finiteNumber(camp?.returnRadius, 24)),
      chaseRadius: Math.max(24, finiteNumber(camp?.leashRadius, 220)),
      activeTargetId: '',
      patrolTarget: null
    },
    selected: false,
    hover: false,
    flagBearerAgentId: '',
    lastDamagedBySquadId: ''
  };
};

const replaceNeutralCampSquad = (target = {}, replacement = {}) => {
  Object.keys(target).forEach((key) => {
    if (!(key in replacement)) delete target[key];
  });
  Object.assign(target, replacement);
  return target;
};

const ensureTrainingStats = (sim = {}) => {
  if (!sim.trainingStats || typeof sim.trainingStats !== 'object') sim.trainingStats = {};
  if (!Number.isFinite(Number(sim.trainingStats.neutralKills))) sim.trainingStats.neutralKills = 0;
  return sim.trainingStats;
};

const resolveCampSquad = (sim = {}, camp = {}) => (
  (Array.isArray(sim?.squads) ? sim.squads : []).find((squad) => (
    String(squad?.id || '') === String(camp?.activeSquadId || camp?.squadId || '')
  )) || null
);

const isLiveCampSquad = (squad = null) => !!squad
  && squad?.team === TEAM_NEUTRAL
  && finiteNumber(squad?.remain) > 0;

const resolveTargetSquad = (sim = {}, squad = {}) => {
  const targetId = String(squad?.targetSquadId || '');
  if (!targetId) return null;
  return (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
    String(candidate?.id || '') === targetId
    && finiteNumber(candidate?.remain) > 0
    && isHostileTeam(squad?.team, candidate?.team)
  )) || null;
};

const resetCampHealth = (crowd = {}, squad = {}) => {
  const agents = crowd?.agentsBySquad?.get?.(squad?.id);
  if (!Array.isArray(agents)) return;
  agents.forEach((agent) => {
    if (!agent || agent.dead) return;
    agent.weight = Math.max(0.1, finiteNumber(agent?.initialWeight, agent?.weight));
    agent.hpWeight = agent.weight;
  });
  squad.health = Math.max(1, finiteNumber(squad?.maxHealth));
};

const queueCampPatrol = (camp = {}, squad = {}, context = {}, nowSec = 0) => {
  if (camp?.patrolEnabled !== true) {
    if (squad?.guard) squad.guard.patrolTarget = null;
    return false;
  }
  if (nowSec < finiteNumber(camp?.nextPatrolAt)) return false;
  const points = Array.isArray(camp?.patrolPoints) ? camp.patrolPoints : [];
  if (points.length <= 0) return false;
  const patrolIndex = Math.max(0, Math.floor(finiteNumber(camp?.patrolIndex))) % points.length;
  const target = resolveLegalPoint(points[patrolIndex], context, Math.max(4, finiteNumber(squad?.radius, 10)));
  const waypoints = buildCampWaypoints(squad, target, context);
  const arrivalRadius = Math.max(CAMP_PATROL_ARRIVAL_RADIUS, finiteNumber(squad?.radius) * 0.42);
  if (waypoints.length <= 0 && distance(squad, target) > arrivalRadius) {
    camp.nextPatrolAt = nowSec + Math.max(0.5, finiteNumber(camp?.patrolIntervalSec, 4));
    return false;
  }
  const reachableTarget = waypoints[waypoints.length - 1] || target;
  camp.patrolIndex = (patrolIndex + 1) % points.length;
  camp.nextPatrolAt = nowSec + Math.max(0.5, finiteNumber(camp?.patrolIntervalSec, 4));
  squad.guard.patrolTarget = reachableTarget;
  squad.waypoints = waypoints;
  return true;
};

const resolveCampPatrolLeashRadius = (camp = {}, squad = {}) => {
  const patrolPoints = Array.isArray(camp?.patrolPoints) ? camp.patrolPoints : [];
  const patrolRadius = patrolPoints.reduce((maxRadius, point) => (
    Math.max(maxRadius, distance(point, camp?.anchor))
  ), 0);
  return Math.max(
    Math.max(6, finiteNumber(camp?.returnRadius, 24)),
    patrolRadius + Math.max(4, finiteNumber(squad?.radius, 10) * 0.42)
  );
};

const updateLiveCampState = (camp = {}, squad = {}, sim = {}, crowd = {}, context = {}, nowSec = 0) => {
  const target = resolveTargetSquad(sim, squad);
  const distanceToAnchor = distance(squad, camp.anchor);
  const targetDistanceToAnchor = target ? distance(target, camp.anchor) : Infinity;
  const guard = squad?.guard && typeof squad.guard === 'object' ? squad.guard : null;
  if (!guard) return;
  const patrolLeashRadius = resolveCampPatrolLeashRadius(camp, squad);

  if (
    distanceToAnchor > camp.leashRadius
    || (target && targetDistanceToAnchor > camp.leashRadius)
  ) {
    squad.targetSquadId = '';
    guard.activeTargetId = '';
    guard.patrolTarget = null;
    squad.waypoints = buildCampWaypoints(squad, camp.anchor, context);
    camp.state = CAMP_STATE_LEASHING;
    return;
  }

  if (target) {
    guard.patrolTarget = null;
    const attackRange = Math.max(1, finiteNumber(squad?.stats?.attackRange?.max, squad?.stats?.range));
    const distanceToTarget = distance(squad, target);
    camp.state = distanceToTarget <= attackRange + Math.max(4, finiteNumber(target?.radius))
      ? CAMP_STATE_FIGHTING
      : CAMP_STATE_CHASING;
    return;
  }

  if (camp.patrolEnabled !== true) guard.patrolTarget = null;

  if (distanceToAnchor > patrolLeashRadius) {
    guard.patrolTarget = null;
    squad.waypoints = buildCampWaypoints(squad, camp.anchor, context);
    camp.state = CAMP_STATE_LEASHING;
    return;
  }

  if (guard.patrolTarget) {
    if (distance(squad, guard.patrolTarget) <= Math.max(CAMP_PATROL_ARRIVAL_RADIUS, finiteNumber(squad?.radius) * 0.42)) {
      guard.patrolTarget = null;
      camp.nextPatrolAt = Math.min(finiteNumber(camp?.nextPatrolAt), nowSec + Math.max(0.5, camp.patrolIntervalSec));
    } else {
      camp.state = CAMP_STATE_ALERTED;
      return;
    }
  }

  if (camp.state === CAMP_STATE_LEASHING) resetCampHealth(crowd, squad);
  if (camp.patrolEnabled !== true) {
    guard.patrolTarget = null;
    squad.waypoints = [];
    squad.vx = 0;
    squad.vy = 0;
    squad.speed = 0;
  } else {
    queueCampPatrol(camp, squad, context, nowSec);
  }
  camp.state = CAMP_STATE_ALIVE;
};

export const initializeTrainingNeutralCamps = ({
  definitions = [],
  buildings = [],
  context = {},
  nowSec = 0
} = {}) => {
  const camps = createTrainingNeutralCampState({ definitions, buildings });
  const squads = [];
  camps.forEach((camp) => {
    if (!camp.enabled || nowSec < camp.initialSpawnAtSec) return;
    camp.state = CAMP_STATE_SPAWNING;
    const squad = createTrainingNeutralCampSquad(camp, context);
    camp.activeSquadId = squad.id;
    camp.spawnCount += 1;
    camp.spawnedAt = nowSec;
    camp.state = CAMP_STATE_ALIVE;
    if (camp.patrolEnabled && camp.patrolStartImmediately) queueCampPatrol(camp, squad, context, nowSec);
    squads.push(squad);
  });
  return { camps, squads };
};

export const updateTrainingNeutralCamps = ({
  sim = {},
  crowd = {},
  context = {},
  nowSec = 0,
  spawnSquad = null
} = {}) => {
  const camps = Array.isArray(sim?.trainingNeutralCamps) ? sim.trainingNeutralCamps : [];
  if (camps.length <= 0) return;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const stats = ensureTrainingStats(sim);
  camps.forEach((camp) => {
    if (!camp || typeof camp !== 'object') return;
    if (camp.enabled === false) {
      camp.state = CAMP_STATE_DISABLED;
      return;
    }
    const squad = resolveCampSquad(sim, camp);
    if (isLiveCampSquad(squad)) {
      updateLiveCampState(camp, squad, sim, crowd, context, safeNow);
      return;
    }

    const hadSpawn = !!camp.activeSquadId;
    if (hadSpawn && camp.state !== CAMP_STATE_CLEARED && camp.state !== CAMP_STATE_RESPAWNING) {
      camp.state = CAMP_STATE_CLEARED;
      camp.clearedAt = safeNow;
      camp.respawnAt = safeNow + Math.max(0, finiteNumber(camp?.respawnSec));
      camp.lastClearerSquadId = String(squad?.lastDamagedBySquadId || '');
      stats.neutralKills = Math.max(0, finiteNumber(stats?.neutralKills)) + 1;
    }

    const spawnAt = hadSpawn
      ? Math.max(0, finiteNumber(camp?.respawnAt))
      : Math.max(0, finiteNumber(camp?.initialSpawnAtSec));
    if (safeNow < spawnAt) {
      camp.state = hadSpawn ? CAMP_STATE_RESPAWNING : CAMP_STATE_WAITING;
      return;
    }

    camp.state = CAMP_STATE_SPAWNING;
    const replacement = createTrainingNeutralCampSquad(camp, context);
    let activeSquad = squad;
    if (activeSquad) {
      activeSquad = replaceNeutralCampSquad(activeSquad, replacement);
    } else {
      if (!Array.isArray(sim.squads)) sim.squads = [];
      sim.squads.push(replacement);
      activeSquad = replacement;
    }
    camp.activeSquadId = activeSquad.id;
    camp.spawnCount = Math.max(0, Math.floor(finiteNumber(camp?.spawnCount))) + 1;
    camp.spawnedAt = safeNow;
    camp.clearedAt = 0;
    camp.respawnAt = 0;
    camp.nextPatrolAt = safeNow + (camp.patrolStartImmediately
      ? 0
      : Math.max(0.5, finiteNumber(camp?.patrolIntervalSec, 4)));
    camp.state = CAMP_STATE_ALIVE;
    if (camp.patrolEnabled && camp.patrolStartImmediately) queueCampPatrol(camp, activeSquad, context, safeNow);
    if (typeof spawnSquad === 'function') spawnSquad(activeSquad);
  });
};

export const getTrainingNeutralCampSummary = (sim = {}) => (
  (Array.isArray(sim?.trainingNeutralCamps) ? sim.trainingNeutralCamps : []).map((camp) => ({
    id: String(camp?.id || ''),
    label: String(camp?.label || '中立营地'),
    state: String(camp?.state || CAMP_STATE_WAITING),
    patrolEnabled: camp?.patrolEnabled === true,
    squadId: String(camp?.activeSquadId || camp?.squadId || ''),
    spawnedAt: Math.max(0, finiteNumber(camp?.spawnedAt)),
    clearedAt: Math.max(0, finiteNumber(camp?.clearedAt)),
    respawnAt: Math.max(0, finiteNumber(camp?.respawnAt)),
    lastClearerSquadId: String(camp?.lastClearerSquadId || '')
  }))
);
