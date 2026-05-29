import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_LAYERS,
  CITY_CHANNEL_WALL_EDGES,
  CITY_CHANNEL_WIDTH
} from './constants';

export const createCellKey = (x, y, z) => `${z}:${x}:${y}`;
export const createWallKey = (x, y, z, edge = CITY_CHANNEL_WALL_EDGES.NORTH) => `${z}:${x}:${y}:${edge}`;

export const parseCellKey = (key = '') => {
  const [z, x, y] = String(key || '').split(':').map((part) => Number.parseInt(part, 10));
  return {
    x: Number.isInteger(x) ? x : 0,
    y: Number.isInteger(y) ? y : 0,
    z: Number.isInteger(z) ? z : 0
  };
};

export const isValidCell = (x, y, z, mapData = null) => {
  const width = Number.isInteger(mapData?.width) ? mapData.width : CITY_CHANNEL_WIDTH;
  const height = Number.isInteger(mapData?.height) ? mapData.height : CITY_CHANNEL_HEIGHT;
  const layers = Number.isInteger(mapData?.layers) ? mapData.layers : CITY_CHANNEL_LAYERS;
  return (
  Number.isInteger(x)
  && Number.isInteger(y)
  && Number.isInteger(z)
  && x >= 0
  && y >= 0
  && z >= 0
  && x < width
  && y < height
  && z < layers
  );
};

export const clampLayer = (layer, layers = CITY_CHANNEL_LAYERS) => {
  const parsed = Number.parseInt(layer, 10);
  const layerCount = Number.isInteger(layers) && layers > 0 ? layers : CITY_CHANNEL_LAYERS;
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(layerCount - 1, parsed));
};

export const normalizeRotation = (rotation = 0) => {
  const parsed = Number.parseInt(rotation, 10);
  if (!Number.isInteger(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
};

export const normalizeWallEdge = (edge = CITY_CHANNEL_WALL_EDGES.NORTH) => (
  Object.values(CITY_CHANNEL_WALL_EDGES).includes(edge) ? edge : CITY_CHANNEL_WALL_EDGES.NORTH
);

export const wallEdgeToRotation = (edge = CITY_CHANNEL_WALL_EDGES.NORTH) => {
  const normalized = normalizeWallEdge(edge);
  if (normalized === CITY_CHANNEL_WALL_EDGES.EAST) return 90;
  if (normalized === CITY_CHANNEL_WALL_EDGES.SOUTH) return 180;
  if (normalized === CITY_CHANNEL_WALL_EDGES.WEST) return 270;
  return 0;
};

export const rotationToWallEdge = (rotation = 0) => {
  const normalized = normalizeRotation(rotation);
  if (normalized >= 45 && normalized < 135) return CITY_CHANNEL_WALL_EDGES.EAST;
  if (normalized >= 135 && normalized < 225) return CITY_CHANNEL_WALL_EDGES.SOUTH;
  if (normalized >= 225 && normalized < 315) return CITY_CHANNEL_WALL_EDGES.WEST;
  return CITY_CHANNEL_WALL_EDGES.NORTH;
};

export const getPortalPassAxis = (rotation = 0) => {
  const normalized = normalizeRotation(rotation);
  if (normalized === 90 || normalized === 270) return 'x';
  return 'y';
};
