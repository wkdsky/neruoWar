import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createWallKey,
  getPortalPassAxis,
  normalizeCityChannelMap,
  wallEdgeToRotation
} from './cityChannelSchema';
import { getCityChannelMaterial, isMechanicalMaterial } from './cityChannelCatalog';

export const CITY_CHANNEL_PHYSICAL_LAYERS = {
  FLOOR_BASE: 'floor_base',
  FLOOR_ATTACHMENT: 'floor_attachment',
  WALL_PLANE: 'wall_plane',
  WALL_ATTACHMENT: 'wall_attachment',
  PORTAL_BODY: 'portal_body',
  MECHANISM_CONNECTOR: 'mechanism_connector',
  EDITOR_OVERLAY: 'editor_overlay'
};

export const CITY_CHANNEL_ANCHOR_SURFACES = {
  GROUND: 'ground',
  CELL_VERTICAL: 'cell_vertical',
  EDGE: 'edge',
  PORTAL: 'portal'
};

export const CITY_CHANNEL_PLACEMENT_KINDS = {
  FLOOR_PANEL: 'floor_panel',
  GROUND_ATTACHMENT: 'ground_attachment',
  CELL_VERTICAL_PANEL: 'cell_vertical_panel',
  EDGE_WALL: 'edge_wall',
  PORTAL: 'portal'
};

export const CITY_CHANNEL_SORT_PHASES = {
  [CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_BASE]: 0,
  [CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_ATTACHMENT]: 10,
  [CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE]: 20,
  [CITY_CHANNEL_PHYSICAL_LAYERS.WALL_ATTACHMENT]: 30,
  [CITY_CHANNEL_PHYSICAL_LAYERS.PORTAL_BODY]: 34,
  [CITY_CHANNEL_PHYSICAL_LAYERS.MECHANISM_CONNECTOR]: 40,
  [CITY_CHANNEL_PHYSICAL_LAYERS.EDITOR_OVERLAY]: 90
};

const isPortalTile = (tile) => (
  tile?.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE
  || tile?.panelType === CITY_CHANNEL_TILE_TYPES.EXIT
);

const createCellRef = (cell) => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
  key: createCellKey(cell.x, cell.y, cell.z)
});

const createRenderPart = ({
  id,
  placementId,
  partType,
  physicalLayer,
  anchor,
  panelType,
  materialId,
  sortBias = 0,
  blocksSight = false,
  blocksPointer = true
}) => ({
  id,
  placementId,
  partType,
  physicalLayer,
  sortPhase: CITY_CHANNEL_SORT_PHASES[physicalLayer] ?? 0,
  sortBias,
  anchor,
  panelType,
  materialId,
  blocksSight,
  blocksPointer
});

const createConnectorParts = ({ placementId, anchor, panelType, materialId, connectors = [] }) => (
  Array.isArray(connectors)
    ? connectors.map((connector) => createRenderPart({
      id: `${placementId}:connector:${connector.id || connector.label || 'node'}`,
      placementId,
      partType: 'mechanism_connector',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.MECHANISM_CONNECTOR,
      anchor,
      panelType,
      materialId,
      sortBias: 2,
      blocksSight: false,
      blocksPointer: true,
      connectorId: connector.id || null,
      connectorLabel: connector.label || connector.id || 'node',
      connectorDirection: connector.direction || 'out',
      connectorPosition: connector.position || null
    }))
    : []
);

const classifyTilePlacement = (tile) => {
  const material = getCityChannelMaterial(tile.panelType);
  const mechanical = isMechanicalMaterial(material);
  if (isPortalTile(tile)) {
    return {
      kind: CITY_CHANNEL_PLACEMENT_KINDS.PORTAL,
      anchorSurface: CITY_CHANNEL_ANCHOR_SURFACES.GROUND,
      hasFloorBase: true,
      hasFloorAttachment: true,
      hasWallPlane: false,
      hasWallAttachment: false,
      hasPortalBody: false,
      mechanical,
      passAxis: getPortalPassAxis(tile.rotation)
    };
  }
  if (tile.isVertical) {
    return {
      kind: CITY_CHANNEL_PLACEMENT_KINDS.CELL_VERTICAL_PANEL,
      anchorSurface: CITY_CHANNEL_ANCHOR_SURFACES.CELL_VERTICAL,
      hasFloorBase: true,
      hasFloorAttachment: false,
      hasWallPlane: true,
      hasWallAttachment: mechanical || !!tile.mechanismModel,
      hasPortalBody: false,
      mechanical,
      passAxis: null
    };
  }
  if (mechanical || tile.mechanismModel) {
    return {
      kind: CITY_CHANNEL_PLACEMENT_KINDS.GROUND_ATTACHMENT,
      anchorSurface: CITY_CHANNEL_ANCHOR_SURFACES.GROUND,
      hasFloorBase: true,
      hasFloorAttachment: true,
      hasWallPlane: false,
      hasWallAttachment: false,
      hasPortalBody: false,
      mechanical: true,
      passAxis: null
    };
  }
  return {
    kind: CITY_CHANNEL_PLACEMENT_KINDS.FLOOR_PANEL,
    anchorSurface: CITY_CHANNEL_ANCHOR_SURFACES.GROUND,
    hasFloorBase: true,
    hasFloorAttachment: false,
    hasWallPlane: false,
    hasWallAttachment: false,
    hasPortalBody: false,
    mechanical: false,
    passAxis: null
  };
};

const buildTilePlacement = (tile) => {
  const cell = createCellRef(tile);
  const placementId = `tile:${cell.key}`;
  const material = getCityChannelMaterial(tile.panelType);
  const classification = classifyTilePlacement(tile);
  const anchor = {
    surface: classification.anchorSurface,
    cell
  };
  const renderParts = [];

  if (classification.hasFloorBase) {
    renderParts.push(createRenderPart({
      id: `${placementId}:floor-base`,
      placementId,
      partType: 'floor_base',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_BASE,
      anchor,
      panelType: tile.panelType,
      materialId: material.id,
      blocksSight: false,
      blocksPointer: true
    }));
  }

  if (classification.hasFloorAttachment) {
    renderParts.push(createRenderPart({
      id: `${placementId}:floor-attachment`,
      placementId,
      partType: 'floor_attachment',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_ATTACHMENT,
      anchor,
      panelType: tile.panelType,
      materialId: material.id,
      sortBias: 1,
      blocksSight: false,
      blocksPointer: true
    }));
  }

  if (classification.hasWallPlane) {
    renderParts.push(createRenderPart({
      id: `${placementId}:wall-plane`,
      placementId,
      partType: 'wall_plane',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE,
      anchor,
      panelType: tile.panelType,
      materialId: material.id,
      sortBias: 1,
      blocksSight: tile.transparent !== true,
      blocksPointer: true
    }));
  }

  if (classification.hasWallAttachment) {
    renderParts.push(createRenderPart({
      id: `${placementId}:wall-attachment`,
      placementId,
      partType: 'wall_attachment',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.WALL_ATTACHMENT,
      anchor,
      panelType: tile.panelType,
      materialId: material.id,
      sortBias: 2,
      blocksSight: false,
      blocksPointer: true
    }));
  }

  if (classification.hasPortalBody) {
    renderParts.push(createRenderPart({
      id: `${placementId}:portal-body`,
      placementId,
      partType: 'portal_body',
      physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.PORTAL_BODY,
      anchor,
      panelType: tile.panelType,
      materialId: material.id,
      sortBias: 2,
      blocksSight: false,
      blocksPointer: true
    }));
  }

  renderParts.push(...createConnectorParts({
    placementId,
    anchor,
    panelType: tile.panelType,
    materialId: material.id,
    connectors: tile.connectors
  }));

  return {
    id: placementId,
    source: 'tile',
    kind: classification.kind,
    panelType: tile.panelType,
    materialId: material.id,
    category: tile.category || material.category,
    cell,
    edge: null,
    rotation: tile.rotation || 0,
    anchor,
    occupancy: {
      cells: [cell.key],
      edges: [],
      walkable: tile.walkable !== false,
      blocksMovement: tile.solid === true,
      transparent: tile.transparent === true,
      passAxis: classification.passAxis
    },
    mechanics: {
      enabled: classification.mechanical,
      modelType: tile.mechanismModel?.type || null,
      connectorIds: Array.isArray(tile.connectors) ? tile.connectors.map((connector) => connector.id).filter(Boolean) : []
    },
    renderParts
  };
};

const buildWallPlacement = (wall, mapData) => {
  const cell = createCellRef(wall);
  const wallKey = createWallKey(wall.x, wall.y, wall.z, wall.edge);
  const placementId = `wall:${wallKey}`;
  const material = getCityChannelMaterial(wall.panelType);
  const anchor = {
    surface: CITY_CHANNEL_ANCHOR_SURFACES.EDGE,
    cell,
    edge: wall.edge
  };
  const hasSupportCell = !!mapData.tiles[cell.key];

  return {
    id: placementId,
    source: 'wall',
    kind: CITY_CHANNEL_PLACEMENT_KINDS.EDGE_WALL,
    panelType: wall.panelType,
    materialId: material.id,
    category: wall.category || material.category,
    cell,
    edge: wall.edge,
    rotation: wallEdgeToRotation(wall.edge),
    anchor,
    occupancy: {
      cells: [],
      edges: [wallKey],
      walkable: false,
      blocksMovement: true,
      transparent: wall.transparent === true,
      passAxis: null,
      requiresSupportCell: true,
      hasSupportCell
    },
    mechanics: {
      enabled: false,
      modelType: null,
      connectorIds: []
    },
    renderParts: [
      createRenderPart({
        id: `${placementId}:wall-plane`,
        placementId,
        partType: 'wall_plane',
        physicalLayer: CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE,
        anchor,
        panelType: wall.panelType,
        materialId: material.id,
        sortBias: 1,
        blocksSight: wall.transparent !== true,
        blocksPointer: true
      })
    ]
  };
};

const indexPlacement = (placement, model) => {
  placement.occupancy.cells.forEach((cellKey) => {
    model.cellIndex[cellKey] = model.cellIndex[cellKey] || [];
    model.cellIndex[cellKey].push(placement.id);
  });
  placement.occupancy.edges.forEach((edgeKey) => {
    model.edgeIndex[edgeKey] = model.edgeIndex[edgeKey] || [];
    model.edgeIndex[edgeKey].push(placement.id);
  });
};

const collectPlacementConflicts = (placement) => {
  if (
    placement.kind === CITY_CHANNEL_PLACEMENT_KINDS.EDGE_WALL
    && placement.occupancy.requiresSupportCell
    && !placement.occupancy.hasSupportCell
  ) {
    return [{
      type: 'missing_wall_support',
      severity: 'warning',
      placementId: placement.id,
      message: '墙板没有可挂载的地面板'
    }];
  }
  return [];
};

export const buildCityChannelDomainModel = (rawMapData = {}) => {
  const mapData = normalizeCityChannelMap(rawMapData);
  const model = {
    version: mapData.version,
    name: mapData.name,
    templateMeta: mapData.templateMeta,
    dimensions: {
      width: mapData.width,
      height: mapData.height,
      layers: mapData.layers
    },
    placements: [],
    renderParts: [],
    cellIndex: {},
    edgeIndex: {},
    conflicts: [],
    stats: {
      floorPanels: 0,
      groundAttachments: 0,
      cellVerticalPanels: 0,
      edgeWalls: 0,
      portals: 0,
      connectors: 0,
      renderParts: 0
    }
  };

  Object.values(mapData.tiles || {}).forEach((tile) => {
    const placement = buildTilePlacement(tile);
    model.placements.push(placement);
    model.renderParts.push(...placement.renderParts);
    indexPlacement(placement, model);
    model.conflicts.push(...collectPlacementConflicts(placement));
  });

  Object.values(mapData.walls || {}).forEach((wall) => {
    const placement = buildWallPlacement(wall, mapData);
    model.placements.push(placement);
    model.renderParts.push(...placement.renderParts);
    indexPlacement(placement, model);
    model.conflicts.push(...collectPlacementConflicts(placement));
  });

  model.stats.floorPanels = model.placements.filter((item) => item.kind === CITY_CHANNEL_PLACEMENT_KINDS.FLOOR_PANEL).length;
  model.stats.groundAttachments = model.placements.filter((item) => item.kind === CITY_CHANNEL_PLACEMENT_KINDS.GROUND_ATTACHMENT).length;
  model.stats.cellVerticalPanels = model.placements.filter((item) => item.kind === CITY_CHANNEL_PLACEMENT_KINDS.CELL_VERTICAL_PANEL).length;
  model.stats.edgeWalls = model.placements.filter((item) => item.kind === CITY_CHANNEL_PLACEMENT_KINDS.EDGE_WALL).length;
  model.stats.portals = model.placements.filter((item) => item.kind === CITY_CHANNEL_PLACEMENT_KINDS.PORTAL).length;
  model.stats.connectors = model.renderParts.filter((item) => item.physicalLayer === CITY_CHANNEL_PHYSICAL_LAYERS.MECHANISM_CONNECTOR).length;
  model.stats.renderParts = model.renderParts.length;

  return model;
};

export const getCityChannelPlacementAtCell = (domainModel, cell) => {
  if (!domainModel || !cell) return [];
  const key = typeof cell === 'string' ? cell : createCellKey(cell.x, cell.y, cell.z);
  const ids = domainModel.cellIndex?.[key] || [];
  return ids.map((id) => domainModel.placements.find((placement) => placement.id === id)).filter(Boolean);
};

export const getCityChannelPlacementAtEdge = (domainModel, wallLike) => {
  if (!domainModel || !wallLike) return [];
  const key = typeof wallLike === 'string'
    ? wallLike
    : createWallKey(wallLike.x, wallLike.y, wallLike.z, wallLike.edge);
  const ids = domainModel.edgeIndex?.[key] || [];
  return ids.map((id) => domainModel.placements.find((placement) => placement.id === id)).filter(Boolean);
};
