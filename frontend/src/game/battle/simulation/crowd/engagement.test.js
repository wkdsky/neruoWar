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
});
