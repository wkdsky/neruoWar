import {
  CITY_CHANNEL_TILE_TYPES,
  cloneGearMounts,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell,
  normalizeRotation
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

export const computeCityChannelMovePreviewModel = ({
  mapData = {},
  origins = [],
  targetCell = null,
  anchor = null,
  explicitSurfaceTarget = null,
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
  const dx = targetCell.x - resolvedAnchor.x;
  const dy = targetCell.y - resolvedAnchor.y;
  const dz = (Number(targetCell.z) || 0) - (Number(resolvedAnchor.z) || 0);
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
  const state = {
    conflicts: [],
    conflictKeys: includeConflictKeys ? new Set() : null,
    seenConflictKeys: new Set(),
    componentResults,
    componentByPlacementKey,
    componentIdByPlacementKey,
    invalidPlacementKeys
  };
  const layFlatTarget = !!targetCell?.layFlat && !targetCell?.edge;
  const moves = origins.map((origin) => ({
    from: origin,
    componentId: componentIdByOriginKey.get(getSelectionPlacementKey(origin)) || null,
    to: {
      x: origin.x + dx,
      y: origin.y + dy,
      z: origin.z + dz,
      ...(explicitSurfaceTarget
        ? (explicitSurfaceTarget.edge ? { edge: explicitSurfaceTarget.edge } : {})
        : (
          targetCell.edge && origins.length === 1
            ? { edge: targetCell.edge }
            : (origin.edge && !layFlatTarget ? { edge: origin.edge } : {})
        )),
      ...(targetCell.rotation !== undefined ? { rotation: normalizeRotation(targetCell.rotation) } : {}),
      // 当 carry resolver 判定要 lay flat（将竖直板放平到空地）时，
      // 把这个意图沿着 move 一起传下去，便于下游覆盖 isVertical。
      ...(layFlatTarget ? { layFlat: true } : {})
    }
  }));
  const movedTilePlacements = [];
  const movedWallPlacements = [];
  const movingEntries = [];
  const previewTiles = new Map(Object.entries(mapData.tiles || {}).filter(([key]) => !movingTileKeys.has(key)));
  const previewWalls = new Map(Object.entries(mapData.walls || {}).filter(([key]) => !movingWallKeys.has(key)));
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
          ...(to.rotation !== undefined ? { transmissionRotation: normalizeRotation(to.rotation) } : {}),
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
              transmissionRotation: to.rotation ?? sourceTile.transmissionRotation ?? sourceTile.rotation ?? 0
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
        ...(to.rotation !== undefined ? { transmissionRotation: normalizeRotation(to.rotation) } : {}),
        ...(to.layFlat ? { isVertical: false } : {}),
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
            transmissionRotation: to.rotation ?? sourceWall.transmissionRotation ?? sourceWall.rotation ?? 0
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

  const staticEntries = collectStaticCollisionEntries({ mapData, movingTileKeys, movingWallKeys });

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
