export const CITY_CHANNEL_STORAGE_KEY = 'city_channel_design_draft_v1';
export const CITY_CHANNEL_VERSION = 1;
export const CITY_CHANNEL_WIDTH = 32;
export const CITY_CHANNEL_HEIGHT = 32;
export const CITY_CHANNEL_LAYERS = 1;

export const CITY_CHANNEL_LAYER_LABELS = [
  '地面层'
];

export const CITY_CHANNEL_TOOLS = {
  SELECT: 'select',
  ERASE: 'erase',
  FLOOR: 'floor',
  WOOD_FLOOR: 'wood_floor',
  STONE_FLOOR: 'stone_floor',
  IRON_FLOOR: 'iron_floor',
  WALL: 'wall',
  STAIR: 'stair',
  ENTRANCE: 'entrance',
  EXIT: 'exit',
  SAFE_MARKER: 'safe_marker'
};

export const CITY_CHANNEL_TILE_TYPES = {
  WOOD_FLOOR: 'wood_floor',
  STONE_FLOOR: 'stone_floor',
  IRON_FLOOR: 'iron_floor',
  WALL: 'wall',
  STAIR: 'stair'
};

export const CITY_CHANNEL_TILE_DEFINITIONS = {
  [CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]: {
    label: '木板',
    walkable: true,
    solid: false
  },
  [CITY_CHANNEL_TILE_TYPES.STONE_FLOOR]: {
    label: '石板',
    walkable: true,
    solid: false
  },
  [CITY_CHANNEL_TILE_TYPES.IRON_FLOOR]: {
    label: '铁板',
    walkable: true,
    solid: false
  },
  [CITY_CHANNEL_TILE_TYPES.WALL]: {
    label: '墙板',
    walkable: false,
    solid: true
  },
  [CITY_CHANNEL_TILE_TYPES.STAIR]: {
    label: '楼梯',
    walkable: true,
    solid: false
  }
};

export const createCellKey = (x, y, z) => `${z}:${x}:${y}`;

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

export const getTileDefinition = (panelType) => (
  CITY_CHANNEL_TILE_DEFINITIONS[panelType] || CITY_CHANNEL_TILE_DEFINITIONS[CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR]
);

export const createTile = ({
  x,
  y,
  z,
  panelType = CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
  marker = null,
  rotation = 0
} = {}) => {
  const definition = getTileDefinition(panelType);
  return {
    x,
    y,
    z,
    panelType,
    rotation: normalizeRotation(rotation),
    walkable: !!definition.walkable,
    solid: !!definition.solid,
    marker,
    hiddenModule: null,
    connectors: []
  };
};

export const createBaseCityChannelMap = ({
  width = CITY_CHANNEL_WIDTH,
  height = CITY_CHANNEL_HEIGHT,
  layers = CITY_CHANNEL_LAYERS,
  name = '未命名通道'
} = {}) => ({
  version: CITY_CHANNEL_VERSION,
  name,
  width,
  height,
  layers,
  tiles: {},
  entrances: [],
  exits: [],
  safeRoute: [],
  mechanisms: [],
  testState: {
    mode: 'idle',
    lastRunAt: null
  }
});

export const createDefaultCityChannelMap = () => {
  const map = createBaseCityChannelMap({
    name: '空白合法模板'
  });
  const entrance = { id: 'entrance_default', x: 15, y: 16, z: 0 };
  const exit = { id: 'exit_default', x: 16, y: 16, z: 0 };
  return {
    ...map,
    tiles: {
      [createCellKey(entrance.x, entrance.y, entrance.z)]: createTile({
        x: entrance.x,
        y: entrance.y,
        z: entrance.z,
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR
      }),
      [createCellKey(exit.x, exit.y, exit.z)]: createTile({
        x: exit.x,
        y: exit.y,
        z: exit.z,
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR
      })
    },
    entrances: [entrance],
    exits: [exit],
    safeRoute: [
      { x: entrance.x, y: entrance.y, z: entrance.z },
      { x: exit.x, y: exit.y, z: exit.z }
    ]
  };
};

const normalizePoint = (point = {}, fallbackIdPrefix = 'point', index = 0, bounds = null) => {
  const x = Number.parseInt(point.x, 10);
  const y = Number.parseInt(point.y, 10);
  const z = clampLayer(point.z, bounds?.layers);
  if (!isValidCell(x, y, z, bounds)) return null;
  return {
    id: typeof point.id === 'string' && point.id.trim()
      ? point.id.trim()
      : `${fallbackIdPrefix}_${z}_${x}_${y}_${index}`,
    x,
    y,
    z
  };
};

export const normalizeTile = (tile = {}, bounds = null) => {
  const x = Number.parseInt(tile.x, 10);
  const y = Number.parseInt(tile.y, 10);
  const z = clampLayer(tile.z, bounds?.layers);
  if (!isValidCell(x, y, z, bounds)) return null;
  const panelType = CITY_CHANNEL_TILE_DEFINITIONS[tile.panelType]
    ? tile.panelType
    : CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR;
  const definition = getTileDefinition(panelType);
  return {
    x,
    y,
    z,
    panelType,
    rotation: normalizeRotation(tile.rotation),
    walkable: !!definition.walkable,
    solid: !!definition.solid,
    marker: tile.marker === 'safe' || tile.marker === 'highlight' ? tile.marker : null,
    hiddenModule: tile.hiddenModule && typeof tile.hiddenModule === 'object' ? tile.hiddenModule : null,
    connectors: Array.isArray(tile.connectors) ? tile.connectors : []
  };
};

export const normalizeCityChannelMap = (input = {}) => {
  const width = Number.parseInt(input?.width, 10);
  const height = Number.parseInt(input?.height, 10);
  const layers = Number.parseInt(input?.layers, 10);
  const base = createBaseCityChannelMap({
    width: Number.isInteger(width) && width > 0 ? width : CITY_CHANNEL_WIDTH,
    height: Number.isInteger(height) && height > 0 ? height : CITY_CHANNEL_HEIGHT,
    layers: Number.isInteger(layers) && layers > 0 ? layers : CITY_CHANNEL_LAYERS,
    name: typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : '未命名通道'
  });
  const bounds = {
    width: base.width,
    height: base.height,
    layers: base.layers
  };
  const sourceTiles = input?.tiles && typeof input.tiles === 'object' ? input.tiles : {};
  const tiles = {};

  Object.entries(sourceTiles).forEach(([key, value]) => {
    const fallback = parseCellKey(key);
    const normalized = normalizeTile({
      ...fallback,
      ...(value && typeof value === 'object' ? value : {})
    }, bounds);
    if (!normalized) return;
    tiles[createCellKey(normalized.x, normalized.y, normalized.z)] = normalized;
  });

  const entrances = (Array.isArray(input?.entrances) ? input.entrances : [])
    .map((point, index) => normalizePoint(point, 'entrance', index, bounds))
    .filter(Boolean);
  const exits = (Array.isArray(input?.exits) ? input.exits : [])
    .map((point, index) => normalizePoint(point, 'exit', index, bounds))
    .filter(Boolean);
  const safeRoute = (Array.isArray(input?.safeRoute) ? input.safeRoute : [])
    .map((point, index) => normalizePoint(point, 'route', index, bounds))
    .filter(Boolean)
    .map(({ x, y, z }) => ({ x, y, z }));

  return {
    ...base,
    version: CITY_CHANNEL_VERSION,
    name: base.name,
    width: base.width,
    height: base.height,
    layers: base.layers,
    tiles,
    entrances,
    exits,
    safeRoute,
    mechanisms: Array.isArray(input?.mechanisms) ? input.mechanisms : [],
    testState: input?.testState && typeof input.testState === 'object'
      ? { ...base.testState, ...input.testState }
      : base.testState
  };
};

export const serializeCityChannelMap = (mapData = {}) => normalizeCityChannelMap(mapData);
