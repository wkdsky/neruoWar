import { pickRangedEnemyAgent, updateCrowdCombat } from './crowdCombat';
import { buildSpatialHash } from './crowdPhysics';
import { createCombatEffectsPool } from '../effects/CombatEffects';

describe('ranged automatic target selection', () => {
  test('prefers a low-health enemy already inside weapon range', () => {
    const shooter = { x: 0, y: 0 };
    const healthy = { id: 'healthy', x: 24, y: 0, weight: 10, hpWeight: 10, initialWeight: 10 };
    const wounded = { id: 'wounded', x: 32, y: 0, weight: 2, hpWeight: 2, initialWeight: 10 };

    expect(pickRangedEnemyAgent(shooter, [healthy, wounded], { min: 20, max: 40 })?.id)
      .toBe('wounded');
  });

  test('does not prefer an out-of-range weak target over a valid shot', () => {
    const shooter = { x: 0, y: 0 };
    const valid = { id: 'valid', x: 30, y: 0, weight: 10, hpWeight: 10, initialWeight: 10 };
    const distant = { id: 'distant', x: 90, y: 0, weight: 1, hpWeight: 1, initialWeight: 10 };

    expect(pickRangedEnemyAgent(shooter, [valid, distant], { min: 20, max: 40 })?.id)
      .toBe('valid');
  });

  test('uses an individual ranged agent range inside a melee-led mixed squad', () => {
    const attacker = {
      id: 'mixed-attacker',
      team: 'attacker',
      x: 0,
      y: 0,
      remain: 2,
      startCount: 2,
      health: 200,
      maxHealth: 200,
      radius: 10,
      classTag: 'infantry',
      unitCategory: 'melee',
      behavior: 'auto',
      controlMode: 'AI',
      order: { type: 'ATTACK_MOVE', targetSquadId: 'mixed-defender' },
      stats: { atk: 20, def: 1, speed: 1, range: 1, attackRange: { min: 0, max: 1 } }
    };
    const defender = {
      id: 'mixed-defender',
      team: 'defender',
      x: 70,
      y: 0,
      remain: 1,
      startCount: 1,
      health: 100,
      maxHealth: 100,
      radius: 10,
      classTag: 'infantry',
      behavior: 'idle',
      controlMode: 'USER',
      order: { type: 'IDLE' },
      stats: { atk: 10, def: 1, speed: 1 }
    };
    const rangedAgent = {
      id: 'mixed-ranged',
      squadId: attacker.id,
      team: attacker.team,
      x: 0,
      y: 0,
      radius: 2,
      weight: 1,
      hpWeight: 1,
      initialWeight: 1,
      typeCategory: 'archer',
      unitCategory: 'ranged',
      attackRangeMin: 56,
      attackRangeMax: 112,
      targetAgentId: 'mixed-target',
      dead: false
    };
    const meleeAgent = {
      ...rangedAgent,
      id: 'mixed-melee',
      typeCategory: 'infantry',
      unitCategory: 'melee',
      attackRangeMin: 0,
      attackRangeMax: 6.2,
      targetAgentId: ''
    };
    const target = {
      id: 'mixed-target',
      squadId: defender.id,
      team: defender.team,
      x: 70,
      y: 0,
      radius: 2,
      weight: 1,
      hpWeight: 1,
      initialWeight: 1,
      typeCategory: 'infantry',
      unitCategory: 'melee',
      dead: false
    };
    const allAgents = [rangedAgent, meleeAgent, target];
    const crowd = {
      agentsBySquad: new Map([
        [attacker.id, [rangedAgent, meleeAgent]],
        [defender.id, [target]]
      ]),
      allAgents,
      spatial: buildSpatialHash(allAgents, 14),
      effectsPool: createCombatEffectsPool(),
      engagement: { enabled: false, config: {} }
    };
    const sim = {
      timeElapsed: 1,
      field: { width: 240, height: 160 },
      buildings: [],
      squads: [attacker, defender]
    };

    updateCrowdCombat(sim, crowd, 0.1);

    expect(rangedAgent.targetAgentId).toBe(target.id);
    expect(crowd.effectsPool.projectileLive.some((projectile) => (
      projectile.sourceAgentId === rangedAgent.id && projectile.type === 'arrow'
    ))).toBe(true);
    expect(meleeAgent.targetAgentId).toBe('');
  });
});
