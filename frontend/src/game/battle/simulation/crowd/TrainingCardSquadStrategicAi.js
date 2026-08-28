import { resolveTrainingMapLane } from '../../shared/trainingMap';
import { buildObstacleSpatialIndex, raycastObstacles } from './crowdPhysics';
import { isRangedSquad, resolveSquadAttackRange } from './attackRange';
import {
  canAcquireSquadTarget,
  isHostileTeam,
  resolveDefaultHostileTeam,
  TEAM_NEUTRAL
} from './teamRelations';
import {
  isTrainingCardAiSquad,
  isTrainingCardComputerSquad,
  isTrainingMinionSquad,
  isTrainingNeutralSquad
} from './TrainingSquadKind';
import { clearTrainingCardAiState } from './TrainingCardSquadAiState';
import { filterBlockingObstacles } from '../items/itemObstacleUtils';

export const TRAINING_MAP_AI_STATE = Object.freeze({
  SPAWN: 'Spawn',
  FORMING: 'Forming',
  ADVANCE: 'Advance',
  APPROACH_TARGET: 'ApproachTarget',
  ATTACK: 'Attack',
  USE_ABILITY: 'UseAbility',
  RETREAT: 'Retreat',
  REJOIN_LANE: 'RejoinLane',
  CHASE: 'Chase',
  DEAD: 'Dead',
  DISABLED: 'Disabled'
});

export const TRAINING_MAP_AI_PLAN_KIND = Object.freeze({
  RETREAT_FROM_TOWER: 'RETREAT_FROM_TOWER',
  DEFEND_WAVE: 'DEFEND_WAVE',
  ESCORT_WAVE: 'ESCORT_WAVE',
  SIEGE_TOWER: 'SIEGE_TOWER',
  CLEAR_NEUTRAL: 'CLEAR_NEUTRAL',
  ROTATE_LANE: 'ROTATE_LANE',
  PUSH_LANE: 'PUSH_LANE',
  SIEGE_BARRACKS: 'SIEGE_BARRACKS'
});

const DEFAULT_TARGET_SCORING = Object.freeze({
  distanceWeight: 30,
  sameLaneBonus: 18,
  offLanePenalty: 7,
  threatWeight: 14,
  lowHealthBonus: 12,
  inAttackRangeBonus: 22,
  attackingAllyBonus: 16,
  targetLockBonus: 10,
  protectedAreaPenalty: 12,
  blockedLinePenalty: 5
});

const STATE_MAX_DURATION_SECONDS = Object.freeze({
  [TRAINING_MAP_AI_STATE.SPAWN]: 0.2,
  [TRAINING_MAP_AI_STATE.FORMING]: 1.2,
  [TRAINING_MAP_AI_STATE.ADVANCE]: 30,
  [TRAINING_MAP_AI_STATE.APPROACH_TARGET]: 20,
  [TRAINING_MAP_AI_STATE.ATTACK]: 18,
  [TRAINING_MAP_AI_STATE.USE_ABILITY]: 4,
  [TRAINING_MAP_AI_STATE.RETREAT]: 20,
  [TRAINING_MAP_AI_STATE.REJOIN_LANE]: 12,
  [TRAINING_MAP_AI_STATE.CHASE]: 12,
  [TRAINING_MAP_AI_STATE.DEAD]: 0,
  [TRAINING_MAP_AI_STATE.DISABLED]: 0
});

const MAX_SQUAD_EVENT_COUNT = 16;
const MAX_SIM_EVENT_COUNT = 160;
const AI_DECISION_INTERVAL_SECONDS = 0.18;
const AI_PLAN_TARGET_LOCK_SECONDS = 1.4;
const AI_PLAN_MOVEMENT_LOCK_SECONDS = 1.05;
const AI_PLAN_NEUTRAL_LOCK_SECONDS = 2.2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const resolveTrainingAiContext = (sim = {}) => {
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const buildings = Array.isArray(sim?.buildings) ? sim.buildings : [];
  const nowSec = finiteNumber(sim?.timeElapsed);
  const sharedBlockingObstacles = Array.isArray(sim?._trainingBlockingObstacles)
    ? sim._trainingBlockingObstacles
    : null;
  const cached = sim?._trainingAiContext;
  if (
    cached
    && cached.squadsRef === squads
    && cached.buildingsRef === buildings
    && cached.squadCount === squads.length
    && cached.buildingCount === buildings.length
    && cached.blockingObstaclesRef === sharedBlockingObstacles
  ) {
    cached.nowSec = nowSec;
    return cached;
  }
  const blockingObstacles = sharedBlockingObstacles || filterBlockingObstacles(buildings);
  if (!blockingObstacles._obstacleSpatialIndex) {
    blockingObstacles._obstacleSpatialIndex = buildObstacleSpatialIndex(blockingObstacles);
  }
  const buildingsById = new Map(
    buildings
      .filter((building) => building?.id)
      .map((building) => [String(building.id), building])
  );
  const alliesByTeam = new Map();
  squads.forEach((squad) => {
    const team = String(squad?.team || '');
    const id = String(squad?.id || '');
    if (!team || !id) return;
    if (!alliesByTeam.has(team)) alliesByTeam.set(team, new Set());
    alliesByTeam.get(team).add(id);
  });
  const context = {
    nowSec,
    squadsRef: squads,
    buildingsRef: buildings,
    squadCount: squads.length,
    buildingCount: buildings.length,
    blockingObstaclesRef: sharedBlockingObstacles,
    blockingObstacles,
    buildingsById,
    alliesByTeam
  };
  if (sim && typeof sim === 'object') sim._trainingAiContext = context;
  return context;
};

const normalizeTargetScoringValue = (value, fallback, max = 1000) => (
  clamp(finiteNumber(value, fallback), 0, max)
);

const isEnemyHiddenForViewer = (enemySquad = {}, viewerTeam = '') => {
  if (viewerTeam === 'attacker') return !!enemySquad?.hiddenFromAttacker;
  if (viewerTeam === 'defender') return !!enemySquad?.hiddenFromDefender;
  return false;
};

const resolveHealthRatio = (squad = {}) => {
  const maxHealth = Math.max(
    1,
    finiteNumber(squad?.maxHealth, finiteNumber(squad?.startCount, finiteNumber(squad?.remain, 1)))
  );
  const health = Math.max(0, finiteNumber(squad?.health, finiteNumber(squad?.remain)));
  return clamp(health / maxHealth, 0, 1);
};

const resolveMapFieldDiagonal = (sim = {}) => {
  const width = Math.max(1, finiteNumber(sim?.field?.width, 2700));
  const height = Math.max(1, finiteNumber(sim?.field?.height, 1488));
  return Math.hypot(width, height);
};

const resolveSquadLaneId = (squad = {}, sim = {}) => {
  const fallback = String(
    squad?.minionLaneId
      || squad?.trainingAiLaneId
      || squad?.spawnLaneId
      || ''
  ).trim();
  return resolveTrainingMapLane(sim?.trainingMap, squad, fallback);
};

const resolveObjectiveBuilding = (sim = {}, objective = {}, context = null) => (
  context?.buildingsById?.get(String(objective?.sourceObjectId || ''))
    || (Array.isArray(sim?.buildings) ? sim.buildings : []).find((building) => (
      String(building?.id || '') === String(objective?.sourceObjectId || '')
    ))
    || null
);

const isTargetInsideProtectedArea = (target = {}, sim = {}, context = null) => {
  const targetTeam = String(target?.team || '');
  const targetPoint = { x: finiteNumber(target?.x), y: finiteNumber(target?.y) };
  const targetRadius = Math.max(0, finiteNumber(target?.radius, 10));
  const objectives = Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [];
  for (let index = 0; index < objectives.length; index += 1) {
    const objective = objectives[index];
    if (!objective || objective.destroyed || objective.targetable === false) continue;
    if (String(objective?.team || '') !== targetTeam) continue;
    const building = resolveObjectiveBuilding(sim, objective, context);
    if (!building || building.destroyed) continue;
    const buildingRadius = Math.max(4, Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5);
    const protectionRange = Math.max(0, finiteNumber(objective?.attackRange));
    const distance = Math.hypot(targetPoint.x - finiteNumber(building?.x), targetPoint.y - finiteNumber(building?.y));
    if (distance <= protectionRange + buildingRadius + targetRadius) return true;
  }
  const guard = target?.guard && typeof target.guard === 'object' ? target.guard : null;
  if (!guard) return false;
  const guardRadius = Math.max(0, finiteNumber(guard?.radius));
  if (guardRadius <= 0) return false;
  return Math.hypot(
    targetPoint.x - finiteNumber(guard?.cx, targetPoint.x),
    targetPoint.y - finiteNumber(guard?.cy, targetPoint.y)
  ) <= guardRadius + targetRadius;
};

const isTargetAttackingAlly = (candidate = {}, squad = {}, sim = {}, context = null) => {
  const allies = context?.alliesByTeam?.get(String(squad?.team || '')) || new Set(
    (Array.isArray(sim?.squads) ? sim.squads : [])
      .filter((row) => row && String(row?.team || '') === String(squad?.team || ''))
      .map((row) => String(row?.id || ''))
      .filter(Boolean)
  );
  if (allies.size <= 0) return false;
  const currentTargetId = String(candidate?.targetSquadId || '');
  const damagedId = String(candidate?.lastDamagedBySquadId || '');
  return allies.has(currentTargetId) || allies.has(damagedId);
};

const hasBlockedDirectLine = (squad = {}, candidate = {}, sim = {}, ignoredObjectId = '', context = null) => {
  const sourceObstacles = context?.blockingObstacles || filterBlockingObstacles(sim?.buildings || []);
  const obstacles = ignoredObjectId
    ? sourceObstacles.filter((building) => String(building?.id || '') !== String(ignoredObjectId || ''))
    : sourceObstacles;
  if (obstacles.length <= 0) return false;
  return !!raycastObstacles(
    { x: finiteNumber(squad?.x), y: finiteNumber(squad?.y) },
    { x: finiteNumber(candidate?.x), y: finiteNumber(candidate?.y) },
    obstacles,
    Math.max(0.6, finiteNumber(squad?.radius, 10) * 0.12)
  );
};

const AI_PLAN_PRIORITY = Object.freeze({
  [TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER]: 0,
  [TRAINING_MAP_AI_PLAN_KIND.DEFEND_WAVE]: 1,
  [TRAINING_MAP_AI_PLAN_KIND.SIEGE_TOWER]: 2,
  [TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS]: 2,
  [TRAINING_MAP_AI_PLAN_KIND.ROTATE_LANE]: 3,
  [TRAINING_MAP_AI_PLAN_KIND.ESCORT_WAVE]: 4,
  [TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL]: 5,
  [TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE]: 6
});

const distanceBetween = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const resolveStrategicLaneId = (squad = {}, sim = {}) => String(
  squad?.trainingAiLaneId
    || squad?.spawnLaneId
    || resolveSquadLaneId(squad, sim)
    || 'mid'
).trim();

const resolveEntityLaneId = (entity = {}, sim = {}) => String(
  entity?.minionLaneId
    || entity?.trainingAiLaneId
    || entity?.spawnLaneId
    || resolveTrainingMapLane(sim?.trainingMap, entity, '')
    || ''
).trim();

const projectPointToPath = (point = {}, path = []) => {
  const rows = Array.isArray(path) ? path.filter(Boolean) : [];
  let best = {
    distance: Infinity,
    progress: 0,
    segmentIndex: 0,
    point: rows[0] ? { ...rows[0] } : { x: finiteNumber(point?.x), y: finiteNumber(point?.y) }
  };
  let travelled = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const start = rows[index - 1];
    const end = rows[index];
    const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
    const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) continue;
    const t = clamp(
      (((finiteNumber(point?.x) - finiteNumber(start?.x)) * dx)
        + ((finiteNumber(point?.y) - finiteNumber(start?.y)) * dy)) / (length * length),
      0,
      1
    );
    const projected = {
      x: finiteNumber(start?.x) + (dx * t),
      y: finiteNumber(start?.y) + (dy * t)
    };
    const projectionDistance = distanceBetween(point, projected);
    if (projectionDistance < best.distance) {
      best = {
        distance: projectionDistance,
        progress: travelled + (length * t),
        segmentIndex: index - 1,
        point: projected
      };
    }
    travelled += length;
  }
  return best;
};

const resolvePathDirection = (path = [], projection = null, fallbackX = 1) => {
  const rows = Array.isArray(path) ? path.filter(Boolean) : [];
  const segmentIndex = clamp(
    Math.floor(finiteNumber(projection?.segmentIndex)),
    0,
    Math.max(0, rows.length - 2)
  );
  const start = rows[segmentIndex];
  const end = rows[segmentIndex + 1];
  const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
  const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
  const length = Math.hypot(dx, dy);
  if (length <= 0.001) return { x: fallbackX, y: 0 };
  return { x: dx / length, y: dy / length };
};

const resolvePathPointAtProgress = (path = [], requestedProgress = 0) => {
  const rows = Array.isArray(path) ? path.filter(Boolean) : [];
  if (rows.length <= 0) return null;
  const safeProgress = Math.max(0, finiteNumber(requestedProgress));
  let travelled = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const start = rows[index - 1];
    const end = rows[index];
    const length = distanceBetween(start, end);
    if (length <= 0.001) continue;
    if (travelled + length >= safeProgress) {
      const t = clamp((safeProgress - travelled) / length, 0, 1);
      return {
        x: finiteNumber(start?.x) + ((finiteNumber(end?.x) - finiteNumber(start?.x)) * t),
        y: finiteNumber(start?.y) + ((finiteNumber(end?.y) - finiteNumber(start?.y)) * t)
      };
    }
    travelled += length;
  }
  const last = rows[rows.length - 1];
  return { x: finiteNumber(last?.x), y: finiteNumber(last?.y) };
};

const resolveBuildingRadius = (building = {}) => Math.max(
  4,
  Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5
);

const resolveStrategicObjectiveEntries = (squad = {}, sim = {}) => {
  const context = resolveTrainingAiContext(sim);
  return (Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [])
    .filter((objective) => (
      objective
      && objective.destroyed !== true
      && objective.targetable !== false
      && isHostileTeam(squad?.team, objective?.team)
      && objective?.team !== TEAM_NEUTRAL
    ))
    .map((objective) => ({
      objective,
      building: resolveObjectiveBuilding(sim, objective, context)
    }))
    .filter((entry) => entry.building && entry.building.destroyed !== true);
};

const resolveFriendlyLaneWaves = (squad = {}, sim = {}, laneId = '') => (
  (Array.isArray(sim?.squads) ? sim.squads : []).filter((candidate) => (
    candidate
    && isTrainingMinionSquad(candidate)
    && candidate?.team === squad?.team
    && finiteNumber(candidate?.remain) > 0
    && resolveEntityLaneId(candidate, sim) === String(laneId || '')
  ))
);

const resolveWaveProgress = (wave = {}) => {
  const path = Array.isArray(wave?.minionPath) ? wave.minionPath : [];
  return Math.max(
    finiteNumber(wave?.minionPathProgress),
    path.length >= 2 ? finiteNumber(projectPointToPath(wave, path).progress) : 0
  );
};

const selectStrategicWave = (waves = [], previousWaveId = '') => {
  const ranked = (Array.isArray(waves) ? waves : []).slice().sort((left, right) => (
    resolveWaveProgress(right) - resolveWaveProgress(left)
    || String(left?.id || '').localeCompare(String(right?.id || ''), 'en')
  ));
  const best = ranked[0] || null;
  const previous = ranked.find((wave) => String(wave?.id || '') === String(previousWaveId || '')) || null;
  if (!previous || !best) return best;
  return resolveWaveProgress(best) - resolveWaveProgress(previous) <= 240 ? previous : best;
};

const resolveStrategicLaneChoice = (squad = {}, sim = {}, previousPlan = null) => {
  const currentLaneId = resolveStrategicLaneId(squad, sim);
  const currentWaves = resolveFriendlyLaneWaves(squad, sim, currentLaneId);
  if (currentWaves.length > 0) {
    return {
      laneId: currentLaneId,
      wave: selectStrategicWave(currentWaves, previousPlan?.waveId),
      rotated: false
    };
  }
  const laneIds = (Array.isArray(sim?.trainingMap?.lanes) ? sim.trainingMap.lanes : [])
    .map((lane) => String(lane?.id || '').trim())
    .filter(Boolean);
  const alternatives = laneIds
    .map((laneId) => {
      const waves = resolveFriendlyLaneWaves(squad, sim, laneId);
      const wave = selectStrategicWave(waves, previousPlan?.waveId);
      return wave ? { laneId, wave, distance: distanceBetween(squad, wave) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.distance - right.distance
      || resolveWaveProgress(right.wave) - resolveWaveProgress(left.wave)
      || left.laneId.localeCompare(right.laneId, 'en')
    ));
  if (alternatives.length <= 0) {
    return { laneId: currentLaneId, wave: null, rotated: false };
  }
  return {
    laneId: alternatives[0].laneId,
    wave: alternatives[0].wave,
    rotated: alternatives[0].laneId !== currentLaneId
  };
};

const selectObjectiveForWave = (entries = [], wave = null) => {
  if (!wave || entries.length <= 0) return entries[0] || null;
  const path = Array.isArray(wave?.minionPath) ? wave.minionPath : [];
  const waveProgress = resolveWaveProgress(wave);
  const targetBuildingId = String(wave?.targetBuildingId || '');
  return entries.slice().sort((left, right) => {
    const leftTargeted = String(left?.building?.id || '') === targetBuildingId;
    const rightTargeted = String(right?.building?.id || '') === targetBuildingId;
    if (leftTargeted !== rightTargeted) return leftTargeted ? -1 : 1;
    if (path.length >= 2) {
      const leftAhead = projectPointToPath(left.building, path).progress - waveProgress;
      const rightAhead = projectPointToPath(right.building, path).progress - waveProgress;
      const leftBehind = leftAhead < -24;
      const rightBehind = rightAhead < -24;
      if (leftBehind !== rightBehind) return leftBehind ? 1 : -1;
      if (Math.abs(leftAhead - rightAhead) > 0.01) {
        return Math.max(0, leftAhead) - Math.max(0, rightAhead);
      }
    }
    return distanceBetween(wave, left.building) - distanceBetween(wave, right.building)
      || String(left?.objective?.id || '').localeCompare(String(right?.objective?.id || ''), 'en');
  })[0] || null;
};

const resolveNextStrategicObjective = ({ squad = {}, sim = {}, laneId = '', wave = null } = {}) => {
  const entries = resolveStrategicObjectiveEntries(squad, sim);
  const laneTowers = entries.filter((entry) => (
    entry?.objective?.type === 'tower'
    && String(entry?.objective?.laneId || '') === String(laneId || '')
  ));
  if (laneTowers.length > 0) {
    return { ...selectObjectiveForWave(laneTowers, wave), stage: 'lane-tower' };
  }
  if (!wave) return null;
  const hostileTeam = resolveDefaultHostileTeam(squad?.team);
  const barracksLane = String(
    wave?.minionBarracksLane
      || (laneId === 'bottom' ? 'bottom' : 'top')
  ).trim();
  const highlandLaneId = `spawn-${hostileTeam}-${barracksLane}`;
  const highlandTowers = entries.filter((entry) => (
    entry?.objective?.type === 'tower'
    && String(entry?.objective?.laneId || '') === highlandLaneId
  ));
  if (highlandTowers.length > 0) {
    return { ...selectObjectiveForWave(highlandTowers, wave), stage: 'highland-tower' };
  }
  const barracks = entries.filter((entry) => (
    entry?.objective?.type === 'barracks'
    && String(entry?.objective?.laneId || '') === highlandLaneId
  ));
  if (barracks.length > 0) {
    return { ...selectObjectiveForWave(barracks, wave), stage: 'barracks' };
  }
  return null;
};

const resolveObjectiveSafeDistance = (squad = {}, entry = {}) => (
  Math.max(0, finiteNumber(entry?.objective?.attackRange))
  + resolveBuildingRadius(entry?.building)
  + Math.max(4, finiteNumber(squad?.radius, 10))
  + 24
);

const isObjectiveTargetingSquad = (entry = {}, squadId = '') => {
  const targetId = String(entry?.objective?.currentTargetId || entry?.objective?.lockedSquadId || '');
  return !!targetId && targetId === String(squadId || '');
};

const resolveThreateningObjective = (squad = {}, sim = {}) => (
  resolveStrategicObjectiveEntries(squad, sim)
    .filter((entry) => (
      entry?.objective?.attackEnabled === true
      && isObjectiveTargetingSquad(entry, squad?.id)
      && distanceBetween(squad, entry.building) <= resolveObjectiveSafeDistance(squad, entry) + 48
    ))
    .sort((left, right) => (
      distanceBetween(squad, left.building) - distanceBetween(squad, right.building)
    ))[0] || null
);

const isObjectiveCoveredByMinions = (entry = {}, waves = []) => {
  if (!entry?.objective || !entry?.building) return false;
  const waveIds = new Set((Array.isArray(waves) ? waves : []).map((wave) => String(wave?.id || '')));
  const targetId = String(entry.objective.currentTargetId || entry.objective.lockedSquadId || '');
  if (targetId && waveIds.has(targetId)) return true;
  const attackDistance = Math.max(0, finiteNumber(entry?.objective?.attackRange))
    + resolveBuildingRadius(entry.building);
  return (Array.isArray(waves) ? waves : []).some((wave) => (
    String(wave?.targetBuildingId || '') === String(entry?.building?.id || '')
    && distanceBetween(wave, entry.building) <= attackDistance + Math.max(4, finiteNumber(wave?.radius, 10)) + 18
  ));
};

const resolveLaneEngagementTarget = ({
  squad = {},
  sim = {},
  laneId = '',
  wave = null,
  previousTargetId = '',
  nowSec = 0,
  objectiveEntries = [],
  laneWaves = []
} = {}) => {
  const hostileTeam = resolveDefaultHostileTeam(squad?.team);
  const diagonal = resolveMapFieldDiagonal(sim);
  const assistRadius = clamp(diagonal * 0.065, 260, 720);
  const allies = (Array.isArray(sim?.squads) ? sim.squads : []).filter((candidate) => (
    candidate
    && candidate?.team === squad?.team
    && finiteNumber(candidate?.remain) > 0
    && resolveEntityLaneId(candidate, sim) === String(laneId || '')
  ));
  const allyIds = new Set(allies.map((ally) => String(ally?.id || '')));
  const anchor = wave || squad;
  return (Array.isArray(sim?.squads) ? sim.squads : [])
    .filter((candidate) => (
      candidate
      && candidate?.team === hostileTeam
      && finiteNumber(candidate?.remain) > 0
      && !isEnemyHiddenForViewer(candidate, squad?.team)
      && !isTrainingMapAiTargetDeferred(squad, candidate?.id, nowSec)
      && resolveEntityLaneId(candidate, sim) === String(laneId || '')
      && !(Array.isArray(objectiveEntries) ? objectiveEntries : []).some((entry) => (
        entry?.objective?.attackEnabled === true
        && !isObjectiveCoveredByMinions(entry, laneWaves)
        && distanceBetween(candidate, entry?.building) <= (
          Math.max(0, finiteNumber(entry?.objective?.attackRange))
          + resolveBuildingRadius(entry?.building)
          + Math.max(4, finiteNumber(candidate?.radius, 10))
        )
      ))
    ))
    .map((candidate) => {
      const nearestAllyDistance = allies.reduce((minimum, ally) => (
        Math.min(minimum, distanceBetween(candidate, ally))
      ), Infinity);
      const attackingAlly = allyIds.has(String(candidate?.targetSquadId || ''))
        || allyIds.has(String(candidate?.lastDamagedBySquadId || ''));
      return {
        candidate,
        attackingAlly,
        nearestAllyDistance,
        anchorDistance: distanceBetween(candidate, anchor),
        squadDistance: distanceBetween(candidate, squad)
      };
    })
    .filter((entry) => (
      entry.attackingAlly
      || entry.nearestAllyDistance <= assistRadius
      || entry.squadDistance <= assistRadius * 0.72
    ))
    .sort((left, right) => (
      Number(String(right?.candidate?.id || '') === String(previousTargetId || ''))
        - Number(String(left?.candidate?.id || '') === String(previousTargetId || ''))
      || Number(right.attackingAlly) - Number(left.attackingAlly)
      || left.anchorDistance - right.anchorDistance
      || left.squadDistance - right.squadDistance
      || String(left?.candidate?.id || '').localeCompare(String(right?.candidate?.id || ''), 'en')
    ))[0]?.candidate || null;
};

const resolveNearestNeutralSquad = (squad = {}, sim = {}, nowSec = 0) => (
  (Array.isArray(sim?.squads) ? sim.squads : [])
    .filter((candidate) => (
      candidate
      && candidate?.team === TEAM_NEUTRAL
      && isTrainingNeutralSquad(candidate)
      && finiteNumber(candidate?.remain) > 0
      && !isTrainingMapAiTargetDeferred(squad, candidate?.id, nowSec)
    ))
    .sort((left, right) => (
      distanceBetween(squad, left) - distanceBetween(squad, right)
      || String(left?.id || '').localeCompare(String(right?.id || ''), 'en')
    ))[0] || null
);

const resolveEscortPoint = ({ squad = {}, wave = {}, objectiveEntry = null } = {}) => {
  const path = Array.isArray(wave?.minionPath) ? wave.minionPath : [];
  const pushDirectionX = squad?.team === 'defender' ? -1 : 1;
  const projection = path.length >= 2 ? projectPointToPath(wave, path) : null;
  const forward = resolvePathDirection(path, projection, pushDirectionX);
  const followDistance = Math.max(
    36,
    finiteNumber(squad?.radius, 10) + finiteNumber(wave?.radius, 10) + 24
  );
  let point = {
    x: finiteNumber(wave?.x) - (forward.x * followDistance),
    y: finiteNumber(wave?.y) - (forward.y * followDistance)
  };
  if (!objectiveEntry?.building || objectiveEntry?.objective?.attackEnabled !== true) return point;
  const safeDistance = resolveObjectiveSafeDistance(squad, objectiveEntry);
  const building = objectiveEntry.building;
  if (distanceBetween(point, building) >= safeDistance) return point;
  if (path.length >= 2) {
    const buildingProjection = projectPointToPath(building, path);
    const safePathPoint = resolvePathPointAtProgress(
      path,
      Math.max(0, finiteNumber(buildingProjection?.progress) - safeDistance)
    );
    if (safePathPoint) return safePathPoint;
  }
  let awayX = point.x - finiteNumber(building?.x);
  let awayY = point.y - finiteNumber(building?.y);
  let awayLength = Math.hypot(awayX, awayY);
  if (awayLength <= 0.001) {
    awayX = -forward.x;
    awayY = -forward.y;
    awayLength = 1;
  }
  point = {
    x: finiteNumber(building?.x) + ((awayX / awayLength) * safeDistance),
    y: finiteNumber(building?.y) + ((awayY / awayLength) * safeDistance)
  };
  return point;
};

const buildStrategicPlan = ({
  kind = TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE,
  laneId = '',
  wave = null,
  targetSquad = null,
  objectiveEntry = null,
  point = null,
  reason = '',
  nowSec = 0,
  lockSeconds = AI_PLAN_MOVEMENT_LOCK_SECONDS
} = {}) => {
  const targetSquadId = String(targetSquad?.id || '');
  const targetObjectiveId = String(objectiveEntry?.objective?.id || '');
  const targetBuildingId = String(objectiveEntry?.building?.id || '');
  const waveId = String(wave?.id || '');
  return {
    id: [kind, laneId, targetSquadId || targetObjectiveId || waveId || 'lane'].join(':'),
    kind,
    laneId: String(laneId || ''),
    waveId,
    targetSquadId,
    targetObjectiveId,
    targetBuildingId,
    x: finiteNumber(point?.x, finiteNumber(targetSquad?.x, finiteNumber(objectiveEntry?.building?.x))),
    y: finiteNumber(point?.y, finiteNumber(targetSquad?.y, finiteNumber(objectiveEntry?.building?.y))),
    reason: String(reason || ''),
    createdAt: Math.max(0, finiteNumber(nowSec)),
    lockUntil: Math.max(0, finiteNumber(nowSec)) + Math.max(0.1, finiteNumber(lockSeconds, 1))
  };
};

const isStrategicPlanValid = (plan = null, squad = {}, sim = {}, laneWaves = [], nowSec = 0) => {
  if (!plan) return false;
  if (plan.kind === TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER) {
    const entry = resolveStrategicObjectiveEntries(squad, sim).find((candidate) => (
      String(candidate?.objective?.id || '') === String(plan?.targetObjectiveId || '')
    ));
    return !!entry && isObjectiveTargetingSquad(entry, squad?.id);
  }
  if (plan.targetSquadId) {
    if (isTrainingMapAiTargetDeferred(squad, plan.targetSquadId, nowSec)) return false;
    return (Array.isArray(sim?.squads) ? sim.squads : []).some((candidate) => (
      String(candidate?.id || '') === String(plan.targetSquadId)
      && finiteNumber(candidate?.remain) > 0
    ));
  }
  if (plan.targetObjectiveId) {
    const entry = resolveStrategicObjectiveEntries(squad, sim).find((candidate) => (
      String(candidate?.objective?.id || '') === String(plan.targetObjectiveId)
    ));
    if (!entry) return false;
    if (
      plan.kind === TRAINING_MAP_AI_PLAN_KIND.SIEGE_TOWER
      || plan.kind === TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS
    ) return isObjectiveCoveredByMinions(entry, laneWaves);
    return true;
  }
  if (plan.waveId) {
    return (Array.isArray(sim?.squads) ? sim.squads : []).some((candidate) => (
      String(candidate?.id || '') === String(plan.waveId)
      && finiteNumber(candidate?.remain) > 0
    ));
  }
  return plan.kind === TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE;
};

export const selectTrainingMapAiPlan = (squad = {}, sim = {}, { nowSec = sim?.timeElapsed } = {}) => {
  if (
    !isTrainingCardAiSquad(squad)
    || finiteNumber(squad?.remain) <= 0
  ) return null;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const previousPlan = squad?._trainingAiPlan && typeof squad._trainingAiPlan === 'object'
    ? squad._trainingAiPlan
    : null;
  const laneChoice = resolveStrategicLaneChoice(squad, sim, previousPlan);
  const laneId = laneChoice.laneId;
  const wave = laneChoice.wave;
  const laneWaves = resolveFriendlyLaneWaves(squad, sim, laneId);
  const objectiveEntries = resolveStrategicObjectiveEntries(squad, sim);
  const objectiveEntry = resolveNextStrategicObjective({ squad, sim, laneId, wave });
  const threateningObjective = resolveThreateningObjective(squad, sim);
  let candidate = null;

  if (threateningObjective) {
    const building = threateningObjective.building;
    const safeDistance = resolveObjectiveSafeDistance(squad, threateningObjective) + 18;
    const path = Array.isArray(wave?.minionPath) ? wave.minionPath : [];
    let retreatPoint = null;
    if (path.length >= 2) {
      const buildingProjection = projectPointToPath(building, path);
      retreatPoint = resolvePathPointAtProgress(
        path,
        Math.max(0, finiteNumber(buildingProjection?.progress) - safeDistance)
      );
    }
    if (!retreatPoint) {
      let awayX = finiteNumber(squad?.x) - finiteNumber(building?.x);
      let awayY = finiteNumber(squad?.y) - finiteNumber(building?.y);
      let awayLength = Math.hypot(awayX, awayY);
      if (awayLength <= 0.001) {
        awayX = squad?.team === 'defender' ? 1 : -1;
        awayY = 0;
        awayLength = 1;
      }
      retreatPoint = {
        x: finiteNumber(building?.x) + ((awayX / awayLength) * safeDistance),
        y: finiteNumber(building?.y) + ((awayY / awayLength) * safeDistance)
      };
    }
    candidate = buildStrategicPlan({
      kind: TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER,
      laneId,
      wave,
      objectiveEntry: threateningObjective,
      point: retreatPoint,
      reason: 'tower-targeting-main-force',
      nowSec: safeNow,
      lockSeconds: 0.65
    });
  }

  if (!candidate) {
    const engagementTarget = resolveLaneEngagementTarget({
      squad,
      sim,
      laneId,
      wave,
      previousTargetId: previousPlan?.targetSquadId,
      nowSec: safeNow,
      objectiveEntries,
      laneWaves
    });
    if (engagementTarget) {
      candidate = buildStrategicPlan({
        kind: TRAINING_MAP_AI_PLAN_KIND.DEFEND_WAVE,
        laneId,
        wave,
        targetSquad: engagementTarget,
        reason: 'enemy-threatening-lane-wave',
        nowSec: safeNow,
        lockSeconds: AI_PLAN_TARGET_LOCK_SECONDS
      });
    }
  }

  if (!candidate && objectiveEntry && wave && isObjectiveCoveredByMinions(objectiveEntry, laneWaves)) {
    candidate = buildStrategicPlan({
      kind: objectiveEntry?.objective?.type === 'barracks'
        ? TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS
        : TRAINING_MAP_AI_PLAN_KIND.SIEGE_TOWER,
      laneId,
      wave,
      objectiveEntry,
      reason: `${objectiveEntry.stage}-covered-by-minions`,
      nowSec: safeNow,
      lockSeconds: AI_PLAN_TARGET_LOCK_SECONDS
    });
  }

  const neutralTarget = resolveNearestNeutralSquad(squad, sim, safeNow);
  if (!candidate && neutralTarget) {
    const diagonal = resolveMapFieldDiagonal(sim);
    const campRadius = clamp(diagonal * 0.055, 260, 520);
    const waveDistance = wave ? distanceBetween(squad, wave) : Infinity;
    const objectiveDistance = objectiveEntry && wave
      ? distanceBetween(wave, objectiveEntry.building)
      : Infinity;
    const objectiveImminent = objectiveEntry && wave
      && objectiveDistance <= Math.max(620, resolveObjectiveSafeDistance(squad, objectiveEntry) + 260);
    if (
      distanceBetween(squad, neutralTarget) <= campRadius
      && !objectiveImminent
      && (!wave || waveDistance <= campRadius * 1.35)
    ) {
      candidate = buildStrategicPlan({
        kind: TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL,
        laneId,
        wave,
        targetSquad: neutralTarget,
        reason: 'safe-lane-downtime',
        nowSec: safeNow,
        lockSeconds: AI_PLAN_NEUTRAL_LOCK_SECONDS
      });
    }
  }

  if (!candidate && wave) {
    const point = resolveEscortPoint({ squad, wave, objectiveEntry });
    candidate = buildStrategicPlan({
      kind: laneChoice.rotated
        ? TRAINING_MAP_AI_PLAN_KIND.ROTATE_LANE
        : TRAINING_MAP_AI_PLAN_KIND.ESCORT_WAVE,
      laneId,
      wave,
      objectiveEntry,
      point,
      reason: objectiveEntry ? `wait-minions-before-${objectiveEntry.stage}` : 'follow-front-wave',
      nowSec: safeNow,
      lockSeconds: AI_PLAN_MOVEMENT_LOCK_SECONDS
    });
  }

  if (!candidate && neutralTarget) {
    candidate = buildStrategicPlan({
      kind: TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL,
      laneId,
      targetSquad: neutralTarget,
      reason: 'no-active-friendly-wave',
      nowSec: safeNow,
      lockSeconds: AI_PLAN_NEUTRAL_LOCK_SECONDS
    });
  }

  if (!candidate) {
    const lane = (Array.isArray(sim?.trainingMap?.lanes) ? sim.trainingMap.lanes : [])
      .find((entry) => String(entry?.id || '') === laneId) || null;
    const path = Array.isArray(lane?.centerline) ? lane.centerline.filter(Boolean) : [];
    const pushDirectionX = squad?.team === 'defender' ? -1 : 1;
    const projection = path.length >= 2 ? projectPointToPath(squad, path) : null;
    const point = path.length >= 2
      ? resolvePathPointAtProgress(
        path,
        finiteNumber(projection?.progress) + (pushDirectionX * 260)
      )
      : {
        x: pushDirectionX * (Math.max(1, finiteNumber(sim?.field?.width, 2700)) * 0.46),
        y: finiteNumber(squad?.y)
      };
    candidate = buildStrategicPlan({
      kind: TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE,
      laneId,
      point,
      reason: 'hold-lane-until-next-wave',
      nowSec: safeNow,
      lockSeconds: AI_PLAN_MOVEMENT_LOCK_SECONDS
    });
  }

  const previousLaneWaves = previousPlan?.laneId
    ? resolveFriendlyLaneWaves(squad, sim, previousPlan.laneId)
    : laneWaves;
  const previousValid = isStrategicPlanValid(previousPlan, squad, sim, previousLaneWaves, safeNow);
  const previousPriority = AI_PLAN_PRIORITY[previousPlan?.kind] ?? Infinity;
  const candidatePriority = AI_PLAN_PRIORITY[candidate?.kind] ?? Infinity;
  const selected = previousValid
    && finiteNumber(previousPlan?.lockUntil) > safeNow
    && previousPriority <= candidatePriority
    ? previousPlan
    : candidate;
  squad._trainingAiPlan = selected;
  squad.trainingAiLaneId = String(selected?.laneId || laneId || squad?.spawnLaneId || '').trim();
  return selected;
};

export const isTrainingMapAiTargetDeferred = (squad = null, targetId = '', nowSec = 0) => {
  const navigation = squad?._trainingTargetNavigation;
  if (!navigation || !targetId) return false;
  const targetStates = navigation?.targets && typeof navigation.targets === 'object'
    ? navigation.targets
    : {};
  const targetState = targetStates[String(targetId || '')]
    || (String(navigation?.targetId || '') === String(targetId || '') ? navigation : null);
  if (!targetState) return false;
  return Math.max(
    0,
    finiteNumber(targetState?.retryAt),
    finiteNumber(targetState?.blockedUntil)
  ) > Math.max(0, finiteNumber(nowSec));
};

export const resolveTrainingMapAiTargetScoring = (sim = {}) => {
  const source = sim?.trainingMap?.navigation?.aiTargetScoring;
  if (sim?._trainingAiScoringSource === source && sim?._trainingAiScoringCache) {
    return sim._trainingAiScoringCache;
  }
  const config = source && typeof source === 'object' ? source : {};
  const scoring = {
    distanceWeight: normalizeTargetScoringValue(config?.distanceWeight, DEFAULT_TARGET_SCORING.distanceWeight),
    sameLaneBonus: normalizeTargetScoringValue(config?.sameLaneBonus, DEFAULT_TARGET_SCORING.sameLaneBonus),
    offLanePenalty: normalizeTargetScoringValue(config?.offLanePenalty, DEFAULT_TARGET_SCORING.offLanePenalty),
    threatWeight: normalizeTargetScoringValue(config?.threatWeight, DEFAULT_TARGET_SCORING.threatWeight),
    lowHealthBonus: normalizeTargetScoringValue(config?.lowHealthBonus, DEFAULT_TARGET_SCORING.lowHealthBonus),
    inAttackRangeBonus: normalizeTargetScoringValue(config?.inAttackRangeBonus, DEFAULT_TARGET_SCORING.inAttackRangeBonus),
    attackingAllyBonus: normalizeTargetScoringValue(config?.attackingAllyBonus, DEFAULT_TARGET_SCORING.attackingAllyBonus),
    targetLockBonus: normalizeTargetScoringValue(config?.targetLockBonus, DEFAULT_TARGET_SCORING.targetLockBonus),
    protectedAreaPenalty: normalizeTargetScoringValue(config?.protectedAreaPenalty, DEFAULT_TARGET_SCORING.protectedAreaPenalty),
    blockedLinePenalty: normalizeTargetScoringValue(config?.blockedLinePenalty, DEFAULT_TARGET_SCORING.blockedLinePenalty)
  };
  if (sim && typeof sim === 'object') {
    sim._trainingAiScoringSource = source;
    sim._trainingAiScoringCache = scoring;
  }
  return scoring;
};

export const scoreTrainingMapAiTarget = (squad = {}, candidate = {}, sim = {}, nowSec = 0) => {
  if (!isTrainingCardAiSquad(squad)) return null;
  if (!squad || !candidate || !canAcquireSquadTarget(squad, candidate)) return null;
  if (finiteNumber(candidate?.remain) <= 0 || isEnemyHiddenForViewer(candidate, squad?.team)) return null;
  if (isTrainingMapAiTargetDeferred(squad, candidate?.id, nowSec)) return null;

  const context = resolveTrainingAiContext(sim);
  const config = resolveTrainingMapAiTargetScoring(sim);
  const distance = Math.hypot(
    finiteNumber(candidate?.x) - finiteNumber(squad?.x),
    finiteNumber(candidate?.y) - finiteNumber(squad?.y)
  );
  const sourceLaneId = resolveSquadLaneId(squad, sim);
  const targetLaneId = resolveSquadLaneId(candidate, sim);
  const sameLane = !!sourceLaneId && sourceLaneId === targetLaneId;
  const attackRange = resolveSquadAttackRange(squad);
  const rangeDistance = Math.max(0, attackRange.max) + Math.max(0, finiteNumber(squad?.radius, 10)) + Math.max(0, finiteNumber(candidate?.radius, 10));
  const inAttackRange = distance <= rangeDistance;
  const healthRatio = resolveHealthRatio(candidate);
  const threat = clamp(finiteNumber(candidate?.stats?.atk) / 100, 0, 1);
  const attackingAlly = isTargetAttackingAlly(candidate, squad, sim, context);
  const protectedArea = isTargetInsideProtectedArea(candidate, sim, context);
  const directLineBlocked = hasBlockedDirectLine(squad, candidate, sim, '', context);
  const lockedTargetId = String(squad?.trainingAi?.targetId || squad?.targetSquadId || '');
  const locked = lockedTargetId === String(candidate?.id || '');
  const distanceTerm = -(distance / resolveMapFieldDiagonal(sim)) * config.distanceWeight;
  const laneTerm = sameLane ? config.sameLaneBonus : (sourceLaneId && targetLaneId ? -config.offLanePenalty : 0);
  const threatTerm = threat * config.threatWeight;
  const lowHealthTerm = (1 - healthRatio) * config.lowHealthBonus;
  const rangeTerm = inAttackRange ? config.inAttackRangeBonus : 0;
  const allyTerm = attackingAlly ? config.attackingAllyBonus : 0;
  const lockTerm = locked ? config.targetLockBonus : 0;
  const protectionTerm = protectedArea ? -config.protectedAreaPenalty : 0;
  const blockedLineTerm = directLineBlocked ? -config.blockedLinePenalty : 0;
  const score = distanceTerm
    + laneTerm
    + threatTerm
    + lowHealthTerm
    + rangeTerm
    + allyTerm
    + lockTerm
    + protectionTerm
    + blockedLineTerm;

  return {
    target: candidate,
    targetId: String(candidate?.id || ''),
    score,
    distance,
    sameLane,
    targetLaneId,
    threat,
    healthRatio,
    inAttackRange,
    attackingAlly,
    protectedArea,
    directLineBlocked,
    terms: {
      distance: distanceTerm,
      lane: laneTerm,
      threat: threatTerm,
      lowHealth: lowHealthTerm,
      inAttackRange: rangeTerm,
      attackingAlly: allyTerm,
      targetLock: lockTerm,
      protectedArea: protectionTerm,
      blockedLine: blockedLineTerm
    }
  };
};

export const selectTrainingMapAiTarget = (squad = {}, sim = {}, {
  candidates = null,
  nowSec = 0
} = {}) => {
  if (!isTrainingCardAiSquad(squad)) return null;
  const sourceRows = Array.isArray(candidates) ? candidates : (Array.isArray(sim?.squads) ? sim.squads : []);
  const sourceLaneId = resolveSquadLaneId(squad, sim);
  const sameLaneRows = sourceLaneId
    ? sourceRows.filter((candidate) => (
      candidate
      && canAcquireSquadTarget(squad, candidate)
      && resolveSquadLaneId(candidate, sim) === sourceLaneId
    ))
    : [];
  const rows = sameLaneRows.length > 0 ? sameLaneRows : sourceRows;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const cached = squad?._trainingAiTargetCache;
  if (cached && finiteNumber(cached?.nextAt) > safeNow) {
    const cachedTarget = rows.find((candidate) => String(candidate?.id || '') === String(cached?.targetId || ''));
    if (
      (!cached?.targetId || (cachedTarget && finiteNumber(cachedTarget?.remain) > 0))
      && (!cached?.targetId || !isTrainingMapAiTargetDeferred(squad, cached.targetId, safeNow))
    ) {
      return cached.selection || null;
    }
  }
  let best = null;
  rows.forEach((candidate) => {
    const score = scoreTrainingMapAiTarget(squad, candidate, sim, safeNow);
    if (!score) return;
    if (!best || score.score > best.score || (
      score.score === best.score && score.targetId.localeCompare(best.targetId, 'zh-Hans-CN') < 0
    )) {
      best = score;
    }
  });
  squad._trainingAiTargetCache = {
    targetId: String(best?.targetId || ''),
    selection: best,
    nextAt: safeNow + AI_DECISION_INTERVAL_SECONDS
  };
  return best;
};

export const selectTrainingMapAiObjective = (squad = {}, sim = {}) => {
  if (!isTrainingCardAiSquad(squad)) return null;
  const nowSec = Math.max(0, finiteNumber(sim?.timeElapsed));
  const context = resolveTrainingAiContext(sim);
  const config = resolveTrainingMapAiTargetScoring(sim);
  const sourceLaneId = resolveSquadLaneId(squad, sim);
  const objectives = Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [];
  const hasSameLaneObjective = !!sourceLaneId && objectives.some((objective) => {
    if (!objective || objective.destroyed || objective.targetable === false) return false;
    if (!isHostileTeam(squad?.team, objective?.team)) return false;
    if (String(objective?.laneId || '') !== sourceLaneId) return false;
    const building = resolveObjectiveBuilding(sim, objective, context);
    return !!building && building.destroyed !== true;
  });
  const cached = squad?._trainingAiObjectiveCache;
  if (cached && finiteNumber(cached?.nextAt) > nowSec) {
    const cachedObjective = cached.selection?.objective;
    const cachedBuilding = cached.selection?.building;
    if (
      cached.selection
      && cachedObjective
      && cachedBuilding
      && cachedObjective.destroyed !== true
      && cachedObjective.targetable !== false
      && cachedBuilding.destroyed !== true
      && (!hasSameLaneObjective || String(cachedObjective?.laneId || '') === sourceLaneId)
    ) {
      return cached.selection;
    }
    if (!cached.selection) return null;
  }
  const attackRange = resolveSquadAttackRange(squad);
  const lockedGoalId = String(squad?.autoNavigation?.goalId || '');
  const explicitBuildingIds = new Set([
    String(squad?.order?.targetBuildingId || ''),
    String(squad?.targetBuildingId || '')
  ].filter(Boolean));
  let best = null;
  objectives.forEach((objective) => {
    if (!objective || objective.destroyed || objective.targetable === false) return;
    if (!isHostileTeam(squad?.team, objective?.team)) return;
    if (
      objective?.team === TEAM_NEUTRAL
      && !explicitBuildingIds.has(String(objective?.sourceObjectId || ''))
    ) return;
    const building = resolveObjectiveBuilding(sim, objective, context);
    if (!building || building.destroyed) return;
    const targetRadius = Math.max(4, Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5);
    const distance = Math.hypot(
      finiteNumber(building?.x) - finiteNumber(squad?.x),
      finiteNumber(building?.y) - finiteNumber(squad?.y)
    );
    const targetLaneId = String(objective?.laneId || '');
    if (hasSameLaneObjective && targetLaneId !== sourceLaneId) return;
    const sameLane = !!sourceLaneId && sourceLaneId === targetLaneId;
    const healthRatio = clamp(
      finiteNumber(objective?.hp, finiteNumber(objective?.maxHp, 1)) / Math.max(1, finiteNumber(objective?.maxHp, finiteNumber(objective?.hp, 1))),
      0,
      1
    );
    const threat = clamp(finiteNumber(objective?.attackDamage) / 100, 0, 1);
    const inAttackRange = distance <= attackRange.max + Math.max(0, finiteNumber(squad?.radius, 10)) + targetRadius;
    const directLineBlocked = hasBlockedDirectLine(squad, building, sim, objective?.sourceObjectId, context);
    const protectedArea = objective?.attackEnabled === true;
    const targetId = `objective:${String(objective?.id || '')}`;
    const distanceTerm = -(distance / resolveMapFieldDiagonal(sim)) * config.distanceWeight;
    const laneTerm = sameLane ? config.sameLaneBonus : (sourceLaneId && targetLaneId ? -config.offLanePenalty : 0);
    const threatTerm = threat * config.threatWeight;
    const lowHealthTerm = (1 - healthRatio) * config.lowHealthBonus;
    const rangeTerm = inAttackRange ? config.inAttackRangeBonus : 0;
    const lockTerm = lockedGoalId === targetId ? config.targetLockBonus : 0;
    const protectionTerm = protectedArea ? -config.protectedAreaPenalty : 0;
    const blockedLineTerm = directLineBlocked ? -config.blockedLinePenalty : 0;
    const score = distanceTerm
      + laneTerm
      + threatTerm
      + lowHealthTerm
      + rangeTerm
      + lockTerm
      + protectionTerm
      + blockedLineTerm;
    const selection = {
      objective,
      building,
      targetId,
      x: finiteNumber(building?.x),
      y: finiteNumber(building?.y),
      score,
      distance,
      sameLane,
      targetLaneId,
      healthRatio,
      threat,
      inAttackRange,
      protectedArea,
      directLineBlocked,
      terms: {
        distance: distanceTerm,
        lane: laneTerm,
        threat: threatTerm,
        lowHealth: lowHealthTerm,
        inAttackRange: rangeTerm,
        targetLock: lockTerm,
        protectedArea: protectionTerm,
        blockedLine: blockedLineTerm
      }
    };
    if (!best || selection.score > best.score || (
      selection.score === best.score && selection.targetId.localeCompare(best.targetId, 'zh-Hans-CN') < 0
    )) {
      best = selection;
    }
  });
  squad._trainingAiObjectiveCache = {
    selection: best,
    nextAt: nowSec + AI_DECISION_INTERVAL_SECONDS
  };
  return best;
};

const getStateMaxDuration = (state = '') => Math.max(0, finiteNumber(STATE_MAX_DURATION_SECONDS[state]));

const ensureTrainingMapAiRuntime = (squad = {}, sim = {}, nowSec = 0) => {
  if (!squad || typeof squad !== 'object') return null;
  if (!squad.trainingAi || typeof squad.trainingAi !== 'object') {
    squad.trainingAi = {
      state: TRAINING_MAP_AI_STATE.SPAWN,
      enteredAt: Math.max(0, finiteNumber(nowSec)),
      expiresAt: Math.max(0, finiteNumber(nowSec)) + getStateMaxDuration(TRAINING_MAP_AI_STATE.SPAWN),
      targetId: '',
      targetScore: null,
      retries: 0,
      events: []
    };
    recordTrainingMapAiEvent({
      squad,
      sim,
      nowSec,
      from: '',
      to: TRAINING_MAP_AI_STATE.SPAWN,
      reason: 'initialized'
    });
  }
  return squad.trainingAi;
};

export const clearTrainingMapAiState = clearTrainingCardAiState;

export const recordTrainingMapAiEvent = ({
  squad = null,
  sim = null,
  nowSec = 0,
  from = '',
  to = '',
  reason = '',
  targetId = ''
} = {}) => {
  if (!squad) return null;
  const event = {
    at: Math.max(0, finiteNumber(nowSec)),
    squadId: String(squad?.id || ''),
    from: String(from || ''),
    to: String(to || ''),
    reason: String(reason || ''),
    targetId: String(targetId || '')
  };
  const runtime = squad.trainingAi && typeof squad.trainingAi === 'object' ? squad.trainingAi : null;
  if (runtime) {
    const events = Array.isArray(runtime.events) ? runtime.events : [];
    runtime.events = [...events, event].slice(-MAX_SQUAD_EVENT_COUNT);
  }
  if (sim && typeof sim === 'object') {
    const events = Array.isArray(sim.trainingAiEvents) ? sim.trainingAiEvents : [];
    sim.trainingAiEvents = [...events, event].slice(-MAX_SIM_EVENT_COUNT);
  }
  return event;
};

export const transitionTrainingMapAiState = ({
  squad = null,
  sim = null,
  nowSec = 0,
  nextState = TRAINING_MAP_AI_STATE.FORMING,
  reason = '',
  targetId = '',
  targetScore = null
} = {}) => {
  const runtime = ensureTrainingMapAiRuntime(squad, sim, nowSec);
  if (!runtime) return null;
  const next = Object.values(TRAINING_MAP_AI_STATE).includes(nextState)
    ? nextState
    : TRAINING_MAP_AI_STATE.FORMING;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const current = String(runtime?.state || '');
  const safeTargetId = String(targetId || runtime?.targetId || '');
  if (current !== next) {
    runtime.state = next;
    runtime.enteredAt = safeNow;
    runtime.expiresAt = safeNow + getStateMaxDuration(next);
    recordTrainingMapAiEvent({
      squad,
      sim,
      nowSec: safeNow,
      from: current,
      to: next,
      reason,
      targetId: safeTargetId
    });
  } else if (
    getStateMaxDuration(next) > 0
    && finiteNumber(runtime?.expiresAt) > 0
    && safeNow >= finiteNumber(runtime.expiresAt)
  ) {
    // State duration is a real watchdog rather than dead metadata.  A state
    // that remains valid receives a fresh decision window and leaves a small
    // trace in the existing AI event log for the debug overlay.
    runtime.enteredAt = safeNow;
    runtime.expiresAt = safeNow + getStateMaxDuration(next);
    recordTrainingMapAiEvent({
      squad,
      sim,
      nowSec: safeNow,
      from: current,
      to: next,
      reason: `${reason || 'state'}-watchdog-refresh`,
      targetId: safeTargetId
    });
  }
  runtime.targetId = safeTargetId;
  runtime.targetScore = targetScore && typeof targetScore === 'object'
    ? {
      score: finiteNumber(targetScore?.score),
      distance: finiteNumber(targetScore?.distance),
      sameLane: !!targetScore?.sameLane,
      inAttackRange: !!targetScore?.inAttackRange,
      protectedArea: !!targetScore?.protectedArea,
      directLineBlocked: !!targetScore?.directLineBlocked
    }
    : null;
  runtime.retries = Math.max(0, finiteNumber(squad?._trainingTargetNavigation?.failureCount));
  return runtime;
};

const resolveSquadTarget = (squad = {}, sim = {}, selection = null) => {
  if (selection?.target) return selection.target;
  const targetId = String(squad?.targetSquadId || squad?.trainingAi?.targetId || '');
  if (!targetId) return null;
  return (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
    String(candidate?.id || '') === targetId
    && finiteNumber(candidate?.remain) > 0
    && isHostileTeam(squad?.team, candidate?.team)
  )) || null;
};

export const syncTrainingMapAiState = ({
  squad = null,
  sim = null,
  nowSec = 0,
  selection = null,
  reason = ''
} = {}) => {
  if (!squad || !sim?.trainingMap) return null;
  if (!isTrainingCardComputerSquad(squad)) {
    clearTrainingCardAiState(squad);
    return null;
  }
  const runtime = ensureTrainingMapAiRuntime(squad, sim, nowSec);
  if (!runtime) return null;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const target = resolveSquadTarget(squad, sim, selection);
  const targetId = String(target?.id || selection?.targetId || '');
  const targetScore = selection || null;
  const formationRuntime = squad?.formationRuntime && typeof squad.formationRuntime === 'object'
    ? squad.formationRuntime
    : {};
  const combatRuntime = squad?.combatRuntime && typeof squad.combatRuntime === 'object'
    ? squad.combatRuntime
    : {};
  const formationState = String(formationRuntime?.state || '');
  const formationReadyRatio = clamp(finiteNumber(formationRuntime?.readyRatio, 1), 0, 1);
  const formationIsAssembling = formationState === 'ASSEMBLE'
    || formationState === 'REFORM';
  const hasReturnRoute = (Array.isArray(squad?.waypoints) && squad.waypoints.length > 0)
    || !!squad?.autoNavigation?.goalId;
  const expired = getStateMaxDuration(runtime?.state) > 0
    && finiteNumber(runtime?.expiresAt) > 0
    && safeNow >= finiteNumber(runtime.expiresAt);
  let nextState = TRAINING_MAP_AI_STATE.ADVANCE;
  let nextReason = reason || 'advance';

  if (finiteNumber(squad?.remain) <= 0) {
    nextState = TRAINING_MAP_AI_STATE.DEAD;
    nextReason = 'no-remaining-units';
  } else if (squad?.disabled === true || squad?.behavior === 'disabled') {
    nextState = TRAINING_MAP_AI_STATE.DISABLED;
    nextReason = 'disabled';
  } else if (squad?.behavior === 'retreat') {
    nextState = TRAINING_MAP_AI_STATE.RETREAT;
    nextReason = 'retreat-order';
  } else if (squad?.activeSkill) {
    nextState = TRAINING_MAP_AI_STATE.USE_ABILITY;
    nextReason = 'active-skill';
  } else if (runtime?.state === TRAINING_MAP_AI_STATE.SPAWN) {
    nextState = TRAINING_MAP_AI_STATE.FORMING;
    nextReason = 'spawn-ready';
  } else if (
    formationIsAssembling
    && formationReadyRatio < 0.56
    && !target
    && !hasReturnRoute
  ) {
    nextState = TRAINING_MAP_AI_STATE.FORMING;
    nextReason = 'formation-assembling';
  } else if (target) {
    const attackRange = resolveSquadAttackRange(squad);
    const distance = Math.hypot(finiteNumber(target?.x) - finiteNumber(squad?.x), finiteNumber(target?.y) - finiteNumber(squad?.y));
    const desiredRange = isRangedSquad(squad)
      ? Math.max(attackRange.min, attackRange.max * 0.72)
      : Math.max(attackRange.max * 0.82, 4.5);
    const targetRadius = Math.max(0, finiteNumber(target?.radius, 10));
    const wasEngaged = runtime?.state === TRAINING_MAP_AI_STATE.ATTACK
      || runtime?.state === TRAINING_MAP_AI_STATE.CHASE
      || String(combatRuntime?.state || '') === 'ENGAGED';
    const chaseLimit = desiredRange + targetRadius + Math.max(
      48,
      finiteNumber(squad?.radius, 12) * (isRangedSquad(squad) ? 2.4 : 3.6)
    );
    if (distance <= desiredRange + targetRadius) {
      nextState = TRAINING_MAP_AI_STATE.ATTACK;
      nextReason = 'target-in-range';
    } else if (wasEngaged && distance <= chaseLimit) {
      nextState = TRAINING_MAP_AI_STATE.CHASE;
      nextReason = 'combat-leash-chase';
    } else {
      nextState = TRAINING_MAP_AI_STATE.APPROACH_TARGET;
      nextReason = 'target-selected';
    }
  } else if (runtime?.state === TRAINING_MAP_AI_STATE.APPROACH_TARGET
    || runtime?.state === TRAINING_MAP_AI_STATE.ATTACK
    || runtime?.state === TRAINING_MAP_AI_STATE.USE_ABILITY
    || runtime?.state === TRAINING_MAP_AI_STATE.CHASE) {
    nextState = TRAINING_MAP_AI_STATE.REJOIN_LANE;
    nextReason = reason || 'target-lost';
  } else if (runtime?.state === TRAINING_MAP_AI_STATE.REJOIN_LANE && hasReturnRoute) {
    nextState = TRAINING_MAP_AI_STATE.REJOIN_LANE;
    nextReason = 'returning-to-lane';
  } else if (squad?.behavior === 'idle' || squad?.behavior === 'standby') {
    nextState = TRAINING_MAP_AI_STATE.FORMING;
    nextReason = 'idle';
  }

  // Do not let transient strategic labels survive forever when a plan has
  // already moved on.  The next decision still owns the actual plan/route.
  if (expired && nextState === runtime?.state) {
    if (nextState === TRAINING_MAP_AI_STATE.CHASE) {
      nextState = TRAINING_MAP_AI_STATE.APPROACH_TARGET;
      nextReason = 'chase-window-expired';
    } else if (nextState === TRAINING_MAP_AI_STATE.REJOIN_LANE) {
      nextState = TRAINING_MAP_AI_STATE.ADVANCE;
      nextReason = 'rejoin-window-expired';
    } else if (nextState === TRAINING_MAP_AI_STATE.FORMING && formationReadyRatio >= 0.56) {
      nextState = TRAINING_MAP_AI_STATE.ADVANCE;
      nextReason = 'formation-window-complete';
    }
  }

  return transitionTrainingMapAiState({
    squad,
    sim,
    nowSec: safeNow,
    nextState,
    reason: nextReason,
    targetId,
    targetScore
  });
};
