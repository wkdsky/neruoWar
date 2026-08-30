import {
  clamp,
  normalizeVec,
  buildSpatialHash,
  buildObstacleSpatialIndex,
  estimateLocalFlowWidth,
  queryObstacleCandidates,
  querySpatialNearby,
  pushOutOfRect,
  raycastObstacles
} from './crowdPhysics';
import {
  createCombatEffectsPool,
  acquireProjectile,
  acquireHitEffect,
  stepEffectPool
} from '../effects/CombatEffects';
import { applyDamageToAgent, pickRangedEnemyAgent, updateCrowdCombat } from './crowdCombat';
import { syncMeleeEngagement } from './engagement';
import itemInteractionSystem from '../items/ItemInteractionSystem';
import {
  filterBlockingObstacles,
  filterVisionBlockingObstacles
} from '../items/itemObstacleUtils';
import { updateTrainingObjectives } from '../objectives/TrainingObjectiveSystem';
import { updateTrainingNeutralCamps } from '../objectives/TrainingNeutralCampSystem';
import { updateTrainingSquadRespawns } from '../respawn/TrainingSquadRespawnSystem';
import {
  planTrainingMapLocalDetour,
  resolveTrainingMapLegalPosition
} from '../navigation/TrainingMapNavigator';
import { isTrainingMapTerrainSegmentTraversable } from '../../shared/trainingMap';
import { snapTrainingDirectionOffset } from '../../shared/trainingDirectionArc';
import {
  isPointInsideSkillPaintArea,
  normalizeSkillPaintArea
} from '../../shared/skillPaintArea';
import { resolveSquadSpatialAnchor } from '../../shared/squadSpatialAnchor';
import {
  isRangedAgent,
  isRangedSquad,
  resolveAgentAttackRange,
  resolveSquadAttackRange,
  resolveUnitTypeAttackRange
} from './attackRange';
import {
  completeTargetOnlyAttackOrder,
  isSquadCombatEnabled,
  isTargetOnlyAttackOrder
} from './combatPolicy';
import {
  clearForeignTrainingNonCardSquadAiState,
  MINION_WAVE_AI_STATE,
  projectPointToMinionPath,
  restoreMinionSquadHoldAnchor,
  resolveMinionPathPointAtProgress as resolveMinionSquadPathPointAtProgress,
  resolveMinionSquadAgentCombatDirective,
  resolveNeutralCampCombatDirective,
  prepareTrainingNonCardSquadAiFrame,
  resetTrainingNonCardSquadAiRuntime,
  updateTrainingMinionSquadAiFrame
} from './TrainingNonCardSquadAi';
import {
  clearTrainingCardAiState,
  completeTrainingCardSquadAiFrame,
  isTrainingMapAiTargetDeferred,
  prepareTrainingCardSquadAiFrame,
  recordTrainingMapAiEvent,
  resolveTrainingCardAgentTacticalIntent,
  resolveTrainingCardAnchorSteering,
  resetTrainingCardSquadAiRuntime,
  selectTrainingMapAiPlan,
  selectTrainingMapAiTarget,
  syncTrainingMapAiState,
  TRAINING_MAP_AI_PLAN_KIND
} from './TrainingCardSquadAi';
import {
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  TEAM_NEUTRAL,
  canAcquireSquadTarget,
  isHostileTeam,
  resolveDefaultHostileTeam
} from './teamRelations';
import {
  isTrainingCardAiSquad,
  isTrainingCardSquad,
  isTrainingMinionSquad,
  isTrainingNeutralSquad,
  resolveTrainingSquadKind,
  TRAINING_SQUAD_KIND
} from './TrainingSquadKind';
import {
  CARD_LOCOMOTION_STATE,
  isTrainingCardPassageState,
  resolveTrainingCardPassageFlowSteering
} from './TrainingCardPassage';

const SKILL_CATEGORY_MELEE = 'melee';
const SKILL_CATEGORY_RANGED = 'ranged';
const SKILL_CATEGORY_SUPPORT = 'support';
const ORDER_IDLE = 'IDLE';
const ORDER_MOVE = 'MOVE';
const ORDER_ATTACK_MOVE = 'ATTACK_MOVE';
const ORDER_CHARGE = 'CHARGE';
const SPEED_MODE_B = 'B_HARMONIC';
const SPEED_MODE_C = 'C_PER_TYPE';
const SPEED_POLICY_MARCH = 'MARCH';
const SPEED_POLICY_RETREAT = 'RETREAT';
const SPEED_POLICY_REFORM = 'REFORM';
const FORMATION_SPACING_LOOSE = 'loose';
const FORMATION_SPACING_STANDARD = 'standard';
const FORMATION_SPACING_COMPACT = 'compact';
const STAMINA_MAX = 100;
const STAMINA_MOVE_THRESHOLD = 20;
const STAMINA_RESUME_THRESHOLD = 44;
const STAMINA_MOVE_COST = 8;
const STAMINA_RECOVER = 28;
const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const MAX_AGENTS_PER_SQUAD = 4096;
const DEFAULT_MAX_AGENT_WEIGHT = 50;
const DEFAULT_DAMAGE_EXPONENT = 0.75;
const CAVALRY_RUSH_MAX_DISTANCE = 220;
const CAVALRY_RUSH_MIN_DISTANCE = 18;
const CAVALRY_RUSH_SPEED = 172;
const CAVALRY_RUSH_IMPACT_RADIUS = 6.2;
const CROWD_SAME_TEAM_SEP_STRENGTH = 0.86;
const CROWD_ENEMY_SEP_STRENGTH = 0.14;
const CROWD_ENEMY_MELEE_SEP_STRENGTH = 0.02;
const CROWD_HARD_CONTACT_STRENGTH = 1.18;
const CROWD_ENEMY_TARGET_GAP = AGENT_RADIUS * 1.12;
const CROWD_HARD_CONTACT_GAP = AGENT_RADIUS * 0.58;
const AGENT_IDLE_DEADZONE = 0.72;
const AGENT_IDLE_RELEASE_RADIUS = 1.72;
const AGENT_SLOT_ARRIVAL_RADIUS = 10.8;
const AGENT_MIN_FORMATION_SEPARATION_GAP = AGENT_RADIUS * 1.55;
const STATIONARY_SEPARATION_SCALE = 0.2;
const STATIONARY_FLAG_SEPARATION_SCALE = 0.08;
const AGENT_MAX_ACCEL = 220;
const AGENT_REFORM_ACCEL = 260;
const AGENT_RETREAT_ACCEL = 280;
const AGENT_AVOID_PROBE = 10;
const FLAG_BACK_OFFSET = 0.72;
const AGENT_COMBAT_TARGET_TIE_DISTANCE = 8;
const AGENT_MELEE_ACQUISITION_RADIUS = 72;
const AGENT_COMBAT_FORMATION_STEER = 0.42;
const AGENT_COMBAT_HOLD_FORMATION_STEER = 0.72;
const AGENT_COMBAT_SEPARATION_STEER = 0.72;
const AGENT_COMBAT_SOFT_TETHER_MARGIN = 18;
const AGENT_COMBAT_HARD_TETHER_MARGIN = 36;
const AGENT_COMBAT_TARGET_LOCK_SEC = 0.9;
const MINION_ROAD_SEARCH_MARGIN = 24;
const SUPPORT_ACQUISITION_RADIUS = 132;
const SUPPORT_CAST_COOLDOWN_SEC = 4.8;

const resolveCrowdObstacleSignature = (obstacles = []) => (
  (Array.isArray(obstacles) ? obstacles : []).map((obstacle, index) => [
    String(obstacle?.id || obstacle?.objectId || index),
    obstacle?.destroyed ? 1 : 0,
    obstacle?.blocksMovement === false ? 0 : 1,
    Number(obstacle?.x) || 0,
    Number(obstacle?.y) || 0,
    Number(obstacle?.width) || 0,
    Number(obstacle?.depth) || 0,
    Number(obstacle?.rotation) || 0,
    Number(obstacle?.colliderRevision) || 0,
    String(obstacle?.collider?.kind || ''),
    Array.isArray(obstacle?.collider?.parts) ? obstacle.collider.parts.length : 0,
    Array.isArray(obstacle?.collider?.polygon?.points) ? obstacle.collider.polygon.points.length : 0
  ].join(':')).join('|')
);

const resolveCrowdBlockingWalls = (crowd, obstacles = []) => {
  const signature = resolveCrowdObstacleSignature(obstacles);
  if (crowd?._blockingWalls && crowd._blockingWallsSignature === signature) {
    return crowd._blockingWalls;
  }
  const walls = filterBlockingObstacles(obstacles);
  walls._obstacleSpatialIndex = buildObstacleSpatialIndex(walls);
  if (crowd && typeof crowd === 'object') {
    crowd._blockingWalls = walls;
    crowd._blockingWallsSignature = signature;
  }
  return walls;
};
const FORMATION_SPACING_SCALE = Object.freeze({
  [FORMATION_SPACING_LOOSE]: 1.28,
  [FORMATION_SPACING_STANDARD]: 1,
  [FORMATION_SPACING_COMPACT]: 0.76
});
const FORMATION_STRUCTURAL_GAP_MULTIPLIER = 1.5;
const LEADER_MAX_TURN_RATE = Math.PI * 1.9;
const LEADER_MAX_ACCEL = 120;
const LEADER_MAX_DECEL = 170;
const REFERENCE_LEADER_SPEED_MULTIPLIER = 18;
const LEADER_ARRIVAL_RADIUS = 5.4;
const LEADER_SLOW_RADIUS = 38;
const LEADER_WAYPOINT_SLOW_RADIUS = 18;
const LEADER_WAYPOINT_MIN_SPEED_RATIO = 0.72;
const LEADER_FINAL_MIN_SPEED_RATIO = 0.08;
const OBSTACLE_AVOID_PROBE = 20;
const NAVIGATION_STUCK_TIMEOUT_SEC = 0.72;
const NAVIGATION_MIN_PROGRESS = 0.18;
const NAVIGATION_MIN_MOVEMENT = 0.2;
const NAVIGATION_MAX_FAILURES_BEFORE_WAIT = 3;
const DEFAULT_AI_NAVIGATION_PLANS_PER_STEP = 1;
const DEFAULT_FORMATION_RECOVERY_PLANS_PER_STEP = 4;
const DEFAULT_AI_DECISIONS_PER_STEP = 1;
const AVOID_SIDE_LOCK_SEC = 0.32;
const NARROW_PASSAGE_SCAN_INTERVAL_SEC = 0.24;
const NARROW_PASSAGE_RELEASE_OPEN_SEC = 0.65;
const AVOID_KEY_GRID = 6;
const AGENT_SETTLE_RADIUS = 2.4;
const AGENT_SETTLE_DEADZONE = 1.08;
const AGENT_SETTLE_SPEED = 16;
const AGENT_FORMATION_LOCK_RELATIVE_SPEED = 2.4;
const SQUAD_COMBAT_LOCK_RELEASE_SEC = 1.35;
const SQUAD_COMBAT_EXIT_GAP = 32;
const FORMATION_MARCH_TURN_RATE = Math.PI * 0.5;
const NEUTRAL_AGENT_TURN_RATE = Math.PI * 3.2;
const NEUTRAL_REPRESENTATIVE_FORMATION_SPACING = 20;
const NEUTRAL_REPRESENTATIVE_FORMATION_DEPTH_SCALE = 0.92;
const FORMATION_SLOT_REJOIN_HZ = 5.2;
const FORMATION_SLOT_LOCK_EPSILON = 0.12;
const FORMATION_SLOT_RELEASE_DISTANCE = 2;
const AGENT_FORMATION_CATCHUP_SPEED_MUL = 20 / REFERENCE_LEADER_SPEED_MULTIPLIER;
const SWEPT_COLLISION_MARGIN = 0.08;
const LEADER_COLLISION_RADIUS = AGENT_RADIUS + 0.5;
const MINION_COHESION_STOP_DELAY_SEC = 0.9;
const MINION_COHESION_RECOVERY_STOP_DELAY_SEC = 1.6;
const MINION_COHESION_CATASTROPHIC_RATIO = 1.55;
const MINION_COHESION_MIN_SPEED_SCALE = 0.24;
const MINION_COHESION_RELEASE_RATIO = 1.04;
const MINION_RECOVERY_STUCK_DELAY_SEC = 0.28;
const MINION_RECOVERY_REPLAN_INTERVAL_SEC = 0.42;
const MINION_RECOVERY_TARGET_DRIFT = 36;
const MINION_RECOVERY_WAYPOINT_RADIUS = 4.2;
const MINION_RECOVERY_MAX_SPEED_MUL = 1.32;
const FORMATION_COHESION_STOP_DELAY_SEC = 0.85;
const FORMATION_COHESION_RECOVERY_STOP_DELAY_SEC = 1.35;
const FORMATION_COHESION_CATASTROPHIC_RATIO = 1.72;
const FORMATION_COHESION_MIN_SPEED_SCALE = 0.3;
const FORMATION_ARRIVAL_STABLE_SEC = 0.28;
const FORMATION_RECOVERY_STUCK_DELAY_SEC = 0.48;
const FORMATION_RECOVERY_REPLAN_INTERVAL_SEC = 0.55;
const FORMATION_RECOVERY_TARGET_DRIFT = 36;
const FORMATION_RECOVERY_WAYPOINT_RADIUS = 4.2;
const FORMATION_RECOVERY_MAX_SPEED_MUL = 1.42;
const GROUND_SKILL_CONFIG = {
  archer: {
    radius: 72,
    waves: 4,
    intervalSec: 0.26,
    durationSec: 1.22,
    shotsPerWave: 12,
    cooldownSec: 8.6,
    impactRadius: 2.8,
    blastRadius: 0,
    blastFalloff: 0,
    wallDamageMul: 1,
    gravity: 70,
    speedHint: 226,
    damageMul: 2.05
  },
  artillery: {
    radius: 126,
    waves: 3,
    intervalSec: 0.46,
    durationSec: 1.65,
    shotsPerWave: 6,
    cooldownSec: 13.5,
    impactRadius: 4.8,
    blastRadius: 13.5,
    blastFalloff: 0.82,
    wallDamageMul: 1.85,
    gravity: 95,
    speedHint: 170,
    damageMul: 2.75
  }
};
const SKILL_COOLDOWN_BY_CLASS = {
  infantry: 2.1,
  cavalry: 2.8,
  archer: 8.6,
  artillery: 13.5
};
const AI_SKILL_TARGET_RANGE = Object.freeze({
  infantry: 82,
  cavalry: 155,
  archer: 148,
  artillery: 182
});
const DEFAULT_STEERING_WEIGHTS = {
  slot: 1,
  separation: 1,
  avoidance: 1,
  anchor: 1,
  pressure: 1,
  leaderAvoidance: 1,
  turnHz: 8.2,
  maxTurnRate: LEADER_MAX_TURN_RATE
};

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const resolveTrainingMapMovementScale = (sim = {}) => {
  const configuredMultiplier = Number(sim?.trainingMap?.movementCalibration?.leaderSpeedMultiplier);
  if (!Number.isFinite(configuredMultiplier) || configuredMultiplier <= 0) return 1;
  return Math.min(4, Math.max(0.5, configuredMultiplier / REFERENCE_LEADER_SPEED_MULTIPLIER));
};

const resolveTrainingNavigationAgentRadius = (squad = {}, sim = {}) => {
  const configuredRadius = Number(sim?.trainingMap?.navigation?.agentRadius);
  const requestedRadius = Number(squad?.navigationAgentRadius);
  if (Number.isFinite(requestedRadius) && requestedRadius > 0) return clamp(requestedRadius, 1, 8);
  // CARD routes are a route for one soldier, not a swept disk the size of the
  // whole card.  The formation-scale route is attempted separately below and
  // may deliberately fall back to this radius to enter a viable passage.
  if (isTrainingCardSquad(squad)) {
    return Number.isFinite(configuredRadius) && configuredRadius > 0
      ? clamp(configuredRadius, 1, 8)
      : AGENT_RADIUS;
  }
  if (isTrainingMinionSquad(squad)) {
    const slotSideExtent = (Array.isArray(squad?.deploySlots) ? squad.deploySlots : []).reduce((maximum, slot) => (
      Math.max(maximum, Math.abs(Number(slot?.side) || 0))
    ), 0);
    const configuredAgentRadius = Number.isFinite(configuredRadius) && configuredRadius > 0
      ? configuredRadius
      : AGENT_RADIUS;
    if (slotSideExtent > 0) {
      return clamp(slotSideExtent + configuredAgentRadius + 0.8, 1, 36);
    }
  }
  if (Number.isFinite(configuredRadius) && configuredRadius > 0) return clamp(configuredRadius, 1, 8);
  return Math.max(4, Number(squad?.radius) || 10);
};

const resolveTrainingFormationNavigationRadius = (squad = {}, sim = {}) => {
  const agentRadius = resolveTrainingNavigationAgentRadius(squad, sim);
  if (!isTrainingCardSquad(squad)) return agentRadius;
  const requested = Number(squad?.formationNavigationRadius);
  if (Number.isFinite(requested) && requested > 0) {
    return clamp(Math.max(agentRadius, requested), agentRadius, 42);
  }
  const configured = Number(sim?.trainingMap?.navigation?.formationRouteRadius);
  if (Number.isFinite(configured) && configured > 0) {
    return clamp(Math.max(agentRadius, configured), agentRadius, 42);
  }
  const spacing = Math.max((AGENT_RADIUS * 2) + AGENT_GAP, Number(squad?.formationRect?.spacing) || 0);
  const visualRadius = Math.max(0, Number(squad?.radius) || 0);
  return clamp(
    Math.max(agentRadius * 2.2, spacing * 1.45, Math.min(visualRadius * 0.22, spacing * 5.5)),
    agentRadius,
    36
  );
};

const resolveTrainingNavigationPathClearance = (sim = {}, { passage = false } = {}) => {
  const navigation = sim?.trainingMap?.navigation || {};
  if (passage) {
    const passageNavigation = navigation?.passage && typeof navigation.passage === 'object'
      ? navigation.passage
      : {};
    const configuredPassage = Number(
      passageNavigation?.pathClearance
      ?? navigation?.passagePathClearance
    );
    if (Number.isFinite(configuredPassage)) return clamp(configuredPassage, 0, 8);
    const configuredPath = Number(navigation?.pathClearance);
    if (Number.isFinite(configuredPath)) return clamp(Math.min(configuredPath, 2.5), 0, 8);
    return 0.75;
  }
  const configuredClearance = Number(navigation?.pathClearance);
  if (Number.isFinite(configuredClearance)) return clamp(configuredClearance, 0, 48);
  return clamp(Number(navigation?.wallClearance) || 18, 0, 48);
};

const isTrainingMovementSegmentTraversable = ({
  sim = null,
  start = {},
  target = {},
  walls = [],
  radius = AGENT_RADIUS
} = {}) => {
  const navigator = sim?.trainingNavigator;
  const clearance = Math.max(0.5, Number(radius) || AGENT_RADIUS);
  if (navigator?.isSegmentTraversable) {
    return navigator.isSegmentTraversable(start, target, {
      obstacles: walls,
      radius: clearance
    });
  }
  // Some focused simulations intentionally omit the navigator.  Movement
  // commits must still obey the same topology rather than silently restoring
  // the old "formation may jump a cliff" fast path.
  if (raycastObstacles(start, target, walls, clearance)) return false;
  return isTrainingMapTerrainSegmentTraversable(sim?.trainingMap, start, target, {
    field: sim?.field,
    rampTolerance: clamp(clearance * 0.2, 0.5, 2.4)
  });
};

const resolveTrainingLegalMovementStep = ({
  sim = null,
  start = {},
  target = {},
  walls = [],
  radius = AGENT_RADIUS
} = {}) => {
  const source = { x: Number(start?.x) || 0, y: Number(start?.y) || 0 };
  const requested = { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
  if (isTrainingMovementSegmentTraversable({ sim, start: source, target: requested, walls, radius })) {
    return { ...requested, legal: true };
  }
  const navigator = sim?.trainingNavigator;
  const resolved = navigator?.resolveLegalPosition
    ? navigator.resolveLegalPosition(source, requested, {
      obstacles: walls,
      radius: Math.max(0.5, Number(radius) || AGENT_RADIUS)
    })
    : resolveTrainingMapLegalPosition({
      field: sim?.field,
      mapConfig: sim?.trainingMap,
      start: source,
      target: requested,
      obstacles: walls,
      radius: Math.max(0.5, Number(radius) || AGENT_RADIUS)
    });
  const x = Number(resolved?.x) || source.x;
  const y = Number(resolved?.y) || source.y;
  return {
    x,
    y,
    legal: Math.hypot(x - requested.x, y - requested.y) <= 0.05
  };
};

const resolveTrainingNavigationPlanBudget = (sim = {}) => clamp(
  Math.floor(Number(sim?.trainingMap?.navigation?.aiNavigationPlansPerStep) || DEFAULT_AI_NAVIGATION_PLANS_PER_STEP),
  1,
  8
);

const resolveFormationRecoveryPlanBudget = (sim = {}) => clamp(
  Math.floor(
    Number(sim?.trainingMap?.navigation?.formationRecoveryPlansPerStep)
      || Number(sim?.trainingMap?.navigation?.minionRecoveryPlansPerStep)
      || DEFAULT_FORMATION_RECOVERY_PLANS_PER_STEP
  ),
  1,
  12
);

const resolveTrainingAiNavigationSearchNodes = (squad = {}, sim = {}) => {
  if (squad?.behavior !== 'auto' && squad?.controlMode !== 'AI') return 0;
  const configured = Math.floor(Number(sim?.trainingMap?.navigation?.aiNavigationSearchNodes));
  if (Number.isFinite(configured) && configured > 0) return clamp(configured, 1, 256);
  const fieldWidth = Number(sim?.field?.width) || 0;
  const fieldHeight = Number(sim?.field?.height) || 0;
  return fieldWidth >= 4000 && fieldHeight >= 3000 ? 128 : 0;
};

const consumeTrainingNavigationPlanBudget = (sim = {}) => {
  const budget = sim?._trainingNavigationBudget;
  if (!budget || !Number.isFinite(Number(budget.remaining))) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
};

const consumeFormationRecoveryPlanBudget = (sim = {}) => {
  const budget = sim?._formationRecoveryNavigationBudget || sim?._minionRecoveryNavigationBudget;
  if (!budget || !Number.isFinite(Number(budget.remaining))) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
};

const resolveTrainingAiDecisionBudget = (sim = {}) => clamp(
  Math.floor(Number(sim?.trainingMap?.navigation?.aiDecisionsPerStep) || DEFAULT_AI_DECISIONS_PER_STEP),
  1,
  12
);

const canRefreshTrainingAiDecision = (squad = null, sim = null, nowSec = 0) => {
  if (!squad || !isTrainingCardAiSquad(squad)) return true;
  const cache = squad?._trainingAiTargetCache;
  if (cache && (Number(cache?.nextAt) || 0) > nowSec) return true;
  const budget = sim?._trainingAiDecisionBudget;
  if (!budget || !Number.isFinite(Number(budget.remaining))) return true;
  if (budget.allowedIds instanceof Set && !budget.allowedIds.has(String(squad?.id || ''))) return false;
  if (budget.consumedIds instanceof Set && budget.consumedIds.has(String(squad?.id || ''))) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (budget.consumedIds instanceof Set) budget.consumedIds.add(String(squad?.id || ''));
  return true;
};

const clearForeignTrainingAiState = (squad = null, agents = []) => {
  if (!squad) return;
  clearForeignTrainingNonCardSquadAiState(squad, agents);
  if (!isTrainingCardAiSquad(squad)) {
    clearTrainingCardAiState(squad, agents);
  }
};

export const resolveTrainingNarrowPassageColumns = ({
  position = {},
  forward = {},
  obstacles = [],
  baseColumns = 1,
  spacing = (AGENT_RADIUS * 2) + AGENT_GAP,
  agentRadius = AGENT_RADIUS,
  navigation = {},
  rearProbeDistance = 0
} = {}) => {
  const safeBaseColumns = Math.max(1, Math.floor(Number(baseColumns) || 1));
  const direction = normalizeVec(Number(forward?.x) || 0, Number(forward?.y) || 0);
  if (safeBaseColumns <= 1 || direction.len <= 0.0001) {
    return { active: false, columns: safeBaseColumns, width: Infinity, distance: 0 };
  }
  const config = navigation?.narrowPassage && typeof navigation.narrowPassage === 'object'
    ? navigation.narrowPassage
    : {};
  const probeDistance = clamp(Number(config?.probeDistance) || 48, 12, 120);
  const probeStep = clamp(Number(config?.probeStep) || 2, 1, 8);
  const entryDistance = clamp(Number(config?.entryDistance) || 38, 0, 96);
  const rearDistance = clamp(Number(rearProbeDistance) || 0, 0, 120);
  const scanStep = Math.max(14, probeStep * 6);
  const passageSpacing = Math.max(AGENT_RADIUS * 2, Number(spacing) || (AGENT_RADIUS * 2) + AGENT_GAP);
  const inflate = Math.max(0.5, Number(agentRadius) || AGENT_RADIUS) + 0.4;
  let narrowestWidth = Infinity;
  let narrowestDistance = 0;

  for (let distanceAhead = -rearDistance; distanceAhead <= entryDistance; distanceAhead += scanStep) {
    const probeOrigin = {
      x: (Number(position?.x) || 0) + (direction.x * distanceAhead),
      y: (Number(position?.y) || 0) + (direction.y * distanceAhead)
    };
    const width = estimateLocalFlowWidth(probeOrigin, direction, obstacles, {
      step: probeStep,
      maxProbe: probeDistance,
      inflate
    });
    if (width < narrowestWidth) {
      narrowestWidth = width;
      narrowestDistance = distanceAhead;
    }
  }

  const safeWidth = Number.isFinite(narrowestWidth) ? narrowestWidth : probeDistance * 2;
  const columns = clamp(
    Math.floor((safeWidth + (passageSpacing * 0.12)) / passageSpacing) + 1,
    1,
    safeBaseColumns
  );
  return {
    active: columns < safeBaseColumns,
    columns,
    width: safeWidth,
    distance: narrowestDistance
  };
};

const resolveTrainingNarrowPassageState = ({
  squad = null,
  sim = null,
  walls = [],
  forward = {},
  baseColumns = 1,
  spacing = (AGENT_RADIUS * 2) + AGENT_GAP,
  rearProbeDistance = 0,
  nowSec = 0
} = {}) => {
  if (!squad) return { active: false, columns: Math.max(1, baseColumns), width: Infinity, distance: 0 };
  const navigation = sim?.trainingMap?.navigation || {};
  if (!navigation?.narrowPassage || typeof navigation.narrowPassage !== 'object') {
    squad._narrowPassage = {
      active: false,
      columns: Math.max(1, Math.floor(Number(baseColumns) || 1)),
      width: Infinity,
      distance: 0,
      until: 0,
      sampledAt: nowSec
    };
    return squad._narrowPassage;
  }
  const previous = squad?._narrowPassage;
  if (
    previous
    && Number.isFinite(Number(previous?.sampledAt))
    && nowSec >= Number(previous.sampledAt)
    && (nowSec - Number(previous.sampledAt)) < NARROW_PASSAGE_SCAN_INTERVAL_SEC
  ) {
    return previous;
  }
  const probeRadius = Math.max(
    8,
    (Number(navigation?.narrowPassage?.probeDistance) || 48)
      + (Number(navigation?.narrowPassage?.entryDistance) || 38)
      + Math.max(0, Number(rearProbeDistance) || 0)
      + resolveTrainingNavigationAgentRadius(squad, sim)
  );
  const releaseSeconds = clamp(
    Number(navigation?.narrowPassage?.releaseSeconds) || NARROW_PASSAGE_RELEASE_OPEN_SEC,
    0.2,
    4
  );
  const nearbyWalls = queryObstacleCandidates(
    walls,
    Number(squad?.x) || 0,
    Number(squad?.y) || 0,
    probeRadius
  );
  if (nearbyWalls.length <= 0) {
    if (previous?.active) {
      const clearSince = Number(previous?.clearSince) || nowSec;
      if (nowSec - clearSince < releaseSeconds) {
        const state = { ...previous, active: true, clearSince, sampledAt: nowSec };
        squad._narrowPassage = state;
        return state;
      }
    }
    squad._narrowPassage = {
      active: false,
      columns: Math.max(1, Math.floor(Number(baseColumns) || 1)),
      width: Infinity,
      distance: 0,
      until: 0,
      clearSince: 0,
      sampledAt: nowSec
    };
    return squad._narrowPassage;
  }
  const passage = resolveTrainingNarrowPassageColumns({
    position: squad,
    forward,
    obstacles: nearbyWalls,
    baseColumns,
    spacing,
    agentRadius: resolveTrainingNavigationAgentRadius(squad, sim),
    navigation,
    rearProbeDistance
  });
  if (passage.active) {
    const state = {
      ...passage,
      active: true,
      until: nowSec + releaseSeconds,
      clearSince: 0,
      sampledAt: nowSec
    };
    squad._narrowPassage = state;
    return state;
  }
  if (previous?.active) {
    const clearSince = Number(previous?.clearSince) || nowSec;
    if (nowSec - clearSince < releaseSeconds) {
      const state = {
        ...previous,
        columns: Math.max(
          Math.max(1, Math.floor(Number(previous?.columns) || 1)),
          Math.max(1, Math.floor(Number(passage?.columns) || 1))
        ),
        width: passage.width,
        distance: passage.distance,
        active: true,
        clearSince,
        sampledAt: nowSec
      };
      squad._narrowPassage = state;
      return state;
    }
  }
  squad._narrowPassage = {
    ...passage,
    active: false,
    until: 0,
    clearSince: 0,
    sampledAt: nowSec
  };
  return squad._narrowPassage;
};

const resolveNarrowPassageFormationSlot = ({
  index = 0,
  standardSlot = {},
  passage = null,
  spacing = (AGENT_RADIUS * 2) + AGENT_GAP,
  spacingScale = 1
} = {}) => {
  if (!passage?.active) return standardSlot;
  const columns = Math.max(1, Math.floor(Number(passage?.columns) || 1));
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
  const column = safeIndex % columns;
  const row = Math.floor(safeIndex / columns);
  const sideSpacing = Math.max(AGENT_RADIUS * 2, Number(spacing) || 1) * spacingScale;
  return {
    side: (column - ((columns - 1) * 0.5)) * sideSpacing,
    front: -row * sideSpacing * 0.92
  };
};

const sumUnitsMap = (map = {}) => Object.values(map || {}).reduce((sum, c) => sum + Math.max(0, Number(c) || 0), 0);

const normalizeUnitsMap = (raw = {}) => {
  const out = {};
  Object.entries(raw || {}).forEach(([unitTypeId, count]) => {
    const id = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    const safe = Math.max(0, Math.floor(Number(count) || 0));
    if (!id || safe <= 0) return;
    out[id] = safe;
  });
  return out;
};

const resolveVisibleAgentCount = (remain = 0, maxAgentWeight = DEFAULT_MAX_AGENT_WEIGHT, strictAgentMapping = false) => {
  const n = Math.max(1, Math.floor(Number(remain) || 0));
  const byWeight = Math.max(1, Math.ceil(n / Math.max(1, Number(maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT)));
  if (strictAgentMapping) return byWeight;
  if (n <= 30) return n;
  if (n <= 300) return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 30 + Math.floor((n - 30) / 6)));
  if (n <= 3000) return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 75 + Math.floor((n - 300) / 60)));
  return Math.max(byWeight, Math.min(MAX_AGENTS_PER_SQUAD, 150 + Math.floor((n - 3000) / 120)));
};

const resolveRepConfig = (sim, crowd) => {
  const source = crowd?.repConfig && typeof crowd.repConfig === 'object'
    ? crowd.repConfig
    : (sim?.repConfig && typeof sim.repConfig === 'object' ? sim.repConfig : {});
  const maxAgentWeight = Math.max(1, Number(source.maxAgentWeight) || DEFAULT_MAX_AGENT_WEIGHT);
  return {
    maxAgentWeight,
    maxTotalAgents: Math.max(0, Math.floor(Number(source.maxTotalAgents) || 0)),
    requestedMaxAgentWeight: Math.max(
      1,
      Number(source.requestedMaxAgentWeight) || maxAgentWeight
    ),
    effectiveMaxAgentWeight: Math.max(
      1,
      Number(source.effectiveMaxAgentWeight) || maxAgentWeight
    ),
    estimatedAgentCount: Math.max(0, Math.floor(Number(source.estimatedAgentCount) || 0)),
    damageExponent: Math.max(0.2, Math.min(1.25, Number(source.damageExponent) || DEFAULT_DAMAGE_EXPONENT)),
    strictAgentMapping: source.strictAgentMapping !== false
  };
};

const resolveSquadRepConfig = (squad, crowd) => {
  const repConfig = resolveRepConfig(null, crowd);
  const representativeAgentWeightCap = Number(squad?.representativeAgentWeightCap);
  if (!Number.isFinite(representativeAgentWeightCap) || representativeAgentWeightCap <= 0) {
    return repConfig;
  }
  return {
    ...repConfig,
    maxAgentWeight: Math.min(
      repConfig.maxAgentWeight,
      Math.max(1, representativeAgentWeightCap)
    )
  };
};

const hamiltonAllocate = (countsByType = {}, budget = 0) => {
  const entries = Object.entries(countsByType || {}).filter(([id, c]) => !!id && c > 0);
  if (entries.length <= 0) return {};
  const safeBudget = Math.max(1, Math.floor(Number(budget) || 1));
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  const alloc = {};
  const frac = [];
  let assigned = 0;
  entries.forEach(([id, c]) => {
    const exact = safeBudget * (c / Math.max(1, total));
    const base = Math.floor(exact);
    alloc[id] = base;
    assigned += base;
    frac.push({ id, rem: exact - base, count: c });
  });
  let left = Math.max(0, safeBudget - assigned);
  frac.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (b.count !== a.count) return b.count - a.count;
    return a.id.localeCompare(b.id, 'zh-Hans-CN');
  });
  for (let i = 0; i < left; i += 1) {
    const pick = frac[i % frac.length];
    alloc[pick.id] = (alloc[pick.id] || 0) + 1;
  }
  Object.keys(alloc).forEach((id) => {
    if (alloc[id] <= 0) delete alloc[id];
  });
  return alloc;
};

const inferCategoryFromUnitType = (unitType = {}, fallbackClass = 'infantry') => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (explicit === 'infantry' || explicit === 'cavalry' || explicit === 'archer' || explicit === 'artillery') {
    return explicit;
  }
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' || unitType?.roleTag === '近战' ? unitType.roleTag : '';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.attackRange?.max ?? unitType?.attackRangeMax ?? unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|弓兵|弩兵|射手)/.test(name)) return 'archer';
  if (roleTag === '远程' && range >= 3) return 'archer';
  if (/(骑|骑兵|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  if (roleTag === '近战') return 'infantry';
  return fallbackClass || 'infantry';
};

const inferSkillCategoryFromUnitType = (unitType = {}, fallback = SKILL_CATEGORY_MELEE) => {
  const category = typeof unitType?.unitCategory === 'string'
    ? unitType.unitCategory.trim().toLowerCase()
    : (typeof unitType?.rpsType === 'string' ? unitType.rpsType.trim().toLowerCase() : '');
  if (category === SKILL_CATEGORY_RANGED || category === SKILL_CATEGORY_SUPPORT) return category;
  if (category === SKILL_CATEGORY_MELEE) return category;
  return fallback === SKILL_CATEGORY_RANGED || fallback === SKILL_CATEGORY_SUPPORT
    ? fallback
    : SKILL_CATEGORY_MELEE;
};

const inferSkillSubtypeFromUnitType = (unitType = {}, skillCategory = SKILL_CATEGORY_MELEE) => {
  const subtype = typeof unitType?.unitSubtype === 'string' ? unitType.unitSubtype.trim().toLowerCase() : '';
  if (skillCategory === SKILL_CATEGORY_SUPPORT) {
    if (subtype === 'combination' || subtype === 'comprehensive' || subtype === 'intervention') return subtype;
    return 'comprehensive';
  }
  if (subtype === 'mobility' || subtype === 'defense' || subtype === 'balance') return subtype;
  return 'balance';
};

const slotOffsetForIndex = (index, columns, spacing = (AGENT_RADIUS * 2) + AGENT_GAP) => {
  const row = Math.floor(index / Math.max(1, columns));
  const col = index % Math.max(1, columns);
  return {
    side: (col - ((columns - 1) / 2)) * spacing,
    back: row * (spacing * 0.92)
  };
};

const normalizeFormationSpacing = (value) => {
  if (value === FORMATION_SPACING_LOOSE || value === FORMATION_SPACING_COMPACT) return value;
  return FORMATION_SPACING_STANDARD;
};

const normalizeFormationSlot = (slot = {}, fallback = {}) => ({
  side: Number.isFinite(Number(slot?.side)) ? Number(slot.side) : (Number(fallback?.side) || 0),
  front: Number.isFinite(Number(slot?.front)) ? Number(slot.front) : (Number(fallback?.front) || 0)
});

const buildNeutralRepresentativeFormation = (agentCount = 1, spacing = NEUTRAL_REPRESENTATIVE_FORMATION_SPACING) => {
  const count = Math.max(1, Math.floor(Number(agentCount) || 1));
  const safeSpacing = Math.max(1, Number(spacing) || NEUTRAL_REPRESENTATIVE_FORMATION_SPACING);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const centerColumn = (columns - 1) * 0.5;
  const centerRow = (rows - 1) * 0.5;
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = (row * columns) + column;
      if (index >= count) break;
      slots.push({
        side: (column - centerColumn) * safeSpacing,
        front: (centerRow - row) * safeSpacing * NEUTRAL_REPRESENTATIVE_FORMATION_DEPTH_SCALE,
        row,
        col: column
      });
    }
  }
  slots.sort((left, right) => (
    Math.hypot(left.col - centerColumn, left.row - centerRow)
      - Math.hypot(right.col - centerColumn, right.row - centerRow)
    || left.row - right.row
    || left.col - right.col
  ));
  return {
    columns,
    rows,
    spacing: safeSpacing,
    width: Math.max(safeSpacing, columns * safeSpacing),
    depth: Math.max(safeSpacing * NEUTRAL_REPRESENTATIVE_FORMATION_DEPTH_SCALE, rows * safeSpacing * NEUTRAL_REPRESENTATIVE_FORMATION_DEPTH_SCALE),
    slots
  };
};

const applyNeutralRepresentativeFormation = (squad = null, agents = [], formationForward = null) => {
  if (!isTrainingNeutralSquad(squad) || !Array.isArray(agents) || agents.length <= 0) return null;
  const formation = buildNeutralRepresentativeFormation(agents.length);
  const forward = normalizeVec(formationForward?.x, formationForward?.y);
  const forwardX = forward.len > 1e-4 ? forward.x : 1;
  const forwardY = forward.len > 1e-4 ? forward.y : 0;
  const sideX = -forwardY;
  const sideY = forwardX;
  const currentFormation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  squad.formationRect = {
    ...currentFormation,
    area: formation.width * formation.depth,
    width: formation.width,
    depth: formation.depth,
    spacing: formation.spacing,
    slotCount: agents.length,
    formationId: String(currentFormation?.formationId || 'neutral-camp-square'),
    formationName: String(currentFormation?.formationName || '方阵守卫')
  };
  squad.deploySlots = formation.slots.map((slot) => ({ ...slot }));
  agents.forEach((agent, index) => {
    const slot = formation.slots[index] || { side: 0, front: 0 };
    agent.formationSlot = normalizeFormationSlot(slot);
    agent.formationSpacingSlots = null;
    agent._formationLocked = true;
    agent._formationHold = true;
    agent._formationHoldSpacing = '';
    agent.x = (Number(squad?.x) || 0) + (sideX * slot.side) + (forwardX * slot.front);
    agent.y = (Number(squad?.y) || 0) + (sideY * slot.side) + (forwardY * slot.front);
    agent.vx = 0;
    agent.vy = 0;
  });
  return formation;
};

const normalizeAngleDelta = (value = 0) => {
  let delta = Number(value) || 0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

const advanceAgentYaw = (agent = null, targetYaw = 0, dt = 0) => {
  if (!agent || !Number.isFinite(Number(targetYaw))) return Number(agent?.yaw) || 0;
  const currentYaw = Number.isFinite(Number(agent.yaw)) ? Number(agent.yaw) : Number(targetYaw);
  const maxTurn = NEUTRAL_AGENT_TURN_RATE * Math.max(0, Number(dt) || 0);
  const step = clamp(normalizeAngleDelta(Number(targetYaw) - currentYaw), -maxTurn, maxTurn);
  agent.yaw = currentYaw + step;
  return agent.yaw;
};

const updateAgentYawFromVelocity = (agent = null, vx = 0, vy = 0, dt = 0) => {
  if (!agent || Math.abs(Number(vx) || 0) + Math.abs(Number(vy) || 0) <= 0.08) {
    return Number(agent?.yaw) || 0;
  }
  return advanceAgentYaw(agent, Math.atan2(Number(vy) || 0, Number(vx) || 0), dt);
};

const buildFormationAxisScale = (slots = [], axis = 'side', baseSpacing = 1, scale = 1) => {
  const values = Array.from(new Set(
    slots
      .map((slot) => Number(slot?.[axis]))
      .filter(Number.isFinite)
  )).sort((left, right) => left - right);
  if (values.length <= 1 || Math.abs(scale - 1) <= 1e-6) {
    return new Map(values.map((value) => [value, value]));
  }
  const scaled = new Map([[values[0], values[0]]]);
  let cursor = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const value = values[index];
    const gap = value - previous;
    const structuralGap = gap > (Math.max(0.1, baseSpacing) * FORMATION_STRUCTURAL_GAP_MULTIPLIER);
    cursor += structuralGap ? gap : (gap * scale);
    scaled.set(value, cursor);
  }
  const originalCenter = (values[0] + values[values.length - 1]) * 0.5;
  const scaledCenter = ((scaled.get(values[0]) || 0) + (scaled.get(values[values.length - 1]) || 0)) * 0.5;
  const centerShift = originalCenter - scaledCenter;
  values.forEach((value) => scaled.set(value, (scaled.get(value) || 0) + centerShift));
  return scaled;
};

const assignFormationSpacingSlots = (agents = [], baseSpacing = (AGENT_RADIUS * 2) + AGENT_GAP) => {
  const slots = agents.map((agent) => normalizeFormationSlot(agent?.formationSlot));
  const scales = Object.entries(FORMATION_SPACING_SCALE).reduce((out, [mode, scale]) => {
    out[mode] = {
      side: buildFormationAxisScale(slots, 'side', baseSpacing, scale),
      front: buildFormationAxisScale(slots, 'front', baseSpacing, scale)
    };
    return out;
  }, {});
  agents.forEach((agent, index) => {
    const slot = slots[index];
    agent.formationSlot = slot;
    agent.formationSpacingSlots = Object.keys(FORMATION_SPACING_SCALE).reduce((out, mode) => {
      const axis = scales[mode];
      out[mode] = {
        side: axis.side.get(slot.side) ?? slot.side,
        front: axis.front.get(slot.front) ?? slot.front
      };
      return out;
    }, {});
  });
};

export const applyCrowdSquadFormation = (crowd, squad, deploySlots = [], formationRect = null) => {
  if (!crowd || !squad?.id) return false;
  const agents = crowd.agentsBySquad?.get(squad.id);
  if (!Array.isArray(agents) || agents.length <= 0) return false;
  const activeAgents = agents
    .filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001)
    .sort((left, right) => (Number(left.slotOrder) || 0) - (Number(right.slotOrder) || 0));
  if (activeAgents.length <= 0) return false;
  const spacing = Math.max(
    0.1,
    Number(formationRect?.spacing) || ((AGENT_RADIUS * 2) + AGENT_GAP)
  );
  const columns = Math.max(
    1,
    Math.round(Math.max(1, Number(formationRect?.width) || spacing) / spacing)
  );
  const slotsByType = new Map();
  const untypedSlots = [];
  (Array.isArray(deploySlots) ? deploySlots : []).forEach((slot) => {
    const normalized = normalizeFormationSlot(slot);
    const unitTypeId = typeof slot?.unitTypeId === 'string' ? slot.unitTypeId.trim() : '';
    if (!unitTypeId) {
      untypedSlots.push(normalized);
      return;
    }
    const typedSlots = slotsByType.get(unitTypeId) || [];
    typedSlots.push(normalized);
    slotsByType.set(unitTypeId, typedSlots);
  });
  activeAgents.forEach((agent, index) => {
    const fallback = slotOffsetForIndex(index, columns, spacing);
    const previousSlot = normalizeFormationSlot(agent.formationSlot);
    const unitTypeId = typeof agent?.unitTypeId === 'string' ? agent.unitTypeId.trim() : '';
    const typedSlots = slotsByType.get(unitTypeId) || [];
    const nextSlot = typedSlots.shift() || untypedSlots.shift() || {
      side: fallback.side,
      front: -fallback.back
    };
    const slotChanged = Math.hypot(
      nextSlot.side - previousSlot.side,
      nextSlot.front - previousSlot.front
    ) > 1e-4;
    agent.formationSlot = nextSlot;
    agent._formationHold = false;
    agent._formationHoldSpacing = '';
    agent._formationLocked = false;
    if (slotChanged || agent?._formationRecovery?.active || agent?._minionRecovery?.active) {
      clearAgentFormationRecovery(agent, Number(squad?._formationPoseAt) || 0, Infinity);
    }
  });
  assignFormationSpacingSlots(activeAgents, spacing);
  squad._crowdBaseColumns = columns;
  return true;
};

export const releaseCrowdSquadFormationLock = (crowd, squadId = '') => {
  const agents = crowd?.agentsBySquad?.get(squadId);
  if (!Array.isArray(agents) || agents.length <= 0) return false;
  agents.forEach((agent) => {
    if (!agent || agent.dead) return;
    agent._formationLocked = false;
    agent._formationHold = false;
    agent._formationHoldSpacing = '';
  });
  return true;
};

const resolveAgentFormationSlot = (agent, index, columns, spacing, mode) => {
  const normalizedMode = normalizeFormationSpacing(mode);
  const configured = agent?.formationSpacingSlots?.[normalizedMode] || agent?.formationSlot;
  if (configured) return normalizeFormationSlot(configured);
  const fallback = slotOffsetForIndex(index, columns, spacing);
  return { side: fallback.side, front: -fallback.back };
};

const teamForward = (team) => (team === TEAM_ATTACKER ? { x: 1, y: 0 } : { x: -1, y: 0 });

const resolveSquadFormationFacing = (squad = {}) => {
  const storedFacing = Number(squad?.formationRect?.facingRad);
  return Number.isFinite(storedFacing)
    ? storedFacing
    : (squad?.team === TEAM_DEFENDER ? Math.PI : 0);
};

const resolveSquadFormationForward = (squad = {}) => {
  const formationFacing = resolveSquadFormationFacing(squad);
  const forward = normalizeVec(Math.cos(formationFacing), Math.sin(formationFacing));
  return forward.len > 1e-4
    ? { x: forward.x, y: forward.y }
    : teamForward(squad?.team);
};

const resolveSquadMovementForward = (squad = {}) => {
  const formationFacing = resolveSquadFormationFacing(squad);
  const directionOffset = Number(squad?.formationRect?.directionOffsetRad);
  const legacyDirection = Number(squad?.formationRect?.directionRad);
  const direction = formationFacing + snapTrainingDirectionOffset(
    Number.isFinite(directionOffset)
      ? directionOffset
      : (Number.isFinite(legacyDirection) ? legacyDirection - formationFacing : 0)
  );
  if (Number.isFinite(direction)) {
    const dir = normalizeVec(Math.cos(direction), Math.sin(direction));
    if (dir.len > 1e-4) return { x: dir.x, y: dir.y };
  }
  return resolveSquadFormationForward(squad);
};

const resolveSquadFormationPose = (squad = {}) => ({
  x: Number.isFinite(Number(squad?._formationPoseX))
    ? Number(squad._formationPoseX)
    : (Number(squad?.x) || 0),
  y: Number.isFinite(Number(squad?._formationPoseY))
    ? Number(squad._formationPoseY)
    : (Number(squad?.y) || 0),
  yaw: Number.isFinite(Number(squad?._formationPoseYaw))
    ? Number(squad._formationPoseYaw)
    : resolveSquadFormationFacing(squad)
});

const advanceSquadFormationPose = (
  squad = null,
  movementForward = null,
  previousPose = null,
  dt = 0
) => {
  const previous = previousPose || resolveSquadFormationPose(squad);
  const movement = normalizeVec(movementForward?.x, movementForward?.y);
  const current = {
    x: Number(squad?.x) || 0,
    y: Number(squad?.y) || 0,
    yaw: previous.yaw
  };
  const isNeutralCamp = isTrainingNeutralSquad(squad);
  if (!squad?.formationRect || movement.len <= 1e-4) {
    squad._formationPoseX = current.x;
    squad._formationPoseY = current.y;
    squad._formationPoseYaw = current.yaw;
    return {
      previous,
      current,
      forward: { x: Math.cos(current.yaw), y: Math.sin(current.yaw) }
    };
  }
  const explicitOffset = Number(squad.formationRect.directionOffsetRad);
  const legacyDirection = Number(squad.formationRect.directionRad);
  const directionOffsetRad = snapTrainingDirectionOffset(
    Number.isFinite(explicitOffset)
      ? explicitOffset
      : (Number.isFinite(legacyDirection) ? legacyDirection - previous.yaw : 0)
  );
  const directionRad = Math.atan2(movement.y, movement.x);
  if (isNeutralCamp) {
    current.yaw = previous.yaw;
    squad.formationRect.directionOffsetRad = snapTrainingDirectionOffset(directionRad - current.yaw);
    squad.formationRect.directionRad = directionRad;
    squad._formationPoseX = current.x;
    squad._formationPoseY = current.y;
    squad._formationPoseYaw = current.yaw;
    return {
      previous,
      current,
      forward: { x: Math.cos(current.yaw), y: Math.sin(current.yaw) }
    };
  }
  const targetFacingRad = directionRad - directionOffsetRad;
  const maxTurn = FORMATION_MARCH_TURN_RATE * Math.max(0, Number(dt) || 0);
  const facingStep = clamp(normalizeAngleDelta(targetFacingRad - previous.yaw), -maxTurn, maxTurn);
  current.yaw = previous.yaw + facingStep;
  squad.formationRect.facingRad = current.yaw;
  squad.formationRect.directionOffsetRad = directionOffsetRad;
  squad.formationRect.directionRad = directionRad;
  squad._formationPoseX = current.x;
  squad._formationPoseY = current.y;
  squad._formationPoseYaw = current.yaw;
  return {
    previous,
    current,
    forward: { x: Math.cos(current.yaw), y: Math.sin(current.yaw) }
  };
};

const formationLocalToWorld = (pose = null, slot = null) => {
  const yaw = Number(pose?.yaw) || 0;
  const forward = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const side = { x: -forward.y, y: forward.x };
  const local = normalizeFormationSlot(slot);
  return {
    x: (Number(pose?.x) || 0) + (side.x * local.side) + (forward.x * local.front),
    y: (Number(pose?.y) || 0) + (side.y * local.side) + (forward.y * local.front)
  };
};

const resolveFormationFollowers = (agents = []) => (
  (Array.isArray(agents) ? agents : [])
    .filter((agent) => (
      agent
      && !agent.dead
      && !agent.isFlagBearer
      && (Number(agent.weight) || 0) > 0.001
    ))
    .sort((left, right) => (Number(left.slotOrder) || 0) - (Number(right.slotOrder) || 0))
);

const resolveFormationRearProbeDistance = ({ squad = null, agents = [], passage = null } = {}) => {
  const followers = resolveFormationFollowers(agents);
  if (followers.length <= 0) return 0;
  const spacing = Math.max(
    (AGENT_RADIUS * 2) + AGENT_GAP,
    Number(squad?.formationRect?.spacing) || 0
  );
  if (passage?.active) {
    const columns = Math.max(1, Math.floor(Number(passage?.columns) || 1));
    const rows = Math.max(1, Math.ceil(followers.length / columns));
    return clamp(((rows - 1) * spacing * 0.92) + (spacing * 1.4), spacing, 120);
  }
  const rearExtent = followers.reduce((maximum, agent, index) => {
    const slot = resolveAgentFormationSlot(
      agent,
      index,
      Math.max(1, Number(squad?._crowdBaseColumns) || Math.ceil(Math.sqrt(followers.length))),
      (AGENT_RADIUS * 2) + AGENT_GAP,
      squad?.formationSpacing
    );
    return Math.max(maximum, Math.max(0, -Number(slot?.front) || 0));
  }, 0);
  return clamp(rearExtent + (spacing * 1.4), spacing, 120);
};

const resolveSquadFormationMetrics = ({
  squad = null,
  agents = [],
  passage = null,
  pose = null
} = {}) => {
  const followers = resolveFormationFollowers(agents);
  const baseSpacing = (AGENT_RADIUS * 2) + AGENT_GAP;
  const configuredSpacing = Math.max(baseSpacing, Number(squad?.formationRect?.spacing) || 0);
  if (!squad || followers.length <= 0) {
    return {
      rows: [],
      errors: [],
      maximumError: 0,
      upperError: 0,
      readyRatio: 1,
      settled: true,
      recoveringCount: 0,
      detachedCount: 0,
      detachedRatio: 0,
      detachedWeightRatio: 0,
      unreadyCount: 0,
      unreadyWeightRatio: 0,
      configuredSpacing
    };
  }
  const formationPose = pose || resolveSquadFormationPose(squad);
  const columns = Math.max(1, Number(squad._crowdBaseColumns) || Math.ceil(Math.sqrt(followers.length)));
  const formationSpacing = normalizeFormationSpacing(squad?.formationSpacing);
  const formationSpacingScale = FORMATION_SPACING_SCALE[formationSpacing]
    || FORMATION_SPACING_SCALE[FORMATION_SPACING_STANDARD];
  const rows = followers.map((agent, index) => {
    const standardSlot = resolveAgentFormationSlot(agent, index, columns, baseSpacing, formationSpacing);
    const slot = resolveNarrowPassageFormationSlot({
      index,
      standardSlot,
      passage,
      spacing: baseSpacing,
      spacingScale: formationSpacingScale
    });
    const destination = formationLocalToWorld(formationPose, slot);
    return {
      agent,
      slot,
      destination,
      error: Math.hypot(
        destination.x - (Number(agent.x) || 0),
        destination.y - (Number(agent.y) || 0)
      )
    };
  });
  const detachedRows = isTrainingCardSquad(squad)
    ? rows.filter((row) => (
      row.agent?._formationDetached === true
      || row.agent?._formationRecovery?.active === true
      || row.agent?._squadController?.rejoin?.active === true
    ))
    : [];
  const detachedAgents = new Set(detachedRows.map((row) => row.agent));
  const measurementRows = isTrainingCardSquad(squad)
    ? rows.filter((row) => !detachedAgents.has(row.agent))
    : rows;
  const errors = measurementRows.map((row) => row.error).sort((left, right) => left - right);
  const allErrors = rows.map((row) => row.error).sort((left, right) => left - right);
  const maximumError = allErrors[allErrors.length - 1] || 0;
  const upperIndex = Math.min(errors.length - 1, Math.max(0, Math.ceil(errors.length * 0.9) - 1));
  const upperError = errors[upperIndex] || 0;
  const readyError = Math.max(1.4, configuredSpacing * 0.34);
  const maximumReadyError = Math.max(2.4, configuredSpacing * 0.52);
  const readyCount = errors.filter((error) => error <= readyError).length;
  const readyRatio = readyCount / Math.max(1, errors.length);
  const recoveringCount = rows.filter((row) => (
    row.agent?._formationRecovery?.active === true
    || row.agent?._minionRecovery?.active === true
  )).length;
  const detachedRatio = detachedRows.length / Math.max(1, rows.length);
  // A representative can stand for very different numbers of soldiers.  Use
  // surviving troop weight for completion decisions so five real stragglers
  // do not hold a 5,000-person card, while a missing third of a small body
  // still keeps its arrival/reform phase alive.
  const totalWeight = rows.reduce((sum, row) => (
    sum + Math.max(0, Number(row?.agent?.weight) || 0)
  ), 0);
  const detachedWeight = detachedRows.reduce((sum, row) => (
    sum + Math.max(0, Number(row?.agent?.weight) || 0)
  ), 0);
  const detachedWeightRatio = detachedWeight / Math.max(0.001, totalWeight);
  const unreadyRows = rows.filter((row) => row.error > maximumReadyError);
  const unreadyWeight = unreadyRows.reduce((sum, row) => (
    sum + Math.max(0, Number(row?.agent?.weight) || 0)
  ), 0);
  const unreadyWeightRatio = unreadyWeight / Math.max(0.001, totalWeight);
  const coreSettled = upperError <= maximumReadyError && readyRatio >= (isTrainingCardSquad(squad) ? 0.94 : 0.98);
  return {
    rows,
    errors,
    maximumError,
    upperError,
    readyRatio,
    readyError,
    maximumReadyError,
    settled: isTrainingCardSquad(squad)
      ? coreSettled && detachedWeightRatio <= 0.08 && unreadyWeightRatio <= 0.08
      : maximumError <= maximumReadyError && readyRatio >= 0.98 && recoveringCount <= 0,
    recoveringCount,
    detachedCount: detachedRows.length,
    detachedRatio,
    detachedWeightRatio,
    unreadyCount: unreadyRows.length,
    unreadyWeightRatio,
    configuredSpacing
  };
};

const resolveSquadMarchCohesionMetrics = ({ squad = null, agents = [] } = {}) => {
  const followers = resolveFormationFollowers(agents);
  const baseSpacing = (AGENT_RADIUS * 2) + AGENT_GAP;
  const configuredSpacing = Math.max(baseSpacing, Number(squad?.formationRect?.spacing) || 0);
  if (!squad || followers.length <= 0) {
    return {
      rows: [],
      errors: [],
      maximumError: 0,
      upperError: 0,
      maximumDistance: 0,
      upperDistance: 0,
      formationSpan: 0,
      readyRatio: 1,
      settled: true,
      recoveringCount: 0,
      configuredSpacing
    };
  }
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  const slotSpan = followers.reduce((maximum, agent) => {
    const slot = normalizeFormationSlot(agent?.formationSlot);
    return Math.max(maximum, Math.hypot(slot.side, slot.front));
  }, 0);
  const width = Math.max(0, Number(formation?.width) || 0);
  const depth = Math.max(0, Number(formation?.depth) || 0);
  const dimensionSpan = width > 0 || depth > 0 ? Math.hypot(width, depth) * 0.5 : 0;
  const columns = Math.max(1, Number(squad?._crowdBaseColumns) || Math.ceil(Math.sqrt(followers.length)));
  const rows = Math.max(1, Math.ceil(followers.length / columns));
  const inferredSpan = Math.hypot(
    Math.max(0, columns - 1) * configuredSpacing * 0.5,
    Math.max(0, rows - 1) * configuredSpacing
  );
  const formationSpan = Math.max(8, slotSpan, dimensionSpan, inferredSpan);
  const distanceRows = followers.map((agent) => {
    const distance = Math.hypot(
      (Number(agent?.x) || 0) - (Number(squad?.x) || 0),
      (Number(agent?.y) || 0) - (Number(squad?.y) || 0)
    );
    return {
      agent,
      distance,
      error: Math.max(0, distance - formationSpan)
    };
  });
  const distances = distanceRows.map((row) => row.distance).sort((left, right) => left - right);
  const errors = distanceRows.map((row) => row.error).sort((left, right) => left - right);
  const upperIndex = Math.min(errors.length - 1, Math.max(0, Math.ceil(errors.length * 0.9) - 1));
  const nearbyError = Math.max(20, configuredSpacing * 2.4);
  const readyCount = errors.filter((error) => error <= nearbyError).length;
  const recoveringCount = distanceRows.filter((row) => (
    row.agent?._formationRecovery?.active === true
    || row.agent?._minionRecovery?.active === true
  )).length;
  return {
    rows: distanceRows,
    errors,
    maximumError: errors[errors.length - 1] || 0,
    upperError: errors[upperIndex] || 0,
    maximumDistance: distances[distances.length - 1] || 0,
    upperDistance: distances[upperIndex] || 0,
    formationSpan,
    nearbyRadius: formationSpan + nearbyError,
    readyRatio: readyCount / Math.max(1, errors.length),
    settled: readyCount === errors.length && recoveringCount <= 0,
    recoveringCount,
    configuredSpacing
  };
};

const resolveSquadFormationCohesion = ({
  squad = null,
  agents = [],
  passage = null,
  moving = false,
  nowSec = 0
} = {}) => {
  const minionMarching = !isTrainingMinionSquad(squad) || (
    squad?._minionAi?.state === MINION_WAVE_AI_STATE.MARCH
    || squad?._minionAi?.state === MINION_WAVE_AI_STATE.RESUME
  );
  if (!squad || !moving || !minionMarching || isTrainingNeutralSquad(squad)) {
    if (squad) {
      squad._formationCohesionSpeedScale = 1;
      squad._formationCohesion = null;
      squad._minionCohesionSpeedScale = 1;
      if (isTrainingMinionSquad(squad)) squad._minionCohesion = null;
    }
    return { speedScale: 1, waiting: false, maximumError: 0, readyRatio: 1 };
  }
  const isMinion = isTrainingMinionSquad(squad);
  const metrics = isMinion
    ? resolveSquadFormationMetrics({ squad, agents, passage })
    : resolveSquadMarchCohesionMetrics({ squad, agents });
  const softError = isMinion
    ? Math.max(14, metrics.configuredSpacing * 1.08)
    : Math.max(20, metrics.configuredSpacing * 2.4);
  const hardError = isMinion
    ? Math.max(28, metrics.configuredSpacing * 1.78)
    : Math.max(48, metrics.configuredSpacing * 5.2);
  const releaseError = softError * MINION_COHESION_RELEASE_RATIO;
  const previous = squad?._formationCohesion && typeof squad._formationCohesion === 'object'
    ? squad._formationCohesion
    : {};
  let severeSince = Number(previous?.severeSince) || 0;
  if (metrics.maximumError > hardError) {
    if (severeSince <= 0) severeSince = nowSec;
  } else if (metrics.maximumError <= releaseError) {
    severeSince = 0;
  }
  const catastrophicRatio = isMinion
    ? MINION_COHESION_CATASTROPHIC_RATIO
    : FORMATION_COHESION_CATASTROPHIC_RATIO;
  const catastrophicError = isMinion
    ? hardError * catastrophicRatio
    : Math.max(
      hardError * catastrophicRatio,
      metrics.configuredSpacing * 8.8
    );
  const stopDelay = metrics.recoveringCount > 0
    ? (isMinion ? MINION_COHESION_RECOVERY_STOP_DELAY_SEC : FORMATION_COHESION_RECOVERY_STOP_DELAY_SEC)
    : (isMinion ? MINION_COHESION_STOP_DELAY_SEC : FORMATION_COHESION_STOP_DELAY_SEC);
  const canWait = squad?.speedPolicy !== SPEED_POLICY_RETREAT && !(Number(squad?.skillRush?.ttl) > 0);
  const waiting = canWait
    && metrics.maximumError > catastrophicError
    && severeSince > 0
    && nowSec - severeSince >= stopDelay;
  const minimumScale = isMinion ? MINION_COHESION_MIN_SPEED_SCALE : FORMATION_COHESION_MIN_SPEED_SCALE;
  const maximumPenalty = metrics.recoveringCount > 0 ? 0.72 : 0.82;
  const maximumScale = metrics.maximumError <= softError
    ? 1
    : clamp(
      1 - (((metrics.maximumError - softError) / Math.max(1, hardError - softError)) * maximumPenalty),
      minimumScale,
      1
    );
  const upperScale = metrics.upperError <= softError
    ? 1
    : clamp(
      1 - (((metrics.upperError - softError) / Math.max(1, hardError - softError)) * 0.68),
      minimumScale,
      1
    );
  const speedScale = waiting ? 0 : Math.min(maximumScale, upperScale);
  const state = {
    ...metrics,
    speedScale,
    waiting,
    softError,
    hardError,
    catastrophicError,
    severeSince
  };
  squad._formationCohesion = state;
  squad._formationCohesionSpeedScale = speedScale;
  squad.formationCohesionState = waiting
    ? 'WAITING'
    : (metrics.recoveringCount > 0 ? 'RECOVERING' : (speedScale < 0.98 ? 'SLOWING' : 'COHESIVE'));
  squad.formationCohesionError = metrics.maximumError;
  if (isMinion) {
    squad._minionCohesion = state;
    squad._minionCohesionSpeedScale = speedScale;
    squad.minionCohesionState = squad.formationCohesionState;
    squad.minionCohesionError = metrics.maximumError;
  }
  return state;
};

const formationWorldToLocal = (pose = null, point = null) => {
  const yaw = Number(pose?.yaw) || 0;
  const forward = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const side = { x: -forward.y, y: forward.x };
  const dx = (Number(point?.x) || 0) - (Number(pose?.x) || 0);
  const dy = (Number(point?.y) || 0) - (Number(pose?.y) || 0);
  return {
    side: (dx * side.x) + (dy * side.y),
    front: (dx * forward.x) + (dy * forward.y)
  };
};

const advanceAgentFormationPosition = (
  agent = null,
  slot = null,
  previousPose = null,
  currentPose = null,
  dt = 0,
  lockSpacing = ''
) => {
  const targetSlot = normalizeFormationSlot(slot);
  const previousLocal = formationWorldToLocal(previousPose, agent);
  const slotError = Math.hypot(
    previousLocal.side - targetSlot.side,
    previousLocal.front - targetSlot.front
  );
  let locked = agent?._formationLocked !== false;
  if (locked && slotError > FORMATION_SLOT_RELEASE_DISTANCE) locked = false;
  let nextLocal = targetSlot;
  if (!locked) {
    const alpha = 1 - Math.exp(-FORMATION_SLOT_REJOIN_HZ * Math.max(0, Number(dt) || 0));
    nextLocal = {
      side: previousLocal.side + ((targetSlot.side - previousLocal.side) * alpha),
      front: previousLocal.front + ((targetSlot.front - previousLocal.front) * alpha)
    };
    if (Math.hypot(
      nextLocal.side - targetSlot.side,
      nextLocal.front - targetSlot.front
    ) <= FORMATION_SLOT_LOCK_EPSILON) {
      nextLocal = targetSlot;
      locked = true;
    }
  }
  if (agent) {
    agent._formationLocked = locked;
    agent._formationHold = locked;
    agent._formationHoldSpacing = locked ? lockSpacing : '';
  }
  return {
    ...formationLocalToWorld(currentPose, nextLocal),
    locked
  };
};

const resolveDirectFormationVelocity = ({
  agent = {},
  targetX = 0,
  targetY = 0,
  maxRelativeSpeed = 0,
  deadzone = 0,
  dt = 0
} = {}) => {
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  const errorX = (Number(targetX) || 0) - (Number(agent?.x) || 0);
  const errorY = (Number(targetY) || 0) - (Number(agent?.y) || 0);
  const distance = Math.hypot(errorX, errorY);
  const arrivalDistance = Math.max(0, Number(deadzone) || 0);
  const remainingDistance = Math.max(0, distance - arrivalDistance);
  const relativeSpeed = Math.min(
    Math.max(0, Number(maxRelativeSpeed) || 0),
    remainingDistance / safeDt
  );
  const directionX = distance > 0.0001 ? errorX / distance : 0;
  const directionY = distance > 0.0001 ? errorY / distance : 0;
  return {
    vx: directionX * relativeSpeed,
    vy: directionY * relativeSpeed,
    distance,
    relativeSpeed
  };
};

const skillRangeByClass = (classTag = '') => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

const resolveAgentSpeedMul = (unitType = {}, category = 'infantry') => {
  const rawSpeed = Number(unitType?.speed);
  if (Number.isFinite(rawSpeed) && rawSpeed > 0) {
    return clamp(rawSpeed / 1.45, 0.64, 1.72);
  }
  if (category === 'cavalry') return 1.3;
  if (category === 'artillery') return 0.82;
  if (category === 'archer') return 0.98;
  return 1;
};

const ensureSquadActionState = (squad) => {
  if (!squad || typeof squad !== 'object') return { kind: 'none', ttl: 0, dur: 0, from: 'none', to: 'none' };
  if (!squad.actionState || typeof squad.actionState !== 'object') {
    squad.actionState = { kind: 'none', ttl: 0, dur: 0, from: 'none', to: 'none' };
  }
  if (typeof squad.actionState.kind !== 'string') squad.actionState.kind = 'none';
  if (!Number.isFinite(Number(squad.actionState.ttl))) squad.actionState.ttl = 0;
  if (!Number.isFinite(Number(squad.actionState.dur))) squad.actionState.dur = 0;
  return squad.actionState;
};

const ensureSquadStatusEffects = (squad) => {
  if (!squad || typeof squad !== 'object') return [];
  if (!Array.isArray(squad.statusEffects)) squad.statusEffects = [];
  return squad.statusEffects;
};

const resolveSquadStatusMultipliers = (squad = null) => {
  const multipliers = {
    atkMul: 1,
    defMul: 1,
    speedMul: 1,
    skillMul: 1,
    rangeMul: 1
  };
  const effects = ensureSquadStatusEffects(squad);
  effects.forEach((effect) => {
    if (!effect || (Number(effect.ttl) || 0) <= 0) return;
    Object.keys(multipliers).forEach((key) => {
      const value = Number(effect[key]);
      if (Number.isFinite(value) && value > 0) multipliers[key] *= value;
    });
  });
  return multipliers;
};

const applySquadStatusEffect = (squad, effect = {}) => {
  if (!squad || !effect || typeof effect !== 'object') return null;
  const effects = ensureSquadStatusEffects(squad);
  const type = effect.type === 'debuff' ? 'debuff' : 'buff';
  if (effect.type === 'purify') {
    squad.statusEffects = effects.filter((entry) => entry?.type !== 'debuff');
    return null;
  }
  const durationSec = Math.max(0.1, Number(effect.durationSec) || Number(effect.ttl) || 1);
  const id = String(effect.id || `${type}:${effect.sourceSkillId || 'skill'}`);
  const next = {
    id,
    type,
    sourceSkillId: String(effect.sourceSkillId || ''),
    ttl: durationSec,
    durationSec,
    atkMul: Math.max(0.05, Number(effect.atkMul) || 1),
    defMul: Math.max(0.05, Number(effect.defMul) || 1),
    speedMul: Math.max(0.05, Number(effect.speedMul) || 1),
    skillMul: Math.max(0.05, Number(effect.skillMul) || 1),
    rangeMul: Math.max(0.05, Number(effect.rangeMul) || 1)
  };
  const existingIndex = effects.findIndex((entry) => entry?.id === id);
  if (existingIndex >= 0) effects[existingIndex] = next;
  else effects.push(next);
  return next;
};

const stepSquadStatusEffects = (squad, dt = 0) => {
  if (!squad || !Array.isArray(squad.statusEffects)) return;
  squad.statusEffects = squad.statusEffects
    .map((effect) => ({
      ...effect,
      ttl: Math.max(0, (Number(effect?.ttl) || 0) - Math.max(0, Number(dt) || 0))
    }))
    .filter((effect) => (Number(effect?.ttl) || 0) > 0);
};

const beginAgentCast = (agent, spec = {}) => {
  if (!agent || agent.dead) return;
  const durationSec = Math.max(0.16, Number(spec.durationSec) || 0.8);
  const requestedDash = Math.max(0, Number(spec.dashDistance) || 0);
  const dashSpeedMul = Math.max(1, Number(spec.dashSpeedMul) || 1);
  const practicalDashLimit = Math.max(
    2,
    (Number(agent.moveSpeedMul) || 1) * 20 * durationSec * dashSpeedMul * 0.52
  );
  const direction = normalizeVec(Number(spec.dirX) || 0, Number(spec.dirY) || 0);
  agent.castState = {
    style: String(spec.style || 'melee'),
    motion: String(spec.motion || ''),
    ttl: durationSec,
    durationSec,
    elapsedSec: 0,
    dirX: direction.len > 0.0001 ? direction.x : (Number(agent.yaw) ? Math.cos(agent.yaw) : 1),
    dirY: direction.len > 0.0001 ? direction.y : (Number(agent.yaw) ? Math.sin(agent.yaw) : 0),
    dashDistance: Math.min(requestedDash, practicalDashLimit),
    dashSpeedMul: requestedDash > 0 ? dashSpeedMul : 1,
    phaseOffset: ((Number(agent.slotOrder) || 0) % 7) * 0.27,
    targetX: Number(spec.targetX) || 0,
    targetY: Number(spec.targetY) || 0
  };
};

const stepAgentCast = (agent, dt = 0) => {
  const cast = agent?.castState;
  if (!cast) return null;
  const safeDt = Math.max(0, Number(dt) || 0);
  cast.ttl = Math.max(0, (Number(cast.ttl) || 0) - safeDt);
  cast.elapsedSec = Math.max(0, (Number(cast.elapsedSec) || 0) + safeDt);
  if (cast.ttl <= 0) {
    agent.castState = null;
    return null;
  }
  return cast;
};

const resolveAgentCastOffset = (agent) => {
  const cast = agent?.castState;
  if (!cast || cast.style !== 'melee') return { x: 0, y: 0, active: false };
  const duration = Math.max(0.01, Number(cast.durationSec) || 0.01);
  const progress = clamp((Number(cast.elapsedSec) || 0) / duration, 0, 1);
  const distance = Math.max(0, Number(cast.dashDistance) || 0);
  if (distance <= 0.01) return { x: 0, y: 0, active: false };
  if (cast.motion === 'orbit') {
    const angle = (progress * Math.PI * 4) + (Number(cast.phaseOffset) || 0);
    const radius = distance * (0.45 + (0.55 * Math.sin(Math.min(1, progress) * Math.PI)));
    return {
      x: (Math.cos(angle) * radius),
      y: (Math.sin(angle) * radius),
      active: true
    };
  }
  const reach = Math.sin(progress * Math.PI) * distance;
  return {
    x: (Number(cast.dirX) || 0) * reach,
    y: (Number(cast.dirY) || 0) * reach,
    active: reach > 0.02
  };
};

const moveMeleeChargeAgent = (agent, destination, squad, sim, walls, dt) => {
  const target = {
    x: Number(destination?.x) || 0,
    y: Number(destination?.y) || 0
  };
  const toTarget = normalizeVec(target.x - (Number(agent?.x) || 0), target.y - (Number(agent?.y) || 0));
  if (toTarget.len <= LEADER_ARRIVAL_RADIUS * 0.82) {
    agent.vx = 0;
    agent.vy = 0;
    return toTarget.len;
  }
  const speed = Math.max(
    10,
    (Number(squad?.stats?.speed) || 1)
      * 20
      * resolveTrainingMapMovementScale(sim)
      * clamp(Number(agent?.moveSpeedMul) || 1, 0.6, 1.8)
      * 1.38
  );
  const step = Math.min(toTarget.len, speed * Math.max(0.001, Number(dt) || 0));
  const previousX = Number(agent.x) || 0;
  const previousY = Number(agent.y) || 0;
  let nextX = previousX + (toTarget.x * step);
  let nextY = previousY + (toTarget.y * step);
  (Array.isArray(walls) ? walls : []).forEach((wall) => {
    const pushed = pushOutOfRect({ x: nextX, y: nextY }, wall, (agent.radius || AGENT_RADIUS) + 0.5);
    nextX = pushed.x;
    nextY = pushed.y;
  });
  const halfW = (Number(sim?.field?.width) || 2700) / 2;
  const halfH = (Number(sim?.field?.height) || 1488) / 2;
  const legalStep = resolveTrainingLegalMovementStep({
    sim,
    start: { x: previousX, y: previousY },
    target: {
      x: clamp(nextX, -halfW + 2, halfW - 2),
      y: clamp(nextY, -halfH + 2, halfH - 2)
    },
    walls,
    radius: (agent.radius || AGENT_RADIUS) + 0.5
  });
  agent.x = legalStep.x;
  agent.y = legalStep.y;
  agent.vx = (agent.x - previousX) / Math.max(0.001, Number(dt) || 0.001);
  agent.vy = (agent.y - previousY) / Math.max(0.001, Number(dt) || 0.001);
  if (Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08) {
    if (agent.isNeutralCampUnit === true) updateAgentYawFromVelocity(agent, agent.vx, agent.vy, dt);
    else agent.yaw = Math.atan2(agent.vy, agent.vx);
  }
  return Math.hypot(target.x - agent.x, target.y - agent.y);
};

const stepMeleeChargeAgent = (agent, squad, order, sim, walls, dt, nowSec) => {
  const state = agent?.meleeChargeState;
  if (!state || !order || order.active === false) return false;
  const alertRect = order.alertRect || {};
  const chargePoint = state.chargePoint || order.targetPoint || { x: squad.x, y: squad.y };
  if (state.phase === 'charge') {
    const distance = moveMeleeChargeAgent(agent, chargePoint, squad, sim, walls, dt);
    agent.state = distance <= LEADER_ARRIVAL_RADIUS ? 'idle' : 'move';
    if (distance <= LEADER_ARRIVAL_RADIUS) {
      state.phase = 'attack';
      state.attackStartedAt = nowSec;
      if ((Number(order.holdUntil) || 0) <= nowSec) {
        order.holdUntil = nowSec + Math.max(1.4, Number(order.attackWindowSec) || 2.2);
      }
    }
    return true;
  }
  if (state.phase === 'attack') {
    const insideAlert = pointInsideMeleeAlertRect(agent, alertRect);
    const enemy = pickEnemyInsideMeleeAlert(squad, sim, alertRect, agent);
    if (!insideAlert || (!enemy && nowSec >= (Number(order.holdUntil) || 0))) {
      state.phase = 'return';
    } else {
      agent.vx = 0;
      agent.vy = 0;
      agent.targetAgentId = enemy?.id || '';
      agent.state = enemy ? 'attack' : 'idle';
      return true;
    }
  }
  if (state.phase === 'return') {
    const distance = moveMeleeChargeAgent(agent, state.returnPoint, squad, sim, walls, dt);
    agent.state = distance <= LEADER_ARRIVAL_RADIUS ? 'idle' : 'move';
    agent.targetAgentId = '';
    if (distance <= LEADER_ARRIVAL_RADIUS) {
      agent.meleeChargeState = null;
      agent.vx = 0;
      agent.vy = 0;
    }
    return true;
  }
  agent.meleeChargeState = null;
  return false;
};

const refreshMeleeAttackOrder = (squad, agents = [], nowSec = 0) => {
  const order = squad?.meleeAttackOrder;
  if (!order || order.active === false) return;
  const casterIds = new Set(Array.isArray(order.casterAgentIds) ? order.casterAgentIds : []);
  const casters = (Array.isArray(agents) ? agents : [])
    .filter((agent) => agent && !agent.dead && casterIds.has(agent.id));
  const activeStates = casters.map((agent) => agent.meleeChargeState).filter(Boolean);
  if (activeStates.length <= 0) {
    squad.meleeAttackOrder = null;
    squad.targetSquadId = '';
    squad.waypoints = [];
    const resumeBehavior = order.resumeBehavior === 'auto' ? 'auto' : 'idle';
    squad.behavior = resumeBehavior;
    squad.action = resumeBehavior === 'auto' ? '自动攻击' : '待命';
    squad.order = {
      type: resumeBehavior === 'auto' ? ORDER_ATTACK_MOVE : ORDER_IDLE,
      issuedAt: nowSec,
      commitUntil: 0,
      targetPoint: null,
      targetSquadId: ''
    };
    return;
  }
  const hasCharge = activeStates.some((state) => state.phase === 'charge');
  const hasAttack = activeStates.some((state) => state.phase === 'attack');
  order.phase = hasCharge ? 'charge' : (hasAttack ? 'attack' : 'return');
  squad.action = order.phase === 'charge'
    ? '近战突进'
    : (order.phase === 'attack' ? '近战警戒' : '回阵');
};

const ensureSquadStability = (squad) => {
  if (!squad || typeof squad !== 'object') return null;
  if (!squad.stability || typeof squad.stability !== 'object') {
    squad.stability = {
      poise: 100,
      poiseMax: 100,
      chargePoise: 140,
      chargePoiseCurrent: 140,
      transition: 90,
      transitionMax: 90,
      poiseRegenPerSec: 6.2,
      transitionDecayPerSec: 4.1,
      transitionRegenPerSec: 2.5
    };
  }
  const s = squad.stability;
  s.poiseMax = Math.max(10, Number(s.poiseMax) || 100);
  s.poise = clamp(Number(s.poise) || s.poiseMax, 0, s.poiseMax);
  s.chargePoise = Math.max(s.poiseMax, Number(s.chargePoise) || (s.poiseMax * 1.3));
  s.chargePoiseCurrent = clamp(Number(s.chargePoiseCurrent) || s.chargePoise, 0, s.chargePoise);
  s.transitionMax = Math.max(10, Number(s.transitionMax) || 90);
  s.transition = clamp(Number(s.transition) || s.transitionMax, 0, s.transitionMax);
  s.poiseRegenPerSec = Math.max(0.1, Number(s.poiseRegenPerSec) || 6.2);
  s.transitionDecayPerSec = Math.max(0.1, Number(s.transitionDecayPerSec) || 4.1);
  s.transitionRegenPerSec = Math.max(0.1, Number(s.transitionRegenPerSec) || 2.5);
  return s;
};

const resolveUnitTypeSpeed = (crowd, unitTypeId, fallback = 1) => {
  const unitType = crowd?.unitTypeMap?.get(unitTypeId) || null;
  const speed = Number(unitType?.speed);
  if (!Number.isFinite(speed) || speed <= 0.05) return Math.max(0.2, Number(fallback) || 1);
  return Math.max(0.2, speed);
};

const resolveSquadSpeedComposition = (squad = {}) => {
  const remaining = normalizeUnitsMap(squad?.remainUnits || {});
  if (sumUnitsMap(remaining) > 0) return remaining;
  return normalizeUnitsMap(squad?.units || {});
};

const computeWeightedGroupSpeed = (squad = {}, crowd = null) => {
  const units = resolveSquadSpeedComposition(squad);
  const entries = Object.entries(units).filter(([, count]) => count > 0);
  if (entries.length <= 0) return Math.max(0.2, Number(squad?.stats?.speed) || 1);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  let weightedSpeed = 0;
  entries.forEach(([unitTypeId, count]) => {
    const w = count / Math.max(1, total);
    const v = resolveUnitTypeSpeed(crowd, unitTypeId, squad?.stats?.speed);
    weightedSpeed += w * v;
  });
  return Math.max(0.2, weightedSpeed || Number(squad?.stats?.speed) || 1);
};

const computeRetreatGroupSpeed = (squad = {}, crowd = null) => {
  const units = resolveSquadSpeedComposition(squad);
  const entries = Object.entries(units).filter(([, count]) => count > 0);
  if (entries.length <= 0) return Math.max(0.2, Number(squad?.stats?.speed) || 1);
  let maxSpeed = 0;
  entries.forEach(([unitTypeId]) => {
    maxSpeed = Math.max(maxSpeed, resolveUnitTypeSpeed(crowd, unitTypeId, squad?.stats?.speed));
  });
  return Math.max(0.2, maxSpeed);
};

const resolveSquadOrderType = (squad = {}) => {
  const orderType = typeof squad?.order?.type === 'string' ? squad.order.type : '';
  if (orderType === ORDER_MOVE || orderType === ORDER_ATTACK_MOVE || orderType === ORDER_CHARGE) return orderType;
  return ORDER_IDLE;
};

const resolveSteeringWeights = (sim = null, crowd = null) => {
  let source = null;
  if (sim?.steeringWeights && typeof sim.steeringWeights === 'object') source = sim.steeringWeights;
  if (!source && crowd?.steeringWeights && typeof crowd.steeringWeights === 'object') source = crowd.steeringWeights;
  if (!source && typeof window !== 'undefined' && window?.__BATTLE_DEBUG__ && typeof window.__BATTLE_DEBUG__ === 'object') {
    source = window.__BATTLE_DEBUG__.steeringWeights || null;
  }
  const input = source && typeof source === 'object' ? source : {};
  return {
    slot: Math.max(0, Number(input.slot ?? DEFAULT_STEERING_WEIGHTS.slot) || DEFAULT_STEERING_WEIGHTS.slot),
    separation: Math.max(0, Number(input.separation ?? DEFAULT_STEERING_WEIGHTS.separation) || DEFAULT_STEERING_WEIGHTS.separation),
    avoidance: Math.max(0, Number(input.avoidance ?? DEFAULT_STEERING_WEIGHTS.avoidance) || DEFAULT_STEERING_WEIGHTS.avoidance),
    anchor: Math.max(0, Number(input.anchor ?? DEFAULT_STEERING_WEIGHTS.anchor) || DEFAULT_STEERING_WEIGHTS.anchor),
    pressure: Math.max(0, Number(input.pressure ?? DEFAULT_STEERING_WEIGHTS.pressure) || DEFAULT_STEERING_WEIGHTS.pressure),
    leaderAvoidance: Math.max(0, Number(input.leaderAvoidance ?? DEFAULT_STEERING_WEIGHTS.leaderAvoidance) || DEFAULT_STEERING_WEIGHTS.leaderAvoidance),
    turnHz: Math.max(0.2, Number(input.turnHz ?? DEFAULT_STEERING_WEIGHTS.turnHz) || DEFAULT_STEERING_WEIGHTS.turnHz),
    maxTurnRate: Math.max(0.2, Number(input.maxTurnRate ?? DEFAULT_STEERING_WEIGHTS.maxTurnRate) || DEFAULT_STEERING_WEIGHTS.maxTurnRate)
  };
};

const clampVecLength = (x, y, maxLen = 1) => {
  const len = Math.hypot(x, y);
  if (len <= maxLen || len <= 1e-6) return { x, y, len };
  return {
    x: (x / len) * maxLen,
    y: (y / len) * maxLen,
    len: maxLen
  };
};

const smoothstep01 = (value) => {
  const t = clamp(Number(value) || 0, 0, 1);
  return t * t * (3 - (2 * t));
};

const clearAvoidanceMemory = (subject) => {
  if (!subject) return;
  subject._avoidSide = 0;
  subject._avoidSideUntil = 0;
  subject._avoidObstacleKey = '';
  subject._avoidObstacle = null;
  subject._avoidForwardX = 0;
  subject._avoidForwardY = 0;
};

const makeAvoidanceObstacleKey = (wall) => {
  if (!wall) return '';
  if (typeof wall.id === 'string' && wall.id) return `id:${wall.id}`;
  const snap = (value) => Math.round((Number(value) || 0) / AVOID_KEY_GRID);
  return [snap(wall.x), snap(wall.y), snap(wall.w), snap(wall.h)].join(':');
};

const hasPassedAvoidanceObstacle = (origin = {}, subject = null, wall = null) => {
  if (!subject || !wall || wall?.destroyed) return true;
  const forward = normalizeVec(subject?._avoidForwardX, subject?._avoidForwardY);
  if (forward.len <= 0.0001) return false;
  const toObstacleX = (Number(wall?.x) || 0) - (Number(origin?.x) || 0);
  const toObstacleY = (Number(wall?.y) || 0) - (Number(origin?.y) || 0);
  const obstacleHalfExtent = Math.max(
    1.5,
    (Math.max(Number(wall?.w) || Number(wall?.width) || 0, Number(wall?.h) || Number(wall?.depth) || 0) * 0.5) + 1.5
  );
  return ((toObstacleX * forward.x) + (toObstacleY * forward.y)) < -obstacleHalfExtent;
};

const isAvoidanceObstacleStillLocal = (origin = {}, wall = null, probe = 0) => {
  if (!wall || wall?.destroyed) return false;
  const obstacleHalfExtent = Math.max(
    1.5,
    Math.max(Number(wall?.w) || Number(wall?.width) || 0, Number(wall?.h) || Number(wall?.depth) || 0) * 0.5
  );
  const clearDistance = obstacleHalfExtent + Math.max(4, Number(probe) || 0) * 1.6;
  return Math.hypot(
    (Number(origin?.x) || 0) - (Number(wall?.x) || 0),
    (Number(origin?.y) || 0) - (Number(wall?.y) || 0)
  ) <= clearDistance;
};

const resolveAvoidanceBoundaryFlow = (origin = {}, dir = {}, wall = null, side = 1) => {
  const away = normalizeVec(
    (Number(origin?.x) || 0) - (Number(wall?.x) || 0),
    (Number(origin?.y) || 0) - (Number(wall?.y) || 0)
  );
  const safeAway = away.len > 0.0001 ? away : normalizeVec(-dir.x, -dir.y);
  const tangentA = { x: -safeAway.y, y: safeAway.x };
  const tangentB = { x: safeAway.y, y: -safeAway.x };
  const pick = side >= 0 ? tangentA : tangentB;
  const boundaryFlow = normalizeVec(
    pick.x + (safeAway.x * 0.9),
    pick.y + (safeAway.y * 0.9)
  );
  return { x: boundaryFlow.x, y: boundaryFlow.y };
};

const computeAvoidanceDirection = (origin, desiredDir, walls = [], probe = OBSTACLE_AVOID_PROBE, subject = null, nowSec = 0) => {
  const dir = normalizeVec(desiredDir?.x || 0, desiredDir?.y || 0);
  if (dir.len <= 1e-4) {
    clearAvoidanceMemory(subject);
    return { x: 0, y: 0 };
  }
  const ahead = {
    x: (Number(origin?.x) || 0) + (dir.x * probe),
    y: (Number(origin?.y) || 0) + (dir.y * probe)
  };
  const hit = raycastObstacles(origin, ahead, walls, 1);
  const rememberedWall = subject?._avoidObstacle || null;
  const rememberedKey = String(subject?._avoidObstacleKey || '');
  const rememberedSide = Number(subject?._avoidSide) || 0;
  const rememberedStillRelevant = !!rememberedWall
    && !rememberedWall?.destroyed
    && rememberedSide !== 0
    && !hasPassedAvoidanceObstacle(origin, subject, rememberedWall)
    // Side memory belongs to the obstacle transit, not to a stale direction
    // forever.  Once the agent is well clear and its present segment no
    // longer hits that wall, release it so a rejoin gate cannot be pulled
    // back into an old tangent.
    && (isAvoidanceObstacleStillLocal(origin, rememberedWall, probe)
      || (hit?.obstacle && makeAvoidanceObstacleKey(hit.obstacle) === rememberedKey));
  if (!hit?.obstacle) {
    if (rememberedStillRelevant) {
      // Do not flip merely because the desired vector momentarily points away
      // from the wall.  The selected side is released after the obstacle has
      // actually moved behind the agent, rather than after a tiny timer.
      return resolveAvoidanceBoundaryFlow(origin, dir, rememberedWall, rememberedSide);
    }
    if ((Number(subject?._avoidSideUntil) || 0) <= nowSec || !rememberedKey) clearAvoidanceMemory(subject);
    return { x: 0, y: 0 };
  }
  const wall = hit.obstacle;
  const away = normalizeVec((Number(hit.x) || 0) - (Number(wall.x) || 0), (Number(hit.y) || 0) - (Number(wall.y) || 0));
  const tangentA = { x: -away.y, y: away.x };
  const tangentB = { x: away.y, y: -away.x };
  const dotA = (tangentA.x * dir.x) + (tangentA.y * dir.y);
  const dotB = (tangentB.x * dir.x) + (tangentB.y * dir.y);
  const obstacleKey = makeAvoidanceObstacleKey(wall);
  let side = dotA >= dotB ? 1 : -1;
  if (subject) {
    const sameObstacle = obstacleKey && rememberedKey === obstacleKey;
    const stickyActive = sameObstacle && rememberedStillRelevant;
    if (stickyActive) side = Number(subject._avoidSide) || side;
    subject._avoidSide = side;
    subject._avoidSideUntil = nowSec + AVOID_SIDE_LOCK_SEC;
    subject._avoidObstacleKey = obstacleKey;
    subject._avoidObstacle = wall;
    if (!stickyActive) {
      subject._avoidForwardX = dir.x;
      subject._avoidForwardY = dir.y;
    }
  }
  return resolveAvoidanceBoundaryFlow(origin, dir, wall, side);
};

const resolveSweptObstacleStep = (start = {}, end = {}, walls = [], inflate = 0) => {
  const startX = Number(start?.x) || 0;
  const startY = Number(start?.y) || 0;
  const endX = Number(end?.x) || 0;
  const endY = Number(end?.y) || 0;
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-5) return { x: endX, y: endY, collided: false, obstacle: null };
  const hit = raycastObstacles(start, end, walls, Math.max(0, Number(inflate) || 0));
  if (!hit?.obstacle || (Number(hit.t) || 0) >= 1) {
    return { x: endX, y: endY, collided: false, obstacle: null };
  }
  const hitT = clamp(Number(hit.t) || 0, 0, 1);
  const safeT = clamp(
    hitT - (SWEPT_COLLISION_MARGIN / distance),
    0,
    1
  );
  const safePoint = {
    x: startX + (dx * safeT),
    y: startY + (dy * safeT)
  };
  const direction = { x: dx / distance, y: dy / distance };
  const normalSample = {
    x: (Number(hit.x) || safePoint.x) + (direction.x * Math.max(0.12, SWEPT_COLLISION_MARGIN * 2)),
    y: (Number(hit.y) || safePoint.y) + (direction.y * Math.max(0.12, SWEPT_COLLISION_MARGIN * 2))
  };
  const pushedSample = pushOutOfRect(
    normalSample,
    hit.obstacle,
    Math.max(0, Number(inflate) || 0) + SWEPT_COLLISION_MARGIN
  );
  let normal = pushedSample?.pushed
    ? normalizeVec(pushedSample.x - normalSample.x, pushedSample.y - normalSample.y)
    : normalizeVec(safePoint.x - (Number(hit.obstacle?.x) || 0), safePoint.y - (Number(hit.obstacle?.y) || 0));
  if (Math.abs(normal.x) + Math.abs(normal.y) <= 1e-4) {
    normal = normalizeVec(-direction.x, -direction.y);
  }
  const remainingX = dx * (1 - safeT);
  const remainingY = dy * (1 - safeT);
  const inwardSpeed = (remainingX * normal.x) + (remainingY * normal.y);
  const slideX = inwardSpeed < 0 ? remainingX - (normal.x * inwardSpeed) : remainingX;
  const slideY = inwardSpeed < 0 ? remainingY - (normal.y * inwardSpeed) : remainingY;
  const slideTarget = {
    x: safePoint.x + slideX,
    y: safePoint.y + slideY
  };
  const slideHit = Math.hypot(slideX, slideY) > 1e-5
    ? raycastObstacles(safePoint, slideTarget, walls, Math.max(0, Number(inflate) || 0))
    : null;
  if (slideHit?.obstacle && (Number(slideHit.t) || 0) > 1e-5 && (Number(slideHit.t) || 0) < 1) {
    const slideDistance = Math.hypot(slideX, slideY);
    const slideT = clamp(
      (Number(slideHit.t) || 0) - (SWEPT_COLLISION_MARGIN / Math.max(1e-5, slideDistance)),
      0,
      1
    );
    slideTarget.x = safePoint.x + (slideX * slideT);
    slideTarget.y = safePoint.y + (slideY * slideT);
  }
  return {
    x: slideTarget.x,
    y: slideTarget.y,
    collided: true,
    obstacle: hit.obstacle
  };
};

const isMeleeAgent = (agent) => {
  const category = typeof agent?.typeCategory === 'string' ? agent.typeCategory : '';
  return category !== 'archer' && category !== 'artillery';
};

const clearAgentCombatTargets = (agent = null) => {
  if (!agent) return;
  agent.targetAgentId = '';
  agent.targetBuildingId = '';
  agent.supportTargetAgentId = '';
  agent.supportTargetSquadId = '';
  agent._combatDirective = null;
  agent._combatTargetLockUntil = 0;
  agent._combatTargetSquadId = '';
};

const resolveAgentHealthRatio = (agent = {}) => clamp(
  (Number(agent?.hpWeight) || Number(agent?.weight) || 0)
    / Math.max(0.001, Number(agent?.initialWeight) || Number(agent?.weight) || 1),
  0,
  1
);

const resolveBuildingTargetRadius = (building = {}) => Math.max(
  4,
  Math.max(Number(building?.width) || 0, Number(building?.depth) || 0) * 0.5
);

const resolveAgentEdgeDistanceToAgent = (agent = {}, target = {}) => Math.max(
  0,
  Math.hypot(
    (Number(target?.x) || 0) - (Number(agent?.x) || 0),
    (Number(target?.y) || 0) - (Number(agent?.y) || 0)
  ) - Math.max(0, Number(agent?.radius) || AGENT_RADIUS) - Math.max(0, Number(target?.radius) || AGENT_RADIUS)
);

const resolveAgentEdgeDistanceToBuilding = (agent = {}, building = {}) => Math.max(
  0,
  Math.hypot(
    (Number(building?.x) || 0) - (Number(agent?.x) || 0),
    (Number(building?.y) || 0) - (Number(agent?.y) || 0)
  ) - resolveBuildingTargetRadius(building) - Math.max(0, Number(agent?.radius) || AGENT_RADIUS)
);

const resolveAgentCombatAcquisitionRadius = (agent = {}, squad = {}, attackRange = null) => {
  const range = attackRange || resolveAgentAttackRange(agent, squad);
  return Math.max(
    AGENT_MELEE_ACQUISITION_RADIUS,
    (Number(range?.max) || 0) + (isRangedAgent(agent) ? 34 : 22)
  );
};

const resolveAgentCombatTargetMemory = ({
  agent = {},
  squad = {},
  sim = {},
  agentMap = new Map(),
  squadMap = new Map(),
  attackRange = {},
  nowSec = 0
} = {}) => {
  const targetId = String(agent?.targetAgentId || '').trim();
  if (!targetId) return null;
  const target = agentMap.get(targetId) || null;
  const targetSquad = target ? (squadMap.get(String(target.squadId || '')) || null) : null;
  if (
    !target
    || target.dead
    || !targetSquad
    || (Number(targetSquad?.remain) || 0) <= 0
    || !canAcquireSquadTarget(squad, targetSquad)
    || isEnemyHiddenForViewer(targetSquad, squad?.team)
  ) return null;
  const committedSquadId = String(
    resolveSquadCombatTargetId(squad)
      || squad?._combatEngagementTargetId
      || agent?._combatTargetSquadId
      || ''
  ).trim();
  if (committedSquadId && committedSquadId !== String(targetSquad.id || '')) return null;
  if (isTrainingMinionSquad(squad) && !isPointWithinTrainingRoadSearchBand(target, squad, sim)) {
    return null;
  }
  const formationEnvelope = resolveSquadFormationEnvelope(squad);
  const acquisitionRadius = resolveAgentCombatAcquisitionRadius(agent, squad, attackRange);
  const centerDistance = Math.hypot(
    (Number(target?.x) || 0) - (Number(agent?.x) || 0),
    (Number(target?.y) || 0) - (Number(agent?.y) || 0)
  );
  if (centerDistance > acquisitionRadius * 1.45) return null;
  const anchorDistance = Math.hypot(
    (Number(target?.x) || 0) - (Number(squad?.x) || 0),
    (Number(target?.y) || 0) - (Number(squad?.y) || 0)
  );
  const retentionRadius = formationEnvelope.hardRadius + (acquisitionRadius * 1.35);
  if (anchorDistance > retentionRadius) return null;
  if (
    Number(agent?._combatTargetLockUntil) > Number(nowSec)
    || anchorDistance <= formationEnvelope.hardRadius + acquisitionRadius
  ) {
    return {
      target,
      centerDistance,
      edgeDistance: resolveAgentEdgeDistanceToAgent(agent, target),
      acquisitionRadius,
      retained: true
    };
  }
  return null;
};

const resolveAllyEngagementCandidate = ({
  agent = {},
  squad = {},
  sim = {},
  crowd = {},
  agentMap = new Map(),
  squadMap = new Map(),
  attackRange = {}
} = {}) => {
  const ownAgents = crowd?.agentsBySquad?.get?.(squad?.id) || [];
  const acquisitionRadius = resolveAgentCombatAcquisitionRadius(agent, squad, attackRange);
  const targetCounts = new Map();
  ownAgents.forEach((ally) => {
    if (!ally || ally.dead || ally.id === agent.id || ally.unitCategory === SKILL_CATEGORY_SUPPORT) return;
    const target = ally.targetAgentId ? agentMap.get(String(ally.targetAgentId)) : null;
    if (!target || target.dead) return;
    const targetSquad = squadMap.get(String(target.squadId || '')) || null;
    if (!targetSquad || !canAcquireSquadTarget(squad, targetSquad)) return;
    const distance = Math.hypot(
      (Number(target.x) || 0) - (Number(agent.x) || 0),
      (Number(target.y) || 0) - (Number(agent.y) || 0)
    );
    if (distance > acquisitionRadius * 1.45) return;
    if (isTrainingMinionSquad(squad) && !isPointWithinTrainingRoadSearchBand(target, squad, sim)) return;
    const key = String(target.id || '');
    const current = targetCounts.get(key) || { target, targetSquad, count: 0, distance };
    current.count += 1;
    current.distance = Math.min(current.distance, distance);
    targetCounts.set(key, current);
  });
  const selected = [...targetCounts.values()]
    .sort((left, right) => (
      right.count - left.count
      || Number(String(left.targetSquad?.id || '') === String(resolveSquadCombatTargetId(squad) || '')) * -1
      || left.distance - right.distance
      || String(left.target?.id || '').localeCompare(String(right.target?.id || ''))
    ))[0];
  if (!selected) return null;
  return {
    target: selected.target,
    centerDistance: Math.hypot(
      (Number(selected.target.x) || 0) - (Number(agent.x) || 0),
      (Number(selected.target.y) || 0) - (Number(agent.y) || 0)
    ),
    edgeDistance: resolveAgentEdgeDistanceToAgent(agent, selected.target),
    acquisitionRadius,
    assisted: true
  };
};

const resolveSquadFormationEnvelope = (squad = {}) => {
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  const slotSpan = (Array.isArray(squad?.deploySlots) ? squad.deploySlots : []).reduce((maximum, slot) => (
    Math.max(maximum, Math.hypot(Number(slot?.side) || 0, Number(slot?.front) || 0))
  ), 0);
  const radius = Math.max(8, Number(squad?.radius) || 0);
  const width = Math.max(AGENT_RADIUS * 4, Number(formation?.width) || radius * 1.8);
  const depth = Math.max(AGENT_RADIUS * 4, Number(formation?.depth) || radius * 1.2);
  const formationSpan = Math.max(slotSpan, Math.hypot(width, depth) * 0.5);
  return {
    formationSpan,
    softRadius: Math.max(28, formationSpan + AGENT_COMBAT_SOFT_TETHER_MARGIN),
    hardRadius: Math.max(44, formationSpan + AGENT_COMBAT_HARD_TETHER_MARGIN)
  };
};

const resolveSquadFormationProjectedExtent = (squad = {}, toward = {}) => {
  const direction = normalizeVec(Number(toward?.x) || 0, Number(toward?.y) || 0);
  const fallbackRadius = Math.max(8, Number(squad?.radius) || 0);
  if (direction.len <= 0.0001) return fallbackRadius;
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  const forward = resolveSquadFormationForward(squad);
  const side = { x: -forward.y, y: forward.x };
  const halfDepth = Math.max(AGENT_RADIUS * 2, Number(formation?.depth) * 0.5 || fallbackRadius * 0.72);
  const halfWidth = Math.max(AGENT_RADIUS * 2, Number(formation?.width) * 0.5 || fallbackRadius);
  return Math.max(
    fallbackRadius,
    (Math.abs((direction.x * forward.x) + (direction.y * forward.y)) * halfDepth)
      + (Math.abs((direction.x * side.x) + (direction.y * side.y)) * halfWidth)
      + AGENT_RADIUS
  );
};

const resolveSquadFormationEdgeGap = (source = {}, target = {}) => {
  const direction = normalizeVec(
    (Number(target?.x) || 0) - (Number(source?.x) || 0),
    (Number(target?.y) || 0) - (Number(source?.y) || 0)
  );
  if (direction.len <= 0.0001) return 0;
  return Math.max(
    0,
    direction.len
      - resolveSquadFormationProjectedExtent(source, direction)
      - resolveSquadFormationProjectedExtent(target, { x: -direction.x, y: -direction.y })
  );
};

const resolveSquadCombatEntryGap = (squad = {}) => {
  const attackRange = resolveSquadAttackRange(squad);
  return isRangedSquad(squad)
    ? Math.max(12, Number(attackRange?.max) || 0)
    : Math.max(8, (Number(attackRange?.max) || 0) + 6);
};

const resolveSquadAgentCombatReadiness = ({
  squad = {},
  target = {},
  sim = {},
  crowd = null
} = {}) => {
  const sourceAgents = crowd?.agentsBySquad?.get?.(squad?.id);
  const targetAgents = crowd?.agentsBySquad?.get?.(target?.id);
  if (!Array.isArray(sourceAgents) || !Array.isArray(targetAgents)) return null;
  const sources = sourceAgents.filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001);
  const targets = targetAgents.filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001);
  if (sources.length <= 0 || targets.length <= 0) {
    return {
      known: true,
      ready: false,
      hasAgentTarget: false,
      canAcquire: false,
      underAttack: false,
      minimumCenterDistance: Infinity
    };
  }
  const sourceRanges = new Map(sources.map((agent) => [
    agent.id,
    resolveAgentCombatAcquisitionRadius(agent, squad)
  ]));
  let hasAgentTarget = false;
  let canAcquire = false;
  let minimumCenterDistance = Infinity;
  sources.forEach((sourceAgent) => {
    const sourceRange = sourceRanges.get(sourceAgent.id) || AGENT_MELEE_ACQUISITION_RADIUS;
    targets.forEach((targetAgent) => {
      const centerDistance = Math.hypot(
        (Number(targetAgent.x) || 0) - (Number(sourceAgent.x) || 0),
        (Number(targetAgent.y) || 0) - (Number(sourceAgent.y) || 0)
      );
      minimumCenterDistance = Math.min(minimumCenterDistance, centerDistance);
      const sourceCanFight = sourceAgent?.unitCategory !== SKILL_CATEGORY_SUPPORT
        && sourceAgent?._formationDetached !== true;
      const sourceRoadEligible = !isTrainingMinionSquad(squad)
        || isPointWithinTrainingRoadSearchBand(targetAgent, squad, sim);
      if (
        sourceCanFight
        && sourceRoadEligible
        && String(sourceAgent?.targetAgentId || '') === String(targetAgent?.id || '')
        && centerDistance <= sourceRange * 1.45
      ) hasAgentTarget = true;
      if (sourceCanFight && sourceRoadEligible && centerDistance <= sourceRange) canAcquire = true;
    });
  });
  const underAttack = (
    (Number(squad?.underAttackTimer) || 0) > 0.05
    && String(squad?.lastDamagedBySquadId || '') === String(target?.id || '')
  ) || (
    (Number(target?.underAttackTimer) || 0) > 0.05
    && String(target?.lastDamagedBySquadId || '') === String(squad?.id || '')
  );
  return {
    known: true,
    ready: hasAgentTarget || canAcquire || underAttack,
    hasAgentTarget,
    canAcquire,
    underAttack,
    minimumCenterDistance
  };
};

const syncSquadAgentCombatLock = ({
  squad = null,
  agents = [],
  agentMap = new Map(),
  squadMap = new Map(),
  nowSec = 0
} = {}) => {
  if (!squad) return '';
  const targetCounts = new Map();
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent || agent.dead || !agent.targetAgentId || agent.unitCategory === SKILL_CATEGORY_SUPPORT) return;
    const targetAgent = agentMap.get(String(agent.targetAgentId || '')) || null;
    const targetSquad = targetAgent ? squadMap.get(targetAgent.squadId) || null : null;
    if (!targetAgent || targetAgent.dead || !targetSquad || (Number(targetSquad.remain) || 0) <= 0) return;
    if (!canAcquireSquadTarget(squad, targetSquad)) return;
    const acquisitionRadius = resolveAgentCombatAcquisitionRadius(agent, squad);
    if (Math.hypot(
      (Number(targetAgent.x) || 0) - (Number(agent.x) || 0),
      (Number(targetAgent.y) || 0) - (Number(agent.y) || 0)
    ) > acquisitionRadius * 1.45) return;
    const targetId = String(targetSquad.id || '');
    targetCounts.set(targetId, (targetCounts.get(targetId) || 0) + 1);
  });
  const damagedById = (Number(squad?.underAttackTimer) || 0) > 0.05
    ? String(squad?.lastDamagedBySquadId || '')
    : '';
  if (damagedById && squadMap.get(damagedById)?.remain > 0) {
    targetCounts.set(damagedById, (targetCounts.get(damagedById) || 0) + 1);
  }
  const preferredTargetId = String(squad?.targetSquadId || '');
  const activeTargetId = targetCounts.has(preferredTargetId)
    ? preferredTargetId
    : ([...targetCounts.entries()].sort((left, right) => (
      right[1] - left[1] || left[0].localeCompare(right[0])
    ))[0]?.[0] || '');
  if (activeTargetId) {
    squad._combatEngagementTargetId = activeTargetId;
    squad._combatEngagementUntil = nowSec + SQUAD_COMBAT_LOCK_RELEASE_SEC;
    return activeTargetId;
  }
  const lockedTargetId = String(squad?._combatEngagementTargetId || '');
  const lockedTarget = squadMap.get(lockedTargetId) || null;
  if (!lockedTarget || (Number(lockedTarget.remain) || 0) <= 0 || !canAcquireSquadTarget(squad, lockedTarget)) {
    squad._combatEngagementTargetId = '';
    squad._combatEngagementUntil = 0;
    return '';
  }
  if ((Number(squad?._combatEngagementUntil) || 0) <= nowSec) {
    squad._combatEngagementTargetId = '';
    squad._combatEngagementUntil = 0;
    return '';
  }
  return lockedTargetId;
};

const resolveSquadCombatLockedTarget = (squad = {}, sim = {}, nowSec = 0) => {
  const targetId = String(squad?._combatEngagementTargetId || '');
  if (!targetId || (Number(squad?._combatEngagementUntil) || 0) <= nowSec) return null;
  const target = (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
    String(candidate?.id || '') === targetId
    && (Number(candidate?.remain) || 0) > 0
    && canAcquireSquadTarget(squad, candidate)
  )) || null;
  if (!target) {
    squad._combatEngagementTargetId = '';
    squad._combatEngagementUntil = 0;
  }
  return target;
};

const shouldHoldSquadCombatTarget = (squad = {}, target = {}, nowSec = 0, readiness = null) => {
  if (!target || (Number(target?.remain) || 0) <= 0) return false;
  const targetId = String(target.id || '');
  const entryGap = resolveSquadCombatEntryGap(squad);
  const formationGap = resolveSquadFormationEdgeGap(squad, target);
  const locked = String(squad?._combatEngagementTargetId || '') === targetId
    && (Number(squad?._combatEngagementUntil) || 0) > nowSec;
  if (readiness?.known === true) {
    if (!readiness.ready) return false;
    squad._combatEngagementTargetId = targetId;
    squad._combatEngagementUntil = nowSec + SQUAD_COMBAT_LOCK_RELEASE_SEC;
    return true;
  }
  if (formationGap <= entryGap) {
    squad._combatEngagementTargetId = targetId;
    squad._combatEngagementUntil = nowSec + SQUAD_COMBAT_LOCK_RELEASE_SEC;
    return true;
  }
  if (!locked) return false;
  if (formationGap <= entryGap + SQUAD_COMBAT_EXIT_GAP) {
    squad._combatEngagementUntil = nowSec + SQUAD_COMBAT_LOCK_RELEASE_SEC;
  }
  return true;
};

const resolveSquadCombatTargetId = (squad = {}) => {
  const activeTargetId = String(squad?.targetSquadId || '').trim();
  if (activeTargetId) return activeTargetId;
  const engagementTargetId = String(squad?._combatEngagementTargetId || '').trim();
  if (engagementTargetId) return engagementTargetId;
  if ((Number(squad?.underAttackTimer) || 0) <= 0.05) return '';
  return String(squad?.lastDamagedBySquadId || '').trim();
};

const resolveAgentObjectiveCandidates = (squad = {}, sim = {}) => {
  const objectives = Array.isArray(sim?.trainingObjectives) ? sim.trainingObjectives : [];
  const buildings = Array.isArray(sim?.buildings) ? sim.buildings : [];
  const buildingById = sim?._trainingObjectiveBuildingById instanceof Map
    ? sim._trainingObjectiveBuildingById
    : new Map(buildings.filter((building) => building?.id).map((building) => [String(building.id), building]));
  const explicitBuildingIds = new Set([
    String(squad?.order?.targetBuildingId || ''),
    String(squad?.targetBuildingId || '')
  ].filter(Boolean));
  const targetOnlyAttack = isTargetOnlyAttackOrder(squad);
  return objectives.reduce((rows, objective) => {
    if (!objective || objective.destroyed || objective.targetable === false) return rows;
    if (!isHostileTeam(squad?.team, objective?.team)) return rows;
    const building = buildingById.get(String(objective?.sourceObjectId || '')) || null;
    if (!building || building.destroyed) return rows;
    const buildingId = String(building.id || '');
    const explicitlyTargeted = explicitBuildingIds.has(buildingId);
    if (targetOnlyAttack && !explicitlyTargeted) return rows;
    if (objective?.team === TEAM_NEUTRAL && !explicitlyTargeted) return rows;
    rows.push({ objective, building, explicitlyTargeted });
    return rows;
  }, []);
};

const resolveHostileAgentCandidates = ({
  agent = {},
  squad = {},
  sim = {},
  crowd = {},
  spatial = null,
  squadMap = new Map(),
  agentMap = new Map(),
  nowSec = 0,
  attackRange = {},
  cardTacticalIntent = null
} = {}) => {
  const formationEnvelope = resolveSquadFormationEnvelope(squad);
  const tacticalIntent = cardTacticalIntent || resolveTrainingCardAgentTacticalIntent({
    agent,
    squad,
    crowd,
    agentMap,
    squadMap,
    nowSec
  });
  const controllerLeash = tacticalIntent?.combatLeash || null;
  const agentAnchorDistance = Math.hypot(
    (Number(agent?.x) || 0) - (Number(squad?.x) || 0),
    (Number(agent?.y) || 0) - (Number(squad?.y) || 0)
  );
  if (agentAnchorDistance > (controllerLeash?.hard || formationEnvelope.hardRadius)) return null;
  const controllerTarget = tacticalIntent?.combatTarget || null;
  if (controllerTarget) {
    return {
      target: controllerTarget,
      centerDistance: Math.hypot(
        (Number(controllerTarget?.x) || 0) - (Number(agent?.x) || 0),
        (Number(controllerTarget?.y) || 0) - (Number(agent?.y) || 0)
      ),
      edgeDistance: resolveAgentEdgeDistanceToAgent(agent, controllerTarget),
      acquisitionRadius: Math.max(
        AGENT_MELEE_ACQUISITION_RADIUS,
        (Number(attackRange?.max) || 0) + (isRangedAgent(agent) ? 34 : 22)
      ),
      controllerAssigned: true
    };
  }
  const preferredTargetSquadId = resolveSquadCombatTargetId(squad);
  if (!preferredTargetSquadId) return null;
  const retainedTarget = resolveAgentCombatTargetMemory({
    agent,
    squad,
    sim,
    agentMap,
    squadMap,
    attackRange,
    nowSec
  });
  if (retainedTarget?.target) return retainedTarget;
  const acquisitionRadius = Math.max(
    AGENT_MELEE_ACQUISITION_RADIUS,
    (Number(attackRange?.max) || 0) + (isRangedAgent(agent) ? 34 : 22)
  );
  const targetAnchorRadius = formationEnvelope.hardRadius + Math.max(
    18,
    Math.min(acquisitionRadius * 0.72, (Number(attackRange?.max) || 0) + 40)
  );
  const candidates = querySpatialNearby(spatial, agent.x, agent.y, acquisitionRadius)
    .filter((target) => {
      if (!target || target.dead || !isHostileTeam(agent?.team, target?.team)) return false;
      if (Math.hypot(
        (Number(target?.x) || 0) - (Number(agent?.x) || 0),
        (Number(target?.y) || 0) - (Number(agent?.y) || 0)
      ) > acquisitionRadius) return false;
      const targetSquad = squadMap.get(target.squadId) || null;
      if (!targetSquad || !canAcquireSquadTarget(squad, targetSquad) || isEnemyHiddenForViewer(targetSquad, squad?.team)) return false;
      if (preferredTargetSquadId) {
        if (String(target?.squadId || '') !== preferredTargetSquadId) return false;
      } else {
        return false;
      }
      if (Math.hypot(
        (Number(target?.x) || 0) - (Number(squad?.x) || 0),
        (Number(target?.y) || 0) - (Number(squad?.y) || 0)
      ) > targetAnchorRadius) return false;
      return true;
    });
  const assistedTarget = resolveAllyEngagementCandidate({
    agent,
    squad,
    sim,
    crowd,
    agentMap,
    squadMap,
    attackRange
  });
  if (candidates.length <= 0 && assistedTarget?.target && !isTargetOnlyAttackOrder(squad)) return assistedTarget;
  if (candidates.length <= 0) return null;
  const nearestEdge = candidates.reduce((best, target) => Math.min(
    best,
    resolveAgentEdgeDistanceToAgent(agent, target)
  ), Infinity);
  const nearBand = candidates.filter((target) => (
    resolveAgentEdgeDistanceToAgent(agent, target) <= nearestEdge + AGENT_COMBAT_TARGET_TIE_DISTANCE
  ));
  const picked = isRangedAgent(agent)
    ? pickRangedEnemyAgent(agent, nearBand, attackRange)
    : nearBand.slice().sort((left, right) => (
      resolveAgentEdgeDistanceToAgent(agent, left) - resolveAgentEdgeDistanceToAgent(agent, right)
      || resolveAgentHealthRatio(left) - resolveAgentHealthRatio(right)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))[0];
  if (!picked) return null;
  return {
    target: picked,
    centerDistance: Math.hypot(
      (Number(picked.x) || 0) - (Number(agent.x) || 0),
      (Number(picked.y) || 0) - (Number(agent.y) || 0)
    ),
    edgeDistance: resolveAgentEdgeDistanceToAgent(agent, picked),
    acquisitionRadius
  };
};

const resolveBuildingAgentCandidate = (agent = {}, objectiveCandidates = [], acquisitionRadius = 0) => (
  (Array.isArray(objectiveCandidates) ? objectiveCandidates : [])
    .map((entry) => ({
      ...entry,
      edgeDistance: resolveAgentEdgeDistanceToBuilding(agent, entry?.building)
    }))
    .filter((entry) => entry.edgeDistance <= acquisitionRadius)
    .sort((left, right) => (
      left.edgeDistance - right.edgeDistance
      || Number(right.explicitlyTargeted) - Number(left.explicitlyTargeted)
      || String(left?.building?.id || '').localeCompare(String(right?.building?.id || ''))
    ))[0] || null
);

const resolveSupportAllyCandidate = ({
  agent = {},
  squad = {},
  crowd = {},
  nowSec = 0,
  cardTacticalIntent = null
} = {}) => {
  const tacticalIntent = cardTacticalIntent || resolveTrainingCardAgentTacticalIntent({
    agent,
    squad,
    crowd,
    nowSec
  });
  const controllerTarget = tacticalIntent?.supportTarget || null;
  if (controllerTarget) {
    const distance = Math.hypot(
      (Number(controllerTarget?.x) || 0) - (Number(agent?.x) || 0),
      (Number(controllerTarget?.y) || 0) - (Number(agent?.y) || 0)
    );
    if (distance <= SUPPORT_ACQUISITION_RADIUS) {
      return { squad, target: controllerTarget, distance, controllerAssigned: true };
    }
  }
  const allyAgents = (crowd?.agentsBySquad?.get(squad.id) || [])
    .filter((target) => target && !target.dead && target.unitCategory !== SKILL_CATEGORY_SUPPORT);
  if (allyAgents.length <= 0) return null;
  const fightingAgents = allyAgents.filter((target) => (
    !!target.targetAgentId
    || !!target.targetBuildingId
    || !!target.engagePairKey
    || target.state === 'attack'
  ));
  const holdingCombatTarget = (
    !!squad.targetSquadId || !!squad.targetBuildingId
  ) && (!Array.isArray(squad?.waypoints) || squad.waypoints.length <= 0);
  const activelyFighting = fightingAgents.length > 0
    || holdingCombatTarget
    || (Number(squad.underAttackTimer) || 0) > 0.05;
  if (!activelyFighting) return null;
  const pool = fightingAgents.length > 0 ? fightingAgents : allyAgents;
  const targetAgent = pool.slice().sort((left, right) => (
    Math.hypot((left.x || 0) - (agent.x || 0), (left.y || 0) - (agent.y || 0))
      - Math.hypot((right.x || 0) - (agent.x || 0), (right.y || 0) - (agent.y || 0))
  ))[0] || null;
  if (!targetAgent) return null;
  const distance = Math.hypot(
    (Number(targetAgent.x) || 0) - (Number(agent.x) || 0),
    (Number(targetAgent.y) || 0) - (Number(agent.y) || 0)
  );
  if (distance > SUPPORT_ACQUISITION_RADIUS) return null;
  return { squad, target: targetAgent, distance };
};

const castAgentSupportEffect = ({
  agent = {},
  squad = {},
  targetSquad = null,
  targetAgent = null,
  crowd = {},
  hostile = false,
  castRange = 0
} = {}) => {
  if (!targetSquad || !targetAgent || (Number(agent.supportCastCd) || 0) > 0) return false;
  const distance = Math.hypot(
    (Number(targetAgent.x) || 0) - (Number(agent.x) || 0),
    (Number(targetAgent.y) || 0) - (Number(agent.y) || 0)
  );
  if (distance > Math.max(1, Number(castRange) || 0)) return false;
  const direction = normalizeVec(
    (Number(targetAgent.x) || 0) - (Number(agent.x) || 0),
    (Number(targetAgent.y) || 0) - (Number(agent.y) || 0)
  );
  const subtype = String(agent?.unitSubtype || 'comprehensive');
  const statusEffect = hostile
    ? {
      id: `support-intervention:${agent.id}`,
      type: 'debuff',
      durationSec: 2.8,
      atkMul: 0.88,
      defMul: 0.96,
      speedMul: 0.82
    }
    : subtype === 'combination'
      ? {
        id: `support-combination:${agent.id}`,
        type: 'buff',
        durationSec: 3.2,
        atkMul: 1.1,
        defMul: 1.06,
        speedMul: 1.04
      }
      : {
        id: `support-comprehensive:${agent.id}`,
        type: 'buff',
        durationSec: 3.2,
        atkMul: 1.06,
        defMul: 1.08,
        speedMul: 1.05
      };
  applySquadStatusEffect(targetSquad, statusEffect);
  beginAgentCast(agent, {
    style: 'support',
    durationSec: 0.42,
    dirX: direction.x,
    dirY: direction.y,
    targetX: targetAgent.x,
    targetY: targetAgent.y
  });
  acquireHitEffect(crowd.effectsPool, {
    type: hostile ? 'debuff_aura' : 'buff_aura',
    x: Number(targetAgent.x) || 0,
    y: Number(targetAgent.y) || 0,
    z: 1.2,
    radius: 6.8,
    ttl: 0.34,
    team: squad.team
  });
  acquireHitEffect(crowd.effectsPool, {
    type: 'cast_pulse',
    x: Number(agent.x) || 0,
    y: Number(agent.y) || 0,
    z: 1.4,
    radius: 4.4,
    ttl: 0.28,
    team: squad.team
  });
  agent.supportCastCd = SUPPORT_CAST_COOLDOWN_SEC + ((Number(agent.slotOrder) || 0) % 3) * 0.16;
  agent.state = 'attack';
  return true;
};

const resolveSupportCombatDirective = ({
  agent = {},
  squad = {},
  sim = {},
  crowd = {},
  spatial = null,
  squadMap = new Map(),
  agentMap = new Map(),
  nowSec = 0,
  attackRange = {},
  cardTacticalIntent = null
} = {}) => {
  const castRange = clamp(Math.max(36, Number(attackRange?.max) || 0), 36, 88);
  if (String(agent?.unitSubtype || '') === 'intervention') {
    const enemy = resolveHostileAgentCandidates({
      agent,
      squad,
      sim,
      crowd,
      spatial,
      squadMap,
      agentMap,
      nowSec,
      attackRange,
      cardTacticalIntent
    });
    if (!enemy?.target) return null;
    const targetSquad = squadMap.get(enemy.target.squadId) || null;
    agent.supportTargetAgentId = enemy.target.id;
    agent.supportTargetSquadId = enemy.target.squadId;
    castAgentSupportEffect({
      agent,
      squad,
      targetSquad,
      targetAgent: enemy.target,
      crowd,
      hostile: true,
      castRange
    });
    return {
      kind: 'support-enemy',
      target: enemy.target,
      distance: enemy.centerDistance,
      attackRange: { min: 0, max: castRange },
      formationBound: true
    };
  }
  const ally = resolveSupportAllyCandidate({ agent, squad, crowd, nowSec, cardTacticalIntent });
  if (!ally?.target) return null;
  agent.supportTargetAgentId = ally.target.id;
  agent.supportTargetSquadId = ally.squad.id;
  castAgentSupportEffect({
    agent,
    squad,
    targetSquad: ally.squad,
    targetAgent: ally.target,
    crowd,
    hostile: false,
    castRange
  });
  return {
    kind: 'support-ally',
    target: ally.target,
    distance: ally.distance,
    attackRange: { min: 0, max: castRange },
    formationBound: true
  };
};

const resolveAgentCombatDirective = ({
  agent = {},
  squad = {},
  sim = {},
  crowd = {},
  spatial = null,
  squadMap = new Map(),
  agentMap = new Map(),
  nowSec = 0,
  objectiveCandidates = [],
  cardTacticalIntent = null
} = {}) => {
  agent.supportCastCd = Math.max(0, Number(agent.supportCastCd) || 0);
  if (!isSquadCombatEnabled(squad)) {
    clearAgentCombatTargets(agent);
    return null;
  }
  if (isTrainingMinionSquad(squad)) {
    return resolveMinionSquadAgentCombatDirective({
      agent,
      squad,
      sim,
      crowd,
      squadMap,
      agentMap,
      castSupportEffect: castAgentSupportEffect
    });
  }
  if (isTrainingNeutralSquad(squad)) {
    return resolveNeutralCampCombatDirective({
      agent,
      squad,
      sim,
      crowd,
      squadMap,
      agentMap
    });
  }
  const formationEnvelope = resolveSquadFormationEnvelope(squad);
  const tacticalIntent = cardTacticalIntent || resolveTrainingCardAgentTacticalIntent({
    agent,
    squad,
    crowd,
    agentMap,
    squadMap,
    nowSec
  });
  const controllerLeash = tacticalIntent?.combatLeash || null;
  const controllerState = agent?._squadController || {};
  const passageState = String(controllerState?.locomotionState || '');
  const activePassagePlanId = Math.floor(Number(squad?._squadController?.passagePlan?.id) || 0);
  const agentPassageId = Math.floor(Number(controllerState?.passageId) || 0);
  const inCardPassage = isTrainingCardSquad(squad)
    && isTrainingCardPassageState(passageState)
    && activePassagePlanId > 0
    && agentPassageId === activePassagePlanId;
  agent._formationDetached = inCardPassage
    && agent?._formationRecovery?.active !== true
    && controllerState?.rejoin?.active !== true
    ? false
    : Math.hypot(
      (Number(agent?.x) || 0) - (Number(squad?.x) || 0),
      (Number(agent?.y) || 0) - (Number(squad?.y) || 0)
    ) > (controllerLeash?.hard || formationEnvelope.hardRadius);
  if (agent._formationDetached) {
    clearAgentCombatTargets(agent);
    return null;
  }
  const attackRange = resolveAgentAttackRange(agent, squad);
  if (agent.unitCategory === SKILL_CATEGORY_SUPPORT) {
    agent.targetAgentId = '';
    agent.targetBuildingId = '';
    const directive = resolveSupportCombatDirective({
      agent,
      squad,
      sim,
      crowd,
      spatial,
      squadMap,
      agentMap,
      nowSec,
      attackRange,
      cardTacticalIntent: tacticalIntent
    });
    if (!directive) {
      agent.supportTargetAgentId = '';
      agent.supportTargetSquadId = '';
    }
    agent._combatDirective = directive;
    return directive;
  }
  agent.supportTargetAgentId = '';
  agent.supportTargetSquadId = '';
  const enemy = resolveHostileAgentCandidates({
    agent,
    squad,
    sim,
    crowd,
    spatial,
    squadMap,
    agentMap,
    nowSec,
    attackRange,
    cardTacticalIntent: tacticalIntent
  });
  const acquisitionRadius = resolveAgentCombatAcquisitionRadius(agent, squad, attackRange);
  const building = resolveBuildingAgentCandidate(agent, objectiveCandidates, acquisitionRadius);
  const committedEnemyId = resolveSquadCombatTargetId(squad);
  const committedEnemy = committedEnemyId
    ? squadMap.get(committedEnemyId) || null
    : null;
  const enemyCommitActive = !!committedEnemy
    && (Number(committedEnemy?.remain) || 0) > 0
    && canAcquireSquadTarget(squad, committedEnemy);
  const chooseEnemy = !!enemy?.target && (
    !building
    || enemy.edgeDistance <= building.edgeDistance + AGENT_COMBAT_TARGET_TIE_DISTANCE
  );
  if (chooseEnemy) {
    agent.targetAgentId = enemy.target.id;
    agent.targetBuildingId = '';
    agent._combatTargetSquadId = String(enemy.target?.squadId || '');
    if (!enemy.retained) {
      agent._combatTargetLockUntil = Math.max(
        Number(agent?._combatTargetLockUntil) || 0,
        Number(nowSec) + AGENT_COMBAT_TARGET_LOCK_SEC
      );
    }
    const directive = {
      kind: 'enemy-agent',
      target: enemy.target,
      distance: enemy.centerDistance,
      edgeDistance: enemy.edgeDistance,
      attackRange
    };
    agent._combatDirective = directive;
    return directive;
  }
  if (building?.building && !enemyCommitActive) {
    agent.targetAgentId = '';
    agent.targetBuildingId = String(building.building.id || '');
    agent._combatTargetLockUntil = 0;
    agent._combatTargetSquadId = '';
    const directive = {
      kind: 'enemy-building',
      target: building.building,
      objective: building.objective,
      distance: building.edgeDistance,
      edgeDistance: building.edgeDistance,
      targetRadius: resolveBuildingTargetRadius(building.building),
      attackRange
    };
    agent._combatDirective = directive;
    return directive;
  }
  clearAgentCombatTargets(agent);
  return null;
};

const resolveAgentCombatSteering = (agent = {}, directive = null) => {
  if (!directive?.target) return null;
  if (directive.formationBound) {
    return { x: 0, y: 0, moving: false, holding: false, distance: Number(directive?.distance) || 0 };
  }
  const target = directive.target;
  const targetDirection = normalizeVec(
    (Number(target.x) || 0) - (Number(agent.x) || 0),
    (Number(target.y) || 0) - (Number(agent.y) || 0)
  );
  const engagement = directive.kind === 'enemy-agent'
    && String(agent?._squadController?.engagement?.targetId || '') === String(target?.id || '')
    ? agent._squadController.engagement
    : null;
  const engagementDirection = engagement
    ? normalizeVec(
      (Number(engagement?.x) || 0) - (Number(agent?.x) || 0),
      (Number(engagement?.y) || 0) - (Number(agent?.y) || 0)
    )
    : targetDirection;
  const attackRange = directive.attackRange || {};
  const minRange = Math.max(0, Number(attackRange.min) || 0);
  const maxRange = Math.max(minRange, Number(attackRange.max) || 0);
  const distance = directive.kind === 'enemy-building'
    ? resolveAgentEdgeDistanceToBuilding(agent, target)
    : targetDirection.len;
  const engagementDistance = engagement ? engagementDirection.len : distance;
  const holdsPositionWhileAttacking = agent?.typeCategory !== 'cavalry';
  const shouldRetreat = minRange > 0 && distance < Math.max(2, minRange * 0.88);
  const shouldApproach = engagement
    ? engagementDistance > Math.max(1.2, Number(agent?.radius) || AGENT_RADIUS)
    : distance > Math.max(
      2,
      holdsPositionWhileAttacking ? maxRange : maxRange * 0.94
    );
  if (shouldRetreat) {
    return { x: -targetDirection.x, y: -targetDirection.y, moving: true, holding: false, distance };
  }
  if (shouldApproach) {
    return {
      x: engagementDirection.x,
      y: engagementDirection.y,
      moving: true,
      holding: false,
      distance,
      engagement: !!engagement
    };
  }
  return {
    x: 0,
    y: 0,
    moving: false,
    holding: true,
    lockPosition: holdsPositionWhileAttacking,
    distance
  };
};

const computeTeamAwareSeparation = (
  agent,
  neighbors = [],
  sameTeamGap = 5.2,
  { allowOwnSquadSoftSeparation = true } = {}
) => {
  if (agent?.isFlagBearer && agent?.isMinionWaveUnit !== true) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  neighbors.forEach((other) => {
    if (
      !other
      || other.id === agent.id
      || other.dead
      || (other.isFlagBearer && other.isMinionWaveUnit !== true)
    ) return;
    const dx = (agent.x || 0) - (other.x || 0);
    const dy = (agent.y || 0) - (other.y || 0);
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.0001) return;
    const sameTeam = other.team === agent.team;
    const sameSquad = sameTeam && other.squadId === agent.squadId;
    const bothMelee = isMeleeAgent(agent) && isMeleeAgent(other);
    let targetGap = sameTeam ? sameTeamGap : CROWD_ENEMY_TARGET_GAP;
    let strength = sameTeam ? CROWD_SAME_TEAM_SEP_STRENGTH : CROWD_ENEMY_SEP_STRENGTH;
    if (sameSquad && !allowOwnSquadSoftSeparation) {
      targetGap = CROWD_HARD_CONTACT_GAP;
      strength = CROWD_HARD_CONTACT_STRENGTH;
    }
    if (!sameTeam && bothMelee) {
      strength = CROWD_ENEMY_MELEE_SEP_STRENGTH;
      targetGap = Math.min(targetGap, AGENT_RADIUS * 1.05);
    }
    if (dist >= targetGap) return;
    if (sameTeam && dist < CROWD_HARD_CONTACT_GAP) {
      strength = Math.max(strength, CROWD_HARD_CONTACT_STRENGTH);
    }
    const push = ((targetGap - dist) / targetGap) * strength;
    sx += (dx / dist) * push;
    sy += (dy / dist) * push;
  });
  return { x: sx, y: sy };
};

const resolvePassageFlowSteering = ({
  agent = null,
  squad = null,
  flowIntent = null,
  neighbors = []
} = {}) => {
  if (
    !agent
    || !squad
    || !flowIntent
    || flowIntent?.detached === true
    || (!flowIntent.active && !flowIntent.expanding)
  ) return null;
  const forward = normalizeVec(flowIntent?.directionX, flowIntent?.directionY);
  if (forward.len <= 0.0001) return null;
  const side = { x: -forward.y, y: forward.x };
  const laneCount = Math.max(1, Math.floor(Number(flowIntent?.laneCount) || 1));
  const lane = clamp(Math.floor(Number(flowIntent?.lane) || 0), 0, laneCount - 1);
  const laneSpacing = Math.max(AGENT_RADIUS * 2.04, Number(flowIntent?.laneSpacing) || 0);
  const queueSpacing = Math.max(AGENT_RADIUS * 2.08, Number(flowIntent?.queueSpacing) || laneSpacing);
  const desiredLaneOffset = (lane - ((laneCount - 1) * 0.5)) * laneSpacing;
  const relativeX = (Number(agent?.x) || 0) - (Number(squad?.x) || 0);
  const relativeY = (Number(agent?.y) || 0) - (Number(squad?.y) || 0);
  const currentLaneOffset = (relativeX * side.x) + (relativeY * side.y);
  const laneError = desiredLaneOffset - currentLaneOffset;
  let nearestFront = Infinity;
  (Array.isArray(neighbors) ? neighbors : []).forEach((other) => {
    if (!other || other === agent || other.dead || other.squadId !== agent.squadId) return;
    const dx = (Number(other?.x) || 0) - (Number(agent?.x) || 0);
    const dy = (Number(other?.y) || 0) - (Number(agent?.y) || 0);
    const longitudinal = (dx * forward.x) + (dy * forward.y);
    const lateral = Math.abs((dx * side.x) + (dy * side.y));
    if (longitudinal <= 0 || lateral > laneSpacing * 0.78) return;
    nearestFront = Math.min(nearestFront, longitudinal);
  });
  const queuePressure = Number.isFinite(nearestFront)
    ? clamp((queueSpacing - nearestFront) / Math.max(0.5, queueSpacing), 0, 1)
    : 0;
  const formationWeight = clamp(Number(flowIntent?.formationWeight) || 0, 0, 1);
  const laneWeight = (flowIntent.active ? 0.46 : 0.24) * (1 - (formationWeight * 0.5));
  const laneSteer = clamp(laneError / Math.max(1, laneSpacing), -1, 1) * laneWeight;
  return {
    forwardX: forward.x,
    forwardY: forward.y,
    laneX: side.x * laneSteer,
    laneY: side.y * laneSteer,
    queuePressure,
    formationWeight,
    // This is a moving corridor look-ahead, not a persistent 2D slot.  It is
    // intentionally the recovery progress goal while an agent is in flow.
    goalX: (Number(agent?.x) || 0) + (forward.x * Math.max(queueSpacing * 2.4, 11)) + (side.x * clamp(laneError, -laneSpacing, laneSpacing)),
    goalY: (Number(agent?.y) || 0) + (forward.y * Math.max(queueSpacing * 2.4, 11)) + (side.y * clamp(laneError, -laneSpacing, laneSpacing))
  };
};

const computeStreamSeparation = ({
  agent = null,
  neighbors = [],
  flowIntent = null,
  targetGap = 4.8
} = {}) => {
  if (!agent || !flowIntent) return { x: 0, y: 0 };
  const forward = normalizeVec(flowIntent.forwardX, flowIntent.forwardY);
  const side = { x: -forward.y, y: forward.x };
  const streamId = Math.floor(Number(flowIntent.streamId) || 0);
  const passageId = Math.floor(Number(flowIntent.passageId) || 0);
  let sx = 0;
  let sy = 0;
  (Array.isArray(neighbors) ? neighbors : []).forEach((other) => {
    if (!other || other === agent || other.dead || String(other?.squadId || '') !== String(agent?.squadId || '')) return;
    const otherState = String(other?._squadController?.locomotionState || '');
    if (!otherState || ![
      CARD_LOCOMOTION_STATE.STREAM_APPROACH,
      CARD_LOCOMOTION_STATE.STREAM,
      CARD_LOCOMOTION_STATE.STREAM_EXIT
    ].includes(otherState)) return;
    if (Math.floor(Number(other?._squadController?.passageId) || 0) !== passageId) return;
    const dx = finiteNumber(agent?.x) - finiteNumber(other?.x);
    const dy = finiteNumber(agent?.y) - finiteNumber(other?.y);
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.0001) return;
    const longitudinal = ((finiteNumber(other?.x) - finiteNumber(agent?.x)) * forward.x)
      + ((finiteNumber(other?.y) - finiteNumber(agent?.y)) * forward.y);
    const lateral = Math.abs((finiteNumber(other?.x) - finiteNumber(agent?.x)) * side.x
      + ((finiteNumber(other?.y) - finiteNumber(agent?.y)) * side.y));
    const otherStream = Math.floor(Number(other?._squadController?.streamId) || 0);
    const sameStream = otherStream === streamId;
    const gap = sameStream
      ? Math.max(AGENT_RADIUS * 1.72, targetGap * 0.62)
      : targetGap * 0.92;
    if (dist >= gap || lateral > targetGap * (sameStream ? 0.58 : 1.7)) return;
    // Same-stream followers only receive a tiny backward correction when they
    // genuinely overlap a leader.  A rear neighbour never pushes a leader.
    if (sameStream && longitudinal <= 0) return;
    const strength = sameStream ? 0.08 : 0.16;
    const push = ((gap - dist) / gap) * strength;
    if (sameStream) {
      sx += -forward.x * push;
      sy += -forward.y * push;
    } else {
      sx += (dx / dist) * push;
      sy += (dy / dist) * push;
    }
  });
  return { x: sx, y: sy };
};

const pointToSegmentDistance = (point, segA, segB) => {
  const px = Number(point?.x) || 0;
  const py = Number(point?.y) || 0;
  const ax = Number(segA?.x) || 0;
  const ay = Number(segA?.y) || 0;
  const bx = Number(segB?.x) || 0;
  const by = Number(segB?.y) || 0;
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = (vx * vx) + (vy * vy);
  if (lenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
  const t = clamp((((px - ax) * vx) + ((py - ay) * vy)) / lenSq, 0, 1);
  const cx = ax + (vx * t);
  const cy = ay + (vy * t);
  return Math.hypot(px - cx, py - cy);
};

const pointInPolygon = (point, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = Number(polygon[i]?.x) || 0;
    const yi = Number(polygon[i]?.y) || 0;
    const xj = Number(polygon[j]?.x) || 0;
    const yj = Number(polygon[j]?.y) || 0;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < (((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
};

const resolveMeleeAlertRect = (squad = {}, center = null) => {
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  const radius = Math.max(12, Number(squad?.radius) || 24);
  const fallbackYaw = Math.atan2(
    Number(squad?.dirY) || 0,
    Number.isFinite(Number(squad?.dirX)) ? Number(squad.dirX) : (squad?.team === TEAM_DEFENDER ? -1 : 1)
  );
  return {
    x: Number.isFinite(Number(center?.x)) ? Number(center.x) : (Number(squad?.x) || 0),
    y: Number.isFinite(Number(center?.y)) ? Number(center.y) : (Number(squad?.y) || 0),
    width: Math.max(32, Number(formation?.width) || radius * 1.8) + 32,
    depth: Math.max(24, Number(formation?.depth) || radius * 1.2) + 32,
    yaw: Number.isFinite(Number(formation?.facingRad)) ? Number(formation.facingRad) : fallbackYaw
  };
};

const pointInsideMeleeAlertRect = (point = {}, rect = {}) => {
  const dx = (Number(point?.x) || 0) - (Number(rect?.x) || 0);
  const dy = (Number(point?.y) || 0) - (Number(rect?.y) || 0);
  const yaw = Number(rect?.yaw) || 0;
  const localX = (dx * Math.cos(yaw)) + (dy * Math.sin(yaw));
  const localY = (-dx * Math.sin(yaw)) + (dy * Math.cos(yaw));
  return Math.abs(localX) <= Math.max(1, Number(rect?.width) || 1) * 0.5
    && Math.abs(localY) <= Math.max(1, Number(rect?.depth) || 1) * 0.5;
};

const pickEnemyInsideMeleeAlert = (squad = {}, sim = null, rect = {}, origin = squad) => {
  let best = null;
  let bestDistance = Infinity;
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((candidate) => {
    if (!candidate || !canAcquireSquadTarget(squad, candidate) || (Number(candidate.remain) || 0) <= 0) return;
    if (isEnemyHiddenForViewer(candidate, squad?.team)) return;
    const candidateRadius = Math.max(0, Number(candidate?.radius) || 0);
    const expandedRect = candidateRadius > 0
      ? { ...rect, width: (Number(rect?.width) || 0) + (candidateRadius * 2), depth: (Number(rect?.depth) || 0) + (candidateRadius * 2) }
      : rect;
    if (!pointInsideMeleeAlertRect(candidate, expandedRect)) return;
    const distance = Math.hypot(
      (Number(candidate.x) || 0) - (Number(origin?.x) || 0),
      (Number(candidate.y) || 0) - (Number(origin?.y) || 0)
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return best;
};

const samplePointInCircle = (center, radius) => {
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * Math.max(0, Number(radius) || 0);
  return {
    x: (Number(center?.x) || 0) + (Math.cos(theta) * r),
    y: (Number(center?.y) || 0) + (Math.sin(theta) * r)
  };
};

const samplePointInTargetArea = (targetSpec = {}) => {
  const paintStamps = Array.isArray(targetSpec?.stamps) ? targetSpec.stamps : [];
  if (paintStamps.length > 0) {
    const totalWeight = paintStamps.reduce((sum, stamp) => (
      sum + (Math.max(0, Number(stamp?.radius) || 0) ** 2)
    ), 0);
    if (totalWeight > 1e-5) {
      let selectedStamp = paintStamps[paintStamps.length - 1];
      let selection = Math.random() * totalWeight;
      for (let stampIndex = 0; stampIndex < paintStamps.length; stampIndex += 1) {
        const stamp = paintStamps[stampIndex];
        selection -= Math.max(0, Number(stamp?.radius) || 0) ** 2;
        if (selection <= 0) {
          selectedStamp = stamp;
          break;
        }
      }
      return samplePointInCircle(selectedStamp, Math.max(0, Number(selectedStamp?.radius) || 0));
    }
  }
  const center = {
    x: Number(targetSpec?.x) || 0,
    y: Number(targetSpec?.y) || 0
  };
  const radius = Math.max(1, Number(targetSpec?.radius) || 1);
  const clipPolygon = Array.isArray(targetSpec?.clipPolygon) ? targetSpec.clipPolygon : [];
  if (clipPolygon.length < 3) {
    return samplePointInCircle(center, radius);
  }
  for (let i = 0; i < 6; i += 1) {
    const sampled = samplePointInCircle(center, radius);
    if (pointInPolygon(sampled, clipPolygon)) {
      return sampled;
    }
  }
  return center;
};

const clipGroundPointByWalls = (origin, target, walls = []) => {
  const hit = raycastObstacles(origin, target, walls, 0.8);
  if (!hit) {
    return {
      x: Number(target?.x) || 0,
      y: Number(target?.y) || 0,
      blockedByWall: false
    };
  }
  const dx = (Number(target?.x) || 0) - (Number(origin?.x) || 0);
  const dy = (Number(target?.y) || 0) - (Number(origin?.y) || 0);
  const dist = Math.hypot(dx, dy) || 1;
  const backStep = Math.min(2.4, dist * 0.08);
  const keepT = clamp(hit.t - (backStep / dist), 0, 1);
  return {
    x: (Number(origin?.x) || 0) + (dx * keepT),
    y: (Number(origin?.y) || 0) + (dy * keepT),
    blockedByWall: true
  };
};

const normalizeGroundSkillTargetSpec = (sim, squad, classTag, targetInput = {}) => {
  const fallback = GROUND_SKILL_CONFIG[classTag] || GROUND_SKILL_CONFIG.archer;
  const sourceX = Number.isFinite(Number(targetInput?.originX))
    ? Number(targetInput.originX)
    : (Number(squad?.x) || 0);
  const sourceY = Number.isFinite(Number(targetInput?.originY))
    ? Number(targetInput.originY)
    : (Number(squad?.y) || 0);
  const inputX = Number(targetInput?.x);
  const inputY = Number(targetInput?.y);
  const inputMaxRange = Number(targetInput?.maxRange);
  const rawX = Number.isFinite(inputX) ? inputX : sourceX;
  const rawY = Number.isFinite(inputY) ? inputY : sourceY;
  const maxRange = Math.max(8, Number.isFinite(inputMaxRange) ? inputMaxRange : skillRangeByClass(classTag));
  const vec = normalizeVec(rawX - sourceX, rawY - sourceY);
  const range = Math.min(maxRange, vec.len || 0);
  const clampedTarget = {
    x: sourceX + (vec.x * range),
    y: sourceY + (vec.y * range)
  };
  const walls = filterVisionBlockingObstacles(sim?.buildings || []);
  const paintArea = normalizeSkillPaintArea({
    paintArea: targetInput?.paintArea,
    origin: { x: sourceX, y: sourceY },
    maxRange
  });
  if (paintArea) {
    return {
      kind: 'ground_paint',
      x: paintArea.center.x,
      y: paintArea.center.y,
      radius: Math.max(1, paintArea.maxStampRadius),
      maxRange,
      stamps: paintArea.stamps,
      clipPolygon: [],
      blockedByWall: false
    };
  }
  const uiHasClipPolygon = Array.isArray(targetInput?.clipPolygon) && targetInput.clipPolygon.length >= 3;
  const clippedCenter = uiHasClipPolygon
    ? {
      x: clampedTarget.x,
      y: clampedTarget.y,
      blockedByWall: !!targetInput?.blockedByWall
    }
    : clipGroundPointByWalls(
      { x: sourceX, y: sourceY },
      clampedTarget,
      walls
    );
  const inputRadius = Number(targetInput?.radius);
  const radius = Math.max(
    8,
    Number.isFinite(inputRadius) && inputRadius > 0 ? inputRadius : fallback.radius
  );
  const clipPolygon = Array.isArray(targetInput?.clipPolygon)
    ? targetInput.clipPolygon.map((row) => ({ x: Number(row?.x) || 0, y: Number(row?.y) || 0 }))
    : [];
  return {
    kind: 'ground_aoe',
    x: clippedCenter.x,
    y: clippedCenter.y,
    radius,
    maxRange,
    clipPolygon,
    blockedByWall: !!targetInput?.blockedByWall || clippedCenter.blockedByWall
  };
};

const solveBallisticVelocity = (source, target, gravity = 70, speedHint = 220) => {
  const sx = Number(source?.x) || 0;
  const sy = Number(source?.y) || 0;
  const sz = Number(source?.z) || 0;
  const tx = Number(target?.x) || sx;
  const ty = Number(target?.y) || sy;
  const dist = Math.hypot(tx - sx, ty - sy);
  const safeSpeed = Math.max(40, Number(speedHint) || 220);
  const flightSec = clamp(dist / safeSpeed, 0.42, 1.35);
  const vx = (tx - sx) / Math.max(0.08, flightSec);
  const vy = (ty - sy) / Math.max(0.08, flightSec);
  const g = Math.max(1, Number(gravity) || 70);
  const vz = ((0.5 * g * (flightSec ** 2)) - sz) / Math.max(0.08, flightSec);
  return {
    vx,
    vy,
    vz,
    gravity: g,
    flightSec
  };
};

const emitGroundSkillWave = (sim, crowd, squad, activeSkill, waveIndex = 0) => {
  if (!sim || !crowd || !squad || !activeSkill) return 0;
  const agents = getCrowdAgentsForSquad(crowd, squad.id);
  if (agents.length <= 0) return 0;
  const classTag = activeSkill?.classTag === 'artillery' ? 'artillery' : 'archer';
  const config = activeSkill.config || GROUND_SKILL_CONFIG[classTag];
  const targetSpec = activeSkill.targetSpec || {};
  const explicitTarget = (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
    String(candidate?.id || '') === String(activeSkill?.targetSquadId || '')
    && isHostileTeam(squad?.team, candidate?.team)
  )) || null;
  const targetTeam = isHostileTeam(squad?.team, activeSkill?.targetTeam)
    ? activeSkill.targetTeam
    : (explicitTarget?.team || resolveDefaultHostileTeam(squad?.team));
  const casterIds = new Set(Array.isArray(activeSkill?.casterAgentIds) ? activeSkill.casterAgentIds : []);
  const rankedShooters = [...agents]
    .filter((agent) => !agent.dead && (casterIds.size <= 0 || casterIds.has(agent.id)))
    .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
  const shooterCount = classTag === 'artillery'
    ? Math.max(2, Math.min(6, Math.floor(Math.sqrt(rankedShooters.length)) + 1))
    : Math.max(3, Math.min(14, Math.floor(Math.sqrt(rankedShooters.length)) + 3));
  const shooters = rankedShooters.slice(0, shooterCount);
  if (shooters.length <= 0) return 0;

  const shotsPerWaveCap = Math.max(1, Math.floor(Number(config?.shotsPerWave) || (classTag === 'artillery' ? 6 : 12)));
  const shooterWeightSum = shooters.reduce((sum, shooter) => sum + Math.max(0.1, Number(shooter?.weight) || 0.1), 0);
  const shotWeightRef = classTag === 'artillery' ? 18 : 24;
  const shotScale = clamp(shooterWeightSum / shotWeightRef, 0.12, 1);
  const scaledShotBudget = Math.max(1, Math.round(shotsPerWaveCap * shotScale));
  const floorByShooters = classTag === 'artillery'
    ? Math.max(1, Math.ceil(shooters.length * 0.5))
    : Math.max(1, Math.ceil(shooters.length * 0.8));
  const totalShots = Math.max(
    1,
    Math.min(
      shotsPerWaveCap,
      Math.max(floorByShooters, scaledShotBudget)
    )
  );
  let fired = 0;
  for (let shotIndex = 0; shotIndex < totalShots; shotIndex += 1) {
    const shooter = shooters[shotIndex % shooters.length];
    if (!shooter || shooter.dead) continue;
    const landing = samplePointInTargetArea(targetSpec);
    const sourceZ = classTag === 'artillery' ? 6 : 4.2;
    const ballistic = solveBallisticVelocity(
      { x: shooter.x, y: shooter.y, z: sourceZ },
      landing,
      Number(config?.gravity) || 70,
      Number(config?.speedHint) || 220
    );
    const repConfig = resolveRepConfig(sim, crowd);
    const weightMul = Math.max(1, Math.pow(Math.max(1, Number(shooter.weight) || 1), repConfig.damageExponent))
      * Math.max(0.05, Number(shooter.combatScale) || 1);
    const damageBase = Math.max(0.22, (Number(squad.stats?.atk) || 10) * (classTag === 'artillery' ? 0.11 : 0.065));
    const damage = damageBase
      * weightMul
      * Math.max(0.1, Number(config?.damageMul) || 1)
      * (activeSkill?.profile ? 1 : Math.max(0.1, Number(activeSkill?.profile?.damageMul) || 1));
    acquireProjectile(crowd.effectsPool, {
      type: classTag === 'artillery' ? 'shell' : 'arrow',
      team: squad.team,
      squadId: squad.id,
      sourceAgentId: shooter.id,
      x: shooter.x,
      y: shooter.y,
      z: sourceZ,
      vx: ballistic.vx,
      vy: ballistic.vy,
      vz: ballistic.vz,
      gravity: ballistic.gravity,
      damage,
      radius: classTag === 'artillery' ? 4.9 : 2.3,
      impactRadius: Math.max(0.8, Number(config?.impactRadius) || 2.2),
      blastRadius: Math.max(0, Number(config?.blastRadius) || 0),
      blastFalloff: Math.max(0, Number(config?.blastFalloff) || 0),
      wallDamageMul: Math.max(0.1, Number(config?.wallDamageMul) || 1),
      ttl: Math.max(0.2, (Number(ballistic.flightSec) || 0.8) + (classTag === 'artillery' ? 0.35 : 0.2)),
      targetTeam,
      targetCenterX: Number(targetSpec?.x) || 0,
      targetCenterY: Number(targetSpec?.y) || 0,
      targetRadius: Math.max(0, Number(targetSpec?.radius) || 0),
      targetStamps: targetSpec?.kind === 'ground_paint' ? targetSpec.stamps : [],
      targetShape: targetSpec?.kind === 'ground_paint' ? 'ground_paint' : 'ground_aoe',
      blockedByWall: !!targetSpec?.blockedByWall,
      skillId: activeSkill.id,
      skillClass: classTag,
      waveIndex: waveIndex + 1,
      maxHits: classTag === 'artillery' ? 999 : 1
    });
    fired += 1;
  }
  if (fired > 0) {
    acquireHitEffect(crowd.effectsPool, {
      type: classTag === 'artillery' ? 'explosion' : 'hit',
      x: Number(targetSpec?.x) || 0,
      y: Number(targetSpec?.y) || 0,
      z: 1.1,
      radius: Math.max(2, Number(targetSpec?.radius) || 8),
      ttl: classTag === 'artillery' ? 0.42 : 0.3,
      team: squad.team
    });
  }
  return fired;
};

const updateActiveGroundSkill = (sim, crowd, squad, dt) => {
  const active = squad?.activeSkill;
  if (!active) return;
  if (active.mode === 'melee') {
    updateConfiguredMeleeSkill(sim, crowd, squad, active, dt);
    return;
  }
  if ((Number(squad?.remain) || 0) <= 0) {
    squad.activeSkill = null;
    return;
  }
  active.ttlSec = Math.max(0, (Number(active.ttlSec) || 0) - dt);
  active.nextWaveSec = (Number(active.nextWaveSec) || 0) - dt;
  while (active.wavesFired < active.wavesTotal && active.nextWaveSec <= 0 && active.ttlSec > 0) {
    emitGroundSkillWave(sim, crowd, squad, active, active.wavesFired);
    active.wavesFired += 1;
    active.nextWaveSec += Math.max(0.05, Number(active.intervalSec) || 0.2);
  }
  squad.action = '兵种攻击';
  if (active.ttlSec <= 0 || active.wavesFired >= active.wavesTotal) {
    squad.activeSkill = null;
    if (squad.actionState && squad.actionState.kind === 'skill') {
      squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
    }
  }
};

const isEnemyHiddenForViewer = (enemySquad = {}, viewerTeam = TEAM_ATTACKER) => {
  if (viewerTeam === TEAM_ATTACKER) return !!enemySquad?.hiddenFromAttacker;
  if (viewerTeam === TEAM_DEFENDER) return !!enemySquad?.hiddenFromDefender;
  return false;
};

const pickNearestEnemySquad = (squad, squads = []) => {
  let best = null;
  let bestDist = Infinity;
  squads.forEach((row) => {
    if (!row || !canAcquireSquadTarget(squad, row) || row.remain <= 0) return;
    if (isEnemyHiddenForViewer(row, squad?.team)) return;
    const dist = Math.hypot((row.x || 0) - (squad.x || 0), (row.y || 0) - (squad.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });
  return best;
};

const selectTrainingMapEnemyTarget = (squad = null, sim = null, nowSec = 0) => {
  const usesTrainingCardAi = isTrainingCardAiSquad(squad);
  const targetOnlyAttack = isTargetOnlyAttackOrder(squad);
  const explicitTargetId = resolveSquadOrderType(squad) === ORDER_ATTACK_MOVE
    ? String(squad?.order?.targetSquadId || '')
    : '';
  if (explicitTargetId) {
    const explicitTarget = (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
      String(candidate?.id || '') === explicitTargetId
      && (Number(candidate?.remain) || 0) > 0
      && isHostileTeam(squad?.team, candidate?.team)
      && !isEnemyHiddenForViewer(candidate, squad?.team)
    )) || null;
    if (explicitTarget) {
      if (usesTrainingCardAi) {
        squad._trainingAiDecisionDeferred = false;
        squad._trainingAiSelection = null;
      }
      return explicitTarget;
    }
    if (targetOnlyAttack) {
      completeTargetOnlyAttackOrder(squad, nowSec);
      return null;
    }
    squad.order.targetSquadId = '';
    if (String(squad?.targetSquadId || '') === explicitTargetId) squad.targetSquadId = '';
  }
  if (targetOnlyAttack) {
    completeTargetOnlyAttackOrder(squad, nowSec);
    return null;
  }
  if (!usesTrainingCardAi) {
    return pickNearestEnemySquad(squad, Array.isArray(sim?.squads) ? sim.squads : []);
  }
  const strategicTargetId = String(squad?._trainingAiPlan?.targetSquadId || '');
  if (squad?._trainingAiPlan) {
    const strategicTarget = (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
      String(candidate?.id || '') === strategicTargetId
      && (Number(candidate?.remain) || 0) > 0
      && canAcquireSquadTarget(squad, candidate)
      && !isEnemyHiddenForViewer(candidate, squad?.team)
      && !isTrainingMapAiTargetDeferred(squad, candidate?.id, nowSec)
    )) || null;
    if (strategicTarget) {
      squad._trainingAiDecisionDeferred = false;
      return strategicTarget;
    }
    squad._trainingAiDecisionDeferred = false;
    squad._trainingAiSelection = null;
    return null;
  }
  if (!canRefreshTrainingAiDecision(squad, sim, nowSec)) {
    squad._trainingAiDecisionDeferred = true;
    const cachedSelection = squad?._trainingAiTargetCache?.selection;
    if (cachedSelection?.target && cachedSelection.target.remain > 0) {
      squad._trainingAiSelection = cachedSelection;
      return cachedSelection.target;
    }
    return null;
  }
  squad._trainingAiDecisionDeferred = false;
  const selection = selectTrainingMapAiTarget(squad, sim, {
    candidates: sim?.squads,
    nowSec
  });
  if (selection) {
    if (squad._trainingAiSelection !== selection) {
      squad.debugTargetScore = {
        targetId: selection.targetId,
        score: selection.score,
        distance: selection.distance,
        sameLane: selection.sameLane,
        targetLaneId: selection.targetLaneId,
        threat: selection.threat,
        healthRatio: selection.healthRatio,
        inAttackRange: selection.inAttackRange,
        attackingAlly: selection.attackingAlly,
        protectedArea: selection.protectedArea,
        directLineBlocked: selection.directLineBlocked,
        terms: selection.terms
      };
    }
    squad._trainingAiSelection = selection;
    return selection.target;
  }
  if (squad) squad._trainingAiSelection = null;
  if (squad?._trainingAiDecisionDeferred) return null;
  const fallbackCache = squad?._trainingNearestEnemyCache;
  if (fallbackCache && (Number(fallbackCache.nextAt) || 0) > nowSec) {
    const cachedTarget = (Array.isArray(sim?.squads) ? sim.squads : []).find((row) => (
      String(row?.id || '') === String(fallbackCache.targetId || '')
      && row.remain > 0
    ));
    return cachedTarget || null;
  }
  let best = null;
  let bestDist = Infinity;
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((row) => {
    if (!row || !canAcquireSquadTarget(squad, row) || row.remain <= 0) return;
    if (isEnemyHiddenForViewer(row, squad?.team)) return;
    if (isTrainingMapAiTargetDeferred(squad, row.id, nowSec)) return;
    const dist = Math.hypot((row.x || 0) - (squad.x || 0), (row.y || 0) - (squad.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });
  if (squad) {
    squad._trainingNearestEnemyCache = {
      targetId: String(best?.id || ''),
      nextAt: nowSec + 0.18
    };
  }
  return best;
};

const recordTrainingTargetNavigationPlan = ({
  squad = null,
  targetId = '',
  planned = null,
  sim = null,
  nowSec = 0
} = {}) => {
  if (!squad) return null;
  const safeTargetId = String(targetId || '');
  const previous = squad?._trainingTargetNavigation;
  const previousTargets = previous?.targets && typeof previous.targets === 'object'
    ? previous.targets
    : {};
  const previousTargetState = previousTargets[safeTargetId]
    || (String(previous?.targetId || '') === safeTargetId ? previous : null);
  const retryCooldown = Math.max(
    0.1,
    Number(sim?.trainingNavigator?.getPathFailureReplanCooldownSeconds?.()) || 0.35
  );
  const failureLimit = clamp(
    Math.floor(Number(sim?.trainingMap?.navigation?.aiTargetUnreachableFailureLimit) || NAVIGATION_MAX_FAILURES_BEFORE_WAIT),
    1,
    8
  );
  const unreachableCooldown = clamp(
    Number(sim?.trainingMap?.navigation?.aiTargetUnreachableCooldownSeconds) || Math.max(1, retryCooldown * 4),
    retryCooldown,
    20
  );
  const passageFallbackSucceeded = planned?.ok === true
    && planned?.formationFailed === true
    && planned?.passageSucceeded === true;
  const failureCount = planned?.ok
    ? (passageFallbackSucceeded
      ? Math.max(1, Number(previousTargetState?.failureCount) || 0, 1)
      : 0)
    : Math.min(12, (Number(previousTargetState?.failureCount) || 0) + 1);
  const blockedUntil = !planned?.ok && failureCount >= failureLimit
    ? nowSec + unreachableCooldown
    : 0;
  const targetState = {
    failureCount,
    retryAt: planned?.ok
      ? (passageFallbackSucceeded ? nowSec + retryCooldown : 0)
      : nowSec + retryCooldown,
    blockedUntil
  };
  const targetStates = { ...previousTargets, [safeTargetId]: targetState };
  const state = {
    targetId: safeTargetId,
    ...targetState,
    targets: targetStates
  };
  squad._trainingTargetNavigation = state;
  if (!planned?.ok) {
    if (squad._trainingAiTargetCache?.targetId === safeTargetId) {
      squad._trainingAiTargetCache.nextAt = 0;
    }
    recordTrainingMapAiEvent({
      squad,
      sim,
      nowSec,
      reason: blockedUntil > nowSec ? 'target-path-deferred' : 'target-path-retry',
      targetId: safeTargetId
    });
  }
  return state;
};

const planTrainingNavigationTarget = (squad = null, sim = null, target = {}, walls = []) => {
  if (!squad) return { ok: false, destination: null };
  const source = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
  const requestedTarget = { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
  const navigator = sim?.trainingNavigator;
  const radius = resolveTrainingNavigationAgentRadius(squad, sim);
  const rawDestination = navigator?.isWalkable && navigator?.resolveLegalPosition
    ? (navigator.isWalkable(requestedTarget, { obstacles: walls, radius })
      ? requestedTarget
      : navigator.resolveLegalPosition(source, requestedTarget, { obstacles: walls, radius }))
    : requestedTarget;
  const navigationClearance = isTrainingCardSquad(squad)
    ? resolveTrainingNavigationPathClearance(sim, { passage: true })
    : resolveTrainingNavigationPathClearance(sim);
  let destination = navigator?.findNearestWalkablePoint
    ? navigator.findNearestWalkablePoint(rawDestination, {
      obstacles: walls,
      radius: radius + navigationClearance
    })
    : rawDestination;
  const roadCorridor = resolveTrainingRoadCorridor(squad, sim);
  if (roadCorridor) {
    destination = constrainPointToTrainingRoadCorridor(destination, roadCorridor, radius);
  }
  if (!navigator?.planRoute) {
    applyTrainingNavigationRoute(
      squad,
      roadCorridor ? buildTrainingRoadFallbackRoute(squad, sim, destination) : [destination]
    );
    return { ok: true, destination };
  }
  if (!consumeTrainingNavigationPlanBudget(sim)) {
    return { ok: false, deferred: true, destination };
  }
  const plannedRoute = planTrainingRouteWithPassageFallback({
    squad,
    sim,
    start: source,
    target: destination,
    walls,
    maxSearchNodes: resolveTrainingAiNavigationSearchNodes(squad, sim),
    preferLocalDetour: true,
    preferredLaneId: roadCorridor?.laneId
  });
  const route = plannedRoute.route;
  const routeReachesDestination = doesTrainingRouteReachTarget(route, destination);
  const highlandEgressPrefix = resolveTrainingHighlandEgressPrefix(sim, source, route);
  if (
    routeReachesDestination
    && isTrainingRouteInsideRoadCorridor(squad, sim, source, route)
  ) {
    applyTrainingNavigationRoute(squad, route);
    squad._trainingNavigationScale = plannedRoute.scale;
    return {
      ok: true,
      destination,
      route,
      scale: plannedRoute.scale,
      formationFailed: plannedRoute.formationFailed === true,
      passageAttempted: plannedRoute.passageAttempted === true,
      passageSucceeded: plannedRoute.passageSucceeded === true
    };
  }
  if (roadCorridor && (routeReachesDestination || highlandEgressPrefix.length > 0)) {
    const fallbackRoute = buildTrainingRoadFallbackRoute(squad, sim, destination, {
      source,
      routePrefix: highlandEgressPrefix
    });
    if (fallbackRoute.length > 0) {
      applyTrainingNavigationRoute(squad, fallbackRoute);
      squad._trainingNavigationScale = 'PASSAGE';
      return {
        ok: true,
        destination,
        route: fallbackRoute,
        scale: 'PASSAGE',
        formationFailed: plannedRoute.formationFailed === true,
        passageAttempted: plannedRoute.passageAttempted === true,
        passageSucceeded: plannedRoute.passageSucceeded === true
      };
    }
  }
  return { ok: false, destination };
};

const routeDistanceFrom = (source = {}, route = []) => {
  let previous = { x: Number(source?.x) || 0, y: Number(source?.y) || 0 };
  return (Array.isArray(route) ? route : []).reduce((total, point) => {
    const current = { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
    return total + segment;
  }, 0);
};

const resolveTrainingRangedApproachPlan = ({
  squad = null,
  sim = null,
  target = null,
  desiredDistance = 0,
  walls = []
} = {}) => {
  if (!squad || !target) return { ok: false, destination: null, route: [] };
  const source = { x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 };
  const targetPoint = { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
  const navigator = sim?.trainingNavigator;
  const radius = resolveTrainingNavigationAgentRadius(squad, sim);
  const clearance = isTrainingCardSquad(squad)
    ? resolveTrainingNavigationPathClearance(sim, { passage: true })
    : resolveTrainingNavigationPathClearance(sim);
  const roadCorridor = resolveTrainingRoadCorridor(squad, sim);
  const targetRadius = Math.max(0, Number(target?.radius) || 0);
  const attackRange = resolveSquadAttackRange(squad);
  const preferredDistance = Math.max(attackRange.min + targetRadius, Number(desiredDistance) || 0);
  const maximumDistance = Math.max(preferredDistance, attackRange.max + targetRadius);
  const distances = Array.from(new Set([
    preferredDistance,
    Math.min(maximumDistance, Math.max(preferredDistance, attackRange.max * 0.86)),
    maximumDistance
  ].map((value) => Math.max(4, Number(value) || 4))));
  const sourceAngle = Math.atan2(source.y - targetPoint.y, source.x - targetPoint.x);
  const angleOffsets = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI];
  const visionWalls = filterVisionBlockingObstacles(sim?.buildings || []);
  let best = null;

  distances.forEach((distanceValue) => {
    angleOffsets.forEach((offset, offsetIndex) => {
      let requested = {
        x: targetPoint.x + (Math.cos(sourceAngle + offset) * distanceValue),
        y: targetPoint.y + (Math.sin(sourceAngle + offset) * distanceValue)
      };
      if (roadCorridor) {
        requested = constrainPointToTrainingRoadCorridor(requested, roadCorridor, radius);
      }
      const rawDestination = navigator?.isWalkable && navigator?.resolveLegalPosition
        ? (navigator.isWalkable(requested, { obstacles: walls, radius })
          ? requested
          : navigator.resolveLegalPosition(source, requested, { obstacles: walls, radius }))
        : requested;
      let destination = navigator?.findNearestWalkablePoint
        ? navigator.findNearestWalkablePoint(rawDestination, {
          obstacles: walls,
          radius: radius + clearance
        })
        : rawDestination;
      if (roadCorridor) {
        destination = constrainPointToTrainingRoadCorridor(destination, roadCorridor, radius);
      }
      if (raycastObstacles(destination, targetPoint, visionWalls, Math.max(0.8, radius * 0.12))) return;
      const plannedRoute = navigator?.planRoute
        ? (consumeTrainingNavigationPlanBudget(sim)
          ? planTrainingRouteWithPassageFallback({
            squad,
            sim,
            start: source,
            target: destination,
            walls,
            maxSearchNodes: resolveTrainingAiNavigationSearchNodes(squad, sim),
            preferLocalDetour: true,
            preferredLaneId: roadCorridor?.laneId
          })
          : null)
        : { route: [destination], scale: 'AGENT' };
      let route = plannedRoute?.route || null;
      if (!route) {
        best = best || { deferred: true, destination: null, route: [], score: Infinity };
        return;
      }
      const routeReachesDestination = doesTrainingRouteReachTarget(route, destination);
      const highlandEgressPrefix = resolveTrainingHighlandEgressPrefix(sim, source, route);
      if (!routeReachesDestination && !(roadCorridor && highlandEgressPrefix.length > 0)) return;
      if (roadCorridor && (
        !routeReachesDestination
        || !isTrainingRouteInsideRoadCorridor(squad, sim, source, route)
      )) {
        route = buildTrainingRoadFallbackRoute(squad, sim, destination, {
          source,
          routePrefix: highlandEgressPrefix
        });
      }
      if (route.length <= 0) return;
      const distanceError = Math.abs(Math.hypot(destination.x - targetPoint.x, destination.y - targetPoint.y) - preferredDistance);
      const score = routeDistanceFrom(source, route) + (distanceError * 1.5) + (offsetIndex * 0.01);
      if (!best || score < best.score) {
        best = {
          destination,
          route,
          score,
          scale: plannedRoute?.scale || 'AGENT',
          formationFailed: plannedRoute?.formationFailed === true,
          passageAttempted: plannedRoute?.passageAttempted === true,
          passageSucceeded: plannedRoute?.passageSucceeded === true
        };
      }
    });
  });

  if (!best || best.deferred) return { ok: false, deferred: !!best?.deferred, destination: null, route: [] };
  applyTrainingNavigationRoute(squad, best.route);
  squad._trainingNavigationScale = best.scale;
  return {
    ok: true,
    destination: best.destination,
    route: best.route,
    scale: best.scale,
    formationFailed: best.formationFailed === true,
    passageAttempted: best.passageAttempted === true,
    passageSucceeded: best.passageSucceeded === true
  };
};

const planTrainingAttackNavigationTarget = ({
  squad = null,
  sim = null,
  target = null,
  desiredDistance = 0,
  ranged = false,
  walls = []
} = {}) => {
  if (!squad || !target) return { ok: false, destination: null, route: [] };
  if (ranged) {
    return resolveTrainingRangedApproachPlan({
      squad,
      sim,
      target,
      desiredDistance,
      walls
    });
  }
  const direction = normalizeVec(
    (Number(target?.x) || 0) - (Number(squad?.x) || 0),
    (Number(target?.y) || 0) - (Number(squad?.y) || 0)
  );
  return planTrainingNavigationTarget(squad, sim, {
    x: (Number(target?.x) || 0) - (direction.x * Math.max(0, Number(desiredDistance) || 0)),
    y: (Number(target?.y) || 0) - (direction.y * Math.max(0, Number(desiredDistance) || 0))
  }, walls);
};

const updateTrainingAutoAdvancePlan = (squad = null, sim = null, walls = [], nowSec = 0) => {
  if (!isTrainingCardAiSquad(squad)) return false;
  if (isTargetOnlyAttackOrder(squad)) return false;
  const rejoiningLane = String(squad?.trainingAi?.state || '') === 'RejoinLane';
  const plan = selectTrainingMapAiPlan(squad, sim, { nowSec });
  if (!plan) return false;
  const planIdChanged = String(squad?._appliedTrainingAiPlanId || '') !== String(plan.id || '');
  squad._appliedTrainingAiPlanId = String(plan.id || '');
  squad._trainingAiDecisionDeferred = false;
  squad.debugAiPlan = {
    kind: plan.kind,
    laneId: plan.laneId,
    waveId: plan.waveId,
    targetSquadId: plan.targetSquadId,
    targetObjectiveId: plan.targetObjectiveId,
    targetBuildingId: plan.targetBuildingId,
    reason: plan.reason,
    lockUntil: plan.lockUntil
  };

  const attacksSquad = plan.kind === TRAINING_MAP_AI_PLAN_KIND.DEFEND_WAVE
    || plan.kind === TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL;
  if (attacksSquad) {
    const target = (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
      String(candidate?.id || '') === String(plan.targetSquadId || '')
      && (Number(candidate?.remain) || 0) > 0
    )) || null;
    if (!target) return true;
    if (planIdChanged) {
      squad.waypoints = [];
      syncTrainingNavigationOrderPath(squad);
      squad._trainingAiSelection = null;
    }
    squad.autoNavigation = null;
    squad.targetBuildingId = '';
    squad.targetSquadId = String(target.id || '');
    squad._combatEngagementTargetId = String(target.id || '');
    squad._combatEngagementUntil = nowSec + SQUAD_COMBAT_LOCK_RELEASE_SEC;
    return false;
  }

  if (squad.targetSquadId) {
    squad.targetSquadId = '';
  }
  squad._combatEngagementTargetId = '';
  squad._combatEngagementUntil = 0;
  const attacksBuilding = plan.kind === TRAINING_MAP_AI_PLAN_KIND.SIEGE_TOWER
    || plan.kind === TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS;
  squad.targetBuildingId = attacksBuilding ? String(plan?.targetBuildingId || '') : '';
  const goal = {
    id: String(plan.id || ''),
    x: Number(plan?.x) || 0,
    y: Number(plan?.y) || 0
  };
  const state = squad?.autoNavigation && typeof squad.autoNavigation === 'object'
    ? squad.autoNavigation
    : null;
  const destinationDrift = state?.destination
    ? Math.hypot(
      (Number(state.destination.x) || 0) - goal.x,
      (Number(state.destination.y) || 0) - goal.y
    )
    : Infinity;
  const refreshDistance = Math.max(48, (Number(squad?.radius) || 10) * 1.8);
  if (
    state?.goalId === goal.id
    && state?.destination
    && Array.isArray(squad.waypoints)
    && squad.waypoints.length <= 0
    && Math.hypot(
      (Number(state.destination.x) || 0) - (Number(squad.x) || 0),
      (Number(state.destination.y) || 0) - (Number(squad.y) || 0)
    ) <= LEADER_ARRIVAL_RADIUS
    && destinationDrift <= refreshDistance
  ) {
    squad.action = attacksBuilding
      ? (plan.kind === TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS ? '随兵攻打兵营' : '随兵拆塔')
      : (plan.kind === TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER ? '撤出塔区' : '塔外护线');
    return true;
  }
  if (
    state?.goalId === goal.id
    && Array.isArray(squad.waypoints)
    && squad.waypoints.length > 0
    && (
      destinationDrift <= refreshDistance
      || (Number(state?.refreshAt) || 0) > nowSec
    )
  ) {
    squad.action = plan.kind === TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER
      ? '撤出塔区'
      : (attacksBuilding ? '随兵推进' : '护送兵线');
    return true;
  }
  if (state?.goalId === goal.id && (Number(state.retryAt) || 0) > nowSec) {
    squad.action = '路径重算';
    return true;
  }
  const planned = planTrainingNavigationTarget(squad, sim, goal, walls);
  squad.autoNavigation = {
    goalId: goal.id,
    planKind: plan.kind,
    destination: planned.destination,
    retryAt: planned.ok ? 0 : nowSec + (planned.deferred ? 0.08 : resolveTrainingNavigationReplanCooldown(sim)),
    refreshAt: nowSec + 0.8,
    deferred: !!planned.deferred
  };
  squad.action = planned.ok
    && rejoiningLane
    ? '回归兵线'
    : planned.ok
    ? (plan.kind === TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER
      ? '撤出塔区'
      : (attacksBuilding ? '随兵推进' : '护送兵线'))
    : (planned.deferred ? '路径排队' : '路径绕行');
  return true;
};

// Shared by lane-wave planning and the minion-only road constraints below.
const resolveMinionPathProjection = projectPointToMinionPath;

const isTrainingRoadBoundSquad = (squad = {}) => (
  isTrainingMinionSquad(squad)
  || (
    isTrainingCardAiSquad(squad)
    && String(squad?.spawnLaneId || '').trim().length > 0
  )
);

const resolveTrainingRoadCorridor = (squad = {}, sim = {}) => {
  if (!isTrainingRoadBoundSquad(squad)) return null;
  if (
    !isTrainingMinionSquad(squad)
    && (
      squad?._trainingAiPlan?.kind === TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL
      || squad?._trainingAiPlan?.kind === TRAINING_MAP_AI_PLAN_KIND.ROTATE_LANE
    )
  ) return null;
  const laneId = String(
    squad?.minionLaneId
      || squad?.trainingAiLaneId
      || squad?.spawnLaneId
      || ''
  ).trim();
  const lane = (Array.isArray(sim?.trainingMap?.lanes) ? sim.trainingMap.lanes : [])
    .find((entry) => String(entry?.id || '') === laneId) || null;
  const strategicWaveId = isTrainingMinionSquad(squad)
    ? ''
    : String(squad?._trainingAiPlan?.waveId || '');
  const strategicWave = strategicWaveId
    ? (Array.isArray(sim?.squads) ? sim.squads : []).find((candidate) => (
      String(candidate?.id || '') === strategicWaveId
      && isTrainingMinionSquad(candidate)
      && (Number(candidate?.remain) || 0) > 0
    )) || null
    : null;
  let path = isTrainingMinionSquad(squad) && Array.isArray(squad?.minionPath)
    ? squad.minionPath.filter(Boolean)
    : (Array.isArray(strategicWave?.minionPath) && strategicWave.minionPath.length >= 2
      ? strategicWave.minionPath.filter(Boolean)
      : (Array.isArray(lane?.centerline) ? lane.centerline.filter(Boolean) : []));
  if (path.length < 2 && lane) {
    const halfWidth = Math.max(50, Number(sim?.field?.width) || 2700) * 0.5;
    const centerY = Number(lane?.centerY) || 0;
    path = [{ x: -halfWidth, y: centerY }, { x: halfWidth, y: centerY }];
  }
  if (path.length < 2) return null;
  const width = Math.max(
    24,
    Number(squad?.minionPathCorridorWidth)
      || Number(strategicWave?.minionPathCorridorWidth)
      || Number(lane?.width)
      || Number(sim?.trainingMap?.navigation?.fixedLaneCorridorWidth)
      || 96
  );
  return {
    laneId,
    path,
    width,
    halfWidth: width * 0.5
  };
};

const isPointWithinTrainingRoadSearchBand = (point = {}, squad = {}, sim = {}) => {
  const corridor = resolveTrainingRoadCorridor(squad, sim);
  if (!corridor) return true;
  const projection = resolveMinionPathProjection(point, corridor.path);
  return projection.distance <= corridor.halfWidth + MINION_ROAD_SEARCH_MARGIN;
};

const constrainPointToTrainingRoadCorridor = (point = {}, corridor = null, inset = 0) => {
  if (!corridor?.path || corridor.path.length < 2) {
    return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
  }
  const projection = resolveMinionPathProjection(point, corridor.path);
  const allowedDistance = Math.max(4, Number(corridor?.halfWidth) - Math.max(0, Number(inset) || 0));
  if (projection.distance <= allowedDistance) {
    return { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
  }
  const direction = normalizeVec(
    (Number(point?.x) || 0) - (Number(projection?.point?.x) || 0),
    (Number(point?.y) || 0) - (Number(projection?.point?.y) || 0)
  );
  return {
    x: (Number(projection?.point?.x) || 0) + (direction.x * allowedDistance),
    y: (Number(projection?.point?.y) || 0) + (direction.y * allowedDistance)
  };
};

const isPointInsideTrainingHighland = (point = {}, sim = {}) => (
  (sim?.trainingNavigator?.sampleTerrain?.(point)?.regionIds || [])
    .some((regionId) => String(regionId || '').startsWith('terrain-highland-'))
);

const constrainMinionAgentsToTrainingRoadCorridor = (squad = {}, sim = {}, agents = [], walls = []) => {
  if (
    !isTrainingMinionSquad(squad)
    || !(Number(squad?.minionPathCorridorWidth) > 0)
  ) return;
  const corridor = resolveTrainingRoadCorridor(squad, sim);
  if (!corridor) return;
  squad._trainingRoadCorridorEntered = true;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent || agent.dead) return;
    const point = { x: Number(agent.x) || 0, y: Number(agent.y) || 0 };
    const projection = resolveMinionPathProjection(point, corridor.path);
    const constrained = constrainPointToTrainingRoadCorridor(
      point,
      corridor,
      Math.max(0.5, Number(agent.radius) || AGENT_RADIUS) + 0.5
    );
    if (Math.hypot(constrained.x - point.x, constrained.y - point.y) <= 0.001) return;
    const outward = normalizeVec(
      point.x - (Number(projection?.point?.x) || 0),
      point.y - (Number(projection?.point?.y) || 0)
    );
    const outwardSpeed = ((Number(agent.vx) || 0) * outward.x) + ((Number(agent.vy) || 0) * outward.y);
    if (outward.len > 0.0001 && outwardSpeed > 0) {
      agent.vx -= outward.x * outwardSpeed;
      agent.vy -= outward.y * outwardSpeed;
    }
    const legalStep = resolveTrainingLegalMovementStep({
      sim,
      start: point,
      target: constrained,
      walls,
      radius: Math.max(0.5, Number(agent.radius) || AGENT_RADIUS) + 0.5
    });
    agent.x = legalStep.x;
    agent.y = legalStep.y;
    agent._formationLocked = false;
    agent._formationHold = false;
    agent._formationHoldSpacing = '';
  });
};

const isTrainingRouteInsideRoadCorridor = (
  squad = {},
  sim = {},
  source = {},
  route = [],
  requestedInset = null
) => {
  const corridor = resolveTrainingRoadCorridor(squad, sim);
  if (!corridor) return true;
  const inset = Number.isFinite(Number(requestedInset))
    ? Math.max(0, Number(requestedInset))
    : resolveTrainingNavigationAgentRadius(squad, sim);
  const allowedDistance = Math.max(4, corridor.halfWidth - inset);
  let previousPoint = { x: Number(source?.x) || 0, y: Number(source?.y) || 0 };
  let enteredCorridor = squad?._trainingRoadCorridorEntered === true || (
    !isPointInsideTrainingHighland(previousPoint, sim)
    && resolveMinionPathProjection(previousPoint, corridor.path).distance <= allowedDistance
  );
  const points = Array.isArray(route) ? route : [];
  for (let index = 0; index < points.length; index += 1) {
    const nextPoint = { x: Number(points[index]?.x) || 0, y: Number(points[index]?.y) || 0 };
    const segmentLength = Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y);
    const sampleCount = Math.max(1, Math.ceil(segmentLength / Math.max(8, allowedDistance * 0.35)));
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const progress = sampleIndex / sampleCount;
      const sample = {
        x: previousPoint.x + ((nextPoint.x - previousPoint.x) * progress),
        y: previousPoint.y + ((nextPoint.y - previousPoint.y) * progress)
      };
      const distance = resolveMinionPathProjection(sample, corridor.path).distance;
      if (isPointInsideTrainingHighland(sample, sim)) continue;
      if (enteredCorridor) {
        if (distance > allowedDistance + 0.5) return false;
      } else if (distance <= allowedDistance) {
        enteredCorridor = true;
      }
    }
    previousPoint = nextPoint;
  }
  return enteredCorridor;
};

const resolveTrainingHighlandEgressPrefix = (sim = {}, source = {}, route = []) => {
  const sampleTerrain = sim?.trainingNavigator?.sampleTerrain;
  if (typeof sampleTerrain !== 'function') return [];
  const startingHighlands = (sampleTerrain(source)?.regionIds || [])
    .filter((regionId) => String(regionId || '').startsWith('terrain-highland-'));
  if (startingHighlands.length <= 0) return [];
  const prefix = [];
  const points = Array.isArray(route) ? route : [];
  for (let index = 0; index < points.length; index += 1) {
    const point = { x: Number(points[index]?.x) || 0, y: Number(points[index]?.y) || 0 };
    prefix.push(point);
    const regionIds = sampleTerrain(point)?.regionIds || [];
    if (startingHighlands.every((regionId) => !regionIds.includes(regionId))) return prefix;
  }
  return [];
};

const buildTrainingRoadFallbackRoute = (
  squad = {},
  sim = {},
  target = {},
  { source = null, routePrefix = [] } = {}
) => {
  const corridor = resolveTrainingRoadCorridor(squad, sim);
  if (!corridor) return [{ x: Number(target?.x) || 0, y: Number(target?.y) || 0 }];
  const requestedSource = source && typeof source === 'object' ? source : squad;
  const safePrefix = (Array.isArray(routePrefix) ? routePrefix : [])
    .map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
  const routeSource = safePrefix[safePrefix.length - 1] || {
    x: Number(requestedSource?.x) || 0,
    y: Number(requestedSource?.y) || 0
  };
  const sourceProjection = resolveMinionPathProjection(routeSource, corridor.path);
  const targetProjection = resolveMinionPathProjection(target, corridor.path);
  const direction = targetProjection.progress >= sourceProjection.progress ? 1 : -1;
  const step = Math.max(18, corridor.halfWidth * 0.55);
  const rawRoute = safePrefix.slice();
  const blockingWalls = filterBlockingObstacles(sim?.buildings || []);
  const navigationRadius = resolveTrainingNavigationAgentRadius(squad, sim);
  const appendRawPoint = (point = null) => {
    if (!point) return;
    const next = { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    const previous = rawRoute[rawRoute.length - 1] || requestedSource;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) > 1) rawRoute.push(next);
  };
  appendRawPoint(sourceProjection.point);
  for (
    let progress = sourceProjection.progress + (direction * step);
    direction > 0 ? progress < targetProjection.progress : progress > targetProjection.progress;
    progress += direction * step
  ) {
    appendRawPoint(resolveMinionPathPointAtProgress(corridor.path, progress));
  }
  appendRawPoint(targetProjection.point);
  const constrainedTarget = constrainPointToTrainingRoadCorridor(
    target,
    corridor,
    resolveTrainingNavigationAgentRadius(squad, sim)
  );
  appendRawPoint(constrainedTarget);

  const route = [];
  const appendRoutePoint = (point = null) => {
    if (!point) return;
    const next = { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    const previous = route[route.length - 1] || requestedSource;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) > 1) route.push(next);
  };
  const segmentBlocked = (from = {}, to = {}) => !isTrainingMovementSegmentTraversable({
    sim,
    start: from,
    target: to,
    walls: blockingWalls,
    radius: navigationRadius
  });
  let previous = { x: Number(requestedSource?.x) || 0, y: Number(requestedSource?.y) || 0 };
  let pointIndex = 0;
  while (pointIndex < rawRoute.length) {
    const next = rawRoute[pointIndex];
    if (!segmentBlocked(previous, next)) {
      appendRoutePoint(next);
      previous = next;
      pointIndex += 1;
      continue;
    }

    let blockedTargetIndex = pointIndex;
    while (
      blockedTargetIndex + 1 < rawRoute.length
      && segmentBlocked(rawRoute[blockedTargetIndex], rawRoute[blockedTargetIndex + 1])
    ) {
      blockedTargetIndex += 1;
    }
    const detourTargetIndex = Math.min(rawRoute.length - 1, blockedTargetIndex + 1);
    const detourTarget = rawRoute[detourTargetIndex];
    const detour = sim?.trainingNavigator?.planRoute?.(previous, detourTarget, {
      obstacles: blockingWalls,
      radius: navigationRadius,
      maxSearchNodes: Math.max(256, resolveTrainingAiNavigationSearchNodes(squad, sim)),
      preferLocalDetour: true,
      preferredLaneId: corridor.laneId
    });
    if (
      !doesTrainingRouteReachTarget(detour, detourTarget)
      || !isTrainingRouteInsideRoadCorridor(squad, sim, previous, detour)
    ) return [];
    let detourPrevious = previous;
    for (let detourIndex = 0; detourIndex < detour.length; detourIndex += 1) {
      const detourPoint = detour[detourIndex];
      if (segmentBlocked(detourPrevious, detourPoint)) return [];
      appendRoutePoint(detourPoint);
      detourPrevious = detourPoint;
    }
    if (Math.hypot(
      (Number(detourPrevious?.x) || 0) - (Number(detourTarget?.x) || 0),
      (Number(detourPrevious?.y) || 0) - (Number(detourTarget?.y) || 0)
    ) > 1) {
      if (segmentBlocked(detourPrevious, detourTarget)) return [];
      appendRoutePoint(detourTarget);
    }
    previous = detourTarget;
    pointIndex = detourTargetIndex + 1;
  }
  return route;
};

const resolveMinionPathPointAtProgress = resolveMinionSquadPathPointAtProgress;

const resolveMinionNavigationWaypoints = ({
  squad = {},
  sim = {},
  walls = [],
  requestedWaypoints = []
} = {}) => {
  const requested = (Array.isArray(requestedWaypoints) ? requestedWaypoints : [])
    .map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }))
    .filter((point, index, points) => (
      index === 0
      || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1
    ));
  if (requested.length <= 0) {
    squad._minionNavigationRoute = null;
    return [];
  }
  const routeKey = requested
    .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
    .join('|');
  const activeRoute = squad?._minionNavigationRoute;
  const currentWaypoints = Array.isArray(squad?.waypoints) ? squad.waypoints : [];
  if (activeRoute?.key === routeKey && currentWaypoints.length > 0) {
    const currentGoal = currentWaypoints[currentWaypoints.length - 1];
    const requestedGoal = requested[requested.length - 1];
    if (Math.hypot(
      (Number(currentGoal?.x) || 0) - requestedGoal.x,
      (Number(currentGoal?.y) || 0) - requestedGoal.y
    ) <= LEADER_ARRIVAL_RADIUS) {
      return currentWaypoints;
    }
  }

  const firstTarget = requested[0];
  const navigationRadius = resolveTrainingNavigationAgentRadius(squad, sim);
  const directPath = isTrainingMovementSegmentTraversable({
    sim,
    start: squad,
    target: firstTarget,
    walls,
    radius: navigationRadius
  });
  if (directPath) {
    squad._minionNavigationRoute = null;
    return requested;
  }
  const navigator = sim?.trainingNavigator;
  if (!navigator?.planRoute || !consumeTrainingNavigationPlanBudget(sim)) return requested;
  const route = navigator.planRoute(squad, firstTarget, {
    obstacles: walls,
    radius: navigationRadius,
    maxSearchNodes: 0,
    preferLocalDetour: true,
    preferredLaneId: resolveTrainingRoadCorridor(squad, sim)?.laneId
  });
  if (
    !doesTrainingRouteReachTarget(route, firstTarget)
    || !isTrainingRouteInsideRoadCorridor(squad, sim, squad, route)
  ) {
    squad._minionNavigationRoute = null;
    return requested;
  }
  const combined = [...route, ...requested.slice(1)]
    .map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }))
    .filter((point, index, points) => (
      index === 0
      || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1
    ));
  squad._minionNavigationRoute = { key: routeKey };
  return combined;
};

const updateSquadBehaviorPlan = (squad, sim, nowSec = 0, walls = [], crowd = null) => {
  if (!squad || squad.remain <= 0) return;
  const actionState = ensureSquadActionState(squad);
  if (actionState.kind === 'stagger' && (Number(actionState.ttl) || 0) > 0) {
    squad.waypoints = [];
    squad.targetSquadId = '';
    squad.action = '硬直';
    return;
  }
  if (actionState.kind === 'transition' && (Number(actionState.ttl) || 0) > 0) {
    squad.action = '调整队形';
    return;
  }
  if (squad?.formationChange && typeof squad.formationChange === 'object') {
    squad.action = '换阵中';
    return;
  }
  if (squad?._formationArrival?.active === true) {
    squad.waypoints = [];
    squad.action = squad?._narrowPassage?.active ? '通过窄地后整队' : '到达整队';
    return;
  }
  const debugAutoPlan = updateTrainingAutoAdvancePlan(squad, sim, walls, nowSec);
  if (debugAutoPlan) return;
  const orderType = resolveSquadOrderType(squad);
  const targetOnlyAttack = isTargetOnlyAttackOrder(squad);
  if (targetOnlyAttack) {
    const targetBuildingId = String(squad?.order?.targetBuildingId || '');
    if (targetBuildingId) {
      const targetBuilding = (Array.isArray(sim?.buildings) ? sim.buildings : []).find((building) => (
        String(building?.id || '') === targetBuildingId
        && building?.destroyed !== true
        && (!Number.isFinite(Number(building?.hp)) || Number(building.hp) > 0)
      )) || null;
      if (!targetBuilding) {
        completeTargetOnlyAttackOrder(squad, nowSec);
      } else {
        squad.targetSquadId = '';
        if (isTrainingCardAiSquad(squad)) {
          squad._trainingAiDecisionDeferred = false;
          squad._trainingAiSelection = null;
        }
        squad.action = Array.isArray(squad?.waypoints) && squad.waypoints.length > 0
          ? '追击目标'
          : '攻击目标';
      }
      return;
    }
    if (!String(squad?.order?.targetSquadId || '')) {
      completeTargetOnlyAttackOrder(squad, nowSec);
      return;
    }
  }
  const chargeCommitted = orderType === ORDER_CHARGE && (Number(squad?.order?.commitUntil) || 0) > nowSec;
  if (orderType === ORDER_MOVE) {
    if (!Array.isArray(squad.waypoints)) squad.waypoints = [];
    squad.action = squad.waypoints.length > 0 ? '移动' : '待命';
    return;
  }
  if (chargeCommitted) {
    squad.action = '冲锋';
    return;
  }
  if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
    squad.action = '兵种攻击';
    return;
  }
  const meleeAttackOrder = squad?.meleeAttackOrder;
  if (meleeAttackOrder && meleeAttackOrder.active !== false) {
    squad.waypoints = [];
    squad.targetSquadId = '';
    squad.action = meleeAttackOrder.phase === 'attack'
      ? '近战警戒'
      : (meleeAttackOrder.phase === 'return' ? '回阵' : '近战突进');
    return;
  }
  if (!Array.isArray(squad.waypoints)) squad.waypoints = [];
  const fieldWidth = Number(sim?.field?.width) || 2700;
  const halfW = fieldWidth / 2;
  const hasWaypoint = squad.waypoints.length > 0;
  let nearestEnemy = null;

  if (squad.behavior === 'retreat') {
    squad.action = '撤退';
    if (!hasWaypoint) {
      const fallbackX = squad.team === TEAM_ATTACKER ? (-halfW + 40) : (halfW - 40);
      squad.waypoints = [{ x: fallbackX, y: 0 }];
    }
    return;
  }

  const guard = squad?.guard && squad.guard.enabled ? squad.guard : null;
  if (guard) {
    const gcx = Number(guard.cx) || (Number(squad.x) || 0);
    const gcy = Number(guard.cy) || (Number(squad.y) || 0);
    const guardRadius = Math.max(12, Number(guard.radius) || 48);
    const returnRadius = Math.max(8, Number(guard.returnRadius) || (guardRadius * 0.36));
    const chaseRadius = Math.max(guardRadius + 10, Number(guard.chaseRadius) || (guardRadius * 1.45));
    let guardEnemy = null;
    if (squad.targetSquadId) {
      const squads = Array.isArray(sim?.squads) ? sim.squads : [];
      for (let i = 0; i < squads.length; i += 1) {
        const row = squads[i];
        if (!row || row.id !== squad.targetSquadId || row.remain <= 0) continue;
        guardEnemy = row;
        break;
      }
    }
    if (!guardEnemy) {
      guardEnemy = pickNearestEnemySquad({ x: gcx, y: gcy, team: squad.team }, sim?.squads || []);
    }
    const enemyDist = guardEnemy
      ? Math.hypot((Number(guardEnemy.x) || 0) - gcx, (Number(guardEnemy.y) || 0) - gcy)
      : Infinity;
    const toCenter = Math.hypot((Number(squad.x) || 0) - gcx, (Number(squad.y) || 0) - gcy);
    const isRangedGuard = isRangedSquad(squad);

    if (guardEnemy && enemyDist <= guardRadius) {
      guard.activeTargetId = guardEnemy.id;
    } else if (guardEnemy && guard.activeTargetId === guardEnemy.id && enemyDist <= chaseRadius) {
      // keep tracking locked target inside chase radius
    } else {
      guard.activeTargetId = '';
    }

    if (isRangedGuard) {
      const patrolTarget = guard?.patrolTarget && typeof guard.patrolTarget === 'object'
        ? guard.patrolTarget
        : null;
      if (!guard.activeTargetId && patrolTarget) {
        const patrolDistance = Math.hypot(
          (Number(patrolTarget.x) || 0) - (Number(squad.x) || 0),
          (Number(patrolTarget.y) || 0) - (Number(squad.y) || 0)
        );
        if (patrolDistance > Math.max(LEADER_ARRIVAL_RADIUS, Number(squad?.radius) * 0.42)) {
          squad.targetSquadId = '';
          if (!Array.isArray(squad.waypoints) || squad.waypoints.length <= 0) {
            squad.waypoints = [{ x: Number(patrolTarget.x) || 0, y: Number(patrolTarget.y) || 0 }];
          }
          squad.action = '巡逻';
          return;
        }
        guard.patrolTarget = null;
      }
      squad.targetSquadId = guardEnemy && enemyDist <= guardRadius ? guardEnemy.id : '';
      if (toCenter > returnRadius) {
        squad.waypoints = [{ x: gcx, y: gcy }];
      } else {
        squad.waypoints = [];
      }
      squad.action = squad.targetSquadId ? '自由攻击' : '警戒';
      return;
    }

    if (guard.activeTargetId) {
      let locked = null;
      const squads = Array.isArray(sim?.squads) ? sim.squads : [];
      for (let i = 0; i < squads.length; i += 1) {
        const row = squads[i];
        if (!row || row.id !== guard.activeTargetId || row.remain <= 0) continue;
        locked = row;
        break;
      }
      if (locked) {
        const lockDistToCenter = Math.hypot((Number(locked.x) || 0) - gcx, (Number(locked.y) || 0) - gcy);
        if (lockDistToCenter <= chaseRadius) {
          squad.targetSquadId = locked.id;
          squad.waypoints = [{ x: Number(locked.x) || 0, y: Number(locked.y) || 0 }];
          squad.action = '自由攻击';
          return;
        }
      }
      guard.activeTargetId = '';
    }

    const patrolTarget = guard?.patrolTarget && typeof guard.patrolTarget === 'object'
      ? guard.patrolTarget
      : null;
    if (patrolTarget) {
      const patrolDistance = Math.hypot(
        (Number(patrolTarget.x) || 0) - (Number(squad.x) || 0),
        (Number(patrolTarget.y) || 0) - (Number(squad.y) || 0)
      );
      if (patrolDistance > Math.max(LEADER_ARRIVAL_RADIUS, Number(squad?.radius) * 0.42)) {
        squad.targetSquadId = '';
        if (!Array.isArray(squad.waypoints) || squad.waypoints.length <= 0) {
          squad.waypoints = [{ x: Number(patrolTarget.x) || 0, y: Number(patrolTarget.y) || 0 }];
        }
        squad.action = '巡逻';
        return;
      }
      guard.patrolTarget = null;
    }

    squad.targetSquadId = '';
    if (toCenter > returnRadius) {
      squad.waypoints = [{ x: gcx, y: gcy }];
      squad.action = '回位';
    } else {
      squad.waypoints = [];
      squad.action = '警戒';
    }
    return;
  }

  if (squad.behavior === 'standby') {
    squad.targetSquadId = '';
    squad.waypoints = [];
    squad.action = '待命';
    return;
  }

  if (squad.behavior === 'idle') {
    squad.targetSquadId = '';
    squad.waypoints = [];
    squad.action = '待命';
    return;
  }

  const playerExplicitOnly = squad.controlMode === 'USER' && !guard && orderType !== ORDER_ATTACK_MOVE && !chargeCommitted;
  if (playerExplicitOnly && !hasWaypoint) {
    squad.targetSquadId = '';
    squad.action = squad.behavior === 'defend' ? '防御' : '待命';
    return;
  }

  const lockedCombatTarget = resolveSquadCombatLockedTarget(squad, sim, nowSec);
  nearestEnemy = targetOnlyAttack
    ? selectTrainingMapEnemyTarget(squad, sim, nowSec)
    : (lockedCombatTarget || selectTrainingMapEnemyTarget(squad, sim, nowSec));
  if (targetOnlyAttack && !isTargetOnlyAttackOrder(squad)) return;
  if (!targetOnlyAttack && lockedCombatTarget && isTrainingCardAiSquad(squad)) {
    squad._trainingAiDecisionDeferred = false;
  }
  if (isTrainingCardAiSquad(squad) && squad._trainingAiDecisionDeferred) {
    squad.action = 'AI思考';
    return;
  }

  if (!nearestEnemy) {
    if (
      orderType === ORDER_ATTACK_MOVE
      && !hasWaypoint
      && Array.isArray(squad?._attackMoveResumeWaypoints)
      && squad._attackMoveResumeWaypoints.length > 0
    ) {
      squad.waypoints = squad._attackMoveResumeWaypoints.map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0
      }));
      squad._attackMoveResumeWaypoints = [];
      squad.action = '攻击前进';
      return;
    }
    if (!hasWaypoint) {
      squad.action = squad.behavior === 'defend' ? '防御' : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '待命');
    }
    return;
  }

  const isRanged = isRangedSquad(squad);
  const attackRange = resolveSquadAttackRange(squad);
  const dist = Math.hypot(
    (nearestEnemy.x || 0) - (squad.x || 0),
    (nearestEnemy.y || 0) - (squad.y || 0)
  ) || 1;
  const desired = isRanged
    ? attackRange.min + ((attackRange.max - attackRange.min) * 0.72)
    : Math.max(attackRange.max * 0.82, (AGENT_RADIUS * 2) + 0.5);
  const engageThreshold = desired * (squad.behavior === 'defend' ? 1.05 : (isRanged ? 1.1 : 1.22));
  const formationGap = resolveSquadFormationEdgeGap(squad, nearestEnemy);
  const rangedTooClose = isRanged && formationGap < Math.max(0, attackRange.min - 4);
  const combatReadiness = resolveSquadAgentCombatReadiness({
    squad,
    target: nearestEnemy,
    sim,
    crowd
  });
  const holdForCombat = !rangedTooClose && (
    shouldHoldSquadCombatTarget(squad, nearestEnemy, nowSec, combatReadiness)
  );

  if (holdForCombat) {
    if (
      orderType === ORDER_ATTACK_MOVE
      && !targetOnlyAttack
      && hasWaypoint
      && (!Array.isArray(squad?._attackMoveResumeWaypoints) || squad._attackMoveResumeWaypoints.length <= 0)
    ) {
      squad._attackMoveResumeWaypoints = squad.waypoints.map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0
      }));
    }
    squad.waypoints = [];
    squad.targetSquadId = nearestEnemy.id;
    squad.action = isRanged
      ? '远程交战'
      : (String(squad?.trainingAi?.state || '') === 'Chase' ? '追击接敌' : '近战接敌');
    return;
  }

  if ((dist > engageThreshold || combatReadiness?.ready === false) && !hasWaypoint) {
    const planned = planTrainingAttackNavigationTarget({
      squad,
      sim,
      target: nearestEnemy,
      desiredDistance: desired,
      ranged: isRanged,
      walls
    });
    if (planned?.deferred) {
      squad.targetSquadId = nearestEnemy.id;
      squad.action = '路径排队';
      return;
    }
    const navigationState = isTrainingCardAiSquad(squad)
      ? recordTrainingTargetNavigationPlan({
          squad,
          targetId: nearestEnemy.id,
          planned,
          sim,
          nowSec
        })
      : null;
    const targetBlocked = navigationState?.blockedUntil > nowSec || (!navigationState && !planned.ok);
    if (navigationState?.blockedUntil > nowSec) squad._trainingAiSelection = null;
    squad.targetSquadId = targetBlocked ? '' : nearestEnemy.id;
    squad.action = planned.ok
      ? (String(squad?.trainingAi?.state || '') === 'Chase'
        ? '追击目标'
        : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '移动'))
      : (isTrainingCardSquad(squad) ? '路径绕行' : '路径等待');
  } else if (isRanged && dist < Math.max(attackRange.min + 6, desired * 0.72) && !hasWaypoint) {
    const planned = planTrainingAttackNavigationTarget({
      squad,
      sim,
      target: nearestEnemy,
      desiredDistance: Math.max(attackRange.min + 6, desired * 0.72),
      ranged: true,
      walls
    });
    if (planned?.deferred) {
      squad.targetSquadId = nearestEnemy.id;
      squad.action = '路径排队';
      return;
    }
    const navigationState = isTrainingCardAiSquad(squad)
      ? recordTrainingTargetNavigationPlan({
          squad,
          targetId: nearestEnemy.id,
          planned,
          sim,
          nowSec
        })
      : null;
    const targetBlocked = navigationState?.blockedUntil > nowSec || (!navigationState && !planned.ok);
    if (navigationState?.blockedUntil > nowSec) squad._trainingAiSelection = null;
    squad.targetSquadId = targetBlocked ? '' : nearestEnemy.id;
    squad.action = planned.ok
      ? (String(squad?.trainingAi?.state || '') === 'Chase'
        ? '追击目标'
        : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '移动'))
      : (isTrainingCardSquad(squad) ? '路径绕行' : '路径等待');
  } else if (!hasWaypoint) {
    squad.action = squad.behavior === 'defend' ? '防御' : (orderType === ORDER_ATTACK_MOVE ? '攻击前进' : '普通攻击');
  }
};

const createAgent = ({
  id,
  squadId,
  team,
  unitTypeId,
  category,
  unitCategory = SKILL_CATEGORY_MELEE,
  unitSubtype = 'balance',
  x,
  y,
  weight,
  slotOrder = 0,
  formationSlot = null,
  formationSpacingSlots = null,
  moveSpeedMul = 1,
  combatScale = 1,
  attackRangeMin = 0,
  attackRangeMax = 0,
  isFlagBearer = false,
  isMinionWaveUnit = false,
  isNeutralCampUnit = false,
  yaw = 0
}) => ({
  id,
  squadId,
  team,
  unitTypeId,
  typeCategory: category,
  unitCategory,
  unitSubtype,
  x: Number(x) || 0,
  y: Number(y) || 0,
  vx: 0,
  vy: 0,
  yaw: Number.isFinite(Number(yaw)) ? Number(yaw) : 0,
  radius: AGENT_RADIUS,
  weight: Math.max(0.2, Number(weight) || 1),
  initialWeight: Math.max(0.2, Number(weight) || 1),
  hpWeight: Math.max(0.2, Number(weight) || 1),
  combatScale: clamp(Number(combatScale) || 1, 0.05, 32),
  state: 'idle',
  attackCd: 0,
  buildingAttackCd: 0,
  supportCastCd: 0,
  targetAgentId: '',
  targetBuildingId: '',
  supportTargetAgentId: '',
  supportTargetSquadId: '',
  _combatTargetLockUntil: 0,
  _combatTargetSquadId: '',
  _formationDetached: false,
  slotOrder,
  formationSlot: formationSlot ? normalizeFormationSlot(formationSlot) : null,
  formationSpacingSlots: formationSpacingSlots && typeof formationSpacingSlots === 'object'
    ? formationSpacingSlots
    : null,
  _formationHold: false,
  _formationHoldSpacing: '',
  _formationLocked: true,
  moveSpeedMul: clamp(Number(moveSpeedMul) || 1, 0.6, 1.8),
  attackRangeMin: Math.max(0, Number(attackRangeMin) || 0),
  attackRangeMax: Math.max(0, Number(attackRangeMax) || 0),
  castState: null,
  meleeChargeState: null,
  isFlagBearer: !!isFlagBearer,
  isMinionWaveUnit: !!isMinionWaveUnit,
  isNeutralCampUnit: !!isNeutralCampUnit,
  hitTimer: 0,
  dead: false
});

const ensureFlagBearer = (squad, agents = []) => {
  const rows = Array.isArray(agents) ? agents : [];
  let flagBearer = null;
  const preferredId = String(squad?.flagBearerAgentId || '');
  for (let index = 0; index < rows.length; index += 1) {
    const agent = rows[index];
    if (!agent || agent.dead || (agent.weight || 0) <= 0.001) continue;
    if (preferredId && agent.id === preferredId) {
      flagBearer = agent;
      break;
    }
    if (!flagBearer || (Number(agent.slotOrder) || 0) < (Number(flagBearer.slotOrder) || 0)) {
      flagBearer = agent;
    }
  }
  if (!flagBearer) {
    if (squad) squad.flagBearerAgentId = '';
    return null;
  }
  for (let index = 0; index < rows.length; index += 1) {
    const agent = rows[index];
    if (!agent || agent.dead || (agent.weight || 0) <= 0.001) continue;
    agent.isFlagBearer = !!flagBearer && agent.id === flagBearer.id;
  }
  if (squad) squad.flagBearerAgentId = flagBearer?.id || '';
  return flagBearer;
};

const holdAgentsWhileAiPlanPending = (agents = [], dt = 0) => {
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent || agent.dead) return;
    stepAgentCast(agent, dt);
    clearAvoidanceMemory(agent);
    agent.vx = 0;
    agent.vy = 0;
    agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - dt);
    agent.state = agent.attackCd > 0 ? 'attack' : 'idle';
  });
};

const stepMinionWaveCombatAgent = ({
  agent = {},
  squad = {},
  sim = {},
  walls = [],
  dt = 0,
  speed = 0,
  combatDirective = null
} = {}) => {
  const minionAi = squad?._minionAi;
  const agentPlan = agent?._minionAi;
  if (
    !agentPlan
    || !Number.isFinite(Number(agentPlan?.combatX))
    || !Number.isFinite(Number(agentPlan?.combatY))
    || (
      minionAi?.state !== MINION_WAVE_AI_STATE.APPROACH
      && minionAi?.state !== MINION_WAVE_AI_STATE.ATTACK_HOLD
    )
  ) return false;
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  const start = { x: Number(agent.x) || 0, y: Number(agent.y) || 0 };
  const destination = { x: Number(agentPlan.combatX) || 0, y: Number(agentPlan.combatY) || 0 };
  const toDestination = normalizeVec(destination.x - start.x, destination.y - start.y);
  let next = { ...destination };
  if (toDestination.len > 0.32) {
    const stepDistance = Math.min(
      toDestination.len,
      Math.max(8, Number(speed) || 0) * safeDt
    );
    next = {
      x: start.x + (toDestination.x * stepDistance),
      y: start.y + (toDestination.y * stepDistance)
    };
    const swept = resolveSweptObstacleStep(
      start,
      next,
      walls,
      (Number(agent.radius) || AGENT_RADIUS) + 0.5
    );
    next.x = swept.x;
    next.y = swept.y;
    const collisionWalls = queryObstacleCandidates(
      walls,
      next.x,
      next.y,
      (Number(agent.radius) || AGENT_RADIUS) + 0.5
    );
    collisionWalls.forEach((wall) => {
      if (!wall || wall.destroyed) return;
      const pushed = pushOutOfRect(next, wall, (Number(agent.radius) || AGENT_RADIUS) + 0.5);
      next.x = pushed.x;
      next.y = pushed.y;
    });
  }
  const halfWidth = (Number(sim?.field?.width) || 2700) * 0.5;
  const halfHeight = (Number(sim?.field?.height) || 1488) * 0.5;
  next.x = clamp(next.x, -halfWidth + 2, halfWidth - 2);
  next.y = clamp(next.y, -halfHeight + 2, halfHeight - 2);
  const legalStep = resolveTrainingLegalMovementStep({
    sim,
    start,
    target: { x: next.x, y: next.y },
    walls,
    radius: (Number(agent.radius) || AGENT_RADIUS) + 0.5
  });
  agent.x = legalStep.x;
  agent.y = legalStep.y;
  agent.vx = (agent.x - start.x) / safeDt;
  agent.vy = (agent.y - start.y) / safeDt;
  if (
    legalStep.legal
    && Math.hypot(agent.x - destination.x, agent.y - destination.y) <= 0.32
  ) {
    agent.vx = 0;
    agent.vy = 0;
  }
  const facingTarget = combatDirective?.target || null;
  if (facingTarget) {
    agent.yaw = Math.atan2(
      (Number(facingTarget.y) || 0) - (Number(agent.y) || 0),
      (Number(facingTarget.x) || 0) - (Number(agent.x) || 0)
    );
  } else if (Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08) {
    agent.yaw = Math.atan2(agent.vy, agent.vx);
  } else {
    agent.yaw = Math.atan2(Number(minionAi?.axisY) || 0, Number(minionAi?.axisX) || 1);
  }
  agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
  agent.state = Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08
    ? 'move'
    : ((combatDirective || (Number(agent.attackCd) || 0) > 0) ? 'attack' : 'idle');
  agent._formationLocked = false;
  agent._formationHold = false;
  agent._formationHoldSpacing = '';
  return true;
};

const createAgentsForSquad = (squad, crowd) => {
  const unitMap = crowd.unitTypeMap || new Map();
  const squadKind = resolveTrainingSquadKind(squad);
  const isMinionWaveUnit = squadKind === TRAINING_SQUAD_KIND.MINION;
  const isNeutralCampUnit = squadKind === TRAINING_SQUAD_KIND.NEUTRAL;
  const countsByType = normalizeUnitsMap(squad?.units || {});
  const remain = Math.max(1, Math.floor(Number(squad?.remain) || sumUnitsMap(countsByType) || 1));
  const repConfig = resolveSquadRepConfig(squad, crowd);
  const requestedMaxAgentWeight = Math.max(
    1,
    Number(repConfig.requestedMaxAgentWeight) || repConfig.maxAgentWeight
  );
  const normalizeCombatPower = requestedMaxAgentWeight !== repConfig.maxAgentWeight;
  const damageExponent = Math.max(0.2, Number(repConfig.damageExponent) || DEFAULT_DAMAGE_EXPONENT);
  const minRequiredByType = Object.fromEntries(
    Object.entries(countsByType).map(([unitTypeId, count]) => [
      unitTypeId,
      Math.max(1, Math.ceil(count / Math.max(1, repConfig.maxAgentWeight)))
    ])
  );
  const minRequired = Object.values(minRequiredByType).reduce((sum, c) => sum + c, 0);
  const agentBudget = Math.max(
    minRequired,
    resolveVisibleAgentCount(remain, repConfig.maxAgentWeight, repConfig.strictAgentMapping)
  );
  const alloc = repConfig.strictAgentMapping
    ? { ...minRequiredByType }
    : hamiltonAllocate(countsByType, agentBudget);
  const agents = [];
  const allocTotal = Math.max(1, Object.values(alloc).reduce((sum, c) => sum + c, 0));
  const formationRect = squad?.formationRect && typeof squad.formationRect === 'object' ? squad.formationRect : null;
  const formationSpacing = Math.max(0.1, Number(formationRect?.spacing) || ((AGENT_RADIUS * 2) + AGENT_GAP));
  const hintedCols = formationRect
    ? Math.max(1, Math.round(Math.max(1, Number(formationRect.width) || 1) / formationSpacing))
    : 0;
  const baseCols = Math.max(1, hintedCols || Math.ceil(Math.sqrt(allocTotal)));
  const formationForward = resolveSquadFormationForward(squad);
  const sideVec = { x: -formationForward.y, y: formationForward.x };
  const deploySlots = Array.isArray(squad?.deploySlots)
    ? squad.deploySlots.map((slot) => normalizeFormationSlot(slot))
    : [];
  const deploySlotsByType = new Map();
  (Array.isArray(squad?.deploySlots) ? squad.deploySlots : []).forEach((slot) => {
    const unitTypeId = typeof slot?.unitTypeId === 'string' ? slot.unitTypeId.trim() : '';
    if (!unitTypeId) return;
    const typedSlots = deploySlotsByType.get(unitTypeId) || [];
    typedSlots.push(normalizeFormationSlot(slot));
    deploySlotsByType.set(unitTypeId, typedSlots);
  });
  const deployedSlotCursorByType = new Map();

  const resolveFormationSlotForType = (unitTypeId, slotOrder, fallbackOffset) => {
    const typedSlots = deploySlotsByType.get(unitTypeId) || [];
    const typedIndex = deployedSlotCursorByType.get(unitTypeId) || 0;
    if (typedSlots[typedIndex]) {
      deployedSlotCursorByType.set(unitTypeId, typedIndex + 1);
      return typedSlots[typedIndex];
    }
    return deploySlots[slotOrder] || {
      side: Number(fallbackOffset?.side) || 0,
      front: -(Number(fallbackOffset?.back) || 0)
    };
  };

  const resolveSpawnPoint = (slot) => {
    return {
      x: (Number(squad.x) || 0) + (sideVec.x * slot.side) + (formationForward.x * slot.front),
      y: (Number(squad.y) || 0) + (sideVec.y * slot.side) + (formationForward.y * slot.front)
    };
  };

  let slotOrder = 0;
  Object.entries(alloc).forEach(([unitTypeId, count]) => {
    const safeCount = Math.max(1, count);
    const perAgentWeight = Math.min(
      Math.max(0.2, (countsByType[unitTypeId] || 1) / safeCount),
      repConfig.maxAgentWeight
    );
    const baselineAgentCount = Math.max(
      1,
      Math.ceil((countsByType[unitTypeId] || 1) / requestedMaxAgentWeight)
    );
    const baselineAgentWeight = Math.max(
      0.2,
      (countsByType[unitTypeId] || 1) / baselineAgentCount
    );
    const baselinePower = baselineAgentCount * Math.pow(baselineAgentWeight, damageExponent);
    const currentPower = safeCount * Math.pow(perAgentWeight, damageExponent);
    const combatScale = normalizeCombatPower
      ? baselinePower / Math.max(0.001, currentPower)
      : 1;
    const unitType = unitMap.get(unitTypeId) || {};
    const category = inferCategoryFromUnitType(unitType, squad?.classTag || 'infantry');
    const unitCategory = inferSkillCategoryFromUnitType(unitType);
    const unitSubtype = inferSkillSubtypeFromUnitType(unitType, unitCategory);
    const moveSpeedMul = resolveAgentSpeedMul(unitType, category);
    const attackRange = resolveUnitTypeAttackRange(unitType);
    for (let i = 0; i < safeCount; i += 1) {
      const offset = slotOffsetForIndex(slotOrder, baseCols);
      const formationSlot = resolveFormationSlotForType(unitTypeId, slotOrder, offset);
      const spawnPoint = resolveSpawnPoint(formationSlot);
      agents.push(createAgent({
        id: `${squad.id}_ag_${slotOrder + 1}`,
        squadId: squad.id,
        team: squad.team,
        unitTypeId,
        category,
        unitCategory,
        unitSubtype,
        x: spawnPoint.x,
        y: spawnPoint.y,
        weight: perAgentWeight,
        combatScale,
        slotOrder,
        formationSlot,
        moveSpeedMul,
        attackRangeMin: attackRange.min,
        attackRangeMax: attackRange.max,
        isMinionWaveUnit,
        isNeutralCampUnit,
        yaw: isNeutralCampUnit
          ? Math.atan2(formationForward.y, formationForward.x)
          : 0
      }));
      slotOrder += 1;
    }
  });
  if (agents.length <= 0) {
    agents.push(createAgent({
      id: `${squad.id}_ag_1`,
      squadId: squad.id,
      team: squad.team,
      unitTypeId: '__fallback__',
      category: squad?.classTag || 'infantry',
      unitCategory: inferSkillCategoryFromUnitType(squad, SKILL_CATEGORY_MELEE),
      unitSubtype: inferSkillSubtypeFromUnitType(squad, inferSkillCategoryFromUnitType(squad, SKILL_CATEGORY_MELEE)),
      x: Number(squad.x) || 0,
      y: Number(squad.y) || 0,
      weight: Math.min(remain, repConfig.maxAgentWeight),
      slotOrder: 0,
      formationSlot: { side: 0, front: 0 },
      moveSpeedMul: resolveAgentSpeedMul({}, squad?.classTag || 'infantry'),
      attackRangeMin: resolveSquadAttackRange(squad).min,
      attackRangeMax: resolveSquadAttackRange(squad).max,
      isMinionWaveUnit,
      isNeutralCampUnit,
      yaw: isNeutralCampUnit
        ? Math.atan2(formationForward.y, formationForward.x)
        : 0
    }));
  }
  const neutralFormation = applyNeutralRepresentativeFormation(squad, agents, formationForward);
  const effectiveFormationSpacing = neutralFormation?.spacing || formationSpacing;
  assignFormationSpacingSlots(agents, effectiveFormationSpacing);
  squad._repMaxAgentWeight = repConfig.maxAgentWeight;
  squad._crowdBaseColumns = Math.max(
    1,
    neutralFormation?.columns || hintedCols || Math.ceil(Math.sqrt(agents.length))
  );
  const movementForward = resolveSquadMovementForward(squad);
  squad._crowdForward = movementForward;
  squad.dirX = movementForward.x;
  squad.dirY = movementForward.y;
  squad.smoothedDirX = movementForward.x;
  squad.smoothedDirY = movementForward.y;
  squad._crowdFormationForward = { x: formationForward.x, y: formationForward.y };
  squad._formationPoseX = Number(squad.x) || 0;
  squad._formationPoseY = Number(squad.y) || 0;
  squad._formationPoseYaw = Math.atan2(formationForward.y, formationForward.x);
  ensureFlagBearer(squad, agents);
  return agents;
};

const resolveTrainingNavigationTarget = (squad = null) => {
  const waypoint = Array.isArray(squad?.waypoints) ? squad.waypoints[0] : null;
  if (!waypoint) return null;
  return {
    x: Number(waypoint?.x) || 0,
    y: Number(waypoint?.y) || 0
  };
};

const resolveTrainingNavigationReplanCooldown = (sim = null) => {
  const configuredCooldown = sim?.trainingNavigator?.getPathFailureReplanCooldownSeconds?.();
  return clamp(Number(configuredCooldown) || 0.35, 0.1, 2);
};

const doesTrainingRouteReachTarget = (route = [], target = {}, radius = LEADER_ARRIVAL_RADIUS) => {
  const last = Array.isArray(route) && route.length > 0 ? route[route.length - 1] : null;
  if (!last) return false;
  return Math.hypot(
    (Number(last?.x) || 0) - (Number(target?.x) || 0),
    (Number(last?.y) || 0) - (Number(target?.y) || 0)
  ) <= Math.max(1, Number(radius) || LEADER_ARRIVAL_RADIUS);
};

const planTrainingRouteWithPassageFallback = ({
  squad = null,
  sim = null,
  start = {},
  target = {},
  walls = [],
  maxSearchNodes = 0,
  preferLocalDetour = true,
  preferredLaneId = ''
} = {}) => {
  const navigator = sim?.trainingNavigator;
  if (!navigator?.planRoute) return {
    route: [{ x: Number(target?.x) || 0, y: Number(target?.y) || 0 }],
    scale: 'AGENT',
    formationFailed: false,
    passageAttempted: false,
    passageSucceeded: false
  };
  const agentRadius = resolveTrainingNavigationAgentRadius(squad, sim);
  const formationRadius = resolveTrainingFormationNavigationRadius(squad, sim);
  const formationPathClearance = resolveTrainingNavigationPathClearance(sim);
  const passagePathClearance = resolveTrainingNavigationPathClearance(sim, { passage: true });
  const sharedOptions = {
    obstacles: walls,
    maxSearchNodes,
    preferLocalDetour,
    preferredLaneId
  };
  const pending = squad?._trainingPassageFallbackPending;
  const deferPassageFallback = isTrainingCardAiSquad(squad);
  const pendingMatches = isTrainingCardSquad(squad)
    && deferPassageFallback
    && pending
    && Math.hypot(
      finiteNumber(pending?.start?.x) - finiteNumber(start?.x),
      finiteNumber(pending?.start?.y) - finiteNumber(start?.y)
    ) < 8
    && Math.hypot(
      finiteNumber(pending?.target?.x) - finiteNumber(target?.x),
      finiteNumber(pending?.target?.y) - finiteNumber(target?.y)
    ) < 8;
  const formationRoute = pendingMatches
    ? (Array.isArray(pending?.route) ? pending.route : [])
    : navigator.planRoute(start, target, {
      ...sharedOptions,
      radius: formationRadius,
      pathClearance: formationPathClearance
    });
  if (doesTrainingRouteReachTarget(formationRoute, target)) {
    if (isTrainingCardSquad(squad)) delete squad._trainingPassageFallbackPending;
    return {
      route: formationRoute,
      scale: 'FORMATION',
      radius: formationRadius,
      formationFailed: false,
      passageAttempted: false,
      passageSucceeded: false
    };
  }
  if (!isTrainingCardSquad(squad) || formationRadius <= agentRadius + 0.05) {
    return {
      route: formationRoute,
      scale: 'FORMATION',
      radius: formationRadius,
      formationFailed: true,
      passageAttempted: false,
      passageSucceeded: false
    };
  }
  if (deferPassageFallback && !pendingMatches) {
    squad._trainingPassageFallbackPending = {
      start: { x: Number(start?.x) || 0, y: Number(start?.y) || 0 },
      target: { x: Number(target?.x) || 0, y: Number(target?.y) || 0 },
      route: Array.isArray(formationRoute) ? formationRoute.map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0
      })) : []
    };
    return {
      route: formationRoute,
      scale: 'FORMATION',
      radius: formationRadius,
      formationFailed: true,
      passageAttempted: false,
      passageSucceeded: false,
      deferredPassage: true
    };
  }
  const passageRoute = navigator.planRoute(start, target, {
    ...sharedOptions,
    radius: agentRadius,
    pathClearance: passagePathClearance
  });
  if (doesTrainingRouteReachTarget(passageRoute, target)) {
    delete squad._trainingPassageFallbackPending;
    return {
      route: passageRoute,
      scale: 'PASSAGE',
      radius: agentRadius,
      formationFailed: true,
      passageAttempted: true,
      passageSucceeded: true
    };
  }
  delete squad._trainingPassageFallbackPending;
  return {
    route: passageRoute,
    scale: 'PASSAGE',
    radius: agentRadius,
    formationFailed: true,
    passageAttempted: true,
    passageSucceeded: false
  };
};

const advanceSquadWaypoint = (squad = null) => {
  if (!squad || !Array.isArray(squad.waypoints) || squad.waypoints.length <= 0) return null;
  const reached = squad.waypoints.shift() || null;
  if (isTrainingCardSquad(squad) && Array.isArray(squad?._passageRoute)) {
    const route = squad._passageRoute;
    if (route.length > 0 && reached) {
      const reachedIndex = route.findIndex((point) => (
        Math.hypot(
          (Number(point?.x) || 0) - (Number(reached?.x) || 0),
          (Number(point?.y) || 0) - (Number(reached?.y) || 0)
        ) <= 0.05
      ));
      if (reachedIndex >= 0) route.splice(0, reachedIndex + 1);
      else route.shift();
    }
  }
  if (squad.order && typeof squad.order === 'object') {
    const pathLength = Array.isArray(squad.order.pathPoints) ? squad.order.pathPoints.length : 0;
    squad.order.pathIndex = Math.min(
      pathLength,
      Math.max(0, Math.floor(Number(squad.order.pathIndex) || 0)) + 1
    );
  }
  squad._plannedMoveWaypointIndex = Math.max(
    0,
    Math.floor(Number(squad?._plannedMoveWaypointIndex) || 0) + 1
  );
  return reached;
};

const beginSquadFormationArrival = (squad = null, target = null, nowSec = 0) => {
  if (!squad || !target) return;
  const previous = squad?._formationArrival && typeof squad._formationArrival === 'object'
    ? squad._formationArrival
    : null;
  squad._formationArrival = {
    active: true,
    orderType: previous?.active ? previous.orderType : resolveSquadOrderType(squad),
    targetX: Number(target?.x) || 0,
    targetY: Number(target?.y) || 0,
    startedAt: previous?.active ? (Number(previous.startedAt) || nowSec) : nowSec,
    stableSince: 0,
    maximumError: Infinity,
    readyRatio: 0
  };
  squad.vx = 0;
  squad.vy = 0;
  squad.speed = 0;
  squad.action = '到达整队';
};

const hasActiveTrainingCardPassage = (squad = null) => (
  isTrainingCardSquad(squad)
  && squad?._squadController?.passageDebug?.passageActive === true
);

const updateSquadFormationArrival = ({
  squad = null,
  agents = [],
  passage = null,
  nowSec = 0
} = {}) => {
  const state = squad?._formationArrival;
  if (!squad || !state?.active) return false;
  if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
    squad._formationArrival = null;
    return false;
  }
  const metrics = resolveSquadFormationMetrics({ squad, agents, passage: null });
  const settled = !passage?.active && metrics.settled;
  const stableSince = settled
    ? (Number(state.stableSince) || nowSec)
    : 0;
  squad._formationArrival = {
    ...state,
    stableSince,
    maximumError: metrics.maximumError,
    readyRatio: metrics.readyRatio,
    recoveringCount: metrics.recoveringCount
  };
  squad.formationArrivalState = settled ? 'STABLE' : (passage?.active ? 'REFORMING' : 'ASSEMBLING');
  squad.formationArrivalError = metrics.maximumError;
  squad.action = passage?.active ? '通过窄地后整队' : '到达整队';
  if (!settled || nowSec - stableSince < FORMATION_ARRIVAL_STABLE_SEC) return false;

  const completedOrderType = String(state.orderType || resolveSquadOrderType(squad));
  squad._formationArrival = null;
  squad.formationArrivalState = 'COMPLETE';
  squad.formationArrivalError = 0;
  if (completedOrderType === ORDER_MOVE || completedOrderType === ORDER_CHARGE) {
    squad.behavior = 'idle';
    squad.targetSquadId = '';
    squad.action = '待命';
    squad.order = {
      type: ORDER_IDLE,
      issuedAt: nowSec,
      commitUntil: 0,
      targetPoint: null,
      targetSquadId: '',
      targetBuildingId: '',
      pathPoints: [],
      pathIndex: 0
    };
    return true;
  }
  squad.action = squad.controlMode === 'AI' ? '自动待命' : '攻击前进';
  return true;
};

const clearAgentFormationRecovery = (
  agent = null,
  nowSec = 0,
  error = 0,
  monitor = null
) => {
  if (!agent) return;
  const previous = agent?._formationRecovery && typeof agent._formationRecovery === 'object'
    ? agent._formationRecovery
    : {};
  const monitoredProgressAt = Number(monitor?.lastProgressAt);
  const monitoredMeaningfulX = Number(monitor?.lastMeaningfulX);
  const monitoredMeaningfulY = Number(monitor?.lastMeaningfulY);
  const monitoredMeaningfulError = Number(monitor?.lastMeaningfulError);
  if (previous?.active !== true && previous?.mode === 'NORMAL') {
    previous.lastX = Number(agent?.x) || 0;
    previous.lastY = Number(agent?.y) || 0;
    previous.lastError = Math.max(0, Number(error) || 0);
    if (Number.isFinite(monitoredMeaningfulX)) previous.lastMeaningfulX = monitoredMeaningfulX;
    if (Number.isFinite(monitoredMeaningfulY)) previous.lastMeaningfulY = monitoredMeaningfulY;
    if (Number.isFinite(monitoredMeaningfulError)) previous.lastMeaningfulError = Math.max(0, monitoredMeaningfulError);
    if (Number.isFinite(monitoredProgressAt)) previous.lastProgressAt = monitoredProgressAt;
    previous.terrainBlocked = false;
    agent._formationDetached = false;
    agent.formationRecoveryState = 'NONE';
    if (agent?.isMinionWaveUnit === true) {
      agent._minionRecovery = previous;
      agent.minionRecoveryState = 'NONE';
    }
    return;
  }
  const state = {
    active: false,
    mode: 'NORMAL',
    route: [],
    routeIndex: 0,
    plannedAt: 0,
    targetX: 0,
    targetY: 0,
    lastX: Number(agent?.x) || 0,
    lastY: Number(agent?.y) || 0,
    lastMeaningfulX: Number.isFinite(monitoredMeaningfulX)
      ? monitoredMeaningfulX
      : (Number.isFinite(Number(previous?.lastMeaningfulX)) ? Number(previous.lastMeaningfulX) : (Number(agent?.x) || 0)),
    lastMeaningfulY: Number.isFinite(monitoredMeaningfulY)
      ? monitoredMeaningfulY
      : (Number.isFinite(Number(previous?.lastMeaningfulY)) ? Number(previous.lastMeaningfulY) : (Number(agent?.y) || 0)),
    lastError: Math.max(0, Number(error) || 0),
    lastMeaningfulError: Number.isFinite(monitoredMeaningfulError)
      ? Math.max(0, monitoredMeaningfulError)
      : (Number.isFinite(Number(previous?.lastMeaningfulError))
        ? Math.max(0, Number(previous.lastMeaningfulError))
        : Math.max(0, Number(error) || 0)),
    lastProgressAt: Number.isFinite(monitoredProgressAt)
      ? monitoredProgressAt
      : (Number.isFinite(Number(previous?.lastProgressAt)) ? Number(previous.lastProgressAt) : nowSec),
    failedSince: 0,
    obstacleId: '',
    terrainBlocked: false
  };
  agent._formationRecovery = state;
  agent._formationDetached = false;
  agent.formationRecoveryState = 'NONE';
  if (agent?.isMinionWaveUnit === true) {
    agent._minionRecovery = state;
    agent.minionRecoveryState = 'NONE';
  }
};

const resolveAgentFormationRecoveryGuidance = ({
  agent = null,
  squad = null,
  sim = null,
  walls = [],
  target = null,
  enabled = true,
  flowing = false,
  nowSec = 0
} = {}) => {
  if (!agent || !squad || !enabled || !target) {
    if (agent?._formationRecovery?.active || agent?._minionRecovery?.active) {
      clearAgentFormationRecovery(agent, nowSec, 0);
    }
    return null;
  }
  const point = { x: Number(agent?.x) || 0, y: Number(agent?.y) || 0 };
  const radius = Math.max(0.5, Number(agent?.radius) || AGENT_RADIUS) + 0.5;
  const error = Math.hypot(
    (Number(target?.x) || 0) - point.x,
    (Number(target?.y) || 0) - point.y
  );
  const configuredSpacing = Math.max(
    (AGENT_RADIUS * 2) + AGENT_GAP,
    Number(squad?.formationRect?.spacing) || 0
  );
  const triggerDistance = Math.max(18, configuredSpacing * 1.15);
  const releaseDistance = Math.max(8, triggerDistance * 0.52);
  const previous = agent?._formationRecovery && typeof agent._formationRecovery === 'object'
    ? agent._formationRecovery
    : (agent?._minionRecovery && typeof agent._minionRecovery === 'object'
      ? agent._minionRecovery
      : {});
  const wasDetached = agent?._formationDetached === true || previous?.active === true;
  const isMinion = isTrainingMinionSquad(squad);
  const stuckDelay = isMinion ? MINION_RECOVERY_STUCK_DELAY_SEC : FORMATION_RECOVERY_STUCK_DELAY_SEC;
  const replanInterval = isMinion ? MINION_RECOVERY_REPLAN_INTERVAL_SEC : FORMATION_RECOVERY_REPLAN_INTERVAL_SEC;
  const targetDriftThreshold = isMinion ? MINION_RECOVERY_TARGET_DRIFT : FORMATION_RECOVERY_TARGET_DRIFT;
  const waypointRadius = isMinion ? MINION_RECOVERY_WAYPOINT_RADIUS : FORMATION_RECOVERY_WAYPOINT_RADIUS;
  const maximumSpeedMul = isMinion ? MINION_RECOVERY_MAX_SPEED_MUL : FORMATION_RECOVERY_MAX_SPEED_MUL;
  const previousLastX = Number(previous?.lastX);
  const previousLastY = Number(previous?.lastY);
  const previousMeaningfulX = Number(previous?.lastMeaningfulX);
  const previousMeaningfulY = Number(previous?.lastMeaningfulY);
  const movedDistance = Math.hypot(
    point.x - (Number.isFinite(previousLastX) ? previousLastX : point.x),
    point.y - (Number.isFinite(previousLastY) ? previousLastY : point.y)
  );
  const previousError = Number.isFinite(Number(previous?.lastError))
    ? Number(previous.lastError)
    : error;
  const previousProgressAt = Number(previous?.lastProgressAt);
  let lastProgressAt = Number.isFinite(previousProgressAt) ? previousProgressAt : nowSec;
  const targetDirection = normalizeVec(
    (Number(target?.x) || 0) - point.x,
    (Number(target?.y) || 0) - point.y
  );
  let lastMeaningfulX = Number.isFinite(previousMeaningfulX) ? previousMeaningfulX : point.x;
  let lastMeaningfulY = Number.isFinite(previousMeaningfulY) ? previousMeaningfulY : point.y;
  let lastMeaningfulError = Number.isFinite(Number(previous?.lastMeaningfulError))
    ? Number(previous.lastMeaningfulError)
    : previousError;
  const netMeaningfulTowardTarget = (
    ((point.x - lastMeaningfulX) * targetDirection.x)
    + ((point.y - lastMeaningfulY) * targetDirection.y)
  );
  // Merely moving is not progress: an agent circling an obstacle can travel a
  // long distance while making no net advance toward its local goal.  Keep a
  // small monotonic progress marker even before recovery becomes active.
  const madeMeaningfulProgress = error <= Math.min(previousError, lastMeaningfulError) - 0.18
    || netMeaningfulTowardTarget >= 0.34
    || (error <= releaseDistance && movedDistance >= 0.08);
  if (madeMeaningfulProgress) {
    lastProgressAt = nowSec;
    lastMeaningfulX = point.x;
    lastMeaningfulY = point.y;
    lastMeaningfulError = error;
  }
  const directHit = error > releaseDistance
    ? raycastObstacles(point, target, walls, radius)
    : null;
  const terrainSegmentBlocked = error > releaseDistance && !isTrainingMovementSegmentTraversable({
    sim,
    start: point,
    target,
    walls,
    radius
  });
  const terrainBlockedAt = Number(agent?._terrainBlockedAt);
  const recentTerrainBlock = agent?._nextFormationStepIllegal === true
    || (
      Number.isFinite(terrainBlockedAt)
      && terrainBlockedAt > 0
      && nowSec - terrainBlockedAt <= Math.max(0.35, stuckDelay * 2.5)
    );
  const stalled = error > triggerDistance && nowSec - lastProgressAt >= stuckDelay;
  const directBlockHasPersisted = nowSec - lastProgressAt >= (stuckDelay * 0.65);
  // A nearby visual slot can graze an obstacle while the agent still has room
  // to continue with normal local avoidance.  Reserve immediate recovery for
  // a genuinely detached target or an already-illegal move; otherwise let
  // the progress tracker confirm that the local steer cannot clear it.
  const directObstacleRequiresRecovery = !!directHit?.obstacle && (
    error >= triggerDistance
    || recentTerrainBlock
    || directBlockHasPersisted
  );
  const terrainTopologyRequiresRecovery = terrainSegmentBlocked && (
    error >= triggerDistance
    || recentTerrainBlock
    || directBlockHasPersisted
  );
  const needsRecovery = error > releaseDistance && (
    ((directObstacleRequiresRecovery || terrainTopologyRequiresRecovery)
      && (!flowing || recentTerrainBlock || directBlockHasPersisted || error >= triggerDistance))
    || recentTerrainBlock
    || stalled
    || wasDetached
  );
  if (!needsRecovery) {
    clearAgentFormationRecovery(agent, nowSec, error, {
      lastProgressAt,
      lastMeaningfulX,
      lastMeaningfulY,
      lastMeaningfulError
    });
    return null;
  }

  const navigator = sim?.trainingNavigator;
  const roadCorridor = resolveTrainingRoadCorridor(squad, sim);
  let destination = roadCorridor
    ? constrainPointToTrainingRoadCorridor(target, roadCorridor, radius)
    : { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
  if (navigator?.findNearestWalkablePoint) {
    destination = navigator.findNearestWalkablePoint(destination, {
      obstacles: walls,
      radius,
      maxSearchDistance: Math.max(48, triggerDistance * 3)
    }) || destination;
  }
  const previousRoute = Array.isArray(previous?.route) ? previous.route : [];
  const previousTargetX = Number(previous?.targetX);
  const previousTargetY = Number(previous?.targetY);
  const targetDrift = Math.hypot(
    destination.x - (Number.isFinite(previousTargetX) ? previousTargetX : destination.x),
    destination.y - (Number.isFinite(previousTargetY) ? previousTargetY : destination.y)
  );
  const obstacleId = String(directHit?.obstacle?.id || directHit?.obstacle?.objectId || '');
  const obstacleChanged = obstacleId && obstacleId !== String(previous?.obstacleId || '');
  const previousRouteIndex = Math.max(0, Math.floor(Number(previous?.routeIndex) || 0));
  const routeMissing = previousRoute.length <= 0 || previousRouteIndex >= previousRoute.length;
  const previousPlanAt = Number(previous?.plannedAt) || 0;
  const planAge = nowSec - previousPlanAt;
  const recoveryRoutePlannerAvailable = !!navigator?.planRoute || !!sim?.field || !!sim?.trainingMap;
  const replanDue = !previousPlanAt
    || planAge >= replanInterval;
  const shouldReplan = recoveryRoutePlannerAvailable
    && (
      obstacleChanged
      || (
        replanDue
        && (
          routeMissing
          || targetDrift >= targetDriftThreshold
          || stalled
          || terrainSegmentBlocked
          || recentTerrainBlock
        )
      )
    );
  let route = previousRoute.map((entry) => ({ x: Number(entry?.x) || 0, y: Number(entry?.y) || 0 }));
  let routeIndex = previousRouteIndex;
  let plannedAt = Number(previous?.plannedAt) || 0;
  let failedSince = Number(previous?.failedSince) || 0;

  if (shouldReplan && consumeFormationRecoveryPlanBudget(sim)) {
    const safeStart = navigator?.findNearestWalkablePoint?.(point, {
      obstacles: walls,
      radius,
      maxSearchDistance: Math.max(48, triggerDistance * 3)
    }) || point;
    const planned = navigator?.planRoute
      ? navigator.planRoute(safeStart, destination, {
        obstacles: walls,
        radius,
        maxSearchNodes: 220,
        preferLocalDetour: true,
        preferredLaneId: roadCorridor?.laneId
      })
      : [];
    const startEscape = Math.hypot(safeStart.x - point.x, safeStart.y - point.y) > 0.2
      ? [safeStart]
      : [];
    let candidateRoute = [...startEscape, ...(Array.isArray(planned) ? planned : [])]
      .filter((entry, index, rows) => (
        index === 0
        || Math.hypot(
          (Number(entry?.x) || 0) - (Number(rows[index - 1]?.x) || 0),
          (Number(entry?.y) || 0) - (Number(rows[index - 1]?.y) || 0)
        ) > 0.5
      ));
    let reachesTarget = doesTrainingRouteReachTarget(
      candidateRoute,
      destination,
      Math.max(6, radius * 2.5)
    );
    let staysOnRoad = !roadCorridor || isTrainingRouteInsideRoadCorridor(
      squad,
      sim,
      point,
      candidateRoute,
      radius
    );
    if (!reachesTarget || !staysOnRoad) {
      // A recovery route is a local, individual concern.  Falling back here
      // lets a stranded unit step through a nearby legal gap without making
      // the shared CARD route wait for an A* result.
      candidateRoute = planTrainingMapLocalDetour({
        field: sim?.field,
        mapConfig: sim?.trainingMap,
        start: point,
        target: destination,
        obstacles: walls,
        radius
      });
      reachesTarget = doesTrainingRouteReachTarget(
        candidateRoute,
        destination,
        Math.max(6, radius * 2.5)
      );
      staysOnRoad = !roadCorridor || isTrainingRouteInsideRoadCorridor(
        squad,
        sim,
        point,
        candidateRoute,
        radius
      );
    }
    if (reachesTarget && staysOnRoad) {
      route = candidateRoute;
      routeIndex = 0;
      plannedAt = nowSec;
      failedSince = 0;
    } else {
      plannedAt = nowSec;
      if (failedSince <= 0) failedSince = nowSec;
    }
  }

  while (routeIndex < route.length) {
    const waypoint = route[routeIndex];
    if (Math.hypot(waypoint.x - point.x, waypoint.y - point.y) > waypointRadius) break;
    const nextWaypoint = route[routeIndex + 1] || null;
    // Do not consume a close corner merely because it lies inside the usual
    // waypoint radius.  The following segment can still clip the same wall
    // (or a highland edge) until the agent has actually rounded that corner.
    if (nextWaypoint && !isTrainingMovementSegmentTraversable({
      sim,
      start: point,
      target: nextWaypoint,
      walls,
      radius
    })) break;
    routeIndex += 1;
  }
  const waypoint = route[routeIndex] || null;
  let guidanceTarget = waypoint;
  if (!guidanceTarget) {
    const toTarget = normalizeVec(destination.x - point.x, destination.y - point.y);
    const avoid = computeAvoidanceDirection(
      point,
      toTarget,
      walls,
      Math.max(AGENT_AVOID_PROBE * 2, Math.min(36, error * 0.45)),
      agent,
      nowSec
    );
    const escape = normalizeVec(toTarget.x + (avoid.x * 1.35), toTarget.y + (avoid.y * 1.35));
    guidanceTarget = {
      x: point.x + (escape.x * Math.max(10, radius * 4)),
      y: point.y + (escape.y * Math.max(10, radius * 4))
    };
  }
  const state = {
    active: true,
    mode: 'RECOVERING',
    route,
    routeIndex,
    plannedAt,
    targetX: destination.x,
    targetY: destination.y,
    lastX: point.x,
    lastY: point.y,
    lastMeaningfulX,
    lastMeaningfulY,
    lastError: error,
    lastMeaningfulError,
    lastProgressAt,
    failedSince,
    obstacleId,
    terrainBlocked: terrainSegmentBlocked || recentTerrainBlock
  };
  agent._formationRecovery = state;
  agent._formationDetached = true;
  agent.formationRecoveryState = waypoint ? 'ROUTING' : 'ESCAPING';
  if (isMinion) {
    agent._minionRecovery = state;
    agent.minionRecoveryState = agent.formationRecoveryState;
  }
  return {
    active: true,
    x: guidanceTarget.x,
    y: guidanceTarget.y,
    speedMul: clamp(
      1.08 + ((error - releaseDistance) / Math.max(1, triggerDistance * 2)),
      1.08,
      maximumSpeedMul
    )
  };
};

const syncTrainingNavigationOrderPath = (squad = null) => {
  if (!squad?.order || typeof squad.order !== 'object') return;
  squad.order.pathPoints = (Array.isArray(squad.waypoints) ? squad.waypoints : []).map((point) => ({
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0
  }));
  squad.order.pathIndex = 0;
};

const applyTrainingNavigationRoute = (squad = null, route = [], remainingWaypoints = []) => {
  const plannedRoute = Array.isArray(route) ? route : [];
  const remaining = Array.isArray(remainingWaypoints) ? remainingWaypoints : [];
  const combined = [...plannedRoute, ...remaining].map((point) => ({
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0
  })).filter((point, index, rows) => (
    index === 0
    || Math.hypot(point.x - rows[index - 1].x, point.y - rows[index - 1].y) > 0.05
  ));
  if (isTrainingCardSquad(squad)) {
    delete squad._trainingPassageFallbackPending;
    const nextRouteSignature = [{ x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 }, ...combined]
      .map((point) => `${Number(point?.x || 0).toFixed(2)},${Number(point?.y || 0).toFixed(2)}`)
      .join(';');
    const previousCompletedSignature = String(squad?._squadController?.passageCompletedRouteSignature || '');
    if (previousCompletedSignature && previousCompletedSignature !== nextRouteSignature) {
      squad._squadController.passageCompletedRouteSignature = '';
      squad._squadController.passageCompletedAt = 0;
    }
    squad._passageRoute = combined.map((point) => ({ ...point }));
    const anchor = {
      x: Number(squad?.x) || 0,
      y: Number(squad?.y) || 0
    };
    squad._passagePlanRoute = [anchor, ...combined]
      .filter((point, index, rows) => (
        index === 0
        || Math.hypot(point.x - rows[index - 1].x, point.y - rows[index - 1].y) > 0.05
      ));
  }
  squad.waypoints = combined.map((point) => ({ ...point }));
  syncTrainingNavigationOrderPath(squad);
};

const attemptTrainingNavigationReplan = ({
  squad,
  sim,
  walls = [],
  target = {},
  nowSec = 0
} = {}) => {
  const navigator = sim?.trainingNavigator;
  if (!squad || !navigator?.planRoute) return false;
  if ((Number(squad?._navigationReplanAt) || 0) > nowSec) return false;

  const currentWaypoints = Array.isArray(squad?.waypoints) ? squad.waypoints.slice() : [];
  const source = { x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 };
  const roadCorridor = resolveTrainingRoadCorridor(squad, sim);
  if (!consumeTrainingNavigationPlanBudget(sim)) {
    squad._navigationReplanAt = nowSec + Math.min(0.12, resolveTrainingNavigationReplanCooldown(sim));
    return false;
  }
  const plannedRoute = planTrainingRouteWithPassageFallback({
    squad,
    sim,
    start: source,
    target,
    walls,
    maxSearchNodes: resolveTrainingAiNavigationSearchNodes(squad, sim),
    preferLocalDetour: true,
    preferredLaneId: roadCorridor?.laneId
  });
  const route = plannedRoute.route;
  const cooldown = resolveTrainingNavigationReplanCooldown(sim);
  squad._navigationReplanAt = nowSec + cooldown;
  squad._navigationReplanAttempts = Math.max(0, Number(squad?._navigationReplanAttempts) || 0) + 1;

  const routeReachesTarget = doesTrainingRouteReachTarget(route, target);
  const highlandEgressPrefix = resolveTrainingHighlandEgressPrefix(sim, source, route);
  if (
    routeReachesTarget
    && isTrainingRouteInsideRoadCorridor(squad, sim, source, route)
  ) {
    applyTrainingNavigationRoute(squad, route, currentWaypoints.slice(1));
    squad._navigationFailureCount = 0;
    squad._navigationStuckSince = 0;
    squad._navigationWaitUntil = 0;
    squad._trainingNavigationScale = plannedRoute.scale;
    return true;
  }

  if (roadCorridor && (routeReachesTarget || highlandEgressPrefix.length > 0)) {
    const fallbackRoute = buildTrainingRoadFallbackRoute(squad, sim, target, {
      source,
      routePrefix: highlandEgressPrefix
    });
    if (fallbackRoute.length > 0) {
      applyTrainingNavigationRoute(squad, fallbackRoute, currentWaypoints.slice(1));
      squad._navigationFailureCount = 0;
      squad._navigationStuckSince = 0;
      squad._navigationWaitUntil = 0;
      squad._trainingNavigationScale = 'PASSAGE';
      return true;
    }
  }

  squad._navigationFailureCount = Math.min(
    6,
    Math.max(0, Number(squad?._navigationFailureCount) || 0) + 1
  );
  // A failed formation-scale route is not a command to freeze a CARD squad.
  // The shared agent-scale attempt above may still find a passage; when even
  // that cannot, keep the current route/momentum and retry with cooldown.
  const recoveryPoint = navigator?.findNearestWalkablePoint?.(source, {
    obstacles: walls,
    radius: resolveTrainingNavigationAgentRadius(squad, sim) + resolveTrainingNavigationPathClearance(
      sim,
      { passage: isTrainingCardSquad(squad) }
    )
  });
  if (recoveryPoint && Math.hypot(
    (Number(recoveryPoint?.x) || 0) - source.x,
    (Number(recoveryPoint?.y) || 0) - source.y
  ) > NAVIGATION_MIN_PROGRESS) {
    applyTrainingNavigationRoute(squad, [recoveryPoint], currentWaypoints);
  }
  squad._navigationWaitUntil = 0;
  squad._navigationRetryAt = nowSec + (cooldown * Math.min(4, squad._navigationFailureCount));
  squad.action = isTrainingCardSquad(squad) ? '路径绕行' : '路径重算';
  return false;
};

const updateTrainingNavigationRecovery = ({
  squad,
  sim,
  walls = [],
  target = null,
  start = {},
  nowSec = 0,
  dt = 0
} = {}) => {
  if (!squad || !sim?.trainingNavigator || !target || squad?.skillRush?.ttl > 0) return;
  if (
    isTrainingCardSquad(squad)
    && (
      hasActiveTrainingCardPassage(squad)
      || String(squad?._trainingNavigationScale || '').toUpperCase() === 'PASSAGE'
    )
  ) return;
  if (resolveTrainingRoadCorridor(squad, sim) && squad?._trainingRoadCorridorEntered === true) return;
  if (!isTrainingCardSquad(squad) && (Number(squad?._navigationWaitUntil) || 0) > nowSec) return;

  const current = { x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 };
  const targetDistanceBefore = Math.hypot(
    (Number(target?.x) || 0) - (Number(start?.x) || 0),
    (Number(target?.y) || 0) - (Number(start?.y) || 0)
  );
  const targetDistanceAfter = Math.hypot(
    (Number(target?.x) || 0) - current.x,
    (Number(target?.y) || 0) - current.y
  );
  if (targetDistanceAfter <= LEADER_ARRIVAL_RADIUS) {
    squad._navigationFailureCount = 0;
    squad._navigationReplanAttempts = 0;
    squad._navigationStuckSince = 0;
    return;
  }

  const movedDistance = Math.hypot(
    current.x - (Number(start?.x) || 0),
    current.y - (Number(start?.y) || 0)
  );
  const collisionAt = Number(squad?._navigationCollisionAt) || 0;
  const collidedThisStep = collisionAt > 0
    && collisionAt >= (nowSec - Math.max(0, Number(dt) || 0) - 0.001);
  const madeProgress = (targetDistanceBefore - targetDistanceAfter) >= NAVIGATION_MIN_PROGRESS
    || (movedDistance >= NAVIGATION_MIN_MOVEMENT && !collidedThisStep);
  if (madeProgress && !collidedThisStep) {
    squad._navigationFailureCount = 0;
    squad._navigationReplanAttempts = 0;
    squad._navigationStuckSince = 0;
    return;
  }

  if (!(Number(squad?._navigationStuckSince) || 0)) squad._navigationStuckSince = nowSec;
  const stuckFor = nowSec - (Number(squad?._navigationStuckSince) || nowSec);
  if (!collidedThisStep && stuckFor < NAVIGATION_STUCK_TIMEOUT_SEC) return;
  attemptTrainingNavigationReplan({ squad, sim, walls, target, nowSec });
};

const leaderMoveStep = (squad, sim, crowd, dt, forwardVec, steeringWeights = DEFAULT_STEERING_WEIGHTS, blockingWalls = null) => {
  const isFixedLaneMinion = isTrainingMinionSquad(squad);
  const actionState = ensureSquadActionState(squad);
  const actionKind = typeof actionState.kind === 'string' ? actionState.kind : 'none';
  const fatiguePenalty = squad.fatigueTimer > 0 ? 0.72 : 1;
  const statusMultipliers = resolveSquadStatusMultipliers(squad);
  const buffSpeed = (squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1)
    * statusMultipliers.speedMul;
  const rushSpeed = squad.skillRush?.ttl > 0 ? 1.45 : 1;
  const speedMode = squad.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const speedPolicy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  const orderType = resolveSquadOrderType(squad);
  const nowSec = Number(sim?.timeElapsed) || 0;
  const minionAi = isFixedLaneMinion ? squad?._minionAi : null;
  const minionHoldAnchor = minionAi?.holdAnchor && typeof minionAi.holdAnchor === 'object'
    ? minionAi.holdAnchor
    : null;
  const minionAnchorDistance = minionHoldAnchor
    ? Math.hypot(
      (Number(minionHoldAnchor.x) || 0) - (Number(squad.x) || 0),
      (Number(minionHoldAnchor.y) || 0) - (Number(squad.y) || 0)
    )
    : Infinity;
  const locksMinionAnchor = !!minionHoldAnchor && (
    minionAi?.state === MINION_WAVE_AI_STATE.ATTACK_HOLD
    || (
      minionAi?.state === MINION_WAVE_AI_STATE.APPROACH
      && minionAnchorDistance <= LEADER_ARRIVAL_RADIUS
    )
  );
  if (locksMinionAnchor) {
    squad.x = Number(minionHoldAnchor.x) || 0;
    squad.y = Number(minionHoldAnchor.y) || 0;
    squad.vx = 0;
    squad.vy = 0;
    squad.speed = 0;
    squad.waypoints = [];
    squad.stamina = STAMINA_MAX;
    const facing = normalizeVec(Number(minionAi?.axisX) || 0, Number(minionAi?.axisY) || 0);
    if (facing.len > 0.0001) {
      squad.dirX = facing.x;
      squad.dirY = facing.y;
      squad.smoothedDirX = facing.x;
      squad.smoothedDirY = facing.y;
      return { x: facing.x, y: facing.y };
    }
    return forwardVec;
  }
  if (squad.meleeAttackOrder && squad.meleeAttackOrder.active !== false) {
    squad.vx = 0;
    squad.vy = 0;
    squad.speed = 0;
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
    return forwardVec;
  }
  const chargingCommitted = orderType === ORDER_CHARGE && (Number(squad?.order?.commitUntil) || 0) > nowSec;
  const baseGroupSpeed = speedMode === SPEED_MODE_C
    ? computeRetreatGroupSpeed(squad, crowd)
    : computeWeightedGroupSpeed(squad, crowd);
  const policyMul = speedPolicy === SPEED_POLICY_RETREAT
    ? 1.08
    : (speedPolicy === SPEED_POLICY_REFORM ? 0.82 : 1);
  const initialWeightedSpeed = Math.max(0.2, Number(squad?.stats?.speed) || baseGroupSpeed);
  const speedTargetBase = isTrainingMinionSquad(squad) && Number(squad?.minionPathSpeed) > 0
    ? Number(squad.minionPathSpeed) * (baseGroupSpeed / initialWeightedSpeed)
    : Math.max(9, baseGroupSpeed * REFERENCE_LEADER_SPEED_MULTIPLIER * resolveTrainingMapMovementScale(sim));
  squad._marchWorldSpeedBase = Math.max(0, speedTargetBase);
  const configuredCohesionScale = Number(
    squad?._formationCohesionSpeedScale ?? squad?._minionCohesionSpeedScale
  );
  const cohesionSpeedScale = Number.isFinite(configuredCohesionScale)
    ? clamp(configuredCohesionScale, 0, 1)
    : 1;
  const speedTargetMax = speedTargetBase
    * fatiguePenalty
    * buffSpeed
    * rushSpeed
    * policyMul
    * (chargingCommitted ? 1.15 : 1)
    * cohesionSpeedScale;
  const walls = Array.isArray(blockingWalls)
    ? blockingWalls
    : filterBlockingObstacles(sim?.buildings || []);
  let target = null;
  let targetFromWaypoint = false;
  const lockRangedSkill = !!squad?.activeSkill?.lockMovement;

  if (squad.skillRush?.ttl > 0) {
    const remainDistance = Math.max(0, Number(squad.skillRush.remainDistance) || 0);
    if (remainDistance <= 0.01) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      if (squad.actionState && squad.actionState.kind === 'charge') {
        squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
      }
      squad.action = '自动攻击';
      return forwardVec;
    }
    target = {
      x: (Number(squad.x) || 0) + ((squad.skillRush.dirX || 0) * remainDistance),
      y: (Number(squad.y) || 0) + ((squad.skillRush.dirY || 0) * remainDistance)
    };
    squad.skillRush.ttl = Math.max(0, squad.skillRush.ttl - dt);
  } else if (lockRangedSkill) {
    target = null;
  } else if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
    target = squad.waypoints[0];
    targetFromWaypoint = true;
  }

  if (
    target
    && !(Number(squad?.skillRush?.ttl) > 0)
    && (Number(squad?._navigationWaitUntil) || 0) > nowSec
    && !isTrainingCardSquad(squad)
  ) {
    target = null;
    squad.vx = 0;
    squad.vy = 0;
    squad.speed = 0;
    squad.action = '路径等待';
  }

  const ignoresMarchStamina = isFixedLaneMinion
    || isTrainingNeutralSquad(squad);
  let staminaResting = false;
  if (!ignoresMarchStamina && !(Number(squad?.skillRush?.ttl) > 0)) {
    const stamina = Math.max(0, Number(squad?.stamina) || 0);
    if (squad?._staminaResting === true && stamina >= STAMINA_RESUME_THRESHOLD) {
      squad._staminaResting = false;
    } else if (target && squad?._staminaResting !== true && stamina < STAMINA_MOVE_THRESHOLD) {
      squad._staminaResting = true;
    }
    staminaResting = squad?._staminaResting === true;
  } else if (squad?._staminaResting === true) {
    squad._staminaResting = false;
  }

  let currentSpeed = Math.max(0, Number(squad.speed) || 0);
  let dir = normalizeVec(Number(squad.dirX) || Number(forwardVec?.x) || 1, Number(squad.dirY) || Number(forwardVec?.y) || 0);
  if (dir.len <= 1e-4) dir = normalizeVec(Number(forwardVec?.x) || 1, Number(forwardVec?.y) || 0);
  let desiredSpeed = 0;
  let desiredDir = { x: dir.x, y: dir.y };

  if (actionKind === 'stagger') {
    desiredSpeed = 0;
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.25), 0, STAMINA_MAX);
  } else if (actionKind === 'transition') {
    desiredSpeed = Math.min(speedTargetMax * 0.32, desiredSpeed);
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.15), 0, STAMINA_MAX);
  } else if (lockRangedSkill) {
    desiredSpeed = 0;
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt * 0.5), 0, STAMINA_MAX);
  } else if (target && (isFixedLaneMinion || !staminaResting)) {
    const toTarget = normalizeVec((Number(target.x) || 0) - (Number(squad.x) || 0), (Number(target.y) || 0) - (Number(squad.y) || 0));
    if (toTarget.len <= LEADER_ARRIVAL_RADIUS) {
      const hasFollowingWaypoint = targetFromWaypoint
        && Array.isArray(squad?.waypoints)
        && squad.waypoints.length > 1;
      const holdForPassage = targetFromWaypoint
        && !hasFollowingWaypoint
        && hasActiveTrainingCardPassage(squad);
      if (targetFromWaypoint && !holdForPassage) advanceSquadWaypoint(squad);
      if (targetFromWaypoint && !holdForPassage && (!squad.waypoints || squad.waypoints.length <= 0)) {
        beginSquadFormationArrival(squad, target, nowSec);
        currentSpeed = 0;
        desiredSpeed = 0;
      } else if (holdForPassage) {
        // Keep the terminal waypoint until every agent has cleared the shared
        // passage.  The anchor may sit at the destination, while stream agents
        // continue their forward exit and reformation independently.
        desiredSpeed = 0;
        squad.vx = 0;
        squad.vy = 0;
        squad.speed = 0;
      }
    } else {
      const avoidanceProbe = Math.max(
        OBSTACLE_AVOID_PROBE,
        currentSpeed * Math.max(0, dt) * 2.2
      );
      const avoid = computeAvoidanceDirection(
        { x: squad.x, y: squad.y },
        toTarget,
        walls,
        avoidanceProbe,
        squad,
        nowSec
      );
      const avoidWeight = Math.max(0, Number(steeringWeights?.leaderAvoidance) || DEFAULT_STEERING_WEIGHTS.leaderAvoidance);
      let centerPull = { x: 0, y: 0 };
      const leaderPathBlocked = isFixedLaneMinion
        ? raycastObstacles(squad, target, walls, LEADER_COLLISION_RADIUS)
        : null;
      if (isFixedLaneMinion && !squad?._minionNavigationRoute && !leaderPathBlocked?.obstacle) {
        const corridor = resolveTrainingRoadCorridor(squad, sim);
        const projection = corridor
          ? resolveMinionPathProjection({ x: squad.x, y: squad.y }, corridor.path)
          : null;
        if (projection && Number(projection?.distance) > 0.5) {
          const direction = normalizeVec(
            (Number(projection?.point?.x) || 0) - (Number(squad?.x) || 0),
            (Number(projection?.point?.y) || 0) - (Number(squad?.y) || 0)
          );
          const strength = clamp(Number(projection.distance) / 24, 0, 0.58);
          centerPull = { x: direction.x * strength, y: direction.y * strength };
        }
      }
      const rawDesired = normalizeVec(
        toTarget.x + (avoid.x * 1.05 * avoidWeight) + centerPull.x,
        toTarget.y + (avoid.y * 1.05 * avoidWeight) + centerPull.y
      );
      // Card squads steer their shared virtual anchor along a wall/boundary
      // before the old swept collision fallback has to push it back.  Agents
      // still retain the existing local collision and avoidance pass below.
      const boundaryAwareDesired = resolveTrainingCardAnchorSteering({
        squad,
        desiredDirection: rawDesired
      });
      const prevSmooth = normalizeVec(Number(squad.smoothedDirX) || dir.x, Number(squad.smoothedDirY) || dir.y);
      const blendK = 1 - Math.exp(-Math.max(0, dt) * Math.max(0.2, Number(steeringWeights?.turnHz) || DEFAULT_STEERING_WEIGHTS.turnHz));
      const smooth = normalizeVec(
        prevSmooth.x + ((boundaryAwareDesired.x - prevSmooth.x) * blendK),
        prevSmooth.y + ((boundaryAwareDesired.y - prevSmooth.y) * blendK)
      );
      desiredDir = smooth;
      squad.smoothedDirX = desiredDir.x;
      squad.smoothedDirY = desiredDir.y;
      const hasMoreWaypoints = Array.isArray(squad.waypoints) && squad.waypoints.length > 1;
      const slowRadius = hasMoreWaypoints ? LEADER_WAYPOINT_SLOW_RADIUS : LEADER_SLOW_RADIUS;
      const arrivalT = clamp((toTarget.len - LEADER_ARRIVAL_RADIUS) / Math.max(1, slowRadius - LEADER_ARRIVAL_RADIUS), 0, 1);
      const easedArrival = smoothstep01(arrivalT);
      const minSpeedRatio = hasMoreWaypoints ? LEADER_WAYPOINT_MIN_SPEED_RATIO : LEADER_FINAL_MIN_SPEED_RATIO;
      const arrivalRate = minSpeedRatio + ((1 - minSpeedRatio) * easedArrival);
      desiredSpeed = Math.min(speedTargetMax, speedTargetMax * arrivalRate);
    }
    squad.stamina = ignoresMarchStamina
      ? STAMINA_MAX
      : clamp((Number(squad.stamina) || 0) - (STAMINA_MOVE_COST * dt), 0, STAMINA_MAX);
  } else {
    desiredSpeed = 0;
    squad.stamina = clamp((Number(squad.stamina) || 0) + (STAMINA_RECOVER * dt), 0, STAMINA_MAX);
    if (!target && squad.behavior === 'move' && resolveSquadOrderType(squad) === ORDER_MOVE) {
      squad.action = '待命';
    }
  }

  const dot = clamp((dir.x * desiredDir.x) + (dir.y * desiredDir.y), -1, 1);
  const angle = Math.acos(dot);
  if (angle > 1e-4) {
    const cross = (dir.x * desiredDir.y) - (dir.y * desiredDir.x);
    const sign = cross >= 0 ? 1 : -1;
    const maxTurnRate = Math.max(0.2, Number(steeringWeights?.maxTurnRate) || LEADER_MAX_TURN_RATE);
    const stepTurn = Math.min(angle, maxTurnRate * dt) * sign;
    const cosT = Math.cos(stepTurn);
    const sinT = Math.sin(stepTurn);
    const nextDir = normalizeVec((dir.x * cosT) - (dir.y * sinT), (dir.x * sinT) + (dir.y * cosT));
    dir = { x: nextDir.x, y: nextDir.y };
  }

  const accel = desiredSpeed >= currentSpeed ? LEADER_MAX_ACCEL : LEADER_MAX_DECEL;
  const maxDv = accel * dt;
  const dv = clamp(desiredSpeed - currentSpeed, -maxDv, maxDv);
  currentSpeed = Math.max(0, currentSpeed + dv);
  const prevX = Number(squad.x) || 0;
  const prevY = Number(squad.y) || 0;
  let nx = prevX + (dir.x * currentSpeed * dt);
  let ny = prevY + (dir.y * currentSpeed * dt);
  const halfW = (Number(sim?.field?.width) || 2700) / 2;
  const halfH = (Number(sim?.field?.height) || 1488) / 2;
  nx = clamp(nx, -halfW + 4, halfW - 4);
  ny = clamp(ny, -halfH + 4, halfH - 4);
  let pushNx = 0;
  let pushNy = 0;
  let roadCollided = false;
  const attemptedX = nx;
  const attemptedY = ny;
  const sweptStep = resolveSweptObstacleStep(
    { x: prevX, y: prevY },
    { x: nx, y: ny },
    walls,
    LEADER_COLLISION_RADIUS
  );
  nx = sweptStep.x;
  ny = sweptStep.y;
  if (sweptStep.collided) {
    const correction = normalizeVec(nx - attemptedX, ny - attemptedY);
    if (correction.len > 1e-4) {
      pushNx += correction.x;
      pushNy += correction.y;
    }
  }
  const nearbyWalls = queryObstacleCandidates(walls, nx, ny, LEADER_COLLISION_RADIUS);
  nearbyWalls.forEach((wall) => {
    if (!wall || wall.destroyed) return;
    const beforeX = nx;
    const beforeY = ny;
    const pushed = pushOutOfRect({ x: nx, y: ny }, wall, LEADER_COLLISION_RADIUS);
    nx = pushed.x;
    ny = pushed.y;
    if (pushed?.pushed) {
      const corr = normalizeVec(nx - beforeX, ny - beforeY);
      if (corr.len > 1e-4) {
        pushNx += corr.x;
        pushNy += corr.y;
      }
    }
  });
  const roadCorridor = resolveTrainingRoadCorridor(squad, sim);
  const hardRoadBound = isTrainingMinionSquad(squad)
    && Number(squad?.minionPathCorridorWidth) > 0;
  if (roadCorridor && (hardRoadBound || !(Number(squad?.skillRush?.ttl) > 0))) {
    const allowedDistance = Math.max(4, roadCorridor.halfWidth - LEADER_COLLISION_RADIUS);
    const previousRoadDistance = resolveMinionPathProjection({ x: prevX, y: prevY }, roadCorridor.path).distance;
    const nextRoadDistance = resolveMinionPathProjection({ x: nx, y: ny }, roadCorridor.path).distance;
    const previousInsideHighland = isPointInsideTrainingHighland({ x: prevX, y: prevY }, sim);
    const nextInsideHighland = isPointInsideTrainingHighland({ x: nx, y: ny }, sim);
    const corridorEntered = hardRoadBound
      || squad?._trainingRoadCorridorEntered === true
      || (!previousInsideHighland && previousRoadDistance <= allowedDistance);
    if (hardRoadBound) squad._trainingRoadCorridorEntered = true;
    if (!corridorEntered && !nextInsideHighland && nextRoadDistance <= allowedDistance) {
      squad._trainingRoadCorridorEntered = true;
    } else if (corridorEntered) {
      squad._trainingRoadCorridorEntered = true;
      const constrained = constrainPointToTrainingRoadCorridor(
        { x: nx, y: ny },
        roadCorridor,
        LEADER_COLLISION_RADIUS
      );
      if (Math.hypot(constrained.x - nx, constrained.y - ny) > 0.001) {
        const roadStep = resolveSweptObstacleStep(
          { x: prevX, y: prevY },
          constrained,
          walls,
          LEADER_COLLISION_RADIUS
        );
        roadCollided = roadStep.collided;
        nx = roadStep.x;
        ny = roadStep.y;
      }
    }
  }
  const terrainStep = resolveTrainingLegalMovementStep({
    sim,
    start: { x: prevX, y: prevY },
    target: { x: nx, y: ny },
    walls,
    radius: LEADER_COLLISION_RADIUS
  });
  const terrainBlocked = !terrainStep.legal;
  nx = terrainStep.x;
  ny = terrainStep.y;
  const movedX = nx - prevX;
  const movedY = ny - prevY;
  squad.x = nx;
  squad.y = ny;
  squad.vx = movedX / Math.max(1e-4, dt);
  squad.vy = movedY / Math.max(1e-4, dt);
  const pushN = normalizeVec(pushNx, pushNy);
  if (pushN.len > 1e-4) {
    const vn = (squad.vx * pushN.x) + (squad.vy * pushN.y);
    if (vn > 0) {
      const keep = vn * 0.2;
      const remove = vn - keep;
      squad.vx -= pushN.x * remove;
      squad.vy -= pushN.y * remove;
    }
  }
  if (
    (sweptStep.collided || roadCollided || terrainBlocked || (Math.abs(pushNx) + Math.abs(pushNy)) > 1e-4)
    && target
    && !(Number(squad?.skillRush?.ttl) > 0)
  ) {
    squad._navigationCollisionAt = nowSec;
  }
  squad.speed = Math.hypot(squad.vx, squad.vy);
  squad.dirX = dir.x;
  squad.dirY = dir.y;

  if (squad.skillRush?.ttl > 0) {
    const moved = Math.hypot(movedX, movedY);
    squad.skillRush.remainDistance = Math.max(0, (Number(squad.skillRush.remainDistance) || 0) - moved);
    if (squad.skillRush.ttl <= 0 || squad.skillRush.remainDistance <= 0.8) {
      squad.skillRush = null;
      squad.behavior = 'auto';
      if (squad.actionState && squad.actionState.kind === 'charge') {
        squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
      }
      squad.action = '自动攻击';
    } else {
      squad.action = '兵种攻击';
    }
  } else if (chargingCommitted) {
    squad.action = '冲锋';
  } else if (staminaResting && target) {
    squad.action = '休整恢复';
  } else if (squad?._formationCohesion?.waiting) {
    squad.action = isFixedLaneMinion ? '兵线等待整队' : '等待掉队士兵';
  } else if ((Number(squad?._formationCohesion?.speedScale) || 1) < 0.98) {
    squad.action = isFixedLaneMinion ? '兵线减速接应' : '减速接应';
  }

  return { x: dir.x, y: dir.y };
};

const aggregateSquadFromAgents = (squad, agents = []) => {
  if (!squad) return;
  const alive = [];
  let remain = 0;
  let centerAccX = 0;
  let centerAccY = 0;
  const spatialPoints = [];
  const remainUnits = {};
  const classAcc = {
    infantry: { x: 0, y: 0, w: 0 },
    cavalry: { x: 0, y: 0, w: 0 },
    archer: { x: 0, y: 0, w: 0 },
    artillery: { x: 0, y: 0, w: 0 }
  };
  const skillCategoryAcc = {
    [SKILL_CATEGORY_MELEE]: { x: 0, y: 0, w: 0 },
    [SKILL_CATEGORY_RANGED]: { x: 0, y: 0, w: 0 },
    [SKILL_CATEGORY_SUPPORT]: { x: 0, y: 0, w: 0 }
  };
  const anchorX = Number(squad.x) || 0;
  const anchorY = Number(squad.y) || 0;
  let maxDist = 0;

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    if (!agent || agent.dead) continue;
    const weight = Math.max(0, Number(agent.weight) || 0);
    if (weight <= 0.001) continue;
    alive.push(agent);
    remain += weight;
    const ax = Number(agent.x) || 0;
    const ay = Number(agent.y) || 0;
    centerAccX += ax;
    centerAccY += ay;
    spatialPoints.push({ x: ax, y: ay });
    const d = Math.hypot(ax - anchorX, ay - anchorY);
    if (d > maxDist) maxDist = d;
    const unitTypeId = typeof agent.unitTypeId === 'string' ? agent.unitTypeId : '__fallback__';
    remainUnits[unitTypeId] = (remainUnits[unitTypeId] || 0) + weight;
    let cls = typeof agent.typeCategory === 'string' ? agent.typeCategory : '';
    if (cls !== 'infantry' && cls !== 'cavalry' && cls !== 'archer' && cls !== 'artillery') {
      cls = typeof squad.classTag === 'string' ? squad.classTag : 'infantry';
    }
    if (!classAcc[cls]) cls = 'infantry';
    classAcc[cls].x += ax * weight;
    classAcc[cls].y += ay * weight;
    classAcc[cls].w += weight;
    const skillCategory = inferSkillCategoryFromUnitType(
      { unitCategory: agent.unitCategory },
      SKILL_CATEGORY_MELEE
    );
    skillCategoryAcc[skillCategory].x += ax * weight;
    skillCategoryAcc[skillCategory].y += ay * weight;
    skillCategoryAcc[skillCategory].w += weight;
  }

  if (alive.length <= 0) {
    squad.remain = 0;
    squad.health = 0;
    squad.action = '覆灭';
    squad.behavior = 'idle';
    squad.waypoints = [];
    squad.flagBearerAgentId = '';
    squad.displayRadius = 0;
    squad.contactRadius = 0;
    squad.classCenters = {
      infantry: { x: anchorX, y: anchorY, count: 0 },
      cavalry: { x: anchorX, y: anchorY, count: 0 },
      archer: { x: anchorX, y: anchorY, count: 0 },
      artillery: { x: anchorX, y: anchorY, count: 0 }
    };
    squad.skillCenters = {
      [SKILL_CATEGORY_MELEE]: { x: anchorX, y: anchorY, count: 0 },
      [SKILL_CATEGORY_RANGED]: { x: anchorX, y: anchorY, count: 0 },
      [SKILL_CATEGORY_SUPPORT]: { x: anchorX, y: anchorY, count: 0 }
    };
    squad.skillCategoryCounts = {
      [SKILL_CATEGORY_MELEE]: 0,
      [SKILL_CATEGORY_RANGED]: 0,
      [SKILL_CATEGORY_SUPPORT]: 0
    };
    return;
  }

  ensureFlagBearer(squad, alive);
  const center = isTrainingMinionSquad(squad)
    ? resolveSquadSpatialAnchor(spatialPoints, {
        fallbackX: anchorX,
        fallbackY: anchorY,
        minimumRadius: 8,
        radiusPadding: 6
      })
    : {
        x: centerAccX / Math.max(1, alive.length),
        y: centerAccY / Math.max(1, alive.length),
        radius: clamp(maxDist + 6, 8, 130)
      };
  const remainRounded = Math.max(1, Math.round(remain));
  squad.remain = clamp(remainRounded, 0, Math.max(0, Number(squad.startCount) || 0));
  squad.losses = Math.max(0, Math.floor((Number(squad.startCount) || 0) - squad.remain));
  squad.centerX = Number.isFinite(center.x) ? center.x : anchorX;
  squad.centerY = Number.isFinite(center.y) ? center.y : anchorY;
  squad.displayRadius = clamp(center.radius, 8, 130);
  squad.contactRadius = squad.displayRadius;
  squad.radius = clamp(maxDist + 6, 8, 130);
  const healthRatio = clamp(squad.remain / Math.max(1, Number(squad.startCount) || 1), 0, 1);
  squad.health = Math.max(0, (Number(squad.maxHealth) || 1) * healthRatio);
  if (squad.remain <= 0) {
    squad.action = '覆灭';
    squad.behavior = 'idle';
    squad.waypoints = [];
    squad.flagBearerAgentId = '';
    return;
  }

  squad.remainUnits = Object.fromEntries(
    Object.entries(remainUnits).map(([unitTypeId, value]) => [unitTypeId, Math.max(0, Math.round(value))])
  );
  const classCenters = {};
  classCenters.infantry = classAcc.infantry.w > 0
    ? { x: classAcc.infantry.x / classAcc.infantry.w, y: classAcc.infantry.y / classAcc.infantry.w, count: Math.round(classAcc.infantry.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.cavalry = classAcc.cavalry.w > 0
    ? { x: classAcc.cavalry.x / classAcc.cavalry.w, y: classAcc.cavalry.y / classAcc.cavalry.w, count: Math.round(classAcc.cavalry.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.archer = classAcc.archer.w > 0
    ? { x: classAcc.archer.x / classAcc.archer.w, y: classAcc.archer.y / classAcc.archer.w, count: Math.round(classAcc.archer.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  classCenters.artillery = classAcc.artillery.w > 0
    ? { x: classAcc.artillery.x / classAcc.artillery.w, y: classAcc.artillery.y / classAcc.artillery.w, count: Math.round(classAcc.artillery.w) }
    : { x: squad.centerX, y: squad.centerY, count: 0 };
  squad.classCenters = classCenters;
  const skillCenters = {};
  const skillCategoryCounts = {};
  Object.entries(skillCategoryAcc).forEach(([category, row]) => {
    const count = Math.round(Math.max(0, Number(row.w) || 0));
    skillCenters[category] = count > 0
      ? { x: row.x / row.w, y: row.y / row.w, count }
      : { x: squad.centerX, y: squad.centerY, count: 0 };
    skillCategoryCounts[category] = count;
  });
  squad.skillCenters = skillCenters;
  squad.skillCategoryCounts = skillCategoryCounts;
};

const trimOrGrowAgents = (squad, agents = [], crowd, dt) => {
  const squadKind = resolveTrainingSquadKind(squad);
  const repConfig = resolveRepConfig(null, crowd);
  if (repConfig.strictAgentMapping) {
    ensureFlagBearer(squad, agents);
    return;
  }
  const alive = agents.filter((agent) => !agent.dead && agent.weight > 0.001);
  const target = Number(squad.remain) <= 0
    ? 0
    : resolveVisibleAgentCount(Math.max(1, Number(squad.remain) || 1), repConfig.maxAgentWeight, false);
  const delta = alive.length - target;
  if (delta > 0) {
    const removeCount = Math.min(delta, Math.max(1, Math.floor(dt * 14)));
    const removable = alive
      .filter((agent) => !agent.isFlagBearer)
      .sort((a, b) => (a.weight - b.weight) || (b.slotOrder - a.slotOrder))
      .slice(0, removeCount);
    (removable.length > 0 ? removable : alive
      .sort((a, b) => (a.weight - b.weight) || (b.slotOrder - a.slotOrder))
      .slice(0, removeCount))
      .forEach((agent) => {
        agent.dead = true;
        agent.weight = 0;
        agent.hpWeight = 0;
      });
  } else if (delta < 0 && alive.length > 0) {
    const addCount = Math.min(-delta, Math.max(1, Math.floor(dt * 9)));
    const source = alive.sort((a, b) => b.weight - a.weight)[0] || alive[0];
    const splitWeight = Math.min(repConfig.maxAgentWeight, Math.max(0.45, (source.weight || 1) * 0.5));
    for (let i = 0; i < addCount; i += 1) {
      if ((source.weight || 0) <= 0.9) break;
      source.weight = Math.max(0.3, source.weight - splitWeight);
      source.hpWeight = Math.max(0.3, source.hpWeight - splitWeight);
      agents.push(createAgent({
        id: `${squad.id}_ag_${crowd.nextAgentId += 1}`,
        squadId: squad.id,
        team: squad.team,
        unitTypeId: source.unitTypeId,
        category: source.typeCategory,
        unitCategory: source.unitCategory,
        unitSubtype: source.unitSubtype,
        x: (source.x || 0) + ((Math.random() - 0.5) * 2.4),
        y: (source.y || 0) + ((Math.random() - 0.5) * 2.4),
        weight: splitWeight,
        slotOrder: source.slotOrder + i + 1,
        formationSlot: source.formationSlot,
        formationSpacingSlots: source.formationSpacingSlots,
        moveSpeedMul: source.moveSpeedMul || 1,
        combatScale: source.combatScale || 1,
        attackRangeMin: source.attackRangeMin,
        attackRangeMax: source.attackRangeMax,
        isMinionWaveUnit: squadKind === TRAINING_SQUAD_KIND.MINION,
        isNeutralCampUnit: squadKind === TRAINING_SQUAD_KIND.NEUTRAL
      }));
    }
  }
  ensureFlagBearer(squad, agents);
};

const updateSquadSpeedPolicyState = (squad, agents = [], dt = 0) => {
  if (!squad) return;
  if (squad.formationChange && typeof squad.formationChange === 'object') {
    const remainingSec = Math.max(0, (Number(squad.formationChange.remainingSec) || 0) - dt);
    squad.formationChange.remainingSec = remainingSec;
    squad.speedPolicy = SPEED_POLICY_REFORM;
    squad.reformUntil = remainingSec;
    return;
  }
  const speedMode = squad.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const policy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  if (speedMode === SPEED_MODE_C) {
    squad.speedPolicy = SPEED_POLICY_RETREAT;
    squad.reformUntil = 0;
    return;
  }
  if (policy === SPEED_POLICY_RETREAT) {
    squad.speedPolicy = SPEED_POLICY_REFORM;
    squad.reformUntil = Math.max(4.6, Number(squad.reformUntil) || 0);
  }
  if (squad.speedPolicy !== SPEED_POLICY_REFORM) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
    return;
  }
  const alive = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
  if (alive.length <= 0) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
    return;
  }
  const coreAlive = isTrainingCardSquad(squad)
    ? alive.filter((agent) => (
      agent?._formationDetached !== true
      && agent?._formationRecovery?.active !== true
      && agent?._squadController?.rejoin?.active !== true
    ))
    : alive;
  const reformMembers = coreAlive.length > 0 ? coreAlive : alive;
  const threshold = Math.max(10, Number(squad.reformRadiusThreshold) || Math.max(16, Number(squad.radius) || 16));
  const inRange = reformMembers.filter((agent) => {
    const dist = Math.hypot((Number(agent.x) || 0) - (Number(squad.x) || 0), (Number(agent.y) || 0) - (Number(squad.y) || 0));
    return dist <= threshold;
  }).length;
  const ratio = inRange / Math.max(1, reformMembers.length);
  squad.reformUntil = Math.max(0, (Number(squad.reformUntil) || 0) - dt);
  if (ratio >= 0.7 || squad.reformUntil <= 0) {
    squad.speedPolicy = SPEED_POLICY_MARCH;
    squad.reformUntil = 0;
  }
};

const updateSquadFormationChangeCompletion = ({
  squad = null,
  agents = [],
  passage = null,
  nowSec = 0
} = {}) => {
  const change = squad?.formationChange;
  if (!squad || !change || typeof change !== 'object') return false;
  const metrics = resolveSquadFormationMetrics({ squad, agents, passage: null });
  const settled = !passage?.active && metrics.settled;
  const stableSince = settled
    ? (Number(change.stableSince) || nowSec)
    : 0;
  squad.formationChange = {
    ...change,
    stableSince,
    maximumError: metrics.maximumError,
    readyRatio: metrics.readyRatio,
    recoveringCount: metrics.recoveringCount
  };
  squad.action = passage?.active ? '窄地通行后换阵' : '换阵中';
  if (
    Number(change.remainingSec) > 0
    || !settled
    || nowSec - stableSince < FORMATION_ARRIVAL_STABLE_SEC
  ) return false;
  squad.formationChange = null;
  if (squad.speedMode === SPEED_MODE_C) {
    squad.speedPolicy = SPEED_POLICY_RETREAT;
  } else {
    squad.speedPolicy = SPEED_POLICY_MARCH;
  }
  squad.reformUntil = 0;
  if (!squad?._formationArrival?.active) {
    squad.action = Array.isArray(squad.waypoints) && squad.waypoints.length > 0 ? '移动' : '待命';
  }
  return true;
};

const resolveAgentModeSpeedMul = (agent, squad, crowd) => {
  const speedMode = squad?.speedMode === SPEED_MODE_C ? SPEED_MODE_C : SPEED_MODE_B;
  const speedPolicy = typeof squad?.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
  if (speedMode === SPEED_MODE_B || speedPolicy === SPEED_POLICY_MARCH) return 1;
  if (speedMode === SPEED_MODE_C) {
    const realSpeed = resolveUnitTypeSpeed(crowd, agent?.unitTypeId, squad?.stats?.speed);
    const groupSpeed = Math.max(0.2, Number(squad?._groupSpeedScalar) || Number(squad?.stats?.speed) || 1);
    return clamp(realSpeed / Math.max(0.2, groupSpeed), 0.65, 2.1);
  }
  return clamp(Number(agent?.moveSpeedMul) || 1, 0.6, 1.8);
};

const resolveForcedAgentLanding = (sim, agent, direction = {}, distance = 0) => {
  const start = {
    x: Number(agent?.x) || 0,
    y: Number(agent?.y) || 0
  };
  const target = {
    x: start.x + ((Number(direction?.x) || 0) * Math.max(0, Number(distance) || 0)),
    y: start.y + ((Number(direction?.y) || 0) * Math.max(0, Number(distance) || 0))
  };
  const options = {
    obstacles: sim?.buildings,
    radius: Math.max(0.6, Number(agent?.radius) || AGENT_RADIUS)
  };
  if (sim?.trainingNavigator?.resolveLegalPosition) {
    return sim.trainingNavigator.resolveLegalPosition(start, target, options);
  }
  return resolveTrainingMapLegalPosition({
    field: sim?.field,
    mapConfig: sim?.trainingMap,
    start,
    target,
    ...options
  });
};

const applyCavalryRushImpact = (sim, crowd, squad, agents = [], fromPoint, toPoint) => {
  if (!squad || !squad.skillRush) return;
  const rush = squad.skillRush;
  if (!(rush.hitAgentIds instanceof Set)) {
    rush.hitAgentIds = new Set();
  }
  const segmentLen = Math.hypot((toPoint?.x || 0) - (fromPoint?.x || 0), (toPoint?.y || 0) - (fromPoint?.y || 0));
  if (segmentLen <= 0.2) return;

  const flagBearer = ensureFlagBearer(squad, agents);
  const sourceWeight = Math.max(1, Number(flagBearer?.weight) || 1);
  const repConfig = resolveRepConfig(sim, crowd);
  const impactDamage = Math.max(
    0.8,
    (Number(squad.stats?.atk) || 10)
      * 0.11
      * Math.pow(sourceWeight, repConfig.damageExponent)
      * Math.max(0.05, Number(flagBearer?.combatScale) || 1)
  );
  const dir = normalizeVec((toPoint?.x || 0) - (fromPoint?.x || 0), (toPoint?.y || 0) - (fromPoint?.y || 0));
  crowd.agentsBySquad.forEach((enemyAgents, enemySquadId) => {
    const enemySquad = (sim?.squads || []).find((row) => row.id === enemySquadId) || null;
    if (!enemySquad || !isHostileTeam(squad?.team, enemySquad?.team) || enemySquad.remain <= 0) return;
    (Array.isArray(enemyAgents) ? enemyAgents : []).forEach((enemyAgent) => {
      if (!enemyAgent || enemyAgent.dead) return;
      if (rush.hitAgentIds.has(enemyAgent.id)) return;
      const hitRadius = CAVALRY_RUSH_IMPACT_RADIUS + Math.max(1.2, Number(enemyAgent.radius) || AGENT_RADIUS);
      const dist = pointToSegmentDistance(enemyAgent, fromPoint, toPoint);
      if (dist > hitRadius) return;

      rush.hitAgentIds.add(enemyAgent.id);
      enemyAgent.hitTimer = 0.24;
      enemyAgent.weight = Math.max(0, (Number(enemyAgent.weight) || 0) - impactDamage);
      enemyAgent.hpWeight = Math.max(0, (Number(enemyAgent.hpWeight) || 0) - impactDamage);
      const landing = resolveForcedAgentLanding(sim, enemyAgent, dir, 1.8);
      enemyAgent.x = landing.x;
      enemyAgent.y = landing.y;
      enemySquad.underAttackTimer = 1.2;
      acquireHitEffect(crowd.effectsPool, {
        type: 'slash',
        x: enemyAgent.x,
        y: enemyAgent.y,
        z: 1.6,
        radius: Math.max(2.2, Math.min(6.6, impactDamage * 0.9)),
        ttl: 0.14,
        team: squad.team
      });

      if (enemyAgent.weight <= 0.001) {
        enemyAgent.dead = true;
        squad.kills = Math.max(0, Number(squad.kills) || 0) + Math.max(1, Math.round(Number(enemyAgent.initialWeight) || 1));
      }
    });
  });
};

export const createCrowdSim = (sim, options = {}) => {
  const unitTypeMap = options?.unitTypeMap instanceof Map ? options.unitTypeMap : new Map();
  const repConfig = resolveRepConfig(sim, { repConfig: options?.repConfig || sim?.repConfig || {} });
  if (sim && typeof sim === 'object') {
    sim.engagementAgentDiameter = AGENT_RADIUS * 2;
    sim.engagementAgentGap = AGENT_GAP;
    sim.repConfig = repConfig;
  }
  const crowd = {
    agentsBySquad: new Map(),
    allAgents: [],
    effectsPool: createCombatEffectsPool(),
    nextAgentId: 1,
    unitTypeMap,
    repConfig,
    spatial: buildSpatialHash([], 14),
    engagement: null
  };
  (Array.isArray(sim?.squads) ? sim.squads : []).forEach((squad) => {
    const agents = createAgentsForSquad(squad, crowd);
    crowd.nextAgentId += agents.length;
    crowd.agentsBySquad.set(squad.id, agents);
    crowd.allAgents.push(...agents);
  });
  crowd.spatial = buildSpatialHash(crowd.allAgents, 14);
  return crowd;
};

export const addCrowdSquad = (crowd, squad, { replace = false } = {}) => {
  if (!crowd || !squad?.id) return [];
  if (!replace && crowd.agentsBySquad?.has(squad.id)) {
    return crowd.agentsBySquad.get(squad.id) || [];
  }
  if (replace) {
    const previousAgents = crowd.agentsBySquad?.get?.(squad.id) || [];
    if (isTrainingCardSquad(squad)) {
      resetTrainingCardSquadAiRuntime(squad, previousAgents, { preserveSlots: true });
    } else {
      resetTrainingNonCardSquadAiRuntime(squad, previousAgents);
    }
  }
  const agents = createAgentsForSquad(squad, crowd);
  crowd.nextAgentId += agents.length;
  crowd.agentsBySquad.set(squad.id, agents);
  return agents;
};

export const getCrowdAgentsForSquad = (crowd, squadId = '') => {
  const source = crowd?.agentsBySquad?.get(squadId);
  if (!Array.isArray(source)) return [];
  return source.filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
};

const ensureSkillCooldownMap = (squad) => {
  if (!squad || typeof squad !== 'object') return {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    artillery: 0,
    support: 0
  };
  if (!squad.skillCooldowns || typeof squad.skillCooldowns !== 'object') {
    const seedCooldown = Math.max(0, Number(squad.attackCooldown) || 0);
    const seedKind = (squad.classTag === 'cavalry' || squad.classTag === 'archer' || squad.classTag === 'artillery')
      ? squad.classTag
      : 'infantry';
    squad.skillCooldowns = {
      infantry: seedKind === 'infantry' ? seedCooldown : 0,
      cavalry: seedKind === 'cavalry' ? seedCooldown : 0,
      archer: seedKind === 'archer' ? seedCooldown : 0,
      artillery: seedKind === 'artillery' ? seedCooldown : 0,
      support: 0
    };
    return squad.skillCooldowns;
  }
  if (!Number.isFinite(Number(squad.skillCooldowns.infantry))) squad.skillCooldowns.infantry = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.cavalry))) squad.skillCooldowns.cavalry = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.archer))) squad.skillCooldowns.archer = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.artillery))) squad.skillCooldowns.artillery = 0;
  if (!Number.isFinite(Number(squad.skillCooldowns.support))) squad.skillCooldowns.support = 0;
  return squad.skillCooldowns;
};

export const resolveTrainingAiSkillPreflight = ({
  squad = null,
  target = null,
  sim = null,
  skillKind = ''
} = {}) => {
  const normalizedKind = skillKind === 'cavalry' || skillKind === 'archer' || skillKind === 'artillery'
    ? skillKind
    : 'infantry';
  if (!squad || (Number(squad?.remain) || 0) <= 0) {
    return { ok: false, reason: 'caster-unavailable', retrySec: 1.2 };
  }
  if (!target || (Number(target?.remain) || 0) <= 0 || !isHostileTeam(squad?.team, target?.team)) {
    return { ok: false, reason: 'target-invalid', retrySec: 1.2 };
  }
  if (isEnemyHiddenForViewer(target, squad?.team)) {
    return { ok: false, reason: 'target-hidden', retrySec: 1.2 };
  }
  if (squad?.activeSkill || (Number(squad?.skillRush?.ttl) || 0) > 0) {
    return { ok: false, reason: 'skill-active', retrySec: 0.6 };
  }
  const cooldownMap = ensureSkillCooldownMap(squad);
  if ((Number(cooldownMap?.[normalizedKind]) || 0) > 0.01) {
    return { ok: false, reason: 'skill-cooldown', retrySec: Math.min(2.1, Number(cooldownMap?.[normalizedKind]) || 0.6) };
  }
  if (normalizedKind === 'cavalry' && (Number(squad?.stamina) || 0) < 32) {
    return { ok: false, reason: 'insufficient-stamina', retrySec: 1.2 };
  }
  const source = { x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 };
  const targetPoint = { x: Number(target?.x) || 0, y: Number(target?.y) || 0 };
  const distance = Math.hypot(targetPoint.x - source.x, targetPoint.y - source.y);
  const maximumDistance = Math.max(1, Number(AI_SKILL_TARGET_RANGE[normalizedKind]) || skillRangeByClass(normalizedKind));
  const minimumDistance = normalizedKind === 'cavalry' ? CAVALRY_RUSH_MIN_DISTANCE : 0;
  if (distance < minimumDistance || distance > maximumDistance) {
    return { ok: false, reason: 'target-out-of-range', retrySec: 1.2, distance, maximumDistance };
  }
  const walls = filterBlockingObstacles(sim?.buildings || []);
  const navigator = sim?.trainingNavigator;
  if (navigator?.isWalkable && !navigator.isWalkable(targetPoint, {
    obstacles: walls,
    radius: Math.max(4, Number(target?.radius) || 10)
  })) {
    return { ok: false, reason: 'target-not-legal', retrySec: 1.2 };
  }
  const visionWalls = filterVisionBlockingObstacles(sim?.buildings || []);
  const blocked = !!raycastObstacles(source, targetPoint, visionWalls, Math.max(0.8, (Number(squad?.radius) || 10) * 0.12));
  if ((normalizedKind === 'archer' || normalizedKind === 'artillery') && blocked) {
    return { ok: false, reason: 'line-of-sight-blocked', retrySec: 1.2 };
  }
  const cavalryPathLegal = normalizedKind !== 'cavalry' || isTrainingMovementSegmentTraversable({
    sim,
    start: source,
    target: targetPoint,
    walls,
    radius: Math.max(0.6, Number(squad?.radius) || LEADER_COLLISION_RADIUS)
  });
  if (normalizedKind === 'cavalry' && (blocked || !cavalryPathLegal)) {
    return { ok: false, reason: 'charge-path-blocked', retrySec: 1.2 };
  }
  return {
    ok: true,
    reason: '',
    distance,
    maximumDistance,
    targetPoint
  };
};

const updateAttackCooldownFromSkills = (squad) => {
  const cooldowns = ensureSkillCooldownMap(squad);
  const maxCooldown = Math.max(
    0,
    Number(cooldowns.infantry) || 0,
    Number(cooldowns.cavalry) || 0,
    Number(cooldowns.archer) || 0,
    Number(cooldowns.artillery) || 0,
    Number(cooldowns.support) || 0
  );
  squad.attackCooldown = maxCooldown;
  return maxCooldown;
};

const getSkillCasterAgents = (crowd, squad, sourceCategory = SKILL_CATEGORY_MELEE) => (
  getCrowdAgentsForSquad(crowd, squad?.id)
    .filter((agent) => inferSkillCategoryFromUnitType(
      { unitCategory: agent?.unitCategory },
      SKILL_CATEGORY_MELEE
    ) === sourceCategory)
);

const getCasterCenter = (casters = [], squad = null) => {
  if (!Array.isArray(casters) || casters.length <= 0) {
    return { x: Number(squad?.x) || 0, y: Number(squad?.y) || 0 };
  }
  const totalWeight = casters.reduce((sum, agent) => sum + Math.max(0.1, Number(agent?.weight) || 0.1), 0);
  return casters.reduce((center, agent) => {
    const weight = Math.max(0.1, Number(agent?.weight) || 0.1);
    return {
      x: center.x + ((Number(agent?.x) || 0) * weight / totalWeight),
      y: center.y + ((Number(agent?.y) || 0) * weight / totalWeight)
    };
  }, { x: 0, y: 0 });
};

const resolveConfiguredSkillDirection = (squad, casters, targetInput = {}, profile = {}) => {
  const source = getCasterCenter(casters, squad);
  const inputDir = normalizeVec(Number(targetInput?.dirX) || 0, Number(targetInput?.dirY) || 0);
  const targetX = Number(targetInput?.x);
  const targetY = Number(targetInput?.y);
  const toTarget = normalizeVec(
    Number.isFinite(targetX) ? targetX - source.x : 0,
    Number.isFinite(targetY) ? targetY - source.y : 0
  );
  const fallback = normalizeVec(Number(squad?.dirX) || 1, Number(squad?.dirY) || 0);
  const direction = inputDir.len > 0.0001
    ? inputDir
    : (toTarget.len > 0.0001 ? toTarget : fallback);
  const minRange = Math.max(0, Number(profile?.minRange) || 0);
  const maxRange = Math.max(minRange || 1, Number(profile?.maxRange) || 180);
  const requestedDistance = Number.isFinite(Number(targetInput?.distance))
    ? Number(targetInput.distance)
    : toTarget.len;
  return {
    source,
    dirX: direction.x,
    dirY: direction.y,
    distance: clamp(Math.max(minRange, requestedDistance || minRange), minRange, maxRange),
    maxRange
  };
};

const resolveConfiguredTargetSquad = (sim, squad, targetInput = {}) => {
  const targetSquadId = String(targetInput?.targetSquadId || '').trim();
  const target = (sim?.squads || []).find((row) => row?.id === targetSquadId) || null;
  if (!target || (Number(target?.remain) || 0) <= 0) return null;
  if (!isHostileTeam(squad?.team, target?.team)) return null;
  return target;
};

const scheduleCasterActions = (casters = [], profile = {}, direction = {}, target = {}) => {
  casters.forEach((agent) => beginAgentCast(agent, {
    style: profile?.castStyle,
    motion: profile?.motion,
    durationSec: profile?.durationSec,
    dashDistance: profile?.dashDistance,
    dashSpeedMul: profile?.dashSpeedMul,
    dirX: direction?.dirX,
    dirY: direction?.dirY,
    targetX: target?.x,
    targetY: target?.y
  }));
};

const getAllCrowdAgents = (crowd) => {
  const current = Array.isArray(crowd?.allAgents) ? crowd.allAgents.filter(Boolean) : [];
  if (current.length > 0) return current;
  const agents = [];
  crowd?.agentsBySquad?.forEach?.((rows) => {
    if (Array.isArray(rows)) agents.push(...rows);
  });
  return agents;
};

const applyConfiguredMeleeWave = (sim, crowd, squad, activeSkill, waveIndex = 0) => {
  const profile = activeSkill?.profile || {};
  const casterIds = new Set(Array.isArray(activeSkill?.casterAgentIds) ? activeSkill.casterAgentIds : []);
  const casters = getCrowdAgentsForSquad(crowd, squad?.id)
    .filter((agent) => casterIds.size <= 0 || casterIds.has(agent.id));
  if (casters.length <= 0) return 0;
  const direction = {
    x: Number(activeSkill?.dirX) || 1,
    y: Number(activeSkill?.dirY) || 0
  };
  const source = activeSkill?.source || getCasterCenter(casters, squad);
  const maxRange = Math.max(4, Number(profile?.maxRange) || 40);
  const radius = Math.max(4, Number(profile?.aoeRadius) || 20);
  const coneAngle = Math.max(8, Math.min(180, Number(profile?.coneAngleDeg) || 90));
  const minDot = Math.cos((coneAngle * Math.PI / 180) * 0.5);
  const shape = String(profile?.shape || 'cone');
  const paintArea = activeSkill?.targetSpec?.kind === 'ground_paint'
    ? activeSkill.targetSpec
    : null;
  const damageExponent = Math.max(0.2, Number(sim?.repConfig?.damageExponent) || DEFAULT_DAMAGE_EXPONENT);
  const casterPower = casters.reduce((sum, agent) => (
    sum
      + Math.pow(Math.max(1, Number(agent?.weight) || 1), damageExponent)
      * Math.max(0.05, Number(agent?.combatScale) || 1)
  ), 0);
  const damage = Math.max(
    0.12,
    (Number(squad?.stats?.atk) || 10)
      * 0.036
      * Math.max(0.1, Number(profile?.damageMul) || 1)
      * Math.max(1, casterPower / Math.max(1, Math.sqrt(casters.length)))
  );
  const targets = getAllCrowdAgents(crowd)
    .filter((agent) => agent && !agent.dead && isHostileTeam(squad?.team, agent?.team))
    .sort((left, right) => {
      const leftDist = Math.hypot((left.x || 0) - source.x, (left.y || 0) - source.y);
      const rightDist = Math.hypot((right.x || 0) - source.x, (right.y || 0) - source.y);
      return leftDist - rightDist;
    });
  const impactedSquads = new Set();
  let hitCount = 0;
  const hitLimit = Math.max(6, Math.min(48, casters.length * 4));
  for (let index = 0; index < targets.length && hitCount < hitLimit; index += 1) {
    const target = targets[index];
    const dx = (Number(target.x) || 0) - source.x;
    const dy = (Number(target.y) || 0) - source.y;
    const dist = Math.hypot(dx, dy);
    const inShape = paintArea
      ? isPointInsideSkillPaintArea(target, paintArea, Math.max(0.6, Number(target?.radius) || 0))
      : shape === 'circle'
      ? dist <= radius
      : (dist <= maxRange && dist > 0.001 && (((dx / dist) * direction.x) + ((dy / dist) * direction.y)) >= minDot);
    if (!inShape) continue;
    const sourceAgent = casters[(hitCount + waveIndex) % casters.length];
    applyDamageToAgent(sim, crowd, sourceAgent, target, damage, 'slash', { poiseDamageMul: 1.25 });
    const knockback = Math.max(0, Number(profile?.knockback) || 0);
    if (knockback > 0 && !target.dead) {
      const landing = resolveForcedAgentLanding(sim, target, direction, knockback);
      target.x = landing.x;
      target.y = landing.y;
    }
    impactedSquads.add(target.squadId);
    hitCount += 1;
  }
  if (profile?.statusEffect && impactedSquads.size > 0) {
    impactedSquads.forEach((targetSquadId) => {
      const targetSquad = (sim?.squads || []).find((row) => row?.id === targetSquadId);
      if (!targetSquad) return;
      applySquadStatusEffect(targetSquad, {
        ...profile.statusEffect,
        sourceSkillId: activeSkill.skillId
      });
    });
  }
  acquireHitEffect(crowd.effectsPool, {
    type: 'slash',
    x: source.x + (direction.x * Math.min(maxRange * 0.42, 24)),
    y: source.y + (direction.y * Math.min(maxRange * 0.42, 24)),
    z: 1.2,
    radius: Math.max(4, shape === 'circle' ? radius : Math.min(radius, maxRange * 0.55)),
    ttl: 0.24,
    team: squad?.team
  });
  return hitCount;
};

const updateConfiguredMeleeSkill = (sim, crowd, squad, activeSkill, dt = 0) => {
  activeSkill.ttlSec = Math.max(0, (Number(activeSkill?.ttlSec) || 0) - Math.max(0, Number(dt) || 0));
  activeSkill.nextWaveSec = (Number(activeSkill?.nextWaveSec) || 0) - Math.max(0, Number(dt) || 0);
  while (
    activeSkill.wavesFired < activeSkill.wavesTotal
    && activeSkill.nextWaveSec <= 0
    && activeSkill.ttlSec > 0
  ) {
    applyConfiguredMeleeWave(sim, crowd, squad, activeSkill, activeSkill.wavesFired);
    activeSkill.wavesFired += 1;
    activeSkill.nextWaveSec += Math.max(0.06, Number(activeSkill.intervalSec) || 0.2);
  }
  squad.action = '兵种攻击';
  if (activeSkill.ttlSec <= 0 || activeSkill.wavesFired >= activeSkill.wavesTotal) {
    squad.activeSkill = null;
    if (squad.actionState?.kind === 'skill') {
      squad.actionState = { kind: 'none', from: 'none', to: 'none', ttl: 0, dur: 0 };
    }
  }
};

const triggerConfiguredCrowdSkill = (sim, crowd, squad, targetInput = {}) => {
  const profile = targetInput?.castProfile && typeof targetInput.castProfile === 'object'
    ? targetInput.castProfile
    : null;
  const sourceCategory = profile?.sourceCategory === SKILL_CATEGORY_RANGED
    || profile?.sourceCategory === SKILL_CATEGORY_SUPPORT
    ? profile.sourceCategory
    : SKILL_CATEGORY_MELEE;
  const casters = getSkillCasterAgents(crowd, squad, sourceCategory);
  if (casters.length <= 0) return { ok: false, reason: '该技能树当前没有可施法的小兵' };
  const direction = resolveConfiguredSkillDirection(squad, casters, targetInput, profile);
  const targetMode = String(profile?.targetMode || 'self');
  const targetSquad = targetMode === 'enemy'
    ? resolveConfiguredTargetSquad(sim, squad, targetInput)
    : null;
  if (targetMode === 'enemy' && !targetSquad) return { ok: false, reason: '请选择一支存活的敌方部队' };
  const target = targetSquad
    ? { x: Number(targetSquad.x) || 0, y: Number(targetSquad.y) || 0 }
    : {
      x: Number.isFinite(Number(targetInput?.x)) ? Number(targetInput.x) : direction.source.x,
      y: Number.isFinite(Number(targetInput?.y)) ? Number(targetInput.y) : direction.source.y
    };
  const projectileClass = profile?.projectileClass === 'artillery' ? 'artillery' : 'archer';
  const paintedGroundTarget = targetMode === 'ground' && targetInput?.paintArea
    ? normalizeGroundSkillTargetSpec(sim, squad, projectileClass, {
        ...targetInput,
        originX: direction.source.x,
        originY: direction.source.y,
        x: target.x,
        y: target.y,
        radius: Math.max(8, Number(profile?.aoeRadius) || 24),
        maxRange: Math.max(8, Number(profile?.maxRange) || skillRangeByClass(projectileClass))
      })
    : null;
  const effectiveMeleeTarget = sourceCategory === SKILL_CATEGORY_MELEE && targetMode === 'ground'
    ? paintedGroundTarget || {
        x: direction.source.x + (direction.dirX * direction.distance),
        y: direction.source.y + (direction.dirY * direction.distance)
      }
    : target;
  if (targetSquad && !profile?.globalTarget) {
    const targetDistance = Math.hypot(target.x - direction.source.x, target.y - direction.source.y);
    const maxRange = Math.max(8, Number(profile?.maxRange) || 180);
    if (targetDistance > maxRange + Math.max(0, Number(targetSquad.radius) || 0)) {
      return { ok: false, reason: '目标超出该兵种的施法范围' };
    }
  }
  const skillId = String(targetInput?.skillId || 'configured_skill');
  scheduleCasterActions(
    casters,
    profile,
    direction,
    sourceCategory === SKILL_CATEGORY_MELEE && targetMode === 'ground' ? effectiveMeleeTarget : target
  );

  if (sourceCategory === SKILL_CATEGORY_SUPPORT) {
    const statusTarget = targetSquad || squad;
    if (profile?.statusEffect) {
      applySquadStatusEffect(statusTarget, {
        ...profile.statusEffect,
        sourceSkillId: skillId
      });
    }
    acquireHitEffect(crowd.effectsPool, {
      type: targetSquad ? 'debuff_aura' : 'buff_aura',
      x: target.x,
      y: target.y,
      z: 1.4,
      radius: Math.max(5, Number(targetSquad?.radius) || Number(squad?.radius) * 0.55 || 8),
      ttl: Math.max(0.28, Number(profile?.durationSec) || 0.8),
      team: squad?.team
    });
    acquireHitEffect(crowd.effectsPool, {
      type: 'cast_pulse',
      x: direction.source.x,
      y: direction.source.y,
      z: 1.5,
      radius: Math.max(4, Number(squad?.radius) * 0.34),
      ttl: 0.3,
      team: squad?.team
    });
    squad.actionState = {
      kind: 'skill',
      from: 'none',
      to: 'support',
      ttl: Math.max(0.2, Number(profile?.durationSec) || 0.8),
      dur: Math.max(0.2, Number(profile?.durationSec) || 0.8)
    };
    squad.action = '辅助施法';
    return { ok: true, sourceCategory, targetSquadId: targetSquad?.id || '' };
  }

  if (sourceCategory === SKILL_CATEGORY_MELEE) {
    const isGroundCharge = targetMode === 'ground';
    const returnPoint = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
    const alertRect = isGroundCharge
      ? resolveMeleeAlertRect(squad, effectiveMeleeTarget)
      : null;
    const activeSkill = {
      id: `skill_${squad.id}_${Date.now()}`,
      mode: 'melee',
      skillId,
      profile,
      source: direction.source,
      dirX: direction.dirX,
      dirY: direction.dirY,
      targetSpec: paintedGroundTarget,
      casterAgentIds: casters.map((agent) => agent.id),
      wavesTotal: Math.max(1, Math.floor(Number(profile?.waves) || 1)),
      wavesFired: 0,
      intervalSec: Math.max(0.06, Number(profile?.intervalSec) || 0.2),
      nextWaveSec: 0,
      ttlSec: Math.max(0.2, Number(profile?.durationSec) || 0.8)
    };
    applyConfiguredMeleeWave(sim, crowd, squad, activeSkill, 0);
    activeSkill.wavesFired = 1;
    activeSkill.nextWaveSec = Math.max(0.06, Number(profile?.intervalSec) || 0.2);
    squad.activeSkill = activeSkill;
    if (isGroundCharge) {
      const chargePoints = {};
      const chargeSpreadRadius = clamp(
        Math.max(3, Number(profile?.aoeRadius) || 14) * 0.34,
        2.4,
        10
      );
      casters.forEach((agent, index) => {
        const angle = ((index / Math.max(1, casters.length)) * Math.PI * 2) + (Math.PI * 0.18);
        const chargePoint = {
          x: effectiveMeleeTarget.x + (Math.cos(angle) * chargeSpreadRadius),
          y: effectiveMeleeTarget.y + (Math.sin(angle) * chargeSpreadRadius)
        };
        chargePoints[agent.id] = chargePoint;
        agent.meleeChargeState = {
          phase: 'charge',
          chargePoint,
          returnPoint: { x: Number(agent.x) || 0, y: Number(agent.y) || 0 },
          attackStartedAt: 0
        };
      });
      squad.meleeAttackOrder = {
        active: true,
        phase: 'charge',
        targetPoint: { x: effectiveMeleeTarget.x, y: effectiveMeleeTarget.y },
        returnPoint,
        alertRect,
        casterAgentIds: casters.map((agent) => agent.id),
        chargePoints,
        resumeBehavior: squad.behavior === 'auto' ? 'auto' : 'idle',
        attackWindowSec: Math.max(1.4, Number(profile?.durationSec) * 2.4 || 2.2),
        phaseStartedAt: Math.max(0, Number(sim?.timeElapsed) || 0),
        holdUntil: 0
      };
      squad.behavior = 'skill';
      squad.targetSquadId = '';
      squad.waypoints = [];
    } else {
      squad.meleeAttackOrder = null;
    }
    squad.actionState = {
      kind: 'skill',
      from: 'none',
      to: 'melee',
      ttl: activeSkill.ttlSec,
      dur: activeSkill.ttlSec
    };
    squad.action = '近战突击';
    return { ok: true, sourceCategory };
  }

  const hasFixedRangedCaster = casters.some((agent) => (
    agent?.typeCategory === 'artillery' || agent?.unitSubtype === 'defense'
  ));
  if (profile?.statusEffect?.type === 'buff') {
    applySquadStatusEffect(squad, {
      ...profile.statusEffect,
      sourceSkillId: skillId
    });
  }
  const activeSkill = {
    id: `skill_${squad.id}_${Date.now()}`,
    mode: 'ground',
    skillId,
    source: direction.source,
    classTag: projectileClass,
    sourceCategory,
    targetSquadId: targetSquad?.id || '',
    targetTeam: targetSquad?.team || '',
    casterAgentIds: casters.map((agent) => agent.id),
    targetSpec: paintedGroundTarget || normalizeGroundSkillTargetSpec(sim, squad, projectileClass, {
      ...targetInput,
      originX: direction.source.x,
      originY: direction.source.y,
      x: target.x,
      y: target.y,
      radius: Math.max(8, Number(profile?.aoeRadius) || 24),
      maxRange: Math.max(8, Number(profile?.maxRange) || skillRangeByClass(projectileClass))
    }),
    wavesTotal: Math.max(1, Math.floor(Number(profile?.waves) || 1)),
    wavesFired: 0,
    intervalSec: Math.max(0.05, Number(profile?.intervalSec) || 0.24),
    nextWaveSec: 0,
    ttlSec: Math.max(0.2, Number(profile?.durationSec) || 0.8),
    lockMovement: !!profile?.requiresSetup && hasFixedRangedCaster,
    profile,
    config: {
      ...(GROUND_SKILL_CONFIG[projectileClass] || GROUND_SKILL_CONFIG.archer),
      radius: Math.max(8, Number(profile?.aoeRadius) || 24),
      waves: Math.max(1, Math.floor(Number(profile?.waves) || 1)),
      intervalSec: Math.max(0.05, Number(profile?.intervalSec) || 0.24),
      durationSec: Math.max(0.2, Number(profile?.durationSec) || 0.8),
      shotsPerWave: Math.max(1, Math.floor(Number(profile?.shotsPerWave) || 8)),
      impactRadius: Math.max(0.8, Number(profile?.impactRadius) || 2.8),
      blastRadius: Math.max(0, Number(profile?.blastRadius) || 0),
      blastFalloff: Math.max(0, Number(profile?.blastFalloff) || 0),
      damageMul: Math.max(0.1, Number(profile?.damageMul) || 1)
    }
  };
  if (profile?.statusEffect?.type === 'debuff') {
    const targetRadius = Math.max(8, Number(profile?.aoeRadius) || 24);
    (sim?.squads || []).forEach((enemySquad) => {
      if (!enemySquad || !isHostileTeam(squad?.team, enemySquad?.team) || (Number(enemySquad.remain) || 0) <= 0) return;
      const squadRadius = Math.max(8, Number(enemySquad.radius) || 8);
      const insidePaintArea = activeSkill.targetSpec?.kind === 'ground_paint'
        && isPointInsideSkillPaintArea(enemySquad, activeSkill.targetSpec, squadRadius);
      const dist = Math.hypot(
        (Number(enemySquad.x) || 0) - activeSkill.targetSpec.x,
        (Number(enemySquad.y) || 0) - activeSkill.targetSpec.y
      );
      if (activeSkill.targetSpec?.kind === 'ground_paint' ? insidePaintArea : dist <= targetRadius + squadRadius) {
        applySquadStatusEffect(enemySquad, {
          ...profile.statusEffect,
          sourceSkillId: skillId
        });
      }
    });
  }
  emitGroundSkillWave(sim, crowd, squad, activeSkill, 0);
  activeSkill.wavesFired = 1;
  activeSkill.nextWaveSec = activeSkill.intervalSec;
  squad.activeSkill = activeSkill;
  squad.actionState = {
    kind: 'skill',
    from: 'none',
    to: 'ranged',
    ttl: activeSkill.ttlSec,
    dur: activeSkill.ttlSec
  };
  squad.action = activeSkill.lockMovement ? '架设火力' : '远程齐射';
  return { ok: true, sourceCategory, target: activeSkill.targetSpec };
};

export const triggerCrowdSkill = (sim, crowd, squadId, targetInput) => {
  const squad = (sim?.squads || []).find((row) => row.id === squadId);
  if (!squad || squad.remain <= 0) return { ok: false, reason: '部队不可用' };
  if (targetInput?.castProfile && typeof targetInput.castProfile === 'object') {
    const configuredResult = triggerConfiguredCrowdSkill(sim, crowd, squad, targetInput);
    if (configuredResult?.ok) {
      const sourceCategory = configuredResult.sourceCategory || SKILL_CATEGORY_MELEE;
      const cooldownMap = ensureSkillCooldownMap(squad);
      const profileCooldown = Math.max(
        0.5,
        Number(targetInput?.castProfile?.cooldownSec)
          || (sourceCategory === SKILL_CATEGORY_SUPPORT ? 8.2 : sourceCategory === SKILL_CATEGORY_RANGED ? 8.6 : 2.4)
      );
      cooldownMap[sourceCategory] = Math.max(Number(cooldownMap[sourceCategory]) || 0, profileCooldown);
      updateAttackCooldownFromSkills(squad);
    }
    return configuredResult;
  }
  const agents = getCrowdAgentsForSquad(crowd, squad.id);
  if (agents.length <= 0) return { ok: false, reason: '无可用士兵' };
  const inputKind = typeof targetInput?.kind === 'string' ? targetInput.kind.trim() : '';
  let skillKind = inputKind;
  if (skillKind !== 'infantry' && skillKind !== 'cavalry' && skillKind !== 'archer' && skillKind !== 'artillery') {
    skillKind = typeof squad.classTag === 'string' ? squad.classTag : 'infantry';
  }
  if (skillKind !== 'infantry' && skillKind !== 'cavalry' && skillKind !== 'archer' && skillKind !== 'artillery') {
    skillKind = 'infantry';
  }
  let classWeight = 0;
  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) continue;
    if ((agent.typeCategory || 'infantry') === skillKind) {
      classWeight += Math.max(0, Number(agent.weight) || 0);
    }
  }
  if (classWeight <= 0.01) {
    return { ok: false, reason: '该兵种当前无人可释放技能' };
  }
  const cooldownMap = ensureSkillCooldownMap(squad);
  const classCooldownRemain = Math.max(0, Number(cooldownMap[skillKind]) || 0);
  if (classCooldownRemain > 0.01) return { ok: false, reason: '兵种攻击冷却中' };
  const inputX = Number(targetInput?.x);
  const inputY = Number(targetInput?.y);
  const tx = Number.isFinite(inputX) ? inputX : (squad.x || 0);
  const ty = Number.isFinite(inputY) ? inputY : (squad.y || 0);

  if (skillKind === 'infantry') {
    if (squad.guard) squad.guard.enabled = false;
    squad.effectBuff = {
      type: 'infantry',
      ttl: 7.5,
      atkMul: 1.22,
      defMul: 1.3,
      speedMul: 0.78
    };
    squad.waypoints = [];
    cooldownMap.infantry = Math.max(Number(cooldownMap.infantry) || 0, Number(SKILL_COOLDOWN_BY_CLASS.infantry) || 2.1);
    updateAttackCooldownFromSkills(squad);
    squad.actionState = {
      kind: 'skill',
      from: 'none',
      to: 'infantry',
      ttl: 0.45,
      dur: 0.45
    };
    squad.action = '兵种攻击';
    return { ok: true };
  }

  if (skillKind === 'cavalry') {
    if (squad.guard) squad.guard.enabled = false;
    const dir = normalizeVec(tx - (Number(squad.x) || 0), ty - (Number(squad.y) || 0));
    const dist = clamp(dir.len, CAVALRY_RUSH_MIN_DISTANCE, CAVALRY_RUSH_MAX_DISTANCE);
    squad.skillRush = {
      ttl: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5),
      dirX: dir.x,
      dirY: dir.y,
      remainDistance: dist,
      hitAgentIds: new Set(),
      startX: Number(squad.x) || 0,
      startY: Number(squad.y) || 0
    };
    squad.behavior = 'skill';
    squad.waypoints = [];
    squad.stamina = clamp((Number(squad.stamina) || 0) - 32, 0, STAMINA_MAX);
    cooldownMap.cavalry = Math.max(Number(cooldownMap.cavalry) || 0, Number(SKILL_COOLDOWN_BY_CLASS.cavalry) || 2.8);
    updateAttackCooldownFromSkills(squad);
    squad.actionState = {
      kind: 'charge',
      from: 'none',
      to: 'cavalry',
      ttl: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5),
      dur: Math.max(0.55, (dist / CAVALRY_RUSH_SPEED) * 1.5)
    };
    squad.action = '兵种攻击';
    return { ok: true };
  }

  const rangedClass = skillKind === 'artillery' ? 'artillery' : 'archer';
  const requestedTargetSquad = resolveConfiguredTargetSquad(
    sim,
    squad,
    targetInput && typeof targetInput === 'object' ? targetInput : {}
  );
  if (squad.guard) squad.guard.enabled = false;
  const cfg = GROUND_SKILL_CONFIG[rangedClass] || GROUND_SKILL_CONFIG.archer;
  const targetSpec = normalizeGroundSkillTargetSpec(
    sim,
    squad,
    rangedClass,
    targetInput && typeof targetInput === 'object' ? targetInput : { x: tx, y: ty }
  );
  const activeSkill = {
    id: `skill_${squad.id}_${Date.now()}`,
    classTag: rangedClass,
    targetSquadId: requestedTargetSquad?.id || '',
    targetTeam: requestedTargetSquad?.team || '',
    targetSpec,
    wavesTotal: Math.max(1, Math.floor(Number(cfg?.waves) || 1)),
    wavesFired: 0,
    intervalSec: Math.max(0.05, Number(cfg?.intervalSec) || 0.2),
    nextWaveSec: 0,
    ttlSec: Math.max(0.08, Number(cfg?.durationSec) || 0.8),
    config: cfg
  };
  emitGroundSkillWave(sim, crowd, squad, activeSkill, 0);
  activeSkill.wavesFired = 1;
  activeSkill.nextWaveSec = Math.max(0.05, Number(cfg?.intervalSec) || 0.2);
  squad.activeSkill = activeSkill;
  cooldownMap[rangedClass] = Math.max(
    Number(cooldownMap[rangedClass]) || 0,
    Number(cfg?.cooldownSec) || Number(SKILL_COOLDOWN_BY_CLASS[rangedClass]) || 6.5
  );
  updateAttackCooldownFromSkills(squad);
  squad.actionState = {
    kind: 'skill',
    from: 'none',
    to: rangedClass,
    ttl: Math.max(0.2, Number(cfg?.durationSec) || 0.8),
    dur: Math.max(0.2, Number(cfg?.durationSec) || 0.8)
  };
  squad.action = '兵种攻击';
  return { ok: true };
};

export const updateCrowdSim = (crowd, sim, dt) => {
  if (!crowd || !sim || sim.ended) return;
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  const steeringWeights = resolveSteeringWeights(sim, crowd);
  if (sim && typeof sim === 'object') sim.steeringWeights = steeringWeights;
  if (crowd && typeof crowd === 'object') crowd.steeringWeights = steeringWeights;
  sim.timeElapsed = Math.max(0, Number(sim?.timeElapsed) || 0) + safeDt;
  const nowSec = Number(sim?.timeElapsed) || 0;
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  sim._trainingNavigationBudget = {
    remaining: resolveTrainingNavigationPlanBudget(sim),
    at: nowSec
  };
  sim._formationRecoveryNavigationBudget = {
    remaining: resolveFormationRecoveryPlanBudget(sim),
    at: nowSec
  };
  sim._minionRecoveryNavigationBudget = sim._formationRecoveryNavigationBudget;
  const decisionSquadIds = squads
    .filter((squad) => isTrainingCardAiSquad(squad) && (Number(squad.remain) || 0) > 0)
    .map((squad) => String(squad.id || ''))
    .filter(Boolean);
  const decisionLimit = Math.min(resolveTrainingAiDecisionBudget(sim), decisionSquadIds.length);
  const decisionStart = decisionSquadIds.length > 0
    ? Math.max(0, Math.floor(Number(sim?._trainingAiDecisionCursor) || 0)) % decisionSquadIds.length
    : 0;
  const allowedDecisionIds = new Set();
  for (let index = 0; index < decisionLimit; index += 1) {
    allowedDecisionIds.add(decisionSquadIds[(decisionStart + index) % decisionSquadIds.length]);
  }
  sim._trainingAiDecisionCursor = decisionSquadIds.length > 0
    ? (decisionStart + Math.max(1, decisionLimit)) % decisionSquadIds.length
    : 0;
  sim._trainingAiDecisionBudget = {
    remaining: decisionLimit,
    allowedIds: allowedDecisionIds,
    consumedIds: new Set(),
    at: nowSec
  };
  updateTrainingNeutralCamps({
    sim,
    crowd,
    nowSec,
    context: {
      field: sim.field,
      navigator: sim.trainingNavigator,
      obstacles: sim.buildings
    },
    spawnSquad: (squad) => addCrowdSquad(crowd, squad, { replace: true })
  });
  const squadMap = new Map(squads.filter(Boolean).map((squad) => [squad.id, squad]));
  sim._squadById = squadMap;
  const walls = resolveCrowdBlockingWalls(crowd, sim?.buildings || []);
  sim._trainingBlockingObstacles = walls;

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents, squadId) => {
    const filtered = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
    crowd.agentsBySquad.set(squadId, filtered);
    crowd.allAgents.push(...filtered);
  });
  squads.forEach((squad) => {
    clearForeignTrainingAiState(squad, crowd.agentsBySquad.get(squad?.id) || []);
  });
  prepareTrainingNonCardSquadAiFrame({ sim, crowd, nowSec });
  updateTrainingSquadRespawns({
    sim,
    crowd,
    nowSec,
    spawnSquad: (squad) => addCrowdSquad(crowd, squad, { replace: true })
  });
  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents, squadId) => {
    const filtered = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
    crowd.agentsBySquad.set(squadId, filtered);
    crowd.allAgents.push(...filtered);
  });
  squads.forEach((squad) => {
    clearForeignTrainingAiState(squad, crowd.agentsBySquad.get(squad?.id) || []);
  });
  squads.forEach((squad) => {
    if (!squad || (Number(squad.remain) || 0) <= 0) return;
    const agents = crowd.agentsBySquad.get(squad.id);
    if (Array.isArray(agents) && agents.length <= 0) {
      aggregateSquadFromAgents(squad, agents);
    }
  });
  const spatial = buildSpatialHash(crowd.allAgents, 14);
  crowd.spatial = spatial;
  const agentMap = new Map(
    crowd.allAgents
      .filter((agent) => agent?.id)
      .map((agent) => [String(agent.id), agent])
  );
  syncMeleeEngagement(crowd, sim, walls, safeDt, Number(sim?.timeElapsed) || 0);
  itemInteractionSystem.step(sim, crowd, safeDt);
  updateTrainingMinionSquadAiFrame({
    sim,
    crowd,
    nowSec,
    isPointWithinLane: (point, squad) => isPointWithinTrainingRoadSearchBand(point, squad, sim),
    assignWaypoints: (squad, requestedWaypoints) => {
      squad.waypoints = resolveMinionNavigationWaypoints({
        squad,
        sim,
        walls,
        requestedWaypoints
      });
    }
  });

  squads.forEach((squad) => {
    if (!squad) return;
    const squadKind = resolveTrainingSquadKind(squad);
    const agents = crowd.agentsBySquad.get(squad.id) || [];
    if (squad.remain <= 0) {
      if (squadKind === TRAINING_SQUAD_KIND.CARD) {
        resetTrainingCardSquadAiRuntime(squad, agents, { preserveSlots: true });
      }
      return;
    }
    const movementWalls = walls;
    if (!squad.meleeAttackOrder) {
      agents.forEach((agent) => {
        if (agent?.meleeChargeState) agent.meleeChargeState = null;
      });
    }
    if (agents.length <= 0) {
      squad.remain = 0;
      squad.health = 0;
      squad.action = '覆灭';
      squad.behavior = 'idle';
      squad.waypoints = [];
      squad.flagBearerAgentId = '';
      if (squadKind === TRAINING_SQUAD_KIND.CARD) {
        resetTrainingCardSquadAiRuntime(squad, agents, { preserveSlots: true });
      }
      return;
    }
    const actionState = ensureSquadActionState(squad);
    const stability = ensureSquadStability(squad);
    if (actionState.kind !== 'none') {
      actionState.ttl = Math.max(0, (Number(actionState.ttl) || 0) - safeDt);
      if (actionState.ttl <= 0) {
        actionState.kind = 'none';
        actionState.from = 'none';
        actionState.to = 'none';
        actionState.dur = 0;
        actionState.ttl = 0;
      }
    }
    if (stability) {
      if (actionState.kind === 'transition') {
        stability.transition = clamp(
          (Number(stability.transition) || 0) - (Math.max(0.1, Number(stability.transitionDecayPerSec) || 0.1) * safeDt),
          0,
          Math.max(1, Number(stability.transitionMax) || 1)
        );
      } else {
        stability.transition = clamp(
          (Number(stability.transition) || 0) + (Math.max(0.1, Number(stability.transitionRegenPerSec) || 0.1) * safeDt),
          0,
          Math.max(1, Number(stability.transitionMax) || 1)
        );
      }
      if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
        stability.chargePoiseCurrent = clamp(
          Number(stability.chargePoiseCurrent) || Number(stability.chargePoise) || 0,
          0,
          Math.max(1, Number(stability.chargePoise) || 1)
        );
      } else {
        stability.chargePoiseCurrent = Math.max(0, Number(stability.chargePoise) || 0);
      }
      stability.poise = clamp(
        (Number(stability.poise) || 0) + (Math.max(0.1, Number(stability.poiseRegenPerSec) || 0.1) * safeDt),
        0,
        Math.max(1, Number(stability.poiseMax) || 1)
      );
    }
    if (squad.effectBuff) {
      squad.effectBuff.ttl = Math.max(0, Number(squad.effectBuff.ttl) - safeDt);
      if (squad.effectBuff.ttl <= 0) squad.effectBuff = null;
    }
    stepSquadStatusEffects(squad, safeDt);
    squad._buffFxCd = Math.max(0, Number(squad._buffFxCd) || 0);
    if (squad.effectBuff) {
      squad._buffFxCd = Math.max(0, squad._buffFxCd - safeDt);
      if (squad._buffFxCd <= 0) {
        acquireHitEffect(crowd.effectsPool, {
          type: 'buff_aura',
          x: Number(squad.x) || 0,
          y: Number(squad.y) || 0,
          z: 1.1,
          radius: Math.max(4, Number(squad.radius) * 0.55),
          ttl: 0.24,
          team: squad.team
        });
        squad._buffFxCd = 0.24;
      }
    }
    const activeStatusEffects = Array.isArray(squad.statusEffects)
      ? squad.statusEffects.filter((effect) => (Number(effect?.ttl) || 0) > 0)
      : [];
    squad._statusFxCd = Math.max(0, Number(squad._statusFxCd) || 0);
    if (activeStatusEffects.length > 0) {
      squad._statusFxCd = Math.max(0, squad._statusFxCd - safeDt);
      if (squad._statusFxCd <= 0) {
        const isDebuffed = activeStatusEffects.some((effect) => effect?.type === 'debuff');
        acquireHitEffect(crowd.effectsPool, {
          type: isDebuffed ? 'debuff_aura' : 'buff_aura',
          x: Number(squad.x) || 0,
          y: Number(squad.y) || 0,
          z: 1.1,
          radius: Math.max(4, Number(squad.radius) * 0.58),
          ttl: 0.28,
          team: squad.team
        });
        squad._statusFxCd = 0.36;
      }
    }
    squad._rushDustCd = Math.max(0, Number(squad._rushDustCd) || 0);
    if ((Number(squad?.skillRush?.ttl) || 0) > 0) {
      squad._rushDustCd = Math.max(0, squad._rushDustCd - safeDt);
      if (squad._rushDustCd <= 0) {
        acquireHitEffect(crowd.effectsPool, {
          type: 'charge_dust',
          x: Number(squad.x) || 0,
          y: Number(squad.y) || 0,
          z: 0.7,
          radius: Math.max(5, Number(squad.radius) * 0.48),
          ttl: 0.22,
          team: squad.team
        });
        squad._rushDustCd = 0.09;
      }
    }
    if ((Number(squad.fatigueTimer) || 0) > 0) {
      squad.fatigueTimer = Math.max(0, Number(squad.fatigueTimer) - safeDt);
    }
    updateActiveGroundSkill(sim, crowd, squad, safeDt);
    const skillCooldowns = ensureSkillCooldownMap(squad);
    skillCooldowns.infantry = Math.max(0, (Number(skillCooldowns.infantry) || 0) - safeDt);
    skillCooldowns.cavalry = Math.max(0, (Number(skillCooldowns.cavalry) || 0) - safeDt);
    skillCooldowns.archer = Math.max(0, (Number(skillCooldowns.archer) || 0) - safeDt);
    skillCooldowns.artillery = Math.max(0, (Number(skillCooldowns.artillery) || 0) - safeDt);
    skillCooldowns.support = Math.max(0, (Number(skillCooldowns.support) || 0) - safeDt);
    updateAttackCooldownFromSkills(squad);
    squad.underAttackTimer = Math.max(0, (Number(squad.underAttackTimer) || 0) - safeDt);
    if (squadKind === TRAINING_SQUAD_KIND.CARD) {
      syncSquadAgentCombatLock({
        squad,
        agents,
        agentMap,
        squadMap,
        nowSec
      });
      updateSquadBehaviorPlan(squad, sim, Number(sim?.timeElapsed) || 0, movementWalls, crowd);
    }
    squad._aiSkillCd = Math.max(0, Number(squad._aiSkillCd) || 0);

    if (isTrainingCardAiSquad(squad) && squad.team === TEAM_DEFENDER) {
      squad._aiSkillCd = Math.max(0, squad._aiSkillCd - safeDt);
      if (squad._aiSkillCd <= 0) {
        const selectedEnemy = selectTrainingMapEnemyTarget(squad, sim, Number(sim?.timeElapsed) || 0);
        if (squad._trainingAiDecisionDeferred) {
          squad._aiSkillCd = 0.08;
        } else {
          const nearestEnemy = selectedEnemy || (
            squad?.behavior === 'auto' && squad?._trainingAiPlan
              ? null
              : pickNearestEnemySquad(squad, sim?.squads || [])
          );
          if (nearestEnemy) {
            const classTag = squad.classTag === 'cavalry' || squad.classTag === 'archer' || squad.classTag === 'artillery'
              ? squad.classTag
              : 'infantry';
            const preflight = resolveTrainingAiSkillPreflight({
              squad,
              target: nearestEnemy,
              sim,
              skillKind: classTag
            });
            if (preflight.ok) {
              const result = triggerCrowdSkill(sim, crowd, squad.id, {
                kind: classTag,
                targetSquadId: nearestEnemy.id,
                x: nearestEnemy.x || 0,
                y: nearestEnemy.y || 0
              });
              if (result?.ok) {
                squad._aiSkillCd = classTag === 'artillery' ? 8.8 : 6.6;
              } else {
                squad._aiSkillCd = 2.1;
              }
            } else {
              recordTrainingMapAiEvent({
                squad,
                sim,
                nowSec,
                reason: `skill-preflight-${preflight.reason}`,
                targetId: nearestEnemy.id
              });
              squad._aiSkillCd = Math.max(0.2, Number(preflight.retrySec) || 1.2);
            }
          } else {
            squad._aiSkillCd = 1.2;
          }
        }
      }
    }

    const navigationStart = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
    const navigationTarget = isTrainingCardSquad(squad)
      && (Number(squad?.skillRush?.ttl) || 0) <= 0
      ? resolveTrainingNavigationTarget(squad)
      : null;
    const previousFormationPose = resolveSquadFormationPose(squad);
    let forward = squad._crowdForward || teamForward(squad.team);
    const rushFromPoint = { x: Number(squad.x) || 0, y: Number(squad.y) || 0 };
    const enemy = (sim.squads || []).find((row) => row.id === squad.targetSquadId && row.remain > 0) || null;
    if (enemy && squadKind !== TRAINING_SQUAD_KIND.MINION && !(Array.isArray(squad.waypoints) && squad.waypoints.length > 0)) {
      const toEnemy = normalizeVec((enemy.x || 0) - (squad.x || 0), (enemy.y || 0) - (squad.y || 0));
      if (toEnemy.len > 0.0001) forward = { x: toEnemy.x, y: toEnemy.y };
    }
    const baseCols = Math.max(1, Number(squad._crowdBaseColumns) || Math.ceil(Math.sqrt(agents.length)));
    const spacing = (AGENT_RADIUS * 2) + AGENT_GAP;
    const formationSpacing = normalizeFormationSpacing(squad?.formationSpacing);
    let formationSpacingScale = FORMATION_SPACING_SCALE[formationSpacing]
      || FORMATION_SPACING_SCALE[FORMATION_SPACING_STANDARD];
    const hasMovementWaypoints = Array.isArray(squad.waypoints) && squad.waypoints.length > 0;
    const passageIntent = (Number(squad.skillRush?.ttl) || 0) > 0
      || hasMovementWaypoints
      || squad?._formationArrival?.active === true
      || squad?._narrowPassage?.active === true;
    const rearProbeDistance = resolveFormationRearProbeDistance({
      squad,
      agents,
      passage: squad?._narrowPassage
    });
    const narrowPassage = squadKind !== TRAINING_SQUAD_KIND.CARD && passageIntent
      ? resolveTrainingNarrowPassageState({
        squad,
        sim,
        walls: movementWalls,
        forward,
        baseColumns: baseCols,
        spacing,
        rearProbeDistance,
        nowSec
      })
      : { active: false, columns: baseCols, width: Infinity, distance: 0 };
    // CARD squads have one cohesion authority in TrainingCardSquadTactics.
    // The legacy controller remains for minions/other squad kinds only.
    if (squadKind !== TRAINING_SQUAD_KIND.CARD) {
      resolveSquadFormationCohesion({
        squad,
        agents,
        passage: narrowPassage,
        moving: (Number(squad.skillRush?.ttl) || 0) > 0 || hasMovementWaypoints,
        nowSec
      });
    }
    const cardAiFrame = squadKind === TRAINING_SQUAD_KIND.CARD
      ? prepareTrainingCardSquadAiFrame({
        squad,
        agents,
        crowd,
        spatial,
        squadMap,
        agentMap,
        sim,
        walls: movementWalls,
        forward,
        nowSec,
        moving: (Number(squad.skillRush?.ttl) || 0) > 0 || hasMovementWaypoints
      })
      : null;
    const squadController = cardAiFrame?.formation || null;
    const controllerPassage = (
      squadController?.terrain?.state === 'PASSAGE'
      || squadController?.terrain?.state === 'EXPAND'
    )
    ? {
        active: squadController?.terrain?.state === 'PASSAGE',
        flowing: squadController?.terrain?.state === 'PASSAGE',
        expanding: squadController?.terrain?.state === 'EXPAND',
        columns: Math.max(1, Number(squadController?.terrain?.columns) || 1),
        width: Number(squadController?.terrain?.corridorWidth) || Infinity,
        distance: Number(squadController?.terrain?.frontClearance) || 0
      }
      : null;
    const activePassage = controllerPassage || narrowPassage;
    if (squadController && squadKind !== TRAINING_SQUAD_KIND.CARD) {
      formationSpacingScale *= clamp(Number(squadController?.terrain?.compression) || 1, 0.76, 1);
    }
    forward = leaderMoveStep(squad, sim, crowd, safeDt, forward, steeringWeights, movementWalls);
    squad._crowdForward = forward;
    const formationPose = advanceSquadFormationPose(squad, forward, previousFormationPose, safeDt);
    const formationForward = formationPose.forward;
    squad._crowdFormationForward = { x: formationForward.x, y: formationForward.y };
    updateSquadSpeedPolicyState(squad, agents, safeDt);
    const modeGroupSpeed = squad.speedMode === SPEED_MODE_C
      ? computeRetreatGroupSpeed(squad, crowd)
      : computeWeightedGroupSpeed(squad, crowd);
    squad._groupSpeedScalar = Math.max(0.2, modeGroupSpeed);

    const leaderMoving = ((Number(squad.skillRush?.ttl) || 0) > 0)
      || (Array.isArray(squad.waypoints) && squad.waypoints.length > 0);
    const speedPolicy = typeof squad.speedPolicy === 'string' ? squad.speedPolicy : SPEED_POLICY_MARCH;
    const retreatMode = speedPolicy === SPEED_POLICY_RETREAT;
    const reformMode = speedPolicy === SPEED_POLICY_REFORM;
    const slotGain = retreatMode ? 0.44 : (reformMode ? 1.36 : 1);
    const sepGain = retreatMode ? 0.52 : (reformMode ? 0.86 : 1);
    const avoidGain = retreatMode ? 0.68 : 0.95;
    const accelCap = retreatMode ? AGENT_RETREAT_ACCEL : (reformMode ? AGENT_REFORM_ACCEL : AGENT_MAX_ACCEL);
    const flagBack = spacing * FLAG_BACK_OFFSET;
    const sorted = agents;
    const nearbyAgents = [];
    const nearbyWalls = [];
    const statusMultipliers = resolveSquadStatusMultipliers(squad);
    ensureFlagBearer(squad, sorted);
    const objectiveCandidates = isTrainingCardSquad(squad)
      ? resolveAgentObjectiveCandidates(squad, sim)
      : [];

    const aiPlanPending = isTrainingCardAiSquad(squad)
      && squad._trainingAiDecisionDeferred === true
      && !leaderMoving
      && !squad.activeSkill
      && !squad.meleeAttackOrder;
    if (aiPlanPending && !isSquadCombatEnabled(squad)) {
      holdAgentsWhileAiPlanPending(sorted, safeDt);
    } else {
      sorted.forEach((agent, index) => {
      if (!agent || agent.dead) return;
      stepAgentCast(agent, safeDt);
      agent.supportCastCd = Math.max(0, (Number(agent.supportCastCd) || 0) - safeDt);
      if (squad.meleeAttackOrder && agent.meleeChargeState) {
        const handled = stepMeleeChargeAgent(
          agent,
          squad,
          squad.meleeAttackOrder,
          sim,
          movementWalls,
          safeDt,
          nowSec
        );
        if (handled) return;
      }
      if (agent.isFlagBearer && squadKind === TRAINING_SQUAD_KIND.CARD) {
        clearAgentCombatTargets(agent);
        const flagOffsetX = -formationForward.x * flagBack;
        const flagOffsetY = -formationForward.y * flagBack;
        const flagStep = resolveTrainingLegalMovementStep({
          sim,
          start: { x: Number(agent.x) || 0, y: Number(agent.y) || 0 },
          target: {
            x: (Number(squad.x) || 0) + flagOffsetX,
            y: (Number(squad.y) || 0) + flagOffsetY
          },
          walls: movementWalls,
          radius: (agent.radius || AGENT_RADIUS) + 0.5
        });
        const previousFlagX = Number(agent.x) || 0;
        const previousFlagY = Number(agent.y) || 0;
        agent.x = flagStep.x;
        agent.y = flagStep.y;
        agent.vx = (agent.x - previousFlagX) / Math.max(1e-4, safeDt);
        agent.vy = (agent.y - previousFlagY) / Math.max(1e-4, safeDt);
        if (Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08) {
          agent.yaw = formationPose.current.yaw;
        } else {
          agent.yaw = Math.atan2(formationForward.y, formationForward.x);
        }
        agent.state = agent.attackCd > 0 ? 'attack' : 'idle';
        agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
        return;
      }
      const standardSlot = resolveAgentFormationSlot(agent, index, baseCols, spacing, formationSpacing);
      const cardTacticalIntent = resolveTrainingCardAgentTacticalIntent({
        agent,
        squad,
        crowd,
        agentMap,
        squadMap,
        nowSec,
        fallbackSlot: standardSlot
      });
      const combatDirective = resolveAgentCombatDirective({
        agent,
        squad,
        sim,
        crowd,
        spatial,
        squadMap,
        agentMap,
        nowSec,
        objectiveCandidates,
        cardTacticalIntent
      });
      const controllerSlot = cardTacticalIntent?.formationSlot || null;
      const slot = controllerSlot
        || (squadKind === TRAINING_SQUAD_KIND.CARD
          ? standardSlot
          : resolveNarrowPassageFormationSlot({
            index,
            standardSlot,
            passage: activePassage,
            spacing,
            spacingScale: formationSpacingScale
          }));
      const castOffset = resolveAgentCastOffset(agent);
      const currentSlotPosition = formationLocalToWorld(formationPose.current, slot);
      const previousSlotPosition = formationLocalToWorld(formationPose.previous, slot);
      const desiredX = currentSlotPosition.x + castOffset.x;
      const desiredY = currentSlotPosition.y + castOffset.y;
      const targetSlotVx = (currentSlotPosition.x - previousSlotPosition.x) / Math.max(0.001, safeDt);
      const targetSlotVy = (currentSlotPosition.y - previousSlotPosition.y) / Math.max(0.001, safeDt);
      const toDesired = normalizeVec(desiredX - (agent.x || 0), desiredY - (agent.y || 0));
      const flowIntent = cardTacticalIntent?.passageFlow || null;
      const formationEnvelope = resolveSquadFormationEnvelope(squad);
      const combatTetherPressure = clamp(
        (toDesired.len - formationEnvelope.softRadius)
          / Math.max(1, formationEnvelope.hardRadius - formationEnvelope.softRadius),
        0,
        1
      );
      const fatigueMul = squad.fatigueTimer > 0 ? 0.72 : 1;
      const weightSlow = 1;
      const castSpeedMul = Number(agent?.castState?.dashSpeedMul) > 0
        ? Number(agent.castState.dashSpeedMul)
        : 1;
      const speedMul = (squad.effectBuff?.speedMul ? Number(squad.effectBuff.speedMul) : 1)
        * statusMultipliers.speedMul
        * ((squad.skillRush?.ttl || 0) > 0 ? 1.45 : 1)
        * castSpeedMul;
      const modeSpeedMul = resolveAgentModeSpeedMul(agent, squad, crowd);
      const controllerSpeedMul = cardTacticalIntent?.passageFlow
        ? 1
        : (cardTacticalIntent?.catchUpMultiplier || 1);
      const marchWorldSpeed = Math.max(
        6,
        Number(squad._marchWorldSpeedBase)
          || ((Number(squad._groupSpeedScalar) || Number(squad.stats?.speed) || 1)
            * REFERENCE_LEADER_SPEED_MULTIPLIER
            * resolveTrainingMapMovementScale(sim))
      );
      const speed = Math.max(
        6,
        marchWorldSpeed
          * AGENT_FORMATION_CATCHUP_SPEED_MUL
          * fatigueMul
          * weightSlow
          * speedMul
          * modeSpeedMul
          * controllerSpeedMul
      );
      if (
        isTrainingMinionSquad(squad)
        && stepMinionWaveCombatAgent({
          agent,
          squad,
          sim,
          walls: movementWalls,
          dt: safeDt,
          speed,
          combatDirective
        })
      ) return;
      const engagementCfg = crowd?.engagement?.config || {};
      const engagementEnabled = !!crowd?.engagement?.enabled;
      const isMelee = isMeleeAgent(agent);
      const hasAnchor = engagementEnabled && isMelee && !!agent.engagePairKey
        && Number.isFinite(Number(agent.engageAx)) && Number.isFinite(Number(agent.engageAy));
      const neighborRadius = Math.max(
        12,
        Number(flowIntent?.queueSpacing) || 0,
        Number(flowIntent?.streamSpacing) || 0,
        flowIntent ? (speed * 0.22) + (Number(flowIntent?.streamSpacing) || 0) : 0
      ) * 1.35;
      const neighbors = querySpatialNearby(spatial, agent.x, agent.y, neighborRadius, nearbyAgents);
      const passageFlow = isTrainingCardSquad(squad)
        ? resolveTrainingCardPassageFlowSteering({
          agent,
          squad,
          flowIntent,
          neighbors,
          speed
        })
        : resolvePassageFlowSteering({
          agent,
          squad,
          flowIntent,
        neighbors
        });
      const formationRecoveryGuidance = resolveAgentFormationRecoveryGuidance({
        agent,
        squad,
        sim,
        walls: movementWalls,
        target: passageFlow
          ? { x: passageFlow.goalX, y: passageFlow.goalY }
          : { x: desiredX, y: desiredY },
        enabled: !passageFlow
          && !combatDirective
          && !hasAnchor
          && !castOffset.active
          && !isTrainingNeutralSquad(squad),
        flowing: !!passageFlow,
        nowSec
      });
      const separationDistance = Math.max(
        AGENT_MIN_FORMATION_SEPARATION_GAP,
        passageFlow
          ? Math.max(spacing * 0.74, Number(flowIntent?.queueSpacing) || 0)
          : spacing * (squadKind === TRAINING_SQUAD_KIND.CARD ? 1 : formationSpacingScale) * 0.94
      );
      const slotWalls = queryObstacleCandidates(
        movementWalls,
        desiredX,
        desiredY,
        (agent.radius || AGENT_RADIUS) + 0.5,
        nearbyWalls
      );
      const slotBlocked = !passageFlow && slotWalls.some((wall) => (
        !wall?.destroyed
        &&
        pushOutOfRect({ x: desiredX, y: desiredY }, wall, (agent.radius || AGENT_RADIUS) + 0.5)?.pushed
      ));
      const hasForeignNeighbor = neighbors.some((other) => (
        other
        && !other.dead
        && other.squadId !== agent.squadId
        && Math.hypot((agent.x || 0) - (other.x || 0), (agent.y || 0) - (other.y || 0)) < separationDistance
      ));
      if (
        agent._formationLocked !== false
        && !castOffset.active
        && !combatDirective
        && !hasAnchor
        && !passageFlow
        && !agent._formationDetached
        && !(squadKind === TRAINING_SQUAD_KIND.CARD && leaderMoving)
        && !slotBlocked
        && !hasForeignNeighbor
      ) {
        const previousX = Number(agent.x) || 0;
        const previousY = Number(agent.y) || 0;
        const formationStep = advanceAgentFormationPosition(
          agent,
          slot,
          formationPose.previous,
          formationPose.current,
          safeDt,
          formationSpacing
        );
        const sweptFormationStep = resolveSweptObstacleStep(
          { x: previousX, y: previousY },
          formationStep,
          movementWalls,
          (agent.radius || AGENT_RADIUS) + 0.5
        );
        const formationStepLegal = !sweptFormationStep.collided && isTrainingMovementSegmentTraversable({
          sim,
          start: { x: previousX, y: previousY },
          target: sweptFormationStep,
          walls: movementWalls,
          radius: (agent.radius || AGENT_RADIUS) + 0.5
        });
        if (formationStepLegal) {
          agent.x = formationStep.x;
          agent.y = formationStep.y;
          agent.vx = (agent.x - previousX) / Math.max(1e-4, safeDt);
          agent.vy = (agent.y - previousY) / Math.max(1e-4, safeDt);
          if (squadKind === TRAINING_SQUAD_KIND.NEUTRAL) {
            updateAgentYawFromVelocity(agent, agent.vx, agent.vy, safeDt);
          } else {
            agent.yaw = formationPose.current.yaw;
          }
          agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
          agent.state = Math.abs(agent.vx) + Math.abs(agent.vy) > 0.08 ? 'move' : 'idle';
          return;
        }
        agent._nextFormationStepIllegal = true;
        agent._formationLocked = false;
      }
      const wasFormationHold = agent._formationHold
        && agent._formationHoldSpacing === formationSpacing;
      agent._formationLocked = false;
      agent._formationHold = false;
      agent._formationHoldSpacing = '';
      const stationaryHold = !castOffset.active
        && !leaderMoving
        && (squad.behavior === 'idle' || squad.behavior === 'move' || squad.behavior === 'standby');
      const leaderSettling = !leaderMoving || (Math.hypot(Number(squad.vx) || 0, Number(squad.vy) || 0) <= AGENT_SETTLE_SPEED);
      const shouldKeepFormationHold = wasFormationHold
        && toDesired.len <= AGENT_IDLE_RELEASE_RADIUS;
      const shouldHoldFormation = !combatDirective && !hasAnchor && !passageFlow && stationaryHold && (
        toDesired.len <= AGENT_IDLE_DEADZONE || shouldKeepFormationHold
      );

      if (shouldHoldFormation) {
        agent._formationLocked = true;
        agent._formationHold = true;
        agent._formationHoldSpacing = formationSpacing;
        clearAvoidanceMemory(agent);
        agent.vx = 0;
        agent.vy = 0;
        agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
        agent.state = agent.attackCd > 0 ? 'attack' : 'idle';
        return;
      }
      agent._formationHold = false;
      agent._formationHoldSpacing = '';

      const genericSep = computeTeamAwareSeparation(agent, neighbors, separationDistance, {
        allowOwnSquadSoftSeparation: !!combatDirective || hasAnchor || !!passageFlow
      });
      const sep = passageFlow && isTrainingCardSquad(squad)
        ? computeStreamSeparation({
          agent,
          neighbors,
          flowIntent: passageFlow,
          targetGap: Math.max(AGENT_RADIUS * 2.1, Number(flowIntent?.streamSpacing) || separationDistance)
        })
        : genericSep;
      const sepScale = combatDirective
        ? 1
        : stationaryHold
        ? (agent.isFlagBearer ? STATIONARY_FLAG_SEPARATION_SCALE : STATIONARY_SEPARATION_SCALE)
        : 1;
      const arrivalDeadzone = stationaryHold ? AGENT_IDLE_DEADZONE : AGENT_SETTLE_DEADZONE;
      const slotArrivalRate = smoothstep01(clamp(
        (toDesired.len - arrivalDeadzone) / Math.max(0.2, AGENT_SLOT_ARRIVAL_RADIUS - arrivalDeadzone),
        0,
        1
      ));
      const settleBlend = clamp(
        (toDesired.len - AGENT_SETTLE_DEADZONE)
          / Math.max(0.2, AGENT_SETTLE_RADIUS - AGENT_SETTLE_DEADZONE),
        0,
        1
      );
      const combatSteering = resolveAgentCombatSteering(agent, combatDirective);
      const lockCombatPosition = !passageFlow && (combatSteering?.lockPosition === true || (
        combatDirective?.formationBound === true
        && !leaderMoving
        && toDesired.len <= AGENT_SETTLE_RADIUS
      ));
      const recoveryDirection = formationRecoveryGuidance?.active
        ? normalizeVec(
          (Number(formationRecoveryGuidance?.x) || 0) - (Number(agent?.x) || 0),
          (Number(formationRecoveryGuidance?.y) || 0) - (Number(agent?.y) || 0)
        )
        : null;
      const flowDirection = passageFlow
        ? normalizeVec(
          passageFlow.forwardX + passageFlow.laneX,
          passageFlow.forwardY + passageFlow.laneY
        )
        : null;
      const steeringDirection = combatSteering?.moving
        ? combatSteering
        : (recoveryDirection || flowDirection || toDesired);
      const avoid = computeAvoidanceDirection(agent, steeringDirection, movementWalls, AGENT_AVOID_PROBE, agent, nowSec);
      const slotW = Math.max(0, Number(steeringWeights?.slot) || DEFAULT_STEERING_WEIGHTS.slot);
      const sepW = Math.max(0, Number(steeringWeights?.separation) || DEFAULT_STEERING_WEIGHTS.separation);
      const avoidW = Math.max(0, Number(steeringWeights?.avoidance) || DEFAULT_STEERING_WEIGHTS.avoidance);
      const anchorW = Math.max(0, Number(steeringWeights?.anchor) || DEFAULT_STEERING_WEIGHTS.anchor);
      const pressureW = Math.max(0, Number(steeringWeights?.pressure) || DEFAULT_STEERING_WEIGHTS.pressure);
      const sepGainLocal = sepGain * settleBlend;
      const avoidGainLocal = avoidGain * settleBlend;
      const slotSpeed = speed * slotGain * slotArrivalRate;
      const directFormationVelocity = passageFlow
        ? { vx: 0, vy: 0 }
        : resolveDirectFormationVelocity({
          agent,
          targetX: desiredX,
          targetY: desiredY,
          maxRelativeSpeed: speed * slotGain * 1.15,
          deadzone: leaderSettling ? AGENT_SETTLE_DEADZONE : 0,
          dt: safeDt
        });
      let desiredVx;
      let desiredVy;
      if (!passageFlow && combatDirective && combatSteering) {
        const combatSpeed = speed * (combatDirective.kind.startsWith('support') ? 0.94 : 1.04);
        const targetSteer = combatDirective.formationBound
          ? 0
          : 1 - (combatTetherPressure * 0.62);
        const formationRecoveryScale = combatDirective.formationBound
          ? 1
          : combatSteering.holding
            ? (combatTetherPressure > 0
              ? AGENT_COMBAT_HOLD_FORMATION_STEER * (0.42 + (combatTetherPressure * 0.58))
              : 0)
            : AGENT_COMBAT_FORMATION_STEER + (combatTetherPressure * 0.28);
        const formationSteer = combatDirective.formationBound
          ? 1.08
          : (combatSteering.holding
            ? 0
            : 0.18 + (combatTetherPressure * 0.34));
        const separationSteer = combatSteering.holding ? 0.3 : AGENT_COMBAT_SEPARATION_STEER;
        const avoidanceSteer = combatSteering.moving && !combatDirective.formationBound ? 0.46 : 0;
        desiredVx = (combatSteering.x * combatSpeed * targetSteer)
          + (directFormationVelocity.vx * formationRecoveryScale)
          + (toDesired.x * slotSpeed * slotW * formationSteer)
          + (sep.x * 40 * separationSteer * sepW)
          + (avoid.x * combatSpeed * avoidanceSteer * avoidW);
        desiredVy = (combatSteering.y * combatSpeed * targetSteer)
          + (directFormationVelocity.vy * formationRecoveryScale)
          + (toDesired.y * slotSpeed * slotW * formationSteer)
          + (sep.y * 40 * separationSteer * sepW)
          + (avoid.y * combatSpeed * avoidanceSteer * avoidW);
        if (lockCombatPosition) {
          desiredVx = 0;
          desiredVy = 0;
        }
      } else if (!passageFlow && formationRecoveryGuidance?.active && recoveryDirection) {
        const recoverySpeed = speed * Math.max(1, Number(formationRecoveryGuidance?.speedMul) || 1);
        const recoveryStepSpeed = Math.min(recoverySpeed, recoveryDirection.len / Math.max(0.001, safeDt));
        desiredVx = (recoveryDirection.x * recoveryStepSpeed)
          + (sep.x * 40 * sepScale * sepGainLocal * sepW)
          + (avoid.x * recoverySpeed * avoidGainLocal * 0.42 * avoidW);
        desiredVy = (recoveryDirection.y * recoveryStepSpeed)
          + (sep.y * 40 * sepScale * sepGainLocal * sepW)
          + (avoid.y * recoverySpeed * avoidGainLocal * 0.42 * avoidW);
      } else if (passageFlow) {
        // A passage member advances along the shared route, uses only weak
        // lane centering, then lets local separation/avoidance settle the
        // queue.  It does not chase a changing two-dimensional formation slot.
        const queueSpeed = Number.isFinite(Number(passageFlow.targetSpeed))
          ? Math.max(0, Number(passageFlow.targetSpeed))
          : speed * (1 - (passageFlow.queuePressure * 0.4));
        const laneVelocityX = Number.isFinite(Number(passageFlow.laneVelocityX))
          ? Number(passageFlow.laneVelocityX)
          : passageFlow.laneX * speed;
        const laneVelocityY = Number.isFinite(Number(passageFlow.laneVelocityY))
          ? Number(passageFlow.laneVelocityY)
          : passageFlow.laneY * speed;
        const streamState = String(passageFlow.state || flowIntent?.state || CARD_LOCOMOTION_STATE.STREAM);
        const weakSeparation = streamState === CARD_LOCOMOTION_STATE.STREAM
          ? 0.18
          : 0.34;
        const passageTangent = normalizeVec(passageFlow.forwardX, passageFlow.forwardY);
        const passageSide = { x: -passageTangent.y, y: passageTangent.x };
        const avoidanceForward = (avoid.x * passageTangent.x) + (avoid.y * passageTangent.y);
        let avoidanceLateral = (avoid.x * passageSide.x) + (avoid.y * passageSide.y);
        const laneError = Number(passageFlow.laneError) || 0;
        // The shared route already establishes a legal corridor.  Generic
        // obstacle avoidance must not pull a stream away from its lane into
        // the wall on the opposite side; retain only a small correction that
        // agrees with the lane merge direction.
        if (Math.abs(laneError) > 0.2 && (avoidanceLateral * laneError) < 0) {
          avoidanceLateral = 0;
        }
        const passageAvoidance = {
          x: (passageTangent.x * clamp(avoidanceForward, -0.22, 0.22))
            + (passageSide.x * clamp(avoidanceLateral, -0.28, 0.28)),
          y: (passageTangent.y * clamp(avoidanceForward, -0.22, 0.22))
            + (passageSide.y * clamp(avoidanceLateral, -0.28, 0.28))
        };
        const passageLaneSpacing = Math.max(
          AGENT_RADIUS * 2.04,
          Number(flowIntent?.streamSpacing) || spacing
        );
        const mergeForwardScale = streamState === CARD_LOCOMOTION_STATE.STREAM_APPROACH
          ? clamp(
            1 - (Math.abs(laneError) / Math.max(1, passageLaneSpacing * 0.9)),
            0.14,
            1
          )
          : 1;
        const passageForwardSpeed = queueSpeed * mergeForwardScale;
        desiredVx = (passageFlow.forwardX * passageForwardSpeed)
          + laneVelocityX
          + (sep.x * 20 * weakSeparation * sepW)
          + (passageAvoidance.x * speed * 0.58 * avoidW);
        desiredVy = (passageFlow.forwardY * passageForwardSpeed)
          + laneVelocityY
          + (sep.y * 20 * weakSeparation * sepW)
          + (passageAvoidance.y * speed * 0.58 * avoidW);
      } else {
        // Once an obstacle has claimed a side, formation is a weak visual
        // tether until that obstacle is passed.  This prevents slot attraction
        // from pulling the agent straight back across the wall each frame.
        const avoidanceFormationWeight = Math.hypot(avoid.x, avoid.y) > 0.0001 ? 0.22 : 1;
        desiredVx = (directFormationVelocity.vx * avoidanceFormationWeight)
          + (sep.x * 40 * sepScale * sepGainLocal * sepW)
          + (avoid.x * speed * avoidGainLocal * 0.9 * avoidW);
        desiredVy = (directFormationVelocity.vy * avoidanceFormationWeight)
          + (sep.y * 40 * sepScale * sepGainLocal * sepW)
          + (avoid.y * speed * avoidGainLocal * 0.9 * avoidW);
      }
      if (hasAnchor && !combatDirective && !passageFlow) {
        const anchorDir = normalizeVec((Number(agent.engageAx) || 0) - (agent.x || 0), (Number(agent.engageAy) || 0) - (agent.y || 0));
        const steerGain = clamp((Number(engagementCfg?.anchorSteerGain) || 0.72) * anchorW, 0.08, 2.4);
        const steerCap = speed * clamp(Number(engagementCfg?.anchorSteerCapMul) || 0.58, 0.1, 1.4);
        let steerVx = anchorDir.x * speed * steerGain;
        let steerVy = anchorDir.y * speed * steerGain;
        const steerLen = Math.hypot(steerVx, steerVy);
        if (steerLen > steerCap && steerLen > 0.0001) {
          steerVx = (steerVx / steerLen) * steerCap;
          steerVy = (steerVy / steerLen) * steerCap;
        }
        desiredVx += steerVx;
        desiredVy += steerVy;
        const pressure = Math.max(0, Number(agent.engagePressure) || 0);
        if (pressure > 0.0001) {
          desiredVx += (Number(agent.engageFrontDx) || 0) * pressure * pressureW;
          desiredVy += (Number(agent.engageFrontDy) || 0) * pressure * pressureW;
        }
      }
      if (
        !combatDirective
        && !hasAnchor
        && stationaryHold
        && !passageFlow
        && toDesired.len <= AGENT_IDLE_DEADZONE
      ) {
        clearAvoidanceMemory(agent);
        desiredVx = 0;
        desiredVy = 0;
      }
      const usesDirectFormationMotion = !isTrainingCardSquad(squad)
        && !combatDirective
        && !hasAnchor
        && !passageFlow
        && !formationRecoveryGuidance?.active;
      const accelStep = usesDirectFormationMotion
        ? null
        : clampVecLength(
            desiredVx - (Number(agent.vx) || 0),
            desiredVy - (Number(agent.vy) || 0),
            accelCap * safeDt
          );
      let vx = usesDirectFormationMotion
        ? desiredVx
        : (Number(agent.vx) || 0) + accelStep.x;
      let vy = usesDirectFormationMotion
        ? desiredVy
        : (Number(agent.vy) || 0) + accelStep.y;
      if (lockCombatPosition && !passageFlow) {
        vx = 0;
        vy = 0;
      }
      const vLen = Math.hypot(vx, vy);
      const maxV = speed * (formationRecoveryGuidance?.active
        ? Math.max(1.15, (Number(formationRecoveryGuidance?.speedMul) || 1) + 0.04)
        : 1.15);
      if (vLen > maxV) {
        vx = (vx / vLen) * maxV;
        vy = (vy / vLen) * maxV;
      }
      let nx = (Number(agent.x) || 0) + (vx * safeDt);
      let ny = (Number(agent.y) || 0) + (vy * safeDt);
      let pushNx = 0;
      let pushNy = 0;
      const attemptedX = nx;
      const attemptedY = ny;
      const sweptStep = resolveSweptObstacleStep(
        { x: Number(agent.x) || 0, y: Number(agent.y) || 0 },
        { x: nx, y: ny },
        movementWalls,
        (agent.radius || AGENT_RADIUS) + 0.5
      );
      nx = sweptStep.x;
      ny = sweptStep.y;
      if (sweptStep.collided) {
        const correction = normalizeVec(nx - attemptedX, ny - attemptedY);
        if (correction.len > 1e-4) {
          pushNx += correction.x;
          pushNy += correction.y;
        }
      }
      const collisionWalls = queryObstacleCandidates(
        movementWalls,
        nx,
        ny,
        (agent.radius || AGENT_RADIUS) + 0.5,
        nearbyWalls
      );
      collisionWalls.forEach((wall) => {
        if (!wall || wall.destroyed) return;
        const beforeX = nx;
        const beforeY = ny;
        const pushed = pushOutOfRect({ x: nx, y: ny }, wall, (agent.radius || AGENT_RADIUS) + 0.5);
        nx = pushed.x;
        ny = pushed.y;
        if (pushed?.pushed) {
          const corr = normalizeVec(nx - beforeX, ny - beforeY);
          if (corr.len > 1e-4) {
            pushNx += corr.x;
            pushNy += corr.y;
          }
        }
      });
      const halfW = (Number(sim?.field?.width) || 2700) / 2;
      const halfH = (Number(sim?.field?.height) || 1488) / 2;
      nx = clamp(nx, -halfW + 2, halfW - 2);
      ny = clamp(ny, -halfH + 2, halfH - 2);
      const terrainStep = resolveTrainingLegalMovementStep({
        sim,
        start: { x: Number(agent.x) || 0, y: Number(agent.y) || 0 },
        target: { x: nx, y: ny },
        walls: movementWalls,
        radius: (agent.radius || AGENT_RADIUS) + 0.5
      });
      const terrainBlocked = !terrainStep.legal;
      nx = terrainStep.x;
      ny = terrainStep.y;
      if (terrainBlocked) agent._terrainBlockedAt = nowSec;
      agent._nextFormationStepIllegal = terrainBlocked;
      const pushN = normalizeVec(pushNx, pushNy);
      if (pushN.len > 1e-4) {
        const vn = (vx * pushN.x) + (vy * pushN.y);
        if (vn > 0) {
          const keep = vn * 0.2;
          const remove = vn - keep;
          vx -= pushN.x * remove;
          vy -= pushN.y * remove;
        }
      }

      const shouldLockFormation = (
        !combatDirective
        && !hasAnchor
        && !passageFlow
        && !formationRecoveryGuidance?.active
        && !agent._formationDetached
        && !slotBlocked
        && !hasForeignNeighbor
        && !sweptStep.collided
        && !terrainBlocked
        && Math.hypot(desiredX - nx, desiredY - ny) <= AGENT_SETTLE_DEADZONE
        && Math.hypot(vx - targetSlotVx, vy - targetSlotVy) <= AGENT_FORMATION_LOCK_RELATIVE_SPEED
      );
      if (shouldLockFormation) {
        vx = targetSlotVx;
        vy = targetSlotVy;
      }
      agent.vx = vx;
      agent.vy = vy;
      agent.x = nx;
      agent.y = ny;
      if (shouldLockFormation) {
        agent._formationLocked = true;
        agent._formationHold = true;
        agent._formationHoldSpacing = formationSpacing;
      }
      agent.hitTimer = Math.max(0, (Number(agent.hitTimer) || 0) - safeDt);
      if (Math.abs(vx) + Math.abs(vy) > 0.08) {
        if (squadKind === TRAINING_SQUAD_KIND.NEUTRAL) {
          updateAgentYawFromVelocity(agent, vx, vy, safeDt);
        } else if (
          squadKind === TRAINING_SQUAD_KIND.CARD
          && !combatDirective
          && !hasAnchor
          && !passageFlow
          && !formationRecoveryGuidance?.active
          && !agent._formationDetached
          && !castOffset.active
        ) {
          agent.yaw = formationPose.current.yaw;
        } else {
          agent.yaw = Math.atan2(vy, vx);
        }
        agent.state = combatSteering?.holding || agent.attackCd > 0 ? 'attack' : 'move';
      } else {
        agent.state = combatSteering?.holding || agent.attackCd > 0 ? 'attack' : 'idle';
      }
      });
    }

    constrainMinionAgentsToTrainingRoadCorridor(squad, sim, sorted, movementWalls);
    refreshMeleeAttackOrder(squad, sorted, nowSec);

    if (squad.skillRush) {
      applyCavalryRushImpact(sim, crowd, squad, sorted, rushFromPoint, {
        x: Number(squad.x) || 0,
        y: Number(squad.y) || 0
      });
    }

    trimOrGrowAgents(squad, agents, crowd, safeDt);
    const liveSquadAgents = crowd.agentsBySquad.get(squad.id) || [];
    aggregateSquadFromAgents(squad, liveSquadAgents);
    restoreMinionSquadHoldAnchor(squad);
    completeTrainingCardSquadAiFrame({
      squad,
      agents: liveSquadAgents,
      nowSec,
      forward: squad._crowdForward || forward
    });
    updateSquadFormationChangeCompletion({
      squad,
      agents: liveSquadAgents,
      passage: activePassage,
      nowSec
    });
    updateSquadFormationArrival({
      squad,
      agents: liveSquadAgents,
      passage: activePassage,
      nowSec
    });
    if (isTrainingCardSquad(squad)) {
      updateTrainingNavigationRecovery({
        squad,
        sim,
        walls,
        target: navigationTarget,
        start: navigationStart,
        nowSec,
        dt: safeDt
      });
    }
    if (isTrainingCardAiSquad(squad)) {
      syncTrainingMapAiState({
        squad,
        sim,
        nowSec,
        selection: squad._trainingAiSelection,
        reason: (Number(squad?._trainingTargetNavigation?.blockedUntil) || 0) > nowSec
          ? 'target-path-deferred'
          : ''
      });
    } else {
      clearTrainingCardAiState(squad, liveSquadAgents);
    }
  });

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents) => crowd.allAgents.push(...agents.filter((agent) => !agent.dead)));
  crowd.spatial = buildSpatialHash(crowd.allAgents, 14);
  updateCrowdCombat(sim, crowd, safeDt);
  updateTrainingObjectives(sim, crowd, safeDt);
  stepEffectPool(crowd.effectsPool, safeDt);
  sim.projectiles = crowd.effectsPool.projectileLive;
  sim.hitEffects = crowd.effectsPool.hitLive;
  sim.damageNumbers = crowd.effectsPool.damageNumberLive;
};
