import { resolveTrainingMapLane } from '../shared/trainingMap';
import { buildObstacleSpatialIndex, raycastObstacles } from './crowd/crowdPhysics';
import { isRangedSquad, resolveSquadAttackRange } from './crowd/attackRange';
import { isHostileTeam, TEAM_NEUTRAL } from './crowd/teamRelations';
import { filterBlockingObstacles } from './items/itemObstacleUtils';

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
  RETURN_TO_CAMP: 'ReturnToCamp',
  DEAD: 'Dead',
  DISABLED: 'Disabled'
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
  [TRAINING_MAP_AI_STATE.RETURN_TO_CAMP]: 16,
  [TRAINING_MAP_AI_STATE.DEAD]: 0,
  [TRAINING_MAP_AI_STATE.DISABLED]: 0
});

const MAX_SQUAD_EVENT_COUNT = 16;
const MAX_SIM_EVENT_COUNT = 160;
const AI_DECISION_INTERVAL_SECONDS = 0.18;

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
  const fallback = String(squad?.spawnLaneId || '').trim();
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
  if (!squad || !candidate || !isHostileTeam(squad?.team, candidate?.team)) return null;
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
  if (!squad || squad?.team === TEAM_NEUTRAL) return null;
  const rows = Array.isArray(candidates) ? candidates : (Array.isArray(sim?.squads) ? sim.squads : []);
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
  if (!squad || squad?.team === TEAM_NEUTRAL) return null;
  const nowSec = Math.max(0, finiteNumber(sim?.timeElapsed));
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
    ) {
      return cached.selection;
    }
    if (!cached.selection) return null;
  }
  const context = resolveTrainingAiContext(sim);
  const config = resolveTrainingMapAiTargetScoring(sim);
  const sourceLaneId = resolveSquadLaneId(squad, sim);
  const attackRange = resolveSquadAttackRange(squad);
  const lockedGoalId = String(squad?.autoNavigation?.goalId || '');
  let best = null;
  (Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : []).forEach((objective) => {
    if (!objective || objective.destroyed || objective.targetable === false) return;
    if (!isHostileTeam(squad?.team, objective?.team)) return;
    const building = resolveObjectiveBuilding(sim, objective, context);
    if (!building || building.destroyed) return;
    const targetRadius = Math.max(4, Math.max(finiteNumber(building?.width), finiteNumber(building?.depth)) * 0.5);
    const distance = Math.hypot(
      finiteNumber(building?.x) - finiteNumber(squad?.x),
      finiteNumber(building?.y) - finiteNumber(squad?.y)
    );
    const targetLaneId = String(objective?.laneId || '');
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

const resolveNeutralCampState = (squad = {}, sim = {}) => {
  if (squad?.team !== TEAM_NEUTRAL) return '';
  const camp = (Array.isArray(sim?.trainingNeutralCamps) ? sim.trainingNeutralCamps : []).find((entry) => (
    String(entry?.activeSquadId || entry?.squadId || '') === String(squad?.id || '')
  ));
  return String(camp?.state || '');
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
  const runtime = ensureTrainingMapAiRuntime(squad, sim, nowSec);
  if (!runtime) return null;
  const safeNow = Math.max(0, finiteNumber(nowSec));
  const target = resolveSquadTarget(squad, sim, selection);
  const targetId = String(target?.id || selection?.targetId || '');
  const targetScore = selection || null;
  let nextState = TRAINING_MAP_AI_STATE.ADVANCE;
  let nextReason = reason || 'advance';

  if (finiteNumber(squad?.remain) <= 0) {
    nextState = TRAINING_MAP_AI_STATE.DEAD;
    nextReason = 'no-remaining-units';
  } else if (squad?.disabled === true || squad?.behavior === 'disabled') {
    nextState = TRAINING_MAP_AI_STATE.DISABLED;
    nextReason = 'disabled';
  } else if (squad?.team === TEAM_NEUTRAL) {
    const campState = resolveNeutralCampState(squad, sim);
    if (campState === 'disabled') {
      nextState = TRAINING_MAP_AI_STATE.DISABLED;
      nextReason = 'camp-disabled';
    } else if (campState === 'leashing' || squad?.action === '回位') {
      nextState = TRAINING_MAP_AI_STATE.RETURN_TO_CAMP;
      nextReason = 'camp-leash';
    } else if (target) {
      const attackRange = resolveSquadAttackRange(squad);
      const distance = Math.hypot(finiteNumber(target?.x) - finiteNumber(squad?.x), finiteNumber(target?.y) - finiteNumber(squad?.y));
      nextState = distance <= attackRange.max + Math.max(0, finiteNumber(target?.radius, 10))
        ? TRAINING_MAP_AI_STATE.ATTACK
        : TRAINING_MAP_AI_STATE.CHASE;
      nextReason = nextState === TRAINING_MAP_AI_STATE.ATTACK ? 'camp-target-in-range' : 'camp-target-chase';
    } else if (campState === 'waiting' || campState === 'spawning') {
      nextState = TRAINING_MAP_AI_STATE.SPAWN;
      nextReason = 'camp-spawn';
    } else {
      nextState = TRAINING_MAP_AI_STATE.FORMING;
      nextReason = 'camp-idle';
    }
  } else if (squad?.behavior === 'retreat') {
    nextState = TRAINING_MAP_AI_STATE.RETREAT;
    nextReason = 'retreat-order';
  } else if (squad?.activeSkill) {
    nextState = TRAINING_MAP_AI_STATE.USE_ABILITY;
    nextReason = 'active-skill';
  } else if (runtime?.state === TRAINING_MAP_AI_STATE.SPAWN) {
    nextState = TRAINING_MAP_AI_STATE.FORMING;
    nextReason = 'spawn-ready';
  } else if (target) {
    const attackRange = resolveSquadAttackRange(squad);
    const distance = Math.hypot(finiteNumber(target?.x) - finiteNumber(squad?.x), finiteNumber(target?.y) - finiteNumber(squad?.y));
    const desiredRange = isRangedSquad(squad)
      ? Math.max(attackRange.min, attackRange.max * 0.72)
      : Math.max(attackRange.max * 0.82, 4.5);
    if (distance <= desiredRange + Math.max(0, finiteNumber(target?.radius, 10))) {
      nextState = TRAINING_MAP_AI_STATE.ATTACK;
      nextReason = 'target-in-range';
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
  } else if (squad?.behavior === 'idle' || squad?.behavior === 'standby') {
    nextState = TRAINING_MAP_AI_STATE.FORMING;
    nextReason = 'idle';
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
