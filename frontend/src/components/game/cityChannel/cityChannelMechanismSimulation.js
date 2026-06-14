import {
  createCellKey,
  createWallKey,
  normalizeRotation,
  parseCellKey,
  wallEdgeToRotation
} from './cityChannelSchema';
import {
  collisionPrismsIntersect,
  getCityChannelPlacementCollisionBoxes,
  getCityChannelPlacementCollisionPrisms,
  isFloorSupportPlacement,
  isSupportCollisionExempt
} from './cityChannelPlacementGeometry';
import {
  buildMechanicalAssemblies,
  createLegacyFixedAxisBinding,
  getGearRotationDirectionSign,
  getGearMountLocalPosition,
  getGearSocketKind,
  isPassiveGearRotationDirection,
  normalizeGearAxisBinding
} from './cityChannelMechanismRuntime';
import {
  getGearSurfaceNormalSignForPanel,
  getGearSurfaceOffsetSignForPanel,
  normalizeGearSurfaceForPanel
} from './cityChannelGearPressurePlateRender';
import {
  getRackAxisBindingStatus,
  getRackCanonicalSegment,
  getRackGearContacts,
  DOUBLE_SIDED_RACK_HEIGHT_WORLD,
  DOUBLE_SIDED_RACK_TOOTH_DEPTH_WORLD,
  DOUBLE_SIDED_RACK_WIDTH_WORLD,
  RACK_DIRECTIONS,
  RACK_PLANES
} from './cityChannelRackModel';

export const FIXED_AXIS_SYNC_TOLERANCE_DEGREES = 0.5;
export const ROTATION_COLLISION_STEP_DEGREES = 2;
export const TRANSLATION_COLLISION_STEP_WORLD = 0.04;
export const MIN_MEANINGFUL_ROTATION_DEGREES = 12;
export const DEFAULT_GEAR_TEETH = 18;
export const CITY_CHANNEL_GEAR_TOOTH_COUNT = DEFAULT_GEAR_TEETH;
export const RACK_TRANSLATION_MOTION_TYPE = 'rackTranslation';
export const CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD = Math.SQRT2 / 4;
export const CITY_CHANNEL_GEAR_ROOT_RADIUS_WORLD = CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.78;
export const CITY_CHANNEL_GEAR_OUTER_RADIUS_WORLD = CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 1.08;
export const CITY_CHANNEL_GEAR_HUB_RADIUS_WORLD = CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.32;
export const CITY_CHANNEL_GEAR_AXLE_RADIUS_WORLD = CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD * 0.14;
export const CITY_CHANNEL_GEAR_THICKNESS_WORLD = 0.09;
export const CITY_CHANNEL_GEAR_MESH_TOLERANCE_WORLD = 0.09;
const VERTICAL_PANEL_BASE_LIFT_WORLD = 4 / 62;
const VERTICAL_PANEL_SURFACE_OFFSET_WORLD = 0.06;
const FLOOR_PANEL_COLLISION_THICKNESS = 0.16;
const RACK_COLLISION_SIDE_HALF_WIDTH = (DOUBLE_SIDED_RACK_WIDTH_WORLD + DOUBLE_SIDED_RACK_TOOTH_DEPTH_WORLD) * 0.5;
const RACK_COLLISION_NORMAL_HALF_WIDTH = DOUBLE_SIDED_RACK_HEIGHT_WORLD * 0.5;

const worldEdgeTangent = {
  north: { x: 1, y: 0 },
  south: { x: 1, y: 0 },
  west: { x: 0, y: 1 },
  east: { x: 0, y: 1 }
};

const worldEdgeNormal = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const worldEdgeCenter = {
  north: { x: 0, y: -0.5 },
  south: { x: 0, y: 0.5 },
  west: { x: -0.5, y: 0 },
  east: { x: 0.5, y: 0 }
};

const getVerticalAxis = (rotation = 0) => rotatePoint({ x: 1, y: 0 }, normalizeRotation(rotation || 0));
const getVerticalNormal = (rotation = 0) => rotatePoint({ x: 0, y: 1 }, normalizeRotation(rotation || 0));

const getPointBounds = (points = []) => points.reduce((bounds, point) => ({
  minX: Math.min(bounds.minX, point.x),
  maxX: Math.max(bounds.maxX, point.x),
  minY: Math.min(bounds.minY, point.y),
  maxY: Math.max(bounds.maxY, point.y)
}), {
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity
});

const createCollisionPrism = ({ points = [], minZ = 0, maxZ = 0 } = {}) => ({
  ...getPointBounds(points),
  points,
  minZ,
  maxZ
});

const getSurfaceOffsetSign = (placement = {}, mount = {}) => (
  getGearSurfaceOffsetSignForPanel(placement.panelType, mount.surface || 'front')
);

export const rotatePoint = (point = {}, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: ((Number(point.x) || 0) * cos) - ((Number(point.y) || 0) * sin),
    y: ((Number(point.x) || 0) * sin) + ((Number(point.y) || 0) * cos)
  };
};

const normalizeDegrees = (degrees = 0) => {
  const parsed = Number(degrees);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
};

export const rotateWorldPointAround = (point = {}, anchor = {}, degrees = 0) => {
  const local = {
    x: (Number(point.x) || 0) - (Number(anchor.x) || 0),
    y: (Number(point.y) || 0) - (Number(anchor.y) || 0)
  };
  const rotated = rotatePoint(local, degrees);
  return {
    x: (Number(anchor.x) || 0) + rotated.x,
    y: (Number(anchor.y) || 0) + rotated.y,
    z: Number(point.z) || 0
  };
};

const getPlacementKey = (placement = {}) => (
  placement.edge
    ? createWallKey(placement.x, placement.y, placement.z, placement.edge)
    : createCellKey(placement.x, placement.y, placement.z)
);

export const getPlacementByComponentKey = (mapData = {}, componentKey = '') => (
  mapData.tiles?.[componentKey] || mapData.walls?.[componentKey] || null
);

export const getGearTeeth = (mount = {}) => {
  const teeth = Number(mount.teeth ?? mount.toothCount ?? mount.gearTeeth);
  return Number.isFinite(teeth) && teeth > 0 ? teeth : DEFAULT_GEAR_TEETH;
};

export const getGearTorqueRatio = (driveRatio = 1) => {
  const ratio = Number(driveRatio) || 1;
  return ratio === 0 ? 0 : 1 / Math.abs(ratio);
};

export const getGearRatioRadiusForMount = (mount = {}) => (
  Math.max(1, getGearTeeth(mount))
);

const roundRuntimeNumber = (value = 0) => Number((Number(value) || 0).toFixed(6));
const RACK_CONTACT_TRAVEL_EPSILON = 0.000001;

export const isRackTranslationRuntimeEntry = (entry = null) => (
  entry?.motionType === RACK_TRANSLATION_MOTION_TYPE
);

export const getRackAxisUnitVector = (rack = {}) => {
  const segment = getRackCanonicalSegment(rack);
  if (segment.direction === RACK_DIRECTIONS.Z) return { x: 0, y: 0, z: 1 };
  if (segment.direction === RACK_DIRECTIONS.Y) return { x: 0, y: 1, z: 0 };
  return { x: 1, y: 0, z: 0 };
};

export const getRackAxisValueForPoint = (rack = {}, point = {}) => {
  const segment = getRackCanonicalSegment(rack);
  if (segment.direction === RACK_DIRECTIONS.Z) return Number(point.z) || 0;
  if (segment.direction === RACK_DIRECTIONS.Y) return Number(point.y) || 0;
  return Number(point.x) || 0;
};

const getRackContactDriveSign = (rackSegment = {}, sideSign = 1) => (
  rackSegment.plane === RACK_PLANES.VERTICAL && rackSegment.direction === RACK_DIRECTIONS.Z
    ? (Number(sideSign) < 0 ? -1 : 1)
    : (Number(sideSign) < 0 ? 1 : -1)
);

const getRackContactDriveRatio = (rack = {}, contact = {}) => {
  const contactSideSign = Number(contact.sideSign) < 0 ? -1 : 1;
  const configuredDriveSign = isPassiveGearRotationDirection(contact.node?.mount?.rotationDirection)
    ? null
    : getGearRotationDirectionSign(contact.node?.mount?.rotationDirection);
  const gearDriveRatio = configuredDriveSign || Number(contact.node?.driveRatio) || 1;
  return gearDriveRatio * getRackContactDriveSign(getRackCanonicalSegment(rack), contactSideSign);
};

const getRackContactDriveCoefficient = (rack = {}, contact = {}) => {
  const pitchRadiusWorld = Math.max(
    0.001,
    Number(contact.node?.pitchRadiusWorld ?? contact.node?.pitchRadius) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  return getRackContactDriveRatio(rack, contact) * pitchRadiusWorld;
};

const createRackDriveConflict = (rack = {}, contacts = []) => {
  const sources = (Array.isArray(contacts) ? contacts : [])
    .map((contact) => {
      if (!contact?.node?.id) return null;
      return {
        rackId: rack.id || null,
        driveCoefficient: getRackContactDriveCoefficient(rack, contact),
        driveRatio: getRackContactDriveRatio(rack, contact),
        contactSideSign: Number(contact.sideSign) < 0 ? -1 : 1,
        contactRackAxis: Number(contact.rackAxis) || 0,
        sourceGearNodeId: contact.node.id,
        sourceGearComponentKey: contact.node.componentKey,
        sourceGearMountId: contact.node.mountId
      };
    })
    .filter(Boolean);
  if (sources.length <= 1) return null;
  const reference = sources[0].driveCoefficient;
  const hasConflict = sources.some((source) => (
    Math.abs(source.driveCoefficient - reference) > RACK_CONTACT_TRAVEL_EPSILON
  ));
  if (!hasConflict) return null;
  return {
    blocked: true,
    type: 'rackDriveConflict',
    rackId: rack.id || null,
    sources
  };
};

const getRackContactTravelLimits = (rack = {}, contactRackAxis = 0) => {
  const axis = Number(contactRackAxis);
  if (!Number.isFinite(axis)) return null;
  const rackSegment = getRackCanonicalSegment(rack);
  if (rackSegment.length < 1) return null;
  return {
    min: axis - rackSegment.max,
    max: axis - rackSegment.min
  };
};

const mergeRackContactTravelLimits = (limits = []) => {
  const sorted = limits
    .map((limit) => ({
      min: Number(limit?.min),
      max: Number(limit?.max)
    }))
    .filter((limit) => Number.isFinite(limit.min) && Number.isFinite(limit.max) && limit.max >= limit.min)
    .sort((a, b) => a.min - b.min);
  if (sorted.length <= 0) return null;
  const merged = [];
  sorted.forEach((limit) => {
    const previous = merged[merged.length - 1];
    if (!previous || limit.min > previous.max + RACK_CONTACT_TRAVEL_EPSILON) {
      merged.push({ ...limit });
      return;
    }
    previous.max = Math.max(previous.max, limit.max);
  });
  return merged.find((limit) => (
    limit.min <= RACK_CONTACT_TRAVEL_EPSILON
    && limit.max >= -RACK_CONTACT_TRAVEL_EPSILON
  )) || null;
};

export const getRackTranslationTravelLimits = (entry = {}) => {
  if (!entry?.rack) return null;
  const sourceLimits = Array.isArray(entry.sourceContactTravelLimits)
    ? mergeRackContactTravelLimits(entry.sourceContactTravelLimits)
    : null;
  if (sourceLimits) return sourceLimits;
  return getRackContactTravelLimits(entry.rack, entry.contactRackAxis);
};

export const clampRackTranslationDistanceToContact = (entry = {}, distance = 0) => {
  const target = Number(distance) || 0;
  const limits = getRackTranslationTravelLimits(entry);
  if (!limits) return target;
  return Math.min(Math.max(target, limits.min), limits.max);
};

export const getRackContactLimitedTranslationDistance = (entry = {}, sourceAngle = 0) => (
  clampRackTranslationDistanceToContact(entry, getRackTranslationDistance(entry, sourceAngle))
);

export const getRackTranslationDistance = (entry = {}, sourceAngle = 0, options = {}) => {
  if (entry?.driveConflict?.blocked) return 0;
  const angle = (Number(entry.driveRatio) || 1) * (Number(sourceAngle) || 0);
  const radius = Math.max(
    0.001,
    Number(entry.pitchRadiusWorld ?? entry.rackPitchRadiusWorld) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  const distance = (angle * Math.PI * radius) / 180;
  return options?.clampToContact
    ? clampRackTranslationDistanceToContact(entry, distance)
    : distance;
};

export const getRackTranslationOffset = (entry = {}, sourceAngle = 0, options = {}) => {
  const axis = entry.translationAxis || getRackAxisUnitVector(entry.rack || {});
  const optionDistance = Number(options?.distance);
  const distance = Number.isFinite(optionDistance)
    ? optionDistance
    : getRackTranslationDistance(entry, sourceAngle, options);
  return {
    x: roundRuntimeNumber((Number(axis.x) || 0) * distance),
    y: roundRuntimeNumber((Number(axis.y) || 0) * distance),
    z: roundRuntimeNumber((Number(axis.z) || 0) * distance)
  };
};

const setRackPointAxisValue = (point = {}, direction = RACK_DIRECTIONS.X, value = 0) => {
  if (direction === RACK_DIRECTIONS.Z) return { ...point, z: value };
  if (direction === RACK_DIRECTIONS.Y) return { ...point, y: value };
  return { ...point, x: value };
};

export const getSweptRackForTranslation = (rack = {}, linearDistance = 0) => {
  const segment = getRackCanonicalSegment(rack);
  const minTravel = Math.min(0, Number(linearDistance) || 0);
  const maxTravel = Math.max(0, Number(linearDistance) || 0);
  return {
    ...rack,
    start: setRackPointAxisValue(segment.start, segment.direction, segment.min + minTravel),
    end: setRackPointAxisValue(segment.end, segment.direction, segment.max + maxTravel),
    ...(Number.isFinite(Number(segment.z)) ? { z: segment.z } : {})
  };
};

export const getRackTravelEngagementDistance = (rack = {}, gearAxis = 0, linearDistance = 0) => {
  const target = Number(linearDistance) || 0;
  const axis = Number(gearAxis);
  if (!Number.isFinite(axis) || Math.abs(target) <= RACK_CONTACT_TRAVEL_EPSILON) return 0;
  const segment = getRackCanonicalSegment(rack);
  if (segment.length < 1) return 0;
  const contactMinTravel = axis - segment.max;
  const contactMaxTravel = axis - segment.min;
  if (target > 0) {
    const start = Math.max(0, contactMinTravel);
    const end = Math.min(target, contactMaxTravel);
    return end > start + RACK_CONTACT_TRAVEL_EPSILON ? end - start : 0;
  }
  const start = Math.max(target, contactMinTravel);
  const end = Math.min(0, contactMaxTravel);
  return end > start + RACK_CONTACT_TRAVEL_EPSILON ? start - end : 0;
};

export const translateRuntimePoint = (point = {}, offset = {}) => ({
  x: roundRuntimeNumber((Number(point.x) || 0) + (Number(offset.x) || 0)),
  y: roundRuntimeNumber((Number(point.y) || 0) + (Number(offset.y) || 0)),
  z: roundRuntimeNumber((Number(point.z) || 0) + (Number(offset.z) || 0))
});

export const getRuntimePlacementForRackTranslationAssemblyMember = ({
  placement = {},
  entry = {},
  sourceAngle = 0,
  offset = null,
  linearDistance = null
} = {}) => {
  const translation = offset || getRackTranslationOffset(entry, sourceAngle);
  const resolvedLinearDistance = Number.isFinite(Number(linearDistance))
    ? Number(linearDistance)
    : getRackTranslationDistance(entry, sourceAngle);
  return {
    ...placement,
    x: roundRuntimeNumber((Number(placement.x) || 0) + (Number(translation.x) || 0)),
    y: roundRuntimeNumber((Number(placement.y) || 0) + (Number(translation.y) || 0)),
    z: roundRuntimeNumber((Number(placement.z) || 0) + (Number(translation.z) || 0)),
    runtimeMotionType: RACK_TRANSLATION_MOTION_TYPE,
    runtimeRackId: entry.rackId || entry.sourceRackId || entry.rack?.id || null,
    runtimeTranslation: translation,
    runtimeLinearDistance: roundRuntimeNumber(resolvedLinearDistance),
    runtimeSourceGearComponentKey: entry.sourceGearComponentKey || null,
    runtimeSourceGearMountId: entry.sourceGearMountId || null
  };
};

export const getRuntimeRackForTranslation = ({
  rack = {},
  entry = {},
  sourceAngle = 0,
  offset = null,
  linearDistance = null
} = {}) => {
  const translation = offset || getRackTranslationOffset(entry, sourceAngle);
  const resolvedLinearDistance = Number.isFinite(Number(linearDistance))
    ? Number(linearDistance)
    : getRackTranslationDistance(entry, sourceAngle);
  return {
    ...rack,
    start: translateRuntimePoint(rack.start || {}, translation),
    end: translateRuntimePoint(rack.end || {}, translation),
    z: roundRuntimeNumber((Number(rack.z) || 0) + (Number(translation.z) || 0)),
    runtimeMotionType: RACK_TRANSLATION_MOTION_TYPE,
    runtimeRackId: entry.rackId || entry.sourceRackId || rack.id || null,
    runtimeTranslation: translation,
    runtimeLinearDistance: roundRuntimeNumber(resolvedLinearDistance),
    runtimeSourceGearComponentKey: entry.sourceGearComponentKey || null,
    runtimeSourceGearMountId: entry.sourceGearMountId || null
  };
};

const getVerticalSurfaceFrame = (placement = {}, mount = {}) => {
  const edge = placement.edge || null;
  const yaw = edge ? wallEdgeToRotation(edge) : normalizeRotation(placement.rotation || 0);
  const originOffset = edge ? (worldEdgeCenter[edge] || worldEdgeCenter.north) : { x: 0, y: 0 };
  return {
    axis: edge ? (worldEdgeTangent[edge] || worldEdgeTangent.north) : getVerticalAxis(yaw),
    normal: edge ? (worldEdgeNormal[edge] || worldEdgeNormal.north) : getVerticalNormal(yaw),
    originOffset,
    surfaceOffset: VERTICAL_PANEL_SURFACE_OFFSET_WORLD * getSurfaceOffsetSign(placement, mount),
    baseLift: edge ? 0 : VERTICAL_PANEL_BASE_LIFT_WORLD,
    yaw
  };
};

const getVerticalSurfaceBaseRotation = (placement = {}) => normalizeRotation(placement.transmissionRotation ?? 0);

const getSurfaceRuntimeRotation = (placement = {}) => (
  Number.isFinite(Number(placement.runtimeSurfaceRotation))
    ? Number(placement.runtimeSurfaceRotation)
    : 0
);

const getVerticalSurfaceLocalRotation = (placement = {}) => normalizeRotation(
  getVerticalSurfaceBaseRotation(placement) + getSurfaceRuntimeRotation(placement)
);

const getHorizontalSurfaceBaseRotation = (placement = {}) => normalizeRotation(
  Number.isFinite(Number(placement.runtimeBaseSurfaceRotation))
    ? Number(placement.runtimeBaseSurfaceRotation)
    : (placement.transmissionRotation ?? placement.rotation ?? 0)
);

const getHorizontalSurfaceLocalRotation = (placement = {}) => normalizeRotation(
  getHorizontalSurfaceBaseRotation(placement) + getSurfaceRuntimeRotation(placement)
);

const getVerticalSurfaceWorldPosition = (placement = {}, mount = {}, local = null) => {
  const frame = getVerticalSurfaceFrame(placement, mount);
  const rotated = rotatePoint(local || getGearMountLocalPosition(mount.position), getVerticalSurfaceLocalRotation(placement));
  const z = Number(placement.z) || 0;
  return {
    x: (Number(placement.x) || 0)
      + (frame.originOffset.x || 0)
      + (frame.axis.x * (Number(rotated.x) || 0))
      + (frame.normal.x * frame.surfaceOffset),
    y: (Number(placement.y) || 0)
      + (frame.originOffset.y || 0)
      + (frame.axis.y * (Number(rotated.x) || 0))
      + (frame.normal.y * frame.surfaceOffset),
    z: z + 0.5 - (Number(rotated.y) || 0) + frame.baseLift
  };
};

export const getGearWorldPosition = (placement = {}, mount = {}) => {
  if (!placement || !mount) return null;
  const local = getGearMountLocalPosition(mount.position);
  const z = Number(placement.z) || 0;

  if (placement.edge || placement.isVertical) {
    return getVerticalSurfaceWorldPosition(placement, mount, local);
  }

  const rotation = getHorizontalSurfaceLocalRotation(placement);
  const rotated = rotatePoint(local, rotation);
  return {
    x: (Number(placement.x) || 0) + rotated.x,
    y: (Number(placement.y) || 0) + rotated.y,
    z
  };
};

export const getGearMeshPlane = (placement = {}, mount = {}, worldPoint = null) => {
  if (!placement || !mount) return null;
  const point = worldPoint || getGearWorldPosition(placement, mount);
  if (!point) return null;
  const sign = getGearSurfaceNormalSignForPanel(placement.panelType, mount.surface || 'front');

  if (placement.edge) {
    const tangent = worldEdgeTangent[placement.edge] || worldEdgeTangent.north;
    const baseNormal = worldEdgeNormal[placement.edge] || worldEdgeNormal.north;
    const normal = {
      x: baseNormal.x * sign,
      y: baseNormal.y * sign,
      z: 0
    };
    return {
      kind: 'vertical',
      normal,
      planeOffset: (point.x * normal.x) + (point.y * normal.y),
      u: (point.x * tangent.x) + (point.y * tangent.y),
      v: Number(point.z) || 0
    };
  }

  if (placement.isVertical) {
    const tangent = getVerticalAxis(placement.rotation || 0);
    const baseNormal = getVerticalNormal(placement.rotation || 0);
    const normal = {
      x: baseNormal.x * sign,
      y: baseNormal.y * sign,
      z: 0
    };
    return {
      kind: 'vertical',
      normal,
      planeOffset: (point.x * normal.x) + (point.y * normal.y),
      u: (point.x * tangent.x) + (point.y * tangent.y),
      v: Number(point.z) || 0
    };
  }

  const normalZ = normalizeGearSurfaceForPanel(placement.panelType, mount.surface || 'front') === 'back' ? -1 : 1;
  return {
    kind: 'horizontal',
    normal: { x: 0, y: 0, z: normalZ },
    planeOffset: (Number(point.z) || 0) * normalZ,
    u: Number(point.x) || 0,
    v: Number(point.y) || 0
  };
};

export const getGearSurfaceKey = (placement, mount = {}) => {
  const surface = normalizeGearSurfaceForPanel(placement?.panelType, mount.surface || 'front');
  if (!placement) return `unknown:${surface}`;
  if (placement.edge) return `edge:${placement.z || 0}:${placement.edge}:${surface}`;
  if (placement.isVertical) {
    const axis = normalizeRotation(placement.rotation || 0) % 180;
    return `vertical:${placement.z || 0}:${axis}:${surface}`;
  }
  return `floor:${placement.z || 0}:${surface}`;
};

export const getGearContactThreshold = () => 56;

const getGearContactPoint = (node = {}) => node.worldPoint || node.point || { x: 0, y: 0, z: 0 };

const getGearPitchRadius = (node = {}) => Number(node.pitchRadiusWorld ?? node.pitchRadius) || 1;

const getGearOuterRadius = (node = {}) => (
  Number(node.outerRadiusWorld ?? node.outerRadius)
  || (getGearPitchRadius(node) * 1.08)
);

const getGearScreenPitchRadius = (node = {}) => Number(node.pitchRadius) || Number(node.pitchRadiusWorld) || 1;

const getGearRatioRadius = (node = {}) => Number(node.gearRatioRadius ?? node.pitchRadiusWorld ?? node.pitchRadius) || 1;

const getGearMeshTolerance = (pitchContact = 0) => Math.max(
  0.035,
  Math.min(CITY_CHANNEL_GEAR_MESH_TOLERANCE_WORLD, (Number(pitchContact) || 0) * 0.13)
);

const getGearGridMeshTolerance = () => CITY_CHANNEL_GEAR_MESH_TOLERANCE_WORLD;

const areGearGridValuesClose = (left = 0, right = 0) => (
  Math.abs((Number(left) || 0) - (Number(right) || 0)) <= getGearGridMeshTolerance()
);

const isGearGridOffset = (left = 0, right = 0, target = 0) => (
  Math.abs(Math.abs((Number(left) || 0) - (Number(right) || 0)) - target) <= getGearGridMeshTolerance()
);

const getGearNodeSocketKind = (node = {}) => getGearSocketKind(node?.mount?.position ?? node?.position);

const isGearStandardSocketMesh = (a = {}, b = {}) => {
  const aPlane = a.meshPlane;
  const bPlane = b.meshPlane;
  if (!aPlane || !bPlane || aPlane.kind !== bPlane.kind) return false;
  const aKind = getGearNodeSocketKind(a);
  const bKind = getGearNodeSocketKind(b);
  const centerCount = [aKind, bKind].filter((kind) => kind === 'center').length;
  if (centerCount === 2) {
    const horizontalNeighbor = areGearGridValuesClose(aPlane.v, bPlane.v)
      && isGearGridOffset(aPlane.u, bPlane.u, 1);
    if (aPlane.kind === 'vertical') return horizontalNeighbor;
    return horizontalNeighbor || (
      areGearGridValuesClose(aPlane.u, bPlane.u)
      && isGearGridOffset(aPlane.v, bPlane.v, 1)
    );
  }
  if (centerCount === 1 && [aKind, bKind].includes('corner')) {
    return isGearGridOffset(aPlane.u, bPlane.u, 0.5)
      && isGearGridOffset(aPlane.v, bPlane.v, 0.5);
  }
  return false;
};

const getGearPointInMeshPlane = (plane = null, point = null) => {
  if (!plane || !point) return null;
  if (plane.kind === 'horizontal') {
    const normalZ = Number(plane.normal?.z) || 1;
    return {
      planeOffset: (Number(point.z) || 0) * normalZ,
      u: Number(point.x) || 0,
      v: Number(point.y) || 0
    };
  }
  if (plane.kind === 'vertical') {
    const normal = plane.normal || {};
    const normalX = Number(normal.x) || 0;
    const normalY = Number(normal.y) || 0;
    if (Math.abs(normalX) + Math.abs(normalY) <= 0.001) return null;
    return {
      planeOffset: ((Number(point.x) || 0) * normalX) + ((Number(point.y) || 0) * normalY),
      u: ((Number(point.x) || 0) * -normalY) + ((Number(point.y) || 0) * normalX),
      v: Number(point.z) || 0
    };
  }
  return null;
};

const isIntersectionCenterMeshInPlane = (intersection = {}, center = {}) => {
  const centerPlane = center.meshPlane;
  const intersectionPoint = getGearContactPoint(intersection);
  const projectedIntersection = getGearPointInMeshPlane(centerPlane, intersectionPoint);
  if (!projectedIntersection || !centerPlane) return false;
  if (Math.abs(projectedIntersection.planeOffset - (Number(centerPlane.planeOffset) || 0)) > getGearGridMeshTolerance()) {
    return false;
  }
  return isGearGridOffset(projectedIntersection.u, centerPlane.u, 0.5)
    && isGearGridOffset(projectedIntersection.v, centerPlane.v, 0.5);
};

const isIntersectionCenterGearMesh = (a = {}, b = {}) => {
  const aIsIntersection = a.hostKind === 'intersection';
  const bIsIntersection = b.hostKind === 'intersection';
  if (aIsIntersection === bIsIntersection) return false;
  const intersection = aIsIntersection ? a : b;
  const center = aIsIntersection ? b : a;
  if (getGearNodeSocketKind(center) !== 'center') return false;
  if (isIntersectionCenterMeshInPlane(intersection, center)) return true;
  const intersectionPoint = getGearContactPoint(intersection);
  const centerPoint = getGearContactPoint(center);
  return areGearGridValuesClose(intersectionPoint.z, centerPoint.z)
    && isGearGridOffset(intersectionPoint.x, centerPoint.x, 0.5)
    && isGearGridOffset(intersectionPoint.y, centerPoint.y, 0.5);
};

const isGearMeshDistance = (distance = 0, pitchContact = 0, a = {}, b = {}) => {
  const parsedDistance = Number(distance);
  if (!Number.isFinite(parsedDistance)) return false;
  if (Math.abs(parsedDistance - pitchContact) <= getGearMeshTolerance(pitchContact)) return true;
  const outerContact = getGearOuterRadius(a) + getGearOuterRadius(b);
  if (parsedDistance > 0.08 && parsedDistance <= outerContact + getGearMeshTolerance(outerContact)) return true;
  return false;
};

const getGearMeshPlaneDistance = (a = {}, b = {}) => {
  const aPlane = a.meshPlane;
  const bPlane = b.meshPlane;
  if (!aPlane || !bPlane) return null;
  if (aPlane.kind !== bPlane.kind) return null;
  const aNormal = aPlane.normal || {};
  const bNormal = bPlane.normal || {};
  const normalDot = ((Number(aNormal.x) || 0) * (Number(bNormal.x) || 0))
    + ((Number(aNormal.y) || 0) * (Number(bNormal.y) || 0))
    + ((Number(aNormal.z) || 0) * (Number(bNormal.z) || 0));
  if (normalDot < 0.98) return null;
  if (Math.abs((Number(aPlane.planeOffset) || 0) - (Number(bPlane.planeOffset) || 0)) > 0.08) return null;
  return Math.hypot((Number(aPlane.u) || 0) - (Number(bPlane.u) || 0), (Number(aPlane.v) || 0) - (Number(bPlane.v) || 0));
};

const getSurfacePlaneWithoutSide = (surfaceKey = '') => {
  if (!surfaceKey) return '';
  const parts = String(surfaceKey).split(':');
  if (parts.length <= 1) return surfaceKey;
  return parts.slice(0, -1).join(':');
};

const areOppositeSidesOfSamePlane = (a = {}, b = {}) => (
  a.surfaceKey !== b.surfaceKey
  && getSurfacePlaneWithoutSide(a.surfaceKey) === getSurfacePlaneWithoutSide(b.surfaceKey)
);

const addRackContactEdges = (graph = new Map(), nodes = [], racks = []) => {
  (Array.isArray(racks) ? racks : []).forEach((rack) => {
    const contacts = getRackGearContacts(rack, nodes);
    for (let i = 0; i < contacts.length; i += 1) {
      for (let j = i + 1; j < contacts.length; j += 1) {
        const a = contacts[i];
        const b = contacts[j];
        if (!a?.node?.id || !b?.node?.id || a.node.id === b.node.id) continue;
        const sideRatio = a.sideSign === b.sideSign ? 1 : -1;
        const aRatioRadius = getGearRatioRadius(a.node);
        const bRatioRadius = getGearRatioRadius(b.node);
        graph.get(a.node.id)?.push({ id: b.node.id, ratio: sideRatio * (aRatioRadius / bRatioRadius), viaRackId: rack.id });
        graph.get(b.node.id)?.push({ id: a.node.id, ratio: sideRatio * (bRatioRadius / aRatioRadius), viaRackId: rack.id });
      }
    }
  });
};

export const buildGearContactGraph = (nodes = [], threshold = getGearContactThreshold(), racks = []) => {
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const intersectionCenterMesh = isIntersectionCenterGearMesh(a, b);
      const sameSurface = a.surfaceKey === b.surfaceKey;
      if (!intersectionCenterMesh && !sameSurface && areOppositeSidesOfSamePlane(a, b)) continue;
      const meshPlaneDistance = getGearMeshPlaneDistance(a, b);
      if (!intersectionCenterMesh && (a.meshPlane || b.meshPlane) && meshPlaneDistance === null) continue;
      const aPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(a) : (a.point || getGearContactPoint(a));
      const bPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(b) : (b.point || getGearContactPoint(b));
      if (!intersectionCenterMesh && meshPlaneDistance === null && sameSurface && Math.abs((Number(aPoint.z) || 0) - (Number(bPoint.z) || 0)) > 0.08) continue;
      const distance = meshPlaneDistance ?? Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y);
      const aRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(a) : getGearScreenPitchRadius(a);
      const bRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(b) : getGearScreenPitchRadius(b);
      const pitchContact = aRadius + bRadius;
      if (!intersectionCenterMesh) {
        if (meshPlaneDistance !== null || sameSurface) {
          if (!isGearStandardSocketMesh(a, b) && !isGearMeshDistance(distance, pitchContact, a, b)) continue;
        } else {
          const contactDistance = Math.max(pitchContact * 1.22, Math.min(threshold, pitchContact * 1.22));
          if (distance > contactDistance) continue;
          if (distance < Math.max(pitchContact * 0.28, 0.08)) continue;
        }
      }
      const aRatioRadius = getGearRatioRadius(a);
      const bRatioRadius = getGearRatioRadius(b);
      graph.get(a.id)?.push({ id: b.id, ratio: -(aRatioRadius / bRatioRadius) });
      graph.get(b.id)?.push({ id: a.id, ratio: -(bRatioRadius / aRatioRadius) });
    }
  }
  addRackContactEdges(graph, nodes, racks);
  return graph;
};

export const getAssemblyComponentDistances = (assembly, sourceComponentKey) => {
  const distances = new Map();
  if (!assembly || !sourceComponentKey) return distances;
  const componentKeys = new Set(assembly.componentKeys || []);
  if (!componentKeys.has(sourceComponentKey)) return distances;
  const adjacency = new Map([...componentKeys].map((key) => [key, []]));
  (assembly.edges || []).forEach((edge) => {
    if (!edge?.componentKey || !edge?.key) return;
    if (!componentKeys.has(edge.componentKey) || !componentKeys.has(edge.key)) return;
    adjacency.get(edge.componentKey)?.push(edge.key);
  });
  const queue = [sourceComponentKey];
  distances.set(sourceComponentKey, 0);
  while (queue.length > 0) {
    const current = queue.shift();
    const nextDistance = (distances.get(current) || 0) + 1;
    (adjacency.get(current) || []).forEach((nextKey) => {
      if (distances.has(nextKey)) return;
      distances.set(nextKey, nextDistance);
      queue.push(nextKey);
    });
  }
  return distances;
};

export const getDrivenGearRoots = (assembly, nodes = [], sourceComponentKey = '') => {
  if (nodes.length <= 0) return [];
  const assemblyComponentKeys = new Set(assembly?.componentKeys || []);
  const directDriveNodes = nodes.filter((node) => {
    if (isPassiveGearRotationDirection(node?.mount?.rotationDirection)) return false;
    const boundComponentKey = node?.mount?.axisBinding?.componentKey;
    return !boundComponentKey || assemblyComponentKeys.has(boundComponentKey);
  });
  if (directDriveNodes.length <= 0) return [];
  const sortRootEntries = (left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    const leftCenter = getGearSocketKind(left.node?.mount?.position ?? left.node?.position) === 'center';
    const rightCenter = getGearSocketKind(right.node?.mount?.position ?? right.node?.position) === 'center';
    if (leftCenter === rightCenter) return 0;
    return leftCenter ? -1 : 1;
  };
  const distances = getAssemblyComponentDistances(assembly, sourceComponentKey);
  const reachable = directDriveNodes
    .map((node) => ({ node, distance: distances.has(node.componentKey) ? distances.get(node.componentKey) : Infinity }))
    .filter((item) => Number.isFinite(item.distance));
  if (reachable.length <= 0) {
    return directDriveNodes
      .map((node) => ({ node, distance: Infinity }))
      .sort(sortRootEntries)
      .map((item) => item.node);
  }
  return reachable.sort(sortRootEntries).map((item) => item.node);
};

export const isDrivenGearAxisBindingActive = (node = null, assembly = null) => {
  const binding = normalizeGearAxisBinding(node?.mount?.axisBinding);
  if (!binding?.componentKey) return false;
  if (node?.axisBindingSuppressed) return false;
  return Math.abs(Number(node?.driveRatio) || 0) > RACK_CONTACT_TRAVEL_EPSILON;
};

const shouldSuppressDrivenAxisBinding = (node = null, nodeById = new Map(), sourceAssembly = null) => {
  const binding = normalizeGearAxisBinding(node?.mount?.axisBinding);
  if (!binding?.componentKey || node?.isDriveRoot !== false) return false;
  const driver = node?.drivenByGearId ? nodeById.get(node.drivenByGearId) : null;
  const isDrivenCorner = getGearSocketKind(node?.mount?.position ?? node?.position) === 'corner';
  const isDrivenByCenter = getGearSocketKind(driver?.mount?.position ?? driver?.position) === 'center';
  const sourceAssemblyKeys = new Set(sourceAssembly?.componentKeys || []);
  const bindsIntoSourceAssembly = sourceAssemblyKeys.has(binding.componentKey);
  return isDrivenCorner && isDrivenByCenter && (
    binding.componentKey === driver?.componentKey
    || bindsIntoSourceAssembly
  );
};

const attachGearDriveConflicts = (nodes = [], conflicts = []) => {
  Object.defineProperty(nodes, 'driveConflicts', {
    configurable: true,
    enumerable: false,
    value: conflicts
  });
  return nodes;
};

const getExplicitGearDriveRatio = (node = null) => {
  if (node?.rotationDirectionConfigured === false) return null;
  if (!Object.prototype.hasOwnProperty.call(node?.mount || {}, 'rotationDirection')) return null;
  if (isPassiveGearRotationDirection(node?.mount?.rotationDirection)) return null;
  const ratio = getGearRotationDirectionSign(node?.mount?.rotationDirection);
  return ratio || null;
};

const clearGearDriveRuntimeState = (node = null) => {
  if (!node) return;
  node.driveRatio = 0;
  node.direction = 0;
  node.isDriveRoot = undefined;
  node.drivenViaRackId = null;
  node.driveSourceNodeId = null;
  node.drivenByGearId = null;
  node.drivenByComponentKey = null;
  node.drivenByMountId = null;
  node.axisBindingSuppressed = false;
  node.sourceAssemblyDriveActive = false;
};

const createGearDriveConflictSource = (node = null, role = 'gear', driveRatio = 0) => (
  node?.id
    ? {
      role,
      driveRatio: Number(driveRatio) || 0,
      sourceGearNodeId: node.id,
      sourceGearComponentKey: node.componentKey,
      sourceGearMountId: node.mountId
    }
    : null
);

const createGearDriveConflict = ({
  source = null,
  current = null,
  target = null,
  proposedRatio = 0,
  requiredRatio = 0,
  viaRackId = null
} = {}) => {
  const sourceEntries = [
    createGearDriveConflictSource(source, 'source', source?.driveRatio),
    createGearDriveConflictSource(current, 'mesh', current?.driveRatio),
    createGearDriveConflictSource(target, 'target', requiredRatio)
  ].filter(Boolean);
  const seen = new Set();
  return {
    blocked: true,
    type: 'gearDriveConflict',
    proposedRatio,
    requiredRatio,
    viaRackId,
    sources: sourceEntries.filter((entry) => {
      if (seen.has(entry.sourceGearNodeId)) return false;
      seen.add(entry.sourceGearNodeId);
      return true;
    })
  };
};

export const resolveDrivenGearNodes = ({
  assembly,
  assemblyNodes = [],
  allNodes = [],
  contactGraph = null,
  sourceComponentKey = ''
} = {}) => {
  if (assemblyNodes.length <= 0) return [];
  allNodes.forEach(clearGearDriveRuntimeState);
  const sourceAssemblyComponentKeys = new Set(assembly?.componentKeys || []);
  const isExplicitDriveActiveInSourceAssembly = (node = null) => (
    !!node?.componentKey && sourceAssemblyComponentKeys.has(node.componentKey)
  );
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const graph = contactGraph || buildGearContactGraph(allNodes);
  const roots = getDrivenGearRoots(assembly, assemblyNodes, sourceComponentKey);
  if (roots.length <= 0) return [];
  roots.forEach((root) => {
    const liveRoot = byId.get(root?.id);
    if (liveRoot) liveRoot.sourceAssemblyDriveActive = true;
  });
  const visited = new Set();
  const driveSourceById = new Map();
  const conflicts = [];
  const conflictKeys = new Set();
  const addGearDriveConflict = (conflict = null) => {
    if (!conflict?.sources?.length) return;
    const key = conflict.sources
      .map((source) => source.sourceGearNodeId)
      .sort()
      .join('|');
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push(conflict);
  };
  roots.forEach((root) => {
    if (!root?.id) return;
    const liveRoot = byId.get(root.id);
    if (!liveRoot) return;
    const rootDirection = getGearRotationDirectionSign(liveRoot.mount?.rotationDirection) || 1;
    if (visited.has(root.id)) {
      const explicitRatio = getExplicitGearDriveRatio(liveRoot);
      if (
        explicitRatio !== null
        && !liveRoot.drivenViaRackId
        && Math.abs((Number(liveRoot.driveRatio) || 0) - explicitRatio) > RACK_CONTACT_TRAVEL_EPSILON
      ) {
        const driver = liveRoot.drivenByGearId ? byId.get(liveRoot.drivenByGearId) : null;
        const source = driveSourceById.has(root.id) ? byId.get(driveSourceById.get(root.id)) : driver;
        addGearDriveConflict(createGearDriveConflict({
          source,
          current: driver,
          target: liveRoot,
          proposedRatio: Number(liveRoot.driveRatio) || 0,
          requiredRatio: explicitRatio
        }));
      }
      return;
    }
    liveRoot.driveRatio = rootDirection;
    liveRoot.direction = rootDirection;
    liveRoot.isDriveRoot = true;
    liveRoot.drivenViaRackId = null;
    liveRoot.driveSourceNodeId = liveRoot.id;
    liveRoot.drivenByGearId = null;
    liveRoot.drivenByComponentKey = null;
    liveRoot.drivenByMountId = null;
    visited.add(root.id);
    driveSourceById.set(root.id, root.id);
    const queue = [root.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      const current = byId.get(currentId);
      (graph.get(currentId) || []).forEach((edge) => {
        const nextId = edge.id;
        const next = byId.get(nextId);
        if (!next || !current) return;
        const proposedRatio = (current.driveRatio || 1) * (edge.ratio || -1);
        const source = driveSourceById.has(currentId) ? byId.get(driveSourceById.get(currentId)) : current;
        if (visited.has(nextId)) {
          if (Math.abs((Number(next.driveRatio) || 0) - proposedRatio) > RACK_CONTACT_TRAVEL_EPSILON) {
            addGearDriveConflict(createGearDriveConflict({
              source,
              current,
              target: next,
              proposedRatio,
              requiredRatio: Number(next.driveRatio) || 0,
              viaRackId: edge.viaRackId || null
            }));
          }
          return;
        }
        const explicitRatio = isExplicitDriveActiveInSourceAssembly(next)
          ? getExplicitGearDriveRatio(next)
          : null;
        if (
          !edge.viaRackId
          && explicitRatio !== null
          && Math.abs(explicitRatio - proposedRatio) > RACK_CONTACT_TRAVEL_EPSILON
        ) {
          addGearDriveConflict(createGearDriveConflict({
            source,
            current,
            target: next,
            proposedRatio,
            requiredRatio: explicitRatio,
            viaRackId: edge.viaRackId || null
          }));
          return;
        }
        next.driveRatio = proposedRatio;
        next.direction = next.driveRatio >= 0 ? 1 : -1;
        next.isDriveRoot = false;
        next.drivenViaRackId = edge.viaRackId || null;
        next.driveSourceNodeId = source?.id || current.id;
        next.drivenByGearId = current.id;
        next.drivenByComponentKey = current.componentKey;
        next.drivenByMountId = current.mountId;
        visited.add(nextId);
        driveSourceById.set(nextId, next.driveSourceNodeId);
        queue.push(nextId);
      });
    }
  });
  const driven = allNodes.filter((node) => visited.has(node.id));
  driven.forEach((node) => {
    node.axisBindingSuppressed = shouldSuppressDrivenAxisBinding(node, byId, assembly);
  });
  return driven.length > 0
    ? attachGearDriveConflicts(driven, conflicts)
    : attachGearDriveConflicts(assemblyNodes.map((node, index) => {
      const next = {
        ...node,
        driveRatio: index % 2 === 0 ? 1 : -1,
        direction: index % 2 === 0 ? 1 : -1,
        isDriveRoot: index === 0,
        drivenViaRackId: null
      };
      return {
        ...next,
        axisBindingSuppressed: shouldSuppressDrivenAxisBinding(next, byId, assembly)
      };
    }), conflicts);
};

export const getGearPhase = (node, angle = 0, basePhase = 0) => normalizeRotation(
  basePhase + ((node.driveRatio || node.direction || 1) * angle)
);

export const getFixedAxisWorldAnchor = (mapData = {}, fixedAxis = {}) => {
  const placement = getPlacementByComponentKey(mapData, fixedAxis.componentKey)
    || (fixedAxis.cell ? getPlacementByComponentKey(mapData, createCellKey(fixedAxis.cell.x, fixedAxis.cell.y, fixedAxis.cell.z)) : null);
  const anchor = getGearWorldPosition(placement, fixedAxis);
  if (anchor) return anchor;
  const cell = fixedAxis.cell || parseCellKey(fixedAxis.componentKey || '');
  return {
    x: Number(cell?.x) || 0,
    y: Number(cell?.y) || 0,
    z: Number(cell?.z) || 0
  };
};

const getRotatedBox = (box = {}, anchor = {}, degrees = 0) => {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY }
  ].map((point) => rotateWorldPointAround(point, anchor, degrees));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxY: Math.max(...corners.map((point) => point.y)),
    minZ: box.minZ,
    maxZ: box.maxZ
  };
};

export const getRotatedPlacementCollisionBoxes = (placement, anchor, degrees = 0) => (
  getCityChannelPlacementCollisionBoxes(placement)
    .map((box) => getRotatedBox(box, anchor, degrees))
);

export const getRuntimePlacementAtAngle = (placement = {}, anchor = {}, degrees = 0) => {
  const point = rotateWorldPointAround(placement, anchor, degrees);
  const baseRotation = placement.edge ? wallEdgeToRotation(placement.edge) : (placement.rotation || 0);
  const baseSurfaceRotation = normalizeRotation(placement.transmissionRotation ?? baseRotation);
  return {
    ...placement,
    x: Number(point.x.toFixed(4)),
    y: Number(point.y.toFixed(4)),
    z: placement.z,
    runtimeAngle: degrees,
    runtimeAxisAnchor: anchor,
    rotation: normalizeRotation(baseRotation + degrees),
    runtimeSurfaceRotation: Number(degrees) || 0,
    runtimeBaseSurfaceRotation: baseSurfaceRotation
  };
};

const getPlacementSurfaceCenterWorld = (placement = {}, mount = {}) => {
  if (placement.edge || placement.isVertical) {
    return getVerticalSurfaceWorldPosition(placement, {
      ...mount,
      position: 'center'
    }, { x: 0, y: 0, z: 0 });
  }
  return {
    x: Number(placement.x) || 0,
    y: Number(placement.y) || 0,
    z: Number(placement.z) || 0
  };
};

const getVerticalPlaneCoordinates = (point = {}, anchor = {}, frame = {}) => {
  const dx = (Number(point.x) || 0) - (Number(anchor.x) || 0);
  const dy = (Number(point.y) || 0) - (Number(anchor.y) || 0);
  return {
    x: (dx * (frame.axis?.x || 0)) + (dy * (frame.axis?.y || 0)),
    y: -((Number(point.z) || 0) - (Number(anchor.z) || 0)),
    normal: (dx * (frame.normal?.x || 0)) + (dy * (frame.normal?.y || 0))
  };
};

const getWorldPointFromVerticalPlaneCoordinates = (coords = {}, anchor = {}, frame = {}) => ({
  x: (Number(anchor.x) || 0)
    + ((frame.axis?.x || 0) * (Number(coords.x) || 0))
    + ((frame.normal?.x || 0) * (Number(coords.normal) || 0)),
  y: (Number(anchor.y) || 0)
    + ((frame.axis?.y || 0) * (Number(coords.x) || 0))
    + ((frame.normal?.y || 0) * (Number(coords.normal) || 0)),
  z: (Number(anchor.z) || 0) - (Number(coords.y) || 0)
});

const getRuntimePlacementInFixedVerticalPlane = (
  placement = {},
  fixedPlacement = {},
  fixedMount = {},
  pivotWorld = null,
  deltaDegrees = 0
) => {
  if (!placement || !pivotWorld) return getRuntimePlacementAtAngle(placement, pivotWorld || {}, deltaDegrees);
  if (!placement.edge && !placement.isVertical) return getRuntimePlacementAtAngle(placement, pivotWorld, deltaDegrees);

  const fixedFrame = getVerticalSurfaceFrame(fixedPlacement, fixedMount);
  const centerWorld = getPlacementSurfaceCenterWorld(placement, fixedMount);
  const centerPlane = getVerticalPlaneCoordinates(centerWorld, pivotWorld, fixedFrame);
  const rotatedCenterPlane = {
    ...rotatePoint(centerPlane, deltaDegrees),
    normal: centerPlane.normal
  };
  const runtimeCenterWorld = getWorldPointFromVerticalPlaneCoordinates(rotatedCenterPlane, pivotWorld, fixedFrame);
  const placementFrame = getVerticalSurfaceFrame(placement, fixedMount);
  return {
    ...placement,
    x: Number(((Number(runtimeCenterWorld.x) || 0)
      - (placementFrame.originOffset.x || 0)
      - (placementFrame.normal.x * placementFrame.surfaceOffset)).toFixed(6)),
    y: Number(((Number(runtimeCenterWorld.y) || 0)
      - (placementFrame.originOffset.y || 0)
      - (placementFrame.normal.y * placementFrame.surfaceOffset)).toFixed(6)),
    z: Number(((Number(runtimeCenterWorld.z) || 0) - 0.5 - placementFrame.baseLift).toFixed(6)),
    runtimeAngle: deltaDegrees,
    runtimeAxisAnchor: pivotWorld,
    runtimePivotWorld: pivotWorld,
    runtimeFixedComponentKey: fixedMount.componentKey,
    runtimeFixedMountId: fixedMount.id,
    runtimeAxisBindingMountId: fixedMount.id,
    runtimeAxisSocket: fixedMount.position || fixedMount.axisBinding?.socket,
    runtimeAxisSurface: fixedMount.surface || fixedMount.axisBinding?.surface || 'front',
    runtimeBaseRotation: placement.edge ? wallEdgeToRotation(placement.edge) : normalizeRotation(placement.rotation || 0),
    runtimeSurfaceRotation: deltaDegrees,
    runtimeBaseSurfaceRotation: getVerticalSurfaceBaseRotation(placement)
  };
};

export const getRuntimePlacementForFixedAxisAssemblyMember = ({
  placement = {},
  componentKey = '',
  fixedMount = {},
  fixedPlacement = null,
  pivotWorld = null,
  degrees = 0
} = {}) => {
  if (componentKey === fixedMount?.componentKey) {
    return getRuntimePlacementAroundFixedGear(placement, fixedMount, pivotWorld, degrees);
  }
  if (fixedPlacement?.edge || fixedPlacement?.isVertical) {
    return getRuntimePlacementInFixedVerticalPlane(placement, fixedPlacement, fixedMount, pivotWorld, degrees);
  }
  return {
    ...getRuntimePlacementAtAngle(placement, pivotWorld, degrees),
    runtimePivotWorld: pivotWorld,
    runtimeFixedComponentKey: fixedMount?.componentKey,
    runtimeFixedMountId: fixedMount?.id,
    runtimeAxisBindingMountId: fixedMount?.id,
    runtimeAxisSocket: fixedMount?.position || fixedMount?.axisBinding?.socket,
    runtimeAxisSurface: fixedMount?.surface || fixedMount?.axisBinding?.surface || 'front'
  };
};

export const getRuntimePlacementAroundFixedGear = (
  basePlacement = {},
  fixedMount = {},
  pivotWorld = null,
  deltaDegrees = 0
) => {
  const resolvedPivot = pivotWorld || getGearWorldPosition(basePlacement, fixedMount);
  if (!basePlacement || !fixedMount || !resolvedPivot) {
    return getRuntimePlacementAtAngle(basePlacement, resolvedPivot || {}, deltaDegrees);
  }

  const anchorSocket = fixedMount.axisBinding?.socket || fixedMount.position;
  const anchorLocal = fixedMount.localPosition || fixedMount.axisBinding?.localPosition || getGearMountLocalPosition(anchorSocket);
  const baseRotation = basePlacement.edge
    ? wallEdgeToRotation(basePlacement.edge)
    : normalizeRotation(basePlacement.rotation || 0);

  if (basePlacement.edge || basePlacement.isVertical) {
    const frame = getVerticalSurfaceFrame(basePlacement, fixedMount);
    const baseSurfaceRotation = getVerticalSurfaceBaseRotation(basePlacement);
    const surfaceRotation = Number(deltaDegrees) || 0;
    const rotatedAnchor = rotatePoint(anchorLocal, normalizeRotation(baseSurfaceRotation + surfaceRotation));
    return {
      ...basePlacement,
      x: Number(((Number(resolvedPivot.x) || 0)
        - (frame.originOffset.x || 0)
        - (frame.axis.x * (Number(rotatedAnchor.x) || 0))
        - (frame.normal.x * frame.surfaceOffset)).toFixed(6)),
      y: Number(((Number(resolvedPivot.y) || 0)
        - (frame.originOffset.y || 0)
        - (frame.axis.y * (Number(rotatedAnchor.x) || 0))
        - (frame.normal.y * frame.surfaceOffset)).toFixed(6)),
      z: Number(((Number(resolvedPivot.z) || 0) - 0.5 + (Number(rotatedAnchor.y) || 0) - frame.baseLift).toFixed(6)),
      rotation: frame.yaw,
      runtimeAngle: deltaDegrees,
      runtimeAxisAnchor: resolvedPivot,
      runtimePivotWorld: resolvedPivot,
      runtimeFixedComponentKey: fixedMount.componentKey,
      runtimeFixedMountId: fixedMount.id,
      runtimeAxisBindingMountId: fixedMount.id,
      runtimeAnchorLocal: anchorLocal,
      runtimeAxisSocket: anchorSocket,
      runtimeAxisSurface: fixedMount.surface || fixedMount.axisBinding?.surface || 'front',
      runtimeBaseRotation: baseRotation,
      runtimeSurfaceRotation: surfaceRotation,
      runtimeBaseSurfaceRotation: baseSurfaceRotation
    };
  }

  const boardAngle = normalizeRotation(baseRotation + deltaDegrees);
  const rotatedAnchor = rotatePoint(anchorLocal, boardAngle);

  return {
    ...basePlacement,
    x: Number(((Number(resolvedPivot.x) || 0) - rotatedAnchor.x).toFixed(6)),
    y: Number(((Number(resolvedPivot.y) || 0) - rotatedAnchor.y).toFixed(6)),
    z: basePlacement.z,
    rotation: boardAngle,
    runtimeAngle: deltaDegrees,
    runtimeAxisAnchor: resolvedPivot,
    runtimePivotWorld: resolvedPivot,
    runtimeFixedComponentKey: fixedMount.componentKey,
    runtimeFixedMountId: fixedMount.id,
    runtimeAxisBindingMountId: fixedMount.id,
    runtimeAnchorLocal: anchorLocal,
    runtimeAxisSocket: anchorSocket,
    runtimeAxisSurface: fixedMount.surface || fixedMount.axisBinding?.surface || 'front',
    runtimeBaseRotation: baseRotation,
    runtimeSurfaceRotation: Number(deltaDegrees) || 0,
    runtimeBaseSurfaceRotation: normalizeRotation(basePlacement.transmissionRotation ?? baseRotation)
  };
};

export const getAxisBindingForMount = ({
  mapData = {},
  mount = {},
  componentKey = '',
  placement = null,
  pivotWorld = null
} = {}) => (
  normalizeGearAxisBinding(mount.axisBinding)
  || createLegacyFixedAxisBinding({ mapData, mount, componentKey, placement, pivotWorld })
);

export const createSingleComponentAssembly = (componentKey = '') => ({
  id: `single_${componentKey}`,
  componentKeys: componentKey ? [componentKey] : [],
  edges: [],
  gearMounts: [],
  boundGearMounts: [],
  fixedAxes: [],
  warnings: []
});

const getAssemblyFromGraph = (assemblyGraph = null, componentKey = '') => {
  if (!assemblyGraph || !componentKey) return null;
  const assemblyId = assemblyGraph.assemblyByComponentKey?.[componentKey];
  if (assemblyId) {
    const assembly = (assemblyGraph.assemblies || []).find((item) => item.id === assemblyId);
    if (assembly) return assembly;
  }
  return (assemblyGraph.assemblies || []).find((assembly) => (
    (assembly?.componentKeys || []).includes(componentKey)
  )) || null;
};

const resolveAssemblyGraph = (mapData = {}, assemblyGraph = null) => (
  assemblyGraph?.assemblies ? assemblyGraph : buildMechanicalAssemblies(mapData)
);

const getAssemblyBasePlacements = (mapData = {}, assembly = null) => (
  (assembly?.componentKeys || []).reduce((placements, componentKey) => {
    const placement = getPlacementByComponentKey(mapData, componentKey);
    if (placement) placements[componentKey] = placement;
    return placements;
  }, {})
);

export const createAxisBindingRuntimeEntryFromGearNode = ({
  mapData = {},
  assemblyGraph = null,
  gearNode = null,
  axisBinding = null,
  pivotWorld = null,
  driveRatio = 1
} = {}) => {
  const binding = normalizeGearAxisBinding(axisBinding);
  if (!gearNode || !binding?.componentKey) return null;
  const boundPlacement = getPlacementByComponentKey(mapData, binding.componentKey);
  if (!boundPlacement) return null;
  const resolvedAssemblyGraph = resolveAssemblyGraph(mapData, assemblyGraph);
  const boundAssembly = getAssemblyFromGraph(resolvedAssemblyGraph, binding.componentKey)
    || createSingleComponentAssembly(binding.componentKey);
  const boundMount = {
    ...gearNode.mount,
    id: gearNode.mountId,
    componentKey: binding.componentKey,
    position: binding.socket,
    socketKind: getGearSocketKind(binding.socket),
    axisBinding: binding,
    cell: boundPlacement
      ? { x: boundPlacement.x, y: boundPlacement.y, z: boundPlacement.z }
      : null
  };
  const basePlacements = getAssemblyBasePlacements(mapData, boundAssembly);
  basePlacements[binding.componentKey] = boundPlacement;
  return {
    assembly: boundAssembly,
    componentKey: binding.componentKey,
    axisBinding: binding,
    fixedAxis: boundMount,
    fixedMount: boundMount,
    pivotWorld,
    anchor: pivotWorld,
    anchorLocal: getGearMountLocalPosition(binding.socket),
    basePlacement: boundPlacement,
    basePlacements,
    baseRotation: boundPlacement?.edge ? 0 : (Number(boundPlacement?.rotation) || 0),
    driveRatio: Number(driveRatio) || 1,
    phase: Number(gearNode.mount?.phase) || 0,
    sourceGearComponentKey: gearNode.componentKey,
    sourceGearMountId: gearNode.mountId
  };
};

export const createRackTranslationRuntimeEntryFromContact = ({
  mapData = {},
  assemblyGraph = null,
  rack = null,
  contact = null,
  sourceContacts = [],
  driveConflict = null,
  bindingStatus = null
} = {}) => {
  if (!rack?.id || !contact?.node) return null;
  const status = bindingStatus || getRackAxisBindingStatus({ mapData, rack });
  const binding = status.valid ? status.binding : null;
  const boundPlacement = binding?.componentKey
    ? getPlacementByComponentKey(mapData, binding.componentKey)
    : null;
  const resolvedAssemblyGraph = resolveAssemblyGraph(mapData, assemblyGraph);
  const boundAssembly = binding?.componentKey
    ? getAssemblyFromGraph(resolvedAssemblyGraph, binding.componentKey) || createSingleComponentAssembly(binding.componentKey)
    : {
      id: `rack_free_${rack.id}`,
      componentKeys: [],
      edges: [],
      gearMounts: [],
      boundGearMounts: [],
      fixedAxes: [],
      warnings: []
    };
  const basePlacements = binding?.componentKey
    ? getAssemblyBasePlacements(mapData, boundAssembly)
    : {};
  if (binding?.componentKey && boundPlacement) basePlacements[binding.componentKey] = boundPlacement;
  const contactSideSign = Number(contact.sideSign) < 0 ? -1 : 1;
  const gearDriveRatio = Number(contact.node.driveRatio) || 1;
  const pitchRadiusWorld = Math.max(
    0.001,
    Number(contact.node.pitchRadiusWorld ?? contact.node.pitchRadius) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  const rackSegment = getRackCanonicalSegment(rack);
  const contactDriveSign = getRackContactDriveSign(rackSegment, contactSideSign);
  const sourceContactTravelLimits = (Array.isArray(sourceContacts) && sourceContacts.length > 0 ? sourceContacts : [contact])
    .map((sourceContact) => {
      const limits = getRackContactTravelLimits(rack, sourceContact.rackAxis);
      if (!limits) return null;
      return {
        ...limits,
        contactRackAxis: Number(sourceContact.rackAxis) || 0,
        sourceGearNodeId: sourceContact.node?.id || null,
        sourceGearComponentKey: sourceContact.node?.componentKey || null,
        sourceGearMountId: sourceContact.node?.mountId || null
      };
    })
    .filter(Boolean);
  return {
    motionType: RACK_TRANSLATION_MOTION_TYPE,
    assembly: boundAssembly,
    componentKey: binding?.componentKey || null,
    axisBinding: binding,
    rack,
    rackId: rack.id,
    sourceRackId: rack.id,
    translationAxis: getRackAxisUnitVector(rack),
    basePlacements,
    basePlacement: boundPlacement,
    driveRatio: gearDriveRatio * contactDriveSign,
    pitchRadiusWorld,
    contactSideSign,
    contactRackAxis: Number(contact.rackAxis) || 0,
    contactPoint: contact.point || null,
    sourceContactTravelLimits,
    driveConflict,
    bindingCandidate: status.candidate || null,
    sourceGearNodeId: contact.node.id || null,
    sourceGearComponentKey: contact.node.componentKey,
    sourceGearMountId: contact.node.mountId
  };
};

const isRackDriveSourceContact = (rack = {}, contact = {}) => {
  const node = contact.node;
  if (!node?.id) return false;
  if (node.isDriveRoot) return true;
  if (node.sourceAssemblyDriveActive) return true;
  if (node.drivenViaRackId === rack.id) return false;
  if (!node.drivenViaRackId) return true;
  if (node.sourceAssemblyDriveActive === false) return false;
  return !isPassiveGearRotationDirection(node.mount?.rotationDirection);
};

export const createRackTranslationRuntimeEntries = ({
  mapData = {},
  assemblyGraph = null,
  nodes = []
} = {}) => {
  const drivenNodeIds = new Set((Array.isArray(nodes) ? nodes : []).map((node) => node.id));
  const entries = [];
  const seen = new Set();
  Object.values(mapData.racks || {}).forEach((rack) => {
    const contacts = getRackGearContacts(rack, nodes).filter((contact) => drivenNodeIds.has(contact.node.id));
    const driveContacts = contacts.filter((contact) => isRackDriveSourceContact(rack, contact));
    if (driveContacts.length <= 0) return;
    const status = getRackAxisBindingStatus({ mapData, rack });
    const preferredAxis = status.candidate?.point
      ? getRackAxisValueForPoint(rack, status.candidate.point)
      : null;
    const contact = driveContacts.reduce((best, item) => {
      const distance = Number.isFinite(preferredAxis) ? Math.abs((item.rackAxis || 0) - preferredAxis) : 0;
      return !best || distance < best.distance ? { item, distance } : best;
    }, null)?.item;
    const driveConflict = createRackDriveConflict(rack, driveContacts);
    const driveCoefficient = getRackContactDriveCoefficient(rack, contact);
    const sourceContacts = driveContacts.filter((item) => (
      Math.abs(getRackContactDriveCoefficient(rack, item) - driveCoefficient) <= RACK_CONTACT_TRAVEL_EPSILON
    ));
    const entry = createRackTranslationRuntimeEntryFromContact({
      mapData,
      assemblyGraph,
      rack,
      contact,
      sourceContacts,
      driveConflict,
      bindingStatus: status
    });
    if (!entry) return;
    const entryKey = `${entry.rackId}:${entry.componentKey || 'free'}`;
    if (seen.has(entryKey)) return;
    seen.add(entryKey);
    entries.push(entry);
  });
  return entries;
};

export const buildStaticCollisionBoxes = (mapData = {}, excludedComponentKeys = new Set()) => {
  const entries = [];
  Object.values(mapData.tiles || {}).forEach((tile) => {
    const componentKey = getPlacementKey(tile);
    if (excludedComponentKeys.has(componentKey)) return;
    const boxes = getCityChannelPlacementCollisionBoxes(tile);
    const prisms = getCityChannelPlacementCollisionPrisms(tile);
    if (boxes.length > 0) entries.push({ componentKey, placement: tile, boxes, prisms });
  });
  Object.values(mapData.walls || {}).forEach((wall) => {
    const componentKey = getPlacementKey(wall);
    if (excludedComponentKeys.has(componentKey)) return;
    const boxes = getCityChannelPlacementCollisionBoxes(wall);
    const prisms = getCityChannelPlacementCollisionPrisms(wall);
    if (boxes.length > 0) entries.push({ componentKey, placement: wall, boxes, prisms });
  });
  return entries;
};

const findBoxCollisions = (movingPlacement = null, movingPrisms = [], staticEntries = []) => {
  const collisions = [];
  for (const movingPrism of movingPrisms) {
    for (const entry of staticEntries) {
      if (isSupportCollisionExempt(movingPlacement, entry.placement)) continue;
      if ((entry.prisms || []).some((staticPrism) => collisionPrismsIntersect(movingPrism, staticPrism, 0.015))) {
        if (!collisions.some((collision) => collision.componentKey === entry.componentKey)) {
          collisions.push(entry);
        }
      }
    }
  }
  return collisions;
};

const findBoxCollision = (movingPlacement = null, movingPrisms = [], staticEntries = []) => {
  const collisions = findBoxCollisions(movingPlacement, movingPrisms, staticEntries);
  return collisions[0] || null;
};

const getVerticalRackCollisionPrisms = (rack = null, offset = {}) => {
  if (!rack) return [];
  const segment = getRackCanonicalSegment(rack);
  if (segment.plane !== RACK_PLANES.VERTICAL || segment.direction !== RACK_DIRECTIONS.Z) return [];
  const x = Number(segment.start?.x) || 0;
  const y = Number(segment.start?.y) || 0;
  const zOffset = Number(offset.z) || 0;
  const minZ = (Number(segment.min) || 0) + zOffset + FLOOR_PANEL_COLLISION_THICKNESS;
  const maxZ = (Number(segment.max) || 0) + zOffset;
  if (maxZ <= minZ + 0.001) return [];

  const halfSide = RACK_COLLISION_SIDE_HALF_WIDTH;
  const halfNormal = RACK_COLLISION_NORMAL_HALF_WIDTH;
  const bounds = segment.normalAxis === RACK_DIRECTIONS.X
    ? {
      minX: x - halfNormal,
      maxX: x + halfNormal,
      minY: y - halfSide,
      maxY: y + halfSide
    }
    : {
      minX: x - halfSide,
      maxX: x + halfSide,
      minY: y - halfNormal,
      maxY: y + halfNormal
    };

  return [createCollisionPrism({
    points: [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY }
    ],
    minZ,
    maxZ
  })];
};

const findRackBodyCollisions = (rack = null, offset = {}, staticEntries = []) => {
  const rackPrisms = getVerticalRackCollisionPrisms(rack, offset);
  if (rackPrisms.length <= 0) return [];
  return findBoxCollisions(
    { componentType: RACK_TRANSLATION_MOTION_TYPE, id: rack?.id },
    rackPrisms,
    staticEntries.filter((entry) => isFloorSupportPlacement(entry.placement))
  );
};

const getCollisionResult = ({ distance = null, angle = null, collisions = [], rackId = null } = {}) => {
  const obstacle = collisions[0] || null;
  if (!obstacle) return null;
  return {
    blocked: true,
    ...(angle !== null && angle !== undefined && Number.isFinite(Number(angle)) ? { angle } : {}),
    ...(distance !== null && distance !== undefined && Number.isFinite(Number(distance)) ? { distance } : {}),
    ...(rackId ? { rackId } : {}),
    obstacleKey: obstacle.componentKey,
    obstacle: obstacle.placement,
    obstacleKeys: collisions.map((collision) => collision.componentKey),
    obstacles: collisions.map((collision) => collision.placement)
  };
};

export const findRotationObstruction = ({
  mapData = {},
  assembly,
  anchor,
  fixedMount = null,
  targetAngle = 0,
  stepDegrees = ROTATION_COLLISION_STEP_DEGREES,
  excludedComponentKeys = new Set()
} = {}) => {
  const componentKeys = Array.isArray(assembly?.componentKeys) ? assembly.componentKeys : [];
  if (componentKeys.length <= 0 || !anchor || !targetAngle) return null;

  const movingKeys = new Set(componentKeys);
  const staticExcludedKeys = new Set([
    ...movingKeys,
    ...(excludedComponentKeys instanceof Set ? excludedComponentKeys : Array.from(excludedComponentKeys || []))
  ]);
  const movingEntries = componentKeys
    .map((componentKey) => ({
      componentKey,
      placement: getPlacementByComponentKey(mapData, componentKey)
    }))
    .filter((entry) => !!entry.placement);
  if (movingEntries.length <= 0) return null;

  const staticEntries = buildStaticCollisionBoxes(mapData, staticExcludedKeys);
  if (staticEntries.length <= 0) return null;

  const direction = targetAngle < 0 ? -1 : 1;
  const maxAngle = Math.abs(targetAngle);
  const step = Math.max(0.5, Math.abs(Number(stepDegrees) || ROTATION_COLLISION_STEP_DEGREES));
  const steps = Math.max(1, Math.ceil(maxAngle / step));

  for (let index = 1; index <= steps; index += 1) {
    const angle = direction * Math.min(maxAngle, index * step);
    const fixedPlacement = fixedMount?.componentKey
      ? getPlacementByComponentKey(mapData, fixedMount.componentKey)
      : null;
    for (const { componentKey, placement } of movingEntries) {
      const runtimePlacement = getRuntimePlacementForFixedAxisAssemblyMember({
        placement,
        componentKey,
        fixedMount,
        fixedPlacement,
        pivotWorld: anchor,
        degrees: angle
      });
      const movingPrisms = getCityChannelPlacementCollisionPrisms(runtimePlacement);
      const obstacle = findBoxCollision(runtimePlacement, movingPrisms, staticEntries);
      if (obstacle) {
        return {
          blocked: true,
          angle,
          obstacleKey: obstacle.componentKey,
          obstacle: obstacle.placement
        };
      }
    }
  }

  return null;
};

export const findRackTranslationObstruction = ({
  mapData = {},
  assembly,
  rack = null,
  translationAxis = { x: 1, y: 0, z: 0 },
  targetDistance = 0,
  stepDistance = TRANSLATION_COLLISION_STEP_WORLD,
  excludedComponentKeys = new Set()
} = {}) => {
  const componentKeys = Array.isArray(assembly?.componentKeys) ? assembly.componentKeys : [];
  const target = Number(targetDistance) || 0;
  const hasRackBody = !!rack;
  if ((componentKeys.length <= 0 && !hasRackBody) || Math.abs(target) <= 0.000001) return null;

  const movingKeys = new Set(componentKeys);
  const staticExcludedKeys = new Set([
    ...movingKeys,
    ...(excludedComponentKeys instanceof Set ? excludedComponentKeys : Array.from(excludedComponentKeys || []))
  ]);
  const movingEntries = componentKeys
    .map((componentKey) => ({
      componentKey,
      placement: getPlacementByComponentKey(mapData, componentKey)
    }))
    .filter((entry) => !!entry.placement);
  if (movingEntries.length <= 0 && !hasRackBody) return null;

  const staticEntries = buildStaticCollisionBoxes(mapData, staticExcludedKeys);
  if (staticEntries.length <= 0) return null;

  const direction = target < 0 ? -1 : 1;
  const maxDistance = Math.abs(target);
  const step = Math.max(0.01, Math.abs(Number(stepDistance) || TRANSLATION_COLLISION_STEP_WORLD));
  const steps = Math.max(1, Math.ceil(maxDistance / step));

  for (let index = 1; index <= steps; index += 1) {
    const distance = direction * Math.min(maxDistance, index * step);
    const offset = {
      x: (Number(translationAxis.x) || 0) * distance,
      y: (Number(translationAxis.y) || 0) * distance,
      z: (Number(translationAxis.z) || 0) * distance
    };
    for (const { placement } of movingEntries) {
      const runtimePlacement = getRuntimePlacementForRackTranslationAssemblyMember({
        placement,
        offset,
        entry: {
          motionType: RACK_TRANSLATION_MOTION_TYPE,
          driveRatio: 1,
          pitchRadiusWorld: 1
        }
      });
      const movingPrisms = getCityChannelPlacementCollisionPrisms(runtimePlacement);
      const obstacle = findBoxCollision(runtimePlacement, movingPrisms, staticEntries);
      if (obstacle) {
        return {
          blocked: true,
          distance,
          obstacleKey: obstacle.componentKey,
          obstacle: obstacle.placement
        };
      }
    }
    const rackCollisions = findRackBodyCollisions(rack, offset, staticEntries);
    if (rackCollisions.length > 0) {
      return getCollisionResult({
        distance,
        collisions: rackCollisions,
        rackId: rack.id
      });
    }
  }

  return null;
};

const createConflictPlacementTargets = (mapData = {}, sources = []) => {
  const obstacleMap = new Map();
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const componentKey = source.sourceGearComponentKey || source.componentKey;
    const placement = componentKey ? getPlacementByComponentKey(mapData, componentKey) : null;
    if (componentKey && placement) obstacleMap.set(componentKey, placement);
  });
  return {
    obstacleKeys: [...obstacleMap.keys()],
    obstacles: [...obstacleMap.values()],
    obstacle: [...obstacleMap.values()][0] || null
  };
};

const createConflictRackTargets = (mapData = {}, rackIds = []) => {
  const rackMap = new Map();
  (Array.isArray(rackIds) ? rackIds : [rackIds]).forEach((rackId) => {
    const rack = rackId ? mapData.racks?.[rackId] : null;
    if (rackId && rack) rackMap.set(rackId, rack);
  });
  return {
    rackIds: [...rackMap.keys()],
    racks: [...rackMap.values()],
    rack: [...rackMap.values()][0] || null
  };
};

const createConflictGearTargets = (sources = []) => {
  const gearMap = new Map();
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const componentKey = source.sourceGearComponentKey || source.componentKey;
    const nodeId = source.sourceGearNodeId || source.id || '';
    const parsedMountId = componentKey && nodeId.startsWith(`${componentKey}:`)
      ? nodeId.slice(componentKey.length + 1)
      : null;
    const mountId = source.sourceGearMountId || source.mountId || parsedMountId;
    if (!componentKey || !mountId) return;
    const gearKey = `${componentKey}:${mountId}`;
    gearMap.set(gearKey, {
      gearKey,
      componentKey,
      mountId,
      role: source.role || null,
      sourceGearNodeId: nodeId || null
    });
  });
  return {
    gearKeys: [...gearMap.keys()],
    gearTargets: [...gearMap.values()],
    gearTarget: [...gearMap.values()][0] || null
  };
};

const MECHANISM_CONFLICT_PRIORITY = {
  gearDriveConflict: 10,
  rackDriveConflict: 20,
  placementMotionConflict: 30,
  collisionBlock: 40
};

const sortMechanismConflicts = (conflicts = []) => (
  (Array.isArray(conflicts) ? conflicts : [])
    .map((conflict, index) => ({ conflict, index }))
    .sort((a, b) => {
      const leftPriority = MECHANISM_CONFLICT_PRIORITY[a.conflict?.type] ?? 1000;
      const rightPriority = MECHANISM_CONFLICT_PRIORITY[b.conflict?.type] ?? 1000;
      return leftPriority === rightPriority
        ? a.index - b.index
        : leftPriority - rightPriority;
    })
    .map(({ conflict }) => conflict)
);

const createMotionVector3 = (vector = {}, scale = 1) => ({
  x: roundRuntimeNumber((Number(vector.x) || 0) * scale),
  y: roundRuntimeNumber((Number(vector.y) || 0) * scale),
  z: roundRuntimeNumber((Number(vector.z) || 0) * scale)
});

const areMotionNumbersClose = (a = 0, b = 0) => (
  Math.abs((Number(a) || 0) - (Number(b) || 0)) <= RACK_CONTACT_TRAVEL_EPSILON
);

const areMotionVectorsClose = (a = {}, b = {}) => (
  areMotionNumbersClose(a.x, b.x)
  && areMotionNumbersClose(a.y, b.y)
  && areMotionNumbersClose(a.z, b.z)
);

const getMotionPoint = (point = null) => {
  if (!point) return null;
  return {
    x: roundRuntimeNumber(point.x),
    y: roundRuntimeNumber(point.y),
    z: roundRuntimeNumber(point.z)
  };
};

const getPlacementRotationPlaneKey = (mapData = {}, entry = {}) => {
  const fixedMount = entry.fixedMount || entry.fixedAxis;
  const fixedPlacement = fixedMount?.componentKey
    ? getPlacementByComponentKey(mapData, fixedMount.componentKey)
    : null;
  if (fixedPlacement?.edge) return `wall:${fixedPlacement.edge}`;
  if (fixedPlacement?.isVertical) {
    return `vertical:${normalizeRotation(fixedPlacement.rotation || 0)}:${fixedMount.surface || fixedMount.axisBinding?.surface || 'front'}`;
  }
  return 'horizontal:z';
};

const getPlacementRotationAnchor = (mapData = {}, entry = {}) => {
  if (entry.pivotWorld || entry.anchor) return entry.pivotWorld || entry.anchor;
  const fixedMount = entry.fixedMount || entry.fixedAxis;
  if (!fixedMount?.componentKey && !fixedMount?.cell) return null;
  return getFixedAxisWorldAnchor(mapData, fixedMount);
};

const createPlacementTranslationIntent = (componentKey = '', entry = {}) => {
  const pitchRadiusWorld = Math.max(
    0.001,
    Number(entry.pitchRadiusWorld ?? entry.rackPitchRadiusWorld) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  const travelCoefficient = (Number(entry.driveRatio) || 0) * pitchRadiusWorld;
  const translationPerSourceAngle = createMotionVector3(
    entry.translationAxis || getRackAxisUnitVector(entry.rack || {}),
    travelCoefficient
  );
  return {
    id: componentKey,
    kind: 'placement',
    motionType: 'rigidTranslation',
    componentKey,
    axis: entry.translationAxis,
    valuePerSourceAngle: Number(entry.driveRatio) || 0,
    translationPerSourceAngle,
    sourceIds: [entry.sourceGearNodeId].filter(Boolean),
    constraints: [{
      type: 'rackCarry',
      rackId: entry.rackId || entry.sourceRackId
    }],
    motionSignature: {
      type: 'rigidTranslation',
      translationPerSourceAngle
    }
  };
};

const createPlacementRotationIntent = (mapData = {}, componentKey = '', entry = {}) => {
  const fixedMount = entry.fixedMount || entry.fixedAxis;
  const anchor = getPlacementRotationAnchor(mapData, entry);
  const rotationPlaneKey = getPlacementRotationPlaneKey(mapData, entry);
  const angularPerSourceAngle = Number(entry.driveRatio) || 1;
  return {
    id: componentKey,
    kind: 'placement',
    motionType: 'rigidRotation',
    componentKey,
    valuePerSourceAngle: angularPerSourceAngle,
    angularPerSourceAngle,
    anchor: getMotionPoint(anchor),
    rotationPlaneKey,
    fixedAxisId: fixedMount?.id || null,
    sourceIds: [entry.sourceGearNodeId].filter(Boolean),
    constraints: [{
      type: 'axisBinding',
      fixedAxisId: fixedMount?.id || null
    }],
    motionSignature: {
      type: 'rigidRotation',
      angularPerSourceAngle,
      anchor: getMotionPoint(anchor),
      rotationPlaneKey,
      fixedAxisId: fixedMount?.id || null
    }
  };
};

const arePlacementMotionIntentsCompatible = (a = {}, b = {}) => {
  const left = a.motionSignature || a;
  const right = b.motionSignature || b;
  if (left.type !== right.type) return false;
  if (left.type === 'rigidTranslation') {
    return areMotionVectorsClose(left.translationPerSourceAngle, right.translationPerSourceAngle);
  }
  if (left.type === 'rigidRotation') {
    if (!areMotionNumbersClose(left.angularPerSourceAngle, right.angularPerSourceAngle)) return false;
    if ((left.rotationPlaneKey || '') !== (right.rotationPlaneKey || '')) return false;
    if (left.anchor && right.anchor) return areMotionVectorsClose(left.anchor, right.anchor);
    return !!left.fixedAxisId && left.fixedAxisId === right.fixedAxisId;
  }
  return (
    a.motionType === b.motionType
    && areMotionNumbersClose(a.valuePerSourceAngle, b.valuePerSourceAngle)
  );
};

export const createMechanismMotionIntentGraph = ({
  mapData = {},
  gearNodes = [],
  assemblyEntries = [],
  collisionBlocks = []
} = {}) => {
  const gears = (Array.isArray(gearNodes) ? gearNodes : []).map((node) => ({
    id: getGearNodeRuntimeId(node),
    kind: 'gear',
    motionType: 'rotation',
    componentKey: node.componentKey,
    mountId: node.mountId,
    valuePerSourceAngle: Number(node.driveRatio) || 0,
    sourceIds: [node.driveSourceNodeId || node.id].filter(Boolean),
    constraints: [
      ...(node.drivenByGearId ? [{
        type: node.drivenViaRackId ? 'rackPinion' : 'gearMesh',
        sourceGearNodeId: node.drivenByGearId,
        viaRackId: node.drivenViaRackId || null
      }] : [])
    ]
  }));
  const racks = [];
  const placements = [];
  (Array.isArray(assemblyEntries) ? assemblyEntries : []).forEach((entry) => {
    if (isRackTranslationRuntimeEntry(entry)) {
      racks.push({
        id: entry.rackId || entry.sourceRackId,
        kind: 'rack',
        motionType: 'translation',
        rackId: entry.rackId || entry.sourceRackId,
        axis: entry.translationAxis,
        valuePerSourceAngle: Number(entry.driveRatio) || 0,
        sourceIds: [entry.sourceGearNodeId].filter(Boolean),
        constraints: (entry.sourceContactTravelLimits || []).map((limit) => ({
          type: 'rackPinion',
          sourceGearNodeId: limit.sourceGearNodeId,
          sourceGearComponentKey: limit.sourceGearComponentKey,
          sourceGearMountId: limit.sourceGearMountId,
          contactRackAxis: limit.contactRackAxis
        }))
      });
      (entry.assembly?.componentKeys || []).forEach((componentKey) => {
        placements.push(createPlacementTranslationIntent(componentKey, entry));
      });
      return;
    }
    (entry.assembly?.componentKeys || []).forEach((componentKey) => {
      placements.push(createPlacementRotationIntent(mapData, componentKey, entry));
    });
  });
  const gearConflicts = (Array.isArray(gearNodes.driveConflicts) ? gearNodes.driveConflicts : [])
    .filter((conflict) => conflict?.type === 'gearDriveConflict')
    .map((conflict) => ({
      ...conflict,
      ...createConflictPlacementTargets(mapData, conflict.sources),
      ...createConflictGearTargets(conflict.sources),
      ...createConflictRackTargets(mapData, conflict.viaRackId ? [conflict.viaRackId] : [])
    }));
  const rackConflicts = (Array.isArray(assemblyEntries) ? assemblyEntries : [])
    .map((entry) => {
      if (!isRackTranslationRuntimeEntry(entry) || !entry.driveConflict?.blocked) return null;
      const rackId = entry.rackId || entry.sourceRackId;
      return {
        blocked: true,
        type: 'rackDriveConflict',
        rackId,
        conflictSources: entry.driveConflict.sources || [],
        ...createConflictPlacementTargets(mapData, entry.driveConflict.sources),
        ...createConflictGearTargets(entry.driveConflict.sources),
        ...createConflictRackTargets(mapData, [rackId])
      };
    })
    .filter(Boolean);
  const placementConflicts = [];
  const placementsById = new Map();
  placements.forEach((placement) => {
    if (!placement.id) return;
    const group = placementsById.get(placement.id) || [];
    group.push(placement);
    placementsById.set(placement.id, group);
  });
  placementsById.forEach((group, componentKey) => {
    if (group.length <= 1) return;
    const reference = group[0];
    const hasConflict = group.some((placement) => (
      !arePlacementMotionIntentsCompatible(reference, placement)
    ));
    if (!hasConflict) return;
    const placement = getPlacementByComponentKey(mapData, componentKey);
    placementConflicts.push({
      blocked: true,
      type: 'placementMotionConflict',
      componentKey,
      intents: group,
      obstacleKey: placement ? componentKey : null,
      obstacle: placement,
      obstacleKeys: placement ? [componentKey] : [],
      obstacles: placement ? [placement] : []
    });
  });
  const collisionConflicts = (Array.isArray(collisionBlocks) ? collisionBlocks : [])
    .filter((block) => block?.blocked)
    .map((block) => ({
      ...block,
      type: block.type || 'collisionBlock',
      ...createConflictRackTargets(mapData, block.rackIds || [block.rackId])
    }));
  return {
    gears,
    racks,
    placements,
    conflicts: sortMechanismConflicts([
      ...gearConflicts,
      ...rackConflicts,
      ...placementConflicts,
      ...collisionConflicts
    ])
  };
};

export const findMechanismMotionObstructions = ({
  mapData = {},
  assemblyEntries = [],
  targetAngle = 0
} = {}) => {
  const sourceTargetAngle = Number(targetAngle) || 0;
  if (Math.abs(sourceTargetAngle) <= 0.000001) return [];
  return (Array.isArray(assemblyEntries) ? assemblyEntries : [])
    .map((entry) => {
      if (isRackTranslationRuntimeEntry(entry)) {
        const targetDistance = getRackContactLimitedTranslationDistance(entry, sourceTargetAngle);
        const obstruction = findRackTranslationObstruction({
          mapData,
          assembly: entry.assembly,
          rack: entry.rack || mapData.racks?.[entry.rackId || entry.sourceRackId] || null,
          translationAxis: entry.translationAxis,
          targetDistance
        });
        if (!obstruction) return null;
        const distancePerSourceAngle = Math.abs(sourceTargetAngle) > 0.000001
          ? targetDistance / sourceTargetAngle
          : 0;
        const sourceAngle = Math.abs(distancePerSourceAngle) > 0.000001
          ? obstruction.distance / distancePerSourceAngle
          : sourceTargetAngle;
        return {
          ...obstruction,
          blocked: true,
          type: 'collisionBlock',
          collisionMotionType: RACK_TRANSLATION_MOTION_TYPE,
          assemblyId: entry.assembly?.id,
          rackId: entry.rackId || entry.sourceRackId,
          linearDistance: obstruction.distance,
          sourceAngle,
          angle: sourceAngle
        };
      }
      const driveRatio = Number(entry.driveRatio) || 1;
      const obstruction = findRotationObstruction({
        mapData,
        assembly: entry.assembly,
        anchor: entry.anchor,
        fixedMount: entry.fixedMount,
        targetAngle: sourceTargetAngle * driveRatio
      });
      if (!obstruction) return null;
      const sourceAngle = obstruction.angle / driveRatio;
      return {
        ...obstruction,
        blocked: true,
        type: 'collisionBlock',
        collisionMotionType: 'rotation',
        assemblyId: entry.assembly?.id,
        fixedAxisId: entry.fixedAxis?.id,
        assemblyAngle: obstruction.angle,
        sourceAngle,
        angle: sourceAngle
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(a.sourceAngle) - Math.abs(b.sourceAngle));
};

export const getAllowedRotationAngle = ({
  targetAngle = 0,
  obstruction = null,
  minimumDegrees = MIN_MEANINGFUL_ROTATION_DEGREES
} = {}) => {
  const target = Number(targetAngle) || 0;
  if (!obstruction?.blocked) {
    return {
      canRotate: Math.abs(target) > 0.001,
      angle: target,
      obstruction: null,
      blockedBeforeMinimum: false
    };
  }
  const sign = target < 0 ? -1 : 1;
  const allowed = sign * Math.min(Math.abs(target), Math.abs(Number(obstruction.angle) || 0));
  const minimum = Math.max(0, Number(minimumDegrees) || 0);
  return {
    canRotate: Math.abs(allowed) >= minimum,
    angle: allowed,
    obstruction,
    blockedBeforeMinimum: Math.abs(allowed) < minimum
  };
};

export const getAngleErrorDegrees = (expected = 0, actual = 0) => {
  const delta = normalizeDegrees((Number(actual) || 0) - (Number(expected) || 0));
  return Math.min(delta, 360 - delta);
};

export const validateFixedAxisSync = ({
  gearAngle = 0,
  assemblyAngle = 0,
  tolerance = FIXED_AXIS_SYNC_TOLERANCE_DEGREES
} = {}) => {
  const error = getAngleErrorDegrees(gearAngle, assemblyAngle);
  return {
    ok: error <= tolerance,
    error,
    tolerance
  };
};

const getGearNodeRuntimeId = (node = {}) => (
  node.id || (node.componentKey && node.mountId ? `${node.componentKey}:${node.mountId}` : null)
);

const isRackSourceGearNode = (entry = {}, node = {}) => (
  !!node
  && (
    (!!entry.sourceGearNodeId && getGearNodeRuntimeId(node) === entry.sourceGearNodeId)
    || (
      !!entry.sourceGearComponentKey
      && !!entry.sourceGearMountId
      && node.componentKey === entry.sourceGearComponentKey
      && node.mountId === entry.sourceGearMountId
    )
  )
);

const createGearRuntimeState = ({
  node = {},
  phase = 0,
  speedRatio = null,
  axisBindingOverride = undefined
} = {}) => {
  const axisBinding = axisBindingOverride !== undefined
    ? axisBindingOverride
    : node.axisBindingSuppressed
      ? null
      : normalizeGearAxisBinding(node.mount?.axisBinding);
  const resolvedSpeedRatio = Number.isFinite(Number(speedRatio))
    ? Number(speedRatio)
    : Number(node.driveRatio) || 1;
  return {
    componentKey: node.componentKey,
    mountId: node.mountId,
    axisType: axisBinding ? 'bound' : (node.mount?.axisType || node.axisType || 'freeAxis'),
    socketKind: getGearSocketKind(node.mount?.position),
    axisBinding,
    phase,
    speedRatio: resolvedSpeedRatio,
    torqueRatio: getGearTorqueRatio(resolvedSpeedRatio),
    teeth: getGearTeeth(node.mount)
  };
};

const createRackDrivenGearRuntimeState = ({
  entry = {},
  contact = {},
  linearDistance = 0,
  sourceAngle = 0,
  basePhases = new Map()
} = {}) => {
  const node = contact.node;
  const rack = entry.rack || contact.rack;
  if (!node || !rack || isRackSourceGearNode(entry, node)) return null;
  const engagedDistance = getRackTravelEngagementDistance(rack, contact.rackAxis, linearDistance);
  if (Math.abs(engagedDistance) <= RACK_CONTACT_TRAVEL_EPSILON) return null;
  const rackSegment = getRackCanonicalSegment(rack);
  const pitchRadius = Math.max(
    0.001,
    Number(node.pitchRadiusWorld ?? node.rackPitchRadiusWorld ?? node.pitchRadius) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  const gearAngle = (engagedDistance * getRackContactDriveSign(rackSegment, contact.sideSign) * 180) / (Math.PI * pitchRadius);
  const basePhase = basePhases.get(node.id) || 0;
  const speedRatio = Math.abs(Number(sourceAngle) || 0) > RACK_CONTACT_TRAVEL_EPSILON
    ? gearAngle / sourceAngle
    : 0;
  return createGearRuntimeState({
    node,
    phase: normalizeRotation(basePhase + gearAngle),
    speedRatio,
    axisBindingOverride: null
  });
};

const propagateRackDrivenGearMeshStates = ({
  rackDrivenGearStates = new Map(),
  nodes = [],
  sourceAngle = 0,
  basePhases = new Map(),
  blockedRootIds = new Set()
} = {}) => {
  if (!(rackDrivenGearStates instanceof Map) || rackDrivenGearStates.size <= 0) return rackDrivenGearStates;
  const nodeById = new Map(
    (Array.isArray(nodes) ? nodes : [])
      .map((node) => [getGearNodeRuntimeId(node), node])
      .filter(([id]) => !!id)
  );
  if (nodeById.size <= 0) return rackDrivenGearStates;
  const meshGraph = buildGearContactGraph([...nodeById.values()], undefined, []);
  const queue = Array.from(rackDrivenGearStates.keys());
  const maxSteps = Math.max(1, nodeById.size * nodeById.size);
  let steps = 0;
  while (queue.length > 0 && steps < maxSteps) {
    steps += 1;
    const currentId = queue.shift();
    const currentState = rackDrivenGearStates.get(currentId);
    const currentSpeedRatio = Number(currentState?.speedRatio) || 0;
    if (Math.abs(currentSpeedRatio) <= RACK_CONTACT_TRAVEL_EPSILON) continue;
    (meshGraph.get(currentId) || []).forEach((edge) => {
      const nextId = edge.id;
      if (!nextId || blockedRootIds.has(nextId)) return;
      const nextNode = nodeById.get(nextId);
      if (!nextNode) return;
      const nextSpeedRatio = currentSpeedRatio * (Number(edge.ratio) || -1);
      if (Math.abs(nextSpeedRatio) <= RACK_CONTACT_TRAVEL_EPSILON) return;
      const existing = rackDrivenGearStates.get(nextId);
      if (existing && Math.abs(Number(existing.speedRatio) || 0) >= Math.abs(nextSpeedRatio)) return;
      const basePhase = basePhases.get(nextId) || 0;
      rackDrivenGearStates.set(nextId, createGearRuntimeState({
        node: nextNode,
        phase: normalizeRotation(basePhase + ((Number(sourceAngle) || 0) * nextSpeedRatio)),
        speedRatio: nextSpeedRatio,
        axisBindingOverride: null
      }));
      queue.push(nextId);
    });
  }
  return rackDrivenGearStates;
};

const createRackDrivenAxisBindingRuntimeEntries = ({
  mapData = {},
  rackDrivenGearStates = new Map(),
  nodes = [],
  gearNodeById = new Map()
} = {}) => {
  if (!(rackDrivenGearStates instanceof Map) || rackDrivenGearStates.size <= 0) return [];
  const nodeById = new Map(
    (Array.isArray(nodes) ? nodes : [])
      .map((node) => [getGearNodeRuntimeId(node), node])
      .filter(([id]) => !!id)
  );
  if (nodeById.size <= 0) return [];
  const assemblyGraph = buildMechanicalAssemblies(mapData);
  const entries = [];
  const seen = new Set();
  rackDrivenGearStates.forEach((state, nodeId) => {
    if (gearNodeById.has(nodeId)) return;
    const node = nodeById.get(nodeId);
    if (!node || node.axisBindingSuppressed) return;
    const speedRatio = Number(state?.speedRatio) || 0;
    if (Math.abs(speedRatio) <= RACK_CONTACT_TRAVEL_EPSILON) return;
    const axisBinding = getAxisBindingForMount({
      mapData,
      mount: node.mount,
      componentKey: node.componentKey,
      placement: node.placement,
      pivotWorld: node.worldPoint
    });
    if (!axisBinding?.componentKey) return;
    const entry = createAxisBindingRuntimeEntryFromGearNode({
      mapData,
      assemblyGraph,
      gearNode: node,
      axisBinding,
      pivotWorld: node.worldPoint || getGearWorldPosition(node.placement, node.mount),
      driveRatio: speedRatio
    });
    if (!entry) return;
    const entryKey = `${entry.componentKey}:${entry.fixedMount?.id || node.mountId}:${nodeId}`;
    if (seen.has(entryKey)) return;
    seen.add(entryKey);
    rackDrivenGearStates.set(nodeId, createGearRuntimeState({
      node,
      phase: state.phase,
      speedRatio
    }));
    entries.push(entry);
  });
  return entries;
};

export const createMechanismRuntimeSnapshot = ({
  mapData = {},
  assemblyEntries = [],
  gearNodes = [],
  rackContactGearNodes = [],
  sourceAngle = 0,
  basePhases = new Map(),
  obstruction = null
} = {}) => {
  const placements = {};
  const racks = {};
  const sync = [];
  const gears = {};
  const gearNodeById = new Map((Array.isArray(gearNodes) ? gearNodes : []).map((node) => [node.id, node]));
  const rackDrivenGearStates = new Map();
  const blockedRackDrivenRootIds = new Set(
    (Array.isArray(gearNodes) ? gearNodes : [])
      .filter((node) => node?.isDriveRoot)
      .map((node) => getGearNodeRuntimeId(node))
      .filter(Boolean)
  );
  const contactGearNodes = Array.isArray(rackContactGearNodes) && rackContactGearNodes.length > 0
    ? rackContactGearNodes
    : gearNodes;
  const applyAxisBindingRuntimeEntry = (entry) => {
    const angle = (Number(entry.driveRatio) || 1) * sourceAngle;
    const fixedMount = entry.fixedMount || entry.fixedAxis;
    const anchor = entry.pivotWorld || entry.anchor || getFixedAxisWorldAnchor(mapData, fixedMount);
    const fixedPlacement = fixedMount?.componentKey
      ? (entry.basePlacements?.[fixedMount.componentKey] || getPlacementByComponentKey(mapData, fixedMount.componentKey))
      : null;
    (entry.assembly?.componentKeys || []).forEach((componentKey) => {
      const placement = entry.basePlacements?.[componentKey] || getPlacementByComponentKey(mapData, componentKey);
      if (!placement) return;
      placements[componentKey] = getRuntimePlacementForFixedAxisAssemblyMember({
        placement,
        componentKey,
        fixedMount,
        fixedPlacement,
        pivotWorld: anchor,
        degrees: angle
      });
    });
    sync.push({
      assemblyId: entry.assembly?.id,
      fixedAxisId: fixedMount?.id,
      axisBindingMountId: fixedMount?.id,
      componentKey: fixedMount?.componentKey,
      gearAngle: angle,
      assemblyAngle: angle,
      ...validateFixedAxisSync({ gearAngle: angle, assemblyAngle: angle })
    });
  };

  assemblyEntries.forEach((entry) => {
    if (isRackTranslationRuntimeEntry(entry)) {
      const linearDistance = getRackContactLimitedTranslationDistance(entry, sourceAngle);
      const translation = getRackTranslationOffset(entry, sourceAngle, { distance: linearDistance });
      (entry.assembly?.componentKeys || []).forEach((componentKey) => {
        const placement = entry.basePlacements?.[componentKey] || getPlacementByComponentKey(mapData, componentKey);
        if (!placement) return;
        placements[componentKey] = getRuntimePlacementForRackTranslationAssemblyMember({
          placement,
          entry,
          sourceAngle,
          offset: translation,
          linearDistance
        });
      });
      const rack = entry.rack || mapData.racks?.[entry.rackId || entry.sourceRackId];
      const rackId = entry.rackId || entry.sourceRackId || rack?.id;
      if (rack && rackId) {
        racks[rackId] = getRuntimeRackForTranslation({
          rack,
          entry,
          sourceAngle,
          offset: translation,
          linearDistance
        });
        const sweptRack = getSweptRackForTranslation(rack, linearDistance);
        getRackGearContacts(sweptRack, contactGearNodes).forEach((contact) => {
          const nodeId = getGearNodeRuntimeId(contact.node);
          if (!nodeId) return;
          const state = createRackDrivenGearRuntimeState({
            entry,
            contact,
            linearDistance,
            sourceAngle,
            basePhases
          });
          if (!state) return;
          const existing = rackDrivenGearStates.get(nodeId);
          if (existing && Math.abs(existing.speedRatio || 0) >= Math.abs(state.speedRatio || 0)) return;
          rackDrivenGearStates.set(nodeId, state);
        });
      }
      sync.push({
        assemblyId: entry.assembly?.id,
        motionType: RACK_TRANSLATION_MOTION_TYPE,
        rackId,
        componentKey: entry.componentKey || null,
        sourceGearComponentKey: entry.sourceGearComponentKey || null,
        sourceGearMountId: entry.sourceGearMountId || null,
        gearAngle: roundRuntimeNumber((linearDistance * 180) / (Math.PI * Math.max(0.001, Number(entry.pitchRadiusWorld) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD))),
        linearDistance: roundRuntimeNumber(linearDistance),
        ok: true,
        error: 0,
        tolerance: 0
      });
      return;
    }
    applyAxisBindingRuntimeEntry(entry);
  });

  gearNodes.forEach((node) => {
    const basePhase = basePhases.get(node.id) || 0;
    const phase = normalizeRotation(basePhase + ((Number(node.driveRatio) || 1) * sourceAngle));
    gears[node.id] = createGearRuntimeState({
      node,
      phase,
      speedRatio: Number(node.driveRatio) || 1
    });
  });
  propagateRackDrivenGearMeshStates({
    rackDrivenGearStates,
    nodes: contactGearNodes,
    sourceAngle,
    basePhases,
    blockedRootIds: blockedRackDrivenRootIds
  });
  createRackDrivenAxisBindingRuntimeEntries({
    mapData,
    rackDrivenGearStates,
    nodes: contactGearNodes,
    gearNodeById
  }).forEach(applyAxisBindingRuntimeEntry);
  rackDrivenGearStates.forEach((state, nodeId) => {
    const drivenNode = gearNodeById.get(nodeId);
    if (drivenNode?.isDriveRoot) return;
    gears[nodeId] = state;
  });

  return {
    sourceAngle,
    placements,
    racks,
    gears,
    sync,
    obstruction
  };
};
