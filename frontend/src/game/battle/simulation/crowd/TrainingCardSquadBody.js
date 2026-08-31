/**
 * CARD squad spatial authority.
 *
 * A CARD used to overload squad.x/y as the simulated leader, formation
 * origin and gameplay position.  That works only while every representative
 * can keep up.  This module deliberately keeps those concepts separate:
 *
 * - bodyAnchor: a weighted, robust measurement of real movement agents;
 * - navigationAnchor: the route follower/cursor;
 * - formationAnchor: the pose consumed by formation slots.
 *
 * The two virtual anchors are permitted to lead the body by a formation-sized
 * amount, never by an unbounded number of route waypoints.
 */

const EPSILON = 0.0001;
const DEFAULT_AGENT_RADIUS = 2.25;
const DEFAULT_AGENT_GAP = 1.05;
const BODY_SMOOTH_HZ = 8.5;
const FORMATION_SMOOTH_HZ = 11;

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const distance = (left = {}, right = {}) => Math.hypot(
  finiteNumber(left?.x) - finiteNumber(right?.x),
  finiteNumber(left?.y) - finiteNumber(right?.y)
);

const normalize = (x = 0, y = 0) => {
  const length = Math.hypot(finiteNumber(x), finiteNumber(y));
  return length > EPSILON
    ? { x: finiteNumber(x) / length, y: finiteNumber(y) / length, length }
    : { x: 1, y: 0, length: 0 };
};

const weightedPercentile = (rows = [], ratio = 0.5, key = 'value') => {
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isFinite(Number(row?.[key])) && finiteNumber(row?.weight) > 0)
    .slice()
    .sort((left, right) => finiteNumber(left?.[key]) - finiteNumber(right?.[key]));
  const total = ordered.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.weight)), 0);
  if (total <= EPSILON) return 0;
  const target = clamp(finiteNumber(ratio), 0, 1) * total;
  let accumulated = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    accumulated += Math.max(0, finiteNumber(ordered[index]?.weight));
    if (accumulated + EPSILON >= target) return finiteNumber(ordered[index]?.[key]);
  }
  return finiteNumber(ordered[ordered.length - 1]?.[key]);
};

const buildSegments = (route = []) => {
  const normalized = [];
  (Array.isArray(route) ? route : []).forEach((point) => {
    const next = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
    if (normalized.length <= 0 || distance(normalized[normalized.length - 1], next) > 0.05) {
      normalized.push(next);
    }
  });
  const segments = [];
  let cursor = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    const start = normalized[index - 1];
    const end = normalized[index];
    const length = distance(start, end);
    if (length <= 0.05) continue;
    const tangent = normalize(end.x - start.x, end.y - start.y);
    segments.push({
      start,
      end,
      length,
      startProgress: cursor,
      endProgress: cursor + length,
      tangent: { x: tangent.x, y: tangent.y }
    });
    cursor += length;
  }
  return { route: normalized, segments, length: cursor };
};

const routeSignature = (model = null) => (Array.isArray(model?.route) ? model.route : [])
  .map((point) => `${finiteNumber(point?.x).toFixed(2)},${finiteNumber(point?.y).toFixed(2)}`)
  .join(';');

const projectPoint = (point = {}, model = null) => {
  const segments = Array.isArray(model?.segments) ? model.segments : [];
  if (segments.length <= 0) {
    return {
      progress: 0,
      distance: Infinity,
      point: { x: finiteNumber(model?.route?.[0]?.x), y: finiteNumber(model?.route?.[0]?.y) },
      tangent: { x: 1, y: 0 }
    };
  }
  const target = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
  let best = null;
  segments.forEach((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const lengthSq = Math.max(EPSILON, (dx * dx) + (dy * dy));
    const local = clamp(
      (((target.x - segment.start.x) * dx) + ((target.y - segment.start.y) * dy)) / lengthSq,
      0,
      1
    );
    const projected = {
      x: segment.start.x + (dx * local),
      y: segment.start.y + (dy * local)
    };
    const candidate = {
      progress: segment.startProgress + (segment.length * local),
      distance: distance(target, projected),
      point: projected,
      tangent: segment.tangent
    };
    if (!best || candidate.distance < best.distance) best = candidate;
  });
  if (!best) return projectPoint(point, { route: [], segments: [] });
  const last = segments[segments.length - 1];
  const beyond = ((target.x - last.end.x) * last.tangent.x) + ((target.y - last.end.y) * last.tangent.y);
  if (beyond > 0) best.progress = last.endProgress + beyond;
  return best;
};

const resolveBodyProgressOnRoute = (body = null, model = null) => {
  if (!model?.segments?.length) return Math.max(0, finiteNumber(body?.bodyProgress));
  if (String(body?.routeSignature || '') === routeSignature(model)) {
    return clamp(finiteNumber(body?.bodyProgress), 0, finiteNumber(model?.length));
  }
  // A replan may replace the route under an existing body sample. In that
  // case its old P50 is not comparable, so project the physical pose once.
  return Math.max(0, projectPoint(body, model).progress);
};

const clampPointToBodyDistance = (body = null, x = 0, y = 0) => {
  const maximum = Math.max(0, finiteNumber(body?.maxAnchorLead));
  const dx = finiteNumber(x) - finiteNumber(body?.x);
  const dy = finiteNumber(y) - finiteNumber(body?.y);
  const separation = Math.hypot(dx, dy);
  if (separation <= maximum + EPSILON || separation <= EPSILON) {
    return { x: finiteNumber(x), y: finiteNumber(y), clamped: false };
  }
  return {
    x: finiteNumber(body?.x) + ((dx / separation) * maximum),
    y: finiteNumber(body?.y) + ((dy / separation) * maximum),
    clamped: true
  };
};

const pointAtProgress = (model = null, requestedProgress = 0) => {
  const segments = Array.isArray(model?.segments) ? model.segments : [];
  if (segments.length <= 0) {
    return { x: finiteNumber(model?.route?.[0]?.x), y: finiteNumber(model?.route?.[0]?.y) };
  }
  const progress = clamp(finiteNumber(requestedProgress), 0, Math.max(0, finiteNumber(model?.length)));
  const segment = segments.find((entry) => progress <= entry.endProgress + 0.001) || segments[segments.length - 1];
  const local = clamp(
    (progress - segment.startProgress) / Math.max(EPSILON, segment.length),
    0,
    1
  );
  return {
    x: segment.start.x + ((segment.end.x - segment.start.x) * local),
    y: segment.start.y + ((segment.end.y - segment.start.y) * local)
  };
};

const tangentAtProgress = (model = null, requestedProgress = 0) => {
  const segments = Array.isArray(model?.segments) ? model.segments : [];
  if (segments.length <= 0) return { x: 1, y: 0 };
  const progress = clamp(finiteNumber(requestedProgress), 0, Math.max(0, finiteNumber(model?.length)));
  const segment = segments.find((entry) => progress <= entry.endProgress + 0.001) || segments[segments.length - 1];
  return { x: finiteNumber(segment?.tangent?.x, 1), y: finiteNumber(segment?.tangent?.y) };
};

export const isTrainingCardMovementAgent = (agent = null) => (
  !!agent && !agent.dead && finiteNumber(agent?.weight) > 0.001
);

export const resolveTrainingCardRoute = (squad = null, route = null) => {
  if (Array.isArray(route) && route.length > 0) return buildSegments(route);
  const navigation = squad?.navigationAnchor || squad?._navigationAnchor || squad?.bodyAnchor || squad || {};
  const planRoute = squad?._squadController?.passagePlan?.route;
  const staticRoute = Array.isArray(planRoute) && planRoute.length > 1
    ? planRoute
    : (Array.isArray(squad?._passagePlanRoute) && squad._passagePlanRoute.length > 1
      ? squad._passagePlanRoute
      : (Array.isArray(squad?._passageRoute) && squad._passageRoute.length > 0
        ? [navigation, ...squad._passageRoute]
        : (Array.isArray(squad?.waypoints) && squad.waypoints.length > 0
          ? [navigation, ...squad.waypoints]
          : [])));
  return buildSegments(staticRoute);
};

const resolveSpacing = (squad = {}) => Math.max(
  DEFAULT_AGENT_RADIUS * 2,
  finiteNumber(squad?.formationRect?.spacing, (DEFAULT_AGENT_RADIUS * 2) + DEFAULT_AGENT_GAP)
);

export const resolveTrainingCardFormationDepth = (squad = {}, agents = []) => {
  const spacing = resolveSpacing(squad);
  const configured = finiteNumber(squad?.formationRect?.depth);
  const slotDepth = (Array.isArray(agents) ? agents : []).reduce((maximum, agent) => (
    Math.max(maximum, Math.max(0, -finiteNumber(agent?.formationSlot?.front)))
  ), 0);
  return Math.max(spacing, configured, slotDepth + spacing);
};

export const resolveTrainingCardMaxAnchorLead = (squad = {}, agents = []) => {
  const spacing = resolveSpacing(squad);
  const depth = resolveTrainingCardFormationDepth(squad, agents);
  // A formation may put its front modestly ahead of its centroid, but a
  // virtual leader is never allowed to escape an entire obstacle complex.
  return clamp(
    Math.max(spacing * 2.25, (depth * 0.52) + (spacing * 1.45)),
    spacing * 2.25,
    56
  );
};

// Passage streams can move real agents ahead of a temporarily slow route
// cursor.  The formation may trail the weighted body by a small part of its
// depth while it smooths, but it may never remain a whole formation behind
// and pull cleared agents back into a choke.
export const resolveTrainingCardMaxFormationAnchorLag = (squad = {}, agents = []) => {
  const spacing = resolveSpacing(squad);
  const depth = resolveTrainingCardFormationDepth(squad, agents);
  const lead = resolveTrainingCardMaxAnchorLead(squad, agents);
  return clamp(
    Math.max(spacing * 0.82, depth * 0.28),
    spacing * 0.72,
    Math.max(spacing, lead * 0.45)
  );
};

const resolveWeightedBody = (agents = [], spacing = 1) => {
  const rows = (Array.isArray(agents) ? agents : [])
    .filter(isTrainingCardMovementAgent)
    .map((agent) => ({
      agent,
      x: finiteNumber(agent?.x),
      y: finiteNumber(agent?.y),
      vx: finiteNumber(agent?.vx),
      vy: finiteNumber(agent?.vy),
      weight: Math.max(0, finiteNumber(agent?.weight))
    }));
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= EPSILON) {
    return {
      rows,
      totalWeight: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: Math.max(8, spacing),
      inlierWeight: 0,
      outlierWeight: 0
    };
  }
  const medianX = weightedPercentile(rows.map((row) => ({ ...row, value: row.x })), 0.5);
  const medianY = weightedPercentile(rows.map((row) => ({ ...row, value: row.y })), 0.5);
  const radial = rows.map((row) => ({
    ...row,
    radial: Math.hypot(row.x - medianX, row.y - medianY)
  }));
  // Retain any material secondary mass. The 92nd weighted percentile keeps
  // a 20%/30% blocked flank inside the true body pose; only a genuinely tiny
  // visual outlier can fall outside this robust spatial measurement.
  const robustRadius = Math.max(spacing * 1.5, weightedPercentile(radial, 0.92, 'radial'));
  const inclusionRadius = robustRadius + Math.max(spacing * 1.2, 6);
  const inliers = radial.filter((row) => row.radial <= inclusionRadius + EPSILON);
  const selected = inliers.length > 0 ? inliers : radial;
  const selectedWeight = selected.reduce((sum, row) => sum + row.weight, 0);
  const aggregate = selected.reduce((sum, row) => ({
    x: sum.x + (row.x * row.weight),
    y: sum.y + (row.y * row.weight),
    vx: sum.vx + (row.vx * row.weight),
    vy: sum.vy + (row.vy * row.weight)
  }), { x: 0, y: 0, vx: 0, vy: 0 });
  const x = aggregate.x / Math.max(EPSILON, selectedWeight);
  const y = aggregate.y / Math.max(EPSILON, selectedWeight);
  const radius = weightedPercentile(
    selected.map((row) => ({ ...row, radial: Math.hypot(row.x - x, row.y - y) })),
    0.9,
    'radial'
  );
  return {
    rows,
    totalWeight,
    x,
    y,
    vx: aggregate.vx / Math.max(EPSILON, selectedWeight),
    vy: aggregate.vy / Math.max(EPSILON, selectedWeight),
    radius: Math.max(8, radius + Math.max(4, spacing * 0.55)),
    inlierWeight: selectedWeight,
    outlierWeight: Math.max(0, totalWeight - selectedWeight)
  };
};

const buildProgressStatistics = (rows = [], route = null, squad = null) => {
  const model = route?.segments ? route : buildSegments(route);
  const activePlan = squad?._squadController?.passagePlan || null;
  const planRouteMatches = activePlan
    && routeSignature(activePlan) === routeSignature(model);
  const samples = (Array.isArray(rows) ? rows : []).map((row) => {
    const state = row?.agent?._squadController || {};
    const samePassage = planRouteMatches
      && Math.floor(finiteNumber(state?.passageId)) === Math.floor(finiteNumber(activePlan?.id))
      && (!activePlan?.geometrySignature
        || !state?.passageSignature
        || state.passageSignature === activePlan.geometrySignature);
    return {
      ...row,
      // Passage maintains a continuity-aware per-agent longitudinal sample.
      // Reuse it on the same route so two nearby legs of a U/C/S route cannot
      // make the body P10/P50/P90 jump to the wrong leg between frames.
      progress: samePassage && Number.isFinite(Number(state?.passageProgress))
        ? finiteNumber(state.passageProgress)
        : projectPoint(row, model).progress
    };
  });
  if (samples.length <= 0 || !model?.segments?.length) {
    return {
      route: model,
      samples,
      rearProgress: 0,
      tailProgress: 0,
      bodyProgress: 0,
      frontProgress: 0
    };
  }
  return {
    route: model,
    samples,
    rearProgress: weightedPercentile(samples, 0.1, 'progress'),
    tailProgress: weightedPercentile(samples, 0.05, 'progress'),
    bodyProgress: weightedPercentile(samples, 0.5, 'progress'),
    frontProgress: weightedPercentile(samples, 0.9, 'progress')
  };
};

const writeAnchor = (squad = null, key = '', value = null) => {
  if (!squad || !key || !value) return value;
  squad[key] = value;
  const privateKey = key === 'bodyAnchor'
    ? '_bodyAnchor'
    : (key === 'navigationAnchor' ? '_navigationAnchor' : '_formationAnchor');
  squad[privateKey] = value;
  return value;
};

export const resolveTrainingCardBodyAnchor = (squad = null) => (
  squad?.bodyAnchor || squad?._bodyAnchor || null
);

export const resolveTrainingCardNavigationAnchor = (squad = null) => (
  squad?.navigationAnchor || squad?._navigationAnchor || resolveTrainingCardBodyAnchor(squad) || squad || null
);

export const resolveTrainingCardFormationAnchor = (squad = null) => (
  squad?.formationAnchor || squad?._formationAnchor || resolveTrainingCardNavigationAnchor(squad) || squad || null
);

export const refreshTrainingCardBodyAnchor = ({
  squad = null,
  agents = [],
  route = null,
  nowSec = 0,
  dt = 0,
  smooth = false
} = {}) => {
  if (!squad) return null;
  // Preserve the authored/previous formation pose while creating the first
  // body sample. A body centroid is intentionally not the same thing as a
  // formation reference, especially when a formation spawns with depth or a
  // member has already been displaced before this first update.
  const legacyPose = {
    x: finiteNumber(squad?.x),
    y: finiteNumber(squad?.y),
    vx: finiteNumber(squad?.vx),
    vy: finiteNumber(squad?.vy)
  };
  const spacing = resolveSpacing(squad);
  const raw = resolveWeightedBody(agents, spacing);
  const previous = resolveTrainingCardBodyAnchor(squad);
  const initialized = previous && Number.isFinite(Number(previous?.x)) && Number.isFinite(Number(previous?.y));
  const alpha = smooth && initialized
    ? clamp(1 - Math.exp(-BODY_SMOOTH_HZ * Math.max(0, finiteNumber(dt))), 0, 1)
    : 1;
  const x = initialized ? finiteNumber(previous?.x) + ((raw.x - finiteNumber(previous?.x)) * alpha) : raw.x;
  const y = initialized ? finiteNumber(previous?.y) + ((raw.y - finiteNumber(previous?.y)) * alpha) : raw.y;
  // An empty caller-supplied array means "use the squad route", not a
  // zero-length route.  This matters on the first frame after a command,
  // before the caller has materialized its static passage route.
  const resolvedRoute = route?.segments || (Array.isArray(route) && route.length > 0)
    ? route
    : resolveTrainingCardRoute(squad);
  const progress = buildProgressStatistics(raw.rows, resolvedRoute, squad);
  const maxAnchorLead = resolveTrainingCardMaxAnchorLead(squad, agents);
  const body = {
    x,
    y,
    rawX: raw.x,
    rawY: raw.y,
    vx: initialized && smooth && finiteNumber(dt) > EPSILON
      ? (x - finiteNumber(previous?.x)) / finiteNumber(dt)
      : raw.vx,
    vy: initialized && smooth && finiteNumber(dt) > EPSILON
      ? (y - finiteNumber(previous?.y)) / finiteNumber(dt)
      : raw.vy,
    radius: raw.radius,
    totalWeight: raw.totalWeight,
    inlierWeight: raw.inlierWeight,
    outlierWeight: raw.outlierWeight,
    rearProgress: progress.rearProgress,
    tailProgress: progress.tailProgress,
    bodyProgress: progress.bodyProgress,
    frontProgress: progress.frontProgress,
    routeLength: progress.route.length,
    routeSignature: routeSignature(progress.route),
    maxAnchorLead,
    sampledAt: finiteNumber(nowSec)
  };
  writeAnchor(squad, 'bodyAnchor', body);
  // Legacy spatial consumers intentionally see the body pose.  Navigation
  // code reads navigationAnchor explicitly, so there is no longer a hidden
  // virtual-leader teleport in normal gameplay queries.
  squad.x = body.x;
  squad.y = body.y;
  squad.centerX = body.x;
  squad.centerY = body.y;
  squad.vx = body.vx;
  squad.vy = body.vy;
  squad.speed = Math.hypot(body.vx, body.vy);
  squad._routeProgress = {
    rear: body.rearProgress,
    tail: body.tailProgress,
    body: body.bodyProgress,
    front: body.frontProgress,
    routeLength: body.routeLength,
    sampledAt: body.sampledAt
  };

  const hasRoute = progress.route.segments.length > 0;
  // Do not call the public resolver here: it intentionally falls back to the
  // body for old saves, which would hide the fact that an explicit cursor has
  // not been created yet.
  const navigation = squad?.navigationAnchor || squad?._navigationAnchor || null;
  if (!navigation || !Number.isFinite(Number(navigation?.x)) || !Number.isFinite(Number(navigation?.y))) {
    let navigationX = initialized ? body.x : legacyPose.x;
    let navigationY = initialized ? body.y : legacyPose.y;
    let routeProgress = body.bodyProgress;
    let clampedToBody = false;
    if (hasRoute) {
      const bodyProgress = clamp(body.bodyProgress, 0, progress.route.length);
      const requestedProgress = projectPoint({ x: navigationX, y: navigationY }, progress.route).progress;
      const boundedProgress = clamp(requestedProgress, bodyProgress, Math.min(
        progress.route.length,
        bodyProgress + body.maxAnchorLead
      ));
      const bounded = pointAtProgress(progress.route, boundedProgress);
      navigationX = bounded.x;
      navigationY = bounded.y;
      routeProgress = boundedProgress;
      clampedToBody = Math.abs(boundedProgress - requestedProgress) > 0.001;
    } else {
      const deltaX = navigationX - body.x;
      const deltaY = navigationY - body.y;
      const separation = Math.hypot(deltaX, deltaY);
      if (separation > body.maxAnchorLead && separation > EPSILON) {
        navigationX = body.x + ((deltaX / separation) * body.maxAnchorLead);
        navigationY = body.y + ((deltaY / separation) * body.maxAnchorLead);
        clampedToBody = true;
      }
    }
    writeAnchor(squad, 'navigationAnchor', {
      x: navigationX,
      y: navigationY,
      vx: initialized ? body.vx : legacyPose.vx,
      vy: initialized ? body.vy : legacyPose.vy,
      routeProgress,
      bodyProgress: body.bodyProgress,
      maxLead: body.maxAnchorLead,
      lead: Math.max(0, routeProgress - body.bodyProgress),
      lag: Math.max(0, body.bodyProgress - routeProgress),
      clampedToBody,
      heading: Math.atan2(finiteNumber(squad?.dirY), finiteNumber(squad?.dirX, 1)),
      sampledAt: body.sampledAt
    });
  } else if (!hasRoute) {
    // Once a command has ended, let the virtual cursor settle back onto the
    // physical body instead of leaving stale debug/navigation state behind.
    const settleAlpha = smooth ? clamp(1 - Math.exp(-FORMATION_SMOOTH_HZ * Math.max(0, finiteNumber(dt))), 0, 1) : 1;
    writeAnchor(squad, 'navigationAnchor', {
      ...navigation,
      x: finiteNumber(navigation?.x) + ((body.x - finiteNumber(navigation?.x)) * settleAlpha),
      y: finiteNumber(navigation?.y) + ((body.y - finiteNumber(navigation?.y)) * settleAlpha),
      vx: body.vx,
      vy: body.vy,
      routeProgress: body.bodyProgress,
      sampledAt: body.sampledAt
    });
  }
  // A refresh may be invoked by tactics/render preparation before the leader
  // gets a movement step that frame.  Enforce the cursor/body invariant here
  // as well, rather than relying on leaderMoveStep eventually correcting an
  // already-invalid virtual position.
  constrainTrainingCardNavigationAnchor({
    squad,
    agents,
    route: progress.route,
    candidate: squad.navigationAnchor || squad._navigationAnchor || body,
    nowSec: body.sampledAt
  });
  // Formation consumption can run before the next leader tick too.  A
  // zero-dt sync does not introduce another smoothing step; it only applies
  // the same hard body envelope if the freshly sampled troop mass moved.
  syncTrainingCardFormationAnchor({
    squad,
    agents,
    route: progress.route,
    nowSec: body.sampledAt,
    dt: 0
  });
  return body;
};

export const constrainTrainingCardNavigationAnchor = ({
  squad = null,
  agents = [],
  route = null,
  candidate = null,
  nowSec = 0
} = {}) => {
  if (!squad) return null;
  const body = resolveTrainingCardBodyAnchor(squad)
    || refreshTrainingCardBodyAnchor({ squad, agents, route, nowSec });
  const model = route?.segments ? route : resolveTrainingCardRoute(squad, route);
  const previous = resolveTrainingCardNavigationAnchor(squad) || body;
  const requested = candidate || previous;
  const headingVector = normalize(
    finiteNumber(requested?.vx, finiteNumber(squad?.dirX, 1)),
    finiteNumber(requested?.vy, finiteNumber(squad?.dirY))
  );
  let x = finiteNumber(requested?.x, finiteNumber(previous?.x, body.x));
  let y = finiteNumber(requested?.y, finiteNumber(previous?.y, body.y));
  let routeProgress = body.bodyProgress;
  let bodyRouteProgress = body.bodyProgress;
  let clamped = false;
  let caughtUpToBody = false;
  let spatiallyClamped = false;
  let allowedProgress = null;
  if (model?.segments?.length > 0) {
    // Replans replace the route underneath an existing body anchor.  Project
    // the physical pose onto the new route instead of borrowing progress from
    // the old one, otherwise a cursor reset can inherit an unrelated lead.
    bodyRouteProgress = resolveBodyProgressOnRoute(body, model);
    const projection = projectPoint({ x, y }, model);
    allowedProgress = Math.min(
      finiteNumber(model?.length),
      Math.max(0, bodyRouteProgress + Math.max(0, body.maxAnchorLead))
    );
    const minimumProgress = Math.min(
      finiteNumber(model?.length),
      Math.max(0, bodyRouteProgress)
    );
    routeProgress = Math.max(0, projection.progress);
    if (routeProgress < minimumProgress - 0.001) {
      const caughtUp = pointAtProgress(model, minimumProgress);
      x = caughtUp.x;
      y = caughtUp.y;
      routeProgress = minimumProgress;
      clamped = true;
      caughtUpToBody = true;
    } else if (routeProgress > allowedProgress + 0.001) {
      const capped = pointAtProgress(model, allowedProgress);
      x = capped.x;
      y = capped.y;
      routeProgress = allowedProgress;
      clamped = true;
    }
  }
  // Longitudinal clamping alone is insufficient when an obstacle has pushed
  // the physical body laterally away from a curved route.  Keep an absolute
  // world-space bound as well: no route cursor may sit tens of units away
  // merely because both positions project near the same route endpoint.
  const spatialClamp = clampPointToBodyDistance(body, x, y);
  if (spatialClamp.clamped) {
    x = spatialClamp.x;
    y = spatialClamp.y;
    clamped = true;
    spatiallyClamped = true;
    if (model?.segments?.length > 0) {
      routeProgress = Math.min(
        Number.isFinite(allowedProgress) ? allowedProgress : finiteNumber(model?.length),
        Math.max(0, projectPoint({ x, y }, model).progress)
      );
    }
  }
  const previousX = finiteNumber(previous?.x, x);
  const previousY = finiteNumber(previous?.y, y);
  const navigation = {
    ...previous,
    x,
    y,
    vx: finiteNumber(candidate?.vx, finiteNumber(previous?.vx)),
    vy: finiteNumber(candidate?.vy, finiteNumber(previous?.vy)),
    heading: Math.atan2(headingVector.y, headingVector.x),
    routeProgress,
    maxLead: body.maxAnchorLead,
    bodyProgress: bodyRouteProgress,
    lead: Math.max(0, routeProgress - bodyRouteProgress),
    lag: Math.max(0, bodyRouteProgress - routeProgress),
    caughtUpToBody,
    spatiallyClamped,
    clampedToBody: clamped,
    sampledAt: finiteNumber(nowSec)
  };
  // A body clamp is a hard invariant, so expose it for debug/recovery rather
  // than silently pretending that the virtual leader reached its waypoint.
  navigation.vx = finiteNumber(candidate?.vx, navigation.vx);
  navigation.vy = finiteNumber(candidate?.vy, navigation.vy);
  if (clamped && Math.hypot(x - previousX, y - previousY) <= EPSILON) {
    navigation.vx = 0;
    navigation.vy = 0;
  }
  writeAnchor(squad, 'navigationAnchor', navigation);
  squad.routeCursor = {
    progress: navigation.routeProgress,
    bodyProgress: navigation.bodyProgress,
    rearProgress: body.rearProgress,
    frontProgress: body.frontProgress,
    maxLead: body.maxAnchorLead,
    clamped: navigation.clampedToBody,
    spatiallyClamped: navigation.spatiallyClamped === true,
    sampledAt: navigation.sampledAt
  };
  return navigation;
};

export const syncTrainingCardFormationAnchor = ({
  squad = null,
  agents = [],
  route = null,
  nowSec = 0,
  dt = 0,
  immediate = false
} = {}) => {
  if (!squad) return null;
  const body = resolveTrainingCardBodyAnchor(squad)
    || refreshTrainingCardBodyAnchor({ squad, agents, route, nowSec });
  const navigation = resolveTrainingCardNavigationAnchor(squad) || body;
  const previous = resolveTrainingCardFormationAnchor(squad);
  const alpha = immediate || !previous
    ? 1
    : clamp(1 - Math.exp(-FORMATION_SMOOTH_HZ * Math.max(0, finiteNumber(dt))), 0, 1);
  let x = previous ? finiteNumber(previous?.x) + ((finiteNumber(navigation?.x) - finiteNumber(previous?.x)) * alpha) : finiteNumber(navigation?.x);
  let y = previous ? finiteNumber(previous?.y) + ((finiteNumber(navigation?.y) - finiteNumber(previous?.y)) * alpha) : finiteNumber(navigation?.y);
  const model = route?.segments ? route : resolveTrainingCardRoute(squad, route);
  let routeProgress = body.bodyProgress;
  let bodyRouteProgress = body.bodyProgress;
  let clamped = false;
  let caughtUpToBody = false;
  let spatiallyClamped = false;
  let allowedProgress = null;
  if (model?.segments?.length > 0) {
    bodyRouteProgress = resolveBodyProgressOnRoute(body, model);
    const projection = projectPoint({ x, y }, model);
    allowedProgress = Math.min(model.length, bodyRouteProgress + body.maxAnchorLead);
    const maximumLag = resolveTrainingCardMaxFormationAnchorLag(squad, agents);
    const minimumProgress = Math.min(model.length, Math.max(0, bodyRouteProgress - maximumLag));
    routeProgress = projection.progress;
    if (routeProgress < minimumProgress - 0.001) {
      const caughtUp = pointAtProgress(model, minimumProgress);
      x = caughtUp.x;
      y = caughtUp.y;
      routeProgress = minimumProgress;
      clamped = true;
      caughtUpToBody = true;
    } else if (routeProgress > allowedProgress + 0.001) {
      const capped = pointAtProgress(model, allowedProgress);
      x = capped.x;
      y = capped.y;
      routeProgress = allowedProgress;
      clamped = true;
    }
  }
  const spatialClamp = clampPointToBodyDistance(body, x, y);
  if (spatialClamp.clamped) {
    x = spatialClamp.x;
    y = spatialClamp.y;
    clamped = true;
    spatiallyClamped = true;
    if (model?.segments?.length > 0) {
      routeProgress = Math.min(
        Number.isFinite(allowedProgress) ? allowedProgress : finiteNumber(model?.length),
        Math.max(0, projectPoint({ x, y }, model).progress)
      );
    }
  }
  const forward = normalize(
    finiteNumber(navigation?.vx, finiteNumber(squad?.dirX, 1)),
    finiteNumber(navigation?.vy, finiteNumber(squad?.dirY))
  );
  const formation = {
    ...(previous || {}),
    x,
    y,
    vx: previous && finiteNumber(dt) > EPSILON ? (x - finiteNumber(previous?.x)) / finiteNumber(dt) : finiteNumber(navigation?.vx),
    vy: previous && finiteNumber(dt) > EPSILON ? (y - finiteNumber(previous?.y)) / finiteNumber(dt) : finiteNumber(navigation?.vy),
    heading: Number.isFinite(Number(squad?._formationPoseYaw))
      ? Number(squad._formationPoseYaw)
      : Math.atan2(forward.y, forward.x),
    routeProgress,
    bodyProgress: bodyRouteProgress,
    maxLead: body.maxAnchorLead,
    lead: Math.max(0, routeProgress - bodyRouteProgress),
    lag: Math.max(0, bodyRouteProgress - routeProgress),
    maxLag: resolveTrainingCardMaxFormationAnchorLag(squad, agents),
    caughtUpToBody,
    spatiallyClamped,
    clampedToBody: clamped,
    sampledAt: finiteNumber(nowSec)
  };
  writeAnchor(squad, 'formationAnchor', formation);
  return formation;
};

export const getTrainingCardRoutePointAtProgress = (route = null, progress = 0) => (
  pointAtProgress(route?.segments ? route : buildSegments(route), progress)
);

export const projectTrainingCardPointToRoute = (point = {}, route = null) => (
  projectPoint(point, route?.segments ? route : buildSegments(route))
);

export const getTrainingCardRouteTangentAtProgress = (route = null, progress = 0) => (
  tangentAtProgress(route?.segments ? route : buildSegments(route), progress)
);
