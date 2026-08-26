import { clamp, normalizeVec } from './crowdPhysics';
import {
  isRangedAgent,
  resolveAgentAttackRange
} from './attackRange';
import {
  TEAM_NEUTRAL,
  canAcquireSquadTarget,
  resolveDefaultHostileTeam
} from './teamRelations';

export const MINION_WAVE_AI_STATE = Object.freeze({
  MARCH: 'MARCH',
  APPROACH: 'APPROACH',
  ATTACK_HOLD: 'ATTACK_HOLD',
  RESUME: 'RESUME'
});

const TARGET_KIND_SQUAD = 'squad';
const TARGET_KIND_BUILDING = 'building';
const TARGET_PRIORITY_RETALIATION = 0;
const TARGET_PRIORITY_IMMEDIATE = 10;
const TARGET_PRIORITY_STRUCTURE = 20;
const MINION_AGGRO_RADIUS = 180;
const MINION_RETALIATION_RADIUS = 240;
const MINION_TARGET_LEASH_RADIUS = 320;
const MINION_STRUCTURE_ACQUIRE_DISTANCE = 240;
const MINION_TARGET_TIE_DISTANCE = 8;
const MINION_PATH_BEHIND_TOLERANCE = 32;
const MINION_MELEE_CENTER_GAP = 5.8;
const MINION_MELEE_BUILDING_EDGE_GAP = 4.2;
const MINION_SUPPORT_REAR_OFFSET = 46;
const MINION_AGENT_ARRIVAL_RADIUS = 0.7;
const MINION_COMBAT_READY_RADIUS = 2.4;
const MINION_COMBAT_READY_RATIO = 0.5;
const MINION_ANCHOR_ARRIVAL_RADIUS = 1.2;
const MINION_RESUME_DURATION_SEC = 0.24;

const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const distanceBetween = (left = {}, right = {}) => Math.hypot(
  finiteNumber(right?.x) - finiteNumber(left?.x),
  finiteNumber(right?.y) - finiteNumber(left?.y)
);

const isAliveAgent = (agent = null) => (
  !!agent
  && !agent.dead
  && finiteNumber(agent?.weight) > 0.001
);

const isCombatAgent = (agent = null) => (
  isAliveAgent(agent)
  && agent?.unitCategory !== 'support'
);

const resolveMinimumAgentEdgeDistance = (sourceAgents = [], targetAgents = []) => {
  let minimum = Infinity;
  (Array.isArray(sourceAgents) ? sourceAgents : []).filter(isAliveAgent).forEach((source) => {
    (Array.isArray(targetAgents) ? targetAgents : []).filter(isAliveAgent).forEach((target) => {
      minimum = Math.min(
        minimum,
        Math.max(
          0,
          distanceBetween(source, target)
            - Math.max(0, finiteNumber(source?.radius, 2.25))
            - Math.max(0, finiteNumber(target?.radius, 2.25))
        )
      );
    });
  });
  return minimum;
};

const resolveSquadFootprintRadius = (squad = {}) => {
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  return Math.max(
    8,
    Math.max(finiteNumber(formation?.width), finiteNumber(formation?.depth)) * 0.5,
    Math.min(24, finiteNumber(squad?.radius, 10))
  );
};

const resolveBuildingRadius = (building = {}) => Math.max(
  4,
  Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5
);

export const resolveMinionWaveAgentAttackRange = (agent = {}, squad = {}) => {
  const range = resolveAgentAttackRange(agent, squad);
  if (!isRangedAgent(agent)) return range;
  return { min: 0, max: Math.max(0, finiteNumber(range?.max)) };
};

export const projectPointToMinionPath = (point = {}, path = []) => {
  const rows = Array.isArray(path) ? path : [];
  let best = {
    distance: Infinity,
    progress: 0,
    segmentIndex: 0,
    point: rows[0]
      ? { x: finiteNumber(rows[0]?.x), y: finiteNumber(rows[0]?.y) }
      : { x: 0, y: 0 }
  };
  let travelled = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const start = rows[index - 1] || {};
    const end = rows[index] || {};
    const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
    const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) continue;
    const progress = clamp(
      (((finiteNumber(point?.x) - finiteNumber(start?.x)) * dx)
        + ((finiteNumber(point?.y) - finiteNumber(start?.y)) * dy)) / (length * length),
      0,
      1
    );
    const projected = {
      x: finiteNumber(start?.x) + (dx * progress),
      y: finiteNumber(start?.y) + (dy * progress)
    };
    const distance = distanceBetween(point, projected);
    if (distance < best.distance) {
      best = {
        distance,
        progress: travelled + (length * progress),
        segmentIndex: index - 1,
        point: projected
      };
    }
    travelled += length;
  }
  return best;
};

export const resolveMinionPathPointAtProgress = (path = [], progress = 0) => {
  const rows = Array.isArray(path) ? path : [];
  if (rows.length <= 0) return { x: 0, y: 0 };
  let remaining = Math.max(0, finiteNumber(progress));
  for (let index = 1; index < rows.length; index += 1) {
    const start = rows[index - 1] || {};
    const end = rows[index] || {};
    const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
    const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) continue;
    if (remaining <= length) {
      const progressRatio = clamp(remaining / length, 0, 1);
      return {
        x: finiteNumber(start?.x) + (dx * progressRatio),
        y: finiteNumber(start?.y) + (dy * progressRatio)
      };
    }
    remaining -= length;
  }
  const last = rows[rows.length - 1] || {};
  return { x: finiteNumber(last?.x), y: finiteNumber(last?.y) };
};

const resolvePathWaypoints = ({
  path = [],
  pathIndex = 1,
  targetProgress = Infinity,
  targetPoint = null
} = {}) => {
  const rows = Array.isArray(path) ? path : [];
  if (rows.length < 2) return [];
  const safeStartIndex = Math.max(1, Math.min(rows.length - 1, Math.floor(finiteNumber(pathIndex, 1))));
  const safeTargetProgress = Number.isFinite(Number(targetProgress))
    ? Math.max(0, Number(targetProgress))
    : Infinity;
  const waypoints = [];
  let travelled = 0;
  const appendPoint = (point = null) => {
    if (!point) return;
    const next = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
    const previous = waypoints[waypoints.length - 1];
    if (!previous || distanceBetween(previous, next) > 1) waypoints.push(next);
  };
  for (let index = 1; index < rows.length; index += 1) {
    const start = rows[index - 1] || {};
    const end = rows[index] || {};
    const segmentLength = distanceBetween(start, end);
    if (segmentLength <= 0.001) continue;
    const segmentEnd = travelled + segmentLength;
    if (index >= safeStartIndex && segmentEnd < safeTargetProgress - 4) appendPoint(end);
    if (segmentEnd >= safeTargetProgress - 4) break;
    travelled = segmentEnd;
  }
  appendPoint(targetPoint);
  return waypoints;
};

const ensureMinionAi = (squad = {}, nowSec = 0) => {
  if (!squad._minionAi || typeof squad._minionAi !== 'object') {
    squad._minionAi = {
      state: MINION_WAVE_AI_STATE.MARCH,
      stateEnteredAt: nowSec,
      transitionCount: 0,
      targetKind: '',
      targetId: '',
      targetPriority: Infinity,
      targetRevision: 0,
      holdAnchor: null,
      holdProgress: 0,
      minimumHoldProgress: 0,
      axisX: squad?.team === 'defender' ? -1 : 1,
      axisY: 0,
      pathAxisX: squad?.team === 'defender' ? -1 : 1,
      pathAxisY: 0,
      encounterKey: '',
      resumeUntil: 0,
      needsApproach: false
    };
  }
  const ai = squad._minionAi;
  if (!Object.values(MINION_WAVE_AI_STATE).includes(ai.state)) ai.state = MINION_WAVE_AI_STATE.MARCH;
  squad.minionAiState = ai.state;
  return ai;
};

const enterState = (squad = {}, ai = {}, state = MINION_WAVE_AI_STATE.MARCH, nowSec = 0) => {
  if (ai.state !== state) {
    ai.state = state;
    ai.stateEnteredAt = nowSec;
    ai.transitionCount = Math.max(0, Math.floor(finiteNumber(ai.transitionCount))) + 1;
  }
  squad.minionAiState = ai.state;
};

const clearTargetPlan = (ai = {}, { minimumHoldProgress = 0 } = {}) => {
  ai.targetOrigin = null;
  ai.holdAnchor = null;
  ai.holdProgress = 0;
  ai.minimumHoldProgress = Math.max(0, finiteNumber(minimumHoldProgress));
  ai.encounterKey = '';
  ai.encounterCenter = null;
  ai.needsApproach = false;
};

const resetMarchKinematics = (squad = {}, pathState = {}) => {
  const path = Array.isArray(pathState?.path) ? pathState.path : [];
  const progress = Math.max(
    finiteNumber(squad?.minionPathProgress),
    finiteNumber(pathState?.projection?.progress)
  );
  const before = resolveMinionPathPointAtProgress(path, Math.max(0, progress - 2));
  const after = resolveMinionPathPointAtProgress(path, progress + 2);
  const forward = normalizeVec(after.x - before.x, after.y - before.y);
  if (forward.len > 0.0001) {
    squad.dirX = forward.x;
    squad.dirY = forward.y;
    squad.smoothedDirX = forward.x;
    squad.smoothedDirY = forward.y;
    squad._crowdForward = { x: forward.x, y: forward.y };
  }
  squad.vx = 0;
  squad.vy = 0;
  squad.speed = 0;
  squad._minionNavigationRoute = null;
};

const clearAgentAssignments = (agents = []) => {
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent) return;
    agent.targetAgentId = '';
    agent.targetBuildingId = '';
    agent.supportTargetAgentId = '';
    agent.supportTargetSquadId = '';
    agent._combatTargetSquadId = '';
    agent._combatTargetLockUntil = 0;
    agent._combatDirective = null;
    agent._formationDetached = false;
    agent._minionAi = null;
    agent._minionForwardFloor = null;
  });
};

const syncSquadTargetFields = (squad = {}, ai = {}) => {
  const targetSquadId = ai.targetKind === TARGET_KIND_SQUAD ? String(ai.targetId || '') : '';
  const targetBuildingId = ai.targetKind === TARGET_KIND_BUILDING ? String(ai.targetId || '') : '';
  squad.targetSquadId = targetSquadId;
  squad.targetBuildingId = targetBuildingId;
  squad._combatEngagementTargetId = targetSquadId;
  squad._combatEngagementUntil = targetSquadId ? Number.POSITIVE_INFINITY : 0;
  squad.behavior = 'auto';
  squad.order = {
    ...(squad.order || {}),
    type: 'IDLE',
    targetSquadId,
    targetBuildingId
  };
};

const syncPathCursor = (squad = {}) => {
  const path = Array.isArray(squad?.minionPath) ? squad.minionPath : [];
  const projection = projectPointToMinionPath(squad, path);
  const previousIndex = Math.max(1, Math.floor(finiteNumber(squad?.minionPathIndex, 1)));
  let pathIndex = Math.max(previousIndex, Math.min(path.length - 1, projection.segmentIndex + 1));
  while (
    pathIndex < path.length - 1
    && distanceBetween(squad, path[pathIndex]) <= Math.max(10, finiteNumber(squad?.minionPathSpeed) * 0.08)
  ) {
    pathIndex += 1;
  }
  squad.minionPathIndex = pathIndex;
  squad.minionPathProgress = Math.max(finiteNumber(squad?.minionPathProgress), finiteNumber(projection?.progress));
  return {
    path,
    projection,
    pathIndex,
    progress: squad.minionPathProgress
  };
};

const isRoadEligible = (point = {}, squad = {}, isPointWithinLane = null) => (
  typeof isPointWithinLane !== 'function' || isPointWithinLane(point, squad) !== false
);

const isSquadLaneEligible = (squad = {}, candidate = {}, isPointWithinLane = null) => {
  if (!candidate || candidate.id === squad.id || finiteNumber(candidate?.remain) <= 0) return false;
  if (!canAcquireSquadTarget(squad, candidate)) return false;
  if (!isRoadEligible(candidate, squad, isPointWithinLane)) return false;
  if (candidate.team === TEAM_NEUTRAL) {
    return String(candidate?.targetSquadId || candidate?._combatEngagementTargetId || '') === String(squad?.id || '')
      || String(squad?.lastDamagedBySquadId || '') === String(candidate?.id || '');
  }
  const expectedTeam = resolveDefaultHostileTeam(squad?.team);
  const laneId = String(squad?.minionLaneId || '').trim();
  return String(candidate?.team || '') === expectedTeam
    && String(candidate?.minionLaneId || candidate?.spawnLaneId || '').trim() === laneId;
};

const resolveSquadCandidate = ({
  squad = {},
  sim = {},
  crowd = {},
  path = [],
  currentProgress = 0,
  radius = MINION_AGGRO_RADIUS,
  preferredId = '',
  isPointWithinLane = null
} = {}) => (
  (Array.isArray(sim?.squads) ? sim.squads : [])
    .filter((candidate) => isSquadLaneEligible(squad, candidate, isPointWithinLane))
    .map((candidate) => {
      const projection = projectPointToMinionPath(candidate, path);
      const centerDistance = distanceBetween(squad, candidate);
      const agentEdgeDistance = resolveMinimumAgentEdgeDistance(
        crowd?.agentsBySquad?.get?.(squad.id) || [],
        crowd?.agentsBySquad?.get?.(candidate.id) || []
      );
      return {
        kind: TARGET_KIND_SQUAD,
        id: String(candidate.id || ''),
        entity: candidate,
        projection,
        centerDistance,
        edgeDistance: Math.min(
          Math.max(
            0,
            centerDistance - resolveSquadFootprintRadius(squad) - resolveSquadFootprintRadius(candidate)
          ),
          agentEdgeDistance
        )
      };
    })
    .filter((entry) => (
      entry.projection.progress >= currentProgress - MINION_PATH_BEHIND_TOLERANCE
      && (
        entry.id === String(preferredId || '')
        || entry.centerDistance <= Math.max(1, finiteNumber(radius, MINION_AGGRO_RADIUS))
      )
    ))
    .sort((left, right) => (
      left.edgeDistance - right.edgeDistance
      || finiteNumber(left?.projection?.progress) - finiteNumber(right?.projection?.progress)
      || left.id.localeCompare(right.id)
    ))[0] || null
);

const resolveStructureCandidate = ({ squad = {}, sim = {}, path = [], currentProgress = 0 } = {}) => {
  const laneId = String(squad?.minionLaneId || '').trim();
  const barracksLane = String(squad?.minionBarracksLane || '').trim() === 'bottom' ? 'bottom' : 'top';
  const targetTeam = resolveDefaultHostileTeam(squad?.team);
  const buildings = Array.isArray(sim?.buildings) ? sim.buildings : [];
  const buildingById = new Map(buildings.filter((building) => building?.id).map((building) => [String(building.id), building]));
  return (Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [])
    .filter((objective) => {
      if (!objective || objective.destroyed || objective.targetable === false || objective.team !== targetTeam) return false;
      if (objective.type === 'tower') return String(objective?.laneId || '') === laneId;
      return objective.type === 'barracks';
    })
    .map((objective) => {
      const building = buildingById.get(String(objective?.sourceObjectId || '')) || null;
      if (!building || building.destroyed) return null;
      if (
        objective.type === 'barracks'
        && (
          building?.category !== 'barracks'
          || String(building?.highlandId || '') !== `${targetTeam}-${barracksLane}`
        )
      ) return null;
      const projection = projectPointToMinionPath(building, path);
      const distanceAhead = projection.progress - currentProgress;
      const centerDistance = distanceBetween(squad, building);
      const edgeDistance = Math.max(
        0,
        centerDistance - resolveSquadFootprintRadius(squad) - resolveBuildingRadius(building)
      );
      return {
        kind: TARGET_KIND_BUILDING,
        id: String(building.id || ''),
        entity: building,
        objective,
        projection,
        distanceAhead,
        centerDistance,
        edgeDistance
      };
    })
    .filter((entry) => (
      entry
      && entry.distanceAhead >= -12
      && (
        entry.distanceAhead <= MINION_STRUCTURE_ACQUIRE_DISTANCE
        || entry.edgeDistance <= MINION_STRUCTURE_ACQUIRE_DISTANCE
      )
    ))
    .sort((left, right) => (
      left.distanceAhead - right.distanceAhead
      || left.edgeDistance - right.edgeDistance
      || Number(left?.objective?.type === 'tower') * -1 - Number(right?.objective?.type === 'tower') * -1
      || left.id.localeCompare(right.id)
    ))[0] || null;
};

const resolveBestTarget = ({ squad = {}, sim = {}, crowd = {}, path = [], currentProgress = 0, isPointWithinLane = null } = {}) => {
  const retaliationId = finiteNumber(squad?.underAttackTimer) > 0.05
    ? String(squad?.lastDamagedBySquadId || '')
    : '';
  if (retaliationId) {
    const retaliation = resolveSquadCandidate({
      squad,
      sim,
      crowd,
      path,
      currentProgress,
      radius: MINION_RETALIATION_RADIUS,
      preferredId: retaliationId,
      isPointWithinLane
    });
    if (retaliation?.id === retaliationId) {
      return { ...retaliation, priority: TARGET_PRIORITY_RETALIATION };
    }
  }
  const enemy = resolveSquadCandidate({
    squad,
    sim,
    crowd,
    path,
    currentProgress,
    radius: MINION_AGGRO_RADIUS,
    isPointWithinLane
  });
  const structure = resolveStructureCandidate({ squad, sim, path, currentProgress });
  if (enemy && structure) {
    if (enemy.edgeDistance <= structure.edgeDistance + MINION_TARGET_TIE_DISTANCE) {
      return { ...enemy, priority: TARGET_PRIORITY_IMMEDIATE };
    }
    return { ...structure, priority: TARGET_PRIORITY_IMMEDIATE };
  }
  if (enemy) return { ...enemy, priority: TARGET_PRIORITY_IMMEDIATE };
  if (structure) return { ...structure, priority: TARGET_PRIORITY_STRUCTURE };
  return null;
};

const resolveCommittedTarget = ({ squad = {}, ai = {}, sim = {}, path = [], isPointWithinLane = null } = {}) => {
  if (!ai.targetId || !ai.targetKind) return null;
  if (ai.targetKind === TARGET_KIND_SQUAD) {
    const candidate = (Array.isArray(sim?.squads) ? sim.squads : []).find((row) => (
      String(row?.id || '') === String(ai.targetId || '')
    )) || null;
    if (!isSquadLaneEligible(squad, candidate, isPointWithinLane)) return null;
    const origin = ai.targetOrigin && typeof ai.targetOrigin === 'object' ? ai.targetOrigin : squad;
    if (distanceBetween(origin, candidate) > MINION_TARGET_LEASH_RADIUS) return null;
    return {
      kind: TARGET_KIND_SQUAD,
      id: String(candidate.id || ''),
      entity: candidate,
      priority: finiteNumber(ai.targetPriority, TARGET_PRIORITY_IMMEDIATE),
      projection: projectPointToMinionPath(candidate, path)
    };
  }
  if (ai.targetKind === TARGET_KIND_BUILDING) {
    const building = (Array.isArray(sim?.buildings) ? sim.buildings : []).find((row) => (
      String(row?.id || '') === String(ai.targetId || '')
      && !row?.destroyed
    )) || null;
    if (!building) return null;
    const objective = (Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : []).find((row) => (
      String(row?.sourceObjectId || '') === String(building.id || '')
      && !row?.destroyed
      && row?.targetable !== false
    )) || null;
    if (!objective) return null;
    return {
      kind: TARGET_KIND_BUILDING,
      id: String(building.id || ''),
      entity: building,
      objective,
      priority: finiteNumber(ai.targetPriority, TARGET_PRIORITY_STRUCTURE),
      projection: projectPointToMinionPath(building, path)
    };
  }
  return null;
};

const commitTarget = ({ squad = {}, ai = {}, target = null, agents = [], pathState = {}, nowSec = 0 } = {}) => {
  if (!target) return false;
  const changed = ai.targetKind !== target.kind || String(ai.targetId || '') !== String(target.id || '');
  if (!changed) {
    ai.targetPriority = Math.min(finiteNumber(ai.targetPriority, target.priority), finiteNumber(target.priority, Infinity));
    syncSquadTargetFields(squad, ai);
    return false;
  }
  const previousAgentPlans = new Map(
    (Array.isArray(agents) ? agents : [])
      .filter((agent) => (
        agent?.id
        && Number.isFinite(Number(agent?._minionAi?.combatX))
        && Number.isFinite(Number(agent?._minionAi?.combatY))
      ))
      .map((agent) => [String(agent.id), {
        x: finiteNumber(agent._minionAi.combatX),
        y: finiteNumber(agent._minionAi.combatY)
      }])
  );
  clearAgentAssignments(agents);
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    const previousPlan = previousAgentPlans.get(String(agent?.id || ''));
    if (previousPlan) agent._minionForwardFloor = previousPlan;
  });
  const previousHoldProgress = Math.max(
    finiteNumber(ai.holdProgress),
    finiteNumber(ai.minimumHoldProgress)
  );
  ai.targetKind = target.kind;
  ai.targetId = String(target.id || '');
  ai.targetPriority = finiteNumber(target.priority, TARGET_PRIORITY_STRUCTURE);
  ai.targetRevision = Math.max(0, Math.floor(finiteNumber(ai.targetRevision))) + 1;
  clearTargetPlan(ai, { minimumHoldProgress: previousHoldProgress });
  ai.targetOrigin = { x: finiteNumber(target?.entity?.x), y: finiteNumber(target?.entity?.y) };
  ai.needsApproach = true;
  resetMarchKinematics(squad, pathState);
  enterState(squad, ai, MINION_WAVE_AI_STATE.APPROACH, nowSec);
  syncSquadTargetFields(squad, ai);
  return true;
};

const releaseTarget = ({ squad = {}, ai = {}, agents = [], pathState = {}, nowSec = 0 } = {}) => {
  const hadTarget = !!ai.targetId;
  if (hadTarget) ai.targetRevision = Math.max(0, Math.floor(finiteNumber(ai.targetRevision))) + 1;
  ai.targetKind = '';
  ai.targetId = '';
  ai.targetPriority = Infinity;
  clearTargetPlan(ai);
  ai.resumeUntil = nowSec + MINION_RESUME_DURATION_SEC;
  clearAgentAssignments(agents);
  resetMarchKinematics(squad, pathState);
  enterState(squad, ai, MINION_WAVE_AI_STATE.RESUME, nowSec);
  syncSquadTargetFields(squad, ai);
};

const ensureEncounterMap = (sim = {}) => {
  if (!(sim._minionWaveEncounters instanceof Map)) sim._minionWaveEncounters = new Map();
  return sim._minionWaveEncounters;
};

const resolveClosestAgentPairCenter = ({ crowd = {}, squad = {}, target = {} } = {}) => {
  const sourceAgents = (crowd?.agentsBySquad?.get?.(squad.id) || []).filter(isAliveAgent);
  const targetAgents = (crowd?.agentsBySquad?.get?.(target.id) || []).filter(isAliveAgent);
  const pairs = [];
  sourceAgents.forEach((sourceAgent) => {
    targetAgents.forEach((targetAgent) => {
      const distance = distanceBetween(sourceAgent, targetAgent);
      const edgeDistance = Math.max(
        0,
        distance
          - Math.max(0, finiteNumber(sourceAgent?.radius, 2.25))
          - Math.max(0, finiteNumber(targetAgent?.radius, 2.25))
      );
      pairs.push({ sourceAgent, targetAgent, distance, edgeDistance });
    });
  });
  const frontLinePairs = pairs.filter((pair) => (
    pair.sourceAgent?.unitCategory === 'melee'
    && pair.targetAgent?.unitCategory === 'melee'
  ));
  const closest = (frontLinePairs.length > 0 ? frontLinePairs : pairs)
    .sort((left, right) => (
      left.edgeDistance - right.edgeDistance
      || left.distance - right.distance
      || String(left?.sourceAgent?.id || '').localeCompare(String(right?.sourceAgent?.id || ''))
      || String(left?.targetAgent?.id || '').localeCompare(String(right?.targetAgent?.id || ''))
    ))[0] || null;
  if (!closest) return null;
  return {
    x: (finiteNumber(closest.sourceAgent?.x) + finiteNumber(closest.targetAgent?.x)) * 0.5,
    y: (finiteNumber(closest.sourceAgent?.y) + finiteNumber(closest.targetAgent?.y)) * 0.5
  };
};

const resolveEncounter = ({ sim = {}, crowd = {}, squad = {}, target = {}, nowSec = 0, activeKeys = new Set() } = {}) => {
  const ids = [String(squad?.id || ''), String(target?.id || '')].sort();
  const key = ids.join('|');
  const encounters = ensureEncounterMap(sim);
  let encounter = encounters.get(key) || null;
  if (!encounter) {
    const contactCenter = resolveClosestAgentPairCenter({ crowd, squad, target });
    encounter = {
      key,
      squadIds: ids,
      center: contactCenter || {
        x: (finiteNumber(squad?.x) + finiteNumber(target?.x)) * 0.5,
        y: (finiteNumber(squad?.y) + finiteNumber(target?.y)) * 0.5
      },
      createdAt: nowSec
    };
    encounters.set(key, encounter);
  }
  activeKeys.add(key);
  return encounter;
};

const resolvePathForward = (path = [], progress = 0) => {
  const before = resolveMinionPathPointAtProgress(path, Math.max(0, finiteNumber(progress) - 2));
  const after = resolveMinionPathPointAtProgress(path, finiteNumber(progress) + 2);
  const direction = normalizeVec(after.x - before.x, after.y - before.y);
  return direction.len > 0.0001 ? direction : { x: 1, y: 0, len: 1 };
};

const resolveHoldPlan = ({ squad = {}, ai = {}, target = null, path = [], projection = {}, sim = {}, crowd = {}, nowSec = 0, activeKeys = new Set() } = {}) => {
  if (!target || path.length < 2) return null;
  const currentProgress = Math.max(
    finiteNumber(squad?.minionPathProgress),
    finiteNumber(projection?.progress),
    finiteNumber(ai?.minimumHoldProgress)
  );
  let holdProgress = currentProgress;
  let encounter = null;
  if (target.kind === TARGET_KIND_SQUAD) {
    encounter = resolveEncounter({ sim, crowd, squad, target: target.entity, nowSec, activeKeys });
    const centerProjection = projectPointToMinionPath(encounter.center, path);
    holdProgress = distanceBetween(squad, target.entity) <= MINION_MELEE_CENTER_GAP + 0.5
      ? currentProgress
      : Math.max(currentProgress, centerProjection.progress - (MINION_MELEE_CENTER_GAP * 0.5));
  } else {
    const targetProjection = projectPointToMinionPath(target.entity, path);
    const standOff = resolveBuildingRadius(target.entity) + 2.25 + MINION_MELEE_BUILDING_EDGE_GAP;
    holdProgress = Math.max(currentProgress, targetProjection.progress - standOff);
  }
  const holdAnchor = resolveMinionPathPointAtProgress(path, holdProgress);
  const targetPoint = target.kind === TARGET_KIND_SQUAD
    ? (encounter?.center || target.entity)
    : target.entity;
  let axis = normalizeVec(
    finiteNumber(targetPoint?.x) - holdAnchor.x,
    finiteNumber(targetPoint?.y) - holdAnchor.y
  );
  if (axis.len <= 0.0001) axis = resolvePathForward(path, holdProgress);
  return {
    holdAnchor,
    holdProgress,
    axis: { x: axis.x, y: axis.y },
    encounter,
    encounterKey: encounter?.key || ''
  };
};

const resolveAgentSideOffset = (agent = {}, target = null) => {
  const requested = clamp(finiteNumber(agent?.formationSlot?.side), -36, 36);
  if (target?.kind !== TARGET_KIND_BUILDING) return requested;
  const radius = resolveBuildingRadius(target.entity);
  return clamp(requested, -radius * 0.58, radius * 0.58);
};

const setAgentCombatPosition = (agent = {}, ai = {}, x = 0, y = 0) => {
  const requested = { x: finiteNumber(x), y: finiteNumber(y) };
  const floor = agent?._minionForwardFloor && typeof agent._minionForwardFloor === 'object'
    ? agent._minionForwardFloor
    : null;
  const pathForward = normalizeVec(
    finiteNumber(ai?.pathAxisX, finiteNumber(ai?.axisX, 1)),
    finiteNumber(ai?.pathAxisY, finiteNumber(ai?.axisY))
  );
  const resolved = floor && pathForward.len > 0.0001 && (
    ((requested.x - finiteNumber(floor.x)) * pathForward.x)
      + ((requested.y - finiteNumber(floor.y)) * pathForward.y)
  ) < -0.001
    ? { x: finiteNumber(floor.x), y: finiteNumber(floor.y) }
    : requested;
  if (!agent._minionAi || typeof agent._minionAi !== 'object') agent._minionAi = {};
  agent._minionAi.targetRevision = ai.targetRevision;
  agent._minionAi.combatX = resolved.x;
  agent._minionAi.combatY = resolved.y;
  agent._minionAi.positionRevision = Math.max(0, Math.floor(finiteNumber(agent._minionAi.positionRevision))) + 1;
};

const resolveTargetFrontPoint = ({ ai = {}, target = null, sideOffset = 0 } = {}) => {
  const axis = { x: finiteNumber(ai?.axisX, 1), y: finiteNumber(ai?.axisY) };
  const side = { x: -axis.y, y: axis.x };
  if (target?.kind === TARGET_KIND_SQUAD) {
    const center = ai.encounterCenter || target.entity;
    return {
      x: finiteNumber(center?.x) + (axis.x * (MINION_MELEE_CENTER_GAP * 0.5)) + (side.x * sideOffset),
      y: finiteNumber(center?.y) + (axis.y * (MINION_MELEE_CENTER_GAP * 0.5)) + (side.y * sideOffset)
    };
  }
  const buildingRadius = resolveBuildingRadius(target?.entity);
  return {
    x: finiteNumber(target?.entity?.x) - (axis.x * buildingRadius) + (side.x * sideOffset),
    y: finiteNumber(target?.entity?.y) - (axis.y * buildingRadius) + (side.y * sideOffset)
  };
};

const configureBaseCombatPositions = ({ squad = {}, ai = {}, target = null, agents = [] } = {}) => {
  const axis = { x: finiteNumber(ai?.axisX, 1), y: finiteNumber(ai?.axisY) };
  const side = { x: -axis.y, y: axis.x };
  const holdAnchor = ai.holdAnchor || squad;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!isAliveAgent(agent)) return;
    agent._formationDetached = false;
    if (finiteNumber(agent?._minionAi?.targetRevision, -1) === finiteNumber(ai.targetRevision)) return;
    const sideOffset = resolveAgentSideOffset(agent, target);
    if (agent.unitCategory === 'support') {
      setAgentCombatPosition(
        agent,
        ai,
        finiteNumber(holdAnchor?.x) - (axis.x * MINION_SUPPORT_REAR_OFFSET) + (side.x * sideOffset),
        finiteNumber(holdAnchor?.y) - (axis.y * MINION_SUPPORT_REAR_OFFSET) + (side.y * sideOffset)
      );
      return;
    }
    if (!isRangedAgent(agent)) {
      setAgentCombatPosition(
        agent,
        ai,
        finiteNumber(holdAnchor?.x) + (side.x * sideOffset),
        finiteNumber(holdAnchor?.y) + (side.y * sideOffset)
      );
      return;
    }
    const attackRange = resolveMinionWaveAgentAttackRange(agent, squad);
    const targetPoint = resolveTargetFrontPoint({ ai, target, sideOffset });
    const current = { x: finiteNumber(agent?.x), y: finiteNumber(agent?.y) };
    if (distanceBetween(current, targetPoint) <= attackRange.max * 0.98) {
      setAgentCombatPosition(agent, ai, current.x, current.y);
      return;
    }
    const desiredDistance = Math.max(8, attackRange.max * 0.8);
    const requested = {
      x: targetPoint.x - (axis.x * desiredDistance),
      y: targetPoint.y - (axis.y * desiredDistance)
    };
    const forwardDisplacement = ((requested.x - current.x) * axis.x) + ((requested.y - current.y) * axis.y);
    setAgentCombatPosition(
      agent,
      ai,
      forwardDisplacement >= -0.5 ? requested.x : current.x,
      forwardDisplacement >= -0.5 ? requested.y : current.y
    );
  });
};

const resolveAgentPlannedPoint = (agent = {}) => ({
  x: finiteNumber(agent?._minionAi?.combatX, finiteNumber(agent?.x)),
  y: finiteNumber(agent?._minionAi?.combatY, finiteNumber(agent?.y))
});

const resolveAssignmentTargetPoint = (target = {}) => ({
  x: finiteNumber(target?._minionAi?.combatX, finiteNumber(target?.x)),
  y: finiteNumber(target?._minionAi?.combatY, finiteNumber(target?.y))
});

const rankTargetCategory = (agent = {}) => {
  if (agent?.unitCategory === 'melee') return 0;
  if (agent?.unitCategory === 'ranged') return 1;
  return 2;
};

const isCavalryAgent = (agent = {}, squad = {}) => (
  agent?.typeCategory === 'cavalry'
  || squad?.classTag === 'cavalry'
);

const chooseAssignedEnemy = ({ source = {}, targets = [], assignedCounts = new Map() } = {}) => {
  const sourcePoint = resolveAgentPlannedPoint(source);
  return (Array.isArray(targets) ? targets : [])
    .filter(isAliveAgent)
    .slice()
    .sort((left, right) => (
      (assignedCounts.get(String(left.id || '')) || 0) - (assignedCounts.get(String(right.id || '')) || 0)
      || rankTargetCategory(left) - rankTargetCategory(right)
      || distanceBetween(sourcePoint, resolveAssignmentTargetPoint(left))
        - distanceBetween(sourcePoint, resolveAssignmentTargetPoint(right))
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))[0] || null;
};

const repositionForAssignment = ({ agent = {}, squad = {}, ai = {}, targetAgent = null, assignmentChanged = false } = {}) => {
  if (!assignmentChanged || !targetAgent || agent?.unitCategory === 'support') return false;
  const targetPoint = resolveAssignmentTargetPoint(targetAgent);
  const plannedPoint = resolveAgentPlannedPoint(agent);
  const attackRange = resolveMinionWaveAgentAttackRange(agent, squad);
  if (distanceBetween(plannedPoint, targetPoint) <= attackRange.max * 0.98) return false;
  const direction = normalizeVec(targetPoint.x - plannedPoint.x, targetPoint.y - plannedPoint.y);
  if (direction.len <= 0.0001) return false;
  const desiredDistance = isRangedAgent(agent)
    ? Math.max(8, attackRange.max * 0.8)
    : Math.max(2, attackRange.max * 0.9);
  const requested = {
    x: targetPoint.x - (direction.x * desiredDistance),
    y: targetPoint.y - (direction.y * desiredDistance)
  };
  const axis = normalizeVec(
    finiteNumber(ai?.pathAxisX, finiteNumber(ai?.axisX, 1)),
    finiteNumber(ai?.pathAxisY, finiteNumber(ai?.axisY))
  );
  if (axis.len > 0.0001 && (isRangedAgent(agent) || !isCavalryAgent(agent, squad))) {
    const current = { x: finiteNumber(agent?.x), y: finiteNumber(agent?.y) };
    const deltaX = requested.x - current.x;
    const deltaY = requested.y - current.y;
    const forwardTravel = (deltaX * axis.x) + (deltaY * axis.y);
    if (forwardTravel < -0.5) return false;
    if (!isRangedAgent(agent)) {
      const side = { x: -axis.y, y: axis.x };
      const lateralTravel = (deltaX * side.x) + (deltaY * side.y);
      requested.x = current.x + (axis.x * Math.max(0, forwardTravel)) + (side.x * lateralTravel);
      requested.y = current.y + (axis.y * Math.max(0, forwardTravel)) + (side.y * lateralTravel);
    }
  }
  setAgentCombatPosition(agent, ai, requested.x, requested.y);
  return distanceBetween(agent, requested) > MINION_AGENT_ARRIVAL_RADIUS;
};

const assignSquadTargets = ({ squad = {}, ai = {}, target = null, agents = [], targetAgents = [] } = {}) => {
  const fighters = (Array.isArray(agents) ? agents : [])
    .filter(isCombatAgent)
    .sort((left, right) => (
      finiteNumber(left?.slotOrder) - finiteNumber(right?.slotOrder)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ));
  const validTargets = (Array.isArray(targetAgents) ? targetAgents : []).filter(isAliveAgent);
  const validTargetIds = new Set(validTargets.map((agent) => String(agent.id || '')));
  const assignedCounts = new Map();
  fighters.forEach((agent) => {
    const currentId = String(agent?.targetAgentId || '');
    if (!validTargetIds.has(currentId)) return;
    assignedCounts.set(currentId, (assignedCounts.get(currentId) || 0) + 1);
  });
  let needsApproach = false;
  fighters.forEach((agent) => {
    const previousTargetId = String(agent?.targetAgentId || '');
    const retained = validTargetIds.has(previousTargetId)
      ? validTargets.find((candidate) => String(candidate.id || '') === previousTargetId) || null
      : null;
    let assigned = retained;
    if (!assigned) assigned = chooseAssignedEnemy({ source: agent, targets: validTargets, assignedCounts });
    const nextTargetId = String(assigned?.id || '');
    const assignmentChanged = previousTargetId !== nextTargetId;
    agent.targetAgentId = nextTargetId;
    agent.targetBuildingId = '';
    agent._combatTargetSquadId = nextTargetId ? String(target?.entity?.id || '') : '';
    agent._combatTargetLockUntil = Number.POSITIVE_INFINITY;
    if (assigned && !retained) assignedCounts.set(nextTargetId, (assignedCounts.get(nextTargetId) || 0) + 1);
    needsApproach = repositionForAssignment({ agent, squad, ai, targetAgent: assigned, assignmentChanged }) || needsApproach;
  });
  return needsApproach;
};

const assignBuildingTargets = ({ agents = [], building = null } = {}) => {
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!isAliveAgent(agent)) return;
    agent.targetAgentId = '';
    agent._combatTargetSquadId = '';
    agent._combatTargetLockUntil = 0;
    agent.targetBuildingId = agent.unitCategory === 'support' ? '' : String(building?.id || '');
  });
  return false;
};

const assignSupportTargets = ({ agents = [], targetAgents = [] } = {}) => {
  const allies = (Array.isArray(agents) ? agents : []).filter(isCombatAgent);
  const enemies = (Array.isArray(targetAgents) ? targetAgents : []).filter(isAliveAgent);
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!isAliveAgent(agent) || agent.unitCategory !== 'support') return;
    const hostile = String(agent?.unitSubtype || '') === 'intervention';
    const pool = hostile ? enemies : allies;
    const expectedSquadId = hostile
      ? String(pool[0]?.squadId || '')
      : String(agent?.squadId || '');
    const retained = pool.find((candidate) => (
      String(candidate?.id || '') === String(agent?.supportTargetAgentId || '')
    )) || null;
    const sourcePoint = resolveAgentPlannedPoint(agent);
    const selected = retained || pool.slice().sort((left, right) => (
      distanceBetween(sourcePoint, resolveAgentPlannedPoint(left))
        - distanceBetween(sourcePoint, resolveAgentPlannedPoint(right))
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))[0] || null;
    agent.supportTargetAgentId = String(selected?.id || '');
    agent.supportTargetSquadId = selected ? String(selected?.squadId || expectedSquadId) : '';
  });
};

const resolveCombatPositionReadiness = (agents = []) => {
  const alive = (Array.isArray(agents) ? agents : []).filter(isAliveAgent);
  const fighters = alive.filter(isCombatAgent);
  const requiredAgents = fighters.length > 0 ? fighters : alive;
  if (requiredAgents.length <= 0) return { ready: false, readyCount: 0, requiredCount: 0 };
  const readyCount = requiredAgents.filter((agent) => (
    !agent?._minionAi
    || distanceBetween(agent, resolveAgentPlannedPoint(agent)) <= Math.max(
      MINION_COMBAT_READY_RADIUS,
      finiteNumber(agent?.radius, 2.25) + 0.4
    )
  )).length;
  const requiredCount = Math.max(1, Math.ceil(requiredAgents.length * MINION_COMBAT_READY_RATIO));
  return {
    ready: readyCount >= requiredCount,
    readyCount,
    requiredCount
  };
};

const assignRequestedWaypoints = (squad = {}, requested = [], assignWaypoints = null) => {
  const normalized = (Array.isArray(requested) ? requested : []).map((point) => ({
    x: finiteNumber(point?.x),
    y: finiteNumber(point?.y)
  }));
  if (typeof assignWaypoints === 'function') {
    assignWaypoints(squad, normalized);
  } else {
    squad.waypoints = normalized;
  }
};

const applyMarchPlan = ({ squad = {}, ai = {}, pathState = {}, nowSec = 0, assignWaypoints = null } = {}) => {
  const { path = [], pathIndex = 1 } = pathState;
  if (ai.state === MINION_WAVE_AI_STATE.RESUME && nowSec >= finiteNumber(ai.resumeUntil)) {
    enterState(squad, ai, MINION_WAVE_AI_STATE.MARCH, nowSec);
  }
  syncSquadTargetFields(squad, ai);
  if (path.length < 2) {
    assignRequestedWaypoints(squad, [], assignWaypoints);
    squad.action = '兵线待命';
    return;
  }
  const finalPoint = path[path.length - 1] || null;
  if (
    pathIndex >= path.length - 1
    && finalPoint
    && distanceBetween(squad, finalPoint) <= MINION_ANCHOR_ARRIVAL_RADIUS
  ) {
    assignRequestedWaypoints(squad, [], assignWaypoints);
    squad.action = '兵线待命';
    return;
  }
  assignRequestedWaypoints(squad, resolvePathWaypoints({
    path,
    pathIndex,
    targetPoint: finalPoint
  }), assignWaypoints);
  squad.action = ai.state === MINION_WAVE_AI_STATE.RESUME ? '兵线重整' : '兵线推进';
};

const applyCombatPlan = ({ squad = {}, ai = {}, target = null, agents = [], pathState = {}, nowSec = 0, assignWaypoints = null } = {}) => {
  const anchorReady = !!ai.holdAnchor && distanceBetween(squad, ai.holdAnchor) <= MINION_ANCHOR_ARRIVAL_RADIUS;
  const combatReadiness = resolveCombatPositionReadiness(agents);
  if (
    ai.state === MINION_WAVE_AI_STATE.ATTACK_HOLD
    && !anchorReady
  ) {
    enterState(squad, ai, MINION_WAVE_AI_STATE.APPROACH, nowSec);
  }
  if (ai.needsApproach && ai.state !== MINION_WAVE_AI_STATE.ATTACK_HOLD) {
    enterState(squad, ai, MINION_WAVE_AI_STATE.APPROACH, nowSec);
  }
  if (
    ai.state === MINION_WAVE_AI_STATE.APPROACH
    && anchorReady
    && combatReadiness.ready
    && !ai.needsApproach
  ) {
    enterState(squad, ai, MINION_WAVE_AI_STATE.ATTACK_HOLD, nowSec);
  }
  if (ai.state === MINION_WAVE_AI_STATE.ATTACK_HOLD) {
    assignRequestedWaypoints(squad, [], assignWaypoints);
    squad.action = target?.kind === TARGET_KIND_BUILDING
      ? (target?.objective?.type === 'tower' ? '攻击防御塔' : '攻击兵营')
      : '兵线交战';
    return;
  }
  if (anchorReady) {
    assignRequestedWaypoints(squad, [], assignWaypoints);
  } else {
    assignRequestedWaypoints(squad, resolvePathWaypoints({
      path: pathState.path,
      pathIndex: pathState.pathIndex,
      targetProgress: ai.holdProgress,
      targetPoint: ai.holdAnchor
    }), assignWaypoints);
  }
  squad.action = '兵线接敌';
};

export const updateMinionWaveAiFrame = ({
  sim = {},
  crowd = {},
  nowSec = 0,
  isPointWithinLane = null,
  assignWaypoints = null
} = {}) => {
  const minionSquads = (Array.isArray(sim?.squads) ? sim.squads : []).filter((squad) => (
    squad?.isMinionWaveUnit === true && finiteNumber(squad?.remain) > 0
  ));
  const pathStateById = new Map();
  const targetById = new Map();
  const activeEncounterKeys = new Set();

  minionSquads.forEach((squad) => {
    const agents = crowd?.agentsBySquad?.get?.(squad.id) || [];
    const ai = ensureMinionAi(squad, nowSec);
    const pathState = syncPathCursor(squad);
    const pathForward = resolvePathForward(
      pathState.path,
      finiteNumber(pathState?.projection?.progress)
    );
    ai.pathAxisX = pathForward.x;
    ai.pathAxisY = pathForward.y;
    pathStateById.set(squad.id, pathState);
    const currentTarget = resolveCommittedTarget({
      squad,
      ai,
      sim,
      path: pathState.path,
      isPointWithinLane
    });
    const bestTarget = resolveBestTarget({
      squad,
      sim,
      crowd,
      path: pathState.path,
      currentProgress: finiteNumber(pathState?.projection?.progress),
      isPointWithinLane
    });
    let selected = currentTarget;
    if (!selected) {
      const resumeLocked = ai.state === MINION_WAVE_AI_STATE.RESUME
        && nowSec < finiteNumber(ai.resumeUntil)
        && finiteNumber(bestTarget?.priority, Infinity) > TARGET_PRIORITY_RETALIATION;
      if (!resumeLocked) selected = bestTarget;
    } else if (
      bestTarget
      && String(bestTarget.id || '') !== String(selected.id || '')
      && finiteNumber(bestTarget.priority, Infinity) < finiteNumber(ai.targetPriority, Infinity)
    ) {
      selected = bestTarget;
    }
    if (selected) {
      commitTarget({ squad, ai, target: selected, agents, pathState, nowSec });
      targetById.set(squad.id, selected);
    } else if (currentTarget || ai.targetId) {
      releaseTarget({ squad, ai, agents, pathState, nowSec });
    }
  });

  minionSquads.forEach((squad) => {
    const ai = ensureMinionAi(squad, nowSec);
    const target = targetById.get(squad.id) || null;
    if (!target) return;
    const pathState = pathStateById.get(squad.id) || syncPathCursor(squad);
    if (!ai.holdAnchor) {
      const plan = resolveHoldPlan({
        squad,
        ai,
        target,
        path: pathState.path,
        projection: pathState.projection,
        sim,
        crowd,
        nowSec,
        activeKeys: activeEncounterKeys
      });
      if (plan) {
        ai.holdAnchor = plan.holdAnchor;
        ai.holdProgress = plan.holdProgress;
        ai.minimumHoldProgress = plan.holdProgress;
        ai.axisX = plan.axis.x;
        ai.axisY = plan.axis.y;
        ai.encounterKey = plan.encounterKey;
        ai.encounterCenter = plan.encounter?.center ? { ...plan.encounter.center } : null;
      }
    } else if (ai.encounterKey) {
      activeEncounterKeys.add(ai.encounterKey);
    }
    configureBaseCombatPositions({
      squad,
      ai,
      target,
      agents: crowd?.agentsBySquad?.get?.(squad.id) || []
    });
  });

  minionSquads.forEach((squad) => {
    const ai = ensureMinionAi(squad, nowSec);
    const target = targetById.get(squad.id) || null;
    if (!target) return;
    const agents = crowd?.agentsBySquad?.get?.(squad.id) || [];
    const targetAgents = target.kind === TARGET_KIND_SQUAD
      ? (crowd?.agentsBySquad?.get?.(target.entity.id) || [])
      : [];
    ai.needsApproach = target.kind === TARGET_KIND_SQUAD
      ? assignSquadTargets({ squad, ai, target, agents, targetAgents })
      : assignBuildingTargets({ agents, building: target.entity });
    assignSupportTargets({ agents, targetAgents });
    syncSquadTargetFields(squad, ai);
  });

  minionSquads.forEach((squad) => {
    const ai = ensureMinionAi(squad, nowSec);
    const target = targetById.get(squad.id) || null;
    const agents = crowd?.agentsBySquad?.get?.(squad.id) || [];
    const pathState = pathStateById.get(squad.id) || syncPathCursor(squad);
    if (!target) {
      applyMarchPlan({ squad, ai, pathState, nowSec, assignWaypoints });
      return;
    }
    applyCombatPlan({ squad, ai, target, agents, pathState, nowSec, assignWaypoints });
  });

  const encounters = ensureEncounterMap(sim);
  [...encounters.keys()].forEach((key) => {
    if (!activeEncounterKeys.has(key)) encounters.delete(key);
  });
};
