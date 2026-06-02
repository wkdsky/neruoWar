import {
  CITY_CHANNEL_TILE_TYPES,
  createBaseCityChannelMap,
  createCellKey,
  createTile
} from '../cityChannelSchema';
import { getGearSocketWorldPosition } from '../cityChannelMechanismRuntime';
import {
  applyPaint,
  eraseHit,
  isSelectedHit,
  selectHit,
  setSelection
} from './cityChannelEditorInteraction';

describe('cityChannelEditorInteraction', () => {
  const expectSameGearPoint = (actual, expected) => {
    expect(actual?.x).toBeCloseTo(expected?.x, 4);
    expect(actual?.y).toBeCloseTo(expected?.y, 4);
    expect(actual?.z).toBeCloseTo(expected?.z, 4);
  };

  const createScene = () => ({
    config: {
      onCommitOperations: jest.fn(),
      onMechanismPanelRequest: jest.fn(),
      onSelectionChange: jest.fn()
    },
    drawSelectionLayer: jest.fn(),
    refreshMechanismVisuals: jest.fn(),
    renderObjects: new Map(),
    requestMechanismPanel: jest.fn(),
    selectedCells: [],
    selectedGears: [],
    selectedWalls: [],
    selectionScope: null
  });

  it('sets board selection and reports selected tile hits', () => {
    const scene = createScene();
    const cell = { x: 1, y: 2, z: 0 };

    setSelection(scene, [cell], [], [], 'board', { lockExternalSync: true });

    expect(scene.selectedCells).toEqual([cell]);
    expect(scene.selectionScope).toBe('board');
    expect(scene.selectionSyncLock.cells.has(createCellKey(1, 2, 0))).toBe(true);
    expect(isSelectedHit(scene, { type: 'tile', cell })).toBe(true);
    expect(scene.config.onSelectionChange).toHaveBeenCalledWith({
      cells: [cell],
      walls: [],
      gears: [],
      scope: 'board'
    });
  });

  it('selects gear hits in component scope', () => {
    const scene = createScene();

    selectHit(scene, {
      type: 'gear',
      hostKind: 'tile',
      hostKey: '0:1:2',
      mount: { id: 'gear_a' },
      cell: { x: 1, y: 2, z: 0 }
    });

    expect(scene.selectionScope).toBe('component');
    expect(scene.selectedGears).toEqual([expect.objectContaining({
      hostKey: '0:1:2',
      mountId: 'gear_a'
    })]);
    expect(scene.config.onMechanismPanelRequest).toHaveBeenCalledWith(null);
  });

  it('commits erase operations for tile and wall hits', () => {
    const scene = createScene();

    eraseHit(scene, {
      hit: {
        type: 'wall',
        cell: { x: 1, y: 2, z: 0 },
        edge: 'north'
      }
    });

    expect(scene.config.onCommitOperations).toHaveBeenCalledWith([{
      kind: 'wall',
      action: 'erase',
      cell: { x: 1, y: 2, z: 0 },
      edge: 'north'
    }], { label: '擦除' });
  });

  it('preserves gear mounts while previewing a same-cell tile replacement', () => {
    const cell = { x: 4, y: 5, z: 0 };
    const tileKey = createCellKey(cell.x, cell.y, cell.z);
    const existing = createTile({
      ...cell,
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_L_PLATE,
      rotation: 0
    });
    existing.gearMounts = [{
      id: 'gear_corner',
      componentType: 'gear',
      position: 'corner_ne',
      socketKind: 'corner',
      surface: 'front',
      axisBinding: {
        componentKey: createCellKey(5, 4, 0),
        hostKind: 'tile',
        socket: 'corner_sw',
        surface: 'front'
      }
    }];
    const beforePoint = getGearSocketWorldPosition(existing, 'corner_ne', 'front');
    const scene = {
      ...createScene(),
      activeRotation: 90,
      activeTileType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      drawGhostLayer: jest.fn(),
      refreshAfterIncrementalEdit: jest.fn(),
      renderTileObject: jest.fn(),
      resolvePlacementEdgeSnap: jest.fn(() => null),
      resolveDynamicPlacementTarget: jest.fn(() => ({
        kind: 'floor',
        cell,
        valid: true,
        replace: true
      })),
      mapData: {
        ...createBaseCityChannelMap({ name: 'replace preview gear mounts' }),
        tiles: {
          [tileKey]: existing
        },
        walls: {}
      },
      paintStroke: {
        intent: 'place',
        isWall: false,
        touched: new Set(),
        operations: []
      }
    };

    applyPaint(scene, null, {
      cell,
      hit: {
        type: 'tile',
        cell,
        tile: existing
      }
    });

    expect(scene.mapData.tiles[tileKey]).toMatchObject({
      panelType: CITY_CHANNEL_TILE_TYPES.TRANSMISSION_CROSS_PLATE,
      rotation: 90
    });
    expect(scene.mapData.tiles[tileKey].gearMounts).toEqual([
      expect.objectContaining({
        id: 'gear_corner',
        position: 'corner_nw',
        socketKind: 'corner',
        axisBinding: expect.objectContaining({
          componentKey: createCellKey(5, 4, 0)
        })
      })
    ]);
    const nextMount = scene.mapData.tiles[tileKey].gearMounts[0];
    expectSameGearPoint(
      getGearSocketWorldPosition(scene.mapData.tiles[tileKey], nextMount.position, nextMount.surface),
      beforePoint
    );
    expect(scene.renderTileObject).toHaveBeenCalledWith(expect.objectContaining({
      gearMounts: expect.arrayContaining([
        expect.objectContaining({ id: 'gear_corner' })
      ])
    }));
  });
});
