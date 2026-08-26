import { pickRangedEnemyAgent, updateCrowdCombat } from './crowdCombat';
import { buildSpatialHash } from './crowdPhysics';
import { createCombatEffectsPool } from '../effects/CombatEffects';

describe('ranged automatic target selection', () => {
  const buildProjectileScenario = ({
    targetX = 70,
    targetY = 0,
    targetVx = 0,
    targetVy = 0,
    minionWave = false
  } = {}) => {
    const attacker = {
      id: 'projectile-attacker',
      team: 'attacker',
      x: 0,
      y: 0,
      remain: 1,
      startCount: 1,
      health: 100,
      maxHealth: 100,
      radius: 10,
      classTag: 'archer',
      unitCategory: 'ranged',
      isMinionWaveUnit: minionWave,
      behavior: 'auto',
      controlMode: 'AI',
      order: { type: 'ATTACK_MOVE', targetSquadId: 'projectile-defender' },
      stats: { atk: 20, def: 1, speed: 1, range: 8, attackRange: { min: 4, max: 8 } }
    };
    if (minionWave) {
      attacker._minionAi = {
        state: 'ATTACK_HOLD',
        targetKind: 'squad',
        targetId: 'projectile-defender'
      };
      attacker.targetSquadId = 'projectile-defender';
    }
    const defender = {
      id: 'projectile-defender',
      team: 'defender',
      x: targetX,
      y: targetY,
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
    const shooter = {
      id: 'projectile-shooter',
      squadId: attacker.id,
      team: attacker.team,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 2,
      weight: 1,
      hpWeight: 1,
      initialWeight: 1,
      typeCategory: 'archer',
      unitCategory: 'ranged',
      attackRangeMin: 56,
      attackRangeMax: 112,
      targetAgentId: 'projectile-target',
      isMinionWaveUnit: minionWave,
      dead: false
    };
    const target = {
      id: 'projectile-target',
      squadId: defender.id,
      team: defender.team,
      x: targetX,
      y: targetY,
      vx: targetVx,
      vy: targetVy,
      radius: 2,
      weight: 1,
      hpWeight: 1,
      initialWeight: 1,
      typeCategory: 'infantry',
      unitCategory: 'melee',
      dead: false
    };
    const allAgents = [shooter, target];
    const crowd = {
      agentsBySquad: new Map([
        [attacker.id, [shooter]],
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
    return { attacker, target, crowd, sim };
  };

  const finishProjectileFlight = ({ attacker, target, crowd, sim }, frames = 12) => {
    updateCrowdCombat(sim, crowd, 0.05);
    attacker.behavior = 'standby';
    for (let frame = 0; frame < frames && !target.dead; frame += 1) {
      target.x += (Number(target.vx) || 0) * 0.05;
      target.y += (Number(target.vy) || 0) * 0.05;
      crowd.spatial = buildSpatialHash(crowd.allAgents, 14);
      updateCrowdCombat(sim, crowd, 0.05);
    }
  };

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

  test('hits a target crossed between two fast projectile frames', () => {
    const scenario = buildProjectileScenario({ targetX: 70 });

    finishProjectileFlight(scenario);

    expect(scenario.target.hpWeight).toBeLessThan(1);
  });

  test('leads a laterally moving target before firing', () => {
    const scenario = buildProjectileScenario({ targetX: 70, targetVy: 20 });

    finishProjectileFlight(scenario);

    expect(scenario.target.hpWeight).toBeLessThan(1);
  });

  test('keeps assigned minion shots accurate even at the worst random roll', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(1);
    const scenario = buildProjectileScenario({ targetX: 70, targetVy: 20, minionWave: true });

    finishProjectileFlight(scenario);

    expect(scenario.target.hpWeight).toBeLessThan(1);
    random.mockRestore();
  });

  test('does not let an assigned minion arrow damage a crossing decoy', () => {
    const scenario = buildProjectileScenario({ targetX: 70, minionWave: true });
    const decoy = {
      id: 'projectile-decoy',
      squadId: scenario.target.squadId,
      team: scenario.target.team,
      x: 35,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 2,
      weight: 1,
      hpWeight: 1,
      initialWeight: 1,
      typeCategory: 'infantry',
      unitCategory: 'melee',
      dead: false
    };
    scenario.crowd.agentsBySquad.get(scenario.target.squadId).push(decoy);
    scenario.crowd.allAgents.push(decoy);
    scenario.crowd.spatial = buildSpatialHash(scenario.crowd.allAgents, 14);

    finishProjectileFlight(scenario, 16);

    expect(scenario.target.hpWeight).toBeLessThan(1);
    expect(decoy.hpWeight).toBe(1);
  });
});
