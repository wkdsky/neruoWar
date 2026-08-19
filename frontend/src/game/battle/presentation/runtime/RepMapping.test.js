import {
  estimateSquadRepAgents,
  resolveRepConfigForSquads
} from './RepMapping';

describe('training representative agent budget', () => {
  test('raises representative weight to stay inside the configured global budget', () => {
    const squads = [
      { units: { infantry: 10000 } },
      { units: { archer: 10000 } },
      { units: { cavalry: 10000 } },
      { units: { artillery: 10000 } }
    ];

    expect(estimateSquadRepAgents(squads, 50)).toBe(800);

    const config = resolveRepConfigForSquads(squads, {
      maxAgentWeight: 50,
      maxTotalAgents: 360,
      strictAgentMapping: true
    });

    expect(config.requestedMaxAgentWeight).toBe(50);
    expect(config.effectiveMaxAgentWeight).toBeGreaterThan(50);
    expect(config.estimatedAgentCount).toBeLessThanOrEqual(360);
    expect(estimateSquadRepAgents(squads, config.maxAgentWeight)).toBe(config.estimatedAgentCount);
  });

  test('keeps the requested representative density when no global budget is set', () => {
    const squads = [{ units: { infantry: 1000, archer: 1000 } }];
    const config = resolveRepConfigForSquads(squads, {
      maxAgentWeight: 50,
      maxTotalAgents: 0
    });

    expect(config.maxAgentWeight).toBe(50);
    expect(config.estimatedAgentCount).toBe(40);
  });

  test('keeps neutral camp troops one-to-one while budgeting other squads', () => {
    const neutralCamp = {
      representativeAgentWeightCap: 1,
      units: { neutral_melee: 8, neutral_ranged: 6, neutral_support: 3 }
    };
    const squads = [neutralCamp, { units: { infantry: 10000 } }];
    const config = resolveRepConfigForSquads(squads, {
      maxAgentWeight: 50,
      maxTotalAgents: 180,
      strictAgentMapping: true
    });

    expect(estimateSquadRepAgents([neutralCamp], 50)).toBe(17);
    expect(estimateSquadRepAgents([neutralCamp], config.maxAgentWeight)).toBe(17);
    expect(config.estimatedAgentCount).toBeLessThanOrEqual(180);
  });
});
