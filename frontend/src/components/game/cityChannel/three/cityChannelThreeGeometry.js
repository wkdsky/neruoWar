import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_TOOLS,
  CITY_CHANNEL_WALL_EDGES,
  CITY_CHANNEL_WIDTH,
  createCellKey,
  isValidCell,
  createWallKey,
  normalizeCityChannelMap,
  normalizeRotation,
  normalizeWallEdge,
  wallEdgeToRotation
} from '../cityChannelSchema';
import {
  EDGE_NEIGHBOR_OFFSETS,
  isPortalMaterial
} from '../cityChannelPlacementGeometry';
import { normalizeGearSurfaceForPanel } from '../cityChannelGearPressurePlateRender';
import { CITY_CHANNEL_GEAR_THICKNESS_WORLD } from '../cityChannelMechanismSimulation';

export const CITY_CHANNEL_THREE_DIMENSIONS = Object.freeze({
  tileSize: 1,
  tileThickness: 0.08,
  wallThickness: 0.08,
  wallHeight: 1,
  layerHeight: 1
});

const edgeOffsets = Object.freeze({
  north: { x: 0, z: -0.5 },
  east: { x: 0.5, z: 0 },
  south: { x: 0, z: 0.5 },
  west: { x: -0.5, z: 0 }
});

const oppositeEdges = Object.freeze({
  north: CITY_CHANNEL_WALL_EDGES.SOUTH,
  east: CITY_CHANNEL_WALL_EDGES.WEST,
  south: CITY_CHANNEL_WALL_EDGES.NORTH,
  west: CITY_CHANNEL_WALL_EDGES.EAST
});

const wallSideNeighborOffsets = Object.freeze({
  north: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
  south: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
  east: [{ x: 0, y: -1 }, { x: 0, y: 1 }],
  west: [{ x: 0, y: -1 }, { x: 0, y: 1 }]
});

const gearSocketLocalPoints = Object.freeze({
  center: { x: 0, y: 0 },
  corner_nw: { x: -0.5, y: -0.5 },
  corner_ne: { x: 0.5, y: -0.5 },
  corner_sw: { x: -0.5, y: 0.5 },
  corner_se: { x: 0.5, y: 0.5 }
});

const rotateLocalPoint = (point = {}, degrees = 0) => {
  const radians = normalizeRotation(degrees) * Math.PI / 180;
  const x = Number(point.x) || 0;
  const y = Number(point.y) || 0;
  return {
    x: (x * Math.cos(radians)) - (y * Math.sin(radians)),
    y: (x * Math.sin(radians)) + (y * Math.cos(radians))
  };
};

const getPlacementSurfaceRotation = (placement = {}) => normalizeRotation(
  (placement.transmissionRotation ?? placement.rotation ?? 0)
  + (Number(placement.runtimeSurfaceRotation) || 0)
);

const cleanAxisValue = (value = 0) => (Math.abs(value) <= 0.000001 ? 0 : value);

const rotateMapPlaneVector = (point = {}, degrees = 0) => {
  const rotated = rotateLocalPoint(point, degrees);
  return {
    x: cleanAxisValue(rotated.x),
    z: cleanAxisValue(rotated.y)
  };
};

const getSurfaceSign = (transform = {}, surface = 'front') => (
  normalizeGearSurfaceForPanel(transform.placement?.panelType || transform.panelType, surface) === 'back'
    ? -1
    : 1
);

const getWallSurfaceFrame = (transform = {}, surface = 'front') => {
  const edge = normalizeWallEdge(transform.edge || transform.placement?.edge || 'north');
  const tangents = {
    north: { x: 1, z: 0 },
    east: { x: 0, z: 1 },
    south: { x: 1, z: 0 },
    west: { x: 0, z: 1 }
  };
  const sign = getSurfaceSign(transform, surface);
  const runsEastWest = edge === CITY_CHANNEL_WALL_EDGES.NORTH || edge === CITY_CHANNEL_WALL_EDGES.SOUTH;
  return {
    tangent: tangents[edge] || tangents.north,
    normal: {
      x: runsEastWest ? 0 : sign,
      z: runsEastWest ? sign : 0
    }
  };
};

const getVerticalTileSurfaceFrame = (transform = {}, surface = 'front') => {
  const rotation = normalizeRotation(transform.placement?.rotation || 0);
  const tangent = rotateMapPlaneVector({ x: 1, y: 0 }, rotation);
  const sign = getSurfaceSign(transform, surface);
  const axisIsX = (transform.size?.x || 0) >= (transform.size?.z || 0);
  return {
    tangent,
    normal: {
      x: axisIsX ? 0 : sign,
      z: axisIsX ? sign : 0
    }
  };
};

const getVerticalSurfaceFrame = (transform = {}, surface = 'front') => (
  transform.kind === 'wall'
    ? getWallSurfaceFrame(transform, surface)
    : getVerticalTileSurfaceFrame(transform, surface)
);

export const getThreeMapCenter = (mapData = {}) => ({
  x: ((Number.isInteger(mapData.width) ? mapData.width : CITY_CHANNEL_WIDTH) - 1) / 2,
  y: ((Number.isInteger(mapData.height) ? mapData.height : CITY_CHANNEL_HEIGHT) - 1) / 2
});

export const cellToThreePosition = (cell = {}, mapData = {}, dimensions = CITY_CHANNEL_THREE_DIMENSIONS) => {
  const center = getThreeMapCenter(mapData);
  return {
    x: (Number(cell.x) || 0) - center.x,
    y: ((Number(cell.z) || 0) * dimensions.layerHeight) + (dimensions.tileThickness * 0.5),
    z: (Number(cell.y) || 0) - center.y
  };
};

export const threePositionToCell = (position = {}, mapData = {}, layer = 0) => {
  const center = getThreeMapCenter(mapData);
  const x = Math.round((Number(position.x) || 0) + center.x);
  const y = Math.round((Number(position.z) || 0) + center.y);
  const z = Number.isInteger(layer) ? layer : 0;
  return isValidCell(x, y, z, mapData) ? { x, y, z } : null;
};

export const getThreeCellLocalOffset = (position = {}, mapData = {}, cell = null) => {
  if (!cell) return null;
  const center = getThreeMapCenter(mapData);
  return {
    x: (Number(position.x) || 0) + center.x - cell.x,
    z: (Number(position.z) || 0) + center.y - cell.y
  };
};

export const getThreeNearestCellEdge = (position = {}, mapData = {}, cellOrLayer = 0) => {
  const cell = cellOrLayer && typeof cellOrLayer === 'object'
    ? cellOrLayer
    : threePositionToCell(position, mapData, Number.isInteger(cellOrLayer) ? cellOrLayer : 0);
  const local = getThreeCellLocalOffset(position, mapData, cell);
  if (!cell || !local) return null;
  const candidates = [
    { edge: CITY_CHANNEL_WALL_EDGES.NORTH, distance: Math.abs(local.z + 0.5) },
    { edge: CITY_CHANNEL_WALL_EDGES.EAST, distance: Math.abs(0.5 - local.x) },
    { edge: CITY_CHANNEL_WALL_EDGES.SOUTH, distance: Math.abs(0.5 - local.z) },
    { edge: CITY_CHANNEL_WALL_EDGES.WEST, distance: Math.abs(local.x + 0.5) }
  ];
  const nearest = candidates.reduce((best, candidate) => (
    candidate.distance < best.distance ? candidate : best
  ), candidates[0]);
  return {
    cell: { x: cell.x, y: cell.y, z: cell.z },
    edge: nearest.edge,
    local,
    distance: nearest.distance
  };
};

export const isThreeWallPhysicalPlaneOccupied = ({ mapData = {}, cell = null, edge = CITY_CHANNEL_WALL_EDGES.NORTH } = {}) => {
  if (!cell) return false;
  const normalizedEdge = normalizeWallEdge(edge);
  const ownKey = createWallKey(cell.x, cell.y, cell.z, normalizedEdge);
  if (mapData.walls?.[ownKey]) return true;
  const offset = EDGE_NEIGHBOR_OFFSETS[normalizedEdge] || EDGE_NEIGHBOR_OFFSETS.north;
  const opposite = oppositeEdges[normalizedEdge] || CITY_CHANNEL_WALL_EDGES.SOUTH;
  const neighborKey = createWallKey(
    cell.x + offset.x,
    cell.y + offset.y,
    cell.z,
    opposite
  );
  return !!mapData.walls?.[neighborKey];
};

export const hasThreeWallSupport = ({
  mapData = {},
  cell = null,
  edge = CITY_CHANNEL_WALL_EDGES.NORTH,
  visited = new Set()
} = {}) => {
  if (!cell || !isValidCell(cell.x, cell.y, cell.z, mapData)) return false;
  const normalizedEdge = normalizeWallEdge(edge);
  const supportKey = createWallKey(cell.x, cell.y, cell.z, normalizedEdge);
  if (visited.has(supportKey)) return false;
  visited.add(supportKey);
  const offset = EDGE_NEIGHBOR_OFFSETS[normalizedEdge] || EDGE_NEIGHBOR_OFFSETS.north;
  const neighbor = {
    x: cell.x + offset.x,
    y: cell.y + offset.y,
    z: cell.z
  };
  const hasSupportingFloor = (candidate) => {
    const tile = mapData.tiles?.[createCellKey(candidate.x, candidate.y, candidate.z)];
    return !!tile && !tile.isVertical;
  };
  if (hasSupportingFloor(cell) || hasSupportingFloor(neighbor)) return true;
  if (cell.z > 0) {
    const belowOwn = { x: cell.x, y: cell.y, z: cell.z - 1 };
    const belowNeighbor = { x: neighbor.x, y: neighbor.y, z: neighbor.z - 1 };
    if (hasSupportingFloor(belowOwn) || hasSupportingFloor(belowNeighbor)) return true;
    if (mapData.walls?.[createWallKey(cell.x, cell.y, cell.z - 1, normalizedEdge)]) return true;
  }
  return (wallSideNeighborOffsets[normalizedEdge] || []).some((sideOffset) => {
    const sideCell = {
      x: cell.x + sideOffset.x,
      y: cell.y + sideOffset.y,
      z: cell.z
    };
    if (!isValidCell(sideCell.x, sideCell.y, sideCell.z, mapData)) return false;
    if (!mapData.walls?.[createWallKey(sideCell.x, sideCell.y, sideCell.z, normalizedEdge)]) return false;
    return hasThreeWallSupport({
      mapData,
      cell: sideCell,
      edge: normalizedEdge,
      visited: new Set(visited)
    });
  });
};

export const getThreeWallPlacementBlockReason = ({
  cell = null,
  edge = CITY_CHANNEL_WALL_EDGES.NORTH,
  mapData = {},
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  activeTileType = null,
  allowReplacement = false
} = {}) => {
  if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !activeTileType || !cell) return 'inactive';
  if (isPortalMaterial(activeTileType)) return 'invalidMaterial';
  if (!isValidCell(cell.x, cell.y, cell.z, mapData)) return 'invalidCell';
  if (!allowReplacement && isThreeWallPhysicalPlaneOccupied({ mapData, cell, edge })) return 'occupied';
  if (!hasThreeWallSupport({ mapData, cell, edge })) return 'unsupported';
  return null;
};

export const createThreeTilePlacementOperation = ({
  cell = null,
  mapData = {},
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  activeTileType = null,
  activeRotation = 0,
  allowReplacement = false,
  isVertical = false
} = {}) => {
  if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !activeTileType || !cell) return null;
  if (isVertical && isPortalMaterial(activeTileType)) return null;
  if (!isValidCell(cell.x, cell.y, cell.z, mapData)) return null;
  const key = createCellKey(cell.x, cell.y, cell.z);
  if (!allowReplacement && mapData.tiles?.[key]) return null;
  return {
    kind: 'tile',
    action: 'place',
    cell: { x: cell.x, y: cell.y, z: cell.z },
    panelType: activeTileType,
    rotation: normalizeRotation(activeRotation),
    transmissionRotation: normalizeRotation(activeRotation),
    ...(isVertical ? { isVertical: true } : {})
  };
};

export const createThreeWallPlacementOperation = ({
  cell = null,
  edge = CITY_CHANNEL_WALL_EDGES.NORTH,
  mapData = {},
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  activeTileType = null,
  activeRotation = 0,
  allowReplacement = false
} = {}) => {
  const blockReason = getThreeWallPlacementBlockReason({
    cell,
    edge,
    mapData,
    activeTool,
    activeTileType,
    allowReplacement
  });
  if (blockReason) return null;
  return {
    kind: 'wall',
    action: 'place',
    cell: { x: cell.x, y: cell.y, z: cell.z },
    edge: normalizeWallEdge(edge),
    panelType: activeTileType,
    transmissionRotation: normalizeRotation(activeRotation)
  };
};

export const isThreeVerticalSupportPlacement = (placement = null) => (
  !!placement && (!!placement.edge || !!placement.isVertical)
);

const hasHorizontalTile = (mapData = {}, cell = null) => {
  if (!cell) return false;
  const tile = mapData.tiles?.[createCellKey(cell.x, cell.y, cell.z)];
  return !!tile && !tile.isVertical;
};

const getThreePlacementVisibilityKey = (placement = null) => {
  if (!placement) return '';
  return placement.edge
    ? `wall:${createWallKey(placement.x, placement.y, placement.z, placement.edge)}`
    : `tile:${createCellKey(placement.x, placement.y, placement.z)}`;
};

const hasVisibleWallFloorSupport = (placement = {}, mapData = {}, cutoff = 0) => {
  const z = Number(placement.z) || 0;
  const edge = normalizeWallEdge(placement.edge);
  const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
  const cells = [
    { x: Number(placement.x) || 0, y: Number(placement.y) || 0, z },
    {
      x: (Number(placement.x) || 0) + offset.x,
      y: (Number(placement.y) || 0) + offset.y,
      z
    },
    { x: Number(placement.x) || 0, y: Number(placement.y) || 0, z: z - 1 },
    {
      x: (Number(placement.x) || 0) + offset.x,
      y: (Number(placement.y) || 0) + offset.y,
      z: z - 1
    }
  ];
  return cells.some((cell) => cell.z <= cutoff && hasHorizontalTile(mapData, cell));
};

const getLowerVerticalAttachment = (placement = {}, mapData = {}) => {
  const z = Number(placement.z) || 0;
  if (z <= 0) return null;
  if (placement.edge) {
    return mapData.walls?.[createWallKey(placement.x, placement.y, z - 1, placement.edge)] || null;
  }
  if (placement.isVertical) {
    const lowerTile = mapData.tiles?.[createCellKey(placement.x, placement.y, z - 1)];
    return lowerTile?.isVertical ? lowerTile : null;
  }
  return null;
};

const hasVisibleVerticalTileBaseSupport = (placement = {}, mapData = {}, cutoff = 0) => {
  const z = Number(placement.z) || 0;
  const lowerTile = z > 0
    ? mapData.tiles?.[createCellKey(placement.x, placement.y, z - 1)]
    : null;
  return !!lowerTile && !lowerTile.isVertical && (Number(lowerTile.z) || 0) <= cutoff;
};

const isVerticalAttachmentConnectedToVisibleLayer = (placement = {}, mapData = {}, cutoff = 0) => {
  const seen = new Set();
  let current = placement;
  while (current && isThreeVerticalSupportPlacement(current)) {
    const z = Number(current.z) || 0;
    if (z <= cutoff) return true;
    const key = getThreePlacementVisibilityKey(current);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (current.edge && hasVisibleWallFloorSupport(current, mapData, cutoff)) return true;
    if (current.isVertical && hasVisibleVerticalTileBaseSupport(current, mapData, cutoff)) return true;
    current = getLowerVerticalAttachment(current, mapData);
  }
  return false;
};

const isSameCell = (left = null, right = null) => (
  !!left
  && !!right
  && Number(left.x) === Number(right.x)
  && Number(left.y) === Number(right.y)
  && Number(left.z) === Number(right.z)
);

const getVerticalSupportTransform = (supportPlacement = null, mapData = {}) => {
  if (!supportPlacement) return null;
  if (supportPlacement.edge) return getWallThreeTransform(supportPlacement, mapData);
  if (supportPlacement.isVertical) return getTileThreeTransform(supportPlacement, mapData);
  return null;
};

const isHorizontalTileConnectedToVisibleVerticalSupport = (placement = {}, mapData = {}, cutoff = 0) => {
  if (!placement || placement.edge || placement.isVertical) return false;
  const targetCell = {
    x: Number(placement.x) || 0,
    y: Number(placement.y) || 0,
    z: Number(placement.z) || 0
  };
  const supports = [
    ...Object.values(mapData.walls || {}),
    ...Object.values(mapData.tiles || {}).filter((tile) => tile?.isVertical)
  ];
  return supports.some((supportPlacement) => {
    if (!isThreeVerticalSupportPlacement(supportPlacement)) return false;
    const supportZ = Number(supportPlacement.z) || 0;
    const zOffset = targetCell.z - supportZ;
    if (zOffset !== 0 && zOffset !== 1) return false;
    if (!isVerticalAttachmentConnectedToVisibleLayer(supportPlacement, mapData, cutoff)) return false;
    const supportTransform = getVerticalSupportTransform(supportPlacement, mapData);
    return ['front', 'back'].some((surface) => isSameCell(
      targetCell,
      getThreeVerticalFaceFloorPlacementCell(supportPlacement, supportTransform, surface, zOffset)
    ));
  });
};

export const isThreePlacementVisible = (placement = {}, {
  mapData = {},
  visibleLayerCutoff = null
} = {}) => {
  if (visibleLayerCutoff === null) return true;
  const cutoff = Number.isFinite(Number(visibleLayerCutoff))
    ? Number(visibleLayerCutoff)
    : 0;
  const z = Number(placement?.z) || 0;
  if (z <= cutoff) return true;
  if (isHorizontalTileConnectedToVisibleVerticalSupport(placement, mapData, cutoff)) return true;
  if (!isThreeVerticalSupportPlacement(placement)) return false;
  return isVerticalAttachmentConnectedToVisibleLayer(placement, mapData, cutoff);
};

export const getThreeVerticalTileRotationForSupport = (supportPlacement = {}) => (
  supportPlacement.edge
    ? wallEdgeToRotation(supportPlacement.edge)
    : normalizeRotation(supportPlacement.rotation || 0)
);

export const getThreeVerticalTilePlacementCell = (supportPlacement = {}) => (
  isThreeVerticalSupportPlacement(supportPlacement)
    ? {
      x: Number(supportPlacement.x) || 0,
      y: Number(supportPlacement.y) || 0,
      z: (Number(supportPlacement.z) || 0) + 1
    }
    : null
);

export const getThreeVerticalTopPlacementTarget = (supportPlacement = {}) => {
  const cell = getThreeVerticalTilePlacementCell(supportPlacement);
  if (!cell) return null;
  if (supportPlacement.edge) {
    return {
      kind: 'wall',
      cell,
      edge: normalizeWallEdge(supportPlacement.edge)
    };
  }
  return {
    kind: 'verticalTile',
    cell,
    rotation: getThreeVerticalTileRotationForSupport(supportPlacement)
  };
};

export const getThreeVerticalFaceFloorPlacementCell = (
  supportPlacement = {},
  supportTransform = {},
  surface = 'front',
  zOffset = 0
) => {
  if (!isThreeVerticalSupportPlacement(supportPlacement) || !supportTransform) return null;
  const z = (Number(supportPlacement.z) || 0) + (Number(zOffset) || 0);
  const rawSurfaceSign = surface === 'back' ? -1 : 1;
  const frontFrame = getVerticalSurfaceFrame(supportTransform, 'front');
  const normal = {
    x: (frontFrame.normal.x || 0) * rawSurfaceSign,
    z: (frontFrame.normal.z || 0) * rawSurfaceSign
  };
  if (supportPlacement.edge) {
    const edge = normalizeWallEdge(supportPlacement.edge);
    const offset = EDGE_NEIGHBOR_OFFSETS[edge] || EDGE_NEIGHBOR_OFFSETS.north;
    const normalDotEdge = ((normal.x || 0) * (offset.x || 0)) + ((normal.z || 0) * (offset.y || 0));
    return normalDotEdge >= 0
      ? {
        x: (Number(supportPlacement.x) || 0) + offset.x,
        y: (Number(supportPlacement.y) || 0) + offset.y,
        z
      }
      : {
        x: Number(supportPlacement.x) || 0,
        y: Number(supportPlacement.y) || 0,
        z
      };
  }
  const normalX = Math.abs(normal.x || 0) >= Math.abs(normal.z || 0)
    ? Math.sign(normal.x || 0)
    : 0;
  const normalY = normalX === 0 ? Math.sign(normal.z || 0) : 0;
  return {
    x: (Number(supportPlacement.x) || 0) + normalX,
    y: (Number(supportPlacement.y) || 0) + normalY,
    z
  };
};

export const isThreeVerticalSupportTopHit = (supportTransform = {}, hitPoint = null, threshold = 0.22) => {
  if (!hitPoint || !supportTransform?.size || !supportTransform?.position) return false;
  if (supportTransform.kind !== 'wall' && supportTransform.kind !== 'verticalTile') return false;
  const topY = supportTransform.position.y + (supportTransform.size.y * 0.5);
  return hitPoint.y >= topY - threshold;
};

export const getThreeVerticalTilePlacementBlockReason = ({
  supportPlacement = null,
  cell = null,
  mapData = {},
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  activeTileType = null,
  allowReplacement = false
} = {}) => {
  if (activeTool !== CITY_CHANNEL_TOOLS.PLACE_TILE || !activeTileType) return 'inactive';
  if (isPortalMaterial(activeTileType)) return 'invalidMaterial';
  if (!supportPlacement?.isVertical || supportPlacement.edge) return 'unsupported';
  const targetCell = cell || getThreeVerticalTilePlacementCell(supportPlacement);
  if (!targetCell || !isValidCell(targetCell.x, targetCell.y, targetCell.z, mapData)) return 'invalidCell';
  if (!allowReplacement && mapData.tiles?.[createCellKey(targetCell.x, targetCell.y, targetCell.z)]) return 'occupied';
  return null;
};

export const createThreeVerticalTilePlacementOperation = ({
  supportPlacement = null,
  cell = null,
  mapData = {},
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  activeTileType = null,
  allowReplacement = false
} = {}) => {
  const targetCell = cell || getThreeVerticalTilePlacementCell(supportPlacement);
  const blockReason = getThreeVerticalTilePlacementBlockReason({
    supportPlacement,
    cell: targetCell,
    mapData,
    activeTool,
    activeTileType,
    allowReplacement
  });
  if (blockReason) return null;
  const rotation = getThreeVerticalTileRotationForSupport(supportPlacement);
  return {
    kind: 'tile',
    action: 'place',
    cell: { x: targetCell.x, y: targetCell.y, z: targetCell.z },
    panelType: activeTileType,
    rotation,
    transmissionRotation: rotation,
    isVertical: true
  };
};

export const getTileThreeTransform = (tile = {}, mapData = {}, dimensions = CITY_CHANNEL_THREE_DIMENSIONS) => {
  const position = cellToThreePosition(tile, mapData, dimensions);
  if (!tile.isVertical) {
    return {
      kind: 'tile',
      key: createCellKey(tile.x, tile.y, tile.z),
      panelType: tile.panelType,
      size: {
        x: dimensions.tileSize,
        y: dimensions.tileThickness,
        z: dimensions.tileSize
      },
      position,
      rotationY: normalizeRotation(tile.rotation || 0) * Math.PI / 180,
      placement: tile
    };
  }

  const rotation = normalizeRotation(tile.rotation || 0);
  const verticalAxisIsX = rotation === 0 || rotation === 180;
  return {
    kind: 'verticalTile',
    key: createCellKey(tile.x, tile.y, tile.z),
    panelType: tile.panelType,
    size: {
      x: verticalAxisIsX ? dimensions.tileSize : dimensions.wallThickness,
      y: dimensions.wallHeight,
      z: verticalAxisIsX ? dimensions.wallThickness : dimensions.tileSize
    },
    position: {
      ...position,
      y: ((Number(tile.z) || 0) * dimensions.layerHeight) + (dimensions.wallHeight * 0.5)
    },
    rotationY: 0,
    placement: tile
  };
};

export const getWallThreeTransform = (wall = {}, mapData = {}, dimensions = CITY_CHANNEL_THREE_DIMENSIONS) => {
  const base = cellToThreePosition(wall, mapData, dimensions);
  const edge = normalizeWallEdge(wall.edge);
  const offset = edgeOffsets[edge] || edgeOffsets.north;
  const wallRunsEastWest = edge === 'north' || edge === 'south';
  return {
    kind: 'wall',
    key: createWallKey(wall.x, wall.y, wall.z, edge),
    panelType: wall.panelType,
    edge,
    size: {
      x: wallRunsEastWest ? dimensions.tileSize : dimensions.wallThickness,
      y: dimensions.wallHeight,
      z: wallRunsEastWest ? dimensions.wallThickness : dimensions.tileSize
    },
    position: {
      x: base.x + offset.x,
      y: ((Number(wall.z) || 0) * dimensions.layerHeight) + (dimensions.wallHeight * 0.5),
      z: base.z + offset.z
    },
    rotationY: 0,
    placement: wall
  };
};

export const getThreeSurfacePoint = (
  transform = {},
  localPoint = {},
  {
    lift = 0.012,
    embedded = false,
    rotate = true,
    surface = 'front'
  } = {}
) => {
  const placement = transform.placement || {};
  const local = rotate
    ? rotateLocalPoint(localPoint, getPlacementSurfaceRotation(placement))
    : {
      x: Number(localPoint.x) || 0,
      y: Number(localPoint.y) || 0
    };
  const position = transform.position || { x: 0, y: 0, z: 0 };
  const size = transform.size || { x: 1, y: 0.08, z: 1 };

  if (transform.kind === 'tile') {
    return {
      x: position.x + local.x,
      y: embedded ? position.y : position.y + (size.y * 0.5) + lift,
      z: position.z + local.y
    };
  }

  if (transform.kind === 'verticalTile') {
    const frame = getVerticalSurfaceFrame(transform, surface);
    return {
      x: position.x + ((frame.tangent.x || 0) * local.x) + ((frame.normal.x || 0) * lift),
      y: position.y - local.y,
      z: position.z + ((frame.tangent.z || 0) * local.x) + ((frame.normal.z || 0) * lift)
    };
  }

  const frame = getVerticalSurfaceFrame(transform, surface);
  return {
    x: position.x + ((frame.tangent.x || 0) * local.x) + ((frame.normal.x || 0) * lift),
    y: position.y - local.y,
    z: position.z + ((frame.tangent.z || 0) * local.x) + ((frame.normal.z || 0) * lift)
  };
};

export const getThreeSurfaceNormal = (transform = {}, surface = 'front') => {
  if (transform.kind === 'tile') return { x: 0, y: 1, z: 0 };
  const frame = getVerticalSurfaceFrame(transform, surface);
  return { x: frame.normal.x || 0, y: 0, z: frame.normal.z || 0 };
};

export const getThreeGearSurfacePoint = (transform = {}, mount = {}) => (
  getThreeSurfacePoint(transform, gearSocketLocalPoints[mount.position] || gearSocketLocalPoints.center, {
    lift: 0,
    embedded: true,
    rotate: transform.kind === 'tile',
    surface: mount.surface || 'front'
  })
);

export const resolveThreeHoverSnapIntent = (
  transform = {},
  local = null,
  {
    centerReplacementRadius = 0.31,
    wallEdgeSnapWorldRadius = 0.18,
    verticalCenterRadius = 0.42
  } = {}
) => {
  if (!transform || !local) return null;
  if (transform.kind === 'tile') {
    const distances = [
      { edge: CITY_CHANNEL_WALL_EDGES.NORTH, distance: Math.abs((Number(local.y) || 0) + 0.5) },
      { edge: CITY_CHANNEL_WALL_EDGES.EAST, distance: Math.abs(0.5 - (Number(local.x) || 0)) },
      { edge: CITY_CHANNEL_WALL_EDGES.SOUTH, distance: Math.abs(0.5 - (Number(local.y) || 0)) },
      { edge: CITY_CHANNEL_WALL_EDGES.WEST, distance: Math.abs((Number(local.x) || 0) + 0.5) }
    ].sort((left, right) => left.distance - right.distance);
    const centerDistance = Math.hypot(Number(local.x) || 0, Number(local.y) || 0);
    return {
      local,
      centerDistance,
      edge: distances[0]?.edge || CITY_CHANNEL_WALL_EDGES.NORTH,
      edgeDistance: distances[0]?.distance ?? Infinity,
      zone: centerDistance <= centerReplacementRadius
        ? 'center'
        : (distances[0]?.distance <= wallEdgeSnapWorldRadius ? 'edge' : 'body')
    };
  }

  const halfLength = ((transform.size?.x || 0) >= (transform.size?.z || 0) ? transform.size?.x : transform.size?.z) * 0.5;
  const horizontalDistances = [
    { side: 'left', distance: Math.abs((Number(local.x) || 0) + halfLength) },
    { side: 'right', distance: Math.abs(halfLength - (Number(local.x) || 0)) }
  ].sort((left, right) => left.distance - right.distance);
  const halfHeight = (transform.size?.y || 1) * 0.5;
  const topDistance = Math.abs((Number(local.y) || 0) + halfHeight);
  const centerDistance = Math.hypot(
    (Number(local.x) || 0) / Math.max(0.001, halfLength),
    (Number(local.y) || 0) / Math.max(0.001, halfHeight)
  );
  const zone = centerDistance <= verticalCenterRadius
    ? 'center'
    : (topDistance <= wallEdgeSnapWorldRadius ? 'top' : 'side');
  return {
    local,
    centerDistance,
    side: horizontalDistances[0]?.side || 'left',
    sideDistance: horizontalDistances[0]?.distance ?? Infinity,
    topDistance,
    zone
  };
};

export const getThreeTransmissionLineSegments = (transform = {}) => {
  const ports = transform.placement?.transmissionSkeleton?.ports || [];
  if (!Array.isArray(ports) || ports.length <= 0) return [];
  const center = getThreeSurfacePoint(transform, { x: 0, y: 0 }, { lift: 0.028 });
  return ports.map((port) => {
    const end = getThreeSurfacePoint(transform, port.localPosition || {}, { lift: 0.028 });
    return { start: center, end, port };
  });
};

export const buildCityChannelThreeRenderModel = (rawMapData = {}) => {
  const mapData = normalizeCityChannelMap(rawMapData);
  return {
    mapData,
    tiles: Object.values(mapData.tiles || {}).map((tile) => getTileThreeTransform(tile, mapData)),
    walls: Object.values(mapData.walls || {}).map((wall) => getWallThreeTransform(wall, mapData))
  };
};
