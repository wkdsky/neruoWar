import {
  canSelectBoardPlacement,
  canSelectComponentPlacement
} from './cityChannelSelectionRules';

describe('cityChannelSelectionRules', () => {
  it('allows single-click selection to switch between board and component', () => {
    expect(canSelectBoardPlacement('component', false)).toBe(true);
    expect(canSelectComponentPlacement('board', false)).toBe(true);
  });

  it('limits additive multi-selection by current selection type', () => {
    expect(canSelectBoardPlacement('component', true)).toBe(false);
    expect(canSelectComponentPlacement('board', true)).toBe(false);
    expect(canSelectBoardPlacement(null, true)).toBe(true);
    expect(canSelectComponentPlacement(null, true)).toBe(true);
  });
});
