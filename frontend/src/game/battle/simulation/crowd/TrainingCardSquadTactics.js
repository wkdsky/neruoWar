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
import { DEFAULT_FORMATION_ID } from '../../../formation/defaultFormation';
import {
  CARD_LOCOMOTION_STATE,
  CARD_PASSAGE_GROUP_STATE,
  isTrainingCardAgentInStream,
  resolveTrainingCardPassageFlowIntent,
  updateTrainingCardPassageAgents,
  updateTrainingCardPassagePlan
} from './TrainingCardPassage';
import {
  resolveTrainingCardBodyAnchor,
  resolveTrainingCardFormationAnchor,
  resolveTrainingCardNavigationAnchor
} from './TrainingCardSquadBody';

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

// Formation shape and locomotion are intentionally separate.  AUTO_DEFAULT
// remains the only player-facing shape, while this is the squad-level motion
// authority consumed by CrowdSim.  In particular, MARCH_LOCKED is not a
// cosmetic state: it selects swept reference-frame transport instead of the
// generic crowd steering mixer.
export const CARD_FORMATION_LOCOMOTION_MODE = Object.freeze({
  HOLD_LOCKED: 'HOLD_LOCKED',
  FORM_UP: 'FORM_UP',
  MARCH_LOCKED: 'MARCH_LOCKED',
  MARCH_ELASTIC: 'MARCH_ELASTIC',
  PASSAGE_STREAM: 'PASSAGE_STREAM',
  REFORM: 'REFORM',
  COMBAT_DEPLOY: 'COMBAT_DEPLOY',
  COMBAT_FREE: 'COMBAT_FREE'
});

export { CARD_LOCOMOTION_STATE };

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
const EXPAND_MIN_DURATION = 1.2;
const PASSAGE_LANE_WIDEN_HYSTERESIS = 0.58;
const PASSAGE_EXIT_READY_RATIO = 0.82;
const REFORM_STABLE_DURATION = 0.42;
const MAX_CATCH_UP_MULTIPLIER = 1.34;
const SUPPORT_MIN_HEALTH_DEFICIT = 0.035;
const CARD_GROUP_OUTLIER_WEIGHT_RATIO = 0.08;
const CARD_GROUP_SLOW_WEIGHT_RATIO = 0.1;
const CARD_ELASTIC_RELEASE_SEC = 0.34;
const CARD_HOLD_READY_RATIO = 0.94;

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
    String(rect?.formationId || DEFAULT_FORMATION_ID),
    finiteNumber(rect?.width),
    finiteNumber(rect?.depth),
    finiteNumber(rect?.spacing),
    slots.map((slot) => (
      String(slot?.unitTypeId || '')
        + ':' + finiteNumber(slot?.side).toFixed(3)
        + ':' + finiteNumber(slot?.front).toFixed(3)
    )).join(',')
  ].join('|');
};

const resolveRequestedFormationId = () => DEFAULT_FORMATION_ID;

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
  const bodyAnchor = resolveTrainingCardBodyAnchor(squad) || squad;
  const formationAnchor = resolveTrainingCardFormationAnchor(squad) || bodyAnchor;
  const navigationAnchor = resolveTrainingCardNavigationAnchor(squad) || formationAnchor;
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
    // Formation slots never read the legacy squad.x/y virtual leader.  CARD
    // locomotion publishes a bounded formation anchor explicitly; the
    // fallback remains body-first for restored/old saves.
    x: finiteNumber(formationAnchor?.x, finiteNumber(bodyAnchor?.x, finiteNumber(squad?.x))),
    y: finiteNumber(formationAnchor?.y, finiteNumber(bodyAnchor?.y, finiteNumber(squad?.y))),
    vx: finiteNumber(formationAnchor?.vx),
    vy: finiteNumber(formationAnchor?.vy),
    heading,
    forwardX: Math.cos(heading),
    forwardY: Math.sin(heading)
  };
  runtime.bodyAnchor = {
    x: finiteNumber(bodyAnchor?.x, finiteNumber(squad?.x)),
    y: finiteNumber(bodyAnchor?.y, finiteNumber(squad?.y)),
    vx: finiteNumber(bodyAnchor?.vx),
    vy: finiteNumber(bodyAnchor?.vy),
    rearProgress: finiteNumber(bodyAnchor?.rearProgress),
    bodyProgress: finiteNumber(bodyAnchor?.bodyProgress),
    frontProgress: finiteNumber(bodyAnchor?.frontProgress),
    maxAnchorLead: Math.max(0, finiteNumber(bodyAnchor?.maxAnchorLead))
  };
  runtime.navigationAnchor = {
    x: finiteNumber(navigationAnchor?.x, runtime.anchor.x),
    y: finiteNumber(navigationAnchor?.y, runtime.anchor.y),
    routeProgress: finiteNumber(navigationAnchor?.routeProgress),
    lead: Math.max(0, finiteNumber(navigationAnchor?.lead)),
    lag: Math.max(0, finiteNumber(navigationAnchor?.lag)),
    caughtUpToBody: navigationAnchor?.caughtUpToBody === true,
    clampedToBody: navigationAnchor?.clampedToBody === true,
    spatiallyClamped: navigationAnchor?.spatiallyClamped === true
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

const assignPersistentSlots = (
  squad = {},
  agents = [],
  { compact = false, orderedAgents = null } = {}
) => {
  const ordered = Array.isArray(orderedAgents)
    ? orderedAgents.filter(isLiveAgent)
    : sortAgents(agents);
  const spacing = resolveBaseSpacing(squad);
  const columns = resolveFormationColumns(squad, ordered.length, spacing);
  const template = Array.isArray(squad?.deploySlots)
    ? squad.deploySlots.map((slot) => normalizeSlot(slot))
    : [];
  ordered.forEach((agent, index) => {
    const existingSlot = agent?.formationSlot && typeof agent.formationSlot === 'object'
      ? normalizeSlot(agent.formationSlot)
      : null;
    const slot = compact
      ? fallbackSlotForIndex(index, columns, spacing)
      : (existingSlot || template[index] || fallbackSlotForIndex(index, columns, spacing));
    applySlotMetadata(agent, slot, index, columns, spacing);
    // The controller owns card-unit slots.  Drop the legacy spacing cache when
    // a member is repacked so a later formation switch cannot revive stale rows.
    agent.formationSpacingSlots = null;
  });
  squad._crowdBaseColumns = columns;
  return { ordered, columns, spacing };
};

const resolveMembershipSignature = (agents = [], orderedAgents = null) => (
  (Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents))
    .map((agent) => String(agent?.id || '')).join('|')
);

const resolveRequiredWidth = (agents = [], spacing = 1, orderedAgents = null) => {
  const ordered = Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents);
  const slots = ordered.map((agent) => normalizeSlot(agent?.formationSlot));
  if (slots.length <= 1) return Math.max(spacing, AGENT_RADIUS * 2);
  const sideExtent = slots.reduce((maximum, slot) => Math.max(maximum, Math.abs(slot.side)), 0);
  return Math.max(spacing, (sideExtent * 2) + spacing);
};

const resolveRearExtent = (agents = [], spacing = 1, orderedAgents = null) => (
  Math.max(
    spacing,
    (Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents)).reduce((maximum, agent) => (
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

const isPointInsidePassagePolygon = (point = {}, polygon = []) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const targetX = finiteNumber(point?.x);
  const targetY = finiteNumber(point?.y);
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index] || {};
    const previous = polygon[previousIndex] || {};
    const currentY = finiteNumber(current?.y);
    const previousY = finiteNumber(previous?.y);
    const crosses = ((currentY > targetY) !== (previousY > targetY))
      && targetX < (
        ((finiteNumber(previous?.x) - finiteNumber(current?.x)) * (targetY - currentY))
        / ((previousY - currentY) || 1e-9)
      ) + finiteNumber(current?.x);
    if (crosses) inside = !inside;
  }
  return inside;
};

const resolveRampPassageWidthAtPoint = (mapConfig = null, point = {}) => {
  const widths = [];
  (Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : []).forEach((region) => {
    if (!String(region?.type || '').startsWith('highland-') && String(region?.type || '') !== 'highland') return;
    (Array.isArray(region?.ramps) ? region.ramps : []).forEach((ramp) => {
      const points = Array.isArray(ramp?.points) ? ramp.points.filter(Boolean) : [];
      if (points.length < 3 || !isPointInsidePassagePolygon(point, points)) return;
      const lowWidth = points.length >= 4
        ? Math.hypot(finiteNumber(points[3]?.x) - finiteNumber(points[0]?.x), finiteNumber(points[3]?.y) - finiteNumber(points[0]?.y))
        : Math.hypot(finiteNumber(points[2]?.x) - finiteNumber(points[0]?.x), finiteNumber(points[2]?.y) - finiteNumber(points[0]?.y));
      const highWidth = points.length >= 4
        ? Math.hypot(finiteNumber(points[2]?.x) - finiteNumber(points[1]?.x), finiteNumber(points[2]?.y) - finiteNumber(points[1]?.y))
        : lowWidth;
      widths.push(Math.max(AGENT_RADIUS * 2, Math.min(lowWidth || Infinity, highWidth || Infinity)));
    });
  });
  return widths.length > 0 ? Math.min(...widths) : Infinity;
};

const resolvePassageWidthAtPoint = ({
  point = {},
  direction = {},
  walls = [],
  field = {},
  mapConfig = null,
  lateralProbe = 64,
  probeStep = 0,
  margin = AGENT_RADIUS + 2,
  spacing = (AGENT_RADIUS * 2) + AGENT_GAP
} = {}) => {
  const forward = normalizeVec(finiteNumber(direction?.x, 1), finiteNumber(direction?.y));
  const safeForward = forward.len > 0.0001 ? forward : { x: 1, y: 0 };
  const side = { x: -safeForward.y, y: safeForward.x };
  const safeProbe = Math.max(spacing * 2, finiteNumber(lateralProbe, 64));
  const leftHit = raycastObstacles(point, {
    x: finiteNumber(point?.x) + (side.x * safeProbe),
    y: finiteNumber(point?.y) + (side.y * safeProbe)
  }, walls, margin);
  const rightHit = raycastObstacles(point, {
    x: finiteNumber(point?.x) - (side.x * safeProbe),
    y: finiteNumber(point?.y) - (side.y * safeProbe)
  }, walls, margin);
  const leftBoundary = distanceToFieldBoundary(point, side, field, margin);
  const rightBoundary = distanceToFieldBoundary(point, { x: -side.x, y: -side.y }, field, margin);
  const left = Math.max(0, Math.min(
    leftHit ? safeProbe * clamp(finiteNumber(leftHit?.t), 0, 1) : safeProbe,
    leftBoundary
  ));
  const right = Math.max(0, Math.min(
    rightHit ? safeProbe * clamp(finiteNumber(rightHit?.t), 0, 1) : safeProbe,
    rightBoundary
  ));
  const localWidth = estimateLocalFlowWidth(point, safeForward, walls, {
    // Keep a large formation from turning a squad-level scan into hundreds of
    // tiny probes.  The probe remains finer than one soldier spacing.
    step: clamp(Math.max(2, spacing * 0.32, finiteNumber(probeStep), safeProbe / 96), 2, 8),
    maxProbe: safeProbe,
    inflate: margin
  });
  return Math.max(
    AGENT_RADIUS * 2,
    Math.min(left + right, localWidth, resolveRampPassageWidthAtPoint(mapConfig, point))
  );
};

const resolveTerrainSample = ({
  squad = {},
  agents = [],
  orderedAgents = null,
  sim = {},
  walls = [],
  forward = {},
  nowSec = 0,
  runtime = null
} = {}) => {
  // This is retained for non-CARD/minion terrain compatibility only. CARD
  // movement must always enter through updateTrainingCardPassagePlan so an
  // old local-width probe can never become a second authority that filters
  // detached/recovery mass or completes a passage by itself.
  if (isTrainingCardSquad(squad)) {
    return runtime?.terrain || {
      state: SQUAD_FORMATION_RUNTIME_STATE.MARCH,
      sampledAt: nowSec,
      compression: 1,
      longitudinalScale: 1,
      columns: 1,
      laneCount: 0,
      passageId: 0
    };
  }
  const terrain = runtime?.terrain || {};
  const direction = normalizeVec(
    finiteNumber(forward?.x, finiteNumber(squad?.dirX, 1)),
    finiteNumber(forward?.y, finiteNumber(squad?.dirY))
  );
  const safeDirection = direction.len > 0.0001 ? direction : { x: 1, y: 0 };
  const side = { x: -safeDirection.y, y: safeDirection.x };
  const spacing = resolveBaseSpacing(squad);
  const ordered = Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents);
  const requiredWidth = resolveRequiredWidth(agents, spacing, ordered);
  const requestedColumns = resolveFormationColumns(squad, ordered.length, spacing);
  const radius = Math.max(AGENT_RADIUS, finiteNumber(squad?.navigationAgentRadius, AGENT_RADIUS));
  const margin = radius + 2;
  const fieldHalfSpan = Math.max(
    64,
    Math.min(
      Math.max(1, finiteNumber(sim?.field?.width, 2700) * 0.5) - margin,
      Math.max(1, finiteNumber(sim?.field?.height, 1488) * 0.5) - margin
    )
  );
  // Detect a passage far enough ahead for a wide body to start queuing before
  // the front reaches it.  The old 104-unit cap made large formations think a
  // perfectly open battlefield was itself a bottleneck.
  const probeDistance = clamp(
    Math.max(44, requiredWidth * 1.08),
    44,
    Math.max(44, Math.min(260, fieldHalfSpan))
  );
  const lateralProbe = clamp(
    Math.max(requiredWidth * 0.56, spacing * 4),
    28,
    Math.max(28, Math.min(512, fieldHalfSpan))
  );
  const flowProbeStep = clamp(Math.max(2, spacing * 0.32, lateralProbe / 96), 2, 8);
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
    step: flowProbeStep,
    maxProbe: lateralProbe,
    inflate: margin
  });
  const rampCorridorWidth = Math.min(...sampleOffsets.map((offset) => (
    resolveRampPassageWidthAtPoint(sim?.trainingMap, {
      x: anchor.x + (safeDirection.x * offset),
      y: anchor.y + (safeDirection.y * offset)
    })
  )));
  const corridorWidth = Math.max(
    AGENT_RADIUS * 2,
    Math.min(leftSpace + rightSpace, localFlowWidth, rampCorridorWidth)
  );
  const availableWidth = Math.max(AGENT_RADIUS * 2, corridorWidth - (spacing * 0.18));
  const compression = clamp(availableWidth / Math.max(spacing, requiredWidth), 0.56, 1);
  const minimumPassageSpacing = Math.max(AGENT_RADIUS * 2.06, spacing * 0.76);
  const measuredPassageColumns = clamp(
    Math.floor((availableWidth + (minimumPassageSpacing * 0.16)) / minimumPassageSpacing),
    1,
    requestedColumns
  );
  const previousColumns = clamp(
    Math.floor(finiteNumber(terrain?.laneCount, finiteNumber(terrain?.columns, requestedColumns))),
    1,
    requestedColumns
  );
  let laneOpenSince = finiteNumber(terrain?.laneOpenSince);
  let passageColumns = measuredPassageColumns;
  if (String(terrain?.state || '') === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE) {
    if (measuredPassageColumns < previousColumns) {
      // Shrinking is safety-critical, so it takes effect immediately.  An
      // existing lane is remapped once by the controller, never every frame.
      passageColumns = measuredPassageColumns;
      laneOpenSince = 0;
    } else if (measuredPassageColumns > previousColumns) {
      const comfortablyWider = availableWidth >= (
        (previousColumns + PASSAGE_LANE_WIDEN_HYSTERESIS) * minimumPassageSpacing
      );
      laneOpenSince = comfortablyWider ? (laneOpenSince || nowSec) : 0;
      passageColumns = comfortablyWider && nowSec - laneOpenSince >= PASSAGE_MIN_DURATION
        ? measuredPassageColumns
        : previousColumns;
    } else {
      passageColumns = previousColumns;
      laneOpenSince = 0;
    }
  }
  // Light compression is still useful in open approaches.  Once a meaningful
  // share of lanes no longer fits, switch before agents start fighting exact
  // slots at the mouth of the corridor.
  const passageNeeded = passageColumns < requestedColumns
    && (compression <= 0.84 || passageColumns <= Math.max(1, Math.floor(requestedColumns * 0.78)));
  const openEnough = corridorWidth >= requiredWidth * 0.9 && frontClearance >= spacing * 2.2;
  const previousState = String(terrain?.state || '');
  const wasPassage = previousState === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
  const wasPassageFlow = wasPassage || previousState === SQUAD_FORMATION_RUNTIME_STATE.EXPAND;
  const allFlowCandidates = ordered.filter((agent) => !agent?.isFlagBearer);
  const flowCandidates = allFlowCandidates
    .filter((agent) => !agent?.isFlagBearer)
    .filter((agent) => (
      agent?._formationRecovery?.active !== true
      && agent?._formationDetached !== true
      && agent?._squadController?.rejoin?.active !== true
    ));
  const totalFlowWeight = allFlowCandidates.reduce((sum, agent) => (
    sum + Math.max(0, finiteNumber(agent?.weight, 1))
  ), 0);
  const healthyFlowWeight = flowCandidates.reduce((sum, agent) => (
    sum + Math.max(0, finiteNumber(agent?.weight, 1))
  ), 0);
  const detachedFlowRatio = (totalFlowWeight - healthyFlowWeight) / Math.max(0.001, totalFlowWeight);
  // Ignore a true tail of outliers, but do not let a large stuck rear vanish
  // from the exit test and cause the front half to expand across the gate.
  const clearanceCandidates = flowCandidates.length > 0 && detachedFlowRatio <= 0.08
    ? flowCandidates
    : allFlowCandidates;
  let frontProgress = -Infinity;
  let rearProgress = Infinity;
  clearanceCandidates.forEach((candidate) => {
    const progress = (
      (finiteNumber(candidate?.x) - anchor.x) * safeDirection.x
      + (finiteNumber(candidate?.y) - anchor.y) * safeDirection.y
    );
    frontProgress = Math.max(frontProgress, progress);
    rearProgress = Math.min(rearProgress, progress);
  });
  const resolveCandidateWidth = (ratio = 0.5) => {
    if (clearanceCandidates.length <= 0) return corridorWidth;
    const desiredProgress = frontProgress - ((frontProgress - rearProgress) * clamp(ratio, 0, 1));
    const candidate = clearanceCandidates.reduce((closest, current) => {
      if (!closest) return current;
      const currentProgress = (
        (finiteNumber(current?.x) - anchor.x) * safeDirection.x
        + (finiteNumber(current?.y) - anchor.y) * safeDirection.y
      );
      const closestProgress = (
        (finiteNumber(closest?.x) - anchor.x) * safeDirection.x
        + (finiteNumber(closest?.y) - anchor.y) * safeDirection.y
      );
      return Math.abs(currentProgress - desiredProgress) < Math.abs(closestProgress - desiredProgress)
        ? current
        : closest;
    }, null);
    return resolvePassageWidthAtPoint({
      point: candidate,
      direction: safeDirection,
      walls,
      field: sim?.field,
      mapConfig: sim?.trainingMap,
      lateralProbe,
      probeStep: flowProbeStep,
      margin,
      spacing
    });
  };
  // The leader clearing a gate is not enough.  Sample the body and a high
  // percentile of the rear instead of waiting for every detached outlier.
  const bodyWidth = resolveCandidateWidth(0.58);
  const rearWidth = resolveCandidateWidth(PASSAGE_EXIT_READY_RATIO);
  const frontCleared = openEnough;
  const bodyCleared = bodyWidth >= requiredWidth * 0.88;
  const rearCleared = rearWidth >= requiredWidth * 0.84;
  const flowClear = frontCleared && bodyCleared && rearCleared;
  let state = SQUAD_FORMATION_RUNTIME_STATE.MARCH;
  let passageUntil = Math.max(0, finiteNumber(terrain?.passageUntil));
  let openSince = finiteNumber(terrain?.openSince);
  let expandStartedAt = finiteNumber(terrain?.expandStartedAt);
  let expandFromCompression = clamp(finiteNumber(terrain?.expandFromCompression, terrain?.compression), 0.4, 1);
  if (passageNeeded || (wasPassageFlow && !flowClear)) {
    state = SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
    passageUntil = passageNeeded ? nowSec + PASSAGE_MIN_DURATION : Math.max(passageUntil, nowSec + 0.18);
    openSince = 0;
    expandStartedAt = 0;
    expandFromCompression = compression;
  } else if (wasPassage && (nowSec < passageUntil || !flowClear)) {
    state = SQUAD_FORMATION_RUNTIME_STATE.PASSAGE;
    if (flowClear && openSince <= 0) openSince = nowSec;
    if (!flowClear) openSince = 0;
    expandStartedAt = 0;
  } else if (wasPassage || previousState === SQUAD_FORMATION_RUNTIME_STATE.EXPAND) {
    state = SQUAD_FORMATION_RUNTIME_STATE.EXPAND;
    if (openSince <= 0) openSince = nowSec;
    if (expandStartedAt <= 0) expandStartedAt = nowSec;
    if (wasPassage) expandFromCompression = clamp(finiteNumber(terrain?.compression, compression), 0.4, 1);
    if (nowSec - expandStartedAt >= EXPAND_MIN_DURATION && compression >= 0.98) {
      state = SQUAD_FORMATION_RUNTIME_STATE.MARCH;
      openSince = 0;
      expandStartedAt = 0;
    }
  } else if (compression < 0.985) {
    state = SQUAD_FORMATION_RUNTIME_STATE.COMPRESS;
  }
  const expandProgress = state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND
    ? clamp((nowSec - Math.max(0, expandStartedAt || nowSec)) / EXPAND_MIN_DURATION, 0, 1)
    : (state === SQUAD_FORMATION_RUNTIME_STATE.MARCH ? 1 : 0);
  const effectiveCompression = state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND
    ? clamp(
      expandFromCompression + ((compression - expandFromCompression) * (expandProgress * expandProgress * (3 - (2 * expandProgress)))),
      0.4,
      1
    )
    : compression;
  const previousPassageId = Math.max(0, Math.floor(finiteNumber(terrain?.passageId)));
  const passageId = state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    ? (wasPassageFlow ? Math.max(1, previousPassageId) : previousPassageId + 1)
    : previousPassageId;
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
    compression: effectiveCompression,
    rawCompression: compression,
    longitudinalScale: clamp(1 + ((1 - effectiveCompression) * 0.56), 1, 1.36),
    requestedColumns,
    columns: state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE ? passageColumns : requestedColumns,
    laneCount: state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE ? passageColumns : requestedColumns,
    laneOpenSince,
    passageId,
    passageUntil,
    openSince,
    frontCleared,
    bodyCleared,
    rearCleared,
    bodyWidth,
    rearWidth,
    expandStartedAt,
    expandFromCompression,
    expandProgress,
    formationWeight: state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
      ? 0.04
      : (state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND ? expandProgress : 1),
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
  const state = agent?._squadController && typeof agent._squadController === 'object'
    ? agent._squadController
    : {};
  if (!ignoreRejoin && state?.rejoin?.active && state?.rejoin?.phase === 'GATE' && state.rejoin.gateSlot) {
    if (
      runtime?.anchor
      && Number.isFinite(Number(state.rejoin?.gateX))
      && Number.isFinite(Number(state.rejoin?.gateY))
    ) {
      // A detached unit first pursues a snapshot of the rear/body corridor.
      // Converting that world target back to the current anchor frame keeps
      // the generic slot consumer unchanged without making the gate run away
      // at the squad's march speed every frame.
      return worldToLocal(runtime.anchor, {
        x: Number(state.rejoin.gateX),
        y: Number(state.rejoin.gateY)
      });
    }
    return normalizeSlot(state.rejoin.gateSlot, fallbackSlot);
  }
  const base = normalizeSlot(agent?.formationSlot, fallbackSlot);
  // Passage locomotion owns its lane target.  Keep the persistent AUTO_DEFAULT
  // slot intact as the exit/reformation reference instead of manufacturing a
  // temporary rigid narrow-column slot here.
  return {
    side: base.side,
    front: base.front
  };
};

const weightedPercentile = (rows = [], ratio = 0.9, key = 'normalError') => {
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isFinite(Number(row?.[key])) && finiteNumber(row?.weight) > 0.001)
    .slice()
    .sort((left, right) => finiteNumber(left?.[key]) - finiteNumber(right?.[key]));
  const totalWeight = ordered.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.weight)), 0);
  if (totalWeight <= 0.001) return 0;
  const target = clamp(finiteNumber(ratio), 0, 1) * totalWeight;
  let accumulated = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    accumulated += Math.max(0, finiteNumber(ordered[index]?.weight));
    if (accumulated + 0.0001 >= target) return finiteNumber(ordered[index]?.[key]);
  }
  return finiteNumber(ordered[ordered.length - 1]?.[key]);
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
  const passageDebug = runtime?.passageDebug || {};
  const groupProgress = runtime?.groupProgress || {};
  const locomotion = runtime?.locomotion || {};
  squad.formationRuntime = {
    state: String(runtime?.formation?.state || SQUAD_FORMATION_RUNTIME_STATE.HOLD),
    locomotionMode: String(locomotion?.mode || CARD_FORMATION_LOCOMOTION_MODE.FORM_UP),
    locomotionTransitionReason: String(locomotion?.transitionReason || 'INITIAL_FORM_UP'),
    requestedFormation: String(runtime?.formation?.requestedId || ''),
    activeFormation: String(runtime?.formation?.activeId || ''),
    readyRatio: clamp(finiteNumber(cohesion?.readyRatio, 1), 0, 1),
    averageError: Math.max(0, finiteNumber(cohesion?.averageError)),
    rmsError: Math.max(0, finiteNumber(cohesion?.rmsError)),
    maxLag: Math.max(0, finiteNumber(cohesion?.maxLag)),
    detachedRatio: clamp(finiteNumber(cohesion?.detachedRatio), 0, 1),
    detachedWeightRatio: clamp(finiteNumber(cohesion?.detachedWeightRatio), 0, 1),
    detachedCount: Math.max(0, Math.floor(finiteNumber(cohesion?.detachedCount))),
    speedScale: clamp(finiteNumber(cohesion?.speedScale, 1), 0, 1),
    compression: clamp(finiteNumber(terrain?.compression, 1), 0, 1),
    passage: terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE,
    passageExit: {
      frontCleared: terrain?.frontCleared === true,
      bodyCleared: terrain?.bodyCleared === true,
      rearCleared: terrain?.rearCleared === true
    },
    corridorWidth: Number.isFinite(Number(terrain?.corridorWidth)) ? Number(terrain.corridorWidth) : null,
    bodyAnchor: runtime?.bodyAnchor ? {
      x: finiteNumber(runtime.bodyAnchor?.x),
      y: finiteNumber(runtime.bodyAnchor?.y),
      rearProgress: finiteNumber(runtime.bodyAnchor?.rearProgress),
      bodyProgress: finiteNumber(runtime.bodyAnchor?.bodyProgress),
      frontProgress: finiteNumber(runtime.bodyAnchor?.frontProgress),
      maxAnchorLead: Math.max(0, finiteNumber(runtime.bodyAnchor?.maxAnchorLead))
    } : null,
    navigationAnchor: runtime?.navigationAnchor ? {
      x: finiteNumber(runtime.navigationAnchor?.x),
      y: finiteNumber(runtime.navigationAnchor?.y),
      routeProgress: finiteNumber(runtime.navigationAnchor?.routeProgress),
      lead: Math.max(0, finiteNumber(runtime.navigationAnchor?.lead)),
      lag: Math.max(0, finiteNumber(runtime.navigationAnchor?.lag)),
      caughtUpToBody: runtime.navigationAnchor?.caughtUpToBody === true,
      clampedToBody: runtime.navigationAnchor?.clampedToBody === true,
      spatiallyClamped: runtime.navigationAnchor?.spatiallyClamped === true
    } : null,
    passageGroupState: String(groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION),
    blockedWeight: Math.max(0, finiteNumber(groupProgress?.blockedWeight)),
    behindGateWeight: Math.max(0, finiteNumber(groupProgress?.behindGateWeight)),
    slotErrorP50: Math.max(0, finiteNumber(locomotion?.slotErrorP50)),
    slotErrorP90: Math.max(0, finiteNumber(locomotion?.slotErrorP90)),
    slotErrorRms: Math.max(0, finiteNumber(locomotion?.slotErrorRms)),
    lockedWeightRatio: clamp(finiteNumber(locomotion?.lockedWeightRatio), 0, 1),
    elasticWeightRatio: clamp(finiteNumber(locomotion?.elasticWeightRatio), 0, 1),
    passageWeightRatio: clamp(finiteNumber(locomotion?.passageWeightRatio), 0, 1),
    maxSlotTargetSpeed: Math.max(0, finiteNumber(locomotion?.maxSlotTargetSpeed)),
    formationAngularSpeed: finiteNumber(locomotion?.formationAngularSpeed),
    blockedSlotWeight: Math.max(0, finiteNumber(locomotion?.blockedSlotWeight))
  };
  squad.passagePlan = runtime?.passagePlan || null;
  squad.passageDebug = {
    passageActive: passageDebug?.passageActive === true,
    passageId: Math.max(0, Math.floor(finiteNumber(passageDebug?.passageId))),
    streamCount: Math.max(0, Math.floor(finiteNumber(passageDebug?.streamCount))),
    agentsApproaching: Math.max(0, Math.floor(finiteNumber(passageDebug?.agentsApproaching))),
    agentsStreaming: Math.max(0, Math.floor(finiteNumber(passageDebug?.agentsStreaming))),
    agentsExiting: Math.max(0, Math.floor(finiteNumber(passageDebug?.agentsExiting))),
    groupState: String(passageDebug?.groupState || groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION),
    totalWeight: Math.max(0, finiteNumber(passageDebug?.totalWeight, groupProgress?.totalWeight)),
    blockedWeight: Math.max(0, finiteNumber(passageDebug?.blockedWeight, groupProgress?.blockedWeight)),
    detachedWeight: Math.max(0, finiteNumber(passageDebug?.detachedWeight, groupProgress?.detachedWeight)),
    behindGateWeight: Math.max(0, finiteNumber(passageDebug?.behindGateWeight, groupProgress?.behindGateWeight)),
    rearProgress: finiteNumber(passageDebug?.rearProgress, groupProgress?.rearProgress),
    bodyProgress: finiteNumber(passageDebug?.bodyProgress, groupProgress?.bodyProgress),
    frontProgress: finiteNumber(passageDebug?.frontProgress, groupProgress?.frontProgress),
    tailPending: passageDebug?.tailPending === true,
    groupBlocked: passageDebug?.groupBlocked === true
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
  orderedAgents = null,
  nowSec = 0,
  forward = null
} = {}) => {
  if (!isTrainingCardSquad(squad)) return null;
  const ordered = Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents);
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
        columns: 1,
        laneCount: 0,
        passageId: 0
      },
      passagePlan: null,
      passageCompletedRouteSignature: '',
      passageCompletedAt: 0,
      passageDebug: {
        passageActive: false,
        passageId: 0,
        streamCount: 0,
        agentsApproaching: 0,
        agentsStreaming: 0,
        agentsExiting: 0
      },
      groupProgress: {
        state: CARD_PASSAGE_GROUP_STATE.FORMATION,
        anchorSpeedScale: 1,
        tailPending: false,
        totalWeight: 0,
        blockedWeight: 0,
        behindGateWeight: 0,
        detachedWeight: 0,
        rearProgress: 0,
        bodyProgress: 0,
        frontProgress: 0,
        needsReplan: false,
        replannedAt: 0
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
        stableSince: 0,
        reason: 'INITIAL_FORM_UP'
      },
      locomotion: {
        mode: CARD_FORMATION_LOCOMOTION_MODE.FORM_UP,
        previousMode: '',
        changedAt: Math.max(0, finiteNumber(nowSec)),
        transitionReason: 'INITIAL_FORM_UP',
        lastTerrainState: SQUAD_FORMATION_RUNTIME_STATE.MARCH,
        elasticUntil: 0,
        slotErrorP50: 0,
        slotErrorP90: 0,
        slotErrorRms: 0,
        lockedWeightRatio: 0,
        elasticWeightRatio: 0,
        passageWeightRatio: 0,
        maxSlotTargetSpeed: 0,
        formationAngularSpeed: 0,
        blockedSlotWeight: 0
      },
      membershipSignature: '',
      lastMoveAt: 0
    };
    squad._squadController = runtime;
  }
  updateAnchor(runtime, squad, forward);
  const membership = resolveMembershipSignature(agents, ordered);
  const formationChanged = runtime?.formation?.requestedSignature !== signature;
  if (formationChanged || !runtime.membershipSignature) {
    assignPersistentSlots(squad, agents, { orderedAgents: ordered });
    runtime.formation.requestedId = resolveRequestedFormationId(squad);
    runtime.formation.requestedSignature = signature;
    runtime.reform.active = true;
    runtime.reform.needsRepack = false;
    runtime.reform.startedAt = Math.max(0, finiteNumber(nowSec));
    runtime.reform.reason = formationChanged ? 'FORMATION_CHANGED' : 'INITIAL_FORM_UP';
  } else if (membership !== runtime.membershipSignature) {
    const known = new Set(
      ordered
        .filter((agent) => agent?._squadController?.slotKey !== undefined)
        .map((agent) => String(agent.id || ''))
    );
    if (known.size < ordered.length) assignPersistentSlots(squad, agents, { orderedAgents: ordered });
    runtime.reform.needsRepack = true;
  }
  runtime.membershipSignature = resolveMembershipSignature(agents, ordered);
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
  delete squad.passagePlan;
  delete squad._passageRoute;
  delete squad._passagePlanRoute;
  delete squad._trainingPassageFallbackPending;
  delete squad._passagePlanSequence;
  delete squad._formationArrival;
  delete squad.formationArrivalState;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (!agent) return;
    delete agent._squadController;
    delete agent._formationRecovery;
    if (agent?._squadController) {
      agent._squadController.locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
      agent._squadController.passageFlowActive = false;
      agent._squadController.passageId = 0;
      agent._squadController.streamId = null;
    }
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
  orderedAgents = null,
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
    assignPersistentSlots(squad, agents, { orderedAgents });
    runtime.reform.needsRepack = false;
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    runtime.reform.stableSince = 0;
    runtime.reform.reason = 'MEMBERSHIP_CHANGED';
  }
  if (runtime?.combat?.disengagedAt > 0 && !runtime.reform.active) {
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    runtime.reform.stableSince = 0;
    runtime.reform.reason = 'COMBAT_EXIT';
  }
};

const resolveCardLocomotion = ({
  runtime = null,
  moving = false,
  nowSec = 0,
  spacing = 0
} = {}) => {
  if (!runtime) return CARD_FORMATION_LOCOMOTION_MODE.FORM_UP;
  const terrainState = String(runtime?.terrain?.state || SQUAD_FORMATION_RUNTIME_STATE.MARCH);
  const combatState = String(runtime?.combat?.state || SQUAD_COMBAT_RUNTIME_STATE.NONE);
  const groupState = String(runtime?.groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION);
  const locomotion = runtime?.locomotion || {};
  const cohesion = runtime?.cohesion || {};
  const holdTolerance = Math.max(1.2, finiteNumber(spacing) * 0.42);
  if (
    combatState === SQUAD_COMBAT_RUNTIME_STATE.ENGAGED
    || combatState === SQUAD_COMBAT_RUNTIME_STATE.DEPLOY
  ) {
    return CARD_FORMATION_LOCOMOTION_MODE.COMBAT_DEPLOY;
  }
  if (combatState === SQUAD_COMBAT_RUNTIME_STATE.APPROACH) {
    return CARD_FORMATION_LOCOMOTION_MODE.COMBAT_FREE;
  }
  if (
    terrainState === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    || groupState === CARD_PASSAGE_GROUP_STATE.FLOW
    || groupState === CARD_PASSAGE_GROUP_STATE.CLEAR_TAIL
    || groupState === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED
  ) {
    return CARD_FORMATION_LOCOMOTION_MODE.PASSAGE_STREAM;
  }
  if (runtime?.reform?.active) {
    return String(runtime?.reform?.reason || '') === 'INITIAL_FORM_UP'
      ? CARD_FORMATION_LOCOMOTION_MODE.FORM_UP
      : CARD_FORMATION_LOCOMOTION_MODE.REFORM;
  }
  if (
    terrainState === SQUAD_FORMATION_RUNTIME_STATE.COMPRESS
    || finiteNumber(locomotion?.elasticUntil) > nowSec
  ) {
    return CARD_FORMATION_LOCOMOTION_MODE.MARCH_ELASTIC;
  }
  if (!moving) {
    const ready = clamp(finiteNumber(cohesion?.readyRatio), 0, 1);
    const p90 = Math.max(0, finiteNumber(locomotion?.slotErrorP90, finiteNumber(cohesion?.upperError)));
    return ready >= CARD_HOLD_READY_RATIO && p90 <= holdTolerance
      ? CARD_FORMATION_LOCOMOTION_MODE.HOLD_LOCKED
      : CARD_FORMATION_LOCOMOTION_MODE.FORM_UP;
  }
  return CARD_FORMATION_LOCOMOTION_MODE.MARCH_LOCKED;
};

const updateCardLocomotionMode = ({
  runtime = null,
  moving = false,
  nowSec = 0,
  spacing = 0
} = {}) => {
  if (!runtime) return null;
  const previous = runtime?.locomotion && typeof runtime.locomotion === 'object'
    ? runtime.locomotion
    : {};
  const nextMode = resolveCardLocomotion({ runtime, moving, nowSec, spacing });
  const previousMode = String(previous?.mode || '');
  let reason = 'OPEN_CORRIDOR';
  const terrainState = String(runtime?.terrain?.state || SQUAD_FORMATION_RUNTIME_STATE.MARCH);
  const groupState = String(runtime?.groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION);
  if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.COMBAT_DEPLOY) reason = 'COMBAT_DEPLOY';
  else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.COMBAT_FREE) reason = 'COMBAT_APPROACH';
  else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.PASSAGE_STREAM) {
    reason = groupState === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED ? 'GROUP_BLOCKED' : 'CORRIDOR_TOO_NARROW';
  } else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.REFORM) {
    reason = String(runtime?.reform?.reason || (terrainState === SQUAD_FORMATION_RUNTIME_STATE.EXPAND ? 'PASSAGE_EXIT' : 'REFORM'));
  } else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.MARCH_ELASTIC) {
    reason = terrainState === SQUAD_FORMATION_RUNTIME_STATE.COMPRESS ? 'CORRIDOR_COMPRESSION' : 'BLOCKED_SLOT';
  } else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.HOLD_LOCKED) reason = 'ARRIVAL_SETTLED';
  else if (nextMode === CARD_FORMATION_LOCOMOTION_MODE.FORM_UP) reason = 'SLOT_READINESS';
  runtime.locomotion = {
    ...previous,
    mode: nextMode,
    previousMode: nextMode === previousMode ? String(previous?.previousMode || '') : previousMode,
    changedAt: nextMode === previousMode ? finiteNumber(previous?.changedAt, nowSec) : nowSec,
    transitionReason: nextMode === previousMode ? String(previous?.transitionReason || reason) : reason,
    lastTerrainState: terrainState
  };
  return runtime.locomotion;
};

const refreshCardLocomotionMetrics = ({ runtime = null, agents = [], nowSec = 0 } = {}) => {
  if (!runtime) return null;
  const rows = (Array.isArray(agents) ? agents : [])
    .filter(isLiveAgent)
    .map((agent) => {
      const debug = agent?._squadController?.locomotionDebug || {};
      return {
        agent,
        weight: Math.max(0, finiteNumber(agent?.weight, 1)),
        error: Math.max(0, finiteNumber(debug?.slotError)),
        mode: String(debug?.mode || ''),
        blocked: debug?.blocked === true,
        targetSpeed: Math.max(0, finiteNumber(debug?.targetSlotSpeed))
      };
    });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const rms = Math.sqrt(rows.reduce((sum, row) => sum + ((row.error * row.error) * row.weight), 0)
    / Math.max(0.001, totalWeight));
  const weightFor = (predicate) => rows
    .filter(predicate)
    .reduce((sum, row) => sum + row.weight, 0);
  const lockedWeight = weightFor((row) => row.mode === CARD_FORMATION_LOCOMOTION_MODE.MARCH_LOCKED
    || row.mode === CARD_FORMATION_LOCOMOTION_MODE.HOLD_LOCKED);
  const elasticWeight = weightFor((row) => row.mode === CARD_FORMATION_LOCOMOTION_MODE.MARCH_ELASTIC
    || row.mode === CARD_FORMATION_LOCOMOTION_MODE.FORM_UP
    || row.mode === CARD_FORMATION_LOCOMOTION_MODE.REFORM);
  const passageWeight = weightFor((row) => row.mode === CARD_FORMATION_LOCOMOTION_MODE.PASSAGE_STREAM);
  const blockedSlotWeight = weightFor((row) => row.blocked);
  const previous = runtime?.locomotion || {};
  const releaseUntil = blockedSlotWeight > 0.001 || elasticWeight > 0.001
    ? Math.max(finiteNumber(previous?.elasticUntil), nowSec + CARD_ELASTIC_RELEASE_SEC)
    : finiteNumber(previous?.elasticUntil);
  runtime.locomotion = {
    ...previous,
    slotErrorP50: weightedPercentile(rows, 0.5, 'error'),
    slotErrorP90: weightedPercentile(rows, 0.9, 'error'),
    slotErrorRms: rms,
    lockedWeightRatio: lockedWeight / Math.max(0.001, totalWeight),
    elasticWeightRatio: elasticWeight / Math.max(0.001, totalWeight),
    passageWeightRatio: passageWeight / Math.max(0.001, totalWeight),
    maxSlotTargetSpeed: rows.reduce((maximum, row) => Math.max(maximum, row.targetSpeed), 0),
    formationAngularSpeed: finiteNumber(runtime?.formationAngularSpeed),
    blockedSlotWeight,
    elasticUntil: releaseUntil > nowSec && elasticWeight > 0.001
      ? releaseUntil
      : Math.max(0, releaseUntil)
  };
  return runtime.locomotion;
};

const updatePassageFlowAssignments = ({ runtime = null, agents = [], orderedAgents = null } = {}) => {
  const terrain = runtime?.terrain || {};
  const state = String(terrain?.state || '');
  const flowActive = state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    || state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND;
  const passageId = Math.max(0, Math.floor(finiteNumber(terrain?.passageId)));
  const measuredLaneCount = Math.max(1, Math.floor(finiteNumber(terrain?.laneCount, terrain?.columns || 1)));
  const ordered = (Array.isArray(orderedAgents) ? orderedAgents : sortAgents(agents))
    .filter((agent) => !agent?.isFlagBearer);
  const maxSide = Math.max(
    1,
    ...ordered.map((agent) => Math.abs(finiteNumber(agent?.formationSlot?.side)))
  );
  ordered.forEach((agent, index) => {
    const previous = agent?._squadController && typeof agent._squadController === 'object'
      ? agent._squadController
      : {};
    if (!flowActive || passageId <= 0) {
      agent._squadController = { ...previous, passageFlowActive: false };
      return;
    }
    const samePassage = Math.floor(finiteNumber(previous?.passageId)) === passageId;
    const previousLaneCount = Math.max(1, Math.floor(finiteNumber(previous?.passageLaneCount, measuredLaneCount)));
    // A wider reading must not reinterpret lane 0 of a one-person queue as
    // the far-left lane of a newly measured four-column corridor.  Existing
    // members retain their lane scale until the gradual EXPAND formation takes
    // over; only a safety-driven shrink remaps them immediately.
    const laneCount = samePassage && measuredLaneCount > previousLaneCount
      ? previousLaneCount
      : measuredLaneCount;
    let lane = Math.floor(finiteNumber(previous?.passageLane, -1));
    if (!samePassage || lane < 0) {
      // Preserve the broad left/right ordering at entry.  It gives a stable
      // first lane without assigning a new lane from global rank every frame.
      const sideRatio = clamp((finiteNumber(agent?.formationSlot?.side) / maxSide + 1) * 0.5, 0, 1);
      lane = Math.round(sideRatio * Math.max(0, laneCount - 1));
    } else if (laneCount < previousLaneCount) {
      // A forced shrink maps each old lane once; widening deliberately keeps
      // the current lane so members do not cut across a live queue.
      const previousLanePosition = previousLaneCount <= 1
        ? 0.5
        : lane / Math.max(1, previousLaneCount - 1);
      lane = Math.round(previousLanePosition * Math.max(0, laneCount - 1));
    }
    agent._squadController = {
      ...previous,
      passageFlowActive: true,
      passageId,
      passageLane: clamp(lane, 0, laneCount - 1),
      passageLaneCount: laneCount,
      passageOrder: samePassage
        ? Math.max(0, Math.floor(finiteNumber(previous?.passageOrder, index)))
        : index
    };
  });
};

const resolveLegalRejoinGateSlot = ({
  anchor = {},
  requestedSlot = {},
  sim = {},
  walls = [],
  spacing = (AGENT_RADIUS * 2) + AGENT_GAP
} = {}) => {
  const requestedPoint = localToWorld(anchor, requestedSlot);
  const navigator = sim?.trainingNavigator;
  const legalPoint = navigator?.findNearestWalkablePoint
    ? navigator.findNearestWalkablePoint(requestedPoint, {
      obstacles: walls,
      radius: AGENT_RADIUS + 0.5,
      maxSearchDistance: Math.max(28, spacing * 5)
    }) || requestedPoint
    : requestedPoint;
  return worldToLocal(anchor, legalPoint);
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
  // CARD groups can contain thousands of representatives.  Reuse one stable
  // order across controller work in this frame instead of repeatedly sorting
  // the same population for slots, lanes and cohesion.
  const orderedAgents = sortAgents(agents);
  const runtime = ensureSquadControllerRuntime({
    squad,
    agents,
    orderedAgents,
    nowSec,
    forward
  });
  if (!runtime) return null;
  const direction = normalizeVec(
    finiteNumber(forward?.x, finiteNumber(squad?.dirX, 1)),
    finiteNumber(forward?.y, finiteNumber(squad?.dirY))
  );
  const sampledAt = finiteNumber(runtime?.terrain?.sampledAt, -Infinity);
  const terrainScanInterval = runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    ? 0.08
    : FORMATION_SCAN_INTERVAL;
  const previousTerrainState = String(
    runtime?.locomotion?.lastTerrainState || runtime?.terrain?.state || SQUAD_FORMATION_RUNTIME_STATE.MARCH
  );
  let passageRows = null;
  if (
    nowSec - sampledAt >= terrainScanInterval
    || !Number.isFinite(sampledAt)
  ) {
    if (isTrainingCardSquad(squad)) {
      if (
        (!Array.isArray(squad?._passagePlanRoute) || squad._passagePlanRoute.length <= 0)
        && Array.isArray(squad?.waypoints)
        && squad.waypoints.length > 0
      ) {
        const navigationAnchor = resolveTrainingCardBodyAnchor(squad)
          || resolveTrainingCardNavigationAnchor(squad)
          || squad;
        const anchor = {
          x: finiteNumber(navigationAnchor?.x, finiteNumber(squad?.x)),
          y: finiteNumber(navigationAnchor?.y, finiteNumber(squad?.y))
        };
        squad._passagePlanRoute = [anchor, ...squad.waypoints.map((point) => ({
          x: finiteNumber(point?.x),
          y: finiteNumber(point?.y)
        }))].filter((point, index, rows) => (
          index === 0
          || Math.hypot(point.x - rows[index - 1].x, point.y - rows[index - 1].y) > 0.05
        ));
      }
      const passageUpdate = updateTrainingCardPassagePlan({
        squad,
        agents: orderedAgents,
        runtime,
        sim,
        walls,
        route: Array.isArray(squad?._passagePlanRoute) && squad._passagePlanRoute.length > 0
          ? squad._passagePlanRoute
          : (Array.isArray(squad?._passageRoute) && squad._passageRoute.length > 0
            ? squad._passageRoute
            : squad?.waypoints),
        nowSec
      });
      passageRows = passageUpdate?.rows || [];
    } else {
      runtime.terrain = resolveTerrainSample({
        squad,
        agents,
        orderedAgents,
        sim,
        walls,
        forward: direction,
        nowSec,
        runtime
      });
    }
  }
  const terrainStateAfterScan = String(runtime?.terrain?.state || SQUAD_FORMATION_RUNTIME_STATE.MARCH);
  if (
    terrainStateAfterScan === SQUAD_FORMATION_RUNTIME_STATE.EXPAND
    && previousTerrainState !== SQUAD_FORMATION_RUNTIME_STATE.EXPAND
  ) {
    // Passage only owns the temporary stream.  Once its tail has cleared, the
    // same persistent slot topology becomes authoritative again before the
    // navigation anchor can resume normal marching.
    runtime.reform.active = true;
    runtime.reform.startedAt = nowSec;
    runtime.reform.stableSince = 0;
    runtime.reform.reason = 'PASSAGE_EXIT';
  }
  updateReformState({ squad, runtime, agents, orderedAgents, nowSec });
  if (isTrainingCardSquad(squad) && runtime?.passagePlan) {
    if (!passageRows) {
      passageRows = updateTrainingCardPassageAgents({
        squad,
        agents: orderedAgents,
        plan: runtime.passagePlan,
        nowSec
      });
    }
    const passageStates = passageRows
      .map((row) => String(row?.state || CARD_LOCOMOTION_STATE.FORMATION));
    const approaching = passageStates.filter((state) => state === CARD_LOCOMOTION_STATE.STREAM_APPROACH).length;
    const streaming = passageStates.filter((state) => state === CARD_LOCOMOTION_STATE.STREAM).length;
    const exiting = passageStates.filter((state) => state === CARD_LOCOMOTION_STATE.STREAM_EXIT).length;
    runtime.passageDebug = {
      ...(runtime.passageDebug || {}),
      agentsApproaching: approaching,
      agentsStreaming: streaming,
      agentsExiting: exiting,
      passageActive: approaching + streaming + exiting > 0
        || runtime?.groupProgress?.tailPending === true
    };
  }
  if (!isTrainingCardSquad(squad)) updatePassageFlowAssignments({ runtime, agents, orderedAgents });
  const anchor = updateAnchor(runtime, squad, direction);
  const spacing = resolveBaseSpacing(squad);
  const bodyGateAnchor = runtime?.bodyAnchor && typeof runtime.bodyAnchor === 'object'
    ? {
      ...runtime.bodyAnchor,
      heading: finiteNumber(runtime?.anchor?.heading, finiteNumber(runtime.bodyAnchor?.heading))
    }
    : anchor;
  // CARD flag bearers are physical representatives.  Do not silently remove
  // their troop weight from formation, passage, or cohesion accounting.
  const followers = orderedAgents;
  const rearExtent = resolveRearExtent(followers, spacing, followers);
  const groupProgress = runtime?.groupProgress || {};
  const groupState = String(groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION);
  const groupBlocked = groupState === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED;
  const passageFlowActive = runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE
    || runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.COMPRESS
    || runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND
    || groupState === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED;
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
    const passageLocomotion = isTrainingCardAgentInStream(agent)
      && agent?._formationRecovery?.active !== true
      && agentState?.rejoin?.active !== true;
    if (passageLocomotion) agent._formationDetached = false;
    const initiallyDetached = !passageLocomotion && (
      agent?._formationDetached === true
      || agent?._formationRecovery?.active === true
    );
    const recoveryThroughPassage = agent?._formationRecovery?.passageRecovery === true;
    const needsGateForDetachedAgent = !groupBlocked
      && !recoveryThroughPassage
      && initiallyDetached
      && normalError >= spacing * 1.45;
    const needsGateForNormalAgent = !groupBlocked
      && !passageFlowActive
      && normalError >= triggerDistance
      && lag >= spacing * 2.1;
    if (!rejoin && (needsGateForDetachedAgent || needsGateForNormalAgent)) {
      const requestedGateSlot = {
        side: clamp(normalSlot.side, -spacing, spacing),
        front: -rearExtent - (spacing * 1.15)
      };
      const gateSlot = resolveLegalRejoinGateSlot({
        // A recovery target is a catchable rear/body corridor gate, never an
        // exact formation slot that keeps crossing the obstacle with the
        // virtual anchor.
        anchor: bodyGateAnchor,
        requestedSlot: requestedGateSlot,
        sim,
        walls,
        spacing
      });
      const gate = localToWorld(bodyGateAnchor, gateSlot);
      rejoin = {
        active: true,
        phase: 'GATE',
        startedAt: nowSec,
        gateSlot,
        gateMode: 'SNAPSHOT',
        gateX: gate.x,
        gateY: gate.y,
        gateUpdatedAt: nowSec
      };
      // A rejoiner is a detached individual even when it did not originate
      // from a terrain recovery.  It remains in group mass/tail accounting;
      // only its short-range steering is delegated to this stable gate.
      agent._formationDetached = true;
    }
    if (rejoin?.active) agent._formationDetached = true;
    if (
      rejoin?.active
      && rejoin.phase === 'GATE'
      && rejoin.gateMode === 'FOLLOWING'
      && agent?._formationRecovery?.active === true
      && normalError >= Math.max(triggerDistance * 1.7, spacing * 7)
    ) {
      // A normal lagger may become a true detached recovery one frame after
      // the tactical gate is first created.  Freeze that far-away gate at
      // the current rear/body corridor so it cannot keep retreating with the
      // moving anchor for the entire recovery route.
      const gate = localToWorld(bodyGateAnchor, rejoin.gateSlot);
      rejoin = {
        ...rejoin,
        gateMode: 'SNAPSHOT',
        gateX: gate.x,
        gateY: gate.y,
        gateUpdatedAt: nowSec
      };
    }
    if (rejoin?.active && rejoin.phase === 'GATE') {
      const gate = Number.isFinite(Number(rejoin?.gateX)) && Number.isFinite(Number(rejoin?.gateY))
        ? { x: Number(rejoin.gateX), y: Number(rejoin.gateY) }
        : localToWorld(bodyGateAnchor, rejoin.gateSlot);
      const movingGate = localToWorld(bodyGateAnchor, rejoin.gateSlot);
      const gateDrift = Math.hypot(movingGate.x - gate.x, movingGate.y - gate.y);
      const gateDistance = Math.hypot(gate.x - finiteNumber(agent?.x), gate.y - finiteNumber(agent?.y));
      if (gateDistance <= spacing * 1.22) {
        if (rejoin.gateMode !== 'SNAPSHOT' || gateDrift <= spacing * 3.2) {
          rejoin = { ...rejoin, phase: 'SLOT', reachedAt: nowSec };
        } else {
          // The body may have advanced while this unit approached the old
          // gate.  Refresh only after it reached that snapshot, and refresh
          // toward the current body corridor rather than the formation lead.
          rejoin = {
            ...rejoin,
            gateX: movingGate.x,
            gateY: movingGate.y,
            gateUpdatedAt: nowSec
          };
        }
      }
    }
    if (rejoin?.active && rejoin.phase === 'SLOT' && normalError <= spacing * 1.28) {
      rejoin = null;
      agent._formationDetached = false;
    }
    const detached = passageLocomotion
      ? false
      : (agent?._formationDetached === true
      || agent?._formationRecovery?.active === true
      || rejoin?.active === true);
    // Install the newly created rejoin state before resolving the active
    // slot.  Otherwise a freshly detached agent spends one frame pulling at
    // its moving exact slot before the stable rear/body gate takes effect.
    agent._squadController = {
      ...agentState,
      normalSlot,
      rejoin
    };
    agent._squadController.activeSlot = resolveFormationSlot({
      squad,
      runtime,
      agent,
      fallbackSlot: fallback,
      ignoreRejoin: false
    });
    rows.push({
      agent,
      weight: Math.max(0, finiteNumber(agent?.weight, 1)),
      normalError,
      lag,
      rejoining: !!rejoin?.active,
      detached
    });
  });
  // A detached/recovery/rejoin member remains part of CARD cohesion.  The
  // only exception is a passage classifier that has already proved it is a
  // persistent, tiny, isolated outlier (capped by troop weight in Passage).
  const cohortRows = rows.filter((row) => row?.agent?._squadController?.passageOutlier?.active !== true);
  const cohesionRows = cohortRows.length > 0 ? cohortRows : rows;
  const cohesionWeight = cohesionRows.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.weight)), 0);
  const allErrors = rows.map((row) => row.normalError);
  const maximumError = allErrors.length > 0 ? Math.max(...allErrors) : 0;
  const upperError = weightedPercentile(cohesionRows, 0.9, 'normalError');
  const averageError = cohesionRows.reduce((sum, row) => (
    sum + (row.normalError * Math.max(0, finiteNumber(row?.weight)))
  ), 0) / Math.max(0.001, cohesionWeight);
  const rmsError = Math.sqrt(cohesionRows.reduce((sum, row) => (
    sum + (row.normalError * row.normalError * Math.max(0, finiteNumber(row?.weight)))
  ), 0) / Math.max(0.001, cohesionWeight));
  const readyThreshold = Math.max(2.4, spacing * 0.68);
  const readyWeight = cohesionRows
    .filter((row) => row.normalError <= readyThreshold)
    .reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.weight)), 0);
  const readyRatio = readyWeight / Math.max(0.001, cohesionWeight);
  const maxLag = weightedPercentile(cohesionRows, 0.9, 'lag');
  const rejoiningCount = rows.filter((row) => row.rejoining).length;
  const detachedCount = rows.filter((row) => row.detached).length;
  const detachedRatio = detachedCount / Math.max(1, rows.length);
  const totalWeight = rows.reduce((sum, row) => (
    sum + Math.max(0, finiteNumber(row?.weight))
  ), 0);
  const detachedWeight = rows
    .filter((row) => row.detached)
    .reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.weight)), 0);
  const groupDetachedWeight = Math.max(detachedWeight, finiteNumber(groupProgress?.detachedWeight));
  const detachedWeightRatio = groupDetachedWeight / Math.max(0.001, totalWeight);
  const blockedWeight = Math.max(0, finiteNumber(groupProgress?.blockedWeight));
  const blockedWeightRatio = blockedWeight / Math.max(0.001, finiteNumber(groupProgress?.trackedWeight, totalWeight));
  const softError = Math.max(spacing * 1.35, 8);
  const hardError = Math.max(spacing * 4.1, 32);
  const unreadyPressure = clamp((upperError - softError) / Math.max(1, hardError - softError), 0, 1);
  const readyPressure = clamp((0.78 - readyRatio) / 0.78, 0, 1);
  const detachedPressure = clamp((detachedWeightRatio - CARD_GROUP_OUTLIER_WEIGHT_RATIO) / 0.52, 0, 1);
  const blockedPressure = clamp((blockedWeightRatio - CARD_GROUP_SLOW_WEIGHT_RATIO) / 0.58, 0, 1);
  const formationPressure = passageFlowActive
    ? Math.max(detachedPressure, blockedPressure)
    : Math.max(detachedPressure, (unreadyPressure * 0.42) + (readyPressure * 0.24));
  const speedScale = !moving
    ? 1
    : (groupBlocked
      ? 0
      : clamp(1 - (formationPressure * 0.56), 0.24, 1));
  const waiting = moving && (
    groupBlocked
    || (
      blockedWeightRatio >= 0.18
      && finiteNumber(groupProgress?.stallFor) >= 0.45
    )
  );
  const previousSevereSince = finiteNumber(runtime?.cohesion?.severeSince);
  const severeSince = waiting
    ? (previousSevereSince > 0 ? previousSevereSince : nowSec)
    : 0;
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
    detachedCount,
    detachedRatio,
    detachedWeight: groupDetachedWeight,
    detachedWeightRatio,
    blockedWeight,
    blockedWeightRatio,
    groupState,
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
  runtime.formation.activeId = DEFAULT_FORMATION_ID;
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
  runtime.formationAngularSpeed = finiteNumber(squad?._cardFormationAngularSpeed);
  updateCardLocomotionMode({ runtime, moving, nowSec, spacing });
  squad._formationCohesion = {
    maximumError,
    upperError,
    readyRatio,
    speedScale,
    waiting,
    recoveringCount: rejoiningCount,
    averageError,
    rmsError,
    maxLag,
    detachedCount,
    detachedRatio,
    detachedWeight: groupDetachedWeight,
    detachedWeightRatio,
    blockedWeight,
    blockedWeightRatio,
    groupState
  };
  squad._formationCohesionSpeedScale = speedScale;
  squad.formationCohesionState = groupBlocked
    ? 'GROUP_BLOCKED'
    : (waiting
      ? 'REGROUPING'
      : (detachedCount > 0
        ? 'REJOINING'
        : (speedScale < 0.98 ? 'SLOWING' : 'COHESIVE')));
  squad.formationCohesionError = upperError;
  // Compatibility/debug mirror only.  CrowdSim no longer consumes this for
  // CARD steering; the controller's PASSAGE_FLOW intent is the source of
  // truth, so retaining the field cannot revive rigid narrow slots.
  squad._narrowPassage = {
    active: runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.PASSAGE,
    expanding: runtime?.terrain?.state === SQUAD_FORMATION_RUNTIME_STATE.EXPAND,
    columns: Math.max(1, Math.floor(finiteNumber(runtime?.terrain?.laneCount, runtime?.terrain?.columns || 1))),
    width: finiteNumber(runtime?.terrain?.corridorWidth, Infinity),
    distance: finiteNumber(runtime?.terrain?.frontClearance),
    passageId: Math.max(0, Math.floor(finiteNumber(runtime?.terrain?.passageId))),
    sampledAt: nowSec
  };
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
  runtime.formationAngularSpeed = finiteNumber(squad?._cardFormationAngularSpeed);
  refreshCardLocomotionMetrics({ runtime, agents, nowSec });
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

export const resolveSquadControllerPassageFlowIntent = ({
  squad = null,
  agent = null
} = {}) => {
  const runtime = squad?._squadController;
  if (!runtime || !agent || !isTrainingCardSquad(squad)) return null;
  if (agent?._formationRecovery?.active || agent?._squadController?.rejoin?.active) {
    return null;
  }
  const locomotionState = String(agent?._squadController?.locomotionState || '');
  if (agent?._formationDetached && !isTrainingCardAgentInStream(agent)) return null;
  if (!isTrainingCardAgentInStream(agent) && locomotionState !== CARD_LOCOMOTION_STATE.STREAM_APPROACH) return null;
  return resolveTrainingCardPassageFlowIntent({ squad, agent, runtime });
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
