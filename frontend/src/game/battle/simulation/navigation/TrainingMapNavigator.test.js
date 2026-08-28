import {
  createTrainingMapNavigator,
  findTrainingMapNearestWalkablePoint,
  getTrainingMapTerrainMultiplier,
  planTrainingMapRoute,
  resolveTrainingHighlandExitPortal,
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

  test('routes every reference deployment through its highland exit before global search', () => {
    const referenceMap = buildReferenceTrainingMapConfig();
    const field = {
      width: referenceMap.layoutMeta.fieldWidth,
      height: referenceMap.layoutMeta.fieldHeight
    };
    const obstacles = referenceMap.objects.filter((entry) => entry?.blocksMovement);
    const navigator = createTrainingMapNavigator({ field, mapConfig: referenceMap });
    const failures = referenceMap.deploySlots.map((slot) => {
      const start = { x: slot.x, y: slot.y };
      const target = { x: -slot.x, y: slot.y };
      const safeStart = navigator.findNearestWalkablePoint(start, {
        obstacles,
        radius: 3.45
      });
      const startRegionId = navigator.sampleTerrain(start).regionIds
        .find((regionId) => String(regionId).startsWith('terrain-highland-')) || '';
      const portal = resolveTrainingHighlandExitPortal({
        mapConfig: referenceMap,
        start: safeStart,
        target,
        obstacles,
        clearance: 3.45,
        field
      });
      const route = navigator.planRoute(start, target, {
        obstacles,
        radius: 2.25,
        maxSearchNodes: 1,
        preferLocalDetour: true
      });
      const firstOutsideIndex = route.findIndex((point) => (
        !navigator.sampleTerrain(point).regionIds.includes(startRegionId)
      ));
      let portalPrevious = safeStart;
      const portalHits = (Array.isArray(portal?.route) ? portal.route : []).map((point) => {
        const hit = raycastObstacles(portalPrevious, point, obstacles, 3.45);
        portalPrevious = point;
        return String(hit?.obstacle?.objectId || hit?.obstacle?.id || '');
      });
      if (
        startRegionId
        && portal
        && portalHits.every((obstacleId) => !obstacleId)
        && firstOutsideIndex >= 0
      ) return null;
      let previous = start;
      const segmentHits = route.slice(0, 8).map((point) => {
        const hit = raycastObstacles(previous, point, obstacles, 3.45);
        previous = point;
        return String(hit?.obstacle?.objectId || hit?.obstacle?.id || '');
      });
      return {
        id: slot.id,
        safeStart,
        startRegionId,
        portal: portal ? {
          entry: portal.entry,
          exit: portal.exit,
          route: portal.route,
          hits: portalHits
        } : null,
        firstOutsideIndex,
        firstPoints: route.slice(0, 8),
        segmentHits
      };
    }).filter(Boolean);

    expect(failures).toEqual([]);
  });

  test('does not let a clear direct segment bypass a highland ramp', () => {
    const highlandMap = {
      navigation: {
        cellSize: 24,
        wallClearance: 2,
        pathClearance: 1,
        maxSearchNodes: 200
      },
      lanes: [],
      terrainRegions: [{
        id: 'terrain-highland-test',
        type: 'highland-test',
        points: [
          { x: -240, y: -120 },
          { x: -20, y: -120 },
          { x: -20, y: 120 },
          { x: -240, y: 120 }
        ],
        ramps: [{
          id: 'front-ramp',
          points: [
            { x: 44, y: -32 },
            { x: -20, y: -32 },
            { x: -20, y: 32 },
            { x: 44, y: 32 }
          ]
        }]
      }]
    };
    const start = { x: -170, y: 82 };
    const target = { x: 120, y: 82 };
    const options = {
      field: { width: 600, height: 400 },
      mapConfig: highlandMap,
      start,
      target,
      obstacles: [],
      radius: 2
    };

    const route = planTrainingMapRoute(options);
    const repeatedRoute = planTrainingMapRoute(options);
    const portal = resolveTrainingHighlandExitPortal({
      mapConfig: highlandMap,
      start,
      target,
      obstacles: [],
      clearance: 3,
      field: options.field
    });

    expect(portal).not.toBeNull();
    expect(route).toEqual(repeatedRoute);
    expect(route[0]).toEqual(portal.entry);
    expect(route).toContainEqual(portal.exit);
    expect(route[route.length - 1]).toEqual(target);
  });

  test('continues straight down a clear highland ramp instead of returning to its top edge', () => {
    const referenceMap = buildReferenceTrainingMapConfig();
    const field = {
      width: referenceMap.layoutMeta.fieldWidth,
      height: referenceMap.layoutMeta.fieldHeight
    };
    const obstacles = referenceMap.objects.filter((entry) => entry?.blocksMovement);
    const highland = referenceMap.terrainRegions.find((region) => (
      region?.id === 'terrain-highland-spawn-attacker-top'
    ));
    const ramp = highland.ramps.find((entry) => entry?.id === 'front-outward-trapezoid-ramp');
    const lowCenter = {
      x: (ramp.points[0].x + ramp.points[3].x) * 0.5,
      y: (ramp.points[0].y + ramp.points[3].y) * 0.5
    };
    const highCenter = {
      x: (ramp.points[1].x + ramp.points[2].x) * 0.5,
      y: (ramp.points[1].y + ramp.points[2].y) * 0.5
    };
    const outwardLength = Math.hypot(lowCenter.x - highCenter.x, lowCenter.y - highCenter.y);
    const outward = {
      x: (lowCenter.x - highCenter.x) / outwardLength,
      y: (lowCenter.y - highCenter.y) / outwardLength
    };
    const start = {
      x: lowCenter.x - (outward.x * 80),
      y: lowCenter.y - (outward.y * 80)
    };
    const target = {
      x: lowCenter.x + (outward.x * 140),
      y: lowCenter.y + (outward.y * 140)
    };

    expect(raycastObstacles(start, target, obstacles, 3.45)).toBeNull();
    const route = planTrainingMapRoute({
      field,
      mapConfig: referenceMap,
      start,
      target,
      obstacles,
      radius: 2.25,
      preferLocalDetour: true
    });

    expect(route).toEqual([target]);
  });

  test('keeps a manual route local around the reference crescent instead of joining a distant lane', () => {
    const referenceMap = buildReferenceTrainingMapConfig();
    const field = {
      width: referenceMap.layoutMeta.fieldWidth,
      height: referenceMap.layoutMeta.fieldHeight
    };
    const obstacles = referenceMap.objects
      .filter((entry) => entry?.blocksMovement)
      .map((entry) => ({ ...entry, collisionPath: undefined }));
    const crescent = obstacles.find((entry) => entry?.geometryRefId === 'ordinary-upper-west-crescent');
    const start = {
      x: crescent.x - (crescent.width * 0.7),
      y: crescent.y - (crescent.depth * 0.7)
    };
    const target = {
      x: crescent.x + (crescent.width * 0.7),
      y: crescent.y + (crescent.depth * 0.7)
    };
    const route = planTrainingMapRoute({
      field,
      mapConfig: referenceMap,
      start,
      target,
      obstacles,
      radius: 2.25,
      preferLocalDetour: true
    });
    const routeLength = route.reduce((sum, point, index) => (
      sum + Math.hypot(
        point.x - (index === 0 ? start.x : route[index - 1].x),
        point.y - (index === 0 ? start.y : route[index - 1].y)
      )
    ), 0);
    const directLength = Math.hypot(target.x - start.x, target.y - start.y);

    expect(crescent.collider).toMatchObject({ kind: 'compositeCapsule' });
    expect(crescent.collider.parts).toHaveLength(crescent.visualPath.length - 1);
    expect(route[route.length - 1]).toEqual(target);
    expect(route.length).toBeGreaterThan(1);
    expect(routeLength).toBeLessThan(directLength * 1.3);
    let previous = start;
    route.forEach((point) => {
      expect(raycastObstacles(previous, point, obstacles, 3.45)).toBeNull();
      previous = point;
    });
  });
});
