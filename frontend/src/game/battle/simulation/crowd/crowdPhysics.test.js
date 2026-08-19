import {
  buildObstacleSpatialIndex,
  buildSpatialHash,
  queryObstacleCandidates,
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
