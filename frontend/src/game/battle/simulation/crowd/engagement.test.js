import { createCrowdSim } from './CrowdSim';
import { resolveSquadAttackRange } from './attackRange';
import { updateCrowdCombat } from './crowdCombat';
import { buildSpatialHash } from './crowdPhysics';
import { syncMeleeEngagement } from './engagement';

const createMeleeSquad = ({ id, team, x }) => ({
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
  roleTag: '近战',
  units: {},
  stats: { atk: 20, def: 1, speed: 1, range: 1, attackRange: { min: 1, max: 1 } },
  behavior: 'auto',
  controlMode: 'AI',
  order: { type: 'ATTACK_MOVE', commitUntil: 0 },
  waypoints: []
});

describe('melee engagement contact', () => {
  test('keeps frontline anchors within normal infantry hit range and deals damage', () => {
    const attacker = createMeleeSquad({ id: 'attacker', team: 'attacker', x: -6 });
    const defender = createMeleeSquad({ id: 'defender', team: 'defender', x: 6 });
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker, defender],
      timeElapsed: 0.1
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    syncMeleeEngagement(crowd, sim, [], 0.1, sim.timeElapsed);

    const [attackerAgent] = crowd.agentsBySquad.get(attacker.id);
    const [defenderAgent] = crowd.agentsBySquad.get(defender.id);
    attackerAgent.x = attackerAgent.engageAx;
    attackerAgent.y = attackerAgent.engageAy;
    defenderAgent.x = defenderAgent.engageAx;
    defenderAgent.y = defenderAgent.engageAy;
    crowd.allAgents = [attackerAgent, defenderAgent];
    crowd.spatial = buildSpatialHash(crowd.allAgents, 14);

    const frontlineDistance = Math.hypot(attackerAgent.x - defenderAgent.x, attackerAgent.y - defenderAgent.y);
    expect(frontlineDistance).toBeLessThanOrEqual(resolveSquadAttackRange(attacker).max);

    const defenderWeight = defenderAgent.weight;
    updateCrowdCombat(sim, crowd, 0.1);

    expect(defenderAgent.weight).toBeLessThan(defenderWeight);
  });

  test('keeps minion engagement locked to the same lane', () => {
    const attackerTop = {
      ...createMeleeSquad({ id: 'attacker-top', team: 'attacker', x: -40 }),
      y: 200,
      isMinionWaveUnit: true,
      minionLaneId: 'top',
      targetSquadId: 'defender-top'
    };
    const defenderTop = {
      ...createMeleeSquad({ id: 'defender-top', team: 'defender', x: 40 }),
      y: 200,
      isMinionWaveUnit: true,
      minionLaneId: 'top',
      targetSquadId: 'attacker-top'
    };
    const defenderMid = {
      ...createMeleeSquad({ id: 'defender-mid', team: 'defender', x: -32 }),
      y: 194,
      isMinionWaveUnit: true,
      minionLaneId: 'mid'
    };
    const sim = {
      field: { width: 300, height: 500 },
      buildings: [],
      squads: [attackerTop, defenderTop, defenderMid],
      timeElapsed: 0.1
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    syncMeleeEngagement(crowd, sim, [], 0.1, sim.timeElapsed);

    const [attackerAgent] = crowd.agentsBySquad.get(attackerTop.id);
    expect(attackerTop.targetSquadId).toBe(defenderTop.id);
    expect(attackerAgent.engageEnemySquadId).toBe(defenderTop.id);
  });

  test('creates melee anchors against a hostile neutral squad', () => {
    const attacker = createMeleeSquad({ id: 'attacker', team: 'attacker', x: -6 });
    const neutral = {
      ...createMeleeSquad({ id: 'neutral', team: 'neutral', x: 6 }),
      behavior: 'guard'
    };
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [attacker, neutral],
      timeElapsed: 0.1
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    syncMeleeEngagement(crowd, sim, [], 0.1, sim.timeElapsed);

    expect(crowd.agentsBySquad.get(attacker.id)[0].engageEnemySquadId).toBe(neutral.id);
    expect(crowd.agentsBySquad.get(neutral.id)[0].engageEnemySquadId).toBe(attacker.id);
  });

  test('does not pull a user move out of formation to retaliate', () => {
    const moving = {
      ...createMeleeSquad({ id: 'moving', team: 'attacker', x: -6 }),
      controlMode: 'USER',
      behavior: 'move',
      underAttackTimer: 1,
      order: { type: 'MOVE', commitUntil: 0 }
    };
    const enemy = createMeleeSquad({ id: 'enemy', team: 'defender', x: 6 });
    const sim = {
      field: { width: 300, height: 200 },
      buildings: [],
      squads: [moving, enemy],
      timeElapsed: 0.1
    };
    const crowd = createCrowdSim(sim, {
      repConfig: { maxAgentWeight: 100, strictAgentMapping: true }
    });

    syncMeleeEngagement(crowd, sim, [], 0.1, sim.timeElapsed);

    expect(crowd.agentsBySquad.get(moving.id)[0].engagePairKey).toBe('');
  });
});
