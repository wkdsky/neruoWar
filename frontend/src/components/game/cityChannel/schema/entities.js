import {
  CITY_CHANNEL_BOARD_SYSTEM_VERSION,
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_LAYERS,
  CITY_CHANNEL_MECHANISM_SCHEMA_VERSION,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_VERSION,
  CITY_CHANNEL_WALL_EDGES,
  CITY_CHANNEL_WIDTH,
  getTileDefinition
} from './constants';
import {
  createCellKey,
  normalizeRotation,
  normalizeWallEdge,
  wallEdgeToRotation
} from './keys';
import {
  createMechanicalPortsForMaterial
} from './mechanicalPorts';
import {
  cloneConnectors,
  cloneGearMounts,
  cloneHiddenModule,
  clonePlainObject,
  cloneTransmissionSkeleton
} from './valueUtils';
import { normalizeTemplateMeta } from './templateMeta';
import {
  getCityChannelMaterial,
  normalizeCityChannelPanelType
} from '../cityChannelCatalog';

export const createTile = ({
  x,
  y,
  z,
  panelType = CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
  marker = null,
  rotation = 0,
  transmissionRotation = null,
  isVertical = false
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
    isVertical: !!definition.isVertical || !!isVertical,
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
