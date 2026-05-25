import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall
} from './cityChannelSchema';
import {
  computeCityChannelMovePreviewModel,
  getCityChannelPlacementCollisionBoxes,
  getSelectionAnchor
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
    expect(preview.invalidPlacementKeys).toEqual(new Set());
  });

  it('keeps multi-select movement across layers valid when moved boxes do not intersect', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(10, 11, 1)]: createTile({ x: 10, y: 11, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR }),
      [createCellKey(12, 10, 1)]: createTile({ x: 12, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.IRON_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 10, y: 10, z: 1 },
        { x: 10, y: 11, z: 1 }
      ],
      targetCell: { x: 11, y: 10, z: 1 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
    expect(preview.invalidPlacementKeys).toEqual(new Set());
  });

  it('keeps stacked upper floor previews valid when the lower floor provides structural support', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 1 }],
      targetCell: { x: 11, y: 10, z: 1 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
    expect(preview.invalidPlacementKeys).toEqual(new Set());
  });

  it('allows moved vertical boards to stand on a static floor tile', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        rotation: 90
      }),
      [createCellKey(12, 10, 0)]: createTile({
        x: 12,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 12, y: 10, z: 0 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
    expect(preview.invalidPlacementKeys).toEqual(new Set());
  });

  it('anchors multi-select movement to the stable selection origin rather than input order', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(11, 10, 0)]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 11, y: 10, z: 0 },
        { x: 10, y: 10, z: 0 }
      ],
      targetCell: { x: 20, y: 10, z: 0 }
    });

    expect(preview.anchor).toEqual({ x: 10, y: 10, z: 0 });
    expect(preview.moves).toEqual([
      {
        from: { x: 11, y: 10, z: 0 },
        to: { x: 21, y: 10, z: 0 }
      },
      {
        from: { x: 10, y: 10, z: 0 },
        to: { x: 20, y: 10, z: 0 }
      }
    ]);
  });

  it('splits disconnected selections into independent components', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
      [createCellKey(14, 10, 0)]: createTile({ x: 14, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 10, y: 10, z: 0 },
        { x: 14, y: 10, z: 0 }
      ],
      targetCell: { x: 15, y: 10, z: 0 }
    });

    expect(preview.components).toHaveLength(2);
    expect(preview.componentResults.size).toBe(2);
  });

  it('keeps floor panels structurally connected to selected vertical supports', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      [createCellKey(10, 10, 1)]: createTile({
        x: 10,
        y: 10,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR
      }),
      [createCellKey(12, 10, 0)]: createTile({
        x: 12,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [
        { x: 10, y: 10, z: 0 },
        { x: 10, y: 10, z: 1 }
      ],
      targetCell: { x: 12, y: 10, z: 0 }
    });

    expect(preview.components).toHaveLength(1);
    expect(preview.valid).toBe(true);
    expect(preview.invalidPlacementKeys).toEqual(new Set());
  });

  it('requires multi-select movement to use the stable group anchor instead of the held upper tile', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      }),
      [createCellKey(10, 10, 1)]: createTile({
        x: 10,
        y: 10,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR
      }),
      [createCellKey(12, 10, 0)]: createTile({
        x: 12,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;
    const origins = [
      { x: 10, y: 10, z: 0 },
      { x: 10, y: 10, z: 1 }
    ];

    const stablePreview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 12, y: 10, z: 0 }
    });
    const heldUpperTilePreview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: { x: 10, y: 10, z: 1 },
      targetCell: { x: 12, y: 10, z: 0 }
    });

    expect(stablePreview.valid).toBe(true);
    expect(stablePreview.moves.map((move) => move.to)).toEqual([
      { x: 12, y: 10, z: 0 },
      { x: 12, y: 10, z: 1 }
    ]);
    expect(heldUpperTilePreview.valid).toBe(false);
    expect(heldUpperTilePreview.conflicts.map((conflict) => conflict.reason)).toContain('placement_occupied');
  });

  it('selects the lowest stable origin as the carry anchor', () => {
    const anchor = getSelectionAnchor([
      { x: 12, y: 11, z: 2 },
      { x: 10, y: 10, z: 1 },
      { x: 11, y: 10, z: 1 }
    ]);

    expect(anchor).toEqual({ x: 10, y: 10, z: 1 });
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

  describe('新的多选移动合法性规则', () => {
    it('允许多选物体移动到空地', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 11, y: 10, z: 1 }
        ],
        targetCell: { x: 20, y: 20, z: 0 }
      });

      expect(preview.valid).toBe(true);
      expect(preview.conflicts).toEqual([]);
    });

    it('允许多选物体贴近静态物体移动', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR }),
        [createCellKey(20, 20, 1)]: createTile({ x: 20, y: 20, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.IRON_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 11, y: 10, z: 1 }
        ],
        targetCell: { x: 21, y: 20, z: 1 }
      });

      expect(preview.valid).toBe(true);
      expect(preview.conflicts).toEqual([]);
    });

    it('允许多选物体混合移动，不再要求传动连接点', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 11, y: 10, z: 1 }
        ],
        targetCell: { x: 20, y: 20, z: 3 }
      });

      expect(preview.valid).toBe(true);
      expect(preview.conflicts).toEqual([]);
      expect(preview.invalidPlacementKeys.size).toBe(0);
    });

    it('保留间断选中分量信息但不要求传动连接', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(20, 20, 1)]: createTile({ x: 20, y: 20, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 20, y: 20, z: 1 }
        ],
        targetCell: { x: 15, y: 15, z: 0 }
      });

      expect(preview.components).toHaveLength(2);
      expect(preview.valid).toBe(true);
    });

    it('仍然标记间断选中里的越界分量', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(20, 20, 5)]: createTile({ x: 20, y: 20, z: 5, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 0 },
          { x: 20, y: 20, z: 5 }
        ],
        targetCell: { x: 15, y: 15, z: 0 }
      });

      expect(preview.components).toHaveLength(2);
      expect(preview.valid).toBe(false);

      const invalidKeys = Array.from(preview.invalidPlacementKeys);
      expect(invalidKeys.length).toBe(1);
      expect(invalidKeys[0]).toContain('5:25:25');
    });

    it('仍然在目标有遮挡时标记遮挡部分为红色', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.WOOD_FLOOR }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.STONE_FLOOR }),
        [createCellKey(21, 20, 0)]: createTile({ x: 21, y: 20, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.IRON_FLOOR })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 11, y: 10, z: 1 }
        ],
        targetCell: { x: 20, y: 20, z: 0 }
      });

      expect(preview.valid).toBe(false);
      expect(preview.conflicts.map((c) => c.reason)).toContain('placement_occupied');
    });
  });
});
