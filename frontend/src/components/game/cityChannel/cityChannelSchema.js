import {
  CITY_CHANNEL_MATERIAL_BY_ID,
  getCityChannelMaterial,
  normalizeCityChannelPanelType
} from './cityChannelCatalog';

export const CITY_CHANNEL_STORAGE_KEY = 'city_channel_design_draft_v1';
export const CITY_CHANNEL_USER_TEMPLATE_STORAGE_KEY = 'city_channel_user_templates_v1';
export const CITY_CHANNEL_VERSION = 1;
export const CITY_CHANNEL_TEMPLATE_META_VERSION = 1;
export const CITY_CHANNEL_BOARD_SYSTEM_VERSION = 2;
export const CITY_CHANNEL_MECHANISM_SCHEMA_VERSION = 2;
export const CITY_CHANNEL_WIDTH = 32;
export const CITY_CHANNEL_HEIGHT = 32;
export const CITY_CHANNEL_LAYERS = 4;

export const CITY_CHANNEL_LAYER_LABELS = [
  '地面层',
  '二层',
  '三层',
  '四层'
];

export const CITY_CHANNEL_TOOLS = {
  BROWSE: 'browse',
  SELECT: 'select',
  ERASE: 'erase',
  PLACE_TILE: 'placeTile',
  FLOOR: 'floor',
  WOOD_FLOOR: 'wood_floor',
  STONE_FLOOR: 'stone_floor',
  IRON_FLOOR: 'iron_floor',
  WALL: 'wall',
  STAIR: 'stair',
  ENTRANCE: 'entrance',
  EXIT: 'exit',
  SAFE_MARKER: 'safe_marker',
  PLACE_COMPONENT: 'placeComponent'
};

export const CITY_CHANNEL_TILE_TYPES = {
  BASIC_PLATE: 'basic_plate',
  TRANSMISSION_STRAIGHT_PLATE: 'transmission_straight_plate',
  TRANSMISSION_CROSS_PLATE: 'transmission_cross_plate',
  TRANSMISSION_T_PLATE: 'transmission_t_plate',
  TRANSMISSION_L_PLATE: 'transmission_l_plate',
  TRANSMISSION_ENDPOINT_PLATE: 'transmission_endpoint_plate',
  GEAR_PRESSURE_PLATE: 'gear_pressure_plate',
  ACTUATOR_CENTER_GEAR_PLATE: 'actuator_center_gear_plate',
  ACTUATOR_SINGLE_CORNER_GEAR_PLATE: 'actuator_single_corner_gear_plate',
  ACTUATOR_SAME_SIDE_GEAR_PLATE: 'actuator_same_side_gear_plate',
  ACTUATOR_OPPOSITE_CORNER_GEAR_PLATE: 'actuator_opposite_corner_gear_plate',
  ACTUATOR_TRIANGLE_GEAR_PLATE: 'actuator_triangle_gear_plate',
  ACTUATOR_FOUR_CORNER_GEAR_PLATE: 'actuator_four_corner_gear_plate',
  WOOD_FLOOR: 'wood_floor',
  STONE_FLOOR: 'stone_floor',
  IRON_FLOOR: 'iron_floor',
  GLASS_FLOOR: 'glass_floor',
  WALL: 'wall',
  GLASS_WALL: 'glass_wall',
  ENTRANCE: 'entrance',
  EXIT: 'exit',
  PRESSURE_PLATE: 'pressure_plate',
  DIRECTIONAL_PRESSURE_PLATE: 'directional_pressure_plate',
  VERTICAL_PUSH_BUTTON: 'vertical_push_button',
  HORIZONTAL_PUSH_BUTTON: 'horizontal_push_button',
  ROTARY_BUTTON: 'rotary_button',
  EXTERNAL_GEAR_PLATE: 'external_gear_plate',
  INTERNAL_GEAR_PLATE: 'internal_gear_plate',
  PEG_GEAR_PLATE: 'peg_gear_plate',
  TRAPDOOR_PLATE: 'trapdoor_plate',
  SIDE_PUSHER_PLATE: 'side_pusher_plate',
  SPRING_PLATE: 'spring_plate',
  STAIR: 'stair'
};

export const CITY_CHANNEL_WALL_EDGES = {
  NORTH: 'north',
  EAST: 'east',
  SOUTH: 'south',
  WEST: 'west'
};

export const CITY_CHANNEL_TILE_DEFINITIONS = {
  ...Object.entries(CITY_CHANNEL_MATERIAL_BY_ID).reduce((definitions, [id, material]) => ({
    ...definitions,
    [id]: {
      label: material.name,
      walkable: !!material.walkable,
      solid: !!material.solid,
      transparent: !!material.transparent,
      isVertical: !!material.isVertical,
      category: material.category,
      markerType: material.markerType || null,
      hiddenModule: material.hiddenModule || null,
      connectors: material.hiddenModule?.connectorPoints || []
    }
  }), {}),
  [CITY_CHANNEL_TILE_TYPES.STAIR]: {
    label: '楼梯',
    walkable: true,
    solid: false,
    category: 'structure'
  }
};

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

export const getTileDefinition = (panelType) => (
  CITY_CHANNEL_TILE_DEFINITIONS[normalizeCityChannelPanelType(panelType)] || CITY_CHANNEL_TILE_DEFINITIONS[CITY_CHANNEL_TILE_TYPES.BASIC_PLATE]
);

export const cloneHiddenModule = (hiddenModule) => (
  hiddenModule && typeof hiddenModule === 'object' ? JSON.parse(JSON.stringify(hiddenModule)) : null
);

export const cloneTransmissionSkeleton = (transmissionSkeleton) => (
  transmissionSkeleton && typeof transmissionSkeleton === 'object'
    ? JSON.parse(JSON.stringify(transmissionSkeleton))
    : null
);

export const cloneGearMounts = (gearMounts = []) => (
  Array.isArray(gearMounts)
    ? gearMounts.map((mount) => (mount && typeof mount === 'object' ? { ...mount } : mount)).filter(Boolean)
    : []
);

export const clonePlainObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {}
);

export const cloneConnectors = (connectors = []) => (
  Array.isArray(connectors) ? connectors.map((connector) => (
    connector && typeof connector === 'object' ? { ...connector } : connector
  )) : []
);

const normalizeString = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const normalizeVector3 = (value = {}, fallback = { x: 0, y: 0, z: 0 }) => ({
  x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
  y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
  z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z
});

const normalizeStringArray = (value = [], fallback = []) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : fallback
);

const inferPortKind = (connector = {}, material = {}) => {
  const id = String(connector.id || '').toLowerCase();
  const category = material.category || '';
  if (id.includes('axis') || id.includes('gear') || id.includes('teeth')) return connector.direction === 'in' ? 'rotary_in' : 'rotary_out';
  if (id.includes('signal')) return 'signal';
  if (id.includes('hinge') || id.includes('drive') || id.includes('spring')) return connector.direction === 'in' ? 'linear_in' : 'linear_out';
  if (category === 'mechanical_sensor') return connector.direction === 'in' ? 'linear_in' : 'signal';
  if (category === 'mechanical_gear') return connector.direction === 'in' ? 'rotary_in' : 'rotary_out';
  return connector.direction === 'in' ? 'linear_in' : 'linear_out';
};

const defaultMediaForPortKind = (kind) => {
  if (kind === 'signal') return ['rigid_rod', 'rope'];
  if (kind === 'rotary_in' || kind === 'rotary_out') return ['rigid_rod', 'belt', 'gear_mesh'];
  return ['rigid_rod', 'rope'];
};

const connectorToMechanicalPort = (connector = {}, material = {}) => {
  const position = connector.position || {};
  const kind = inferPortKind(connector, material);
  const direction = connector.direction === 'in' ? 'in' : connector.direction === 'out' ? 'out' : 'bidirectional';
  return {
    id: typeof connector.id === 'string' && connector.id.trim() ? connector.id.trim() : 'port',
    label: typeof connector.label === 'string' && connector.label.trim() ? connector.label.trim() : '连接口',
    kind,
    direction,
    mediums: defaultMediaForPortKind(kind),
    localPosition3d: {
      x: Number.isFinite(Number(position.dx)) ? Number(position.dx) : 0,
      y: Number.isFinite(Number(position.dy)) ? Number(position.dy) : 0,
      z: -0.08
    },
    localDirection3d: {
      x: Number.isFinite(Number(position.dx)) ? Math.sign(Number(position.dx)) : 0,
      y: Number.isFinite(Number(position.dy)) ? Math.sign(Number(position.dy)) : (direction === 'in' ? -1 : 1),
      z: 0
    },
    motionAxis: kind.includes('rotary') ? 'z' : 'xy',
    phaseBehavior: 'same',
    capacity: 1,
    compatibleWith: []
  };
};

export const normalizeMechanicalPort = (port = {}, fallback = {}, material = {}) => {
  const source = port && typeof port === 'object' ? port : {};
  const base = fallback && typeof fallback === 'object' ? fallback : connectorToMechanicalPort(source, material);
  const kind = typeof source.kind === 'string' && source.kind ? source.kind : base.kind || inferPortKind(source, material);
  const mediums = normalizeStringArray(source.mediums, normalizeStringArray(base.mediums, defaultMediaForPortKind(kind)));
  return {
    id: normalizeString(source.id, normalizeString(base.id, 'port')),
    label: normalizeString(source.label, normalizeString(base.label, '连接口')),
    kind,
    direction: ['in', 'out', 'bidirectional'].includes(source.direction) ? source.direction : (base.direction || 'bidirectional'),
    mediums,
    localPosition3d: normalizeVector3(source.localPosition3d, normalizeVector3(base.localPosition3d)),
    localDirection3d: normalizeVector3(source.localDirection3d, normalizeVector3(base.localDirection3d, { x: 0, y: 1, z: 0 })),
    motionAxis: normalizeString(source.motionAxis, normalizeString(base.motionAxis, kind.includes('rotary') ? 'z' : 'xy')),
    phaseBehavior: normalizeString(source.phaseBehavior, normalizeString(base.phaseBehavior, 'same')),
    capacity: Math.max(1, Number.parseInt(source.capacity ?? base.capacity ?? 1, 10) || 1),
    compatibleWith: normalizeStringArray(source.compatibleWith, normalizeStringArray(base.compatibleWith, []))
  };
};

export const cloneMechanicalPorts = (ports = [], material = {}) => {
  const sourcePorts = Array.isArray(ports) ? ports : [];
  return sourcePorts
    .map((port, index) => normalizeMechanicalPort(port, { id: `port_${index}` }, material))
    .filter((port) => port.id);
};

const createMechanicalPortsForMaterial = (catalogItem = {}) => {
  if (Array.isArray(catalogItem.mechanicalPorts) && catalogItem.mechanicalPorts.length > 0) {
    return cloneMechanicalPorts(catalogItem.mechanicalPorts, catalogItem);
  }
  if (!Array.isArray(catalogItem.connectors) || catalogItem.connectors.length <= 0) return [];
  return catalogItem.connectors.map((connector) => normalizeMechanicalPort(connectorToMechanicalPort(connector, catalogItem), {}, catalogItem));
};

export const createMechanicalLink = ({
  id = null,
  medium = 'rigid_rod',
  from,
  to,
  routing = [],
  tensionMode = 'push_pull',
  slack = 0
} = {}) => ({
  id: normalizeString(id, `link_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
  medium,
  from,
  to,
  routing: Array.isArray(routing) ? routing.map((point) => normalizeVector3(point)).filter(Boolean) : [],
  tensionMode,
  slack: Number.isFinite(Number(slack)) ? Number(slack) : 0
});

const normalizeMechanicalEndpoint = (endpoint = {}, tiles = {}) => {
  const componentKey = normalizeString(endpoint.componentKey, '');
  const portId = normalizeString(endpoint.portId, '');
  if (!componentKey || !portId || !tiles[componentKey]) return null;
  const tile = tiles[componentKey];
  const port = (tile.mechanicalPorts || []).find((item) => item.id === portId);
  if (!port) return null;
  return { componentKey, portId };
};

export const normalizeMechanicalLink = (link = {}, tiles = {}) => {
  const from = normalizeMechanicalEndpoint(link.from, tiles);
  const to = normalizeMechanicalEndpoint(link.to, tiles);
  if (!from || !to || (from.componentKey === to.componentKey && from.portId === to.portId)) return null;
  return createMechanicalLink({
    id: link.id,
    medium: normalizeString(link.medium, 'rigid_rod'),
    from,
    to,
    routing: link.routing,
    tensionMode: normalizeString(link.tensionMode, 'push_pull'),
    slack: link.slack
  });
};

export const normalizeTemplateMeta = (meta = {}, fallback = {}) => {
  const source = meta && typeof meta === 'object' ? meta : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const parentTemplateId = normalizeString(source.parentTemplateId, normalizeString(fallbackSource.parentTemplateId, null));
  const rootTemplateId = normalizeString(
    source.rootTemplateId,
    normalizeString(fallbackSource.rootTemplateId, parentTemplateId || null)
  );
  const lineage = Array.isArray(source.lineage) ? source.lineage : (Array.isArray(fallbackSource.lineage) ? fallbackSource.lineage : []);
  const normalizedLineage = lineage
    .map((entry) => normalizeString(entry, ''))
    .filter(Boolean);

  if (parentTemplateId && !normalizedLineage.includes(parentTemplateId)) {
    normalizedLineage.unshift(parentTemplateId);
  }

  return {
    schemaVersion: CITY_CHANNEL_TEMPLATE_META_VERSION,
    source: normalizeString(source.source, normalizeString(fallbackSource.source, 'local')),
    templateId: normalizeString(source.templateId, normalizeString(fallbackSource.templateId, null)),
    parentTemplateId,
    rootTemplateId,
    originalTemplateId: normalizeString(source.originalTemplateId, normalizeString(fallbackSource.originalTemplateId, rootTemplateId || parentTemplateId || null)),
    authorId: normalizeString(source.authorId, normalizeString(fallbackSource.authorId, null)),
    visibility: normalizeString(source.visibility, normalizeString(fallbackSource.visibility, 'private')),
    forkedAt: normalizeString(source.forkedAt, normalizeString(fallbackSource.forkedAt, null)),
    savedAt: normalizeString(source.savedAt, normalizeString(fallbackSource.savedAt, null)),
    lineage: normalizedLineage
  };
};

export const createTile = ({
  x,
  y,
  z,
  panelType = CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
  marker = null,
  rotation = 0,
  transmissionRotation = null
} = {}) => {
  const normalizedPanelType = normalizeCityChannelPanelType(panelType);
  const definition = getTileDefinition(normalizedPanelType);
  const catalogItem = getCityChannelMaterial(normalizedPanelType);
  const markerType = catalogItem.markerType || null;
  return {
    x,
    y,
    z,
    panelType: normalizedPanelType,
    boardRole: catalogItem.boardRole || 'basic',
    category: definition.category || catalogItem.category || 'structure',
    rotation: normalizeRotation(rotation),
    transmissionRotation: normalizeRotation(transmissionRotation === null || transmissionRotation === undefined ? rotation : transmissionRotation),
    walkable: !!definition.walkable,
    solid: !!definition.solid,
    transparent: !!definition.transparent,
    isVertical: !!definition.isVertical,
    marker: marker || markerType,
    flipped: false,
    hiddenModule: cloneHiddenModule(catalogItem.hiddenModule),
    mechanismModel: catalogItem.mechanismModel || null,
    transmissionSkeleton: cloneTransmissionSkeleton(catalogItem.transmissionSkeleton),
    gearMounts: cloneGearMounts(catalogItem.gearMounts),
    gearConfigs: clonePlainObject(catalogItem.gearConfigs),
    triggerConfig: clonePlainObject(catalogItem.triggerConfig),
    motionConfig: clonePlainObject(catalogItem.motionConfig),
    connectors: cloneConnectors(catalogItem.connectors || catalogItem.hiddenModule?.connectorPoints || definition.connectors || []),
    mechanicalPorts: createMechanicalPortsForMaterial(catalogItem)
  };
};

export const createWall = ({
  x,
  y,
  z,
  edge = CITY_CHANNEL_WALL_EDGES.NORTH,
  panelType = CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
  rotation = null,
  transmissionRotation = 0,
  marker = null,
  flipped = false
} = {}) => {
  const normalizedEdge = normalizeWallEdge(edge);
  const safePanelType = normalizeCityChannelPanelType(panelType);
  const definition = getTileDefinition(safePanelType);
  const catalogItem = getCityChannelMaterial(safePanelType);
  return {
    x,
    y,
    z,
    edge: normalizedEdge,
    panelType: safePanelType,
    boardRole: catalogItem.boardRole || 'basic',
    category: definition.category || catalogItem.category || 'structure',
    rotation: wallEdgeToRotation(normalizedEdge),
    transmissionRotation: normalizeRotation(transmissionRotation),
    marker: marker === 'highlight' ? 'highlight' : null,
    flipped: false,
    walkable: false,
    solid: true,
    transparent: !!definition.transparent,
    isVertical: true,
    hiddenModule: cloneHiddenModule(catalogItem.hiddenModule),
    mechanismModel: catalogItem.mechanismModel || null,
    transmissionSkeleton: cloneTransmissionSkeleton(catalogItem.transmissionSkeleton),
    gearMounts: cloneGearMounts(catalogItem.gearMounts),
    gearConfigs: clonePlainObject(catalogItem.gearConfigs),
    triggerConfig: clonePlainObject(catalogItem.triggerConfig),
    motionConfig: clonePlainObject(catalogItem.motionConfig),
    connectors: cloneConnectors(catalogItem.connectors || catalogItem.hiddenModule?.connectorPoints || definition.connectors || []),
    mechanicalPorts: createMechanicalPortsForMaterial(catalogItem)
  };
};

export const createBaseCityChannelMap = ({
  width = CITY_CHANNEL_WIDTH,
  height = CITY_CHANNEL_HEIGHT,
  layers = CITY_CHANNEL_LAYERS,
  name = '未命名通道',
  templateMeta = null
} = {}) => ({
  version: CITY_CHANNEL_VERSION,
  boardSystemVersion: CITY_CHANNEL_BOARD_SYSTEM_VERSION,
  mechanismSchemaVersion: CITY_CHANNEL_MECHANISM_SCHEMA_VERSION,
  name,
  templateMeta: normalizeTemplateMeta(templateMeta, { source: 'local' }),
  width,
  height,
  layers,
  tiles: {},
  walls: {},
  entrances: [],
  exits: [],
  safeRoute: [],
  mechanisms: [],
  mechanismParams: {},
  mechanicalLinks: [],
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
        panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
        rotation: 90
      }),
      [createCellKey(exit.x, exit.y, exit.z)]: createTile({
        x: exit.x,
        y: exit.y,
        z: exit.z,
        panelType: CITY_CHANNEL_TILE_TYPES.EXIT,
        rotation: 90
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
  const panelType = normalizeCityChannelPanelType(tile.panelType);
  const definition = getTileDefinition(panelType);
  const catalogItem = getCityChannelMaterial(panelType);
  return {
    x,
    y,
    z,
    panelType,
    boardRole: catalogItem.boardRole || tile.boardRole || 'basic',
    category: definition.category || catalogItem.category || tile.category || 'structure',
    rotation: normalizeRotation(tile.rotation),
    transmissionRotation: normalizeRotation(tile.transmissionRotation !== undefined ? tile.transmissionRotation : tile.rotation),
    walkable: !!definition.walkable,
    solid: !!definition.solid,
    transparent: !!definition.transparent,
    isVertical: !!definition.isVertical,
    marker: ['safe', 'highlight', 'entrance', 'exit'].includes(tile.marker)
      ? tile.marker
      : (catalogItem.markerType || null),
    flipped: false,
    hiddenModule: tile.hiddenModule && typeof tile.hiddenModule === 'object'
      ? cloneHiddenModule(tile.hiddenModule)
      : cloneHiddenModule(catalogItem.hiddenModule),
    mechanismModel: tile.mechanismModel && typeof tile.mechanismModel === 'object'
      ? tile.mechanismModel
      : (catalogItem.mechanismModel || null),
    transmissionSkeleton: tile.transmissionSkeleton && typeof tile.transmissionSkeleton === 'object'
      ? cloneTransmissionSkeleton(tile.transmissionSkeleton)
      : cloneTransmissionSkeleton(catalogItem.transmissionSkeleton),
    gearMounts: Array.isArray(tile.gearMounts) && tile.gearMounts.length > 0
      ? cloneGearMounts(tile.gearMounts)
      : cloneGearMounts(catalogItem.gearMounts),
    gearConfigs: tile.gearConfigs && typeof tile.gearConfigs === 'object'
      ? clonePlainObject(tile.gearConfigs)
      : clonePlainObject(catalogItem.gearConfigs),
    triggerConfig: tile.triggerConfig && typeof tile.triggerConfig === 'object'
      ? clonePlainObject(tile.triggerConfig)
      : clonePlainObject(catalogItem.triggerConfig),
    motionConfig: tile.motionConfig && typeof tile.motionConfig === 'object'
      ? clonePlainObject(tile.motionConfig)
      : clonePlainObject(catalogItem.motionConfig),
    connectors: Array.isArray(tile.connectors) && tile.connectors.length > 0
      ? cloneConnectors(tile.connectors)
      : cloneConnectors(catalogItem.connectors || catalogItem.hiddenModule?.connectorPoints || definition.connectors || []),
    mechanicalPorts: Array.isArray(tile.mechanicalPorts) && tile.mechanicalPorts.length > 0
      ? cloneMechanicalPorts(tile.mechanicalPorts, catalogItem)
      : createMechanicalPortsForMaterial(catalogItem)
  };
};

export const normalizeWall = (wall = {}, bounds = null) => {
  const x = Number.parseInt(wall.x, 10);
  const y = Number.parseInt(wall.y, 10);
  const z = clampLayer(wall.z, bounds?.layers);
  if (!isValidCell(x, y, z, bounds)) return null;
  const edge = normalizeWallEdge(wall.edge || rotationToWallEdge(wall.rotation));
  const edgeRotation = wallEdgeToRotation(edge);
  const panelType = normalizeCityChannelPanelType(wall.panelType);
  const definition = getTileDefinition(panelType);
  const catalogItem = getCityChannelMaterial(panelType);
  return {
    x,
    y,
    z,
    edge,
    panelType,
    boardRole: catalogItem.boardRole || wall.boardRole || 'basic',
    category: definition.category || catalogItem.category || 'structure',
    rotation: edgeRotation,
    transmissionRotation: normalizeRotation(
      wall.transmissionRotation !== undefined
        ? wall.transmissionRotation
        : normalizeRotation((wall.rotation || edgeRotation) - edgeRotation)
    ),
    marker: wall.marker === 'highlight' ? 'highlight' : null,
    flipped: false,
    walkable: false,
    solid: true,
    transparent: !!definition.transparent,
    isVertical: true,
    hiddenModule: wall.hiddenModule && typeof wall.hiddenModule === 'object'
      ? cloneHiddenModule(wall.hiddenModule)
      : cloneHiddenModule(catalogItem.hiddenModule),
    mechanismModel: wall.mechanismModel && typeof wall.mechanismModel === 'object'
      ? wall.mechanismModel
      : (catalogItem.mechanismModel || null),
    transmissionSkeleton: wall.transmissionSkeleton && typeof wall.transmissionSkeleton === 'object'
      ? cloneTransmissionSkeleton(wall.transmissionSkeleton)
      : cloneTransmissionSkeleton(catalogItem.transmissionSkeleton),
    gearMounts: Array.isArray(wall.gearMounts) && wall.gearMounts.length > 0
      ? cloneGearMounts(wall.gearMounts)
      : cloneGearMounts(catalogItem.gearMounts),
    gearConfigs: wall.gearConfigs && typeof wall.gearConfigs === 'object'
      ? clonePlainObject(wall.gearConfigs)
      : clonePlainObject(catalogItem.gearConfigs),
    triggerConfig: wall.triggerConfig && typeof wall.triggerConfig === 'object'
      ? clonePlainObject(wall.triggerConfig)
      : clonePlainObject(catalogItem.triggerConfig),
    motionConfig: wall.motionConfig && typeof wall.motionConfig === 'object'
      ? clonePlainObject(wall.motionConfig)
      : clonePlainObject(catalogItem.motionConfig),
    connectors: Array.isArray(wall.connectors) && wall.connectors.length > 0
      ? cloneConnectors(wall.connectors)
      : cloneConnectors(catalogItem.connectors || catalogItem.hiddenModule?.connectorPoints || definition.connectors || []),
    mechanicalPorts: Array.isArray(wall.mechanicalPorts) && wall.mechanicalPorts.length > 0
      ? cloneMechanicalPorts(wall.mechanicalPorts, catalogItem)
      : createMechanicalPortsForMaterial(catalogItem)
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
  const sourceWalls = input?.walls && typeof input.walls === 'object' ? input.walls : {};
  const tiles = {};
  const walls = {};

  Object.entries(sourceTiles).forEach(([key, value]) => {
    const fallback = parseCellKey(key);
    const normalized = normalizeTile({
      ...fallback,
      ...(value && typeof value === 'object' ? value : {})
    }, bounds);
    if (!normalized) return;
    tiles[createCellKey(normalized.x, normalized.y, normalized.z)] = normalized;
  });

  Object.entries(sourceWalls).forEach(([key, value]) => {
    const [z, x, y, edge] = String(key || '').split(':');
    const normalized = normalizeWall({
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
      z: Number.parseInt(z, 10),
      edge,
      ...(value && typeof value === 'object' ? value : {})
    }, bounds);
    if (!normalized) return;
    walls[createWallKey(normalized.x, normalized.y, normalized.z, normalized.edge)] = normalized;
  });

  const sourceEntrances = (Array.isArray(input?.entrances) ? input.entrances : [])
    .map((point, index) => normalizePoint(point, 'entrance', index, bounds))
    .filter(Boolean);
  const sourceExits = (Array.isArray(input?.exits) ? input.exits : [])
    .map((point, index) => normalizePoint(point, 'exit', index, bounds))
    .filter(Boolean);
  const markerEntrances = Object.values(tiles)
    .filter((tile) => tile.marker === 'entrance' || tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE)
    .map((tile, index) => normalizePoint(tile, 'entrance_marker', index, bounds))
    .filter(Boolean);
  const markerExits = Object.values(tiles)
    .filter((tile) => tile.marker === 'exit' || tile.panelType === CITY_CHANNEL_TILE_TYPES.EXIT)
    .map((tile, index) => normalizePoint(tile, 'exit_marker', index, bounds))
    .filter(Boolean);
  const entrance = sourceEntrances[0] || markerEntrances[0] || null;
  const exit = sourceExits[0] || markerExits[0] || null;

  Object.entries(tiles).forEach(([key, tile]) => {
    const isEntranceCell = entrance && tile.x === entrance.x && tile.y === entrance.y && tile.z === entrance.z;
    const isExitCell = exit && tile.x === exit.x && tile.y === exit.y && tile.z === exit.z;
    if (isEntranceCell) {
      tiles[key] = {
        ...createTile({ x: tile.x, y: tile.y, z: tile.z, panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE, rotation: tile.rotation }),
        marker: 'entrance'
      };
      return;
    }
    if (isExitCell) {
      tiles[key] = {
        ...createTile({ x: tile.x, y: tile.y, z: tile.z, panelType: CITY_CHANNEL_TILE_TYPES.EXIT, rotation: tile.rotation }),
        marker: 'exit'
      };
      return;
    }
    if (
      tile.marker === 'entrance'
      || tile.marker === 'exit'
      || tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE
      || tile.panelType === CITY_CHANNEL_TILE_TYPES.EXIT
    ) {
      tiles[key] = createTile({
        x: tile.x,
        y: tile.y,
        z: tile.z,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: tile.rotation
      });
    }
  });

  if (entrance && !tiles[createCellKey(entrance.x, entrance.y, entrance.z)]) {
    tiles[createCellKey(entrance.x, entrance.y, entrance.z)] = createTile({
      x: entrance.x,
      y: entrance.y,
      z: entrance.z,
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE
    });
  }
  if (exit && !tiles[createCellKey(exit.x, exit.y, exit.z)]) {
    tiles[createCellKey(exit.x, exit.y, exit.z)] = createTile({
      x: exit.x,
      y: exit.y,
      z: exit.z,
      panelType: CITY_CHANNEL_TILE_TYPES.EXIT
    });
  }

  const entrances = entrance ? [{ ...entrance, id: entrance.id || 'entrance_main' }] : [];
  const exits = exit ? [{ ...exit, id: exit.id || 'exit_main' }] : [];
  const safeRoute = (Array.isArray(input?.safeRoute) ? input.safeRoute : [])
    .map((point, index) => normalizePoint(point, 'route', index, bounds))
    .filter(Boolean)
    .map(({ x, y, z }) => ({ x, y, z }));
  const mechanicalLinks = (Array.isArray(input?.mechanicalLinks) ? input.mechanicalLinks : [])
    .map((link) => normalizeMechanicalLink(link, tiles))
    .filter(Boolean);

  return {
    ...base,
    version: CITY_CHANNEL_VERSION,
    boardSystemVersion: Math.max(
      Number.parseInt(input?.boardSystemVersion, 10) || 0,
      CITY_CHANNEL_BOARD_SYSTEM_VERSION
    ),
    mechanismSchemaVersion: Math.max(
      Number.parseInt(input?.mechanismSchemaVersion, 10) || 0,
      CITY_CHANNEL_MECHANISM_SCHEMA_VERSION
    ),
    name: base.name,
    templateMeta: normalizeTemplateMeta(input?.templateMeta, base.templateMeta),
    width: base.width,
    height: base.height,
    layers: base.layers,
    tiles,
    walls,
    entrances,
    exits,
    safeRoute,
    mechanisms: Array.isArray(input?.mechanisms) ? input.mechanisms : [],
    mechanismParams: input?.mechanismParams && typeof input.mechanismParams === 'object' ? input.mechanismParams : {},
    mechanicalLinks,
    testState: input?.testState && typeof input.testState === 'object'
      ? { ...base.testState, ...input.testState }
      : base.testState
  };
};

export const serializeCityChannelMap = (mapData = {}) => normalizeCityChannelMap(mapData);
