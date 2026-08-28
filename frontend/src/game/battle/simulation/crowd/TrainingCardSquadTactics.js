/**
 * Card-squad formation, cohesion, terrain and agent-tactics implementation.
 * Runtime callers should enter through TrainingCardSquadAi.
 */
import {
  clamp,
  estimateLocalFlowWidth,
  normalizeVec,
  querySpatialNearby,
  raycastObstacles
} from './crowdPhysics';
import { isRangedAgent, resolveAgentAttackRange } from './attackRange';
import {
  ORDER_ATTACK_MOVE,
  ORDER_CHARGE,
  ORDER_MOVE,
  isSquadCombatEnabled
} from './combatPolicy';
import { isTrainingCardSquad } from './TrainingSquadKind';

export const SQUAD_FORMATION_RUNTIME_STATE = Object.freeze({
  ASSEMBLE: 'ASSEMBLE',
  MARCH: 'MARCH',
  COMPRESS: 'COMPRESS',
  PASSAGE: 'PASSAGE',
  EXPAND: 'EXPAND',
  COMBAT_DEPLOY: 'COMBAT_DEPLOY',
  REFORM: 'REFORM',
  HOLD: 'HOLD'
});

export const SQUAD_COMBAT_RUNTIME_STATE = Object.freeze({
  NONE: 'NONE',
  APPROACH: 'APPROACH',
  DEPLOY: 'DEPLOY',
  ENGAGED: 'ENGAGED',
  DISENGAGE: 'DISENGAGE'
});

export const SQUAD_COMBAT_INTENT = Object.freeze({
  HOLD_FORMATION: 'HOLD_FORMATION',
  FREE_ATTACK: 'FREE_ATTACK',
  FOCUS_FIRE: 'FOCUS_FIRE',
  ADVANCE_ATTACK: 'ADVANCE_ATTACK'
});

const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const FORMATION_SCAN_INTERVAL = 0.22;
const PASSAGE_MIN_DURATION = 0.72;
const EXPAND_MIN_DURATION = 0.42;
const REFORM_STABLE_DURATION = 0.42;
const MAX_CATCH_UP_MULTIPLIER = 1.34;
const SUPPORT_MIN_HEALTH_DEFICIT = 0.035;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const isLiveAgent = (agent = null) => (
  !!agent && !agent.dead && finiteNumber(agent?.weight) > 0.001
);

const sortAgents = (agents = []) => (
  (Array.isArray(agents) ? agents : [])
    .filter(isLiveAgent)
    .slice()
    .sort((left, right) => (
      finiteNumber(left?.slotOrder) - finiteNumber(right?.slotOrder)
      || String(left?.id || '').localeCompare(String(right?.id || ''))
    ))
);

const normalizeSlot = (slot = {}, fallback = {}) => ({
  side: Number.isFinite(Number(slot?.side)) ? Number(slot.side) : finiteNumber(fallback?.side),
  front: Number.isFinite(Number(slot?.front)) ? Number(slot.front) : finiteNumber(fallback?.front)
});

const resolveBaseSpacing = (squad = {}) => Math.max(
  AGENT_RADIUS * 2,
  finiteNumber(squad?.formationRect?.spacing, (AGENT_RADIUS * 2) + AGENT_GAP)
);

const resolveFormationColumns = (squad = {}, count = 1, spacing = resolveBaseSpacing(squad)) => {
  const width = finiteNumber(squad?.formationRect?.width);
  const hinted = width > 0 ? Math.round(width / Math.max(0.1, spacing)) : 0;
  return clamp(Math.max(1, hinted || Math.ceil(Math.sqrt(Math.max(1, count)))), 1, Math.max(1, count));
};

const fallbackSlotForIndex = (index = 0, columns = 1, spacing = (AGENT_RADIUS * 2) + AGENT_GAP) => {
  const safeColumns = Math.max(1, Math.floor(finiteNumber(columns, 1)));
  const row = Math.floor(Math.max(0, Math.floor(finiteNumber(index))) / safeColumns);
  const column = Math.max(0, Math.floor(finiteNumber(index))) % safeColumns;
  return {
    side: (column - ((safeColumns - 1) * 0.5)) * spacing,
    front: -row * spacing * 0.92
  };
};

const formationSignature = (squad = {}) => {
  const rect = squad?.formationRect && typeof squad.formationRect === 'object' ? squad.formationRect : {};
  const slots = Array.isArray(squad?.deploySlots) ? squad.deploySlots : [];
  return [
    String(squad?.activeFormationId || rect?.formationId || ''),
    finiteNumber(rect?.width),
    finiteNumber(rect?.depth),
    finiteNumber(rect?.spacing),
    slots.map((slot) => (
      finiteNumber(slot?.side).toFixed(3) + ':' + finiteNumber(slot?.front).toFixed(3)
    )).join(',')
  ].join('|');
};

const resolveRequestedFormationId = (squad = {}) => String(
  squad?.activeFormationId || squad?.formationRect?.formationId || 'default'
);

const localToWorld = (anchor = {}, slot = {}) => {
  const yaw = finiteNumber(anchor?.heading, finiteNumber(anchor?.yaw));
  const forward = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const side = { x: -forward.y, y: forward.x };
  const local = normalizeSlot(slot);
  return {
    x: finiteNumber(anchor?.x) + (side.x * local.side) + (forward.x * local.front),
    y: finiteNumber(anchor?.y) + (side.y * local.side) + (forward.y * local.front)
  };
};

const worldToLocal = (anchor = {}, point = {}) => {
  const yaw = finiteNumber(anchor?.heading, finiteNumber(anchor?.yaw));
  const forward = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const side = { x: -forward.y, y: forward.x };
  const dx = finiteNumber(point?.x) - finiteNumber(anchor?.x);
  const dy = finiteNumber(point?.y) - finiteNumber(anchor?.y);
  return {
    side: (dx * side.x) + (dy * side.y),
    front: (dx * forward.x) + (dy * forward.y)
  };
};

const updateAnchor = (runtime = {}, squad = {}, forward = null) => {
  const fallbackForward = normalizeVec(
    finiteNumber(squad?.dirX, 1),
    finiteNumber(squad?.dirY)
  );
  const resolvedForward = normalizeVec(
    finiteNumber(forward?.x, fallbackForward.x),
    finiteNumber(forward?.y, fallbackForward.y)
  );
  const heading = Number.isFinite(Number(squad?._formationPoseYaw))
    ? Number(squad._formationPoseYaw)
    : Math.atan2(
      resolvedForward.len > 0.0001 ? resolvedForward.y : fallbackForward.y,
      resolvedForward.len > 0.0001 ? resolvedForward.x : fallbackForward.x
    );
  runtime.anchor = {
    x: finiteNumber(squad?.x),
    y: finiteNumber(squad?.y),
    vx: finiteNumber(squad?.vx),
    vy: finiteNumber(squad?.vy),
    heading,
    forwardX: Math.cos(heading),
    forwardY: Math.sin(heading)
  };
  return runtime.anchor;
};

const resolveAgentRole = (agent = {}) => {
  if (agent?.unitCategory === 'support') return 'SUPPORT';
  if (isRangedAgent(agent)) return 'RANGED';
  if (agent?.typeCategory === 'cavalry') return 'CAVALRY';
  return 'MELEE';
};

const applySlotMetadata = (agent = {}, slot = {}, index = 0, columns = 1, spacing = 1) => {
  const normalized = normalizeSlot(slot);
  const state = agent?._squadController && typeof agent._squadController === 'object'
    ? agent._squadController
    : {};
  agent._squadController = {
    ...state,
    slotKey: String(index),
    rank: index,
    role: resolveAgentRole(agent),
    row: Math.max(0, Math.round(Math.max(0, -normalized.front) / Math.max(0.1, spacing * 0.92))),
    column: Math.max(0, Math.min(Math.max(0, columns - 1), Math.round(
      (normalized.side / Math.max(0.1, spacing)) + ((columns - 1) * 0.5)
    )))
  };
  agent.formationSlot = normalized;
};

const assignPersistentSlots = (squad = {}, agents = [], { compact = false } = {}) => {
  const ordered = sortAgents(agents);
  const spacing = resolveBaseSpacing(squad);
  const columns = resolveFormationColumns(squad, ordered.length, spacing);
  const template = Array.isArray(squad?.deploySlots)
    ? squad.deploySlots.map((slot) => normalizeSlot(slot))
    : [];
  ordered.forEach((agent, index) => {
    const slot = compact
      ? fallbackSlotForIndex(index, columns, spacing)
      : (template[index] || normalizeSlot(agent?.formationSlot, fallbackSlotForIndex(index, columns, spacing)));
    applySlotMetadata(agent, slot, index, columns, spacing);
    // The controller owns card-unit slots.  Drop the legacy spacing cache when
    // a member is repacked so a later formation switch cannot revive stale rows.
    agent.formationSpacingSlots = null;
  });
  squad._crowdBaseColumns = columns;
  return { ordered, columns, spacing };
};

const resolveMembershipSignature = (agents = []) => (
  sortAgents(agents).map((agent) => String(agent?.id || '')).join('|')
);

const resolveRequiredWidth = (agents = [], spacing = 1) => {
  const slots = sortAgents(agents).map((agent) => normalizeSlot(agent?.formationSlot));
  if (slots.length <= 1) return Math.max(spacing, AGENT_RADIUS * 2);
  const sideExtent = slots.reduce((maximum, slot) => Math.max(maximum, Math.abs(slot.side)), 0);
  return Math.max(spacing, (sideExtent * 2) + spacing);
};

const resolveRearExtent = (agents = [], spacing = 1) => (
  Math.max(
    spacing,
    sortAgents(agents).reduce((maximum, agent) => (
      Math.max(maximum, Math.max(0, -normalizeSlot(agent?.formationSlot).front))
    ), 0) + spacing
  )
);

const distanceToFieldBoundary = (point = {}, direction = {}, field = {}, margin = 0) => {
  const halfWidth = Math.max(1, finiteNumber(field?.width, 2700) * 0.5) - margin;
  const halfHeight = Math.max(1, finiteNumber(field?.height, 1488) * 0.5) - margin;
  const dx = finiteNumber(direction?.x);
  const dy = finiteNumber(direction?.y);
  const distances = [];
  if (dx > 0.0001) distances.push((halfWidth - finiteNumber(point?.x)) / dx);
  if (dx < -0.0001) distances.push((-halfWidth - finiteNumber(point?.x)) / dx);
  if (dy > 0.0001) distances.push((halfHeight - finiteNumber(point?.y)) / dy);
  if (dy < -0.0001) distances.push((-halfHeight - finiteNumber(point?.y)) / dy);
  const usable = distances.filter((value) => Number.isFinite(value) && value >= 0);
  return usable.length > 0 ? Math.min(...usable) : Infinity;
};

const resolveBoundaryNormal = (point = {}, field = {}, margin = 0) => {
  const halfWidth = Math.max(1, finiteNumber(field?.width, 2700) * 0.5) - margin;
  const halfHeight = Math.max(1, finiteNumber(field?.height, 1488) * 0.5) - margin;
  const distances = [
    { distance: finiteNumber(point?.x) + halfWidth, x: 1, y: 0 },
    { distance: halfWidth - finiteNumber(point?.x), x: -1, y: 0 },
    { distance: finiteNumber(point?.y) + halfHeight, x: 0, y: 1 },
    { distance: halfHeight - finiteNumber(point?.y), x: 0, y: -1 }
  ].sort((left, right) => left.distance - right.distance);
  return distances[0] || { distance: Infinity, x: 0, y: 0 };
};

const resolveWallNormal = (hit = null, forward = {}) => {
  if (!hit?.obstacle) return { x: 0, y: 0 };
  const away = normalizeVec(
    finiteNumber(hit?.x) - finiteNumber(hit?.obstacle?.x),
    finiteNumber(hit?.y) - finiteNumber(hit?.obstacle?.y)
  );
  if (away.len > 0.0001) return { x: away.x, y: away.y };
  return { x: -finiteNumber(forward?.x), y: -finiteNumber(forward?.y) };
};

const resolveTerrainSample = ({
  squad = {},
  agents = [],
  sim = {},
  walls = [],
  forward = {},
  nowSec = 0,
  runtime = null
} = {}) => {
  const terrain = runtime?.terrain || {};
  const direction = normalizeVec(
    finiteNumber(forward?.x, finiteNumber(squad?.dirX, 1)),
    finiteNumber(forward?.y, finiteNumber(squad?.dirY))
  );
  const safeDirection = direction.len > 0.0001 ? direction : { x: 1, y: 0 };
  const side = { x: -safeDirection.y, y: safeDirection.x };
  const spacing = resolveBaseSpacing(squad);
  const requiredWidth = resolveRequiredWidth(agents, spacing);
  const requestedColumns = resolveFormationColumns(squad, sortAgents(agents).length, spacing);
  const radius = Math.max(AGENT_RADIUS, finiteNumber(squad?.navigationAgentRadius, AGENT_RADIUS));
  const probeDistance = clamp(Math.max(44, requiredWidth * 1.1), 44, 108);
  const lateralProbe = clamp(Math.max(requiredWidth, spacing * 4), 28, 104);
  const margin = radius + 2;
  const anchor = { x: finiteNumber(squad?.x), y: finiteNumber(squad?.y) };
  const sampleOffsets = [0, probeDistance * 0.42, probeDistance * 0.82];
  let leftSpace = Infinity;
  let rightSpace = Infinity;
  let frontClearance = Infinity;
  let wallHit = null;

  sampleOffsets.forEach((offset) => {
    const point = {
      x: anchor.x + (safeDirection.x * offset),
      y: anchor.y + (safeDirection.y * offset)
    };
    const leftHit = raycastObstacles(point, {
      x: point.x + (side.x * lateralProbe),
      y: point.y + (side.y * lateralProbe)
    }, walls, margin);
    const rightHit = raycastObstacles(point, {
      x: point.x - (side.x * lateralProbe),
      y: point.y - (side.y * lateralProbe)
    }, walls, margin);
    const forwardHit = raycastObstacles(point, {
      x: point.x + (safeDirection.x * probeDistance),
      y: point.y + (safeDirection.y * probeDistance)
    }, walls, margin);
    const leftBoundary = distanceToFieldBoundary(point, side, sim?.field, margin);
    const rightBoundary = distanceToFieldBoundary(point, { x: -side.x, y: -side.y }, sim?.field, margin);
    const forwardBoundary = distanceToFieldBoundary(point, safeDirection, sim?.field, margin);
    leftSpace = Math.min(leftSpace, leftHit ? lateralProbe * clamp(finiteNumber(leftHit?.t), 0, 1) : lateralProbe, leftBoundary);
    rightSpace = Math.min(rightSpace, rightHit ? lateralProbe * clamp(finiteNumber(rightHit?.t), 0, 1) : lateralProbe, rightBoundary);
    const clearance = forwardHit
      ? probeDistance * clamp(finiteNumber(forwardHit?.t), 0, 1)
      : Math.min(probeDistance, forwardBoundary);
    if (clearance < frontClearance) {
      frontClearance = clearance;
      wallHit = forwardHit || wallHit;
    }
  });

  leftSpace = Number.isFinite(leftSpace) ? Math.max(0, leftSpace) : lateralProbe;
  rightSpace = Number.isFinite(rightSpace) ? Math.max(0, rightSpace) : lateralProbe;
  frontClearance = Number.isFinite(frontClearance) ? Math.max(0, frontClearance) : probeDistance;
  // The ray probes catch walls in front of the anchor; this local flow probe
  // fills the gap for an obstacle touching either flank.  Both helpers use the
  // existing obstacle spatial index, so this remains a squad-level cached cost.
  const localFlowWidth = estimateLocalFlowWidth(anchor, safeDirection, walls, {
    step: Math.max(2, spacing * 0.32),
    maxProbe: lateralProbe,
    inflate: margin
  });
  const corridorWidth = Math.max(
    AGENT_RADIUS * 2,
    Math.min(leftSpace + rightSpace, localFlowWidth)
  );
  const availableWidth = Math.max(AGENT_RADIUS * 2, corridorWidth - (spacing * 0.18));
  const compression = clamp(availableWidth / Math.max(spacing, requiredWidth), 0.56, 1);
  const minimumPassageSpacing = Math.max(AGENT_RADIUS * 2.06, spacing * 0.76);
  const passageColumns = clamp(
    Math.floor((availableWidth + (minimumPassageSpacing * 0.12)) / minimumPassageSpacing) + 1,
    1,
    requestedColumns
  );
  const passageNeeded = passageColumns < requestedColumns
    && (compression <= 0.7 || passageColumns <= Math.max(1, Math.floor(requestedColumns * 0.56)));
  const openEnough = corridorWidth >= requiredWidth * 0.9 && frontClearance >= spacing * 2.2;
  const previousState = String(terrain?.state || '');
  const wasPassage = previousState === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
  let state = SQUAD_FORMATION_RUNTIME_STATE.MARCH;
  let passageUntil = Math.max(0, finiteNumber(terrain?.passageUntil));
  let openSince = finiteNumber(terrain?.openSince);
  if (passageNeeded) {
    state = SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
    passageUntil = nowSec + PASSAGE_MIN_DURATION;
    openSince = 0;
  } else if (wasPassage && (nowSec < passageUntil || !openEnough)) {
    state = SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
    if (openEnough && openSince <= 0) openSince = nowSec;
    if (!openEnough) openSince = 0;
  } else if (wasPassage || previousState === SQUAD_FORMATION_RUNTIME_STATE.EXPAND) {
    state = SQUAD_FORMATION_RUNTIME_STATE.EXPAND;
    if (openSince <= 0) openSince = nowSec;
    if (nowSec - openSince >= EXPAND_MIN_DURATION && compression >= 0.98) {
      state = SQUAD_FORMATION_RUNTIME_STATE.MARCH;
      openSince = 0;
    }
  } else if (compression < 0.985) {
    state = SQUAD_FORMATION_RUNTIME_STATE.COMPRESS;
  }
  const boundary = resolveBoundaryNormal(anchor, sim?.field, margin);
  const wallNormal = resolveWallNormal(wallHit, safeDirection);
  return {
    state,
    sampledAt: nowSec,
    directionX: safeDirection.x,
    directionY: safeDirection.y,
    leftSpace,
    rightSpace,
    corridorWidth,
    requiredWidth,
    frontClearance,
    compression,
    longitudinalScale: clamp(1 + ((1 - compression) * 0.56), 1, 1.36),
    requestedColumns,
    columns: state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE ? passageColumns : requestedColumns,
    passageUntil,
    openSince,
    boundaryNormalX: boundary.x,
    boundaryNormalY: boundary.y,
    boundaryDistance: boundary.distance,
    wallNormalX: wallNormal.x,
    wallNormalY: wallNormal.y,
    wallDistance: frontClearance,
    nearBoundary: boundary.distance <= Math.max(spacing * 1.15, 14),
    nearWall: !!wallHit && frontClearance <= Math.max(spacing * 2.6, 18)
  };
};

const resolveFormationSlot = ({
  squad = {},
  runtime = null,
  agent = {},
  fallbackSlot = {},
  ignoreRejoin = false
} = {}) => {
  const terrain = runtime?.terrain || {};
  const state = agent?._squadController && typeof agent._squadController === 'object'
    ? agent._squadController
    : {};
  if (!ignoreRejoin && state?.rejoin?.active && state?.rejoin?.phase === 'GATE' && state.rejoin.gateSlot) {
    return normalizeSlot(state.rejoin.gateSlot, fallbackSlot);
  }
  const base = normalizeSlot(agent?.formationSlot, fallbackSlot);
  const spacing = resolveBaseSpacing(squad);
  if (terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE) {
    const columns = Math.max(1, Math.floor(finiteNumber(terrain?.columns, 1)));
    const rank = Math.max(0, Math.floor(finiteNumber(state?.rank, finiteNumber(agent?.slotOrder))));
    const column = rank % columns;
    const row = Math.floor(rank / columns);
    const passageSpacing = Math.max(AGENT_RADIUS * 2.04, spacing * 0.82);
    return {
      side: (column - ((columns - 1) * 0.5)) * passageSpacing,
      front: -row * passageSpacing * Math.max(0.98, finiteNumber(terrain?.longitudinalScale, 1))
    };
  }
  return {
    side: base.side * clamp(finiteNumber(terrain?.compression, 1), 0.56, 1),
    front: base.front * clamp(finiteNumber(terrain?.longitudinalScale, 1), 1, 1.36)
  };
};

const percentile = (values = [], ratio = 0.9) => {
  if (!Array.isArray(values) || values.length <= 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = clamp(Math.ceil(sorted.length * ratio) - 1, 0, sorted.length - 1);
  return sorted[index] || 0;
};

const resolveCombatIntent = (squad = {}) => {
  const order = String(squad?.order?.type || '');
  if (order === ORDER_ATTACK_MOVE && squad?.order?.stopAfterTarget === true) {
    return SQUAD_COMBAT_INTENT.FOCUS_FIRE;
  }
  if (order === ORDER_ATTACK_MOVE || order === ORDER_CHARGE) {
    return SQUAD_COMBAT_INTENT.ADVANCE_ATTACK;
  }
  if (order === ORDER_MOVE) return SQUAD_COMBAT_INTENT.HOLD_FORMATION;
  return squad?.controlMode === 'AI' || squad?.behavior === 'auto'
    ? SQUAD_COMBAT_INTENT.FREE_ATTACK
    : SQUAD_COMBAT_INTENT.HOLD_FORMATION;
};

const refreshRuntimeDebug = (squad = {}, runtime = null) => {
  if (!squad || !runtime) return;
  const cohesion = runtime?.cohesion || {};
  const terrain = runtime?.terrain || {};
  const combat = runtime?.combat || {};
  squad.formationRuntime = {
    state: String(runtime?.formation?.state || SQUAD_FORMATION_RUNTIME_STATE.HOLD),
    requestedFormation: String(runtime?.formation?.requestedId || ''),
    activeFormation: String(runtime?.formation?.activeId || ''),
    readyRatio: clamp(finiteNumber(cohesion?.readyRatio, 1), 0, 1),
    averageError: Math.max(0, finiteNumber(cohesion?.averageError)),
    rmsError: Math.max(0, finiteNumber(cohesion?.rmsError)),
    maxLag: Math.max(0, finiteNumber(cohesion?.maxLag)),
    speedScale: clamp(finiteNumber(cohesion?.speedScale, 1), 0, 1),
    compression: clamp(finiteNumber(terrain?.compression, 1), 0, 1),
    passage: terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE,
    corridorWidth: Number.isFinite(Number(terrain?.corridorWidth)) ? Number(terrain.corridorWidth) : null
  };
  squad.combatRuntime = {
    state: String(combat?.state || SQUAD_COMBAT_RUNTIME_STATE.NONE),
    intent: String(combat?.intent || SQUAD_COMBAT_INTENT.HOLD_FORMATION),
    targetId: String(combat?.targetSquadId || ''),
    assignedCount: Math.max(0, Math.floor(finiteNumber(combat?.assignedCount))),
    supportReservations: Math.max(0, Math.floor(finiteNumber(combat?.supportReservations)))
  };
};

const clearAgentControllerCombat = (agent = {}) => {
  if (!agent?._squadController) return;
  const controlledTargetId = String(agent?._squadController?.combatTargetId || '');
  if (controlledTargetId && String(agent?.targetAgentId || '') === controlledTargetId) {
    agent.targetAgentId = '';
  }
  delete agent._squadController.combatTargetId;
  delete agent._squadController.combatTargetUntil;
  delete agent._squadController.engagement;
  delete agent._squadController.supportTargetId;
  delete agent._squadController.supportTargetUntil;
};

export const ensureSquadControllerRuntime = ({
  squad = null,
  agents = [],
  nowSec = 0,
  forward = null
} = {}) => {
  if (!isTrainingCardSquad(squad)) return null;
  const signature = formationSignature(squad);
  let runtime = squad?._squadController && typeof squad._squadController === 'object'
    ? squad._squadController
    : null;
  if (!runtime) {
    runtime = {
      version: 1,
      createdAt: Math.max(0, finiteNumber(nowSec)),
      anchor: {},
      formation: {
        requestedId: resolveRequestedFormationId(squad),
        requestedSignature: signature,
        activeId: resolveRequestedFormationId(squad),
        state: SQUAD_FORMATION_RUNTIME_STATE.ASSEMBLE
      },
      terrain: {
        state: SQUAD_FORMATION_RUNTIME_STATE.MARCH,
        sampledAt: -Infinity,
        compression: 1,
        longitudinalScale: 1,
        columns: 1
      },
      cohesion: {
        readyRatio: 1,
        speedScale: 1,
        maximumError: 0,
        upperError: 0,
        averageError: 0,
        rmsError: 0,
        maxLag: 0,
        rejoiningCount: 0,
        waiting: false
      },
      combat: {
        state: SQUAD_COMBAT_RUNTIME_STATE.NONE,
        intent: SQUAD_COMBAT_INTENT.HOLD_FORMATION,
        targetSquadId: '',
        assignedCount: 0,
        supportReservations: 0,
        anchor: null,
        disengagedAt: 0
      },
      reform: {
        active: true,
        needsRepack: false,
        startedAt: Math.max(0, finiteNumber(nowSec)),
        stableSince: 0
      },
      membershipSignature: '',
      lastMoveAt: 0
    };
    squad._squadController = runtime;
  }
  updateAnchor(runtime, squad, forward);
  const membership = resolveMembershipSignature(agents);
  const formationChanged = runtime?.formation?.requestedSignature !== signature;
  if (formationChanged || !runtime.membershipSignature) {
    assignPersistentSlots(squad, agents);
    runtime.formation.requestedId = resolveRequestedFormationId(squad);
    runtime.formation.requestedSignature = signature;
    runtime.reform.active = true;
    runtime.reform.needsRepack = false;
    runtime.reform.startedAt = Math.max(0, finiteNumber(nowSec));
  } else if (membership !== runtime.membershipSignature) {
    const known = new Set(
      sortAgents(agents)
        .filter((agent) => agent?._squadController?.slotKey !== undefined)
        .map((agent) => String(agent.id || ''))
    );
    if (known.size < sortAgents(agents).length) assignPersistentSlots(squad, agents);
    runtime.reform.needsRepack = true;
  }
  runtime.membershipSignature = resolveMembershipSignature(agents);
  return runtime;
};

export const resetSquadControllerRuntime = (squad = null, agents = [], { preserveSlots = true } = {}) => {
  if (!squad || typeof squad !== 'object') return;
  delete squad._squadController;
  delete squad.formationRuntime;
  delete squad.combatRuntime;
  delete squad._formationCohesion;
  delete squad._formationCohesionSpeedScale;
  delete squad.formationCohesionState;
  delete squad.formationCohesionError;
  delete squad._narrowPassage;
  delete squad._formationArrival;
  delete squad.formationArrivalState;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent) return;
    delete agent._squadController;
    delete agent._formationRecovery;
    if (!preserveSlots) {
      agent.formationSlot = null;
      agent.formationSpacingSlots = null;
    }
  });
};

export const clearSquadControllerRuntime = resetSquadControllerRuntime;

const updateReformState = ({
  squad = {},
  runtime = null,
  agents = [],
  nowSec = 0
} = {}) => {
  if (!runtime) return;
  const combatState = runtime?.combat?.state;
  if (combatState === SQUAD_COMBAT_RUNTIME_STATE.ENGAGED
    || combatState === SQUAD_COMBAT_RUNTIME_STATE.DEPLOY
    || combatState === SQUAD_COMBAT_RUNTIME_STATE.APPROACH) {
    runtime.reform.active = false;
    runtime.reform.stableSince = 0;
    return;
  }
  // Repacking is deliberately allowed while marching slowly after combat.  The
  // slots remain persistent until a real membership/formation event, so this
  // does not create the every-frame swapping that makes a unit look unruly.
  if (runtime.reform.needsRepack) {
    assignPersistentSlots(squad, agents, { compact: true });
    runtime.reform.needsRepack = false;
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    runtime.reform.stableSince = 0;
  }
  if (runtime?.combat?.disengagedAt > 0 && !runtime.reform.active) {
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    runtime.reform.stableSince = 0;
  }
};

export const prepareSquadControllerFrame = ({
  squad = null,
  agents = [],
  sim = {},
  walls = [],
  forward = null,
  nowSec = 0,
  moving = false
} = {}) => {
  const runtime = ensureSquadControllerRuntime({ squad, agents, nowSec, forward });
  if (!runtime) return null;
  const direction = normalizeVec(
    finiteNumber(forward?.x, finiteNumber(squad?.dirX, 1)),
    finiteNumber(forward?.y, finiteNumber(squad?.dirY))
  );
  const sampledAt = finiteNumber(runtime?.terrain?.sampledAt, -Infinity);
  const terrainScanInterval = runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    ? 0.08
    : FORMATION_SCAN_INTERVAL;
  if (
    nowSec - sampledAt >= terrainScanInterval
    || !Number.isFinite(sampledAt)
  ) {
    runtime.terrain = resolveTerrainSample({
      squad,
      agents,
      sim,
      walls,
      forward: direction,
      nowSec,
      runtime
    });
  }
  updateReformState({ squad, runtime, agents, nowSec });
  const anchor = updateAnchor(runtime, squad, direction);
  const spacing = resolveBaseSpacing(squad);
  const followers = sortAgents(agents).filter((agent) => !agent.isFlagBearer);
  const rearExtent = resolveRearExtent(followers, spacing);
  const rows = [];
  followers.forEach((agent, index) => {
    const fallback = fallbackSlotForIndex(index, resolveFormationColumns(squad, followers.length, spacing), spacing);
    const normalSlot = resolveFormationSlot({
      squad,
      runtime,
      agent,
      fallbackSlot: fallback,
      ignoreRejoin: true
    });
    const normalTarget = localToWorld(anchor, normalSlot);
    const normalError = Math.hypot(
      normalTarget.x - finiteNumber(agent?.x),
      normalTarget.y - finiteNumber(agent?.y)
    );
    const local = worldToLocal(anchor, agent);
    const lag = Math.max(0, normalSlot.front - local.front);
    const agentState = agent?._squadController && typeof agent._squadController === 'object'
      ? agent._squadController
      : {};
    const triggerDistance = Math.max(30, spacing * 4.8);
    let rejoin = agentState?.rejoin && typeof agentState.rejoin === 'object'
      ? agentState.rejoin
      : null;
    if (!rejoin && normalError >= triggerDistance && lag >= spacing * 2.1) {
      rejoin = {
        active: true,
        phase: 'GATE',
        startedAt: nowSec,
        gateSlot: {
          side: clamp(normalSlot.side, -spacing, spacing),
          front: -rearExtent - (spacing * 1.15)
        }
      };
    }
    if (rejoin?.active && rejoin.phase === 'GATE') {
      const gate = localToWorld(anchor, rejoin.gateSlot);
      if (Math.hypot(gate.x - finiteNumber(agent?.x), gate.y - finiteNumber(agent?.y)) <= spacing * 1.22) {
        rejoin = { ...rejoin, phase: 'SLOT', reachedAt: nowSec };
      }
    }
    if (rejoin?.active && rejoin.phase === 'SLOT' && normalError <= spacing * 1.28) {
      rejoin = null;
    }
    agent._squadController = {
      ...agentState,
      activeSlot: resolveFormationSlot({
        squad,
        runtime,
        agent,
        fallbackSlot: fallback,
        ignoreRejoin: false
      }),
      normalSlot,
      rejoin
    };
    rows.push({ agent, normalError, lag, rejoining: !!rejoin?.active });
  });
  const errors = rows.map((row) => row.normalError);
  const sumSquared = errors.reduce((sum, value) => sum + (value * value), 0);
  const maximumError = errors.length > 0 ? Math.max(...errors) : 0;
  const upperError = percentile(errors, 0.9);
  const averageError = errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length);
  const rmsError = Math.sqrt(sumSquared / Math.max(1, errors.length));
  const readyThreshold = Math.max(2.4, spacing * 0.68);
  const readyRatio = rows.filter((row) => row.normalError <= readyThreshold).length / Math.max(1, rows.length);
  const maxLag = rows.reduce((maximum, row) => Math.max(maximum, row.lag), 0);
  const rejoiningCount = rows.filter((row) => row.rejoining).length;
  const softError = Math.max(spacing * 1.35, 8);
  const hardError = Math.max(spacing * 4.1, 32);
  const unreadyPressure = clamp((upperError - softError) / Math.max(1, hardError - softError), 0, 1);
  const readyPressure = clamp((0.78 - readyRatio) / 0.78, 0, 1);
  let speedScale = moving
    ? clamp(1 - (unreadyPressure * 0.54) - (readyPressure * 0.2), 0.38, 1)
    : 1;
  if (rejoiningCount > 0 && moving) speedScale = Math.min(speedScale, 0.86);
  const severe = upperError >= hardError && readyRatio < 0.28;
  const previousSevereSince = finiteNumber(runtime?.cohesion?.severeSince);
  const severeSince = severe ? (previousSevereSince || nowSec) : 0;
  const waiting = severe && nowSec - severeSince >= 1.1;
  if (waiting) speedScale = Math.max(0.2, speedScale * 0.68);
  rows.forEach((row) => {
    const gain = clamp(
      (row.normalError - (spacing * 1.3)) / Math.max(1, spacing * 5.2),
      0,
      1
    );
    row.agent._squadController = {
      ...row.agent._squadController,
      catchUpMultiplier: row.rejoining
        ? MAX_CATCH_UP_MULTIPLIER
        : clamp(1 + (gain * (MAX_CATCH_UP_MULTIPLIER - 1)), 1, MAX_CATCH_UP_MULTIPLIER)
    };
  });
  runtime.cohesion = {
    maximumError,
    upperError,
    averageError,
    rmsError,
    maxLag,
    readyRatio,
    rejoiningCount,
    speedScale,
    waiting,
    severeSince
  };
  const combatState = runtime?.combat?.state || SQUAD_COMBAT_RUNTIME_STATE.NONE;
  if (combatState === SQUAD_COMBAT_RUNTIME_STATE.ENGAGED || combatState === SQUAD_COMBAT_RUNTIME_STATE.DEPLOY) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.COMBAT_DEPLOY;
  } else if (runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
  } else if (runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.COMPRESS) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.COMPRESS;
  } else if (runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.EXPAND;
  } else if (runtime?.reform?.active) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.REFORM;
  } else if (moving) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.MARCH;
  } else if (readyRatio < 0.82) {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.ASSEMBLE;
  } else {
    runtime.formation.state = SQUAD_FORMATION_RUNTIME_STATE.HOLD;
  }
  runtime.formation.activeId = runtime.formation.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    ? 'NARROW_COLUMN'
    : runtime.formation.requestedId;
  if (runtime?.reform?.active) {
    const settled = readyRatio >= 0.86 && upperError <= Math.max(spacing * 1.3, 6);
    runtime.reform.stableSince = settled
      ? (finiteNumber(runtime?.reform?.stableSince) || nowSec)
      : 0;
    if (settled && nowSec - runtime.reform.stableSince >= REFORM_STABLE_DURATION) {
      runtime.reform.active = false;
      runtime.reform.stableSince = 0;
    }
  }
  squad._formationCohesion = {
    maximumError,
    upperError,
    readyRatio,
    speedScale,
    waiting,
    recoveringCount: rejoiningCount,
    averageError,
    rmsError,
    maxLag
  };
  squad._formationCohesionSpeedScale = speedScale;
  squad.formationCohesionState = waiting
    ? 'REGROUPING'
    : (rejoiningCount > 0 ? 'REJOINING' : (speedScale < 0.98 ? 'SLOWING' : 'COHESIVE'));
  squad.formationCohesionError = maximumError;
  refreshRuntimeDebug(squad, runtime);
  return runtime;
};

export const completeSquadControllerFrame = ({
  squad = null,
  agents = [],
  nowSec = 0,
  forward = null
} = {}) => {
  const runtime = squad?._squadController;
  if (!runtime || !isTrainingCardSquad(squad)) return null;
  updateAnchor(runtime, squad, forward);
  runtime.membershipSignature = resolveMembershipSignature(agents);
  runtime.lastUpdatedAt = nowSec;
  refreshRuntimeDebug(squad, runtime);
  return runtime;
};

export const resolveSquadControllerFormationSlot = ({
  squad = null,
  agent = null,
  fallbackSlot = {}
} = {}) => {
  const runtime = squad?._squadController;
  if (!runtime || !agent || !isTrainingCardSquad(squad)) return null;
  const active = agent?._squadController?.activeSlot;
  return active ? normalizeSlot(active, fallbackSlot) : resolveFormationSlot({
    squad,
    runtime,
    agent,
    fallbackSlot
  });
};

export const resolveSquadControllerAgentSpeedMultiplier = (agent = null, squad = null) => {
  if (!agent || !isTrainingCardSquad(squad)) return 1;
  return clamp(
    finiteNumber(agent?._squadController?.catchUpMultiplier, 1),
    1,
    MAX_CATCH_UP_MULTIPLIER
  );
};

export const resolveSquadControllerBoundarySteering = ({
  squad = null,
  desiredDirection = null
} = {}) => {
  const direction = normalizeVec(desiredDirection?.x, desiredDirection?.y);
  const runtime = squad?._squadController;
  const terrain = runtime?.terrain;
  if (!runtime || !terrain || direction.len <= 0.0001) {
    return direction.len > 0.0001 ? { x: direction.x, y: direction.y } : { x: 0, y: 0 };
  }
  let x = direction.x;
  let y = direction.y;
  const applySlide = (normalX = 0, normalY = 0, distance = Infinity, range = 0) => {
    const normal = normalizeVec(normalX, normalY);
    if (normal.len <= 0.0001 || !Number.isFinite(distance) || distance > range) return;
    const outward = (x * normal.x) + (y * normal.y);
    if (outward < 0) {
      x -= normal.x * outward;
      y -= normal.y * outward;
    }
    const inwardStrength = clamp((range - distance) / Math.max(1, range), 0, 1) * 0.54;
    x += normal.x * inwardStrength;
    y += normal.y * inwardStrength;
  };
  const spacing = resolveBaseSpacing(squad);
  applySlide(
    finiteNumber(terrain?.boundaryNormalX),
    finiteNumber(terrain?.boundaryNormalY),
    finiteNumber(terrain?.boundaryDistance, Infinity),
    Math.max(14, spacing * 1.25)
  );
  applySlide(
    finiteNumber(terrain?.wallNormalX),
    finiteNumber(terrain?.wallNormalY),
    finiteNumber(terrain?.wallDistance, Infinity),
    Math.max(16, spacing * 2.8)
  );
  const normalized = normalizeVec(x, y);
  return normalized.len > 0.0001 ? { x: normalized.x, y: normalized.y } : { x: direction.x, y: direction.y };
};

const resolveTargetAgentCapacity = (target = {}) => {
  if (target?.isBoss === true || target?.boss === true || finiteNumber(target?.weight) >= 80) return 7;
  const health = clamp(
    finiteNumber(target?.hpWeight, finiteNumber(target?.weight))
      / Math.max(0.001, finiteNumber(target?.initialWeight, finiteNumber(target?.weight, 1))),
    0,
    1
  );
  if (health <= 0.22) return 1;
  if (finiteNumber(target?.weight) >= 28) return 5;
  if (finiteNumber(target?.weight) >= 10) return 3;
  return 2;
};

const resolveCombatLeash = (agent = {}, squad = {}) => {
  const formationRadius = Math.max(18, finiteNumber(squad?.radius, 12));
  const role = resolveAgentRole(agent);
  const extra = role === 'SUPPORT'
    ? 18
    : role === 'RANGED'
      ? 30
      : role === 'CAVALRY'
        ? 78
        : 58;
  return {
    soft: formationRadius + Math.max(12, extra * 0.58),
    hard: formationRadius + extra
  };
};

export const resolveSquadControllerCombatLeash = ({
  agent = null,
  squad = null
} = {}) => resolveCombatLeash(agent || {}, squad || {});

const resolveTargetSquad = (squad = {}, squadMap = new Map()) => {
  const targetId = String(
    squad?.targetSquadId
      || squad?._combatEngagementTargetId
      || squad?.order?.targetSquadId
      || squad?.lastDamagedBySquadId
      || ''
  ).trim();
  const target = targetId ? squadMap.get(targetId) || null : null;
  return target && finiteNumber(target?.remain) > 0 ? target : null;
};

const isValidCombatTarget = ({
  agent = {},
  target = null,
  squad = {},
  targetSquad = null,
  nowSec = 0
} = {}) => {
  if (!target || target.dead || !targetSquad || finiteNumber(targetSquad?.remain) <= 0) return false;
  const leash = resolveCombatLeash(agent, squad);
  const anchorDistance = Math.hypot(
    finiteNumber(target?.x) - finiteNumber(squad?.x),
    finiteNumber(target?.y) - finiteNumber(squad?.y)
  );
  if (anchorDistance > leash.hard + 72) return false;
  const assignmentUntil = finiteNumber(agent?._squadController?.combatTargetUntil);
  const range = resolveAgentAttackRange(agent, squad);
  const distance = Math.hypot(
    finiteNumber(target?.x) - finiteNumber(agent?.x),
    finiteNumber(target?.y) - finiteNumber(agent?.y)
  );
  return assignmentUntil > nowSec || distance <= Math.max(42, range.max * 1.6);
};

const assignSupportReservations = ({
  squad = {},
  agents = [],
  targetAgents = [],
  nowSec = 0
} = {}) => {
  const supports = sortAgents(agents).filter((agent) => resolveAgentRole(agent) === 'SUPPORT');
  const allies = sortAgents(agents).filter((agent) => resolveAgentRole(agent) !== 'SUPPORT' && !agent.isFlagBearer);
  const reservations = new Map();
  let assigned = 0;
  supports.forEach((support) => {
    const supportState = support?._squadController && typeof support._squadController === 'object'
      ? support._squadController
      : {};
    const range = resolveAgentAttackRange(support, squad);
    const castRange = clamp(Math.max(36, finiteNumber(range?.max)), 36, 88);
    if (String(support?.unitSubtype || '') === 'intervention') {
      const target = targetAgents
        .slice()
        .sort((left, right) => (
          Math.hypot(finiteNumber(left?.x) - finiteNumber(support?.x), finiteNumber(left?.y) - finiteNumber(support?.y))
            - Math.hypot(finiteNumber(right?.x) - finiteNumber(support?.x), finiteNumber(right?.y) - finiteNumber(support?.y))
        ))[0] || null;
      support._squadController = {
        ...supportState,
        supportTargetId: target?.id || '',
        supportTargetUntil: target ? nowSec + 0.7 : 0
      };
      return;
    }
    let best = null;
    let bestScore = -Infinity;
    allies.forEach((ally) => {
      const distance = Math.hypot(
        finiteNumber(ally?.x) - finiteNumber(support?.x),
        finiteNumber(ally?.y) - finiteNumber(support?.y)
      );
      if (distance > castRange) return;
      const healthRatio = clamp(
        finiteNumber(ally?.hpWeight, finiteNumber(ally?.weight))
          / Math.max(0.001, finiteNumber(ally?.initialWeight, finiteNumber(ally?.weight, 1))),
        0,
        1
      );
      const missingHealth = 1 - healthRatio;
      const underThreat = finiteNumber(ally?.hitTimer) > 0.02
        || ally?.state === 'attack'
        || !!ally?.targetAgentId;
      if (missingHealth < SUPPORT_MIN_HEALTH_DEFICIT && !underThreat) return;
      const reservationCount = reservations.get(String(ally.id || '')) || 0;
      const roleBonus = resolveAgentRole(ally) === 'MELEE' ? 5 : 0;
      const score = (missingHealth * 110)
        + (underThreat ? 18 : 0)
        + roleBonus
        - (distance * 0.12)
        - (reservationCount * 34);
      if (score > bestScore) {
        bestScore = score;
        best = ally;
      }
    });
    const targetId = String(best?.id || '');
    if (targetId) {
      reservations.set(targetId, (reservations.get(targetId) || 0) + 1);
      assigned += 1;
    }
    support._squadController = {
      ...supportState,
      supportTargetId: targetId,
      supportTargetUntil: targetId ? nowSec + 0.7 : 0
    };
  });
  return assigned;
};

export const syncSquadControllerCombat = ({
  squad = null,
  agents = [],
  crowd = {},
  spatial = null,
  squadMap = new Map(),
  agentMap = new Map(),
  nowSec = 0
} = {}) => {
  const runtime = ensureSquadControllerRuntime({ squad, agents, nowSec });
  if (!runtime) return null;
  const wasCombatState = runtime?.combat?.state;
  const targetSquad = resolveTargetSquad(squad, squadMap);
  const combatEnabled = isSquadCombatEnabled(squad);
  runtime.combat.intent = resolveCombatIntent(squad);
  if (!combatEnabled || !targetSquad) {
    sortAgents(agents).forEach(clearAgentControllerCombat);
    if (
      wasCombatState === SQUAD_COMBAT_RUNTIME_STATE.ENGAGED
      || wasCombatState === SQUAD_COMBAT_RUNTIME_STATE.DEPLOY
    ) {
      runtime.combat.disengagedAt = nowSec;
      runtime.reform.active = true;
      runtime.reform.startedAt = nowSec;
    }
    const disengageAge = nowSec - finiteNumber(runtime?.combat?.disengagedAt);
    runtime.combat = {
      ...runtime.combat,
      state: wasCombatState === SQUAD_COMBAT_RUNTIME_STATE.NONE
        || (wasCombatState === SQUAD_COMBAT_RUNTIME_STATE.DISENGAGE && disengageAge >= 0.55)
        ? SQUAD_COMBAT_RUNTIME_STATE.NONE
        : SQUAD_COMBAT_RUNTIME_STATE.DISENGAGE,
      targetSquadId: '',
      assignedCount: 0,
      supportReservations: assignSupportReservations({ squad, agents, targetAgents: [], nowSec }),
      anchor: null
    };
    refreshRuntimeDebug(squad, runtime);
    return runtime;
  }
  const targetAgents = sortAgents(crowd?.agentsBySquad?.get?.(targetSquad.id) || []);
  if (targetAgents.length <= 0) {
    sortAgents(agents).forEach(clearAgentControllerCombat);
    runtime.combat = {
      ...runtime.combat,
      state: SQUAD_COMBAT_RUNTIME_STATE.DISENGAGE,
      targetSquadId: String(targetSquad?.id || ''),
      assignedCount: 0,
      supportReservations: assignSupportReservations({ squad, agents, targetAgents: [], nowSec }),
      anchor: null,
      disengagedAt: nowSec
    };
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    refreshRuntimeDebug(squad, runtime);
    return runtime;
  }
  const activeAgents = sortAgents(agents);
  const combatAgents = activeAgents.filter((agent) => (
    !agent.isFlagBearer && resolveAgentRole(agent) !== 'SUPPORT'
  ));
  const targetById = new Map(targetAgents.map((agent) => [String(agent.id || ''), agent]));
  const reservations = new Map();
  const assignments = [];
  const reserve = (agent, target) => {
    const key = String(target.id || '');
    reservations.set(key, (reservations.get(key) || 0) + 1);
    const state = agent?._squadController && typeof agent._squadController === 'object'
      ? agent._squadController
      : {};
    agent._squadController = {
      ...state,
      combatTargetId: key,
      combatTargetUntil: nowSec + 0.72
    };
    agent.targetAgentId = key;
    assignments.push({ agent, target });
  };
  combatAgents.forEach((agent) => {
    const previousId = String(agent?._squadController?.combatTargetId || agent?.targetAgentId || '');
    const previous = targetById.get(previousId) || null;
    if (!isValidCombatTarget({ agent, target: previous, squad, targetSquad, nowSec })) return;
    if ((reservations.get(previousId) || 0) >= resolveTargetAgentCapacity(previous)) return;
    reserve(agent, previous);
  });
  const assignedIds = new Set(assignments.map((row) => String(row.agent?.id || '')));
  const nearbyScratch = [];
  combatAgents.forEach((agent) => {
    if (assignedIds.has(String(agent?.id || ''))) return;
    const range = resolveAgentAttackRange(agent, squad);
    const leash = resolveCombatLeash(agent, squad);
    const anchorDistance = Math.hypot(
      finiteNumber(agent?.x) - finiteNumber(squad?.x),
      finiteNumber(agent?.y) - finiteNumber(squad?.y)
    );
    if (anchorDistance > leash.hard) {
      clearAgentControllerCombat(agent);
      return;
    }
    const searchRadius = Math.max(36, finiteNumber(range?.max) + (isRangedAgent(agent) ? 46 : 34));
    const nearby = querySpatialNearby(spatial, agent?.x, agent?.y, searchRadius, nearbyScratch);
    let best = null;
    let bestScore = Infinity;
    for (let index = 0; index < nearby.length; index += 1) {
      const candidate = nearby[index];
      if (
        !candidate
        || candidate.dead
        || String(candidate?.squadId || '') !== String(targetSquad.id || '')
      ) continue;
      const distance = Math.hypot(
        finiteNumber(candidate?.x) - finiteNumber(agent?.x),
        finiteNumber(candidate?.y) - finiteNumber(agent?.y)
      );
      if (distance > searchRadius) continue;
      const reservationCount = reservations.get(String(candidate.id || '')) || 0;
      const healthRatio = clamp(
        finiteNumber(candidate?.hpWeight, finiteNumber(candidate?.weight))
          / Math.max(0.001, finiteNumber(candidate?.initialWeight, finiteNumber(candidate?.weight, 1))),
        0,
        1
      );
      const threat = candidate?.state === 'attack' || !!candidate?.targetAgentId ? 1 : 0;
      const overCapacity = reservationCount >= resolveTargetAgentCapacity(candidate);
      const score = distance
        + (reservationCount * 15)
        + (overCapacity ? 96 : 0)
        + (healthRatio * 1.5)
        - (threat * 4.5);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) reserve(agent, best);
    else clearAgentControllerCombat(agent);
  });
  const assignmentsByTarget = new Map();
  assignments.forEach((row) => {
    const key = String(row.target?.id || '');
    if (!assignmentsByTarget.has(key)) assignmentsByTarget.set(key, []);
    assignmentsByTarget.get(key).push(row);
  });
  const spacing = resolveBaseSpacing(squad);
  let anchorX = 0;
  let anchorY = 0;
  let anchorCount = 0;
  assignmentsByTarget.forEach((rows, targetId) => {
    const target = targetById.get(targetId);
    if (!target) return;
    const approach = normalizeVec(
      finiteNumber(squad?.x) - finiteNumber(target?.x),
      finiteNumber(squad?.y) - finiteNumber(target?.y)
    );
    const forward = approach.len > 0.0001
      ? approach
      : normalizeVec(finiteNumber(runtime?.anchor?.forwardX, 1), finiteNumber(runtime?.anchor?.forwardY));
    const side = { x: -forward.y, y: forward.x };
    const ordered = rows.slice().sort((left, right) => (
      finiteNumber(left?.agent?.slotOrder) - finiteNumber(right?.agent?.slotOrder)
      || String(left?.agent?.id || '').localeCompare(String(right?.agent?.id || ''))
    ));
    const columns = clamp(Math.ceil(Math.sqrt(ordered.length)), 1, 3);
    ordered.forEach((row, index) => {
      const agent = row.agent;
      if (isRangedAgent(agent)) return;
      const attackRange = resolveAgentAttackRange(agent, squad);
      const column = index % columns;
      const depth = Math.floor(index / columns);
      const lane = column - ((columns - 1) * 0.5);
      const contact = Math.max(
        finiteNumber(agent?.radius, AGENT_RADIUS) + finiteNumber(target?.radius, AGENT_RADIUS) + 0.9,
        Math.min(Math.max(1.1, finiteNumber(attackRange?.max) * 0.48), 4.4)
      );
      const engagement = {
        x: finiteNumber(target?.x) + (forward.x * (contact + (depth * spacing * 0.58))) + (side.x * lane * spacing * 0.94),
        y: finiteNumber(target?.y) + (forward.y * (contact + (depth * spacing * 0.58))) + (side.y * lane * spacing * 0.94),
        targetId,
        expiresAt: nowSec + 0.72
      };
      agent._squadController = { ...agent._squadController, engagement };
    });
    anchorX += finiteNumber(target?.x);
    anchorY += finiteNumber(target?.y);
    anchorCount += 1;
  });
  const squadDistance = Math.hypot(
    finiteNumber(targetSquad?.x) - finiteNumber(squad?.x),
    finiteNumber(targetSquad?.y) - finiteNumber(squad?.y)
  );
  const targetRadius = Math.max(8, finiteNumber(targetSquad?.radius, targetSquad?.contactRadius));
  const engaged = assignments.length > 0 || squadDistance <= targetRadius + Math.max(28, finiteNumber(squad?.radius));
  runtime.combat = {
    ...runtime.combat,
    state: engaged ? SQUAD_COMBAT_RUNTIME_STATE.ENGAGED : SQUAD_COMBAT_RUNTIME_STATE.APPROACH,
    targetSquadId: String(targetSquad.id || ''),
    assignedCount: assignments.length,
    supportReservations: assignSupportReservations({ squad, agents, targetAgents, nowSec }),
    anchor: anchorCount > 0
      ? { x: anchorX / anchorCount, y: anchorY / anchorCount }
      : { x: finiteNumber(targetSquad?.x), y: finiteNumber(targetSquad?.y) }
  };
  refreshRuntimeDebug(squad, runtime);
  return runtime;
};

export const getSquadControllerCombatAssignment = ({
  agent = null,
  squad = null,
  agentMap = new Map(),
  squadMap = new Map(),
  nowSec = 0
} = {}) => {
  const targetId = String(agent?._squadController?.combatTargetId || '');
  if (!targetId || !agentMap?.get) return null;
  const target = agentMap.get(targetId) || null;
  const targetSquad = target ? squadMap.get(String(target?.squadId || '')) || null : null;
  if (!isValidCombatTarget({ agent, target, squad, targetSquad, nowSec })) return null;
  return target;
};

export const getSquadControllerSupportAssignment = ({
  agent = null,
  crowd = {},
  nowSec = 0
} = {}) => {
  const targetId = String(agent?._squadController?.supportTargetId || '');
  const until = finiteNumber(agent?._squadController?.supportTargetUntil);
  if (!targetId || until <= nowSec) return null;
  const squadAgents = crowd?.agentsBySquad?.get?.(agent?.squadId) || [];
  return squadAgents.find((candidate) => (
    candidate && !candidate.dead && String(candidate?.id || '') === targetId
  )) || null;
};
