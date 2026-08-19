import {
  createCrowdSim,
  getCrowdAgentsForSquad,
  resolveTrainingMapMovementScale,
  resolveTrainingNarrowPassageColumns,
  resolveTrainingAiSkillPreflight,
  triggerCrowdSkill,
  updateCrowdSim
} from './CrowdSim';
import { buildSpatialHash, isInsideCollider, raycastObstacles } from './crowdPhysics';
import { updateCrowdCombat } from './crowdCombat';
import { createCombatEffectsPool } from '../effects/CombatEffects';
import { createTrainingMapNavigator } from '../navigation/TrainingMapNavigator';
import {
  initializeTrainingNeutralCamps,
  updateTrainingNeutralCamps
} from '../objectives/TrainingNeutralCampSystem';

const { buildReferenceTrainingMapConfig } = require('../../../../../../backend/services/trainingMapDefinitionService');

const createSquad = ({ id, team, x }) => ({
  id,
  team,
  x,
  y: 0,
  startCount: 100,
  remain: 100,
  maxHealth: 100,
  health: 100,
  radius: 12,
  classTag: 'infantry',
  units: {},
  stats: { atk: 1, speed: 1 },
  behavior: 'idle',
  waypoints: []
});

describe('training-map scale calibration', () => {
  test('applies the map movement calibration relative to the legacy world scale', () => {
    expect(resolveTrainingMapMovementScale({})).toBe(1);
    expect(resolveTrainingMapMovementScale({
      trainingMap: { movementCalibration: { leaderSpeedMultiplier: 18 } }
    })).toBe(1);
    expect(resolveTrainingMapMovementScale({
      trainingMap: { movementCalibration: { leaderSpeedMultiplier: 36 } }
    })).toBe(2);
  });
});

describe('training-map narrow passage handling', () => {
  test('reduces a wide formation to a single-file queue for a one-agent gate', () => {
    const columns = resolveTrainingNarrowPassageColumns({
      position: { x: -20, y: 0 },
      forward: { x: 1, y: 0 },
      obstacles: [
        { id: 'gate-top', x: 0, y: 31.5, width: 18, depth: 57, blocksMovement: true },
        { id: 'gate-bottom', x: 0, y: -31.5, width: 18, depth: 57, blocksMovement: true }
      ],
      baseColumns: 4,
      spacing: 5.55,
      agentRadius: 2.25,
      navigation: {
        narrowPassage: {
          probeDistance: 24,
          probeStep: 1,
          entryDistance: 32
        }
      }
    });

    expect(columns).toMatchObject({ active: true, columns: 1 });
    expect(columns.width).toBeLessThan(5.55);
  });
});

describe('training-map AI simulation profile', () => {
  test('profiles the all-AI decision path with representative squads', () => {
    const field = { width: 2400, height: 1200 };
    const mapConfig = {
      mapId: 'training-war-map-v1',
      navigation: {
        cellSize: 32,
        maxSearchNodes: 1800,
        pathClearance: 1.2,
        agentRadius: 2.25,
        narrowPassage: {
          cellSize: 8,
          probeDistance: 48,
          probeStep: 2,
          entryDistance: 38,
          releaseSeconds: 3.2
        },
        aiTargetScoring: {
          distanceWeight: 30,
          sameLaneBonus: 18,
          offLanePenalty: 7,
          threatWeight: 14,
          lowHealthBonus: 12,
          inAttackRangeBonus: 22,
          attackingAllyBonus: 16,
          targetLockBonus: 10,
          protectedAreaPenalty: 12,
          blockedLinePenalty: 5
        }
      },
      lanes: [{
        id: 'mid',
        width: 180,
        centerline: [{ x: -1100, y: 0 }, { x: 1100, y: 0 }]
      }],
      terrainRegions: [{
        id: 'grass-main',
        type: 'grass',
        shape: 'rect',
        x: 0,
        y: 0,
        width: field.width,
        height: field.height,
        walkable: true
      }]
    };
    const walls = Array.from({ length: 8 }, (_, index) => ({
      id: `profile-wall-${index}`,
      x: -420 + (index * 120),
      y: index % 2 === 0 ? 90 : -90,
      width: 72,
      depth: 36,
      blocksMovement: true,
      blocksVision: true
    }));
    const squads = Array.from({ length: 12 }, (_, index) => {
      const attacker = index < 6;
      return {
        ...createSquad({
          id: `profile-${index}`,
          team: attacker ? 'attacker' : 'defender',
          x: attacker ? -900 : 900
        }),
        y: (index % 6 - 2.5) * 48,
        startCount: 1000,
        remain: 1000,
        units: { infantry_basic: 1000 },
        behavior: 'auto',
        controlMode: 'AI',
        stamina: 100,
        order: { type: 'ATTACK_MOVE', pathPoints: [], pathIndex: 0 }
      };
    });
    const trainingNavigator = createTrainingMapNavigator({ field, mapConfig });
    let planCalls = 0;
    const originalPlanRoute = trainingNavigator.planRoute.bind(trainingNavigator);
    trainingNavigator.planRoute = (...args) => {
      planCalls += 1;
      return originalPlanRoute(...args);
    };
    const sim = {
      field,
      buildings: walls,
      squads,
      timeElapsed: 0,
      trainingMap: mapConfig,
      trainingNavigator,
      trainingObjectives: []
    };
    const crowd = createCrowdSim(sim, {
      repConfig: {
        maxAgentWeight: 50,
        maxTotalAgents: 360,
        strictAgentMapping: true
      }
    });
    const allAiSamples = [];
    for (let index = 0; index < 20; index += 1) {
      const start = performance.now();
      updateCrowdSim(crowd, sim, 1 / 30);
      allAiSamples.push(performance.now() - start);
    }
    squads.forEach((squad) => {
      squad.behavior = 'move';
      squad.controlMode = 'USER';
      squad.order = { type: 'MOVE', pathPoints: [], pathIndex: 0 };
      squad.waypoints = [{
        x: squad.team === 'attacker' ? 1000 : -1000,
        y: Number(squad.y) || 0
      }];
    });
    const manualSamples = [];
    for (let index = 0; index < 8; index += 1) {
      const start = performance.now();
      updateCrowdSim(crowd, sim, 1 / 30);
      manualSamples.push(performance.now() - start);
    }
    expect(planCalls).toBeGreaterThan(0);
    expect(planCalls).toBeLessThanOrEqual(20);
    expect(allAiSamples.every((sample) => Number.isFinite(sample))).toBe(true);
    expect(manualSamples.every((sample) => Number.isFinite(sample))).toBe(true);
  });

  test('queues real-map AI routes through highland exits', () => {
    const mapConfig = buildReferenceTrainingMapConfig();
    const field = {
      width: mapConfig.layoutMeta.fieldWidth,
      height: mapConfig.layoutMeta.fieldHeight
    };
    const slotsByTeam = (team) => mapConfig.deploySlots.filter((slot) => slot.team === team);
    const squads = [...slotsByTeam('attacker'), ...slotsByTeam('defender')].map((slot, index) => ({
      ...createSquad({ id: `reference-${index}`, team: slot.team, x: slot.x }),
      y: slot.y,
      startCount: 1000,
      remain: 1000,
      units: { infantry_basic: 1000 },
      behavior: 'auto',
      controlMode: 'AI',
      stamina: 100,
      order: { type: 'ATTACK_MOVE', pathPoints: [], pathIndex: 0 }
    }));
    const initialPositions = new Map(squads.map((squad) => [squad.id, { x: squad.x, y: squad.y }]));
    const trainingNavigator = createTrainingMapNavigator({ field, mapConfig });
    let planCalls = 0;
    const originalPlanRoute = trainingNavigator.planRoute.bind(trainingNavigator);
    trainingNavigator.planRoute = (...args) => {
      planCalls += 1;
      return originalPlanRoute(...args);
    };
    const sim = {
      field,
      buildings: mapConfig.objects,
      squads,
      timeElapsed: 0,
      trainingMap: mapConfig,
      trainingNavigator,
      trainingObjectives: []
    };
    const crowd = createCrowdSim(sim, {
      repConfig: {
        maxAgentWeight: 50,
        maxTotalAgents: 360,
        strictAgentMapping: true
      }
    });

    for (let index = 0; index < 60; index += 1) {
      updateCrowdSim(crowd, sim, 1 / 20);
    }

    expect(planCalls).toBeGreaterThan(0);
    expect(planCalls).toBeLessThanOrEqual(60);
    expect(squads.some((squad) => squad.waypoints.length > 0)).toBe(true);
    expect(squads.every((squad) => {
      const initial = initialPositions.get(squad.id);
      return Math.hypot(squad.x - initial.x, squad.y - initial.y) > 8;
    })).toBe(true);
  });
});

describe('training-map forced displacement', () => {
  test('keeps a melee knockback target on the near side of a blocking wall', () => {
    const wall = {
      id: 'skill-wall',
      x: 0,
      y: 0,
      width: 20,
      depth: 120,
      blocksMovement: true
    };
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: -60 });
    const defender = createSquad({ id: 'defender', team: 'defender', x: -20 });
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [wall],
      squads: [attacker, defender],
      timeElapsed: 0
    };
    const crowd = createCrowdSim(sim);
    const [target] = getCrowdAgentsForSquad(crowd, defender.id);

    const result = triggerCrowdSkill(sim, crowd, attacker.id, {
      x: 20,
      y: 0,
      castProfile: {
        sourceCategory: 'melee',
        targetMode: 'ground',
        castStyle: 'melee',
        shape: 'cone',
        coneAngleDeg: 180,
        maxRange: 100,
        aoeRadius: 24,
        durationSec: 0.3,
        waves: 1,
        knockback: 30
      }
    });

    expect(result.ok).toBe(true);
    expect(target.x).toBeLessThan(-12);
    expect(isInsideCollider(target, wall, target.radius)).toBe(false);
  });

  test('counts an unreachable replan and uses the map cooldown', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: -80 });
    attacker.behavior = 'move';
    attacker.stamina = 100;
    attacker.waypoints = [{ x: 80, y: 0 }];
    attacker.order = { type: 'MOVE', pathPoints: [{ x: 80, y: 0 }], pathIndex: 0 };
    attacker._navigationCollisionAt = 1;
    const planRoute = jest.fn(() => [{ x: -80, y: 0 }]);
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker],
      timeElapsed: 0,
      trainingNavigator: {
        planRoute,
        getPathFailureReplanCooldownSeconds: () => 0.2,
        findNearestWalkablePoint: (point) => point
      }
    };
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(planRoute).toHaveBeenCalledTimes(1);
    expect(attacker._navigationFailureCount).toBe(1);
    expect(attacker._navigationReplanAt).toBeCloseTo(0.3);
  });

});

describe('training-map automatic navigation', () => {
  const field = { width: 1000, height: 400 };
  const curvedLane = [{
    id: 'mid',
    width: 100,
    attackerDirection: 'left-to-right',
    centerline: [
      { x: -400, y: 0 },
      { x: -120, y: 150 },
      { x: 120, y: 150 },
      { x: 400, y: 0 }
    ]
  }];
  const buildAutoSim = ({ squads = [], buildings = [], trainingNavigator = null } = {}) => ({
    field,
    buildings,
    squads,
    timeElapsed: 0,
    trainingMap: {
      mapId: 'training-war-map-v1',
      lanes: curvedLane,
      navigation: { wallClearance: 8 }
    },
    trainingNavigator: trainingNavigator || {
      planRoute: jest.fn((start, target) => [{ x: target.x, y: target.y }]),
      getPathFailureReplanCooldownSeconds: () => 0.2,
      findNearestWalkablePoint: (point) => point
    }
  });

  const createAutoSquad = ({ id, team, x }) => ({
    ...createSquad({ id, team, x }),
    behavior: 'auto',
    stamina: 100,
    order: { type: 'ATTACK_MOVE', pathPoints: [], pathIndex: 0 }
  });

  test('uses one direct endpoint when the automatic goal is unobstructed', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const sim = buildAutoSim({ squads: [attacker] });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(sim.trainingNavigator.planRoute).toHaveBeenCalledTimes(1);
    expect(attacker.autoNavigation).toMatchObject({ goalId: 'field-edge:attacker' });
    expect(attacker.waypoints).toEqual([{ x: 488, y: 0 }]);
    expect(attacker.x).toBeGreaterThan(-430);
  });

  test('uses a detour only when an obstacle blocks the automatic goal', () => {
    const wall = { id: 'wall', x: 0, y: 0, width: 80, depth: 160, blocksMovement: true };
    const navigator = createTrainingMapNavigator({
      field,
      mapConfig: { navigation: { cellSize: 40, wallClearance: 8, maxSearchNodes: 1200 }, lanes: curvedLane }
    });
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const sim = buildAutoSim({ squads: [attacker], buildings: [wall], trainingNavigator: navigator });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(attacker.waypoints.length).toBeGreaterThan(1);
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeGreaterThan(450);
    expect(attacker.waypoints[attacker.waypoints.length - 1].y).toBe(0);
    expect(attacker.waypoints.some((point) => Math.abs(point.y) > 100)).toBe(true);
  });

  test('moves directly toward an enemy instead of consuming its lane centerline', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const defender = createSquad({ id: 'defender', team: 'defender', x: 80 });
    const sim = buildAutoSim({ squads: [attacker, defender] });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(attacker.waypoints).toHaveLength(1);
    expect(attacker.waypoints[0].x).toBeGreaterThan(-430);
    expect(attacker.waypoints[0].x).toBeLessThan(80);
    expect(attacker.waypoints[0].y).toBe(0);
  });

  test('uses the map score to favor a same-lane enemy over a closer off-lane enemy', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const offLane = { ...createSquad({ id: 'off-lane', team: 'defender', x: -350 }), y: 140 };
    const sameLane = createSquad({ id: 'same-lane', team: 'defender', x: 20 });
    const sim = buildAutoSim({ squads: [attacker, offLane, sameLane] });
    sim.trainingMap.lanes = [
      {
        id: 'mid',
        width: 100,
        centerline: [{ x: -450, y: 0 }, { x: 450, y: 0 }]
      },
      {
        id: 'top',
        width: 100,
        centerline: [{ x: -450, y: 140 }, { x: 450, y: 140 }]
      }
    ];
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(attacker._trainingAiSelection?.targetId).toBe(sameLane.id);
    expect(attacker.targetSquadId).toBe(sameLane.id);
    expect(attacker.debugTargetScore?.sameLane).toBe(true);
  });

  test('routes a ranged squad to a visible attack position around a blocking building', () => {
    const wall = { id: 'wall', x: 0, y: 0, width: 80, depth: 240, blocksMovement: true };
    const navigator = createTrainingMapNavigator({
      field,
      mapConfig: { navigation: { cellSize: 40, wallClearance: 8, maxSearchNodes: 1800 }, lanes: curvedLane }
    });
    const attacker = {
      ...createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 }),
      classTag: 'archer',
      roleTag: '远程',
      stats: { atk: 8, speed: 1, range: 10, attackRange: { min: 2, max: 10 } }
    };
    const defender = {
      ...createSquad({ id: 'defender', team: 'defender', x: 80 }),
      radius: 12
    };
    const sim = buildAutoSim({ squads: [attacker, defender], buildings: [wall], trainingNavigator: navigator });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    const endpoint = attacker.waypoints[attacker.waypoints.length - 1];
    expect(attacker.waypoints.length).toBeGreaterThan(1);
    expect(endpoint).toBeTruthy();
    expect(Math.abs(endpoint.y)).toBeGreaterThan(90);
    expect(raycastObstacles(endpoint, defender, [wall], 1)).toBeNull();
  });

  test('defers an unreachable enemy before resuming its automatic fallback', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const defender = createSquad({ id: 'defender', team: 'defender', x: 80 });
    const navigator = {
      planRoute: jest.fn((start, target) => (
        target.x < 200 ? [{ x: start.x, y: start.y }] : [{ x: target.x, y: target.y }]
      )),
      getPathFailureReplanCooldownSeconds: () => 0.2,
      findNearestWalkablePoint: (point) => point
    };
    const sim = buildAutoSim({ squads: [attacker, defender], trainingNavigator: navigator });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);
    updateCrowdSim(crowd, sim, 0.05);
    updateCrowdSim(crowd, sim, 0.05);

    const pursuitCalls = navigator.planRoute.mock.calls.filter(([, target]) => target.x < 200);
    expect(pursuitCalls).toHaveLength(1);
    expect(attacker._trainingTargetNavigation).toMatchObject({
      targetId: defender.id,
      failureCount: 1
    });
    expect(attacker.autoNavigation).toMatchObject({ goalId: 'field-edge:attacker' });
    expect(attacker.waypoints).toHaveLength(1);
    expect(attacker.waypoints[0]).toMatchObject({ y: 0 });
    expect(attacker.waypoints[0].x).toBeGreaterThan(480);
  });
});

describe('training-map AI skill preflight', () => {
  const skillField = { width: 1000, height: 400 };

  test('rejects ranged skills through a building and accepts a clear, legal target', () => {
    const wall = { id: 'wall', x: 0, y: 0, width: 20, depth: 140, blocksMovement: true };
    const archer = {
      ...createSquad({ id: 'archer', team: 'defender', x: -70 }),
      classTag: 'archer',
      roleTag: '远程',
      stamina: 100,
      stats: { atk: 8, speed: 1, range: 10, attackRange: { min: 2, max: 10 } },
      skillCooldowns: { infantry: 0, cavalry: 0, archer: 0, artillery: 0, support: 0 }
    };
    const target = createSquad({ id: 'target', team: 'attacker', x: 70 });
    const sim = {
      field: skillField,
      squads: [archer, target],
      buildings: [wall],
      trainingNavigator: { isWalkable: () => true }
    };

    expect(resolveTrainingAiSkillPreflight({ squad: archer, target, sim, skillKind: 'archer' }))
      .toMatchObject({ ok: false, reason: 'line-of-sight-blocked' });

    sim.buildings = [];
    expect(resolveTrainingAiSkillPreflight({ squad: archer, target, sim, skillKind: 'archer' }))
      .toMatchObject({ ok: true, targetPoint: { x: 70, y: 0 } });
  });

  test('defers a cavalry AI skill until its stamina can pay the charge cost', () => {
    const cavalry = {
      ...createSquad({ id: 'cavalry', team: 'defender', x: -50 }),
      classTag: 'cavalry',
      stamina: 31,
      skillCooldowns: { infantry: 0, cavalry: 0, archer: 0, artillery: 0, support: 0 }
    };
    const target = createSquad({ id: 'target', team: 'attacker', x: 30 });
    const sim = { field: skillField, squads: [cavalry, target], buildings: [] };

    expect(resolveTrainingAiSkillPreflight({ squad: cavalry, target, sim, skillKind: 'cavalry' }))
      .toMatchObject({ ok: false, reason: 'insufficient-stamina' });
  });

  test('applies the preflight in the defender AI loop before it calls the existing skill command', () => {
    const wall = { id: 'wall', x: 0, y: 0, width: 20, depth: 140, blocksMovement: true };
    const defender = {
      ...createSquad({ id: 'defender', team: 'defender', x: -70 }),
      classTag: 'archer',
      roleTag: '远程',
      behavior: 'auto',
      stamina: 100,
      stats: { atk: 8, speed: 1, range: 10, attackRange: { min: 2, max: 10 } },
      skillCooldowns: { infantry: 0, cavalry: 0, archer: 0, artillery: 0, support: 0 }
    };
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 70 });
    const sim = {
      field: skillField,
      squads: [defender, attacker],
      buildings: [wall],
      timeElapsed: 0,
      trainingMap: { mapId: 'training-war-map-v1', lanes: [], navigation: { wallClearance: 8 } },
      trainingNavigator: {
        planRoute: jest.fn((start, target) => [{ x: target.x, y: target.y }]),
        getPathFailureReplanCooldownSeconds: () => 0.2,
        findNearestWalkablePoint: (point) => point,
        isWalkable: () => true
      }
    };
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(defender.activeSkill).toBeFalsy();
    expect(sim.trainingAiEvents.some((event) => event.reason === 'skill-preflight-line-of-sight-blocked')).toBe(true);

    sim.buildings = [];
    defender._aiSkillCd = 0;
    updateCrowdSim(crowd, sim, 0.1);

    expect(defender.activeSkill?.targetSquadId).toBe(attacker.id);
  });
});

describe('training-map neutral camp combat', () => {
  test('moves both central sand guards along their configured shuttle paths after training starts', () => {
    const mapConfig = buildReferenceTrainingMapConfig();
    const field = {
      width: mapConfig.layoutMeta.fieldWidth,
      height: mapConfig.layoutMeta.fieldHeight
    };
    const definitions = mapConfig.objectives.filter((objective) => (
      objective?.type === 'neutralCamp'
      && objective?.neutralCamp?.profileId === 'center'
    ));
    const context = {
      field,
      obstacles: [],
      navigator: {
        isWalkable: () => true,
        findNearestWalkablePoint: (point) => point,
        planRoute: (_start, target) => [{ x: target.x, y: target.y }]
      }
    };
    const { camps, squads } = initializeTrainingNeutralCamps({ definitions, context });
    const sim = {
      field,
      buildings: [],
      squads,
      trainingNeutralCamps: camps,
      trainingStats: { neutralKills: 0 }
    };
    const before = squads.map((squad) => ({ x: squad.x, y: squad.y }));

    updateTrainingNeutralCamps({ sim, crowd: { agentsBySquad: new Map() }, context, nowSec: 3 });

    expect(camps).toHaveLength(2);
    camps.forEach((camp, index) => {
      expect(camp.patrolMode).toBe('shuttle');
      expect(camp.patrolPoints).toHaveLength(2);
      expect(squads[index].guard.patrolTarget).toEqual(camp.patrolPoints[0]);
      expect(Math.hypot(
        squads[index].guard.patrolTarget.x - before[index].x,
        squads[index].guard.patrolTarget.y - before[index].y
      )).toBeGreaterThan(0);
    });
  });

  test('keeps a ranged neutral guard moving toward its patrol target before acquiring an enemy', () => {
    const neutral = {
      ...createSquad({ id: 'neutral-patrol', team: 'neutral', x: 0 }),
      behavior: 'guard',
      classTag: 'archer',
      roleTag: '远程',
      radius: 8,
      guard: {
        enabled: true,
        cx: 0,
        cy: 0,
        radius: 60,
        returnRadius: 80,
        chaseRadius: 100,
        activeTargetId: '',
        patrolTarget: { x: 36, y: 0 }
      },
      stats: { atk: 8, def: 1, speed: 1, range: 5, attackRange: { min: 2, max: 5 } }
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 240, height: 160 },
      buildings: [],
      squads: [neutral]
    };
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(neutral.action).toBe('巡逻');
    expect(neutral.targetSquadId).toBe('');
    expect(neutral.guard.patrolTarget).toEqual({ x: 36, y: 0 });
    for (let index = 0; index < 12; index += 1) updateCrowdSim(crowd, sim, 0.1);
    expect(neutral.x).toBeGreaterThan(0);
  });

  test('allows both factions to acquire and damage neutral camp guards', () => {
    const attacker = {
      ...createSquad({ id: 'attacker', team: 'attacker', x: 0 }),
      behavior: 'auto',
      classTag: 'infantry',
      radius: 8,
      stats: { atk: 20, def: 1, speed: 1, range: 1, attackRange: { min: 1, max: 1 } }
    };
    const neutral = {
      ...createSquad({ id: 'neutral-camp', team: 'neutral', x: 1 }),
      behavior: 'guard',
      classTag: 'infantry',
      radius: 8,
      guard: { enabled: true, cx: 1, cy: 0, radius: 60, returnRadius: 12, chaseRadius: 100, activeTargetId: '' },
      stats: { atk: 20, def: 1, speed: 1, range: 1, attackRange: { min: 1, max: 1 } }
    };
    const attackerAgent = {
      id: 'attacker-agent', squadId: attacker.id, team: 'attacker', x: 0, y: 0,
      weight: 10, hpWeight: 10, initialWeight: 10, radius: 2, typeCategory: 'infantry', dead: false
    };
    const neutralAgent = {
      id: 'neutral-agent', squadId: neutral.id, team: 'neutral', x: 1, y: 0,
      weight: 10, hpWeight: 10, initialWeight: 10, radius: 2, typeCategory: 'infantry', dead: false
    };
    const agents = [attackerAgent, neutralAgent];
    const sim = {
      timeElapsed: 1,
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker, neutral]
    };
    const crowd = {
      agentsBySquad: new Map([
        [attacker.id, [attackerAgent]],
        [neutral.id, [neutralAgent]]
      ]),
      allAgents: agents,
      spatial: buildSpatialHash(agents, 14),
      effectsPool: createCombatEffectsPool(),
      engagement: { enabled: false, config: {} }
    };

    updateCrowdCombat(sim, crowd, 0.2);

    expect(attacker.targetSquadId).toBe(neutral.id);
    expect(neutral.targetSquadId).toBe(attacker.id);
    expect(attackerAgent.weight).toBeLessThan(10);
    expect(neutralAgent.weight).toBeLessThan(10);
  });
});
