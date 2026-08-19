import {
  getTrainingNeutralCampSummary,
  initializeTrainingNeutralCamps,
  updateTrainingNeutralCamps
} from './TrainingNeutralCampSystem';

const buildDefinition = (overrides = {}) => ({
  objectiveId: 'objective_neutral_test-camp',
  sourceObjectId: 'map-test-camp',
  type: 'neutralCamp',
  team: 'neutral',
  rewardLabel: '测试中立营地',
  neutralCamp: {
    campId: 'test-camp',
    label: '测试中立营地',
    anchor: { x: 0, y: 0 },
    spawnPoints: [{ x: -8, y: 0 }, { x: 0, y: 8 }, { x: 8, y: 0 }],
    patrolPoints: [{ x: 16, y: 0 }, { x: 0, y: 16 }, { x: -16, y: 0 }],
    initialSpawnAtSec: 0,
    respawnSec: 3,
    senseRadius: 60,
    leashRadius: 100,
    returnRadius: 12,
    patrolIntervalSec: 2,
    composition: [{
      unitTypeId: 'training_neutral_guard',
      count: 6,
      hp: 80,
      attack: 14,
      defense: 7,
      speed: 1,
      attackRange: 1,
      classTag: 'infantry',
      unitCategory: 'melee',
      unitSubtype: 'balance'
    }],
    ...overrides
  }
});

const buildContext = () => ({
  field: { width: 400, height: 300 },
  obstacles: [],
  navigator: {
    isWalkable: jest.fn(() => true),
    findNearestWalkablePoint: jest.fn((point) => point),
    planRoute: jest.fn((start, target) => [{ x: target.x, y: target.y }])
  }
});

describe('TrainingNeutralCampSystem', () => {
  test('initializes a non-blocking neutral squad for every active camp', () => {
    const context = buildContext();
    const state = initializeTrainingNeutralCamps({
      definitions: [buildDefinition()],
      buildings: [{ id: 'map-test-camp', x: 0, y: 0, blocksMovement: false }],
      context
    });

    expect(state.camps).toHaveLength(1);
    expect(state.squads).toHaveLength(1);
    expect(state.camps[0]).toMatchObject({
      id: 'test-camp',
      state: 'alive',
      activeSquadId: 'neutral_camp_test-camp'
    });
    expect(state.squads[0]).toMatchObject({
      team: 'neutral',
      behavior: 'guard',
      neutralCampId: 'test-camp',
      remain: 6
    });
    expect(state.squads[0].guard).toMatchObject({
      enabled: true,
      chaseRadius: 100
    });
  });

  test('starts an immediate patrol as soon as the configured camp enters training', () => {
    const context = buildContext();
    const state = initializeTrainingNeutralCamps({
      definitions: [buildDefinition({ patrolStartImmediately: true })],
      buildings: [{ id: 'map-test-camp', x: 0, y: 0, blocksMovement: false }],
      context
    });

    expect(state.camps[0]).toMatchObject({ patrolStartImmediately: true, patrolIndex: 1 });
    expect(state.squads[0].guard.patrolTarget).toEqual({ x: 16, y: 0 });
    expect(state.squads[0].waypoints).toEqual([{ x: 16, y: 0 }]);
  });

  test('alternates a shuttle patrol between its two local endpoints', () => {
    const context = buildContext();
    const state = initializeTrainingNeutralCamps({
      definitions: [buildDefinition({
        patrolMode: 'shuttle',
        patrolStartImmediately: true,
        returnRadius: 12,
        patrolPoints: [{ x: 20, y: 0 }, { x: -20, y: 0 }]
      })],
      buildings: [{ id: 'map-test-camp', x: 0, y: 0, blocksMovement: false }],
      context
    });
    const camp = state.camps[0];
    const squad = state.squads[0];
    squad.x = 20;
    squad.y = 0;

    updateTrainingNeutralCamps({
      sim: { squads: [squad], trainingNeutralCamps: [camp], trainingStats: { neutralKills: 0 } },
      crowd: { agentsBySquad: new Map() },
      context,
      nowSec: 3
    });

    expect(squad.guard.patrolTarget).toEqual({ x: -20, y: 0 });
    expect(squad.waypoints).toEqual([{ x: -20, y: 0 }]);
  });

  test('marks a cleared camp once and restores its squad on the simulation respawn timer', () => {
    const context = buildContext();
    const { camps, squads } = initializeTrainingNeutralCamps({
      definitions: [buildDefinition()],
      buildings: [{ id: 'map-test-camp', x: 0, y: 0, blocksMovement: false }],
      context
    });
    const campSquad = squads[0];
    campSquad.remain = 0;
    campSquad.lastDamagedBySquadId = 'attacker-squad';
    const sim = {
      squads,
      trainingNeutralCamps: camps,
      trainingStats: { neutralKills: 0 }
    };
    const crowd = { agentsBySquad: new Map([[campSquad.id, []]]) };
    const spawnSquad = jest.fn((squad) => {
      crowd.agentsBySquad.set(squad.id, []);
    });

    updateTrainingNeutralCamps({ sim, crowd, context, nowSec: 1, spawnSquad });

    expect(camps[0]).toMatchObject({
      state: 'respawning',
      clearedAt: 1,
      respawnAt: 4,
      lastClearerSquadId: 'attacker-squad'
    });
    expect(sim.trainingStats.neutralKills).toBe(1);
    expect(spawnSquad).not.toHaveBeenCalled();

    updateTrainingNeutralCamps({ sim, crowd, context, nowSec: 4, spawnSquad });

    expect(camps[0]).toMatchObject({ state: 'alive', spawnedAt: 4, respawnAt: 0 });
    expect(campSquad.remain).toBe(6);
    expect(spawnSquad).toHaveBeenCalledWith(campSquad);
    expect(getTrainingNeutralCampSummary(sim)[0]).toMatchObject({
      state: 'alive',
      lastClearerSquadId: 'attacker-squad'
    });
  });

  test('leashes an escaped target back toward the camp through the shared navigator', () => {
    const context = buildContext();
    const { camps, squads } = initializeTrainingNeutralCamps({
      definitions: [buildDefinition()],
      buildings: [{ id: 'map-test-camp', x: 0, y: 0, blocksMovement: false }],
      context
    });
    const campSquad = squads[0];
    campSquad.targetSquadId = 'attacker-squad';
    const sim = {
      squads: [campSquad, {
        id: 'attacker-squad',
        team: 'attacker',
        remain: 10,
        x: 160,
        y: 0,
        radius: 10
      }],
      trainingNeutralCamps: camps,
      trainingStats: { neutralKills: 0 }
    };

    updateTrainingNeutralCamps({ sim, crowd: { agentsBySquad: new Map() }, context, nowSec: 1 });

    expect(camps[0].state).toBe('leashing');
    expect(campSquad.targetSquadId).toBe('');
    expect(campSquad.waypoints).toEqual([{ x: 0, y: 0 }]);
    expect(context.navigator.planRoute).toHaveBeenCalled();
  });
});
