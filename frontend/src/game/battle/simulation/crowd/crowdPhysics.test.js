import {
  buildObstacleSpatialIndex,
  buildSpatialHash,
  isInsideCollider,
  pushOutOfCollider,
  queryObstacleCandidates,
  raycastCollider,
  raycastObstacles,
  querySpatialNearby
} from './crowdPhysics';

test('reuses a caller-provided buffer for nearby-agent queries', () => {
  const attacker = { id: 'attacker', x: 0, y: 0 };
  const defender = { id: 'defender', x: 8, y: 0 };
  const hash = buildSpatialHash([attacker, defender], 14);
  const reusable = [{ id: 'stale' }];

  const nearby = querySpatialNearby(hash, 0, 0, 12, reusable);

  expect(nearby).toBe(reusable);
  expect(nearby).toEqual(expect.arrayContaining([attacker, defender]));
  expect(nearby.some((agent) => agent.id === 'stale')).toBe(false);
});

test('limits static obstacle checks to the nearby spatial cells', () => {
  const nearWall = { id: 'near', x: 0, y: 0, width: 20, depth: 20 };
  const farWall = { id: 'far', x: 1200, y: 0, width: 20, depth: 20 };
  const obstacles = [nearWall, farWall];
  obstacles._obstacleSpatialIndex = buildObstacleSpatialIndex(obstacles, 64);
  const reusable = [{ id: 'stale' }];

  const candidates = queryObstacleCandidates(obstacles, 0, 0, 16, reusable);

  expect(candidates).toBe(reusable);
  expect(candidates).toEqual([nearWall]);
  expect(raycastObstacles({ x: -60, y: 0 }, { x: 60, y: 0 }, obstacles)?.obstacle).toBe(nearWall);
});

test('uses the smooth circular tower footprint instead of its square bounds', () => {
  const tower = {
    id: 'round-tower',
    x: 5,
    y: -3,
    width: 20,
    depth: 20,
    collider: { kind: 'circle', cx: 0, cy: 0, r: 10, h: 40 }
  };

  expect(isInsideCollider({ x: 13, y: 5 }, tower)).toBe(false);
  expect(isInsideCollider({ x: 12, y: 3 }, tower)).toBe(true);

  const hit = raycastCollider({ x: -15, y: -3 }, { x: 25, y: -3 }, tower);
  expect(hit).toMatchObject({ obstacle: tower });
  expect(hit.t).toBeCloseTo(0.25, 5);
  expect(hit.x).toBeCloseTo(-5, 5);
  expect(hit.y).toBeCloseTo(-3, 5);
});

test('keeps capsule wall ends round without rectangular corner spikes', () => {
  const wall = {
    id: 'round-ended-wall',
    x: 0,
    y: 0,
    collider: {
      kind: 'compositeCapsule',
      parts: [{ ax: -10, ay: 0, bx: 10, by: 0, r: 4, h: 20 }]
    }
  };

  expect(isInsideCollider({ x: 13.5, y: 3.5 }, wall)).toBe(false);
  expect(isInsideCollider({ x: 13, y: 2 }, wall)).toBe(true);
});

test('pushes a soldier fully out of overlapping capsule wall joints', () => {
  const cornerWall = {
    id: 'capsule-corner',
    x: 0,
    y: 0,
    collider: {
      kind: 'compositeCapsule',
      parts: [
        { ax: -10, ay: 0, bx: 10, by: 0, r: 4, h: 20 },
        { ax: 0, ay: -10, bx: 0, by: 10, r: 4, h: 20 }
      ]
    }
  };

  const pushed = pushOutOfCollider({ x: 0, y: 0 }, cornerWall);

  expect(pushed.pushed).toBe(true);
  expect(isInsideCollider(pushed, cornerWall)).toBe(false);
});
