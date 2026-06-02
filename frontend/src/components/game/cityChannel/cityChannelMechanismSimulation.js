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
  createLegacyFixedAxisBinding,
  getGearMountLocalPosition,
  getGearSocketKind,
  normalizeGearAxisBinding
} from './cityChannelMechanismRuntime';
import {
  getGearSurfaceNormalSignForPanel,
  getGearSurfaceOffsetSignForPanel,
  normalizeGearSurfaceForPanel
} from './cityChannelGearPressurePlateRender';

export const FIXED_AXIS_SYNC_TOLERANCE_DEGREES = 0.5;
export const ROTATION_COLLISION_STEP_DEGREES = 2;
export const MIN_MEANINGFUL_ROTATION_DEGREES = 12;
export const DEFAULT_GEAR_TEETH = 18;
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
  return {
    ...placement,
    x: Number(point.x.toFixed(4)),
    y: Number(point.y.toFixed(4)),
    z: placement.z,
    runtimeAngle: degrees,
    runtimeAxisAnchor: anchor,
    rotation: normalizeRotation(baseRotation + degrees)
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
    runtimeFixedMountId: fixedMount.id,
    runtimeAxisBindingMountId: fixedMount.id,
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
  return getRuntimePlacementAtAngle(placement, pivotWorld, degrees);
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
  const anchorLocal = getGearMountLocalPosition(anchorSocket);
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
      runtimeFixedMountId: fixedMount.id,
      runtimeAxisBindingMountId: fixedMount.id,
      runtimeAnchorLocal: anchorLocal,
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
    runtimeFixedMountId: fixedMount.id,
    runtimeAxisBindingMountId: fixedMount.id,
    runtimeAnchorLocal: anchorLocal,
    runtimeBaseRotation: baseRotation
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
  const boundAssembly = getAssemblyFromGraph(assemblyGraph, binding.componentKey)
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
  const sync = [];

  assemblyEntries.forEach((entry) => {
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
    gears[node.id] = {
      componentKey: node.componentKey,
      mountId: node.mountId,
      axisType: node.mount?.axisBinding ? 'bound' : (node.mount?.axisType || node.axisType || 'freeAxis'),
      socketKind: getGearSocketKind(node.mount?.position),
      axisBinding: normalizeGearAxisBinding(node.mount?.axisBinding),
      phase,
      speedRatio: Number(node.driveRatio) || 1,
      torqueRatio: getGearTorqueRatio(node.driveRatio),
      teeth: getGearTeeth(node.mount)
    };
  });

  return {
    sourceAngle,
    placements,
    gears,
    sync,
    obstruction
  };
};
