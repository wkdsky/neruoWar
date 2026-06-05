import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  normalizeCityChannelMap
} from './cityChannelSchema';
import {
  CITY_CHANNEL_MATERIAL_GROUPS,
  getPaletteCityChannelMaterials
} from './cityChannelCatalog';

describe('city channel portal panels', () => {
  it('exposes entrance and exit in a dedicated board library group', () => {
    const portalGroup = CITY_CHANNEL_MATERIAL_GROUPS.find((group) => group.id === 'portal_board');
    const paletteIds = getPaletteCityChannelMaterials().map((material) => material.id);

    expect(portalGroup?.categories).toContain('portal_board');
    expect(paletteIds).toEqual(expect.arrayContaining([
      CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      CITY_CHANNEL_TILE_TYPES.EXIT
    ]));
  });

  it('keeps portal panels horizontal even when legacy data marks them as vertical', () => {
    const entrance = createTile({
      x: 2,
      y: 2,
      z: 0,
      panelType: CITY_CHANNEL_TILE_TYPES.ENTRANCE,
      isVertical: true
    });
    const key = createCellKey(entrance.x, entrance.y, entrance.z);
    const mapData = normalizeCityChannelMap({
      ...createBaseCityChannelMap({ width: 4, height: 4 }),
      tiles: {
        [key]: {
          ...entrance,
          isVertical: true
        }
      },
      entrances: [{ id: 'entrance_test', x: 2, y: 2, z: 0 }]
    });

    expect(entrance.isVertical).toBe(false);
    expect(mapData.tiles[key].isVertical).toBe(false);
  });

  it('falls back to an ordinary board when a portal type is requested as a wall', () => {
    const wall = createWall({
      x: 1,
      y: 1,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.EXIT
    });

    expect(wall.panelType).toBe(CITY_CHANNEL_TILE_TYPES.BASIC_PLATE);
  });
});
