import {
  isTrainingMapAiTargetDeferred,
  selectTrainingMapAiPlan,
  selectTrainingMapAiObjective,
  selectTrainingMapAiTarget,
  syncTrainingMapAiState,
  TRAINING_MAP_AI_PLAN_KIND,
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

const createMinionWave = ({
  id = 'wave',
  team = 'attacker',
  laneId = 'mid',
  barracksLane = 'top',
  x = 80,
  y = 0,
  targetBuildingId = ''
} = {}) => ({
  ...createSquad({ id, team, x, y, remain: 30 }),
  behavior: 'auto',
  controlMode: 'AI',
  isMinionWaveUnit: true,
  minionLaneId: laneId,
  spawnLaneId: laneId,
  minionBarracksLane: barracksLane,
  minionPath: [{ x: -480, y }, { x: 480, y }],
  minionPathProgress: x + 480,
  targetBuildingId
});

const addObjective = (sim, {
  id,
  type = 'tower',
  team = 'defender',
  laneId = 'mid',
  x = 200,
  y = 0,
  attackRange = 80,
  attackEnabled = true,
  currentTargetId = '',
  lockedSquadId = ''
} = {}) => {
  const building = {
    id: `building:${id}`,
    x,
    y,
    width: 30,
    depth: 30,
    blocksMovement: true,
    destroyed: false
  };
  const objective = {
    id,
    sourceObjectId: building.id,
    type,
    team,
    laneId,
    hp: 100,
    maxHp: 100,
    attackRange,
    attackDamage: attackEnabled ? 20 : 0,
    attackEnabled,
    targetable: true,
    currentTargetId,
    lockedSquadId,
    destroyed: false
  };
  sim.buildings.push(building);
  sim.trainingObjectives.push(objective);
  return { building, objective };
};

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

  test('does not run card target scoring for minion waves', () => {
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

    expect(selectTrainingMapAiTarget(attacker, sim, { nowSec: 1 })).toBeNull();
    expect(attacker._trainingAiTargetCache).toBeUndefined();
  });

  test('does not run card target scoring for user-controlled card squads', () => {
    const attacker = createSquad({ id: 'user-attacker', team: 'attacker', x: 0, y: 0 });
    attacker.controlMode = 'USER';
    const defender = createSquad({ id: 'defender', team: 'defender', x: 40, y: 0 });
    const sim = createTrainingSim([attacker, defender]);

    expect(selectTrainingMapAiTarget(attacker, sim, { nowSec: 1 })).toBeNull();
    expect(attacker._trainingAiTargetCache).toBeUndefined();
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

describe('training-map lane strategy planning', () => {
  test('waits outside tower range until friendly minions take tower aggro', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 100 });
    const sim = createTrainingSim([attacker, wave]);
    const { building } = addObjective(sim, { id: 'mid-tower', x: 200, attackRange: 80 });

    const plan = selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 });

    expect(plan).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.ESCORT_WAVE,
      waveId: wave.id,
      targetBuildingId: building.id
    });
    expect(Math.hypot(plan.x - building.x, plan.y - building.y)).toBeGreaterThan(125);
  });

  test('joins a tower attack only after the tower locks friendly minions', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 110 });
    const sim = createTrainingSim([attacker, wave]);
    const { building, objective } = addObjective(sim, {
      id: 'mid-tower',
      x: 200,
      currentTargetId: wave.id,
      lockedSquadId: wave.id
    });

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.SIEGE_TOWER,
      targetObjectiveId: objective.id,
      targetBuildingId: building.id,
      waveId: wave.id
    });
  });

  test('immediately retreats when a defensive objective targets the main force', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 120 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 100 });
    const sim = createTrainingSim([attacker, wave]);
    const { building } = addObjective(sim, {
      id: 'mid-tower',
      x: 200,
      attackRange: 80,
      currentTargetId: attacker.id,
      lockedSquadId: attacker.id
    });

    const plan = selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 });

    expect(plan?.kind).toBe(TRAINING_MAP_AI_PLAN_KIND.RETREAT_FROM_TOWER);
    expect(Math.hypot(plan.x - building.x, plan.y - building.y)).toBeGreaterThan(140);
    expect(plan.x).toBeLessThan(attacker.x);
  });

  test('defends a fighting lane wave before considering towers or neutral camps', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 100 });
    const enemyWave = createMinionWave({ id: 'enemy-wave', team: 'defender', x: 135 });
    const neutral = createSquad({ id: 'neutral', team: 'neutral', x: 20 });
    neutral.isNeutralCampUnit = true;
    const sim = createTrainingSim([attacker, wave, enemyWave, neutral]);
    addObjective(sim, { id: 'mid-tower', x: 400 });

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.DEFEND_WAVE,
      targetSquadId: enemyWave.id,
      waveId: wave.id
    });
  });

  test('keeps the current lane target through small score changes', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 80 });
    const first = createMinionWave({ id: 'enemy-a', team: 'defender', x: 120 });
    const second = createMinionWave({ id: 'enemy-b', team: 'defender', x: 125 });
    const sim = createTrainingSim([attacker, wave, first, second]);

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })?.targetSquadId).toBe(first.id);
    first.x = 132;
    second.x = 118;
    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1.3 })?.targetSquadId).toBe(first.id);
  });

  test('uses safe downtime for a nearby neutral camp', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const neutral = createSquad({ id: 'neutral', team: 'neutral', x: 80 });
    neutral.isNeutralCampUnit = true;
    const sim = createTrainingSim([attacker, neutral]);

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.CLEAR_NEUTRAL,
      targetSquadId: neutral.id
    });
  });

  test('rotates only when the assigned lane has no living friendly wave', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const topWave = createMinionWave({ id: 'top-wave', laneId: 'top', x: 40, y: 145 });
    topWave.minionPath = [{ x: -480, y: 145 }, { x: 480, y: 145 }];
    const sim = createTrainingSim([attacker, topWave]);

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.ROTATE_LANE,
      laneId: 'top',
      waveId: topWave.id
    });
  });

  test('pushes both teams inward along their own lane direction while waiting for a wave', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: -400 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const defender = createSquad({ id: 'defender', team: 'defender', x: 400 });
    defender.behavior = 'auto';
    defender.controlMode = 'AI';
    defender.spawnLaneId = 'mid';
    const sim = createTrainingSim([attacker, defender]);

    const attackerPlan = selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 });
    const defenderPlan = selectTrainingMapAiPlan(defender, sim, { nowSec: 1 });

    expect(attackerPlan).toMatchObject({ kind: TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE, laneId: 'mid' });
    expect(defenderPlan).toMatchObject({ kind: TRAINING_MAP_AI_PLAN_KIND.PUSH_LANE, laneId: 'mid' });
    expect(attackerPlan.x).toBeGreaterThan(attacker.x);
    expect(defenderPlan.x).toBeLessThan(defender.x);
  });

  test('clears lane towers, then highland towers, then the matching barracks', () => {
    const attacker = createSquad({ id: 'attacker', team: 'attacker', x: 0 });
    attacker.behavior = 'auto';
    attacker.controlMode = 'AI';
    attacker.spawnLaneId = 'mid';
    const wave = createMinionWave({ x: 100, barracksLane: 'top' });
    const sim = createTrainingSim([attacker, wave]);
    const laneTower = addObjective(sim, {
      id: 'lane-tower',
      laneId: 'mid',
      x: 160,
      currentTargetId: wave.id
    });
    const highlandTower = addObjective(sim, {
      id: 'highland-tower',
      laneId: 'spawn-defender-top',
      x: 300,
      currentTargetId: wave.id
    });
    const barracks = addObjective(sim, {
      id: 'barracks',
      type: 'barracks',
      laneId: 'spawn-defender-top',
      x: 420,
      currentTargetId: wave.id
    });

    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 1 })?.targetObjectiveId)
      .toBe(laneTower.objective.id);
    laneTower.objective.destroyed = true;
    laneTower.building.destroyed = true;
    attacker._trainingAiPlan = null;
    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 2 })?.targetObjectiveId)
      .toBe(highlandTower.objective.id);
    highlandTower.objective.destroyed = true;
    highlandTower.building.destroyed = true;
    attacker._trainingAiPlan = null;
    expect(selectTrainingMapAiPlan(attacker, sim, { nowSec: 3 })).toMatchObject({
      kind: TRAINING_MAP_AI_PLAN_KIND.SIEGE_BARRACKS,
      targetObjectiveId: barracks.objective.id
    });
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

  test('maps card retreat, dead and disabled conditions while rejecting neutral squads', () => {
    const retreating = createSquad({ id: 'retreating', team: 'attacker', behavior: 'retreat' });
    const neutral = createSquad({ id: 'neutral', team: 'neutral', behavior: 'guard' });
    const dead = createSquad({ id: 'dead', team: 'attacker', remain: 0 });
    const disabled = createSquad({ id: 'disabled', team: 'defender', behavior: 'disabled' });
    const sim = createTrainingSim([retreating, neutral, dead, disabled]);
    sim.trainingNeutralCamps = [{ activeSquadId: neutral.id, state: 'leashing' }];

    expect(syncTrainingMapAiState({ squad: retreating, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.RETREAT);
    expect(syncTrainingMapAiState({ squad: neutral, sim, nowSec: 1 })).toBeNull();
    expect(neutral.trainingAi).toBeUndefined();
    expect(syncTrainingMapAiState({ squad: dead, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.DEAD);
    expect(syncTrainingMapAiState({ squad: disabled, sim, nowSec: 1 })?.state)
      .toBe(TRAINING_MAP_AI_STATE.DISABLED);
  });
});
