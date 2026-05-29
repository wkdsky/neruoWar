import {
  compareCityChannelHits,
  PAINT_DRAG_START_DISTANCE,
  shouldStartPaintDrag
} from './cityChannelSceneInteraction';

describe('cityChannelSceneInteraction', () => {
  it('prefers higher depth over selectionPriority when selecting with occlusion', () => {
    const floorHit = { depth: 120000, selectionPriority: 0 };
    const wallHit = { depth: 80000, selectionPriority: 1 };

    expect(compareCityChannelHits(floorHit, wallHit, { preferOcclusion: true })).toBeLessThan(0);
    expect(compareCityChannelHits(wallHit, floorHit, { preferOcclusion: true })).toBeGreaterThan(0);
  });

  it('keeps selectionPriority ahead of depth for placement snapping', () => {
    const floorHit = { depth: 120000, selectionPriority: 0 };
    const wallHit = { depth: 80000, selectionPriority: 1 };

    expect(compareCityChannelHits(floorHit, wallHit)).toBeGreaterThan(0);
    expect(compareCityChannelHits(wallHit, floorHit)).toBeLessThan(0);
  });

  it('still prefers snapPriority targets before depth in selection mode', () => {
    const gearHit = { depth: 1000, snapPriority: 2 };
    const floorHit = { depth: 120000, snapPriority: 0 };

    expect(compareCityChannelHits(gearHit, floorHit, { preferOcclusion: true })).toBeLessThan(0);
  });

  it('prefers the front gear-surface hit over a back one regardless of snapPriority', () => {
    const frontFloor = { depth: 120000, snapPriority: 0, gearSurfacePlane: true };
    const backVertical = { depth: 80000, snapPriority: 2, gearSurfacePlane: true };

    expect(compareCityChannelHits(frontFloor, backVertical)).toBeLessThan(0);
    expect(compareCityChannelHits(backVertical, frontFloor)).toBeGreaterThan(0);
    expect(compareCityChannelHits(frontFloor, backVertical, { preferOcclusion: true })).toBeLessThan(0);
    expect(compareCityChannelHits(backVertical, frontFloor, { preferOcclusion: true })).toBeGreaterThan(0);
  });

  it('falls back to snapPriority when only one hit is on gear surface', () => {
    const floorHit = { depth: 120000, snapPriority: 0, gearSurfacePlane: true };
    const verticalHit = { depth: 80000, snapPriority: 2 };

    expect(compareCityChannelHits(floorHit, verticalHit)).toBeGreaterThan(0);
    expect(compareCityChannelHits(verticalHit, floorHit)).toBeLessThan(0);
  });

  it('uses a drag threshold for paint interactions', () => {
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE - 1, y: 100 }
    )).toBe(false);
    expect(shouldStartPaintDrag(
      { startX: 100, startY: 100 },
      { x: 100 + PAINT_DRAG_START_DISTANCE, y: 100 }
    )).toBe(true);
    expect(shouldStartPaintDrag({}, { x: 240, y: 160 })).toBe(false);
  });
});
