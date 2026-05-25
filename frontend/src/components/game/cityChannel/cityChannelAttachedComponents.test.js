import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from './cityChannelSchema';
import {
  buildPlacementGhostAtTarget,
  getInstalledComponentMounts,
  getMovingHostKeysFromOrigins,
  isInstalledComponentMount
} from './cityChannelAttachedComponents';
import { computeCityChannelMovePreviewModel } from './cityChannelMovePreview';

describe('cityChannelAttachedComponents', () => {
  it('detects installed component mounts by componentType', () => {
    expect(isInstalledComponentMount({ componentType: 'gear' })).toBe(true);
    expect(isInstalledComponentMount({ position: 'center' })).toBe(false);
  });

  it('builds ghost placement at target coordinates with attached gear mounts', () => {
    const source = createTile({
      x: 10,
      y: 10,
      z: 1,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    source.gearMounts = [{
      id: 'gear_a',
      componentType: 'gear',
      position: 'center',
      surface: 'front'
    }];

    const ghost = buildPlacementGhostAtTarget(source, { x: 12, y: 11, z: 2 });
    expect(ghost).toMatchObject({ x: 12, y: 11, z: 2 });
    expect(getInstalledComponentMounts(ghost)).toHaveLength(1);
  });

  it('tracks moving host keys for tile and wall origins', () => {
    const keys = getMovingHostKeysFromOrigins([
      { x: 10, y: 10, z: 0 },
      { x: 11, y: 10, z: 0, edge: 'north' }
    ]);
    expect(keys.has('0:10:10')).toBe(true);
    expect(keys.has('0:11:10:north')).toBe(true);
  });

  it('keeps installed gear mounts on moved tile previews', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'attached gear move' }),
      tiles: {
        [createCellKey(10, 10, 0)]: createTile({
          x: 10,
          y: 10,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      },
      walls: {}
    };
    mapData.tiles[createCellKey(10, 10, 0)].gearMounts = [{
      id: 'gear_move',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front'
    }];

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 12, y: 10, z: 0 }
    });

    const movedKey = createCellKey(12, 10, 0);
    expect(preview.previewTiles.get(movedKey)?.gearMounts).toEqual(mapData.tiles[createCellKey(10, 10, 0)].gearMounts);
  });

  it('keeps installed gear mounts for each origin in multi-select moves', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'multi attached gear move' }),
      tiles: {
        [createCellKey(10, 10, 1)]: createTile({
          x: 10,
          y: 10,
          z: 1,
          panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR
        }),
        [createCellKey(11, 10, 1)]: createTile({
          x: 11,
          y: 10,
          z: 1,
          panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR
        })
      },
      walls: {}
    };
    mapData.tiles[createCellKey(10, 10, 1)].gearMounts = [{
      id: 'gear_a',
      componentType: 'gear',
      position: 'center',
      surface: 'front'
    }];
    mapData.tiles[createCellKey(11, 10, 1)].gearMounts = [{
      id: 'gear_b',
      componentType: 'gear',
      position: 'corner_sw',
      surface: 'front'
    }];

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 10, y: 10, z: 1 },
        { x: 11, y: 10, z: 1 }
      ],
      targetCell: { x: 20, y: 20, z: 0 }
    });

    expect(preview.previewTiles.get(createCellKey(20, 20, 0))?.gearMounts).toHaveLength(1);
    expect(preview.previewTiles.get(createCellKey(21, 20, 0))?.gearMounts).toHaveLength(1);
  });
});
