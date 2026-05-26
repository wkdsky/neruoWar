import { compareCityChannelHits } from './cityChannelHitSelection';

describe('cityChannelHitSelection', () => {
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
});
