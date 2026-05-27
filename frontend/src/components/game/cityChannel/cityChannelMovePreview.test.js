import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile,
  createWall,
  createWallKey
} from './cityChannelSchema';
import {
  computeCityChannelMovePreviewModel,
  getCityChannelPlacementCollisionBoxes,
  getSelectionAnchor
} from './cityChannelMovePreview';
import { buildMechanicalAssemblies } from './cityChannelMechanismRuntime';

const createMapWithTiles = (tiles = {}) => ({
  ...createBaseCityChannelMap({ name: 'move preview regression' }),
  tiles,
  walls: {}
});

describe('cityChannelMovePreview', () => {
  it('marks same-layer moved tiles invalid when their volumes overlap a static tile', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(11, 10, 0)]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 11, y: 10, z: 0 }
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts.map((conflict) => conflict.reason)).toContain('placement_occupied');
  });

  it('keeps cross-layer floor previews valid when moved boxes do not collide', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(10, 11, 1)]: createTile({ x: 10, y: 11, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE }),
      [createCellKey(12, 10, 1)]: createTile({ x: 12, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE })
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
  });

  it('keeps stacked upper floor previews valid under group collision-only legality', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 1 }],
      targetCell: { x: 11, y: 10, z: 1 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
  });

  it('lays a moved vertical board flat when the target cell carries layFlat intent', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 12, y: 10, z: 0, layFlat: true }
    });

    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toEqual([]);
    expect(preview.movedTilePlacements).toHaveLength(1);
    expect(preview.movedTilePlacements[0].isVertical).toBe(false);
    expect(preview.moves[0].to.layFlat).toBe(true);
  });

  it('lays a moved wall placement flat when the target cell carries layFlat intent', () => {
    const wall = createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'wall lay flat regression' }),
      tiles: {},
      walls: {
        '0:10:10:north': wall
      }
    };

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0, edge: 'north' }],
      targetCell: { x: 12, y: 10, z: 0, layFlat: true }
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves[0].to.edge).toBeUndefined();
    expect(preview.moves[0].to.layFlat).toBe(true);
    expect(preview.movedWallPlacements).toHaveLength(0);
    expect(preview.movedTilePlacements).toHaveLength(1);
    expect(preview.movedTilePlacements[0].isVertical).toBe(false);
  });

  it('raises a moved flat board into a wall when the target carries an edge', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 90
      })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 12, y: 10, z: 0, edge: 'east' }
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves[0].to.edge).toBe('east');
    expect(preview.movedTilePlacements).toHaveLength(0);
    expect(preview.movedWallPlacements).toHaveLength(1);
    expect(preview.movedWallPlacements[0].edge).toBe('east');
  });

  it('applies target rotation to moved wall transmission surface', () => {
    const wall = createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      transmissionRotation: 0
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'wall move rotate regression' }),
      tiles: {},
      walls: {
        '0:10:10:north': wall
      }
    };

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0, edge: 'north' }],
      targetCell: { x: 12, y: 10, z: 0, edge: 'north', rotation: 90 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.movedWallPlacements).toHaveLength(1);
    expect(preview.movedWallPlacements[0].transmissionRotation).toBe(90);
  });

  it('applies target rotation to moved floor transmission surface', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
        rotation: 0,
        transmissionRotation: 0
      })
    });

    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins: [{ x: 10, y: 10, z: 0 }],
      targetCell: { x: 10, y: 10, z: 0, rotation: 90 }
    });

    expect(preview.valid).toBe(true);
    expect(preview.movedTilePlacements).toHaveLength(1);
    expect(preview.movedTilePlacements[0].rotation).toBe(90);
    expect(preview.movedTilePlacements[0].transmissionRotation).toBe(90);
  });

  it('keeps a moved vertical board vertical when the target cell has no layFlat intent', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
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
    expect(preview.movedTilePlacements).toHaveLength(1);
    expect(preview.movedTilePlacements[0].isVertical).toBe(true);
    expect(preview.moves[0].to.layFlat).toBeUndefined();
  });

  it('rejects laying a moved vertical board flat onto a static horizontal floor', () => {
    // 复现：竖直板被搬运（carry）到一个已有水平地板的格子上。
    // 此时 resolver 会给出 layFlat 目标，move preview 应当把它视为水平板，
    // 与原地板碰撞、标红，而不是悄悄覆盖。
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
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
      targetCell: { x: 12, y: 10, z: 0, layFlat: true }
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts.map((conflict) => conflict.reason)).toContain('placement_occupied');
    expect(preview.invalidPlacementKeys.has(createCellKey(12, 10, 0))).toBe(true);
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
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(11, 10, 0)]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(14, 10, 0)]: createTile({ x: 14, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
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
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
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
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    }));

    expect(boxes).toHaveLength(1);
    expect(boxes[0].maxZ).toBe(1);
    expect(boxes[0].maxY - boxes[0].minY).toBeLessThan(0.2);
  });

  it('applies groupRotationSteps to multi-select relative offsets', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
      [createCellKey(11, 10, 0)]: createTile({ x: 11, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
    });
    const origins = [
      { x: 10, y: 10, z: 0 },
      { x: 11, y: 10, z: 0 }
    ];
    const anchor = getSelectionAnchor(origins);
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor,
      targetCell: { x: 20, y: 20, z: 0 },
      groupRotationSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 90, transmissionRotation: 90 },
      { x: 20, y: 21, z: 0, rotation: 90, transmissionRotation: 90 }
    ]);
  });

  it('rotates multi-select wall edges as one rigid yaw group', () => {
    const firstWall = createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
    });
    const secondWall = createWall({
      x: 11,
      y: 10,
      z: 0,
      edge: 'north',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'wall rigid yaw regression' }),
      tiles: {},
      walls: {
        [createWallKey(10, 10, 0, 'north')]: firstWall,
        [createWallKey(11, 10, 0, 'north')]: secondWall
      }
    };
    const origins = [
      { x: 10, y: 10, z: 0, edge: 'north' },
      { x: 11, y: 10, z: 0, edge: 'north' }
    ];
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 20, y: 20, z: 0, edge: 'east' },
      groupRotationSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 90, transmissionRotation: 0, edge: 'east' },
      { x: 20, y: 21, z: 0, rotation: 90, transmissionRotation: 0, edge: 'east' }
    ]);
  });

  it('keeps straight transmission ports connected after rigid yaw rotation', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      }),
      [createCellKey(10, 11, 0)]: createTile({
        x: 10,
        y: 11,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      })
    });
    const origins = [
      { x: 10, y: 10, z: 0 },
      { x: 10, y: 11, z: 0 }
    ];
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 20, y: 20, z: 0 },
      groupRotationSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 90, transmissionRotation: 90 },
      { x: 19, y: 20, z: 0, rotation: 90, transmissionRotation: 90 }
    ]);
    const graph = buildMechanicalAssemblies({
      tiles: Object.fromEntries(preview.previewTiles),
      walls: Object.fromEntries(preview.previewWalls)
    });
    expect(graph.assemblies).toHaveLength(1);
  });

  it('tumbles stacked multi-select forward while preserving relative offsets', () => {
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
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;
    mapData.tiles[createCellKey(10, 10, 1)].isVertical = true;
    const origins = [
      { x: 10, y: 10, z: 0 },
      { x: 10, y: 10, z: 1 }
    ];
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 20, y: 20, z: 0 },
      groupPoseSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 0, transmissionRotation: 0, layFlat: true },
      { x: 20, y: 19, z: 0, rotation: 0, transmissionRotation: 0, layFlat: true }
    ]);
  });

  it('keeps an L-shaped multi-select rigid when tumbling forward one quarter turn', () => {
    const mapData = createMapWithTiles({
      [createCellKey(10, 10, 0)]: createTile({
        x: 10,
        y: 10,
        z: 0,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      }),
      [createCellKey(10, 10, 1)]: createTile({
        x: 10,
        y: 10,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 0
      }),
      [createCellKey(11, 10, 1)]: createTile({
        x: 11,
        y: 10,
        z: 1,
        panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE,
        transmissionRotation: 90
      })
    });
    mapData.tiles[createCellKey(10, 10, 0)].isVertical = true;
    mapData.tiles[createCellKey(10, 10, 1)].isVertical = true;
    const origins = [
      { x: 10, y: 10, z: 0 },
      { x: 10, y: 10, z: 1 },
      { x: 11, y: 10, z: 1 }
    ];
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 20, y: 20, z: 0 },
      groupPoseSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 0, transmissionRotation: 0, layFlat: true },
      { x: 20, y: 19, z: 0, rotation: 0, transmissionRotation: 0, layFlat: true },
      { x: 21, y: 19, z: 0, rotation: 0, transmissionRotation: 90, isVertical: true }
    ]);
    expect(preview.moves.some((move) => move.to.layFlat)).toBe(true);
    expect(preview.moves.some((move) => move.to.isVertical)).toBe(true);
    expect(new Set(preview.moves.map((move) => `${move.to.x}:${move.to.y}:${move.to.z}`)).size).toBe(3);
  });

  it('uses the selected wall direction as the rigid tumble axis', () => {
    const lowerWall = createWall({
      x: 10,
      y: 10,
      z: 0,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const upperWall = createWall({
      x: 10,
      y: 10,
      z: 1,
      edge: 'east',
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE
    });
    const mapData = {
      ...createBaseCityChannelMap({ name: 'wall rigid pose axis regression' }),
      tiles: {},
      walls: {
        [createWallKey(10, 10, 0, 'east')]: lowerWall,
        [createWallKey(10, 10, 1, 'east')]: upperWall
      }
    };
    const origins = [
      { x: 10, y: 10, z: 0, edge: 'east' },
      { x: 10, y: 10, z: 1, edge: 'east' }
    ];
    const preview = computeCityChannelMovePreviewModel({
      mapData,
      origins,
      anchor: getSelectionAnchor(origins),
      targetCell: { x: 20, y: 20, z: 0 },
      groupPoseSteps: 1
    });

    expect(preview.valid).toBe(true);
    expect(preview.moves.map((move) => move.to)).toEqual([
      { x: 20, y: 20, z: 0, rotation: 0, transmissionRotation: 90, layFlat: true },
      { x: 21, y: 20, z: 0, rotation: 0, transmissionRotation: 90, layFlat: true }
    ]);
    const graph = buildMechanicalAssemblies({
      tiles: Object.fromEntries(preview.previewTiles),
      walls: Object.fromEntries(preview.previewWalls)
    });
    expect(graph.assemblies).toHaveLength(1);
  });

  describe('新的多选移动合法性规则', () => {
    it('允许多选物体移动到空地', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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

    it('多选贴近静态物体且不重叠时应判定通过', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE }),
        [createCellKey(20, 20, 1)]: createTile({ x: 20, y: 20, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE })
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

    it('多选混合移动在无重叠情况下应判定通过', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
    });

    it('保留间断选中分量信息但不要求传动连接', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(20, 20, 1)]: createTile({ x: 20, y: 20, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(20, 20, 5)]: createTile({ x: 20, y: 20, z: 5, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE })
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
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(11, 10, 1)]: createTile({ x: 11, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE }),
        [createCellKey(21, 20, 0)]: createTile({ x: 21, y: 20, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE })
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

    it('复制模式会把原位置物体视为静态遮挡', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 0)]: createTile({ x: 10, y: 10, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [{ x: 10, y: 10, z: 0 }],
        targetCell: { x: 10, y: 10, z: 0 },
        preserveOrigins: true
      });

      expect(preview.valid).toBe(false);
      expect(preview.conflicts.map((c) => c.reason)).toContain('placement_occupied');
    });

    it('多选中局部无支撑但无重叠时按组级规则判定通过', () => {
      const mapData = createMapWithTiles({
        [createCellKey(10, 10, 1)]: createTile({ x: 10, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE }),
        [createCellKey(14, 10, 1)]: createTile({ x: 14, y: 10, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_STRAIGHT_PLATE }),
        [createCellKey(20, 20, 0)]: createTile({ x: 20, y: 20, z: 0, panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE })
      });

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [
          { x: 10, y: 10, z: 1 },
          { x: 14, y: 10, z: 1 }
        ],
        targetCell: { x: 20, y: 20, z: 1 }
      });

      expect(preview.valid).toBe(true);
      expect(preview.conflicts).toEqual([]);
    });

    it('墙板在同层存在合法支撑时可通过多选预览校验', () => {
      const wall = createWall({
        x: 10,
        y: 10,
        z: 1,
        edge: 'north',
        panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE
      });
      const mapData = {
        ...createBaseCityChannelMap({ name: 'wall support preview' }),
        tiles: {
          [createCellKey(20, 20, 1)]: createTile({ x: 20, y: 20, z: 1, panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE })
        },
        walls: {
          [createCellKey(10, 10, 1) + ':north']: wall
        }
      };

      const preview = computeCityChannelMovePreviewModel({
        mapData,
        origins: [{ x: 10, y: 10, z: 1, edge: 'north' }],
        targetCell: { x: 20, y: 20, z: 1, edge: 'north' }
      });

      expect(preview.valid).toBe(true);
      expect(preview.conflicts).toEqual([]);
    });
  });
});
