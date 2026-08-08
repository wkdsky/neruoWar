import {
  acquireDamageNumber,
  createCombatEffectsPool,
  stepEffectPool
} from './CombatEffects';

describe('combat damage numbers', () => {
  test('batches closely timed hits for the same squad and releases the entry after its lifetime', () => {
    const pool = createCombatEffectsPool();
    const first = acquireDamageNumber(pool, {
      squadId: 'defender_1',
      team: 'defender',
      x: 12,
      y: 8,
      amount: 1.25
    });
    const batched = acquireDamageNumber(pool, {
      squadId: 'defender_1',
      team: 'defender',
      x: 13,
      y: 9,
      amount: 2.75
    });

    expect(batched).toBe(first);
    expect(pool.damageNumberLive).toHaveLength(1);
    expect(first.amount).toBeCloseTo(4, 6);
    expect(first.revision).toBe(2);

    stepEffectPool(pool, 1);
    expect(pool.damageNumberLive).toHaveLength(0);
    expect(pool.damageNumberFree).toHaveLength(1);
  });
});
