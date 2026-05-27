import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_WALL_EDGES,
  createCellKey,
  createWallKey,
  getPortalPassAxis,
  isValidCell,
  normalizeCityChannelMap
} from './cityChannelSchema';

const createFailure = (message, checkedCells = 0, route = []) => ({
  ok: false,
  message,
  route,
  checkedCells
});

const createSuccess = (message, checkedCells, route) => ({
  ok: true,
  message,
  route,
  checkedCells
});

const isWalkableTile = (mapData, point) => {
  const tile = mapData.tiles[createCellKey(point.x, point.y, point.z)];
  return !!tile && tile.walkable !== false && tile.solid !== true;
};

const getEdgeBetween = (from, to) => {
  if (to.x === from.x + 1 && to.y === from.y) return CITY_CHANNEL_WALL_EDGES.EAST;
  if (to.x === from.x - 1 && to.y === from.y) return CITY_CHANNEL_WALL_EDGES.WEST;
  if (to.y === from.y + 1 && to.x === from.x) return CITY_CHANNEL_WALL_EDGES.SOUTH;
  if (to.y === from.y - 1 && to.x === from.x) return CITY_CHANNEL_WALL_EDGES.NORTH;
  return null;
};

const getOppositeEdge = (edge) => {
  if (edge === CITY_CHANNEL_WALL_EDGES.EAST) return CITY_CHANNEL_WALL_EDGES.WEST;
  if (edge === CITY_CHANNEL_WALL_EDGES.WEST) return CITY_CHANNEL_WALL_EDGES.EAST;
  if (edge === CITY_CHANNEL_WALL_EDGES.SOUTH) return CITY_CHANNEL_WALL_EDGES.NORTH;
  return CITY_CHANNEL_WALL_EDGES.SOUTH;
};

const isBlockedByWall = (mapData, from, to) => {
  const edge = getEdgeBetween(from, to);
  if (!edge) return false;
  const opposite = getOppositeEdge(edge);
  return Boolean(
    mapData.walls?.[createWallKey(from.x, from.y, from.z, edge)]
    || mapData.walls?.[createWallKey(to.x, to.y, to.z, opposite)]
  );
};

const isPortalTile = (tile) => (
  tile?.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE
  || tile?.panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

const getNeighbors = (mapData, point) => {
  const currentTile = mapData.tiles[createCellKey(point.x, point.y, point.z)];
  const currentIsPortal = isPortalTile(currentTile);
  const currentPassAxis = currentIsPortal ? getPortalPassAxis(currentTile.rotation) : null;

  const candidates = [
    { x: point.x + 1, y: point.y, z: point.z },
    { x: point.x - 1, y: point.y, z: point.z },
    { x: point.x, y: point.y + 1, z: point.z },
    { x: point.x, y: point.y - 1, z: point.z }
  ];

  return candidates.filter((candidate) => {
    if (!isValidCell(candidate.x, candidate.y, candidate.z, mapData)) return false;
    if (!isWalkableTile(mapData, candidate)) return false;
    if (isBlockedByWall(mapData, point, candidate)) return false;

    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;

    if (currentIsPortal) {
      if (currentPassAxis === 'x' && dx === 0) return false;
      if (currentPassAxis === 'y' && dy === 0) return false;
    }

    const candidateTile = mapData.tiles[createCellKey(candidate.x, candidate.y, candidate.z)];
    if (isPortalTile(candidateTile)) {
      const candidateAxis = getPortalPassAxis(candidateTile.rotation);
      if (candidateAxis === 'x' && dx === 0) return false;
      if (candidateAxis === 'y' && dy === 0) return false;
    }

    return true;
  });
};

const rebuildRoute = (parentByKey, endKey) => {
  const route = [];
  let cursor = endKey;
  while (cursor) {
    const point = parentByKey.get(cursor);
    if (!point) break;
    route.push({ x: point.x, y: point.y, z: point.z });
    cursor = point.parentKey;
  }
  return route.reverse();
};

export const validateCityChannelSafeRoute = (rawMapData = {}) => {
  const mapData = normalizeCityChannelMap(rawMapData);
  const entrances = mapData.entrances.filter((point) => isWalkableTile(mapData, point));
  const exits = mapData.exits.filter((point) => isWalkableTile(mapData, point));

  if (mapData.entrances.length <= 0) {
    return createFailure('缺少入口');
  }
  if (mapData.exits.length <= 0) {
    return createFailure('缺少出口');
  }
  if (entrances.length <= 0) {
    return createFailure('入口未放置在可通行板材上');
  }
  if (exits.length <= 0) {
    return createFailure('出口未放置在可通行板材上');
  }

  const exitKeys = new Set(exits.map((point) => createCellKey(point.x, point.y, point.z)));
  const queue = [];
  const visited = new Set();
  const parentByKey = new Map();

  entrances.forEach((entrance) => {
    const key = createCellKey(entrance.x, entrance.y, entrance.z);
    if (visited.has(key)) return;
    visited.add(key);
    parentByKey.set(key, { ...entrance, parentKey: '' });
    queue.push(entrance);
  });

  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = createCellKey(current.x, current.y, current.z);
    if (exitKeys.has(currentKey)) {
      const route = rebuildRoute(parentByKey, currentKey);
      return createSuccess('验证通过：入口可到达出口', visited.size, route);
    }

    const neighbors = getNeighbors(mapData, current);
    for (const neighbor of neighbors) {
      const key = createCellKey(neighbor.x, neighbor.y, neighbor.z);
      if (visited.has(key)) continue;
      visited.add(key);
      parentByKey.set(key, { ...neighbor, parentKey: currentKey });
      if (exitKeys.has(key)) {
        const route = rebuildRoute(parentByKey, key);
        return createSuccess('验证通过：入口可到达出口', visited.size, route);
      }
      queue.push(neighbor);
    }
  }

  return createFailure('入口无法到达出口', visited.size);
};

export default validateCityChannelSafeRoute;
