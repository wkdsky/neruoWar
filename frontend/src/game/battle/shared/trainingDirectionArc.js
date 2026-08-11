const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const TRAINING_DIRECTION_ARC_SEGMENTS = 22;
export const TRAINING_DIRECTION_ARC_CORNER_EPSILON_RAD = 0.12;
export const TRAINING_DIRECTION_ARC_MAX_HALF_SPREAD_RAD = 1.15;
export const TRAINING_DIRECTION_ARC_CENTRAL_ANGLE_RAD = Math.PI / 2;
export const TRAINING_DIRECTION_ARC_INSET_RATIO = 0.14;
export const TRAINING_DIRECTION_ARC_MIN_INSET = 3;
export const TRAINING_DIRECTION_ARC_MAX_INSET = 9;
export const TRAINING_DIRECTION_ARC_DIRECTION_COUNT = 8;
export const TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD = (
  Math.PI * 2
) / TRAINING_DIRECTION_ARC_DIRECTION_COUNT;
export const TRAINING_DIRECTION_ARC_DEFAULT_HIT_OPTIONS = Object.freeze({
  minimumHitRadius: 3,
  maximumHitRadius: 8,
  extraPadding: 2
});

const normalizeAngleDelta = (value = 0) => {
  let delta = Number(value) || 0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export const snapTrainingDirectionOffset = (value = 0) => {
  const snapped = normalizeAngleDelta(
    Math.round(normalizeAngleDelta(value) / TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD)
      * TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD
  );
  return Math.abs(snapped + Math.PI) <= 1e-6 ? Math.PI : snapped;
};

const resolveMarkerStrength = (source = null) => {
  const direct = Math.max(0, finiteOr(source?.remain), finiteOr(source?.startCount));
  const unitCount = Object.values(source?.units || {})
    .reduce((sum, value) => sum + Math.max(0, finiteOr(value)), 0);
  return Math.max(direct, unitCount);
};

export const resolveTrainingFormationDimensions = (source = null) => {
  const rect = source?.formationRect || {};
  const strength = Math.max(1, resolveMarkerStrength(source));
  const squadRadius = Math.max(0, finiteOr(source?.radius));
  const inferredSpan = Math.sqrt(strength) * 3;
  return {
    width: Math.max(10, finiteOr(rect.width), squadRadius * 1.9, inferredSpan),
    depth: Math.max(8, finiteOr(rect.depth), squadRadius, inferredSpan * 0.68)
  };
};

export const resolveTrainingFormationFacing = (source = null, team = 'attacker') => {
  const facing = Number(source?.formationRect?.facingRad);
  return Number.isFinite(facing) ? facing : (team === 'defender' ? Math.PI : 0);
};

export const resolveTrainingDirectionYaw = (
  source = null,
  team = 'attacker',
  preferFormationFacing = false
) => {
  const formationFacing = resolveTrainingFormationFacing(source, team);
  const directionRad = Number(source?.formationRect?.directionRad);
  if (Number.isFinite(directionRad)) return directionRad;
  const directionOffset = Number(source?.formationRect?.directionOffsetRad);
  if (Number.isFinite(directionOffset)) {
    return formationFacing + snapTrainingDirectionOffset(directionOffset);
  }
  const legacyDirection = Number(source?.formationRect?.directionRad);
  if (Number.isFinite(legacyDirection)) {
    return formationFacing + snapTrainingDirectionOffset(legacyDirection - formationFacing);
  }
  if (preferFormationFacing) return formationFacing;
  const primaryX = finiteOr(source?.dirX, finiteOr(source?.vx));
  const primaryY = finiteOr(source?.dirY, finiteOr(source?.vy));
  if (Math.hypot(primaryX, primaryY) > 0.1) {
    return formationFacing + snapTrainingDirectionOffset(
      Math.atan2(primaryY, primaryX) - formationFacing
    );
  }
  return formationFacing;
};

export const resolveTrainingDirectionOffset = (source = null, team = 'attacker') => {
  const formationFacing = resolveTrainingFormationFacing(source, team);
  const directionOffset = Number(source?.formationRect?.directionOffsetRad);
  if (Number.isFinite(directionOffset)) return snapTrainingDirectionOffset(directionOffset);
  const legacyDirection = Number(source?.formationRect?.directionRad);
  if (Number.isFinite(legacyDirection)) return snapTrainingDirectionOffset(legacyDirection - formationFacing);
  return 0;
};

const resolveFormationFrame = (source = null, team = 'attacker', preferFormationFacing = true) => {
  const dimensions = resolveTrainingFormationDimensions(source);
  const formationYaw = resolveTrainingFormationFacing(source, team);
  const directionYaw = resolveTrainingDirectionYaw(source, team, preferFormationFacing);
  const forward = { x: Math.cos(formationYaw), y: Math.sin(formationYaw) };
  const side = { x: -forward.y, y: forward.x };
  return {
    center: {
      x: finiteOr(source?.centerX, finiteOr(source?.x)),
      y: finiteOr(source?.centerY, finiteOr(source?.y))
    },
    width: dimensions.width,
    depth: dimensions.depth,
    halfWidth: dimensions.width * 0.5,
    halfDepth: dimensions.depth * 0.5,
    formationYaw,
    directionYaw,
    forward,
    side
  };
};

export const resolveTrainingDirectionArcInset = (frame = {}) => {
  const desiredInset = clamp(
    Math.min(Number(frame.width) || 0, Number(frame.depth) || 0)
      * TRAINING_DIRECTION_ARC_INSET_RATIO,
    TRAINING_DIRECTION_ARC_MIN_INSET,
    TRAINING_DIRECTION_ARC_MAX_INSET
  );
  const minimumHalfEdge = Math.min(
    Math.max(0, Number(frame.halfWidth) || 0),
    Math.max(0, Number(frame.halfDepth) || 0)
  );
  return Math.min(desiredInset, minimumHalfEdge * 0.45);
};

const resolveRayRectIntersection = (frame, yaw, inset = 0) => {
  const delta = normalizeAngleDelta(yaw - frame.formationYaw);
  const localFront = Math.cos(delta);
  const localSide = Math.sin(delta);
  const halfDepth = Math.max(0.5, frame.halfDepth - inset);
  const halfWidth = Math.max(0.5, frame.halfWidth - inset);
  const frontDistance = Math.abs(localFront) > 1e-6
    ? halfDepth / Math.abs(localFront)
    : Number.POSITIVE_INFINITY;
  const sideDistance = Math.abs(localSide) > 1e-6
    ? halfWidth / Math.abs(localSide)
    : Number.POSITIVE_INFINITY;
  const distance = Math.min(frontDistance, sideDistance);
  const tolerance = 1e-5;
  const edges = [];
  if (frontDistance <= sideDistance + tolerance) edges.push(localFront >= 0 ? 'front' : 'back');
  if (sideDistance <= frontDistance + tolerance) edges.push(localSide >= 0 ? 'right' : 'left');
  return {
    x: frame.center.x + (Math.cos(yaw) * distance),
    y: frame.center.y + (Math.sin(yaw) * distance),
    distance,
    edges
  };
};

const resolveCornerAngles = (frame) => (
  [-1, 1].flatMap((frontSign) => ([-1, 1].map((sideSign) => {
    const x = frame.center.x
      + (frame.forward.x * frame.halfDepth * frontSign)
      + (frame.side.x * frame.halfWidth * sideSign);
    const y = frame.center.y
      + (frame.forward.y * frame.halfDepth * frontSign)
      + (frame.side.y * frame.halfWidth * sideSign);
    return Math.atan2(y - frame.center.y, x - frame.center.x);
  })))
);

const resolveHalfSpread = (frame) => {
  const nearestCornerDelta = resolveCornerAngles(frame)
    .reduce((nearest, cornerYaw) => Math.min(
      nearest,
      Math.abs(normalizeAngleDelta(frame.directionYaw - cornerYaw))
    ), Math.PI);
  const directionStep = Math.round(
    normalizeAngleDelta(frame.directionYaw - frame.formationYaw)
      / TRAINING_DIRECTION_ARC_DIRECTION_STEP_RAD
  );
  const isDiagonalDirection = Math.abs(directionStep) % 2 === 1;
  if (isDiagonalDirection) {
    return Math.min(
      TRAINING_DIRECTION_ARC_MAX_HALF_SPREAD_RAD,
      Math.max(0.22, nearestCornerDelta + 0.08)
    );
  }
  if (nearestCornerDelta <= TRAINING_DIRECTION_ARC_CORNER_EPSILON_RAD) {
    return Math.min(
      TRAINING_DIRECTION_ARC_MAX_HALF_SPREAD_RAD,
      Math.max(0.22, nearestCornerDelta + 0.24)
    );
  }
  return Math.min(
    TRAINING_DIRECTION_ARC_MAX_HALF_SPREAD_RAD,
    Math.max(0.18, nearestCornerDelta * 0.82)
  );
};

export const resolveTrainingDirectionArcLayout = (
  source = null,
  team = 'attacker',
  { preferFormationFacing = true } = {}
) => {
  const frame = resolveFormationFrame(source, team, preferFormationFacing);
  const halfSpreadRad = resolveHalfSpread(frame);
  const arcInset = resolveTrainingDirectionArcInset(frame);
  const start = resolveRayRectIntersection(frame, frame.directionYaw - halfSpreadRad, arcInset);
  const end = resolveRayRectIntersection(frame, frame.directionYaw + halfSpreadRad, arcInset);
  const boundary = resolveRayRectIntersection(frame, frame.directionYaw, arcInset);
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  const outward = { x: Math.cos(frame.directionYaw), y: Math.sin(frame.directionYaw) };
  const chordMidpoint = {
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5
  };
  let arcNormal = chord <= 1e-6
    ? { ...outward }
    : { x: -(end.y - start.y) / chord, y: (end.x - start.x) / chord };
  if ((arcNormal.x * outward.x) + (arcNormal.y * outward.y) < 0) {
    arcNormal = { x: -arcNormal.x, y: -arcNormal.y };
  }
  const halfCentralAngle = TRAINING_DIRECTION_ARC_CENTRAL_ANGLE_RAD * 0.5;
  const arcRadius = chord <= 1e-6
    ? 1
    : chord / (2 * Math.sin(halfCentralAngle));
  const centerDistance = chord <= 1e-6
    ? 0
    : chord / (2 * Math.tan(halfCentralAngle));
  const arcCenter = {
    x: chordMidpoint.x - (arcNormal.x * centerDistance),
    y: chordMidpoint.y - (arcNormal.y * centerDistance)
  };
  const startAngle = Math.atan2(start.y - arcCenter.y, start.x - arcCenter.x);
  const endAngle = Math.atan2(end.y - arcCenter.y, end.x - arcCenter.x);
  const sweepRad = normalizeAngleDelta(endAngle - startAngle);
  const middleAngle = startAngle + (sweepRad * 0.5);
  const apex = {
    x: arcCenter.x + (Math.cos(middleAngle) * arcRadius),
    y: arcCenter.y + (Math.sin(middleAngle) * arcRadius)
  };
  const bulgeDepth = Math.max(0, (
    ((apex.x - chordMidpoint.x) * arcNormal.x)
    + ((apex.y - chordMidpoint.y) * arcNormal.y)
  ));
  return {
    ...frame,
    halfSpreadRad,
    arcInset,
    start,
    end,
    boundary,
    apex,
    outward,
    arcCenter,
    arcRadius,
    startAngle,
    sweepRad,
    bulgeDepth,
    bandWidth: clamp(Math.min(frame.width, frame.depth) * 0.22, 4, 12)
  };
};

export const sampleTrainingDirectionArc = (
  layout = null,
  segments = TRAINING_DIRECTION_ARC_SEGMENTS
) => {
  if (!layout) return [];
  const count = Math.max(2, Math.floor(Number(segments) || TRAINING_DIRECTION_ARC_SEGMENTS));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const angle = layout.startAngle + (layout.sweepRad * t);
    const point = {
      x: layout.arcCenter.x + (Math.cos(angle) * layout.arcRadius),
      y: layout.arcCenter.y + (Math.sin(angle) * layout.arcRadius)
    };
    const tangent = {
      x: -Math.sin(angle) * layout.arcRadius * layout.sweepRad,
      y: Math.cos(angle) * layout.arcRadius * layout.sweepRad
    };
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
    let normal = { x: -tangent.y / tangentLength, y: tangent.x / tangentLength };
    if ((normal.x * layout.outward.x) + (normal.y * layout.outward.y) < 0) {
      normal = { x: -normal.x, y: -normal.y };
    }
    const halfBand = (layout.bandWidth * 0.5) * Math.sin(Math.PI * t);
    return {
      t,
      point,
      sideA: {
        x: point.x + (normal.x * halfBand),
        y: point.y + (normal.y * halfBand)
      },
      sideB: {
        x: point.x - (normal.x * halfBand),
        y: point.y - (normal.y * halfBand)
      }
    };
  });
};

const pointToSegmentDistance = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = (dx * dx) + (dy * dy);
  if (denominator <= 1e-8) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = clamp(
    (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / denominator,
    0,
    1
  );
  return Math.hypot(
    point.x - (start.x + (dx * progress)),
    point.y - (start.y + (dy * progress))
  );
};

export const isPointOnTrainingDirectionArc = (
  point = null,
  source = null,
  team = 'attacker',
  hitOptions = TRAINING_DIRECTION_ARC_DEFAULT_HIT_OPTIONS
) => {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const layout = resolveTrainingDirectionArcLayout(source, team);
  const samples = sampleTrainingDirectionArc(layout);
  const minimumHitRadius = Math.max(
    1,
    finiteOr(hitOptions?.minimumHitRadius, TRAINING_DIRECTION_ARC_DEFAULT_HIT_OPTIONS.minimumHitRadius)
  );
  const maximumHitRadius = Math.max(
    minimumHitRadius,
    finiteOr(hitOptions?.maximumHitRadius, TRAINING_DIRECTION_ARC_DEFAULT_HIT_OPTIONS.maximumHitRadius)
  );
  const extraPadding = Math.max(
    0,
    finiteOr(hitOptions?.extraPadding, TRAINING_DIRECTION_ARC_DEFAULT_HIT_OPTIONS.extraPadding)
  );
  const visibleHalfBand = Math.max(0.5, layout.bandWidth * 0.5);
  const hitRadius = clamp(visibleHalfBand + extraPadding, minimumHitRadius, maximumHitRadius);
  for (let index = 1; index < samples.length; index += 1) {
    if (pointToSegmentDistance({ x, y }, samples[index - 1].point, samples[index].point) <= hitRadius) {
      return true;
    }
  }
  return false;
};

export const resolveTrainingDirectionOffsetFromPoint = (source = null, point = null, team = 'attacker') => {
  const centerX = finiteOr(source?.centerX, finiteOr(source?.x));
  const centerY = finiteOr(source?.centerY, finiteOr(source?.y));
  const dx = Number(point?.x) - centerX;
  const dy = Number(point?.y) - centerY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= 1e-4) return null;
  return snapTrainingDirectionOffset(
    Math.atan2(dy, dx) - resolveTrainingFormationFacing(source, team)
  );
};
