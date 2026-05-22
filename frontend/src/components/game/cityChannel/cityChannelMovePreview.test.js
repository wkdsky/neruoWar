import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall
} from './cityChannelSchema';
import {
  computeCityChannelMovePreviewModel,
  getCityChannelPlacementCollisionBoxes
} from './cityChannelMovePreview';

const createMapWithTiles = (tiles = {}) => ({
  ...createBaseCityChannelMap({ name: 'move preview regression' }),
  tiles,
  walls: {}
});

describe('cityChannelMovePreview', () => {
  it('marks same-layer moved tiles invalid when their volumes overlap a static tile', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(11, 10, 0)]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 11, y: 10, z: 0 }
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts.map((conflict) => conflict.reason)).toContain('placement_occupied');
  });

  it('keeps cross-layer floor previews valid when their volumes do not intersect', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 1 }],
      targetCell: { x: 11, y: 10, z: 1 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
  });

  it('keeps multi-select movement across layers valid when moved boxes do not intersect', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(10, 11, 0)]: createTile({ x: 10, y: 11, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR }),
      [createCellKey(12, 10, 0)]: createTile({ x: 12, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.IRON_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 10, y: 10, z: 1 },
        { x: 10, y: 11, z: 0 }
      ],
      targetCell: { x: 11, y: 10, z: 1 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
  });

  it('represents edge walls as thin vertical volumes', () => {
    const boxes = getCityChannelPlacementCollisionBoxes(createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'south',
      panelType: CITY_CHANNEL_TILE_TYPES.WALL
    }));

    expect(boxes).toHaveLength(1);
    expect(boxes[0].maxZ).toBe(1);
    expect(boxes[0].maxY - boxes[0].minY).toBeLessThan(0.2);
  });
});
