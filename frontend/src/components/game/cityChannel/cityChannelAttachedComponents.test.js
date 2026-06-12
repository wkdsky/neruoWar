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
import { DOUBLE_SIDED_RACK_COMPONENT_TYPE } from './cityChannelRackModel';

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

  it('rejects moved gear mounts that would overlap a rack', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'attached gear rack overlap' }),
      tiles: {
        [createCellKey(1, 1, 0)]: createTile({
          x: 1,
          y: 1,
          z: 0,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        })
      },
      walls: {},
      racks: {
        rack_overlap: {
          id: 'rack_overlap',
          componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
          direction: 'x',
          z: 0,
          start: { x: 0.5, y: 1.5, z: 0 },
          end: { x: 2.5, y: 1.5, z: 0 }
        }
      }
    };
    mapData.tiles[createCellKey(1, 1, 0)].gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      surface: 'front'
    }];

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 1, y: 1, z: 0 }],
      targetCell: { x: 1, y: 2, z: 0 }
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'gear_rack_overlap' })
    ]));
  });

  it('keeps installed gear mounts for each origin in multi-select moves', () => {
    const mapData = {
      ...createBaseCityChannelMap({ name: 'multi attached gear move' }),
      tiles: {
        [createCellKey(10, 10, 1)]: createTile({
          x: 10,
          y: 10,
          z: 1,
          panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
        }),
        [createCellKey(11, 10, 1)]: createTile({
          x: 11,
          y: 10,
          z: 1,
          panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
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
