import {
  constrainTrainingCardNavigationAnchor,
  refreshTrainingCardBodyAnchor,
  resolveTrainingCardMaxFormationAnchorLag,
  syncTrainingCardFormationAnchor
} from './TrainingCardSquadBody';

test('uses weighted real troop body and bounds both cursor lead and formation lag', () => {
  const squad = {
    id: 'weighted-body',
    x: 0,
    y: 0,
    formationRect: { spacing: 8, depth: 32 },
    waypoints: [{ x: 200, y: 0 }]
  };
  const route = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  const agents = [
    { id: 'rear-mass', x: 0, y: 0, weight: 2, vx: 0, vy: 0 },
    { id: 'front-mass', x: 100, y: 0, weight: 8, vx: 0, vy: 0 }
  ];

  const body = refreshTrainingCardBodyAnchor({ squad, agents, route, nowSec: 1 });
  // A 20% rear flank is material troop mass, not a disposable visual
  // outlier; the spatial body remains weight-correct.
  expect(body.x).toBeCloseTo(80);
  expect(body.rearProgress).toBe(0);
  expect(body.bodyProgress).toBe(100);
  expect(body.frontProgress).toBe(100);
  expect(squad.x).toBeCloseTo(body.x);

  const farCursor = constrainTrainingCardNavigationAnchor({
    squad,
    agents,
    route,
    candidate: { x: 200, y: 0 },
    nowSec: 1
  });
  expect(farCursor.routeProgress).toBeLessThanOrEqual(body.bodyProgress + body.maxAnchorLead + 0.001);
  expect(Math.hypot(farCursor.x - body.x, farCursor.y - body.y)).toBeLessThanOrEqual(body.maxAnchorLead + 0.001);

  // Obstacles can push a body far sideways from a curved route.  Equal route
  // progress alone must not allow the virtual cursor to remain on the other
  // side of that obstacle complex.
  const lateralCursor = constrainTrainingCardNavigationAnchor({
    squad,
    agents,
    route,
    candidate: { x: 100, y: 100 },
    nowSec: 1.05
  });
  expect(Math.hypot(lateralCursor.x - body.x, lateralCursor.y - body.y)).toBeLessThanOrEqual(body.maxAnchorLead + 0.001);

  const caughtUpCursor = constrainTrainingCardNavigationAnchor({
    squad,
    agents,
    route,
    candidate: { x: 0, y: 0 },
    nowSec: 1.1
  });
  expect(caughtUpCursor.routeProgress).toBeGreaterThanOrEqual(body.bodyProgress - 0.001);
  expect(caughtUpCursor.caughtUpToBody).toBe(true);

  squad.formationAnchor = { x: 0, y: 0 };
  const formation = syncTrainingCardFormationAnchor({
    squad,
    agents,
    route,
    nowSec: 1.2,
    dt: 0.05
  });
  expect(formation.routeProgress).toBeGreaterThanOrEqual(
    body.bodyProgress - resolveTrainingCardMaxFormationAnchorLag(squad, agents) - 0.001
  );
});
