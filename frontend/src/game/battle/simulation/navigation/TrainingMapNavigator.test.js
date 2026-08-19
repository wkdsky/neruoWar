import {
  createTrainingMapNavigator,
  findTrainingMapNearestWalkablePoint,
  getTrainingMapTerrainMultiplier,
  planTrainingMapRoute,
  resolveTrainingMapLegalPosition
} from './TrainingMapNavigator';
import { isInsideCollider, raycastObstacles } from '../crowd/crowdPhysics';

const { buildReferenceTrainingMapConfig } = require('../../../../../../backend/services/trainingMapDefinitionService');

const mapConfig = {
  navigation: {
    cellSize: 48,
    wallClearance: 10,
    maxSearchNodes: 1200,
    roadCost: 0.68,
    grassCost: 1,
    riverCost: 1.08
  },
  lanes: [{ id: 'mid', centerY: 0, width: 110 }],
  terrainRegions: []
};

describe('TrainingMapNavigator', () => {
  test('uses a direct endpoint when no obstacle blocks the route', () => {
    const startedAt = performance.now();
    const route = planTrainingMapRoute({
      field: { width: 600, height: 400 },
      mapConfig,
      start: { x: -220, y: 0 },
      target: { x: 220, y: 0 },
      obstacles: [],
      radius: 8
    });

    expect(route).toEqual([{ x: 220, y: 0 }]);
  });

  test('routes around a blocking wall and keeps every segment clear', () => {
    const wall = {
      id: 'center-wall',
      x: 0,
      y: 0,
      width: 72,
      depth: 180,
      rotation: 0,
      blocksMovement: true
    };
    const start = { x: -220, y: 0 };
    const route = planTrainingMapRoute({
      field: { width: 600, height: 400 },
      mapConfig,
      start,
      target: { x: 220, y: 0 },
      obstacles: [wall],
      radius: 8
    });

    expect(route.length).toBeGreaterThan(1);
    let previous = start;
    route.forEach((point) => {
      expect(raycastObstacles(previous, point, [wall], 12)).toBeNull();
      previous = point;
    });
  });

  test('keeps a single-agent route open through a bottleneck that cannot fit a full formation', () => {
    const field = { width: 240, height: 120 };
    const mapWithPassage = {
      navigation: {
        cellSize: 32,
        wallClearance: 18,
        pathClearance: 1,
        narrowPassage: { cellSize: 4 }
      },
      lanes: [],
      terrainRegions: []
    };
    const walls = [
      { id: 'gate-top', x: 0, y: 33, width: 18, depth: 54, blocksMovement: true },
      { id: 'gate-bottom', x: 0, y: -33, width: 18, depth: 54, blocksMovement: true }
    ];
    const start = { x: -90, y: 0 };
    const target = { x: 90, y: 0 };

    const singleAgentRoute = planTrainingMapRoute({
      field,
      mapConfig: mapWithPassage,
      start,
      target,
      obstacles: walls,
      radius: 2.25
    });
    const formationRoute = planTrainingMapRoute({
      field,
      mapConfig: mapWithPassage,
      start,
      target,
      obstacles: walls,
      radius: 8
    });

    expect(singleAgentRoute[singleAgentRoute.length - 1]).toEqual(target);
    expect(formationRoute[formationRoute.length - 1].x).toBeLessThan(0);
  });

  test('uses the narrow-passage grid to route through a one-agent turning gate', () => {
    const field = { width: 240, height: 164 };
    const mapWithTurningGate = {
      navigation: {
        cellSize: 32,
        wallClearance: 18,
        pathClearance: 1,
        narrowPassage: { cellSize: 4 }
      },
      lanes: [],
      terrainRegions: []
    };
    const walls = [
      { id: 'turning-gate-top', x: 0, y: 43, width: 20, depth: 78, blocksMovement: true },
      { id: 'turning-gate-bottom', x: 0, y: -43, width: 20, depth: 78, blocksMovement: true }
    ];
    const start = { x: -70, y: -50 };
    const target = { x: 70, y: -50 };
    const route = planTrainingMapRoute({
      field,
      mapConfig: mapWithTurningGate,
      start,
      target,
      obstacles: walls,
      radius: 2.25
    });

    expect(route[route.length - 1]).toEqual(target);
    expect(route.some((point) => Math.abs(point.y) <= 2)).toBe(true);
  });

  test('keeps terrain metadata without turning surface type into a path preference', () => {
    const sandMapConfig = {
      navigation: {
        roadCost: 0.68,
        grassCost: 1,
        sandCost: 0.86,
        highlandCost: 1.1
      },
      lanes: [{ id: 'mid', centerY: 0, width: 90 }],
      terrainRegions: [{
        id: 'central-sand',
        type: 'sand',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 140,
        height: 360
      }]
    };

    expect(getTrainingMapTerrainMultiplier({ x: 0, y: 140 }, sandMapConfig)).toBe(1);
    expect(getTrainingMapTerrainMultiplier({ x: 0, y: 0 }, sandMapConfig)).toBe(1);
    expect(getTrainingMapTerrainMultiplier({ x: 220, y: 140 }, sandMapConfig)).toBe(1);
    expect(planTrainingMapRoute({
      field: { width: 600, height: 400 },
      mapConfig: sandMapConfig,
      start: { x: -220, y: 140 },
      target: { x: 220, y: 140 },
      obstacles: [],
      radius: 8
    })).toEqual([{ x: 220, y: 140 }]);
  });

  test('keeps central sand walkable', () => {
    const field = { width: 600, height: 400 };
    const centralSand = {
      id: 'sand-central',
      type: 'sand',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 120,
      height: 400,
      walkable: true
    };
    const baseConfig = {
      navigation: {
        cellSize: 40,
        wallClearance: 8,
        roadCost: 0.68,
        grassCost: 1,
        sandCost: 1,
        pathFailureReplanCooldownSeconds: 0.2
      },
      lanes: [{ id: 'mid', centerY: 0, width: 90 }],
      terrainRegions: [
        { id: 'grass-main', type: 'grass', shape: 'rect', x: 0, y: 0, width: 600, height: 400, walkable: true },
        centralSand
      ]
    };
    const start = { x: -220, y: 0 };
    const target = { x: 220, y: 0 };
    const navigator = createTrainingMapNavigator({ field, mapConfig: baseConfig });

    expect(navigator.sampleTerrain({ x: 0, y: 0 })).toMatchObject({
      type: 'road',
      baseType: 'sand',
      isCentralSand: true,
      walkable: true
    });
    expect(navigator.getPathFailureReplanCooldownSeconds()).toBe(0.2);
    expect(navigator.planRoute(start, target)).toEqual([target]);

  });

  test('does not turn a terrain annotation into a movement obstacle', () => {
    const terrainMapConfig = {
      navigation: { cellSize: 40, wallClearance: 8, grassCost: 1 },
      lanes: [],
      terrainRegions: [
        { id: 'grass-main', type: 'grass', shape: 'rect', x: 0, y: 0, width: 600, height: 400, walkable: true },
        { id: 'blocked-patch', type: 'blocked', shape: 'rect', x: 0, y: 0, width: 100, height: 180, walkable: false }
      ]
    };
    const start = { x: -220, y: 0 };
    const route = planTrainingMapRoute({
      field: { width: 600, height: 400 },
      mapConfig: terrainMapConfig,
      start,
      target: { x: 220, y: 0 },
      obstacles: [],
      radius: 8
    });

    expect(route).toEqual([{ x: 220, y: 0 }]);
  });

  test('finds a walkable recovery point for an agent that starts inside a wall', () => {
    const wall = {
      id: 'recovery-wall',
      x: 0,
      y: 0,
      width: 80,
      depth: 100,
      blocksMovement: true
    };
    const point = findTrainingMapNearestWalkablePoint({
      field: { width: 600, height: 400 },
      point: { x: 0, y: 0 },
      obstacles: [wall],
      radius: 6
    });

    expect(isInsideCollider(point, wall, 6)).toBe(false);
  });

  test('stops forced displacement before a wall instead of crossing it', () => {
    const wall = {
      id: 'knockback-wall',
      x: 0,
      y: 0,
      width: 32,
      depth: 160,
      blocksMovement: true
    };
    const start = { x: -120, y: 0 };
    const landing = resolveTrainingMapLegalPosition({
      field: { width: 600, height: 400 },
      start,
      target: { x: 120, y: 0 },
      obstacles: [wall],
      radius: 6
    });

    expect(landing.x).toBeLessThan(-21);
    expect(isInsideCollider(landing, wall, 6)).toBe(false);
    expect(raycastObstacles(start, landing, [wall], 6)).toBeNull();
  });

  test('clamps forced displacement to the navigable field boundary', () => {
    const landing = resolveTrainingMapLegalPosition({
      field: { width: 600, height: 400 },
      start: { x: 0, y: 0 },
      target: { x: 900, y: -900 },
      obstacles: [],
      radius: 8
    });

    expect(landing).toEqual({ x: 292, y: -192 });
  });

  test('routes through the reference highland exits without a global narrow-grid search', () => {
    const referenceMap = buildReferenceTrainingMapConfig();
    const field = {
      width: referenceMap.layoutMeta.fieldWidth,
      height: referenceMap.layoutMeta.fieldHeight
    };
    const obstacles = referenceMap.objects.filter((entry) => entry?.blocksMovement);
    const start = { x: -3462.002784, y: 1416.39340928 };
    const target = { x: 3462.002784, y: 1416.39340928 };
    const navigator = createTrainingMapNavigator({ field, mapConfig: referenceMap });
    const route = navigator.planRoute(start, target, { obstacles, radius: 2.25 });
    const cachedRoute = navigator.planRoute(start, target, { obstacles, radius: 2.25 });

    expect(route.length).toBeGreaterThan(0);
    expect(route[route.length - 1]).toEqual(target);
    expect(cachedRoute).toEqual(route);
  });
});
