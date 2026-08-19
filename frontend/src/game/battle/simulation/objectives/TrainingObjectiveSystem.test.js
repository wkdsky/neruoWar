import { createCombatEffectsPool } from '../effects/CombatEffects';
import {
  createTrainingObjectives,
  getTrainingObjectiveSummary,
  updateTrainingObjectives
} from './TrainingObjectiveSystem';

const buildAttacker = (overrides = {}) => {
  const squad = {
    id: 'attacker_squad',
    team: 'attacker',
    classTag: 'archer',
    roleTag: '远程',
    behavior: 'auto',
    remain: 25,
    x: 0,
    y: 0,
    radius: 10,
    stats: {
      atk: 10,
      def: 1,
      range: 10,
      attackRange: { min: 3, max: 10 }
    }
  };
  return {
    ...squad,
    ...overrides,
    stats: {
      ...squad.stats,
      ...(overrides?.stats || {})
    }
  };
};

const buildSim = ({ definition, building }) => {
  const squad = buildAttacker();
  return {
    timeElapsed: 1,
    squads: [squad],
    buildings: [building],
    trainingObjectives: createTrainingObjectives([definition]),
    trainingMap: {
      lanes: [{ id: 'mid', centerY: 0, width: 150 }]
    },
    _squadById: new Map([[squad.id, squad]])
  };
};

describe('TrainingObjectiveSystem', () => {
  test('lets squads damage towers and exposes tower lock feedback', () => {
    const tower = {
      id: 'tower_defender_mid',
      x: 100,
      y: 0,
      width: 52,
      depth: 52,
      height: 88,
      hp: 1200,
      maxHp: 1200,
      defense: 1,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = buildSim({
      definition: {
        objectiveId: 'tower_defender_mid',
        sourceObjectId: 'tower_defender_mid',
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: 1200,
        attackRange: 180,
        attackIntervalSec: 0.2,
        attackDamage: 8
      },
      building: tower
    });
    const agent = {
      id: 'attacker_agent',
      squadId: 'attacker_squad',
      team: 'attacker',
      x: 0,
      y: 0,
      radius: 2,
      weight: 30,
      hpWeight: 30,
      initialWeight: 30,
      dead: false
    };
    const crowd = {
      agentsBySquad: new Map([['attacker_squad', [agent]]]),
      effectsPool: createCombatEffectsPool()
    };

    updateTrainingObjectives(sim, crowd, 0.25);

    expect(tower.hp).toBeLessThan(1200);
    expect(sim.trainingStats.towerDamage).toBeGreaterThan(0);
    expect(sim.trainingObjectives[0].lockedSquadId).toBe('attacker_squad');
    expect(agent.weight).toBeLessThan(30);
  });

  test('uses configured tower threat priority and retargets invalid squads', () => {
    const tower = {
      id: 'tower_defender_mid',
      x: 100,
      y: 0,
      width: 52,
      depth: 52,
      height: 88,
      hp: 1200,
      maxHp: 1200,
      defense: 1,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = buildSim({
      definition: {
        objectiveId: 'tower_defender_mid',
        sourceObjectId: 'tower_defender_mid',
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: 1200,
        attackRange: 180,
        attackIntervalSec: 0.1,
        attackDamage: 8,
        priority: 'highest-threat',
        threatDecayPerSecond: 0
      },
      building: tower
    });
    const nearest = buildAttacker({ id: 'nearest_squad', x: 70 });
    const aggressor = buildAttacker({
      id: 'aggressor_squad',
      x: 64,
      stats: { atk: 40 }
    });
    sim.squads = [nearest, aggressor];
    sim._squadById = new Map(sim.squads.map((squad) => [squad.id, squad]));
    const nearestAgent = {
      id: 'nearest_agent',
      squadId: nearest.id,
      team: 'attacker',
      x: nearest.x,
      y: nearest.y,
      radius: 2,
      weight: 30,
      hpWeight: 30,
      initialWeight: 30,
      dead: false
    };
    const aggressorAgent = {
      id: 'aggressor_agent',
      squadId: aggressor.id,
      team: 'attacker',
      x: aggressor.x,
      y: aggressor.y,
      radius: 2,
      weight: 30,
      hpWeight: 30,
      initialWeight: 30,
      dead: false
    };
    const crowd = {
      agentsBySquad: new Map([
        [nearest.id, [nearestAgent]],
        [aggressor.id, [aggressorAgent]]
      ]),
      effectsPool: createCombatEffectsPool()
    };

    updateTrainingObjectives(sim, crowd, 0.2);

    const objective = sim.trainingObjectives[0];
    expect(objective.priority).toBe('highestThreat');
    expect(objective.threatBySquadId[aggressor.id]).toBeGreaterThan(objective.threatBySquadId[nearest.id]);
    expect(objective.lockedSquadId).toBe(aggressor.id);
    expect(objective.currentTargetId).toBe(aggressor.id);
    expect(aggressorAgent.weight).toBeLessThan(30);
    expect(nearestAgent.weight).toBe(30);

    aggressor.remain = 0;
    aggressorAgent.dead = true;
    sim.timeElapsed = 1.2;
    updateTrainingObjectives(sim, crowd, 0.2);

    expect(objective.lockedSquadId).toBe(nearest.id);
    expect(objective.currentTargetId).toBe(nearest.id);
    expect(nearestAgent.weight).toBeLessThan(30);
  });

  test('marks destroyed towers once and exposes their authoritative runtime state', () => {
    const tower = {
      id: 'tower_defender_mid',
      x: 24,
      y: 0,
      width: 52,
      depth: 52,
      height: 88,
      hp: 1,
      maxHp: 1,
      defense: 1,
      blocksMovement: true,
      blocksVision: true,
      destroyed: false
    };
    const sim = buildSim({
      definition: {
        objectiveId: 'tower_defender_mid',
        sourceObjectId: 'tower_defender_mid',
        type: 'tower',
        team: 'defender',
        laneId: 'mid',
        maxHp: 1,
        attackEnabled: false
      },
      building: tower
    });
    const crowd = {
      agentsBySquad: new Map([['attacker_squad', []]]),
      effectsPool: createCombatEffectsPool()
    };

    updateTrainingObjectives(sim, crowd, 0.2);
    updateTrainingObjectives(sim, crowd, 0.2);

    const [summary] = getTrainingObjectiveSummary(sim);
    expect(tower.destroyed).toBe(true);
    expect(sim.trainingObjectives[0].destroyed).toBe(true);
    expect(sim.destroyedBuildings).toBe(1);
    expect(sim.trainingStats.towerKills).toBe(1);
    expect(sim.trainingStats.objectiveKillsById.tower_defender_mid).toBe(1);
    expect(summary).toMatchObject({
      destroyed: true,
      currentTargetId: '',
      destroyedAt: 1,
      priority: 'nearest'
    });
  });

  test('respawns neutral training camps after their configured delay', () => {
    const camp = {
      id: 'neutral_camp',
      x: 24,
      y: 0,
      width: 42,
      depth: 42,
      height: 24,
      hp: 1,
      maxHp: 1,
      defense: 1,
      blocksMovement: false,
      blocksVision: false,
      destroyed: false
    };
    const sim = buildSim({
      definition: {
        objectiveId: 'neutral_camp',
        sourceObjectId: 'neutral_camp',
        type: 'neutralCamp',
        team: 'neutral',
        laneId: 'mid',
        maxHp: 1,
        respawnSec: 1,
        attackEnabled: false
      },
      building: camp
    });
    const crowd = {
      agentsBySquad: new Map([['attacker_squad', []]]),
      effectsPool: createCombatEffectsPool()
    };

    updateTrainingObjectives(sim, crowd, 0.25);
    expect(sim.trainingObjectives[0].destroyed).toBe(true);
    expect(sim.trainingStats.neutralKills).toBe(1);
    expect(camp.destroyed).toBe(true);

    sim.timeElapsed = 2.1;
    updateTrainingObjectives(sim, crowd, 0.01);
    expect(sim.trainingObjectives[0].destroyed).toBe(false);
    expect(camp.destroyed).toBe(false);
    expect(camp.hp).toBe(1);
  });
});
