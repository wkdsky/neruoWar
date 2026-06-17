import { getCityChannelMaterial } from './cityChannelCatalog';
import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createWallKey,
  normalizeRotation,
  parseCellKey,
  wallEdgeToRotation
} from './cityChannelSchema';
import {
  getGearSurfaceOffsetSignForPanel,
  normalizeGearSurfaceForPanel
} from './cityChannelGearPressurePlateRender';

export const CITY_CHANNEL_TRIGGER_MECHANISM_TYPES = new Set([
  CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
]);

export const DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS = {
  rotationAngle: 180,
  rotationTurns: 0,
  rotationDirection: 'right',
  rotationSpeedDegPerSec: 90,
  triggerDelaySeconds: 0,
  autoReturn: false,
  autoReturnDelaySeconds: 0,
  durationSeconds: 1.5,
  verticalExtensionLength: 70,
  horizontalExtensionLength: 80
};

export const CITY_CHANNEL_MECHANISM_LIMITS = {
  rotationAngle: { min: 0, max: 360, step: 5 },
  rotationTurns: { min: 0, max: 30, step: 1 },
  rotationSpeedDegPerSec: { min: 15, max: 720, step: 15 },
  triggerDelaySeconds: { min: 0, max: 30, step: 0.5 },
  autoReturnDelaySeconds: { min: 0, max: 30, step: 0.5 },
  durationSeconds: { min: 0.5, max: 8, step: 0.5 },
  verticalExtensionLength: { min: 30, max: 140, step: 5 },
  horizontalExtensionLength: { min: 30, max: 160, step: 5 }
};

export const CITY_CHANNEL_MECHANISM_SPEED_STEPS = [
  15,
  30,
  60,
  90,
  120,
  180,
  240,
  360,
  540,
  720
];

export const CITY_CHANNEL_MECHANISM_KINDS = {
  GEAR_PRESSURE_PLATE: 'gearPressurePlate',
  FIXED_AXIS_ASSEMBLY: 'fixedAxisAssembly',
  TRANSMISSION_BOARD: 'transmissionBoard',
  ACTUATOR_BOARD: 'actuatorBoard'
};

const DIRECTIONS = ['north', 'east', 'south', 'west'];
export const CITY_CHANNEL_GEAR_CENTER_SOCKET = 'center';
export const CITY_CHANNEL_GEAR_CORNER_SOCKETS = new Set([
  'corner_ne',
  'corner_nw',
  'corner_se',
  'corner_sw'
]);

export const CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS = {
  CLOCKWISE: 'clockwise',
  COUNTERCLOCKWISE: 'counterclockwise',
  PASSIVE: 'passive'
};

export const DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION = CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE;

const directionVector = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 }
};

const edgeEndpointsByEdge = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};

const VERTICAL_PANEL_BASE_LIFT_WORLD = 4 / 62;
const VERTICAL_PANEL_SURFACE_OFFSET_WORLD = 0.06;

const oppositeDirection = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east'
};

const clampToStep = (value, { min, max, step }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const clamped = Math.max(min, Math.min(max, parsed));
  return Number((Math.round(clamped / step) * step).toFixed(2));
};

const clampMechanismSpeed = (value) => {
  const parsed = Number(value);
  const fallback = DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationSpeedDegPerSec;
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(
    CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.min,
    Math.min(CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec.max, parsed)
  );
  return CITY_CHANNEL_MECHANISM_SPEED_STEPS.reduce((best, step) => (
    Math.abs(step - clamped) < Math.abs(best - clamped) ? step : best
  ), CITY_CHANNEL_MECHANISM_SPEED_STEPS[0]);
};

const getNormalizedRotationAngleParts = (params = {}) => {
  const hasTurnParts = params.rotationTurns !== undefined || params.rotationAngleRemainder !== undefined;
  if (hasTurnParts) {
    return {
      rotationTurns: clampToStep(
        params.rotationTurns ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationTurns,
        CITY_CHANNEL_MECHANISM_LIMITS.rotationTurns
      ),
      rotationAngle: clampToStep(
        params.rotationAngleRemainder ?? params.rotationAngle ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationAngle,
        CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle
      )
    };
  }
  const legacyTotal = Math.max(
    0,
    Number(params.rotationAngle ?? params.angle ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationAngle) || 0
  );
  const turns = Math.floor(legacyTotal / 360);
  const remainder = legacyTotal - (turns * 360);
  return {
    rotationTurns: clampToStep(turns, CITY_CHANNEL_MECHANISM_LIMITS.rotationTurns),
    rotationAngle: clampToStep(remainder, CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle)
  };
};

export const getMechanismTotalRotationAngle = (params = {}) => (
  ((Number(params.rotationTurns) || 0) * 360) + (Number(params.rotationAngle) || 0)
);

export const formatMechanismRotationAngle = (params = {}) => {
  const turns = Math.max(0, Math.trunc(Number(params.rotationTurns) || 0));
  const angle = Math.max(0, Number(params.rotationAngle) || 0);
  if (turns <= 0) return `${angle}°`;
  return `${turns}圈${angle > 0 ? `${angle}°` : ''}`;
};

export const normalizeMechanismParams = (params = {}) => {
  const angleParts = getNormalizedRotationAngleParts(params);
  const normalized = {
    rotationAngle: angleParts.rotationAngle,
    rotationTurns: angleParts.rotationTurns,
    rotationDirection: params.rotationDirection === 'left' ? 'left' : 'right',
    rotationSpeedDegPerSec: clampMechanismSpeed(
      params.rotationSpeedDegPerSec ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationSpeedDegPerSec
    ),
    triggerDelaySeconds: clampToStep(
      params.triggerDelaySeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.triggerDelaySeconds,
      CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds
    ),
    autoReturn: !!params.autoReturn,
    autoReturnDelaySeconds: clampToStep(
      params.autoReturnDelaySeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.autoReturnDelaySeconds,
      CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds
    ),
    durationSeconds: clampToStep(
      params.durationSeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.durationSeconds,
      CITY_CHANNEL_MECHANISM_LIMITS.durationSeconds
    ),
    verticalExtensionLength: clampToStep(
      params.verticalExtensionLength ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.verticalExtensionLength,
      CITY_CHANNEL_MECHANISM_LIMITS.verticalExtensionLength
    ),
    horizontalExtensionLength: clampToStep(
      params.horizontalExtensionLength ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.horizontalExtensionLength,
      CITY_CHANNEL_MECHANISM_LIMITS.horizontalExtensionLength
    )
  };
  return {
    ...normalized,
    rotationTotalAngle: getMechanismTotalRotationAngle(normalized)
  };
};

export const normalizeGearRotationDirection = (direction = DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION) => {
  if (
    direction === CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE
    || direction === 'left'
    || direction === 'ccw'
  ) {
    return CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE;
  }
  if (
    direction === CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
    || direction === 'none'
    || direction === 'disabled'
  ) {
    return CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE;
  }
  return CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE;
};

export const getGearRotationDirectionSign = (direction = DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION) => {
  const normalized = normalizeGearRotationDirection(direction);
  if (normalized === CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE) return 0;
  return normalized === CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE ? -1 : 1;
};

export const isPassiveGearRotationDirection = (direction = DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION) => (
  normalizeGearRotationDirection(direction) === CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
);

export const isTriggerMechanismTile = (panelType) => CITY_CHANNEL_TRIGGER_MECHANISM_TYPES.has(panelType);

export const getMechanismTemplateKind = (panelType) => {
  if (panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE) return CITY_CHANNEL_MECHANISM_KINDS.GEAR_PRESSURE_PLATE;
  if (String(panelType || '').startsWith('transmission_')) return CITY_CHANNEL_MECHANISM_KINDS.TRANSMISSION_BOARD;
  if (String(panelType || '').startsWith('actuator_')) return CITY_CHANNEL_MECHANISM_KINDS.ACTUATOR_BOARD;
  return null;
};

export const getMechanismParamKey = (cell) => (
  cell ? createCellKey(cell.x, cell.y, cell.z) : ''
);

const rotateDirection = (direction, rotation = 0, flipped = false) => {
  let index = DIRECTIONS.indexOf(direction);
  if (index < 0) return direction;
  if (flipped) {
    if (direction === 'east') index = DIRECTIONS.indexOf('west');
    else if (direction === 'west') index = DIRECTIONS.indexOf('east');
  }
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  return DIRECTIONS[(index + steps) % 4];
};

const rotateLocalPosition = (position = {}, rotation = 0, flipped = false) => {
  let x = Number(position.x) || 0;
  let y = Number(position.y) || 0;
  if (flipped) x *= -1;
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  for (let index = 0; index < steps; index += 1) {
    const nextX = -y;
    y = x;
    x = nextX;
  }
  return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), z: Number(position.z) || 0 };
};

export const rotateGearLocalPosition = (position = {}, rotation = 0) => {
  const radians = (normalizeRotation(rotation || 0) * Math.PI) / 180;
  const x = Number(position.x) || 0;
  const y = Number(position.y) || 0;
  return {
    x: (x * Math.cos(radians)) - (y * Math.sin(radians)),
    y: (x * Math.sin(radians)) + (y * Math.cos(radians)),
    z: Number(position.z) || 0
  };
};

export const isCornerGearSocket = (position = '') => CITY_CHANNEL_GEAR_CORNER_SOCKETS.has(position);

export const isCenterGearSocket = (position = '') => position === CITY_CHANNEL_GEAR_CENTER_SOCKET;

export const getGearSocketKind = (position = '') => (isCornerGearSocket(position) ? 'corner' : 'center');

export const getWorldTransmissionPorts = (tile = {}, componentKey = '') => {
  const catalogPorts = getCityChannelMaterial(tile.panelType)?.transmissionSkeleton?.ports;
  const ports = Array.isArray(catalogPorts) && catalogPorts.length > 0
    ? catalogPorts
    : [];
  const baseRotation = tile.edge ? wallEdgeToRotation(tile.edge) : 0;
  const localRotation = normalizeRotation(
    (tile.transmissionRotation ?? tile.rotation ?? 0)
    + (Number(tile.runtimeSurfaceRotation) || 0)
  );
  const directionRotation = normalizeRotation(baseRotation + localRotation);
  return ports.map((port) => ({
    ...port,
    componentKey: componentKey || createCellKey(tile.x, tile.y, tile.z),
    worldDirection: rotateDirection(port.direction, directionRotation, false),
    worldLocalPosition: rotateLocalPosition(port.localPosition, localRotation, false)
  }));
};

export const getGearMountLocalPosition = (position = 'center') => {
  const lookup = {
    center: { x: 0, y: 0, z: 0 },
    corner_ne: { x: 0.5, y: -0.5, z: 0 },
    corner_nw: { x: -0.5, y: -0.5, z: 0 },
    corner_se: { x: 0.5, y: 0.5, z: 0 },
    corner_sw: { x: -0.5, y: 0.5, z: 0 }
  };
  return lookup[position] || lookup.center;
};

const getSurfaceRuntimeRotation = (placement = {}) => (
  Number.isFinite(Number(placement.runtimeSurfaceRotation))
    ? Number(placement.runtimeSurfaceRotation)
    : 0
);

const getHorizontalSurfaceBaseRotation = (placement = {}) => normalizeRotation(
  Number.isFinite(Number(placement.runtimeBaseSurfaceRotation))
    ? Number(placement.runtimeBaseSurfaceRotation)
    : (placement.transmissionRotation ?? placement.rotation ?? 0)
);

const getHorizontalSurfaceLocalRotation = (placement = {}) => normalizeRotation(
  getHorizontalSurfaceBaseRotation(placement) + getSurfaceRuntimeRotation(placement)
);

export const getHorizontalGearSocketWorldPosition = (placement = {}, socket = 'center') => {
  if (!placement || placement.edge || placement.isVertical) return null;
  const local = getGearMountLocalPosition(socket);
  const rotated = rotateGearLocalPosition(local, getHorizontalSurfaceLocalRotation(placement));
  return {
    x: (Number(placement.x) || 0) + rotated.x,
    y: (Number(placement.y) || 0) + rotated.y,
    z: Number(placement.z) || 0
  };
};

const getVerticalSurfaceFrame = (placement = {}, surface = 'front') => {
  if (placement.edge) {
    const endpoints = edgeEndpointsByEdge[placement.edge] || edgeEndpointsByEdge.north;
    const tangent = {
      x: (endpoints[1].x || 0) - (endpoints[0].x || 0),
      y: (endpoints[1].y || 0) - (endpoints[0].y || 0)
    };
    const length = Math.max(0.001, Math.hypot(tangent.x, tangent.y));
    const normal = directionVector[placement.edge] || directionVector.north;
    const sign = getGearSurfaceOffsetSignForPanel(placement.panelType, surface);
    return {
      axis: { x: tangent.x / length, y: tangent.y / length },
      normal: { x: normal.x || 0, y: normal.y || 0 },
      originOffset: {
        x: ((endpoints[0].x || 0) + (endpoints[1].x || 0)) * 0.5,
        y: ((endpoints[0].y || 0) + (endpoints[1].y || 0)) * 0.5
      },
      surfaceOffset: VERTICAL_PANEL_SURFACE_OFFSET_WORLD * sign,
      baseLift: 0
    };
  }
  const rotation = normalizeRotation(placement.rotation || 0);
  const axis = rotateGearLocalPosition({ x: 1, y: 0 }, rotation);
  const normal = rotateGearLocalPosition({ x: 0, y: 1 }, rotation);
  const sign = getGearSurfaceOffsetSignForPanel(placement.panelType, surface);
  return {
    axis,
    normal,
    originOffset: { x: 0, y: 0 },
    surfaceOffset: VERTICAL_PANEL_SURFACE_OFFSET_WORLD * sign,
    baseLift: VERTICAL_PANEL_BASE_LIFT_WORLD
  };
};

export const getGearSocketWorldPosition = (placement = {}, socket = 'center', surface = 'front') => {
  if (!placement) return null;
  if (!placement.edge && !placement.isVertical) {
    return getHorizontalGearSocketWorldPosition(placement, socket);
  }
  const localRotation = normalizeRotation(placement.transmissionRotation ?? 0);
  const local = rotateGearLocalPosition(getGearMountLocalPosition(socket), localRotation);
  const frame = getVerticalSurfaceFrame(placement, surface);
  return {
    x: (Number(placement.x) || 0)
      + (frame.originOffset.x || 0)
      + ((frame.axis.x || 0) * (Number(local.x) || 0))
      + ((frame.normal.x || 0) * frame.surfaceOffset),
    y: (Number(placement.y) || 0)
      + (frame.originOffset.y || 0)
      + ((frame.axis.y || 0) * (Number(local.x) || 0))
      + ((frame.normal.y || 0) * frame.surfaceOffset),
    z: (Number(placement.z) || 0) + 0.5 - (Number(local.y) || 0) + frame.baseLift
  };
};

const GEAR_OUTER_RADIUS_WORLD = (Math.SQRT2 / 4) * 1.08;
const GEAR_GROUND_CLEARANCE_EPSILON = 0.001;

export const getGearSocketGroundClearance = (placement = {}, socket = 'center', surface = 'front') => {
  if (!placement || (!placement.edge && !placement.isVertical)) return Infinity;
  const pivot = getGearSocketWorldPosition(placement, socket, surface);
  if (!pivot) return -Infinity;
  return (Number(pivot.z) || 0) - GEAR_OUTER_RADIUS_WORLD;
};

export const isGearSocketAboveGround = (placement = {}, socket = 'center', surface = 'front') => (
  getGearSocketGroundClearance(placement, socket, surface) >= -GEAR_GROUND_CLEARANCE_EPSILON
);

const sameCornerPivot = (a = {}, b = {}, epsilon = 0.001) => (
  Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= epsilon
  && Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= epsilon
  && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) <= epsilon
);

export const normalizeGearAxisBinding = (binding = null) => {
  if (!binding || typeof binding !== 'object' || !binding.componentKey) return null;
  const socket = isCornerGearSocket(binding.socket) ? binding.socket : null;
  if (!socket) return null;
  return {
    componentKey: binding.componentKey,
    hostKind: binding.hostKind === 'wall' ? 'wall' : 'tile',
    socket,
    surface: binding.surface || 'front'
  };
};

export const normalizeGearMount = (mount = {}) => {
  const axisBinding = normalizeGearAxisBinding(mount.axisBinding);
  return {
    ...mount,
    socketKind: mount.socketKind || getGearSocketKind(mount.position),
    axisBinding,
    rotationDirection: normalizeGearRotationDirection(mount.rotationDirection)
  };
};

const getPlacementByComponentKey = (mapData = {}, componentKey = '') => (
  mapData.tiles?.[componentKey] || mapData.walls?.[componentKey] || null
);

const getPlacementHostKind = (mapData = {}, componentKey = '') => (
  mapData.walls?.[componentKey] ? 'wall' : 'tile'
);

const getGearBindingCandidateSurfaces = (placement = {}, preferredSurface = 'front') => {
  const preferred = normalizeGearSurfaceForPanel(placement.panelType, preferredSurface || 'front');
  const surfaces = [preferred];
  ['front', 'back'].forEach((surface) => {
    const normalized = normalizeGearSurfaceForPanel(placement.panelType, surface);
    if (!surfaces.includes(normalized)) surfaces.push(normalized);
  });
  return surfaces;
};

const findAssemblyAxisBindingPivotCandidate = ({
  mapData = {},
  binding = null,
  hostPivot = null,
  epsilon = 0.001,
  assemblyGraph = null
} = {}) => {
  if (!binding?.componentKey || !hostPivot) return null;
  const graphForLookup = assemblyGraph?.assemblyByComponentKey
    ? assemblyGraph
    : buildMechanicalAssemblies(mapData);
  const assemblyId = graphForLookup.assemblyByComponentKey?.[binding.componentKey];
  const assembly = (graphForLookup.assemblies || []).find((item) => item.id === assemblyId) || null;
  const componentKeys = assembly?.componentKeys?.length > 0
    ? assembly.componentKeys
    : [binding.componentKey];
  for (const componentKey of componentKeys) {
    const placement = getPlacementByComponentKey(mapData, componentKey);
    if (!placement) continue;
    for (const socket of CITY_CHANNEL_GEAR_CORNER_SOCKETS) {
      for (const surface of getGearBindingCandidateSurfaces(placement, binding.surface)) {
        const pivot = getGearSocketWorldPosition(placement, socket, surface);
        if (!sameCornerPivot(pivot, hostPivot, epsilon)) continue;
        return {
          componentKey,
          hostKind: getPlacementHostKind(mapData, componentKey),
          socket,
          surface,
          component: placement
        };
      }
    }
  }
  return null;
};

export const getGearAxisBindingStatus = ({
  mapData = {},
  placement = null,
  mount = {},
  epsilon = 0.001,
  assemblyGraph = null
} = {}) => {
  const binding = normalizeGearAxisBinding(mount?.axisBinding);
  if (!binding) {
    return {
      bound: false,
      valid: true,
      binding: null,
      reason: 'unbound'
    };
  }
  if (!placement || !isCornerGearSocket(mount.position)) {
    return {
      bound: true,
      valid: false,
      binding,
      reason: 'invalid_host'
    };
  }
  const boundPlacement = binding.hostKind === 'wall'
    ? mapData.walls?.[binding.componentKey]
    : mapData.tiles?.[binding.componentKey];
  if (!boundPlacement) {
    return {
      bound: true,
      valid: false,
      binding,
      reason: 'missing_component'
    };
  }
  const hostPivot = getGearSocketWorldPosition(
    placement,
    mount.position,
    normalizeGearSurfaceForPanel(placement.panelType, mount.surface || 'front')
  );
  const boundPivot = getGearSocketWorldPosition(
    boundPlacement,
    binding.socket,
    normalizeGearSurfaceForPanel(boundPlacement.panelType, binding.surface || 'front')
  );
  if (hostPivot && boundPivot && sameCornerPivot(hostPivot, boundPivot, epsilon)) {
    return {
      bound: true,
      valid: true,
      binding,
      reason: 'ok',
      component: boundPlacement
    };
  }
  const assemblyCandidate = findAssemblyAxisBindingPivotCandidate({
    mapData,
    binding,
    hostPivot,
    epsilon,
    assemblyGraph
  });
  if (!assemblyCandidate) {
    return {
      bound: true,
      valid: false,
      binding,
      reason: 'detached_pivot'
    };
  }
  return {
    bound: true,
    valid: true,
    binding: {
      componentKey: assemblyCandidate.componentKey,
      hostKind: assemblyCandidate.hostKind,
      socket: assemblyCandidate.socket,
      surface: assemblyCandidate.surface
    },
    reason: 'ok',
    component: assemblyCandidate.component,
    resolvedFromBinding: binding
  };
};

export const getCornerGearBindingCandidates = ({
  mapData = {},
  pivotWorld = null,
  z = null,
  epsilon = 0.001
} = {}) => {
  if (!pivotWorld) return [];
  const pivotZ = Number.isFinite(Number(z)) ? Number(z) : Number(pivotWorld.z) || 0;
  const candidates = [];
  Object.entries(mapData.tiles || {}).forEach(([componentKey, tile]) => {
    if (!tile || tile.edge || tile.isVertical) return;
    if (Math.abs((Number(tile.z) || 0) - pivotZ) > epsilon) return;
    CITY_CHANNEL_GEAR_CORNER_SOCKETS.forEach((socket) => {
      const cornerWorld = getHorizontalGearSocketWorldPosition(tile, socket);
      if (!sameCornerPivot(cornerWorld, { ...pivotWorld, z: pivotZ }, epsilon)) return;
      candidates.push({
        componentKey,
        hostKind: 'tile',
        socket,
        surface: 'front',
        pivotWorld: cornerWorld
      });
    });
  });
  return candidates;
};

const getCanonicalGearTargetFallback = ({
  hostKind = 'tile',
  hostKey = '',
  placement = null,
  socket = '',
  surface = 'front',
  pivotWorld = null
} = {}) => ({
  hostKind: hostKind === 'wall' ? 'wall' : 'tile',
  hostKey,
  componentKey: hostKey,
  placement,
  socket,
  surface: normalizeGearSurfaceForPanel(placement?.panelType, surface || 'front'),
  pivotWorld
});

export const getCanonicalGearMountTarget = ({
  mapData = {},
  hostKind = 'tile',
  hostKey = '',
  placement = null,
  socket = '',
  surface = 'front',
  pivotWorld = null,
  epsilon = 0.001
} = {}) => {
  const fallback = getCanonicalGearTargetFallback({
    hostKind,
    hostKey,
    placement,
    socket,
    surface,
    pivotWorld
  });
  if (!isCornerGearSocket(socket) || !placement || placement.edge || placement.isVertical) return fallback;
  const resolvedPivot = pivotWorld || getGearSocketWorldPosition(placement, socket, surface);
  if (!resolvedPivot) return fallback;
  const targetSurface = fallback.surface;
  const candidates = [];
  Object.entries(mapData.tiles || {}).forEach(([componentKey, tile]) => {
    if (!tile || tile.edge || tile.isVertical) return;
    if (Math.abs((Number(tile.z) || 0) - (Number(resolvedPivot.z) || 0)) > epsilon) return;
    CITY_CHANNEL_GEAR_CORNER_SOCKETS.forEach((candidateSocket) => {
      const candidateSurface = normalizeGearSurfaceForPanel(tile.panelType, targetSurface);
      const candidatePivot = getGearSocketWorldPosition(tile, candidateSocket, candidateSurface);
      if (!sameCornerPivot(candidatePivot, resolvedPivot, epsilon)) return;
      candidates.push({
        hostKind: 'tile',
        hostKey: componentKey,
        componentKey,
        placement: tile,
        socket: candidateSocket,
        surface: candidateSurface,
        pivotWorld: candidatePivot
      });
    });
  });
  if (candidates.length <= 0) return { ...fallback, pivotWorld: resolvedPivot };
  return candidates.sort((left, right) => (
    String(left.hostKind).localeCompare(String(right.hostKind))
    || String(left.hostKey).localeCompare(String(right.hostKey))
    || String(left.socket).localeCompare(String(right.socket))
  ))[0];
};

export const createLegacyFixedAxisBinding = ({
  mapData = {},
  mount = {},
  componentKey = '',
  placement = null,
  pivotWorld = null
} = {}) => {
  if (mount.axisBinding) return normalizeGearAxisBinding(mount.axisBinding);
  if (mount.axisType !== 'fixedAxis' || !isCornerGearSocket(mount.position)) return null;
  const hostPlacement = placement || mapData.tiles?.[componentKey] || null;
  const pivot = pivotWorld || getHorizontalGearSocketWorldPosition(hostPlacement, mount.position);
  if (!pivot) return null;
  const candidates = getCornerGearBindingCandidates({ mapData, pivotWorld: pivot });
  const ownCandidate = candidates.find((candidate) => candidate.componentKey === componentKey && candidate.socket === mount.position);
  return normalizeGearAxisBinding(ownCandidate || candidates[0] || null);
};

const getNeighborKeyForPort = (tile, port) => {
  const offset = directionVector[port.worldDirection];
  if (!offset) return '';
  return createCellKey(tile.x + offset.x, tile.y + offset.y, tile.z);
};

const arePortsAligned = (fromPort, toPort) => {
  if (!fromPort || !toPort) return false;
  if (toPort.worldDirection !== oppositeDirection[fromPort.worldDirection]) return false;
  const fromPos = fromPort.worldLocalPosition || {};
  const toPos = toPort.worldLocalPosition || {};
  if (fromPort.worldDirection === 'north' || fromPort.worldDirection === 'south') {
    return Math.abs((fromPos.x || 0) - (toPos.x || 0)) <= 0.08;
  }
  return Math.abs((fromPos.y || 0) - (toPos.y || 0)) <= 0.08;
};

const getCellVerticalEndpoints = (rotation = 0) => {
  const normalized = ((Number.parseInt(rotation, 10) || 0) % 180 + 180) % 180;
  return normalized === 90
    ? [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    : [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }];
};

const lerp = (a, b, t) => a + ((b - a) * t);

const getTransmissionSocketPosition = (component = {}, port = {}) => {
  if (!component || !port) return null;
  const local = port.worldLocalPosition || rotateLocalPosition(
    port.localPosition || { x: 0, y: 0, z: 0 },
    normalizeRotation(component.transmissionRotation ?? component.rotation ?? 0),
    false
  );

  if (component.edge || component.isVertical) {
    const endpoints = component.edge
      ? (edgeEndpointsByEdge[component.edge] || edgeEndpointsByEdge.north)
      : getCellVerticalEndpoints(component.rotation || 0);
    const u = Math.max(0, Math.min(1, (local.x || 0) + 0.5));
    return {
      x: (Number(component.x) || 0) + lerp(endpoints[0].x, endpoints[1].x, u),
      y: (Number(component.y) || 0) + lerp(endpoints[0].y, endpoints[1].y, u),
      z: (Number(component.z) || 0) + 0.5 - (local.y || 0)
    };
  }

  return {
    x: (Number(component.x) || 0) + (local.x || 0),
    y: (Number(component.y) || 0) + (local.y || 0),
    z: Number(component.z) || 0
  };
};

const getSocketKey = (socket = {}) => [
  Math.round((Number(socket.x) || 0) * 1000),
  Math.round((Number(socket.y) || 0) * 1000),
  Math.round((Number(socket.z) || 0) * 1000)
].join(':');

const areTransmissionSocketPositionsEqual = (fromComponent, fromPort, toComponent, toPort) => {
  const fromSocket = getTransmissionSocketPosition(fromComponent, fromPort);
  const toSocket = getTransmissionSocketPosition(toComponent, toPort);
  return !!fromSocket && !!toSocket && getSocketKey(fromSocket) === getSocketKey(toSocket);
};

const addEdge = (graph, a, b, meta) => {
  graph.set(a, graph.get(a) || []);
  graph.set(b, graph.get(b) || []);
  graph.get(a).push({ key: b, ...meta });
  graph.get(b).push({ key: a, ...meta, from: meta.to, to: meta.from });
};

const hasGraphEdge = (graph, a, b) => (
  (graph.get(a) || []).some((edge) => edge.key === b)
);

const pushUnique = (list, value) => {
  if (value && !list.includes(value)) list.push(value);
};

const normalizeAssemblyGearMount = ({
  mapData = {},
  placement = null,
  componentKey = '',
  mount = {},
  assemblyGraph = null
} = {}) => {
  const normalizedMount = normalizeGearMount({
    ...mount,
    axisBinding: mount.axisBinding || createLegacyFixedAxisBinding({
      mapData,
      mount,
      componentKey,
      placement
    })
  });
  const bindingStatus = getGearAxisBindingStatus({
    mapData,
    placement,
    mount: normalizedMount,
    assemblyGraph
  });
  return {
    ...normalizedMount,
    axisBinding: bindingStatus.valid ? bindingStatus.binding : null,
    axisBindingInvalid: bindingStatus.bound && !bindingStatus.valid,
    axisBindingInvalidReason: bindingStatus.bound && !bindingStatus.valid ? bindingStatus.reason : null
  };
};

const getWallAdjacentFloorKeys = (wall = {}) => {
  if (!wall?.edge) return [];
  const offset = directionVector[wall.edge];
  const keys = [createCellKey(wall.x, wall.y, wall.z)];
  if (offset) keys.push(createCellKey(wall.x + offset.x, wall.y + offset.y, wall.z));
  return keys;
};

const getCandidateComponentKeysForPort = (component = {}, port = {}, connectableKeys = new Set()) => {
  const candidateKeys = [];
  const addIfConnectable = (key) => {
    if (key && connectableKeys.has(key)) pushUnique(candidateKeys, key);
  };

  const targetKey = getNeighborKeyForPort(component, port);
  addIfConnectable(targetKey);

  if (component.edge) {
    addIfConnectable(createWallKey(component.x, component.y, component.z - 1, component.edge));
    addIfConnectable(createWallKey(component.x, component.y, component.z + 1, component.edge));
    getWallAdjacentFloorKeys(component).forEach(addIfConnectable);
    return candidateKeys;
  }

  if (port.worldDirection) {
    const ownWallKey = createWallKey(component.x, component.y, component.z, port.worldDirection);
    const neighbor = directionVector[port.worldDirection];
    const neighborWallKey = neighbor
      ? createWallKey(component.x + neighbor.x, component.y + neighbor.y, component.z, oppositeDirection[port.worldDirection])
      : '';
    [ownWallKey, neighborWallKey].forEach(addIfConnectable);
  }

  return candidateKeys;
};

export const buildMechanicalAssemblies = (mapData = {}) => {
  const tiles = mapData.tiles || {};
  const walls = mapData.walls || {};
  const components = { ...tiles, ...walls };
  const graph = new Map();
  const portByTileKey = new Map();
  const warnings = [];
  const connectableKeys = new Set();

  Object.entries(components).forEach(([key, tile]) => {
    const ports = getWorldTransmissionPorts(tile, key);
    if (ports.length > 0) {
      connectableKeys.add(key);
      graph.set(key, graph.get(key) || []);
      portByTileKey.set(key, ports);
    }
  });

  connectableKeys.forEach((key) => {
    const tile = components[key];
    const ports = portByTileKey.get(key) || [];
    ports.forEach((port) => {
      const candidateKeys = getCandidateComponentKeysForPort(tile, port, connectableKeys);
      candidateKeys.forEach((candidateKey) => {
        if (candidateKey === key) return;
        const candidate = components[candidateKey];
        const targetPorts = portByTileKey.get(candidateKey) || [];
        const targetPort = targetPorts.find((item) => (
          arePortsAligned(port, item)
          && areTransmissionSocketPositionsEqual(tile, port, candidate, item)
        ));
        if (!targetPort) return;
        if (key < candidateKey) {
          addEdge(graph, key, candidateKey, {
            from: { componentKey: key, portId: port.id },
            to: { componentKey: candidateKey, portId: targetPort.id }
          });
        }
      });
    });
  });

  const portsBySocketKey = new Map();
  connectableKeys.forEach((componentKey) => {
    const component = components[componentKey];
    (portByTileKey.get(componentKey) || []).forEach((port) => {
      const socket = getTransmissionSocketPosition(component, port);
      if (!socket) return;
      const socketKey = getSocketKey(socket);
      portsBySocketKey.set(socketKey, portsBySocketKey.get(socketKey) || []);
      portsBySocketKey.get(socketKey).push({ componentKey, port });
    });
  });

  portsBySocketKey.forEach((entries) => {
    for (let fromIndex = 0; fromIndex < entries.length; fromIndex += 1) {
      for (let toIndex = fromIndex + 1; toIndex < entries.length; toIndex += 1) {
        const fromEntry = entries[fromIndex];
        const toEntry = entries[toIndex];
        if (fromEntry.componentKey === toEntry.componentKey) continue;
        if (hasGraphEdge(graph, fromEntry.componentKey, toEntry.componentKey)) continue;
        addEdge(graph, fromEntry.componentKey, toEntry.componentKey, {
          from: { componentKey: fromEntry.componentKey, portId: fromEntry.port.id },
          to: { componentKey: toEntry.componentKey, portId: toEntry.port.id },
          socketConnection: true
        });
      }
    }
  });

  const assemblySkeletons = [];
  const assemblyByComponentKey = {};
  const visited = new Set();
  connectableKeys.forEach((key) => {
    if (visited.has(key)) return;
    const queue = [key];
    const componentKeys = [];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift();
      componentKeys.push(current);
      (graph.get(current) || []).forEach(({ key: nextKey }) => {
        if (visited.has(nextKey)) return;
        visited.add(nextKey);
        queue.push(nextKey);
      });
    }
    const id = `assembly_${assemblySkeletons.length + 1}`;
    componentKeys.forEach((componentKey) => {
      assemblyByComponentKey[componentKey] = id;
    });
    const assembly = {
      id,
      componentKeys,
      edges: componentKeys.flatMap((componentKey) => (graph.get(componentKey) || []).map((edge) => ({ componentKey, ...edge }))),
      warnings: []
    };
    assemblySkeletons.push(assembly);
  });

  const assemblyGraphForBindings = {
    assemblies: assemblySkeletons,
    assemblyByComponentKey,
    graph
  };

  const assemblies = assemblySkeletons.map((assembly) => {
    const gearMounts = assembly.componentKeys.flatMap((componentKey) => {
      const tile = components[componentKey];
      return (Array.isArray(tile.gearMounts) ? tile.gearMounts : []).map((mount) => ({
        ...normalizeAssemblyGearMount({
          mapData,
          placement: tile,
          componentKey,
          mount,
          assemblyGraph: assemblyGraphForBindings
        }),
        componentKey,
        cell: parseCellKey(componentKey)
      }));
    });
    const boundGearMounts = gearMounts.filter((mount) => !!mount.axisBinding);
    const fixedAxes = boundGearMounts;
    return {
      ...assembly,
      gearMounts,
      boundGearMounts,
      fixedAxes
    };
  });

  Object.entries(components).forEach(([key, tile]) => {
    if (tile.boardRole === 'power_source' && !assemblyByComponentKey[key]) {
      warnings.push({ componentKey: key, message: '齿轮压力板没有连接到有效传动骨骼。' });
    }
  });

  return {
    assemblies,
    assemblyByComponentKey,
    graph,
    warnings
  };
};

export const getAssemblyForCell = (assemblyGraph, cell) => {
  const key = typeof cell === 'string' ? cell : getMechanismParamKey(cell);
  const id = assemblyGraph?.assemblyByComponentKey?.[key];
  return (assemblyGraph?.assemblies || []).find((assembly) => assembly.id === id) || null;
};

export const isPressureSourcePlacement = (placement = null) => (
  placement?.boardRole === 'power_source'
  || placement?.panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE
);

export const assemblyHasPressureSource = (assembly = null, mapData = {}) => (
  (assembly?.componentKeys || []).some((componentKey) => (
    isPressureSourcePlacement(mapData.tiles?.[componentKey] || mapData.walls?.[componentKey])
  ))
);

export const isPressureLinkedIntermediateGear = ({
  mapData = {},
  assemblyGraph = null,
  componentKey = '',
  placement = null
} = {}) => {
  if (!componentKey || isPressureSourcePlacement(placement)) return false;
  const assembly = getAssemblyForCell(assemblyGraph, componentKey);
  return !!assembly && assemblyHasPressureSource(assembly, mapData);
};

export const findFixedAxisForTrigger = (mapData = {}, cell) => {
  const assemblyGraph = buildMechanicalAssemblies(mapData);
  const sourceKey = getMechanismParamKey(cell);
  const sourceTile = mapData.tiles?.[sourceKey];
  const sourceAssembly = getAssemblyForCell(assemblyGraph, sourceKey);
  const fixedAxis = sourceAssembly?.fixedAxes?.[0] || null;
  if (sourceTile?.boardRole === 'power_source' && !fixedAxis) {
    return {
      ok: false,
      reason: 'no_connected_actuator',
      message: '齿轮压力板没有连接到可驱动的承动组件。',
      assemblyGraph
    };
  }
  const fallbackFixedAxis = fixedAxis
    || assemblyGraph.assemblies.find((assembly) => assembly.fixedAxes.length > 0)?.fixedAxes?.[0]
    || null;
  if (!fallbackFixedAxis) {
    return {
      ok: false,
      reason: 'no_actuator',
      message: '当前传动网络中没有可驱动的承动组件。',
      assemblyGraph
    };
  }
  const assembly = getAssemblyForCell(assemblyGraph, fallbackFixedAxis.componentKey);
  return {
    ok: !!assembly,
    reason: assembly ? 'ok' : 'missing_assembly',
    message: assembly ? '已找到固定轴。' : '固定轴没有所属机械整体。',
    fixedAxis: fallbackFixedAxis,
    assembly,
    assemblyGraph
  };
};
