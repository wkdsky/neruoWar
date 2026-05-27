import {
  PAINT_DRAG_START_DISTANCE,
  shouldStartPaintDrag
} from './cityChannelPaintInteraction';

describe('cityChannelPaintInteraction', () => {
  it('keeps a click-sized pointer jitter from starting drag paint', () => {
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE - 1, y: 100 }
    )).toBe(false);
  });

  it('starts drag paint once the pointer reaches the drag threshold', () => {
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE, y: 100 }
    )).toBe(true);
  });

  it('uses the current pointer position as the fallback start point', () => {
    expect(shouldStartPaintDrag({}, { x: 240, y: 160 })).toBe(false);
  });
});
