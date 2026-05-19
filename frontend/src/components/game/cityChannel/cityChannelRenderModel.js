import {
  CITY_CHANNEL_HEIGHT,
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_WIDTH,
  createTile,
  createWall,
  createCellKey,
  createWallKey,
  isValidCell,
  normalizeCityChannelMap
} from './cityChannelSchema';
import {
  CITY_CHANNEL_ANCHOR_SURFACES,
  CITY_CHANNEL_PHYSICAL_LAYERS,
  CITY_CHANNEL_SORT_PHASES,
  buildCityChannelDomainModel
} from './cityChannelDomainModel';
import {
  TILE_HEIGHT,
  projectWorldOffset
} from './cityChannelGeometryUtils';

export const CITY_CHANNEL_SCENE_RENDER_BASE = 50000000;
export const CITY_CHANNEL_DEPTH_ORDER_SCALE = 1000;
export const CITY_CHANNEL_PHASE_ORDER_SCALE = 10;
export const CITY_CHANNEL_LAYER_ORDER_STEP = 10000;

export const normalizeCityChannelCameraYaw = (yaw = 0) => ((yaw % 360) + 360) % 360;

export const getCityChannelMapCenter = (mapData = {}) => ({
  x: Math.floor((Number.isInteger(mapData.width) ? mapData.width : CITY_CHANNEL_WIDTH) / 2),
  y: Math.floor((Number.isInteger(mapData.height) ? mapData.height : CITY_CHANNEL_HEIGHT) / 2)
});

export const projectCityChannelCell = (cell, cameraYaw = 0, mapCenter = null) => {
  const center = mapCenter || getCityChannelMapCenter();
  const dx = cell.x - center.x;
  const dy = cell.y - center.y;
  const offset = projectWorldOffset(dx, dy, cameraYaw);
  return {
    left: offset.x,
    top: offset.y,
    depth: Math.round((offset.y / (TILE_HEIGHT / 2)) * 100)
  };
};

const edgeEndpointsByEdge = {
  north: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }],
  south: [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  west: [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }],
  east: [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]
};

const getProjectedAnchorDepthBias = (points = [], cameraYaw = 0) => {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const projectedY = Math.max(...points.map((point) => projectWorldOffset(point.x, point.y, cameraYaw).y));
  return Math.round((projectedY / (TILE_HEIGHT / 2)) * 100);
};

const getCellVerticalPlaneEndpoints = (rotation = 0) => {
  const normalizedRotation = ((Number.parseInt(rotation, 10) || 0) % 180 + 180) % 180;
  const endpoints = normalizedRotation === 90
    ? [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }]
    : [{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }];
  return endpoints;
};

export const getCityChannelPartDepthBias = ({ placement, part, wall, cameraYaw = 0 }) => {
  if (!part) return 0;
  if (wall || placement?.source === 'wall') {
    return getProjectedAnchorDepthBias(edgeEndpointsByEdge[wall?.edge || placement?.edge] || edgeEndpointsByEdge.north, cameraYaw);
  }
  if (
    part.partType === 'wall_plane'
    || part.partType === 'wall_attachment'
    || part.partType === 'portal_body'
    || (part.partType === 'mechanism_connector' && part.anchor?.surface === CITY_CHANNEL_ANCHOR_SURFACES.CELL_VERTICAL)
  ) {
    return getProjectedAnchorDepthBias(getCellVerticalPlaneEndpoints(placement?.rotation || part.anchor?.rotation || 0), cameraYaw);
  }
  return 0;
};

export const createPhysicalRenderOrder = (sortDepth, physicalLayer, subBias = 0) => Math.round(
  CITY_CHANNEL_SCENE_RENDER_BASE
  + (sortDepth * CITY_CHANNEL_DEPTH_ORDER_SCALE)
  + ((CITY_CHANNEL_SORT_PHASES[physicalLayer] ?? 0) * CITY_CHANNEL_PHASE_ORDER_SCALE)
  + subBias
);

export const getCityChannelLayerSortDepth = (cell = {}) => (
  (Number(cell.z) || 0) * CITY_CHANNEL_LAYER_ORDER_STEP
);

export const compareCityChannelRenderItems = (a, b) => (
  (a.renderOrder - b.renderOrder)
  || String(a.part?.id || a.id || '').localeCompare(String(b.part?.id || b.id || ''))
);

const createHintCells = (mapData, hoverCell) => {
  const hints = new Map();
  const addHint = (x, y, z = 0) => {
    if (!isValidCell(x, y, z, mapData)) return;
    const key = createCellKey(x, y, z);
    if (mapData.tiles?.[key]) return;
    hints.set(key, { x, y, z });
  };
  Object.values(mapData.tiles || {}).forEach((tile) => {
    addHint(tile.x + 1, tile.y, tile.z);
    addHint(tile.x - 1, tile.y, tile.z);
    addHint(tile.x, tile.y + 1, tile.z);
    addHint(tile.x, tile.y - 1, tile.z);
  });
  if (hoverCell) {
    addHint(hoverCell.x, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x + 1, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x - 1, hoverCell.y, hoverCell.z);
    addHint(hoverCell.x, hoverCell.y + 1, hoverCell.z);
    addHint(hoverCell.x, hoverCell.y - 1, hoverCell.z);
  }
  return Array.from(hints.values());
};

export const createCityChannelRenderItems = ({
  domainModel = null,
  mapData = {},
  cameraYaw = 0,
  hoverCell = null,
  includeHints = true,
  projectCell = null,
  getPartDepthBias = null
} = {}) => {
  const sourceMap = domainModel ? mapData : normalizeCityChannelMap(mapData);
  const model = domainModel || buildCityChannelDomainModel(sourceMap);
  const mapCenter = getCityChannelMapCenter(sourceMap);
  const project = projectCell || ((cell) => projectCityChannelCell(cell, cameraYaw, mapCenter));
  const resolveDepthBias = getPartDepthBias || getCityChannelPartDepthBias;
  const hints = includeHints ? createHintCells(sourceMap, hoverCell).map((cell) => {
    const projection = project(cell, cameraYaw);
    const sortDepth = projection.depth + getCityChannelLayerSortDepth(cell);
    return {
      id: `hint:${cell.z}:${cell.x}:${cell.y}`,
      kind: 'hint',
      cell,
      projection,
      sortDepth,
      sortPhase: CITY_CHANNEL_SORT_PHASES[CITY_CHANNEL_PHYSICAL_LAYERS.EDITOR_OVERLAY],
      sortBias: 0,
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.EDITOR_OVERLAY,
      renderOrder: createPhysicalRenderOrder(sortDepth, CITY_CHANNEL_PHYSICAL_LAYERS.EDITOR_OVERLAY),
      visualParts: [
        {
          kind: 'hint_fill',
          sortPhase: 0,
          depthOffset: 0
        }
      ]
    };
  }) : [];

  const renderItems = [];

  model.placements.forEach((placement) => {
    const cell = placement.cell;
    const projection = project(cell, cameraYaw);
    const tile = placement.source === 'tile' ? sourceMap.tiles?.[cell.key] || null : null;
    const wall = placement.source === 'wall'
      ? sourceMap.walls?.[createWallKey(cell.x, cell.y, cell.z, placement.edge)] || null
      : null;

    placement.renderParts.forEach((part, index) => {
      const physicalLayer = part.physicalLayer || CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_BASE;
      const depthBias = resolveDepthBias({
        placement,
        part,
        tile,
        wall,
        cameraYaw,
        mapData: sourceMap
      });
      const sortDepth = projection.depth + getCityChannelLayerSortDepth(cell) + depthBias;
      const sortBias = (Number(part.sortBias) || 0) + index;
      const subBias = Math.round(sortBias);

      renderItems.push({
        id: part.id,
        kind: placement.source,
        placement,
        part,
        cell,
        tile,
        wall,
        projection,
        sortDepth,
        sortPhase: part.sortPhase,
        sortBias,
        subDepth: part.sortPhase + subBias,
        physicalLayer,
        renderOrder: createPhysicalRenderOrder(sortDepth, physicalLayer, subBias),
        visualParts: [part]
      });
    });
  });

  return [...hints, ...renderItems].sort(compareCityChannelRenderItems);
};

export const findCityChannelRenderItem = (renderItems, predicate) => (
  Array.isArray(renderItems) ? renderItems.find(predicate) || null : null
);

export const createCityChannelGhostRenderItems = ({
  mapData = {},
  cell = null,
  panelType = CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR,
  rotation = 0,
  edge = 'north',
  placementKind = 'tile',
  cameraYaw = 0,
  valid = true,
  mode = 'place'
} = {}) => {
  if (!cell) return [];
  const ghostMapData = {
    ...mapData,
    tiles: {},
    walls: {},
    entrances: [],
    exits: [],
    safeRoute: [],
    mechanisms: []
  };

  if (placementKind === 'edge_wall') {
    const wall = createWall({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      edge,
      panelType,
      rotation
    });
    ghostMapData.walls = {
      [createWallKey(cell.x, cell.y, cell.z, wall.edge)]: wall
    };
  } else {
    const tile = createTile({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType,
      rotation
    });
    ghostMapData.tiles = {
      [createCellKey(cell.x, cell.y, cell.z)]: tile
    };
  }

  return createCityChannelRenderItems({
    mapData: ghostMapData,
    cameraYaw,
    includeHints: false
  }).map((item) => ({
    ...item,
    id: `ghost:${item.id}`,
    isGhost: true,
    ghost: {
      valid,
      mode,
      placementKind,
      panelType,
      edge
    }
  }));
};

export const isCityChannelPortalType = (tileType) => (
  tileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || tileType === CITY_CHANNEL_TILE_TYPES.EXIT
);
