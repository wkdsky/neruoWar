import {
  clamp,
  estimateLocalFlowWidth,
  isInsideCollider,
  normalizeVec,
  queryObstacleCandidates,
  raycastObstacles,
  resolveObstacleNavigationSignature
} from './crowdPhysics';
import { isTrainingMapTerrainSegmentTraversable } from '../../shared/trainingMap';
import {
  resolveTrainingCardBodyAnchor,
  resolveTrainingCardFormationAnchor,
  resolveTrainingCardNavigationAnchor
} from './TrainingCardSquadBody';

export const CARD_LOCOMOTION_STATE = Object.freeze({
  FORMATION: 'FORMATION',
  STREAM_APPROACH: 'STREAM_APPROACH',
  STREAM: 'STREAM',
  STREAM_EXIT: 'STREAM_EXIT'
});

// Group lifecycle is intentionally independent from per-agent locomotion.
// A stream may have a few agents already exiting while the weighted rear is
// still queued at the entrance; only this state is allowed to complete the
// shared corridor.
export const CARD_PASSAGE_GROUP_STATE = Object.freeze({
  FORMATION: 'FORMATION',
  APPROACH: 'APPROACH',
  COMPRESS: 'COMPRESS',
  FLOW: 'FLOW',
  CLEAR_TAIL: 'CLEAR_TAIL',
  EXPAND: 'EXPAND',
  GROUP_BLOCKED: 'GROUP_BLOCKED'
});

const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const DEFAULT_LANE_GAP = AGENT_GAP * 0.72;
const DEFAULT_PLAN_SCAN_INTERVAL = 0.24;
const DEFAULT_PLAN_RETAIN_INTERVAL = 0.72;
const DEFAULT_APPROACH_DISTANCE = 22;
const DEFAULT_EXIT_CLEAR_DISTANCE = 18;
const DEFAULT_MAX_STREAMS = 12;
const GROUP_OUTLIER_WEIGHT_RATIO = 0.08;
const GROUP_SLOW_WEIGHT_RATIO = 0.1;
const GROUP_BLOCKED_WEIGHT_RATIO = 0.24;
const GROUP_STALL_TIMEOUT = 0.72;
const GROUP_OUTLIER_TIMEOUT = 4.5;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const smoothstep01 = (value = 0) => {
  const t = clamp(finiteNumber(value), 0, 1);
  return t * t * (3 - (2 * t));
};

const distance = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const normalizePoint = (point = {}) => ({
  x: finiteNumber(point?.x),
  y: finiteNumber(point?.y)
});

const normalizeRoute = (start = null, route = []) => {
  const rawRoute = Array.isArray(route) ? route : [];
  const firstRoutePoint = rawRoute.length > 0 ? normalizePoint(rawRoute[0]) : null;
  const points = [];
  if (
    start
    && typeof start === 'object'
    && (!firstRoutePoint || distance(start, firstRoutePoint) > 0.05)
  ) points.push(normalizePoint(start));
  rawRoute.forEach((point) => {
    const next = normalizePoint(point);
    if (points.length <= 0 || distance(points[points.length - 1], next) > 0.05) points.push(next);
  });
  return points;
};

const routesMatch = (left = [], right = []) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((point, index) => distance(point, right[index]) <= 0.05)
);

const buildRouteSegments = (route = []) => {
  const segments = [];
  let progress = 0;
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const length = distance(start, end);
    if (length <= 0.05) continue;
    const tangent = normalizeVec(end.x - start.x, end.y - start.y);
    segments.push({
      start,
      end,
      length,
      startProgress: progress,
      endProgress: progress + length,
      tangent: tangent.len > 0.0001 ? { x: tangent.x, y: tangent.y } : { x: 1, y: 0 }
    });
    progress += length;
  }
  return segments;
};

const pointAtRouteProgress = (plan = {}, progress = 0) => {
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  if (segments.length <= 0) return normalizePoint(plan?.route?.[0]);
  const safeProgress = clamp(finiteNumber(progress), 0, Math.max(0, finiteNumber(plan?.routeLength)));
  const segment = segments.find((entry) => safeProgress <= entry.endProgress + 0.001) || segments[segments.length - 1];
  const local = clamp(
    (safeProgress - segment.startProgress) / Math.max(0.001, segment.length),
    0,
    1
  );
  return {
    x: segment.start.x + ((segment.end.x - segment.start.x) * local),
    y: segment.start.y + ((segment.end.y - segment.start.y) * local)
  };
};

const tangentAtRouteProgress = (plan = {}, progress = 0) => {
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  if (segments.length <= 0) return { x: 1, y: 0 };
  const safeProgress = clamp(finiteNumber(progress), 0, Math.max(0, finiteNumber(plan?.routeLength)));
  const segment = segments.find((entry) => safeProgress <= entry.endProgress + 0.001) || segments[segments.length - 1];
  return segment.tangent;
};

const buildSpineSegments = (spine = []) => {
  const points = Array.isArray(spine) ? spine : [];
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    if (length <= 0.001) continue;
    const tangent = normalizeVec(end.x - start.x, end.y - start.y);
    segments.push({
      start,
      end,
      length,
      startProgress: finiteNumber(start?.progress),
      endProgress: finiteNumber(end?.progress),
      tangent: tangent.len > 0.0001 ? { x: tangent.x, y: tangent.y } : { x: 1, y: 0 }
    });
  }
  return segments;
};

const pointAtSpineProgress = (spine = [], segments = [], progress = 0) => {
  const rows = Array.isArray(segments) ? segments : [];
  if (rows.length <= 0) return normalizePoint(spine?.[0]);
  const safeProgress = clamp(
    finiteNumber(progress),
    finiteNumber(rows[0]?.startProgress),
    finiteNumber(rows[rows.length - 1]?.endProgress)
  );
  const segment = rows.find((entry) => safeProgress <= entry.endProgress + 0.001) || rows[rows.length - 1];
  const span = Math.max(0.001, segment.endProgress - segment.startProgress);
  const local = clamp((safeProgress - segment.startProgress) / span, 0, 1);
  return {
    x: segment.start.x + ((segment.end.x - segment.start.x) * local),
    y: segment.start.y + ((segment.end.y - segment.start.y) * local)
  };
};

const tangentAtSpineProgress = (segments = [], progress = 0) => {
  const rows = Array.isArray(segments) ? segments : [];
  if (rows.length <= 0) return { x: 1, y: 0 };
  const safeProgress = clamp(
    finiteNumber(progress),
    finiteNumber(rows[0]?.startProgress),
    finiteNumber(rows[rows.length - 1]?.endProgress)
  );
  const segment = rows.find((entry) => safeProgress <= entry.endProgress + 0.001) || rows[rows.length - 1];
  return segment.tangent;
};

const buildOffsetSpine = ({ route = [], segments = [], offset = 0 } = {}) => {
  const points = Array.isArray(route) ? route : [];
  if (points.length <= 0) return [];
  const safeOffset = finiteNumber(offset);
  return points.map((point, index) => {
    const previous = segments[Math.max(0, index - 1)] || segments[0] || null;
    const next = segments[Math.min(segments.length - 1, index)] || previous;
    const previousTangent = previous?.tangent || next?.tangent || { x: 1, y: 0 };
    const nextTangent = next?.tangent || previousTangent;
    let joinTangent = normalizeVec(
      finiteNumber(previousTangent?.x) + finiteNumber(nextTangent?.x),
      finiteNumber(previousTangent?.y) + finiteNumber(nextTangent?.y)
    );
    if (joinTangent.len <= 0.0001) joinTangent = normalizeVec(previousTangent?.x, previousTangent?.y);
    const side = { x: -joinTangent.y, y: joinTangent.x };
    const previousSide = { x: -previousTangent.y, y: previousTangent.x };
    const joinAlignment = Math.abs((side.x * previousSide.x) + (side.y * previousSide.y));
    // A true offset miter explodes near a reversal.  A bounded join keeps the
    // lane continuous and leaves legality validation to reject unsafe lanes.
    const miter = clamp(1 / Math.max(0.58, joinAlignment), 1, 1.38);
    const progress = index <= 0
      ? 0
      : finiteNumber(segments[index - 1]?.endProgress);
    return {
      x: finiteNumber(point?.x) + (side.x * safeOffset * miter),
      y: finiteNumber(point?.y) + (side.y * safeOffset * miter),
      progress
    };
  });
};

const isSpineTraversable = ({ spine = [], walls = [], sim = {}, options = {} } = {}) => {
  const segments = buildSpineSegments(spine);
  if (segments.length <= 0) return false;
  const clearance = Math.max(0.5, finiteNumber(options?.agentRadius) + finiteNumber(options?.wallClearance));
  const pointsClear = spine.every((point) => !queryObstacleCandidates(
    walls,
    point?.x,
    point?.y,
    clearance
  ).some((obstacle) => (
    !obstacle?.destroyed && isInsideCollider(point, obstacle, clearance)
  )));
  if (!pointsClear) return false;
  return segments.every((segment) => {
    if (sim?.trainingNavigator?.isSegmentTraversable) {
      return sim.trainingNavigator.isSegmentTraversable(segment.start, segment.end, {
        obstacles: walls,
        radius: clearance
      });
    }
    return !raycastObstacles(segment.start, segment.end, walls, clearance)
      && isTrainingMapTerrainSegmentTraversable(
        sim?.trainingMap,
        segment.start,
        segment.end,
        { field: sim?.field, rampTolerance: Math.min(2.4, finiteNumber(options?.wallClearance) * 0.2) }
      );
  });
};

const buildValidatedStreamGeometry = ({
  route = [],
  segments = [],
  requestedCount = 1,
  laneSpacing = 1,
  walls = [],
  sim = {},
  options = {}
} = {}) => {
  const initialCount = Math.max(1, Math.floor(finiteNumber(requestedCount, 1)));
  for (let count = initialCount; count >= 1; count -= 1) {
    const streams = Array.from({ length: count }, (_, id) => {
      const offset = (id - ((count - 1) * 0.5)) * laneSpacing;
      const spine = buildOffsetSpine({ route, segments, offset });
      return {
        id,
        offset,
        spine,
        spineSegments: buildSpineSegments(spine),
        validatedWidth: Math.max(0, finiteNumber(options?.laneWidth))
      };
    });
    if (streams.every((stream) => isSpineTraversable({ spine: stream.spine, walls, sim, options }))) {
      return streams;
    }
  }
  return [];
};

export const sampleTrainingCardPassageStream = (plan = null, streamId = 0, progress = 0) => {
  if (!plan) return null;
  const streams = Array.isArray(plan?.streams) ? plan.streams : [];
  const index = clamp(Math.floor(finiteNumber(streamId)), 0, Math.max(0, streams.length - 1));
  const stream = streams[index] || null;
  // Plans are squad-level immutable geometry.  The reference check keeps the
  // hot per-agent query O(1), while the signature remains a compatibility
  // fallback for restored plans that do not retain the route reference.
  const spineMatchesRoute = stream?.spineRoute === plan?.route
    || (
      !stream?.spineRoute
      && !!stream?.spineRouteSignature
      && stream.spineRouteSignature === String(plan?.routeSignature || '')
    );
  if (!spineMatchesRoute || !stream?.spine?.length || !stream?.spineSegments?.length) {
    const tangent = tangentAtRouteProgress(plan, progress);
    const side = { x: -tangent.y, y: tangent.x };
    const offset = finiteNumber(stream?.offset, resolvePassageStreamOffset(plan, index));
    const center = pointAtRouteProgress(plan, progress);
    return {
      x: center.x + (side.x * offset),
      y: center.y + (side.y * offset),
      tangent,
      offset
    };
  }
  return {
    ...pointAtSpineProgress(stream.spine, stream.spineSegments, progress),
    tangent: tangentAtSpineProgress(stream.spineSegments, progress),
    offset: finiteNumber(stream?.offset)
  };
};

export const projectPointToPassagePlan = (point = {}, plan = null, preferredProgress = null) => {
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  if (segments.length <= 0) {
    return {
      progress: 0,
      distance: Infinity,
      point: normalizePoint(plan?.route?.[0]),
      tangent: { x: 1, y: 0 },
      lateral: 0
    };
  }
  const target = normalizePoint(point);
  let best = null;
  const hasPreferredProgress = preferredProgress !== null
    && preferredProgress !== undefined
    && Number.isFinite(Number(preferredProgress));
  const preferred = finiteNumber(preferredProgress);
  segments.forEach((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const lengthSq = Math.max(0.0001, (dx * dx) + (dy * dy));
    const local = clamp(
      (((target.x - segment.start.x) * dx) + ((target.y - segment.start.y) * dy)) / lengthSq,
      0,
      1
    );
    const projected = {
      x: segment.start.x + (dx * local),
      y: segment.start.y + (dy * local)
    };
    const offsetX = target.x - projected.x;
    const offsetY = target.y - projected.y;
    const sideX = -segment.tangent.y;
    const sideY = segment.tangent.x;
    const candidate = {
      progress: segment.startProgress + (segment.length * local),
      distance: Math.hypot(offsetX, offsetY),
      point: projected,
      tangent: segment.tangent,
      lateral: (offsetX * sideX) + (offsetY * sideY),
      // U/C/S-shaped routes can place two legal route legs close together in
      // world space. A small longitudinal continuity preference prevents an
      // already streaming agent from teleporting its progress to a different
      // nearby leg; initial planning still uses pure nearest projection.
      continuityScore: Math.hypot(offsetX, offsetY) + (hasPreferredProgress
        ? Math.abs((segment.startProgress + (segment.length * local)) - preferred) * 0.28
        : 0)
    };
    if (!best || candidate.continuityScore < best.continuityScore) best = candidate;
  });
  if (!best) return best;
  const lastSegment = segments[segments.length - 1];
  const beyond = (
    (target.x - lastSegment.end.x) * lastSegment.tangent.x
    + (target.y - lastSegment.end.y) * lastSegment.tangent.y
  );
  if (beyond > 0) {
    best.progress = lastSegment.endProgress + beyond;
  }
  return best;
};

const obstacleSignature = (obstacles = []) => resolveObstacleNavigationSignature(obstacles);

const resolveFieldWidth = (sim = {}) => Math.max(100, finiteNumber(sim?.field?.width, 2700));
const resolveFieldHeight = (sim = {}) => Math.max(100, finiteNumber(sim?.field?.height, 1488));

const resolveFieldSideDistance = (point = {}, side = {}, sim = {}, margin = 0) => {
  const halfWidth = (resolveFieldWidth(sim) * 0.5) - margin;
  const halfHeight = (resolveFieldHeight(sim) * 0.5) - margin;
  const distances = [];
  if (side.x > 0.0001) distances.push((halfWidth - finiteNumber(point?.x)) / side.x);
  if (side.x < -0.0001) distances.push((-halfWidth - finiteNumber(point?.x)) / side.x);
  if (side.y > 0.0001) distances.push((halfHeight - finiteNumber(point?.y)) / side.y);
  if (side.y < -0.0001) distances.push((-halfHeight - finiteNumber(point?.y)) / side.y);
  const valid = distances.filter((value) => Number.isFinite(value) && value >= 0);
  return valid.length > 0 ? Math.min(...valid) : Infinity;
};

const resolveFormationWidth = (squad = {}, spacing = (AGENT_RADIUS * 2) + AGENT_GAP) => {
  const rectWidth = finiteNumber(squad?.formationRect?.width);
  if (rectWidth > spacing) return rectWidth;
  const columns = Math.max(
    1,
    Math.floor(
      finiteNumber(squad?._crowdBaseColumns,
        finiteNumber(squad?.formationRect?.columns, 1))
    )
  );
  return Math.max(spacing, columns * spacing);
};

const resolvePassageOptions = (sim = {}, squad = {}) => {
  const navigation = sim?.trainingMap?.navigation && typeof sim.trainingMap.navigation === 'object'
    ? sim.trainingMap.navigation
    : {};
  const passage = navigation?.passage && typeof navigation.passage === 'object'
    ? navigation.passage
    : {};
  const legacy = navigation?.narrowPassage && typeof navigation.narrowPassage === 'object'
    ? navigation.narrowPassage
    : {};
  const spacing = Math.max(
    (AGENT_RADIUS * 2) + AGENT_GAP,
    finiteNumber(squad?.formationRect?.spacing, (AGENT_RADIUS * 2) + AGENT_GAP)
  );
  const agentRadius = clamp(
    finiteNumber(squad?.navigationAgentRadius, finiteNumber(navigation?.agentRadius, AGENT_RADIUS)),
    1,
    8
  );
  return {
    spacing,
    agentRadius,
    laneWidth: Math.max(
      agentRadius * 2,
      finiteNumber(passage?.laneWidth, (agentRadius * 2) + DEFAULT_LANE_GAP)
    ),
    wallClearance: clamp(
      finiteNumber(
        passage?.wallClearance,
        finiteNumber(
          passage?.pathClearance,
          finiteNumber(
            navigation?.passagePathClearance,
            Number.isFinite(Number(navigation?.pathClearance))
              ? Math.min(Number(navigation.pathClearance), 2.5)
              : 0.75
          )
        )
      ),
      0.25,
      8
    ),
    scanStep: clamp(
      finiteNumber(
        passage?.scanStep,
        Number.isFinite(Number(legacy?.probeStep))
          ? Math.max(4, Number(legacy.probeStep) * 6)
          : Math.max(8, spacing * 1.8)
      ),
      4,
      36
    ),
    maxProbe: clamp(
      finiteNumber(passage?.maxProbe, finiteNumber(legacy?.probeDistance, 256)),
      24,
      768
    ),
    approachDistance: clamp(
      finiteNumber(
        passage?.approachDistance,
        finiteNumber(legacy?.entryDistance, Math.max(DEFAULT_APPROACH_DISTANCE * 1.5, spacing * 4.6))
      ),
      8,
      96
    ),
    exitClearDistance: clamp(
      finiteNumber(passage?.exitClearDistance, Math.max(DEFAULT_EXIT_CLEAR_DISTANCE, spacing * 3.4)),
      8,
      120
    ),
    scanInterval: clamp(finiteNumber(passage?.scanInterval, DEFAULT_PLAN_SCAN_INTERVAL), 0.08, 1.2),
    retainInterval: clamp(finiteNumber(passage?.retainInterval, DEFAULT_PLAN_RETAIN_INTERVAL), 0.2, 3),
    maxStreams: clamp(Math.floor(finiteNumber(passage?.maxStreams, DEFAULT_MAX_STREAMS)), 1, 24)
  };
};

const resolveRouteForSquad = ({ squad = {}, route = null } = {}) => {
  if (Array.isArray(route) && route.length > 0) return route;
  if (Array.isArray(squad?._passageRoute) && squad._passageRoute.length > 0) return squad._passageRoute;
  if (Array.isArray(squad?.waypoints) && squad.waypoints.length > 0) return squad.waypoints;
  const target = squad?.order?.targetPoint;
  return target && typeof target === 'object' ? [target] : [];
};

const resolveStaticPassageRoute = (squad = {}, route = null) => {
  if (Array.isArray(route) && route.length > 0) return route;
  if (Array.isArray(squad?._passagePlanRoute) && squad._passagePlanRoute.length > 0) {
    return squad._passagePlanRoute;
  }
  return resolveRouteForSquad({ squad, route });
};

const resolvePassageRouteGeometry = (squad = {}, route = null) => {
  const staticRoute = Array.isArray(squad?._passagePlanRoute)
    && squad._passagePlanRoute.length > 0
    && (!route || route === squad._passagePlanRoute || routesMatch(route, squad._passagePlanRoute));
  const resolvedRoute = staticRoute
    ? squad._passagePlanRoute
    : resolveStaticPassageRoute(squad, route);
  const routeStart = staticRoute
    ? null
    : (resolveTrainingCardBodyAnchor(squad)
      || resolveTrainingCardNavigationAnchor(squad)
      || squad);
  return {
    staticRoute,
    normalizedRoute: normalizeRoute(routeStart, resolvedRoute)
  };
};

const resolveRouteScale = (squad = {}) => String(squad?._trainingNavigationScale || '').toUpperCase();

const resolveWidthAtPoint = ({ point, tangent, walls, sim, options }) => {
  const side = { x: -tangent.y, y: tangent.x };
  const probe = Math.max(options.maxProbe, resolveFormationWidth({}, options.spacing) * 0.7);
  const fieldMargin = options.agentRadius + options.wallClearance;
  const leftBoundary = resolveFieldSideDistance(point, side, sim, fieldMargin);
  const rightBoundary = resolveFieldSideDistance(point, { x: -side.x, y: -side.y }, sim, fieldMargin);
  const localWidth = estimateLocalFlowWidth(point, tangent, walls, {
    step: clamp(options.spacing * 0.28, 1.5, 8),
    maxProbe: probe,
    inflate: options.agentRadius + options.wallClearance
  });
  const centerBlocked = queryObstacleCandidates(
    walls,
    point?.x,
    point?.y,
    options.agentRadius + options.wallClearance
  ).some((obstacle) => (
    !obstacle?.destroyed
    && isInsideCollider(point, obstacle, options.agentRadius + options.wallClearance)
  ));
  if (centerBlocked) return 0;
  const bounded = Math.min(
    localWidth,
    Number.isFinite(leftBoundary + rightBoundary) ? leftBoundary + rightBoundary : localWidth
  );
  return Math.max(0, bounded);
};

const buildGeometrySignature = ({ route, obstacles, options, formationWidth }) => [
  route.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';'),
  obstacleSignature(obstacles),
  options.agentRadius.toFixed(2),
  options.wallClearance.toFixed(2),
  formationWidth.toFixed(2)
].join('|');

const resolveRouteGeometrySignature = ({ squad = {}, sim = {}, walls = [], route = null } = {}) => {
  const options = resolvePassageOptions(sim, squad);
  const { normalizedRoute } = resolvePassageRouteGeometry(squad, route);
  if (normalizedRoute.length < 2) return { signature: '', route: normalizedRoute, options, formationWidth: 0 };
  const formationWidth = resolveFormationWidth(squad, options.spacing);
  return {
    signature: buildGeometrySignature({
      route: normalizedRoute,
      obstacles: walls,
      options,
      formationWidth
    }),
    route: normalizedRoute,
    options,
    formationWidth
  };
};

const scanRouteWidths = ({ route, walls, sim, options, formationWidth }) => {
  const segments = buildRouteSegments(route);
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (segments.length <= 0 || length <= 0.1) return { segments, length, samples: [] };
  const samples = [];
  const passageClearance = options.agentRadius + options.wallClearance;
  const routeClear = segments.every((segment) => {
    if (sim?.trainingNavigator?.isSegmentTraversable) {
      return sim.trainingNavigator.isSegmentTraversable(segment.start, segment.end, {
        obstacles: walls,
        radius: passageClearance
      });
    }
    return !raycastObstacles(
      segment.start,
      segment.end,
      walls,
      passageClearance
    ) && isTrainingMapTerrainSegmentTraversable(
      sim?.trainingMap,
      segment.start,
      segment.end,
      { field: sim?.field, rampTolerance: Math.min(2.4, options.wallClearance * 0.2) }
    );
  });
  const count = clamp(Math.ceil(length / options.scanStep), 2, 96);
  for (let index = 0; index <= count; index += 1) {
    const progress = length * (index / count);
    const segment = segments.find((entry) => progress <= entry.endProgress + 0.001) || segments[segments.length - 1];
    const tangent = segment.tangent;
    const point = pointAtRouteProgress({ segments, routeLength: length }, progress);
    const width = resolveWidthAtPoint({ point, tangent, walls, sim, options, formationWidth });
    samples.push({ progress, point, tangent, width });
  }
  return { segments, length, samples, routeClear };
};

const resolveNarrowThreshold = (formationWidth, options) => Math.max(
  options.laneWidth * 0.95,
  formationWidth * 0.9
);

const chooseNarrowSegment = ({
  samples,
  formationWidth,
  options,
  routeScale,
  minimumProgress = 0
}) => {
  if (!Array.isArray(samples) || samples.length <= 0) return null;
  const threshold = resolveNarrowThreshold(formationWidth, options);
  const runs = [];
  let current = [];
  samples.forEach((sample) => {
    const eligible = sample.width < threshold
      || (routeScale === 'PASSAGE' && sample.width < formationWidth * 1.12);
    const viable = eligible && sample.width >= options.laneWidth * 0.82;
    if (!viable) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push(sample);
  });
  if (current.length > 0) runs.push(current);
  if (runs.length <= 0) return null;
  // The first viable run is the next bottleneck the squad will encounter.
  // Choosing the globally narrowest run would let a distant gate claim the
  // plan and make the squad compress before it reaches the nearer one.
  const relevantRuns = runs.filter((run) => (
    run[run.length - 1].progress >= minimumProgress - options.exitClearDistance
  ));
  if (relevantRuns.length <= 0) return null;
  const selected = relevantRuns
    .slice()
    .sort((left, right) => left[0].progress - right[0].progress)[0];
  const narrowest = selected.reduce((best, sample) => (!best || sample.width < best.width ? sample : best), null);
  const minProgress = selected[0].progress;
  const maxProgress = selected[selected.length - 1].progress;
  const approach = Math.max(options.approachDistance, options.scanStep * 1.5);
  const exit = Math.max(options.exitClearDistance, options.scanStep * 1.5);
  return {
    startProgress: Math.max(0, minProgress - approach),
    bottleneckStartProgress: minProgress,
    bottleneckEndProgress: maxProgress,
    endProgress: maxProgress + Math.max(exit * 2.4, options.scanStep * 3),
    minimumWidth: narrowest.width,
    usableWidth: Math.max(options.agentRadius * 2, narrowest.width),
    narrowestProgress: narrowest.progress,
    direction: narrowest.tangent,
    center: narrowest.point
  };
};

const resolveStreamCount = ({ usableWidth, options }) => clamp(
  Math.max(1, Math.floor((Math.max(0, usableWidth) + (options.laneWidth * 0.18)) / options.laneWidth)),
  1,
  options.maxStreams
);

export const resolvePassageStreamCount = ({ usableWidth = 0, agentRadius = AGENT_RADIUS, agentGap = AGENT_GAP } = {}) => {
  const laneWidth = Math.max(1, (Math.max(0.5, Number(agentRadius) || AGENT_RADIUS) * 2) + (Math.max(0, Number(agentGap) || AGENT_GAP) * 0.72));
  return clamp(Math.max(1, Math.floor((Math.max(0, Number(usableWidth) || 0) + (laneWidth * 0.18)) / laneWidth)), 1, DEFAULT_MAX_STREAMS);
};

export const createTrainingCardPassagePlan = ({
  squad = null,
  sim = {},
  walls = [],
  route = null,
  nowSec = 0,
  previousPlan = null,
  force = false,
  minimumProgress = 0
} = {}) => {
  if (!squad) return null;
  const options = resolvePassageOptions(sim, squad);
  const { normalizedRoute } = resolvePassageRouteGeometry(squad, route);
  if (normalizedRoute.length < 2) return null;
  const formationWidth = resolveFormationWidth(squad, options.spacing);
  const geometrySignature = buildGeometrySignature({
    route: normalizedRoute,
    obstacles: walls,
    options,
    formationWidth
  });
  // `endProgress` intentionally includes a generous reformation envelope.
  // Keeping a completed plan alive until the rear reaches that envelope makes
  // two nearby gates look like one indefinitely: the normal formation reaches
  // the next gate while the old plan is still reporting EXPAND.  The shared
  // tail is authoritative instead; once it has cleared the actual passage
  // progress, select the next bottleneck from the same route.
  const previousPlanStillRelevant = !previousPlan
    || finiteNumber(previousPlan?.clearProgress, previousPlan?.endProgress)
      >= finiteNumber(minimumProgress) - Math.max(0.5, options.scanStep * 0.18);
  if (
    !force
    && previousPlan
    && previousPlan.geometrySignature === geometrySignature
    && previousPlanStillRelevant
  ) {
    return { ...previousPlan, lastValidatedAt: nowSec };
  }
  const scan = scanRouteWidths({
    route: normalizedRoute,
    walls,
    sim,
    options,
    formationWidth
  });
  if (scan.routeClear === false) return null;
  const segment = chooseNarrowSegment({
    samples: scan.samples,
    formationWidth,
    options,
    routeScale: resolveRouteScale(squad),
    minimumProgress
  });
  if (!segment) return null;
  const requestedStreamCount = resolveStreamCount({ usableWidth: segment.usableWidth, options });
  const laneSpacing = Math.max(options.agentRadius * 2.05, options.laneWidth);
  const clearProgress = segment.bottleneckEndProgress + options.exitClearDistance;
  const reformationDistance = Math.max(options.exitClearDistance * 1.4, options.scanStep * 2);
  const id = Math.max(
    1,
    Math.floor(finiteNumber(previousPlan?.id, finiteNumber(squad?._passagePlanSequence, 0))) + 1
  );
  const streams = buildValidatedStreamGeometry({
    route: normalizedRoute,
    segments: scan.segments,
    requestedCount: requestedStreamCount,
    laneSpacing,
    walls,
    sim,
    options
  });
  // The centre route was already validated above.  If an outer offset lane
  // cannot round a corner safely, shrink the plan once at creation time rather
  // than emitting a lane that will clip a wall or changing lane count per
  // frame while agents are inside it.
  if (streams.length <= 0) return null;
  const streamCount = streams.length;
  const routeSignature = normalizedRoute.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';');
  streams.forEach((stream) => {
    stream.spineRoute = normalizedRoute;
    stream.spineRouteSignature = routeSignature;
  });
  const plan = {
    id,
    route: normalizedRoute,
    segments: scan.segments,
    routeLength: scan.length,
    entry: pointAtRouteProgress({ segments: scan.segments, routeLength: scan.length }, segment.startProgress),
    exit: pointAtRouteProgress({ segments: scan.segments, routeLength: scan.length }, Math.min(scan.length, segment.endProgress)),
    center: segment.center,
    direction: {
      x: segment.direction.x,
      y: segment.direction.y
    },
    narrowest: {
      progress: segment.narrowestProgress,
      point: { ...segment.center },
      width: segment.minimumWidth
    },
    directionX: segment.direction.x,
    directionY: segment.direction.y,
    startProgress: segment.startProgress,
    bottleneckStartProgress: segment.bottleneckStartProgress,
    bottleneckEndProgress: segment.bottleneckEndProgress,
    bottleneck: {
      startProgress: segment.bottleneckStartProgress,
      endProgress: segment.bottleneckEndProgress,
      center: { ...segment.center },
      minimumWidth: segment.minimumWidth,
      usableWidth: segment.usableWidth
    },
    endProgress: Math.min(scan.length, Math.max(segment.endProgress, clearProgress + reformationDistance)),
    usableWidth: segment.usableWidth,
    minimumWidth: segment.minimumWidth,
    streamCount,
    requestedStreamCount,
    streamSpacing: laneSpacing,
    streams,
    laneWidth: options.laneWidth,
    wallClearance: options.wallClearance,
    approachDistance: options.approachDistance,
    exitClearDistance: options.exitClearDistance,
    clearProgress: Math.min(scan.length, clearProgress),
    reformationDistance,
    geometrySignature,
    routeSignature,
    createdAt: previousPlan ? finiteNumber(previousPlan.createdAt, nowSec) : nowSec,
    lastValidatedAt: nowSec,
    valid: true,
    draining: false,
    routeScale: resolveRouteScale(squad)
  };
  squad._passagePlanSequence = Math.max(
    Math.floor(finiteNumber(squad?._passagePlanSequence, 0)),
    id
  );
  return plan;
};

const clearAgentPassageState = (agent = {}) => {
  const state = agent?._squadController;
  if (!state || typeof state !== 'object') return;
  state.locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
  state.passageFlowActive = false;
  state.passageId = 0;
  state.streamId = null;
  state.passageProgress = 0;
  state.passageLateral = 0;
  state.passageForwardX = 0;
  state.passageForwardY = 0;
  state.passageExitProgress = 0;
  state.passageEnteredAt = 0;
  state.passageSignature = '';
  state.passageCompletedId = 0;
  state.passageCompletedSignature = '';
  state.passageCompletedAt = 0;
  state.streamWatchdog = null;
};

const assignStream = ({ agent, plan, projection, reuseExisting = false }) => {
  const state = agent?._squadController || {};
  const existing = Number.isFinite(Number(state?.streamId)) ? Math.floor(Number(state.streamId)) : -1;
  if (reuseExisting && existing >= 0 && existing < plan.streamCount) return existing;
  const streams = Array.isArray(plan?.streams) ? plan.streams : [];
  if (streams.length > 0) {
    return streams.reduce((bestId, stream, index) => {
      const bestSample = sampleTrainingCardPassageStream(plan, bestId, projection.progress);
      const candidateSample = sampleTrainingCardPassageStream(plan, index, projection.progress);
      const bestDistance = bestSample
        ? Math.hypot(finiteNumber(agent?.x) - bestSample.x, finiteNumber(agent?.y) - bestSample.y)
        : Math.abs(finiteNumber(streams[bestId]?.offset) - projection.lateral);
      const candidateDistance = candidateSample
        ? Math.hypot(finiteNumber(agent?.x) - candidateSample.x, finiteNumber(agent?.y) - candidateSample.y)
        : Math.abs(finiteNumber(stream?.offset) - projection.lateral);
      return candidateDistance < bestDistance
        ? index
        : bestId;
    }, 0);
  }
  const ratio = plan.usableWidth > 0
    ? clamp((projection.lateral / Math.max(0.1, plan.usableWidth)) + 0.5, 0, 1)
    : 0.5;
  return clamp(Math.round(ratio * Math.max(0, plan.streamCount - 1)), 0, plan.streamCount - 1);
};

export const resolvePassageStreamOffset = (plan = null, streamId = 0) => {
  if (!plan) return 0;
  const count = Math.max(1, Math.floor(finiteNumber(plan?.streamCount, 1)));
  const lane = clamp(Math.floor(finiteNumber(streamId)), 0, count - 1);
  const storedOffset = Number(plan?.streams?.[lane]?.offset);
  if (Number.isFinite(storedOffset)) return storedOffset;
  return (lane - ((count - 1) * 0.5)) * Math.max(0.1, finiteNumber(plan?.streamSpacing, 1));
};

const resolveFormationLateralAtProjection = ({
  squad = null,
  agent = null,
  projection = null,
  routeSide = null
} = {}) => {
  const formationSlot = agent?._squadController?.normalSlot || agent?.formationSlot || {};
  const fallback = finiteNumber(formationSlot?.side);
  if (!squad || !projection?.point || !routeSide) return fallback;
  const formationForward = normalizeVec(
    finiteNumber(squad?._crowdFormationForward?.x, finiteNumber(squad?._crowdForward?.x, squad?.dirX)),
    finiteNumber(squad?._crowdFormationForward?.y, finiteNumber(squad?._crowdForward?.y, squad?.dirY))
  );
  if (formationForward.len <= 0.0001) return fallback;
  const formationSide = { x: -formationForward.y, y: formationForward.x };
  const formationAnchor = resolveTrainingCardFormationAnchor(squad)
    || resolveTrainingCardBodyAnchor(squad)
    || squad;
  const slotX = finiteNumber(formationAnchor?.x, finiteNumber(squad?.x))
    + (formationForward.x * finiteNumber(formationSlot?.front))
    + (formationSide.x * finiteNumber(formationSlot?.side));
  const slotY = finiteNumber(formationAnchor?.y, finiteNumber(squad?.y))
    + (formationForward.y * finiteNumber(formationSlot?.front))
    + (formationSide.y * finiteNumber(formationSlot?.side));
  return ((slotX - projection.point.x) * routeSide.x)
    + ((slotY - projection.point.y) * routeSide.y);
};

export const updateTrainingCardPassageAgents = ({
  squad = null,
  agents = [],
  plan = null,
  nowSec = 0
} = {}) => {
  const rows = [];
  const liveAgents = (Array.isArray(agents) ? agents : []).filter((agent) => (
    // A flag bearer is still a movement representative.  Excluding it made
    // a real weight disappear from stream/tail completion accounting.
    agent && !agent.dead && finiteNumber(agent.weight, 1) > 0.001
  ));
  liveAgents.forEach((agent) => {
    if (!agent._squadController || typeof agent._squadController !== 'object') agent._squadController = {};
    const state = agent._squadController;
    if (!plan) {
      clearAgentPassageState(agent);
      rows.push({
        agent,
        state: CARD_LOCOMOTION_STATE.FORMATION,
        projection: null,
        completedCurrentPassage: false
      });
      return;
    }
    const planId = Math.floor(finiteNumber(plan?.id));
    const planSignature = String(plan?.geometrySignature || '');
    const samePassage = Math.floor(finiteNumber(state?.passageId)) === planId
      && (!planSignature || !state?.passageSignature || state.passageSignature === planSignature);
    const projection = projectPointToPassagePlan(
      agent,
      plan,
      samePassage ? state?.passageProgress : null
    );
    const previousState = String(state?.locomotionState || CARD_LOCOMOTION_STATE.FORMATION);
    const wasInPlan = Math.floor(finiteNumber(state?.passageId)) === planId
      && isPassageState(previousState);
    const wasInPassage = samePassage && isPassageState(previousState);
    const completedCurrentPassage = Math.floor(finiteNumber(state?.passageCompletedId))
      === planId
      && (!planSignature || state?.passageCompletedSignature === planSignature);
    let locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
    const routeEndpointReached = projection.progress >= Math.max(
      plan.bottleneckEndProgress + (plan.exitClearDistance * 0.45),
      finiteNumber(plan?.routeLength) - Math.max(0.75, plan.streamSpacing * 0.18)
    );
    const pastExit = projection.progress > plan.endProgress + 0.1 || routeEndpointReached;
    const routeSide = { x: -projection.tangent.y, y: projection.tangent.x };
    const formationNeighborhood = pastExit && Math.abs(
      projection.lateral - resolveFormationLateralAtProjection({
        squad,
        agent,
        projection,
        routeSide
      })
    ) <= Math.max(
      plan.streamSpacing * 1.8,
      plan.usableWidth * 0.42
    );
    const routeProximity = projection.distance <= Math.max(
      plan.approachDistance * 1.7,
      plan.usableWidth * 0.85,
      plan.streamSpacing * 3
    );
    const clearExit = pastExit && (
      formationNeighborhood
      || projection.progress > plan.endProgress + Math.max(
        plan.reformationDistance,
        plan.streamSpacing * 2
      )
      || routeEndpointReached
    );
    if (plan.draining === true) {
      // A destroyed/opened bottleneck should drain the agents already in it
      // through STREAM_EXIT instead of snapping everybody straight back to a
      // formation slot.  New arrivals stay in normal formation because the
      // shared soldier-scale passage is no longer needed.
      locomotionState = wasInPlan && !clearExit
        ? CARD_LOCOMOTION_STATE.STREAM_EXIT
        : CARD_LOCOMOTION_STATE.FORMATION;
    } else if (clearExit && (previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT || previousState === CARD_LOCOMOTION_STATE.FORMATION)) {
      // Once an agent has cleared the exit, keep it in the normal formation
      // controller.  Without this hysteresis an already-cleared member would
      // be classified as STREAM_EXIT again on every frame while the tail was
      // still inside the passage, preventing the shared plan from draining.
      locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
    } else if (completedCurrentPassage && previousState === CARD_LOCOMOTION_STATE.FORMATION) {
      locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
    } else if (!wasInPassage && !completedCurrentPassage && !routeProximity) {
      locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
    } else if (projection.progress >= plan.startProgress && projection.progress < plan.bottleneckStartProgress) {
      locomotionState = CARD_LOCOMOTION_STATE.STREAM_APPROACH;
    } else if (
      projection.progress >= plan.bottleneckStartProgress
      && projection.progress <= plan.bottleneckEndProgress + (plan.exitClearDistance * 0.45)
    ) {
      locomotionState = CARD_LOCOMOTION_STATE.STREAM;
    } else if (
      projection.progress > plan.bottleneckEndProgress + (plan.exitClearDistance * 0.45)
      || (previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT && projection.progress > plan.endProgress)
    ) {
      locomotionState = CARD_LOCOMOTION_STATE.STREAM_EXIT;
    }
    if (
      locomotionState === CARD_LOCOMOTION_STATE.FORMATION
      && wasInPassage
      && !completedCurrentPassage
      && !clearExit
    ) {
      locomotionState = previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT
        ? CARD_LOCOMOTION_STATE.STREAM_EXIT
        : CARD_LOCOMOTION_STATE.STREAM_APPROACH;
    }
    if (
      plan.draining !== true
      && previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT
      && projection.progress <= plan.endProgress
    ) {
      locomotionState = CARD_LOCOMOTION_STATE.STREAM_EXIT;
    }
    const enteringPassage = locomotionState !== CARD_LOCOMOTION_STATE.FORMATION;
    if (!enteringPassage) {
      if (clearExit) {
        state.passageCompletedId = planId;
        state.passageCompletedSignature = planSignature;
        state.passageCompletedAt = nowSec;
      }
      state.locomotionState = CARD_LOCOMOTION_STATE.FORMATION;
      state.passageFlowActive = false;
      state.passageId = 0;
      state.streamId = null;
      state.passageProgress = projection.progress;
      state.passageLateral = projection.lateral;
      state.passageForwardX = 0;
      state.passageForwardY = 0;
      state.passageExitProgress = 0;
      state.passageEnteredAt = 0;
      state.streamWatchdog = null;
      rows.push({
        agent,
        state: locomotionState,
        projection,
        streamId: null,
        completedCurrentPassage: clearExit
      });
      return;
    }
    const streamId = assignStream({
      agent,
      plan,
      projection,
      reuseExisting: wasInPassage || (plan.draining === true && wasInPlan)
    });
    const streamSample = sampleTrainingCardPassageStream(plan, streamId, projection.progress);
    const streamForward = normalizeVec(streamSample?.tangent?.x, streamSample?.tangent?.y);
    state.locomotionState = locomotionState;
    state.passageFlowActive = true;
    state.passageId = planId;
    state.passageSignature = planSignature;
    state.streamId = streamId;
    state.passageProgress = projection.progress;
    state.passageLateral = projection.lateral;
    state.passageForwardX = streamForward.len > 0.0001 ? streamForward.x : projection.tangent.x;
    state.passageForwardY = streamForward.len > 0.0001 ? streamForward.y : projection.tangent.y;
    state.passageExitProgress = plan.endProgress;
    state.passageEnteredAt = wasInPassage ? (state.passageEnteredAt || nowSec) : nowSec;
    if (!wasInPassage && !(plan.draining === true && wasInPlan)) state.streamWatchdog = null;
    if (agent?._formationRecovery?.active !== true && state?.rejoin?.active !== true) {
      agent._formationDetached = false;
    }
    rows.push({
      agent,
      state: locomotionState,
      projection,
      streamId,
      completedCurrentPassage: false
    });
  });
  return rows;
};

const passageParticipantWeight = (agent = null) => Math.max(0, finiteNumber(agent?.weight, 1));

const isPassageParticipant = (agent = null) => (
  !!agent && !agent.dead && passageParticipantWeight(agent) > 0.001
);

const weightedPassagePercentile = (rows = [], ratio = 0.5, key = 'progress') => {
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

const isPassageDetachedAgent = (agent = null) => (
  agent?._formationDetached === true
  || agent?._formationRecovery?.active === true
  || agent?._squadController?.rejoin?.active === true
);

const resolvePassageTailAllowance = ({ squad = null, rows = [], options = {} } = {}) => {
  const spacing = Math.max(AGENT_RADIUS * 2, finiteNumber(options?.spacing, (AGENT_RADIUS * 2) + AGENT_GAP));
  const squadDepth = Math.max(0, finiteNumber(squad?.formationRect?.depth));
  const slotDepth = (Array.isArray(rows) ? rows : []).reduce((maximum, row) => (
    Math.max(maximum, Math.max(0, -finiteNumber(row?.agent?.formationSlot?.front)))
  ), 0);
  return clamp(
    Math.max(spacing * 2, (slotDepth || squadDepth) + (spacing * 1.1), squadDepth * 0.72),
    spacing * 2,
    96
  );
};

const clearPassageOutlier = (agent = null) => {
  if (!agent?._squadController || typeof agent._squadController !== 'object') return;
  delete agent._squadController.passageOutlier;
  delete agent._squadController.passageOutlierCandidateSince;
};

/**
 * A passage outlier is deliberately a very narrow exception.  A detached
 * member cannot merely declare itself irrelevant: it must be isolated far
 * from the real body for a sustained interval, and all ignored troop weight
 * is capped below GROUP_OUTLIER_WEIGHT_RATIO.  This prevents a whole blocked
 * flank from disappearing into individual recovery.
 */
const classifyPassageOutliers = ({
  rows = [],
  plan = null,
  totalWeight = 0,
  body = null,
  nowSec = 0,
  options = {}
} = {}) => {
  const planId = Math.floor(finiteNumber(plan?.id));
  const signature = String(plan?.geometrySignature || '');
  const allowedWeight = Math.max(0, totalWeight * GROUP_OUTLIER_WEIGHT_RATIO);
  const bodyPoint = body || {};
  const baseIsolationDistance = Math.max(
    64,
    finiteNumber(plan?.reformationDistance) * 1.6,
    finiteNumber(options?.exitClearDistance) * 3
  );
  const included = new Set();
  let outlierWeight = 0;
  const stableRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.agent)
    .slice()
    .sort((left, right) => String(left?.agent?.id || '').localeCompare(String(right?.agent?.id || '')));

  // Preserve a qualified outlier only while it remains a small, detached,
  // physically distant exception. The proof survives a harmless passage-plan
  // rollover; otherwise a 1% soldier can complete one gate and immediately
  // force the whole squad to plan the same gate again from its old position.
  stableRows.forEach((row) => {
    const agent = row?.agent;
    const state = agent?._squadController || {};
    const outlier = state?.passageOutlier;
    const isolationDistance = Math.max(
      baseIsolationDistance,
      finiteNumber(outlier?.isolationDistance)
    );
    const farFromBody = distance(agent, bodyPoint) >= isolationDistance;
    const weight = passageParticipantWeight(agent);
    if (outlier?.active === true && isPassageDetachedAgent(agent) && farFromBody && outlierWeight + weight <= allowedWeight + 0.001) {
      included.add(agent);
      outlierWeight += weight;
    } else if (outlier || Number.isFinite(Number(state?.passageOutlierCandidateSince))) {
      clearPassageOutlier(agent);
    }
  });

  if (!plan) return included;

  // Sorting makes the tiny exception deterministic instead of depending on the
  // agent iteration order.  No candidate can be marked until it has remained
  // detached and isolated for GROUP_OUTLIER_TIMEOUT seconds.
  stableRows
    .filter((row) => !included.has(row.agent))
    .forEach((row) => {
      const agent = row.agent;
      if (!isPassageDetachedAgent(agent)) {
        clearPassageOutlier(agent);
        return;
      }
      const weight = passageParticipantWeight(agent);
      const farFromBody = distance(agent, bodyPoint) >= baseIsolationDistance;
      const state = agent._squadController && typeof agent._squadController === 'object'
        ? agent._squadController
        : (agent._squadController = {});
      if (!farFromBody || weight > allowedWeight + 0.001 || outlierWeight + weight > allowedWeight + 0.001) {
        delete state.passageOutlierCandidateSince;
        return;
      }
      const candidateSince = finiteNumber(state?.passageOutlierCandidateSince);
      state.passageOutlierCandidateSince = candidateSince > 0 ? candidateSince : nowSec;
      if (nowSec - state.passageOutlierCandidateSince < GROUP_OUTLIER_TIMEOUT) return;
      state.passageOutlier = {
        active: true,
        passageId: planId,
        signature,
        routeSignature: String(plan?.routeSignature || ''),
        isolationDistance: baseIsolationDistance,
        markedAt: nowSec
      };
      included.add(agent);
      outlierWeight += weight;
    });
  return included;
};

/**
 * Weighted group-level passage progress.  Per-agent stream state is useful
 * for steering, but it is never the authority for passage completion: every
 * alive representative remains in the body/rear/tail statistics unless it
 * passed the deliberately tiny outlier classifier above.
 */
export const resolveTrainingCardPassageGroupProgress = ({
  squad = null,
  agents = [],
  rows = [],
  plan = null,
  routeProjectionPlan = null,
  previous = null,
  nowSec = 0,
  options = {}
} = {}) => {
  const byAgent = new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.agent, row]));
  const projectionPlan = plan || routeProjectionPlan;
  const progressRouteSignature = (Array.isArray(projectionPlan?.route) ? projectionPlan.route : [])
    .map((point) => `${finiteNumber(point?.x).toFixed(2)},${finiteNumber(point?.y).toFixed(2)}`)
    .join(';');
  const hasProgressRoute = Array.isArray(projectionPlan?.segments)
    && projectionPlan.segments.length > 0;
  const participantRows = (Array.isArray(agents) ? agents : [])
    .filter(isPassageParticipant)
    .map((agent) => {
      const row = byAgent.get(agent) || null;
      const state = agent?._squadController || {};
      const samePassage = !!plan
        && Math.floor(finiteNumber(state?.passageId)) === Math.floor(finiteNumber(plan?.id))
        && (!plan?.geometrySignature || !state?.passageSignature || state.passageSignature === plan.geometrySignature);
      const projection = row?.projection || (projectionPlan
        ? projectPointToPassagePlan(agent, projectionPlan, samePassage ? state?.passageProgress : null)
        : null);
      const terrainBlockedAt = finiteNumber(agent?._terrainBlockedAt);
      const blockedRecently = terrainBlockedAt > 0 && nowSec - terrainBlockedAt <= 0.9;
      const solverMode = String(state?.locomotionDebug?.mode || '');
      // A bounded MARCH_ELASTIC offset is deliberately a local formation
      // deformation, not evidence that the shared route has failed.  Passage
      // still owns stream collisions/watchdogs, and true route blockage still
      // escalates through them; this prevents one bypassable flank tower from
      // turning a whole open formation into GROUP_BLOCKED.
      const locallyElastic = solverMode === 'MARCH_ELASTIC'
        || solverMode === 'FORM_UP'
        || solverMode === 'REFORM';
      return {
        agent,
        row,
        projection,
        progress: finiteNumber(projection?.progress),
        weight: passageParticipantWeight(agent),
        detached: isPassageDetachedAgent(agent),
        terrainBlocked: !locallyElastic && (blockedRecently || agent?._nextFormationStepIllegal === true),
        streamBlocked: state?.streamWatchdog?.stalled === true,
        completedCurrentPassage: row?.completedCurrentPassage === true
      };
    });
  const totalWeight = participantRows.reduce((sum, row) => sum + row.weight, 0);
  const body = resolveTrainingCardBodyAnchor(squad) || squad || {};
  const outliers = classifyPassageOutliers({
    rows: participantRows,
    plan,
    totalWeight,
    body,
    nowSec,
    options
  });
  const trackedRows = participantRows.filter((row) => !outliers.has(row.agent));
  const statisticsRows = trackedRows.length > 0 ? trackedRows : participantRows;
  const trackedWeight = statisticsRows.reduce((sum, row) => sum + row.weight, 0);
  const rearProgress = weightedPassagePercentile(statisticsRows, 0.1);
  const tailProgress = weightedPassagePercentile(statisticsRows, 0.05);
  const bodyProgress = weightedPassagePercentile(statisticsRows, 0.5);
  const frontProgress = weightedPassagePercentile(statisticsRows, 0.9);
  const detachedWeight = participantRows
    .filter((row) => row.detached)
    .reduce((sum, row) => sum + row.weight, 0);
  const outlierWeight = participantRows
    .filter((row) => outliers.has(row.agent))
    .reduce((sum, row) => sum + row.weight, 0);
  const clearTolerance = Math.max(0.5, finiteNumber(plan?.streamSpacing) * 0.18);
  const nominalClearProgress = Math.max(0, finiteNumber(plan?.clearProgress, plan?.endProgress) - clearTolerance);
  const tailAllowance = resolvePassageTailAllowance({ squad, rows: participantRows, options });
  const routeLength = Math.max(0, finiteNumber(plan?.routeLength));
  const endpointLeavesNoReformRoom = routeLength > 0
    && routeLength - nominalClearProgress <= tailAllowance * 0.55;
  // A destination immediately after the final choke cannot fit the entire
  // formation beyond the nominal exit-clear distance.  Keep every real member
  // in the tail test, but use the last physically achievable rear gate rather
  // than declaring a permanent GROUP_BLOCKED at an endpoint.
  const clearProgress = endpointLeavesNoReformRoom
    ? Math.max(
      finiteNumber(plan?.bottleneckStartProgress),
      routeLength - tailAllowance
    )
    : nominalClearProgress;
  const pendingRows = plan
    ? statisticsRows.filter((row) => row.progress < clearProgress)
    : [];
  const behindGateWeight = pendingRows.reduce((sum, row) => sum + row.weight, 0);
  // A detached agent is material tail mass, but it is not itself proof of a
  // topology failure: a true small rejoiner may still be making progress.
  // Escalate direct blockage only from collision/stream evidence; the stalled
  // tail path below still catches a detached mass that cannot follow.
  const directBlockCandidates = plan ? pendingRows : statisticsRows;
  const directBlockedWeight = directBlockCandidates
    .filter((row) => row.terrainBlocked || row.streamBlocked)
    .reduce((sum, row) => sum + row.weight, 0);
  const navigationAnchor = resolveTrainingCardNavigationAnchor(squad) || body;
  const navigationProjection = plan
    ? projectPointToPassagePlan(navigationAnchor, plan)
    : null;
  const navigationProgress = finiteNumber(navigationProjection?.progress, bodyProgress);
  const maximumAnchorLead = Math.max(
    finiteNumber(body?.maxAnchorLead),
    finiteNumber(options?.spacing) * 2.25,
    1
  );
  const navigationLead = Math.max(0, navigationProgress - bodyProgress);
  const cursorAtRouteEnd = !!plan && navigationProgress >= Math.max(
    0,
    routeLength - Math.max(0.6, finiteNumber(plan?.streamSpacing) * 0.24)
  );
  const cursorLeadSaturated = !!plan && (
    cursorAtRouteEnd
    || navigationLead >= maximumAnchorLead - Math.max(0.6, finiteNumber(options?.spacing) * 0.18)
  );
  const samePlan = !!plan
    && Math.floor(finiteNumber(previous?.passageId)) === Math.floor(finiteNumber(plan?.id))
    && (!plan?.geometrySignature || previous?.signature === plan.geometrySignature);
  const sameProgressContext = plan
    ? samePlan
    : (!!progressRouteSignature && previous?.routeSignature === progressRouteSignature);
  const progressEpsilon = Math.max(0.12, finiteNumber(options?.spacing) * 0.025);
  const madeProgress = !sameProgressContext
    || bodyProgress >= finiteNumber(previous?.bodyProgress) + progressEpsilon
    || rearProgress >= finiteNumber(previous?.rearProgress) + (progressEpsilon * 0.6);
  const lastProgressAt = madeProgress || !Number.isFinite(Number(previous?.lastProgressAt))
    ? nowSec
    : finiteNumber(previous?.lastProgressAt);
  const stallFor = Math.max(0, nowSec - lastProgressAt);
  const touchDistance = Math.max(
    finiteNumber(options?.spacing) * 1.5,
    finiteNumber(plan?.approachDistance) * 0.28
  );
  // startProgress includes the pre-compression approach and can legitimately
  // be zero when a long obstacle begins near the route source.  A queue is a
  // group-level stall only once the weighted body/front has reached the real
  // bottleneck mouth (or terrain has already reported a collision).
  const mouthProgress = Math.max(
    finiteNumber(plan?.startProgress),
    finiteNumber(plan?.bottleneckStartProgress) - touchDistance
  );
  const touchingPassage = !!plan && (
    frontProgress >= mouthProgress
    || bodyProgress >= mouthProgress
    || directBlockedWeight > 0
  );
  // A stationary rear is not itself a topology failure: it may simply be
  // catching an anchor that has not yet spent its legal lead.  Escalate the
  // whole squad only after the cursor has either reached that lead cap (or the
  // route end) and material mass still cannot follow it.  Direct collision /
  // stream-watchdog evidence remains independently meaningful.
  const stalledBlockedWeight = touchingPassage
    && cursorLeadSaturated
    && stallFor >= Math.min(0.18, GROUP_STALL_TIMEOUT * 0.35)
    ? behindGateWeight
    : 0;
  const blockedWeight = Math.max(directBlockedWeight, stalledBlockedWeight);
  const blockedRatio = blockedWeight / Math.max(0.001, trackedWeight);
  const directBlockedRatio = directBlockedWeight / Math.max(0.001, trackedWeight);
  const detachedWeightRatio = detachedWeight / Math.max(0.001, totalWeight);
  const tailPending = !!plan && pendingRows.length > 0;
  const materiallyDirectBlocked = directBlockedRatio >= GROUP_BLOCKED_WEIGHT_RATIO;
  const previousDirectBlockedSince = Number(previous?.directBlockedSince);
  const fallbackDirectBlockedSince = Number(previous?.lastProgressAt);
  const directBlockedSince = materiallyDirectBlocked
    ? (sameProgressContext
      ? (Number.isFinite(previousDirectBlockedSince)
        ? previousDirectBlockedSince
        : (Number.isFinite(fallbackDirectBlockedSince) ? fallbackDirectBlockedSince : nowSec))
      : nowSec)
    : 0;
  const directBlockedFor = materiallyDirectBlocked
    ? Math.max(0, nowSec - directBlockedSince)
    : 0;
  const persistentDirectBlock = materiallyDirectBlocked && directBlockedFor >= GROUP_STALL_TIMEOUT;
  const groupBlocked = !!plan
    && tailPending
    && (
      persistentDirectBlock
      || (
        cursorLeadSaturated
        && stallFor >= GROUP_STALL_TIMEOUT
        && blockedRatio >= GROUP_BLOCKED_WEIGHT_RATIO
      )
    );
  // The same authority also protects a formation-scale route before it has
  // become a formal PassagePlan.  A material share repeatedly colliding with
  // terrain cannot be hidden behind a still-moving P50/front; halt the
  // bounded cursor and spend the next navigation budget on a group replan.
  const routeGroupBlocked = !plan
    && hasProgressRoute
    && persistentDirectBlock;
  const groupLevelBlocked = groupBlocked || routeGroupBlocked;
  const slowRatio = Math.max(
    blockedRatio,
    (touchingPassage || !plan) ? detachedWeightRatio : 0
  );
  const anchorSpeedScale = groupLevelBlocked
    ? 0
    : (slowRatio <= GROUP_SLOW_WEIGHT_RATIO
      ? 1
      : clamp(1 - (((slowRatio - GROUP_SLOW_WEIGHT_RATIO) / 0.65) * 0.78), 0.22, 1));
  let state = CARD_PASSAGE_GROUP_STATE.FORMATION;
  if (groupLevelBlocked) {
    state = CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED;
  } else if (plan) {
    if (frontProgress < finiteNumber(plan?.startProgress) - touchDistance) state = CARD_PASSAGE_GROUP_STATE.APPROACH;
    else if (bodyProgress < finiteNumber(plan?.bottleneckStartProgress)) state = CARD_PASSAGE_GROUP_STATE.COMPRESS;
    else if (tailPending && frontProgress >= clearProgress) state = CARD_PASSAGE_GROUP_STATE.CLEAR_TAIL;
    else if (tailPending) state = CARD_PASSAGE_GROUP_STATE.FLOW;
    else state = CARD_PASSAGE_GROUP_STATE.EXPAND;
  }
  const replanCooldown = Math.max(0.55, finiteNumber(options?.scanInterval) * 3);
  const needsReplan = groupLevelBlocked
    && nowSec - finiteNumber(previous?.replannedAt, -Infinity) >= replanCooldown;
  return {
    state,
    passageId: Math.floor(finiteNumber(plan?.id)),
    signature: String(plan?.geometrySignature || ''),
    routeSignature: progressRouteSignature,
    totalWeight,
    trackedWeight,
    outlierWeight,
    detachedWeight,
    detachedWeightRatio,
    blockedWeight,
    blockedRatio,
    directBlockedWeight,
    directBlockedRatio,
    behindGateWeight,
    behindGateRatio: behindGateWeight / Math.max(0.001, trackedWeight),
    rearProgress,
    tailProgress,
    bodyProgress,
    frontProgress,
    clearProgress,
    nominalClearProgress,
    tailAllowance,
    tailPending,
    navigationProgress,
    navigationLead,
    maximumAnchorLead,
    cursorLeadSaturated,
    cursorAtRouteEnd,
    touchingPassage,
    madeProgress,
    lastProgressAt,
    stallFor,
    directBlockedSince,
    directBlockedFor,
    blockedSince: groupLevelBlocked
      ? (sameProgressContext && previous?.state === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED
        ? finiteNumber(previous?.blockedSince, nowSec)
        : nowSec)
      : 0,
    anchorSpeedScale,
    needsReplan
  };
};

export const updateTrainingCardPassagePlan = ({
  squad = null,
  agents = [],
  runtime = null,
  sim = {},
  walls = [],
  route = null,
  nowSec = 0,
  force = false
} = {}) => {
  if (!squad || !runtime) return { plan: null, rows: [], terrain: null };
  const previousPlan = runtime?.passagePlan || null;
  const options = resolvePassageOptions(sim, squad);
  const geometry = resolveRouteGeometrySignature({ squad, sim, walls, route });
  const routeSignature = geometry.route.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';');
  const routeSegments = buildRouteSegments(geometry.route);
  const routeLength = routeSegments.reduce((sum, segment) => sum + segment.length, 0);
  const routeProjectionPlan = {
    route: geometry.route,
    segments: routeSegments,
    routeLength
  };
  // Planning must start at the real rear of the group. Detached, recovery and
  // rejoin members stay in this sample; a percentile would still silently
  // skip a small-but-not-yet-proven tail, which can make the next bottleneck
  // appear cleared before that physical member has moved.
  const initialProgressRows = (Array.isArray(agents) ? agents : [])
    .filter(isPassageParticipant)
    .map((agent) => ({
      agent,
      weight: passageParticipantWeight(agent),
      progress: projectPointToPassagePlan(agent, routeProjectionPlan).progress
    }));
  // Preserve only an already-proven tiny outlier across a plan rollover.
  // New detached/recovery/rejoin members cannot opt out here; they must first
  // satisfy classifyPassageOutliers' distance, duration and total-weight cap.
  const retainedOutliers = classifyPassageOutliers({
    rows: initialProgressRows,
    plan: null,
    totalWeight: initialProgressRows.reduce((sum, row) => sum + row.weight, 0),
    body: resolveTrainingCardBodyAnchor(squad) || squad,
    nowSec,
    options
  });
  const minimumProgressRows = initialProgressRows.filter((row) => !retainedOutliers.has(row.agent));
  const minimumProgress = minimumProgressRows.length > 0
    ? minimumProgressRows.reduce((minimum, row) => Math.min(minimum, row.progress), Infinity)
    : projectPointToPassagePlan(resolveTrainingCardBodyAnchor(squad) || squad, routeProjectionPlan).progress;
  const targetPoint = squad?.order?.targetPoint && typeof squad.order.targetPoint === 'object'
    ? squad.order.targetPoint
    : geometry.route?.[geometry.route.length - 1];
  const routePending = (
    Array.isArray(squad?.waypoints) && squad.waypoints.length > 0
  ) || distance(squad, targetPoint) > 10;
  if (routePending && runtime?.passageCompletedRouteSignature === routeSignature) {
    runtime.passageCompletedRouteSignature = '';
    runtime.passageCompletedAt = 0;
  }
  const completedSameRoute = !force
    && !previousPlan
    && routeSignature
    && !routePending
    && runtime?.passageCompletedRouteSignature === routeSignature;
  let plan = previousPlan;
  const geometryChanged = !!plan
    && String(plan?.geometrySignature || '') !== String(geometry?.signature || '');
  const shouldValidate = force
    || !plan
    || geometryChanged
    || nowSec - finiteNumber(plan?.lastValidatedAt, -Infinity) >= options.scanInterval;
  if (shouldValidate && !completedSameRoute) {
    const candidatePlan = createTrainingCardPassagePlan({
      squad,
      sim,
      walls,
      route,
      nowSec,
      previousPlan,
      force,
      minimumProgress
    });
    if (candidatePlan) {
      plan = candidatePlan;
    } else {
      const sameRoute = previousPlan?.routeSignature === routeSignature;
      const safeToDrainOpenedPassage = sameRoute
        && Array.isArray(previousPlan?.streams)
        && previousPlan.streams.length > 0
        && previousPlan.streams.every((stream) => isSpineTraversable({
          spine: stream?.spine,
          walls,
          sim,
          options
        }));
      if (safeToDrainOpenedPassage) {
        // A geometry revision can remove the bottleneck (for example a tower
        // is destroyed).  The cached lane spines are still legal under the
        // new geometry, so drain current members through STREAM_EXIT instead
        // of abruptly returning them to exact formation slots.
        plan = {
          ...previousPlan,
          geometrySignature: geometry.signature,
          draining: true,
          lastValidatedAt: nowSec,
          valid: true
        };
      } else {
        // A transient probe miss must not reset a live passage.  Retain the
        // cached plan while the route/obstacle geometry is unchanged; a genuine
        // route change gets a fresh validation and may invalidate it.
        const previousPlanStillRelevant = previousPlan
          && finiteNumber(previousPlan?.endProgress, Infinity)
            >= minimumProgress - Math.max(options.exitClearDistance, options.scanStep);
        plan = previousPlanStillRelevant && geometry.signature
          && previousPlan.geometrySignature === geometry.signature
          ? { ...previousPlan, lastValidatedAt: nowSec }
          : null;
      }
    }
  } else if (completedSameRoute) {
    plan = null;
  }
  runtime.passagePlanInvalid = !!previousPlan && geometryChanged && !plan;
  const rows = updateTrainingCardPassageAgents({ squad, agents, plan, nowSec });
  const groupProgress = resolveTrainingCardPassageGroupProgress({
    squad,
    agents,
    rows,
    plan,
    routeProjectionPlan,
    previous: runtime?.groupProgress,
    nowSec,
    options
  });
  runtime.groupProgress = groupProgress;
  const activeRows = rows.filter((row) => row.state !== CARD_LOCOMOTION_STATE.FORMATION);
  const active = !!plan && (
    groupProgress.state !== CARD_PASSAGE_GROUP_STATE.EXPAND
    || groupProgress.tailPending
    || activeRows.length > 0
  );
  const tailPending = groupProgress.tailPending === true;
  if (active || tailPending) {
    runtime.passageInactiveSince = 0;
  } else if (plan) {
    if (routePending) {
      // The plan belongs to the command, not just to agents already inside the
      // gate.  Keep it alive while the formation is still approaching so a
      // quiet interval cannot reset lane assignments before the mouth.
      runtime.passageInactiveSince = 0;
    } else {
      const previousInactiveSince = Number(runtime?.passageInactiveSince);
      runtime.passageInactiveSince = Number.isFinite(previousInactiveSince) && previousInactiveSince > 0
        ? previousInactiveSince
        : nowSec;
      if (nowSec - runtime.passageInactiveSince >= options.retainInterval) {
        if (
          routeSignature
          && (!Array.isArray(squad?.waypoints) || squad.waypoints.length <= 0)
        ) {
          runtime.passageCompletedRouteSignature = routeSignature;
          runtime.passageCompletedAt = nowSec;
        }
        plan = null;
      }
    }
  }
  runtime.passagePlan = plan;
  const streamingRows = rows.filter((row) => row.state === CARD_LOCOMOTION_STATE.STREAM);
  const approachRows = rows.filter((row) => row.state === CARD_LOCOMOTION_STATE.STREAM_APPROACH);
  const exitingRows = rows.filter((row) => row.state === CARD_LOCOMOTION_STATE.STREAM_EXIT);
  const groupState = String(groupProgress?.state || CARD_PASSAGE_GROUP_STATE.FORMATION);
  const flowing = !!plan && (groupState === CARD_PASSAGE_GROUP_STATE.FLOW
    || groupState === CARD_PASSAGE_GROUP_STATE.CLEAR_TAIL
    || groupState === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED
    || approachRows.length + streamingRows.length > 0);
  const previousTerrainState = String(runtime?.terrain?.state || '');
  const hasPassageLifecycle = previousTerrainState === 'PASSAGE'
    || previousTerrainState === 'EXPAND'
    || exitingRows.length > 0;
  const terrain = {
    state: groupState === CARD_PASSAGE_GROUP_STATE.APPROACH
      || groupState === CARD_PASSAGE_GROUP_STATE.COMPRESS
      ? 'COMPRESS'
      : (groupState === CARD_PASSAGE_GROUP_STATE.EXPAND
        ? 'EXPAND'
        : (flowing
          ? 'PASSAGE'
          : (active || (plan && hasPassageLifecycle) ? 'EXPAND' : 'MARCH'))),
    sampledAt: nowSec,
    passageId: Math.max(0, Math.floor(finiteNumber(plan?.id))),
    passagePlanId: Math.max(0, Math.floor(finiteNumber(plan?.id))),
    passagePlan: plan,
    corridorWidth: plan ? plan.usableWidth : Infinity,
    requiredWidth: resolveFormationWidth(squad, options.spacing),
    minimumWidth: plan ? plan.minimumWidth : Infinity,
    streamCount: plan ? plan.streamCount : 0,
    laneCount: plan ? plan.streamCount : 0,
    streamSpacing: plan ? plan.streamSpacing : 0,
    directionX: plan ? plan.directionX : finiteNumber(squad?.dirX, 1),
    directionY: plan ? plan.directionY : finiteNumber(squad?.dirY),
    startProgress: plan ? plan.startProgress : 0,
    endProgress: plan ? plan.endProgress : 0,
    frontClearance: plan ? Math.max(0, plan.startProgress) : Infinity,
    frontCleared: !plan || groupProgress.frontProgress >= groupProgress.clearProgress,
    bodyCleared: !plan || groupProgress.bodyProgress >= groupProgress.clearProgress,
    rearCleared: !tailPending,
    compression: active ? clamp(plan.usableWidth / Math.max(options.spacing, resolveFormationWidth(squad, options.spacing)), 0.4, 1) : 1,
    rawCompression: active ? clamp(plan.usableWidth / Math.max(options.spacing, resolveFormationWidth(squad, options.spacing)), 0.4, 1) : 1,
    longitudinalScale: 1,
    formationWeight: active ? 0 : 1,
    agentsApproaching: approachRows.length,
    agentsStreaming: streamingRows.length,
    agentsExiting: exitingRows.length,
    activeAgents: activeRows.length,
    groupState,
    totalWeight: groupProgress.totalWeight,
    blockedWeight: groupProgress.blockedWeight,
    detachedWeight: groupProgress.detachedWeight,
    behindGateWeight: groupProgress.behindGateWeight,
    rearProgress: groupProgress.rearProgress,
    bodyProgress: groupProgress.bodyProgress,
    frontProgress: groupProgress.frontProgress
  };
  runtime.terrain = terrain;
  runtime.passageDebug = {
    passageActive: active,
    passageId: terrain.passageId,
    streamCount: terrain.streamCount,
    agentsApproaching: terrain.agentsApproaching,
    agentsStreaming: terrain.agentsStreaming,
    agentsExiting: terrain.agentsExiting,
    groupState,
    totalWeight: groupProgress.totalWeight,
    blockedWeight: groupProgress.blockedWeight,
    detachedWeight: groupProgress.detachedWeight,
    behindGateWeight: groupProgress.behindGateWeight,
    rearProgress: groupProgress.rearProgress,
    bodyProgress: groupProgress.bodyProgress,
    frontProgress: groupProgress.frontProgress,
    tailPending: groupProgress.tailPending === true,
    groupBlocked: groupProgress.state === CARD_PASSAGE_GROUP_STATE.GROUP_BLOCKED
  };
  return { plan, rows, terrain };
};

const isPassageState = (value) => (
  value === CARD_LOCOMOTION_STATE.STREAM_APPROACH
  || value === CARD_LOCOMOTION_STATE.STREAM
  || value === CARD_LOCOMOTION_STATE.STREAM_EXIT
);

export const resolveTrainingCardPassageFlowIntent = ({
  squad = null,
  agent = null,
  runtime = null
} = {}) => {
  if (!squad || !agent || !runtime?.passagePlan) return null;
  const state = String(agent?._squadController?.locomotionState || CARD_LOCOMOTION_STATE.FORMATION);
  if (!isPassageState(state)) return null;
  const plan = runtime.passagePlan;
  if (plan.valid === false) return null;
  if (
    Math.floor(finiteNumber(agent?._squadController?.passageId)) !== Math.floor(finiteNumber(plan?.id))
  ) return null;
  if (
    plan?.geometrySignature
    && agent?._squadController?.passageSignature
    && agent._squadController.passageSignature !== plan.geometrySignature
  ) return null;
  const controller = agent?._squadController || {};
  const storedProgress = Number(controller?.passageProgress);
  const projection = Number.isFinite(storedProgress)
    ? {
      progress: storedProgress,
      point: pointAtRouteProgress(plan, storedProgress),
      tangent: tangentAtRouteProgress(plan, storedProgress),
      lateral: finiteNumber(controller?.passageLateral)
    }
    : projectPointToPassagePlan(agent, plan);
  const streamId = clamp(
    Math.floor(finiteNumber(agent?._squadController?.streamId)),
    0,
    Math.max(0, plan.streamCount - 1)
  );
  const routeTangent = tangentAtRouteProgress(plan, projection.progress);
  const streamSample = sampleTrainingCardPassageStream(plan, streamId, projection.progress);
  const tangent = normalizeVec(
    finiteNumber(streamSample?.tangent?.x, routeTangent?.x),
    finiteNumber(streamSample?.tangent?.y, routeTangent?.y)
  );
  if (tangent.len <= 0.0001) return null;
  const side = { x: -tangent.y, y: tangent.x };
  const laneOffset = resolvePassageStreamOffset(plan, streamId);
  const lanePoint = {
    x: finiteNumber(streamSample?.x, projection.point.x + (side.x * laneOffset)),
    y: finiteNumber(streamSample?.y, projection.point.y + (side.y * laneOffset))
  };
  const laneLateral = (
    (finiteNumber(agent?.x) - lanePoint.x) * side.x
  ) + (
    (finiteNumber(agent?.y) - lanePoint.y) * side.y
  );
  let reformSideError = 0;
  if (state === CARD_LOCOMOTION_STATE.STREAM_EXIT) {
    reformSideError = resolveFormationLateralAtProjection({
      squad,
      agent,
      projection,
      routeSide: { x: -routeTangent.y, y: routeTangent.x }
    }) - laneOffset;
  }
  const clearProgress = Math.max(
    plan.bottleneckEndProgress + plan.exitClearDistance,
    finiteNumber(plan?.clearProgress, plan.endProgress)
  );
  const previousWatchdog = controller?.streamWatchdog && typeof controller.streamWatchdog === 'object'
    ? controller.streamWatchdog
    : null;
  const watchdogRefresh = previousWatchdog?.stalled === true;
  const lookAhead = Math.max(10, plan.streamSpacing * 2.5) * (watchdogRefresh ? 1.55 : 1);
  const goal = sampleTrainingCardPassageStream(
    plan,
    streamId,
    Math.min(plan.routeLength, projection.progress + lookAhead)
  ) || pointAtRouteProgress(plan, Math.min(plan.routeLength, projection.progress + lookAhead));
  return {
    active: state !== CARD_LOCOMOTION_STATE.FORMATION,
    state,
    passageId: plan.id,
    streamId,
    streamCount: plan.streamCount,
    forwardX: tangent.x,
    forwardY: tangent.y,
    sideX: side.x,
    sideY: side.y,
    laneOffset,
    lanePointX: lanePoint.x,
    lanePointY: lanePoint.y,
    progress: projection.progress,
    lateral: laneOffset + laneLateral,
    laneError: -laneLateral,
    streamSpacing: plan.streamSpacing,
    queueSpacing: Math.max(plan.streamSpacing * 1.05, plan.laneWidth * 1.12),
    queueLookahead: Math.max(plan.streamSpacing * 4, lookAhead * 1.65),
    approachDistance: plan.approachDistance,
    mergeDistanceRemaining: Math.max(0, plan.bottleneckStartProgress - projection.progress),
    streamWatchdog: previousWatchdog,
    watchdogRefresh,
    formationWeight: state === CARD_LOCOMOTION_STATE.STREAM_EXIT
      ? clamp(
        (projection.progress - clearProgress)
          / Math.max(1, finiteNumber(plan?.reformationDistance, plan.exitClearDistance * 1.4)),
        0,
        1
    )
      : 0,
    reformSideError: state === CARD_LOCOMOTION_STATE.STREAM_EXIT ? reformSideError : 0,
    clearProgress,
    goalX: goal.x,
    goalY: goal.y
  };
};

export const resolveTrainingCardPassageFlowSteering = ({
  agent = null,
  squad = null,
  flowIntent = null,
  neighbors = [],
  speed = 0,
  nowSec = 0
} = {}) => {
  if (!agent || !squad || !flowIntent?.active) return null;
  const tangent = normalizeVec(flowIntent.forwardX, flowIntent.forwardY);
  if (tangent.len <= 0.0001) return null;
  const side = { x: -tangent.y, y: tangent.x };
  const laneSpacing = Math.max(AGENT_RADIUS * 2.04, finiteNumber(flowIntent?.streamSpacing, 5.2));
  const queueSpacing = Math.max(laneSpacing * 1.05, finiteNumber(flowIntent?.queueSpacing, laneSpacing));
  const state = String(flowIntent?.state || CARD_LOCOMOTION_STATE.STREAM);
  const exitFormationWeight = state === CARD_LOCOMOTION_STATE.STREAM_EXIT
    ? clamp(finiteNumber(flowIntent?.formationWeight), 0, 1)
    : 0;
  const laneOffset = finiteNumber(flowIntent?.laneOffset);
  const formationOffset = laneOffset + finiteNumber(flowIntent?.reformSideError);
  const targetLateralOffset = laneOffset
    + ((formationOffset - laneOffset) * exitFormationWeight);
  const laneError = targetLateralOffset - finiteNumber(flowIntent?.lateral);
  const laneGain = state === CARD_LOCOMOTION_STATE.STREAM_APPROACH
    ? 0.34
    : (state === CARD_LOCOMOTION_STATE.STREAM_EXIT ? 0.2 : 0.22);
  const lateralVelocity = clamp(
    laneError * Math.max(1.2, Number(speed) || 0) * laneGain,
    -(Math.max(1, Number(speed) || 0) * (state === CARD_LOCOMOTION_STATE.STREAM_APPROACH ? 0.42 : 0.3)),
    Math.max(1, Number(speed) || 0) * (state === CARD_LOCOMOTION_STATE.STREAM_APPROACH ? 0.42 : 0.3)
  );
  let nearestFront = null;
  const selfProgress = finiteNumber(flowIntent?.progress);
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const queueLookahead = Math.max(
    queueSpacing * 3,
    finiteNumber(flowIntent?.queueLookahead, queueSpacing * 4),
    safeSpeed * 0.5
  );
  (Array.isArray(neighbors) ? neighbors : []).forEach((other) => {
    if (!other || other === agent || other.dead || String(other?.squadId || '') !== String(agent?.squadId || '')) return;
    const otherState = String(other?._squadController?.locomotionState || '');
    if (!isPassageState(otherState)) return;
    if (Math.floor(finiteNumber(other?._squadController?.passageId)) !== Math.floor(finiteNumber(flowIntent?.passageId))) return;
    if (Math.floor(finiteNumber(other?._squadController?.streamId, -1)) !== Math.floor(finiteNumber(flowIntent?.streamId, -1))) return;
    const otherProgress = Number(other?._squadController?.passageProgress);
    if (!Number.isFinite(otherProgress)) return;
    const progressDifference = otherProgress - selfProgress;
    if (progressDifference <= 0 || progressDifference > queueLookahead) return;
    const dx = finiteNumber(other?.x) - finiteNumber(agent?.x);
    const dy = finiteNumber(other?.y) - finiteNumber(agent?.y);
    const worldDistance = Math.hypot(dx, dy);
    const lateral = Math.abs((dx * side.x) + (dy * side.y));
    // Progress is the longitudinal authority.  World distance remains a
    // safety filter so a self-crossing route cannot make a distant stream
    // member brake this one, but a curved corner is allowed to look lateral
    // in the current tangent frame.
    if (worldDistance > Math.max(queueSpacing * 3.5, safeSpeed * 0.72 + laneSpacing)) return;
    if (!nearestFront
      || progressDifference < nearestFront.progressDifference - 0.001
      || (
        Math.abs(progressDifference - nearestFront.progressDifference) <= 0.001
        && worldDistance < nearestFront.worldDistance
      )) {
      nearestFront = {
        agent: other,
        progressDifference,
        worldDistance,
        lateral
      };
    }
  });
  const minimumGap = Math.max(laneSpacing * 0.72, (finiteNumber(agent?.radius, AGENT_RADIUS) * 2) + 0.25);
  const timeHeadway = clamp(queueSpacing / Math.max(1, safeSpeed), 0.2, 0.46);
  const desiredGap = Math.max(queueSpacing, minimumGap + (safeSpeed * timeHeadway));
  const gap = nearestFront?.progressDifference ?? Infinity;
  let targetSpeed = safeSpeed;
  let frontSpeed = safeSpeed;
  if (Number.isFinite(gap)) {
    if (nearestFront?.agent) {
      const frontTangent = normalizeVec(
        finiteNumber(nearestFront.agent?._squadController?.passageForwardX, tangent.x),
        finiteNumber(nearestFront.agent?._squadController?.passageForwardY, tangent.y)
      );
      const direction = frontTangent.len > 0.0001 ? frontTangent : tangent;
      frontSpeed = (finiteNumber(nearestFront.agent.vx) * direction.x)
        + (finiteNumber(nearestFront.agent.vy) * direction.y);
    }
    frontSpeed = clamp(frontSpeed, 0, safeSpeed);
    const release = smoothstep01(clamp(
      (gap - minimumGap) / Math.max(0.5, desiredGap - minimumGap),
      0,
      1
    ));
    const selfForwardSpeed = (finiteNumber(agent?.vx) * tangent.x) + (finiteNumber(agent?.vy) * tangent.y);
    const closingSpeed = Math.max(0, selfForwardSpeed - frontSpeed);
    targetSpeed = clamp(
      frontSpeed + ((safeSpeed - frontSpeed) * release) - (closingSpeed * (1 - release) * 0.7),
      0,
      safeSpeed
    );
    if (gap < minimumGap) {
      const overlapRatio = clamp(gap / Math.max(0.1, minimumGap), 0, 1);
      targetSpeed = Math.min(targetSpeed, (frontSpeed * overlapRatio) + (safeSpeed * 0.08 * overlapRatio));
    }
  }
  const queuePressure = safeSpeed > 0.001 ? clamp(1 - (targetSpeed / safeSpeed), 0, 1) : 0;
  const mergeDemand = clamp(
    Math.abs(laneError) / Math.max(
      laneSpacing,
      finiteNumber(flowIntent?.approachDistance, laneSpacing * 4) * 0.44
    ),
    0,
    1
  );
  const approachForwardRatio = state === CARD_LOCOMOTION_STATE.STREAM_APPROACH
    ? 0.72 + (0.28 * (1 - smoothstep01(mergeDemand)))
    : 1;
  const previousWatch = agent?._squadController?.streamWatchdog || {};
  const previousProgress = Number(previousWatch?.progress);
  const progressed = !Number.isFinite(previousProgress)
    || selfProgress >= previousProgress + 0.16;
  const previousProgressAt = Number(previousWatch?.lastProgressAt);
  const lastProgressAt = progressed || !Number.isFinite(previousProgressAt)
    ? nowSec
    : previousProgressAt;
  const frontBlocking = Number.isFinite(gap) && gap <= desiredGap * 1.08;
  const stalled = state === CARD_LOCOMOTION_STATE.STREAM
    && !frontBlocking
    && nowSec - lastProgressAt >= 0.9;
  if (agent?._squadController && typeof agent._squadController === 'object') {
    agent._squadController.streamWatchdog = {
      progress: selfProgress,
      lastProgressAt,
      stalled,
      frontBlocking,
      refreshedAt: stalled ? nowSec : finiteNumber(previousWatch?.refreshedAt)
    };
  }
  const totalLateral = lateralVelocity;
  return {
    state,
    passageId: flowIntent.passageId,
    streamId: flowIntent.streamId,
    forwardX: tangent.x,
    forwardY: tangent.y,
    laneX: side.x * (totalLateral / Math.max(1, Number(speed) || 1)),
    laneY: side.y * (totalLateral / Math.max(1, Number(speed) || 1)),
    laneVelocityX: side.x * totalLateral,
    laneVelocityY: side.y * totalLateral,
    targetSpeed,
    queuePressure,
    approachForwardRatio,
    formationWeight: finiteNumber(flowIntent?.formationWeight),
    goalX: finiteNumber(flowIntent?.goalX),
    goalY: finiteNumber(flowIntent?.goalY),
    sameStreamFront: nearestFront?.agent || null,
    frontProgressDifference: nearestFront?.progressDifference ?? Infinity,
    laneError,
    streamWatchdog: { stalled, frontBlocking, lastProgressAt }
  };
};

export const isTrainingCardPassageState = (value) => isPassageState(value);

export const isTrainingCardAgentInStream = (agent = null) => isPassageState(
  String(agent?._squadController?.locomotionState || '')
);
