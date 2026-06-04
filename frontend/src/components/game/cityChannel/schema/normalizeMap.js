import {
  CITY_CHANNEL_BOARD_SYSTEM_VERSION,
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_LAYERS,
  CITY_CHANNEL_MECHANISM_SCHEMA_VERSION,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_VERSION,
  CITY_CHANNEL_WIDTH,
  getTileDefinition
} from './constants';
import {
  clampLayer,
  createCellKey,
  createWallKey,
  isValidCell,
  normalizeRotation,
  normalizeWallEdge,
  parseCellKey,
  rotationToWallEdge,
  wallEdgeToRotation
} from './keys';
import {
  createBaseCityChannelMap,
  createTile
} from './entities';
import {
  cloneConnectors,
  cloneGearMounts,
  cloneHiddenModule,
  clonePlainObject,
  cloneTransmissionSkeleton
} from './valueUtils';
import {
  cloneMechanicalPorts,
  createMechanicalPortsForMaterial,
  normalizeMechanicalLink
} from './mechanicalPorts';
import { normalizeTemplateMeta } from './templateMeta';
import {
  getCityChannelMaterial,
  normalizeCityChannelPanelType
} from '../cityChannelCatalog';

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

const getSafeLayerIndex = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const getSourcePlacementLayer = (keyLayer, placement = {}) => {
  const valueLayer = getSafeLayerIndex(placement?.z);
  if (valueLayer !== null) return valueLayer;
  return getSafeLayerIndex(keyLayer);
};

const getRequiredLayerCount = (input = {}) => {
  let maxLayer = -1;
  const visitLayer = (layer) => {
    const safeLayer = getSafeLayerIndex(layer);
    if (safeLayer !== null) maxLayer = Math.max(maxLayer, safeLayer);
  };

  Object.entries(input?.tiles && typeof input.tiles === 'object' ? input.tiles : {}).forEach(([key, value]) => {
    const fallback = parseCellKey(key);
    visitLayer(getSourcePlacementLayer(fallback.z, value));
  });

  Object.entries(input?.walls && typeof input.walls === 'object' ? input.walls : {}).forEach(([key, value]) => {
    const [z] = String(key || '').split(':');
    visitLayer(getSourcePlacementLayer(z, value));
  });

  (Array.isArray(input?.entrances) ? input.entrances : []).forEach((point) => visitLayer(point?.z));
  (Array.isArray(input?.exits) ? input.exits : []).forEach((point) => visitLayer(point?.z));
  (Array.isArray(input?.safeRoute) ? input.safeRoute : []).forEach((point) => visitLayer(point?.z));

  return maxLayer + 1;
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
    isVertical: !!definition.isVertical || !!tile.isVertical,
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
    transmissionSkeleton: catalogItem.transmissionSkeleton
      ? (tile.transmissionSkeleton && typeof tile.transmissionSkeleton === 'object'
        ? cloneTransmissionSkeleton(tile.transmissionSkeleton)
        : cloneTransmissionSkeleton(catalogItem.transmissionSkeleton))
      : null,
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
    transmissionSkeleton: catalogItem.transmissionSkeleton
      ? (wall.transmissionSkeleton && typeof wall.transmissionSkeleton === 'object'
        ? cloneTransmissionSkeleton(wall.transmissionSkeleton)
        : cloneTransmissionSkeleton(catalogItem.transmissionSkeleton))
      : null,
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
  const requiredLayers = getRequiredLayerCount(input);
  const base = createBaseCityChannelMap({
    width: Number.isInteger(width) && width > 0 ? width : CITY_CHANNEL_WIDTH,
    height: Number.isInteger(height) && height > 0 ? height : CITY_CHANNEL_HEIGHT,
    layers: Math.max(
      Number.isInteger(layers) && layers > 0 ? layers : CITY_CHANNEL_LAYERS,
      requiredLayers
    ),
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
