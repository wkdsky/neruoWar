const geometry = require('../data/training-war-map-v1/geometry.json');
const navigation = require('../data/training-war-map-v1/navigation.json');
const objectiveData = require('../data/training-war-map-v1/objectives.json');
const neutralCampData = require('../data/training-war-map-v1/neutral-camps.json');
const highlandDefenseData = require('../data/training-war-map-v1/highland-defense.json');

const REFERENCE_RUNTIME_WORLD_WIDTH = 3600;
const REFERENCE_RUNTIME_WORLD_HEIGHT = 2504;
const NORMAL_TOWER_FOOTPRINT_SCALE = 0.5;
const NORMAL_TOWER_BASE_SIZE = 58;
const NORMAL_TOWER_BASE_HEIGHT = 96;

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const finiteNumber = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizeTeam = (team) => (team === 'defender' ? 'defender' : 'attacker');

const resolveTowerRuntimeConfig = () => {
  const definition = objectiveData?.towerRuntime && typeof objectiveData.towerRuntime === 'object'
    ? objectiveData.towerRuntime
    : {};
  const priority = typeof definition?.priority === 'string' && definition.priority.trim()
    ? definition.priority.trim()
    : 'nearest';
  return {
    maxHp: Math.max(1, finiteNumber(definition?.maxHp, 2200)),
    attackRange: Math.max(0, finiteNumber(definition?.attackRange, 329)),
    attackIntervalSec: Math.max(0.1, finiteNumber(definition?.attackIntervalSec, 0.8)),
    attackDamage: Math.max(0, finiteNumber(definition?.attackDamage, 20)),
    priority,
    threatDecayPerSecond: Math.max(0, finiteNumber(definition?.threatDecayPerSecond, 0.2))
  };
};

const resolveLayout = () => ({
  fieldWidth: Math.max(100, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.width, 12600)),
  fieldHeight: Math.max(100, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.height, 8764))
});

const resolveRuntimeScale = (layout = resolveLayout()) => Math.max(0.1, Math.min(
  finiteNumber(layout?.fieldWidth, REFERENCE_RUNTIME_WORLD_WIDTH) / REFERENCE_RUNTIME_WORLD_WIDTH,
  finiteNumber(layout?.fieldHeight, REFERENCE_RUNTIME_WORLD_HEIGHT) / REFERENCE_RUNTIME_WORLD_HEIGHT
));

const resolveReferenceAssetBounds = () => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  return {
    width: Math.max(1, finiteNumber(bounds?.width, 1607)),
    height: Math.max(1, finiteNumber(bounds?.height, 1118))
  };
};

const normalizedToWorld = (point = {}, layout = resolveLayout()) => ({
  x: (finiteNumber(point?.x) - 0.5) * layout.fieldWidth,
  y: (0.5 - finiteNumber(point?.y)) * layout.fieldHeight
});

const tupleToWorld = (point = [], layout = resolveLayout()) => normalizedToWorld({
  x: point?.[0],
  y: point?.[1]
}, layout);

const interpolateWorldPoint = (from = {}, to = {}, progress = 0) => ({
  x: finiteNumber(from?.x) + ((finiteNumber(to?.x) - finiteNumber(from?.x)) * progress),
  y: finiteNumber(from?.y) + ((finiteNumber(to?.y) - finiteNumber(from?.y)) * progress)
});

const scaleHighlandFootprint = (points = [], team = 'attacker', layout = resolveLayout(), scale = 1) => {
  const safePoints = Array.isArray(points) ? points : [];
  const footprintScale = Math.max(1, Math.min(1.35, finiteNumber(scale, 1)));
  if (safePoints.length <= 0 || footprintScale <= 1.0001) return safePoints;
  const boundaryX = normalizeTeam(team) === 'defender'
    ? finiteNumber(layout?.fieldWidth) * 0.5
    : finiteNumber(layout?.fieldWidth) * -0.5;
  const boundaryY = safePoints.reduce((sum, point) => sum + finiteNumber(point?.y), 0) / safePoints.length;
  return safePoints.map((point) => ({
    x: boundaryX + ((finiteNumber(point?.x) - boundaryX) * footprintScale),
    y: boundaryY + ((finiteNumber(point?.y) - boundaryY) * footprintScale)
  }));
};

const buildHighlandRamps = (points = [], rampInset = 0.22) => {
  const safePoints = Array.isArray(points) ? points : [];
  if (safePoints.length < 3) return [];
  const inset = Math.max(0.08, Math.min(0.36, finiteNumber(rampInset, 0.22)));
  return safePoints.map((point, index) => {
    const next = safePoints[(index + 1) % safePoints.length] || point;
    const previous = safePoints[(index + safePoints.length - 1) % safePoints.length] || point;
    return {
      id: `ramp-${index + 1}`,
      vertexIndex: index,
      points: [
        { x: finiteNumber(point?.x), y: finiteNumber(point?.y) },
        interpolateWorldPoint(point, next, inset),
        interpolateWorldPoint(point, previous, inset)
      ]
    };
  });
};

const intersectWorldLines = (
  firstOrigin = {},
  firstDirection = {},
  secondOrigin = {},
  secondDirection = {}
) => {
  const firstDirectionX = finiteNumber(firstDirection?.x);
  const firstDirectionY = finiteNumber(firstDirection?.y);
  const secondDirectionX = finiteNumber(secondDirection?.x);
  const secondDirectionY = finiteNumber(secondDirection?.y);
  const determinant = (firstDirectionX * secondDirectionY) - (firstDirectionY * secondDirectionX);
  if (Math.abs(determinant) <= 0.000001) {
    return { x: finiteNumber(firstOrigin?.x), y: finiteNumber(firstOrigin?.y) };
  }
  const originOffsetX = finiteNumber(secondOrigin?.x) - finiteNumber(firstOrigin?.x);
  const originOffsetY = finiteNumber(secondOrigin?.y) - finiteNumber(firstOrigin?.y);
  const firstProgress = ((originOffsetX * secondDirectionY) - (originOffsetY * secondDirectionX))
    / determinant;
  return {
    x: finiteNumber(firstOrigin?.x) + (firstDirectionX * firstProgress),
    y: finiteNumber(firstOrigin?.y) + (firstDirectionY * firstProgress)
  };
};

const normalizeHighlandOuterEdgeCurve = (curve = {}) => {
  if (String(curve?.kind || '') !== 'semicircle') return null;
  return {
    kind: 'semicircle',
    segments: Math.max(8, Math.min(64, Math.floor(finiteNumber(curve?.segments, 24)))),
    bulgeScale: Math.max(1, Math.min(1.35, finiteNumber(curve?.bulgeScale, 1)))
  };
};

const buildHighlandSemicirclePath = (
  start = {},
  end = {},
  toward = {},
  segments = 24,
  bulgeScale = 1
) => {
  const startPoint = { x: finiteNumber(start?.x), y: finiteNumber(start?.y) };
  const endPoint = { x: finiteNumber(end?.x), y: finiteNumber(end?.y) };
  const center = {
    x: (startPoint.x + endPoint.x) * 0.5,
    y: (startPoint.y + endPoint.y) * 0.5
  };
  const radialVector = {
    x: startPoint.x - center.x,
    y: startPoint.y - center.y
  };
  const chordRadius = Math.hypot(radialVector.x, radialVector.y);
  if (chordRadius <= 0.000001) return [startPoint, endPoint];
  const towardOffset = {
    x: finiteNumber(toward?.x) - center.x,
    y: finiteNumber(toward?.y) - center.y
  };
  const candidateBulgeAxis = {
    x: -radialVector.y / chordRadius,
    y: radialVector.x / chordRadius
  };
  const shouldReverseBulgeAxis = (
    (candidateBulgeAxis.x * towardOffset.x) + (candidateBulgeAxis.y * towardOffset.y)
  ) < 0;
  const bulgeAxis = {
    x: shouldReverseBulgeAxis ? -candidateBulgeAxis.x : candidateBulgeAxis.x,
    y: shouldReverseBulgeAxis ? -candidateBulgeAxis.y : candidateBulgeAxis.y
  };
  const chordAxis = {
    x: radialVector.x / chordRadius,
    y: radialVector.y / chordRadius
  };
  const sagitta = chordRadius * Math.max(0.25, Math.min(2.5, finiteNumber(bulgeScale, 1)));
  const circleRadius = (sagitta * sagitta + chordRadius * chordRadius) / (2 * sagitta);
  const circleCenterOffset = (sagitta * sagitta - chordRadius * chordRadius) / (2 * sagitta);
  const circleCenter = {
    x: center.x + (bulgeAxis.x * circleCenterOffset),
    y: center.y + (bulgeAxis.y * circleCenterOffset)
  };
  const startAngle = Math.atan2(chordRadius, -circleCenterOffset);
  const endAngle = Math.atan2(-chordRadius, -circleCenterOffset);
  const segmentCount = Math.max(8, Math.min(64, Math.floor(finiteNumber(segments, 24))));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    if (index === 0) return startPoint;
    if (index === segmentCount) return endPoint;
    const angle = startAngle + ((endAngle - startAngle) * index / segmentCount);
    return {
      x: circleCenter.x + (bulgeAxis.x * circleRadius * Math.cos(angle)) + (chordAxis.x * circleRadius * Math.sin(angle)),
      y: circleCenter.y + (bulgeAxis.y * circleRadius * Math.cos(angle)) + (chordAxis.y * circleRadius * Math.sin(angle))
    };
  });
};

const normalizeHighlandFrontRamp = (definition = {}) => {
  const frontRamp = definition && typeof definition === 'object' ? definition : {};
  return {
    highEdgeArcFraction: Math.max(0.12, Math.min(
      0.72,
      finiteNumber(frontRamp?.highEdgeArcFraction, 0.34)
    )),
    lowEdgeWidthScale: Math.max(1.05, Math.min(
      2.4,
      finiteNumber(frontRamp?.lowEdgeWidthScale, 1.45)
    )),
    outwardLengthRatio: Math.max(0.16, Math.min(
      1.25,
      finiteNumber(frontRamp?.outwardLengthRatio, 0.65)
    ))
  };
};

const normalizeHighlandEdgeRamps = (definition = {}, rampInset = 0.22) => {
  const edgeRamps = definition && typeof definition === 'object' ? definition : {};
  const defaultEdgeWidthScale = 1 + Math.min(0.25, finiteNumber(rampInset, 0.22) * 0.55);
  return {
    edgeWidthScale: Math.max(1, Math.min(
      1.8,
      finiteNumber(
        edgeRamps?.edgeWidthScale ?? edgeRamps?.lowEdgeWidthScale,
        defaultEdgeWidthScale
      )
    )),
    slopeLengthScale: Math.max(1, Math.min(
      2.5,
      finiteNumber(edgeRamps?.slopeLengthScale, 1)
    ))
  };
};

const buildFrontOutwardTrapezoidHighlandSurface = (
  points = [],
  rampInset = 0.22,
  outerEdgeCurve = null,
  frontRamp = null,
  edgeRamps = null
) => {
  const safePoints = Array.isArray(points) ? points : [];
  if (safePoints.length !== 3) return null;

  const [upperOuterPoint, routePoint, lowerOuterPoint] = safePoints;
  const inset = Math.max(0.08, Math.min(0.36, finiteNumber(rampInset, 0.22)));
  const outerMidpoint = {
    x: (finiteNumber(upperOuterPoint?.x) + finiteNumber(lowerOuterPoint?.x)) * 0.5,
    y: (finiteNumber(upperOuterPoint?.y) + finiteNumber(lowerOuterPoint?.y)) * 0.5
  };
  const routeOffset = {
    x: finiteNumber(routePoint?.x) - outerMidpoint.x,
    y: finiteNumber(routePoint?.y) - outerMidpoint.y
  };
  const routeDistance = Math.hypot(routeOffset.x, routeOffset.y);
  const outerSpan = {
    x: finiteNumber(lowerOuterPoint?.x) - finiteNumber(upperOuterPoint?.x),
    y: finiteNumber(lowerOuterPoint?.y) - finiteNumber(upperOuterPoint?.y)
  };
  const outerSpanDistance = Math.hypot(outerSpan.x, outerSpan.y);
  if (routeDistance <= 0.000001 || outerSpanDistance <= 0.000001) return null;

  const candidateFrontAxis = {
    x: -outerSpan.y / outerSpanDistance,
    y: outerSpan.x / outerSpanDistance
  };
  const frontAxisNeedsReversing = (
    (candidateFrontAxis.x * routeOffset.x) + (candidateFrontAxis.y * routeOffset.y)
  ) < 0;
  const frontAxis = {
    x: frontAxisNeedsReversing ? -candidateFrontAxis.x : candidateFrontAxis.x,
    y: frontAxisNeedsReversing ? -candidateFrontAxis.y : candidateFrontAxis.y
  };
  const outerSpanAxis = {
    x: outerSpan.x / outerSpanDistance,
    y: outerSpan.y / outerSpanDistance
  };
  const upperBaseRouteHighPoint = interpolateWorldPoint(upperOuterPoint, routePoint, inset);
  const lowerBaseRouteHighPoint = interpolateWorldPoint(lowerOuterPoint, routePoint, inset);
  const upperBaseOuterHighPoint = intersectWorldLines(
    upperOuterPoint,
    outerSpan,
    upperBaseRouteHighPoint,
    frontAxis
  );
  const lowerBaseOuterHighPoint = intersectWorldLines(
    upperOuterPoint,
    outerSpan,
    lowerBaseRouteHighPoint,
    frontAxis
  );
  const rampProfile = normalizeHighlandFrontRamp(frontRamp);
  const edgeRampProfile = normalizeHighlandEdgeRamps(edgeRamps, inset);
  const upperBaseSlopeLength = Math.max(1, Math.abs(
    ((finiteNumber(upperBaseOuterHighPoint?.x) - finiteNumber(upperOuterPoint?.x)) * outerSpanAxis.x)
      + ((finiteNumber(upperBaseOuterHighPoint?.y) - finiteNumber(upperOuterPoint?.y)) * outerSpanAxis.y)
  ));
  const lowerBaseSlopeLength = Math.max(1, Math.abs(
    ((finiteNumber(lowerBaseOuterHighPoint?.x) - finiteNumber(lowerOuterPoint?.x)) * outerSpanAxis.x)
      + ((finiteNumber(lowerBaseOuterHighPoint?.y) - finiteNumber(lowerOuterPoint?.y)) * outerSpanAxis.y)
  ));
  const upperBaseEdgeWidth = Math.max(1, Math.abs(
    ((finiteNumber(upperBaseRouteHighPoint?.x) - finiteNumber(upperBaseOuterHighPoint?.x)) * frontAxis.x)
      + ((finiteNumber(upperBaseRouteHighPoint?.y) - finiteNumber(upperBaseOuterHighPoint?.y)) * frontAxis.y)
  ));
  const lowerBaseEdgeWidth = Math.max(1, Math.abs(
    ((finiteNumber(lowerBaseRouteHighPoint?.x) - finiteNumber(lowerBaseOuterHighPoint?.x)) * frontAxis.x)
      + ((finiteNumber(lowerBaseRouteHighPoint?.y) - finiteNumber(lowerBaseOuterHighPoint?.y)) * frontAxis.y)
  ));
  const upperSlopeLength = upperBaseSlopeLength * edgeRampProfile.slopeLengthScale;
  const lowerSlopeLength = lowerBaseSlopeLength * edgeRampProfile.slopeLengthScale;
  const upperSideEdgeWidth = upperBaseEdgeWidth * edgeRampProfile.edgeWidthScale;
  const lowerSideEdgeWidth = lowerBaseEdgeWidth * edgeRampProfile.edgeWidthScale;
  const upperOuterHighPoint = {
    x: finiteNumber(upperOuterPoint?.x) + (outerSpanAxis.x * upperSlopeLength),
    y: finiteNumber(upperOuterPoint?.y) + (outerSpanAxis.y * upperSlopeLength)
  };
  const lowerOuterHighPoint = {
    x: finiteNumber(lowerOuterPoint?.x) - (outerSpanAxis.x * lowerSlopeLength),
    y: finiteNumber(lowerOuterPoint?.y) - (outerSpanAxis.y * lowerSlopeLength)
  };
  const upperRouteHighPoint = {
    x: upperOuterHighPoint.x + (frontAxis.x * upperSideEdgeWidth),
    y: upperOuterHighPoint.y + (frontAxis.y * upperSideEdgeWidth)
  };
  const lowerRouteHighPoint = {
    x: lowerOuterHighPoint.x + (frontAxis.x * lowerSideEdgeWidth),
    y: lowerOuterHighPoint.y + (frontAxis.y * lowerSideEdgeWidth)
  };
  const curve = normalizeHighlandOuterEdgeCurve(outerEdgeCurve) || {
    kind: 'semicircle',
    segments: 24,
    bulgeScale: 1
  };
  const fullFrontPath = buildHighlandSemicirclePath(
    upperRouteHighPoint,
    lowerRouteHighPoint,
    routePoint,
    curve.segments,
    curve.bulgeScale
  );
  const totalFrontSegments = fullFrontPath.length - 1;
  if (totalFrontSegments < 3) return null;

  const rampSegmentCount = Math.max(1, Math.min(
    totalFrontSegments - 2,
    Math.round(totalFrontSegments * rampProfile.highEdgeArcFraction)
  ));
  const railSegmentCount = Math.max(1, Math.floor(
    (totalFrontSegments - rampSegmentCount) * 0.5
  ));
  const highlandStartIndex = railSegmentCount;
  const highlandEndIndex = totalFrontSegments - railSegmentCount;
  if (highlandEndIndex <= highlandStartIndex) return null;

  const upperRailingPath = fullFrontPath.slice(0, highlandStartIndex + 1);
  const lowerRailingPath = fullFrontPath.slice(highlandEndIndex);
  const highlandStart = upperRailingPath[upperRailingPath.length - 1];
  const highlandEnd = lowerRailingPath[0];
  const highEdge = {
    x: finiteNumber(highlandEnd?.x) - finiteNumber(highlandStart?.x),
    y: finiteNumber(highlandEnd?.y) - finiteNumber(highlandStart?.y)
  };
  const highEdgeLength = Math.hypot(highEdge.x, highEdge.y);
  if (highEdgeLength <= 0.000001) return null;

  const highEdgeAxis = {
    x: highEdge.x / highEdgeLength,
    y: highEdge.y / highEdgeLength
  };
  const highEdgeCenter = {
    x: (finiteNumber(highlandStart?.x) + finiteNumber(highlandEnd?.x)) * 0.5,
    y: (finiteNumber(highlandStart?.y) + finiteNumber(highlandEnd?.y)) * 0.5
  };
  const upperSideLowOuterPoint = {
    x: finiteNumber(upperOuterPoint?.x),
    y: finiteNumber(upperOuterPoint?.y)
  };
  const lowerSideLowOuterPoint = {
    x: finiteNumber(lowerOuterPoint?.x),
    y: finiteNumber(lowerOuterPoint?.y)
  };
  const upperSideLowRoutePoint = {
    x: upperSideLowOuterPoint.x + (frontAxis.x * upperSideEdgeWidth),
    y: upperSideLowOuterPoint.y + (frontAxis.y * upperSideEdgeWidth)
  };
  const lowerSideLowRoutePoint = {
    x: lowerSideLowOuterPoint.x + (frontAxis.x * lowerSideEdgeWidth),
    y: lowerSideLowOuterPoint.y + (frontAxis.y * lowerSideEdgeWidth)
  };
  const lowEdgeCenter = {
    x: highEdgeCenter.x + (frontAxis.x * outerSpanDistance * 0.5 * rampProfile.outwardLengthRatio),
    y: highEdgeCenter.y + (frontAxis.y * outerSpanDistance * 0.5 * rampProfile.outwardLengthRatio)
  };
  const lowEdgeHalfLength = highEdgeLength * 0.5 * rampProfile.lowEdgeWidthScale;
  const upperFrontLowPoint = {
    x: lowEdgeCenter.x - (highEdgeAxis.x * lowEdgeHalfLength),
    y: lowEdgeCenter.y - (highEdgeAxis.y * lowEdgeHalfLength)
  };
  const lowerFrontLowPoint = {
    x: lowEdgeCenter.x + (highEdgeAxis.x * lowEdgeHalfLength),
    y: lowEdgeCenter.y + (highEdgeAxis.y * lowEdgeHalfLength)
  };

  return {
    ramps: [
      {
        id: 'upper-outward-road-ramp',
        vertexIndex: 0,
        points: [
          upperSideLowOuterPoint,
          upperOuterHighPoint,
          upperRouteHighPoint,
          upperSideLowRoutePoint
        ]
      },
      {
        id: 'front-outward-trapezoid-ramp',
        vertexIndex: 1,
        points: [upperFrontLowPoint, highlandStart, highlandEnd, lowerFrontLowPoint]
      },
      {
        id: 'lower-outward-road-ramp',
        vertexIndex: 2,
        points: [
          lowerSideLowOuterPoint,
          lowerOuterHighPoint,
          lowerRouteHighPoint,
          lowerSideLowRoutePoint
        ]
      }
    ],
    topPolygons: [[
      upperOuterHighPoint,
      ...upperRailingPath,
      highlandEnd,
      ...lowerRailingPath.slice(1),
      lowerOuterHighPoint
    ]],
    footprintPoints: [
      upperSideLowOuterPoint,
      upperSideLowRoutePoint,
      ...upperRailingPath,
      upperFrontLowPoint,
      lowerFrontLowPoint,
      ...lowerRailingPath,
      lowerSideLowRoutePoint,
      lowerSideLowOuterPoint
    ],
    railingPaths: [upperRailingPath, lowerRailingPath]
  };
};

const buildHighlandSurface = (
  points = [],
  rampInset = 0.22,
  rampLayout = '',
  outerEdgeCurve = null,
  frontRamp = null,
  edgeRamps = null
) => {
  const safePoints = Array.isArray(points) ? points : [];
  const inset = Math.max(0.08, Math.min(0.36, finiteNumber(rampInset, 0.22)));
  if (rampLayout === 'road-corner-outward-pair-with-front-trapezoid') {
    const frontSurface = buildFrontOutwardTrapezoidHighlandSurface(
      safePoints,
      inset,
      outerEdgeCurve,
      frontRamp,
      edgeRamps
    );
    if (frontSurface) return frontSurface;
  }
  if (rampLayout !== 'road-corner-outward-pair' || safePoints.length !== 3) {
    return {
      ramps: buildHighlandRamps(safePoints, inset),
      topPolygons: [],
      footprintPoints: safePoints,
      railingPaths: []
    };
  }

  const [upperOuterPoint, routePoint, lowerOuterPoint] = safePoints;
  const outerMidpoint = {
    x: (finiteNumber(upperOuterPoint?.x) + finiteNumber(lowerOuterPoint?.x)) * 0.5,
    y: (finiteNumber(upperOuterPoint?.y) + finiteNumber(lowerOuterPoint?.y)) * 0.5
  };
  const routeOffset = {
    x: finiteNumber(routePoint?.x) - outerMidpoint.x,
    y: finiteNumber(routePoint?.y) - outerMidpoint.y
  };
  const routeDistance = Math.hypot(routeOffset.x, routeOffset.y);
  const outerSpan = {
    x: finiteNumber(lowerOuterPoint?.x) - finiteNumber(upperOuterPoint?.x),
    y: finiteNumber(lowerOuterPoint?.y) - finiteNumber(upperOuterPoint?.y)
  };
  const outerSpanDistance = Math.hypot(outerSpan.x, outerSpan.y);
  if (routeDistance <= 0.000001 || outerSpanDistance <= 0.000001) {
    return {
      ramps: buildHighlandRamps(safePoints, inset),
      topPolygons: [],
      footprintPoints: safePoints,
      railingPaths: []
    };
  }

  const candidateRoadAxis = {
    x: -outerSpan.y / outerSpanDistance,
    y: outerSpan.x / outerSpanDistance
  };
  const roadAxisNeedsReversing = (
    (candidateRoadAxis.x * routeOffset.x) + (candidateRoadAxis.y * routeOffset.y)
  ) < 0;
  const roadAxis = {
    x: roadAxisNeedsReversing ? -candidateRoadAxis.x : candidateRoadAxis.x,
    y: roadAxisNeedsReversing ? -candidateRoadAxis.y : candidateRoadAxis.y
  };
  const upperRouteHighPoint = interpolateWorldPoint(upperOuterPoint, routePoint, inset);
  const lowerRouteHighPoint = interpolateWorldPoint(lowerOuterPoint, routePoint, inset);
  const upperOuterHighPoint = intersectWorldLines(
    upperOuterPoint,
    outerSpan,
    upperRouteHighPoint,
    roadAxis
  );
  const lowerOuterHighPoint = intersectWorldLines(
    upperOuterPoint,
    outerSpan,
    lowerRouteHighPoint,
    roadAxis
  );
  const upperHighEdgeLength = Math.max(1, Math.abs(
    ((finiteNumber(upperRouteHighPoint?.x) - finiteNumber(upperOuterHighPoint?.x)) * roadAxis.x)
      + ((finiteNumber(upperRouteHighPoint?.y) - finiteNumber(upperOuterHighPoint?.y)) * roadAxis.y)
  ));
  const lowerHighEdgeLength = Math.max(1, Math.abs(
    ((finiteNumber(lowerRouteHighPoint?.x) - finiteNumber(lowerOuterHighPoint?.x)) * roadAxis.x)
      + ((finiteNumber(lowerRouteHighPoint?.y) - finiteNumber(lowerOuterHighPoint?.y)) * roadAxis.y)
  ));
  const lowEdgeScale = 1 + Math.min(0.25, inset * 0.55);
  const upperLowOuterPoint = {
    x: finiteNumber(upperOuterPoint?.x),
    y: finiteNumber(upperOuterPoint?.y)
  };
  const lowerLowOuterPoint = {
    x: finiteNumber(lowerOuterPoint?.x),
    y: finiteNumber(lowerOuterPoint?.y)
  };
  const upperLowRoutePoint = {
    x: upperLowOuterPoint.x + (roadAxis.x * upperHighEdgeLength * lowEdgeScale),
    y: upperLowOuterPoint.y + (roadAxis.y * upperHighEdgeLength * lowEdgeScale)
  };
  const lowerLowRoutePoint = {
    x: lowerLowOuterPoint.x + (roadAxis.x * lowerHighEdgeLength * lowEdgeScale),
    y: lowerLowOuterPoint.y + (roadAxis.y * lowerHighEdgeLength * lowEdgeScale)
  };

  const curve = normalizeHighlandOuterEdgeCurve(outerEdgeCurve);
  const railingPath = curve
    ? buildHighlandSemicirclePath(
      upperRouteHighPoint,
      lowerRouteHighPoint,
      routePoint,
      curve.segments,
      curve.bulgeScale
    )
    : [];
  const topPolygon = railingPath.length >= 2
    ? [upperOuterHighPoint, ...railingPath, lowerOuterHighPoint]
    : [
      upperOuterHighPoint,
      upperRouteHighPoint,
      routePoint,
      lowerRouteHighPoint,
      lowerOuterHighPoint
    ];
  const footprintPoints = railingPath.length >= 2
    ? [upperOuterPoint, ...railingPath, lowerOuterPoint]
    : safePoints;

  return {
    ramps: [
      {
        id: 'upper-outward-road-ramp',
        vertexIndex: 0,
        points: [
          upperLowOuterPoint,
          upperOuterHighPoint,
          upperRouteHighPoint,
          upperLowRoutePoint
        ]
      },
      {
        id: 'lower-outward-road-ramp',
        vertexIndex: 2,
        points: [
          lowerLowOuterPoint,
          lowerOuterHighPoint,
          lowerRouteHighPoint,
          lowerLowRoutePoint
        ]
      }
    ],
    topPolygons: [topPolygon],
    footprintPoints,
    railingPaths: railingPath.length >= 2 ? [railingPath] : []
  };
};

const normalizedBoundsToWorld = (normalizedBounds = [], layout = resolveLayout()) => {
  const left = finiteNumber(normalizedBounds?.[0]);
  const top = finiteNumber(normalizedBounds?.[1]);
  const right = finiteNumber(normalizedBounds?.[2]);
  const bottom = finiteNumber(normalizedBounds?.[3]);
  const topLeft = normalizedToWorld({ x: left, y: top }, layout);
  const bottomRight = normalizedToWorld({ x: right, y: bottom }, layout);
  return {
    x: (topLeft.x + bottomRight.x) * 0.5,
    y: (topLeft.y + bottomRight.y) * 0.5,
    width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
    height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
  };
};

const buildRoadSegmentPolygon = (start = {}, end = {}, width = 0) => {
  const startX = finiteNumber(start?.x);
  const startY = finiteNumber(start?.y);
  const deltaX = finiteNumber(end?.x) - startX;
  const deltaY = finiteNumber(end?.y) - startY;
  const length = Math.hypot(deltaX, deltaY);
  const halfWidth = Math.max(1, finiteNumber(width) * 0.5);
  if (length <= 0.1 || halfWidth <= 0) return [];
  const normalX = (-deltaY / length) * halfWidth;
  const normalY = (deltaX / length) * halfWidth;
  const endX = finiteNumber(end?.x);
  const endY = finiteNumber(end?.y);
  return [
    { x: startX + normalX, y: startY + normalY },
    { x: endX + normalX, y: endY + normalY },
    { x: endX - normalX, y: endY - normalY },
    { x: startX - normalX, y: startY - normalY }
  ];
};

const sourceBoundsToNormalizedBounds = (sourceBounds = []) => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  const width = Math.max(1, finiteNumber(bounds?.width, 1607));
  const height = Math.max(1, finiteNumber(bounds?.height, 1118));
  const left = finiteNumber(bounds?.left, 43);
  const top = finiteNumber(bounds?.top, 63);
  return [
    (finiteNumber(sourceBounds?.[0]) - left) / width,
    (finiteNumber(sourceBounds?.[1]) - top) / height,
    (finiteNumber(sourceBounds?.[2]) - left) / width,
    (finiteNumber(sourceBounds?.[3]) - top) / height
  ];
};

const sourcePointToWorld = (point = [], layout = resolveLayout()) => {
  const bounds = geometry?.referenceAsset?.effectiveBattlefieldBounds || {};
  const width = Math.max(1, finiteNumber(bounds?.width, 1607));
  const height = Math.max(1, finiteNumber(bounds?.height, 1118));
  return normalizedToWorld({
    x: (finiteNumber(point?.[0]) - finiteNumber(bounds?.left, 43)) / width,
    y: (finiteNumber(point?.[1]) - finiteNumber(bounds?.top, 63)) / height
  }, layout);
};

const resolveWallWorldPath = (wall = {}, layout = resolveLayout()) => {
  if (Array.isArray(wall?.sourcePath) && wall.sourcePath.length >= 2) {
    return wall.sourcePath.map((point) => sourcePointToWorld(point, layout));
  }
  if (Array.isArray(wall?.visualPath) && wall.visualPath.length >= 2) {
    return wall.visualPath.map((point) => tupleToWorld(point, layout));
  }
  return [];
};

const resolveWallWorldOutline = (wall = {}, layout = resolveLayout()) => (
  Array.isArray(wall?.sourceOutline) && wall.sourceOutline.length >= 3
    ? wall.sourceOutline.map((point) => sourcePointToWorld(point, layout))
    : []
);

const resolveWallWorldBezierOutline = (wall = {}, layout = resolveLayout()) => {
  const definition = wall?.bezierOutline;
  if (!definition || !Array.isArray(definition?.start) || !Array.isArray(definition?.segments)) return null;
  const toWorld = (point) => sourcePointToWorld(point, layout);
  const segments = definition.segments
    .filter((segment) => (
      Array.isArray(segment?.controlPoint1)
      && Array.isArray(segment?.controlPoint2)
      && Array.isArray(segment?.end)
    ))
    .map((segment) => ({
      controlPoint1: toWorld(segment.controlPoint1),
      controlPoint2: toWorld(segment.controlPoint2),
      end: toWorld(segment.end)
    }));
  return segments.length > 0
    ? { start: toWorld(definition.start), segments }
    : null;
};

const resolveWallType = (wall = {}, category = 'ordinaryWall') => {
  const requested = String(wall?.wallType || '').trim();
  if (requested === 'thinBarrier' || requested === 'thickWall') return requested;
  if (category === 'highWall' || String(wall?.visualKind || '') === 'crescent') return 'thickWall';
  return 'thinBarrier';
};

const resolveWallHeight = (wall = {}, category = 'ordinaryWall', layout = resolveLayout()) => {
  const wallType = resolveWallType(wall, category);
  const defaultHeight = category === 'highWall' ? 72 : (wallType === 'thickWall' ? 52 : 34);
  return Math.max(8, finiteNumber(wall?.renderHeight, defaultHeight) * resolveRuntimeScale(layout));
};

const resolveWallThicknessWorld = (wall = {}, layout = resolveLayout()) => {
  const widthPx = finiteNumber(wall?.collision?.widthPx);
  if (widthPx > 0) {
    const referenceHeight = Math.max(1, finiteNumber(geometry?.referenceAsset?.effectiveBattlefieldBounds?.height, 1118));
    return Math.max(4, (widthPx / referenceHeight) * layout.fieldHeight);
  }
  const radiusNormalized = finiteNumber(wall?.collision?.radiusNormalized);
  if (radiusNormalized > 0) {
    return Math.max(4, radiusNormalized * Math.min(layout.fieldWidth, layout.fieldHeight) * 2);
  }
  return 24;
};

const buildPolylineCollider = (worldPath = [], center = {}, thickness = 24, height = 32) => {
  const parts = [];
  for (let index = 1; index < worldPath.length; index += 1) {
    const start = worldPath[index - 1] || {};
    const end = worldPath[index] || {};
    const dx = finiteNumber(end?.x) - finiteNumber(start?.x);
    const dy = finiteNumber(end?.y) - finiteNumber(start?.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.1) continue;
    parts.push({
      ax: finiteNumber(start?.x) - finiteNumber(center?.x),
      ay: finiteNumber(start?.y) - finiteNumber(center?.y),
      bx: finiteNumber(end?.x) - finiteNumber(center?.x),
      by: finiteNumber(end?.y) - finiteNumber(center?.y),
      r: Math.max(0.5, finiteNumber(thickness) * 0.5),
      h: Math.max(1, finiteNumber(height, 32)),
    });
  }
  return parts.length > 0 ? { kind: 'compositeCapsule', parts } : null;
};

const resolveRoadsideTowerPosition = (definition = {}, layout = resolveLayout(), basePosition = {}, towerSize = 0) => {
  const laneId = String(definition?.laneId || 'mid');
  const route = (Array.isArray(navigation?.routes) ? navigation.routes : [])
    .find((entry) => String(entry?.id || '') === laneId);
  const side = String(definition?.roadSide || '').trim();
  if (!route || !side) return { ...basePosition, roadSide: '', roadSideOffset: 0 };
  let sideSign = 0;
  if (side === 'upper') sideSign = 1;
  if (side === 'lower') sideSign = -1;
  if (side === 'outer') {
    if (laneId === 'top') sideSign = 1;
    if (laneId === 'bottom') sideSign = -1;
  }
  if (sideSign === 0) return { ...basePosition, roadSide: '', roadSideOffset: 0 };
  const roadWidth = Math.max(
    24,
    finiteNumber(route?.visualWidthNormalized, 0.028) * finiteNumber(layout?.fieldHeight)
  );
  const offsetRatio = Math.max(0.28, Math.min(0.48, finiteNumber(definition?.roadSideOffsetRatio, 0.36)));
  const roadSideOffset = Math.max(
    Math.max(1, finiteNumber(towerSize)) * 0.72,
    roadWidth * offsetRatio
  );
  return {
    x: finiteNumber(basePosition?.x),
    y: finiteNumber(basePosition?.y) + (roadSideOffset * sideSign),
    roadSide: side,
    roadSideOffset
  };
};

const buildTerrainRegions = (layout) => {
  const terrainRegions = (Array.isArray(geometry?.terrainRegions) ? geometry.terrainRegions : [])
    .map((region) => {
      const normalizedBounds = Array.isArray(region?.normalizedBounds) ? region.normalizedBounds : [];
      const worldBounds = normalizedBoundsToWorld(normalizedBounds, layout);
      if (region?.shape === 'semicircle') {
        return {
          id: String(region?.id || 'sand-region'),
          type: String(region?.type || 'sand'),
          shape: 'semicircle',
          ...worldBounds,
          radius: Math.max(1, Math.min(worldBounds.width, worldBounds.height) * 0.5),
          arcDirection: String(region?.id || '').includes('top') ? 'down' : 'up',
          walkable: region?.walkable !== false,
          z: 0.045,
          sourceRegionId: String(region?.id || '')
        };
      }
      return {
        id: String(region?.id || 'terrain-region'),
        type: String(region?.type || 'grass'),
        shape: 'rect',
        ...worldBounds,
        walkable: region?.walkable !== false,
        z: region?.type === 'grass' ? 0 : 0.045,
        sourceRegionId: String(region?.id || '')
      };
    });

  (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).forEach((spawnRegion) => {
    const team = normalizeTeam(spawnRegion?.team);
    const sourceHighlandPoints = (Array.isArray(spawnRegion?.normalizedPolygon) ? spawnRegion.normalizedPolygon : [])
      .map((point) => tupleToWorld(point, layout));
    const highlandControlPoints = scaleHighlandFootprint(
      sourceHighlandPoints,
      team,
      layout,
      finiteNumber(spawnRegion?.renderFootprintScale, 1)
    );
    const rampInset = Math.max(0.08, Math.min(0.36, finiteNumber(spawnRegion?.rampInset, 0.22)));
    const highlandSurface = buildHighlandSurface(
      highlandControlPoints,
      rampInset,
      String(spawnRegion?.rampLayout || ''),
      spawnRegion?.outerEdgeCurve,
      spawnRegion?.frontRamp,
      spawnRegion?.edgeRamps
    );
    const highlandFootprintPoints = highlandSurface.footprintPoints.length >= 3
      ? highlandSurface.footprintPoints
      : highlandControlPoints;
    terrainRegions.push({
      id: `terrain-highland-${spawnRegion?.id || team}`,
      type: `highland-${team}`,
      shape: 'polygon',
      points: highlandFootprintPoints,
      rampControlPoints: highlandControlPoints,
      walkable: spawnRegion?.walkable !== false,
      z: 0.08 * resolveRuntimeScale(layout),
      elevation: Math.max(0, finiteNumber(spawnRegion?.renderElevation, 28)) * resolveRuntimeScale(layout),
      rampInset,
      ramps: highlandSurface.ramps,
      topPolygons: highlandSurface.topPolygons,
      railingPaths: highlandSurface.railingPaths,
      railingEdges: Array.isArray(spawnRegion?.railingEdges)
        ? spawnRegion.railingEdges.map((edge) => Math.floor(finiteNumber(edge))).filter((edge) => edge >= 0)
        : [0, 1],
      connectedRouteIds: Array.isArray(spawnRegion?.routeIds) ? spawnRegion.routeIds.slice() : [],
      sourceRegionId: String(spawnRegion?.id || '')
    });
  });

  (Array.isArray(navigation?.routes) ? navigation.routes : []).forEach((route) => {
    const visualCenterline = Array.isArray(route?.visualCenterline) ? route.visualCenterline : [];
    const firstPoint = visualCenterline[0] || [0.5, 0.5];
    const center = tupleToWorld(firstPoint, layout);
    const routeId = String(route?.id || '');
    const roadWidth = Math.max(8, finiteNumber(route?.visualWidthNormalized, 0.015) * layout.fieldHeight);
    terrainRegions.push({
      id: `terrain-road-${routeId || 'lane'}`,
      type: 'road',
      shape: 'rect',
      x: 0,
      y: center.y,
      width: layout.fieldWidth,
      height: roadWidth,
      walkable: true,
      z: 0.065,
      laneId: routeId,
      roadRole: 'main',
      sourceRouteId: routeId
    });
    (Array.isArray(route?.visualConnectors) ? route.visualConnectors : []).forEach((connector, connectorIndex) => {
      const connectorId = String(connector?.id || `connector-${connectorIndex + 1}`);
      const points = (Array.isArray(connector?.centerline) ? connector.centerline : [])
        .map((point) => tupleToWorld(point, layout));
      for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
        const polygon = buildRoadSegmentPolygon(points[segmentIndex - 1], points[segmentIndex], roadWidth);
        if (polygon.length < 3) continue;
        terrainRegions.push({
          id: `terrain-road-${routeId || 'lane'}-${connectorId}-${segmentIndex}`,
          type: 'road',
          shape: 'polygon',
          points: polygon,
          walkable: true,
          z: 0.065,
          laneId: routeId,
          roadRole: 'connector',
          sourceRouteId: routeId,
          sourceConnectorId: connectorId
        });
      }
    });
  });

  return terrainRegions;
};

const buildLanes = (layout) => (
  (Array.isArray(navigation?.routes) ? navigation.routes : []).map((route) => {
    const visualCenterline = Array.isArray(route?.visualCenterline) ? route.visualCenterline : [];
    const navigationCenterline = Array.isArray(route?.navigationCenterline) ? route.navigationCenterline : [];
    const center = tupleToWorld(visualCenterline[0] || [0.5, 0.5], layout);
    return {
      id: String(route?.id || 'lane'),
      label: String(route?.label || route?.id || '道路'),
      centerY: center.y,
      width: Math.max(24, finiteNumber(route?.navigationWidthNormalized, 0.08) * layout.fieldHeight),
      visualCenterline: visualCenterline.map((point) => tupleToWorld(point, layout)),
      visualConnectors: (Array.isArray(route?.visualConnectors) ? route.visualConnectors : []).map((connector, index) => ({
        id: String(connector?.id || `connector-${index + 1}`),
        centerline: (Array.isArray(connector?.centerline) ? connector.centerline : [])
          .map((point) => tupleToWorld(point, layout))
      })),
      centerline: navigationCenterline.map((point) => tupleToWorld(point, layout)),
      attackerDirection: String(route?.attackerDirection || 'left-to-right'),
      defenderDirection: String(route?.defenderDirection || 'right-to-left'),
      connectedTerrainIds: Array.isArray(route?.connectedTerrainIds) ? route.connectedTerrainIds.slice() : []
    };
  })
);

const buildDeploySlots = (layout) => {
  const slots = [];
  (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).forEach((region) => {
    const team = normalizeTeam(region?.team);
    const points = Array.isArray(region?.normalizedPolygon) ? region.normalizedPolygon : [];
    if (points.length !== 3) return;
    const boundaryTop = points[0];
    const tip = points[1];
    const boundaryBottom = points[2];
    const normalizedSlots = [
      [
        (boundaryTop[0] * 0.72) + (tip[0] * 0.28),
        (boundaryTop[1] * 0.72) + (tip[1] * 0.28)
      ],
      [
        (boundaryTop[0] * 0.5) + (tip[0] * 0.35) + (boundaryBottom[0] * 0.15),
        (boundaryTop[1] * 0.5) + (tip[1] * 0.35) + (boundaryBottom[1] * 0.15)
      ],
      [
        (boundaryBottom[0] * 0.72) + (tip[0] * 0.28),
        (boundaryBottom[1] * 0.72) + (tip[1] * 0.28)
      ]
    ];
    normalizedSlots.forEach((point, index) => {
      const worldPoint = tupleToWorld(point, layout);
      slots.push({
        id: `deploy-${region?.id || `${team}-${index + 1}`}-${index + 1}`,
        team,
        laneId: String(region?.laneAffinity || 'jungle'),
        label: `${team === 'defender' ? '防守方' : '进攻方'}${region?.laneAffinity === 'bottom' ? '下' : '上'}高地 ${index + 1}`,
        x: worldPoint.x,
        y: worldPoint.y,
        spawnRegionId: String(region?.id || '')
      });
    });
  });
  return slots;
};

const buildWallObjects = (layout) => {
  const highWalls = Array.isArray(geometry?.walls?.high) ? geometry.walls.high : [];
  const ordinaryWalls = Array.isArray(geometry?.walls?.ordinary) ? geometry.walls.ordinary : [];
  const toObject = (wall, itemId, category, maxHp, index) => {
    const normalizedBounds = sourceBoundsToNormalizedBounds(wall?.sourceBounds);
    const worldBounds = normalizedBoundsToWorld(normalizedBounds, layout);
    const wallPath = resolveWallWorldPath(wall, layout);
    const wallOutline = resolveWallWorldOutline(wall, layout);
    const wallBezierOutline = resolveWallWorldBezierOutline(wall, layout);
    const wallType = resolveWallType(wall, category);
    const thickness = resolveWallThicknessWorld(wall, layout);
    const height = resolveWallHeight(wall, category, layout);
    const collider = buildPolylineCollider(wallPath, worldBounds, thickness, height);
    return {
      objectId: `map-${wall?.id || `${category}-${index + 1}`}`,
      itemId,
      x: worldBounds.x,
      y: worldBounds.y,
      z: 0,
      width: worldBounds.width,
      depth: worldBounds.height,
      height,
      category: 'wall',
      team: 'neutral',
      mapStatic: true,
      presetTags: ['wall'],
      maxHp,
      hp: maxHp,
      blocksMovement: true,
      blocksVision: category === 'highWall' || wallType === 'thickWall' || wall?.collision?.blocksVision === true,
      geometryRefId: String(wall?.id || ''),
      geometryKind: category,
      wallType,
      visualKind: String(wall?.visualKind || ''),
      collisionDefinition: cloneValue(wall?.collision || {}),
      visualPath: wallPath,
      visualOutline: wallOutline,
      bezierOutline: wallBezierOutline,
      collisionPath: wallPath,
      collider
    };
  };
  return [
    ...highWalls.map((wall, index) => toObject(wall, 'training_map_high_wall', 'highWall', 2600, index)),
    ...ordinaryWalls.map((wall, index) => toObject(
      wall,
      resolveWallType(wall, 'ordinaryWall') === 'thickWall' ? 'training_map_thick_wall' : 'training_map_low_wall',
      'ordinaryWall',
      resolveWallType(wall, 'ordinaryWall') === 'thickWall' ? 2200 : 1450,
      index
    ))
  ];
};

const buildHighlandRailingObjects = (layout) => {
  const runtimeScale = resolveRuntimeScale(layout);
  return (Array.isArray(geometry?.spawnRegions) ? geometry.spawnRegions : []).flatMap((spawnRegion) => {
    const sourcePoints = (Array.isArray(spawnRegion?.normalizedPolygon) ? spawnRegion.normalizedPolygon : [])
      .map((point) => tupleToWorld(point, layout));
    const points = scaleHighlandFootprint(
      sourcePoints,
      normalizeTeam(spawnRegion?.team),
      layout,
      finiteNumber(spawnRegion?.renderFootprintScale, 1)
    );
    if (points.length < 3) return [];
    const inset = Math.max(0.08, Math.min(0.36, finiteNumber(spawnRegion?.rampInset, 0.22)));
    const highlandSurface = buildHighlandSurface(
      points,
      inset,
      String(spawnRegion?.rampLayout || ''),
      spawnRegion?.outerEdgeCurve,
      spawnRegion?.frontRamp,
      spawnRegion?.edgeRamps
    );
    const elevation = Math.max(0, finiteNumber(spawnRegion?.renderElevation, 28)) * runtimeScale;
    const railHeight = elevation + Math.max(6, elevation * 0.3);
    const railThickness = Math.max(6, 7 * runtimeScale);
    const railingEdges = Array.isArray(spawnRegion?.railingEdges)
      ? spawnRegion.railingEdges
      : [0, 1];
    const curvedRailingPaths = (Array.isArray(highlandSurface.railingPaths) ? highlandSurface.railingPaths : [])
      .filter((path) => Array.isArray(path) && path.length >= 2);
    const railDefinitions = curvedRailingPaths.length > 0
      ? curvedRailingPaths.map((path, index) => ({
        edgeIndex: index,
        path
      }))
      : railingEdges.map((rawEdge) => {
        const edgeIndex = Math.max(0, Math.floor(finiteNumber(rawEdge))) % points.length;
        const from = points[edgeIndex];
        const to = points[(edgeIndex + 1) % points.length];
        return {
          edgeIndex,
          path: [
            interpolateWorldPoint(from, to, inset),
            interpolateWorldPoint(from, to, 1 - inset)
          ]
        };
      });
    return railDefinitions.map(({ edgeIndex, path }) => {
      const center = path.reduce((sum, point) => ({
        x: sum.x + finiteNumber(point?.x),
        y: sum.y + finiteNumber(point?.y)
      }), { x: 0, y: 0 });
      center.x /= path.length;
      center.y /= path.length;
      const length = path.slice(1).reduce((total, point, index) => {
        const previous = path[index] || {};
        return total + Math.hypot(
          finiteNumber(point?.x) - finiteNumber(previous?.x),
          finiteNumber(point?.y) - finiteNumber(previous?.y)
        );
      }, 0);
      const railLength = Math.max(1, length);
      return {
        objectId: `map-highland-rail-${spawnRegion?.id || 'region'}-${edgeIndex + 1}`,
        itemId: 'training_map_low_wall',
        x: center.x,
        y: center.y,
        z: 0,
        width: railLength,
        depth: railThickness,
        height: railHeight,
        category: 'wall',
        team: 'neutral',
        mapStatic: true,
        presetTags: [],
        maxHp: 999999,
        hp: 999999,
        blocksMovement: true,
        blocksVision: false,
        geometryRefId: `highland-rail-${spawnRegion?.id || 'region'}-${edgeIndex + 1}`,
        geometryKind: 'highlandRail',
        wallType: 'thinBarrier',
        highlandRegionId: `terrain-highland-${spawnRegion?.id || ''}`,
        visualPath: path,
        collisionPath: path,
        collider: buildPolylineCollider(path, center, railThickness, railHeight)
      };
    });
  });
};

const buildTowerObjectsAndObjectives = (layout) => (
  (Array.isArray(objectiveData?.objectives) ? objectiveData.objectives : []).map((definition, index) => {
    const objectiveId = `objective_tower_${String(definition?.objectiveId || `tower-${index + 1}`)}`;
    const team = normalizeTeam(definition?.team);
    const towerRuntime = resolveTowerRuntimeConfig();
    const maxHp = towerRuntime.maxHp;
    const staticScale = resolveRuntimeScale(layout);
    const towerSize = NORMAL_TOWER_BASE_SIZE * NORMAL_TOWER_FOOTPRINT_SCALE * staticScale;
    const towerHeight = NORMAL_TOWER_BASE_HEIGHT * staticScale;
    const sourcePosition = tupleToWorld(definition?.position, layout);
    const position = resolveRoadsideTowerPosition(definition, layout, sourcePosition, towerSize);
    return {
      object: {
        objectId: `map-${objectiveId}`,
        itemId: 'training_map_tower',
        x: position.x,
        y: position.y,
        z: 0,
        width: towerSize,
        depth: towerSize,
        height: towerHeight,
        category: 'tower',
        team,
        mapStatic: true,
        presetTags: ['tower'],
        objectiveId,
        objectiveType: 'tower',
        maxHp,
        hp: maxHp,
        attackRange: towerRuntime.attackRange,
        rangeIndicatorMode: 'proximity',
        blocksMovement: true,
        blocksVision: true,
        sourceCenter: Array.isArray(definition?.sourceCenter) ? definition.sourceCenter.slice() : [],
        roadSide: position.roadSide,
        roadSideOffset: position.roadSideOffset,
        roadCenterX: sourcePosition.x,
        roadCenterY: sourcePosition.y,
        collider: {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: towerSize * 0.5,
          h: towerHeight
        }
      },
      objective: {
        objectiveId,
        sourceObjectId: `map-${objectiveId}`,
        type: 'tower',
        team,
        laneId: String(definition?.laneId || 'mid'),
        routeOrder: Math.max(1, Math.floor(finiteNumber(definition?.routeOrder, 1))),
        maxHp,
        attackRange: towerRuntime.attackRange,
        attackIntervalSec: towerRuntime.attackIntervalSec,
        attackDamage: towerRuntime.attackDamage,
        priority: towerRuntime.priority,
        threatDecayPerSecond: towerRuntime.threatDecayPerSecond,
        presetTags: ['tower']
      }
    };
  }));

const normalizeHighlandDefenseWeapon = (weapon = {}, index = 0) => ({
  id: String(weapon?.id || `weapon-${index + 1}`),
  label: String(weapon?.label || `兵营武器 ${index + 1}`),
  delivery: weapon?.delivery === 'projectile' ? 'projectile' : 'instant',
  projectileType: weapon?.projectileType === 'shell' ? 'shell' : 'arrow',
  attackRange: Math.max(0, finiteNumber(weapon?.attackRange)),
  attackIntervalSec: Math.max(0.1, finiteNumber(weapon?.attackIntervalSec, 1)),
  attackDamage: Math.max(0, finiteNumber(weapon?.attackDamage)),
  priority: String(weapon?.priority || 'nearest'),
  projectileSpeed: Math.max(0, finiteNumber(weapon?.projectileSpeed)),
  splashRadius: Math.max(0, finiteNumber(weapon?.splashRadius)),
  splashFalloff: Math.max(0, Math.min(1, finiteNumber(weapon?.splashFalloff))),
  wallDamageMul: Math.max(0.1, finiteNumber(weapon?.wallDamageMul, 1))
});

const buildHighlandDefenseObjectsAndObjectives = (layout) => {
  const runtimeScale = resolveRuntimeScale(layout);
  const barracksRuntime = highlandDefenseData?.barracksRuntime && typeof highlandDefenseData.barracksRuntime === 'object'
    ? highlandDefenseData.barracksRuntime
    : {};
  const outerTowerRuntime = highlandDefenseData?.outerTowerRuntime && typeof highlandDefenseData.outerTowerRuntime === 'object'
    ? highlandDefenseData.outerTowerRuntime
    : {};
  const respawnRuntime = highlandDefenseData?.respawnRuntime && typeof highlandDefenseData.respawnRuntime === 'object'
    ? highlandDefenseData.respawnRuntime
    : {};
  const barracksWeapons = (Array.isArray(barracksRuntime?.weapons) ? barracksRuntime.weapons : [])
    .map(normalizeHighlandDefenseWeapon)
    .filter((weapon) => weapon.attackRange > 0 && weapon.attackDamage > 0);
  const barracksAttackRange = barracksWeapons.reduce((maxRange, weapon) => (
    Math.max(maxRange, weapon.attackRange)
  ), 0);
  const outerAttackRange = Math.max(0, finiteNumber(outerTowerRuntime?.attackRange, 455));
  const outerAttackIntervalSec = Math.max(0.1, finiteNumber(outerTowerRuntime?.attackIntervalSec, 0.8));
  const outerAttackDamage = Math.max(0, finiteNumber(outerTowerRuntime?.attackDamage, 23));
  const respawnRadius = Math.max(
    24,
    finiteNumber(respawnRuntime?.radiusNormalized, 0.017) * Math.min(layout.fieldWidth, layout.fieldHeight)
  );
  const objects = [];
  const objectives = [];
  const respawnPoints = [];

  (Array.isArray(highlandDefenseData?.highlands) ? highlandDefenseData.highlands : []).forEach((definition, index) => {
    const highlandId = String(definition?.id || `highland-${index + 1}`);
    const mirrorHighlandId = String(definition?.mirrorOf || '');
    const team = normalizeTeam(definition?.team);
    const facingDeg = finiteNumber(definition?.facingDeg, team === 'defender' ? 180 : 0);
    const facingRad = facingDeg * (Math.PI / 180);
    const barracksPosition = tupleToWorld(definition?.barracks?.position, layout);
    const barracksObjectiveId = `objective_highland_barracks_${highlandId}`;
    const barracksObjectId = `map-highland-barracks-${highlandId}`;
    const barracksMaxHp = Math.max(1, finiteNumber(barracksRuntime?.maxHp, 5600));
    const barracksWidth = Math.max(16, finiteNumber(barracksRuntime?.width, 84) * runtimeScale);
    const barracksDepth = Math.max(16, finiteNumber(barracksRuntime?.depth, 52) * runtimeScale);
    const barracksHeight = Math.max(18, finiteNumber(barracksRuntime?.height, 18) * runtimeScale);
    objects.push({
      objectId: barracksObjectId,
      itemId: 'training_map_barracks',
      x: barracksPosition.x,
      y: barracksPosition.y,
      z: 0,
      rotation: facingDeg,
      width: barracksWidth,
      depth: barracksDepth,
      height: barracksHeight,
      category: 'barracks',
      team,
      mapStatic: true,
      presetTags: ['highlandDefense'],
      mirrorOf: mirrorHighlandId ? `map-highland-barracks-${mirrorHighlandId}` : '',
      highlandId,
      defenseRole: 'barracks',
      objectiveId: barracksObjectiveId,
      objectiveType: 'barracks',
      maxHp: barracksMaxHp,
      hp: barracksMaxHp,
      attackRange: barracksAttackRange,
      rangeIndicatorColor: String(barracksRuntime?.rangeIndicatorColor || '#ef4b55'),
      rangeIndicatorMode: String(barracksRuntime?.rangeIndicatorMode || 'always'),
      blocksMovement: true,
      blocksVision: true
    });
    objectives.push({
      objectiveId: barracksObjectiveId,
      sourceObjectId: barracksObjectId,
      type: 'barracks',
      team,
      laneId: String(definition?.spawnRegionId || 'highland'),
      maxHp: barracksMaxHp,
      attackRange: barracksAttackRange,
      attackEnabled: barracksWeapons.length > 0,
      priority: 'highestThreat',
      threatDecayPerSecond: 0.18,
      weaponProfiles: cloneValue(barracksWeapons),
      presetTags: ['highlandDefense']
    });

    const respawnPosition = tupleToWorld(definition?.respawn?.position, layout);
    respawnPoints.push({
      id: `respawn-${highlandId}`,
      highlandId,
      team,
      spawnRegionId: String(definition?.spawnRegionId || ''),
      label: String(respawnRuntime?.label || '高地重生点'),
      x: respawnPosition.x,
      y: respawnPosition.y,
      radius: respawnRadius,
      facingRad,
      presetTags: ['highlandDefense']
    });

    (Array.isArray(definition?.outerTowers) ? definition.outerTowers : []).forEach((tower, towerIndex) => {
      const towerId = String(tower?.id || `tower-${towerIndex + 1}`);
      const position = tupleToWorld(tower?.position, layout);
      const towerAttackRange = Math.max(0, finiteNumber(tower?.attackRange, outerAttackRange));
      const objectiveId = `objective_highland_outpost_${highlandId}_${towerId}`;
      const objectId = `map-highland-outpost-${highlandId}-${towerId}`;
      const maxHp = Math.max(1, finiteNumber(outerTowerRuntime?.maxHp, 2000));
      const towerSize = Math.max(12, finiteNumber(outerTowerRuntime?.width, 48) * runtimeScale);
      const towerHeight = Math.max(16, finiteNumber(outerTowerRuntime?.height, 82) * runtimeScale);
      objects.push({
        objectId,
        itemId: 'training_map_highland_outpost_tower',
        x: position.x,
        y: position.y,
        z: 0,
        rotation: facingDeg,
        width: towerSize,
        depth: towerSize,
        height: towerHeight,
        category: 'tower',
        team,
        mapStatic: true,
        presetTags: ['highlandDefense'],
        mirrorOf: mirrorHighlandId ? `map-highland-outpost-${mirrorHighlandId}-${towerId}` : '',
        highlandId,
        defenseRole: 'highlandOutpost',
        objectiveId,
        objectiveType: 'tower',
        maxHp,
        hp: maxHp,
        attackRange: towerAttackRange,
        rangeIndicatorColor: String(outerTowerRuntime?.rangeIndicatorColor || '#53dff0'),
        rangeIndicatorMode: String(outerTowerRuntime?.rangeIndicatorMode || 'always'),
        blocksMovement: true,
        blocksVision: true,
        collider: {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: towerSize * 0.5,
          h: towerHeight
        }
      });
      objectives.push({
        objectiveId,
        sourceObjectId: objectId,
        type: 'tower',
        team,
        laneId: String(definition?.spawnRegionId || 'highland'),
        maxHp,
        attackRange: towerAttackRange,
        attackIntervalSec: outerAttackIntervalSec,
        attackDamage: outerAttackDamage,
        priority: String(outerTowerRuntime?.priority || 'nearest'),
        threatDecayPerSecond: Math.max(0, finiteNumber(outerTowerRuntime?.threatDecayPerSecond, 0.24)),
        defenseRole: 'highlandOutpost',
        presetTags: ['highlandDefense']
      });
    });
  });

  return { objects, objectives, respawnPoints };
};

const resolveCampLaneId = (position = []) => {
  const y = finiteNumber(position?.[1], 0.5);
  if (y <= 0.34) return 'top';
  if (y >= 0.66) return 'bottom';
  return 'jungle';
};

const resolveNeutralCampProfileId = (definition = {}) => {
  const requested = String(definition?.profile || '').trim();
  if (requested) return requested;
  if (String(definition?.group || '') === 'center') return 'center';
  return String(definition?.campId || '').includes('sand') ? 'sand' : 'standard';
};

const resolveNeutralCampRuntime = (definition = {}, layout = resolveLayout(), anchor = {}) => {
  const defaults = neutralCampData?.runtimeDefaults && typeof neutralCampData.runtimeDefaults === 'object'
    ? neutralCampData.runtimeDefaults
    : {};
  const profiles = neutralCampData?.profiles && typeof neutralCampData.profiles === 'object'
    ? neutralCampData.profiles
    : {};
  const profileId = resolveNeutralCampProfileId(definition);
  const profile = profiles?.[profileId] && typeof profiles[profileId] === 'object'
    ? profiles[profileId]
    : (profiles?.standard || {});
  const referenceSize = Math.min(layout.fieldWidth, layout.fieldHeight);
  const radiusFromNormalized = (value, fallback) => Math.max(4, finiteNumber(value, fallback) * referenceSize);
  const spawnRadius = radiusFromNormalized(definition?.spawnRadiusNormalized, 0.028);
  const patrolRadius = radiusFromNormalized(
    definition?.patrolRadiusNormalized,
    finiteNumber(defaults?.patrolRadiusNormalized, 0.018)
  );
  const formationRotationDeg = finiteNumber(definition?.formationRotationDeg);
  const formationFacingRad = formationRotationDeg * (Math.PI / 180);
  const patrolEnabled = definition?.patrolEnabled === true
    || (definition?.patrolEnabled !== false && String(definition?.group || '') === 'center');
  const patrolMode = patrolEnabled && definition?.patrolMode === 'shuttle' ? 'shuttle' : 'loop';
  const patrolDirectionDeg = finiteNumber(definition?.patrolDirectionDeg, formationRotationDeg);
  const patrolDirectionRad = patrolDirectionDeg * (Math.PI / 180);
  const patrolSpan = radiusFromNormalized(
    definition?.patrolSpanNormalized,
    Math.max(0.004, finiteNumber(definition?.patrolRadiusNormalized, finiteNumber(defaults?.patrolRadiusNormalized, 0.018)) * 2)
  );
  const createRingPoints = (radius, startAngle = 0) => [0, 1, 2].map((index) => {
    const angle = startAngle + ((Math.PI * 2 * index) / 3);
    return {
      x: finiteNumber(anchor?.x) + (Math.cos(angle) * radius),
      y: finiteNumber(anchor?.y) + (Math.sin(angle) * radius)
    };
  });
  const createShuttlePoints = (span, directionRad) => {
    const halfSpan = Math.max(4, span * 0.5);
    const offsetX = Math.cos(directionRad) * halfSpan;
    const offsetY = Math.sin(directionRad) * halfSpan;
    return [
      {
        x: finiteNumber(anchor?.x) + offsetX,
        y: finiteNumber(anchor?.y) + offsetY
      },
      {
        x: finiteNumber(anchor?.x) - offsetX,
        y: finiteNumber(anchor?.y) - offsetY
      }
    ];
  };
  const patrolPoints = !patrolEnabled
    ? []
    : (patrolMode === 'shuttle'
      ? createShuttlePoints(patrolSpan, patrolDirectionRad)
      : createRingPoints(Math.min(spawnRadius * 0.68, patrolRadius), formationFacingRad - (Math.PI / 6)));
  return {
    campId: String(definition?.campId || ''),
    group: String(definition?.group || ''),
    profileId,
    strengthTier: String(definition?.strengthTier || 'remote'),
    label: String(profile?.label || '中立守卫'),
    anchor: { x: finiteNumber(anchor?.x), y: finiteNumber(anchor?.y) },
    formationFacingRad,
    spawnPoints: createRingPoints(spawnRadius * 0.34, formationFacingRad + (Math.PI / 6)),
    patrolEnabled,
    patrolMode,
    patrolDirectionRad,
    patrolSpan,
    patrolPoints,
    patrolStartImmediately: patrolEnabled && definition?.patrolStartImmediately === true,
    initialSpawnAtSec: Math.max(0, finiteNumber(defaults?.initialSpawnAtSec)),
    respawnSec: Math.max(0, finiteNumber(defaults?.respawnSec, 30)),
    senseRadius: radiusFromNormalized(definition?.senseRadiusNormalized, finiteNumber(defaults?.senseRadiusNormalized, 0.052)),
    leashRadius: radiusFromNormalized(definition?.leashRadiusNormalized, finiteNumber(defaults?.leashRadiusNormalized, 0.096)),
    returnRadius: radiusFromNormalized(definition?.returnRadiusNormalized, finiteNumber(defaults?.returnRadiusNormalized, 0.012)),
    patrolIntervalSec: Math.max(0.5, finiteNumber(definition?.patrolIntervalSec, finiteNumber(defaults?.patrolIntervalSec, 4))),
    showPatrolPreview: patrolEnabled && definition?.showPatrolPreview === true,
    patrolPreviewLength: Math.max(8, patrolSpan * 0.5),
    enabled: definition?.enabled !== false,
    composition: cloneValue(Array.isArray(profile?.composition) ? profile.composition : [])
  };
};

const buildCampObjectsAndObjectives = (layout) => (
  (Array.isArray(neutralCampData?.camps) ? neutralCampData.camps : []).map((definition, index) => {
    const position = tupleToWorld(definition?.position, layout);
    const campId = String(definition?.campId || `camp-${index + 1}`);
    const objectiveId = `objective_neutral_${campId}`;
    const maxHp = 1200;
    const staticScale = resolveRuntimeScale(layout);
    const neutralCamp = resolveNeutralCampRuntime(definition, layout, position);
    return {
      object: {
        objectId: `map-${campId}`,
        itemId: 'training_map_neutral_camp',
        x: position.x,
        y: position.y,
        z: 0,
        width: 62 * staticScale,
        depth: 62 * staticScale,
        height: 42 * staticScale,
        category: 'neutralCamp',
        team: 'neutral',
        mapStatic: true,
        presetTags: ['neutral'],
        neutralCampId: campId,
        neutralProfileId: neutralCamp.profileId,
        neutralStrengthTier: neutralCamp.strengthTier,
        neutralFormationFacingRad: neutralCamp.formationFacingRad,
        neutralComposition: cloneValue(neutralCamp.composition),
        neutralPatrolMode: neutralCamp.patrolMode,
        neutralPatrolEnabled: neutralCamp.patrolEnabled,
        neutralPatrolDirectionRad: neutralCamp.patrolDirectionRad,
        neutralPatrolPreview: neutralCamp.showPatrolPreview,
        neutralPatrolPreviewLength: neutralCamp.patrolPreviewLength,
        objectiveId,
        objectiveType: 'neutralCamp',
        maxHp,
        hp: maxHp,
        blocksMovement: false,
        blocksVision: false,
        sourceCenter: Array.isArray(definition?.sourceCenter) ? definition.sourceCenter.slice() : []
      },
      objective: {
        objectiveId,
        sourceObjectId: `map-${campId}`,
        type: 'neutralCamp',
        team: 'neutral',
        laneId: resolveCampLaneId(definition?.position),
        maxHp,
        attackEnabled: false,
        targetable: false,
        attackRange: 0,
        attackIntervalSec: 1,
        attackDamage: 0,
        rewardLabel: neutralCamp.label,
        neutralCamp,
        presetTags: ['neutral']
      }
    };
  }));

const buildMovementCalibration = (deploySlots, towerEntries) => {
  const definition = geometry?.movementCalibration && typeof geometry.movementCalibration === 'object'
    ? geometry.movementCalibration
    : {};
  const spawnSlotId = String(definition?.referenceSpawnSlotId || 'deploy-spawn-attacker-top-1');
  const spawnSlotIds = Array.from(new Set(
    (Array.isArray(definition?.referenceSpawnSlotIds) ? definition.referenceSpawnSlotIds : [spawnSlotId])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  const objectiveId = `objective_tower_${String(definition?.referenceObjectiveId || 'tower-attacker-mid-outer')}`;
  const tower = (Array.isArray(towerEntries) ? towerEntries : []).find((entry) => entry?.objective?.objectiveId === objectiveId);
  const calibrationTarget = tower
    ? {
      x: Number.isFinite(Number(tower.object?.roadCenterX)) ? Number(tower.object.roadCenterX) : finiteNumber(tower.object?.x),
      y: Number.isFinite(Number(tower.object?.roadCenterY)) ? Number(tower.object.roadCenterY) : finiteNumber(tower.object?.y)
    }
    : null;
  const distances = spawnSlotIds.map((slotId) => {
    const spawn = (Array.isArray(deploySlots) ? deploySlots : []).find((slot) => slot?.id === slotId);
    return spawn && calibrationTarget
      ? Math.hypot(
        finiteNumber(spawn.x) - calibrationTarget.x,
        finiteNumber(spawn.y) - calibrationTarget.y
      )
      : 0;
  }).filter((value) => value > 0);
  const distance = distances.length > 0
    ? distances.reduce((sum, value) => sum + value, 0) / distances.length
    : 0;
  const nominalUnitSpeed = Math.max(0.2, finiteNumber(definition?.nominalUnitSpeed, 5));
  const leaderSpeedMultiplier = Math.max(1, finiteNumber(definition?.leaderSpeedMultiplier, 18));
  const nominalWorldSpeed = nominalUnitSpeed * leaderSpeedMultiplier;
  return {
    revision: Math.max(1, Math.floor(finiteNumber(definition?.revision, 1))),
    targetTravelSeconds: Math.max(0.1, finiteNumber(definition?.targetTravelSeconds, 8)),
    nominalUnitSpeed,
    leaderSpeedMultiplier,
    nominalWorldSpeed,
    referenceSpawnSlotId: spawnSlotId,
    referenceSpawnSlotIds: spawnSlotIds,
    referenceObjectiveId: String(definition?.referenceObjectiveId || 'tower-attacker-mid-outer'),
    referenceDistanceWorld: distance,
    referenceDistanceRangeWorld: {
      min: distances.length > 0 ? Math.min(...distances) : 0,
      max: distances.length > 0 ? Math.max(...distances) : 0
    },
    expectedTravelSeconds: distance > 0 ? distance / nominalWorldSpeed : 0,
    expectedTravelSecondsRange: {
      min: distances.length > 0 ? Math.min(...distances) / nominalWorldSpeed : 0,
      max: distances.length > 0 ? Math.max(...distances) / nominalWorldSpeed : 0
    },
    scaleMultiplier: Math.max(0.1, finiteNumber(geometry?.coordinateSystems?.runtimeWorld?.scaleMultiplier, 1)),
    notes: String(definition?.notes || '')
  };
};

const buildReferenceTrainingMapConfig = ({ itemCatalog = [] } = {}) => {
  const layout = resolveLayout();
  const towerEntries = buildTowerObjectsAndObjectives(layout);
  const campEntries = buildCampObjectsAndObjectives(layout);
  const highlandDefense = buildHighlandDefenseObjectsAndObjectives(layout);
  const deploySlots = buildDeploySlots(layout);
  const movementCalibration = buildMovementCalibration(deploySlots, towerEntries);
  const wallObjects = buildWallObjects(layout);
  const highlandRailingObjects = buildHighlandRailingObjects(layout);
  const objects = [
    ...wallObjects,
    ...highlandRailingObjects,
    ...towerEntries.map((entry) => entry.object),
    ...highlandDefense.objects,
    ...campEntries.map((entry) => entry.object)
  ];
  const objectives = [
    ...towerEntries.map((entry) => entry.objective),
    ...highlandDefense.objectives,
    ...campEntries.map((entry) => entry.objective)
  ];

  return {
    mapId: String(geometry?.mapId || 'training-war-map-v1'),
    mapVersion: Math.max(1, Math.floor(finiteNumber(geometry?.mapVersion, 1))),
    layoutMeta: {
      fieldWidth: layout.fieldWidth,
      fieldHeight: layout.fieldHeight,
      coordinateOrigin: 'center',
      coordinateSystem: 'x-right-y-up-z-up',
      scaleMultiplier: movementCalibration.scaleMultiplier,
      movementCalibration: cloneValue(movementCalibration),
      referenceAsset: cloneValue(geometry?.referenceAsset || {}),
      maxItemsPerType: 999999
    },
    teamPresentation: {
      attacker: { label: '进攻方高地', color: '#ef2020', direction: 'right' },
      defender: { label: '防守方高地', color: '#16dfe8', direction: 'left' }
    },
    terrainRegions: buildTerrainRegions(layout),
    spawnRegions: cloneValue(geometry?.spawnRegions || []),
    respawnPoints: cloneValue(highlandDefense.respawnPoints),
    lanes: buildLanes(layout),
    deploySlots,
    movementCalibration: cloneValue(movementCalibration),
    navigation: {
      cellSize: 128,
      roadCost: 1,
      grassCost: finiteNumber(navigation?.terrainCosts?.grass, 1),
      sandCost: finiteNumber(navigation?.terrainCosts?.sand, 1),
      highlandCost: finiteNumber(navigation?.terrainCosts?.highland, 1),
      outsideBattlefieldWalkable: navigation?.navigationRules?.outsideBattlefieldWalkable === true,
      wallClearance: Math.max(2, finiteNumber(navigation?.navigationRules?.wallClearanceNormalized, 0.012) * layout.fieldWidth),
      pathClearance: Math.max(0.5, Math.min(12, finiteNumber(navigation?.navigationRules?.pathClearance, 1.2))),
      agentRadius: Math.max(1, Math.min(8, finiteNumber(navigation?.navigationRules?.agentRadius, 2.25))),
      aiNavigationSearchNodes: Math.max(32, Math.min(512, Math.floor(finiteNumber(navigation?.navigationRules?.aiNavigationSearchNodes, 128)))),
      formationRecoveryPlansPerStep: Math.max(1, Math.min(12, Math.floor(finiteNumber(navigation?.navigationRules?.formationRecoveryPlansPerStep, 4)))),
      minionRecoveryPlansPerStep: 3,
      narrowPassage: {
        cellSize: Math.max(4, Math.min(32, finiteNumber(navigation?.navigationRules?.narrowPassage?.cellSize, 8))),
        probeDistance: Math.max(12, Math.min(120, finiteNumber(navigation?.navigationRules?.narrowPassage?.probeDistance, 48))),
        probeStep: Math.max(1, Math.min(8, finiteNumber(navigation?.navigationRules?.narrowPassage?.probeStep, 2))),
        entryDistance: Math.max(4, Math.min(96, finiteNumber(navigation?.navigationRules?.narrowPassage?.entryDistance, 38))),
        releaseSeconds: Math.max(0.2, Math.min(4, finiteNumber(navigation?.navigationRules?.narrowPassage?.releaseSeconds, 0.65)))
      },
      maxSearchNodes: 1800,
      pathFailureReplanCooldownSeconds: Math.max(0.1, finiteNumber(navigation?.navigationRules?.pathFailureReplanCooldownSeconds, 0.35)),
      aiTargetUnreachableFailureLimit: Math.max(1, Math.min(8, Math.floor(finiteNumber(navigation?.navigationRules?.aiTargetUnreachableFailureLimit, 3)))),
      aiTargetUnreachableCooldownSeconds: Math.max(0.1, finiteNumber(navigation?.navigationRules?.aiTargetUnreachableCooldownSeconds, 2)),
      aiTargetScoring: {
        distanceWeight: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.distanceWeight, 30)),
        sameLaneBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.sameLaneBonus, 18)),
        offLanePenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.offLanePenalty, 7)),
        threatWeight: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.threatWeight, 14)),
        lowHealthBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.lowHealthBonus, 12)),
        inAttackRangeBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.inAttackRangeBonus, 22)),
        attackingAllyBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.attackingAllyBonus, 16)),
        targetLockBonus: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.targetLockBonus, 10)),
        protectedAreaPenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.protectedAreaPenalty, 12)),
        blockedLinePenalty: Math.max(0, finiteNumber(navigation?.navigationRules?.aiTargetScoring?.blockedLinePenalty, 5))
      }
    },
    referenceGeometry: {
      schemaVersion: geometry?.schemaVersion || 1,
      debugOverlay: cloneValue(geometry?.debugOverlay || {}),
      assetDirectory: 'backend/data/training-war-map-v1'
    },
    itemCatalog: cloneValue(itemCatalog),
    objects,
    objectives,
    presets: [
      { id: 'empty', label: '空地图兵种测试', enabledTags: [] },
      { id: 'three-lane', label: '三路推演', enabledTags: ['wall', 'tower', 'highlandDefense'] },
      { id: 'full-jungle', label: '完整野区对抗', enabledTags: ['wall', 'tower', 'highlandDefense', 'neutral'] }
    ],
    defaultPresetId: 'full-jungle'
  };
};

module.exports = {
  buildReferenceTrainingMapConfig,
  normalizedToWorld,
  sourceBoundsToNormalizedBounds
};
