import {
  isTrainingMapAiTargetDeferred,
  selectTrainingMapAiObjective,
  selectTrainingMapAiTarget,
  syncTrainingMapAiState,
  TRAINING_MAP_AI_STATE
} from './TrainingMapAi';

const createSquad = ({
  id,
  team,
  x = 0,
  y = 0,
  remain = 100,
  behavior = 'auto',
  classTag = 'infantry',
  attack = 10,
  health = 100,
  maxHealth = 100
} = {}) => ({
  id,
  team,
  x,
  y,
  remain,
  startCount: 100,
  behavior,
  classTag,
  radius: 10,
  health,
  maxHealth,
  stats: {
    atk: attack,
    range: 1,
    attackRange: { min: 1, max: 1 }
  },
  waypoints: []
});

const createTrainingSim = (squads = []) => ({
  field: { width: 1000, height: 400 },
  squads,
  buildings: [],
  trainingObjectives: [],
  trainingMap: {
    mapId: 'training-war-map-v1',
    lanes: [
      { id: 'top', width: 100, centerline: [{ x: -480, y: 145 }, { x: 480, y: 145 }] },
      { id: 'mid', width: 100, centerline: [{ x: -480, y: 0 }, { x: 480, y: 0 }] },
      { id: 'bottom', width: 100, centerline: [{ x: -480, y: -145 }, { x: 480, y: -145 }] }
    ],
    navigation: {
      aiTargetScoring: {
        distanceWeight: 30,
        sameLaneBonus: 30,
        offLanePenalty: 12,
        threatWeight: 14,
        lowHealthBonus: 12,
        inAttackRangeBonus: 22,
        attackingAllyBonus: 16,
        targetLockBonus: 10,
        protectedAreaPenalty: 12,
        blockedLinePenalty: 5
      }
    }
  }
});

describe('training-map AI target scoring', () => {
  test('prefers a same-lane threat over a slightly closer off-lane target', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0, y: 0, attack: 18 });
    const offLane = createSquad({ id: 'off-lane', team: 'defender', x: 80, y: 140, attack: 20 });
    const sameLane = createSquad({ id: 'same-lane', team: 'defender', x: 230, y: 0, attack: 50 });
    const sim = createTrainingSim([attacker, offLane, sameLane]);

    const selection = selectTrainingMapAiTarget(attacker, sim, { nowSec: 1 });

    expect(selection?.targetId).toBe(sameLane.id);
    expect(selection?.sameLane).toBe(true);
    expect(selection?.terms.lane).toBeGreaterThan(0);
    expect(selection?.terms.threat).toBeGreaterThan(0);
  });

  test('keeps a deferred unreachable target out of later score queries', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0, y: 0 });
    const blocked = createSquad({ id: 'blocked', team: 'defender', x: 30, y: 0, attack: 80 });
    const reachable = createSquad({ id: 'reachable', team: 'defender', x: 160, y: 0, attack: 10 });
    attacker._trainingTargetNavigation = {
      targetId: blocked.id,
      failureCount: 3,
      retryAt: 0,
      blockedUntil: 4,
      targets: {
        [blocked.id]: { failureCount: 3, retryAt: 0, blockedUntil: 4 }
      }
    };
    const sim = createTrainingSim([attacker, blocked, reachable]);

    expect(isTrainingMapAiTargetDeferred(attacker, blocked.id, 1)).toBe(true);
    expect(selectTrainingMapAiTarget(attacker, sim, { nowSec: 1 })?.targetId).toBe(reachable.id);
    expect(isTrainingMapAiTargetDeferred(attacker, blocked.id, 4)).toBe(false);
  });

  test('keeps minion target acquisition inside the assigned road band', () => {
    const attacker = createSquad({ id: 'minion-attacker', team: 'attacker', x: 0, y: 0 });
    attacker.isMinionWaveUnit = true;
    attacker.minionLaneId = 'mid';
    attacker.spawnLaneId = 'mid';
    attacker.minionPath = [{ x: -480, y: 0 }, { x: 480, y: 0 }];
    const roadTarget = createSquad({ id: 'road-target', team: 'defender', x: 120, y: 0 });
    roadTarget.spawnLaneId = 'mid';
    const offRoadTarget = createSquad({ id: 'off-road-target', team: 'defender', x: 24, y: 180 });
    offRoadTarget.spawnLaneId = 'mid';
    const sim = createTrainingSim([attacker, roadTarget, offRoadTarget]);

    expect(selectTrainingMapAiTarget(attacker, sim, { nowSec: 1 })?.targetId)
      .toBe(roadTarget.id);
  });

  test('does not auto-select a neutral camp objective', () => {
    const attacker = createSquad({ id: 'objective-attacker', team: 'attacker', x: 0, y: 0 });
    const sim = createTrainingSim([attacker]);
    sim.buildings = [{ id: 'neutral-camp-building', x: 40, y: 0, width: 20, depth: 20 }];
    sim.trainingObjectives = [{
      id: 'neutral-objective',
      sourceObjectId: 'neutral-camp-building',
      type: 'neutralCamp',
      team: 'neutral',
      hp: 100,
      maxHp: 100
    }];

    expect(selectTrainingMapAiObjective(attacker, sim)).toBeNull();
  });

  test('keeps fallback objectives on the assigned lane even when off-lane scoring is cheaper', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0, y: 0 });
    const sim = createTrainingSim([attacker]);
    sim.buildings = [
      { id: 'tower-top', x: 60, y: 145, width: 30, depth: 30, blocksMovement: true },
      { id: 'tower-mid', x: 220, y: 0, width: 30, depth: 30, blocksMovement: true }
    ];
    sim.trainingObjectives = [
      { id: 'tower-top', sourceObjectId: 'tower-top', team: 'defender', laneId: 'top', hp: 100, maxHp: 100 },
      { id: 'tower-mid', sourceObjectId: 'tower-mid', team: 'defender', laneId: 'mid', hp: 100, maxHp: 100 }
    ];
    sim.trainingMap.navigation.aiTargetScoring.sameLaneBonus = 0;
    sim.trainingMap.navigation.aiTargetScoring.offLanePenalty = 0;

    const selection = selectTrainingMapAiObjective(attacker, sim);

    expect(selection?.targetId).toBe('objective:tower-mid');
    expect(selection?.sameLane).toBe(true);
  });
});

describe('training-map AI state machine', () => {
  test('records spawn, formation, advance, approach, attack and ability transitions', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0, y: 0 });
    const defender = createSquad({ id: 'defender', team: 'defender', x: 120, y: 0 });
    const sim = createTrainingSim([attacker, defender]);

    expect(syncTrainingMapAiState({ squad: attacker, sim, nowSec: 0 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.FORMING);
    expect(syncTrainingMapAiState({ squad: attacker, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.ADVANCE);

    const selection = selectTrainingMapAiTarget(attacker, sim, { nowSec: 2 });
    expect(syncTrainingMapAiState({ squad: attacker, sim, nowSec: 2, selection })?.state)
      .toBe(TRAINING_MAP_AI_STATE.APPROACH_TARGET);

    defender.x = 8;
    const closeSelection = selectTrainingMapAiTarget(attacker, sim, { nowSec: 3 });
    expect(syncTrainingMapAiState({ squad: attacker, sim, nowSec: 3, selection: closeSelection })?.state)
      .toBe(TRAINING_MAP_AI_STATE.ATTACK);

    attacker.activeSkill = { id: 'test-skill' };
    expect(syncTrainingMapAiState({ squad: attacker, sim, nowSec: 4, selection: closeSelection })?.state)
      .toBe(TRAINING_MAP_AI_STATE.USE_ABILITY);

    const states = attacker.trainingAi.events.map((event) => event.to);
    expect(states).toEqual(expect.arrayContaining([
      TRAINING_MAP_AI_STATE.SPAWN,
      TRAINING_MAP_AI_STATE.FORMING,
      TRAINING_MAP_AI_STATE.ADVANCE,
      TRAINING_MAP_AI_STATE.APPROACH_TARGET,
      TRAINING_MAP_AI_STATE.ATTACK,
      TRAINING_MAP_AI_STATE.USE_ABILITY
    ]));
    expect(sim.trainingAiEvents.length).toBeGreaterThanOrEqual(states.length);
  });

  test('maps retreat, neutral camp return, dead and disabled conditions to stable states', () => {
    const retreating = createSquad({ id: 'retreating', team: 'attacker', behavior: 'retreat' });
    const neutral = createSquad({ id: 'neutral', team: 'neutral', behavior: 'guard' });
    const dead = createSquad({ id: 'dead', team: 'attacker', remain: 0 });
    const disabled = createSquad({ id: 'disabled', team: 'defender', behavior: 'disabled' });
    const sim = createTrainingSim([retreating, neutral, dead, disabled]);
    sim.trainingNeutralCamps = [{ activeSquadId: neutral.id, state: 'leashing' }];

    expect(syncTrainingMapAiState({ squad: retreating, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.RETREAT);
    expect(syncTrainingMapAiState({ squad: neutral, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.RETURN_TO_CAMP);
    expect(syncTrainingMapAiState({ squad: dead, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.DEAD);
    expect(syncTrainingMapAiState({ squad: disabled, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.DISABLED);
  });
});
