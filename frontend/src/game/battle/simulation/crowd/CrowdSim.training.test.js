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
import { createTrainingObjectives } from '../objectives/TrainingObjectiveSystem';

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

describe('individual soldier combat behavior', () => {
  const unitTypeMap = new Map([
    ['test_melee', {
      classTag: 'infantry',
      roleTag: '近战',
      unitCategory: 'melee',
      unitSubtype: 'defense',
      speed: 1,
      attackRange: { min: 0, max: 1 }
    }],
    ['test_ranged', {
      classTag: 'archer',
      roleTag: '远程',
      unitCategory: 'ranged',
      unitSubtype: 'balance',
      speed: 1,
      attackRange: { min: 4, max: 8 }
    }],
    ['test_support_comprehensive', {
      classTag: 'infantry',
      roleTag: '远程',
      unitCategory: 'support',
      unitSubtype: 'comprehensive',
      speed: 1,
      attackRange: { min: 3, max: 6 }
    }],
    ['test_support_intervention', {
      classTag: 'infantry',
      roleTag: '远程',
      unitCategory: 'support',
      unitSubtype: 'intervention',
      speed: 1,
      attackRange: { min: 3, max: 6 }
    }],
    ['test_slow', {
      classTag: 'infantry',
      roleTag: '近战',
      unitCategory: 'melee',
      unitSubtype: 'defense',
      speed: 1,
      attackRange: { min: 0, max: 1 }
    }],
    ['test_fast', {
      classTag: 'cavalry',
      roleTag: '近战',
      unitCategory: 'melee',
      unitSubtype: 'mobility',
      speed: 3,
      attackRange: { min: 0, max: 1 }
    }]
  ]);

  const buildCombatSquad = ({
    id,
    team,
    x,
    units,
    isMinionWaveUnit = false,
    controlMode = 'AI',
    behavior = 'auto'
  }) => {
    const count = Object.values(units).reduce((sum, value) => sum + value, 0);
    return {
      id,
      team,
      x,
      y: 0,
      startCount: count,
      remain: count,
      maxHealth: count * 100,
      health: count * 100,
      radius: 10,
      classTag: 'infantry',
      roleTag: '近战',
      unitCategory: 'melee',
      units,
      stats: { atk: 20, def: 1, speed: 1, range: 1, attackRange: { min: 0, max: 1 } },
      behavior,
      controlMode,
      stamina: 100,
      waypoints: [],
      isMinionWaveUnit,
      minionLaneId: isMinionWaveUnit ? 'mid' : '',
      spawnLaneId: 'mid',
      minionPath: isMinionWaveUnit ? [{ x: -100, y: 0 }, { x: 100, y: 0 }] : [],
      minionPathIndex: 1,
      minionPathSpeed: 120,
      order: {
        type: controlMode === 'USER' ? 'IDLE' : 'ATTACK_MOVE',
        issuedAt: 0,
        commitUntil: 0,
        targetPoint: null,
        targetSquadId: '',
        targetBuildingId: ''
      }
    };
  };

  const buildCrowd = (sim) => createCrowdSim(sim, {
    unitTypeMap,
    repConfig: { maxAgentWeight: 1, strictAgentMapping: true }
  });

  test('keeps a minion squad alive while its last agent still has residual health', () => {
    const minion = buildCombatSquad({
      id: 'residual-health-minion',
      team: 'attacker',
      x: -80,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    const sim = {
      timeElapsed: 0,
      field: { width: 400, height: 160 },
      buildings: [],
      trainingObjectives: [],
      squads: [minion]
    };
    const crowd = buildCrowd(sim);
    const [agent] = getCrowdAgentsForSquad(crowd, minion.id);
    agent.weight = 0.4;
    agent.hpWeight = 0.4;

    updateCrowdSim(crowd, sim, 0.05);

    expect(minion.remain).toBe(1);
    expect(agent.dead).toBe(false);
    expect(crowd.allAgents).toContain(agent);
  });

  test('forces a detached soldier to rejoin instead of attacking alone', () => {
    const attacker = buildCombatSquad({
      id: 'front-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 }
    });
    const defender = buildCombatSquad({
      id: 'front-defender',
      team: 'defender',
      x: 140,
      units: { test_melee: 2 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const sim = {
      timeElapsed: 0,
      field: { width: 400, height: 160 },
      buildings: [],
      trainingObjectives: [],
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    const attackerAgents = getCrowdAgentsForSquad(crowd, attacker.id);
    const front = attackerAgents.find((agent) => !agent.isFlagBearer);
    const target = getCrowdAgentsForSquad(crowd, defender.id).find((agent) => !agent.isFlagBearer);
    front.x = 134;
    front.y = target.y;
    front.vx = 0;
    front.vy = 0;
    front._formationLocked = false;
    const beforeX = front.x;

    updateCrowdSim(crowd, sim, 0.05);

    expect(front.targetAgentId).toBe('');
    expect(front._formationDetached).toBe(true);
    expect(front.x).toBeLessThan(beforeX);
    expect(target.weight).toBe(1);
    expect(attacker.x).toBeLessThan(10);
  });

  test('keeps every soldier focused on the enemy selected by its squad', () => {
    const attacker = buildCombatSquad({
      id: 'cohesive-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 }
    });
    const selectedDefender = buildCombatSquad({
      id: 'selected-defender',
      team: 'defender',
      x: 4,
      units: { test_melee: 2 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const unrelatedDefender = buildCombatSquad({
      id: 'unrelated-defender',
      team: 'defender',
      x: 2,
      units: { test_melee: 2 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    unrelatedDefender.y = 8;
    unrelatedDefender.spawnLaneId = 'top';
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 140 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [
          { id: 'mid', width: 4, centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
          { id: 'top', width: 4, centerline: [{ x: -100, y: 8 }, { x: 100, y: 8 }] }
        ]
      },
      squads: [attacker, selectedDefender, unrelatedDefender]
    };
    const crowd = buildCrowd(sim);
    const soldier = getCrowdAgentsForSquad(crowd, attacker.id)
      .find((agent) => !agent.isFlagBearer);
    const selectedTargets = getCrowdAgentsForSquad(crowd, selectedDefender.id);
    const selectedTarget = selectedTargets.find((agent) => !agent.isFlagBearer);
    const unrelatedTarget = getCrowdAgentsForSquad(crowd, unrelatedDefender.id)
      .find((agent) => !agent.isFlagBearer);
    soldier.y = 7;
    selectedTarget.x = 4;
    selectedTarget.y = 0;
    unrelatedTarget.x = 2;
    unrelatedTarget.y = 8;

    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.targetSquadId).toBe(selectedDefender.id);
    expect(selectedTargets.some((target) => target.id === soldier.targetAgentId)).toBe(true);
    expect(unrelatedTarget.weight).toBe(1);
  });

  test('stops ordinary infantry immediately once its target is in attack range', () => {
    const attacker = buildCombatSquad({
      id: 'stationary-infantry-attacker',
      team: 'attacker',
      x: -3,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'stationary-infantry-defender',
      team: 'defender',
      x: 3,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    attacker.targetSquadId = defender.id;
    attacker.order.targetSquadId = defender.id;
    defender.targetSquadId = attacker.id;
    defender.order.targetSquadId = attacker.id;
    defender.minionPath = [{ x: 100, y: 0 }, { x: -100, y: 0 }];
    const sim = {
      timeElapsed: 0,
      field: { width: 240, height: 140 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{ id: 'mid', width: 80, centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }]
      },
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    const attackerAgent = getCrowdAgentsForSquad(crowd, attacker.id)[0];
    const defenderAgent = getCrowdAgentsForSquad(crowd, defender.id)[0];
    attackerAgent.vx = 24;
    defenderAgent.vx = -24;
    const attackerStart = { x: attackerAgent.x, y: attackerAgent.y };
    const defenderStart = { x: defenderAgent.x, y: defenderAgent.y };

    updateCrowdSim(crowd, sim, 0.05);

    expect(attackerAgent.typeCategory).toBe('infantry');
    expect(defenderAgent.typeCategory).toBe('infantry');
    expect(attackerAgent.targetAgentId).toBe(defenderAgent.id);
    expect(defenderAgent.targetAgentId).toBe(attackerAgent.id);
    expect(Math.hypot(attackerAgent.x - attackerStart.x, attackerAgent.y - attackerStart.y)).toBeLessThan(0.05);
    expect(Math.hypot(defenderAgent.x - defenderStart.x, defenderAgent.y - defenderStart.y)).toBeLessThan(0.05);
    expect(Math.hypot(attackerAgent.vx, attackerAgent.vy)).toBeLessThan(0.05);
    expect(Math.hypot(defenderAgent.vx, defenderAgent.vy)).toBeLessThan(0.05);
  });

  test('keeps cavalry free to close distance during melee combat', () => {
    const attacker = buildCombatSquad({
      id: 'moving-cavalry-attacker',
      team: 'attacker',
      x: -10,
      units: { test_fast: 1 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'moving-cavalry-defender',
      team: 'defender',
      x: 10,
      units: { test_fast: 1 },
      isMinionWaveUnit: true
    });
    attacker.targetSquadId = defender.id;
    attacker.order.targetSquadId = defender.id;
    defender.targetSquadId = attacker.id;
    defender.order.targetSquadId = attacker.id;
    defender.minionPath = [{ x: 100, y: 0 }, { x: -100, y: 0 }];
    const sim = {
      timeElapsed: 0,
      field: { width: 240, height: 140 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{ id: 'mid', width: 80, centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }]
      },
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    const attackerAgent = getCrowdAgentsForSquad(crowd, attacker.id)[0];
    const defenderAgent = getCrowdAgentsForSquad(crowd, defender.id)[0];
    const initialDistance = Math.abs(defenderAgent.x - attackerAgent.x);

    updateCrowdSim(crowd, sim, 0.05);

    expect(attackerAgent.typeCategory).toBe('cavalry');
    expect(defenderAgent.typeCategory).toBe('cavalry');
    expect(Math.abs(defenderAgent.x - attackerAgent.x)).toBeLessThan(initialDistance);
  });

  test('holds a squad engagement target while a more attractive enemy appears', () => {
    const attacker = buildCombatSquad({
      id: 'locked-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 2 }
    });
    const committed = buildCombatSquad({
      id: 'committed-defender',
      team: 'defender',
      x: 8,
      units: { test_melee: 2 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const challenger = buildCombatSquad({
      id: 'challenger-defender',
      team: 'defender',
      x: 24,
      units: { test_melee: 2 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const sim = {
      timeElapsed: 0,
      field: { width: 240, height: 140 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{ id: 'mid', width: 80, centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }] }]
      },
      squads: [attacker, committed, challenger]
    };
    const crowd = buildCrowd(sim);

    updateCrowdSim(crowd, sim, 0.05);
    expect(attacker.targetSquadId).toBe(committed.id);

    challenger.x = 1;
    challenger.stats.atk = 999;
    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.targetSquadId).toBe(committed.id);
    expect(attacker._combatEngagementTargetId).toBe(committed.id);
  });

  test('uses the surviving troop mix weighted average for march speed', () => {
    const squad = buildCombatSquad({
      id: 'weighted-speed',
      team: 'attacker',
      x: 0,
      units: { test_slow: 3, test_fast: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    squad.remainUnits = { test_slow: 1, test_fast: 1 };
    const sim = {
      timeElapsed: 0,
      field: { width: 300, height: 160 },
      buildings: [],
      trainingObjectives: [],
      squads: [squad]
    };
    const crowd = buildCrowd(sim);

    updateCrowdSim(crowd, sim, 0.05);

    expect(squad._groupSpeedScalar).toBeCloseTo((1 * 0.5) + (3 * 0.5), 6);
  });

  test('makes a detached soldier physically rejoin after combat instead of snapping to its slot', () => {
    const squad = buildCombatSquad({
      id: 'physical-rejoin',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      controlMode: 'USER',
      behavior: 'move'
    });
    squad.stamina = 100;
    squad.order = { type: 'MOVE', targetPoint: { x: 100, y: 0 } };
    squad.waypoints = [{ x: 100, y: 0 }];
    const sim = {
      timeElapsed: 0,
      field: { width: 300, height: 180 },
      buildings: [],
      trainingObjectives: [],
      squads: [squad]
    };
    const crowd = buildCrowd(sim);
    const returningAgent = getCrowdAgentsForSquad(crowd, squad.id)
      .find((agent) => !agent.isFlagBearer);
    const targetSlot = {
      x: squad.x + (Number(returningAgent.formationSlot?.front) || 0),
      y: squad.y + (Number(returningAgent.formationSlot?.side) || 0)
    };
    returningAgent.x = targetSlot.x - 60;
    returningAgent.y = targetSlot.y;
    returningAgent.vx = 0;
    returningAgent.vy = 0;
    returningAgent._formationLocked = false;
    const before = { x: returningAgent.x, y: returningAgent.y };

    updateCrowdSim(crowd, sim, 0.05);

    const firstStep = Math.hypot(returningAgent.x - before.x, returningAgent.y - before.y);
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(2);
    expect(returningAgent._formationLocked).toBe(false);

    for (let index = 0; index < 360; index += 1) updateCrowdSim(crowd, sim, 0.05);

    const finalTargetSlot = {
      x: squad.x + (Number(returningAgent.formationSlot?.front) || 0),
      y: squad.y + (Number(returningAgent.formationSlot?.side) || 0)
    };
    expect(Math.hypot(returningAgent.x - finalTargetSlot.x, returningAgent.y - finalTargetSlot.y)).toBeLessThan(1.2);
    expect(returningAgent._formationLocked).toBe(true);
  });

  test('critically damps repeated formation recovery without wave-like overshoot', () => {
    const squad = buildCombatSquad({
      id: 'damped-recovery',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      controlMode: 'USER',
      behavior: 'move'
    });
    squad.formationRect = {
      width: 18,
      depth: 18,
      spacing: 6,
      facingRad: 0,
      directionOffsetRad: 0
    };
    squad.deploySlots = [
      { side: 0, front: 6 },
      { side: -6, front: 0 },
      { side: 6, front: 0 }
    ];
    squad.order = { type: 'MOVE', targetPoint: { x: 500, y: 0 } };
    squad.waypoints = [{ x: 500, y: 0 }];
    const sim = {
      timeElapsed: 0,
      field: { width: 1200, height: 240 },
      buildings: [],
      trainingObjectives: [],
      squads: [squad]
    };
    const crowd = buildCrowd(sim);
    const recoveringAgent = getCrowdAgentsForSquad(crowd, squad.id)
      .find((agent) => !agent.isFlagBearer);

    const runRecovery = ({ offsetY, velocityY }) => {
      const targetY = squad.y + (Number(recoveringAgent.formationSlot?.side) || 0);
      recoveringAgent.x = squad.x + (Number(recoveringAgent.formationSlot?.front) || 0);
      recoveringAgent.y = targetY + offsetY;
      recoveringAgent.vx = Number(squad.vx) || 0;
      recoveringAgent.vy = velocityY;
      recoveringAgent._formationLocked = false;
      let previousSign = Math.sign(offsetY);
      let signChanges = 0;
      let maximumLateError = 0;
      for (let index = 0; index < 160; index += 1) {
        updateCrowdSim(crowd, sim, 0.05);
        const currentTargetY = squad.y + (Number(recoveringAgent.formationSlot?.side) || 0);
        const error = recoveringAgent.y - currentTargetY;
        if (Math.abs(error) > 0.8) {
          const sign = Math.sign(error);
          if (sign !== previousSign) signChanges += 1;
          previousSign = sign;
        }
        if (index >= 100) maximumLateError = Math.max(maximumLateError, Math.abs(error));
      }
      return { signChanges, maximumLateError };
    };

    const firstRecovery = runRecovery({ offsetY: 42, velocityY: -58 });
    const secondRecovery = runRecovery({ offsetY: -36, velocityY: 52 });

    expect(firstRecovery.signChanges).toBeLessThanOrEqual(1);
    expect(secondRecovery.signChanges).toBeLessThanOrEqual(1);
    expect(firstRecovery.maximumLateError).toBeLessThan(1.5);
    expect(secondRecovery.maximumLateError).toBeLessThan(1.5);
    expect(recoveringAgent._formationLocked).toBe(true);
  });

  test('keeps fixed-lane minions out of walls and flows around the nearer edge', () => {
    const minions = buildCombatSquad({
      id: 'wall-flow-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.y = 3;
    minions.speed = 30;
    minions.minionPathSpeed = 30;
    minions.minionPath = [{ x: 0, y: 3 }, { x: 80, y: 3 }, { x: 120, y: 3 }];
    minions.minionPathIndex = 1;
    const wall = {
      id: 'short-wall',
      x: 20,
      y: 0,
      width: 8,
      depth: 18,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 120 },
      buildings: [wall],
      trainingObjectives: [],
      squads: [minions]
    };
    const crowd = buildCrowd(sim);
    let maximumY = minions.y;
    let minimumY = minions.y;
    let crossedWall = false;

    for (let index = 0; index < 60; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      maximumY = Math.max(maximumY, minions.y);
      minimumY = Math.min(minimumY, minions.y);
      expect(isInsideCollider(minions, wall, 2.25)).toBe(false);
      getCrowdAgentsForSquad(crowd, minions.id).forEach((agent) => {
        expect(isInsideCollider(agent, wall, Number(agent.radius) || 0)).toBe(false);
      });
      if (minions.x > wall.x + (wall.width * 0.5) + 3) {
        crossedWall = true;
        break;
      }
    }

    expect(crossedWall).toBe(true);
    expect(maximumY).toBeGreaterThan(12);
    expect(minimumY).toBeGreaterThan(-6);
  });

  test('detours the whole minion formation around a side-slot obstacle', () => {
    const minions = buildCombatSquad({
      id: 'cohesive-wall-recovery-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.minionPathSpeed = 42;
    minions.minionPath = [{ x: 0, y: 0 }, { x: 150, y: 0 }];
    minions.minionPathIndex = 1;
    minions.minionPathCorridorWidth = 104;
    minions.formationRect = {
      width: 36,
      depth: 18,
      spacing: 18,
      facingRad: 0,
      directionOffsetRad: 0,
      slotCount: 3
    };
    minions.deploySlots = [
      { side: -18, front: 0, row: 0, col: 0 },
      { side: 0, front: 0, row: 0, col: 1 },
      { side: 18, front: 0, row: 0, col: 2 }
    ];
    const wall = {
      id: 'side-slot-wall',
      x: 38,
      y: 22,
      width: 30,
      depth: 24,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const trainingMap = {
      lanes: [{
        id: 'mid',
        width: 104,
        centerline: [{ x: -20, y: 0 }, { x: 170, y: 0 }]
      }],
      navigation: {
        agentRadius: 2.25,
        pathClearance: 1.2,
        aiNavigationPlansPerStep: 2,
        maxSearchNodes: 1800
      }
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 360, height: 180 },
      buildings: [wall],
      trainingObjectives: [],
      trainingMap,
      trainingNavigator: createTrainingMapNavigator({
        field: { width: 360, height: 180 },
        mapConfig: trainingMap
      }),
      squads: [minions]
    };
    const crowd = buildCrowd(sim);
    const blockedAgent = getCrowdAgentsForSquad(crowd, minions.id)
      .find((agent) => Number(agent?.formationSlot?.side) > 10);
    let waitedForStraggler = false;
    let usedFormationDetour = false;
    let leaderEscapedBeforeStraggler = false;
    let maximumSeparation = 0;

    for (let index = 0; index < 320; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      const separation = Math.hypot(blockedAgent.x - minions.x, blockedAgent.y - minions.y);
      maximumSeparation = Math.max(maximumSeparation, separation);
      waitedForStraggler = waitedForStraggler
        || minions.minionCohesionState === 'WAITING';
      usedFormationDetour = usedFormationDetour || Math.abs(Number(minions.y) || 0) > 8;
      leaderEscapedBeforeStraggler = leaderEscapedBeforeStraggler
        || (minions.x > 100 && blockedAgent.x < wall.x + (wall.width * 0.5));
      expect(isInsideCollider(blockedAgent, wall, Number(blockedAgent.radius) || 0)).toBe(false);
      if (minions.x > 135 && blockedAgent.x > 125) break;
    }

    expect(waitedForStraggler || usedFormationDetour).toBe(true);
    expect(leaderEscapedBeforeStraggler).toBe(false);
    expect(maximumSeparation).toBeLessThan(72);
    expect(minions.x).toBeGreaterThan(135);
    expect(blockedAgent.x).toBeGreaterThan(125);
  });

  test('lets a stranded minion route around a roadside tower and rejoin the moving formation', () => {
    const minions = buildCombatSquad({
      id: 'roadside-tower-recovery-minions',
      team: 'attacker',
      x: 45,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.minionPathSpeed = 42;
    minions.minionPath = [{ x: 45, y: 0 }, { x: 180, y: 0 }];
    minions.minionPathIndex = 1;
    minions.minionPathCorridorWidth = 80;
    minions.formationRect = {
      width: 36,
      depth: 18,
      spacing: 18,
      facingRad: 0,
      directionOffsetRad: 0,
      slotCount: 3
    };
    minions.deploySlots = [
      { side: -18, front: 0, row: 0, col: 0 },
      { side: 0, front: 0, row: 0, col: 1 },
      { side: 18, front: 0, row: 0, col: 2 }
    ];
    const tower = {
      id: 'roadside-round-tower',
      x: 30,
      y: 18,
      width: 20,
      depth: 20,
      height: 60,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false,
      collider: { kind: 'circle', cx: 0, cy: 0, r: 10, h: 60 }
    };
    const trainingMap = {
      lanes: [{
        id: 'mid',
        width: 80,
        centerline: [{ x: -20, y: 0 }, { x: 190, y: 0 }]
      }],
      navigation: {
        agentRadius: 2.25,
        pathClearance: 1.2,
        aiNavigationPlansPerStep: 1,
        minionRecoveryPlansPerStep: 3,
        maxSearchNodes: 1800
      }
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 420, height: 180 },
      buildings: [tower],
      trainingObjectives: [],
      trainingMap,
      trainingNavigator: createTrainingMapNavigator({
        field: { width: 420, height: 180 },
        mapConfig: trainingMap
      }),
      squads: [minions]
    };
    const crowd = buildCrowd(sim);
    const straggler = getCrowdAgentsForSquad(crowd, minions.id)
      .find((agent) => Number(agent?.formationSlot?.side) > 10);
    straggler.x = 8;
    straggler.y = 18;
    straggler.vx = 0;
    straggler.vy = 0;
    straggler._formationLocked = false;
    const initialAnchorX = minions.x;
    let sawRecovery = false;
    let sawMovingRecovery = false;
    let maximumCenterOffset = 0;

    for (let index = 0; index < 360; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      sawRecovery = sawRecovery || ['ROUTING', 'ESCAPING'].includes(straggler.minionRecoveryState);
      sawMovingRecovery = sawMovingRecovery || (
        minions.minionCohesionState === 'RECOVERING'
        && minions.x > initialAnchorX + 0.5
      );
      maximumCenterOffset = Math.max(maximumCenterOffset, Math.abs(Number(minions.y) || 0));
      getCrowdAgentsForSquad(crowd, minions.id).forEach((agent) => {
        expect(isInsideCollider(agent, tower, Number(agent.radius) || 0)).toBe(false);
      });
      if (minions.x > 165 && straggler.x > 150 && straggler.minionRecoveryState === 'NONE') break;
    }

    expect(sawRecovery).toBe(true);
    expect(sawMovingRecovery).toBe(true);
    expect(maximumCenterOffset).toBeLessThan(6);
    expect(minions.x).toBeGreaterThan(165);
    expect(straggler.x).toBeGreaterThan(150);
    expect(straggler.minionRecoveryState).toBe('NONE');
    expect(minions.minionCohesionState).toBe('COHESIVE');
  });

  test('slows the minion anchor for a delayed straggler and resumes after rejoining', () => {
    const minions = buildCombatSquad({
      id: 'delayed-straggler-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.minionPathSpeed = 42;
    minions.minionPath = [{ x: 0, y: 0 }, { x: 160, y: 0 }];
    minions.minionPathIndex = 1;
    minions.formationRect = {
      width: 18,
      depth: 18,
      spacing: 9,
      facingRad: 0,
      directionOffsetRad: 0,
      slotCount: 3
    };
    minions.deploySlots = [
      { side: -9, front: 0, row: 0, col: 0 },
      { side: 0, front: 0, row: 0, col: 1 },
      { side: 9, front: 0, row: 0, col: 2 }
    ];
    const sim = {
      timeElapsed: 0,
      field: { width: 380, height: 160 },
      buildings: [],
      trainingObjectives: [],
      squads: [minions]
    };
    const crowd = buildCrowd(sim);
    const straggler = getCrowdAgentsForSquad(crowd, minions.id)
      .find((agent) => Number(agent?.formationSlot?.side) > 0);
    straggler.x = -70;
    straggler.vx = 0;
    straggler.vy = 0;
    straggler._formationLocked = false;
    let sawSlowing = false;
    let movedWhileSlowing = false;
    let minimumMovingScale = 1;

    for (let index = 0; index < 360; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      if (minions.minionCohesionState === 'SLOWING' || minions.minionCohesionState === 'RECOVERING') {
        sawSlowing = true;
        movedWhileSlowing = movedWhileSlowing || (minions.x > 0.1 && minions.speed > 0);
        minimumMovingScale = Math.min(
          minimumMovingScale,
          Number(minions?._minionCohesion?.speedScale) || 0
        );
      }
      if (sawSlowing && minions.x > 140 && straggler.x > 130) break;
    }

    expect(sawSlowing).toBe(true);
    expect(movedWhileSlowing).toBe(true);
    expect(minimumMovingScale).toBeGreaterThan(0);
    expect(minimumMovingScale).toBeLessThan(1);
    expect(minions.x).toBeGreaterThan(140);
    expect(straggler.x).toBeGreaterThan(130);
    expect(minions.minionCohesionState).toBe('COHESIVE');
  });

  test('keeps a planned minion detour until the blocked path segment is cleared', () => {
    const minions = buildCombatSquad({
      id: 'planned-detour-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.minionPathSpeed = 30;
    minions.minionPath = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 0 }];
    minions.minionPathIndex = 1;
    const wall = {
      id: 'long-wall',
      x: 20,
      y: 0,
      width: 8,
      depth: 60,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const planRoute = jest.fn((_start, target) => [
      { x: 0, y: 36 },
      { x: 44, y: 36 },
      { x: Number(target.x) || 0, y: Number(target.y) || 0 }
    ]);
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 140 },
      buildings: [wall],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{
          id: 'mid',
          width: 96,
          centerline: [{ x: -100, y: 0 }, { x: 120, y: 0 }]
        }],
        navigation: {
          agentRadius: 2.25,
          pathClearance: 1.2,
          aiNavigationPlansPerStep: 1
        }
      },
      trainingNavigator: { planRoute },
      squads: [minions]
    };
    const crowd = buildCrowd(sim);

    updateCrowdSim(crowd, sim, 0.05);

    expect(planRoute).toHaveBeenCalledTimes(1);
    expect(minions.waypoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 36 }),
      expect.objectContaining({ x: 44, y: 36 }),
      expect.objectContaining({ x: 80, y: 0 })
    ]));
    const plannedWaypoints = minions.waypoints.map((point) => ({ ...point }));

    updateCrowdSim(crowd, sim, 0.05);

    expect(planRoute).toHaveBeenCalledTimes(1);
    expect(minions.waypoints).toEqual(plannedWaypoints);
  });

  test('rejects a fixed-lane detour that leaves the road corridor', () => {
    const minions = buildCombatSquad({
      id: 'road-bound-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.minionPathSpeed = 30;
    minions.minionPath = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 0 }];
    minions.minionPathIndex = 1;
    const wall = {
      id: 'road-wall',
      x: 20,
      y: 0,
      width: 8,
      depth: 60,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const planRoute = jest.fn((_start, target) => [
      { x: 0, y: 72 },
      { x: 44, y: 72 },
      { x: Number(target.x) || 0, y: Number(target.y) || 0 }
    ]);
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 180 },
      buildings: [wall],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{
          id: 'mid',
          width: 96,
          centerline: [{ x: -100, y: 0 }, { x: 120, y: 0 }]
        }],
        navigation: {
          agentRadius: 2.25,
          pathClearance: 1.2,
          aiNavigationPlansPerStep: 1
        }
      },
      trainingNavigator: { planRoute },
      squads: [minions]
    };
    const crowd = buildCrowd(sim);

    updateCrowdSim(crowd, sim, 0.05);

    expect(planRoute).toHaveBeenCalledTimes(1);
    expect(minions.waypoints.length).toBeGreaterThan(0);
    expect(minions.waypoints.every((point) => Math.abs(Number(point?.y) || 0) <= 48)).toBe(true);
    expect(minions.waypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ y: 72 })
    ]));
  });

  test('hard-clamps every minion soldier to the visible road corridor', () => {
    const minions = buildCombatSquad({
      id: 'visible-road-bound-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    minions.y = 70;
    minions.minionPathSpeed = 30;
    minions.minionPath = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
    minions.minionPathIndex = 1;
    minions.minionPathCorridorWidth = 40;
    const sim = {
      timeElapsed: 0,
      field: { width: 240, height: 200 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{
          id: 'mid',
          width: 180,
          centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }]
        }]
      },
      squads: [minions]
    };
    const crowd = buildCrowd(sim);
    getCrowdAgentsForSquad(crowd, minions.id).forEach((agent, index) => {
      agent.y = 62 + (index * 4);
      agent.vy = 18;
    });

    updateCrowdSim(crowd, sim, 0.05);

    expect(minions._trainingRoadCorridorEntered).toBe(true);
    expect(Math.abs(Number(minions.y) || 0)).toBeLessThanOrEqual(20);
    expect(getCrowdAgentsForSquad(crowd, minions.id).every((agent) => (
      Math.abs(Number(agent?.y) || 0) <= 20
    ))).toBe(true);
  });

  test('brings opposing minion formations into real soldier combat before holding their anchors', () => {
    const attacker = buildCombatSquad({
      id: 'combat-lock-attacker',
      team: 'attacker',
      x: -120,
      units: {
        test_melee: 24,
        test_ranged: 24,
        test_support_comprehensive: 24
      },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'combat-lock-defender',
      team: 'defender',
      x: 120,
      units: {
        test_melee: 24,
        test_ranged: 24,
        test_support_comprehensive: 24
      },
      isMinionWaveUnit: true
    });
    attacker.minionPathSpeed = 30;
    attacker.minionPath = [{ x: -300, y: 0 }, { x: 300, y: 0 }];
    defender.minionPathSpeed = 30;
    defender.minionPath = [{ x: 300, y: 0 }, { x: -300, y: 0 }];
    const deploySlots = Array.from({ length: 9 }, (_, index) => ({
      side: ((index % 3) - 1) * 18,
      front: -Math.floor(index / 3) * 18,
      row: Math.floor(index / 3),
      col: index % 3
    }));
    attacker.formationRect = { width: 54, depth: 54, spacing: 18, facingRad: 0, slotCount: 9 };
    defender.formationRect = { width: 54, depth: 54, spacing: 18, facingRad: Math.PI, slotCount: 9 };
    attacker.deploySlots = deploySlots.map((slot) => ({ ...slot }));
    defender.deploySlots = deploySlots.map((slot) => ({ ...slot }));
    const tower = {
      id: 'combat-lock-tower',
      team: 'defender',
      x: 280,
      y: 0,
      width: 20,
      depth: 20,
      hp: 300,
      maxHp: 300,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 800, height: 200 },
      buildings: [tower],
      trainingObjectives: createTrainingObjectives([{
        objectiveId: tower.id,
        sourceObjectId: tower.id,
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: tower.maxHp,
        attackEnabled: false
      }]),
      squads: [attacker, defender]
    };
    const crowd = createCrowdSim(sim, {
      unitTypeMap,
      repConfig: { maxAgentWeight: 8, strictAgentMapping: true }
    });
    const attackerAgents = getCrowdAgentsForSquad(crowd, attacker.id);
    const defenderAgents = getCrowdAgentsForSquad(crowd, defender.id);
    const initialCenterDistance = Math.abs(defender.x - attacker.x);
    const initialHpWeight = attackerAgents
      .concat(defenderAgents)
      .reduce((sum, agent) => sum + (Number(agent?.hpWeight) || 0), 0);
    let sawIndividualTarget = false;
    let sawDamage = false;
    let sawAttackHold = false;

    for (let index = 0; index < 3; index += 1) updateCrowdSim(crowd, sim, 0.05);

    expect(attackerAgents.concat(defenderAgents).some((agent) => !!agent?.targetAgentId)).toBe(false);
    expect(attacker.waypoints.length).toBeGreaterThan(0);
    expect(defender.waypoints.length).toBeGreaterThan(0);

    for (let index = 0; index < 240; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
      const agents = getCrowdAgentsForSquad(crowd, attacker.id)
        .concat(getCrowdAgentsForSquad(crowd, defender.id));
      sawIndividualTarget = sawIndividualTarget || agents.some((agent) => !!agent?.targetAgentId);
      const currentHpWeight = agents.reduce((sum, agent) => sum + (Number(agent?.hpWeight) || 0), 0);
      sawDamage = sawDamage || currentHpWeight < initialHpWeight;
      sawAttackHold = attacker.minionAiState === 'ATTACK_HOLD'
        && defender.minionAiState === 'ATTACK_HOLD';
      if (sawIndividualTarget && sawDamage && sawAttackHold) break;
    }

    expect(attacker.targetSquadId).toBe(defender.id);
    expect(defender.targetSquadId).toBe(attacker.id);
    expect(Math.abs(defender.x - attacker.x)).toBeLessThan(initialCenterDistance);
    expect(sawIndividualTarget).toBe(true);
    expect(sawDamage).toBe(true);
    expect(sawAttackHold).toBe(true);
    expect(attacker.waypoints).toEqual([]);
    expect(defender.waypoints).toEqual([]);
    expect(attacker.action).toBe('兵线交战');
    expect(defender.action).toBe('兵线交战');
    expect(Math.abs(Number(attacker.speed) || 0)).toBeLessThan(1);
    expect(Math.abs(Number(defender.speed) || 0)).toBeLessThan(1);
    expect(attacker.x).toBeLessThan(defender.x);
  });

  test('continues advancing after the engaged minion squad is eliminated', () => {
    const attacker = buildCombatSquad({
      id: 'resume-after-combat-attacker',
      team: 'attacker',
      x: -48,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'resume-after-combat-defender',
      team: 'defender',
      x: 48,
      units: { test_melee: 3 },
      isMinionWaveUnit: true
    });
    attacker.minionPath = [{ x: -180, y: 0 }, { x: 180, y: 0 }];
    defender.minionPath = [{ x: 180, y: 0 }, { x: -180, y: 0 }];
    attacker.minionPathSpeed = 80;
    defender.minionPathSpeed = 80;
    const sim = {
      timeElapsed: 0,
      field: { width: 420, height: 160 },
      buildings: [],
      trainingObjectives: [],
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    updateCrowdSim(crowd, sim, 0.05);
    [attacker, defender].forEach((squad) => {
      squad.x = squad._minionAi.holdAnchor.x;
      squad.y = squad._minionAi.holdAnchor.y;
      getCrowdAgentsForSquad(crowd, squad.id).forEach((agent) => {
        agent.x = agent._minionAi.combatX;
        agent.y = agent._minionAi.combatY;
        agent.vx = 0;
        agent.vy = 0;
      });
    });
    updateCrowdSim(crowd, sim, 0.05);
    expect(attacker.minionAiState).toBe('ATTACK_HOLD');
    const heldX = attacker.x;
    const defenderAgents = getCrowdAgentsForSquad(crowd, defender.id);
    defenderAgents.forEach((agent) => {
      agent.dead = true;
      agent.weight = 0;
      agent.hpWeight = 0;
    });
    defender.remain = 0;
    defender.health = 0;

    for (let index = 0; index < 8; index += 1) updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.targetSquadId).toBe('');
    expect(attacker.minionAiState).toBe('MARCH');
    expect(attacker.x).toBeGreaterThan(heldX + 4);
    expect(attacker.action).toBe('兵线推进');
    expect(attacker.waypoints.length).toBeGreaterThan(0);
  });

  test('interrupts a tower march when front-line soldiers meet first', () => {
    const attacker = buildCombatSquad({
      id: 'local-priority-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'local-priority-defender',
      team: 'defender',
      x: 30,
      units: { test_melee: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const tower = {
      id: 'local-priority-tower',
      team: 'defender',
      x: 20,
      y: 0,
      width: 20,
      depth: 20,
      hp: 200,
      maxHp: 200,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 260, height: 160 },
      buildings: [tower],
      trainingObjectives: createTrainingObjectives([{
        objectiveId: tower.id,
        sourceObjectId: tower.id,
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: tower.maxHp,
        attackEnabled: false
      }]),
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    const attackerAgent = getCrowdAgentsForSquad(crowd, attacker.id)[0];
    const defenderAgent = getCrowdAgentsForSquad(crowd, defender.id)[0];
    attackerAgent.x = 4;
    attackerAgent.y = 0;
    defenderAgent.x = 8;
    defenderAgent.y = 0;

    updateCrowdSim(crowd, sim, 0.05);

    expect(attackerAgent.targetAgentId).toBe(defenderAgent.id);
    expect(attackerAgent.targetBuildingId).toBe('');

    for (let index = 0; index < 80 && attacker.minionAiState !== 'ATTACK_HOLD'; index += 1) {
      updateCrowdSim(crowd, sim, 0.05);
    }

    expect(attacker.targetSquadId).toBe(defender.id);
    expect(attacker.minionAiState).toBe('ATTACK_HOLD');
    expect(attacker.waypoints).toEqual([]);
    expect(attacker.action).toBe('兵线交战');
    expect(Math.abs(Number(attacker.speed) || 0)).toBeLessThan(1);
  });

  test('does not let an alerted neutral squad acquire a nearby tower', () => {
    const neutral = buildCombatSquad({
      id: 'neutral-near-tower',
      team: 'neutral',
      x: 0,
      units: { test_melee: 1 }
    });
    neutral.underAttackTimer = 1;
    neutral.lastDamagedBySquadId = 'missing-enemy';
    const tower = {
      id: 'neutral-passive-tower',
      team: 'defender',
      x: 24,
      y: 0,
      width: 20,
      depth: 20,
      hp: 200,
      maxHp: 200,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 260, height: 160 },
      buildings: [tower],
      trainingObjectives: createTrainingObjectives([{
        objectiveId: tower.id,
        sourceObjectId: tower.id,
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: tower.maxHp,
        attackEnabled: false
      }]),
      squads: [neutral]
    };
    const crowd = buildCrowd(sim);
    const neutralAgent = getCrowdAgentsForSquad(crowd, neutral.id)[0];

    updateCrowdSim(crowd, sim, 0.05);

    expect(neutralAgent.targetBuildingId).toBe('');
    expect(neutralAgent.targetAgentId).toBe('');
  });

  test('retaliates against a neutral road aggressor without chasing one off road', () => {
    const minions = buildCombatSquad({
      id: 'neutral-road-minions',
      team: 'attacker',
      x: 0,
      units: { test_melee: 2 },
      isMinionWaveUnit: true
    });
    const buildNeutralAggressor = (id, x, y) => {
      const neutral = buildCombatSquad({
        id,
        team: 'neutral',
        x,
        units: { test_melee: 2 },
        controlMode: 'AI',
        behavior: 'guard'
      });
      neutral.y = y;
      neutral.spawnLaneId = '';
      neutral.minionLaneId = '';
      neutral.order = { type: 'IDLE', targetSquadId: '' };
      neutral.targetSquadId = minions.id;
      neutral._combatEngagementTargetId = minions.id;
      neutral._combatEngagementUntil = 5;
      neutral.underAttackTimer = 1;
      neutral.lastDamagedBySquadId = minions.id;
      neutral.guard = {
        enabled: true,
        cx: x,
        cy: y,
        radius: 80,
        returnRadius: 20,
        chaseRadius: 120,
        activeTargetId: minions.id
      };
      return neutral;
    };
    const roadNeutral = buildNeutralAggressor('road-neutral', 8, 0);
    const offRoadNeutral = buildNeutralAggressor('off-road-neutral', 3, 90);
    const sim = {
      timeElapsed: 0,
      field: { width: 260, height: 220 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [{ id: 'mid', width: 40, centerline: [{ x: -120, y: 0 }, { x: 120, y: 0 }] }]
      },
      squads: [minions, roadNeutral, offRoadNeutral]
    };
    const crowd = buildCrowd(sim);

    updateCrowdSim(crowd, sim, 0.05);

    expect(minions.targetSquadId).toBe(roadNeutral.id);
    const roadAgentIds = new Set(getCrowdAgentsForSquad(crowd, roadNeutral.id).map((agent) => agent.id));
    expect(getCrowdAgentsForSquad(crowd, minions.id).some((agent) => (
      roadAgentIds.has(agent.targetAgentId)
    ))).toBe(true);
    const offRoadAgentIds = new Set(getCrowdAgentsForSquad(crowd, offRoadNeutral.id).map((agent) => agent.id));
    expect(getCrowdAgentsForSquad(crowd, minions.id).some((agent) => (
      offRoadAgentIds.has(agent.targetAgentId)
    ))).toBe(false);
  });

  const buildPriorityScenario = ({ enemyX, towerX }) => {
    const attacker = buildCombatSquad({
      id: 'priority-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'priority-defender',
      team: 'defender',
      x: enemyX,
      units: { test_melee: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const tower = {
      id: 'priority-tower',
      team: 'defender',
      x: towerX,
      y: 0,
      width: 20,
      depth: 20,
      height: 40,
      hp: 200,
      maxHp: 200,
      defense: 1,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 260, height: 160 },
      buildings: [tower],
      trainingObjectives: createTrainingObjectives([{
        objectiveId: tower.id,
        sourceObjectId: tower.id,
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: tower.maxHp,
        attackEnabled: false
      }]),
      squads: [attacker, defender]
    };
    const crowd = buildCrowd(sim);
    return {
      attacker,
      defender,
      tower,
      sim,
      crowd,
      attackerAgent: getCrowdAgentsForSquad(crowd, attacker.id)[0],
      defenderAgent: getCrowdAgentsForSquad(crowd, defender.id)[0]
    };
  };

  test('stops for a clearly nearer tower instead of chasing soldiers behind it', () => {
    const scenario = buildPriorityScenario({ enemyX: 72, towerX: 32 });

    updateCrowdSim(scenario.crowd, scenario.sim, 0.05);

    expect(scenario.attackerAgent.targetBuildingId).toBe(scenario.tower.id);
    expect(scenario.attackerAgent.targetAgentId).toBe('');
    for (let index = 0; index < 30 && scenario.tower.hp >= scenario.tower.maxHp; index += 1) {
      updateCrowdSim(scenario.crowd, scenario.sim, 0.05);
    }
    expect(scenario.tower.hp).toBeLessThan(scenario.tower.maxHp);
  });

  test('attacks a nearer soldier and uses soldier priority only inside the distance tie band', () => {
    const nearerSoldier = buildPriorityScenario({ enemyX: 9, towerX: 40 });
    updateCrowdSim(nearerSoldier.crowd, nearerSoldier.sim, 0.05);
    expect(nearerSoldier.attackerAgent.targetAgentId).toBe(nearerSoldier.defenderAgent.id);
    expect(nearerSoldier.attackerAgent.targetBuildingId).toBe('');

    const tiedTargets = buildPriorityScenario({ enemyX: 20, towerX: 25 });
    updateCrowdSim(tiedTargets.crowd, tiedTargets.sim, 0.05);
    expect(tiedTargets.attackerAgent.targetAgentId).toBe(tiedTargets.defenderAgent.id);
    expect(tiedTargets.attackerAgent.targetBuildingId).toBe('');
  });

  test('lets comprehensive supports buff only their own fighting squad', () => {
    const attacker = buildCombatSquad({
      id: 'support-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 1, test_support_comprehensive: 1 },
      isMinionWaveUnit: true
    });
    const defender = buildCombatSquad({
      id: 'support-defender',
      team: 'defender',
      x: 5,
      units: { test_melee: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const otherAlly = buildCombatSquad({
      id: 'support-other-ally',
      team: 'attacker',
      x: -18,
      units: { test_melee: 1 },
      isMinionWaveUnit: true
    });
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 140 },
      buildings: [],
      trainingObjectives: [],
      squads: [attacker, otherAlly, defender]
    };
    const crowd = buildCrowd(sim);
    const agents = getCrowdAgentsForSquad(crowd, attacker.id);
    const melee = agents.find((agent) => agent.unitCategory === 'melee');
    const support = agents.find((agent) => agent.unitCategory === 'support');
    const [target] = getCrowdAgentsForSquad(crowd, defender.id);
    melee.x = 0;
    support.x = -20;
    target.x = 5;

    updateCrowdSim(crowd, sim, 0.05);

    expect(melee.targetAgentId).toBe(target.id);
    expect(support.supportTargetSquadId).toBe(attacker.id);
    expect(support.supportCastCd).toBeGreaterThan(0);
    expect(attacker.statusEffects.some((effect) => (
      effect.type === 'buff' && effect.id === `support-comprehensive:${support.id}`
    ))).toBe(true);
    expect((otherAlly.statusEffects || []).some((effect) => (
      effect.id === `support-comprehensive:${support.id}`
    ))).toBe(false);
  });

  test('lets intervention supports debuff only the enemy targeted by their squad', () => {
    const attacker = buildCombatSquad({
      id: 'intervention-attacker',
      team: 'attacker',
      x: 0,
      units: { test_melee: 1, test_support_intervention: 1 }
    });
    const defender = buildCombatSquad({
      id: 'intervention-defender',
      team: 'defender',
      x: 30,
      units: { test_melee: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    const unrelated = buildCombatSquad({
      id: 'intervention-unrelated',
      team: 'defender',
      x: 5,
      units: { test_melee: 1 },
      controlMode: 'USER',
      behavior: 'idle'
    });
    unrelated.y = 20;
    unrelated.spawnLaneId = 'top';
    const sim = {
      timeElapsed: 0,
      field: { width: 220, height: 140 },
      buildings: [],
      trainingObjectives: [],
      trainingMap: {
        lanes: [
          { id: 'mid', width: 12, centerline: [{ x: -100, y: 0 }, { x: 100, y: 0 }] },
          { id: 'top', width: 12, centerline: [{ x: -100, y: 20 }, { x: 100, y: 20 }] }
        ]
      },
      squads: [attacker, defender, unrelated]
    };
    const crowd = buildCrowd(sim);
    const support = getCrowdAgentsForSquad(crowd, attacker.id)
      .find((agent) => agent.unitCategory === 'support');
    const [target] = getCrowdAgentsForSquad(crowd, defender.id);

    updateCrowdSim(crowd, sim, 0.05);

    expect(support.supportTargetAgentId).toBe(target.id);
    expect(support.supportTargetSquadId).toBe(defender.id);
    expect(defender.statusEffects.some((effect) => (
      effect.type === 'debuff'
      && effect.id === `support-intervention:${support.id}`
      && effect.speedMul < 1
    ))).toBe(true);
    expect((unrelated.statusEffects || []).some((effect) => (
      effect.id === `support-intervention:${support.id}`
    ))).toBe(false);
    expect(target.weight).toBe(1);
  });
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
    expect(resolveTrainingMapMovementScale({
      trainingMap: { movementCalibration: { leaderSpeedMultiplier: 63 } }
    })).toBe(3.5);
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

describe('attack-move engagement flow', () => {
  test('stops ordinary faction formations when their front ranks enter combat range', () => {
    const attacker = {
      ...createSquad({ id: 'formation-attacker', team: 'attacker', x: -17.5 }),
      behavior: 'auto',
      controlMode: 'AI',
      spawnLaneId: 'mid',
      stamina: 100,
      formationRect: { width: 24, depth: 24, spacing: 8, facingRad: 0 },
      order: { type: 'ATTACK_MOVE', targetSquadId: 'formation-defender' },
      waypoints: [{ x: 120, y: 0 }]
    };
    const defender = {
      ...createSquad({ id: 'formation-defender', team: 'defender', x: 17.5 }),
      behavior: 'auto',
      controlMode: 'AI',
      spawnLaneId: 'mid',
      stamina: 100,
      formationRect: { width: 24, depth: 24, spacing: 8, facingRad: Math.PI },
      order: { type: 'ATTACK_MOVE', targetSquadId: 'formation-attacker' },
      waypoints: [{ x: -120, y: 0 }]
    };
    const sim = {
      field: { width: 300, height: 160 },
      buildings: [],
      squads: [attacker, defender],
      timeElapsed: 0,
      trainingMap: {
        lanes: [{ id: 'mid', width: 80, centerline: [{ x: -140, y: 0 }, { x: 140, y: 0 }] }],
        navigation: { aiDecisionsPerStep: 2 }
      }
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.targetSquadId).toBe(defender.id);
    expect(defender.targetSquadId).toBe(attacker.id);
    expect(attacker.waypoints).toEqual([]);
    expect(defender.waypoints).toEqual([]);
    expect(attacker.action).toBe('近战接敌');
    expect(['近战接敌', '兵种攻击']).toContain(defender.action);
  });

  test('pauses the formation anchor for combat and resumes the saved march route', () => {
    const attacker = {
      ...createSquad({ id: 'attacker', team: 'attacker', x: 0 }),
      behavior: 'move',
      controlMode: 'USER',
      stamina: 100,
      order: { type: 'ATTACK_MOVE', targetSquadId: 'defender' },
      waypoints: [{ x: 120, y: 0 }]
    };
    const defender = {
      ...createSquad({ id: 'defender', team: 'defender', x: 8 }),
      behavior: 'idle',
      controlMode: 'USER',
      order: { type: 'IDLE' }
    };
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker, defender],
      timeElapsed: 0
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.waypoints).toEqual([]);
    expect(attacker._attackMoveResumeWaypoints).toEqual([{ x: 120, y: 0 }]);
    expect(attacker.action).toBe('近战接敌');

    defender.remain = 0;
    crowd.agentsBySquad.get(defender.id).forEach((agent) => {
      agent.dead = true;
      agent.weight = 0;
      agent.hpWeight = 0;
    });
    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.waypoints).toEqual([{ x: 120, y: 0 }]);
    expect(attacker._attackMoveResumeWaypoints).toEqual([]);
    expect(attacker.action).toBe('攻击前进');
  });

  test('holds position instead of retargeting when a manual target dies during the simulation step', () => {
    const attacker = {
      ...createSquad({ id: 'manual-attacker', team: 'attacker', x: 0 }),
      behavior: 'move',
      controlMode: 'USER',
      stamina: 100,
      order: {
        type: 'ATTACK_MOVE',
        targetSquadId: 'defeated-target',
        targetBuildingId: '',
        stopAfterTarget: true
      },
      targetSquadId: 'defeated-target',
      waypoints: [{ x: 80, y: 0 }]
    };
    const defeatedTarget = {
      ...createSquad({ id: 'defeated-target', team: 'defender', x: 8 }),
      behavior: 'idle',
      controlMode: 'USER',
      order: { type: 'IDLE' }
    };
    const replacementTarget = {
      ...createSquad({ id: 'replacement-target', team: 'defender', x: 28 }),
      behavior: 'idle',
      controlMode: 'USER',
      order: { type: 'IDLE' }
    };
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker, defeatedTarget, replacementTarget],
      timeElapsed: 0
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });
    crowd.agentsBySquad.get(defeatedTarget.id).forEach((agent) => {
      agent.dead = true;
      agent.weight = 0;
      agent.hpWeight = 0;
    });
    const attackerXBeforeDeathResolution = attacker.x;
    const attackerYBeforeDeathResolution = attacker.y;

    updateCrowdSim(crowd, sim, 0.05);

    expect(defeatedTarget.remain).toBe(0);
    expect(attacker.x).toBe(attackerXBeforeDeathResolution);
    expect(attacker.y).toBe(attackerYBeforeDeathResolution);
    expect(attacker.targetSquadId).toBe('');
    expect(attacker.waypoints).toEqual([]);
    expect(attacker.behavior).toBe('idle');
    expect(attacker.action).toBe('待命');
    expect(attacker.order).toMatchObject({
      type: 'IDLE',
      targetSquadId: '',
      targetBuildingId: ''
    });
    expect(crowd.agentsBySquad.get(attacker.id).every((agent) => (
      !agent.targetAgentId
      && !agent.targetBuildingId
      && !agent.supportTargetAgentId
      && !agent.supportTargetSquadId
    ))).toBe(true);
  });

  test('holds position when a manually targeted building is destroyed', () => {
    const attacker = {
      ...createSquad({ id: 'building-attacker', team: 'attacker', x: 0 }),
      behavior: 'move',
      controlMode: 'USER',
      stamina: 100,
      order: {
        type: 'ATTACK_MOVE',
        targetSquadId: '',
        targetBuildingId: 'destroyed-tower',
        stopAfterTarget: true
      },
      targetBuildingId: 'destroyed-tower',
      waypoints: [{ x: 80, y: 0 }]
    };
    const replacementTarget = {
      ...createSquad({ id: 'building-replacement-target', team: 'defender', x: 24 }),
      behavior: 'idle',
      controlMode: 'USER',
      order: { type: 'IDLE' }
    };
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [{ id: 'destroyed-tower', x: 16, y: 0, hp: 0, destroyed: true }],
      squads: [attacker, replacementTarget],
      timeElapsed: 0
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });
    const attackerXBeforeDestroyedTarget = attacker.x;
    const attackerYBeforeDestroyedTarget = attacker.y;

    updateCrowdSim(crowd, sim, 0.05);

    expect(attacker.x).toBe(attackerXBeforeDestroyedTarget);
    expect(attacker.y).toBe(attackerYBeforeDestroyedTarget);
    expect(attacker.targetSquadId).toBe('');
    expect(attacker.targetBuildingId).toBe('');
    expect(attacker.waypoints).toEqual([]);
    expect(attacker.behavior).toBe('idle');
    expect(attacker.action).toBe('待命');
    expect(attacker.order.type).toBe('IDLE');
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

  test('moves real-map AI toward enemy targets from highland deployments', () => {
    const mapConfig = buildReferenceTrainingMapConfig();
    const field = {
      width: mapConfig.layoutMeta.fieldWidth,
      height: mapConfig.layoutMeta.fieldHeight
    };
    const slotsByTeam = (team) => mapConfig.deploySlots.filter((slot) => slot.team === team);
    const squads = [...slotsByTeam('attacker'), ...slotsByTeam('defender')].map((slot, index) => ({
      ...createSquad({ id: `reference-${index}`, team: slot.team, x: slot.x }),
      y: slot.y,
      spawnLaneId: slot.laneId,
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

    for (let index = 0; index < 240; index += 1) {
      updateCrowdSim(crowd, sim, 1 / 20);
    }

    expect(planCalls).toBeGreaterThan(0);
    expect(planCalls).toBeLessThanOrEqual(60);
    expect(squads.every((squad) => String(squad.targetSquadId || '').startsWith('reference-'))).toBe(true);
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
    controlMode: 'AI',
    spawnLaneId: 'mid',
    stamina: 100,
    order: { type: 'ATTACK_MOVE', pathPoints: [], pathIndex: 0 }
  });

  test('rejects a direct jungle shortcut and follows the assigned road', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const sim = buildAutoSim({ squads: [attacker] });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(sim.trainingNavigator.planRoute).toHaveBeenCalledTimes(1);
    expect(attacker.autoNavigation).toMatchObject({ goalId: 'field-edge:attacker' });
    expect(attacker.waypoints.length).toBeGreaterThan(2);
    expect(attacker.waypoints.some((point) => Number(point?.y) > 100)).toBe(true);
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeLessThanOrEqual(450);
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
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeGreaterThan(400);
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeLessThanOrEqual(450);
    expect(attacker.waypoints[attacker.waypoints.length - 1].y).toBe(0);
    expect(attacker.waypoints.some((point) => Math.abs(point.y) > 100)).toBe(true);
  });

  test('approaches an enemy through the assigned road corridor', () => {
    const attacker = createAutoSquad({ id: 'attacker', team: 'attacker', x: -430 });
    const defender = createSquad({ id: 'defender', team: 'defender', x: 80 });
    const sim = buildAutoSim({ squads: [attacker, defender] });
    const crowd = createCrowdSim(sim);

    updateCrowdSim(crowd, sim, 0.1);

    expect(attacker.waypoints.length).toBeGreaterThan(2);
    expect(attacker.waypoints[0].x).toBeGreaterThan(-430);
    expect(attacker.waypoints.some((point) => Number(point?.y) > 100)).toBe(true);
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeLessThan(120);
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
    expect(Math.abs(endpoint.y)).toBeGreaterThan(60);
    expect(Math.abs(endpoint.y)).toBeLessThanOrEqual(150);
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
    expect(attacker.waypoints.length).toBeGreaterThan(2);
    expect(attacker.waypoints.some((point) => Number(point?.y) > 100)).toBe(true);
    expect(attacker.waypoints[attacker.waypoints.length - 1].x).toBeLessThanOrEqual(450);
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

  test('keeps a neutral patrol formation fixed while soldiers turn with their movement', () => {
    const spacing = 5.55;
    const neutral = {
      ...createSquad({ id: 'neutral-square-patrol', team: 'neutral', x: 0 }),
      remain: 9,
      startCount: 9,
      units: { neutral_guard: 9 },
      isNeutralCampUnit: true,
      stamina: 100,
      controlMode: 'USER',
      behavior: 'move',
      order: { type: 'MOVE', issuedAt: 0, commitUntil: 0, targetPoint: { x: 0, y: 80 }, targetSquadId: '' },
      waypoints: [{ x: 0, y: 80 }],
      formationRect: {
        width: spacing * 3,
        depth: spacing * 3 * 0.92,
        spacing,
        facingRad: 0,
        directionOffsetRad: 0,
        directionRad: 0,
        slotCount: 9,
        formationId: 'neutral-camp-square'
      },
      deploySlots: [
        { side: 0, front: 0 },
        { side: -spacing, front: 0 },
        { side: spacing, front: 0 },
        { side: 0, front: spacing * 0.92 },
        { side: 0, front: -spacing * 0.92 },
        { side: -spacing, front: spacing * 0.92 },
        { side: spacing, front: spacing * 0.92 },
        { side: -spacing, front: -spacing * 0.92 },
        { side: spacing, front: -spacing * 0.92 }
      ],
      stats: { atk: 8, def: 1, speed: 1, range: 1, attackRange: { min: 1, max: 1 } }
    };
    const sim = {
      timeElapsed: 0,
      field: { width: 300, height: 220 },
      buildings: [],
      squads: [neutral]
    };
    const crowd = createCrowdSim(sim, {
      unitTypeMap: new Map([['neutral_guard', { classTag: 'infantry', unitCategory: 'melee' }]]),
      repConfig: { maxAgentWeight: 1 }
    });
    const neutralAgents = getCrowdAgentsForSquad(crowd, neutral.id);
    const flagBearer = neutralAgents.find((row) => row.isFlagBearer);
    const agent = neutralAgents.find((row) => !row.isFlagBearer);
    const slot = { ...agent.formationSlot };
    const flagSlot = { ...flagBearer.formationSlot };

    for (let index = 0; index < 20; index += 1) updateCrowdSim(crowd, sim, 0.05);

    expect(neutral.formationRect.facingRad).toBeCloseTo(0);
    expect(agent.yaw).toBeGreaterThan(0.2);
    expect(agent.x - neutral.x).toBeCloseTo(slot.front, 1);
    expect(agent.y - neutral.y).toBeCloseTo(slot.side, 1);
    expect(flagBearer.x - neutral.x).toBeCloseTo(flagSlot.front, 1);
    expect(flagBearer.y - neutral.y).toBeCloseTo(flagSlot.side, 1);
  });

  test('uses weighted representative agents for a large central neutral camp', () => {
    const mapConfig = buildReferenceTrainingMapConfig();
    const field = {
      width: mapConfig.layoutMeta.fieldWidth,
      height: mapConfig.layoutMeta.fieldHeight
    };
    const definition = mapConfig.objectives.find((objective) => (
      objective?.type === 'neutralCamp'
      && objective?.neutralCamp?.campId === 'camp-center-north'
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
    const { camps, squads } = initializeTrainingNeutralCamps({ definitions: [definition], context });
    const sim = {
      field,
      buildings: [],
      squads,
      trainingNeutralCamps: camps,
      repConfig: { maxAgentWeight: 50, maxTotalAgents: 360, strictAgentMapping: true }
    };
    const crowd = createCrowdSim(sim);
    const [guard] = squads;
    const agents = getCrowdAgentsForSquad(crowd, guard.id);

    expect(guard.representativeAgentWeightCap).toBeUndefined();
    expect(guard.startCount).toBe(480);
    expect(agents).toHaveLength(11);
    expect(agents.length).toBeLessThan(guard.startCount);
    expect(agents.some((agent) => agent.initialWeight > 1)).toBe(true);
    expect(agents.reduce((sum, agent) => sum + agent.initialWeight, 0)).toBe(guard.startCount);
    expect(guard.formationRect).toMatchObject({ slotCount: agents.length, spacing: 20 });
    expect(guard.deploySlots).toHaveLength(agents.length);
    const nearestPairDistance = agents.reduce((nearest, agent, index) => (
      agents.slice(index + 1).reduce((pairNearest, candidate) => (
        Math.min(pairNearest, Math.hypot(agent.x - candidate.x, agent.y - candidate.y))
      ), nearest)
    ), Infinity);
    expect(nearestPairDistance).toBeGreaterThan(18);
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

  test('keeps neutral camp guards passive until attacked, then retaliates', () => {
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

    expect(attacker.targetSquadId).toBe('');
    expect(neutral.targetSquadId).toBe('');
    expect(attackerAgent.weight).toBe(10);
    expect(neutralAgent.weight).toBe(10);

    attacker.order = {
      type: 'ATTACK_MOVE',
      targetSquadId: neutral.id
    };
    attacker.targetSquadId = neutral.id;
    updateCrowdCombat(sim, crowd, 0.2);

    expect(attacker.targetSquadId).toBe(neutral.id);
    expect(neutral.targetSquadId).toBe(attacker.id);
    expect(attackerAgent.weight).toBeLessThan(10);
    expect(neutralAgent.weight).toBeLessThan(10);
  });
});
