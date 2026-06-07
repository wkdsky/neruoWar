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
  RACK_DIRECTIONS
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
const VERTICAL_PANEL_BASE_LIFT_WORLD = 4 / 62;
const VERTICAL_PANEL_SURFACE_OFFSET_WORLD = 0.06;

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

export const getRackTranslationDistance = (entry = {}, sourceAngle = 0) => {
  const angle = (Number(entry.driveRatio) || 1) * (Number(sourceAngle) || 0);
  const radius = Math.max(
    0.001,
    Number(entry.pitchRadiusWorld ?? entry.rackPitchRadiusWorld) || CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD
  );
  return (angle * Math.PI * radius) / 180;
};

export const getRackTranslationOffset = (entry = {}, sourceAngle = 0) => {
  const axis = entry.translationAxis || getRackAxisUnitVector(entry.rack || {});
  const distance = getRackTranslationDistance(entry, sourceAngle);
  return {
    x: roundRuntimeNumber((Number(axis.x) || 0) * distance),
    y: roundRuntimeNumber((Number(axis.y) || 0) * distance),
    z: roundRuntimeNumber((Number(axis.z) || 0) * distance)
  };
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
  offset = null
} = {}) => {
  const translation = offset || getRackTranslationOffset(entry, sourceAngle);
  const linearDistance = getRackTranslationDistance(entry, sourceAngle);
  return {
    ...placement,
    x: roundRuntimeNumber((Number(placement.x) || 0) + (Number(translation.x) || 0)),
    y: roundRuntimeNumber((Number(placement.y) || 0) + (Number(translation.y) || 0)),
    z: roundRuntimeNumber((Number(placement.z) || 0) + (Number(translation.z) || 0)),
    runtimeMotionType: RACK_TRANSLATION_MOTION_TYPE,
    runtimeRackId: entry.rackId || entry.sourceRackId || entry.rack?.id || null,
    runtimeTranslation: translation,
    runtimeLinearDistance: roundRuntimeNumber(linearDistance),
    runtimeSourceGearComponentKey: entry.sourceGearComponentKey || null,
    runtimeSourceGearMountId: entry.sourceGearMountId || null
  };
};

export const getRuntimeRackForTranslation = ({
  rack = {},
  entry = {},
  sourceAngle = 0,
  offset = null
} = {}) => {
  const translation = offset || getRackTranslationOffset(entry, sourceAngle);
  const linearDistance = getRackTranslationDistance(entry, sourceAngle);
  return {
    ...rack,
    start: translateRuntimePoint(rack.start || {}, translation),
    end: translateRuntimePoint(rack.end || {}, translation),
    z: roundRuntimeNumber((Number(rack.z) || 0) + (Number(translation.z) || 0)),
    runtimeMotionType: RACK_TRANSLATION_MOTION_TYPE,
    runtimeRackId: entry.rackId || entry.sourceRackId || rack.id || null,
    runtimeTranslation: translation,
    runtimeLinearDistance: roundRuntimeNumber(linearDistance),
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

const getVerticalSurfaceRuntimeRotation = (placement = {}) => (
  Number.isFinite(Number(placement.runtimeSurfaceRotation))
    ? Number(placement.runtimeSurfaceRotation)
    : 0
);

const getVerticalSurfaceLocalRotation = (placement = {}) => normalizeRotation(
  getVerticalSurfaceBaseRotation(placement) + getVerticalSurfaceRuntimeRotation(placement)
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

  const rotation = normalizeRotation(placement.rotation || 0);
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

const getGearScreenPitchRadius = (node = {}) => Number(node.pitchRadius) || Number(node.pitchRadiusWorld) || 1;

const getGearRatioRadius = (node = {}) => Number(node.gearRatioRadius ?? node.pitchRadiusWorld ?? node.pitchRadius) || 1;

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
      const sameSurface = a.surfaceKey === b.surfaceKey;
      if (!sameSurface && areOppositeSidesOfSamePlane(a, b)) continue;
      const meshPlaneDistance = getGearMeshPlaneDistance(a, b);
      if ((a.meshPlane || b.meshPlane) && meshPlaneDistance === null) continue;
      const aPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(a) : (a.point || getGearContactPoint(a));
      const bPoint = meshPlaneDistance !== null || sameSurface ? getGearContactPoint(b) : (b.point || getGearContactPoint(b));
      if (meshPlaneDistance === null && sameSurface && Math.abs((Number(aPoint.z) || 0) - (Number(bPoint.z) || 0)) > 0.08) continue;
      const distance = meshPlaneDistance ?? Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y);
      const aRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(a) : getGearScreenPitchRadius(a);
      const bRadius = meshPlaneDistance !== null || sameSurface ? getGearPitchRadius(b) : getGearScreenPitchRadius(b);
      const pitchContact = aRadius + bRadius;
      const contactDistance = meshPlaneDistance !== null || sameSurface
        ? pitchContact * 1.22
        : Math.max(pitchContact * 1.22, Math.min(threshold, pitchContact * 1.22));
      if (distance > contactDistance) continue;
      if (distance < Math.max(pitchContact * 0.28, 0.08)) continue;
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
  if (isPassiveGearRotationDirection(node?.mount?.rotationDirection)) return false;
  const binding = normalizeGearAxisBinding(node?.mount?.axisBinding);
  if (!binding?.componentKey) return false;
  return !node?.axisBindingSuppressed;
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

export const resolveDrivenGearNodes = ({
  assembly,
  assemblyNodes = [],
  allNodes = [],
  contactGraph = null,
  sourceComponentKey = ''
} = {}) => {
  if (assemblyNodes.length <= 0) return [];
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const graph = contactGraph || buildGearContactGraph(allNodes);
  const roots = getDrivenGearRoots(assembly, assemblyNodes, sourceComponentKey);
  if (roots.length <= 0) return [];
  const visited = new Set();
  roots.forEach((root) => {
    if (!root?.id || visited.has(root.id)) return;
    const liveRoot = byId.get(root.id);
    if (!liveRoot) return;
    const rootDirection = getGearRotationDirectionSign(liveRoot.mount?.rotationDirection) || 1;
    liveRoot.driveRatio = rootDirection;
    liveRoot.direction = rootDirection;
    liveRoot.isDriveRoot = true;
    liveRoot.drivenByGearId = null;
    liveRoot.drivenByComponentKey = null;
    liveRoot.drivenByMountId = null;
    visited.add(root.id);
    const queue = [root.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      const current = byId.get(currentId);
      (graph.get(currentId) || []).forEach((edge) => {
        const nextId = edge.id;
        if (visited.has(nextId)) return;
        const next = byId.get(nextId);
        if (!next || !current) return;
        next.driveRatio = (current.driveRatio || 1) * (edge.ratio || -1);
        next.direction = next.driveRatio >= 0 ? 1 : -1;
        next.isDriveRoot = false;
        next.drivenByGearId = current.id;
        next.drivenByComponentKey = current.componentKey;
        next.drivenByMountId = current.mountId;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
  });
  const driven = allNodes.filter((node) => visited.has(node.id));
  driven.forEach((node) => {
    node.axisBindingSuppressed = shouldSuppressDrivenAxisBinding(node, byId, assembly);
  });
  return driven.length > 0
    ? driven
    : assemblyNodes.map((node, index) => {
      const next = {
        ...node,
        driveRatio: index % 2 === 0 ? 1 : -1,
        direction: index % 2 === 0 ? 1 : -1,
        isDriveRoot: index === 0
      };
      return {
        ...next,
        axisBindingSuppressed: shouldSuppressDrivenAxisBinding(next, byId, assembly)
      };
    });
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
    driveRatio: -gearDriveRatio * contactSideSign,
    pitchRadiusWorld,
    contactSideSign,
    contactRackAxis: Number(contact.rackAxis) || 0,
    contactPoint: contact.point || null,
    bindingCandidate: status.candidate || null,
    sourceGearComponentKey: contact.node.componentKey,
    sourceGearMountId: contact.node.mountId
  };
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
    if (contacts.length <= 0) return;
    const status = getRackAxisBindingStatus({ mapData, rack });
    const preferredAxis = status.candidate?.point
      ? getRackAxisValueForPoint(rack, status.candidate.point)
      : null;
    const contact = contacts.reduce((best, item) => {
      const distance = Number.isFinite(preferredAxis) ? Math.abs((item.rackAxis || 0) - preferredAxis) : 0;
      return !best || distance < best.distance ? { item, distance } : best;
    }, null)?.item;
    const entry = createRackTranslationRuntimeEntryFromContact({
      mapData,
      assemblyGraph,
      rack,
      contact,
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

const findBoxCollision = (movingPlacement = null, movingPrisms = [], staticEntries = []) => {
  for (const movingPrism of movingPrisms) {
    for (const entry of staticEntries) {
      if (isSupportCollisionExempt(movingPlacement, entry.placement)) continue;
      if ((entry.prisms || []).some((staticPrism) => collisionPrismsIntersect(movingPrism, staticPrism, 0.015))) {
        return entry;
      }
    }
  }
  return null;
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
  translationAxis = { x: 1, y: 0, z: 0 },
  targetDistance = 0,
  stepDistance = TRANSLATION_COLLISION_STEP_WORLD,
  excludedComponentKeys = new Set()
} = {}) => {
  const componentKeys = Array.isArray(assembly?.componentKeys) ? assembly.componentKeys : [];
  const target = Number(targetDistance) || 0;
  if (componentKeys.length <= 0 || Math.abs(target) <= 0.000001) return null;

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
  }

  return null;
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

export const createMechanismRuntimeSnapshot = ({
  mapData = {},
  assemblyEntries = [],
  gearNodes = [],
  sourceAngle = 0,
  basePhases = new Map(),
  obstruction = null
} = {}) => {
  const placements = {};
  const racks = {};
  const sync = [];

  assemblyEntries.forEach((entry) => {
    if (isRackTranslationRuntimeEntry(entry)) {
      const translation = getRackTranslationOffset(entry, sourceAngle);
      const linearDistance = getRackTranslationDistance(entry, sourceAngle);
      (entry.assembly?.componentKeys || []).forEach((componentKey) => {
        const placement = entry.basePlacements?.[componentKey] || getPlacementByComponentKey(mapData, componentKey);
        if (!placement) return;
        placements[componentKey] = getRuntimePlacementForRackTranslationAssemblyMember({
          placement,
          entry,
          sourceAngle,
          offset: translation
        });
      });
      const rack = entry.rack || mapData.racks?.[entry.rackId || entry.sourceRackId];
      const rackId = entry.rackId || entry.sourceRackId || rack?.id;
      if (rack && rackId) {
        racks[rackId] = getRuntimeRackForTranslation({
          rack,
          entry,
          sourceAngle,
          offset: translation
        });
      }
      sync.push({
        assemblyId: entry.assembly?.id,
        motionType: RACK_TRANSLATION_MOTION_TYPE,
        rackId,
        componentKey: entry.componentKey || null,
        sourceGearComponentKey: entry.sourceGearComponentKey || null,
        sourceGearMountId: entry.sourceGearMountId || null,
        gearAngle: (Number(entry.driveRatio) || 1) * sourceAngle,
        linearDistance: roundRuntimeNumber(linearDistance),
        ok: true,
        error: 0,
        tolerance: 0
      });
      return;
    }
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
  });

  const gears = {};
  gearNodes.forEach((node) => {
    const basePhase = basePhases.get(node.id) || 0;
    const phase = normalizeRotation(basePhase + ((Number(node.driveRatio) || 1) * sourceAngle));
    const axisBinding = node.axisBindingSuppressed
      ? null
      : normalizeGearAxisBinding(node.mount?.axisBinding);
    gears[node.id] = {
      componentKey: node.componentKey,
      mountId: node.mountId,
      axisType: axisBinding ? 'bound' : (node.mount?.axisType || node.axisType || 'freeAxis'),
      socketKind: getGearSocketKind(node.mount?.position),
      axisBinding,
      phase,
      speedRatio: Number(node.driveRatio) || 1,
      torqueRatio: getGearTorqueRatio(node.driveRatio),
      teeth: getGearTeeth(node.mount)
    };
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
