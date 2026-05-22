import {
  CITY_CHANNEL_TILE_TYPES,
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

const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

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
  const key = `${to.z}:${to.x}:${to.y}:${conflictEdge || 'cell'}:${reason}`;
  if (state.seenConflictKeys?.has(key)) return;
  state.seenConflictKeys?.add(key);
  state.conflicts.push({
    key,
    cell: to,
    edge: conflictEdge,
    reason
  });
  state.conflictKeys?.add(
    conflictEdge
      ? createWallKey(to.x, to.y, to.z, conflictEdge)
      : createCellKey(to.x, to.y, to.z)
  );
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

export const computeCityChannelMovePreviewModel = ({
  mapData = {},
  origins = [],
  targetCell = null,
  explicitSurfaceTarget = null,
  includeConflictKeys = false,
  unsupportedWallReason = 'wall_without_support'
} = {}) => {
  if (!Array.isArray(origins) || origins.length <= 0 || !targetCell) {
    return {
      valid: true,
      moves: [],
      conflicts: [],
      conflictKeys: includeConflictKeys ? new Set() : undefined,
      movedTilePlacements: [],
      movedWallPlacements: [],
      previewTiles: new Map(Object.entries(mapData.tiles || {})),
      previewWalls: new Map(Object.entries(mapData.walls || {})),
      targetKey: targetCell ? createCellKey(targetCell.x, targetCell.y, targetCell.z) : ''
    };
  }

  const anchor = origins[0];
  const dx = targetCell.x - anchor.x;
  const dy = targetCell.y - anchor.y;
  const movingTileKeys = new Set(origins.filter((item) => !item.edge).map((item) => createCellKey(item.x, item.y, item.z)));
  const movingWallKeys = new Set(origins.filter((item) => item.edge).map(createWallSelectionKey));
  const state = {
    conflicts: [],
    conflictKeys: includeConflictKeys ? new Set() : null,
    seenConflictKeys: new Set()
  };
  const moves = origins.map((origin) => ({
    from: origin,
    to: {
      x: origin.x + dx,
      y: origin.y + dy,
      z: origin.z,
      ...(explicitSurfaceTarget
        ? (explicitSurfaceTarget.edge ? { edge: explicitSurfaceTarget.edge } : {})
        : (origin.edge ? { edge: origin.edge } : {}))
    }
  }));
  const movedTilePlacements = [];
  const movedWallPlacements = [];
  const movingEntries = [];

  moves.forEach(({ from, to }) => {
    if (!isValidCell(to.x, to.y, to.z, mapData)) {
      addConflict(state, 'out_of_bounds', to, to.edge || null);
      return;
    }

    if (to.edge) {
      const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
      const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
      const placement = sourceWall
        ? { ...sourceWall, x: to.x, y: to.y, z: to.z, edge: to.edge }
        : sourceTile
          ? createWall({
            x: to.x,
            y: to.y,
            z: to.z,
            edge: to.edge,
            panelType: sourceTile.panelType,
            transmissionRotation: sourceTile.transmissionRotation ?? sourceTile.rotation ?? 0
          })
          : null;
      if (!placement) return;
      movedWallPlacements.push(placement);
      movingEntries.push(createCollisionEntry({
        placement,
        key: createWallSelectionKey(to),
        origin: from,
        moving: true
      }));
      return;
    }

    const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
    const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
    const placement = sourceTile
      ? { ...sourceTile, x: to.x, y: to.y, z: to.z }
      : sourceWall
        ? createTile({
          x: to.x,
          y: to.y,
          z: to.z,
          panelType: sourceWall.panelType,
          transmissionRotation: sourceWall.transmissionRotation || 0
        })
        : null;
    if (!placement) return;
    movedTilePlacements.push(placement);
    movingEntries.push(createCollisionEntry({
      placement,
      key: createCellKey(to.x, to.y, to.z),
      origin: from,
      moving: true
    }));
  });

  const staticEntries = collectStaticCollisionEntries({ mapData, movingTileKeys, movingWallKeys });
  for (let i = 0; i < movingEntries.length; i += 1) {
    for (let j = i + 1; j < movingEntries.length; j += 1) {
      if (boxSetsIntersect(movingEntries[i].boxes, movingEntries[j].boxes)) {
        addCollisionConflicts(state, movingEntries[i], movingEntries[j]);
      }
    }
    staticEntries.forEach((staticEntry) => {
      if (boxSetsIntersect(movingEntries[i].boxes, staticEntry.boxes)) {
        addCollisionConflicts(state, movingEntries[i], staticEntry);
      }
    });
  }

  const previewTiles = new Map(Object.entries(mapData.tiles || {}).filter(([key]) => !movingTileKeys.has(key)));
  const previewWalls = new Map(Object.entries(mapData.walls || {}).filter(([key]) => !movingWallKeys.has(key)));
  movedTilePlacements.forEach((tile) => {
    previewTiles.set(createCellKey(tile.x, tile.y, tile.z), tile);
  });
  movedWallPlacements.forEach((wall) => {
    previewWalls.set(createWallKey(wall.x, wall.y, wall.z, wall.edge), wall);
  });

  moves.forEach(({ to }) => {
    if (!to.edge || !isValidCell(to.x, to.y, to.z, mapData)) return;
    const ownCellKey = createCellKey(to.x, to.y, to.z);
    const neighborOffset = EDGE_NEIGHBOR_OFFSETS[to.edge] || EDGE_NEIGHBOR_OFFSETS.north;
    const neighbor = { x: to.x + neighborOffset.x, y: to.y + neighborOffset.y, z: to.z };
    const neighborKey = createCellKey(neighbor.x, neighbor.y, neighbor.z);
    const hasOwnSupport = !!previewTiles.get(ownCellKey);
    const hasNeighborSupport = !!previewTiles.get(neighborKey);
    if (!explicitSurfaceTarget && !hasOwnSupport && !hasNeighborSupport) {
      addConflict(state, unsupportedWallReason, to, to.edge);
    }
  });

  return {
    valid: state.conflicts.length === 0,
    moves,
    conflicts: state.conflicts,
    conflictKeys: state.conflictKeys || undefined,
    movedTilePlacements,
    movedWallPlacements,
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
