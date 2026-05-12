import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from './cityChannelSchema';
import {
  CITY_CHANNEL_PHYSICAL_LAYERS,
  buildCityChannelDomainModel
} from './cityChannelDomainModel';
import {
  createCityChannelRenderItems,
  createCityChannelGhostRenderItems,
  findCityChannelRenderItem
} from './cityChannelRenderModel';
import { createOcclusionRegressionTemplate } from './cityChannelTemplates';

const createMapWithTiles = (tiles = {}, walls = {}) => ({
  ...createBaseCityChannelMap({ name: 'render order regression' }),
  tiles,
  walls
});

const getPart = (items, { x, y, z = 0, source = 'tile', edge = null, partType }) => {
  const cellKey = createCellKey(x, y, z);
  const placementId = source === 'wall'
    ? `wall:${createWallKey(x, y, z, edge)}`
    : `tile:${cellKey}`;
  return findCityChannelRenderItem(items, (item) => (
    item.part?.placementId === placementId
    && item.part?.partType === partType
  ));
};

describe('cityChannelRenderModel', () => {
  it('orders floor bases before edge wall planes on the same cell', () => {
    const floorKey = createCellKey(16, 16, 0);
    const wallKey = createWallKey(16, 16, 0, 'south');
    const mapData = createMapWithTiles({
      [floorKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR })
    }, {
      [wallKey]: createWall({ x: 16, y: 16, z: 0, edge: 'south' })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const floor = getPart(items, { x: 16, y: 16, partType: 'floor_base' });
    const wall = getPart(items, { x: 16, y: 16, source: 'wall', edge: 'south', partType: 'wall_plane' });

    expect(floor).toBeTruthy();
    expect(wall).toBeTruthy();
    expect(floor.renderOrder).toBeLessThan(wall.renderOrder);
    expect(wall.physicalLayer).toBe(CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE);
  });

  it('allows a foreground floor to occlude a background wall by projected depth', () => {
    const wallFloorKey = createCellKey(16, 16, 0);
    const foregroundFloorKey = createCellKey(16, 17, 0);
    const wallKey = createWallKey(16, 16, 0, 'north');
    const mapData = createMapWithTiles({
      [wallFloorKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [foregroundFloorKey]: createTile({ x: 16, y: 17, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    }, {
      [wallKey]: createWall({ x: 16, y: 16, z: 0, edge: 'north' })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const wall = getPart(items, { x: 16, y: 16, source: 'wall', edge: 'north', partType: 'wall_plane' });
    const foregroundFloor = getPart(items, { x: 16, y: 17, partType: 'floor_base' });

    expect(wall).toBeTruthy();
    expect(foregroundFloor).toBeTruthy();
    expect(wall.renderOrder).toBeLessThan(foregroundFloor.renderOrder);
  });

  it('keeps ground mechanisms above their floor base but below a same-cell wall plane', () => {
    const cellKey = createCellKey(16, 16, 0);
    const wallKey = createWallKey(16, 16, 0, 'south');
    const mapData = createMapWithTiles({
      [cellKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.PRESSURE_PLATE })
    }, {
      [wallKey]: createWall({ x: 16, y: 16, z: 0, edge: 'south' })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const floor = getPart(items, { x: 16, y: 16, partType: 'floor_base' });
    const mechanism = getPart(items, { x: 16, y: 16, partType: 'floor_attachment' });
    const wall = getPart(items, { x: 16, y: 16, source: 'wall', edge: 'south', partType: 'wall_plane' });

    expect(floor.renderOrder).toBeLessThan(mechanism.renderOrder);
    expect(mechanism.renderOrder).toBeLessThan(wall.renderOrder);
  });

  it('keeps wall attachments above their owning wall plane', () => {
    const cellKey = createCellKey(16, 16, 0);
    const mapData = createMapWithTiles({
      [cellKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.SIDE_PUSHER_PLATE, rotation: 0 })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const wall = getPart(items, { x: 16, y: 16, partType: 'wall_plane' });
    const attachment = getPart(items, { x: 16, y: 16, partType: 'wall_attachment' });

    expect(wall).toBeTruthy();
    expect(attachment).toBeTruthy();
    expect(wall.renderOrder).toBeLessThan(attachment.renderOrder);
    expect(attachment.physicalLayer).toBe(CITY_CHANNEL_PHYSICAL_LAYERS.WALL_ATTACHMENT);
  });

  it('assigns portal bodies to the portal physical layer after the floor base', () => {
    const cellKey = createCellKey(16, 16, 0);
    const mapData = createMapWithTiles({
      [cellKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE, rotation: 90 })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const floor = getPart(items, { x: 16, y: 16, partType: 'floor_base' });
    const portal = getPart(items, { x: 16, y: 16, partType: 'portal_body' });

    expect(floor.renderOrder).toBeLessThan(portal.renderOrder);
    expect(portal.physicalLayer).toBe(CITY_CHANNEL_PHYSICAL_LAYERS.PORTAL_BODY);
  });

  it('allows a foreground floor to occlude a background portal body by projected depth', () => {
    const portalKey = createCellKey(16, 16, 0);
    const foregroundFloorKey = createCellKey(16, 17, 0);
    const mapData = createMapWithTiles({
      [portalKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE, rotation: 90 }),
      [foregroundFloorKey]: createTile({ x: 16, y: 17, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.IRON_FLOOR })
    });
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    const portal = getPart(items, { x: 16, y: 16, partType: 'portal_body' });
    const foregroundFloor = getPart(items, { x: 16, y: 17, partType: 'floor_base' });

    expect(portal).toBeTruthy();
    expect(foregroundFloor).toBeTruthy();
    expect(portal.renderOrder).toBeLessThan(foregroundFloor.renderOrder);
  });

  it('orders floor ghosts with the same projected depth rules as placed floors', () => {
    const wallFloorKey = createCellKey(16, 16, 0);
    const foregroundCell = { x: 16, y: 17, z: 0 };
    const wallKey = createWallKey(16, 16, 0, 'north');
    const mapData = createMapWithTiles({
      [wallFloorKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR })
    }, {
      [wallKey]: createWall({ x: 16, y: 16, z: 0, edge: 'north' })
    });
    const sceneItems = [
      ...createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false }),
      ...createCityChannelGhostRenderItems({
        mapData,
        cell: foregroundCell,
        panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR,
        cameraYaw: 0
      })
    ].sort((a, b) => a.renderOrder - b.renderOrder);

    const wall = getPart(sceneItems, { x: 16, y: 16, source: 'wall', edge: 'north', partType: 'wall_plane' });
    const ghostFloor = findCityChannelRenderItem(sceneItems, (item) => item.isGhost && item.part?.partType === 'floor_base');

    expect(wall).toBeTruthy();
    expect(ghostFloor).toBeTruthy();
    expect(wall.renderOrder).toBeLessThan(ghostFloor.renderOrder);
  });

  it('splits wall ghosts into wall-plane render items', () => {
    const cell = { x: 16, y: 16, z: 0 };
    const mapData = createMapWithTiles({
      [createCellKey(cell.x, cell.y, cell.z)]: createTile({ ...cell, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR })
    });
    const ghostItems = createCityChannelGhostRenderItems({
      mapData,
      cell,
      panelType: CITY_CHANNEL_TILE_TYPES.WALL,
      edge: 'south',
      placementKind: 'edge_wall',
      cameraYaw: 0,
      valid: true
    });

    expect(ghostItems).toHaveLength(1);
    expect(ghostItems[0].isGhost).toBe(true);
    expect(ghostItems[0].part?.partType).toBe('wall_plane');
    expect(ghostItems[0].physicalLayer).toBe(CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE);
    expect(ghostItems[0].ghost.valid).toBe(true);
  });

  it('matches the domain model render part count without editor-only hints', () => {
    const cellKey = createCellKey(16, 16, 0);
    const wallKey = createWallKey(16, 16, 0, 'east');
    const mapData = createMapWithTiles({
      [cellKey]: createTile({ x: 16, y: 16, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.PRESSURE_PLATE })
    }, {
      [wallKey]: createWall({ x: 16, y: 16, z: 0, edge: 'east' })
    });
    const model = buildCityChannelDomainModel(mapData);
    const items = createCityChannelRenderItems({ domainModel: model, mapData, cameraYaw: 0, includeHints: false });

    expect(items).toHaveLength(model.renderParts.length);
  });

  it('provides a hidden template for visual occlusion regression checks', () => {
    const mapData = createOcclusionRegressionTemplate();
    const items = createCityChannelRenderItems({ mapData, cameraYaw: 0, includeHints: false });

    expect(mapData.templateMeta.templateId).toBe('occlusion-regression');
    expect(mapData.templateMeta.visibility).toBe('private');
    expect(getPart(items, { x: 15, y: 16, source: 'wall', edge: 'north', partType: 'wall_plane' })).toBeTruthy();
    expect(getPart(items, { x: 16, y: 16, source: 'wall', edge: 'south', partType: 'wall_plane' })).toBeTruthy();
    expect(getPart(items, { x: 17, y: 16, partType: 'floor_attachment' })).toBeTruthy();
    expect(getPart(items, { x: 15, y: 15, partType: 'portal_body' })).toBeTruthy();
    expect(getPart(items, { x: 18, y: 17, partType: 'portal_body' })).toBeTruthy();
  });
});
