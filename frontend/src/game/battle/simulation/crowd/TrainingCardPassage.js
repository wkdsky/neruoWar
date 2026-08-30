import {
  clamp,
  estimateLocalFlowWidth,
  isInsideCollider,
  normalizeVec,
  queryObstacleCandidates,
  raycastObstacles
} from './crowdPhysics';
import { isTrainingMapTerrainSegmentTraversable } from '../../shared/trainingMap';

export const CARD_LOCOMOTION_STATE = Object.freeze({
  FORMATION: 'FORMATION',
  STREAM_APPROACH: 'STREAM_APPROACH',
  STREAM: 'STREAM',
  STREAM_EXIT: 'STREAM_EXIT'
});

const AGENT_RADIUS = 2.25;
const AGENT_GAP = 1.05;
const DEFAULT_LANE_GAP = AGENT_GAP * 0.72;
const DEFAULT_PLAN_SCAN_INTERVAL = 0.24;
const DEFAULT_PLAN_RETAIN_INTERVAL = 0.72;
const DEFAULT_APPROACH_DISTANCE = 22;
const DEFAULT_EXIT_CLEAR_DISTANCE = 18;
const DEFAULT_MAX_STREAMS = 12;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

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

export const projectPointToPassagePlan = (point = {}, plan = null) => {
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
      lateral: (offsetX * sideX) + (offsetY * sideY)
    };
    if (!best || candidate.distance < best.distance) best = candidate;
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

const obstacleSignature = (obstacles = []) => (
  (Array.isArray(obstacles) ? obstacles : []).map((obstacle, index) => ([
    String(obstacle?.id || obstacle?.objectId || index),
    obstacle?.destroyed === true ? 1 : 0,
    obstacle?.blocksMovement === false ? 0 : 1,
    finiteNumber(obstacle?.x).toFixed(2),
    finiteNumber(obstacle?.y).toFixed(2),
    finiteNumber(obstacle?.width).toFixed(2),
    finiteNumber(obstacle?.depth).toFixed(2),
    finiteNumber(obstacle?.rotation).toFixed(2),
    String(obstacle?.collider?.kind || '')
  ].join(':'))).join('|')
);

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
        finiteNumber(legacy?.entryDistance, Math.max(DEFAULT_APPROACH_DISTANCE, spacing * 3.2))
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
    : squad;
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
  const previousPlanStillRelevant = !previousPlan
    || finiteNumber(previousPlan?.endProgress, Infinity)
      >= finiteNumber(minimumProgress) - Math.max(options.exitClearDistance, options.scanStep);
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
  const streamCount = resolveStreamCount({ usableWidth: segment.usableWidth, options });
  const laneSpacing = Math.max(options.agentRadius * 2.05, options.laneWidth);
  const clearProgress = segment.bottleneckEndProgress + options.exitClearDistance;
  const reformationDistance = Math.max(options.exitClearDistance * 1.4, options.scanStep * 2);
  const id = Math.max(
    1,
    Math.floor(finiteNumber(previousPlan?.id, finiteNumber(squad?._passagePlanSequence, 0))) + 1
  );
  const streams = Array.from({ length: streamCount }, (_, streamId) => ({
    id: streamId,
    offset: (streamId - ((streamCount - 1) * 0.5)) * laneSpacing,
    tangent: {
      x: segment.direction.x,
      y: segment.direction.y
    }
  }));
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
    streamSpacing: laneSpacing,
    streams,
    laneWidth: options.laneWidth,
    wallClearance: options.wallClearance,
    approachDistance: options.approachDistance,
    exitClearDistance: options.exitClearDistance,
    clearProgress: Math.min(scan.length, clearProgress),
    reformationDistance,
    geometrySignature,
    routeSignature: normalizedRoute.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';'),
    createdAt: previousPlan ? finiteNumber(previousPlan.createdAt, nowSec) : nowSec,
    lastValidatedAt: nowSec,
    valid: true,
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
  state.passageExitProgress = 0;
  state.passageEnteredAt = 0;
  state.passageSignature = '';
  state.passageCompletedId = 0;
  state.passageCompletedSignature = '';
  state.passageCompletedAt = 0;
};

const assignStream = ({ agent, plan, projection, reuseExisting = false }) => {
  const state = agent?._squadController || {};
  const existing = Number.isFinite(Number(state?.streamId)) ? Math.floor(Number(state.streamId)) : -1;
  if (reuseExisting && existing >= 0 && existing < plan.streamCount) return existing;
  const ratio = plan.usableWidth > 0
    ? clamp((projection.lateral / Math.max(0.1, plan.usableWidth)) + 0.5, 0, 1)
    : 0.5;
  return clamp(Math.round(ratio * Math.max(0, plan.streamCount - 1)), 0, plan.streamCount - 1);
};

export const resolvePassageStreamOffset = (plan = null, streamId = 0) => {
  if (!plan) return 0;
  const count = Math.max(1, Math.floor(finiteNumber(plan?.streamCount, 1)));
  const lane = clamp(Math.floor(finiteNumber(streamId)), 0, count - 1);
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
  const slotX = finiteNumber(squad?.x)
    + (formationForward.x * finiteNumber(formationSlot?.front))
    + (formationSide.x * finiteNumber(formationSlot?.side));
  const slotY = finiteNumber(squad?.y)
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
    agent && !agent.dead && finiteNumber(agent.weight, 1) > 0.001 && !agent.isFlagBearer
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
    const projection = projectPointToPassagePlan(agent, plan);
    const planId = Math.floor(finiteNumber(plan?.id));
    const planSignature = String(plan?.geometrySignature || '');
    const samePassage = Math.floor(finiteNumber(state?.passageId)) === planId
      && (!planSignature || !state?.passageSignature || state.passageSignature === planSignature);
    const previousState = String(state?.locomotionState || CARD_LOCOMOTION_STATE.FORMATION);
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
    if (clearExit && (previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT || previousState === CARD_LOCOMOTION_STATE.FORMATION)) {
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
    if (previousState === CARD_LOCOMOTION_STATE.STREAM_EXIT && projection.progress <= plan.endProgress) {
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
      state.passageExitProgress = 0;
      state.passageEnteredAt = 0;
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
      reuseExisting: wasInPassage
    });
    state.locomotionState = locomotionState;
    state.passageFlowActive = true;
    state.passageId = planId;
    state.passageSignature = planSignature;
    state.streamId = streamId;
    state.passageProgress = projection.progress;
    state.passageLateral = projection.lateral;
    state.passageExitProgress = plan.endProgress;
    state.passageEnteredAt = wasInPassage ? (state.passageEnteredAt || nowSec) : nowSec;
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
  const coreAgentsForProgress = (Array.isArray(agents) ? agents : []).filter((agent) => (
    agent
    && !agent.dead
    && !agent.isFlagBearer
    && finiteNumber(agent.weight, 1) > 0.001
    && agent._formationDetached !== true
    && agent._formationRecovery?.active !== true
    && agent._squadController?.rejoin?.active !== true
  ));
  const progressSamples = coreAgentsForProgress.map((agent) => (
    projectPointToPassagePlan(agent, routeProjectionPlan).progress
  ));
  const minimumProgress = progressSamples.length > 0
    ? Math.min(...progressSamples)
    : projectPointToPassagePlan(squad, routeProjectionPlan).progress;
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
  const shouldValidate = force
    || !plan
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
  } else if (completedSameRoute) {
    plan = null;
  }
  const rows = updateTrainingCardPassageAgents({ squad, agents, plan, nowSec });
  const activeRows = rows.filter((row) => row.state !== CARD_LOCOMOTION_STATE.FORMATION);
  const active = !!plan && activeRows.length > 0;
  const passageId = Math.floor(finiteNumber(plan?.id));
  const passageSignature = String(plan?.geometrySignature || '');
  const coreRows = rows.filter((row) => (
    row?.agent
    && row.agent?._formationDetached !== true
    && row.agent?._formationRecovery?.active !== true
    && row.agent?._squadController?.rejoin?.active !== true
  ));
  const tailPending = !!plan && coreRows.some((row) => {
    if (row?.completedCurrentPassage === true) return false;
    const state = row?.agent?._squadController || {};
    const completed = Math.floor(finiteNumber(state?.passageCompletedId)) === passageId
      && (!passageSignature || state?.passageCompletedSignature === passageSignature);
    if (completed) return false;
    const progress = finiteNumber(row?.projection?.progress, 0);
    return progress < Math.max(
      0,
      finiteNumber(plan?.clearProgress, plan?.endProgress) - Math.max(0.5, plan?.streamSpacing * 0.18)
    );
  });
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
  const flowing = approachRows.length + streamingRows.length > 0;
  const previousTerrainState = String(runtime?.terrain?.state || '');
  const hasPassageLifecycle = previousTerrainState === 'PASSAGE'
    || previousTerrainState === 'EXPAND'
    || exitingRows.length > 0;
  const terrain = {
    state: flowing
      ? 'PASSAGE'
      : (active || (plan && hasPassageLifecycle) ? 'EXPAND' : 'MARCH'),
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
    frontCleared: exitingRows.length > 0 || !active,
    bodyCleared: streamingRows.length <= 0,
    rearCleared: rows.every((row) => row.state === CARD_LOCOMOTION_STATE.FORMATION),
    compression: active ? clamp(plan.usableWidth / Math.max(options.spacing, resolveFormationWidth(squad, options.spacing)), 0.4, 1) : 1,
    rawCompression: active ? clamp(plan.usableWidth / Math.max(options.spacing, resolveFormationWidth(squad, options.spacing)), 0.4, 1) : 1,
    longitudinalScale: 1,
    formationWeight: active ? 0 : 1,
    agentsApproaching: approachRows.length,
    agentsStreaming: streamingRows.length,
    agentsExiting: exitingRows.length,
    activeAgents: activeRows.length
  };
  runtime.terrain = terrain;
  runtime.passageDebug = {
    passageActive: active,
    passageId: terrain.passageId,
    streamCount: terrain.streamCount,
    agentsApproaching: terrain.agentsApproaching,
    agentsStreaming: terrain.agentsStreaming,
    agentsExiting: terrain.agentsExiting
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
  const projection = projectPointToPassagePlan(agent, plan);
  const streamId = clamp(
    Math.floor(finiteNumber(agent?._squadController?.streamId)),
    0,
    Math.max(0, plan.streamCount - 1)
  );
  const routeTangent = tangentAtRouteProgress(plan, projection.progress);
  const tangent = normalizeVec(
    finiteNumber(routeTangent?.x, projection?.tangent?.x),
    finiteNumber(routeTangent?.y, projection?.tangent?.y)
  );
  if (tangent.len <= 0.0001) return null;
  const side = { x: -tangent.y, y: tangent.x };
  const laneOffset = resolvePassageStreamOffset(plan, streamId);
  const lanePoint = {
    x: projection.point.x + (side.x * laneOffset),
    y: projection.point.y + (side.y * laneOffset)
  };
  let reformSideError = 0;
  if (state === CARD_LOCOMOTION_STATE.STREAM_EXIT) {
    reformSideError = resolveFormationLateralAtProjection({
      squad,
      agent,
      projection,
      routeSide: side
    }) - laneOffset;
  }
  const clearProgress = Math.max(
    plan.bottleneckEndProgress + plan.exitClearDistance,
    finiteNumber(plan?.clearProgress, plan.endProgress)
  );
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
    lateral: projection.lateral,
    laneError: laneOffset - projection.lateral,
    streamSpacing: plan.streamSpacing,
    queueSpacing: Math.max(plan.streamSpacing * 1.05, plan.laneWidth * 1.12),
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
    goalX: pointAtRouteProgress(plan, Math.min(plan.routeLength, projection.progress + Math.max(10, plan.streamSpacing * 2.5))).x,
    goalY: pointAtRouteProgress(plan, Math.min(plan.routeLength, projection.progress + Math.max(10, plan.streamSpacing * 2.5))).y
  };
};

export const resolveTrainingCardPassageFlowSteering = ({
  agent = null,
  squad = null,
  flowIntent = null,
  neighbors = [],
  speed = 0
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
  (Array.isArray(neighbors) ? neighbors : []).forEach((other) => {
    if (!other || other === agent || other.dead || String(other?.squadId || '') !== String(agent?.squadId || '')) return;
    const otherState = String(other?._squadController?.locomotionState || '');
    if (!isPassageState(otherState)) return;
    if (Math.floor(finiteNumber(other?._squadController?.passageId)) !== Math.floor(finiteNumber(flowIntent?.passageId))) return;
    if (Math.floor(finiteNumber(other?._squadController?.streamId, -1)) !== Math.floor(finiteNumber(flowIntent?.streamId, -1))) return;
    const dx = finiteNumber(other?.x) - finiteNumber(agent?.x);
    const dy = finiteNumber(other?.y) - finiteNumber(agent?.y);
    const longitudinal = (dx * tangent.x) + (dy * tangent.y);
    const lateral = Math.abs((dx * side.x) + (dy * side.y));
    if (longitudinal <= 0 || lateral > laneSpacing * 0.86) return;
    if (!nearestFront || longitudinal < nearestFront.longitudinal) {
      nearestFront = { agent: other, longitudinal };
    }
  });
  const minimumGap = Math.max(laneSpacing * 0.72, (finiteNumber(agent?.radius, AGENT_RADIUS) * 2) + 0.25);
  const desiredGap = Math.max(queueSpacing, (Number(speed) || 0) * 0.16 + minimumGap);
  const gap = nearestFront?.longitudinal ?? Infinity;
  const queuePressure = Number.isFinite(gap)
    ? clamp((desiredGap - gap) / Math.max(0.5, desiredGap - minimumGap), 0, 1)
    : 0;
  let targetSpeed = Math.max(0, Number(speed) || 0);
  if (Number.isFinite(gap)) {
    const gapRatio = clamp((gap - minimumGap) / Math.max(0.5, desiredGap - minimumGap), 0.08, 1);
    targetSpeed *= gapRatio;
    const frontSpeed = nearestFront?.agent
      ? ((finiteNumber(nearestFront.agent.vx) * tangent.x) + (finiteNumber(nearestFront.agent.vy) * tangent.y))
      : targetSpeed;
    if (frontSpeed > 0 && gap < desiredGap * 1.15) {
      targetSpeed = Math.min(targetSpeed, frontSpeed * 0.98 + (targetSpeed * 0.02));
    }
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
    formationWeight: finiteNumber(flowIntent?.formationWeight),
    goalX: finiteNumber(flowIntent?.goalX),
    goalY: finiteNumber(flowIntent?.goalY),
    sameStreamFront: nearestFront?.agent || null,
    laneError
  };
};

export const isTrainingCardPassageState = (value) => isPassageState(value);

export const isTrainingCardAgentInStream = (agent = null) => isPassageState(
  String(agent?._squadController?.locomotionState || '')
);
