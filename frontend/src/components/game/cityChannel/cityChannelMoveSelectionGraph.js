import {
  createCellKey,
  createWallKey
} from './cityChannelSchema';
import {
  EDGE_NEIGHBOR_OFFSETS,
  isPortalMaterial,
  sameCell
} from './cityChannelPlacementGeometry';

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

export const createWallSelectionKey = (wall) => (
  wall ? createWallKey(wall.x, wall.y, wall.z, wall.edge) : ''
);

export const getSelectionPlacementKey = (placement) => (
  placement?.edge
    ? createWallSelectionKey(placement)
    : createCellKey(placement.x, placement.y, placement.z)
);

export const getMovingPlacementKey = (placement) => (
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

export const getSelectionPlacement = (mapData = {}, origin = {}) => (
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

export const buildSelectionComponents = (mapData = {}, origins = []) => {
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

export const createComponentResult = (component) => ({
  id: component.id,
  indices: component.indices,
  originKeys: new Set(component.originKeys),
  placementKeys: new Set(),
  invalidPlacementKeys: new Set(),
  conflictReasons: new Set(),
  hasConnection: false,
  valid: true
});

export const markComponentPlacementInvalid = (state, placementKey, componentId, reason) => {
  if (!placementKey) return;
  state.invalidPlacementKeys?.add(placementKey);
  const component = componentId ? state.componentResults?.get(componentId) : state.componentByPlacementKey?.get(placementKey);
  if (!component) return;
  component.invalidPlacementKeys.add(placementKey);
  if (reason) component.conflictReasons.add(reason);
  component.valid = false;
};

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
