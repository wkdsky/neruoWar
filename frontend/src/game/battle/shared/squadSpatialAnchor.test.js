import { resolveSquadSpatialAnchor } from './squadSpatialAnchor';

describe('squad spatial anchor', () => {
  test('binds to the majority cluster instead of distant stragglers', () => {
    const anchor = resolveSquadSpatialAnchor([
      { x: -4, y: -2 },
      { x: 0, y: -3 },
      { x: 4, y: -2 },
      { x: -3, y: 2 },
      { x: 1, y: 3 },
      { x: 5, y: 2 },
      { x: 760, y: 120 },
      { x: 820, y: -140 }
    ], { radiusPadding: 6 });

    expect(anchor.x).toBeGreaterThan(-2);
    expect(anchor.x).toBeLessThan(3);
    expect(Math.abs(anchor.y)).toBeLessThan(2);
    expect(anchor.inlierCount).toBe(6);
    expect(anchor.radius).toBeLessThan(16);
  });

  test('keeps a normal formation centered when every soldier belongs to one cluster', () => {
    const anchor = resolveSquadSpatialAnchor([
      { x: -18, y: -18 },
      { x: 0, y: -18 },
      { x: 18, y: -18 },
      { x: -18, y: 0 },
      { x: 0, y: 0 },
      { x: 18, y: 0 },
      { x: -18, y: 18 },
      { x: 0, y: 18 },
      { x: 18, y: 18 }
    ]);

    expect(anchor).toMatchObject({ x: 0, y: 0, count: 9, inlierCount: 9 });
    expect(anchor.radius).toBeCloseTo(Math.hypot(18, 18), 6);
  });
});
