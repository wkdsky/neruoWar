import BattleRuntime from './BattleRuntime';

const buildInit = () => ({
  mode: 'training',
  rules: { allowCrossMidline: true, maxDeployGroupTotal: 10000 },
  battlefield: {
    layoutMeta: { fieldWidth: 2400, fieldHeight: 1200 },
    objects: []
  },
  unitTypes: [{
    unitTypeId: 'infantry',
    name: '步兵',
    classTag: 'infantry',
    hp: 10,
    atk: 2,
    def: 1,
    speed: 1,
    range: 1
  }],
  attacker: {
    rosterUnits: [{ unitTypeId: 'infantry', count: 40000 }],
    deployUnits: []
  },
  defender: {
    rosterUnits: [],
    deployUnits: []
  }
});

describe('BattleRuntime training performance profile', () => {
  test('applies the representative-agent budget when training starts', () => {
    const runtime = new BattleRuntime(buildInit(), {
      repConfig: {
        maxAgentWeight: 50,
        maxTotalAgents: 180,
        strictAgentMapping: true
      }
    });

    for (let index = 0; index < 4; index += 1) {
      runtime.createDeployGroup('attacker', {
        units: { infantry: 10000 },
        placed: true
      });
    }

    expect(runtime.startBattle()).toMatchObject({ ok: true });
    expect(runtime.sim.repConfig).toMatchObject({
      maxTotalAgents: 180,
      requestedMaxAgentWeight: 50
    });
    expect(runtime.crowd.allAgents).toHaveLength(runtime.sim.repConfig.estimatedAgentCount);
    expect(runtime.crowd.allAgents.length).toBeLessThanOrEqual(180);
    const weightedCombatPower = runtime.crowd.allAgents.reduce((sum, agent) => (
      sum
        + Math.pow(agent.weight, 0.75)
        * agent.combatScale
    ), 0);
    const baselineCombatPower = 4 * 200 * Math.pow(50, 0.75);
    expect(weightedCombatPower).toBeCloseTo(baselineCombatPower, 5);
    expect(runtime.getPerformanceCaptureContext()).toMatchObject({
      representativeAgentBudget: 180,
      representativeAgentCount: runtime.crowd.allAgents.length
    });
  });
});
