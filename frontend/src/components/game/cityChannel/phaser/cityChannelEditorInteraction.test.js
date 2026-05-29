import {
  createCellKey
} from '../cityChannelSchema';
import {
  eraseHit,
  isSelectedHit,
  selectHit,
  setSelection
} from './cityChannelEditorInteraction';

describe('cityChannelEditorInteraction', () => {
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
});
