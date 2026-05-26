import {
  CITY_CHANNEL_TILE_TYPES,
  cloneGearMounts,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell,
  normalizeRotation,
  wallEdgeToRotation
} from './cityChannelSchema';

const EDGE_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const PANEL_THICKNESS = 0.16;
const WALL_THICKNESS = 0.12;
const BOX_EPSILON = 0.0001;

const isPortalMaterial = (panelType) => (
  panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

const isFloorSupportPlacement = (placement) => (
  !!placement
  && !placement.edge
  && !placement.isVertical
  && !isPortalMaterial(placement.panelType)
);

const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

export const collectSupportedFloorKeys = ({
  previewTiles = new Map(),
  isVerticalSupport = () => false,
  isSameLevelConnected = () => false
} = {}) => {
  const floorTiles = Array.from(previewTiles.entries()).filter(([, tile]) => (
    tile && !tile.isVertical && !isPortalMaterial(tile.panelType)
  ));
  const floorTileKeys = new Set(floorTiles.map(([key]) => key));
  const floorGraph = new Map(floorTiles.map(([key]) => [key, new Set()]));
  const supportedFloorKeys = new Set();

  floorTiles.forEach(([key, tile]) => {
    if ((Number(tile.z) || 0) <= 0 || isVerticalSupport(tile, key)) {
      supportedFloorKeys.add(key);
    }

    Object.values(EDGE_NEIGHBOR_OFFSETS).forEach((offset) => {
      const neighborKey = createCellKey(tile.x + offset.x, tile.y + offset.y, tile.z);
      if (!floorTileKeys.has(neighborKey)) return;
      const neighbor = previewTiles.get(neighborKey);
      if (!neighbor || neighbor.isVertical || isPortalMaterial(neighbor.panelType)) return;
      if (!isSameLevelConnected(tile, key, neighbor, neighborKey)) return;
      floorGraph.get(key)?.add(neighborKey);
      floorGraph.get(neighborKey)?.add(key);
    });

    const upperKey = createCellKey(tile.x, tile.y, tile.z + 1);
    if (floorTileKeys.has(upperKey)) {
      floorGraph.get(key)?.add(upperKey);
    }
  });

  const queue = Array.from(supportedFloorKeys);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    (floorGraph.get(current) || []).forEach((nextKey) => {
      if (supportedFloorKeys.has(nextKey)) return;
      supportedFloorKeys.add(nextKey);
      queue.push(nextKey);
    });
  }

  return supportedFloorKeys;
};

const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

const getSelectionPlacementKey = (placement) => (
  placement?.edge
    ? createWallSelectionKey(placement)
    : createCellKey(placement.x, placement.y, placement.z)
);

const getMovingPlacementKey = (placement) => (
  placement?.edge
    ? createWallKey(placement.x, placement.y, placement.z, placement.edge)
    : createCellKey(placement.x, placement.y, placement.z)
);

const areWallAndFloorConnected = (wall, floor) => {
  if (!wall?.edge || !floor || floor.edge) return false;
  if ((Number(wall.z) || 0) !== (Number(floor.z) || 0)) return false;
  const ownCellKey = createCellKey(wall.x, wall.y, wall.z);
  const neighborOffset = EDGE_NEIGHBOR_OFFSETS[wall.edge] || EDGE_NEIGHBOR_OFFSETS.north;
  const neighborCellKey = createCellKey(wall.x + neighborOffset.x, wall.y + neighborOffset.y, wall.z);
  const floorKey = createCellKey(floor.x, floor.y, floor.z);
  return floorKey === ownCellKey || floorKey === neighborCellKey;
};

const areSelectionPlacementsConnected = (a, b) => {
  if (!a || !b) return false;
  if (sameCell(a, b) && a.edge === b.edge) return true;

  const aWall = !!a.edge;
  const bWall = !!b.edge;
  const aVertical = !!a.isVertical && !aWall;
  const bVertical = !!b.isVertical && !bWall;

  if (aWall && bWall) {
    return a.edge === b.edge
      && a.x === b.x
      && a.y === b.y
      && Math.abs((Number(a.z) || 0) - (Number(b.z) || 0)) === 1;
  }

  if (aWall && !bWall) return areWallAndFloorConnected(a, b) || (aVertical && sameCell(a, b));
  if (bWall && !aWall) return areWallAndFloorConnected(b, a) || (bVertical && sameCell(a, b));

  if (aVertical || bVertical) {
    return sameCell(a, b);
  }

  if (isPortalMaterial(a.panelType) || isPortalMaterial(b.panelType)) {
    return sameCell(a, b);
  }

  return Number(a.z) === Number(b.z)
    && Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) + Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) === 1;
};

const getSelectionSupportCells = (support = {}) => {
  if (!support?.edge && !support?.isVertical) return [];
  const base = {
    x: Number(support.x) || 0,
    y: Number(support.y) || 0,
    z: Number(support.z) || 0
  };
  const cells = [
    { x: base.x, y: base.y, z: base.z + 1 }
  ];
  Object.values(EDGE_NEIGHBOR_OFFSETS).forEach((offset) => {
    cells.push({
      x: base.x + offset.x,
      y: base.y + offset.y,
      z: base.z + 1
    });
  });
  if (support.edge) {
    const offset = EDGE_NEIGHBOR_OFFSETS[support.edge];
    if (offset) {
      cells.push({
        x: base.x + offset.x,
        y: base.y + offset.y,
        z: base.z + 1
      });
    }
  }
  return cells;
};

const areSelectionPlacementsStructurallyConnected = (a, b) => {
  if (!a || !b) return false;
  const target = { x: Number(b.x) || 0, y: Number(b.y) || 0, z: Number(b.z) || 0 };
  return getSelectionSupportCells(a).some((cell) => sameCell(cell, target));
};

const areSelectionPlacementsConnectedInMap = (a, b) => (
  areSelectionPlacementsConnected(a, b)
  || areSelectionPlacementsStructurallyConnected(a, b)
  || areSelectionPlacementsStructurallyConnected(b, a)
);

const getSelectionPlacement = (mapData = {}, origin = {}) => (
  origin.edge
    ? mapData.walls?.[createWallSelectionKey(origin)]
    : mapData.tiles?.[createCellKey(origin.x, origin.y, origin.z)]
);

const getSelectionPlacementForGraph = (mapData = {}, origin = {}) => {
  const placement = getSelectionPlacement(mapData, origin);
  return placement
    ? {
      ...placement,
      ...(origin.edge ? { edge: origin.edge } : {})
    }
    : { ...origin };
};

const buildSelectionComponents = (mapData = {}, origins = []) => {
  const nodes = origins.map((origin, index) => ({
    index,
    origin,
    key: getSelectionPlacementKey(origin),
    placement: getSelectionPlacementForGraph(mapData, origin)
  }));
  const graph = new Map(nodes.map((node) => [node.index, []]));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!areSelectionPlacementsConnectedInMap(nodes[i].placement, nodes[j].placement)) continue;
      graph.get(i)?.push(j);
      graph.get(j)?.push(i);
    }
  }

  const visited = new Set();
  const components = [];
  nodes.forEach((node) => {
    if (visited.has(node.index)) return;
    const queue = [node.index];
    const indices = [];
    visited.add(node.index);
    while (queue.length > 0) {
      const current = queue.shift();
      indices.push(current);
      (graph.get(current) || []).forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push(next);
      });
    }
    const id = `component_${components.length}`;
    components.push({
      id,
      indices,
      originKeys: new Set(indices.map((index) => nodes[index].key)),
      placementKeys: new Set()
    });
  });
  return components;
};

const createComponentResult = (component) => ({
  id: component.id,
  indices: component.indices,
  originKeys: new Set(component.originKeys),
  placementKeys: new Set(),
  invalidPlacementKeys: new Set(),
  conflictReasons: new Set(),
  hasConnection: false,
  valid: true
});

const markComponentPlacementInvalid = (state, placementKey, componentId, reason) => {
  if (!placementKey) return;
  state.invalidPlacementKeys?.add(placementKey);
  const component = componentId ? state.componentResults?.get(componentId) : state.componentByPlacementKey?.get(placementKey);
  if (!component) return;
  component.invalidPlacementKeys.add(placementKey);
  if (reason) component.conflictReasons.add(reason);
  component.valid = false;
};

const rotatePoint = (point, degrees = 0) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (point.x * Math.cos(radians)) - (point.y * Math.sin(radians)),
    y: (point.x * Math.sin(radians)) + (point.y * Math.cos(radians))
  };
};

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

const createBox = ({ minX, maxX, minY, maxY, minZ, maxZ }) => ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ
});

const boxesIntersect = (a, b, epsilon = BOX_EPSILON) => !!a && !!b && !(
  a.maxX <= b.minX + epsilon
  || a.minX >= b.maxX - epsilon
  || a.maxY <= b.minY + epsilon
  || a.minY >= b.maxY - epsilon
  || a.maxZ <= b.minZ + epsilon
  || a.minZ >= b.maxZ - epsilon
);

const boxSetsIntersect = (boxesA = [], boxesB = []) => (
  boxesA.some((boxA) => boxesB.some((boxB) => boxesIntersect(boxA, boxB)))
);

const getRotatedTileFootprint = (rotation = 0) => {
  const corners = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 }
  ].map((point) => rotatePoint(point, rotation));
  return getPointBounds(corners);
};

const getCellVerticalFootprint = (rotation = 0) => {
  const normalizedRotation = normalizeRotation(rotation) % 180;
  return normalizedRotation === 90
    ? { minX: -WALL_THICKNESS / 2, maxX: WALL_THICKNESS / 2, minY: -0.5, maxY: 0.5 }
    : { minX: -0.5, maxX: 0.5, minY: -WALL_THICKNESS / 2, maxY: WALL_THICKNESS / 2 };
};

const getEdgeWallFootprint = (edge = 'north') => {
  if (edge === 'south') return { minX: -0.5, maxX: 0.5, minY: 0.5 - WALL_THICKNESS, maxY: 0.5 };
  if (edge === 'west') return { minX: -0.5, maxX: -0.5 + WALL_THICKNESS, minY: -0.5, maxY: 0.5 };
  if (edge === 'east') return { minX: 0.5 - WALL_THICKNESS, maxX: 0.5, minY: -0.5, maxY: 0.5 };
  return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: -0.5 + WALL_THICKNESS };
};

export const getCityChannelPlacementCollisionBoxes = (placement) => {
  if (!placement) return [];
  const z = Number(placement.z) || 0;
  const boxes = [];

  if (!placement.edge) {
    const floorFootprint = getRotatedTileFootprint(placement.rotation || 0);
    boxes.push(createBox({
      minX: placement.x + floorFootprint.minX,
      maxX: placement.x + floorFootprint.maxX,
      minY: placement.y + floorFootprint.minY,
      maxY: placement.y + floorFootprint.maxY,
      minZ: z,
      maxZ: z + PANEL_THICKNESS
    }));
  }

  if (placement.edge || placement.isVertical) {
    const wallFootprint = placement.edge
      ? getEdgeWallFootprint(placement.edge)
      : getCellVerticalFootprint(placement.rotation || 0);
    boxes.push(createBox({
      minX: placement.x + wallFootprint.minX,
      maxX: placement.x + wallFootprint.maxX,
      minY: placement.y + wallFootprint.minY,
      maxY: placement.y + wallFootprint.maxY,
      minZ: z + PANEL_THICKNESS + BOX_EPSILON,
      maxZ: z + 1
    }));
  }

  return boxes;
};

export const getCityChannelPlacementCollisionBox = (placement) => {
  const boxes = getCityChannelPlacementCollisionBoxes(placement);
  if (boxes.length <= 0) return null;
  return boxes.reduce((combined, box) => createBox({
    minX: Math.min(combined.minX, box.minX),
    maxX: Math.max(combined.maxX, box.maxX),
    minY: Math.min(combined.minY, box.minY),
    maxY: Math.max(combined.maxY, box.maxY),
    minZ: Math.min(combined.minZ, box.minZ),
    maxZ: Math.max(combined.maxZ, box.maxZ)
  }), boxes[0]);
};

const getPlacementKey = (placement) => (
  placement?.edge
    ? createWallSelectionKey(placement)
    : createCellKey(placement.x, placement.y, placement.z)
);

export const getSelectionAnchor = (origins = []) => {
  if (!Array.isArray(origins) || origins.length === 0) return null;
  return origins.reduce((best, origin) => {
    if (!best) return origin;
    const bestZ = Number(best.z) || 0;
    const originZ = Number(origin.z) || 0;
    if (originZ !== bestZ) return originZ < bestZ ? origin : best;
    const bestY = Number(best.y) || 0;
    const originY = Number(origin.y) || 0;
    if (originY !== bestY) return originY < bestY ? origin : best;
    const bestX = Number(best.x) || 0;
    const originX = Number(origin.x) || 0;
    if (originX !== bestX) return originX < bestX ? origin : best;
    const bestEdge = String(best.edge || '');
    const originEdge = String(origin.edge || '');
    return originEdge.localeCompare(bestEdge) < 0 ? origin : best;
  }, null);
};

const createCollisionEntry = ({ placement, key, origin = null, moving = false }) => ({
  key,
  placement,
  origin,
  moving,
  boxes: getCityChannelPlacementCollisionBoxes(placement)
});

const addConflict = (state, reason, to, edge = null) => {
  if (!to) return;
  const conflictEdge = edge ?? to.edge ?? null;
  const placementKey = conflictEdge
    ? createWallKey(to.x, to.y, to.z, conflictEdge)
    : createCellKey(to.x, to.y, to.z);
  const key = `${placementKey}:${reason}`;
  if (state.seenConflictKeys?.has(key)) return;
  state.seenConflictKeys?.add(key);
  state.conflicts.push({
    key,
    cell: to,
    edge: conflictEdge,
    reason,
    placementKey
  });
  state.conflictKeys?.add(placementKey);
  const componentId = state.componentIdByPlacementKey?.get(placementKey);
  markComponentPlacementInvalid(state, placementKey, componentId, reason);
};

const addCollisionConflicts = (state, leftEntry, rightEntry) => {
  if (leftEntry.moving && rightEntry.moving) {
    addConflict(state, 'selection_overlap', leftEntry.placement, leftEntry.placement.edge || null);
    addConflict(state, 'selection_overlap', rightEntry.placement, rightEntry.placement.edge || null);
    return;
  }
  if (leftEntry.moving) {
    addConflict(state, 'placement_occupied', leftEntry.placement, leftEntry.placement.edge || null);
  }
  if (rightEntry.moving) {
    addConflict(state, 'placement_occupied', rightEntry.placement, rightEntry.placement.edge || null);
  }
};

const collectStaticCollisionEntries = ({
  mapData = {},
  movingTileKeys = new Set(),
  movingWallKeys = new Set()
} = {}) => {
  const entries = [];
  Object.entries(mapData.tiles || {}).forEach(([key, tile]) => {
    if (!tile || movingTileKeys.has(key)) return;
    entries.push(createCollisionEntry({ placement: tile, key, moving: false }));
  });
  Object.entries(mapData.walls || {}).forEach(([key, wall]) => {
    if (!wall || movingWallKeys.has(key)) return;
    entries.push(createCollisionEntry({ placement: wall, key, moving: false }));
  });
  return entries;
};

const getWallSupportCellKeys = (placement = {}) => {
  if (!placement?.edge) return [];
  const offset = EDGE_NEIGHBOR_OFFSETS[placement.edge] || EDGE_NEIGHBOR_OFFSETS.north;
  return [
    createCellKey(placement.x, placement.y, placement.z),
    createCellKey(placement.x + offset.x, placement.y + offset.y, placement.z)
  ];
};

const isSupportCollisionExempt = (movingPlacement = {}, staticPlacement = {}) => {
  if (!movingPlacement || !staticPlacement) return false;
  if (!isFloorSupportPlacement(staticPlacement)) return false;
  if (movingPlacement.edge) {
    return getWallSupportCellKeys(movingPlacement).includes(
      createCellKey(staticPlacement.x, staticPlacement.y, staticPlacement.z)
    );
  }
  return movingPlacement.isVertical && sameCell(movingPlacement, staticPlacement);
};

const rotateOffsetBySteps = (dx = 0, dy = 0, steps = 0) => {
  const normalized = ((steps % 4) + 4) % 4;
  if (normalized === 1) return { x: -dy, y: dx };
  if (normalized === 2) return { x: -dx, y: -dy };
  if (normalized === 3) return { x: dy, y: -dx };
  return { x: dx, y: dy };
};

const rotateVectorYawBySteps = ({ x = 0, y = 0, z = 0 } = {}, steps = 0) => {
  const rotated = rotateOffsetBySteps(x, y, steps);
  return {
    x: rotated.x,
    y: rotated.y,
    z
  };
};

const rotateVectorPitchByQuarter = ({ x = 0, y = 0, z = 0 } = {}, quarterTurns = 0) => {
  const normalized = ((quarterTurns % 4) + 4) % 4;
  if (normalized === 1) {
    // Roll forward 90° around the local X axis.
    return { x, y: -z, z: y };
  }
  if (normalized === 2) return { x, y: -y, z: -z };
  if (normalized === 3) return { x, y: z, z: -y };
  return { x, y, z };
};

const roundGrid = (value = 0) => Math.round(Number(value) || 0);

const rotationToWallEdge = (rotation = 0) => {
  const normalized = ((Number(rotation) || 0) % 360 + 360) % 360;
  if (normalized === 90) return 'east';
  if (normalized === 180) return 'south';
  if (normalized === 270) return 'west';
  return 'north';
};

const getEdgeCenterOffset = (edge = 'north') => {
  const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
  return {
    x: offset.x * 0.5,
    y: offset.y * 0.5
  };
};

const getPlacementRigidPoint = (origin = {}, placement = null) => {
  const edge = origin.edge || placement?.edge || null;
  const edgeOffset = edge ? getEdgeCenterOffset(edge) : { x: 0, y: 0 };
  return {
    x: (Number(origin.x) || 0) + edgeOffset.x,
    y: (Number(origin.y) || 0) + edgeOffset.y,
    z: Number(origin.z) || 0
  };
};

const getPlacementShapeRotation = (origin = {}, placement = null) => normalizeRotation(
  placement?.rotation
    ?? (origin.edge ? wallEdgeToRotation(origin.edge) : 0)
);

const getPlacementBaseRotation = (origin = {}, placement = null) => (
  origin.edge || placement?.edge ? wallEdgeToRotation(origin.edge || placement?.edge) : 0
);

const getPlacementSurfaceRotation = (origin = {}, placement = null) => normalizeRotation(
  placement?.transmissionRotation
    ?? placement?.rotation
    ?? (origin.edge ? wallEdgeToRotation(origin.edge) : 0)
);

const getPlacementWorldSurfaceRotation = (origin = {}, placement = null) => normalizeRotation(
  getPlacementBaseRotation(origin, placement) + getPlacementSurfaceRotation(origin, placement)
);

const rotateRotationBySteps = (rotation = 0, steps = 0) => normalizeRotation(rotation + (steps * 90));

const getRotationSteps = (rotation = 0) => Math.round(normalizeRotation(rotation) / 90) % 4;

const rotateVectorPitchAroundYawByQuarter = (vector, axisSteps = 0, quarterTurns = 0) => {
  const normalizedQuarterTurns = ((quarterTurns % 4) + 4) % 4;
  if (normalizedQuarterTurns === 0) return vector;
  const local = rotateVectorYawBySteps(vector, -axisSteps);
  const pitched = rotateVectorPitchByQuarter(local, normalizedQuarterTurns);
  return rotateVectorYawBySteps(pitched, axisSteps);
};

const createRigidTransform = ({
  sourceCenterPoint,
  normalizedRotationSteps,
  poseQuarterTurns,
  basisRotationSteps
}) => {
  const axisSteps = (basisRotationSteps + normalizedRotationSteps + 4) % 4;
  return (point = {}) => {
    const offset = {
      x: (Number(point.x) || 0) - sourceCenterPoint.x,
      y: (Number(point.y) || 0) - sourceCenterPoint.y,
      z: (Number(point.z) || 0) - sourceCenterPoint.z
    };
    const yawed = rotateVectorYawBySteps(offset, normalizedRotationSteps);
    const transformed = rotateVectorPitchAroundYawByQuarter(yawed, axisSteps, poseQuarterTurns);
    return {
      x: sourceCenterPoint.x + transformed.x,
      y: sourceCenterPoint.y + transformed.y,
      z: sourceCenterPoint.z + transformed.z
    };
  };
};

const rotateVectorWithRigidParams = (
  vector,
  normalizedRotationSteps = 0,
  poseQuarterTurns = 0,
  basisRotationSteps = 0
) => {
  const axisSteps = (basisRotationSteps + normalizedRotationSteps + 4) % 4;
  const yawed = rotateVectorYawBySteps(vector, normalizedRotationSteps);
  return rotateVectorPitchAroundYawByQuarter(yawed, axisSteps, poseQuarterTurns);
};

const vectorToWallEdge = (vector = {}) => {
  const absX = Math.abs(Number(vector.x) || 0);
  const absY = Math.abs(Number(vector.y) || 0);
  if (absX >= absY) {
    return (Number(vector.x) || 0) >= 0 ? 'east' : 'west';
  }
  return (Number(vector.y) || 0) >= 0 ? 'south' : 'north';
};

const vectorToShapeRotation = (vector = {}) => normalizeRotation(
  Math.round((Math.atan2(Number(vector.y) || 0, Number(vector.x) || 0) * 180) / Math.PI / 90) * 90
);

const getPlacementLocalBasis = (origin = {}, placement = null) => {
  const surfaceSteps = getRotationSteps(getPlacementSurfaceRotation(origin, placement));
  const tangent = rotateOffsetBySteps(1, 0, surfaceSteps);

  if (origin.edge || placement?.edge) {
    const edge = origin.edge || placement.edge;
    const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
    return {
      normal: { x: offset.x, y: offset.y, z: 0 },
      tangent: { x: tangent.x, y: tangent.y, z: 0 },
      sourceKind: 'wall'
    };
  }

  if (placement?.isVertical) {
    const faceSteps = getRotationSteps(getPlacementShapeRotation(origin, placement));
    const normal = rotateOffsetBySteps(0, -1, faceSteps);
    return {
      normal: { x: normal.x, y: normal.y, z: 0 },
      tangent: { x: tangent.x, y: tangent.y, z: 0 },
      sourceKind: 'vertical'
    };
  }

  return {
    normal: { x: 0, y: 0, z: 1 },
    tangent: { x: tangent.x, y: tangent.y, z: 0 },
    sourceKind: 'floor'
  };
};

const withLocalSurfaceRotation = (shape) => ({
  ...shape,
  surfaceRotation: normalizeRotation(
    shape.worldSurfaceRotation - (shape.edge ? wallEdgeToRotation(shape.edge) : 0)
  )
});

const deriveShapeFromRigidTransform = ({
  origin,
  sourcePlacement,
  normalizedRotationSteps,
  normalizedGroupPoseSteps,
  basisRotationSteps
}) => {
  const basis = getPlacementLocalBasis(origin, sourcePlacement);
  const transformedNormal = rotateVectorWithRigidParams(
    basis.normal,
    normalizedRotationSteps,
    normalizedGroupPoseSteps,
    basisRotationSteps
  );
  const transformedTangent = rotateVectorWithRigidParams(
    basis.tangent,
    normalizedRotationSteps,
    normalizedGroupPoseSteps,
    basisRotationSteps
  );
  const absX = Math.abs(transformedNormal.x);
  const absY = Math.abs(transformedNormal.y);
  const absZ = Math.abs(transformedNormal.z);
  const sourceWorldSurfaceRotation = getPlacementWorldSurfaceRotation(origin, sourcePlacement);
  const rotatedWorldSurfaceRotation = rotateRotationBySteps(sourceWorldSurfaceRotation, normalizedRotationSteps);
  const shapeRotationFromTangent = vectorToShapeRotation(transformedTangent);
  const target = {
    shapeRotation: shapeRotationFromTangent,
    worldSurfaceRotation: rotatedWorldSurfaceRotation,
    includeRotation: true
  };

  if (absZ >= absX && absZ >= absY) {
    if (basis.sourceKind === 'wall' || origin.edge) {
      return withLocalSurfaceRotation({ ...target, layFlat: true });
    }
    if (basis.sourceKind === 'vertical') {
      return withLocalSurfaceRotation({ ...target, layFlat: true });
    }
    return withLocalSurfaceRotation(target);
  }

  const edge = vectorToWallEdge(transformedNormal);
  if (basis.sourceKind === 'wall' || origin.edge) {
    return withLocalSurfaceRotation({
      ...target,
      edge,
      shapeRotation: wallEdgeToRotation(edge)
    });
  }
  if (basis.sourceKind === 'vertical') {
    return withLocalSurfaceRotation({
      ...target,
      isVertical: true,
      shapeRotation: shapeRotationFromTangent
    });
  }
  return withLocalSurfaceRotation({
    ...target,
    isVertical: true,
    shapeRotation: shapeRotationFromTangent
  });
};

const getPlacementTargetShape = ({
  origin,
  sourcePlacement,
  targetCell,
  originsLength,
  normalizedGroupPoseSteps,
  normalizedRotationSteps,
  basisRotationSteps,
  layFlatTarget
}) => {
  const normalizedPoseSteps = ((normalizedGroupPoseSteps % 4) + 4) % 4;
  const hasGroupTransform = originsLength > 1 && (normalizedRotationSteps !== 0 || normalizedPoseSteps !== 0);

  if (hasGroupTransform) {
    return deriveShapeFromRigidTransform({
      origin,
      sourcePlacement,
      normalizedRotationSteps,
      normalizedGroupPoseSteps: normalizedPoseSteps,
      basisRotationSteps
    });
  }

  const sourceShapeRotation = getPlacementShapeRotation(origin, sourcePlacement);
  const sourceWorldSurfaceRotation = getPlacementWorldSurfaceRotation(origin, sourcePlacement);
  const rotatedShapeRotation = rotateRotationBySteps(sourceShapeRotation, normalizedRotationSteps);
  const rotatedWorldSurfaceRotation = rotateRotationBySteps(sourceWorldSurfaceRotation, normalizedRotationSteps);
  const target = {
    shapeRotation: targetCell.rotation !== undefined
      ? normalizeRotation(targetCell.rotation)
      : rotatedShapeRotation,
    worldSurfaceRotation: targetCell.rotation !== undefined
      ? normalizeRotation(targetCell.rotation)
      : rotatedWorldSurfaceRotation,
    includeRotation: targetCell.rotation !== undefined
  };

  if (targetCell.edge && originsLength === 1) {
    return withLocalSurfaceRotation({
      ...target,
      edge: targetCell.edge
    });
  }
  if (origin.edge && !layFlatTarget) {
    return withLocalSurfaceRotation({
      ...target,
      edge: rotationToWallEdge(rotateRotationBySteps(wallEdgeToRotation(origin.edge), normalizedRotationSteps))
    });
  }
  if (layFlatTarget) {
    return withLocalSurfaceRotation({
      ...target,
      layFlat: true
    });
  }
  return withLocalSurfaceRotation(target);
};

const createPlacementTargetCell = ({
  transformedPoint,
  targetShape,
  dx,
  dy,
  dz
}) => {
  const edgeOffset = targetShape.edge ? getEdgeCenterOffset(targetShape.edge) : { x: 0, y: 0 };
  return {
    x: roundGrid(transformedPoint.x + dx - edgeOffset.x),
    y: roundGrid(transformedPoint.y + dy - edgeOffset.y),
    z: roundGrid(transformedPoint.z + dz)
  };
};

export const computeCityChannelMovePreviewModel = ({
  mapData = {},
  origins = [],
  targetCell = null,
  anchor = null,
  explicitSurfaceTarget = null,
  preserveOrigins = false,
  groupRotationSteps = 0,
  groupPoseSteps = 0,
  includeConflictKeys = false
} = {}) => {
  const emptyComponents = [];
  const emptyComponentResults = new Map();
  if (!Array.isArray(origins) || origins.length <= 0 || !targetCell) {
    return {
      valid: true,
      moves: [],
      conflicts: [],
      conflictKeys: includeConflictKeys ? new Set() : undefined,
      invalidPlacementKeys: new Set(),
      componentResults: emptyComponentResults,
      components: emptyComponents,
      componentByPlacementKey: new Map(),
      componentIdByPlacementKey: new Map(),
      movedTilePlacements: [],
      movedWallPlacements: [],
      movingTileKeys: new Set(),
      movingWallKeys: new Set(),
      anchor: null,
      previewTiles: new Map(Object.entries(mapData.tiles || {})),
      previewWalls: new Map(Object.entries(mapData.walls || {})),
      targetKey: targetCell ? createCellKey(targetCell.x, targetCell.y, targetCell.z) : ''
    };
  }

  const resolvedAnchor = anchor || getSelectionAnchor(origins) || origins[0];
  const sourcePlacementByOriginKey = new Map(
    origins.map((origin) => {
      const originKey = getSelectionPlacementKey(origin);
      const sourcePlacement = getSelectionPlacement(mapData, origin);
      return [originKey, sourcePlacement || null];
    })
  );
  const sourceRigidPointByOriginKey = new Map(
    origins.map((origin) => {
      const originKey = getSelectionPlacementKey(origin);
      return [originKey, getPlacementRigidPoint(origin, sourcePlacementByOriginKey.get(originKey))];
    })
  );
  const sourceCenter = Array.from(sourceRigidPointByOriginKey.values()).reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
    z: acc.z + point.z
  }), { x: 0, y: 0, z: 0 });
  const sourceCenterPoint = {
    x: sourceCenter.x / origins.length,
    y: sourceCenter.y / origins.length,
    z: sourceCenter.z / origins.length
  };
  const normalizedGroupPoseSteps = ((groupPoseSteps % 4) + 4) % 4;
  const poseQuarterTurns = origins.length > 1 ? normalizedGroupPoseSteps : 0;
  const normalizedRotationSteps = ((groupRotationSteps % 4) + 4) % 4;
  const resolvedAnchorKey = getSelectionPlacementKey(resolvedAnchor);
  const anchorSourcePlacement = sourcePlacementByOriginKey.get(resolvedAnchorKey);
  const basisRotationSteps = getRotationSteps(getPlacementShapeRotation(resolvedAnchor, anchorSourcePlacement));
  const transformRigidPoint = createRigidTransform({
    sourceCenterPoint,
    normalizedRotationSteps,
    poseQuarterTurns,
    basisRotationSteps
  });
  const rotatedAnchorPoint = transformRigidPoint(
    sourceRigidPointByOriginKey.get(resolvedAnchorKey) || getPlacementRigidPoint(resolvedAnchor, anchorSourcePlacement)
  );
  const anchorTargetShape = getPlacementTargetShape({
    origin: resolvedAnchor,
    sourcePlacement: anchorSourcePlacement,
    targetCell,
    originsLength: origins.length,
    normalizedGroupPoseSteps,
    normalizedRotationSteps,
    basisRotationSteps,
    layFlatTarget: false
  });
  const anchorTargetOffset = anchorTargetShape.edge ? getEdgeCenterOffset(anchorTargetShape.edge) : { x: 0, y: 0 };
  const targetAnchorPoint = anchorTargetShape.edge
    ? getPlacementRigidPoint({ ...targetCell, edge: anchorTargetShape.edge }, null)
    : {
      x: (Number(targetCell.x) || 0) + anchorTargetOffset.x,
      y: (Number(targetCell.y) || 0) + anchorTargetOffset.y,
      z: Number(targetCell.z) || 0
    };
  const dx = targetAnchorPoint.x - rotatedAnchorPoint.x;
  const dy = targetAnchorPoint.y - rotatedAnchorPoint.y;
  const dz = targetAnchorPoint.z - (Number(rotatedAnchorPoint.z) || 0);
  const components = buildSelectionComponents(mapData, origins);
  const componentIdByOriginKey = new Map();
  components.forEach((component) => {
    component.originKeys.forEach((key) => componentIdByOriginKey.set(key, component.id));
  });
  const componentResults = new Map(components.map((component) => [component.id, createComponentResult(component)]));
  const componentByPlacementKey = new Map();
  const componentIdByPlacementKey = new Map();
  const invalidPlacementKeys = new Set();
  const movingTileKeys = new Set(origins.filter((item) => !item.edge).map((item) => createCellKey(item.x, item.y, item.z)));
  const movingWallKeys = new Set(origins.filter((item) => item.edge).map(createWallSelectionKey));
  const movableTileKeys = preserveOrigins ? new Set() : movingTileKeys;
  const movableWallKeys = preserveOrigins ? new Set() : movingWallKeys;
  const state = {
    conflicts: [],
    conflictKeys: includeConflictKeys ? new Set() : null,
    seenConflictKeys: new Set(),
    componentResults,
    componentByPlacementKey,
    componentIdByPlacementKey,
    invalidPlacementKeys
  };
  const layFlatTarget = origins.length === 1 && !!targetCell?.layFlat && !targetCell?.edge;
  const moves = origins.map((origin) => ({
    from: origin,
    componentId: componentIdByOriginKey.get(getSelectionPlacementKey(origin)) || null,
    to: (() => {
      const originKey = getSelectionPlacementKey(origin);
      const sourcePlacement = sourcePlacementByOriginKey.get(originKey);
      const targetShape = getPlacementTargetShape({
        origin,
        sourcePlacement,
        targetCell,
        originsLength: origins.length,
        normalizedGroupPoseSteps,
        normalizedRotationSteps,
        basisRotationSteps,
        layFlatTarget
      });
      const rotatedOriginPoint = transformRigidPoint(sourceRigidPointByOriginKey.get(originKey));
      const to = createPlacementTargetCell({
        transformedPoint: rotatedOriginPoint,
        targetShape,
        dx,
        dy,
        dz
      });
      if (targetShape.includeRotation) {
        to.rotation = normalizeRotation(targetShape.shapeRotation);
        to.transmissionRotation = normalizeRotation(targetShape.surfaceRotation);
      }
      if (explicitSurfaceTarget) {
        if (explicitSurfaceTarget.edge) to.edge = explicitSurfaceTarget.edge;
      } else if (targetShape.edge) {
        to.edge = targetShape.edge;
      } else if (targetShape.layFlat) {
        to.layFlat = true;
      } else if (targetShape.isVertical) {
        to.isVertical = true;
      }
      return to;
    })()
  }));
  const movedTilePlacements = [];
  const movedWallPlacements = [];
  const movingEntries = [];
  const previewTiles = new Map(Object.entries(mapData.tiles || {}).filter(([key]) => !movableTileKeys.has(key)));
  const previewWalls = new Map(Object.entries(mapData.walls || {}).filter(([key]) => !movableWallKeys.has(key)));
  const movedTilePlacementKeys = new Set();
  const registerPlacementKey = (placementKey, componentId) => {
    componentIdByPlacementKey.set(placementKey, componentId);
    const componentResult = componentResults.get(componentId);
    if (componentResult) {
      componentResult.placementKeys.add(placementKey);
      componentByPlacementKey.set(placementKey, componentResult);
    }
  };

  const registerMovedPlacement = (placement, componentId) => {
    const placementKey = getMovingPlacementKey(placement);
    registerPlacementKey(placementKey, componentId);
    return placementKey;
  };

  moves.forEach(({ from, to, componentId }) => {
    registerPlacementKey(getMovingPlacementKey(to), componentId);
    if (!isValidCell(to.x, to.y, to.z, mapData)) {
      addConflict(state, 'out_of_bounds', to, to.edge || null);
      return;
    }

    if (to.edge) {
      const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
      const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
      const placement = sourceWall
        ? {
          ...sourceWall,
          x: to.x,
          y: to.y,
          z: to.z,
          edge: to.edge,
          ...(to.transmissionRotation !== undefined || to.rotation !== undefined
            ? { transmissionRotation: normalizeRotation(to.transmissionRotation ?? to.rotation) }
            : {}),
          gearMounts: cloneGearMounts(sourceWall.gearMounts || [])
        }
        : sourceTile
          ? {
            ...createWall({
              x: to.x,
              y: to.y,
              z: to.z,
              edge: to.edge,
              panelType: sourceTile.panelType,
              transmissionRotation: to.transmissionRotation ?? to.rotation ?? sourceTile.transmissionRotation ?? sourceTile.rotation ?? 0
            }),
            gearMounts: cloneGearMounts(sourceTile.gearMounts || [])
          }
          : null;
      if (!placement) return;
      movedWallPlacements.push(placement);
      const placementKey = registerMovedPlacement(placement, componentId);
      previewWalls.set(placementKey, placement);
      movingEntries.push(createCollisionEntry({
        placement,
        key: placementKey,
        origin: from,
        moving: true
      }));
      return;
    }

    const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
    const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
    const placement = sourceTile
      ? {
        ...sourceTile,
        x: to.x,
        y: to.y,
        z: to.z,
        ...(to.rotation !== undefined ? { rotation: normalizeRotation(to.rotation) } : {}),
        ...(to.transmissionRotation !== undefined || to.rotation !== undefined
          ? { transmissionRotation: normalizeRotation(to.transmissionRotation ?? to.rotation) }
          : {}),
        ...(to.layFlat ? { isVertical: false } : (to.isVertical ? { isVertical: true } : {})),
        gearMounts: cloneGearMounts(sourceTile.gearMounts || [])
      }
      : sourceWall
        ? {
          ...createTile({
            x: to.x,
            y: to.y,
            z: to.z,
            panelType: sourceWall.panelType,
            rotation: to.rotation ?? sourceWall.rotation ?? 0,
            transmissionRotation: to.transmissionRotation ?? to.rotation ?? sourceWall.transmissionRotation ?? sourceWall.rotation ?? 0
          }),
          gearMounts: cloneGearMounts(sourceWall.gearMounts || []),
          isVertical: to.layFlat ? false : sourceWall.isVertical
        }
        : null;
    if (!placement) return;
    movedTilePlacements.push(placement);
    const placementKey = registerMovedPlacement(placement, componentId);
    movedTilePlacementKeys.add(placementKey);
    previewTiles.set(placementKey, placement);
    movingEntries.push(createCollisionEntry({
      placement,
      key: placementKey,
      origin: from,
      moving: true
    }));
  });

  const staticEntries = collectStaticCollisionEntries({
    mapData,
    movingTileKeys: movableTileKeys,
    movingWallKeys: movableWallKeys
  });

  // 新规则1: 检查遮挡（碰撞）
  // 移动物体之间的碰撞（选中物体内部碰撞）
  for (let i = 0; i < movingEntries.length; i += 1) {
    for (let j = i + 1; j < movingEntries.length; j += 1) {
      if (boxSetsIntersect(movingEntries[i].boxes, movingEntries[j].boxes)) {
        addCollisionConflicts(state, movingEntries[i], movingEntries[j]);
      }
    }
  }

  // 移动物体与静态物体的碰撞
  movingEntries.forEach((movingEntry) => {
    staticEntries.forEach((staticEntry) => {
      if (boxSetsIntersect(movingEntry.boxes, staticEntry.boxes)) {
        // 支撑关系豁免：墙体可以穿过其支撑的地板
        if (isSupportCollisionExempt(movingEntry.placement, staticEntry.placement)) return;
        addCollisionConflicts(state, movingEntry, staticEntry);
      }
    });
  });

  return {
    valid: state.conflicts.length === 0,
    moves: moves.map(({ componentId, ...move }) => move),
    conflicts: state.conflicts,
    conflictKeys: state.conflictKeys || undefined,
    invalidPlacementKeys,
    componentResults,
    components,
    componentByPlacementKey,
    componentIdByPlacementKey,
    movedTilePlacements,
    movedWallPlacements,
    anchor: resolvedAnchor,
    translation: { dx, dy, dz },
    previewTiles,
    previewWalls,
    movingTileKeys,
    movingWallKeys,
    targetKey: createCellKey(targetCell.x, targetCell.y, targetCell.z)
  };
};

export const createMoveGhostMapData = ({ mapData = {}, previewTiles = new Map(), previewWalls = new Map() } = {}) => ({
  ...mapData,
  tiles: Object.fromEntries(previewTiles),
  walls: Object.fromEntries(previewWalls),
  entrances: [],
  exits: [],
  safeRoute: [],
  mechanisms: []
});

export const getCityChannelMovePreviewPlacementKey = getPlacementKey;
export { EDGE_NEIGHBOR_OFFSETS, isPortalMaterial };
