import {
  expandVisibleLayerCutoffForTargetLayer,
  getMaxTargetLayerFromMoves,
  getMaxTargetLayerFromPlacementOperations,
  getRuntimeVisibleLayerCutoff
} from './cityChannelEditorVisibility';
import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

describe('cityChannelEditorVisibility', () => {
  it('expands a finite visible layer cutoff to include placement targets', () => {
    const maxLayer = getMaxTargetLayerFromPlacementOperations([
      { kind: 'wall', cell: { x: 1, y: 1, z: 1 } },
      { kind: 'tile', cell: { x: 1, y: 2, z: 0 } }
    ]);

    expect(maxLayer).toBe(1);
    expect(expandVisibleLayerCutoffForTargetLayer(0, maxLayer)).toBe(1);
    expect(expandVisibleLayerCutoffForTargetLayer(null, maxLayer)).toBeNull();
  });

  it('expands a finite visible layer cutoff to include move targets', () => {
    const maxLayer = getMaxTargetLayerFromMoves([
      { from: { x: 1, y: 1, z: 0 }, to: { x: 1, y: 1, z: 2, edge: 'east' } }
    ]);

    expect(maxLayer).toBe(2);
    expect(expandVisibleLayerCutoffForTargetLayer(1, maxLayer)).toBe(2);
  });

  it('shows every layer in the Three runtime during placement and carry interactions', () => {
    expect(getRuntimeVisibleLayerCutoff({
      visibleLayerCutoff: 0,
      activeTool: CITY_CHANNEL_TOOLS.BROWSE,
      carryActive: false
    })).toBe(0);
    expect(getRuntimeVisibleLayerCutoff({
      visibleLayerCutoff: 0,
      activeTool: CITY_CHANNEL_TOOLS.PLACE_TILE,
      carryActive: false
    })).toBeNull();
    expect(getRuntimeVisibleLayerCutoff({
      visibleLayerCutoff: 0,
      activeTool: CITY_CHANNEL_TOOLS.SELECT,
      carryActive: true
    })).toBeNull();
  });
});
