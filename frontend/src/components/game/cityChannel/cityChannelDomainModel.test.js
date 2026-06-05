import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeCityChannelMap
} from './cityChannelSchema';
import {
  CITY_CHANNEL_PHYSICAL_LAYERS,
  CITY_CHANNEL_PLACEMENT_KINDS,
  buildCityChannelDomainModel,
  getCityChannelPlacementAtCell,
  getCityChannelPlacementAtEdge
} from './cityChannelDomainModel';

describe('cityChannelDomainModel', () => {
  it('classifies floor, ground attachment, portal, and edge wall placements', () => {
    const floorKey = createCellKey(10, 10, 0);
    const pressureKey = createCellKey(11, 10, 0);
    const portalKey = createCellKey(12, 10, 0);
    const wallKey = createWallKey(10, 10, 0, 'east');
    const mapData = {
      ...createBaseCityChannelMap({ name: 'domain model test' }),
      tiles: {
        [floorKey]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [pressureKey]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE }),
        [portalKey]: createTile({ x: 12, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE })
      },
      walls: {
        [wallKey]: createWall({ x: 10, y: 10, z: 0, edge: 'east' })
      },
      entrances: [{ id: 'entrance_test', x: 12, y: 10, z: 0 }]
    };

    const model = buildCityChannelDomainModel(mapData);

    expect(model.stats.floorPanels).toBe(1);
    expect(model.stats.groundAttachments).toBe(1);
    expect(model.stats.portals).toBe(1);
    expect(model.stats.edgeWalls).toBe(1);
    expect(model.conflicts).toEqual([]);
    expect(getCityChannelPlacementAtCell(model, { x: 11, y: 10, z: 0 })[0].kind).toBe(CITY_CHANNEL_PLACEMENT_KINDS.GROUND_ATTACHMENT);
    const portalPlacement = getCityChannelPlacementAtCell(model, { x: 12, y: 10, z: 0 })[0];
    expect(portalPlacement.kind).toBe(CITY_CHANNEL_PLACEMENT_KINDS.PORTAL);
    expect(portalPlacement.anchor.surface).toBe('ground');
    expect(portalPlacement.renderParts.map((part) => part.partType)).toEqual(['floor_base', 'floor_attachment']);
    expect(getCityChannelPlacementAtEdge(model, { x: 10, y: 10, z: 0, edge: 'east' })[0].kind).toBe(CITY_CHANNEL_PLACEMENT_KINDS.EDGE_WALL);
    expect(model.renderParts.some((part) => part.physicalLayer === CITY_CHANNEL_PHYSICAL_LAYERS.FLOOR_ATTACHMENT)).toBe(true);
    expect(model.renderParts.some((part) => part.physicalLayer === CITY_CHANNEL_PHYSICAL_LAYERS.WALL_PLANE)).toBe(true);
    expect(model.renderParts.some((part) => part.physicalLayer === CITY_CHANNEL_PHYSICAL_LAYERS.PORTAL_BODY)).toBe(false);
  });

  it('reports unsupported edge walls without mutating the map shape', () => {
    const wallKey = createWallKey(5, 5, 0, 'north');
    const mapData = {
      ...createBaseCityChannelMap({ name: 'unsupported wall test' }),
      walls: {
        [wallKey]: createWall({ x: 5, y: 5, z: 0, edge: 'north' })
      }
    };

    const model = buildCityChannelDomainModel(mapData);

    expect(model.stats.edgeWalls).toBe(1);
    expect(model.conflicts).toHaveLength(1);
    expect(model.conflicts[0].type).toBe('missing_wall_support');
  });

  it('drops legacy edge wall flipped state during normalization', () => {
    const wallKey = createWallKey(8, 8, 0, 'east');
    const mapData = normalizeCityChannelMap({
      ...createBaseCityChannelMap({ name: 'flipped wall test' }),
      walls: {
        [wallKey]: {
          ...createWall({ x: 8, y: 8, z: 0, edge: 'east' }),
          flipped: true
        }
      }
    });

    expect(mapData.walls[wallKey].flipped).toBe(false);
  });
});
